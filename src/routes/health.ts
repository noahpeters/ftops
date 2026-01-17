import { json, methodNotAllowed, notFound } from "../lib/http";
import type { Env } from "../lib/types";

export async function handleHealth(
  segments: string[],
  request: Request,
  _env: Env,
  _ctx: ExecutionContext,
  _url: URL
) {
  if (segments.length > 0) {
    return notFound("Route not found");
  }

  if (request.method !== "GET") {
    return methodNotAllowed(["GET"]);
  }

  return json({ status: "ok" });
}
