import { corsPreflight, withCors } from "./lib/cors";
import { route } from "./lib/router";
import type { Env, EventQueuePayload } from "./lib/types";
import { processEventMessage } from "./processors/eventProcessor";

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
      await processEventMessage(msg.body, env);
      msg.ack();
    }
  },
};
