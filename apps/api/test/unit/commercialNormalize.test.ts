import { describe, expect, it } from "vitest";
import { normalizeCommercialUpsert } from "../../src/processors/commercialNormalize";
import { stableStringify } from "../../src/lib/jsonStable";
import { sha256Hex } from "../../src/lib/hash";

describe("normalizeCommercialUpsert", () => {
  it("returns record uri, line items, and stable snapshot hash", async () => {
    const payload = {
      record: {
        uri: "manual://proposal/demo-123",
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
          title: "Ash Dining Table",
          category_key: "furniture",
          deliverable_key: "dining_table",
          quantity: 1,
          position: 1,
          config: { requiresDesign: true },
        },
      ],
    };

    const result = await normalizeCommercialUpsert({
      eventSource: "manual",
      externalId: "demo-123",
      receivedAt: "2026-01-17T00:00:00.000Z",
      eventId: "evt-1",
      payload,
      nowIso: "2026-01-17T00:00:01.000Z",
    });

    expect(result.recordUri).toBe("manual://proposal/demo-123");
    expect(result.lineItemRows).toHaveLength(1);
    expect(result.lineItemRows[0]?.uri).toBe("manual://proposal/demo-123/line/1");
    expect(result.recordRow.quoted_delivery_date).toBe("2026-03-15");
    expect(result.recordRow.quoted_install_date).toBe("2026-03-20");

    const expectedSnapshotJson = stableStringify({
      record: payload.record,
      line_items: payload.line_items,
    });
    const expectedSnapshotHash = await sha256Hex(expectedSnapshotJson);
    expect(result.snapshotJson).toBe(expectedSnapshotJson);
    expect(result.snapshotHash).toBe(expectedSnapshotHash);
  });
});
