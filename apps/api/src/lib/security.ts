const TRUSTED_ORIGINS = new Set([
  "https://ops.from-trees.com",
  "http://localhost:5173",
  "http://localhost:8787",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:8787",
]);

export function isTrustedMutationOrigin(request: Request) {
  const origin = request.headers.get("Origin");
  return Boolean(origin && TRUSTED_ORIGINS.has(origin));
}

export function sanitizeExternalError(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : fallback;
  if (/^[a-z0-9_-]{1,100}$/i.test(message)) return message;
  return fallback;
}

export function noStore(response: Response) {
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "no-store, no-cache, must-revalidate, private");
  headers.set("Pragma", "no-cache");
  headers.set("Expires", "0");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function safeRedirect(target: string, allowed: ReadonlySet<string>) {
  const url = new URL(target);
  const key = `${url.origin}${url.pathname}`;
  if (!allowed.has(key)) throw new Error("redirect_not_allowed");
  return new Response(null, {
    status: 302,
    headers: {
      Location: url.toString(),
      "Cache-Control": "no-store, no-cache, must-revalidate, private",
      Pragma: "no-cache",
      Expires: "0",
    },
  });
}
