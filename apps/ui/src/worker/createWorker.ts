import { createRequestHandler } from "@react-router/cloudflare";
import type { ExecutionContext, IncomingRequestCfProperties } from "@cloudflare/workers-types";
import type { ServerBuild } from "react-router";
import { handleApiProxyRequest } from "./apiProxy";

type Env = {
  ASSETS: { fetch: typeof fetch };
  API?: { fetch: typeof fetch };
};

export function createWorker(build: ServerBuild) {
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

  return {
    async fetch(request: Request, env: Env, ctx: ExecutionContext) {
      try {
        if (new URL(request.url).pathname.startsWith("/api/")) {
          return noStore(await handleApiProxyRequest(request, env));
        }
        const handlerFn = handler as unknown as (context: {
          request: Request;
          env: Env;
          params: Record<string, string>;
          waitUntil: ExecutionContext["waitUntil"];
          passThroughOnException: ExecutionContext["passThroughOnException"];
          next: () => Promise<Response>;
        }) => Promise<Response>;
        return noStore(
          await handlerFn({
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
          })
        );
      } catch (error) {
        console.error(error);
        return noStore(new Response("Internal Server Error", { status: 500 }));
      }
    },
  };
}

function noStore(response: Response) {
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
