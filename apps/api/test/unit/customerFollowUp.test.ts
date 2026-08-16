import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";
import { computeCustomerFollowUp } from "../../src/services/customerFollowUp";

const zone = "America/Los_Angeles";

describe("customer follow-up cadence", () => {
  it("schedules leads on predictable Tuesday and Friday cadence", () => {
    const result = computeCustomerFollowUp(
      { status: "lead", created_at: "2026-08-17T17:00:00.000Z" },
      DateTime.fromISO("2026-08-17T12:00:00", { zone })
    );
    expect(result.next_follow_up_at).toBe("2026-08-18T16:00:00.000Z");
    expect(result.follow_up_urgency).toBe("upcoming");
  });

  it("moves a holiday Friday to the prior business day", () => {
    const result = computeCustomerFollowUp(
      { status: "active", last_human_note_at: "2026-06-29T17:00:00.000Z" },
      DateTime.fromISO("2026-06-29T12:00:00", { zone })
    );
    expect(result.next_follow_up_at).toBe("2026-07-02T16:00:00.000Z");
  });

  it("uses stored note guidance and suppresses archived customers", () => {
    const guided = computeCustomerFollowUp(
      {
        status: "completed",
        created_at: "2026-08-01T17:00:00.000Z",
        guidance_type: "date",
        interpreted_date: "2026-09-15T16:00:00.000Z",
        guidance_explanation: "Customer asked us to call next month.",
      },
      DateTime.fromISO("2026-08-16T12:00:00", { zone })
    );
    expect(guided).toMatchObject({
      next_follow_up_at: "2026-09-15T16:00:00.000Z",
      follow_up_reason: "Customer asked us to call next month.",
    });
    expect(computeCustomerFollowUp({ status: "archived" }).next_follow_up_at).toBeNull();
  });
});
