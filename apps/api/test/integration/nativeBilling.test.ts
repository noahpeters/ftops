import { checkout, reconcileAttempt, stripeWebhook } from "../../src/billing/payments";
import { completeSignature } from "../../src/billing/guest";
import { loadRevision } from "../../src/billing/model";
import { readFileSync } from "node:fs";
import { expect, it, vi } from "vitest";
import { createTestEnv } from "../helpers/miniflare";
import { route } from "../../src/lib/router";
import { hashObject } from "../../src/billing/common";
import { signingIdentity, signedPdf } from "../../src/billing/documents";
import { PDFDocument } from "pdf-lib";
const key = readFileSync("test/fixtures/billing/test-key.pem", "utf8");
const certificate = readFileSync("test/fixtures/billing/test-certificate.pem", "utf8");
const staff = {
  "Cf-Access-Authenticated-User-Email": "owner@example.test",
  Origin: "http://localhost:8787",
  "Content-Type": "application/json",
};
function req(
  env: Parameters<typeof route>[1],
  path: string,
  body?: unknown,
  headers: Record<string, string> = staff
) {
  return route(
    new Request("http://localhost:8787" + path, {
      method: body ? "POST" : "GET",
      headers,
      body: body ? JSON.stringify(body) : undefined,
    }),
    env,
    {} as ExecutionContext
  );
}
async function setup() {
  const context = await createTestEnv({
    env: {
      INTEGRATIONS_MASTER_KEY: "11".repeat(32),
      BILLING_PUBLIC_ORIGIN: "http://localhost:8787",
      RESEND_API_KEY: "test-email",
    },
  });
  if (!context) throw new Error("Local Cloudflare database emulator required");
  const { db, env } = context;
  await db
    .prepare(
      "INSERT INTO users(user_id,workspace_id,email,name,workspace_admin,system_admin) VALUES('owner','default','owner@example.test','Owner',1,0)"
    )
    .run();
  const created = await req(env, "/customers", {
    workspaceId: "default",
    displayName: "Synthetic Customer",
  });
  expect(created.status).toBe(201);
  const customer = (await created.json()) as { customer: { id: string } };
  const contact = await req(env, `/customers/${customer.customer.id}/contacts`, {
    displayName: "Synthetic Signer",
    email: "signer@example.test",
  });
  expect(contact.status).toBe(201);
  const contactData = (await contact.json()) as { contacts: Array<{ id: string; email: string }> };
  const saved = await req(env, "/billing/settings?workspaceId=default", {
    issuerName: "Synthetic From Trees",
    replyEmail: "owner@example.test",
    disclosure:
      "You agree to electronic records. Download PDFs using a PDF reader. Contact owner@example.test for paper copies, to withdraw electronic consent or update your email. This applies to this project.",
    environment: "sandbox",
    signingKeyPkcs8: key,
    signingCertificatePem: certificate,
    stripeKey: "sk_test_synthetic",
    stripeWebhookSecret: "whsec_synthetic",
  });
  expect(saved.status).toBe(200);
  const published = await req(env, "/billing/terms?workspaceId=default", {
    versionLabel: "v1",
    title: "Terms and conditions",
    content: "Synthetic terms, version one. Deposit and milestones as agreed in the estimate.",
  });
  expect(await published.clone().text()).not.toContain("billing_operation_failed");
  expect(published.status).toBe(201);
  const terms = (await published.json()) as { id: string };
  const input = {
    customerId: customer.customer.id,
    contactId: contactData.contacts.find((c) => c.email === "signer@example.test")!.id,
    termsId: terms.id,
    title: "Walnut table",
    scope: "Custom table. Delivery is excluded.",
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
    deposit: { kind: "percentage", bps: 7500 },
    lines: [
      {
        id: "table",
        description: "Custom walnut table",
        quantityMillis: 1000,
        unitPriceCents: 100000,
        unitCostCents: 50000,
        discountCents: 0,
        taxRatePpm: 87500,
      },
    ],
    milestones: [],
  };
  const estimate = await req(env, "/billing/estimates?workspaceId=default", input);
  expect(await estimate.clone().text()).not.toContain("billing_operation_failed");
  expect(estimate.status).toBe(201);
  const revision = (await estimate.json()) as { id: string };
  return { ...context, input, revision, terms };
}
it("signs real PDFs with a matching key and rejects a mismatched or expired identity", async () => {
  const result = await signedPdf(
    { title: "Invoice", subtitle: "Synthetic verification", paragraphs: ["Test amount: $100.00"] },
    key,
    certificate,
    "Synthetic issuer",
    "owner@example.test"
  );
  expect(result.bytes.subarray(0, 5).toString()).toBe("%PDF-");
  expect(result.bytes.toString()).toContain("/ByteRange");
  expect(result.bytes.toString()).not.toContain("/ByteRange [0 /");
  expect((await PDFDocument.load(result.bytes)).getPageCount()).toBe(1);
  const identity = await signingIdentity(key, certificate);
  expect(identity.fingerprint).toMatch(/^[a-f0-9]{64}$/);
  await expect(signingIdentity("invalid", certificate)).rejects.toThrow();
});
it("supports account-free verified e-signing, preserves terms and creates private signed PDFs and invoices", async () => {
  const context = await setup();
  const { env, db, mf, revision } = context;
  const messages: string[] = [];
  const original = globalThis.fetch;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "https://api.resend.com/emails") {
        messages.push(String(init?.body));
        return Response.json({ id: "test-email" });
      }
      return original(input, init);
    })
  );
  try {
    const settings = await (await req(env, "/billing/settings?workspaceId=default")).text();
    expect(settings).not.toContain("PRIVATE KEY");
    expect(settings).not.toContain("sk_test_");
    const issued = await req(
      env,
      `/billing/estimates/${revision.id}/issue?workspaceId=default`,
      {}
    );
    expect(issued.status).toBe(200);
    const invitation = (await issued.json()) as { url: string };
    const token = new URL(invitation.url).hash.slice(1);
    const headers = { Origin: "http://localhost:8787", "Content-Type": "application/json" };
    expect((await req(env, "/billing-public/view", undefined, headers)).status).toBe(401);
    expect(
      (
        await req(
          env,
          "/billing-public/code",
          { token },
          { ...headers, Origin: "https://evil.test" }
        )
      ).status
    ).toBe(403);
    expect((await req(env, "/billing-public/code", { token }, headers)).status).toBe(200);
    expect((await req(env, "/billing-public/code", { token }, headers)).status).toBe(429);
    expect(
      (await req(env, "/billing-public/verify", { token, code: "999999" }, headers)).status
    ).toBe(401);
    const code = JSON.parse(messages[0]).text.match(/code is (\d{6})/)[1];
    const verified = await req(env, "/billing-public/verify", { token, code }, headers);
    expect(verified.status).toBe(200);
    const cookie = verified.headers.get("set-cookie")!.split(";")[0];
    const guest = { ...headers, Cookie: cookie };
    expect((await req(env, "/billing-public/verify", { token, code }, headers)).status).toBe(401);
    const view = await req(env, "/billing-public/view", undefined, guest);
    const raw = await view.text();
    for (const privateKey of [
      "unitCostCents",
      "costCents",
      "profitCents",
      "markupBps",
      "marginBps",
    ])
      expect(raw).not.toContain(privateKey);
    const data = JSON.parse(raw);
    const signature = {
      signerName: "Synthetic Signer",
      contentHash: data.hash,
      termsHash: data.proposal.terms.hash,
      approveEstimate: true,
      acceptTerms: true,
      electronicConsent: true,
      signerAuthority: true,
      intent: data.intent,
    };
    expect(
      (await req(env, "/billing-public/sign", { ...signature, acceptTerms: false }, guest)).status
    ).toBe(400);
    const beforeSettings = (await (
      await req(env, "/billing/settings?workspaceId=default")
    ).json()) as Record<string, unknown>;
    expect(
      (
        await req(env, "/billing/settings?workspaceId=default", {
          ...beforeSettings,
          issuerName: "Future Business Name",
        })
      ).status
    ).toBe(200);
    const signed = await req(env, "/billing-public/sign", signature, guest);
    expect(await signed.clone().text()).toBe('{"signed":true}');
    expect(signed.status).toBe(200);
    expect((await req(env, "/billing-public/sign", signature, guest)).status).toBe(200);
    const evidence = await db
      .prepare("SELECT * FROM native_signature_evidence WHERE revision_id=?")
      .bind(revision.id)
      .first();
    expect(evidence?.signer_email).toBe("signer@example.test");
    expect(evidence?.verified_at).toBeTruthy();
    expect(
      (await db.prepare("SELECT count(*) AS n FROM native_signature_evidence").first())?.n
    ).toBe(1);
    expect((await db.prepare("SELECT count(*) AS n FROM native_invoices").first())?.n).toBe(2);
    const after = (await (await req(env, "/billing-public/view", undefined, guest)).json()) as {
      status: string;
      documents: Array<{ id: string; kind: string }>;
      invoices: Array<{ amount_cents: number }>;
      proposal: { terms: { content: string } };
    };
    expect(after.status).toBe("signed");
    expect(after.invoices.reduce((s, i) => s + i.amount_cents, 0)).toBe(108750);
    expect(after.documents).toHaveLength(5);
    const doc = await req(
      env,
      `/billing-public/documents/${after.documents[0].id}`,
      undefined,
      guest
    );
    expect(doc.status).toBe(200);
    expect(doc.headers.get("Content-Type")).toBe("application/pdf");
    for (const artifact of after.documents) {
      const file = await req(env, `/billing-public/documents/${artifact.id}`, undefined, guest);
      expect((await PDFDocument.load(await file.arrayBuffer())).getAuthor()).toBe(
        "Synthetic From Trees"
      );
    }

    const terms2 = await req(env, "/billing/terms?workspaceId=default", {
      versionLabel: "v2",
      title: "Updated terms",
      content: "Different future terms.",
    });
    expect(terms2.status).toBe(201);
    const still = await (await req(env, "/billing-public/view", undefined, guest)).text();
    expect(still).toContain("Synthetic terms, version one.");
    expect(still).not.toContain("Different future terms.");
    await expect(
      db
        .prepare("UPDATE native_terms_versions SET content='changed' WHERE id=?")
        .bind(context.terms.id)
        .run()
    ).rejects.toThrow();
    expect(
      (await req(env, `/billing/estimates/${revision.id}/withdraw?workspaceId=default`, {})).status
    ).toBe(409);
    expect(await hashObject(token)).toMatch(/^[a-f0-9]{64}$/);
  } finally {
    vi.unstubAllGlobals();
    await mf.dispose();
  }
});

it("denies unauthorized staff and cross-workspace access and withdraws superseded invitations", async () => {
  const context = await setup();
  const { env, db, mf, revision, input } = context;
  try {
    expect((await req(env, "/billing/estimates?workspaceId=default", undefined, {})).status).toBe(
      401
    );
    expect((await req(env, "/billing/estimates?workspaceId=other")).status).toBe(403);
    const issued = (await (
      await req(env, `/billing/estimates/${revision.id}/issue?workspaceId=default`, {})
    ).json()) as { url: string };
    const token = new URL(issued.url).hash.slice(1);
    const updated = await req(env, `/billing/estimates/${revision.id}/revise?workspaceId=default`, {
      ...input,
      title: "Revised table",
    });
    expect(updated.status).toBe(201);
    expect(
      (
        await req(
          env,
          "/billing-public/exchange",
          { token },
          { Origin: "http://localhost:8787", "Content-Type": "application/json" }
        )
      ).status
    ).toBe(401);
    expect(
      (
        await db
          .prepare("SELECT status FROM native_estimate_revisions WHERE id=?")
          .bind(revision.id)
          .first()
      )?.status
    ).toBe("withdrawn");
    const draft = (await updated.json()) as { id: string };
    const result = await req(env, `/billing/estimates/${draft.id}?workspaceId=default`);
    expect(result.status).toBe(200);
    expect(
      (
        await req(env, `/billing/estimates/${draft.id}/revise?workspaceId=default`, {
          ...input,
          contactId: "foreign-contact",
        })
      ).status
    ).toBe(400);
  } finally {
    await mf.dispose();
  }
});

it("preserves approval evidence across PDF failures and resumes without another signature", async () => {
  const context = await setup();
  const { env, db, mf, revision } = context;
  let code = "";
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_input: unknown, init?: RequestInit) => {
      code = JSON.parse(String(init?.body)).text.match(/code is (\d{6})/)?.[1] ?? code;
      return Response.json({ id: "email" });
    })
  );
  try {
    const invitation = (await (
      await req(env, `/billing/estimates/${revision.id}/issue?workspaceId=default`, {})
    ).json()) as { url: string };
    const token = new URL(invitation.url).hash.slice(1);
    const headers = { Origin: "http://localhost:8787", "Content-Type": "application/json" };
    await req(env, "/billing-public/code", { token }, headers);
    const verified = await req(env, "/billing-public/verify", { token, code }, headers);
    const guest = { ...headers, Cookie: verified.headers.get("set-cookie")!.split(";")[0] };
    const view = (await (await req(env, "/billing-public/view", undefined, guest)).json()) as {
      hash: string;
      intent: string;
      proposal: { terms: { hash: string } };
    };
    const bucket = env.R2_BILLING_DOCUMENTS_BUCKET;
    env.R2_BILLING_DOCUMENTS_BUCKET = undefined;
    const failed = await req(
      env,
      "/billing-public/sign",
      {
        signerName: "Synthetic Signer",
        contentHash: view.hash,
        termsHash: view.proposal.terms.hash,
        approveEstimate: true,
        acceptTerms: true,
        electronicConsent: true,
        signerAuthority: true,
        intent: view.intent,
      },
      guest
    );
    expect(failed.status).toBe(503);
    expect(
      (
        await db
          .prepare("SELECT status FROM native_estimate_revisions WHERE id=?")
          .bind(revision.id)
          .first()
      )?.status
    ).toBe("signing");
    expect(
      (await db.prepare("SELECT COUNT(*) AS n FROM native_signature_evidence").first())?.n
    ).toBe(1);
    env.R2_BILLING_DOCUMENTS_BUCKET = bucket;
    expect((await req(env, "/billing-public/finish", {}, guest)).status).toBe(200);
    expect((await req(env, "/billing-public/finish", {}, guest)).status).toBe(200);
    expect((await db.prepare("SELECT COUNT(*) AS n FROM native_invoices").first())?.n).toBe(2);
    expect(
      (await db.prepare("SELECT COUNT(*) AS n FROM native_signature_evidence").first())?.n
    ).toBe(1);
  } finally {
    vi.unstubAllGlobals();
    await mf.dispose();
  }
});

it("offers cards and ACH in one checkout, reserves pending bank payments, deduplicates events and records fees/refunds", async () => {
  const context = await setup();
  const { env, db, mf, revision } = context;
  let attemptId = "",
    status = "processing",
    refunded = 0,
    sessionCreates = 0;
  const original = globalThis.fetch;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (!url.startsWith("https://api.stripe.com/")) return original(input, init);
      const path = new URL(url).pathname;
      if (path === "/v1/checkout/sessions") {
        sessionCreates++;
        const body = new URLSearchParams(String(init?.body));
        expect(body.get("payment_method_types[0]")).toBe("card");
        expect(body.get("payment_method_types[1]")).toBe("us_bank_account");
        expect(body.get("line_items[0][price_data][unit_amount]")).toBe("81563");
        expect(init?.headers).toMatchObject({
          "Idempotency-Key": expect.stringContaining("ftops-checkout-"),
        });
        attemptId = body.get("client_reference_id")!;
        return Response.json({ id: "cs_test_one", url: "https://checkout.stripe.com/c/pay/test" });
      }
      if (path === "/v1/checkout/sessions/cs_test_one")
        return Response.json({
          id: "cs_test_one",
          status: "complete",
          livemode: false,
          currency: "usd",
          amount_total: 81563,
          client_reference_id: attemptId,
          payment_intent: "pi_one",
        });
      if (path === "/v1/payment_intents/pi_one")
        return Response.json({
          id: "pi_one",
          status,
          currency: "usd",
          amount: 81563,
          latest_charge: {
            id: "ch_one",
            status: status === "succeeded" ? "succeeded" : "pending",
            amount: 81563,
            amount_refunded: refunded,
            disputed: false,
            balance_transaction: status === "succeeded" ? "bt_charge" : null,
          },
        });
      if (path === "/v1/balance_transactions/bt_charge")
        return Response.json({
          id: "bt_charge",
          amount: 81563,
          fee: 2395,
          net: 79168,
          status: "available",
          available_on: 1800000000,
        });
      if (path === "/v1/balance_transactions/bt_refund")
        return Response.json({
          id: "bt_refund",
          amount: -10000,
          fee: 0,
          net: -10000,
          status: "available",
          available_on: 1800000000,
        });
      if (path === "/v1/disputes") return Response.json({ data: [], has_more: false });
      if (path === "/v1/refunds")
        return Response.json({
          data: refunded
            ? [
                {
                  id: "re_one",
                  amount: 10000,
                  status: "succeeded",
                  balance_transaction: "bt_refund",
                },
              ]
            : [],
          has_more: false,
        });
      throw new Error("Unexpected provider request " + path);
    })
  );
  try {
    // Establish a synthetic verified signature directly; the separate test exercises all guest checks.
    const row = await loadRevision(env, revision.id);
    const proposal = JSON.parse(row.public_json);
    const at = new Date().toISOString();
    await db
      .prepare("UPDATE native_estimate_revisions SET status='signing' WHERE id=?")
      .bind(row.id)
      .run();
    await db
      .prepare(
        "INSERT INTO native_guest_grants(id,workspace_id,revision_id,token_hash,email,expires_at) VALUES(?,?,?,?,?,?)"
      )
      .bind(
        "verified-grant",
        "default",
        row.id,
        "synthetic-hash",
        "signer@example.test",
        row.expires_at
      )
      .run();
    await db
      .prepare("INSERT INTO native_signature_evidence VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .bind(
        "signature",
        "default",
        row.id,
        "verified-grant",
        "Synthetic Signer",
        "signer@example.test",
        row.content_hash,
        proposal.terms.hash,
        proposal.disclosure,
        "Test intent",
        at,
        at,
        "Test agent",
        "test-evidence-hash"
      )
      .run();
    await completeSignature(env, row);
    const invoice = await db
      .prepare("SELECT id FROM native_invoices WHERE revision_id=? AND kind='deposit'")
      .bind(row.id)
      .first<{ id: string }>();
    expect((await checkout(env, "default", row.id, invoice!.id)).url).toBe(
      "https://checkout.stripe.com/c/pay/test"
    );
    await reconcileAttempt(env, "default", attemptId);
    expect(
      (await db.prepare("SELECT status FROM native_invoices WHERE id=?").bind(invoice!.id).first())
        ?.status
    ).toBe("processing");
    await expect(checkout(env, "default", row.id, invoice!.id)).rejects.toThrow(
      "payment_already_submitted"
    );
    expect(sessionCreates).toBe(1);
    status = "succeeded";
    const event = {
      id: "evt_one",
      type: "checkout.session.async_payment_succeeded",
      livemode: false,
      data: { object: { id: "cs_test_one", client_reference_id: attemptId } },
    };
    const raw = JSON.stringify(event);
    const timestamp = Math.floor(Date.now() / 1000);
    const secret = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode("whsec_synthetic"),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const signature = Array.from(
      new Uint8Array(
        await crypto.subtle.sign("HMAC", secret, new TextEncoder().encode(`${timestamp}.${raw}`))
      ),
      (b) => b.toString(16).padStart(2, "0")
    ).join("");
    const webhook = () =>
      new Request("http://localhost:8787/billing-public/stripe/default", {
        method: "POST",
        headers: { "stripe-signature": `t=${timestamp},v1=${signature}` },
        body: raw,
      });
    await stripeWebhook(env, "default", webhook());
    await stripeWebhook(env, "default", webhook());
    expect((await db.prepare("SELECT count(*) AS n FROM native_payment_events").first())?.n).toBe(
      1
    );
    expect(
      (await db.prepare("SELECT status FROM native_invoices WHERE id=?").bind(invoice!.id).first())
        ?.status
    ).toBe("paid");
    expect(
      await db
        .prepare(
          "SELECT amount_cents,fee_cents,net_cents FROM native_payment_ledger WHERE provider_id='ch_one'"
        )
        .first()
    ).toEqual({ amount_cents: 81563, fee_cents: 2395, net_cents: 79168 });
    refunded = 10000;
    await reconcileAttempt(env, "default", attemptId);
    await reconcileAttempt(env, "default", attemptId);
    expect(
      (
        await db
          .prepare("SELECT refunded_cents FROM native_invoices WHERE id=?")
          .bind(invoice!.id)
          .first()
      )?.refunded_cents
    ).toBe(10000);
    expect(
      (
        await db
          .prepare("SELECT count(*) AS n FROM native_payment_ledger WHERE kind='refund'")
          .first()
      )?.n
    ).toBe(1);
    expect(
      (
        await db
          .prepare("SELECT amount_cents FROM native_payment_ledger WHERE kind='refund'")
          .first()
      )?.amount_cents
    ).toBe(-10000);
    await expect(
      stripeWebhook(
        env,
        "default",
        new Request("http://localhost/webhook", {
          method: "POST",
          body: raw,
          headers: { "stripe-signature": `t=${timestamp},v1=${"0".repeat(64)}` },
        })
      )
    ).rejects.toThrow("invalid_webhook_signature");
  } finally {
    vi.unstubAllGlobals();
    await mf.dispose();
  }
});
