import { corsPreflight, withCors } from "./lib/cors";
import { route } from "./lib/router";
import type { Env, EventQueuePayload } from "./lib/types";
import { nowISO } from "./lib/utils";

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (request.method === "OPTIONS") {
      return corsPreflight(request);
    }

    const response = await route(request, env, ctx);
    return withCors(request, response);
  },

  async queue(batch: MessageBatch<EventQueuePayload>, env: Env, _ctx: ExecutionContext) {
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
      } catch {
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
