import { buildUrl, fetchJson } from "@/lib/api";

export type KanbanTask = {
  id: string;
  workspace_id: string;
  project_id: string;
  scope: string;
  group_key: string | null;
  line_item_uri: string | null;
  template_key: string;
  title: string;
  kind: string;
  status: string;
  position: number;
  state_json: string | null;
  due_at: string | null;
  assigned_to: string | null;
  created_at: string;
  updated_at: string;
  priority: number;
  attachments_count?: number;
};

export type KanbanResponse = {
  weekStart: string;
  weekEnd: string;
  overdue: KanbanTask[];
  due_this_week: KanbanTask[];
  doing: KanbanTask[];
  blocked: KanbanTask[];
  canceled: KanbanTask[];
};

export type TaskFile = {
  id: string;
  workspace_id: string;
  task_id: string;
  uploaded_by_email?: string | null;
  original_filename: string;
  content_type: string;
  size_bytes: number;
  storage_key: string;
  sha256?: string | null;
  created_at: string;
};

export async function getKanban(scope: "this_week" = "this_week") {
  return await fetchJson<KanbanResponse>(buildUrl("/tasks/kanban", { scope }));
}

export async function patchTask(taskId: string, payload: { status?: string; priority?: number }) {
  return await fetchJson(buildUrl(`/tasks/${taskId}`), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function initTaskFile(
  taskId: string,
  payload: {
    filename: string;
    contentType: string;
    sizeBytes: number;
  }
) {
  return await fetchJson<{ uploadUrl: string; storageKey: string }>(
    buildUrl(`/tasks/${taskId}/files/init`),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }
  );
}

export async function completeTaskFile(
  taskId: string,
  payload: {
    storageKey: string;
    filename: string;
    contentType: string;
    sizeBytes: number;
    sha256?: string;
  }
) {
  return await fetchJson<TaskFile>(buildUrl(`/tasks/${taskId}/files/complete`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function listTaskFiles(taskId: string) {
  return await fetchJson<TaskFile[]>(buildUrl(`/tasks/${taskId}/files`));
}

export async function downloadTaskFile(fileId: string) {
  return await fetchJson<{ downloadUrl: string }>(buildUrl(`/task-files/${fileId}/download`));
}

export async function deleteTaskFile(fileId: string) {
  return await fetchJson<{ ok: boolean }>(buildUrl(`/task-files/${fileId}`), {
    method: "DELETE",
  });
}
