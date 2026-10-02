export type SketchupHost = { fromTreesImport?: (message: string) => void };
export function sketchupContext(search: string, host?: SketchupHost) {
  const query = new URLSearchParams(search);
  const nonce = query.get("bridge");
  if (query.get("sketchup") !== "1" || !nonce || !/^[a-f0-9]{64}$/.test(nonce)) return null;
  if (typeof host?.fromTreesImport !== "function") return null;
  return { nonce, send: host.fromTreesImport.bind(host) };
}
export function importMessage(nonce: string, requestId: string, manifest: unknown) {
  if (!/^[a-f0-9]{64}$/.test(nonce) || !/^[a-f0-9-]{36}$/.test(requestId))
    throw new Error("Invalid SketchUp session");
  return JSON.stringify({ nonce, requestId, manifest });
}
export function matchingImportResult(detail: unknown, nonce: string, requestId: string) {
  if (!detail || typeof detail !== "object") return null;
  const result = detail as Record<string, unknown>;
  return result.nonce === nonce &&
    result.requestId === requestId &&
    typeof result.ok === "boolean" &&
    typeof result.message === "string"
    ? { ok: result.ok, message: result.message.slice(0, 1000) }
    : null;
}
