import { badRequest, json, methodNotAllowed, notFound } from "../lib/http";
import type { Env } from "../lib/types";
import { nowISO } from "../lib/utils";
import { requireActor } from "../lib/access";

const CUSTOMER_STATUSES = ["lead", "active", "completed", "archived"];

type PreferenceKey = "customer_status_filters" | "left_rail_collapsed";

export async function handlePreferences(
  segments: string[],
  request: Request,
  env: Env,
  _ctx: ExecutionContext,
  _url: URL
) {
  const actorResult = await requireActor(env, request);
  if (!actorResult.ok) return actorResult.response;
  const { actor } = actorResult;

  if (segments.length === 0) {
    if (request.method !== "GET") return methodNotAllowed(["GET"]);
    const result = await env.DB.prepare(
      `SELECT preference_key, value_json FROM user_preferences WHERE user_email=?`
    )
      .bind(actor.email)
      .all<{ preference_key: string; value_json: string }>();
    const preferences: Record<string, unknown> = {};
    for (const row of result.results ?? []) {
      try {
        preferences[row.preference_key] = JSON.parse(row.value_json);
      } catch {
        // Ignore malformed legacy values so one preference cannot block the rest.
      }
    }
    return json(preferences);
  }

  if (segments.length !== 1) return notFound("Route not found");
  if (request.method !== "PUT") return methodNotAllowed(["PUT"]);
  const key = segments[0] as PreferenceKey;
  const body = await readBody(request);
  const value = validatePreference(key, body.value);
  if (!value.ok) return badRequest(value.error);
  const now = nowISO();
  await env.DB.prepare(
    `INSERT INTO user_preferences (user_email,preference_key,value_json,created_at,updated_at)
     VALUES (?,?,?,?,?)
     ON CONFLICT(user_email,preference_key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at`
  )
    .bind(actor.email, key, JSON.stringify(value.value), now, now)
    .run();
  return json({ key, value: value.value });
}

function validatePreference(
  key: PreferenceKey,
  value: unknown
): { ok: true; value: unknown } | { ok: false; error: string } {
  if (key === "left_rail_collapsed") {
    return typeof value === "boolean"
      ? { ok: true, value }
      : { ok: false, error: "invalid_preference_value" };
  }
  if (key === "customer_status_filters") {
    if (
      !Array.isArray(value) ||
      value.some((status) => typeof status !== "string" || !CUSTOMER_STATUSES.includes(status))
    ) {
      return { ok: false, error: "invalid_preference_value" };
    }
    return { ok: true, value: [...new Set(value)] };
  }
  return { ok: false, error: "invalid_preference_key" };
}

async function readBody(request: Request) {
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}
