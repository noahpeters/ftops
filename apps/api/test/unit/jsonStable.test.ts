import { describe, expect, it } from "vitest";
import { stableStringify } from "../../src/lib/jsonStable";

describe("stableStringify", () => {
  it("sorts keys deterministically", () => {
    const value = { b: 2, a: 1 };
    expect(stableStringify(value)).toBe('{"a":1,"b":2}');
  });

  it("sorts nested objects deterministically", () => {
    const value = { z: { b: 2, a: 1 }, a: [1, { d: 4, c: 3 }] };
    expect(stableStringify(value)).toBe('{"a":[1,{"c":3,"d":4}],"z":{"a":1,"b":2}}');
  });
});
