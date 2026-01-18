import { buildUrl, fetchJson } from "../../lib/api";

export type WorkspaceRow = {
  id: string;
  slug?: string | null;
  name: string;
  created_at?: string | null;
  updated_at?: string | null;
};

export async function listWorkspaces() {
  return fetchJson<WorkspaceRow[]>(buildUrl("/workspaces"));
}

export async function createWorkspace(body: { slug: string; name: string }) {
  return fetchJson<WorkspaceRow>(buildUrl("/workspaces"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function updateWorkspace(id: string, body: { slug?: string; name?: string }) {
  return fetchJson<WorkspaceRow>(buildUrl(`/workspaces/${id}`), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function deleteWorkspace(id: string) {
  return fetchJson(buildUrl(`/workspaces/${id}`), { method: "DELETE" });
}
