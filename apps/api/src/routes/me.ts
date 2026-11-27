import { json } from "../lib/http";
import type { Env } from "../lib/types";
import { canAccessWorkspace, requireActor } from "../lib/access";

export async function handleMe(
  _segments: string[],
  request: Request,
  env: Env,
  _ctx: ExecutionContext,
  _url: URL
) {
  const actorResult = await requireActor(env, request);
  if (!actorResult.ok) {
    return actorResult.response;
  }

  const { actor } = actorResult;
  const reportingWorkspaceId = env.CABINET_ANALYTICS_WORKSPACE_ID;
  return json({
    email: actor.email,
    isSystemAdmin: actor.isSystemAdmin,
    workspaceIds: actor.workspaceIds,
    workspaceAdminIds: actor.workspaceAdminIds,
    cabinetAnalyticsWorkspaceId:
      reportingWorkspaceId && canAccessWorkspace(actor, reportingWorkspaceId)
        ? reportingWorkspaceId
        : null,
  });
}
