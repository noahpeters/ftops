"use client";

import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from "react";
import stylex from "~/lib/stylex";
import { colors, radius, spacing } from "../../theme/tokens.stylex";
import {
  completeTaskFile,
  deleteTaskFile,
  downloadTaskFile,
  getKanban,
  initTaskFile,
  listTaskFiles,
  patchTask,
  type KanbanResponse,
  type KanbanTask,
  type TaskFile,
} from "./api";
import { addTaskNote, listTaskNotes, type TaskNote } from "@/features/projects/api";
import { buildUrl } from "@/lib/api";

type LaneKey = "overdue" | "due_this_week" | "in_progress" | "blocked" | "canceled";

const LANE_CONFIG: Array<{ key: LaneKey; label: string }> = [
  { key: "overdue", label: "Overdue" },
  { key: "due_this_week", label: "Due This Week" },
  { key: "in_progress", label: "In Progress" },
  { key: "blocked", label: "Blocked" },
  { key: "canceled", label: "Canceled" },
];

const STATUS_OPTIONS = ["scheduled", "in progress", "blocked", "done", "canceled"];

const styles = stylex.create({
  panel: {
    padding: "24px 32px",
  },
  header: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  headerMeta: {
    display: "flex",
    flexDirection: "column",
    gap: spacing.xs,
  },
  metaText: {
    fontSize: "14px",
    lineHeight: "1.5",
    color: colors.textMuted,
  },
  board: {
    display: "flex",
    flexWrap: "wrap",
    gap: spacing.lg,
    alignItems: "flex-start",
  },
  lane: {
    flex: "1 1 240px",
    border: `1px solid ${colors.border}`,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    minHeight: "220px",
    display: "flex",
    flexDirection: "column",
  },
  laneHeader: {
    padding: "12px 14px",
    borderBottom: `1px solid ${colors.border}`,
    backgroundColor: colors.surfaceAlt,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    fontSize: "14px",
    lineHeight: "1.5",
    fontWeight: 600,
  },
  laneBody: {
    display: "flex",
    flexDirection: "column",
    gap: spacing.sm,
    padding: "12px",
    minHeight: "180px",
  },
  card: {
    border: `1px solid ${colors.border}`,
    borderRadius: radius.sm,
    padding: "10px 12px",
    backgroundColor: colors.surface,
    display: "flex",
    flexDirection: "column",
    gap: spacing.xs,
    cursor: "grab",
    boxShadow: "0 10px 18px rgba(47, 75, 58, 0.12)",
  },
  cardDragging: {
    opacity: 0.6,
  },
  cardTitle: {
    fontSize: "14px",
    lineHeight: "1.5",
    fontWeight: 600,
  },
  cardMeta: {
    display: "flex",
    flexWrap: "wrap",
    gap: spacing.sm,
    fontSize: "12px",
    lineHeight: "1.4",
    color: colors.textMuted,
  },
  badgeOverdue: {
    backgroundColor: colors.errorBg,
    color: colors.errorText,
    borderRadius: radius.sm,
    padding: "2px 6px",
    fontSize: "11px",
    fontWeight: 600,
  },
  badgePriority: {
    backgroundColor: colors.neutralBg,
    color: colors.neutralText,
    borderRadius: radius.sm,
    padding: "2px 6px",
    fontSize: "11px",
    fontWeight: 600,
  },
  cardActions: {
    display: "flex",
    gap: spacing.xs,
    flexWrap: "wrap",
    marginTop: spacing.xs,
  },
  actionButton: {
    border: `1px solid ${colors.border}`,
    backgroundColor: colors.surfaceAlt,
    color: colors.text,
    padding: "4px 8px",
    borderRadius: radius.sm,
    cursor: "pointer",
    fontSize: "12px",
  },
  emptyLane: {
    color: colors.textSubtle,
    fontSize: "14px",
    lineHeight: "1.5",
  },
  error: {
    color: colors.errorText,
    fontSize: "14px",
    lineHeight: "1.5",
  },
  drawerOverlay: {
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
  drawerHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: spacing.sm,
  },
  drawerTitle: {
    fontSize: "20px",
    lineHeight: "1.4",
    fontWeight: 600,
  },
  drawerSection: {
    display: "flex",
    flexDirection: "column",
    gap: spacing.sm,
    paddingBottom: spacing.md,
    borderBottom: `1px solid ${colors.border}`,
  },
  drawerLabel: {
    fontSize: "12px",
    lineHeight: "1.4",
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    color: colors.textSubtle,
  },
  drawerRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: spacing.sm,
    alignItems: "center",
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
  notesList: {
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
  noteInput: {
    width: "100%",
    minHeight: "80px",
    borderRadius: radius.sm,
    border: `1px solid ${colors.border}`,
    padding: "8px 10px",
    fontFamily: "inherit",
    fontSize: "14px",
  },
});

export function TasksKanbanPanel(): JSX.Element {
  const [kanban, setKanban] = useState<KanbanResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragState, setDragState] = useState<{ taskId: string; fromLane: LaneKey } | null>(null);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [notes, setNotes] = useState<TaskNote[]>([]);
  const [notesLoading, setNotesLoading] = useState(false);
  const [noteDraft, setNoteDraft] = useState("");
  const [noteError, setNoteError] = useState<string | null>(null);
  const [files, setFiles] = useState<TaskFile[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);

  const activeTask = useMemo(() => {
    if (!activeTaskId || !kanban) return null;
    for (const { key } of LANE_CONFIG) {
      const task = kanban[key].find((item) => item.id === activeTaskId);
      if (task) return task;
    }
    return null;
  }, [activeTaskId, kanban]);

  const loadKanban = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await getKanban();
    if (!result.ok) {
      setError(result.text || "Failed to load kanban data.");
      setKanban(null);
    } else {
      setKanban(result.data);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadKanban();
  }, [loadKanban]);

  useEffect(() => {
    if (!activeTaskId) {
      setNotes([]);
      setFiles([]);
      setNoteDraft("");
      return;
    }
    void (async () => {
      setNotesLoading(true);
      setFilesLoading(true);
      setNoteError(null);
      setFileError(null);

      const [notesResult, filesResult] = await Promise.all([
        listTaskNotes(activeTaskId),
        listTaskFiles(activeTaskId),
      ]);

      if (!notesResult.ok) {
        setNoteError(notesResult.text || "Failed to load notes.");
        setNotes([]);
      } else {
        setNotes(notesResult.data ?? []);
      }

      if (!filesResult.ok) {
        setFileError(filesResult.text || "Failed to load files.");
        setFiles([]);
      } else {
        setFiles(filesResult.data ?? []);
      }

      setNotesLoading(false);
      setFilesLoading(false);
    })();
  }, [activeTaskId]);

  function getLaneTasks(lane: LaneKey) {
    return kanban ? kanban[lane] : [];
  }

  async function updateLanePriorities(
    lane: LaneKey,
    tasks: KanbanTask[],
    statusOverride?: string,
    statusTaskId?: string
  ) {
    const base = 1000;
    const step = 10;
    const reindexed = tasks.map((task, index) => ({
      ...task,
      priority: base - index * step,
      status: statusOverride && task.id === statusTaskId ? statusOverride : task.status,
    }));

    setKanban((prev) => (prev ? { ...prev, [lane]: reindexed } : prev));

    const updates = reindexed.map((task) => {
      const payload: { priority: number; status?: string } = { priority: task.priority };
      if (statusOverride && task.id === statusTaskId) {
        payload.status = statusOverride;
      }
      return patchTask(task.id, payload);
    });

    const results = await Promise.all(updates);
    if (results.some((result) => !result.ok)) {
      await loadKanban();
    }
  }

  async function handleDrop(lane: LaneKey, targetIndex: number) {
    if (!dragState || !kanban) return;
    const { taskId, fromLane } = dragState;
    const fromTasks = [...kanban[fromLane]];
    const taskIndex = fromTasks.findIndex((task) => task.id === taskId);
    if (taskIndex === -1) return;
    const [moved] = fromTasks.splice(taskIndex, 1);
    const targetTasks = fromLane === lane ? fromTasks : [...kanban[lane]];
    const insertIndex =
      fromLane === lane && taskIndex < targetIndex ? Math.max(0, targetIndex - 1) : targetIndex;
    targetTasks.splice(insertIndex, 0, moved);

    setDragState(null);

    if (fromLane === lane) {
      await updateLanePriorities(lane, targetTasks);
      return;
    }

    setKanban((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        [fromLane]: fromTasks,
        [lane]: targetTasks,
      };
    });

    await updateLanePriorities(lane, targetTasks, statusForLane(lane), moved.id);
  }

  async function bumpTask(task: KanbanTask, lane: LaneKey, direction: "up" | "down") {
    if (!kanban) return;
    const tasks = [...kanban[lane]];
    const index = tasks.findIndex((item) => item.id === task.id);
    if (index === -1) return;
    const nextIndex = direction === "up" ? index - 1 : index + 1;
    if (nextIndex < 0 || nextIndex >= tasks.length) return;
    const [moved] = tasks.splice(index, 1);
    tasks.splice(nextIndex, 0, moved);
    await updateLanePriorities(lane, tasks);
  }

  async function markDone(task: KanbanTask) {
    const result = await patchTask(task.id, { status: "done" });
    if (result.ok) {
      await loadKanban();
    }
  }

  async function handleStatusChange(taskId: string, status: string) {
    const result = await patchTask(taskId, { status });
    if (result.ok) {
      await loadKanban();
    }
  }

  async function handleAddNote() {
    if (!activeTaskId) return;
    const trimmed = noteDraft.trim();
    if (!trimmed) {
      setNoteError("Note body cannot be empty.");
      return;
    }
    setNoteError(null);
    const result = await addTaskNote(activeTaskId, trimmed);
    if (!result.ok) {
      setNoteError(result.text || "Failed to add note.");
      return;
    }
    const refreshed = await listTaskNotes(activeTaskId);
    if (refreshed.ok) {
      setNotes(refreshed.data ?? []);
      setNoteDraft("");
    }
  }

  async function handleUpload(event: ChangeEvent<HTMLInputElement>) {
    if (!activeTaskId) return;
    const file = event.target.files?.[0];
    if (!file) return;
    setFileError(null);
    setFilesLoading(true);
    const init = await initTaskFile(activeTaskId, {
      filename: file.name,
      contentType: file.type || "application/octet-stream",
      sizeBytes: file.size,
    });
    if (!init.ok || !init.data) {
      setFileError(init.text || "Failed to start upload.");
      setFilesLoading(false);
      return;
    }
    const { uploadUrl, storageKey } = init.data;
    const resolvedUploadUrl = uploadUrl.startsWith("/") ? buildUrl(uploadUrl) : uploadUrl;
    const uploadResponse = await fetch(resolvedUploadUrl, {
      method: "PUT",
      headers: { "Content-Type": file.type || "application/octet-stream" },
      body: file,
    });
    if (!uploadResponse.ok) {
      setFileError("Upload failed.");
      setFilesLoading(false);
      return;
    }
    const complete = await completeTaskFile(activeTaskId, {
      storageKey,
      filename: file.name,
      contentType: file.type || "application/octet-stream",
      sizeBytes: file.size,
    });
    if (!complete.ok) {
      setFileError(complete.text || "Failed to finalize upload.");
      setFilesLoading(false);
      return;
    }
    const refreshed = await listTaskFiles(activeTaskId);
    if (refreshed.ok) {
      setFiles(refreshed.data ?? []);
    }
    setFilesLoading(false);
    event.target.value = "";
    await loadKanban();
  }

  async function handleDownload(file: TaskFile) {
    const result = await downloadTaskFile(file.id);
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
    const result = await deleteTaskFile(fileId);
    if (!result.ok) {
      setFileError(result.text || "Failed to delete file.");
      return;
    }
    if (activeTaskId) {
      const refreshed = await listTaskFiles(activeTaskId);
      if (refreshed.ok) {
        setFiles(refreshed.data ?? []);
      }
    }
    await loadKanban();
  }

  return (
    <section className={stylex(styles.panel)}>
      <div className={stylex(styles.header)}>
        <div className={stylex(styles.headerMeta)}>
          <h2>Tasks Kanban</h2>
          {kanban && (
            <span className={stylex(styles.metaText)}>
              Week of {formatDate(kanban.weekStart)} – {formatDate(kanban.weekEnd)}
            </span>
          )}
        </div>
        <button type="button" onClick={loadKanban} disabled={loading}>
          {loading ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      {error && <div className={stylex(styles.error)}>{error}</div>}
      {loading && !kanban && <p className={stylex(styles.metaText)}>Loading tasks...</p>}

      {kanban && (
        <div className={stylex(styles.board)}>
          {LANE_CONFIG.map((lane) => {
            const laneTasks = getLaneTasks(lane.key);
            return (
              <div
                key={lane.key}
                className={stylex(styles.lane)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={() => void handleDrop(lane.key, laneTasks.length)}
              >
                <div className={stylex(styles.laneHeader)}>
                  <span>{lane.label}</span>
                  <span>{laneTasks.length}</span>
                </div>
                <div className={stylex(styles.laneBody)}>
                  {laneTasks.length === 0 && (
                    <span className={stylex(styles.emptyLane)}>No tasks.</span>
                  )}
                  {laneTasks.map((task, index) => {
                    const overdue = isOverdue(task.due_at, kanban.weekStart);
                    return (
                      <div
                        key={task.id}
                        className={stylex(
                          styles.card,
                          dragState?.taskId === task.id && styles.cardDragging
                        )}
                        draggable
                        onDragStart={() => setDragState({ taskId: task.id, fromLane: lane.key })}
                        onDragEnd={() => setDragState(null)}
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          void handleDrop(lane.key, index);
                        }}
                        onClick={() => setActiveTaskId(task.id)}
                      >
                        <div className={stylex(styles.cardTitle)}>{task.title}</div>
                        <div className={stylex(styles.cardMeta)}>
                          <span>{formatDueDate(task.due_at)}</span>
                          {overdue && <span className={stylex(styles.badgeOverdue)}>Overdue</span>}
                          <span className={stylex(styles.badgePriority)}>
                            Priority {task.priority}
                          </span>
                          <span>{task.attachments_count ?? 0} files</span>
                        </div>
                        <div className={stylex(styles.cardActions)}>
                          <button
                            type="button"
                            className={stylex(styles.actionButton)}
                            onClick={(event) => {
                              event.stopPropagation();
                              void markDone(task);
                            }}
                          >
                            Mark done
                          </button>
                          <button
                            type="button"
                            className={stylex(styles.actionButton)}
                            onClick={(event) => {
                              event.stopPropagation();
                              void bumpTask(task, lane.key, "up");
                            }}
                          >
                            Priority ↑
                          </button>
                          <button
                            type="button"
                            className={stylex(styles.actionButton)}
                            onClick={(event) => {
                              event.stopPropagation();
                              void bumpTask(task, lane.key, "down");
                            }}
                          >
                            Priority ↓
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {activeTask && (
        <>
          <div className={stylex(styles.drawerOverlay)} onClick={() => setActiveTaskId(null)} />
          <aside className={stylex(styles.drawer)}>
            <div className={stylex(styles.drawerHeader)}>
              <div>
                <div className={stylex(styles.drawerLabel)}>Task</div>
                <div className={stylex(styles.drawerTitle)}>{activeTask.title}</div>
              </div>
              <button type="button" onClick={() => setActiveTaskId(null)}>
                Close
              </button>
            </div>

            <section className={stylex(styles.drawerSection)}>
              <div className={stylex(styles.drawerLabel)}>Status</div>
              <div className={stylex(styles.drawerRow)}>
                <select
                  value={activeTask.status}
                  onChange={(event) => void handleStatusChange(activeTask.id, event.target.value)}
                >
                  {STATUS_OPTIONS.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>
                <span className={stylex(styles.metaText)}>
                  Due {formatDueDate(activeTask.due_at)}
                </span>
                <span className={stylex(styles.badgePriority)}>Priority {activeTask.priority}</span>
              </div>
            </section>

            <section className={stylex(styles.drawerSection)}>
              <div className={stylex(styles.drawerLabel)}>Details</div>
              <div className={stylex(styles.metaText)}>
                {activeTask.description || "No description."}
              </div>
              <div className={stylex(styles.drawerRow)}>
                <span className={stylex(styles.metaText)}>
                  Template ID: {activeTask.template_id || "—"}
                </span>
                <span className={stylex(styles.metaText)}>
                  Customer ID: {activeTask.customer_id || "—"}
                </span>
              </div>
            </section>

            <section className={stylex(styles.drawerSection)}>
              <div className={stylex(styles.drawerLabel)}>Notes</div>
              {notesLoading && <span className={stylex(styles.metaText)}>Loading notes...</span>}
              {noteError && <span className={stylex(styles.error)}>{noteError}</span>}
              <div className={stylex(styles.notesList)}>
                {notes.length === 0 && !notesLoading && (
                  <span className={stylex(styles.metaText)}>No notes yet.</span>
                )}
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
                className={stylex(styles.noteInput)}
                value={noteDraft}
                onChange={(event) => setNoteDraft(event.target.value)}
                placeholder="Add a note..."
              />
              <button type="button" onClick={() => void handleAddNote()}>
                Add note
              </button>
            </section>

            <section className={stylex(styles.drawerSection)}>
              <div className={stylex(styles.drawerLabel)}>Attachments</div>
              {filesLoading && <span className={stylex(styles.metaText)}>Loading files...</span>}
              {fileError && <span className={stylex(styles.error)}>{fileError}</span>}
              <div className={stylex(styles.notesList)}>
                {files.length === 0 && !filesLoading && (
                  <span className={stylex(styles.metaText)}>No files yet.</span>
                )}
                {files.map((file) => (
                  <div key={file.id} className={stylex(styles.fileRow)}>
                    <div className={stylex(styles.fileMeta)}>
                      <strong>{file.original_filename}</strong>
                      <span>{formatFileMeta(file)}</span>
                    </div>
                    <div className={stylex(styles.drawerRow)}>
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
      )}
    </section>
  );
}

function statusForLane(lane: LaneKey) {
  if (lane === "in_progress") return "in progress";
  if (lane === "blocked") return "blocked";
  if (lane === "canceled") return "canceled";
  return "scheduled";
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatDueDate(value: string | null) {
  if (!value) return "No due date";
  return new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function isOverdue(value: string | null, weekStart: string) {
  if (!value) return false;
  return new Date(value).getTime() < new Date(weekStart).getTime();
}

function formatFileMeta(file: TaskFile) {
  const sizeKb = Math.round(file.size_bytes / 1024);
  return `${sizeKb} KB · ${file.content_type}`;
}
