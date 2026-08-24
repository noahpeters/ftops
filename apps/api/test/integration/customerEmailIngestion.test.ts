import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExecutionContext } from "@cloudflare/workers-types";
import { createTestEnv } from "../helpers/miniflare";
import { route } from "../../src/lib/router";
import {
  processCustomerEmailIngestion,
  receiveCustomerEmail,
} from "../../src/services/customerEmailIngestion";

describe("customer email ingestion", () => {
  afterEach(() => vi.restoreAllMocks());

  it("preserves workspace isolation, extracts candidates, and attaches email files on apply", async () => {
    const queued: unknown[] = [];
    const context = await createTestEnv({
      env: {
        AI: {
          run: vi.fn(async () => ({
            response: JSON.stringify({
              candidates: [
                {
                  category: "material",
                  subject: "Material preference",
                  body: "Customer selected white oak.",
                  confidence: 0.97,
                  evidence: "We have decided on white oak.",
                },
              ],
            }),
          })),
        },
        EVENT_QUEUE: { send: vi.fn(async (message: unknown) => queued.push(message)) },
      },
    });
    if (!context) return;
    const { env, db, mf } = context;
    const now = new Date().toISOString();
    await db.batch([
      db
        .prepare(
          `INSERT INTO workspaces (id,name,created_at,updated_at) VALUES ('ws-email','Email Workspace',?,?)`
        )
        .bind(now, now),
      db
        .prepare(
          `INSERT INTO workspaces (id,name,created_at,updated_at) VALUES ('ws-other','Other Workspace',?,?)`
        )
        .bind(now, now),
      db
        .prepare(
          `INSERT INTO email_ingestion_mailboxes (id,workspace_id,address,enabled,created_at,updated_at) VALUES ('mb','ws-email','notes@in.example.com',1,?,?)`
        )
        .bind(now, now),
      db
        .prepare(
          `INSERT INTO email_ingestion_forwarders (id,workspace_id,email,enabled,created_at,updated_at) VALUES ('f1','ws-email','owner@example.com',1,?,?)`
        )
        .bind(now, now),
      db
        .prepare(
          `INSERT INTO customers (id,workspace_id,display_name,status,created_at,updated_at) VALUES ('customer-email','ws-email','Customer One','lead',?,?)`
        )
        .bind(now, now),
      db
        .prepare(
          `INSERT INTO contacts (id,workspace_id,customer_id,display_name,email,is_primary,created_at,updated_at,status) VALUES ('contact-email','ws-email','customer-email','Client','client@example.com',1,?,?, 'active')`
        )
        .bind(now, now),
      db
        .prepare(
          `INSERT INTO customers (id,workspace_id,display_name,status,created_at,updated_at) VALUES ('customer-other','ws-other','Other Customer','lead',?,?)`
        )
        .bind(now, now),
      db
        .prepare(
          `INSERT INTO contacts (id,workspace_id,customer_id,display_name,email,is_primary,created_at,updated_at,status) VALUES ('contact-other','ws-other','customer-other','Same Client','client@example.com',1,?,?, 'active')`
        )
        .bind(now, now),
    ]);

    const raw = forwardedMime();
    const received = await receiveCustomerEmail(env, {
      raw,
      forwardingEmail: "owner@example.com",
      envelopeTo: "notes@in.example.com",
    });
    expect(received).toMatchObject({ status: "queued", duplicate: false });
    expect(queued).toHaveLength(1);
    await processCustomerEmailIngestion(env, received.id);

    const ingestion = await db
      .prepare(
        `SELECT workspace_id,customer_id,contact_id,status FROM customer_email_ingestions WHERE id=?`
      )
      .bind(received.id)
      .first();
    expect(ingestion).toMatchObject({
      workspace_id: "ws-email",
      customer_id: "customer-email",
      contact_id: "contact-email",
      status: "ready",
    });
    const candidate = await db
      .prepare(`SELECT id,status FROM customer_email_note_candidates WHERE ingestion_id=?`)
      .bind(received.id)
      .first<{ id: string; status: string }>();
    expect(candidate?.status).toBe("pending");
    expect(
      await db
        .prepare(`SELECT original_filename FROM customer_email_attachments WHERE ingestion_id=?`)
        .bind(received.id)
        .first()
    ).toMatchObject({ original_filename: "dimensions.txt" });

    const applied = await apiRequest(env, `/customer-emails/candidates/${candidate!.id}/apply`, {
      method: "POST",
      headers: { "X-Debug-User-Email": "reviewer@example.com" },
    });
    expect(applied.status).toBe(200);
    const activity = await db
      .prepare(
        `SELECT id,source,body,created_by FROM customer_activities WHERE customer_id='customer-email'`
      )
      .first<{ id: string; body: string }>();
    expect(activity).toMatchObject({
      source: "customer_email",
      created_by: "reviewer@example.com",
    });
    expect(String(activity?.body)).toContain(`Source ingestion: ${received.id}`);
    expect(
      await db
        .prepare(
          `SELECT original_filename,activity_id FROM customer_note_files WHERE customer_id='customer-email'`
        )
        .first()
    ).toMatchObject({ original_filename: "dimensions.txt", activity_id: activity?.id });
    expect(
      await db
        .prepare(
          `SELECT COUNT(*) AS count FROM customer_activities WHERE customer_id='customer-other'`
        )
        .first()
    ).toMatchObject({ count: 0 });
    await mf.dispose();
  });

  it("requires a mailbox-scoped forwarding authorization", async () => {
    const context = await createTestEnv();
    if (!context) return;
    const { env, db, mf } = context;
    const now = new Date().toISOString();
    await db
      .prepare(
        `INSERT INTO email_ingestion_mailboxes (id,workspace_id,address,enabled,created_at,updated_at) VALUES ('mb2','default','notes@in.example.com',1,?,?)`
      )
      .bind(now, now)
      .run();
    await expect(
      receiveCustomerEmail(env, {
        raw: forwardedMime(),
        forwardingEmail: "unauthorized@example.com",
        envelopeTo: "notes@in.example.com",
      })
    ).rejects.toThrow("email_forwarder_not_authorized");
    await mf.dispose();
  });
});

function apiRequest(env: Parameters<typeof route>[1], path: string, init: RequestInit = {}) {
  return route(new Request(`http://localhost${path}`, init), env, {} as ExecutionContext);
}

function forwardedMime() {
  const boundary = "ftops-test-boundary";
  const raw = [
    "From: Owner <owner@example.com>",
    "To: notes@in.example.com",
    "Subject: Fwd: Kitchen material",
    `Content-Type: multipart/mixed; boundary=\"${boundary}\"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=utf-8",
    "",
    "> Begin forwarded message:",
    "> From: Client <client@example.com>",
    "> Date: Tue, 18 Aug 2026 10:00:00 -0500",
    "> Subject: Kitchen material",
    "",
    "We have decided on white oak.",
    `--${boundary}`,
    'Content-Type: text/plain; name="dimensions.txt"',
    'Content-Disposition: attachment; filename="dimensions.txt"',
    "Content-Transfer-Encoding: base64",
    "",
    "ODQgaW5jaGVzIHdpZGU=",
    `--${boundary}--`,
    "",
  ].join("\r\n");
  return new TextEncoder().encode(raw).buffer;
}
