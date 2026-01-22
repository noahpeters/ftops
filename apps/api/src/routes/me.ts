import { json } from "../lib/http";
import type { Env } from "../lib/types";
import { requireActor } from "../lib/access";

export async function handleMe(
  _segments: string[],
  request: Request,
  env: Env,
  _ctx: ExecutionContext,
  _url: URL
) {
  const actorResult = await requireActor(env, request);
  if ("response" in actorResult) {
    return actorResult.response;
  }

  const { actor } = actorResult;
  return json({
    email: actor.email,
    isSystemAdmin: actor.isSystemAdmin,
    workspaceIds: actor.workspaceIds,
    workspaceAdminIds: actor.workspaceAdminIds,
  });
}
