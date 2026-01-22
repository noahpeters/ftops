"use client";

import { useEffect, useMemo, useState } from "react";
import stylex from "~/lib/stylex";
import { colors, radius } from "../../theme/tokens.stylex";
import {
  addTaskNote,
  getProject,
  getProjectTasks,
  listProjects,
  listTaskNotes,
  patchTaskStatus,
  type ProjectRow,
  type TaskNote,
  type TaskRow,
} from "./api";

const STATUS_OPTIONS = ["scheduled", "in progress", "blocked", "done", "canceled"];

type ContextLookup = Record<string, { title?: string | null }>;

const styles = stylex.create({
  panel: {
    padding: "24px 32px",
  },
  layout: {
    display: "grid",
    gridTemplateColumns: "280px 1fr",
    gap: "16px",
  },
  sidebar: {
    border: `1px solid ${colors.border}`,
    borderRadius: radius.md,
    padding: "12px",
    backgroundColor: colors.surface,
    display: "flex",
    flexDirection: "column",
    gap: "12px",
  },
  actions: {
    display: "flex",
    gap: "8px",
  },
  error: {
    color: colors.errorText,
  },
  list: {
    listStyle: "none",
    padding: 0,
    margin: 0,
    display: "flex",
    flexDirection: "column",
    gap: "8px",
  },
  listButton: {
    textAlign: "left",
    width: "100%",
    border: `1px solid ${colors.border}`,
    borderRadius: radius.sm,
    padding: "10px",
    backgroundColor: colors.surfaceAlt,
    cursor: "pointer",
    display: "flex",
    flexDirection: "column",
    gap: "4px",
  },
  listButtonActive: {
    borderColor: colors.accent,
    backgroundColor: colors.neutralBg,
  },
  muted: {
    color: colors.textSubtle,
  },
  detail: {
    border: `1px solid ${colors.border}`,
    borderRadius: radius.md,
    padding: "16px",
    backgroundColor: colors.surface,
    display: "flex",
    flexDirection: "column",
    gap: "12px",
  },
  projectHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "12px",
  },
  secondaryButton: {
    border: `1px solid ${colors.border}`,
    backgroundColor: colors.surface,
    color: colors.text,
    padding: "6px 10px",
    borderRadius: radius.sm,
    cursor: "pointer",
  },
  tasksSection: {
    display: "flex",
    flexDirection: "column",
    gap: "16px",
  },
  taskGroup: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
  },
  taskSubgroup: {
    border: `1px solid ${colors.border}`,
    borderRadius: radius.md,
    padding: "10px",
    backgroundColor: colors.surfaceAlt,
    display: "flex",
    flexDirection: "column",
    gap: "8px",
  },
  taskSubgroupTitle: {
    display: "flex",
    flexDirection: "column",
    gap: "4px",
  },
  taskRow: {
    border: `1px solid ${colors.border}`,
    borderRadius: radius.md,
    padding: "10px",
    backgroundColor: colors.surface,
    display: "flex",
    flexDirection: "column",
    gap: "10px",
  },
  taskMain: {
    display: "flex",
    justifyContent: "space-between",
    gap: "12px",
    flexWrap: "wrap",
  },
  taskMeta: {
    fontSize: "12px",
    color: colors.textMuted,
  },
  taskActions: {
    display: "flex",
    gap: "8px",
    alignItems: "center",
  },
  taskNotes: {
    borderTop: `1px solid ${colors.border}`,
    paddingTop: "10px",
    display: "flex",
    flexDirection: "column",
    gap: "8px",
  },
  noteRow: {
    border: `1px solid ${colors.border}`,
    borderRadius: "8px",
    padding: "8px",
    backgroundColor: colors.surfaceAlt,
  },
  noteMeta: {
    display: "flex",
    gap: "8px",
    fontSize: "12px",
    color: colors.textMuted,
  },
});

export function ProjectsPanel({
  workspaceId,
  selectedProjectId,
  onSelectProject,
  contextLookup,
}: {
  workspaceId: string | null;
  selectedProjectId: string | null;
  onSelectProject: (id: string | null) => void;
  contextLookup?: ContextLookup;
}): JSX.Element {
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [projectsError, setProjectsError] = useState<string | null>(null);

  const [project, setProject] = useState<ProjectRow | null>(null);
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [tasksLoading, setTasksLoading] = useState(false);
  const [tasksError, setTasksError] = useState<string | null>(null);

  const [expandedTasks, setExpandedTasks] = useState<Record<string, boolean>>({});
  const [notesByTask, setNotesByTask] = useState<Record<string, TaskNote[]>>({});
  const [notesLoading, setNotesLoading] = useState<Record<string, boolean>>({});
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  const [statusSaving, setStatusSaving] = useState<Record<string, boolean>>({});
  const [noteError, setNoteError] = useState<string | null>(null);

  useEffect(() => {
    void refreshProjects();
  }, [workspaceId]);

  useEffect(() => {
    if (!selectedProjectId) {
      setProject(null);
      setTasks([]);
      return;
    }
    void loadProject(selectedProjectId);
    void loadTasks(selectedProjectId);
  }, [selectedProjectId]);

  async function refreshProjects() {
    if (!workspaceId) {
      setProjects([]);
      setProjectsError("Select a workspace to view projects.");
      return;
    }
    setProjectsLoading(true);
    setProjectsError(null);
    const result = await listProjects(workspaceId);
    if (!result.ok) {
      setProjectsError(result.text || "Failed to load projects.");
    } else {
      setProjects(result.data ?? []);
    }
    setProjectsLoading(false);
  }

  async function loadProject(projectId: string) {
    const result = await getProject(projectId);
    if (result.ok) {
      setProject(result.data ?? null);
    }
  }

  async function loadTasks(projectId: string) {
    setTasksLoading(true);
    setTasksError(null);
    const result = await getProjectTasks(projectId);
    if (!result.ok) {
      setTasksError(result.text || "Failed to load tasks.");
      setTasks([]);
    } else {
      setTasks(result.data ?? []);
    }
    setTasksLoading(false);
  }

  async function handleStatusChange(taskId: string, nextStatus: string) {
    if (!selectedProjectId) return;
    setStatusSaving((prev) => ({ ...prev, [taskId]: true }));
    const result = await patchTaskStatus(taskId, nextStatus);
    if (result.ok) {
      await loadTasks(selectedProjectId);
    }
    setStatusSaving((prev) => ({ ...prev, [taskId]: false }));
  }

  async function toggleNotes(taskId: string) {
    setExpandedTasks((prev) => ({ ...prev, [taskId]: !prev[taskId] }));
    if (!notesByTask[taskId]) {
      setNotesLoading((prev) => ({ ...prev, [taskId]: true }));
      const result = await listTaskNotes(taskId);
      if (result.ok) {
        setNotesByTask((prev) => ({ ...prev, [taskId]: result.data ?? [] }));
      }
      setNotesLoading((prev) => ({ ...prev, [taskId]: false }));
    }
  }

  async function submitNote(taskId: string) {
    const body = noteDrafts[taskId]?.trim();
    if (!body) {
      setNoteError("Note body cannot be empty.");
      return;
    }
    setNoteError(null);
    const result = await addTaskNote(taskId, body);
    if (result.ok) {
      setNoteDrafts((prev) => ({ ...prev, [taskId]: "" }));
      const refreshed = await listTaskNotes(taskId);
      if (refreshed.ok) {
        setNotesByTask((prev) => ({ ...prev, [taskId]: refreshed.data ?? [] }));
      }
    } else {
      setNoteError(result.text || "Failed to add note.");
    }
  }

  const groupedTasks = useMemo(() => {
    const groups: Record<string, TaskRow[]> = {
      project: [],
      shared: [],
      deliverable: [],
    };
    tasks.forEach((task) => {
      groups[task.scope]?.push(task);
    });
    return groups;
  }, [tasks]);

  const deliverableGroups = useMemo(() => {
    const map = new Map<string, TaskRow[]>();
    groupedTasks.deliverable.forEach((task) => {
      const key = task.line_item_uri ?? "unknown";
      const list = map.get(key) ?? [];
      list.push(task);
      map.set(key, list);
    });
    return map;
  }, [groupedTasks.deliverable]);

  const sharedGroups = useMemo(() => {
    const map = new Map<string, TaskRow[]>();
    groupedTasks.shared.forEach((task) => {
      const key = task.group_key ?? "ungrouped";
      const list = map.get(key) ?? [];
      list.push(task);
      map.set(key, list);
    });
    return map;
  }, [groupedTasks.shared]);

  return (
    <section className={stylex(styles.panel)}>
      <h2>Projects</h2>
      <div className={stylex(styles.layout)}>
        <div className={stylex(styles.sidebar)}>
          <div className={stylex(styles.actions)}>
            <button type="button" onClick={refreshProjects} disabled={projectsLoading}>
              {projectsLoading ? "Loading..." : "Refresh"}
            </button>
          </div>
          {projectsError && <div className={stylex(styles.error)}>{projectsError}</div>}
          <ul className={stylex(styles.list)}>
            {projects.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className={stylex(
                    styles.listButton,
                    selectedProjectId === item.id && styles.listButtonActive
                  )}
                  onClick={() => onSelectProject(item.id)}
                >
                  <strong>{item.title}</strong>
                  <span>{item.status}</span>
                  <span className={stylex(styles.muted)}>{item.updated_at ?? item.created_at}</span>
                </button>
              </li>
            ))}
            {projects.length === 0 && !projectsLoading && (
              <li className={stylex(styles.muted)}>No projects yet.</li>
            )}
          </ul>
        </div>

        <div className={stylex(styles.detail)}>
          {!selectedProjectId && <p className={stylex(styles.muted)}>Select a project.</p>}
          {selectedProjectId && (
            <>
              <div className={stylex(styles.projectHeader)}>
                <div>
                  <h3>{project?.title ?? "Project"}</h3>
                  <p className={stylex(styles.muted)}>
                    Record: {project?.commercial_record_uri ?? "n/a"}
                  </p>
                </div>
                <button
                  type="button"
                  className={stylex(styles.secondaryButton)}
                  onClick={() => onSelectProject(null)}
                >
                  Back to list
                </button>
              </div>

              {tasksError && <div className={stylex(styles.error)}>{tasksError}</div>}
              {tasksLoading && <p className={stylex(styles.muted)}>Loading tasks...</p>}

              {!tasksLoading && (
                <div className={stylex(styles.tasksSection)}>
                  <TaskGroup
                    title="Project"
                    tasks={groupedTasks.project}
                    onStatusChange={handleStatusChange}
                    statusSaving={statusSaving}
                    onToggleNotes={toggleNotes}
                    expandedTasks={expandedTasks}
                    notesByTask={notesByTask}
                    notesLoading={notesLoading}
                    noteDrafts={noteDrafts}
                    setNoteDrafts={setNoteDrafts}
                    submitNote={submitNote}
                    noteError={noteError}
                  />

                  <TaskGroupCollection
                    title="Shared"
                    groups={sharedGroups}
                    contextLookup={contextLookup}
                    onStatusChange={handleStatusChange}
                    statusSaving={statusSaving}
                    onToggleNotes={toggleNotes}
                    expandedTasks={expandedTasks}
                    notesByTask={notesByTask}
                    notesLoading={notesLoading}
                    noteDrafts={noteDrafts}
                    setNoteDrafts={setNoteDrafts}
                    submitNote={submitNote}
                    noteError={noteError}
                  />

                  <TaskGroupCollection
                    title="Deliverable"
                    groups={deliverableGroups}
                    contextLookup={contextLookup}
                    onStatusChange={handleStatusChange}
                    statusSaving={statusSaving}
                    onToggleNotes={toggleNotes}
                    expandedTasks={expandedTasks}
                    notesByTask={notesByTask}
                    notesLoading={notesLoading}
                    noteDrafts={noteDrafts}
                    setNoteDrafts={setNoteDrafts}
                    submitNote={submitNote}
                    noteError={noteError}
                  />
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  );
}

function TaskGroup({
  title,
  tasks,
  onStatusChange,
  statusSaving,
  onToggleNotes,
  expandedTasks,
  notesByTask,
  notesLoading,
  noteDrafts,
  setNoteDrafts,
  submitNote,
  noteError,
}: {
  title: string;
  tasks: TaskRow[];
  onStatusChange: (taskId: string, status: string) => void;
  statusSaving: Record<string, boolean>;
  onToggleNotes: (taskId: string) => void;
  expandedTasks: Record<string, boolean>;
  notesByTask: Record<string, TaskNote[]>;
  notesLoading: Record<string, boolean>;
  noteDrafts: Record<string, string>;
  setNoteDrafts: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  submitNote: (taskId: string) => void;
  noteError: string | null;
}) {
  if (!tasks.length) {
    return (
      <div className={stylex(styles.taskGroup)}>
        <h4>{title}</h4>
        <p className={stylex(styles.muted)}>No tasks.</p>
      </div>
    );
  }
  return (
    <div className={stylex(styles.taskGroup)}>
      <h4>{title}</h4>
      {tasks.map((task) => (
        <TaskRowView
          key={task.id}
          task={task}
          onStatusChange={onStatusChange}
          statusSaving={statusSaving}
          onToggleNotes={onToggleNotes}
          expandedTasks={expandedTasks}
          notesByTask={notesByTask}
          notesLoading={notesLoading}
          noteDrafts={noteDrafts}
          setNoteDrafts={setNoteDrafts}
          submitNote={submitNote}
          noteError={noteError}
        />
      ))}
    </div>
  );
}

function TaskGroupCollection({
  title,
  groups,
  contextLookup,
  ...taskProps
}: {
  title: string;
  groups: Map<string, TaskRow[]>;
  contextLookup?: ContextLookup;
  onStatusChange: (taskId: string, status: string) => void;
  statusSaving: Record<string, boolean>;
  onToggleNotes: (taskId: string) => void;
  expandedTasks: Record<string, boolean>;
  notesByTask: Record<string, TaskNote[]>;
  notesLoading: Record<string, boolean>;
  noteDrafts: Record<string, string>;
  setNoteDrafts: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  submitNote: (taskId: string) => void;
  noteError: string | null;
}) {
  return (
    <div className={stylex(styles.taskGroup)}>
      <h4>{title}</h4>
      {groups.size === 0 && <p className={stylex(styles.muted)}>No tasks.</p>}
      {Array.from(groups.entries()).map(([key, tasks]) => {
        const contextTitle = contextLookup?.[key]?.title;
        return (
          <div key={key} className={stylex(styles.taskSubgroup)}>
            <div className={stylex(styles.taskSubgroupTitle)}>
              <strong>{contextTitle ?? shorten(key)}</strong>
              {contextTitle && <span className={stylex(styles.muted)}>{shorten(key)}</span>}
            </div>
            {tasks.map((task) => (
              <TaskRowView key={task.id} task={task} {...taskProps} />
            ))}
          </div>
        );
      })}
    </div>
  );
}

function TaskRowView({
  task,
  onStatusChange,
  statusSaving,
  onToggleNotes,
  expandedTasks,
  notesByTask,
  notesLoading,
  noteDrafts,
  setNoteDrafts,
  submitNote,
  noteError,
}: {
  task: TaskRow;
  onStatusChange: (taskId: string, status: string) => void;
  statusSaving: Record<string, boolean>;
  onToggleNotes: (taskId: string) => void;
  expandedTasks: Record<string, boolean>;
  notesByTask: Record<string, TaskNote[]>;
  notesLoading: Record<string, boolean>;
  noteDrafts: Record<string, string>;
  setNoteDrafts: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  submitNote: (taskId: string) => void;
  noteError: string | null;
}) {
  const isExpanded = expandedTasks[task.id];
  const notes = notesByTask[task.id] ?? [];
  const isSaving = statusSaving[task.id];

  return (
    <div className={stylex(styles.taskRow)}>
      <div className={stylex(styles.taskMain)}>
        <div>
          <strong>{task.title}</strong>
          <div className={stylex(styles.taskMeta)}>
            <span>{task.template_key}</span>
          </div>
        </div>
        <div className={stylex(styles.taskActions)}>
          <select
            value={task.status}
            onChange={(event) => onStatusChange(task.id, event.target.value)}
            disabled={isSaving}
          >
            {STATUS_OPTIONS.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
          <button
            type="button"
            className={stylex(styles.secondaryButton)}
            onClick={() => onToggleNotes(task.id)}
          >
            {isExpanded ? "Hide notes" : "Notes"}
          </button>
        </div>
      </div>

      {isExpanded && (
        <div className={stylex(styles.taskNotes)}>
          {notesLoading[task.id] && <p className={stylex(styles.muted)}>Loading notes...</p>}
          {noteError && <div className={stylex(styles.error)}>{noteError}</div>}
          {notes.length === 0 && !notesLoading[task.id] && (
            <p className={stylex(styles.muted)}>No notes yet.</p>
          )}
          {notes.map((note) => (
            <div key={note.id} className={stylex(styles.noteRow)}>
              <div className={stylex(styles.noteMeta)}>
                <strong>{note.author_email}</strong>
                <span>{note.created_at}</span>
              </div>
              <p>{note.body}</p>
            </div>
          ))}
          <textarea
            value={noteDrafts[task.id] ?? ""}
            onChange={(event) =>
              setNoteDrafts((prev) => ({ ...prev, [task.id]: event.target.value }))
            }
            rows={3}
            placeholder="Add a note..."
          />
          <button type="button" onClick={() => submitNote(task.id)}>
            Add note
          </button>
        </div>
      )}
    </div>
  );
}

function shorten(value: string, max = 42) {
  if (value.length <= max) return value;
  return `${value.slice(0, 18)}…${value.slice(-12)}`;
}
