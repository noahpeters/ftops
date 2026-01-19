import { applyCorsHeaders, corsPreflight, getCorsContext } from "./lib/cors";
import { route } from "./lib/router";
import type { Env, EventQueuePayload } from "./lib/types";
import { processEventMessage } from "./processors/eventProcessor";
import { processWebhookEnvelope } from "./processors/webhookProcessor";
import type { IngestQueueMessage, WebhookEnvelope } from "@ftops/webhooks";
import { processIngestQueueMessage } from "./processors/ingestQueue";

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (request.method === "OPTIONS") {
      return corsPreflight(request);
    }

    const cors = getCorsContext(request);
    if (!cors.allowed) {
      return applyCorsHeaders(
        new Response(JSON.stringify({ error: "origin_not_allowed" }), {
          status: 403,
          headers: { "content-type": "application/json" },
        }),
        cors.headers
      );
    }

    try {
      const response = await route(request, env, ctx);
      return applyCorsHeaders(response, cors.headers);
    } catch (error) {
      console.error(error);
      return applyCorsHeaders(
        new Response(JSON.stringify({ error: "internal_error" }), {
          status: 500,
          headers: { "content-type": "application/json" },
        }),
        cors.headers
      );
    }
  },

  async queue(
    batch: MessageBatch<EventQueuePayload | WebhookEnvelope | IngestQueueMessage>,
    env: Env,
    _ctx: ExecutionContext
  ) {
    for (const msg of batch.messages) {
      if (isIngestQueueMessage(msg.body)) {
        await processIngestQueueMessage(msg.body, env);
        msg.ack();
        continue;
      }

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

function isWebhookEnvelope(
  body: EventQueuePayload | WebhookEnvelope | IngestQueueMessage
): body is WebhookEnvelope {
  return (
    typeof (body as WebhookEnvelope).id === "string" &&
    typeof (body as WebhookEnvelope).path === "string"
  );
}

function isIngestQueueMessage(
  body: EventQueuePayload | WebhookEnvelope | IngestQueueMessage
): body is IngestQueueMessage {
  return (
    typeof (body as IngestQueueMessage).id === "string" &&
    typeof (body as IngestQueueMessage).headers_json === "string" &&
    typeof (body as IngestQueueMessage).body_text === "string"
  );
}
