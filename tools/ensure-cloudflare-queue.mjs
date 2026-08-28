import { spawnSync } from "node:child_process";

const queueName = process.argv[2];
if (!queueName) throw new Error("queue name is required");

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const baseArgs = [
  "--workspace",
  "apps/webhooks",
  "exec",
  "--",
  "wrangler",
  "queues",
];
const result = spawnSync(npmCommand, [...baseArgs, "create", queueName], {
  encoding: "utf8",
});
const output = `${result.stdout || ""}\n${result.stderr || ""}`;
if (result.status === 0) {
  process.stdout.write(output);
} else if (
  /already exists|already_exists|already taken|code:\s*11009/i.test(output)
) {
  console.log(`Queue ${queueName} already exists.`);
} else {
  process.stdout.write(result.stdout || "");
  process.stderr.write(result.stderr || "");
  process.exit(result.status || 1);
}
