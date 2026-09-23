import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("API public exposure", () => {
  it("publishes intake without publishing the staff API or a workers.dev endpoint", () => {
    const config = readFileSync("wrangler.toml", "utf8");
    const publicPatterns = [...config.matchAll(/pattern\s*=\s*"([^"]+)"/g)].map(
      (match) => match[1]
    );
    expect(publicPatterns).toEqual(["api.from-trees.com/website-intake/*"]);
    expect(config).toMatch(/^workers_dev\s*=\s*false\s*$/m);
  });
});
