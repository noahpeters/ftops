import { json } from "../lib/http";
import type { Env } from "../lib/types";
import { websiteAcquisitionIntegration } from "../lib/websiteAcquisitionIntegration";
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
  const websiteIntegration = await websiteAcquisitionIntegration(env);
  return json({
    email: actor.email,
    isSystemAdmin: actor.isSystemAdmin,
    workspaceIds: actor.workspaceIds,
    workspaceAdminIds: actor.workspaceAdminIds,
    websiteAnalyticsIntegration:
      websiteIntegration && canAccessWorkspace(actor, websiteIntegration.workspace_id)
        ? { id: websiteIntegration.id, workspaceId: websiteIntegration.workspace_id }
        : null,
    cabinetAnalyticsWorkspaceId:
      reportingWorkspaceId && canAccessWorkspace(actor, reportingWorkspaceId)
        ? reportingWorkspaceId
        : null,
  });
}
