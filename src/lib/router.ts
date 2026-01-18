import { notFound } from "./http";
import type { Env } from "./types";
import { handleEvents } from "../routes/events";
import { handleHealth } from "../routes/health";
import { handlePlan } from "../routes/plan";
import { handleProjects } from "../routes/projects";
import { handleTemplates } from "../routes/templates";
import { handleCommercialRecords } from "../routes/commercialRecords";
import { handleTasks } from "../routes/tasks";
import { handleIngest } from "../routes/ingest";
import { handleWorkspaces } from "../routes/workspaces";
import { handleIntegrations } from "../routes/integrations";

export type SegmentHandler = (
  segments: string[],
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  url: URL
) => Response | Promise<Response>;

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
    return await fallback(segments, request, env, ctx, url);
  }

  const [head, ...tail] = segments;
  const handler = handlers[head];

  if (!handler) {
    return await fallback(tail, request, env, ctx, url);
  }

  return await handler(tail, request, env, ctx, url);
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
      ingest: handleIngest,
      workspaces: handleWorkspaces,
      integrations: handleIntegrations,
    },
    () => notFound("Route not found")
  );
}
