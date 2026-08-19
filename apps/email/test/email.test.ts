import { describe, expect, it, vi } from "vitest";
import worker from "../src/index";

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

function emailMessage(raw: string) {
  return {
    from: "Owner@Example.com",
    to: "Notes@In.Example.com",
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
