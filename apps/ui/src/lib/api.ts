export type FetchJsonResult<T = unknown> = {
  ok: boolean;
  status: number;
  data: T | null;
  text: string;
  headers: Headers;
  durationMs: number;
};

let debugEmailHeader = "";

export function setDebugEmailHeader(value: string): void {
  debugEmailHeader = value;
}

export function getApiBase(): string {
  if (import.meta.env.DEV) {
    return import.meta.env.VITE_FTOPS_API_BASE_URL || "http://localhost:8787";
  }
  return import.meta.env.VITE_FTOPS_API_BASE_URL || "https://api.from-trees.com";
}

export function buildUrl(
  path: string,
  params?: Record<string, string | number | boolean | undefined | null>
): string {
  const base = getApiBase().replace(/\/$/, "");
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const url = new URL(`${base}${normalizedPath}`);

  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null) continue;
      url.searchParams.set(key, String(value));
    }
  }

  return url.toString();
}

export async function fetchJson<T>(
  url: string,
  init: RequestInit = {}
): Promise<FetchJsonResult<T>> {
  const start = performance.now();
  let response: Response;
  let text = "";
  let data: T | null = null;
  const headers = new Headers(init.headers || {});

  if (import.meta.env.DEV && debugEmailHeader) {
    headers.set("X-Debug-User-Email", debugEmailHeader);
  }

  try {
    response = await fetch(url, {
      ...init,
      credentials: "include",
      headers,
    });
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : "Network request failed");
  }

  try {
    text = await response.text();
    if (text) {
      data = JSON.parse(text) as T;
    }
  } catch (error) {
    const durationMs = Math.round(performance.now() - start);
    return {
      ok: response.ok,
      status: response.status,
      data: null,
      text,
      headers: response.headers,
      durationMs,
    };
  }

  const durationMs = Math.round(performance.now() - start);
  return {
    ok: response.ok,
    status: response.status,
    data,
    text,
    headers: response.headers,
    durationMs,
  };
}
