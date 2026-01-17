const JSON_HEADERS = { "content-type": "application/json" };

export function json(
  data: unknown,
  status = 200,
  headers: Record<string, string> = {}
) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...JSON_HEADERS, ...headers },
  });
}

export function badRequest(message: string, extra: Record<string, unknown> = {}) {
  return json({ error: message, ...extra }, 400);
}

export function notFound(message: string, extra: Record<string, unknown> = {}) {
  return json({ error: message, ...extra }, 404);
}

export function methodNotAllowed(allowed: string[]) {
  return json({ error: "Method Not Allowed", allowed }, 405, {
    allow: allowed.join(", "),
  });
}

export function serverError(message: string, extra: Record<string, unknown> = {}) {
  return json({ error: message, ...extra }, 500);
}
