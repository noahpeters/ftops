import { forbidden, json, methodNotAllowed, notFound } from "../lib/http";
import { handleSegment } from "../lib/router";
import type { Env } from "../lib/types";
import { buildIdempotencyKey, nowISO } from "../lib/utils";
import { requireActor } from "../lib/access";

type EventTestRequest = {
  source?: string;
  type?: string;
  externalId?: string;
  payload?: unknown;
};

export async function handleEvents(
  segments: string[],
  request: Request,
  env: Env,
  _ctx: ExecutionContext,
  url: URL
) {
  const actorResult = await requireActor(env, request);
  if ("response" in actorResult) {
    return actorResult.response;
  }
  if (!actorResult.actor.isSystemAdmin) {
    return forbidden("forbidden");
  }

  return await handleSegment(
    segments,
    request,
    env,
    _ctx,
    url,
    {
      test: handleEventsTest,
    },
    handleEventsRoot
  );
}

async function handleEventsRoot(
  segments: string[],
  request: Request,
  env: Env,
  _ctx: ExecutionContext,
  _url: URL
) {
  if (segments.length > 0) {
    return notFound("Route not found");
  }

  if (request.method !== "GET") {
    return methodNotAllowed(["GET"]);
  }

  const result = await env.DB.prepare(
    `SELECT source, type, external_id, idempotency_key, received_at, processed_at, process_error
     FROM events
     ORDER BY received_at DESC
     LIMIT 50`
  ).all();

  return json(result.results);
}

async function handleEventsTest(
  segments: string[],
  request: Request,
  env: Env,
  _ctx: ExecutionContext,
  _url: URL
) {
  if (segments.length > 0) {
    return notFound("Route not found");
  }

  if (request.method !== "POST") {
    return methodNotAllowed(["POST"]);
  }

  const body = (await request.json()) as EventTestRequest;

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
