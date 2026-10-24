import { handleBillingGuest, resumeBillingDocuments } from "./billing/guest";
import { paymentAdapter } from "./billing/provider";
import { applyCorsHeaders, corsPreflight, getCorsContext } from "./lib/cors";
import { route } from "./lib/router";
import type { Env, EventQueuePayload } from "./lib/types";
import { processEventMessage } from "./processors/eventProcessor";
import { recoverStaleCustomerEmailIngestions } from "./services/customerEmailIngestion";
import { processWebhookEnvelope } from "./processors/webhookProcessor";
import type { IngestQueueMessage, WebhookEnvelope } from "@ftops/webhooks";
import { processIngestQueueMessage } from "./processors/ingestQueue";
import { noStore, sanitizeExternalError } from "./lib/security";
import { sendDailySummaries } from "./services/dailySummary";
import { enqueueDueQuoSyncs } from "./services/quo";
import { syncAllQuoConversations } from "./services/quoConversationSync";
import { enqueueMissingCustomerNoteFollowUps } from "./services/customerFollowUp";

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (new URL(request.url).pathname.startsWith("/billing-public")) {
      const segments = new URL(request.url).pathname.split("/").filter(Boolean);
      if (segments[0] !== "billing-public") return new Response("Not found", { status: 404 });
      return noStore(await handleBillingGuest(segments.slice(1), request, env));
    }
    if (request.method === "OPTIONS") {
      return noStore(corsPreflight(request));
    }

    const cors = getCorsContext(request);
    if (!cors.allowed) {
      return noStore(
        applyCorsHeaders(
          new Response(JSON.stringify({ error: "origin_not_allowed" }), {
            status: 403,
            headers: { "content-type": "application/json" },
          }),
          cors.headers
        )
      );
    }

    try {
      const response = await route(request, env, ctx);
      return noStore(applyCorsHeaders(response, cors.headers));
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "api_request_failed",
          error: sanitizeExternalError(error, "internal_error"),
        })
      );
      return noStore(
        applyCorsHeaders(
          new Response(JSON.stringify({ error: "internal_error" }), {
            status: 500,
            headers: { "content-type": "application/json" },
          }),
          cors.headers
        )
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

  async scheduled(controller: ScheduledController, env: Env, _ctx: ExecutionContext) {
    await resumeBillingDocuments(env);
    const billingWorkspaces = await env.DB.prepare(
      "SELECT workspace_id FROM native_billing_settings"
    ).all<{ workspace_id: string }>();
    for (const workspace of billingWorkspaces.results) {
      try {
        await paymentAdapter().reconcile(env, workspace.workspace_id);
      } catch {
        console.error(
          JSON.stringify({
            event: "billing_reconciliation_failed",
            workspace_id: workspace.workspace_id,
          })
        );
      }
    }
    await Promise.all([
      sendDailySummaries(env, new Date(controller.scheduledTime)),
      enqueueDueQuoSyncs(env),
      syncAllQuoConversations(env, new Date(controller.scheduledTime)),
      enqueueMissingCustomerNoteFollowUps(env),
      recoverStaleCustomerEmailIngestions(env, controller.scheduledTime),
    ]);
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
