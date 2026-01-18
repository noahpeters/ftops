import { buildUrl, fetchJson } from "../../lib/api";

export type ProjectRow = {
  id: string;
  title: string;
  status: string;
  commercial_record_uri?: string | null;
  updated_at?: string | null;
  created_at?: string | null;
};

export type TaskRow = {
  id: string;
  project_id: string;
  scope: "project" | "shared" | "deliverable";
  group_key: string | null;
  line_item_uri: string | null;
  template_key: string;
  title: string;
  kind: string;
  status: string;
  position: number;
};

export type TaskNote = {
  id: string;
  task_id: string;
  author_email: string;
  created_at: string;
  body: string;
};

export async function listProjects() {
  return fetchJson<ProjectRow[]>(buildUrl("/projects"));
}

export async function getProject(id: string) {
  return fetchJson<ProjectRow>(buildUrl(`/projects/${id}`));
}

export async function getProjectTasks(projectId: string) {
  return fetchJson<TaskRow[]>(buildUrl(`/projects/${projectId}/tasks`));
}

export async function patchTaskStatus(taskId: string, status: string) {
  return fetchJson(buildUrl(`/tasks/${taskId}`), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });
}

export async function listTaskNotes(taskId: string) {
  return fetchJson<TaskNote[]>(buildUrl(`/tasks/${taskId}/notes`));
}

export async function addTaskNote(taskId: string, body: string) {
  return fetchJson<TaskNote>(buildUrl(`/tasks/${taskId}/notes`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ body }),
  });
}

export async function createProjectFromRecord(recordUri: string) {
  return fetchJson<{ project: ProjectRow; created: boolean }>(buildUrl("/projects/from-record"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ recordUri }),
  });
}

export async function materializeProject(projectId: string) {
  return fetchJson<{
    alreadyMaterialized: boolean;
    tasksCreated: number;
  }>(buildUrl(`/projects/${projectId}/materialize`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dryRun: false }),
  });
}
