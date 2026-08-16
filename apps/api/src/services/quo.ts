import type { Env, EventQueuePayload } from "../lib/types";
import { sanitizeExternalError } from "../lib/security";
import { nowISO } from "../lib/utils";

const SOURCE = "ftops";
const DEFAULT_BASE_URL = "https://api.quo.com/v1";
const MAX_ATTEMPTS = 12;

type SyncRow = {
  contact_id: string;
  workspace_id: string;
  customer_id: string;
  quo_contact_id: string | null;
  desired_action: "upsert";
  status: string;
  version: number;
  attempts: number;
};

type ContactRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  display_name: string;
  email: string | null;
  phone: string | null;
  role: string | null;
  status: string;
  customer_status: string;
  customer_display_name: string;
  company_name: string | null;
};

type QuoContact = { id: string; externalId?: string | null };

export async function enqueueQuoContactSync(
  env: Env,
  workspaceId: string,
  customerId: string,
  contactId: string
) {
  const desiredAction = await desiredActionForContact(env, contactId);
  if (!desiredAction) return;
  const now = nowISO();
  await env.DB.prepare(
    `INSERT INTO quo_contact_sync
       (contact_id,workspace_id,customer_id,desired_action,status,version,attempts,next_attempt_at,created_at,updated_at)
     VALUES (?,?,?,?, 'pending',1,0,?,?,?)
     ON CONFLICT(contact_id) DO UPDATE SET
       workspace_id=excluded.workspace_id, customer_id=excluded.customer_id,
       desired_action=excluded.desired_action, status='pending', version=version+1,
       attempts=0, next_attempt_at=excluded.next_attempt_at, last_error=NULL,
       updated_at=excluded.updated_at`
  )
    .bind(contactId, workspaceId, customerId, desiredAction, now, now, now)
    .run();
  const row = await env.DB.prepare(`SELECT version FROM quo_contact_sync WHERE contact_id=?`)
    .bind(contactId)
    .first<{ version: number }>();
  if (row) await sendSyncMessage(env, contactId, row.version);
}

export async function enqueueCustomerQuoSync(env: Env, workspaceId: string, customerId: string) {
  const contacts = await env.DB.prepare(
    `SELECT id FROM contacts WHERE workspace_id=? AND customer_id=?`
  )
    .bind(workspaceId, customerId)
    .all<{ id: string }>();
  await Promise.all(
    (contacts.results ?? []).map((contact) =>
      enqueueQuoContactSync(env, workspaceId, customerId, contact.id)
    )
  );
}

export async function processQuoContactSync(
  env: Env,
  payload: { contactId?: string; version?: number }
) {
  if (!payload.contactId || !Number.isInteger(payload.version)) return;
  const row = await env.DB.prepare(`SELECT * FROM quo_contact_sync WHERE contact_id=?`)
    .bind(payload.contactId)
    .first<SyncRow>();
  if (!row || row.version !== payload.version || row.status === "synced") return;

  const attemptedAt = nowISO();
  await env.DB.prepare(
    `UPDATE quo_contact_sync SET status='processing',last_attempt_at=?,updated_at=?
     WHERE contact_id=? AND version=?`
  )
    .bind(attemptedAt, attemptedAt, row.contact_id, row.version)
    .run();

  try {
    if (!env.QUO_API_KEY) throw new QuoError("quo_api_key_not_configured", 0, false);
    await upsertContact(env, row);
    const completedAt = nowISO();
    await env.DB.prepare(
      `UPDATE quo_contact_sync SET status='synced',attempts=0,next_attempt_at=NULL,
       last_error=NULL,last_synced_at=?,updated_at=? WHERE contact_id=? AND version=?`
    )
      .bind(completedAt, completedAt, row.contact_id, row.version)
      .run();
    log("quo_contact_sync_succeeded", row, { action: row.desired_action });
  } catch (error) {
    const attempts = row.attempts + 1;
    const retryable = !(error instanceof QuoError) || error.retryable;
    const shouldRetry = retryable && attempts < MAX_ATTEMPTS;
    const delaySeconds = retryDelaySeconds(attempts);
    const nextAttempt = shouldRetry
      ? new Date(Date.now() + delaySeconds * 1000).toISOString()
      : null;
    const message = sanitizeExternalError(error, "quo_sync_failed").slice(0, 500);
    await env.DB.prepare(
      `UPDATE quo_contact_sync SET status='failed',attempts=?,next_attempt_at=?,last_error=?,updated_at=?
       WHERE contact_id=? AND version=?`
    )
      .bind(attempts, nextAttempt, message, nowISO(), row.contact_id, row.version)
      .run();
    log("quo_contact_sync_failed", row, {
      action: row.desired_action,
      attempts,
      retryable: shouldRetry,
      error: message,
    });
    if (shouldRetry) await sendSyncMessage(env, row.contact_id, row.version, delaySeconds);
  }
}

export async function enqueueDueQuoSyncs(env: Env) {
  if (!env.QUO_API_KEY) return;
  const now = nowISO();
  const rows = await env.DB.prepare(
    `SELECT contact_id,version FROM quo_contact_sync
     WHERE (status='pending' OR (status='failed' AND next_attempt_at<=?))
     ORDER BY COALESCE(next_attempt_at,updated_at) ASC LIMIT 50`
  )
    .bind(now)
    .all<{ contact_id: string; version: number }>();
  for (const row of rows.results ?? []) await sendSyncMessage(env, row.contact_id, row.version);
}

async function desiredActionForContact(env: Env, contactId: string) {
  const row = await env.DB.prepare(`SELECT id FROM contacts WHERE id=?`)
    .bind(contactId)
    .first<{ id: string }>();
  if (!row) return null;
  return "upsert";
}

async function upsertContact(env: Env, row: SyncRow) {
  const contact = await loadContact(env, row.contact_id);
  if (!contact) throw new QuoError("ftops_contact_not_found", 0, false);
  const body = contactBody(contact);
  let quoId = row.quo_contact_id;
  if (!quoId) quoId = (await findByExternalId(env, row.contact_id))?.id ?? null;
  if (quoId) {
    const response = await quoRequest(
      env,
      `/contacts/${encodeURIComponent(quoId)}`,
      {
        method: "PATCH",
        body: JSON.stringify(body),
      },
      [404]
    );
    if (response.status === 404) {
      quoId = (await findByExternalId(env, row.contact_id))?.id ?? null;
      if (!quoId) quoId = await createContact(env, row.contact_id, body);
    } else {
      const result = (await response.json()) as { data: QuoContact };
      quoId = result.data.id;
    }
  } else {
    quoId = await createContact(env, row.contact_id, body);
  }
  await env.DB.prepare(
    `UPDATE quo_contact_sync SET quo_contact_id=? WHERE contact_id=? AND version=?`
  )
    .bind(quoId, row.contact_id, row.version)
    .run();
}

async function createContact(env: Env, externalId: string, defaultFields: object) {
  try {
    const response = await quoRequest(env, "/contacts", {
      method: "POST",
      body: JSON.stringify({ externalId, source: SOURCE, defaultFields }),
    });
    return ((await response.json()) as { data: QuoContact }).data.id;
  } catch (error) {
    if (error instanceof QuoError && error.status === 409) {
      const existing = await findByExternalId(env, externalId);
      if (existing) return existing.id;
    }
    throw error;
  }
}

async function findByExternalId(env: Env, externalId: string) {
  const query = new URLSearchParams({ maxResults: "50" });
  query.append("externalIds", externalId);
  query.append("sources", SOURCE);
  const response = await quoRequest(env, `/contacts?${query.toString()}`, { method: "GET" });
  const result = (await response.json()) as { data?: QuoContact[] };
  return result.data?.find((contact) => contact.externalId === externalId) ?? null;
}

async function loadContact(env: Env, contactId: string) {
  return await env.DB.prepare(
    `SELECT ct.id,ct.first_name,ct.last_name,ct.display_name,ct.email,ct.phone,ct.role,ct.status,
            c.status customer_status,c.display_name customer_display_name,c.company_name
     FROM contacts ct JOIN customers c ON c.id=ct.customer_id WHERE ct.id=?`
  )
    .bind(contactId)
    .first<ContactRow>();
}

export function contactBody(contact: ContactRow) {
  const inferred = splitDisplayName(contact.display_name);
  const phone = normalizePhone(contact.phone);
  return {
    firstName: contact.first_name || inferred.firstName,
    lastName: contact.last_name || inferred.lastName,
    company: contact.company_name || contact.customer_display_name,
    role: contact.role || undefined,
    emails: contact.email ? [{ name: "work", value: contact.email }] : [],
    phoneNumbers: phone ? [{ name: "primary", value: phone }] : [],
  };
}

export function normalizePhone(value: string | null) {
  if (!value) return null;
  const trimmed = value.trim();
  if (trimmed.startsWith("+")) {
    const digits = trimmed.slice(1).replace(/\D/g, "");
    return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  }
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

function splitDisplayName(value: string) {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  return { firstName: parts.shift() || value, lastName: parts.join(" ") || undefined };
}

async function quoRequest(
  env: Env,
  path: string,
  init: RequestInit,
  allowedStatuses: number[] = []
) {
  const response = await fetch(
    `${(env.QUO_API_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, "")}${path}`,
    {
      ...init,
      headers: {
        Authorization: env.QUO_API_KEY || "",
        ...(init.body ? { "Content-Type": "application/json" } : {}),
      },
    }
  );
  if (response.ok || allowedStatuses.includes(response.status)) return response;
  const detail = (await response.text()).slice(0, 300);
  throw new QuoError(
    `quo_http_${response.status}${detail ? `: ${detail}` : ""}`,
    response.status,
    response.status === 408 || response.status === 429 || response.status >= 500
  );
}

async function sendSyncMessage(
  env: Env,
  contactId: string,
  version: number,
  delaySeconds?: number
) {
  if (!env.EVENT_QUEUE) return;
  const message: EventQueuePayload = {
    source: "ftops",
    type: "quo.contact.sync",
    externalId: contactId,
    idempotencyKey: `quo:${contactId}:${version}:${crypto.randomUUID()}`,
    payload: { contactId, version },
    receivedAt: nowISO(),
  };
  try {
    await env.EVENT_QUEUE.send(message, delaySeconds ? { delaySeconds } : undefined);
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "quo_contact_sync_enqueue_failed",
        contactId,
        version,
        error: sanitizeExternalError(error, "queue_send_failed"),
      })
    );
  }
}

function retryDelaySeconds(attempt: number) {
  return Math.min(3600, 15 * 2 ** Math.max(0, attempt - 1));
}

function log(event: string, row: SyncRow, fields: Record<string, unknown>) {
  console.log(
    JSON.stringify({
      event,
      contactId: row.contact_id,
      customerId: row.customer_id,
      workspaceId: row.workspace_id,
      version: row.version,
      ...fields,
    })
  );
}

class QuoError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryable: boolean
  ) {
    super(message);
  }
}
