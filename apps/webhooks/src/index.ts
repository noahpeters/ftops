import { notFound } from "./lib/http";
import type { Env } from "./lib/types";
import { handleIngest } from "./routes/ingest";

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);
    const segments = url.pathname.split("/").filter(Boolean);

    if (segments.length === 0) {
      return notFound("Route not found");
    }

    if (segments[0] === "ingest") {
      return handleIngest(segments.slice(1), request, env, ctx, url);
    }

    return notFound("Route not found");
  },
};
