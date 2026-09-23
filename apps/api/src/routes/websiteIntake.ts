import { canAccessWorkspace, requireActor } from "../lib/access";
import type { Env } from "../lib/types";
import { badRequest, json, methodNotAllowed, notFound } from "../lib/http";
import { decryptSecrets } from "../lib/crypto/secrets";

const KEYS = [
  "externalEventId",
  "email",
  "firstName",
  "lastName",
  "name",
  "phone",
  "companyName",
  "projectType",
  "location",
  "timeline",
  "budget",
  "message",
  "sourcePath",
  "marketingConsent",
  "opportunity",
];
type Fields = Record<string, string> & { email: string; externalEventId: string };
type Opportunity = {
  description: string;
  type: "furniture" | "cabinets" | "other";
  budgetCents: number;
};
type Consent = {
  state: "granted" | "revoked" | "not_provided";
  disclosureVersion?: string;
  capturedAt?: string;
};

export async function handleWebsiteIntake(segments: string[], request: Request, env: Env) {
  if (segments.length !== 1) return notFound("Route not found");
  if (request.method !== "POST") return methodNotAllowed(["POST"]);
  const integration = await env.DB.prepare(
    `SELECT id,workspace_id,secrets_key_id,secrets_ciphertext FROM integrations WHERE id=? AND provider='website' AND is_active=1`
  )
    .bind(segments[0])
    .first<{
      id: string;
      workspace_id: string;
      secrets_key_id: string;
      secrets_ciphertext: string;
    }>();
  const token = request.headers.get("authorization")?.match(/^Bearer (\S+)$/)?.[1];
  if (!integration || !token) return json({ error: "invalid_integration_credential" }, 401);
  const secrets = JSON.parse(
    await decryptSecrets(env, integration.secrets_key_id, integration.secrets_ciphertext)
  ) as { intakeToken?: string };
  if (!secrets.intakeToken || !(await equalToken(token, secrets.intakeToken)))
    return json({ error: "invalid_integration_credential" }, 401);
  if (new URL(request.url).search) return badRequest("query_parameters_not_supported");
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json"))
    return json({ error: "application_json_required" }, 415);
  const reader = request.body?.getReader();
  if (!reader) return badRequest("invalid_payload");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 65536) {
      await reader.cancel();
      return json({ error: "payload_too_large" }, 413);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let raw: string;
  let parsed: unknown;
  try {
    raw = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    parsed = JSON.parse(raw);
  } catch {
    return badRequest("invalid_json");
  }
  const validated = validatePayload(parsed);
  if (!validated) return badRequest("invalid_payload");
  const { fields, consent, opportunity } = validated;
  const { id: integrationId, workspace_id: workspaceId } = integration;
  const replay = async () =>
    await env.DB.prepare(
      `SELECT id,raw_payload,reconciliation_status FROM website_submissions WHERE integration_id=? AND external_event_id=?`
    )
      .bind(integrationId, fields.externalEventId)
      .first<{ id: string; raw_payload: string; reconciliation_status: string }>();
  const response = (
    row: { id: string; raw_payload: string; reconciliation_status: string },
    duplicate: boolean
  ) =>
    canonical(JSON.parse(row.raw_payload)) !== canonical(parsed)
      ? json({ error: "event_id_payload_conflict" }, 409)
      : json(
          { submissionId: row.id, status: row.reconciliation_status, duplicate },
          duplicate ? 200 : 201
        );
  const previous = await replay();
  if (previous) return response(previous, true);
  const id = crypto.randomUUID();
  const customerId = crypto.randomUUID();
  const contactId = crypto.randomUUID();
  const now = new Date().toISOString();
  const name =
    fields.name || [fields.firstName, fields.lastName].filter(Boolean).join(" ") || fields.email;
  const statement = (sql: string, ...values: unknown[]) => env.DB.prepare(sql).bind(...values);
  // Matching and all writes run inside a single D1 transaction, including the
  // unique event claim. Concurrent new events see the preceding batch's contact.
  const batch = [
    statement(
      `INSERT INTO website_submissions
      (id,workspace_id,integration_id,external_event_id,email,fields_json,raw_payload,received_at,customer_id,contact_id,reconciliation_status)
      SELECT ?,?,?,?,?,?,?,?,
        CASE WHEN count(*)=0 THEN ? WHEN count(*)=1 AND max(ct.status)='active' AND max(c.status)!='archived' THEN max(ct.customer_id) END,
        CASE WHEN count(*)=0 THEN ? WHEN count(*)=1 AND max(ct.status)='active' AND max(c.status)!='archived' THEN max(ct.id) END,
        CASE WHEN count(*)=0 OR (count(*)=1 AND max(ct.status)='active' AND max(c.status)!='archived') THEN 'linked' ELSE 'needs_review' END
      FROM contacts ct LEFT JOIN customers c ON c.id=ct.customer_id AND c.workspace_id=ct.workspace_id
      WHERE ct.workspace_id=? AND lower(trim(ct.email))=?`,
      id,
      workspaceId,
      integrationId,
      fields.externalEventId,
      fields.email,
      JSON.stringify({ ...fields, marketingConsent: consent, opportunity }),
      raw,
      now,
      customerId,
      contactId,
      workspaceId,
      fields.email
    ),
    statement(
      `INSERT INTO customers (id,workspace_id,display_name,company_name,status,lead_source,primary_contact_id,created_at,updated_at)
      SELECT customer_id,workspace_id,?,?,'lead','website',contact_id,?,? FROM website_submissions WHERE id=? AND customer_id=?`,
      name,
      fields.companyName || null,
      now,
      now,
      id,
      customerId
    ),
    statement(
      `INSERT INTO contacts (id,workspace_id,customer_id,display_name,email,is_primary,created_at,updated_at)
      SELECT contact_id,workspace_id,customer_id,?,email,1,?,? FROM website_submissions WHERE id=? AND contact_id=?`,
      name,
      now,
      now,
      id,
      contactId
    ),
    statement(
      `UPDATE contacts SET display_name=coalesce(nullif(trim(display_name),''),?),first_name=coalesce(nullif(trim(first_name),''),?),last_name=coalesce(nullif(trim(last_name),''),?),phone=coalesce(nullif(trim(phone),''),?),updated_at=?
      WHERE workspace_id=? AND id=(SELECT contact_id FROM website_submissions WHERE id=?)`,
      name,
      fields.firstName || null,
      fields.lastName || null,
      fields.phone || null,
      now,
      workspaceId,
      id
    ),
    statement(
      `UPDATE customers SET display_name=coalesce(nullif(trim(display_name),''),?),company_name=coalesce(nullif(trim(company_name),''),?),updated_at=?
      WHERE workspace_id=? AND id=(SELECT customer_id FROM website_submissions WHERE id=?)`,
      name,
      fields.companyName || null,
      now,
      workspaceId,
      id
    ),
    statement(
      `INSERT INTO customer_activities (id,workspace_id,customer_id,activity_type,subject,body,source,external_entity_id,occurred_at,created_at)
      SELECT ?,workspace_id,customer_id,'website_submission','Website inquiry',?,'website',id,received_at,received_at
      FROM website_submissions WHERE id=? AND customer_id IS NOT NULL`,
      crypto.randomUUID(),
      Object.entries({ ...fields, marketingConsent: consent.state })
        .map(([key, value]) => `${key}: ${value}`)
        .join("\n"),
      id
    ),
  ];
  if (opportunity) {
    const match = `workspace_id=? AND customer_id=(SELECT customer_id FROM website_submissions WHERE id=?) AND opportunity_type=? AND description=? AND status IN ('scoping','quoted')`;
    batch.push(
      statement(
        `INSERT INTO customer_opportunities (id,workspace_id,customer_id,description,opportunity_type,budget_cents,status,created_at,updated_at)
      SELECT ?,workspace_id,customer_id,?,?,?,'scoping',?,? FROM website_submissions WHERE id=? AND customer_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM customer_opportunities WHERE ${match})`,
        crypto.randomUUID(),
        opportunity.description,
        opportunity.type,
        opportunity.budgetCents,
        now,
        now,
        id,
        workspaceId,
        id,
        opportunity.type,
        opportunity.description
      )
    );
    batch.push(
      statement(
        `INSERT INTO website_submission_opportunities (submission_id,workspace_id,opportunity_id)
      SELECT ?,?,min(id) FROM customer_opportunities WHERE ${match} HAVING count(*)=1`,
        id,
        workspaceId,
        workspaceId,
        id,
        opportunity.type,
        opportunity.description
      )
    );
  }
  if (consent.state !== "not_provided") {
    const permission = consent.state === "granted" ? "allowed" : "not_allowed";
    const captured = consent.capturedAt!;
    batch.push(
      statement(
        `INSERT INTO contact_marketing_events (id,workspace_id,contact_id,permission,source,submission_id,disclosure_version,captured_at,recorded_at)
      SELECT ?,workspace_id,contact_id,?,'website',id,?,?,? FROM website_submissions WHERE id=? AND contact_id IS NOT NULL`,
        crypto.randomUUID(),
        permission,
        consent.disclosureVersion || null,
        captured,
        now,
        id
      )
    );
    // Old deliveries remain evidence but cannot undo newer preferences. Revocation wins ties.
    batch.push(
      statement(
        `UPDATE contacts SET marketing_email_permission=?,marketing_email_updated_at=?
      WHERE workspace_id=? AND id=(SELECT contact_id FROM website_submissions WHERE id=?)
      AND (marketing_email_updated_at IS NULL OR marketing_email_updated_at<? OR (marketing_email_updated_at=? AND ?='not_allowed'))`,
        permission,
        captured,
        workspaceId,
        id,
        captured,
        captured,
        permission
      )
    );
  }
  try {
    await env.DB.batch(batch);
  } catch (error) {
    const concurrent = await replay();
    if (concurrent) return response(concurrent, true);
    throw error;
  }
  return response((await replay())!, false);
}

function validatePayload(
  value: unknown
): { fields: Fields; consent: Consent; opportunity?: Opportunity } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some((key) => !KEYS.includes(key))) return null;
  let opportunity: Opportunity | undefined;
  if (input.opportunity !== undefined) {
    const o = input.opportunity;
    if (!o || typeof o !== "object" || Array.isArray(o)) return null;
    const r = o as Record<string, unknown>;
    if (
      Object.keys(r).some((k) => !["description", "type", "budgetCents"].includes(k)) ||
      typeof r.description !== "string" ||
      !r.description.trim() ||
      r.description.length > 2000 ||
      !["furniture", "cabinets", "other"].includes(r.type as string) ||
      !Number.isSafeInteger(r.budgetCents) ||
      (r.budgetCents as number) < 0
    )
      return null;
    opportunity = {
      description: r.description.trim(),
      type: r.type as Opportunity["type"],
      budgetCents: r.budgetCents as number,
    };
  }
  const fields = {} as Fields;
  for (const [key, val] of Object.entries(input)) {
    if (key === "marketingConsent" || key === "opportunity") continue;
    if (typeof val !== "string" || val.length > (key === "message" ? 16000 : 2000)) return null;
    fields[key] = val.trim();
  }
  if (
    !fields.externalEventId ||
    fields.externalEventId.length > 200 ||
    !fields.email ||
    fields.email.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.email)
  )
    return null;
  fields.email = fields.email.toLowerCase();
  const c =
    input.marketingConsent === undefined ? { state: "not_provided" } : input.marketingConsent;
  if (!c || typeof c !== "object" || Array.isArray(c)) return null;
  const record = c as Record<string, unknown>;
  if (
    Object.keys(record).some((key) => !["state", "disclosureVersion", "capturedAt"].includes(key))
  )
    return null;
  if (!["granted", "revoked", "not_provided"].includes(record.state as string)) return null;
  if (
    record.disclosureVersion !== undefined &&
    (typeof record.disclosureVersion !== "string" ||
      !record.disclosureVersion.trim() ||
      record.disclosureVersion.length > 200)
  )
    return null;
  if (record.state === "granted" && !record.disclosureVersion) return null;
  if (record.capturedAt !== undefined || record.state !== "not_provided") {
    if (
      typeof record.capturedAt !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(record.capturedAt) ||
      !Number.isFinite(Date.parse(record.capturedAt)) ||
      Date.parse(record.capturedAt) > Date.now()
    )
      return null;
  }
  return {
    fields,
    opportunity,
    consent: {
      state: record.state as Consent["state"],
      ...(record.disclosureVersion
        ? { disclosureVersion: record.disclosureVersion as string }
        : {}),
      ...(record.capturedAt
        ? { capturedAt: new Date(record.capturedAt as string).toISOString() }
        : {}),
    },
  };
}
function canonical(value: unknown): string {
  if (value && typeof value === "object" && !Array.isArray(value))
    return JSON.stringify(
      Object.fromEntries(
        Object.entries(value)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, val]) => [key, JSON.parse(canonical(val))])
      )
    );
  return JSON.stringify(value);
}
async function equalToken(a: string, b: string) {
  const hash = async (v: string) =>
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(v)));
  const [x, y] = await Promise.all([hash(a), hash(b)]);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

// Staff-only inspection; integration credentials do not grant CRM read access.
export async function handleWebsiteSubmissions(segments: string[], request: Request, env: Env) {
  const auth = await requireActor(env, request);
  if (!auth.ok) return auth.response;
  if (request.method !== "GET") return methodNotAllowed(["GET"]);
  const workspaceId = new URL(request.url).searchParams.get("workspaceId");
  if (!workspaceId) return badRequest("missing_workspace_id");
  if (!canAccessWorkspace(auth.actor, workspaceId)) return json({ error: "forbidden" }, 403);
  if (segments.length > 1) return notFound("Route not found");
  if (segments.length === 1) {
    const row = await env.DB.prepare(
      `SELECT * FROM website_submissions WHERE id=? AND workspace_id=?`
    )
      .bind(segments[0], workspaceId)
      .first();
    return row ? json(row) : notFound("Submission not found");
  }
  const rows = await env.DB.prepare(
    `SELECT id,integration_id,external_event_id,email,received_at,customer_id,contact_id,reconciliation_status FROM website_submissions WHERE workspace_id=? ORDER BY received_at DESC LIMIT 100`
  )
    .bind(workspaceId)
    .all();
  return json(rows.results ?? []);
}
