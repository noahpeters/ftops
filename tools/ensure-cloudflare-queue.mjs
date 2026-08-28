import { execFileSync } from "node:child_process";

const queueName = process.argv[2];
if (!queueName) throw new Error("queue name is required");

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const baseArgs = ["--workspace", "apps/webhooks", "exec", "--", "wrangler", "queues"];
const output = execFileSync(npmCommand, [...baseArgs, "list", "--json"], {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "inherit"],
});
const queues = JSON.parse(output);
if (!Array.isArray(queues)) throw new Error("unexpected Cloudflare queue list response");

if (queues.some((queue) => queue?.queue_name === queueName || queue?.name === queueName)) {
  console.log(`Queue ${queueName} already exists.`);
} else {
  execFileSync(npmCommand, [...baseArgs, "create", queueName], { stdio: "inherit" });
}
