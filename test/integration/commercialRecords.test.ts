import { describe, expect, it } from "vitest";
import { processEventMessage } from "../../src/processors/eventProcessor";
import { createTestEnv, dispatchRequest } from "../helpers/miniflare";

const baseMessage = {
  source: "manual",
  type: "commercial_record_upserted",
  externalId: "proposal-demo-001",
  idempotencyKey: "manual:commercial_record_upserted:proposal-demo-001",
  receivedAt: "2026-01-17T00:00:00.000Z",
  payload: {
    record: {
      uri: "manual://proposal/proposal-demo-001",
      kind: "proposal",
      customer: { display: "Jane Smith" },
      commitments: {
        quotedDeliveryDate: "2026-03-15",
        quotedInstallDate: "2026-03-20",
      },
      currency: "USD",
    },
    line_items: [
      {
        uri: "manual://proposal/proposal-demo-001/line/table",
        title: "Ash Dining Table",
        category_key: "furniture",
        deliverable_key: "dining_table",
        quantity: 1,
        position: 1,
        config: {
          requiresDesign: true,
          requiresApproval: true,
          woodSpecies: "ash",
        },
      },
      {
        uri: "manual://proposal/proposal-demo-001/line/delivery",
        title: "Delivery",
        category_key: "delivery",
        deliverable_key: "delivery_service",
        quantity: 1,
        position: 2,
        config: { deliveryRequired: true },
      },
    ],
  },
};

describe("commercial_record_upserted integration", () => {
  it("commercial_upsert_creates_record_and_line_items", async () => {
    const context = await createTestEnv();
    if (!context) {
      return;
    }
    const { env, db, mf } = context;

    await processEventMessage(baseMessage, env);

    const recordResult = await db
      .prepare("SELECT * FROM commercial_records WHERE uri = ?")
      .bind(baseMessage.payload.record.uri)
      .all();
    expect(recordResult.results?.length).toBe(1);
    const record = recordResult.results?.[0] as Record<string, unknown>;
    expect(record.source).toBe("manual");
    expect(record.kind).toBe("proposal");
    expect(record.external_id).toBe("proposal-demo-001");
    expect(record.customer_display).toBe("Jane Smith");
    expect(record.quoted_delivery_date).toBe("2026-03-15");
    expect(record.quoted_install_date).toBe("2026-03-20");
    expect(record.snapshot_hash).toBeTruthy();

    const lineResult = await db
      .prepare("SELECT * FROM commercial_line_items WHERE record_uri = ? ORDER BY position ASC")
      .bind(baseMessage.payload.record.uri)
      .all();
    expect(lineResult.results?.length).toBe(2);
    expect(lineResult.results?.[0]?.uri).toBe("manual://proposal/proposal-demo-001/line/table");

    await mf.dispose();
  });

  it("commercial_upsert_replaces_line_items", async () => {
    const context = await createTestEnv();
    if (!context) {
      return;
    }
    const { env, db, mf } = context;

    await processEventMessage(baseMessage, env);

    const secondMessage = {
      ...baseMessage,
      idempotencyKey: "manual:commercial_record_upserted:proposal-demo-001:second",
      payload: {
        ...baseMessage.payload,
        line_items: [
          {
            uri: "manual://proposal/proposal-demo-001/line/table",
            title: "Ash Dining Table",
            category_key: "furniture",
            deliverable_key: "dining_table",
            quantity: 1,
            position: 1,
            config: { requiresDesign: true },
          },
        ],
      },
    };

    await processEventMessage(secondMessage, env);

    const lineResult = await db
      .prepare("SELECT * FROM commercial_line_items WHERE record_uri = ?")
      .bind(baseMessage.payload.record.uri)
      .all();
    expect(lineResult.results?.length).toBe(1);

    const record = await db
      .prepare("SELECT updated_at FROM commercial_records WHERE uri = ?")
      .bind(baseMessage.payload.record.uri)
      .first<{ updated_at: string }>();
    expect(record?.updated_at).toBeTruthy();

    await mf.dispose();
  });

  it("commercial_upsert_updates_snapshot_hash_on_change", async () => {
    const context = await createTestEnv();
    if (!context) {
      return;
    }
    const { env, db, mf } = context;

    const messageA = {
      ...baseMessage,
      externalId: "proposal-demo-002",
      idempotencyKey: "manual:commercial_record_upserted:proposal-demo-002",
      payload: {
        ...baseMessage.payload,
        record: {
          ...baseMessage.payload.record,
          uri: "manual://proposal/proposal-demo-002",
        },
        line_items: [
          {
            uri: "manual://proposal/proposal-demo-002/line/table",
            title: "Ash Dining Table",
            category_key: "furniture",
            deliverable_key: "dining_table",
            quantity: 1,
            position: 1,
            config: { requiresDesign: false },
          },
        ],
      },
    };

    const messageB = {
      ...messageA,
      idempotencyKey: "manual:commercial_record_upserted:proposal-demo-002:second",
      payload: {
        ...messageA.payload,
        line_items: [
          {
            uri: "manual://proposal/proposal-demo-002/line/table",
            title: "Ash Dining Table",
            category_key: "furniture",
            deliverable_key: "dining_table",
            quantity: 1,
            position: 1,
            config: { requiresDesign: true },
          },
        ],
      },
    };

    await processEventMessage(messageA, env);
    const first = await db
      .prepare("SELECT snapshot_hash FROM commercial_records WHERE uri = ?")
      .bind("manual://proposal/proposal-demo-002")
      .first<{ snapshot_hash: string }>();

    await processEventMessage(messageB, env);
    const second = await db
      .prepare("SELECT snapshot_hash FROM commercial_records WHERE uri = ?")
      .bind("manual://proposal/proposal-demo-002")
      .first<{ snapshot_hash: string }>();

    expect(first?.snapshot_hash).toBeTruthy();
    expect(second?.snapshot_hash).toBeTruthy();
    expect(first?.snapshot_hash).not.toEqual(second?.snapshot_hash);

    const line = await db
      .prepare("SELECT config_hash FROM commercial_line_items WHERE record_uri = ?")
      .bind("manual://proposal/proposal-demo-002")
      .first<{ config_hash: string }>();
    expect(line?.config_hash).toBeTruthy();

    await mf.dispose();
  });

  it("http_list_commercial_records", async () => {
    const context = await createTestEnv();
    if (!context) {
      return;
    }
    const { env, mf } = context;

    await processEventMessage(baseMessage, env);

    const response = await dispatchRequest("http://localhost/commercial-records", env);
    const body = (await response.json()) as { records: unknown[] };

    expect(Array.isArray(body.records)).toBe(true);
    expect(body.records.length).toBeGreaterThan(0);

    await mf.dispose();
  });

  it("http_get_commercial_record_detail", async () => {
    const context = await createTestEnv();
    if (!context) {
      return;
    }
    const { env, mf } = context;

    await processEventMessage(baseMessage, env);

    const encoded = encodeURIComponent(baseMessage.payload.record.uri);
    const response = await dispatchRequest(`http://localhost/commercial-records/${encoded}`, env);
    const body = (await response.json()) as {
      record: Record<string, unknown>;
      line_items: unknown[];
    };

    expect(body.record.uri).toBe(baseMessage.payload.record.uri);
    expect(Array.isArray(body.line_items)).toBe(true);
    expect(body.line_items.length).toBe(2);

    await mf.dispose();
  });
});
