"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import stylex from "~/lib/stylex";
import {
  Button,
  List,
  Panel,
  Select,
  SidePanel,
  Status,
  TextArea,
  TextInput,
} from "@from-trees/ui";
import { color, metrics, space } from "@from-trees/ui/tokens.stylex";
import {
  completeFileUpload,
  createNote,
  deleteFile,
  downloadFile,
  initFileUpload,
  listFiles,
  fetchNotes,
  getTask,
  updateTask,
  type TaskFile,
  type TaskNote,
  type TaskRow,
  type WorkspaceUser,
} from "./api";
import { buildUrl } from "@/lib/api";
import { listCustomers, type CustomerSummary } from "@/features/customers/api";

const STATUS_OPTIONS = ["scheduled", "blocked", "in progress", "done", "canceled"];

const styles = stylex.create({
  stack: { display: "grid", gap: space.md, minWidth: 0 },
  details: {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    gap: space.md,
    margin: 0,
  },
  value: { margin: 0, overflowWrap: "anywhere" },
  notes: { listStyleType: "none", margin: 0, padding: 0, display: "grid", gap: space.md },
  note: { whiteSpace: "pre-wrap", overflowWrap: "anywhere" },
  muted: { color: color.muted, fontSize: metrics.small, margin: 0 },
});

type Props = {
  task: TaskRow;
  workspaceId: string | null;
  users: WorkspaceUser[];
  onClose: () => void;
  onUpdated: () => Promise<void>;
};

type TaskEditorDrawerProps = {
  taskId: string;
  workspaceId: string | null;
  users: WorkspaceUser[];
  onClose: () => void;
  onUpdated: () => Promise<void>;
  initialTask?: TaskRow;
};

export function TaskEditorDrawer({
  taskId,
  workspaceId,
  users,
  onClose,
  onUpdated,
  initialTask,
}: TaskEditorDrawerProps): JSX.Element | null {
  const [task, setTask] = useState<TaskRow | null>(initialTask?.id === taskId ? initialTask : null);

  useEffect(() => {
    let active = true;
    if (initialTask?.id === taskId) {
      setTask(initialTask);
    } else {
      setTask(null);
    }
    void getTask(taskId).then((result) => {
      if (active && result.ok && result.data) setTask(result.data);
    });
    return () => {
      active = false;
    };
  }, [initialTask, taskId]);

  if (!task) return null;

  return (
    <TaskDetailDrawer
      task={task}
      workspaceId={workspaceId}
      users={users}
      onClose={onClose}
      onUpdated={async () => {
        await onUpdated();
        const result = await getTask(taskId);
        if (result.ok && result.data) setTask(result.data);
      }}
    />
  );
}

export function TaskDetailDrawer({
  task,
  workspaceId,
  users,
  onClose,
  onUpdated,
}: Props): JSX.Element {
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? "");
  const [status, setStatus] = useState(task.status);
  const [assignedTo, setAssignedTo] = useState(task.assigned_to ?? "");
  const [customerId, setCustomerId] = useState(task.customer_id ?? "");
  const [dueDate, setDueDate] = useState(() => toDateTimeInput(task.due_at));
  const [notes, setNotes] = useState<TaskNote[]>([]);
  const [noteDraft, setNoteDraft] = useState("");
  const [files, setFiles] = useState<TaskFile[]>([]);
  const filePicker = useRef<HTMLInputElement>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [noteError, setNoteError] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [customers, setCustomers] = useState<CustomerSummary[]>([]);

  useEffect(() => {
    setTitle(task.title);
    setDescription(task.description ?? "");
    setStatus(task.status);
    setAssignedTo(task.assigned_to ?? "");
    setCustomerId(task.customer_id ?? "");
    setDueDate(toDateTimeInput(task.due_at));
  }, [task]);

  useEffect(() => {
    void (async () => {
      const [notesResult, filesResult] = await Promise.all([
        fetchNotes(task.id),
        listFiles(task.id),
      ]);
      if (notesResult.ok) {
        setNotes(notesResult.data ?? []);
      }
      if (filesResult.ok) {
        setFiles(filesResult.data ?? []);
      }
    })();
  }, [task.id]);

  useEffect(() => {
    void (async () => {
      if (!workspaceId) {
        setCustomers([]);
        return;
      }
      const result = await listCustomers(workspaceId, {});
      if (result.ok) {
        setCustomers(result.data ?? []);
      }
    })();
  }, [workspaceId]);

  const completedAt = useMemo(() => formatDateTime(task.completed_at), [task.completed_at]);
  const taskUpdates = useMemo(
    () => ({
      title: title.trim() || task.title,
      description: description.trim() || null,
      status,
      assigned_to: assignedTo.trim() || null,
      due_at:
        dueDate === toDateTimeInput(task.due_at)
          ? (task.due_at ?? null)
          : dueDate
            ? new Date(dueDate).toISOString()
            : null,
      customer_id: customerId.trim() || null,
    }),
    [assignedTo, customerId, description, dueDate, status, task, title]
  );
  const hasChanges = useMemo(
    () =>
      taskUpdates.title !== task.title ||
      taskUpdates.description !== (task.description ?? null) ||
      taskUpdates.status !== task.status ||
      taskUpdates.assigned_to !== (task.assigned_to ?? null) ||
      taskUpdates.due_at !== (task.due_at ?? null) ||
      taskUpdates.customer_id !== (task.customer_id ?? null),
    [task, taskUpdates]
  );

  async function handleSave() {
    if (!hasChanges || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      const result = await updateTask(task.id, taskUpdates);
      if (!result.ok) {
        setSaveError(result.text || "Could not save the task.");
        return;
      }
      await onUpdated();
      onClose();
    } catch {
      setSaveError("Could not save the task.");
    } finally {
      setSaving(false);
    }
  }

  async function handleAddNote() {
    const body = noteDraft.trim();
    if (!body) {
      setNoteError("Note body cannot be empty.");
      return;
    }
    setNoteError(null);
    const result = await createNote(task.id, body);
    if (!result.ok) {
      setNoteError(result.text || "Failed to add note.");
      return;
    }
    const refreshed = await fetchNotes(task.id);
    if (refreshed.ok) {
      setNotes(refreshed.data ?? []);
      setNoteDraft("");
    }
  }

  async function handleUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setFileError(null);
    const init = await initFileUpload(task.id, {
      filename: file.name,
      contentType: file.type || "application/octet-stream",
      sizeBytes: file.size,
    });
    if (!init.ok || !init.data) {
      setFileError(init.text || "Failed to start upload.");
      return;
    }
    const resolvedUploadUrl = init.data.uploadUrl.startsWith("/")
      ? buildUrl(init.data.uploadUrl)
      : init.data.uploadUrl;
    const uploadResponse = await fetch(resolvedUploadUrl, {
      method: "PUT",
      headers: { "Content-Type": file.type || "application/octet-stream" },
      body: file,
    });
    if (!uploadResponse.ok) {
      setFileError("Upload failed.");
      return;
    }
    const complete = await completeFileUpload(task.id, {
      storageKey: init.data.storageKey,
      filename: file.name,
      contentType: file.type || "application/octet-stream",
      sizeBytes: file.size,
    });
    if (!complete.ok) {
      setFileError(complete.text || "Failed to finalize upload.");
      return;
    }
    const refreshed = await listFiles(task.id);
    if (refreshed.ok) {
      setFiles(refreshed.data ?? []);
    }
    event.target.value = "";
    await onUpdated();
  }

  async function handleDownload(file: TaskFile) {
    const result = await downloadFile(file.id);
    if (!result.ok || !result.data?.downloadUrl) {
      setFileError(result.text || "Failed to fetch download URL.");
      return;
    }
    try {
      const resolvedDownloadUrl = result.data.downloadUrl.startsWith("/")
        ? buildUrl(result.data.downloadUrl)
        : result.data.downloadUrl;
      const response = await fetch(resolvedDownloadUrl);
      if (!response.ok) {
        setFileError("Failed to download file.");
        return;
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = file.original_filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      setFileError(error instanceof Error ? error.message : "Failed to download file.");
    }
  }

  async function handleDelete(fileId: string) {
    const result = await deleteFile(fileId);
    if (!result.ok) {
      setFileError(result.text || "Failed to delete file.");
      return;
    }
    const refreshed = await listFiles(task.id);
    if (refreshed.ok) {
      setFiles(refreshed.data ?? []);
    }
    await onUpdated();
  }

  return (
    <SidePanel
      open
      title={task.title}
      description="Task"
      dismissible={!saving}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      footer={
        <>
          <Button isDisabled={saving} onPress={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            busy={saving}
            isDisabled={!hasChanges}
            onPress={() => void handleSave()}
          >
            Save task
          </Button>
        </>
      }
    >
      <div className={stylex(styles.stack)}>
        {saveError && <Status tone="danger">{saveError}</Status>}
        <Panel title="Fields">
          <TextInput
            label="Title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
          <TextArea
            label="Description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
          <Select label="Status" value={status} onChange={(event) => setStatus(event.target.value)}>
            {STATUS_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </Select>
          <Select
            label="Assigned"
            value={assignedTo}
            onChange={(event) => setAssignedTo(event.target.value)}
          >
            <option value="">Unassigned</option>
            {users.map((user) => (
              <option key={user.user_id} value={user.user_id}>
                {user.name} ({user.email})
              </option>
            ))}
          </Select>
          <TextInput
            label="Due date and time"
            type="datetime-local"
            value={dueDate}
            onChange={(event) => setDueDate(event.target.value)}
          />
          <Select
            label="Customer"
            value={customerId}
            onChange={(event) => setCustomerId(event.target.value)}
          >
            <option value="">Unassigned</option>
            {buildCustomerOptions(customers).map((customer) => (
              <option key={customer.id} value={customer.id}>
                {customer.label}
              </option>
            ))}
          </Select>
          <dl className={stylex(styles.details)}>
            <div>
              <dt className={stylex(styles.muted)}>Completed</dt>
              <dd className={stylex(styles.value)}>{completedAt}</dd>
            </div>
            <div>
              <dt className={stylex(styles.muted)}>Template ID</dt>
              <dd className={stylex(styles.value)}>
                {task.template_id ?? task.template_key ?? "—"}
              </dd>
            </div>
          </dl>
        </Panel>
        <Panel title="Notes">
          {noteError && <Status tone="danger">{noteError}</Status>}
          {notes.length ? (
            <ul className={stylex(styles.notes)}>
              {notes.map((note) => (
                <li key={note.id}>
                  <p className={stylex(styles.muted)}>
                    {note.author_email} · {note.created_at}
                  </p>
                  <div className={stylex(styles.note)}>{note.body}</div>
                </li>
              ))}
            </ul>
          ) : (
            <p className={stylex(styles.muted)}>No notes yet.</p>
          )}
          <TextArea
            label="Add a note"
            value={noteDraft}
            onChange={(event) => setNoteDraft(event.target.value)}
          />
          <div>
            <Button onPress={() => void handleAddNote()}>Add note</Button>
          </div>
        </Panel>
        <Panel
          title="Files"
          actions={<Button onPress={() => filePicker.current?.click()}>Attach file</Button>}
        >
          <input ref={filePicker} type="file" hidden onChange={handleUpload} />
          {fileError && <Status tone="danger">{fileError}</Status>}
          <List
            label="Task files"
            emptyMessage="No files yet."
            items={files.map((file) => ({
              id: file.id,
              title: file.original_filename,
              metadata: formatFileMeta(file),
              actions: [
                { id: "download", label: "Download", onAction: () => void handleDownload(file) },
                { id: "delete", label: "Delete", onAction: () => void handleDelete(file.id) },
              ],
            }))}
          />
        </Panel>
      </div>
    </SidePanel>
  );
}

function toDateTimeInput(value: string | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function formatDateTime(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatFileMeta(file: TaskFile) {
  const sizeKb = Math.round(file.size_bytes / 1024);
  return `${sizeKb} KB · ${file.content_type}`;
}

function buildCustomerOptions(records: CustomerSummary[]) {
  return records.map((customer) => ({ id: customer.id, label: customer.display_name }));
}
