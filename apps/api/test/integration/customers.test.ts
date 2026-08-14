import { afterEach, describe, expect, it, vi } from "vitest";
import { createTestEnv } from "../helpers/miniflare";
import { route } from "../../src/lib/router";
import type { ExecutionContext } from "@cloudflare/workers-types";

describe("customers API", () => {
  afterEach(() => vi.restoreAllMocks());

  it("creates an unlinked customer and loads detail and filters", async () => {
    const context = await createTestEnv();
    if (!context) return;
    const { env, mf } = context;
    const created = await request(env, "/customers", {
      method: "POST",
      body: JSON.stringify({
        workspaceId: "default",
        displayName: "Acme Millwork",
        companyName: "Acme",
        status: "lead",
      }),
    });
    expect(created.status).toBe(201);
    const detail = (await created.json()) as {
      customer: { id: string; quickbooks_sync_status: string };
    };
    expect(detail.customer.quickbooks_sync_status).toBe("not_linked");
    const list = await request(
      env,
      "/customers?workspaceId=default&search=Acme&status=lead&sync=not_linked"
    );
    expect(list.status).toBe(200);
    expect((await list.json()) as unknown[]).toHaveLength(1);
    const loaded = await request(env, `/customers/${detail.customer.id}`);
    expect(loaded.status).toBe(200);

    const updated = await request(env, `/customers/${detail.customer.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        displayName: "Acme Workshop",
        status: "active",
        leadSource: "Architect referral",
      }),
    });
    expect(updated.status).toBe(200);
    expect((await updated.json()) as unknown).toMatchObject({
      customer: {
        display_name: "Acme Workshop",
        status: "active",
        lead_source: "Architect referral",
      },
    });

    const multiStatusList = await request(env, "/customers?workspaceId=default&status=lead,active");
    expect(multiStatusList.status).toBe(200);
    expect((await multiStatusList.json()) as Array<{ status: string }>).toEqual([
      expect.objectContaining({ status: "active" }),
    ]);

    const note = await request(env, `/customers/${detail.customer.id}/activities`, {
      method: "POST",
      headers: { "X-Debug-User-Email": "author@example.com" },
      body: JSON.stringify({
        subject: "Site visit",
        body: "## Decisions\n\n- Use **white oak**\n- Confirm hardware",
      }),
    });
    expect(note.status).toBe(201);
    const activities = (await note.json()) as Array<{
      body: string | null;
      created_by: string | null;
    }>;
    expect(activities[0]).toMatchObject({
      subject: "Site visit",
      body: "## Decisions\n\n- Use **white oak**\n- Confirm hardware",
      created_by: "author@example.com",
    });
    await mf.dispose();
  });

  it("enforces authorization and workspace isolation", async () => {
    const context = await createTestEnv();
    if (!context) return;
    const { env, db, mf } = context;
    await db
      .prepare(
        `INSERT INTO users (workspace_id,user_id,name,email,workspace_admin,system_admin) VALUES ('default','u1','One','one@example.com',0,0)`
      )
      .run();
    const forbidden = await request(env, "/customers?workspaceId=ws_unknown", {
      headers: { "X-Debug-User-Email": "one@example.com" },
    });
    expect(forbidden.status).toBe(403);
    const unknown = await request(env, "/customers?workspaceId=default", {
      headers: { "X-Debug-User-Email": "other@example.com" },
    });
    expect(unknown.status).toBe(403);
    await mf.dispose();
  });

  it("creates customer-only follow-up tasks from notes and derives the next follow-up", async () => {
    const context = await createTestEnv();
    if (!context) return;
    const { env, mf } = context;
    const created = await request(env, "/customers", {
      method: "POST",
      body: JSON.stringify({ workspaceId: "default", displayName: "Follow-up Customer" }),
    });
    const customer = (await created.json()) as { customer: { id: string } };
    const dueAt = "2030-04-10T17:30:00.000Z";

    const note = await request(env, `/customers/${customer.customer.id}/activities`, {
      method: "POST",
      body: JSON.stringify({
        subject: "Proposal call",
        body: "They will review this week.",
        followUpAt: dueAt,
        followUpDescription: "Call about the proposal",
      }),
    });
    expect(note.status).toBe(201);

    const loaded = await request(env, `/customers/${customer.customer.id}`);
    const detail = (await loaded.json()) as {
      customer: { next_follow_up_at: string | null };
      tasks: Array<{
        id: string;
        project_id: string | null;
        customer_id: string;
        status: string;
        due_at: string;
      }>;
    };
    expect(detail.customer.next_follow_up_at).toBe(dueAt);
    expect(detail.tasks[0]).toMatchObject({
      project_id: null,
      customer_id: customer.customer.id,
      status: "scheduled",
      due_at: dueAt,
    });

    const completed = await request(env, `/tasks/${detail.tasks[0].id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "done" }),
    });
    expect(completed.status).toBe(200);
    const after = (await (await request(env, `/customers/${customer.customer.id}`)).json()) as {
      customer: { next_follow_up_at: string | null };
    };
    expect(after.customer.next_follow_up_at).toBeNull();
    await mf.dispose();
  });

  it("creates, reads, edits, validates, and archives contacts", async () => {
    const context = await createTestEnv();
    if (!context) return;
    const { env, mf } = context;
    const createdCustomer = await request(env, "/customers", {
      method: "POST",
      body: JSON.stringify({ workspaceId: "default", displayName: "Smith Residence" }),
    });
    const customer = (await createdCustomer.json()) as { customer: { id: string } };

    const invalid = await request(env, `/customers/${customer.customer.id}/contacts`, {
      method: "POST",
      body: JSON.stringify({ firstName: "Alex", email: "not-an-email" }),
    });
    expect(invalid.status).toBe(400);

    const created = await request(env, `/customers/${customer.customer.id}/contacts`, {
      method: "POST",
      body: JSON.stringify({
        firstName: "Alex",
        lastName: "Smith",
        email: "alex@example.com",
        phone: "555-0100",
        role: "Homeowner",
        isPrimary: true,
      }),
    });
    expect(created.status).toBe(201);
    const detail = (await created.json()) as {
      customer: { primary_contact_id: string };
      contacts: Array<{ id: string; display_name: string; status: string; is_primary: number }>;
    };
    const contact = detail.contacts[0];
    expect(contact).toMatchObject({ display_name: "Alex Smith", status: "active", is_primary: 1 });
    expect(detail.customer.primary_contact_id).toBe(contact.id);

    const loaded = await request(env, `/customers/${customer.customer.id}/contacts/${contact.id}`);
    expect(loaded.status).toBe(200);

    const updated = await request(
      env,
      `/customers/${customer.customer.id}/contacts/${contact.id}`,
      {
        method: "PATCH",
        body: JSON.stringify({ lastName: "Jones", status: "inactive", phone: "555-0199" }),
      }
    );
    expect(updated.status).toBe(200);
    const updatedDetail = (await updated.json()) as {
      contacts: Array<{ display_name: string; email: string; phone: string; status: string }>;
    };
    expect(updatedDetail.contacts[0]).toMatchObject({
      display_name: "Alex Jones",
      email: "alex@example.com",
      phone: "555-0199",
      status: "inactive",
    });

    const archived = await request(
      env,
      `/customers/${customer.customer.id}/contacts/${contact.id}`,
      {
        method: "DELETE",
      }
    );
    expect(archived.status).toBe(200);
    const finalDetail = await request(env, `/customers/${customer.customer.id}`);
    const finalBody = (await finalDetail.json()) as {
      customer: { primary_contact_id: string | null };
      contacts: Array<{ status: string; archived_at: string | null; is_primary: number }>;
    };
    expect(finalBody.contacts[0].status).toBe("archived");
    expect(finalBody.contacts[0].archived_at).toBeTruthy();
    expect(finalBody.contacts[0].is_primary).toBe(0);
    expect(finalBody.customer.primary_contact_id).toBeNull();
    await mf.dispose();
  });

  it("stores protected note attachments and supports deprecation", async () => {
    const context = await createTestEnv({
      env: { ALLOW_R2_FALLBACK_UPLOADS: "true" },
    });
    if (!context) return;
    const { env, mf } = context;
    const created = await request(env, "/customers", {
      method: "POST",
      body: JSON.stringify({ workspaceId: "default", displayName: "Files Customer" }),
    });
    const customer = (await created.json()) as { customer: { id: string } };
    await request(env, `/customers/${customer.customer.id}/activities`, {
      method: "POST",
      body: JSON.stringify({ subject: "Selections", body: "Current selections attached." }),
    });
    const detail = (await (await request(env, `/customers/${customer.customer.id}`)).json()) as {
      activities: Array<{ id: string }>;
    };
    const activityId = detail.activities[0].id;

    const initialized = await request(env, `/customers/${customer.customer.id}/files/init`, {
      method: "POST",
      body: JSON.stringify({
        activityId,
        filename: "selections.pdf",
        contentType: "application/pdf",
        sizeBytes: 7,
      }),
    });
    expect(initialized.status).toBe(200);
    const upload = (await initialized.json()) as { uploadUrl: string; storageKey: string };
    expect(upload.storageKey).toContain(`/customers/`.slice(1));
    const uploaded = await request(env, upload.uploadUrl, {
      method: "PUT",
      headers: { "content-type": "application/pdf" },
      body: "pdfdata",
    });
    expect(uploaded.status).toBe(200);
    const completed = await request(env, `/customers/${customer.customer.id}/files/complete`, {
      method: "POST",
      body: JSON.stringify({
        activityId,
        storageKey: upload.storageKey,
        filename: "selections.pdf",
        contentType: "application/pdf",
        sizeBytes: 7,
      }),
    });
    expect(completed.status).toBe(201);
    const file = (await completed.json()) as { id: string; deprecated_at: string | null };
    expect(file.deprecated_at).toBeNull();

    const deprecated = await request(env, `/customer-files/${file.id}`, {
      method: "PATCH",
      body: JSON.stringify({ deprecated: true }),
    });
    expect(deprecated.status).toBe(200);
    expect((await deprecated.json()) as unknown).toMatchObject({
      id: file.id,
      deprecated_at: expect.any(String),
    });
    const download = await request(env, `/customer-files/${file.id}/download`);
    expect(download.status).toBe(200);
    expect((await download.json()) as unknown).toMatchObject({
      downloadUrl: `/customer-files/${file.id}/blob`,
    });
    await mf.dispose();
  });

  it("creates, reads, validates, and edits customer opportunities", async () => {
    const context = await createTestEnv();
    if (!context) return;
    const { env, mf } = context;
    const createdCustomer = await request(env, "/customers", {
      method: "POST",
      body: JSON.stringify({ workspaceId: "default", displayName: "River House" }),
    });
    const customer = (await createdCustomer.json()) as { customer: { id: string } };
    const path = `/customers/${customer.customer.id}/opportunities`;

    const invalid = await request(env, path, {
      method: "POST",
      body: JSON.stringify({ description: "Library", type: "millwork", budgetCents: -1 }),
    });
    expect(invalid.status).toBe(400);

    const created = await request(env, path, {
      method: "POST",
      body: JSON.stringify({
        description: "Built-in library wall",
        type: "cabinets",
        budgetCents: 1850000,
        status: "scoping",
      }),
    });
    expect(created.status).toBe(201);
    const detail = (await created.json()) as {
      opportunities: Array<{
        id: string;
        opportunity_type: string;
        budget_cents: number;
        status: string;
      }>;
    };
    expect(detail.opportunities[0]).toMatchObject({
      opportunity_type: "cabinets",
      budget_cents: 1850000,
      status: "scoping",
    });

    const opportunityId = detail.opportunities[0].id;
    const loaded = await request(env, `${path}/${opportunityId}`);
    expect(loaded.status).toBe(200);
    const updated = await request(env, `${path}/${opportunityId}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "quoted", budgetCents: 1925000 }),
    });
    expect(updated.status).toBe(200);
    const updatedDetail = (await updated.json()) as {
      opportunities: Array<{ description: string; budget_cents: number; status: string }>;
    };
    expect(updatedDetail.opportunities[0]).toMatchObject({
      description: "Built-in library wall",
      budget_cents: 1925000,
      status: "quoted",
    });
    await mf.dispose();
  });
});

function request(env: Parameters<typeof route>[1], path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (init.body) headers.set("content-type", "application/json");
  return route(
    new Request(`http://localhost${path}`, { ...init, headers }),
    env,
    {} as ExecutionContext
  );
}
