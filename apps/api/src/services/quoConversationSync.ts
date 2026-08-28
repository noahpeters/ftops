import type { Env } from "../lib/types";
import { decryptSecrets } from "../lib/crypto/secrets";
import { sanitizeExternalError } from "../lib/security";
import { nowISO } from "../lib/utils";
import { normalizePhone } from "./quo";
import { processQuoCallWebhook } from "./quoCallWebhook";

const DEFAULT_BASE_URL = "https://api.quo.com/v1";
const INITIAL_BACKFILL_DAYS = 90;
const OVERLAP_MINUTES = 5;
const CALL_TRANSCRIPT_LOOKBACK_HOURS = 24;
const MAX_PAGES = 100;

type JsonRecord = Record<string, unknown>;
type IntegrationRow = {
  id: string;
  workspace_id: string;
  secrets_key_id: string;
  secrets_ciphertext: string;
};
type Conversation = {
  id: string;
  phoneNumberId: string;
  participants: string[];
  name?: string | null;
};
type Message = {
  id: string;
  conversationId?: string;
  direction: string;
  text?: string | null;
  createdAt: string;
  updatedAt?: string;
  media?: Array<{ url?: string; type?: string }>;
};
type Call = {
  id: string;
  status: string;
  createdAt: string;
  raw: JsonRecord;
};
type ContactMatch = { id: string; customer_id: string; phone: string | null };

export async function syncAllQuoConversations(env: Env, scheduledAt = new Date()) {
  const integrations = await env.DB.prepare(
    `SELECT id,workspace_id,secrets_key_id,secrets_ciphertext FROM integrations
     WHERE provider='quo' AND environment='production' AND is_active=1`
  ).all<IntegrationRow>();
  for (const integration of integrations.results ?? []) {
    try {
      await syncQuoIntegrationConversations(env, integration, scheduledAt);
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "quo_conversation_sync_failed",
          workspace_id: integration.workspace_id,
          integration_id: integration.id,
          error: sanitizeExternalError(error, "quo_conversation_sync_failed"),
        })
      );
    }
  }
}

export async function syncQuoIntegrationConversations(
  env: Env,
  integration: IntegrationRow,
  scheduledAt = new Date(),
  options: { forceBackfill?: boolean } = {}
) {
  const attemptedAt = scheduledAt.toISOString();
  const checkpoint = await env.DB.prepare(
    `SELECT last_successful_sync_at FROM quo_conversation_sync_state WHERE integration_id=?`
  )
    .bind(integration.id)
    .first<{ last_successful_sync_at: string | null }>();
  const windowStart =
    checkpoint?.last_successful_sync_at && !options.forceBackfill
      ? new Date(
          Date.parse(checkpoint.last_successful_sync_at) - OVERLAP_MINUTES * 60_000
        ).toISOString()
      : new Date(scheduledAt.getTime() - INITIAL_BACKFILL_DAYS * 86_400_000).toISOString();
  const callWindowStart = new Date(
    Math.min(
      Date.parse(windowStart),
      scheduledAt.getTime() - CALL_TRANSCRIPT_LOOKBACK_HOURS * 3_600_000
    )
  ).toISOString();
  const now = nowISO();
  await env.DB.prepare(
    `INSERT INTO quo_conversation_sync_state
       (integration_id,workspace_id,last_attempt_at,created_at,updated_at)
     VALUES (?,?,?,?,?) ON CONFLICT(integration_id) DO UPDATE SET
       workspace_id=excluded.workspace_id,last_attempt_at=excluded.last_attempt_at,
       last_error=NULL,updated_at=excluded.updated_at`
  )
    .bind(integration.id, integration.workspace_id, attemptedAt, now, now)
    .run();

  try {
    const config = await configForIntegration(env, integration);
    const conversations = await listConversations(config, windowStart, attemptedAt);
    for (const conversation of conversations) {
      await syncConversation(
        env,
        integration,
        config,
        conversation,
        windowStart,
        callWindowStart,
        attemptedAt
      );
    }
    await env.DB.prepare(
      `UPDATE quo_conversation_sync_state SET last_successful_sync_at=?,last_error=NULL,updated_at=?
       WHERE integration_id=?`
    )
      .bind(attemptedAt, nowISO(), integration.id)
      .run();
    console.log(
      JSON.stringify({
        event: "quo_conversation_sync_succeeded",
        workspace_id: integration.workspace_id,
        integration_id: integration.id,
        conversation_count: conversations.length,
        window_start: windowStart,
        window_end: attemptedAt,
      })
    );
  } catch (error) {
    const message = sanitizeExternalError(error, "quo_conversation_sync_failed").slice(0, 500);
    await env.DB.prepare(
      `UPDATE quo_conversation_sync_state SET last_error=?,updated_at=? WHERE integration_id=?`
    )
      .bind(message, nowISO(), integration.id)
      .run();
    throw error;
  }
}

async function syncConversation(
  env: Env,
  integration: IntegrationRow,
  config: { apiKey: string; baseUrl: string },
  conversation: Conversation,
  windowStart: string,
  callWindowStart: string,
  windowEnd: string
) {
  if (!conversation.id || !conversation.phoneNumberId || !conversation.participants?.length) return;
  await syncConversationCalls(env, integration, config, conversation, callWindowStart, windowEnd);
  const messages = await listMessages(config, conversation, windowStart, windowEnd);
  if (!messages.length) return;
  const externalPhone = singleExternalPhone(conversation.participants);
  if (!externalPhone) {
    await recordIgnoredMessages(
      env,
      integration,
      conversation.id,
      messages,
      null,
      "group_conversation"
    );
    return;
  }

  const match = await findContactByPhone(env, integration.workspace_id, externalPhone);
  let customerId = match?.customer_id ?? null;
  let contactId = match?.id ?? null;
  let leadCreated = false;
  let leadReason = "meaningful_incoming_conversation";
  if (!customerId) {
    const qualification = qualifyConversation(conversation, messages, externalPhone);
    if (!qualification.ok) {
      await recordIgnoredMessages(
        env,
        integration,
        conversation.id,
        messages,
        externalPhone,
        qualification.reason
      );
      return;
    }
    const lead = await ensureLead(env, integration, conversation, messages, externalPhone);
    customerId = lead.customerId;
    contactId = lead.contactId;
    leadCreated = true;
    leadReason = qualification.reason;
  } else if (contactId) {
    await improvePlaceholderLeadName(
      env,
      integration.workspace_id,
      customerId,
      contactId,
      messages
    );
  }

  for (const message of messages.sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    if (!message.id || !message.createdAt) continue;
    const activityId = `quo-message:${message.id}`;
    const inserted = await insertMessageNote(env, {
      activityId,
      workspaceId: integration.workspace_id,
      customerId,
      conversationId: conversation.id,
      message,
      externalPhone,
    });
    await recordMessage(env, {
      integration,
      conversationId: conversation.id,
      message,
      externalPhone,
      outcome: leadCreated && inserted ? "lead_created" : "noted",
      reason: match ? "matched_contact_phone" : leadReason,
      customerId,
      contactId,
      activityId,
    });
  }
}

async function syncConversationCalls(
  env: Env,
  integration: IntegrationRow,
  config: { apiKey: string; baseUrl: string },
  conversation: Conversation,
  createdAfter: string,
  createdBefore: string
) {
  if (conversation.participants.length !== 1) return;
  const calls = await listCalls(config, conversation, createdAfter, createdBefore);
  for (const call of calls) {
    if (!call.id || call.status !== "completed") continue;
    const transcriptResponse = await quoGetOptional(
      config,
      `/call-transcripts/${encodeURIComponent(call.id)}`
    );
    if (!transcriptResponse) continue;
    const transcript = asRecord(transcriptResponse.data);
    if (!transcript) continue;
    await processQuoCallWebhook(env, {
      workspaceId: integration.workspace_id,
      integrationId: integration.id,
      eventId: `quo-transcript-sync:${call.id}`,
      body: {
        id: `quo-transcript-sync:${call.id}`,
        type: "call.transcript.completed",
        createdAt: string(transcript.createdAt) || call.createdAt,
        data: { object: { ...transcript, callId: string(transcript.callId) || call.id } },
      },
      receivedAt: string(transcript.createdAt) || call.createdAt,
      resolvedCall: call.raw,
      externalPhone: conversation.participants[0],
      retryUnresolvable: true,
    });
  }
}

async function listCalls(
  config: { apiKey: string; baseUrl: string },
  conversation: Conversation,
  createdAfter: string,
  createdBefore: string
) {
  const results: Call[] = [];
  let pageToken: string | null = null;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const query = new URLSearchParams({
      phoneNumberId: conversation.phoneNumberId,
      createdAfter,
      createdBefore,
      maxResults: "100",
    });
    query.append("participants", conversation.participants[0]);
    if (pageToken) query.set("pageToken", pageToken);
    const body = await quoGet(config, `/calls?${query.toString()}`);
    results.push(...array(body.data).map(toCall).filter(isPresent));
    pageToken = string(body.nextPageToken) || null;
    if (!pageToken) return results;
  }
  throw new Error("quo_call_pagination_limit");
}

async function listConversations(
  config: { apiKey: string; baseUrl: string },
  updatedAfter: string,
  updatedBefore: string
) {
  const results: Conversation[] = [];
  let pageToken: string | null = null;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const query = new URLSearchParams({ updatedAfter, updatedBefore, maxResults: "100" });
    if (pageToken) query.set("pageToken", pageToken);
    const body = await quoGet(config, `/conversations?${query.toString()}`);
    results.push(...array(body.data).map(toConversation).filter(isPresent));
    pageToken = string(body.nextPageToken) || null;
    if (!pageToken) return results;
  }
  throw new Error("quo_conversation_pagination_limit");
}

async function listMessages(
  config: { apiKey: string; baseUrl: string },
  conversation: Conversation,
  createdAfter: string,
  createdBefore: string
) {
  const results: Message[] = [];
  let pageToken: string | null = null;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const query = new URLSearchParams({
      phoneNumberId: conversation.phoneNumberId,
      createdAfter,
      createdBefore,
      maxResults: "100",
    });
    for (const participant of conversation.participants) query.append("participants", participant);
    if (pageToken) query.set("pageToken", pageToken);
    const body = await quoGet(config, `/messages?${query.toString()}`);
    results.push(
      ...array(body.data)
        .map(toMessage)
        .filter(isPresent)
        .filter((message) => !message.conversationId || message.conversationId === conversation.id)
    );
    pageToken = string(body.nextPageToken) || null;
    if (!pageToken) return results;
  }
  throw new Error("quo_message_pagination_limit");
}

async function quoGet(config: { apiKey: string; baseUrl: string }, path: string) {
  const response = await fetch(`${config.baseUrl}${path}`, {
    headers: { Authorization: config.apiKey },
  });
  if (!response.ok) throw new Error(`quo_http_${response.status}`);
  return asRecord(await response.json()) ?? {};
}

async function quoGetOptional(config: { apiKey: string; baseUrl: string }, path: string) {
  const response = await fetch(`${config.baseUrl}${path}`, {
    headers: { Authorization: config.apiKey },
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`quo_http_${response.status}`);
  return asRecord(await response.json()) ?? {};
}

async function configForIntegration(env: Env, integration: IntegrationRow) {
  const secrets = asRecord(
    JSON.parse(
      await decryptSecrets(env, integration.secrets_key_id, integration.secrets_ciphertext)
    )
  );
  const apiKey = string(secrets?.apiKey);
  if (!apiKey) throw new Error("quo_api_key_not_configured");
  return { apiKey, baseUrl: (env.QUO_API_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, "") };
}

async function findContactByPhone(env: Env, workspaceId: string, phone: string) {
  const contacts = await env.DB.prepare(
    `SELECT id,customer_id,phone FROM contacts WHERE workspace_id=? AND phone IS NOT NULL`
  )
    .bind(workspaceId)
    .all<ContactMatch>();
  return (
    (contacts.results ?? []).find((contact) => normalizePhone(contact.phone) === phone) ?? null
  );
}

function qualifyConversation(conversation: Conversation, messages: Message[], phone: string) {
  const incoming = messages.filter((message) => message.direction === "incoming");
  if (incoming.some(isMeaningfulMessage)) {
    return { ok: true as const, reason: "meaningful_incoming_conversation" };
  }
  if (
    !incoming.length &&
    usefulConversationName(conversation.name, phone) &&
    messages.some((message) => message.direction === "outgoing" && isMeaningfulMessage(message))
  ) {
    return { ok: true as const, reason: "meaningful_named_outgoing_conversation" };
  }
  if (!incoming.length) return { ok: false as const, reason: "outgoing_only_conversation" };
  return { ok: false as const, reason: "low_information_conversation" };
}

function isMeaningfulMessage(message: Message) {
  if (message.media?.length) return true;
  const text = string(message.text).replace(/\s+/g, " ").trim();
  if (
    !text ||
    /^(stop|unsubscribe|cancel|end|quit|wrong number|no|ok|okay|thanks|thank you)[.! ]*$/i.test(
      text
    )
  ) {
    return false;
  }
  if (/spam|scam|robocall|telemarket/i.test(text)) return false;
  const words = text.match(/[a-z0-9]+/gi) ?? [];
  return text.length >= 12 || words.length >= 3;
}

async function ensureLead(
  env: Env,
  integration: IntegrationRow,
  conversation: Conversation,
  messages: Message[],
  phone: string
) {
  const customerId = `quo-conversation:${conversation.id}`;
  const contactId = `quo-conversation-contact:${conversation.id}`;
  const name =
    usefulConversationName(conversation.name, phone) ||
    extractSenderName(messages) ||
    `Text ${formatPhone(phone)}`;
  const now = nowISO();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT OR IGNORE INTO customers
       (id,workspace_id,display_name,customer_type,status,lead_source,created_at,updated_at)
       VALUES (?,?,?,'person','lead','quo',?,?)`
    ).bind(customerId, integration.workspace_id, name, now, now),
    env.DB.prepare(
      `INSERT OR IGNORE INTO contacts
       (id,workspace_id,customer_id,display_name,phone,is_primary,status,created_at,updated_at)
       VALUES (?,?,?,?,?,1,'active',?,?)`
    ).bind(contactId, integration.workspace_id, customerId, name, phone, now, now),
    env.DB.prepare(`UPDATE customers SET primary_contact_id=? WHERE id=?`).bind(
      contactId,
      customerId
    ),
  ]);
  return { customerId, contactId };
}

async function improvePlaceholderLeadName(
  env: Env,
  workspaceId: string,
  customerId: string,
  contactId: string,
  messages: Message[]
) {
  const name = extractSenderName(messages);
  if (!name) return;
  const customer = await env.DB.prepare(
    `SELECT display_name,status,lead_source FROM customers WHERE id=? AND workspace_id=?`
  )
    .bind(customerId, workspaceId)
    .first<{ display_name: string; status: string; lead_source: string | null }>();
  if (
    !customer ||
    customer.status !== "lead" ||
    customer.lead_source !== "quo" ||
    !isPlaceholderName(customer.display_name)
  ) {
    return;
  }
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE customers SET display_name=?,updated_at=? WHERE id=? AND workspace_id=?`
    ).bind(name, nowISO(), customerId, workspaceId),
    env.DB.prepare(
      `UPDATE contacts SET display_name=?,updated_at=? WHERE id=? AND customer_id=? AND workspace_id=?`
    ).bind(name, nowISO(), contactId, customerId, workspaceId),
  ]);
}

function usefulConversationName(value: string | null | undefined, phone: string) {
  const name = string(value);
  if (!name || isPlaceholderName(name) || normalizePhone(name) === phone) return null;
  return name;
}

function isPlaceholderName(value: string) {
  return /^text\s+(?:\+?[\d(). -]{7,}|unknown)$/i.test(value.trim());
}

export function extractSenderName(messages: Message[]) {
  const patterns = [
    /\b(?:[Tt]his is|[Mm]y name is)\s+([A-Z][A-Za-z'’-]+(?:\s+[A-Z][A-Za-z'’-]+){1,3})(?=[,.!;]|\s+(?:and|from|with|i\b|we\b|calling\b|texting\b)|$)/,
    /\bI(?:'m| am)\s+([A-Z][A-Za-z'’-]+(?:\s+[A-Z][A-Za-z'’-]+){1,3})(?=[,.!;]|\s+(?:and|from|with|i\b|we\b|calling\b|texting\b)|$)/,
  ];
  for (const message of messages) {
    if (message.direction !== "incoming") continue;
    const text = string(message.text).replace(/\s+/g, " ");
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match?.[1]) return match[1].trim();
    }
  }
  return null;
}

async function insertMessageNote(
  env: Env,
  args: {
    activityId: string;
    workspaceId: string;
    customerId: string;
    conversationId: string;
    message: Message;
    externalPhone: string;
  }
) {
  const media = args.message.media ?? [];
  const body = [
    string(args.message.text) || null,
    ...media.map((item) =>
      string(item.url)
        ? `Attachment${string(item.type) ? ` (${string(item.type)})` : ""}: ${string(item.url)}`
        : null
    ),
    `Quo conversation ID: ${args.conversationId}.`,
    `Participant: ${formatPhone(args.externalPhone)}.`,
  ]
    .filter(Boolean)
    .join("\n\n");
  const result = await env.DB.prepare(
    `INSERT OR IGNORE INTO customer_activities
       (id,workspace_id,customer_id,activity_type,subject,body,source,external_entity_id,occurred_at,created_at,is_human_authored)
     VALUES (?,?,?,'note',?,?,'quo',?,?,?,0)`
  )
    .bind(
      args.activityId,
      args.workspaceId,
      args.customerId,
      `Quo ${args.message.direction} text`,
      body,
      args.message.id,
      args.message.createdAt,
      nowISO()
    )
    .run();
  return result.meta?.changes === 1;
}

async function recordIgnoredMessages(
  env: Env,
  integration: IntegrationRow,
  conversationId: string,
  messages: Message[],
  externalPhone: string | null,
  reason: string
) {
  for (const message of messages) {
    if (!message.id || !message.createdAt) continue;
    await recordMessage(env, {
      integration,
      conversationId,
      message,
      externalPhone,
      outcome: "ignored",
      reason,
      customerId: null,
      contactId: null,
      activityId: null,
    });
  }
}

async function recordMessage(
  env: Env,
  args: {
    integration: IntegrationRow;
    conversationId: string;
    message: Message;
    externalPhone: string | null;
    outcome: "noted" | "lead_created" | "ignored";
    reason: string;
    customerId: string | null;
    contactId: string | null;
    activityId: string | null;
  }
) {
  const now = nowISO();
  await env.DB.prepare(
    `INSERT INTO quo_message_ingestions
       (message_id,conversation_id,workspace_id,integration_id,direction,external_phone,
        outcome,reason,customer_id,contact_id,activity_id,message_created_at,processed_at,created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(message_id) DO UPDATE SET
       outcome=excluded.outcome,reason=excluded.reason,customer_id=excluded.customer_id,
       contact_id=excluded.contact_id,activity_id=excluded.activity_id,
       processed_at=excluded.processed_at`
  )
    .bind(
      args.message.id,
      args.conversationId,
      args.integration.workspace_id,
      args.integration.id,
      args.message.direction || "unknown",
      args.externalPhone,
      args.outcome,
      args.reason,
      args.customerId,
      args.contactId,
      args.activityId,
      args.message.createdAt,
      now,
      now
    )
    .run();
}

function singleExternalPhone(participants: string[]) {
  const normalized = [...new Set(participants.map(normalizePhone).filter(Boolean))];
  return normalized.length === 1 ? normalized[0] : null;
}

function toConversation(value: unknown): Conversation | null {
  const row = asRecord(value);
  const id = string(row?.id);
  const phoneNumberId = string(row?.phoneNumberId);
  const participants = array(row?.participants).map(string).filter(Boolean);
  return id && phoneNumberId && participants.length
    ? { id, phoneNumberId, participants, name: string(row?.name) || null }
    : null;
}

function toMessage(value: unknown): Message | null {
  const row = asRecord(value);
  const id = string(row?.id);
  const createdAt = string(row?.createdAt);
  if (!id || !createdAt) return null;
  return {
    id,
    conversationId: string(row?.conversationId) || undefined,
    direction: string(row?.direction) || "unknown",
    text: string(row?.text) || null,
    createdAt,
    updatedAt: string(row?.updatedAt) || undefined,
    media: array(row?.media).map((item) => {
      const media = asRecord(item);
      return { url: string(media?.url), type: string(media?.type) };
    }),
  };
}

function toCall(value: unknown): Call | null {
  const row = asRecord(value);
  if (!row) return null;
  const id = string(row?.id);
  const createdAt = string(row?.createdAt);
  if (!id || !createdAt) return null;
  return { id, status: string(row?.status), createdAt, raw: row };
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
function isPresent<T>(value: T | null): value is T {
  return value !== null;
}
