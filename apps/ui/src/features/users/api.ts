import { buildUrl, fetchJson } from "@/lib/api";

export type WorkspaceUser = {
  workspace_id: string;
  user_id: string;
  name: string;
  email: string;
  workspace_admin: number | boolean;
  system_admin: number | boolean;
};

export async function listUsers(workspaceId: string) {
  return await fetchJson<WorkspaceUser[]>(buildUrl(`/workspaces/${workspaceId}/users`));
}

export async function createUser(
  workspaceId: string,
  payload: {
    name: string;
    email: string;
    workspace_admin?: boolean;
    system_admin?: boolean;
  }
) {
  return await fetchJson<WorkspaceUser>(buildUrl(`/workspaces/${workspaceId}/users`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function updateUser(
  workspaceId: string,
  userId: string,
  payload: {
    name?: string;
    email?: string;
    workspace_admin?: boolean;
    system_admin?: boolean;
  }
) {
  return await fetchJson<WorkspaceUser>(buildUrl(`/workspaces/${workspaceId}/users/${userId}`), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function deleteUser(workspaceId: string, userId: string) {
  return await fetchJson<{ ok: boolean }>(buildUrl(`/workspaces/${workspaceId}/users/${userId}`), {
    method: "DELETE",
  });
}
