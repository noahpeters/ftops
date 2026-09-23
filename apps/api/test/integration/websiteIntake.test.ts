import { describe, expect, it } from "vitest";
import { createTestEnv } from "../helpers/miniflare";
import { route } from "../../src/lib/router";
import { encryptSecrets } from "../../src/lib/crypto/secrets";
import type { Env } from "../../src/lib/types";

const token = "test_website_credential_12345678901234567890";
const payload = {
  externalEventId: "event-1",
  email: "  Person@Example.com ",
  firstName: "Original",
  phone: "555-1234",
  budget: "around ten thousand",
  message: "A custom table",
};
function request(env: Env, path: string, body?: unknown, credential = token, method = "POST") {
  return route(
    new Request(`http://localhost${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${credential}`,
        ...(path.startsWith("/integrations") ? { Origin: "http://localhost:5173" } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
    env,
    {} as ExecutionContext
  );
}
async function setup() {
  const context = await createTestEnv({ env: { INTEGRATIONS_MASTER_KEY: "01".repeat(32) } });
  if (!context)
    throw new Error(
      "Website intake integration tests require the D1 emulator; localhost access is unavailable"
    );
  for (const [id, workspace] of [
    ["site-a", "default"],
    ["site-b", "ws_unknown"],
  ]) {
    const encrypted = await encryptSecrets(
      context.env,
      JSON.stringify({ intakeToken: id === "site-a" ? token : token + "_b" })
    );
    await context.db
      .prepare(
        `INSERT INTO integrations (id,workspace_id,provider,environment,external_account_id,secrets_key_id,secrets_ciphertext,is_active,created_at,updated_at) VALUES (?,?,'website','production',?,?,?,1,'now','now')`
      )
      .bind(id, workspace, id, encrypted.keyId, encrypted.ciphertext)
      .run();
  }
  return context;
}

describe("website intake", () => {
  it("rolls back a failed batch and safely retries distinct concurrent new events", async () => {
    const { env, db, mf } = await setup();
    try {
      await db
        .prepare(
          `CREATE TRIGGER fail_activity BEFORE INSERT ON customer_activities BEGIN SELECT RAISE(ABORT,'test_failure'); END`
        )
        .run();
      await expect(request(env, "/website-intake/site-a", payload)).rejects.toThrow("test_failure");
      for (const table of ["website_submissions", "customers", "contacts", "customer_activities"]) {
        expect(await db.prepare(`SELECT count(*) AS n FROM ${table}`).first()).toEqual({ n: 0 });
      }
      await db.prepare(`DROP TRIGGER fail_activity`).run();
      const responses = await Promise.all(
        [1, 2].map((n) =>
          request(env, "/website-intake/site-a", { ...payload, externalEventId: `new-${n}` })
        )
      );
      expect(responses.map((r) => r.status)).toEqual([201, 201]);
      expect(await db.prepare(`SELECT count(*) AS n FROM contacts`).first()).toEqual({ n: 1 });
      expect(await db.prepare(`SELECT count(*) AS n FROM website_submissions`).first()).toEqual({
        n: 2,
      });
    } finally {
      await mf.dispose();
    }
  });

  it("assigns credentials, normalizes domains, and regenerates without exposing saved secrets", async () => {
    const { env, db, mf } = await setup();
    try {
      const create = await request(env, "/integrations", {
        workspaceId: "default",
        provider: "website",
        environment: "production",
        sourceDomain: "HTTPS://WWW.Example.COM/contact",
        displayName: "Main site",
      });
      expect(create.status).toBe(201);
      expect(create.headers.get("Cache-Control")).toBe("no-store");
      const row = (await create.json()) as {
        id: string;
        intakeCredential: string;
        external_account_id: string;
      };
      expect(row.external_account_id).toBe("www.example.com");
      expect(row.intakeCredential).toMatch(/^[a-f0-9]{64}$/);
      expect(row).not.toHaveProperty("secrets_ciphertext");
      const stored = await db
        .prepare(`SELECT secrets_ciphertext FROM integrations WHERE id=?`)
        .bind(row.id)
        .first<{ secrets_ciphertext: string }>();
      expect(stored!.secrets_ciphertext).not.toContain(row.intakeCredential);
      expect(
        (await request(env, `/website-intake/${row.id}`, payload, row.intakeCredential)).status
      ).toBe(201);
      const domainEdit = await request(
        env,
        `/integrations/${row.id}`,
        { sourceDomain: "example.org." },
        token,
        "PATCH"
      );
      expect(await domainEdit.json()).toMatchObject({ external_account_id: "example.org" });
      const rotate = await request(
        env,
        `/integrations/${row.id}`,
        { regenerateCredential: true },
        token,
        "PATCH"
      );
      expect(rotate.status).toBe(200);
      expect(rotate.headers.get("Cache-Control")).toBe("no-store");
      const next = (await rotate.json()) as { intakeCredential: string };
      expect(next.intakeCredential).toMatch(/^[a-f0-9]{64}$/);
      expect(next.intakeCredential).not.toBe(row.intakeCredential);
      expect(
        (await request(env, `/website-intake/${row.id}`, payload, row.intakeCredential)).status
      ).toBe(401);
      expect(
        (await request(env, `/website-intake/${row.id}`, payload, next.intakeCredential)).status
      ).toBe(200);
      for (const path of ["/integrations?workspaceId=default", `/integrations/${row.id}`]) {
        const read = await request(env, path, undefined, token, "GET");
        const text = await read.text();
        expect(text).not.toContain(next.intakeCredential);
        expect(text).not.toContain("intakeCredential");
        expect(text).not.toContain("secrets_ciphertext");
      }
      expect(
        (
          await request(
            env,
            `/integrations/${row.id}`,
            { secrets: { intakeToken: token } },
            token,
            "PATCH"
          )
        ).status
      ).toBe(400);
      await db.prepare(`UPDATE integrations SET provider='quo' WHERE id=?`).bind(row.id).run();
      expect(
        (
          await request(
            env,
            `/integrations/${row.id}`,
            { regenerateCredential: true },
            token,
            "PATCH"
          )
        ).status
      ).toBe(400);
      expect(
        (await request(env, `/website-intake/${row.id}`, payload, next.intakeCredential)).status
      ).toBe(401);
    } finally {
      await mf.dispose();
    }
  });

  it("rejects invalid or duplicate source domains and unauthorized regeneration", async () => {
    const { env, db, mf } = await setup();
    try {
      const base = { workspaceId: "default", provider: "website", environment: "production" };
      for (const sourceDomain of [
        "",
        "new-site",
        "localhost",
        "127.0.0.1",
        "https://user:password@example.com",
        "https://example.com:8080",
        "ftp://example.com",
        "-bad.example.com",
        "bad domain.com",
      ]) {
        expect((await request(env, "/integrations", { ...base, sourceDomain })).status).toBe(400);
      }
      expect(
        (
          await request(env, "/integrations", {
            ...base,
            sourceDomain: "example.com",
            secrets: { intakeToken: token },
          })
        ).status
      ).toBe(400);
      const results = await Promise.all(
        [1, 2].map(() => request(env, "/integrations", { ...base, sourceDomain: "example.com" }))
      );
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
      const created = (await results.find((r) => r.status === 201)!.json()) as { id: string };
      const withoutOrigin = await route(
        new Request(`http://localhost/integrations/${created.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ regenerateCredential: true }),
        }),
        env,
        {} as ExecutionContext
      );
      expect(withoutOrigin.status).toBe(403);
      await db
        .prepare(
          `INSERT INTO users(workspace_id,user_id,name,email,workspace_admin,system_admin) VALUES ('ws_unknown','outsider','Outsider','outsider@example.com',1,0)`
        )
        .run();
      for (const method of ["GET", "PATCH"]) {
        const denied = await route(
          new Request(`http://localhost/integrations/${created.id}`, {
            method,
            headers: {
              "X-Debug-User-Email": "outsider@example.com",
              Origin: "http://localhost:5173",
              "content-type": "application/json",
            },
            ...(method === "PATCH" ? { body: JSON.stringify({ regenerateCredential: true }) } : {}),
          }),
          env,
          {} as ExecutionContext
        );
        expect(denied.status).toBe(403);
      }
    } finally {
      await mf.dispose();
    }
  });

  it("resolves tenants from credentials and rejects authority/CRUD fields and inactive integrations", async () => {
    const { env, db, mf } = await setup();
    try {
      expect((await request(env, "/website-intake/site-a", payload, "wrong")).status).toBe(401);
      expect((await request(env, "/website-intake/missing", payload)).status).toBe(401);
      for (const body of [
        { ...payload, workspaceId: "ws_unknown" },
        { ...payload, customerId: "x" },
        { ...payload, marketingConsent: false },
        { ...payload, opportunity: { description: "x", type: "furniture", budgetCents: "100" } },
      ]) {
        expect((await request(env, "/website-intake/site-a", body)).status).toBe(400);
      }
      expect(
        (await request(env, "/website-intake/site-a?workspaceId=ws_unknown", payload)).status
      ).toBe(400);
      expect((await request(env, "/website-intake/site-a", undefined, token, "GET")).status).toBe(
        405
      );
      expect(
        (await request(env, "/website-intake/site-a", { ...payload, message: "x".repeat(66000) }))
          .status
      ).toBe(413);
      expect((await request(env, "/website-intake/site-a", payload)).status).toBe(201);
      expect((await request(env, "/website-intake/site-b", payload)).status).toBe(401);
      expect((await request(env, "/website-intake/site-b", payload, token + "_b")).status).toBe(
        201
      );
      expect(
        (await db.prepare(`SELECT workspace_id FROM customers ORDER BY workspace_id`).all()).results
      ).toEqual([{ workspace_id: "default" }, { workspace_id: "ws_unknown" }]);
      await db.prepare(`UPDATE integrations SET is_active=0 WHERE id='site-a'`).run();
      expect((await request(env, "/website-intake/site-a", payload)).status).toBe(401);
    } finally {
      await mf.dispose();
    }
  });

  it("is atomic and idempotent under concurrent events, preserves raw evidence and established identities", async () => {
    const { env, db, mf } = await setup();
    try {
      const responses = await Promise.all([
        request(env, "/website-intake/site-a", payload),
        request(env, "/website-intake/site-a", payload),
      ]);
      expect(responses.map((r) => r.status).sort()).toEqual([200, 201]);
      expect(
        (await request(env, "/website-intake/site-a", { ...payload, message: "changed" })).status
      ).toBe(409);
      await Promise.all(
        [2, 3].map((n) =>
          request(env, "/website-intake/site-a", {
            ...payload,
            externalEventId: `event-${n}`,
            firstName: "Conflicting",
            phone: "new",
            lastName: "Added",
          })
        )
      );
      expect(await db.prepare(`SELECT count(*) AS n FROM customers`).first()).toEqual({ n: 1 });
      expect(
        await db
          .prepare(
            `SELECT first_name,last_name,phone,email,marketing_email_permission FROM contacts`
          )
          .first()
      ).toEqual({
        first_name: "Original",
        last_name: "Added",
        phone: "555-1234",
        email: "person@example.com",
        marketing_email_permission: "unknown",
      });
      expect(
        await db
          .prepare(
            `SELECT count(*) AS n FROM customer_activities WHERE activity_type='website_submission'`
          )
          .first()
      ).toEqual({ n: 3 });
      expect(await db.prepare(`SELECT count(*) AS n FROM customer_opportunities`).first()).toEqual({
        n: 0,
      });
      const row = await db
        .prepare(
          `SELECT raw_payload,fields_json FROM website_submissions WHERE external_event_id='event-1'`
        )
        .first<{ raw_payload: string; fields_json: string }>();
      expect(JSON.parse(row!.raw_payload)).toEqual(payload);
      expect(JSON.parse(row!.fields_json).budget).toBe(payload.budget);
      await expect(
        db.prepare(`UPDATE website_submissions SET email='other'`).run()
      ).rejects.toThrow("immutable");
      await expect(db.prepare(`DELETE FROM website_submissions`).run()).rejects.toThrow(
        "immutable"
      );
    } finally {
      await mf.dispose();
    }
  });

  it("retains consent history, ignores not_provided, supports revocation and ignores stale grants", async () => {
    const { env, db, mf } = await setup();
    try {
      const send = (id: string, consent?: unknown) =>
        request(env, "/website-intake/site-a", {
          ...payload,
          externalEventId: id,
          ...(consent ? { marketingConsent: consent } : {}),
        });
      expect(
        (await send("bad-grant", { state: "granted", capturedAt: "2026-01-01T00:00:00Z" })).status
      ).toBe(400);
      expect(
        (
          await send("grant", {
            state: "granted",
            disclosureVersion: "v1",
            capturedAt: "2026-01-01T00:00:00Z",
          })
        ).status
      ).toBe(201);
      await send("unspecified");
      expect(await db.prepare(`SELECT marketing_email_permission FROM contacts`).first()).toEqual({
        marketing_email_permission: "allowed",
      });
      await send("revoke", { state: "revoked", capturedAt: "2026-01-02T00:00:00Z" });
      await send("stale", {
        state: "granted",
        disclosureVersion: "v1",
        capturedAt: "2026-01-01T12:00:00Z",
      });
      await send("tie", {
        state: "granted",
        disclosureVersion: "v1",
        capturedAt: "2026-01-02T00:00:00Z",
      });
      await send("not-provided", { state: "not_provided" });
      expect(await db.prepare(`SELECT marketing_email_permission FROM contacts`).first()).toEqual({
        marketing_email_permission: "not_allowed",
      });
      expect(
        await db.prepare(`SELECT count(*) AS n FROM contact_marketing_events`).first()
      ).toEqual({ n: 4 });
      await expect(db.prepare(`DELETE FROM contact_marketing_events`).run()).rejects.toThrow(
        "immutable"
      );
    } finally {
      await mf.dispose();
    }
  });

  it("keeps ambiguous and archived matches for review without modifying contacts", async () => {
    const { env, db, mf } = await setup();
    try {
      await request(env, "/website-intake/site-a", payload);
      await db.prepare(`UPDATE contacts SET status='archived'`).run();
      const archived = await request(env, "/website-intake/site-a", {
        ...payload,
        externalEventId: "archived",
      });
      expect(await archived.json()).toMatchObject({ status: "needs_review" });
      await db.prepare(`UPDATE contacts SET status='active'`).run();
      await db
        .prepare(
          `INSERT INTO contacts(id,workspace_id,customer_id,display_name,email,created_at,updated_at) SELECT 'duplicate',workspace_id,customer_id,'Duplicate',email,created_at,updated_at FROM contacts`
        )
        .run();
      const ambiguous = await request(env, "/website-intake/site-a", {
        ...payload,
        externalEventId: "ambiguous",
        marketingConsent: { state: "revoked", capturedAt: "2026-01-01T00:00:00Z" },
      });
      expect(await ambiguous.json()).toMatchObject({ status: "needs_review" });
      expect(await db.prepare(`SELECT count(*) AS n FROM customer_activities`).first()).toEqual({
        n: 1,
      });
      expect(
        await db.prepare(`SELECT count(*) AS n FROM contact_marketing_events`).first()
      ).toEqual({ n: 0 });
    } finally {
      await mf.dispose();
    }
  });

  it("creates or links opportunities only with explicit structured amounts", async () => {
    const { env, db, mf } = await setup();
    try {
      const opportunity = { description: "Dining table", type: "furniture", budgetCents: 500000 };
      expect(
        (await request(env, "/website-intake/site-a", { ...payload, opportunity })).status
      ).toBe(201);
      expect(
        (
          await request(env, "/website-intake/site-a", {
            ...payload,
            externalEventId: "event-2",
            opportunity: { ...opportunity, budgetCents: 700000 },
          })
        ).status
      ).toBe(201);
      expect(
        await db
          .prepare(`SELECT count(*) AS n,max(budget_cents) AS budget FROM customer_opportunities`)
          .first()
      ).toEqual({ n: 1, budget: 500000 });
      expect(
        await db.prepare(`SELECT count(*) AS n FROM website_submission_opportunities`).first()
      ).toEqual({ n: 2 });
    } finally {
      await mf.dispose();
    }
  });

  it("exposes staff contact preferences and history while enforcing workspace access", async () => {
    const { env, db, mf } = await setup();
    try {
      await request(env, "/website-intake/site-a", payload);
      const contact = await db
        .prepare(`SELECT id,customer_id FROM contacts`)
        .first<{ id: string; customer_id: string }>();
      const path = `/customers/${contact!.customer_id}/contacts/${contact!.id}`;
      const patch = await request(
        env,
        path,
        { marketingEmailPermission: "allowed" },
        token,
        "PATCH"
      );
      expect(patch.status).toBe(200);
      const detail = await request(env, path, undefined, token, "GET");
      expect(await detail.json()).toMatchObject({
        marketing_email_permission: "allowed",
        marketing_email_history: [{ source: "manual", permission: "allowed" }],
      });
      expect(
        (await request(env, path, { marketingEmailPermission: "invalid" }, token, "PATCH")).status
      ).toBe(400);
      await request(env, path, { marketingEmailPermission: "unknown" }, token, "PATCH");
      expect(
        await db.prepare(`SELECT count(*) AS n FROM contact_marketing_events`).first()
      ).toEqual({ n: 2 });
      await db
        .prepare(
          `INSERT INTO users(workspace_id,user_id,name,email,workspace_admin,system_admin) VALUES ('ws_unknown','outsider','Outsider','outsider@example.com',0,0)`
        )
        .run();
      const forbidden = await route(
        new Request(`http://localhost${path}`, {
          headers: { "X-Debug-User-Email": "outsider@example.com" },
        }),
        env,
        {} as ExecutionContext
      );
      expect(forbidden.status).toBe(403);
      expect(
        (await request(env, "/website-submissions?workspaceId=default", undefined, token, "GET"))
          .status
      ).toBe(403);
      expect(
        (
          await request(env, "/website-intake/site-a", {
            ...payload,
            externalEventId: "still-valid",
          })
        ).status
      ).toBe(201);
    } finally {
      await mf.dispose();
    }
  });
});
