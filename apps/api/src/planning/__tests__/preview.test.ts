import { describe, expect, it } from "vitest";
import { getPlanPreview, NotFoundError } from "../preview";
import type { Env } from "../../lib/types";

type QueryResult = { results: unknown[] };

function makeEnv(data: {
  record: unknown | null;
  lineItems: unknown[];
  categories: unknown[];
  deliverables: unknown[];
  templates?: unknown[];
  rules?: unknown[];
}): Env {
  const db = {
    prepare(sql: string) {
      const handlers = {
        all: async (): Promise<QueryResult> => {
          if (sql.includes("FROM line_item_categories")) {
            return { results: data.categories };
          }
          if (sql.includes("FROM deliverable_kinds")) {
            return { results: data.deliverables };
          }
          if (sql.includes("FROM commercial_line_items")) {
            return { results: data.lineItems };
          }
          if (sql.includes("FROM templates")) {
            return { results: data.templates ?? [] };
          }
          if (sql.includes("FROM template_rules")) {
            return { results: data.rules ?? [] };
          }
          return { results: [] };
        },
        first: async (): Promise<unknown | null> => {
          if (sql.includes("FROM commercial_records")) {
            return data.record;
          }
          return null;
        },
        bind() {
          return handlers;
        },
      };
      return handlers;
    },
  };

  return {
    DB: db as D1Database,
    EVENT_QUEUE: {} as Queue,
    R2_TASK_FILES_BUCKET: {} as R2Bucket,
  };
}

describe("getPlanPreview", () => {
  it("throws NotFoundError when record is missing", async () => {
    const env = makeEnv({
      record: null,
      lineItems: [],
      categories: [],
      deliverables: [],
    });

    await expect(getPlanPreview(env, "missing://record")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("returns a deterministic preview payload", async () => {
    const env = makeEnv({
      record: {
        uri: "manual://proposal/demo",
        source: "manual",
        kind: "proposal",
        external_id: "demo",
        customer_uri: null,
        customer_display: null,
        quoted_delivery_date: null,
        quoted_install_date: null,
        currency: null,
        total_amount_cents: null,
        snapshot_json: "{}",
        snapshot_hash: "snap123",
        first_seen_at: "now",
        last_seen_at: "now",
        last_event_id: null,
        created_at: "now",
        updated_at: "now",
      },
      lineItems: [
        {
          uri: "manual://proposal/demo/line/1",
          record_uri: "manual://proposal/demo",
          category_key: "furniture",
          deliverable_key: "dining_table",
          group_key: null,
          title: "Dining Table",
          quantity: 1,
          unit_price_cents: null,
          amount_cents: null,
          position: 1,
          config_json: "{}",
          config_hash: "cfg",
          snapshot_json: null,
          snapshot_hash: null,
          created_at: "now",
          updated_at: "now",
        },
      ],
      categories: [{ key: "furniture", label: "Furniture", is_active: 1 }],
      deliverables: [
        { key: "dining_table", label: "Dining Table", category_key: "furniture", is_active: 1 },
      ],
    });

    const preview = await getPlanPreview(env, "manual://proposal/demo");
    expect(preview.plan_input.record.uri).toBe("manual://proposal/demo");
    expect(preview.plan_preview.groups.length).toBeGreaterThan(0);
    expect(preview.debug.plan_id).toHaveLength(64);
    expect(preview.versions.workspace_config_version).toBe("v0");
  });
});
