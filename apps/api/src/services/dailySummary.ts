import { DateTime } from "luxon";
import type { Env } from "../lib/types";
import { addComputedFollowUp } from "./customerFollowUp";

const DEFAULT_TIMEZONE = "America/Los_Angeles";
const DEFAULT_EMAIL_API_URL = "https://api.resend.com/emails";

type SummaryUser = {
  workspace_id: string;
  workspace_name: string;
  user_id: string;
  name: string;
  email: string;
};

type DueTask = {
  id: string;
  title: string;
  due_at: string;
  description: string | null;
  customer_id: string | null;
  customer_name: string | null;
  project_id: string | null;
  project_name: string | null;
};

type DueCustomer = {
  id: string;
  display_name: string;
  next_follow_up_at: string;
  follow_up_urgency: "overdue" | "due_today" | "upcoming" | "none";
};

export type DailySummaryResult = {
  date: string;
  timezone: string;
  sent: number;
  skipped: number;
  failed: number;
};

export type ManualDailySummaryResult = {
  date: string;
  timezone: string;
  taskCount: number;
  customerCount: number;
  providerMessageId: string | null;
};

export async function sendDailySummaryForUser(
  env: Env,
  workspaceId: string,
  userId: string,
  requestedAt: Date = new Date(),
  fetcher: typeof fetch = fetch
): Promise<ManualDailySummaryResult | null> {
  const { timezone, localNow, summaryDate, start, end } = summaryWindow(env, requestedAt);
  const user = await env.DB.prepare(
    `SELECT u.workspace_id, w.name AS workspace_name, u.user_id, u.name, u.email
     FROM users u
     JOIN workspaces w ON w.id = u.workspace_id
     WHERE u.workspace_id=? AND u.user_id=? AND TRIM(u.email) != ''`
  )
    .bind(workspaceId, userId)
    .first<SummaryUser>();
  if (!user) return null;

  const [tasks, customers] = await Promise.all([
    loadDueTasks(env, user, start, end),
    loadDueCustomers(env, workspaceId, end, localNow),
  ]);
  const message = renderDailySummary(env, user, summaryDate, timezone, tasks, customers);
  const providerMessageId = await sendEmail(
    env,
    user,
    message,
    `manual-daily-summary/${workspaceId}/${userId}/${summaryDate}/${crypto.randomUUID()}`,
    fetcher
  );
  console.log(
    JSON.stringify({
      event: "manual_daily_summary_sent",
      workspaceId,
      userId,
      date: summaryDate,
      taskCount: tasks.length,
      customerCount: customers.length,
    })
  );
  return {
    date: summaryDate,
    timezone,
    taskCount: tasks.length,
    customerCount: customers.length,
    providerMessageId,
  };
}

export async function sendDailySummaries(
  env: Env,
  scheduledAt: Date,
  fetcher: typeof fetch = fetch
): Promise<DailySummaryResult> {
  const { timezone, localNow, summaryDate, start, end } = summaryWindow(env, scheduledAt);
  const result: DailySummaryResult = {
    date: summaryDate,
    timezone,
    sent: 0,
    skipped: 0,
    failed: 0,
  };

  // The trigger runs hourly so 7:00 remains correct through daylight-saving changes.
  if (localNow.hour !== 7) return result;

  const users = await env.DB.prepare(
    `SELECT u.workspace_id, w.name AS workspace_name, u.user_id, u.name, u.email
     FROM users u
     JOIN workspaces w ON w.id = u.workspace_id
     WHERE TRIM(u.email) != ''
     ORDER BY u.workspace_id, u.name, u.email`
  ).all<SummaryUser>();

  for (const user of users.results ?? []) {
    const delivered = await env.DB.prepare(
      `SELECT 1 AS found FROM daily_summary_deliveries
       WHERE workspace_id=? AND user_id=? AND summary_date=?`
    )
      .bind(user.workspace_id, user.user_id, summaryDate)
      .first();
    if (delivered) {
      result.skipped += 1;
      continue;
    }

    try {
      const [tasks, customers] = await Promise.all([
        loadDueTasks(env, user, start, end),
        loadDueCustomers(env, user.workspace_id, end, localNow),
      ]);
      const message = renderDailySummary(env, user, summaryDate, timezone, tasks, customers);
      const providerMessageId = await sendEmail(
        env,
        user,
        message,
        `daily-summary/${user.workspace_id}/${user.user_id}/${summaryDate}`,
        fetcher
      );
      await env.DB.prepare(
        `INSERT INTO daily_summary_deliveries
          (workspace_id,user_id,summary_date,provider_message_id,sent_at)
         VALUES (?,?,?,?,?)`
      )
        .bind(
          user.workspace_id,
          user.user_id,
          summaryDate,
          providerMessageId,
          new Date().toISOString()
        )
        .run();
      result.sent += 1;
    } catch (error) {
      result.failed += 1;
      console.error(
        JSON.stringify({
          event: "daily_summary_failed",
          workspaceId: user.workspace_id,
          userId: user.user_id,
          date: summaryDate,
          error: error instanceof Error ? error.message : "unknown_error",
        })
      );
    }
  }

  console.log(JSON.stringify({ event: "daily_summaries_complete", ...result }));
  if (result.failed > 0) throw new Error(`daily_summary_failures:${result.failed}`);
  return result;
}

async function loadDueTasks(env: Env, user: SummaryUser, start: string, end: string) {
  const rows = await env.DB.prepare(
    `SELECT t.id, t.title, t.due_at, t.description, t.customer_id,
            c.display_name AS customer_name, t.project_id, p.title AS project_name
     FROM tasks t
     LEFT JOIN customers c ON c.id = t.customer_id AND c.workspace_id = t.workspace_id
     LEFT JOIN projects p ON p.id = t.project_id AND p.workspace_id = t.workspace_id
     WHERE t.workspace_id=? AND t.assigned_to=?
       AND t.status NOT IN ('done','canceled')
       AND t.due_at>=? AND t.due_at<?
     ORDER BY t.due_at ASC, t.title ASC`
  )
    .bind(user.workspace_id, user.user_id, start, end)
    .all<DueTask>();
  return rows.results ?? [];
}

async function loadDueCustomers(env: Env, workspaceId: string, end: string, now: DateTime) {
  const rows = await env.DB.prepare(
    `SELECT c.id,c.display_name,c.status,c.created_at,
            (SELECT MAX(a.occurred_at) FROM customer_activities a
             WHERE a.workspace_id=c.workspace_id AND a.customer_id=c.id
               AND a.activity_type='note' AND a.is_human_authored=1) AS last_human_note_at,
            g.guidance_type,g.interpreted_date,g.cadence_json,g.explanation AS guidance_explanation
     FROM customers c
     LEFT JOIN customer_follow_up_guidance g ON g.customer_id=c.id AND g.workspace_id=c.workspace_id
     WHERE c.workspace_id=? AND c.status!='archived'
     ORDER BY c.display_name ASC`
  )
    .bind(workspaceId)
    .all<Record<string, unknown>>();
  return (rows.results ?? [])
    .map((row) => addComputedFollowUp(row, now))
    .filter(
      (row): row is typeof row & DueCustomer =>
        Boolean(row.next_follow_up_at) && String(row.next_follow_up_at) < end
    )
    .sort((a, b) => a.next_follow_up_at.localeCompare(b.next_follow_up_at));
}

function renderDailySummary(
  env: Env,
  user: SummaryUser,
  summaryDate: string,
  timezone: string,
  tasks: DueTask[],
  customers: DueCustomer[]
) {
  const appBaseUrl = (env.APP_BASE_URL || "https://ops.from-trees.com").replace(/\/$/, "");
  const dateLabel = DateTime.fromISO(summaryDate, { zone: timezone }).toLocaleString(
    DateTime.DATE_FULL
  );
  const taskText = tasks.length
    ? tasks
        .map((task) => {
          const context = task.customer_name || task.project_name;
          return `- ${task.title}${context ? ` — ${context}` : ""} (${formatTime(task.due_at, timezone)})`;
        })
        .join("\n")
    : "- No tasks assigned to you are due today.";
  const customerText = customers.length
    ? customers
        .map(
          (customer) =>
            `- ${customer.display_name} (${customer.follow_up_urgency === "overdue" ? "overdue · " : ""}${formatDateTime(customer.next_follow_up_at, timezone)})`
        )
        .join("\n")
    : "- No customer follow-ups are due or overdue.";

  const text = `Good morning, ${user.name}.\n\nFTOPS daily summary for ${dateLabel}\n\nTasks due today\n${taskText}\n\nCustomer follow-ups due or overdue\n${customerText}\n\nOpen FTOPS: ${appBaseUrl}/tasks`;
  const taskHtml = tasks.length
    ? `<ul>${tasks
        .map((task) => {
          const context = task.customer_name || task.project_name;
          return `<li><strong>${escapeHtml(task.title)}</strong>${
            context ? ` — ${escapeHtml(context)}` : ""
          } <span style="color:#6b6259">${escapeHtml(formatTime(task.due_at, timezone))}</span></li>`;
        })
        .join("")}</ul>`
    : "<p>No tasks assigned to you are due today.</p>";
  const customerHtml = customers.length
    ? `<ul>${customers
        .map(
          (customer) =>
            `<li><strong>${escapeHtml(customer.display_name)}</strong> <span style="color:#6b6259">${escapeHtml(
              `${customer.follow_up_urgency === "overdue" ? "overdue · " : ""}${formatDateTime(customer.next_follow_up_at, timezone)}`
            )}</span></li>`
        )
        .join("")}</ul>`
    : "<p>No customer follow-ups are due or overdue.</p>";
  const html = `<div style="font-family:Arial,sans-serif;max-width:680px;color:#2b251f;line-height:1.5"><p>Good morning, ${escapeHtml(
    user.name
  )}.</p><h1 style="font-size:24px">FTOPS daily summary</h1><p>${escapeHtml(
    dateLabel
  )} · ${escapeHtml(user.workspace_name)}</p><h2 style="font-size:18px">Tasks due today</h2>${taskHtml}<h2 style="font-size:18px">Customer follow-ups due or overdue</h2>${customerHtml}<p><a href="${escapeHtml(
    `${appBaseUrl}/tasks`
  )}">Open FTOPS tasks</a></p></div>`;
  return { subject: `FTOPS daily summary — ${dateLabel}`, text, html };
}

async function sendEmail(
  env: Env,
  user: SummaryUser,
  message: { subject: string; text: string; html: string },
  idempotencyKey: string,
  fetcher: typeof fetch
) {
  if (!env.RESEND_API_KEY) throw new Error("missing_resend_api_key");
  if (!env.DAILY_SUMMARY_FROM_EMAIL) throw new Error("missing_daily_summary_from_email");
  const from = env.DAILY_SUMMARY_FROM_NAME
    ? `${env.DAILY_SUMMARY_FROM_NAME} <${env.DAILY_SUMMARY_FROM_EMAIL}>`
    : env.DAILY_SUMMARY_FROM_EMAIL;
  const response = await fetcher(env.DAILY_SUMMARY_EMAIL_API_URL || DEFAULT_EMAIL_API_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.RESEND_API_KEY}`,
      "content-type": "application/json",
      "idempotency-key": idempotencyKey,
    },
    body: JSON.stringify({ from, to: [user.email], ...message }),
  });
  if (!response.ok) throw new Error(`daily_summary_email_http_${response.status}`);
  const body = (await response.json()) as { id?: string };
  return body.id ?? null;
}

function summaryWindow(env: Env, at: Date) {
  const timezone = env.DAILY_SUMMARY_TIMEZONE || DEFAULT_TIMEZONE;
  const localNow = DateTime.fromJSDate(at, { zone: "utc" }).setZone(timezone);
  if (!localNow.isValid) throw new Error("invalid_daily_summary_timezone");
  const summaryDate = localNow.toISODate();
  if (!summaryDate) throw new Error("invalid_daily_summary_date");
  const start = localNow.startOf("day").toUTC().toISO();
  const end = localNow.plus({ days: 1 }).startOf("day").toUTC().toISO();
  if (!start || !end) throw new Error("invalid_daily_summary_range");
  return { timezone, localNow, summaryDate, start, end };
}

function formatTime(value: string, timezone: string) {
  return DateTime.fromISO(value, { zone: "utc" })
    .setZone(timezone)
    .toLocaleString(DateTime.TIME_SIMPLE);
}

function formatDateTime(value: string, timezone: string) {
  return DateTime.fromISO(value, { zone: "utc" })
    .setZone(timezone)
    .toLocaleString(DateTime.DATETIME_MED);
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    };
    return entities[character];
  });
}
