import { describe, expect, it } from "vitest";
import { sha256Hex } from "../../src/lib/hash";

describe("sha256Hex", () => {
  it("returns consistent SHA-256 hex", async () => {
    const result = await sha256Hex("abc");
    expect(result).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});
