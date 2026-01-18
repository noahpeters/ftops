import { useEffect, useMemo, useState } from "react";
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

const STATUS_OPTIONS = ["todo", "doing", "blocked", "done", "canceled"];

type ContextLookup = Record<string, { title?: string | null }>;

export function ProjectsPanel({
  selectedProjectId,
  onSelectProject,
  contextLookup,
}: {
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
  }, []);

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
    setProjectsLoading(true);
    setProjectsError(null);
    const result = await listProjects();
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
    <section className="panel">
      <h2>Projects</h2>
      <div className="projects-layout">
        <div className="projects-sidebar">
          <div className="actions">
            <button type="button" onClick={refreshProjects} disabled={projectsLoading}>
              {projectsLoading ? "Loading..." : "Refresh"}
            </button>
          </div>
          {projectsError && <div className="error">{projectsError}</div>}
          <ul className="projects-list">
            {projects.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className={selectedProjectId === item.id ? "active" : ""}
                  onClick={() => onSelectProject(item.id)}
                >
                  <strong>{item.title}</strong>
                  <span>{item.status}</span>
                  <span className="muted">{item.updated_at ?? item.created_at}</span>
                </button>
              </li>
            ))}
            {projects.length === 0 && !projectsLoading && (
              <li className="muted">No projects yet.</li>
            )}
          </ul>
        </div>

        <div className="projects-detail">
          {!selectedProjectId && <p className="muted">Select a project.</p>}
          {selectedProjectId && (
            <>
              <div className="project-header">
                <div>
                  <h3>{project?.title ?? "Project"}</h3>
                  <p className="muted">Record: {project?.commercial_record_uri ?? "n/a"}</p>
                </div>
                <button type="button" className="secondary" onClick={() => onSelectProject(null)}>
                  Back to list
                </button>
              </div>

              {tasksError && <div className="error">{tasksError}</div>}
              {tasksLoading && <p className="muted">Loading tasks...</p>}

              {!tasksLoading && (
                <div className="tasks-section">
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
      <div className="task-group">
        <h4>{title}</h4>
        <p className="muted">No tasks.</p>
      </div>
    );
  }
  return (
    <div className="task-group">
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
    <div className="task-group">
      <h4>{title}</h4>
      {groups.size === 0 && <p className="muted">No tasks.</p>}
      {Array.from(groups.entries()).map(([key, tasks]) => {
        const contextTitle = contextLookup?.[key]?.title;
        return (
          <div key={key} className="task-subgroup">
            <div className="task-subgroup-title">
              <strong>{contextTitle ?? shorten(key)}</strong>
              {contextTitle && <span className="muted">{shorten(key)}</span>}
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
    <div className="task-row">
      <div className="task-main">
        <div>
          <strong>{task.title}</strong>
          <div className="task-meta">
            <span>{task.template_key}</span>
          </div>
        </div>
        <div className="task-actions">
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
          <button type="button" className="secondary" onClick={() => onToggleNotes(task.id)}>
            {isExpanded ? "Hide notes" : "Notes"}
          </button>
        </div>
      </div>

      {isExpanded && (
        <div className="task-notes">
          {notesLoading[task.id] && <p className="muted">Loading notes...</p>}
          {noteError && <div className="error">{noteError}</div>}
          {notes.length === 0 && !notesLoading[task.id] && <p className="muted">No notes yet.</p>}
          {notes.map((note) => (
            <div key={note.id} className="note-row">
              <div className="note-meta">
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
