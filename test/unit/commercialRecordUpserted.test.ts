import { describe, expect, it } from "vitest";
import { deriveLineItemUri } from "../../src/processors/commercialRecordUpserted";

describe("deriveLineItemUri", () => {
  it("uses provided line item uri", () => {
    const uri = deriveLineItemUri("manual://proposal/x", "custom://line/1", 0);
    expect(uri).toBe("custom://line/1");
  });

  it("derives line item uri when missing", () => {
    const uri = deriveLineItemUri("manual://proposal/x", undefined, 1);
    expect(uri).toBe("manual://proposal/x/line/2");
  });
});
