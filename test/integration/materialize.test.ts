import { describe, expect, it } from "vitest";
import { processEventMessage } from "../../src/processors/eventProcessor";
import { createTestEnv } from "../helpers/miniflare";
import { route } from "../../src/lib/router";
import type { ExecutionContext } from "@cloudflare/workers-types";

const baseMessage = {
  source: "manual",
  type: "commercial_record_upserted",
  externalId: "proposal-materialize-001",
  idempotencyKey: "manual:commercial_record_upserted:proposal-materialize-001",
  receivedAt: "2026-01-17T00:00:00.000Z",
  payload: {
    record: {
      uri: "manual://proposal/materialize-001",
      kind: "proposal",
      customer: { display: "Materialize Test" },
      commitments: {
        quotedDeliveryDate: "2026-03-15",
        quotedInstallDate: "2026-03-20",
      },
      currency: "USD",
    },
    line_items: [
      {
        uri: "manual://proposal/materialize-001/line/table",
        title: "Ash Dining Table",
        category_key: "furniture",
        deliverable_key: "dining_table",
        group_key: "kitchen",
        quantity: 1,
        position: 1,
        config: {
          requiresDesign: true,
          requiresApproval: true,
        },
      },
      {
        uri: "manual://proposal/materialize-001/line/delivery",
        title: "Delivery",
        category_key: "delivery",
        deliverable_key: "delivery_service",
        group_key: "kitchen",
        quantity: 1,
        position: 2,
        config: { deliveryRequired: true },
      },
    ],
  },
};

async function createProject(
  db: { prepare: (sql: string) => { bind: (...args: unknown[]) => { run: () => Promise<void> } } },
  projectId: string,
  recordUri: string
) {
  const now = "2026-01-17T00:00:00.000Z";
  await db
    .prepare(
      `INSERT INTO projects
        (id, title, project_type, status, workspace_id, commercial_record_uri, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      projectId,
      "Materialize Test Project",
      "internal",
      "intake",
      "default",
      recordUri,
      now,
      now
    )
    .run();
}

async function materialize(
  env: unknown,
  projectId: string,
  body?: Record<string, unknown>
) {
  const request = new Request(`http://localhost/projects/${projectId}/materialize`, {
    method: "POST",
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  return route(request, env as never, {} as ExecutionContext);
}

describe("materialize tasks integration", () => {
  it("materialize_creates_tasks", async () => {
    const context = await createTestEnv();
    if (!context) return;
    const { env, db, mf } = context;

    await processEventMessage(baseMessage, env);
    const projectId = "project-materialize-1";
    await createProject(db, projectId, baseMessage.payload.record.uri);

    const response = await materialize(env, projectId);
    expect(response.status).toBe(200);
    const payload = (await response.json()) as Record<string, unknown>;
    expect(payload.ok).toBe(true);
    expect(payload.alreadyMaterialized).toBe(false);
    expect(payload.tasksCreated).toBeGreaterThan(0);

    const tasksResult = await db
      .prepare("SELECT * FROM tasks WHERE project_id = ?")
      .bind(projectId)
      .all();
    expect(tasksResult.results?.length).toBe(payload.tasksCreated);
    const task = tasksResult.results?.[0] as Record<string, unknown>;
    expect(task.status).toBe("todo");

    const materializedResult = await db
      .prepare(
        "SELECT * FROM project_materializations WHERE project_id = ? AND workspace_id = ?"
      )
      .bind(projectId, "default")
      .all();
    expect(materializedResult.results?.length).toBe(1);

    await mf.dispose();
  });

  it("materialize_is_idempotent", async () => {
    const context = await createTestEnv();
    if (!context) return;
    const { env, db, mf } = context;

    await processEventMessage(baseMessage, env);
    const projectId = "project-materialize-2";
    await createProject(db, projectId, baseMessage.payload.record.uri);

    await materialize(env, projectId);
    const second = await materialize(env, projectId);
    const payload = (await second.json()) as Record<string, unknown>;
    expect(payload.alreadyMaterialized).toBe(true);
    expect(payload.tasksCreated).toBe(0);

    const tasksResult = await db
      .prepare("SELECT * FROM tasks WHERE project_id = ?")
      .bind(projectId)
      .all();
    expect(tasksResult.results?.length).toBeGreaterThan(0);

    await mf.dispose();
  });

  it("materialize_dry_run_does_not_write", async () => {
    const context = await createTestEnv();
    if (!context) return;
    const { env, db, mf } = context;

    await processEventMessage(baseMessage, env);
    const projectId = "project-materialize-3";
    await createProject(db, projectId, baseMessage.payload.record.uri);

    const response = await materialize(env, projectId, { dryRun: true });
    const payload = (await response.json()) as Record<string, unknown>;
    expect(payload.dryRun).toBe(true);

    const tasksResult = await db
      .prepare("SELECT * FROM tasks WHERE project_id = ?")
      .bind(projectId)
      .all();
    expect(tasksResult.results?.length).toBe(0);

    const materializedResult = await db
      .prepare("SELECT * FROM project_materializations WHERE project_id = ?")
      .bind(projectId)
      .all();
    expect(materializedResult.results?.length).toBe(0);

    await mf.dispose();
  });

  it("materialize_updates_project_debug_snapshot", async () => {
    const context = await createTestEnv();
    if (!context) return;
    const { env, db, mf } = context;

    await processEventMessage(baseMessage, env);
    const projectId = "project-materialize-4";
    await createProject(db, projectId, baseMessage.payload.record.uri);

    await materialize(env, projectId);

    const project = await db
      .prepare("SELECT debug_plan_json, debug_plan_hash FROM projects WHERE id = ?")
      .bind(projectId)
      .first();
    expect((project as { debug_plan_json?: string }).debug_plan_json).toBeTruthy();
    expect((project as { debug_plan_hash?: string }).debug_plan_hash).toBeTruthy();

    await mf.dispose();
  });
});
