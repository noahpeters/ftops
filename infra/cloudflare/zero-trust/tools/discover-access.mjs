#!/usr/bin/env node

import fs from "node:fs";

const args = process.argv.slice(2);
const hosts = [];
let outPath = null;

for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (arg === "--host") {
    const host = args[i + 1];
    if (!host) {
      throw new Error("--host requires a value");
    }
    hosts.push(host);
    i += 1;
  } else if (arg === "--out") {
    outPath = args[i + 1];
    if (!outPath) {
      throw new Error("--out requires a value");
    }
    i += 1;
  }
}

const defaultHosts = ["api.from-trees.com", "ops.from-trees.com"];
const targetHosts = hosts.length > 0 ? hosts : defaultHosts;

const apiToken = process.env.CLOUDFLARE_API_TOKEN;
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;

if (!apiToken || !accountId) {
  console.error("CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID must be set.");
  process.exit(1);
}

async function apiRequest(path) {
  const resp = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    headers: {
      Authorization: `Bearer ${apiToken}`,
    },
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Cloudflare API error (${resp.status}): ${body}`);
  }

  const payload = await resp.json();
  if (!payload.success) {
    throw new Error(`Cloudflare API failure: ${JSON.stringify(payload.errors)}`);
  }
  return payload.result;
}

function matchesHost(app, host) {
  const domains = new Set();
  if (app.domain) {
    domains.add(app.domain);
  }
  for (const item of app.self_hosted_domains || []) {
    domains.add(item);
  }
  for (const destination of app.destinations || []) {
    if (destination?.uri) {
      domains.add(destination.uri);
    }
  }
  return Array.from(domains).some((entry) => entry.includes(host));
}

const apps = await apiRequest(`/accounts/${accountId}/access/apps`);
const filteredApps = apps.filter((app) =>
  targetHosts.some((host) => matchesHost(app, host))
);

const reportApps = [];
for (const app of filteredApps) {
  const policies = await apiRequest(
    `/accounts/${accountId}/access/apps/${app.id}/policies`
  );

  reportApps.push({
    id: app.id,
    name: app.name,
    type: app.type,
    domain: app.domain,
    self_hosted_domains: app.self_hosted_domains || [],
    destinations: app.destinations || [],
    session_duration: app.session_duration,
    app_launcher_visible: app.app_launcher_visible,
    auto_redirect_to_identity: app.auto_redirect_to_identity,
    http_only_cookie_attribute: app.http_only_cookie_attribute,
    same_site_cookie_attribute: app.same_site_cookie_attribute,
    options_preflight_bypass: app.options_preflight_bypass,
    allowed_idps: app.allowed_idps || [],
    policies: policies.map((policy) => ({
      id: policy.id,
      name: policy.name,
      decision: policy.decision,
      precedence: policy.precedence,
      include: policy.include,
      exclude: policy.exclude,
      require: policy.require,
      session_duration: policy.session_duration,
      reusable: policy.reusable,
    })),
  });
}

const report = {
  generated_at: new Date().toISOString(),
  account_id: accountId,
  hosts: targetHosts,
  apps: reportApps,
};

const output = JSON.stringify(report, null, 2);
console.log(output);

if (outPath) {
  fs.writeFileSync(outPath, output + "\n");
}
