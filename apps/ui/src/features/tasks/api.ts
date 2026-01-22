import { buildUrl, fetchJson } from "@/lib/api";

export type TaskRow = {
  id: string;
  workspace_id: string;
  project_id: string;
  scope: string;
  group_key: string | null;
  line_item_uri: string | null;
  template_key: string;
  template_id?: string | null;
  title: string;
  kind: string;
  description?: string | null;
  status: string;
  position: number;
  state_json: string | null;
  due_at: string | null;
  completed_at?: string | null;
  assigned_to: string | null;
  customer_id?: string | null;
  created_at: string;
  updated_at: string;
  priority: number;
  attachments_count?: number;
  notes_count?: number;
};

export type KanbanResponse = {
  weekStart: string;
  weekEnd: string;
  scheduled: TaskRow[];
  overdue: TaskRow[];
  due_this_week: TaskRow[];
  in_progress: TaskRow[];
  blocked: TaskRow[];
  done: TaskRow[];
  canceled: TaskRow[];
};

export type TaskNote = {
  id: string;
  task_id: string;
  author_email: string;
  created_at: string;
  body: string;
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

export type WorkspaceUser = {
  workspace_id: string;
  user_id: string;
  name: string;
  email: string;
  workspace_admin?: number | boolean;
  system_admin?: number | boolean;
};

export async function fetchKanban(workspaceId: string, scope: "this_week" = "this_week") {
  return await fetchJson<KanbanResponse>(buildUrl("/tasks/kanban", { scope, workspaceId }));
}

export async function getTask(id: string) {
  return await fetchJson<TaskRow>(buildUrl(`/tasks/${id}`));
}

export async function updateTask(
  id: string,
  updates: {
    status?: string;
    priority?: number;
    due_at?: string | null;
    assigned_to?: string | null;
    description?: string | null;
    template_id?: string | null;
    customer_id?: string | null;
    title?: string | null;
  }
) {
  return await fetchJson<TaskRow>(buildUrl(`/tasks/${id}`), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updates),
  });
}

export async function fetchNotes(taskId: string) {
  return await fetchJson<TaskNote[]>(buildUrl(`/tasks/${taskId}/notes`));
}

export async function createNote(taskId: string, body: string) {
  return await fetchJson<TaskNote>(buildUrl(`/tasks/${taskId}/notes`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ body }),
  });
}

export async function initFileUpload(
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

export async function completeFileUpload(
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

export async function listFiles(taskId: string) {
  return await fetchJson<TaskFile[]>(buildUrl(`/tasks/${taskId}/files`));
}

export async function downloadFile(fileId: string) {
  return await fetchJson<{ downloadUrl: string }>(buildUrl(`/task-files/${fileId}/download`));
}

export async function deleteFile(fileId: string) {
  return await fetchJson<{ ok: boolean }>(buildUrl(`/task-files/${fileId}`), {
    method: "DELETE",
  });
}

export async function listWorkspaceUsers(workspaceId: string) {
  return await fetchJson<WorkspaceUser[]>(buildUrl(`/workspaces/${workspaceId}/users`));
}
