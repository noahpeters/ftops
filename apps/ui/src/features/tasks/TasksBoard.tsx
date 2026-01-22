"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import stylex from "~/lib/stylex";
import { colors, radius, spacing } from "../../theme/tokens.stylex";
import {
  fetchKanban,
  listWorkspaceUsers,
  updateTask,
  type KanbanResponse,
  type TaskRow,
  type WorkspaceUser,
} from "./api";
import { TaskDetailDrawer } from "./TaskDetailDrawer";
import { listProjects, type ProjectRow } from "../projects/api";

type LaneKey = "scheduled" | "blocked" | "in progress" | "done" | "canceled";

const LANE_CONFIG: Array<{ key: LaneKey; label: string }> = [
  { key: "scheduled", label: "Scheduled" },
  { key: "in progress", label: "In Progress" },
  { key: "blocked", label: "Blocked" },
  { key: "done", label: "Done" },
  { key: "canceled", label: "Canceled" },
];

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
  sectionLabel: {
    fontSize: "12px",
    lineHeight: "1.4",
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    color: colors.textSubtle,
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
  badgeDue: {
    backgroundColor: colors.infoBg,
    color: colors.infoText,
    borderRadius: radius.sm,
    padding: "2px 6px",
    fontSize: "11px",
    fontWeight: 600,
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
});

export function TasksBoard({ workspaceId }: { workspaceId: string | null }): JSX.Element {
  const [kanban, setKanban] = useState<KanbanResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragState, setDragState] = useState<{ taskId: string; fromLane: LaneKey } | null>(null);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [users, setUsers] = useState<WorkspaceUser[]>([]);
  const [projects, setProjects] = useState<ProjectRow[]>([]);

  const loadKanban = useCallback(async () => {
    if (!workspaceId) {
      setKanban(null);
      setError("Select a workspace to view tasks.");
      return;
    }
    setLoading(true);
    setError(null);
    const result = await fetchKanban(workspaceId);
    if (!result.ok) {
      setError(result.text || "Failed to load tasks.");
      setKanban(null);
    } else {
      setKanban(result.data);
    }
    setLoading(false);
  }, [workspaceId]);

  useEffect(() => {
    void loadKanban();
  }, [loadKanban]);

  useEffect(() => {
    if (!workspaceId) {
      setUsers([]);
      return;
    }
    void (async () => {
      const result = await listWorkspaceUsers(workspaceId);
      if (result.ok) {
        setUsers(result.data ?? []);
      } else {
        setUsers([]);
      }
    })();
  }, [workspaceId]);

  useEffect(() => {
    if (!workspaceId) {
      setProjects([]);
      return;
    }
    void (async () => {
      const result = await listProjects(workspaceId);
      if (result.ok) {
        setProjects(result.data ?? []);
      }
    })();
  }, [workspaceId]);

  const activeTask = useMemo(() => {
    if (!activeTaskId || !kanban) return null;
    const lanes = [
      kanban.scheduled,
      kanban.in_progress,
      kanban.blocked,
      kanban.done,
      kanban.canceled,
    ];
    for (const lane of lanes) {
      const task = lane.find((item) => item.id === activeTaskId);
      if (task) return task;
    }
    return null;
  }, [activeTaskId, kanban]);

  const scheduledGroups = useMemo(() => {
    if (!kanban) {
      return { overdue: [], due: [], rest: [] } as {
        overdue: TaskRow[];
        due: TaskRow[];
        rest: TaskRow[];
      };
    }
    const overdueIds = new Set(kanban.overdue.map((task) => task.id));
    const dueIds = new Set(kanban.due_this_week.map((task) => task.id));
    const overdue = kanban.scheduled.filter((task) => overdueIds.has(task.id));
    const due = kanban.scheduled.filter((task) => dueIds.has(task.id));
    const rest = kanban.scheduled.filter(
      (task) => !overdueIds.has(task.id) && !dueIds.has(task.id)
    );
    return { overdue, due, rest };
  }, [kanban]);

  const scheduledIndex = useMemo(() => {
    const map = new Map<string, number>();
    if (kanban) {
      kanban.scheduled.forEach((task, index) => {
        map.set(task.id, index);
      });
    }
    return map;
  }, [kanban]);

  function laneTasks(lane: LaneKey) {
    if (!kanban) return [];
    if (lane === "scheduled") return kanban.scheduled;
    if (lane === "in progress") return kanban.in_progress;
    if (lane === "blocked") return kanban.blocked;
    if (lane === "done") return kanban.done;
    return kanban.canceled;
  }

  async function updateLanePriorities(lane: LaneKey, tasks: TaskRow[], statusOverride?: string) {
    const base = 1000;
    const step = 10;
    const reindexed = tasks.map((task, index) => ({
      ...task,
      priority: base - index * step,
      status: statusOverride ?? task.status,
    }));
    setKanban((prev) => {
      if (!prev) return prev;
      if (lane === "scheduled") {
        return { ...prev, scheduled: reindexed };
      }
      if (lane === "in progress") {
        return { ...prev, in_progress: reindexed };
      }
      if (lane === "blocked") {
        return { ...prev, blocked: reindexed };
      }
      if (lane === "done") {
        return { ...prev, done: reindexed };
      }
      return { ...prev, canceled: reindexed };
    });

    const updates = reindexed.map((task) =>
      updateTask(task.id, {
        priority: task.priority,
        status: task.status,
      })
    );
    const results = await Promise.all(updates);
    if (results.some((result) => !result.ok)) {
      await loadKanban();
    }
  }

  async function handleDrop(lane: LaneKey, targetIndex: number) {
    if (!dragState || !kanban) return;
    const { taskId, fromLane } = dragState;
    const fromTasks = [...laneTasks(fromLane)];
    const taskIndex = fromTasks.findIndex((task) => task.id === taskId);
    if (taskIndex === -1) return;
    const [moved] = fromTasks.splice(taskIndex, 1);
    const targetTasks = fromLane === lane ? fromTasks : [...laneTasks(lane)];
    const insertIndex =
      fromLane === lane && taskIndex < targetIndex ? Math.max(0, targetIndex - 1) : targetIndex;
    targetTasks.splice(insertIndex, 0, moved);

    setDragState(null);

    if (fromLane === lane) {
      await updateLanePriorities(lane, targetTasks, lane);
      return;
    }

    setKanban((prev) => {
      if (!prev) return prev;
      if (fromLane === "scheduled") {
        return { ...prev, scheduled: fromTasks };
      }
      if (fromLane === "in progress") {
        return { ...prev, in_progress: fromTasks };
      }
      if (fromLane === "blocked") {
        return { ...prev, blocked: fromTasks };
      }
      if (fromLane === "done") {
        return { ...prev, done: fromTasks };
      }
      return { ...prev, canceled: fromTasks };
    });

    await updateLanePriorities(lane, targetTasks, lane);
  }

  const userLookup = useMemo(() => {
    const map = new Map<string, WorkspaceUser>();
    users.forEach((user) => map.set(user.user_id, user));
    return map;
  }, [users]);

  const projectLookup = useMemo(() => {
    const map = new Map<string, ProjectRow>();
    projects.forEach((project) => map.set(project.id, project));
    return map;
  }, [projects]);

  return (
    <section className={stylex(styles.panel)}>
      <div className={stylex(styles.header)}>
        <div>
          <h2>Tasks</h2>
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
            const tasks = laneTasks(lane.key);
            return (
              <div
                key={lane.key}
                className={stylex(styles.lane)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={() => void handleDrop(lane.key, tasks.length)}
              >
                <div className={stylex(styles.laneHeader)}>
                  <span>{lane.label}</span>
                  <span>{tasks.length}</span>
                </div>
                <div className={stylex(styles.laneBody)}>
                  {lane.key === "scheduled" ? (
                    <>
                      <div className={stylex(styles.sectionLabel)}>Overdue</div>
                      {scheduledGroups.overdue.length === 0 && (
                        <span className={stylex(styles.emptyLane)}>No overdue tasks.</span>
                      )}
                      {scheduledGroups.overdue.map((task) => (
                        <TaskCard
                          key={task.id}
                          task={task}
                          dragging={dragState?.taskId === task.id}
                          onDragStart={() => setDragState({ taskId: task.id, fromLane: lane.key })}
                          onDragEnd={() => setDragState(null)}
                          onDrop={(index) => void handleDrop(lane.key, index)}
                          onClick={() => setActiveTaskId(task.id)}
                          badge="overdue"
                          index={scheduledIndex.get(task.id) ?? 0}
                          users={userLookup}
                          projects={projectLookup}
                        />
                      ))}
                      <div className={stylex(styles.sectionLabel)}>Due this week</div>
                      {scheduledGroups.due.length === 0 && (
                        <span className={stylex(styles.emptyLane)}>No tasks due this week.</span>
                      )}
                      {scheduledGroups.due.map((task) => (
                        <TaskCard
                          key={task.id}
                          task={task}
                          dragging={dragState?.taskId === task.id}
                          onDragStart={() => setDragState({ taskId: task.id, fromLane: lane.key })}
                          onDragEnd={() => setDragState(null)}
                          onDrop={(index) => void handleDrop(lane.key, index)}
                          onClick={() => setActiveTaskId(task.id)}
                          badge="due"
                          index={scheduledIndex.get(task.id) ?? 0}
                          users={userLookup}
                          projects={projectLookup}
                        />
                      ))}
                      <div className={stylex(styles.sectionLabel)}>Scheduled</div>
                      {scheduledGroups.rest.length === 0 && (
                        <span className={stylex(styles.emptyLane)}>No other scheduled tasks.</span>
                      )}
                      {scheduledGroups.rest.map((task) => (
                        <TaskCard
                          key={task.id}
                          task={task}
                          dragging={dragState?.taskId === task.id}
                          onDragStart={() => setDragState({ taskId: task.id, fromLane: lane.key })}
                          onDragEnd={() => setDragState(null)}
                          onDrop={(index) => void handleDrop(lane.key, index)}
                          onClick={() => setActiveTaskId(task.id)}
                          index={scheduledIndex.get(task.id) ?? 0}
                          users={userLookup}
                          projects={projectLookup}
                        />
                      ))}
                    </>
                  ) : (
                    <>
                      {tasks.length === 0 && (
                        <span className={stylex(styles.emptyLane)}>No tasks.</span>
                      )}
                      {tasks.map((task, index) => (
                        <TaskCard
                          key={task.id}
                          task={task}
                          dragging={dragState?.taskId === task.id}
                          onDragStart={() => setDragState({ taskId: task.id, fromLane: lane.key })}
                          onDragEnd={() => setDragState(null)}
                          onDrop={(dropIndex) => void handleDrop(lane.key, dropIndex)}
                          onClick={() => setActiveTaskId(task.id)}
                          index={index}
                          users={userLookup}
                          projects={projectLookup}
                        />
                      ))}
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {activeTask && (
        <TaskDetailDrawer
          task={activeTask}
          workspaceId={workspaceId}
          users={users}
          onClose={() => setActiveTaskId(null)}
          onUpdated={loadKanban}
        />
      )}
    </section>
  );
}

function TaskCard({
  task,
  dragging,
  onDragStart,
  onDragEnd,
  onDrop,
  onClick,
  badge,
  index,
  users,
  projects,
}: {
  task: TaskRow;
  dragging: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDrop: (index: number) => void;
  onClick: () => void;
  badge?: "overdue" | "due";
  index: number;
  users: Map<string, WorkspaceUser>;
  projects: Map<string, ProjectRow>;
}) {
  const assignedUser = task.assigned_to ? users.get(task.assigned_to) : null;
  const assignedLabel = assignedUser ? `${assignedUser.name} (${assignedUser.email})` : "—";
  const project = projects.get(task.project_id);
  const projectLabel = project?.title ?? task.project_id;
  return (
    <div
      className={stylex(styles.card, dragging && styles.cardDragging)}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onDrop(index);
      }}
      onClick={onClick}
    >
      <div className={stylex(styles.cardTitle)}>{task.title}</div>
      <div className={stylex(styles.cardMeta)}>
        <span>{formatDueDate(task.due_at)}</span>
        {badge === "overdue" && <span className={stylex(styles.badgeOverdue)}>Overdue</span>}
        {badge === "due" && <span className={stylex(styles.badgeDue)}>Due this week</span>}
        <span>Assigned: {assignedLabel}</span>
        <span>Project: {projectLabel}</span>
        <span>Template: {task.template_id ?? task.template_key}</span>
        <span>Notes: {task.notes_count ?? 0}</span>
        <span>Files: {task.attachments_count ?? 0}</span>
      </div>
    </div>
  );
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
