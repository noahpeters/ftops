import { notFound } from "./http";
import type { Env } from "./types";
import { handleEvents } from "../routes/events";
import { handleHealth } from "../routes/health";
import { handlePlan } from "../routes/plan";
import { handleProjects } from "../routes/projects";
import { handleTemplates } from "../routes/templates";
import { handleCommercialRecords } from "../routes/commercialRecords";
import { handleTasks } from "../routes/tasks";

export type SegmentHandler = (
  segments: string[],
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  url: URL
) => Promise<Response>;

export async function route(request: Request, env: Env, ctx: ExecutionContext) {
  const url = new URL(request.url);
  const segments = url.pathname.split("/").filter(Boolean);

  if (segments.length === 0) {
    return notFound("Route not found");
  }

  return routesRoot(segments, request, env, ctx, url);
}

export async function handleSegment(
  segments: string[],
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  url: URL,
  handlers: Record<string, SegmentHandler>,
  fallback: SegmentHandler
) {
  if (segments.length === 0) {
    return fallback(segments, request, env, ctx, url);
  }

  const [head, ...tail] = segments;
  const handler = handlers[head];

  if (!handler) {
    return fallback(tail, request, env, ctx, url);
  }

  return handler(tail, request, env, ctx, url);
}

async function routesRoot(
  segments: string[],
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  url: URL
) {
  return handleSegment(
    segments,
    request,
    env,
    ctx,
    url,
    {
      health: handleHealth,
      projects: handleProjects,
      events: handleEvents,
      plan: handlePlan,
      templates: handleTemplates,
      "commercial-records": handleCommercialRecords,
      tasks: handleTasks,
    },
    () => notFound("Route not found")
  );
}
