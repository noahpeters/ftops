type FetcherLike = {
  fetch: (input: RequestInfo, init?: RequestInit) => Promise<Response>;
};

type ApiProxyEnv = {
  API?: FetcherLike;
};

type AllowlistEntry = {
  methods: ReadonlySet<string>;
  pattern: RegExp;
};

const ACCESS_HEADER_KEYS = [
  "cf-access-authenticated-user-email",
  "x-auth-request-email",
  "x-debug-user-email",
];

const FORWARDED_HEADER_KEYS = [
  "accept",
  "content-type",
  "x-debug-user-email",
  "x-auth-request-email",
  "cf-access-authenticated-user-email",
];

const ALLOWLIST: AllowlistEntry[] = [
  { methods: new Set(["GET"]), pattern: /^\/events$/ },
  { methods: new Set(["POST"]), pattern: /^\/events\/test$/ },
  { methods: new Set(["GET"]), pattern: /^\/plan\/preview$/ },
  { methods: new Set(["GET"]), pattern: /^\/commercial-records(?:\/[^/]+)?$/ },
  { methods: new Set(["GET", "POST"]), pattern: /^\/projects$/ },
  { methods: new Set(["POST"]), pattern: /^\/projects\/from-record$/ },
  { methods: new Set(["POST"]), pattern: /^\/projects\/[^/]+\/materialize$/ },
  { methods: new Set(["GET"]), pattern: /^\/projects\/[^/]+$/ },
  { methods: new Set(["GET"]), pattern: /^\/projects\/[^/]+\/tasks$/ },
  { methods: new Set(["PATCH"]), pattern: /^\/tasks\/[^/]+$/ },
  { methods: new Set(["GET", "POST"]), pattern: /^\/tasks\/[^/]+\/notes$/ },
  { methods: new Set(["GET", "POST"]), pattern: /^\/workspaces$/ },
  { methods: new Set(["GET", "PATCH", "DELETE"]), pattern: /^\/workspaces\/[^/]+$/ },
  { methods: new Set(["GET", "POST"]), pattern: /^\/integrations$/ },
  { methods: new Set(["GET", "PATCH", "DELETE"]), pattern: /^\/integrations\/[^/]+$/ },
  { methods: new Set(["GET", "POST"]), pattern: /^\/templates$/ },
  { methods: new Set(["GET", "PATCH", "DELETE"]), pattern: /^\/templates\/[^/]+$/ },
  { methods: new Set(["POST"]), pattern: /^\/templates\/[^/]+\/rules$/ },
  { methods: new Set(["PATCH", "DELETE"]), pattern: /^\/templates\/[^/]+\/rules\/[^/]+$/ },
  { methods: new Set(["GET"]), pattern: /^\/ingest\/requests(?:\/[^/]+)?$/ },
  { methods: new Set(["POST"]), pattern: /^\/admin\/ingest-requests\/[^/]+\/replay$/ },
];

export async function handleApiProxyRequest(request: Request, env: ApiProxyEnv): Promise<Response> {
  const url = new URL(request.url);
  const path = stripApiPrefix(url.pathname);
  if (!path) {
    return jsonError("not_found", 404);
  }

  if (!hasAccessHeader(request.headers)) {
    return jsonError("unauthorized", 401);
  }

  if (!isAllowed(path, request.method)) {
    return jsonError("proxy_not_allowed", 403);
  }

  if (!env.API) {
    return jsonError("api_binding_missing", 502);
  }

  const upstream = new URL(path, "http://internal");
  upstream.search = url.search;

  const headers = buildProxyHeaders(request.headers);
  const body = await readBody(request);

  const upstreamRequest = new Request(upstream.toString(), {
    method: request.method,
    headers,
    body,
  });

  return await env.API.fetch(upstreamRequest);
}

function stripApiPrefix(pathname: string) {
  if (!pathname.startsWith("/api")) {
    return null;
  }
  const trimmed = pathname.replace(/^\/api/, "");
  if (!trimmed || trimmed === "/") {
    return null;
  }
  return trimmed;
}

function hasAccessHeader(headers: Headers) {
  return ACCESS_HEADER_KEYS.some((key) => headers.get(key));
}

function isAllowed(path: string, method: string) {
  const normalizedMethod = method.toUpperCase();
  return ALLOWLIST.some((entry) => entry.pattern.test(path) && entry.methods.has(normalizedMethod));
}

function buildProxyHeaders(source: Headers) {
  const headers = new Headers();
  for (const key of FORWARDED_HEADER_KEYS) {
    const value = source.get(key);
    if (value) {
      headers.set(key, value);
    }
  }
  return headers;
}

async function readBody(request: Request) {
  if (request.method === "GET" || request.method === "HEAD") {
    return undefined;
  }
  return await request.arrayBuffer();
}

function jsonError(code: string, status: number) {
  return new Response(JSON.stringify({ error: code }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export type { ApiProxyEnv, FetcherLike };
