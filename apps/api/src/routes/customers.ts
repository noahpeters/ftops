import { canAccessWorkspace, requireActor } from "../lib/access";
import { badRequest, forbidden, json, methodNotAllowed, notFound } from "../lib/http";
import type { Env } from "../lib/types";
import { nowISO } from "../lib/utils";
import {
  createQboCustomer,
  getQboIntegration,
  persistSyncError,
  searchQboCustomers,
  syncQboEntity,
  upsertQboEntity,
} from "../services/quickbooks";

const STATUSES = ["lead", "prospect", "active", "past", "archived"];
const ADDRESS_TYPES = ["billing", "shipping", "project_site", "other"];

export async function handleCustomers(
  segments: string[],
  request: Request,
  env: Env,
  _ctx: ExecutionContext,
  url: URL
) {
  const auth = await requireActor(env, request);
  if (!auth.ok) return auth.response;
  const actor = auth.actor;

  if (segments.length === 0) {
    if (request.method === "GET") {
      const workspaceId = url.searchParams.get("workspaceId")?.trim();
      if (!workspaceId) return badRequest("missing_workspace_id");
      if (!canAccessWorkspace(actor, workspaceId)) return forbidden("forbidden");
      const filters = ["c.workspace_id = ?"];
      const values: unknown[] = [workspaceId];
      const search = url.searchParams.get("search")?.trim();
      if (search) {
        filters.push(
          `(c.display_name LIKE ? OR c.company_name LIKE ? OR pc.email LIKE ? OR pc.phone LIKE ?)`
        );
        const term = `%${search}%`;
        values.push(term, term, term, term);
      }
      const status = url.searchParams.get("status")?.trim();
      if (status) {
        if (!STATUSES.includes(status)) return badRequest("invalid_status");
        filters.push("c.status = ?");
        values.push(status);
      }
      const sync = url.searchParams.get("sync")?.trim();
      if (sync === "not_linked") filters.push("ee.id IS NULL");
      else if (sync) {
        filters.push("ee.sync_status = ?");
        values.push(sync);
      }
      const result = await env.DB.prepare(
        `SELECT c.id, c.display_name, c.company_name, c.status, c.lead_source, c.updated_at,
                pc.display_name AS primary_contact, pc.email, pc.phone,
                COALESCE(ee.sync_status, 'not_linked') AS quickbooks_sync_status,
                ee.last_synced_at, ee.last_error,
                (SELECT COUNT(*) FROM estimates e WHERE e.customer_id=c.id AND COALESCE(e.status,'open') NOT IN ('closed','deleted','rejected')) AS open_estimate_count,
                (SELECT COALESCE(SUM(i.balance),0) FROM invoices i WHERE i.customer_id=c.id AND COALESCE(i.balance,0)>0) AS open_invoice_balance
         FROM customers c LEFT JOIN contacts pc ON pc.id=c.primary_contact_id
         LEFT JOIN external_entities ee ON ee.workspace_id=c.workspace_id AND ee.local_entity_type='customer' AND ee.local_entity_id=c.id
         WHERE ${filters.join(" AND ")} ORDER BY c.display_name COLLATE NOCASE`
      )
        .bind(...values)
        .all();
      return json(result.results ?? []);
    }
    if (request.method === "POST") {
      const body = await readBody(request);
      const workspaceId = string(body.workspaceId);
      const displayName = string(body.displayName);
      const status = string(body.status) || "lead";
      if (!workspaceId || !displayName) return badRequest("missing_required_fields");
      if (!canAccessWorkspace(actor, workspaceId)) return forbidden("forbidden");
      if (!STATUSES.includes(status)) return badRequest("invalid_status");
      const now = nowISO();
      const id = crypto.randomUUID();
      await env.DB.prepare(
        `INSERT INTO customers (id,workspace_id,display_name,company_name,customer_type,status,lead_source,notes,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?)`
      )
        .bind(
          id,
          workspaceId,
          displayName,
          nullable(body.companyName),
          nullable(body.customerType),
          status,
          nullable(body.leadSource),
          nullable(body.notes),
          now,
          now
        )
        .run();
      await addActivity(
        env,
        workspaceId,
        id,
        "customer_created",
        "Customer created",
        nullable(body.notes),
        "ftops",
        actor.email
      );
      return json(await loadDetail(env, workspaceId, id), 201);
    }
    return methodNotAllowed(["GET", "POST"]);
  }

  const customerId = segments[0];
  const customer = await env.DB.prepare(`SELECT * FROM customers WHERE id=?`)
    .bind(customerId)
    .first<Record<string, unknown>>();
  if (!customer) return notFound("Customer not found");
  const workspaceId = String(customer.workspace_id);
  if (!canAccessWorkspace(actor, workspaceId)) return forbidden("forbidden");

  if (segments.length === 1) {
    if (request.method === "GET") return json(await loadDetail(env, workspaceId, customerId));
    if (request.method === "PATCH") {
      const body = await readBody(request);
      const updates: string[] = [];
      const values: unknown[] = [];
      for (const [api, column] of [
        ["displayName", "display_name"],
        ["companyName", "company_name"],
        ["customerType", "customer_type"],
        ["leadSource", "lead_source"],
        ["notes", "notes"],
      ] as const) {
        if (body[api] !== undefined) {
          if (api === "displayName" && !string(body[api]))
            return badRequest("display_name_required");
          updates.push(`${column}=?`);
          values.push(nullable(body[api]));
        }
      }
      if (body.status !== undefined) {
        const status = string(body.status);
        if (!STATUSES.includes(status)) return badRequest("invalid_status");
        updates.push("status=?");
        values.push(status);
      }
      if (!updates.length) return badRequest("no_updates");
      updates.push("updated_at=?");
      values.push(nowISO(), customerId, workspaceId);
      await env.DB.prepare(
        `UPDATE customers SET ${updates.join(",")} WHERE id=? AND workspace_id=?`
      )
        .bind(...values)
        .run();
      await addActivity(
        env,
        workspaceId,
        customerId,
        "customer_updated",
        "Customer updated",
        null,
        "ftops",
        actor.email
      );
      return json(await loadDetail(env, workspaceId, customerId));
    }
    if (request.method === "DELETE") {
      const now = nowISO();
      await env.DB.prepare(
        `UPDATE customers SET status='archived',archived_at=?,updated_at=? WHERE id=? AND workspace_id=?`
      )
        .bind(now, now, customerId, workspaceId)
        .run();
      await addActivity(
        env,
        workspaceId,
        customerId,
        "customer_updated",
        "Customer archived",
        null,
        "ftops",
        actor.email
      );
      return json({ archived: true });
    }
    return methodNotAllowed(["GET", "PATCH", "DELETE"]);
  }

  const action = segments[1];
  if ((action === "contacts" || action === "addresses") && segments.length <= 3) {
    if (request.method !== (segments.length === 2 ? "POST" : "PATCH"))
      return methodNotAllowed([segments.length === 2 ? "POST" : "PATCH"]);
    const body = await readBody(request);
    const now = nowISO();
    const id = segments[2] || crypto.randomUUID();
    if (action === "contacts") {
      const displayName =
        string(body.displayName) ||
        [string(body.firstName), string(body.lastName)].filter(Boolean).join(" ");
      if (!displayName) return badRequest("display_name_required");
      if (segments.length === 3) {
        const row = await env.DB.prepare(
          `SELECT id FROM contacts WHERE id=? AND customer_id=? AND workspace_id=?`
        )
          .bind(id, customerId, workspaceId)
          .first();
        if (!row) return notFound("Contact not found");
        await env.DB.prepare(
          `UPDATE contacts SET first_name=?,last_name=?,display_name=?,email=?,phone=?,role=?,is_primary=?,updated_at=? WHERE id=?`
        )
          .bind(
            nullable(body.firstName),
            nullable(body.lastName),
            displayName,
            nullable(body.email),
            nullable(body.phone),
            nullable(body.role),
            bool(body.isPrimary),
            now,
            id
          )
          .run();
      } else
        await env.DB.prepare(
          `INSERT INTO contacts (id,workspace_id,customer_id,first_name,last_name,display_name,email,phone,role,is_primary,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
        )
          .bind(
            id,
            workspaceId,
            customerId,
            nullable(body.firstName),
            nullable(body.lastName),
            displayName,
            nullable(body.email),
            nullable(body.phone),
            nullable(body.role),
            bool(body.isPrimary),
            now,
            now
          )
          .run();
      if (bool(body.isPrimary)) {
        await env.DB.prepare(
          `UPDATE contacts SET is_primary=CASE WHEN id=? THEN 1 ELSE 0 END WHERE customer_id=? AND workspace_id=?`
        )
          .bind(id, customerId, workspaceId)
          .run();
        await env.DB.prepare(`UPDATE customers SET primary_contact_id=?,updated_at=? WHERE id=?`)
          .bind(id, now, customerId)
          .run();
      }
    } else {
      const addressType = string(body.addressType);
      if (!ADDRESS_TYPES.includes(addressType)) return badRequest("invalid_address_type");
      const fields = [
        nullable(body.line1),
        nullable(body.line2),
        nullable(body.city),
        nullable(body.region),
        nullable(body.postalCode),
        nullable(body.country),
        bool(body.isPrimary),
        now,
      ];
      if (segments.length === 3) {
        const row = await env.DB.prepare(
          `SELECT id FROM customer_addresses WHERE id=? AND customer_id=? AND workspace_id=?`
        )
          .bind(id, customerId, workspaceId)
          .first();
        if (!row) return notFound("Address not found");
        await env.DB.prepare(
          `UPDATE customer_addresses SET address_type=?,line1=?,line2=?,city=?,region=?,postal_code=?,country=?,is_primary=?,updated_at=? WHERE id=?`
        )
          .bind(addressType, ...fields, id)
          .run();
      } else
        await env.DB.prepare(
          `INSERT INTO customer_addresses (id,workspace_id,customer_id,address_type,line1,line2,city,region,postal_code,country,is_primary,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
        )
          .bind(id, workspaceId, customerId, addressType, ...fields.slice(0, 7), now, now)
          .run();
    }
    return json(await loadDetail(env, workspaceId, customerId), segments.length === 2 ? 201 : 200);
  }
  if (action === "activities" && request.method === "POST") {
    const body = await readBody(request);
    const subject = string(body.subject);
    if (!subject) return badRequest("subject_required");
    await addActivity(
      env,
      workspaceId,
      customerId,
      "note",
      subject,
      nullable(body.body),
      "ftops",
      actor.email
    );
    return json(
      await listRows(
        env,
        `SELECT * FROM customer_activities WHERE workspace_id=? AND customer_id=? ORDER BY occurred_at DESC`,
        workspaceId,
        customerId
      ),
      201
    );
  }
  if ((action === "estimates" || action === "invoices") && request.method === "GET")
    return json(
      await listRows(
        env,
        `SELECT * FROM ${action} WHERE workspace_id=? AND customer_id=? ORDER BY transaction_date DESC, created_at DESC`,
        workspaceId,
        customerId
      )
    );
  if (action === "quickbooks" && segments.length >= 3)
    return await handleQuickbooks(
      segments.slice(2),
      request,
      env,
      workspaceId,
      customerId,
      customer
    );
  return notFound("Route not found");
}

async function handleQuickbooks(
  segments: string[],
  request: Request,
  env: Env,
  workspaceId: string,
  customerId: string,
  customer: Record<string, unknown>
) {
  const body = request.method === "POST" ? await readBody(request) : {};
  const integrationId =
    string(body.integrationId) || new URL(request.url).searchParams.get("integrationId") || "";
  if (!integrationId) return badRequest("missing_integration_id");
  const integration = await getQboIntegration(env, integrationId);
  if (!integration || integration.workspace_id !== workspaceId)
    return notFound("QuickBooks integration not found");
  const action = segments[0];
  try {
    if (action === "search" && request.method === "GET") {
      const term =
        new URL(request.url).searchParams.get("q")?.trim() || String(customer.display_name);
      return json(await searchQboCustomers(env, integration, term));
    }
    if (action === "link" && request.method === "POST") {
      const externalId = string(body.externalId);
      if (!externalId) return badRequest("external_id_required");
      const remote = await syncQboEntity(env, { integration, entityType: "customer", externalId });
      const importedId = remote.localEntityId;
      if (importedId !== customerId) {
        const duplicate = await env.DB.prepare(
          `SELECT id FROM external_entities WHERE workspace_id=? AND integration_id=? AND entity_type='customer' AND external_id=? AND local_entity_id<>?`
        )
          .bind(workspaceId, integrationId, externalId, customerId)
          .first();
        if (duplicate) return json({ error: "quickbooks_customer_already_linked" }, 409);
        const mapping = await env.DB.prepare(
          `SELECT * FROM external_entities WHERE local_entity_id=? AND entity_type='customer'`
        )
          .bind(importedId)
          .first<Record<string, unknown>>();
        if (mapping) {
          await env.DB.prepare(`DELETE FROM contacts WHERE customer_id=? AND workspace_id=?`)
            .bind(importedId, workspaceId)
            .run();
          await env.DB.prepare(
            `DELETE FROM customer_activities WHERE customer_id=? AND workspace_id=?`
          )
            .bind(importedId, workspaceId)
            .run();
          await env.DB.prepare(`DELETE FROM customers WHERE id=? AND customer_type='quickbooks'`)
            .bind(importedId)
            .run();
          await env.DB.prepare(
            `UPDATE external_entities SET local_entity_id=?,updated_at=? WHERE id=?`
          )
            .bind(customerId, nowISO(), mapping.id)
            .run();
        }
      }
      await addActivity(
        env,
        workspaceId,
        customerId,
        "quickbooks_linked",
        "Linked to QuickBooks",
        null,
        "quickbooks",
        null
      );
      return json(await loadDetail(env, workspaceId, customerId));
    }
    if (action === "create" && request.method === "POST") {
      const contact = await env.DB.prepare(`SELECT email,phone FROM contacts WHERE id=?`)
        .bind(customer.primary_contact_id ?? "")
        .first<{ email: string | null; phone: string | null }>();
      const remote = await createQboCustomer(env, integration, {
        displayName: String(customer.display_name),
        companyName: customer.company_name as string | null,
        email: contact?.email,
        phone: contact?.phone,
      });
      const externalId = string(remote.Id);
      await upsertQboEntity(env, {
        integration,
        entityType: "customer",
        externalId,
        entity: remote,
      });
      const mapping = await env.DB.prepare(
        `SELECT id,local_entity_id FROM external_entities WHERE integration_id=? AND entity_type='customer' AND external_id=?`
      )
        .bind(integrationId, externalId)
        .first<{ id: string; local_entity_id: string }>();
      if (mapping && mapping.local_entity_id !== customerId) {
        await env.DB.prepare(`DELETE FROM contacts WHERE customer_id=? AND workspace_id=?`)
          .bind(mapping.local_entity_id, workspaceId)
          .run();
        await env.DB.prepare(
          `DELETE FROM customer_activities WHERE customer_id=? AND workspace_id=?`
        )
          .bind(mapping.local_entity_id, workspaceId)
          .run();
        await env.DB.prepare(`DELETE FROM customers WHERE id=? AND customer_type='quickbooks'`)
          .bind(mapping.local_entity_id)
          .run();
        await env.DB.prepare(`UPDATE external_entities SET local_entity_id=? WHERE id=?`)
          .bind(customerId, mapping.id)
          .run();
      }
      return json(await loadDetail(env, workspaceId, customerId), 201);
    }
    if ((action === "refresh" || action === "retry") && request.method === "POST") {
      const mapping = await env.DB.prepare(
        `SELECT external_id FROM external_entities WHERE workspace_id=? AND integration_id=? AND entity_type='customer' AND local_entity_id=?`
      )
        .bind(workspaceId, integrationId, customerId)
        .first<{ external_id: string }>();
      if (!mapping) return badRequest("customer_not_linked");
      await syncQboEntity(env, {
        integration,
        entityType: "customer",
        externalId: mapping.external_id,
      });
      return json(await loadDetail(env, workspaceId, customerId));
    }
  } catch (error) {
    const externalId = string(body.externalId);
    if (externalId) await persistSyncError(env, integration, "customer", externalId, error);
    const status = (error as { status?: number }).status === 409 ? 409 : 502;
    return json(
      {
        error: error instanceof Error ? error.message : "quickbooks_request_failed",
        syncStatus: status === 409 ? "conflict" : "error",
      },
      status
    );
  }
  return methodNotAllowed(["GET", "POST"]);
}

async function loadDetail(env: Env, workspaceId: string, id: string) {
  const customer = await env.DB.prepare(
    `SELECT c.*,COALESCE(ee.sync_status,'not_linked') quickbooks_sync_status,ee.integration_id,ee.external_id quickbooks_customer_id,ee.last_synced_at,ee.last_error FROM customers c LEFT JOIN external_entities ee ON ee.workspace_id=c.workspace_id AND ee.local_entity_type='customer' AND ee.local_entity_id=c.id WHERE c.workspace_id=? AND c.id=?`
  )
    .bind(workspaceId, id)
    .first();
  return {
    customer,
    contacts: await listRows(
      env,
      `SELECT * FROM contacts WHERE workspace_id=? AND customer_id=? ORDER BY is_primary DESC,display_name`,
      workspaceId,
      id
    ),
    addresses: await listRows(
      env,
      `SELECT * FROM customer_addresses WHERE workspace_id=? AND customer_id=? ORDER BY is_primary DESC,address_type`,
      workspaceId,
      id
    ),
    activities: await listRows(
      env,
      `SELECT * FROM customer_activities WHERE workspace_id=? AND customer_id=? ORDER BY occurred_at DESC LIMIT 100`,
      workspaceId,
      id
    ),
    estimates: await listRows(
      env,
      `SELECT * FROM estimates WHERE workspace_id=? AND customer_id=? ORDER BY transaction_date DESC`,
      workspaceId,
      id
    ),
    invoices: await listRows(
      env,
      `SELECT * FROM invoices WHERE workspace_id=? AND customer_id=? ORDER BY transaction_date DESC`,
      workspaceId,
      id
    ),
  };
}
async function listRows(env: Env, sql: string, ...args: unknown[]) {
  const result = await env.DB.prepare(sql)
    .bind(...args)
    .all();
  return result.results ?? [];
}
async function addActivity(
  env: Env,
  workspaceId: string,
  customerId: string,
  type: string,
  subject: string,
  body: string | null,
  source: string,
  createdBy: string | null
) {
  const now = nowISO();
  await env.DB.prepare(
    `INSERT INTO customer_activities (id,workspace_id,customer_id,activity_type,subject,body,source,occurred_at,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`
  )
    .bind(
      crypto.randomUUID(),
      workspaceId,
      customerId,
      type,
      subject,
      body,
      source,
      now,
      createdBy,
      now
    )
    .run();
}
async function readBody(request: Request) {
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}
function string(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}
function nullable(value: unknown) {
  const result = string(value);
  return result || null;
}
function bool(value: unknown) {
  return value ? 1 : 0;
}
