#!/usr/bin/env node
/* eslint-disable no-console */
/* AUTO-GENERATED manifest builder */
const fs = require("fs");
const path = require("path");

const migrationsDir = path.resolve(__dirname, "..", "migrations");
const outputDir = path.resolve(__dirname, "..", "src", "generated");
const outputFile = path.join(outputDir, "migrationsManifest.ts");

function listMigrationFiles() {
  if (!fs.existsSync(migrationsDir)) {
    throw new Error(`migrations directory not found: ${migrationsDir}`);
  }
  return fs
    .readdirSync(migrationsDir)
    .filter((name) => name.endsWith(".sql"))
    .sort((a, b) => a.localeCompare(b));
}

function buildOutput(filenames) {
  const latest = filenames[filenames.length - 1] || "";
  return `// AUTO-GENERATED. DO NOT EDIT.
export const MIGRATIONS = ${JSON.stringify(filenames, null, 2)} as const;
export const LATEST_MIGRATION = ${JSON.stringify(latest)};
export const MIGRATIONS_COUNT = ${filenames.length};
`;
}

function main() {
  const filenames = listMigrationFiles();
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  const output = buildOutput(filenames);
  fs.writeFileSync(outputFile, output, "utf8");
  console.log(
    `Generated migrations manifest with ${filenames.length} entries.`
  );
}

main();
