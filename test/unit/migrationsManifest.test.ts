import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MIGRATIONS } from "../../src/generated/migrationsManifest";

function scanMigrations(dir: string) {
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".sql"))
    .sort((a, b) => a.localeCompare(b));
}

describe("migrations manifest", () => {
  it("matches the migrations folder", () => {
    const migrationsDir = path.resolve(process.cwd(), "migrations");
    const expected = scanMigrations(migrationsDir);
    if (JSON.stringify(MIGRATIONS) !== JSON.stringify(expected)) {
      throw new Error(
        "migrations manifest out of date; run npm run gen:migrations"
      );
    }
    expect(MIGRATIONS).toEqual(expected);
  });
});
