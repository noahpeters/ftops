import type { Env } from "../lib/types";
import { decryptSecrets } from "../lib/crypto/secrets";
import { nowISO } from "../lib/utils";
import { normalizePhone } from "./quo";

const MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const DEFAULT_BASE_URL = "https://api.quo.com/v1";
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
  const callId =
    eventType === "call.transcript.completed" ? string(call?.callId) : string(call?.id);
  const eventId = string(event?.id) || args.eventId;
  const receivedAt = string(event?.createdAt) || args.receivedAt || nowISO();
  const now = nowISO();

  const inserted = await env.DB.prepare(
    `INSERT INTO quo_call_ingestions
       (event_id,workspace_id,integration_id,call_id,outcome,received_at,created_at,updated_at)
     VALUES (?,?,?,?,'processing',?,?,?) ON CONFLICT(event_id) DO NOTHING`
  )
    .bind(eventId, args.workspaceId, args.integrationId, callId, receivedAt, now, now)
    .run();
  if (!inserted.meta || inserted.meta.changes !== 1) {
    const existing = await env.DB.prepare(
      `SELECT outcome FROM quo_call_ingestions WHERE event_id=?`
    )
      .bind(eventId)
      .first<{ outcome: string }>();
    if (!existing || existing.outcome !== "processing") return;
  }

  if (eventType === "call.transcript.completed" && call) {
    await processCallTranscript(env, args, eventId, call, callId, receivedAt);
    return;
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
  const name = callerName(call);
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

async function processCallTranscript(
  env: Env,
  args: { workspaceId: string; integrationId: string | null },
  eventId: string,
  transcript: JsonRecord,
  callId: string,
  receivedAt: string
) {
  if (!callId || !args.integrationId) {
    await finish(env, eventId, "ignored", "transcript_call_unresolvable", null, null, null, null);
    return;
  }
  const config = await quoConfig(env, args.integrationId, args.workspaceId);
  const callResponse = await quoGet(config, `/calls/${encodeURIComponent(callId)}`);
  const call = asRecord(callResponse.data);
  const externalPhone = singleExternalPhone(array(call?.participants));
  if (!call || !externalPhone) {
    await finish(env, eventId, "ignored", "transcript_call_unresolvable", null, null, null, null);
    return;
  }

  const dialogue = array(transcript.dialogue)
    .map((item) => asRecord(item))
    .filter((item): item is JsonRecord => Boolean(item));
  if (!dialogue.length) {
    await finish(env, eventId, "ignored", "empty_call_transcript", null, null, null, externalPhone);
    return;
  }
  const analysis = await analyzeTranscript(env, dialogue, externalPhone);
  if (
    !analysis.meaningful ||
    analysis.spam ||
    !analysis.name ||
    !analysis.summary ||
    analysis.confidence < 0.65
  ) {
    await finish(
      env,
      eventId,
      "ignored",
      analysis.spam ? "spam_call_transcript" : "unqualified_call_transcript",
      null,
      null,
      null,
      externalPhone
    );
    return;
  }

  const match = await findContactByPhone(env, args.workspaceId, externalPhone);
  const now = nowISO();
  const customerId = match?.customer_id || `quo-transcript-lead:${callId}`;
  const contactId = match?.id || `quo-transcript-contact:${callId}`;
  if (!match) {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT OR IGNORE INTO customers
         (id,workspace_id,display_name,customer_type,status,lead_source,created_at,updated_at)
         VALUES (?,?,?,'person','lead','quo',?,?)`
      ).bind(customerId, args.workspaceId, analysis.name, now, now),
      env.DB.prepare(
        `INSERT OR IGNORE INTO contacts
         (id,workspace_id,customer_id,display_name,phone,is_primary,status,created_at,updated_at)
         VALUES (?,?,?,?,?,1,'active',?,?)`
      ).bind(contactId, args.workspaceId, customerId, analysis.name, externalPhone, now, now),
      env.DB.prepare(`UPDATE customers SET primary_contact_id=? WHERE id=?`).bind(
        contactId,
        customerId
      ),
    ]);
  } else {
    await improvePlaceholderCallLeadName(
      env,
      args.workspaceId,
      customerId,
      contactId,
      analysis.name
    );
  }

  const activityId = `quo-call-transcript:${callId}`;
  const nextSteps = analysis.nextSteps.length
    ? `Next steps:\n${analysis.nextSteps.map((step) => `- ${step}`).join("\n")}`
    : null;
  const duration = number(transcript.duration);
  await env.DB.prepare(
    `INSERT OR IGNORE INTO customer_activities
       (id,workspace_id,customer_id,activity_type,subject,body,source,external_entity_id,occurred_at,created_at,is_human_authored)
     VALUES (?,?,?,'note',?,?,'quo',?,?,?,0)`
  )
    .bind(
      activityId,
      args.workspaceId,
      customerId,
      analysis.subject || `Quo call with ${analysis.name}`,
      [
        analysis.summary,
        nextSteps,
        duration ? `Call duration: ${Math.round(duration)} seconds.` : null,
        `Quo call ID: ${callId}.`,
      ]
        .filter(Boolean)
        .join("\n\n"),
      callId,
      string(call.completedAt) || string(transcript.createdAt) || receivedAt,
      now
    )
    .run();
  await finish(
    env,
    eventId,
    match ? "noted" : "lead_created",
    "meaningful_named_call_transcript",
    customerId,
    contactId,
    activityId,
    externalPhone
  );
}

async function analyzeTranscript(env: Env, dialogue: JsonRecord[], externalPhone: string) {
  if (!env.AI) throw new Error("quo_transcript_ai_unavailable");
  const transcript = dialogue
    .map(
      (line) =>
        `${normalizePhone(string(line.identifier)) === externalPhone ? "Potential customer" : "FTOPS"}: ${string(line.content)}`
    )
    .filter((line) => !line.endsWith(": "))
    .join("\n");
  const result = await env.AI.run(MODEL, {
    messages: [
      {
        role: "system",
        content:
          "Analyze a business phone-call transcript for a CRM. Identify the potential customer's own stated name, not the FTOPS team member's name and never a phone number. Mark meaningful true only when the call contains a genuine prospective or existing customer discussion, request, project, need, decision, appointment, estimate, or substantive voicemail. Mark spam true for sales solicitations, robocalls, scams, or irrelevant calls. Summarize the substantive customer context without inventing details or copying the transcript. Preserve project scope, dimensions, materials, budget, location, timing, questions, decisions, and commitments. Return JSON only as {name,meaningful,spam,subject,summary,nextSteps,confidence}. Use null for name if it is not stated confidently; nextSteps must be an array of strings.",
      },
      { role: "user", content: transcript.slice(0, 60_000) },
    ],
    response_format: { type: "json_object" },
    max_tokens: 1400,
    temperature: 0,
  });
  const raw = typeof result === "string" ? result : result.response;
  const parsed = asRecord(parseJson(string(raw))) ?? {};
  return {
    name: validPersonName(string(parsed.name)),
    meaningful: parsed.meaningful === true,
    spam: parsed.spam === true,
    subject: string(parsed.subject).slice(0, 200),
    summary: string(parsed.summary).slice(0, 4000),
    nextSteps: array(parsed.nextSteps).map(string).filter(Boolean).slice(0, 12),
    confidence: Math.max(0, Math.min(1, number(parsed.confidence) || 0)),
  };
}

async function quoConfig(env: Env, integrationId: string, workspaceId: string) {
  const row = await env.DB.prepare(
    `SELECT secrets_key_id,secrets_ciphertext FROM integrations
     WHERE id=? AND workspace_id=? AND provider='quo' AND is_active=1`
  )
    .bind(integrationId, workspaceId)
    .first<{ secrets_key_id: string; secrets_ciphertext: string }>();
  if (!row) throw new Error("quo_integration_not_found");
  const secrets = asRecord(
    parseJson(await decryptSecrets(env, row.secrets_key_id, row.secrets_ciphertext))
  );
  const apiKey = string(secrets?.apiKey);
  if (!apiKey) throw new Error("quo_api_key_not_configured");
  return { apiKey, baseUrl: (env.QUO_API_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, "") };
}

async function quoGet(config: { apiKey: string; baseUrl: string }, path: string) {
  const response = await fetch(`${config.baseUrl}${path}`, {
    headers: { Authorization: config.apiKey },
  });
  if (!response.ok) throw new Error(`quo_http_${response.status}`);
  return asRecord(await response.json()) ?? {};
}

async function improvePlaceholderCallLeadName(
  env: Env,
  workspaceId: string,
  customerId: string,
  contactId: string,
  name: string
) {
  const customer = await env.DB.prepare(
    `SELECT display_name,status,lead_source FROM customers WHERE id=? AND workspace_id=?`
  )
    .bind(customerId, workspaceId)
    .first<{ display_name: string; status: string; lead_source: string | null }>();
  if (
    !customer ||
    customer.status !== "lead" ||
    customer.lead_source !== "quo" ||
    !/^(?:caller|text)\s+[+\d(]/i.test(customer.display_name)
  ) {
    return;
  }
  await env.DB.batch([
    env.DB.prepare(`UPDATE customers SET display_name=?,updated_at=? WHERE id=?`).bind(
      name,
      nowISO(),
      customerId
    ),
    env.DB.prepare(`UPDATE contacts SET display_name=?,updated_at=? WHERE id=?`).bind(
      name,
      nowISO(),
      contactId
    ),
  ]);
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
  if (!name && (duration >= 15 || voicemailDuration >= 3)) {
    return { ok: false as const, reason: "awaiting_named_call_transcript" };
  }
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

function singleExternalPhone(values: unknown[]) {
  const phones = [...new Set(values.map(string).map(normalizePhone).filter(Boolean))];
  return phones.length === 1 ? phones[0] : null;
}

function validPersonName(value: string) {
  const name = value.replace(/\s+/g, " ").trim().slice(0, 120);
  if (
    !name ||
    name.length < 2 ||
    /\d/.test(name) ||
    /^(unknown|caller|customer|potential customer|not provided|n\/a|null)$/i.test(name)
  ) {
    return null;
  }
  return name;
}

function parseJson(value: string): unknown {
  if (!value) return null;
  const unfenced = value
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  try {
    return JSON.parse(unfenced);
  } catch {
    throw new Error("quo_transcript_ai_response_invalid");
  }
}

function formatPhone(phone: string) {
  return phone.startsWith("+1") && phone.length === 12
    ? `(${phone.slice(2, 5)}) ${phone.slice(5, 8)}-${phone.slice(8)}`
    : phone;
}

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : null;
}
function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
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
