const ALLOWED_ORIGINS = new Set([
  "https://ops.from-trees.com",
  "http://localhost:5173",
  "http://localhost:8787",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:8787",
]);

const ALLOWED_HEADERS =
  "content-type,x-debug-user-email,x-auth-request-email,cf-access-authenticated-user-email";

export function getCorsContext(request: Request) {
  const origin = request.headers.get("Origin");
  if (!origin) {
    return { allowed: true, headers: {} as Record<string, string> };
  }
  if (!ALLOWED_ORIGINS.has(origin)) {
    return { allowed: false, headers: { Vary: "Origin" } as Record<string, string> };
  }

  return {
    allowed: true,
    headers: {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Credentials": "true",
      "Access-Control-Allow-Methods": "GET,POST,PATCH,PUT,DELETE,OPTIONS",
      "Access-Control-Allow-Headers": ALLOWED_HEADERS,
      Vary: "Origin",
    },
  };
}

export function applyCorsHeaders(response: Response, corsHeaders: Record<string, string>) {
  if (Object.keys(corsHeaders).length === 0) {
    return response;
  }

  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(corsHeaders)) {
    headers.set(key, value);
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function withCors(request: Request, response: Response) {
  const cors = getCorsContext(request);
  return applyCorsHeaders(response, cors.headers);
}

export function corsPreflight(request: Request) {
  const cors = getCorsContext(request);
  if (!cors.allowed) {
    return applyCorsHeaders(
      new Response(JSON.stringify({ error: "origin_not_allowed" }), {
        status: 403,
        headers: { "content-type": "application/json" },
      }),
      cors.headers
    );
  }

  return applyCorsHeaders(new Response(null, { status: 204 }), cors.headers);
}
