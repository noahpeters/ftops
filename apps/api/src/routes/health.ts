import { json, methodNotAllowed, notFound } from "../lib/http";
import type { Env } from "../lib/types";
import { getMigrationStatus } from "../lib/migrationStatus";

export async function handleHealth(
  segments: string[],
  request: Request,
  env: Env,
  _ctx: ExecutionContext,
  _url: URL
) {
  if (segments.length > 0) {
    return notFound("Route not found");
  }

  if (request.method !== "GET") {
    return methodNotAllowed(["GET"]);
  }

  const migrations = await getMigrationStatus(env);
  return json({
    status: "ok",
    migrations: {
      ok: migrations.ok,
      appliedLatest: migrations.appliedLatest,
      expectedLatest: migrations.expectedLatest,
      missingCount: migrations.missingCount,
      missing: migrations.missing,
      checkedAt: migrations.checkedAt,
    },
  });
}
