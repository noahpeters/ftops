import { afterEach, describe, expect, it, vi } from "vitest";
import { createTestEnv } from "../helpers/miniflare";
import { route } from "../../src/lib/router";
import { processQuoContactSync } from "../../src/services/quo";
import type { ExecutionContext } from "@cloudflare/workers-types";
import type { Env } from "../../src/lib/types";
import { decryptSecrets } from "../../src/lib/crypto/secrets";

const MASTER_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

describe("FTOPS to Quo contact sync", () => {
  afterEach(() => vi.restoreAllMocks());

  it("looks up by external ID, persists the mapping, and keeps syncing archived contacts", async () => {
    const context = await createTestEnv({
      env: { INTEGRATIONS_MASTER_KEY: MASTER_KEY, INTEGRATIONS_KEY_ID: "v1" },
    });
    if (!context) return;
    const { env, db, mf } = context;
    const integrationResponse = await request(env, "/integrations", {
      method: "POST",
      body: JSON.stringify({
        workspaceId: "default",
        provider: "quo",
        displayName: "Quo",
        secrets: { apiKey: "test-key" },
      }),
    });
    expect(integrationResponse.status).toBe(201);
    const createdIntegration = (await integrationResponse.json()) as { id: string };
    const integration = await db
      .prepare(
        `SELECT secrets_key_id,secrets_ciphertext FROM integrations WHERE workspace_id='default' AND provider='quo'`
      )
      .first<{ secrets_key_id: string; secrets_ciphertext: string }>();
    expect(integration?.secrets_ciphertext).not.toContain("test-key");
    expect(
      JSON.parse(
        await decryptSecrets(env, integration!.secrets_key_id, integration!.secrets_ciphertext)
      )
    ).toEqual({ apiKey: "test-key" });

    const customerResponse = await request(env, "/customers", {
      method: "POST",
      body: JSON.stringify({ workspaceId: "default", displayName: "Smith Residence" }),
    });
    const customer = (await customerResponse.json()) as { customer: { id: string } };
    const contactResponse = await request(env, `/customers/${customer.customer.id}/contacts`, {
      method: "POST",
      body: JSON.stringify({
        firstName: "Alex",
        lastName: "Smith",
        phone: "415-555-0123",
        email: "alex@example.com",
      }),
    });
    const detail = (await contactResponse.json()) as { contacts: Array<{ id: string }> };
    const contactId = detail.contacts[0].id;
    const initial = await db
      .prepare(`SELECT version,status FROM quo_contact_sync WHERE contact_id=?`)
      .bind(contactId)
      .first<{ version: number; status: string }>();
    expect(initial?.status).toBe("pending");

    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [], totalItems: 0, nextPageToken: null }), {
          status: 200,
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { id: "quo-contact-1", externalId: contactId } }), {
          status: 201,
        })
      );
    await processQuoContactSync(env, { contactId, version: initial?.version });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const lookup = new URL(String(fetchMock.mock.calls[0][0]));
    expect(lookup.hostname).toBe("api.quo.com");
    expect(lookup.searchParams.getAll("externalIds")).toEqual([contactId]);
    expect(fetchMock.mock.calls[0][1]?.headers).toMatchObject({ Authorization: "test-key" });
    const createBody = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
    expect(createBody).toMatchObject({
      externalId: contactId,
      source: "ftops",
      defaultFields: {
        firstName: "Alex",
        lastName: "Smith",
        company: "Smith Residence",
        phoneNumbers: [{ value: "+14155550123" }],
      },
    });
    expect(
      await db
        .prepare(`SELECT quo_contact_id,status FROM quo_contact_sync WHERE contact_id=?`)
        .bind(contactId)
        .first()
    ).toMatchObject({ quo_contact_id: "quo-contact-1", status: "synced" });

    const replaced = await request(env, `/integrations/${createdIntegration.id}`, {
      method: "PATCH",
      body: JSON.stringify({ secrets: { apiKey: "replacement-key" } }),
    });
    expect(replaced.status).toBe(200);
    const replacedSecret = await db
      .prepare(`SELECT secrets_key_id,secrets_ciphertext FROM integrations WHERE id=?`)
      .bind(createdIntegration.id)
      .first<{ secrets_key_id: string; secrets_ciphertext: string }>();
    expect(
      JSON.parse(
        await decryptSecrets(
          env,
          replacedSecret!.secrets_key_id,
          replacedSecret!.secrets_ciphertext
        )
      )
    ).toEqual({ apiKey: "replacement-key" });
    const replacementSync = await db
      .prepare(`SELECT version FROM quo_contact_sync WHERE contact_id=?`)
      .bind(contactId)
      .first<{ version: number }>();
    fetchMock.mockClear();
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: { id: "quo-contact-1", externalId: contactId } }), {
        status: 200,
      })
    );
    await processQuoContactSync(env, { contactId, version: replacementSync?.version });
    expect(fetchMock.mock.calls[0][1]?.headers).toMatchObject({
      Authorization: "replacement-key",
    });

    await request(env, `/customers/${customer.customer.id}/contacts/${contactId}`, {
      method: "DELETE",
    });
    const archived = await db
      .prepare(`SELECT version,desired_action FROM quo_contact_sync WHERE contact_id=?`)
      .bind(contactId)
      .first<{ version: number; desired_action: string }>();
    expect(archived?.desired_action).toBe("upsert");
    fetchMock.mockClear();
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: { id: "quo-contact-1", externalId: contactId } }), {
        status: 200,
      })
    );
    await processQuoContactSync(env, { contactId, version: archived?.version });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1]?.method).toBe("PATCH");
    expect(
      await db
        .prepare(`SELECT quo_contact_id,status FROM quo_contact_sync WHERE contact_id=?`)
        .bind(contactId)
        .first()
    ).toMatchObject({ quo_contact_id: "quo-contact-1", status: "synced" });
    await mf.dispose();
  });
});

async function request(env: Env, path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json");
  headers.set("X-Debug-User-Email", "admin@example.com");
  headers.set("Origin", "https://ops.from-trees.com");
  return route(
    new Request(`http://local${path}`, { ...init, headers }),
    env,
    {} as ExecutionContext
  );
}
