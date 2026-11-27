import { WorkerEntrypoint } from "cloudflare:workers";
import { json, methodNotAllowed, notFound } from "./lib/http";
import type { Env } from "./lib/types";

type EventRow = {
  id: string;
  kind: string;
  occurred_at: string;
  received_at: string;
  visitor_id: string | null;
  session_id: string | null;
  payload: string;
};

const kinds = new Set([
  "arrival",
  "view",
  "inquiry_cta",
  "configurator_cta",
  "inquiry_accepted",
  "ad_attribution",
]);

function instant(value: unknown): value is string {
  return (
    typeof value === "string" &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}

function isEventRow(value: unknown): value is EventRow {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<EventRow>;
  return (
    typeof row.id === "string" &&
    !!row.id &&
    typeof row.kind === "string" &&
    kinds.has(row.kind) &&
    instant(row.occurred_at) &&
    instant(row.received_at) &&
    typeof row.payload === "string" &&
    (row.kind === "arrival"
      ? row.visitor_id === null && row.session_id === null
      : typeof row.visitor_id === "string" && typeof row.session_id === "string")
  );
}

const insert = `INSERT INTO h2_acquisition_events
  (workspace_id, id, kind, occurred_at, received_at, visitor_id, session_id, payload)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(kind, id) DO UPDATE SET payload = excluded.payload
  WHERE workspace_id IS NOT excluded.workspace_id
     OR occurred_at IS NOT excluded.occurred_at
     OR received_at IS NOT excluded.received_at
     OR visitor_id IS NOT excluded.visitor_id
     OR session_id IS NOT excluded.session_id
     OR payload IS NOT excluded.payload`;

// A named Cloudflare entrypoint is reachable only by its Worker service binding.
// The normal API and browser proxy have no route to it.
export class H2AcquisitionIngest extends WorkerEntrypoint<Env> {
  async fetch(request: Request): Promise<Response> {
    if (new URL(request.url).pathname !== "/h2-acquisition") return notFound("Route not found");
    if (request.method !== "POST") return methodNotAllowed(["POST"]);
    const workspaceId = this.env.CABINET_ANALYTICS_WORKSPACE_ID;
    if (!workspaceId) return json({ error: "acquisition_workspace_not_configured" }, 503);
    const body = (await request.json().catch(() => null)) as {
      events?: unknown[];
      caughtUp?: boolean;
    } | null;
    if (
      !body ||
      !Array.isArray(body.events) ||
      body.events.length > 50 ||
      !body.events.every(isEventRow) ||
      typeof body.caughtUp !== "boolean" ||
      body.caughtUp !== (body.events.length === 0)
    ) {
      return json({ error: "invalid_acquisition_batch" }, 400);
    }

    if (body.caughtUp) {
      await this.env.DB.prepare(
        `INSERT INTO h2_acquisition_delivery_state(workspace_id, caught_up_at) VALUES (?, ?)
         ON CONFLICT(workspace_id) DO UPDATE SET caught_up_at = excluded.caught_up_at`
      )
        .bind(workspaceId, new Date().toISOString())
        .run();
    } else {
      // D1 either accepts the whole batch or rolls it back. The immutable-row
      // trigger rejects a reused event key whose original evidence differs.
      await this.env.DB.batch(
        body.events.map((row) =>
          this.env.DB.prepare(insert).bind(
            workspaceId,
            row.id,
            row.kind,
            row.occurred_at,
            row.received_at,
            row.visitor_id,
            row.session_id,
            row.payload
          )
        )
      );
    }
    return new Response(null, { status: 204 });
  }
}
