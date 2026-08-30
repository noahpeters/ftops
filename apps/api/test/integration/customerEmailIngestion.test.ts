import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExecutionContext } from "@cloudflare/workers-types";
import { createTestEnv } from "../helpers/miniflare";
import { route } from "../../src/lib/router";
import {
  processCustomerEmailIngestion,
  receiveCustomerEmail,
  recoverStaleCustomerEmailIngestions,
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

  it.each([
    ["a forwarded sent message", sentForwardMime(), "owner@example.com"],
    ["an attached RFC 822 message", attachedForwardMime(), "owner@example.com"],
    ["a live message with the notes mailbox CC'd", liveCustomerMime("cc"), "client@example.com"],
    ["a live message with the notes mailbox BCC'd", liveCustomerMime("bcc"), "client@example.com"],
  ])("matches the customer for %s", async (_scenario, raw, envelopeFrom) => {
    const aiRun = vi.fn(async () => ({
      response: {
        subject: "Project update",
        summary: "- Confirmed project detail.",
        confidence: 1,
      },
    }));
    const context = await createTestEnv({ env: { AI: { run: aiRun } } });
    if (!context) return;
    const { env, db, mf } = context;
    const now = new Date().toISOString();
    await db.batch([
      db
        .prepare(
          `INSERT INTO email_ingestion_mailboxes (id,workspace_id,address,enabled,created_at,updated_at) VALUES ('matching-mb','default','notes@ops.from-trees.com',1,?,?)`
        )
        .bind(now, now),
      db
        .prepare(
          `INSERT INTO email_ingestion_forwarders (id,workspace_id,email,enabled,created_at,updated_at) VALUES ('matching-forwarder','default','owner@example.com',1,?,?)`
        )
        .bind(now, now),
      db
        .prepare(
          `INSERT INTO customers (id,workspace_id,display_name,status,created_at,updated_at) VALUES ('matching-customer','default','Matching Customer','lead',?,?)`
        )
        .bind(now, now),
      db
        .prepare(
          `INSERT INTO contacts (id,workspace_id,customer_id,display_name,email,is_primary,created_at,updated_at,status) VALUES ('matching-contact','default','matching-customer','Client','client@example.com',1,?,?, 'active')`
        )
        .bind(now, now),
    ]);

    const received = await receiveCustomerEmail(env, {
      raw,
      forwardingEmail: envelopeFrom,
      envelopeTo: "notes@ops.from-trees.com",
    });
    await processCustomerEmailIngestion(env, received.id);

    expect(
      await db
        .prepare(
          `SELECT customer_id,contact_id,status,failure_reason FROM customer_email_ingestions WHERE id=?`
        )
        .bind(received.id)
        .first()
    ).toMatchObject({
      customer_id: "matching-customer",
      contact_id: "matching-contact",
      status: "ready",
      failure_reason: null,
    });
    expect(aiRun).toHaveBeenCalled();
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

  it("preserves useful content from an unexpected AI response shape", async () => {
    const aiRun = vi.fn(async () => ({
      response: {
        email_summary: {
          overview: "Customer finalized the kitchen materials.",
          selections: ["White oak fronts", "Solid birch boxes"],
        },
        confidence: 0.88,
      },
    }));
    const context = await createTestEnv({ env: { AI: { run: aiRun } } });
    if (!context) return;
    const { env, db, mf } = context;
    const now = new Date().toISOString();
    await db.batch([
      db
        .prepare(
          `INSERT INTO email_ingestion_mailboxes (id,workspace_id,address,enabled,created_at,updated_at) VALUES ('mb4','default','notes@in.example.com',1,?,?)`
        )
        .bind(now, now),
      db
        .prepare(
          `INSERT INTO email_ingestion_forwarders (id,workspace_id,email,enabled,created_at,updated_at) VALUES ('f4','default','owner@example.com',1,?,?)`
        )
        .bind(now, now),
      db
        .prepare(
          `INSERT INTO customers (id,workspace_id,display_name,status,created_at,updated_at) VALUES ('customer-fallback','default','Fallback Customer','lead',?,?)`
        )
        .bind(now, now),
      db
        .prepare(
          `INSERT INTO contacts (id,workspace_id,customer_id,display_name,email,is_primary,created_at,updated_at,status) VALUES ('contact-fallback','default','customer-fallback','Client','client@example.com',1,?,?, 'active')`
        )
        .bind(now, now),
    ]);
    const received = await receiveCustomerEmail(env, {
      raw: forwardedMime("unexpected-response"),
      forwardingEmail: "owner@example.com",
      envelopeTo: "notes@in.example.com",
    });

    await processCustomerEmailIngestion(env, received.id);

    const candidate = await db
      .prepare(
        `SELECT proposed_subject,proposed_body FROM customer_email_note_candidates WHERE ingestion_id=? LIMIT 1`
      )
      .bind(received.id)
      .first<{ proposed_subject: string; proposed_body: string }>();
    expect(candidate?.proposed_subject).toBe("Kitchen material");
    expect(candidate?.proposed_body).toContain("Customer finalized the kitchen materials.");
    expect(candidate?.proposed_body).toContain("White oak fronts");
    expect(candidate?.proposed_body).toContain("Solid birch boxes");
    await mf.dispose();
  });

  it("streams a 12 MiB attachment into R2 without buffering it in the parsed email", async () => {
    const aiRun = vi.fn(async () => ({
      response: {
        subject: "Large drawing",
        summary: "- Customer supplied a drawing.",
        confidence: 1,
      },
    }));
    const context = await createTestEnv({ env: { AI: { run: aiRun } } });
    if (!context) return;
    const { env, db, mf } = context;
    const now = new Date().toISOString();
    await db.batch([
      db
        .prepare(
          `INSERT INTO email_ingestion_mailboxes (id,workspace_id,address,enabled,created_at,updated_at) VALUES ('large-mb','default','notes@in.example.com',1,?,?)`
        )
        .bind(now, now),
      db
        .prepare(
          `INSERT INTO email_ingestion_forwarders (id,workspace_id,email,enabled,created_at,updated_at) VALUES ('large-forwarder','default','owner@example.com',1,?,?)`
        )
        .bind(now, now),
      db
        .prepare(
          `INSERT INTO customers (id,workspace_id,display_name,status,created_at,updated_at) VALUES ('large-customer','default','Large Customer','lead',?,?)`
        )
        .bind(now, now),
      db
        .prepare(
          `INSERT INTO contacts (id,workspace_id,customer_id,display_name,email,is_primary,created_at,updated_at,status) VALUES ('large-contact','default','large-customer','Client','client@example.com',1,?,?, 'active')`
        )
        .bind(now, now),
    ]);

    const received = await receiveCustomerEmail(env, {
      raw: largeAttachmentMime(12 * 1024 * 1024),
      forwardingEmail: "owner@example.com",
      envelopeTo: "notes@in.example.com",
    });
    await processCustomerEmailIngestion(env, received.id);

    expect(
      await db
        .prepare(`SELECT status,failure_reason FROM customer_email_ingestions WHERE id=?`)
        .bind(received.id)
        .first()
    ).toMatchObject({ status: "ready", failure_reason: null });
    const attachment = await db
      .prepare(
        `SELECT size_bytes,sha256,storage_key FROM customer_email_attachments WHERE ingestion_id=?`
      )
      .bind(received.id)
      .first<{ size_bytes: number; sha256: string; storage_key: string }>();
    expect(attachment).toMatchObject({ size_bytes: 12 * 1024 * 1024 });
    expect(attachment?.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect((await env.R2_CUSTOMER_EMAILS_BUCKET.head(attachment!.storage_key))?.size).toBe(
      12 * 1024 * 1024
    );
    await mf.dispose();
  }, 30_000);

  it("surfaces and requeues stale processing records", async () => {
    const queued: unknown[] = [];
    const context = await createTestEnv({
      env: { EVENT_QUEUE: { send: vi.fn(async (message: unknown) => queued.push(message)) } },
    });
    if (!context) return;
    const { env, db, mf } = context;
    const now = new Date("2026-08-30T20:00:00.000Z");
    await db
      .prepare(
        `INSERT INTO customer_email_ingestions
          (id,workspace_id,forwarding_email,envelope_to,raw_storage_key,raw_sha256,raw_size_bytes,status,received_at,created_at,updated_at)
         VALUES ('stale-email','default','owner@example.com','notes@in.example.com','raw/stale','stale-hash',100,'processing',?,?,?)`
      )
      .bind(now.toISOString(), now.toISOString(), "2000-01-01T00:00:00.000Z")
      .run();

    const attention = await apiRequest(
      env,
      "/customer-emails?workspaceId=default&status=attention",
      {
        headers: { "X-Debug-User-Email": "reviewer@example.com" },
      }
    );
    expect(await attention.json()).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "stale-email", status: "processing" })])
    );
    expect(await recoverStaleCustomerEmailIngestions(env, now.getTime())).toBe(1);
    expect(
      await db
        .prepare(
          `SELECT status,failure_reason FROM customer_email_ingestions WHERE id='stale-email'`
        )
        .first()
    ).toMatchObject({ status: "queued", failure_reason: "interrupted_processing_requeued" });
    expect(queued).toEqual([
      expect.objectContaining({
        type: "customer.email.extract",
        payload: { ingestionId: "stale-email" },
      }),
    ]);
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

function sentForwardMime() {
  return textMime([
    "From: Owner <owner@example.com>",
    "To: notes@ops.from-trees.com",
    "Subject: Fwd: Project update",
    "",
    "Begin forwarded message:",
    "",
    "From: Owner <owner@example.com>",
    "Date: Tue, 18 Aug 2026 10:00:00 -0500",
    "Subject: Project update",
    "To: Client <client@example.com>",
    "",
    "Here is the update I sent to the customer.",
  ]);
}

function attachedForwardMime() {
  return textMime([
    "From: Owner <owner@example.com>",
    "To: notes@ops.from-trees.com",
    "Subject: Fwd: Project update",
    "MIME-Version: 1.0",
    'Content-Type: multipart/mixed; boundary="attached-message"',
    "",
    "--attached-message",
    "Content-Type: text/plain; charset=utf-8",
    "",
    "Forwarded customer message attached.",
    "--attached-message",
    'Content-Type: message/rfc822; name="original.eml"',
    'Content-Disposition: attachment; filename="original.eml"',
    "",
    "From: Client <client@example.com>",
    "To: Owner <owner@example.com>",
    "Subject: Project update",
    "",
    "The attached customer message confirms the project detail.",
    "--attached-message--",
    "",
  ]);
}

function largeAttachmentMime(size: number) {
  const boundary = "ftops-large-boundary";
  const encoded = Buffer.from(new Uint8Array(size).fill(65))
    .toString("base64")
    .replace(/.{76}/g, "$&\r\n");
  return new TextEncoder().encode(
    [
      "From: Client <client@example.com>",
      "To: notes@in.example.com",
      "Subject: Large drawing",
      "MIME-Version: 1.0",
      `Content-Type: multipart/mixed; boundary="${boundary}"`,
      "",
      `--${boundary}`,
      "Content-Type: text/plain; charset=utf-8",
      "",
      "Attached is the drawing.",
      `--${boundary}`,
      'Content-Type: application/octet-stream; name="drawing.bin"',
      'Content-Disposition: attachment; filename="drawing.bin"',
      "Content-Transfer-Encoding: base64",
      "",
      encoded,
      `--${boundary}--`,
      "",
    ].join("\r\n")
  ).buffer;
}

function liveCustomerMime(mode: "cc" | "bcc") {
  return textMime([
    "From: Client <client@example.com>",
    "To: Owner <owner@example.com>",
    ...(mode === "cc" ? ["Cc: notes@ops.from-trees.com"] : []),
    "Subject: Project update",
    "",
    "Here is a live customer update.",
  ]);
}

function textMime(lines: string[]) {
  return new TextEncoder().encode(
    [...lines.slice(0, 3), "Content-Type: text/plain; charset=utf-8", ...lines.slice(3), ""].join(
      "\r\n"
    )
  ).buffer;
}
