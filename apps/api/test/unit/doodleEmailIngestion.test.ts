import { describe, expect, it } from "vitest";
import {
  classifyOpportunityType,
  isAdministrativeBooking,
  parseBudgetCents,
  parseDoodleBooking,
} from "../../src/services/doodleEmailIngestion";

function email(subject: string, body: string, messageId = "<doodle-test@example.com>") {
  return new TextEncoder().encode(
    [
      "From: Doodle <mailer@doodle.com>",
      "To: noah@fromtrees.studio",
      `Subject: ${subject}`,
      `Message-Id: ${messageId}`,
      "X-Mailgun-Template-Name: SE_PARTICIPATION_NOTIF_BOOKING_O",
      'Content-Type: text/html; charset="utf-8"',
      "",
      body,
    ].join("\r\n")
  ).buffer;
}

describe("Doodle booking ingestion", () => {
  it("parses a detailed in-home consultation lead", async () => {
    const raw = email(
      "New time booked for Free In Home Consultation w/ Mariam",
      `<!doctype html><html><body>
        <div>Hi Noah Peters</div>
        <div>Mariam just responded to your invite Free In Home Consultation w/ Mariam.</div>
        <div>Aug 27, 2026, 9:00 AM - 10:00 AM America/Los_Angeles (GMT-07:00)</div>
        <div>Answers to your invitee fields:</div>
        <div>Home Address</div><div>1532 n kennymead st orange ca 92869</div>
        <div>Phone number</div><div>7143251463</div>
        <div>Your budget range</div><div>Unknown</div>
        <div>Brief description of the project you'd like to discuss</div>
        <div>Build a home library/ office with a paint-grade architectural built-in bookcase with arched openings.</div>
        <a href="https://email.doodle.com/c/example">Go to the invite</a>
      </body></html>`,
      "<20260825005800.b47eaed4c961f2ca@doodle.com>"
    );
    const booking = await parseDoodleBooking(raw);
    expect(booking).not.toBeNull();
    expect(booking?.inviteeName).toBe("Mariam");
    expect(booking?.inviteTitle).toBe("Free In Home Consultation");
    expect(booking?.phone).toBe("7143251463");
    expect(booking?.address).toBe("1532 n kennymead st orange ca 92869");
    expect(booking?.budgetText).toBe("Unknown");
    expect(booking?.projectDescription).toContain("home library");
    expect(booking?.inviteUrl).toBe("https://email.doodle.com/c/example");
  });

  it("parses Doodle budget ranges using the midpoint as working budget", () => {
    expect(parseBudgetCents("Not sure 2000-4000")).toBe(300000);
    expect(parseBudgetCents("$10k - $20k")).toBe(1500000);
    expect(parseBudgetCents("Unknown")).toBe(0);
  });

  it("classifies cabinet-like project descriptions", () => {
    expect(classifyOpportunityType("Vanity for the master bath")).toBe("cabinets");
    expect(classifyOpportunityType("Built-in bookcase with arched openings")).toBe("cabinets");
    expect(classifyOpportunityType("White oak dining table")).toBe("furniture");
  });

  it("treats reschedule-only bookings as administrative activity", () => {
    expect(
      isAdministrativeBooking({
        projectDescription: "This is the rescheduled call from August 25th.",
        fields: { Topic: "This is the rescheduled call from August 25th." },
      })
    ).toBe(true);
    expect(
      isAdministrativeBooking({
        projectDescription: "Build a home library with arched built-ins.",
        fields: {},
      })
    ).toBe(false);
  });

  it("rejects a non-Doodle message even if its subject resembles a booking", async () => {
    const raw = new TextEncoder().encode(
      [
        "From: Someone <person@example.com>",
        "To: noah@fromtrees.studio",
        "Subject: New time booked for Free In Home Consultation w/ Fake Person",
        'Content-Type: text/plain; charset="utf-8"',
        "",
        "not doodle",
      ].join("\r\n")
    ).buffer;
    expect(await parseDoodleBooking(raw)).toBeNull();
  });
});
