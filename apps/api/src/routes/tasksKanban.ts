import { DateTime } from "luxon";
import { json, methodNotAllowed } from "../lib/http";
import type { Env } from "../lib/types";

const LANE_KEYS = [
  "scheduled",
  "overdue",
  "due_this_week",
  "in_progress",
  "blocked",
  "done",
  "canceled",
] as const;
type LaneKey = (typeof LANE_KEYS)[number];

type TaskRow = {
  id: string;
  workspace_id: string;
  project_id: string;
  scope: string;
  group_key: string | null;
  line_item_uri: string | null;
  template_key: string;
  template_id: string | null;
  title: string;
  kind: string;
  description: string | null;
  position: number;
  status: string;
  state_json: string | null;
  due_at: string | null;
  completed_at: string | null;
  assigned_to: string | null;
  customer_id: string | null;
  created_at: string;
  updated_at: string;
  priority: number;
  attachments_count?: number;
  notes_count?: number;
};

type KanbanResponse = {
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

export async function handleTasksKanban(request: Request, env: Env, url: URL): Promise<Response> {
  if (request.method !== "GET") {
    return methodNotAllowed(["GET"]);
  }

  const scope = url.searchParams.get("scope") ?? "this_week";
  if (scope !== "this_week") {
    return json({ error: "unsupported_scope" }, 400);
  }

  const now = DateTime.now().setZone("America/Los_Angeles");
  const weekStart = now.minus({ days: now.weekday - 1 }).startOf("day");
  const weekEnd = weekStart
    .plus({ days: 6 })
    .set({ hour: 23, minute: 59, second: 59, millisecond: 0 });
  const fallbackIso = new Date().toISOString();
  const weekStartIso =
    weekStart.toISO({ suppressMilliseconds: true }) ?? weekStart.toISO() ?? fallbackIso;
  const weekEndIso =
    weekEnd.toISO({ suppressMilliseconds: true }) ?? weekEnd.toISO() ?? fallbackIso;

  const result = await env.DB.prepare(
    `SELECT tasks.*,
            (SELECT COUNT(1) FROM task_files WHERE task_files.task_id = tasks.id) as attachments_count,
            (SELECT COUNT(1) FROM task_notes WHERE task_notes.task_id = tasks.id) as notes_count
     FROM tasks
     WHERE status IN ('scheduled', 'blocked', 'in progress', 'done', 'canceled')
       AND (due_at IS NULL OR due_at <= ?)`
  )
    .bind(weekEndIso)
    .all<TaskRow>();

  const lanes: Record<LaneKey, TaskRow[]> = {
    scheduled: [],
    overdue: [],
    due_this_week: [],
    in_progress: [],
    blocked: [],
    done: [],
    canceled: [],
  };

  for (const task of result.results ?? []) {
    const dueAt = task.due_at
      ? DateTime.fromISO(task.due_at, { zone: "America/Los_Angeles" })
      : null;

    if (task.status === "done") {
      lanes.done.push(task);
      continue;
    }

    if (task.status === "in progress") {
      lanes.in_progress.push(task);
      continue;
    }

    if (task.status === "blocked") {
      lanes.blocked.push(task);
      continue;
    }

    if (task.status === "canceled") {
      lanes.canceled.push(task);
      continue;
    }

    if (task.status === "scheduled") {
      lanes.scheduled.push(task);
      if (dueAt && dueAt < weekStart) {
        lanes.overdue.push(task);
      } else if (dueAt && dueAt <= weekEnd) {
        lanes.due_this_week.push(task);
      }
    }
  }

  const sorted = Object.fromEntries(
    LANE_KEYS.map((lane) => [
      lane,
      [...lanes[lane]].sort((a, b) => {
        if (a.priority !== b.priority) {
          return b.priority - a.priority;
        }
        if (a.due_at && b.due_at) {
          return a.due_at.localeCompare(b.due_at);
        }
        if (a.due_at) return -1;
        if (b.due_at) return 1;
        return 0;
      }),
    ])
  ) as Record<LaneKey, TaskRow[]>;

  const payload: KanbanResponse = {
    weekStart: weekStartIso,
    weekEnd: weekEndIso,
    scheduled: sorted.scheduled,
    overdue: sorted.overdue,
    due_this_week: sorted.due_this_week,
    in_progress: sorted.in_progress,
    blocked: sorted.blocked,
    done: sorted.done,
    canceled: sorted.canceled,
  };

  return json(payload);
}
