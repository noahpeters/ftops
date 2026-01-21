import { DateTime } from "luxon";
import { json, methodNotAllowed } from "../lib/http";
import type { Env } from "../lib/types";

const LANE_KEYS = ["overdue", "due_this_week", "doing", "blocked", "canceled"] as const;
type LaneKey = (typeof LANE_KEYS)[number];

type TaskRow = {
  id: string;
  workspace_id: string;
  project_id: string;
  scope: string;
  group_key: string | null;
  line_item_uri: string | null;
  template_key: string;
  title: string;
  kind: string;
  position: number;
  status: string;
  state_json: string | null;
  due_at: string | null;
  assigned_to: string | null;
  created_at: string;
  updated_at: string;
  priority: number;
  attachments_count?: number;
};

type KanbanResponse = {
  weekStart: string;
  weekEnd: string;
  overdue: TaskRow[];
  due_this_week: TaskRow[];
  doing: TaskRow[];
  blocked: TaskRow[];
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
            (SELECT COUNT(1) FROM task_files WHERE task_files.task_id = tasks.id) as attachments_count
     FROM tasks
     WHERE status != 'done'
       AND (due_at IS NULL OR due_at <= ?)`
  )
    .bind(weekEndIso)
    .all<TaskRow>();

  const lanes: Record<LaneKey, TaskRow[]> = {
    overdue: [],
    due_this_week: [],
    doing: [],
    blocked: [],
    canceled: [],
  };

  for (const task of result.results ?? []) {
    const dueAt = task.due_at
      ? DateTime.fromISO(task.due_at, { zone: "America/Los_Angeles" })
      : null;

    if (dueAt && dueAt < weekStart) {
      lanes.overdue.push(task);
      continue;
    }

    if (dueAt && dueAt <= weekEnd) {
      lanes.due_this_week.push(task);
      continue;
    }

    if (task.status === "doing" || task.status === "blocked" || task.status === "canceled") {
      lanes[task.status as "doing" | "blocked" | "canceled"].push(task);
      continue;
    }

    if (task.status === "overdue") {
      lanes.overdue.push(task);
      continue;
    }

    lanes.due_this_week.push(task);
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
    overdue: sorted.overdue,
    due_this_week: sorted.due_this_week,
    doing: sorted.doing,
    blocked: sorted.blocked,
    canceled: sorted.canceled,
  };

  return json(payload);
}
