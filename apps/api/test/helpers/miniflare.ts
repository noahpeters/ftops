import { readFileSync, readdirSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { Miniflare } from "miniflare";
import type { D1Database, ExecutionContext } from "@cloudflare/workers-types";
import type { Env } from "../../src/lib/types";
import { route } from "../../src/lib/router";

const migrationsDir = join(process.cwd(), "migrations");

export async function createTestEnv(options?: { env?: Record<string, unknown> }) {
  const canListen = await canListenOnLocalhost();
  if (!canListen) {
    return null;
  }
  try {
    const mf = new Miniflare({
      script: "export default { fetch() { return new Response('ok'); } }",
      modules: true,
      d1Databases: { DB: "test-db" },
      compatibilityDate: "2026-01-01",
    });

    const db = await mf.getD1Database("DB");
    await runMigrations(db);

    const env = { DB: db, ...(options?.env ?? {}) } as unknown as Env;

    return { mf, db, env };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error ?? "");
    if (message.includes("listen EPERM") || message.includes("EACCES")) {
      return null;
    }
    throw error;
  }
}

export async function dispatchRequest(url: string, env: Env) {
  const request = new Request(url);
  return route(request, env, {} as ExecutionContext);
}

async function runMigrations(db: D1Database) {
  const files = readdirSync(migrationsDir)
    .filter((file: string) => file.endsWith(".sql"))
    .sort();

  for (const file of files) {
    const sql = readFileSync(join(migrationsDir, file), "utf8");
    await execSql(db, sql);
  }
}

async function canListenOnLocalhost() {
  return new Promise<boolean>((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.listen(0, "127.0.0.1", () => {
      server.close(() => resolve(true));
    });
  });
}

async function execSql(db: D1Database, sql: string) {
  const cleaned = sql
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");

  const statements = cleaned
    .split(";")
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);

  for (const statement of statements) {
    await db.prepare(statement).run();
  }
}
