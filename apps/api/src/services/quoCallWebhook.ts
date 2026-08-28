import type { Env } from "../lib/types";
import { nowISO } from "../lib/utils";
import { normalizePhone } from "./quo";

type JsonRecord = Record<string, unknown>;
type ContactCandidate = { id: string; customer_id: string; phone: string | null };

export async function processQuoCallWebhook(
  env: Env,
  args: {
    workspaceId: string;
    integrationId: string | null;
    eventId: string;
    body: unknown;
    receivedAt?: string;
  }
) {
  const event = asRecord(args.body);
  const call = asRecord(asRecord(event?.data)?.object);
  const eventType = string(event?.type);
  const eventId = string(event?.id) || args.eventId;
  const receivedAt = string(event?.createdAt) || args.receivedAt || nowISO();
  const now = nowISO();

  const inserted = await env.DB.prepare(
    `INSERT INTO quo_call_ingestions
       (event_id,workspace_id,integration_id,call_id,outcome,received_at,created_at,updated_at)
     VALUES (?,?,?,?,'processing',?,?,?) ON CONFLICT(event_id) DO NOTHING`
  )
    .bind(eventId, args.workspaceId, args.integrationId, string(call?.id), receivedAt, now, now)
    .run();
  if (!inserted.meta || inserted.meta.changes !== 1) {
    const existing = await env.DB.prepare(
      `SELECT outcome FROM quo_call_ingestions WHERE event_id=?`
    )
      .bind(eventId)
      .first<{ outcome: string }>();
    if (!existing || existing.outcome !== "processing") return;
  }

  if (eventType !== "call.completed" || !call) {
    await finish(env, eventId, "ignored", "unsupported_event_type", null, null, null, null);
    return;
  }

  const direction = string(call.direction);
  const externalPhone = normalizePhone(
    direction === "outgoing" ? string(call.to) : string(call.from)
  );
  if (!externalPhone) {
    await finish(env, eventId, "ignored", "invalid_external_phone", null, null, null, null);
    return;
  }

  const match = await findContactByPhone(env, args.workspaceId, externalPhone);
  if (match) {
    const activityId = `quo-call:${eventId}`;
    await insertCallNote(env, {
      id: activityId,
      workspaceId: args.workspaceId,
      customerId: match.customer_id,
      eventId,
      call,
      phone: externalPhone,
      occurredAt: string(call.completedAt) || receivedAt,
    });
    await finish(
      env,
      eventId,
      "noted",
      "matched_contact_phone",
      match.customer_id,
      match.id,
      activityId,
      externalPhone
    );
    log("quo_call_noted", args, { eventId, customerId: match.customer_id, matched: true });
    return;
  }

  const qualification = qualifyNewLead(call, direction);
  if (!qualification.ok) {
    await finish(env, eventId, "ignored", qualification.reason, null, null, null, externalPhone);
    log("quo_call_ignored", args, { eventId, reason: qualification.reason });
    return;
  }

  const customerId = `quo-lead:${eventId}`;
  const contactId = `quo-contact:${eventId}`;
  const activityId = `quo-call:${eventId}`;
  const name = callerName(call) || `Caller ${formatPhone(externalPhone)}`;
  await env.DB.batch([
    env.DB.prepare(
      `INSERT OR IGNORE INTO customers
       (id,workspace_id,display_name,customer_type,status,lead_source,created_at,updated_at)
       VALUES (?,?,?,'person','lead','quo',?,?)`
    ).bind(customerId, args.workspaceId, name, now, now),
    env.DB.prepare(
      `INSERT OR IGNORE INTO contacts
       (id,workspace_id,customer_id,display_name,phone,is_primary,status,created_at,updated_at)
       VALUES (?,?,?,?,?,1,'active',?,?)`
    ).bind(contactId, args.workspaceId, customerId, name, externalPhone, now, now),
    env.DB.prepare(`UPDATE customers SET primary_contact_id=? WHERE id=?`).bind(
      contactId,
      customerId
    ),
  ]);
  await insertCallNote(env, {
    id: activityId,
    workspaceId: args.workspaceId,
    customerId,
    eventId,
    call,
    phone: externalPhone,
    occurredAt: string(call.completedAt) || receivedAt,
  });
  await finish(
    env,
    eventId,
    "lead_created",
    qualification.reason,
    customerId,
    contactId,
    activityId,
    externalPhone
  );
  log("quo_call_lead_created", args, { eventId, customerId, reason: qualification.reason });
}

async function findContactByPhone(env: Env, workspaceId: string, phone: string) {
  const rows = await env.DB.prepare(
    `SELECT id,customer_id,phone FROM contacts WHERE workspace_id=? AND phone IS NOT NULL`
  )
    .bind(workspaceId)
    .all<ContactCandidate>();
  return (rows.results ?? []).find((row) => normalizePhone(row.phone) === phone) ?? null;
}

function qualifyNewLead(call: JsonRecord, direction: string) {
  if (direction !== "incoming") return { ok: false as const, reason: "unmatched_outgoing_call" };
  const name = callerName(call);
  if (name && /spam|scam|telemarketer|robocall|unknown caller|potential spam/i.test(name)) {
    return { ok: false as const, reason: "spam_caller_label" };
  }
  const duration = callDurationSeconds(call);
  const voicemail = asRecord(call.voicemail);
  const voicemailDuration = number(voicemail?.duration) || 0;
  if (string(call.answeredAt) && duration >= 15) {
    return { ok: true as const, reason: "answered_call_15_seconds" };
  }
  if (voicemailDuration >= 3) {
    return { ok: true as const, reason: "voicemail_3_seconds" };
  }
  return { ok: false as const, reason: "low_information_call" };
}

async function insertCallNote(
  env: Env,
  args: {
    id: string;
    workspaceId: string;
    customerId: string;
    eventId: string;
    call: JsonRecord;
    phone: string;
    occurredAt: string;
  }
) {
  const direction = string(args.call.direction) || "unknown";
  const duration = callDurationSeconds(args.call);
  const voicemail = asRecord(args.call.voicemail);
  const lines = [
    `Quo ${direction} call with ${formatPhone(args.phone)}.`,
    `Status: ${string(args.call.status) || "completed"}.`,
    duration > 0 ? `Duration: ${duration} seconds.` : null,
    voicemail
      ? `Voicemail: ${number(voicemail.duration) || 0} seconds${string(voicemail.url) ? ` (${string(voicemail.url)})` : "."}`
      : null,
    string(args.call.id) ? `Quo call ID: ${string(args.call.id)}.` : null,
  ]
    .filter(Boolean)
    .join("\n");
  await env.DB.prepare(
    `INSERT OR IGNORE INTO customer_activities
       (id,workspace_id,customer_id,activity_type,subject,body,source,external_entity_id,occurred_at,created_at,is_human_authored)
     VALUES (?,?,?,'note',?,?, 'quo',?,?,?,0)`
  )
    .bind(
      args.id,
      args.workspaceId,
      args.customerId,
      `Quo ${direction} call`,
      lines,
      args.eventId,
      args.occurredAt,
      nowISO()
    )
    .run();
}

async function finish(
  env: Env,
  eventId: string,
  outcome: "noted" | "lead_created" | "ignored",
  reason: string,
  customerId: string | null,
  contactId: string | null,
  activityId: string | null,
  phone: string | null
) {
  const now = nowISO();
  await env.DB.prepare(
    `UPDATE quo_call_ingestions SET outcome=?,reason=?,customer_id=?,contact_id=?,activity_id=?,
       caller_phone=?,processed_at=?,updated_at=? WHERE event_id=?`
  )
    .bind(outcome, reason, customerId, contactId, activityId, phone, now, now, eventId)
    .run();
}

function callDurationSeconds(call: JsonRecord) {
  const started = Date.parse(string(call.answeredAt) || string(call.createdAt) || "");
  const completed = Date.parse(string(call.completedAt) || "");
  return Number.isFinite(started) && Number.isFinite(completed)
    ? Math.max(0, Math.round((completed - started) / 1000))
    : 0;
}

function callerName(call: JsonRecord) {
  const contact = asRecord(call.contact);
  return (
    string(call.callerName) ||
    string(call.name) ||
    string(contact?.name) ||
    string(contact?.displayName)
  );
}

function formatPhone(phone: string) {
  return phone.startsWith("+1") && phone.length === 12
    ? `(${phone.slice(2, 5)}) ${phone.slice(5, 8)}-${phone.slice(8)}`
    : phone;
}

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : null;
}
function string(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}
function number(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
function log(
  event: string,
  args: { workspaceId: string; integrationId: string | null },
  details: JsonRecord
) {
  console.log(
    JSON.stringify({
      event,
      workspace_id: args.workspaceId,
      integration_id: args.integrationId,
      ...details,
    })
  );
}
