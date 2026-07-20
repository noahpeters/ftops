import { describe, expect, it } from "vitest";
import { extractChanges } from "../../src/processors/quickbooksWebhook";

describe("QuickBooks webhook changes", () => {
  it("extracts supported entity notifications safely", () => {
    expect(
      extractChanges({
        eventNotifications: [
          {
            dataChangeEvent: {
              entities: [
                { name: "Customer", id: "1", operation: "Update" },
                { name: "Invoice", id: "2" },
              ],
            },
          },
        ],
      })
    ).toEqual([
      { name: "Customer", id: "1", operation: "Update" },
      { name: "Invoice", id: "2" },
    ]);
    expect(extractChanges(null)).toEqual([]);
  });
});
