type Env = {
  DB: D1Database;
  EVENT_QUEUE: Queue;
};

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return new Response(JSON.stringify({ status: "ok" }), {
        headers: { "content-type": "application/json" },
      });
    }

    // Temporary: keep your projects endpoint behavior simple
    if (url.pathname === "/projects" && request.method === "GET") {
      const result = await env.DB.prepare(
        "SELECT * FROM projects ORDER BY created_at DESC"
      ).all();

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

    return new Response("Not Found", { status: 404 });
  },

  async queue(batch: MessageBatch<any>, env: Env, ctx: ExecutionContext) {
    // Temporary stub so Wrangler can attach this Worker as a consumer.
    // We'll add idempotent event insertion next.
    for (const msg of batch.messages) {
      msg.ack();
    }
  },
};
