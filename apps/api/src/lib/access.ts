import type { Env } from "./types";
import { getActorEmail } from "./identity";
import { forbidden } from "./http";

export type Actor = {
  email: string;
  isSystemAdmin: boolean;
  workspaceIds: string[];
  workspaceAdminIds: string[];
};

type ActorRow = {
  workspace_id: string;
  workspace_admin?: number | null;
  system_admin?: number | null;
};

export async function getActor(env: Env, request: Request): Promise<Actor | null> {
  const email = getActorEmail(request);
  const rows = await env.DB.prepare(
    `SELECT workspace_id, workspace_admin, system_admin
     FROM users
     WHERE email = ?`
  )
    .bind(email)
    .all<ActorRow>();

  const results = rows.results ?? [];
  if (results.length === 0) {
    const countRow = await env.DB.prepare(`SELECT COUNT(*) as count FROM users`).first<{
      count: number;
    }>();
    if ((countRow?.count ?? 0) === 0) {
      return {
        email,
        isSystemAdmin: true,
        workspaceIds: [],
        workspaceAdminIds: [],
      };
    }
    return null;
  }

  const workspaceIds = results.map((row) => row.workspace_id);
  const workspaceAdminIds = results
    .filter((row) => Boolean(row.workspace_admin))
    .map((row) => row.workspace_id);
  const isSystemAdmin = results.some((row) => Boolean(row.system_admin));

  return {
    email,
    isSystemAdmin,
    workspaceIds,
    workspaceAdminIds,
  };
}

export async function requireActor(env: Env, request: Request) {
  const actor = await getActor(env, request);
  if (!actor) {
    return { response: forbidden("forbidden") } as const;
  }
  return { actor } as const;
}

export function canAccessWorkspace(actor: Actor, workspaceId: string) {
  return actor.isSystemAdmin || actor.workspaceIds.includes(workspaceId);
}

export function canAdminWorkspace(actor: Actor, workspaceId: string) {
  return actor.isSystemAdmin || actor.workspaceAdminIds.includes(workspaceId);
}
