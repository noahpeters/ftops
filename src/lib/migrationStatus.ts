import type { Env } from "./types";
import { nowISO } from "./utils";
import { LATEST_MIGRATION, MIGRATIONS } from "../generated/migrationsManifest";

export type MigrationStatus = {
  ok: boolean;
  appliedLatest: string | null;
  expectedLatest: string;
  missingCount: number;
  missing: string[];
  checkedAt: string;
};

type CachedStatus = {
  value: MigrationStatus;
  expiresAt: number;
};

let cached: CachedStatus | null = null;
let warnedOutOfDate = false;

export async function getMigrationStatus(env: Env): Promise<MigrationStatus> {
  const now = Date.now();
  if (cached && now < cached.expiresAt) {
    return cached.value;
  }

  const checkedAt = nowISO();
  const ttlMs = getTtlMs();

  try {
    const appliedResult = await env.DB.prepare(
      `SELECT name
       FROM d1_migrations
       ORDER BY name ASC`
    ).all<{ name: string }>();

    const appliedNames = (appliedResult.results ?? [])
      .map((row) => row.name)
      .filter(Boolean);
    const appliedSet = new Set(appliedNames);
    const missing = MIGRATIONS.filter((name) => !appliedSet.has(name));
    const appliedLatest =
      appliedNames.length > 0 ? appliedNames[appliedNames.length - 1] : null;
    const ok = missing.length === 0;
    const status: MigrationStatus = {
      ok,
      appliedLatest,
      expectedLatest: LATEST_MIGRATION,
      missingCount: missing.length,
      missing: missing.slice(0, 10),
      checkedAt,
    };

    cached = { value: status, expiresAt: now + ttlMs };

    if (!ok && !warnedOutOfDate) {
      warnedOutOfDate = true;
      console.warn(
        JSON.stringify({
          action: "migrations_out_of_date",
          appliedLatest: status.appliedLatest,
          expectedLatest: status.expectedLatest,
          missingCount: status.missingCount,
        })
      );
    }

    return status;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error ?? "");
    console.warn(
      JSON.stringify({
        action: "migrations_check_failed",
        error: message,
      })
    );
    const status: MigrationStatus = {
      ok: false,
      appliedLatest: null,
      expectedLatest: LATEST_MIGRATION,
      missingCount: MIGRATIONS.length,
      missing: MIGRATIONS.slice(0, 10),
      checkedAt,
    };
    cached = { value: status, expiresAt: now + ttlMs };
    return status;
  }
}

function getTtlMs() {
  const isDev =
    (globalThis as { __MINIFLARE__?: boolean }).__MINIFLARE__ ||
    (globalThis as { MINIFLARE?: boolean }).MINIFLARE ||
    (globalThis as { location?: { hostname?: string } }).location?.hostname ===
      "localhost";
  return isDev ? 5_000 : 30_000;
}
