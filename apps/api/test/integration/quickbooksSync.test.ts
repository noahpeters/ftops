import { describe, expect, it } from "vitest";
import { createTestEnv } from "../helpers/miniflare";
import { persistSyncError, upsertQboEntity } from "../../src/services/quickbooks";

const integration = {
  id: "qbo_1",
  workspace_id: "default",
  environment: "sandbox",
  external_account_id: "realm_1",
  secrets_key_id: "v1",
  secrets_ciphertext: "unused",
};

describe("QuickBooks mirrors", () => {
  it("synchronizes customer, estimate, and invoice idempotently", async () => {
    const context = await createTestEnv();
    if (!context) return;
    const { env, db, mf } = context;
    const metadata = { LastUpdatedTime: "2026-07-19T12:00:00Z" };
    const customer = await upsertQboEntity(env, {
      integration,
      entityType: "customer",
      externalId: "c1",
      entity: {
        Id: "c1",
        SyncToken: "2",
        DisplayName: "Quick Customer",
        MetaData: metadata,
        PrimaryEmailAddr: { Address: "quick@example.com" },
      },
    });
    const duplicate = await upsertQboEntity(env, {
      integration,
      entityType: "customer",
      externalId: "c1",
      entity: { Id: "c1", DisplayName: "Older name", MetaData: metadata },
    });
    expect(duplicate.duplicate).toBe(true);

    await upsertQboEntity(env, {
      integration,
      entityType: "estimate",
      externalId: "e1",
      entity: {
        Id: "e1",
        DocNumber: "EST-1",
        CustomerRef: { value: "c1" },
        TotalAmt: 120,
        MetaData: metadata,
      },
    });
    await upsertQboEntity(env, {
      integration,
      entityType: "invoice",
      externalId: "i1",
      entity: {
        Id: "i1",
        DocNumber: "INV-1",
        CustomerRef: { value: "c1" },
        TotalAmt: 120,
        Balance: 40,
        MetaData: metadata,
      },
    });
    expect(
      (await db.prepare(`SELECT customer_id,total FROM estimates WHERE doc_number='EST-1'`).first())
        ?.customer_id
    ).toBe(customer.localEntityId);
    expect(
      (await db.prepare(`SELECT balance FROM invoices WHERE doc_number='INV-1'`).first())?.balance
    ).toBe(40);
    await mf.dispose();
  });

  it("persists stale-token conflicts", async () => {
    const context = await createTestEnv();
    if (!context) return;
    const { env, db, mf } = context;
    await upsertQboEntity(env, {
      integration,
      entityType: "customer",
      externalId: "c2",
      entity: { Id: "c2", DisplayName: "Conflict", MetaData: { LastUpdatedTime: "2026-07-19" } },
    });
    const error = Object.assign(new Error("quickbooks_http_409"), { status: 409 });
    await persistSyncError(env, integration, "customer", "c2", error);
    const mapping = await db
      .prepare(`SELECT sync_status,last_error FROM external_entities WHERE external_id='c2'`)
      .first<{ sync_status: string; last_error: string }>();
    expect(mapping).toMatchObject({ sync_status: "conflict", last_error: "quickbooks_http_409" });
    await mf.dispose();
  });
});
