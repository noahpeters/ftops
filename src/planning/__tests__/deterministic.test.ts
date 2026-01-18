import { describe, expect, it } from "vitest";
import { sha256Hex, stableStringify } from "../deterministic";

describe("stableStringify", () => {
  it("sorts object keys recursively", () => {
    const value = { b: 2, a: { d: 4, c: 3 }, list: [{ z: 1, y: 2 }] };
    const result = stableStringify(value);
    expect(result).toBe('{"a":{"c":3,"d":4},"b":2,"list":[{"y":2,"z":1}]}');
  });
});

describe("sha256Hex", () => {
  it("hashes deterministically", async () => {
    const hash = await sha256Hex("hello");
    expect(hash).toBe("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
  });
});
