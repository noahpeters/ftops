#!/usr/bin/env node

import { spawnSync } from "node:child_process";

const apiToken = process.env.CLOUDFLARE_API_TOKEN;
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;

if (!apiToken || !accountId) {
  console.error("CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID must be set.");
  process.exit(1);
}

const resources = [
  {
    address: "cloudflare_zero_trust_access_application.legal_privacy",
    name: "ftops-legal-privacy",
    domain: "ops.from-trees.com/legal/privacy",
  },
  {
    address: "cloudflare_zero_trust_access_application.legal_eula",
    name: "ftops-legal-eula",
    domain: "ops.from-trees.com/legal/eula",
  },
];

function isManaged(address) {
  return (
    spawnSync("terraform", ["state", "show", address], {
      stdio: "ignore",
    }).status === 0
  );
}

function importResource(address, id) {
  const imported = spawnSync(
    "terraform",
    ["import", "-input=false", address, id],
    { stdio: "inherit" },
  );
  if (imported.status !== 0) process.exit(imported.status ?? 1);
}

const legalPolicyAddress = "cloudflare_zero_trust_access_policy.public_legal";
if (!isManaged(legalPolicyAddress)) {
  importResource(
    legalPolicyAddress,
    `account/${accountId}/af136f20-30a8-4b01-b6e8-449da982ea92`,
  );
}

const response = await fetch(
  `https://api.cloudflare.com/client/v4/accounts/${accountId}/access/apps`,
  {
    headers: { Authorization: `Bearer ${apiToken}` },
  },
);
const payload = await response.json();
if (!response.ok || !payload.success) {
  console.error(
    `Unable to discover Cloudflare Access applications (${response.status}).`,
  );
  process.exit(1);
}

for (const resource of resources) {
  if (isManaged(resource.address)) continue;

  const matches = payload.result.filter(
    (application) =>
      application.name === resource.name &&
      application.domain === resource.domain,
  );
  if (matches.length !== 1) {
    console.error(
      `Expected exactly one ${resource.name} application at ${resource.domain}; found ${matches.length}.`,
    );
    process.exit(1);
  }

  importResource(resource.address, `${accountId}/${matches[0].id}`);
}
