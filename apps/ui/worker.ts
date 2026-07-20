import { createRequestHandler } from "@react-router/cloudflare";
import * as build from "virtual:react-router/server-build";
import { handleApiProxyRequest } from "./src/worker/apiProxy";
import type { ExecutionContext, IncomingRequestCfProperties } from "@cloudflare/workers-types";

type Env = {
  ASSETS: { fetch: typeof fetch };
  API?: { fetch: typeof fetch };
};

const handler = createRequestHandler({
  build,
  getLoadContext({ request, context }) {
    const cf = (request as Request & { cf?: IncomingRequestCfProperties }).cf ?? {};
    return {
      cloudflare: {
        ...context.cloudflare,
        cf,
      },
    };
  },
});

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    try {
      if (new URL(request.url).pathname.startsWith("/api/")) {
        return await handleApiProxyRequest(request, env);
      }
      const handlerFn = handler as unknown as (context: {
        request: Request;
        env: Env;
        params: Record<string, string>;
        waitUntil: ExecutionContext["waitUntil"];
        passThroughOnException: ExecutionContext["passThroughOnException"];
        next: () => Promise<Response>;
      }) => Promise<Response>;
      return await handlerFn({
        request,
        env,
        params: {},
        waitUntil: ctx.waitUntil.bind(ctx),
        passThroughOnException:
          "passThroughOnException" in ctx
            ? (ctx.passThroughOnException as () => void).bind(ctx)
            : () => {},
        next() {
          return Promise.resolve(new Response("Not Found", { status: 404 }));
        },
      });
    } catch (error) {
      console.error(error);
      return new Response("Internal Server Error", { status: 500 });
    }
  },
};
