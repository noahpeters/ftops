import { SKETCHUP_EXTENSION } from "../assets/sketchupExtension";
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
  if (
    segments.length > 1 ||
    (segments[0] && !["design", "export", "extension"].includes(segments[0]))
  )
    return notFound("Route not found");
  if (segments[0] === "extension")
    return new Response(JSON.stringify(SKETCHUP_EXTENSION), {
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  if (!env.CABINET_ANALYTICS_URL || !env.CABINET_ANALYTICS_READ_TOKEN)
    return json({ error: "configurator_not_connected" }, 503);
  const incoming = new URL(request.url);
  const target = new URL(
    segments[0] === "export"
      ? "/admin/export"
      : segments[0] === "design"
        ? "/admin/design"
        : "/admin/dashboard",
    env.CABINET_ANALYTICS_URL
  );
  if (target.protocol !== "https:") return json({ error: "configurator_not_connected" }, 503);
  const filters =
    segments[0] === "export"
      ? [
          "slug",
          "revision",
          "carcassThickness",
          "dadoDepth",
          "backThickness",
          "backGrooveDepth",
          "stretcherWidth",
          "drawerThickness",
          "drawerRabbetDepth",
          "drawerBottomThickness",
          "drawerGrooveDepth",
          "drawerBottomInset",
          "drawerSideHeight",
          "drawerWidthDeduction",
          "drawerDepthDeduction",
          "shakerRailWidth",
          "shakerPanelThickness",
          "shakerGrooveDepth",
        ]
      : ["days", "page", "slug"];
  for (const key of filters) {
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
    if (segments[0] === "export" && [400, 409, 422].includes(response.status)) {
      const body = (await response.json()) as { error?: unknown; issues?: unknown };
      return json(
        {
          error:
            typeof body.error === "string" &&
            [
              "invalid_construction_profile",
              "design_revision_changed",
              "fabrication_needs_review",
              "invalid_saved_design",
            ].includes(body.error)
              ? body.error
              : "invalid_export_request",
          issues: Array.isArray(body.issues)
            ? body.issues
                .filter((issue): issue is string => typeof issue === "string")
                .slice(0, 100)
                .map((issue) => issue.slice(0, 500))
            : [],
        },
        response.status
      );
    }
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
