type Env = {
  DB: D1Database;
  EVENT_QUEUE: Queue;
};

const JSON_HEADERS = { "content-type": "application/json" };
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return new Response(JSON.stringify({ status: "ok" }), {
        headers: { "content-type": "application/json" },
      });
    }

    // Temporary: keep your projects endpoint behavior simple
    if (url.pathname === "/projects" && request.method === "GET") {
      const result = await env.DB.prepare("SELECT * FROM projects ORDER BY created_at DESC").all();

      return new Response(JSON.stringify(result.results), {
        headers: { "content-type": "application/json" },
      });
    }

    if (url.pathname === "/projects" && request.method === "POST") {
      const id = crypto.randomUUID();
      const now = new Date().toISOString();

      await env.DB.prepare(
        `
        INSERT INTO projects (id, title, project_type, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `
      )
        .bind(id, "Test Project", "internal", "intake", now, now)
        .run();

      return new Response(JSON.stringify({ id }), {
        status: 201,
        headers: { "content-type": "application/json" },
      });
    }

    if (url.pathname === "/events/test" && request.method === "POST") {
      const body = await request.json<any>();

      const source = body.source ?? "manual";
      const type = body.type ?? "test_event";
      const externalId = body.externalId ?? "default";

      const idempotencyKey = buildIdempotencyKey(source, type, externalId);

      await env.EVENT_QUEUE.send({
        source,
        type,
        externalId,
        idempotencyKey,
        payload: body.payload ?? body,
        receivedAt: nowISO(),
      });

      return json({ enqueued: true, idempotencyKey }, 202);
    }

    if (url.pathname === "/events" && request.method === "GET") {
      const result = await env.DB.prepare(
        `SELECT source, type, external_id, idempotency_key, received_at, processed_at, process_error
         FROM events
         ORDER BY received_at DESC
         LIMIT 50`
      ).all();

      return json(result.results);
    }

    return new Response("Not Found", { status: 404 });
  },

  async queue(batch: MessageBatch<any>, env: any, ctx: ExecutionContext) {
    for (const msg of batch.messages) {
      const evt = msg.body;
      const now = nowISO();

      try {
        await env.DB.prepare(
          `INSERT INTO events
            (id, source, type, external_id, idempotency_key, payload, received_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
          .bind(
            crypto.randomUUID(),
            evt.source,
            evt.type,
            evt.externalId ?? null,
            evt.idempotencyKey,
            JSON.stringify(evt.payload ?? {}),
            evt.receivedAt ?? now
          )
          .run();
      } catch (e) {
        // Duplicate (or already inserted) => ignore
        msg.ack();
        continue;
      }

      await env.DB.prepare(
        `UPDATE events
         SET processed_at = ?, process_error = NULL
         WHERE idempotency_key = ?`
      )
        .bind(now, evt.idempotencyKey)
        .run();

      msg.ack();
    }
  },
};

function nowISO() {
  return new Date().toISOString();
}

function buildIdempotencyKey(source: string, type: string, externalId: string) {
  return `${source}:${type}:${externalId}`;
}
