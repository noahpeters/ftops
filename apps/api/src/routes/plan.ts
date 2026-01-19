import { badRequest, json, methodNotAllowed, notFound, serverError } from "../lib/http";
import { handleSegment } from "../lib/router";
import type { Env } from "../lib/types";
import { NotFoundError, getPlanPreview } from "../planning/preview";

export async function handlePlan(
  segments: string[],
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  url: URL
) {
  return await handleSegment(
    segments,
    request,
    env,
    ctx,
    url,
    {
      preview: handlePlanPreview,
    },
    () => notFound("Route not found")
  );
}

async function handlePlanPreview(
  segments: string[],
  request: Request,
  env: Env,
  _ctx: ExecutionContext,
  url: URL
) {
  if (segments.length > 0) {
    return notFound("Route not found");
  }

  if (request.method !== "GET") {
    return methodNotAllowed(["GET"]);
  }

  const recordUri = url.searchParams.get("record_uri");
  if (!recordUri) {
    return badRequest("Missing record_uri query parameter");
  }

  try {
    const response = await getPlanPreview(env, recordUri);
    return json(response);
  } catch (error) {
    if (error instanceof NotFoundError) {
      return notFound(error.message);
    }

    return serverError("Failed to build plan preview");
  }
}
