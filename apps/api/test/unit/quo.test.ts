import { describe, expect, it } from "vitest";
import { contactBody, normalizePhone } from "../../src/services/quo";

describe("Quo contact mapping", () => {
  it("normalizes North American and international phone numbers to E.164", () => {
    expect(normalizePhone("(415) 555-0123")).toBe("+14155550123");
    expect(normalizePhone("1-415-555-0123")).toBe("+14155550123");
    expect(normalizePhone("+44 20 7946 0958")).toBe("+442079460958");
    expect(normalizePhone("555-0100")).toBeNull();
  });

  it("maps a human contact and keeps the Customer as company context", () => {
    expect(
      contactBody({
        id: "contact-1",
        first_name: "Alex",
        last_name: "Smith",
        display_name: "Alex Smith",
        email: "alex@example.com",
        phone: "4155550123",
        role: "Homeowner",
        status: "active",
        customer_status: "lead",
        customer_display_name: "Smith Residence",
        company_name: null,
      })
    ).toEqual({
      firstName: "Alex",
      lastName: "Smith",
      company: "Smith Residence",
      role: "Homeowner",
      emails: [{ name: "work", value: "alex@example.com" }],
      phoneNumbers: [{ name: "primary", value: "+14155550123" }],
    });
  });
});
