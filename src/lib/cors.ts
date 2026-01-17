const ALLOWED_ORIGINS = new Set(["https://ops.from-trees.com", "http://localhost:5173"]);

export function getCorsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get("Origin");
  if (!origin || !ALLOWED_ORIGINS.has(origin)) {
    return {};
  }

  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "content-type",
    Vary: "Origin",
  };
}

export function withCors(request: Request, response: Response) {
  const corsHeaders = getCorsHeaders(request);
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

export function corsPreflight(request: Request) {
  return withCors(request, new Response(null, { status: 204 }));
}
