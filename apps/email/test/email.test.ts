import { describe, expect, it, vi } from "vitest";
import worker, { isTrustedDoodleForward } from "../src/index";

describe("inbound email worker", () => {
  it("passes the raw MIME and signed workspace-routing envelopes to FTOPS", async () => {
    const raw =
      "From: Customer <customer@example.com>\r\nSubject: White oak\r\n\r\nUse white oak.";
    const fetch = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        expect(init?.headers).toMatchObject({
          "x-ftops-envelope-from": "owner@example.com",
          "x-ftops-envelope-to": "notes@in.example.com",
        });
        expect(await new Response(init?.body).text()).toBe(raw);
        expect(
          String(
            (init?.headers as Record<string, string>)[
              "x-ftops-email-signature"
            ],
          ),
        ).toMatch(/^[a-f0-9]{64}$/);
        return new Response(JSON.stringify({ status: "queued" }), {
          status: 202,
        });
      },
    );
    const message = emailMessage(raw);
    await worker.email!(message, {
      API: { fetch },
      EMAIL_INGESTION_SECRET: "test-secret",
    });
    expect(fetch).toHaveBeenCalledOnce();
    expect(message.setReject).not.toHaveBeenCalled();
  });

  it("authorizes an authenticated Doodle booking on the dedicated mailbox", async () => {
    const raw = [
      "Return-Path: <bounce+example@doodle.com>",
      "Authentication-Results: dmarc.icloud.com; dmarc=pass header.from=doodle.com",
      "Authentication-Results: dkim-verifier.icloud.com; dkim=pass header.d=doodle.com header.i=@doodle.com",
      "DKIM-Signature: a=rsa-sha256; d=doodle.com; s=pic; b=abc",
      "Subject: New time booked for Free In Home Consultation w/ Mariam",
      "From: Doodle <mailer@doodle.com>",
      "X-Mailgun-Template-Name: SE_PARTICIPATION_NOTIF_BOOKING_O",
      "",
      "Doodle booking body",
    ].join("\r\n");
    const rawBuffer = new TextEncoder().encode(raw).buffer;
    expect(
      isTrustedDoodleForward(rawBuffer, "doodle@ops.fromtrees.studio"),
    ).toBe(true);

    const fetch = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        expect(init?.headers).toMatchObject({
          "x-ftops-envelope-from": "doodle@doodle.com",
          "x-ftops-original-envelope-from": "srs0=forwarded@icloud.com",
          "x-ftops-envelope-to": "doodle@ops.fromtrees.studio",
        });
        return new Response(JSON.stringify({ status: "queued" }), {
          status: 202,
        });
      },
    );
    const message = emailMessage(raw, {
      from: "SRS0=forwarded@icloud.com",
      to: "doodle@ops.fromtrees.studio",
    });
    await worker.email!(message, {
      API: { fetch },
      EMAIL_INGESTION_SECRET: "test-secret",
    });
    expect(fetch).toHaveBeenCalledOnce();
    expect(message.setReject).not.toHaveBeenCalled();
  });

  it("does not grant Doodle authorization outside the dedicated mailbox", () => {
    const raw = new TextEncoder().encode(
      [
        "Authentication-Results: x; dmarc=pass header.from=doodle.com",
        "DKIM-Signature: d=doodle.com; b=abc",
        "Subject: New time booked for Test w/ Person",
        "From: Doodle <mailer@doodle.com>",
        "X-Mailgun-Template-Name: SE_PARTICIPATION_NOTIF_BOOKING_O",
        "",
        "test",
      ].join("\r\n"),
    ).buffer;
    expect(isTrustedDoodleForward(raw, "notes@ops.fromtrees.studio")).toBe(
      false,
    );
  });

  it("rejects unauthorized senders when FTOPS returns forbidden", async () => {
    const message = emailMessage("Subject: no\r\n\r\nno");
    await worker.email!(message, {
      API: {
        fetch: vi.fn(async () => new Response("forbidden", { status: 403 })),
      },
      EMAIL_INGESTION_SECRET: "test-secret",
    });
    expect(message.setReject).toHaveBeenCalledWith(
      "This sender or FTOPS mailbox is not authorized",
    );
  });
});

function emailMessage(
  raw: string,
  envelope: { from?: string; to?: string } = {},
) {
  return {
    from: envelope.from || "Owner@Example.com",
    to: envelope.to || "Notes@In.Example.com",
    headers: new Headers(),
    raw: new Response(raw).body!,
    rawSize: new TextEncoder().encode(raw).byteLength,
    setReject: vi.fn(),
    forward: vi.fn(),
    reply: vi.fn(),
  } as unknown as ForwardableEmailMessage & {
    setReject: ReturnType<typeof vi.fn>;
  };
}
