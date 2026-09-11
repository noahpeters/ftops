import { forbidden, json, methodNotAllowed, notFound } from "../lib/http";
import { requireActor } from "../lib/access";
import type { Env } from "../lib/types";

export async function handleConfigurator(segments: string[], request: Request, env: Env) {
  if (
    !["cf-access-authenticated-user-email", "x-auth-request-email", "x-debug-user-email"].some(
      (key) => request.headers.get(key)
    )
  )
    return forbidden("forbidden");
  const actor = await requireActor(env, request);
  if (!actor.ok) return actor.response;
  if (!actor.actor.isSystemAdmin) return forbidden("forbidden");
  if (request.method !== "GET") return methodNotAllowed(["GET"]);
  if (segments.length > 1 || (segments[0] && segments[0] !== "design"))
    return notFound("Route not found");
  if (!env.CABINET_ANALYTICS_URL || !env.CABINET_ANALYTICS_READ_TOKEN)
    return json({ error: "configurator_not_connected" }, 503);
  const incoming = new URL(request.url);
  const target = new URL(
    segments[0] === "design" ? "/admin/design" : "/admin/dashboard",
    env.CABINET_ANALYTICS_URL
  );
  if (target.protocol !== "https:") return json({ error: "configurator_not_connected" }, 503);
  for (const key of ["days", "page", "slug"]) {
    const value = incoming.searchParams.get(key);
    if (value !== null) target.searchParams.set(key, value);
  }
  try {
    const reportingFetch = env.CABINET_ANALYTICS_SERVICE
      ? env.CABINET_ANALYTICS_SERVICE.fetch.bind(env.CABINET_ANALYTICS_SERVICE)
      : fetch;
    const response = await reportingFetch(target, {
      headers: { Authorization: `Bearer ${env.CABINET_ANALYTICS_READ_TOKEN}` },
      signal: AbortSignal.timeout(15000),
      redirect: "manual",
    });
    if (!response.ok)
      return json(
        { error: response.status === 404 ? "design_not_found" : "configurator_unavailable" },
        response.status === 404 ? 404 : 503
      );
    return new Response(response.body, {
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  } catch {
    return json({ error: "configurator_unavailable" }, 503);
  }
}
