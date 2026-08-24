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
    const aiRun = vi.fn(async () => ({
      response: {
        subject: "Kitchen material decision",
        summary: "- Customer selected white oak.\n- Target width is 84 inches.",
        confidence: 0.97,
      },
    }));
    const context = await createTestEnv({
      env: {
        AI: { run: aiRun },
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
      .prepare(
        `SELECT c.id,c.status FROM customer_email_note_candidates c
         JOIN customer_email_messages m ON m.id=c.email_message_id
         WHERE c.ingestion_id=? AND m.sender_email='client@example.com'`
      )
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
    const repeated = await receiveCustomerEmail(env, {
      raw: forwardedMime("second-forward"),
      forwardingEmail: "owner@example.com",
      envelopeTo: "notes@in.example.com",
    });
    await processCustomerEmailIngestion(env, repeated.id);
    expect(
      await db.prepare(`SELECT COUNT(*) AS count FROM customer_email_messages`).first()
    ).toMatchObject({ count: 3 });
    expect(
      await db
        .prepare(`SELECT status FROM customer_email_ingestions WHERE id=?`)
        .bind(repeated.id)
        .first()
    ).toMatchObject({ status: "ready" });
    expect(
      await db.prepare(`SELECT COUNT(*) AS count FROM customer_email_note_candidates`).first()
    ).toMatchObject({ count: 3 });
    expect(aiRun).toHaveBeenCalledTimes(3);
    const processingList = await apiRequest(
      env,
      "/customer-emails?workspaceId=ws-email&status=ready",
      { headers: { "X-Debug-User-Email": "reviewer@example.com" } }
    );
    expect(processingList.status).toBe(200);
    expect(await processingList.json()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: received.id,
          workspace_id: "ws-email",
          customer_display_name: "Customer One",
          contact_display_name: "Client",
          status: "ready",
          candidate_count: 3,
          message_count: 3,
        }),
      ])
    );
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

  it("accepts fenced and nested AI note responses", async () => {
    const aiRun = vi.fn(async () => ({
      response:
        '```json\n{"note":{"title":"Material selections","content":["White oak fronts","Solid birch boxes"],"confidence":0.91}}\n```',
    }));
    const context = await createTestEnv({ env: { AI: { run: aiRun } } });
    if (!context) return;
    const { env, db, mf } = context;
    const now = new Date().toISOString();
    await db.batch([
      db
        .prepare(
          `INSERT INTO email_ingestion_mailboxes (id,workspace_id,address,enabled,created_at,updated_at) VALUES ('mb3','default','notes@in.example.com',1,?,?)`
        )
        .bind(now, now),
      db
        .prepare(
          `INSERT INTO email_ingestion_forwarders (id,workspace_id,email,enabled,created_at,updated_at) VALUES ('f3','default','owner@example.com',1,?,?)`
        )
        .bind(now, now),
      db
        .prepare(
          `INSERT INTO customers (id,workspace_id,display_name,status,created_at,updated_at) VALUES ('customer-nested','default','Nested Customer','lead',?,?)`
        )
        .bind(now, now),
      db
        .prepare(
          `INSERT INTO contacts (id,workspace_id,customer_id,display_name,email,is_primary,created_at,updated_at,status) VALUES ('contact-nested','default','customer-nested','Client','client@example.com',1,?,?, 'active')`
        )
        .bind(now, now),
    ]);
    const received = await receiveCustomerEmail(env, {
      raw: forwardedMime("nested-response"),
      forwardingEmail: "owner@example.com",
      envelopeTo: "notes@in.example.com",
    });

    await processCustomerEmailIngestion(env, received.id);

    expect(
      await db
        .prepare(
          `SELECT proposed_subject,proposed_body FROM customer_email_note_candidates WHERE ingestion_id=? LIMIT 1`
        )
        .bind(received.id)
        .first()
    ).toMatchObject({
      proposed_subject: "Material selections",
      proposed_body: "- White oak fronts\n- Solid birch boxes",
    });
    await mf.dispose();
  });
});

function apiRequest(env: Parameters<typeof route>[1], path: string, init: RequestInit = {}) {
  return route(new Request(`http://localhost${path}`, init), env, {} as ExecutionContext);
}

function forwardedMime(forwardId = "first-forward") {
  const boundary = "ftops-test-boundary";
  const raw = [
    "From: Owner <owner@example.com>",
    "To: notes@in.example.com",
    "Subject: Fwd: Kitchen material",
    `X-Test-Forward: ${forwardId}`,
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
    "> On Mon, Aug 17, 2026 at 9:00 AM <owner@example.com> wrote:",
    "> Earlier, the shop confirmed it could provide an 84-inch-wide cabinet.",
    ">> On Sun, Aug 16, 2026 at 8:00 AM Client <client@example.com> wrote:",
    ">>> The customer requested solid birch boxes and no particle board.",
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
