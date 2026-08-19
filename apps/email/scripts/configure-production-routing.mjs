const apiToken = process.env.CLOUDFLARE_API_TOKEN;
const zoneId = process.env.EMAIL_ROUTING_ZONE_ID;
const subdomain = process.env.EMAIL_ROUTING_SUBDOMAIN;
const address = process.env.EMAIL_ROUTING_ADDRESS;
const worker = process.env.EMAIL_ROUTING_WORKER;

for (const [name, value] of Object.entries({
  CLOUDFLARE_API_TOKEN: apiToken,
  EMAIL_ROUTING_ZONE_ID: zoneId,
  EMAIL_ROUTING_SUBDOMAIN: subdomain,
  EMAIL_ROUTING_ADDRESS: address,
  EMAIL_ROUTING_WORKER: worker,
})) {
  if (!value) throw new Error(`${name} is required`);
}

if (!address.endsWith(`@${subdomain}`)) {
  throw new Error(
    "EMAIL_ROUTING_ADDRESS must belong to EMAIL_ROUTING_SUBDOMAIN",
  );
}

const baseUrl = `https://api.cloudflare.com/client/v4/zones/${zoneId}/email/routing`;
const headers = {
  Authorization: `Bearer ${apiToken}`,
  "Content-Type": "application/json",
};

async function cloudflare(path, init = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { ...headers, ...init.headers },
  });
  const payload = await response.json();
  if (!response.ok || !payload.success) {
    const detail =
      payload.errors?.map((error) => error.message).join("; ") ||
      response.statusText;
    throw new Error(`Cloudflare Email Routing request failed: ${detail}`);
  }
  return payload.result;
}

// Supplying the subdomain name is critical: omitting it would modify apex MX records.
const dns = await cloudflare("/dns", {
  method: "POST",
  body: JSON.stringify({ name: subdomain }),
});

if (dns?.name && dns.name !== subdomain) {
  throw new Error(
    `Cloudflare configured unexpected routing domain ${dns.name}`,
  );
}

const rules = await cloudflare("/rules");
const existing = rules.find((rule) =>
  rule.matchers?.some(
    (matcher) =>
      matcher.type === "literal" &&
      matcher.field === "to" &&
      matcher.value?.toLowerCase() === address,
  ),
);

const desired = {
  name: `FTOPS customer notes (${address})`,
  enabled: true,
  matchers: [{ type: "literal", field: "to", value: address }],
  actions: [{ type: "worker", value: [worker] }],
  priority: existing?.priority ?? 0,
};

if (existing?.id) {
  await cloudflare(`/rules/${existing.id}`, {
    method: "PUT",
    body: JSON.stringify(desired),
  });
  console.log(`Updated Email Routing rule for ${address}`);
} else {
  await cloudflare("/rules", {
    method: "POST",
    body: JSON.stringify(desired),
  });
  console.log(`Created Email Routing rule for ${address}`);
}

console.log(
  `Email Routing is configured on ${subdomain} without changing apex MX records`,
);
