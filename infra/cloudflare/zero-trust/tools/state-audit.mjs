#!/usr/bin/env node

import { spawnSync } from "node:child_process";

const commands = [
  ["terraform", ["workspace", "show"]],
  ["terraform", ["state", "list"]],
  ["terraform", ["providers"]],
];

let exitCode = 0;

for (const [command, args] of commands) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.status !== 0) {
    exitCode = result.status ?? 1;
  }
}

process.exit(exitCode);
