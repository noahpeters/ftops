import { spawnSync } from "node:child_process";
const command = process.platform === "win32" ? "npm.cmd" : "npm";
const result = spawnSync(
  command,
  [
    "--workspace",
    "apps/api",
    "exec",
    "--",
    "wrangler",
    "r2",
    "bucket",
    "create",
    "ftops-billing-documents",
  ],
  { encoding: "utf8" },
);
const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
if (
  result.status === 0 ||
  /already exists|already_exists|already own/i.test(output)
)
  console.log("Private billing document bucket is available.");
else {
  console.error("Could not provision the private billing document bucket.");
  process.exitCode = result.status || 1;
}
