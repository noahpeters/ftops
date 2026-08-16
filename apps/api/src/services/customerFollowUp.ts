import { DateTime } from "luxon";
import type { Env } from "../lib/types";

const ZONE = "America/Los_Angeles";
const MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

export type FollowUpGuidance = {
  type: "date" | "cadence" | "none";
  interpretedDate: string | null;
  cadence: Record<string, unknown> | null;
  confidence: number;
  explanation: string;
  model: string;
};

export type ComputedFollowUp = {
  next_follow_up_at: string | null;
  follow_up_urgency: "overdue" | "due_today" | "upcoming" | "none";
  follow_up_reason: string | null;
};

type CustomerFollowUpRow = {
  status?: unknown;
  created_at?: unknown;
  last_human_note_at?: unknown;
  guidance_type?: unknown;
  interpreted_date?: unknown;
  cadence_json?: unknown;
  guidance_explanation?: unknown;
};

export async function analyzeAndStoreFollowUpGuidance(
  env: Env,
  input: {
    workspaceId: string;
    customerId: string;
    noteId: string;
    subject: string;
    body: string | null;
    now: string;
  }
) {
  const text = [input.subject, input.body].filter(Boolean).join("\n\n");
  const guidance = await analyzeGuidance(env, text, input.now);
  await env.DB.prepare(
    `INSERT INTO customer_follow_up_guidance
       (customer_id,workspace_id,source_note_id,guidance_type,interpreted_date,cadence_json,confidence,explanation,model,analyzed_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(customer_id) DO UPDATE SET
       workspace_id=excluded.workspace_id,
       source_note_id=excluded.source_note_id,
       guidance_type=excluded.guidance_type,
       interpreted_date=excluded.interpreted_date,
       cadence_json=excluded.cadence_json,
       confidence=excluded.confidence,
       explanation=excluded.explanation,
       model=excluded.model,
       analyzed_at=excluded.analyzed_at
     WHERE excluded.analyzed_at >= customer_follow_up_guidance.analyzed_at`
  )
    .bind(
      input.customerId,
      input.workspaceId,
      input.noteId,
      guidance.type,
      guidance.interpretedDate,
      guidance.cadence ? JSON.stringify(guidance.cadence) : null,
      guidance.confidence,
      guidance.explanation,
      guidance.model,
      input.now
    )
    .run();
  return guidance;
}

export async function enqueueCustomerNoteFollowUpAnalysis(
  env: Env,
  input: { workspaceId: string; customerId: string; noteId: string; occurredAt: string }
) {
  await env.EVENT_QUEUE.send({
    source: "ftops",
    type: "customer.note.follow_up.analyze",
    externalId: input.noteId,
    idempotencyKey: `customer-note-follow-up/${input.noteId}`,
    payload: input,
    receivedAt: input.occurredAt,
  });
}

export async function enqueueMissingCustomerNoteFollowUps(env: Env) {
  const rows = await env.DB.prepare(
    `SELECT a.workspace_id,a.customer_id,a.id AS note_id,a.occurred_at
     FROM customer_activities a
     JOIN customers c ON c.id=a.customer_id AND c.workspace_id=a.workspace_id
     LEFT JOIN customer_follow_up_guidance g
       ON g.customer_id=a.customer_id AND g.workspace_id=a.workspace_id
     WHERE a.activity_type='note' AND a.is_human_authored=1 AND c.status!='archived'
       AND a.occurred_at=(
         SELECT MAX(latest.occurred_at) FROM customer_activities latest
         WHERE latest.workspace_id=a.workspace_id AND latest.customer_id=a.customer_id
           AND latest.activity_type='note' AND latest.is_human_authored=1
       )
       AND (g.source_note_id IS NULL OR g.source_note_id!=a.id)
     ORDER BY a.occurred_at ASC
     LIMIT 100`
  ).all<{
    workspace_id: string;
    customer_id: string;
    note_id: string;
    occurred_at: string;
  }>();
  for (const row of rows.results ?? []) {
    await enqueueCustomerNoteFollowUpAnalysis(env, {
      workspaceId: row.workspace_id,
      customerId: row.customer_id,
      noteId: row.note_id,
      occurredAt: row.occurred_at,
    });
  }
  return rows.results?.length ?? 0;
}

export async function processCustomerNoteFollowUpAnalysis(
  env: Env,
  payload: { workspaceId?: string; customerId?: string; noteId?: string }
) {
  if (!payload.workspaceId || !payload.customerId || !payload.noteId)
    throw new Error("customer_note_follow_up_payload_invalid");
  const note = await env.DB.prepare(
    `SELECT subject,body,occurred_at FROM customer_activities
     WHERE id=? AND workspace_id=? AND customer_id=?
       AND activity_type='note' AND is_human_authored=1`
  )
    .bind(payload.noteId, payload.workspaceId, payload.customerId)
    .first<{ subject: string; body: string | null; occurred_at: string }>();
  if (!note) throw new Error("customer_note_follow_up_note_not_found");
  return await analyzeAndStoreFollowUpGuidance(env, {
    workspaceId: payload.workspaceId,
    customerId: payload.customerId,
    noteId: payload.noteId,
    subject: note.subject,
    body: note.body,
    now: note.occurred_at,
  });
}

export function computeCustomerFollowUp(
  row: CustomerFollowUpRow,
  now = DateTime.now().setZone(ZONE)
): ComputedFollowUp {
  if (String(row.status) === "archived") {
    return { next_follow_up_at: null, follow_up_urgency: "none", follow_up_reason: null };
  }

  const guidanceDate = parseDate(row.interpreted_date);
  let next: DateTime;
  let reason: string;
  if ((row.guidance_type === "date" || row.guidance_type === "cadence") && guidanceDate) {
    next = guidanceDate;
    reason = String(row.guidance_explanation || "Follow-up timing requested in the latest note.");
  } else {
    const anchor = parseDate(row.last_human_note_at) || parseDate(row.created_at) || now;
    next = nextDefaultDate(String(row.status), anchor);
    reason =
      String(row.status) === "lead"
        ? "Default lead cadence: Tuesday and Friday."
        : "Default weekly Friday cadence.";
  }

  const today = now.startOf("day");
  const dueDay = next.setZone(ZONE).startOf("day");
  const urgency = dueDay < today ? "overdue" : dueDay.equals(today) ? "due_today" : "upcoming";
  return {
    next_follow_up_at: next.toUTC().toISO(),
    follow_up_urgency: urgency,
    follow_up_reason: reason,
  };
}

export function addComputedFollowUp<T extends CustomerFollowUpRow>(row: T, now?: DateTime) {
  return { ...row, ...computeCustomerFollowUp(row, now) };
}

async function analyzeGuidance(env: Env, text: string, now: string): Promise<FollowUpGuidance> {
  const deterministic = fallbackGuidance(text, now);
  if (env.AI) {
    try {
      const result = await env.AI.run(MODEL, {
        messages: [
          {
            role: "system",
            content:
              "Extract explicit future-contact guidance from a staff-written customer note. Return JSON only with type (date, cadence, or none), interpretedDate (ISO 8601 with timezone or null), cadence (object or null), confidence (0..1), and explanation. Do not infer a delay from ordinary project details. A cadence must include enough information to calculate its next occurrence.",
          },
          { role: "user", content: `Current time: ${now}\nTimezone: ${ZONE}\nNote:\n${text}` },
        ],
        response_format: { type: "json_object" },
        max_tokens: 300,
        temperature: 0,
      });
      const response = typeof result === "string" ? result : result.response;
      if (typeof response === "string") {
        const analyzed = normalizeGuidance(JSON.parse(response), MODEL);
        return deterministic.type !== "none" && analyzed.type === "none" ? deterministic : analyzed;
      }
    } catch (error) {
      console.warn("customer follow-up AI analysis failed", error);
    }
  }
  return deterministic;
}

function normalizeGuidance(value: unknown, model: string): FollowUpGuidance {
  const data = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const type = data.type === "date" || data.type === "cadence" ? data.type : "none";
  const interpretedDate = parseDate(data.interpretedDate)?.toUTC().toISO() || null;
  return {
    type: interpretedDate && type !== "none" ? type : "none",
    interpretedDate,
    cadence: type === "cadence" && isObject(data.cadence) ? data.cadence : null,
    confidence: clamp(Number(data.confidence) || 0),
    explanation: String(
      data.explanation ||
        (type === "none"
          ? "No explicit future-contact guidance."
          : "Future-contact guidance found.")
    ),
    model,
  };
}

function fallbackGuidance(text: string, nowIso: string): FollowUpGuidance {
  const lower = text.toLowerCase();
  const now = DateTime.fromISO(nowIso, { zone: ZONE });
  let date: DateTime | null = null;
  if (/\bnext month\b/.test(lower)) date = now.plus({ months: 1 }).startOf("month");
  const weeks = lower.match(/\bin\s+(\d+)\s+weeks?\b/);
  if (weeks) date = now.plus({ weeks: Number(weeks[1]) });
  if (/\bin two weeks\b/.test(lower)) date = now.plus({ weeks: 2 });
  if (/\btomorrow\b/.test(lower)) date = now.plus({ days: 1 });
  const weekday = lower.match(
    /\b(?:try\s+to\s+)?(?:contact|call|phone|follow\s+up|reach(?:\s+out)?)\b[^.!?\n]{0,50}\b(?:on\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/
  );
  if (weekday) date = nextWeekday(now, weekday[1]);
  const iso = date?.set({ hour: 9, minute: 0, second: 0, millisecond: 0 }).toUTC().toISO() || null;
  return {
    type: iso ? "date" : "none",
    interpretedDate: iso,
    cadence: null,
    confidence: iso ? 0.65 : 0,
    explanation: iso
      ? "Future-contact timing parsed from the latest note."
      : "No explicit future-contact guidance.",
    model: "deterministic-fallback",
  };
}

function nextWeekday(now: DateTime, weekdayName: string) {
  const weekdays: Record<string, number> = {
    monday: 1,
    tuesday: 2,
    wednesday: 3,
    thursday: 4,
    friday: 5,
    saturday: 6,
    sunday: 7,
  };
  const target = weekdays[weekdayName];
  let days = (target - now.weekday + 7) % 7;
  if (days === 0) days = 7;
  return now.plus({ days });
}

function nextDefaultDate(status: string, anchor: DateTime) {
  const local = anchor.setZone(ZONE);
  const targetDays = status === "lead" ? [2, 5] : [5];
  for (let offset = 1; offset <= 8; offset += 1) {
    const candidate = local.plus({ days: offset });
    if (!targetDays.includes(candidate.weekday)) continue;
    const adjusted = priorBusinessDay(candidate);
    if (adjusted.startOf("day") <= local.startOf("day")) continue;
    return adjusted.set({ hour: 9, minute: 0, second: 0, millisecond: 0 });
  }
  return priorBusinessDay(local.plus({ weeks: 1 })).set({
    hour: 9,
    minute: 0,
    second: 0,
    millisecond: 0,
  });
}

function priorBusinessDay(date: DateTime) {
  let candidate = date.startOf("day");
  while (candidate.weekday > 5 || isFederalHoliday(candidate))
    candidate = candidate.minus({ days: 1 });
  return candidate;
}

function isFederalHoliday(date: DateTime) {
  const holidays = federalHolidays(date.year);
  return holidays.has(date.toISODate() || "");
}

function federalHolidays(year: number) {
  const dates = [
    observed(DateTime.local(year, 1, 1, { zone: ZONE })),
    observed(DateTime.local(year + 1, 1, 1, { zone: ZONE })),
    nthWeekday(year, 1, 1, 3),
    nthWeekday(year, 2, 1, 3),
    lastWeekday(year, 5, 1),
    observed(DateTime.local(year, 6, 19, { zone: ZONE })),
    observed(DateTime.local(year, 7, 4, { zone: ZONE })),
    nthWeekday(year, 9, 1, 1),
    nthWeekday(year, 10, 1, 2),
    observed(DateTime.local(year, 11, 11, { zone: ZONE })),
    nthWeekday(year, 11, 4, 4),
    observed(DateTime.local(year, 12, 25, { zone: ZONE })),
  ];
  return new Set(dates.map((date) => date.toISODate() || ""));
}

function observed(date: DateTime) {
  return date.weekday === 6
    ? date.minus({ days: 1 })
    : date.weekday === 7
      ? date.plus({ days: 1 })
      : date;
}
function nthWeekday(year: number, month: number, weekday: number, nth: number) {
  let date = DateTime.local(year, month, 1, { zone: ZONE });
  while (date.weekday !== weekday) date = date.plus({ days: 1 });
  return date.plus({ weeks: nth - 1 });
}
function lastWeekday(year: number, month: number, weekday: number) {
  let date = DateTime.local(year, month, 1, { zone: ZONE }).endOf("month").startOf("day");
  while (date.weekday !== weekday) date = date.minus({ days: 1 });
  return date;
}
function parseDate(value: unknown) {
  if (typeof value !== "string" || !value) return null;
  const parsed = DateTime.fromISO(value, { setZone: true });
  return parsed.isValid ? parsed : null;
}
function clamp(value: number) {
  return Math.max(0, Math.min(1, value));
}
function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
