import { describe, expect, it } from "vitest";
import { processEventMessage } from "../../src/processors/eventProcessor";
import { createTestEnv } from "../helpers/miniflare";
import { route } from "../../src/lib/router";
import type { ExecutionContext } from "@cloudflare/workers-types";

const baseMessage = {
  source: "manual",
  type: "commercial_record_upserted",
  externalId: "proposal-tasks-001",
  idempotencyKey: "manual:commercial_record_upserted:proposal-tasks-001",
  receivedAt: "2026-01-17T00:00:00.000Z",
  payload: {
    record: {
      uri: "manual://proposal/tasks-001",
      kind: "proposal",
      customer: { display: "Tasks Test" },
      currency: "USD",
    },
    line_items: [
      {
        uri: "manual://proposal/tasks-001/line/table",
        title: "Ash Dining Table",
        category_key: "furniture",
        deliverable_key: "dining_table",
        quantity: 1,
        position: 1,
        config: { requiresDesign: true },
      },
    ],
  },
};

async function createProjectFromRecord(env: unknown, recordUri: string) {
  const request = new Request("http://localhost/projects/from-record", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ recordUri }),
  });
  const response = await route(request, env as never, {} as ExecutionContext);
  expect(response.status).toBe(200);
  const payload = (await response.json()) as { project: { id: string } };
  return payload.project.id;
}

async function materialize(env: unknown, projectId: string) {
  const request = new Request(`http://localhost/projects/${projectId}/materialize`, {
    method: "POST",
  });
  return route(request, env as never, {} as ExecutionContext);
}

describe("task lifecycle integration", () => {
  it("create_project_from_record_idempotent", async () => {
    const context = await createTestEnv();
    if (!context) return;
    const { env, mf } = context;

    await processEventMessage(baseMessage, env);

    const first = await route(
      new Request("http://localhost/projects/from-record", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ recordUri: baseMessage.payload.record.uri }),
      }),
      env,
      {} as ExecutionContext
    );
    const firstPayload = (await first.json()) as { created: boolean; project: { id: string } };
    expect(firstPayload.created).toBe(true);

    const second = await route(
      new Request("http://localhost/projects/from-record", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ recordUri: baseMessage.payload.record.uri }),
      }),
      env,
      {} as ExecutionContext
    );
    const secondPayload = (await second.json()) as { created: boolean };
    expect(secondPayload.created).toBe(false);

    await mf.dispose();
  });

  it("materialize_then_get_tasks", async () => {
    const context = await createTestEnv();
    if (!context) return;
    const { env, db, mf } = context;

    await processEventMessage(baseMessage, env);
    const projectId = await createProjectFromRecord(env, baseMessage.payload.record.uri);

    const response = await materialize(env, projectId);
    expect(response.status).toBe(200);

    const tasks = await db
      .prepare("SELECT * FROM tasks WHERE project_id = ?")
      .bind(projectId)
      .all();
    expect(tasks.results?.length).toBeGreaterThan(0);

    await mf.dispose();
  });

  it("patch_task_status", async () => {
    const context = await createTestEnv();
    if (!context) return;
    const { env, db, mf } = context;

    await processEventMessage(baseMessage, env);
    const projectId = await createProjectFromRecord(env, baseMessage.payload.record.uri);
    await materialize(env, projectId);

    const task = await db
      .prepare("SELECT * FROM tasks WHERE project_id = ? LIMIT 1")
      .bind(projectId)
      .first<{ id: string }>();
    expect(task?.id).toBeTruthy();

    const request = new Request(`http://localhost/tasks/${task?.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "in progress" }),
    });
    const response = await route(request, env, {} as ExecutionContext);
    expect(response.status).toBe(200);
    const updated = (await response.json()) as { status: string };
    expect(updated.status).toBe("in progress");

    await mf.dispose();
  });

  it("add_and_list_notes", async () => {
    const context = await createTestEnv();
    if (!context) return;
    const { env, mf } = context;

    await processEventMessage(baseMessage, env);
    const projectId = await createProjectFromRecord(env, baseMessage.payload.record.uri);
    await materialize(env, projectId);

    const tasksResponse = await route(
      new Request(`http://localhost/projects/${projectId}/tasks`),
      env,
      {} as ExecutionContext
    );
    const tasks = (await tasksResponse.json()) as Array<{ id: string }>;
    const taskId = tasks[0]?.id;
    expect(taskId).toBeTruthy();

    const createNote = await route(
      new Request(`http://localhost/tasks/${taskId}/notes`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "X-Debug-User-Email": "dev@example.com",
        },
        body: JSON.stringify({ body: "First note" }),
      }),
      env,
      {} as ExecutionContext
    );
    expect(createNote.status).toBe(201);

    const listNotes = await route(
      new Request(`http://localhost/tasks/${taskId}/notes`),
      env,
      {} as ExecutionContext
    );
    const notes = (await listNotes.json()) as Array<{ author_email: string }>;
    expect(notes.length).toBe(1);
    expect(notes[0].author_email).toBe("dev@example.com");

    await mf.dispose();
  });
});
