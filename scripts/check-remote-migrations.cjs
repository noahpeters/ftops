#!/usr/bin/env node

const { execFileSync } = require("node:child_process");
const path = require("node:path");

const apiDir = path.resolve(__dirname, "..", "apps", "api");

function runWranglerListRemote() {
  return execFileSync(
    "npx",
    ["wrangler", "d1", "migrations", "list", "ftops-db", "--remote"],
    {
      cwd: apiDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }
  );
}

function hasUnappliedMigrations(output) {
  return /\.sql\b/.test(output);
}

function main() {
  try {
    const output = runWranglerListRemote();
    if (hasUnappliedMigrations(output)) {
      console.error(
        "Remote D1 has unapplied migrations. Run: npm --workspace apps/api run db:migrate:remote"
      );
      console.error(output.trim());
      process.exit(1);
    }
    process.stdout.write("Remote migrations are up to date.\n");
  } catch (error) {
    console.error("Failed to check remote migrations.");
    if (error && error.stderr) {
      process.stderr.write(error.stderr.toString());
    } else if (error && error.message) {
      console.error(error.message);
    }
    process.exit(1);
  }
}

main();
