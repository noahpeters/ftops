"use client";

import { useEffect, useMemo, useState } from "react";
import stylex from "~/lib/stylex";
import { colors, radius, spacing } from "../../theme/tokens.stylex";
import {
  completeFileUpload,
  createNote,
  deleteFile,
  downloadFile,
  initFileUpload,
  listFiles,
  fetchNotes,
  updateTask,
  type TaskFile,
  type TaskNote,
  type TaskRow,
  type WorkspaceUser,
} from "./api";
import { buildUrl } from "@/lib/api";
import {
  listCommercialRecords,
  type CommercialRecordListItem,
} from "@/features/api/commercialRecords";

const STATUS_OPTIONS = ["scheduled", "blocked", "in progress", "done", "canceled"];

const styles = stylex.create({
  overlay: {
    position: "fixed",
    inset: 0,
    backgroundColor: "rgba(47, 33, 24, 0.18)",
  },
  drawer: {
    position: "fixed",
    top: 0,
    right: 0,
    height: "100vh",
    width: "420px",
    maxWidth: "92vw",
    backgroundColor: colors.surface,
    borderLeft: `1px solid ${colors.border}`,
    padding: "20px 18px",
    display: "flex",
    flexDirection: "column",
    gap: spacing.md,
    overflowY: "auto",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: spacing.sm,
  },
  title: {
    fontSize: "20px",
    lineHeight: "1.4",
    fontWeight: 600,
  },
  label: {
    fontSize: "12px",
    lineHeight: "1.4",
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    color: colors.textSubtle,
  },
  section: {
    display: "flex",
    flexDirection: "column",
    gap: spacing.sm,
    paddingBottom: spacing.md,
    borderBottom: `1px solid ${colors.border}`,
  },
  field: {
    display: "flex",
    flexDirection: "column",
    gap: spacing.xs,
  },
  input: {
    border: `1px solid ${colors.border}`,
    borderRadius: radius.sm,
    padding: "8px 10px",
    fontFamily: "inherit",
    fontSize: "14px",
  },
  textarea: {
    border: `1px solid ${colors.border}`,
    borderRadius: radius.sm,
    padding: "8px 10px",
    fontFamily: "inherit",
    fontSize: "14px",
    minHeight: "90px",
  },
  row: {
    display: "flex",
    flexWrap: "wrap",
    gap: spacing.sm,
    alignItems: "center",
  },
  metaText: {
    fontSize: "14px",
    lineHeight: "1.5",
    color: colors.textMuted,
  },
  list: {
    display: "flex",
    flexDirection: "column",
    gap: spacing.sm,
  },
  noteCard: {
    border: `1px solid ${colors.border}`,
    borderRadius: radius.sm,
    padding: "8px 10px",
    backgroundColor: colors.surfaceAlt,
    fontSize: "14px",
    lineHeight: "1.5",
  },
  noteMeta: {
    fontSize: "12px",
    lineHeight: "1.4",
    color: colors.textMuted,
  },
  fileRow: {
    display: "flex",
    justifyContent: "space-between",
    gap: spacing.sm,
    alignItems: "center",
    border: `1px solid ${colors.border}`,
    padding: "8px 10px",
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceAlt,
  },
  fileMeta: {
    display: "flex",
    flexDirection: "column",
    gap: spacing.xs,
    fontSize: "12px",
    lineHeight: "1.4",
  },
  actions: {
    display: "flex",
    gap: spacing.sm,
    flexWrap: "wrap",
  },
});

type Props = {
  task: TaskRow;
  workspaceId: string | null;
  users: WorkspaceUser[];
  onClose: () => void;
  onUpdated: () => Promise<void>;
};

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
  const [dueDate, setDueDate] = useState(() => toDateInput(task.due_at));
  const [notes, setNotes] = useState<TaskNote[]>([]);
  const [noteDraft, setNoteDraft] = useState("");
  const [files, setFiles] = useState<TaskFile[]>([]);
  const [noteError, setNoteError] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [customers, setCustomers] = useState<CommercialRecordListItem[]>([]);

  useEffect(() => {
    setTitle(task.title);
    setDescription(task.description ?? "");
    setStatus(task.status);
    setAssignedTo(task.assigned_to ?? "");
    setCustomerId(task.customer_id ?? "");
    setDueDate(toDateInput(task.due_at));
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
      const result = await listCommercialRecords({ limit: 200, offset: 0 });
      if (result.ok) {
        setCustomers(result.data?.records ?? []);
      }
    })();
  }, [workspaceId]);

  const completedAt = useMemo(() => formatDateTime(task.completed_at), [task.completed_at]);

  async function handleSave() {
    setSaving(true);
    const payload = {
      title: title.trim() || task.title,
      description: description.trim() || null,
      status,
      assigned_to: assignedTo.trim() || null,
      due_at: dueDate ? new Date(`${dueDate}T00:00:00`).toISOString() : null,
      customer_id: customerId.trim() || null,
    };
    const result = await updateTask(task.id, payload);
    setSaving(false);
    if (result.ok) {
      await onUpdated();
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
    <>
      <div className={stylex(styles.overlay)} onClick={onClose} />
      <aside className={stylex(styles.drawer)}>
        <div className={stylex(styles.header)}>
          <div>
            <div className={stylex(styles.label)}>Task</div>
            <div className={stylex(styles.title)}>{task.title}</div>
          </div>
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>

        <section className={stylex(styles.section)}>
          <div className={stylex(styles.label)}>Fields</div>
          <div className={stylex(styles.field)}>
            <label className={stylex(styles.label)}>Title</label>
            <input
              className={stylex(styles.input)}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>
          <div className={stylex(styles.field)}>
            <label className={stylex(styles.label)}>Description</label>
            <textarea
              className={stylex(styles.textarea)}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>
          <div className={stylex(styles.row)}>
            <div className={stylex(styles.field)}>
              <label className={stylex(styles.label)}>Status</label>
              <select value={status} onChange={(event) => setStatus(event.target.value)}>
                {STATUS_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </div>
            <div className={stylex(styles.field)}>
              <label className={stylex(styles.label)}>Assigned</label>
              <select
                className={stylex(styles.input)}
                value={assignedTo}
                onChange={(event) => setAssignedTo(event.target.value)}
              >
                <option value="">Unassigned</option>
                {users.map((user) => (
                  <option key={user.user_id} value={user.user_id}>
                    {user.name} ({user.email})
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className={stylex(styles.row)}>
            <div className={stylex(styles.field)}>
              <label className={stylex(styles.label)}>Due date</label>
              <input
                className={stylex(styles.input)}
                type="date"
                value={dueDate}
                onChange={(event) => setDueDate(event.target.value)}
              />
            </div>
            <div className={stylex(styles.field)}>
              <label className={stylex(styles.label)}>Completed</label>
              <span className={stylex(styles.metaText)}>{completedAt}</span>
            </div>
          </div>
          <div className={stylex(styles.row)}>
            <div className={stylex(styles.field)}>
              <label className={stylex(styles.label)}>Template ID</label>
              <span className={stylex(styles.metaText)}>
                {task.template_id ?? task.template_key ?? "—"}
              </span>
            </div>
            <div className={stylex(styles.field)}>
              <label className={stylex(styles.label)}>Customer ID</label>
              <select
                className={stylex(styles.input)}
                value={customerId}
                onChange={(event) => setCustomerId(event.target.value)}
              >
                <option value="">Unassigned</option>
                {buildCustomerOptions(customers).map((customer) => (
                  <option key={customer.id} value={customer.id}>
                    {customer.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <button type="button" onClick={() => void handleSave()} disabled={saving}>
            {saving ? "Saving..." : "Save"}
          </button>
        </section>

        <section className={stylex(styles.section)}>
          <div className={stylex(styles.label)}>Notes</div>
          {noteError && <span className={stylex(styles.metaText)}>{noteError}</span>}
          <div className={stylex(styles.list)}>
            {notes.length === 0 && <span className={stylex(styles.metaText)}>No notes yet.</span>}
            {notes.map((note) => (
              <div key={note.id} className={stylex(styles.noteCard)}>
                <div className={stylex(styles.noteMeta)}>
                  {note.author_email} · {note.created_at}
                </div>
                <div>{note.body}</div>
              </div>
            ))}
          </div>
          <textarea
            className={stylex(styles.textarea)}
            value={noteDraft}
            onChange={(event) => setNoteDraft(event.target.value)}
            placeholder="Add a note..."
          />
          <button type="button" onClick={() => void handleAddNote()}>
            Add note
          </button>
        </section>

        <section className={stylex(styles.section)}>
          <div className={stylex(styles.label)}>Files</div>
          {fileError && <span className={stylex(styles.metaText)}>{fileError}</span>}
          <div className={stylex(styles.list)}>
            {files.length === 0 && <span className={stylex(styles.metaText)}>No files yet.</span>}
            {files.map((file) => (
              <div key={file.id} className={stylex(styles.fileRow)}>
                <div className={stylex(styles.fileMeta)}>
                  <strong>{file.original_filename}</strong>
                  <span>{formatFileMeta(file)}</span>
                </div>
                <div className={stylex(styles.actions)}>
                  <button type="button" onClick={() => void handleDownload(file)}>
                    Download
                  </button>
                  <button type="button" onClick={() => void handleDelete(file.id)}>
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
          <input type="file" onChange={handleUpload} />
        </section>
      </aside>
    </>
  );
}

function toDateInput(value: string | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
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

function buildCustomerOptions(records: CommercialRecordListItem[]) {
  const seen = new Set<string>();
  const options: Array<{ id: string; label: string }> = [];
  for (const record of records) {
    const customerUri = record.customer_uri?.trim();
    if (!customerUri || seen.has(customerUri)) continue;
    seen.add(customerUri);
    const label = record.customer_display?.trim() || customerUri;
    options.push({ id: customerUri, label });
  }
  return options;
}
