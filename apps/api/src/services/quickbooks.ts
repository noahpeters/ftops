import { decryptSecrets, encryptSecrets } from "../lib/crypto/secrets";
import type { Env } from "../lib/types";
import { nowISO } from "../lib/utils";
import { exchangeRefreshToken, tokensWithExpiry, type QboSecrets } from "./quickbooksOAuth";
import { sanitizeExternalError } from "../lib/security";

type Integration = {
  id: string;
  workspace_id: string;
  environment: string;
  external_account_id: string;
  secrets_key_id: string;
  secrets_ciphertext: string;
  token_version?: number;
};

type QboEntity = Record<string, unknown> & {
  Id?: string;
  SyncToken?: string;
  DisplayName?: string;
  CompanyName?: string;
  Active?: boolean;
  DocNumber?: string;
  TxnDate?: string;
  DueDate?: string;
  ExpirationDate?: string;
  TotalAmt?: number;
  Balance?: number;
  CustomerRef?: { value?: string };
  MetaData?: { LastUpdatedTime?: string };
};

const ENTITY_KEYS = { customer: "Customer", estimate: "Estimate", invoice: "Invoice" } as const;

export async function getQboIntegration(env: Env, integrationId: string) {
  return await env.DB.prepare(
    `SELECT id, workspace_id, environment, external_account_id, secrets_key_id, secrets_ciphertext, token_version
     FROM integrations WHERE id = ? AND provider = 'qbo' AND is_active = 1`
  )
    .bind(integrationId)
    .first<Integration>();
}

async function qboRequest(
  env: Env,
  integration: Integration,
  path: string,
  init: RequestInit = {}
) {
  let secrets = await ensureAccessToken(env, integration, false);
  const defaultBase =
    integration.environment === "sandbox"
      ? "https://sandbox-quickbooks.api.intuit.com"
      : "https://quickbooks.api.intuit.com";
  const base = (secrets.apiBaseUrl || defaultBase).replace(/\/$/, "");
  const realmId = secrets.realmId || integration.external_account_id;
  const separator = path.includes("?") ? "&" : "?";
  const url = `${base}/v3/company/${encodeURIComponent(realmId)}${path}${separator}minorversion=${encodeURIComponent(secrets.minorVersion || "75")}`;
  let response = await authorizedFetch(url, init, secrets.accessToken!);
  if (response.status === 401) {
    secrets = await ensureAccessToken(env, integration, true);
    response = await authorizedFetch(url, init, secrets.accessToken!);
  }
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const error = new Error(`quickbooks_http_${response.status}`) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }
  return payload;
}

async function authorizedFetch(url: string, init: RequestInit, accessToken: string) {
  return await fetch(url, {
    ...init,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  });
}

export async function ensureAccessToken(
  env: Env,
  integration: Integration,
  force: boolean
): Promise<QboSecrets> {
  const current = await env.DB.prepare(
    `SELECT secrets_key_id,secrets_ciphertext,token_version FROM integrations WHERE id=? AND is_active=1`
  )
    .bind(integration.id)
    .first<{ secrets_key_id: string; secrets_ciphertext: string; token_version: number }>();
  if (!current) throw new Error("quickbooks_integration_not_found");
  const secrets = JSON.parse(
    await decryptSecrets(env, current.secrets_key_id, current.secrets_ciphertext)
  ) as QboSecrets;
  const expiresAt = secrets.accessTokenExpiresAt ? Date.parse(secrets.accessTokenExpiresAt) : 0;
  if (!force && secrets.accessToken && expiresAt > Date.now() + 5 * 60 * 1000) return secrets;
  if (!secrets.refreshToken) throw new Error("quickbooks_refresh_token_missing");
  try {
    const refreshed = tokensWithExpiry(
      await exchangeRefreshToken(env, secrets.refreshToken),
      secrets
    );
    const encrypted = await encryptSecrets(env, JSON.stringify(refreshed));
    const update = await env.DB.prepare(
      `UPDATE integrations SET secrets_key_id=?,secrets_ciphertext=?,token_version=token_version+1,connection_status='connected',connection_error=NULL,updated_at=? WHERE id=? AND token_version=?`
    )
      .bind(encrypted.keyId, encrypted.ciphertext, nowISO(), integration.id, current.token_version)
      .run();
    if (update.meta?.changes === 1) return refreshed;
    const winner = await env.DB.prepare(
      `SELECT secrets_key_id,secrets_ciphertext FROM integrations WHERE id=?`
    )
      .bind(integration.id)
      .first<{ secrets_key_id: string; secrets_ciphertext: string }>();
    if (!winner) throw new Error("quickbooks_integration_not_found");
    return JSON.parse(
      await decryptSecrets(env, winner.secrets_key_id, winner.secrets_ciphertext)
    ) as QboSecrets;
  } catch (error) {
    const latest = await env.DB.prepare(
      `SELECT secrets_key_id,secrets_ciphertext,token_version FROM integrations WHERE id=?`
    )
      .bind(integration.id)
      .first<{ secrets_key_id: string; secrets_ciphertext: string; token_version: number }>();
    if (latest && latest.token_version !== current.token_version) {
      return JSON.parse(
        await decryptSecrets(env, latest.secrets_key_id, latest.secrets_ciphertext)
      ) as QboSecrets;
    }
    const message = sanitizeExternalError(error, "quickbooks_refresh_failed");
    await env.DB.prepare(
      `UPDATE integrations SET connection_status='reconnect_required',connection_error=?,updated_at=? WHERE id=?`
    )
      .bind(message, nowISO(), integration.id)
      .run();
    throw error;
  }
}

export async function queryQboPage(
  env: Env,
  integration: Integration,
  entityType: keyof typeof ENTITY_KEYS,
  startPosition: number,
  maxResults = 100
) {
  const key = ENTITY_KEYS[entityType];
  const query = `select * from ${key} startposition ${startPosition} maxresults ${maxResults}`;
  const payload = await qboRequest(env, integration, `/query?query=${encodeURIComponent(query)}`);
  const response = payload.QueryResponse as Record<string, unknown> | undefined;
  return Array.isArray(response?.[key]) ? (response[key] as QboEntity[]) : [];
}

export async function fetchQboEntity(
  env: Env,
  integration: Integration,
  entityType: keyof typeof ENTITY_KEYS,
  externalId: string
): Promise<QboEntity> {
  const key = ENTITY_KEYS[entityType];
  const payload = await qboRequest(
    env,
    integration,
    `/${key.toLowerCase()}/${encodeURIComponent(externalId)}`
  );
  const entity = payload[key];
  if (!entity || typeof entity !== "object") throw new Error("quickbooks_entity_missing");
  return entity as QboEntity;
}

export async function searchQboCustomers(env: Env, integration: Integration, term: string) {
  const escaped = term.replace(/'/g, "\\'");
  const query = `select * from Customer where DisplayName like '%${escaped}%' maxresults 25`;
  const payload = await qboRequest(env, integration, `/query?query=${encodeURIComponent(query)}`);
  const queryResponse = payload.QueryResponse as { Customer?: QboEntity[] } | undefined;
  return (queryResponse?.Customer ?? []).map((customer) => ({
    id: customer.Id,
    displayName: customer.DisplayName,
    companyName: customer.CompanyName,
    email: readString(customer.PrimaryEmailAddr, "Address"),
    phone: readString(customer.PrimaryPhone, "FreeFormNumber"),
    syncToken: customer.SyncToken,
  }));
}

export async function createQboCustomer(
  env: Env,
  integration: Integration,
  input: {
    displayName: string;
    companyName?: string | null;
    email?: string | null;
    phone?: string | null;
  }
) {
  const payload = await qboRequest(env, integration, "/customer", {
    method: "POST",
    body: JSON.stringify({
      DisplayName: input.displayName,
      ...(input.companyName ? { CompanyName: input.companyName } : {}),
      ...(input.email ? { PrimaryEmailAddr: { Address: input.email } } : {}),
      ...(input.phone ? { PrimaryPhone: { FreeFormNumber: input.phone } } : {}),
    }),
  });
  if (!payload.Customer || typeof payload.Customer !== "object") {
    throw new Error("quickbooks_customer_create_missing");
  }
  return payload.Customer as QboEntity;
}

export async function syncQboEntity(
  env: Env,
  args: {
    integration: Integration;
    entityType: keyof typeof ENTITY_KEYS;
    externalId: string;
    operation?: string;
    eventUpdatedAt?: string | null;
  }
) {
  const entity = await fetchQboEntity(env, args.integration, args.entityType, args.externalId);
  return await upsertQboEntity(env, { ...args, entity });
}

export async function upsertQboEntity(
  env: Env,
  args: {
    integration: Integration;
    entityType: keyof typeof ENTITY_KEYS;
    externalId: string;
    entity: QboEntity;
    operation?: string;
    eventUpdatedAt?: string | null;
  }
) {
  const { integration, entityType, externalId, entity } = args;
  const now = nowISO();
  const existing = await env.DB.prepare(
    `SELECT id, local_entity_id, external_updated_at FROM external_entities
     WHERE workspace_id = ? AND integration_id = ? AND entity_type = ? AND external_id = ?`
  )
    .bind(integration.workspace_id, integration.id, entityType, externalId)
    .first<{ id: string; local_entity_id: string; external_updated_at: string | null }>();
  const updatedAt = entity.MetaData?.LastUpdatedTime ?? args.eventUpdatedAt ?? now;
  if (existing?.external_updated_at && updatedAt <= existing.external_updated_at) {
    return { localEntityId: existing.local_entity_id, duplicate: true };
  }

  if (entityType === "customer") {
    return await upsertCustomer(env, integration, externalId, entity, existing, now, updatedAt);
  }

  const customerExternalId = entity.CustomerRef?.value;
  let customerId = customerExternalId
    ? await findLocalCustomer(env, integration, customerExternalId)
    : null;
  if (!customerId && customerExternalId) {
    const customer = await fetchQboEntity(env, integration, "customer", customerExternalId);
    customerId = (
      await upsertCustomer(env, integration, customerExternalId, customer, null, now, updatedAt)
    ).localEntityId;
  }
  const mappingId = existing?.id ?? crypto.randomUUID();
  const localId = existing?.local_entity_id ?? crypto.randomUUID();
  await upsertMapping(env, {
    id: mappingId,
    integration,
    entityType,
    localEntityId: localId,
    externalId,
    entity,
    now,
    updatedAt,
  });
  const table = entityType === "estimate" ? "estimates" : "invoices";
  const expirationOrDue =
    entityType === "estimate" ? (entity.ExpirationDate ?? null) : (entity.DueDate ?? null);
  const status = entity.Active === false ? "deleted" : String(entity.TxnStatus ?? "open");
  if (entityType === "estimate") {
    await env.DB.prepare(
      `INSERT INTO estimates
       (id, workspace_id, customer_id, external_entity_id, doc_number, status, transaction_date,
        expiration_date, currency, subtotal, tax_total, discount_total, total, raw_payload, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET customer_id=excluded.customer_id, doc_number=excluded.doc_number,
       status=excluded.status, transaction_date=excluded.transaction_date, expiration_date=excluded.expiration_date,
       currency=excluded.currency, subtotal=excluded.subtotal, tax_total=excluded.tax_total,
       discount_total=excluded.discount_total, total=excluded.total, raw_payload=excluded.raw_payload,
       updated_at=excluded.updated_at`
    )
      .bind(
        localId,
        integration.workspace_id,
        customerId,
        mappingId,
        entity.DocNumber ?? null,
        status,
        entity.TxnDate ?? null,
        expirationOrDue,
        currency(entity),
        subTotal(entity),
        tax(entity),
        discount(entity),
        numberOrNull(entity.TotalAmt),
        JSON.stringify(entity),
        now,
        now
      )
      .run();
  } else {
    await env.DB.prepare(
      `INSERT INTO invoices
       (id, workspace_id, customer_id, external_entity_id, doc_number, status, transaction_date,
        due_date, currency, subtotal, tax_total, discount_total, total, balance, raw_payload, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET customer_id=excluded.customer_id, doc_number=excluded.doc_number,
       status=excluded.status, transaction_date=excluded.transaction_date, due_date=excluded.due_date,
       currency=excluded.currency, subtotal=excluded.subtotal, tax_total=excluded.tax_total,
       discount_total=excluded.discount_total, total=excluded.total, balance=excluded.balance,
       raw_payload=excluded.raw_payload, updated_at=excluded.updated_at`
    )
      .bind(
        localId,
        integration.workspace_id,
        customerId,
        mappingId,
        entity.DocNumber ?? null,
        status,
        entity.TxnDate ?? null,
        expirationOrDue,
        currency(entity),
        subTotal(entity),
        tax(entity),
        discount(entity),
        numberOrNull(entity.TotalAmt),
        numberOrNull(entity.Balance),
        JSON.stringify(entity),
        now,
        now
      )
      .run();
  }
  if (customerId) {
    await activity(
      env,
      integration.workspace_id,
      customerId,
      `${entityType}_${existing ? "updated" : "created"}`,
      `${entityType === "estimate" ? "Estimate" : "Invoice"} ${entity.DocNumber ?? externalId} synchronized`,
      mappingId,
      now
    );
  }
  return { localEntityId: localId, duplicate: false, table };
}

async function upsertCustomer(
  env: Env,
  integration: Integration,
  externalId: string,
  entity: QboEntity,
  existing: { id: string; local_entity_id: string } | null,
  now: string,
  updatedAt: string
) {
  const mappingId = existing?.id ?? crypto.randomUUID();
  const localId = existing?.local_entity_id ?? crypto.randomUUID();
  const displayName =
    entity.DisplayName || entity.CompanyName || `QuickBooks customer ${externalId}`;
  await env.DB.prepare(
    `INSERT INTO customers (id, workspace_id, display_name, company_name, customer_type, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'quickbooks', 'active', ?, ?)
     ON CONFLICT(id) DO UPDATE SET display_name=excluded.display_name, company_name=excluded.company_name,
     updated_at=excluded.updated_at`
  )
    .bind(localId, integration.workspace_id, displayName, entity.CompanyName ?? null, now, now)
    .run();
  await upsertMapping(env, {
    id: mappingId,
    integration,
    entityType: "customer",
    localEntityId: localId,
    externalId,
    entity,
    now,
    updatedAt,
  });
  const email = readString(entity.PrimaryEmailAddr, "Address");
  const phone = readString(entity.PrimaryPhone, "FreeFormNumber");
  if ((email || phone) && !existing) {
    const contactId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO contacts (id, workspace_id, customer_id, display_name, email, phone, is_primary, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`
    )
      .bind(contactId, integration.workspace_id, localId, displayName, email, phone, now, now)
      .run();
    await env.DB.prepare(`UPDATE customers SET primary_contact_id = ? WHERE id = ?`)
      .bind(contactId, localId)
      .run();
  }
  await activity(
    env,
    integration.workspace_id,
    localId,
    existing ? "quickbooks_synced" : "quickbooks_linked",
    `QuickBooks customer ${existing ? "synchronized" : "imported"}`,
    mappingId,
    now
  );
  return { localEntityId: localId, duplicate: false };
}

async function upsertMapping(
  env: Env,
  input: {
    id: string;
    integration: Integration;
    entityType: keyof typeof ENTITY_KEYS;
    localEntityId: string;
    externalId: string;
    entity: QboEntity;
    now: string;
    updatedAt: string;
  }
) {
  await env.DB.prepare(
    `INSERT INTO external_entities
     (id, workspace_id, integration_id, provider, entity_type, local_entity_type, local_entity_id,
      external_id, external_sync_token, external_updated_at, last_synced_at, sync_status, created_at, updated_at)
     VALUES (?, ?, ?, 'quickbooks', ?, ?, ?, ?, ?, ?, ?, 'linked', ?, ?)
     ON CONFLICT(workspace_id, integration_id, entity_type, external_id) DO UPDATE SET
      external_sync_token=excluded.external_sync_token, external_updated_at=excluded.external_updated_at,
      last_synced_at=excluded.last_synced_at, sync_status='linked', last_error=NULL, updated_at=excluded.updated_at`
  )
    .bind(
      input.id,
      input.integration.workspace_id,
      input.integration.id,
      input.entityType,
      input.entityType,
      input.localEntityId,
      input.externalId,
      input.entity.SyncToken ?? null,
      input.updatedAt,
      input.now,
      input.now,
      input.now
    )
    .run();
}

async function findLocalCustomer(env: Env, integration: Integration, externalId: string) {
  const row = await env.DB.prepare(
    `SELECT local_entity_id FROM external_entities WHERE workspace_id=? AND integration_id=?
     AND entity_type='customer' AND external_id=?`
  )
    .bind(integration.workspace_id, integration.id, externalId)
    .first<{ local_entity_id: string }>();
  return row?.local_entity_id ?? null;
}

export async function persistSyncError(
  env: Env,
  integration: Integration,
  entityType: string,
  externalId: string,
  error: unknown
) {
  const message = sanitizeExternalError(error, "quickbooks_sync_failed");
  const status = (error as { status?: number }).status === 409 ? "conflict" : "error";
  const now = nowISO();
  await env.DB.prepare(
    `UPDATE external_entities SET sync_status=?, last_error=?, updated_at=?
     WHERE workspace_id=? AND integration_id=? AND entity_type=? AND external_id=?`
  )
    .bind(status, message, now, integration.workspace_id, integration.id, entityType, externalId)
    .run();
  console.error(
    JSON.stringify({
      event: "quickbooks_sync_error",
      integrationId: integration.id,
      entityType,
      message,
    })
  );
  return message;
}

async function activity(
  env: Env,
  workspaceId: string,
  customerId: string,
  type: string,
  subject: string,
  externalEntityId: string | null,
  now: string
) {
  await env.DB.prepare(
    `INSERT INTO customer_activities (id, workspace_id, customer_id, activity_type, subject, source, external_entity_id, occurred_at, created_at)
     VALUES (?, ?, ?, ?, ?, 'quickbooks', ?, ?, ?)`
  )
    .bind(crypto.randomUUID(), workspaceId, customerId, type, subject, externalEntityId, now, now)
    .run();
}

function readString(value: unknown, key: string) {
  return value &&
    typeof value === "object" &&
    typeof (value as Record<string, unknown>)[key] === "string"
    ? (value as Record<string, string>)[key]
    : null;
}
function numberOrNull(value: unknown) {
  return typeof value === "number" ? value : null;
}
function currency(entity: QboEntity) {
  return readString(entity.CurrencyRef, "value") ?? "USD";
}
function subTotal(entity: QboEntity) {
  return lineAmount(entity, "SubTotalLineDetail");
}
function discount(entity: QboEntity) {
  return lineAmount(entity, "DiscountLineDetail");
}
function tax(entity: QboEntity) {
  const txnTax = entity.TxnTaxDetail as { TotalTax?: unknown } | undefined;
  return numberOrNull(txnTax?.TotalTax);
}
function lineAmount(entity: QboEntity, detailType: string) {
  const lines = Array.isArray(entity.Line) ? (entity.Line as Array<Record<string, unknown>>) : [];
  const line = lines.find((item) => item.DetailType === detailType);
  return numberOrNull(line?.Amount);
}
