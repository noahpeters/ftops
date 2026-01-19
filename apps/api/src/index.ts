import { corsPreflight, withCors } from "./lib/cors";
import { route } from "./lib/router";
import type { Env, EventQueuePayload } from "./lib/types";
import { processEventMessage } from "./processors/eventProcessor";
import { processWebhookEnvelope } from "./processors/webhookProcessor";
import type { WebhookEnvelope } from "@ftops/webhooks";

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (request.method === "OPTIONS") {
      return corsPreflight(request);
    }

    const response = await route(request, env, ctx);
    return withCors(request, response);
  },

  async queue(
    batch: MessageBatch<EventQueuePayload | WebhookEnvelope>,
    env: Env,
    _ctx: ExecutionContext
  ) {
    for (const msg of batch.messages) {
      if (isWebhookEnvelope(msg.body)) {
        await processWebhookEnvelope(msg.body, env);
        msg.ack();
        continue;
      }

      await processEventMessage(msg.body as EventQueuePayload, env);
      msg.ack();
    }
  },
};

function isWebhookEnvelope(body: EventQueuePayload | WebhookEnvelope): body is WebhookEnvelope {
  return (
    typeof (body as WebhookEnvelope).id === "string" &&
    typeof (body as WebhookEnvelope).path === "string"
  );
}
