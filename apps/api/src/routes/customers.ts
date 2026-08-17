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
import { sanitizeExternalError } from "../lib/security";
import { signedUrl } from "./customerFiles";
import { enqueueCustomerQuoSync, enqueueQuoContactSync } from "../services/quo";
import {
  addComputedFollowUp,
  enqueueCustomerNoteFollowUpAnalysis,
} from "../services/customerFollowUp";

const STATUSES = ["lead", "active", "completed", "archived"];
const CONTACT_STATUSES = ["active", "inactive", "archived"];
const OPPORTUNITY_TYPES = ["furniture", "cabinets", "other"];
const OPPORTUNITY_STATUSES = ["scoping", "quoted", "accepted", "lost"];
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
      const statuses = (url.searchParams.get("status") || "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
      if (statuses.length) {
        if (statuses.some((status) => !STATUSES.includes(status)))
          return badRequest("invalid_status");
        filters.push(`c.status IN (${statuses.map(() => "?").join(",")})`);
        values.push(...statuses);
      }
      const sort = url.searchParams.get("sort")?.trim() || "name_asc";
      const orderBy = {
        name_asc: "c.display_name COLLATE NOCASE ASC",
        next_follow_up_asc: "c.display_name COLLATE NOCASE ASC",
        last_note_desc:
          "CASE WHEN last_note_at IS NULL THEN 1 ELSE 0 END, last_note_at DESC, c.display_name COLLATE NOCASE ASC",
      }[sort];
      if (!orderBy) return badRequest("invalid_sort");
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
                (SELECT MAX(a.occurred_at) FROM customer_activities a
                 WHERE a.workspace_id=c.workspace_id AND a.customer_id=c.id
                   AND a.activity_type='note' AND a.is_human_authored=1) AS last_human_note_at,
                g.guidance_type,g.interpreted_date,g.cadence_json,g.explanation AS guidance_explanation,
                (SELECT MAX(a.occurred_at) FROM customer_activities a
                 WHERE a.workspace_id=c.workspace_id AND a.customer_id=c.id
                   AND a.activity_type='note') AS last_note_at,
                (SELECT COUNT(*) FROM estimates e WHERE e.customer_id=c.id AND COALESCE(e.status,'open') NOT IN ('closed','deleted','rejected')) AS open_estimate_count,
                (SELECT COALESCE(SUM(i.balance),0) FROM invoices i WHERE i.customer_id=c.id AND COALESCE(i.balance,0)>0) AS open_invoice_balance,
                (SELECT COALESCE(SUM(o.budget_cents),0) FROM customer_opportunities o
                 WHERE o.workspace_id=c.workspace_id AND o.customer_id=c.id AND o.status<>'lost') AS non_lost_opportunity_total_cents
         FROM customers c LEFT JOIN contacts pc ON pc.id=c.primary_contact_id
         LEFT JOIN external_entities ee ON ee.workspace_id=c.workspace_id AND ee.local_entity_type='customer' AND ee.local_entity_id=c.id
         LEFT JOIN customer_follow_up_guidance g ON g.customer_id=c.id AND g.workspace_id=c.workspace_id
         WHERE ${filters.join(" AND ")} ORDER BY ${orderBy}`
      )
        .bind(...values)
        .all();
      const rows = (result.results ?? []).map((row) => addComputedFollowUp(row));
      if (sort === "next_follow_up_asc") {
        rows.sort((a, b) => {
          if (!a.next_follow_up_at && !b.next_follow_up_at)
            return String(a.display_name).localeCompare(String(b.display_name));
          if (!a.next_follow_up_at) return 1;
          if (!b.next_follow_up_at) return -1;
          return (
            a.next_follow_up_at.localeCompare(b.next_follow_up_at) ||
            String(a.display_name).localeCompare(String(b.display_name))
          );
        });
      }
      return json(rows);
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
      await enqueueCustomerQuoSync(env, workspaceId, customerId);
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
      await enqueueCustomerQuoSync(env, workspaceId, customerId);
      return json({ archived: true });
    }
    return methodNotAllowed(["GET", "PATCH", "DELETE"]);
  }

  const action = segments[1];
  if (action === "follow-up-stream" && request.method === "GET") {
    const noteId = url.searchParams.get("noteId")?.trim();
    if (!noteId) return badRequest("missing_note_id");
    const note = await env.DB.prepare(
      `SELECT 1 FROM customer_activities
       WHERE id=? AND workspace_id=? AND customer_id=?
         AND activity_type='note' AND is_human_authored=1`
    )
      .bind(noteId, workspaceId, customerId)
      .first();
    if (!note) return notFound("Note not found");
    return followUpStream(env, workspaceId, customerId, noteId, request.signal);
  }
  if ((action === "contacts" || action === "addresses") && segments.length <= 3) {
    const allowedMethods = segments.length === 2 ? ["POST"] : ["GET", "PATCH", "DELETE"];
    if (!allowedMethods.includes(request.method)) return methodNotAllowed(allowedMethods);
    const body = await readBody(request);
    const now = nowISO();
    const id = segments[2] || crypto.randomUUID();
    if (action === "contacts") {
      if (segments.length === 3) {
        const row = await env.DB.prepare(
          `SELECT * FROM contacts WHERE id=? AND customer_id=? AND workspace_id=?`
        )
          .bind(id, customerId, workspaceId)
          .first<Record<string, unknown>>();
        if (!row) return notFound("Contact not found");
        if (request.method === "GET") return json(row);
        if (request.method === "DELETE") {
          await archiveContact(env, workspaceId, customerId, id, now);
          await enqueueQuoContactSync(env, workspaceId, customerId, id);
          return json({ archived: true });
        }
        const firstName =
          body.firstName === undefined ? string(row.first_name) : string(body.firstName);
        const lastName =
          body.lastName === undefined ? string(row.last_name) : string(body.lastName);
        const displayName =
          body.displayName === undefined
            ? [firstName, lastName].filter(Boolean).join(" ") || string(row.display_name)
            : string(body.displayName) || [firstName, lastName].filter(Boolean).join(" ");
        if (!displayName) return badRequest("display_name_required");
        const email = body.email === undefined ? nullable(row.email) : nullable(body.email);
        if (email && !isValidEmail(email)) return badRequest("invalid_email");
        const status = body.status === undefined ? string(row.status) : string(body.status);
        if (!CONTACT_STATUSES.includes(status)) return badRequest("invalid_contact_status");
        const isPrimary =
          body.isPrimary === undefined ? bool(row.is_primary) : bool(body.isPrimary);
        await env.DB.prepare(
          `UPDATE contacts SET first_name=?,last_name=?,display_name=?,email=?,phone=?,role=?,status=?,is_primary=?,archived_at=?,updated_at=? WHERE id=?`
        )
          .bind(
            firstName || null,
            lastName || null,
            displayName,
            email,
            body.phone === undefined ? nullable(row.phone) : nullable(body.phone),
            body.role === undefined ? nullable(row.role) : nullable(body.role),
            status,
            isPrimary,
            status === "archived" ? now : null,
            now,
            id
          )
          .run();
        if (status === "archived") await clearPrimaryContact(env, workspaceId, customerId, id, now);
        else if (isPrimary) await setPrimaryContact(env, workspaceId, customerId, id, now);
      } else {
        const firstName = string(body.firstName);
        const lastName = string(body.lastName);
        const displayName =
          string(body.displayName) || [firstName, lastName].filter(Boolean).join(" ");
        if (!displayName) return badRequest("display_name_required");
        const email = nullable(body.email);
        if (email && !isValidEmail(email)) return badRequest("invalid_email");
        const status = string(body.status) || "active";
        if (!CONTACT_STATUSES.includes(status)) return badRequest("invalid_contact_status");
        if (status === "archived") return badRequest("cannot_create_archived_contact");
        await env.DB.prepare(
          `INSERT INTO contacts (id,workspace_id,customer_id,first_name,last_name,display_name,email,phone,role,status,is_primary,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
        )
          .bind(
            id,
            workspaceId,
            customerId,
            firstName || null,
            lastName || null,
            displayName,
            email,
            nullable(body.phone),
            nullable(body.role),
            status,
            bool(body.isPrimary),
            now,
            now
          )
          .run();
        if (bool(body.isPrimary)) await setPrimaryContact(env, workspaceId, customerId, id, now);
      }
      await enqueueQuoContactSync(env, workspaceId, customerId, id);
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
  if (action === "opportunities" && segments.length <= 3) {
    const allowedMethods = segments.length === 2 ? ["POST"] : ["GET", "PATCH"];
    if (!allowedMethods.includes(request.method)) return methodNotAllowed(allowedMethods);
    const body = await readBody(request);
    const now = nowISO();
    const opportunityId = segments[2] || crypto.randomUUID();
    if (segments.length === 3) {
      const opportunity = await env.DB.prepare(
        `SELECT * FROM customer_opportunities WHERE id=? AND customer_id=? AND workspace_id=?`
      )
        .bind(opportunityId, customerId, workspaceId)
        .first<Record<string, unknown>>();
      if (!opportunity) return notFound("Opportunity not found");
      if (request.method === "GET") return json(opportunity);
      const input = parseOpportunity(body, opportunity);
      if (!input.ok) return badRequest(input.error);
      await env.DB.prepare(
        `UPDATE customer_opportunities SET description=?,opportunity_type=?,budget_cents=?,status=?,updated_at=? WHERE id=? AND customer_id=? AND workspace_id=?`
      )
        .bind(
          input.description,
          input.opportunityType,
          input.budgetCents,
          input.status,
          now,
          opportunityId,
          customerId,
          workspaceId
        )
        .run();
    } else {
      const input = parseOpportunity(body);
      if (!input.ok) return badRequest(input.error);
      await env.DB.prepare(
        `INSERT INTO customer_opportunities (id,workspace_id,customer_id,description,opportunity_type,budget_cents,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)`
      )
        .bind(
          opportunityId,
          workspaceId,
          customerId,
          input.description,
          input.opportunityType,
          input.budgetCents,
          input.status,
          now,
          now
        )
        .run();
    }
    return json(await loadDetail(env, workspaceId, customerId), segments.length === 2 ? 201 : 200);
  }
  if (action === "activities" && request.method === "POST") {
    const body = await readBody(request);
    const subject = string(body.subject);
    if (!subject) return badRequest("subject_required");
    const followUpAt = nullable(body.followUpAt);
    const followUpDescription = nullable(body.followUpDescription);
    const followUpAssignedTo = nullable(body.followUpAssignedTo);
    if (followUpAt && Number.isNaN(Date.parse(followUpAt)))
      return badRequest("invalid_follow_up_at");
    if (followUpAt && !followUpDescription) return badRequest("follow_up_description_required");
    if (followUpAssignedTo) {
      const assignee = await env.DB.prepare(
        `SELECT user_id FROM users WHERE workspace_id=? AND user_id=?`
      )
        .bind(workspaceId, followUpAssignedTo)
        .first();
      if (!assignee) return badRequest("invalid_follow_up_assignee");
    }
    const now = nowISO();
    const noteId = crypto.randomUUID();
    const statements = [
      env.DB.prepare(
        `INSERT INTO customer_activities (id,workspace_id,customer_id,activity_type,subject,body,source,occurred_at,created_by,created_at,is_human_authored) VALUES (?,?,?,?,?,?,?,?,?,?,1)`
      ).bind(
        noteId,
        workspaceId,
        customerId,
        "note",
        subject,
        nullable(body.body),
        "ftops",
        now,
        actor.email,
        now
      ),
    ];
    if (followUpAt && followUpDescription) {
      const taskId = crypto.randomUUID();
      statements.push(
        env.DB.prepare(
          `INSERT INTO tasks
           (id,workspace_id,project_id,scope,group_key,line_item_uri,template_key,title,kind,position,status,state_json,due_at,assigned_to,description,template_id,customer_id,completed_at,priority,created_at,updated_at)
           VALUES (?,?,NULL,'customer',NULL,NULL,'customer-follow-up',?,'customer_follow_up',0,'scheduled',NULL,?,?,?,NULL,?,NULL,0,?,?)`
        ).bind(
          taskId,
          workspaceId,
          followUpDescription,
          followUpAt,
          followUpAssignedTo,
          followUpDescription,
          customerId,
          now,
          now
        )
      );
    }
    await env.DB.batch(statements);
    await enqueueCustomerNoteFollowUpAnalysis(env, {
      workspaceId,
      customerId,
      noteId,
      occurredAt: now,
    });
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
  if (action === "files" && segments.length === 3) {
    const fileAction = segments[2];
    if (fileAction === "init" && request.method === "POST") {
      const body = await readBody(request);
      const activityId = string(body.activityId);
      const filename = string(body.filename);
      const sizeBytes = typeof body.sizeBytes === "number" ? body.sizeBytes : Number.NaN;
      if (!activityId || !filename || !Number.isSafeInteger(sizeBytes) || sizeBytes < 1)
        return badRequest("missing_fields");
      if (sizeBytes > 100 * 1024 * 1024) return badRequest("file_too_large");
      const activity = await env.DB.prepare(
        `SELECT id FROM customer_activities WHERE id=? AND workspace_id=? AND customer_id=? AND activity_type='note'`
      )
        .bind(activityId, workspaceId, customerId)
        .first();
      if (!activity) return badRequest("invalid_note_activity");
      const storageKey = `customers/${workspaceId}/${customerId}/${activityId}/${crypto.randomUUID()}-${safeStorageName(filename)}`;
      const uploadUrl = await signedUrl(env, storageKey, "PUT");
      if (uploadUrl) return json({ uploadUrl, storageKey });
      if (env.ALLOW_R2_FALLBACK_UPLOADS === "true") {
        const fallback = new URL(`/customers/${customerId}/files/upload`, "http://local");
        fallback.searchParams.set("storageKey", storageKey);
        return json({ uploadUrl: `${fallback.pathname}${fallback.search}`, storageKey });
      }
      return json({ error: "presigned_url_unsupported" }, 500);
    }
    if (fileAction === "upload" && request.method === "PUT") {
      const storageKey = url.searchParams.get("storageKey") || "";
      const prefix = `customers/${workspaceId}/${customerId}/`;
      if (!storageKey.startsWith(prefix)) return badRequest("invalid_storage_key");
      await env.R2_TASK_FILES_BUCKET.put(storageKey, await request.arrayBuffer(), {
        httpMetadata: {
          contentType: request.headers.get("content-type") || "application/octet-stream",
        },
      });
      return json({ ok: true });
    }
    if (fileAction === "complete" && request.method === "POST") {
      const body = await readBody(request);
      const activityId = string(body.activityId);
      const storageKey = string(body.storageKey);
      const filename = string(body.filename);
      const contentType = string(body.contentType) || "application/octet-stream";
      const sizeBytes = typeof body.sizeBytes === "number" ? body.sizeBytes : Number.NaN;
      const prefix = `customers/${workspaceId}/${customerId}/${activityId}/`;
      if (
        !activityId ||
        !storageKey.startsWith(prefix) ||
        !filename ||
        !Number.isSafeInteger(sizeBytes) ||
        sizeBytes < 1 ||
        sizeBytes > 100 * 1024 * 1024
      )
        return badRequest("invalid_file_metadata");
      const activity = await env.DB.prepare(
        `SELECT id FROM customer_activities WHERE id=? AND workspace_id=? AND customer_id=? AND activity_type='note'`
      )
        .bind(activityId, workspaceId, customerId)
        .first();
      if (!activity) return badRequest("invalid_note_activity");
      const object = await env.R2_TASK_FILES_BUCKET.head(storageKey);
      if (!object) return badRequest("uploaded_file_not_found");
      const fileId = crypto.randomUUID();
      const now = nowISO();
      await env.DB.prepare(
        `INSERT INTO customer_note_files
         (id,workspace_id,customer_id,activity_id,uploaded_by_email,original_filename,content_type,size_bytes,storage_key,sha256,created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`
      )
        .bind(
          fileId,
          workspaceId,
          customerId,
          activityId,
          actor.email,
          filename,
          contentType,
          sizeBytes,
          storageKey,
          nullable(body.sha256),
          now
        )
        .run();
      return json(
        await env.DB.prepare(`SELECT * FROM customer_note_files WHERE id=?`).bind(fileId).first(),
        201
      );
    }
    return methodNotAllowed(["POST", "PUT"]);
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

function followUpStream(
  env: Env,
  workspaceId: string,
  customerId: string,
  noteId: string,
  signal: AbortSignal
) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      controller.enqueue(encoder.encode(": connected\n\n"));
      for (let attempt = 0; attempt < 25 && !signal.aborted; attempt += 1) {
        const row = await loadFollowUpState(env, workspaceId, customerId);
        if (row?.source_note_id === noteId) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(row)}\n\n`));
          controller.close();
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      controller.close();
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
    },
  });
}

async function loadFollowUpState(env: Env, workspaceId: string, customerId: string) {
  const row = await env.DB.prepare(
    `SELECT c.id,c.status,c.created_at,
            (SELECT MAX(a.occurred_at) FROM customer_activities a
             WHERE a.workspace_id=c.workspace_id AND a.customer_id=c.id
               AND a.activity_type='note' AND a.is_human_authored=1) AS last_human_note_at,
            g.guidance_type,g.interpreted_date,g.cadence_json,
            g.confidence AS guidance_confidence,g.explanation AS guidance_explanation,g.source_note_id
     FROM customers c
     LEFT JOIN customer_follow_up_guidance g ON g.customer_id=c.id AND g.workspace_id=c.workspace_id
     WHERE c.workspace_id=? AND c.id=?`
  )
    .bind(workspaceId, customerId)
    .first<Record<string, unknown>>();
  return row ? addComputedFollowUp(row) : null;
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
        error: sanitizeExternalError(error, "quickbooks_request_failed"),
        syncStatus: status === 409 ? "conflict" : "error",
      },
      status
    );
  }
  return methodNotAllowed(["GET", "POST"]);
}

async function loadDetail(env: Env, workspaceId: string, id: string) {
  const customerRow = await env.DB.prepare(
    `SELECT c.*,COALESCE(ee.sync_status,'not_linked') quickbooks_sync_status,ee.integration_id,ee.external_id quickbooks_customer_id,ee.last_synced_at,ee.last_error,
            (SELECT MAX(a.occurred_at) FROM customer_activities a WHERE a.workspace_id=c.workspace_id AND a.customer_id=c.id AND a.activity_type='note' AND a.is_human_authored=1) AS last_human_note_at,
            g.guidance_type,g.interpreted_date,g.cadence_json,g.confidence AS guidance_confidence,g.explanation AS guidance_explanation,g.source_note_id
     FROM customers c
     LEFT JOIN external_entities ee ON ee.workspace_id=c.workspace_id AND ee.local_entity_type='customer' AND ee.local_entity_id=c.id
     LEFT JOIN customer_follow_up_guidance g ON g.customer_id=c.id AND g.workspace_id=c.workspace_id
     WHERE c.workspace_id=? AND c.id=?`
  )
    .bind(workspaceId, id)
    .first();
  const customer = customerRow ? addComputedFollowUp(customerRow) : customerRow;
  return {
    customer,
    contacts: await listRows(
      env,
      `SELECT * FROM contacts WHERE workspace_id=? AND customer_id=? ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'inactive' THEN 1 ELSE 2 END,is_primary DESC,display_name`,
      workspaceId,
      id
    ),
    opportunities: await listRows(
      env,
      `SELECT * FROM customer_opportunities WHERE workspace_id=? AND customer_id=? ORDER BY CASE status WHEN 'accepted' THEN 0 WHEN 'quoted' THEN 1 WHEN 'scoping' THEN 2 ELSE 3 END,updated_at DESC`,
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
    tasks: await listRows(
      env,
      `SELECT * FROM tasks WHERE workspace_id=? AND customer_id=? ORDER BY CASE WHEN status IN ('scheduled','blocked','in progress') THEN 0 ELSE 1 END,due_at IS NULL,due_at,updated_at DESC`,
      workspaceId,
      id
    ),
    files: await listRows(
      env,
      `SELECT f.*,a.subject AS note_subject,a.occurred_at AS note_occurred_at
       FROM customer_note_files f JOIN customer_activities a ON a.id=f.activity_id
       WHERE f.workspace_id=? AND f.customer_id=?
       ORDER BY f.deprecated_at IS NOT NULL,f.created_at DESC`,
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
  return value === true || value === 1 ? 1 : 0;
}
function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}
function safeStorageName(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(-160) || "file";
}
function parseOpportunity(
  body: Record<string, unknown>,
  current?: Record<string, unknown>
):
  | {
      ok: true;
      description: string;
      opportunityType: string;
      budgetCents: number;
      status: string;
    }
  | { ok: false; error: string } {
  const description =
    body.description === undefined ? string(current?.description) : string(body.description);
  if (!description) return { ok: false, error: "description_required" };
  const opportunityType =
    body.type === undefined ? string(current?.opportunity_type) : string(body.type);
  if (!OPPORTUNITY_TYPES.includes(opportunityType))
    return { ok: false, error: "invalid_opportunity_type" };
  const status =
    body.status === undefined ? string(current?.status) || "scoping" : string(body.status);
  if (!OPPORTUNITY_STATUSES.includes(status))
    return { ok: false, error: "invalid_opportunity_status" };
  const rawBudget = body.budgetCents === undefined ? current?.budget_cents : body.budgetCents;
  const budgetCents = typeof rawBudget === "number" ? rawBudget : Number.NaN;
  if (!Number.isSafeInteger(budgetCents) || budgetCents < 0)
    return { ok: false, error: "invalid_budget" };
  return { ok: true, description, opportunityType, budgetCents, status };
}
async function setPrimaryContact(
  env: Env,
  workspaceId: string,
  customerId: string,
  contactId: string,
  now: string
) {
  await env.DB.prepare(
    `UPDATE contacts SET is_primary=CASE WHEN id=? THEN 1 ELSE 0 END WHERE customer_id=? AND workspace_id=?`
  )
    .bind(contactId, customerId, workspaceId)
    .run();
  await env.DB.prepare(`UPDATE customers SET primary_contact_id=?,updated_at=? WHERE id=?`)
    .bind(contactId, now, customerId)
    .run();
}
async function clearPrimaryContact(
  env: Env,
  workspaceId: string,
  customerId: string,
  contactId: string,
  now: string
) {
  await env.DB.prepare(`UPDATE contacts SET is_primary=0 WHERE id=? AND workspace_id=?`)
    .bind(contactId, workspaceId)
    .run();
  await env.DB.prepare(
    `UPDATE customers SET primary_contact_id=NULL,updated_at=? WHERE id=? AND workspace_id=? AND primary_contact_id=?`
  )
    .bind(now, customerId, workspaceId, contactId)
    .run();
}
async function archiveContact(
  env: Env,
  workspaceId: string,
  customerId: string,
  contactId: string,
  now: string
) {
  await env.DB.prepare(
    `UPDATE contacts SET status='archived',is_primary=0,archived_at=?,updated_at=? WHERE id=? AND customer_id=? AND workspace_id=?`
  )
    .bind(now, now, contactId, customerId, workspaceId)
    .run();
  await clearPrimaryContact(env, workspaceId, customerId, contactId, now);
}
