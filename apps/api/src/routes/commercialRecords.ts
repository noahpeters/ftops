import { badRequest, forbidden, json, methodNotAllowed, notFound, serverError } from "../lib/http";
import type { Env } from "../lib/types";
import { requireActor } from "../lib/access";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export async function handleCommercialRecords(
  segments: string[],
  request: Request,
  env: Env,
  _ctx: ExecutionContext,
  url: URL
) {
  const actorResult = await requireActor(env, request);
  if ("response" in actorResult) {
    return actorResult.response;
  }
  if (!actorResult.actor) {
    return forbidden("forbidden");
  }
  if (request.method !== "GET") {
    return methodNotAllowed(["GET"]);
  }

  if (segments.length === 0) {
    return await listCommercialRecords(env, url);
  }

  if (segments.length === 1) {
    const encodedUri = segments[0];
    return await getCommercialRecord(env, encodedUri);
  }

  return notFound("Route not found");
}

async function listCommercialRecords(env: Env, url: URL) {
  const limitParam = url.searchParams.get("limit");
  const offsetParam = url.searchParams.get("offset");
  const queryParam = url.searchParams.get("query");

  const limit = clampNumber(parseNumber(limitParam, DEFAULT_LIMIT), 1, MAX_LIMIT);
  const offset = clampNumber(parseNumber(offsetParam, 0), 0, Number.MAX_SAFE_INTEGER);
  const query = queryParam?.trim();

  const where: string[] = [];
  const binds: unknown[] = [];

  if (query) {
    where.push("(uri LIKE ? OR customer_display LIKE ? OR external_id LIKE ?)");
    const like = `%${query}%`;
    binds.push(like, like, like);
  }

  const whereClause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";

  const sql = `SELECT uri, source, kind, external_id, customer_uri, customer_display,
                     quoted_delivery_date, quoted_install_date,
                     last_seen_at, snapshot_hash
              FROM commercial_records
              ${whereClause}
              ORDER BY (last_seen_at IS NULL) ASC, last_seen_at DESC, updated_at DESC
              LIMIT ? OFFSET ?`;

  binds.push(limit, offset);

  try {
    const result = await env.DB.prepare(sql)
      .bind(...binds)
      .all();
    return json({
      records: result.results ?? [],
      limit,
      offset,
    });
  } catch (error) {
    if (isMissingCommercialSchema(error)) {
      // This will work once the commercial schema migrations are applied.
      return json({ error: "commercial_schema_not_installed" }, 501);
    }
    return serverError("Failed to load commercial records");
  }
}

async function getCommercialRecord(env: Env, encodedUri: string) {
  let uri: string;
  try {
    uri = decodeURIComponent(encodedUri);
  } catch {
    return badRequest("invalid_uri");
  }

  try {
    const record = await env.DB.prepare(`SELECT * FROM commercial_records WHERE uri = ?`)
      .bind(uri)
      .first();

    if (!record) {
      return notFound("Record not found");
    }

    const lineItems = await env.DB.prepare(
      `SELECT * FROM commercial_line_items
       WHERE record_uri = ?
       ORDER BY position ASC, uri ASC`
    )
      .bind(uri)
      .all();

    return json({
      record,
      line_items: lineItems.results ?? [],
    });
  } catch (error) {
    if (isMissingCommercialSchema(error)) {
      // This will work once the commercial schema migrations are applied.
      return json({ error: "commercial_schema_not_installed" }, 501);
    }
    return serverError("Failed to load commercial record");
  }
}

function parseNumber(value: string | null, fallback: number) {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function isMissingCommercialSchema(error: unknown) {
  if (!error) return false;
  const message = typeof error === "string" ? error : error instanceof Error ? error.message : "";
  return (
    message.includes("no such table: commercial_records") ||
    message.includes("no such table: commercial_line_items")
  );
}
