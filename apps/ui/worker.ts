import { createRequestHandler } from "@react-router/cloudflare";

let handlerPromise: Promise<ReturnType<typeof createRequestHandler>> | null = null;

async function loadBuild() {
  const virtualSpecifier = ["virtual:react-router/server-build"].join("");
  try {
    return await import(virtualSpecifier);
  } catch (error) {
    console.warn("Falling back to build/server index.js for server build.", error);
    return await import("./build/server/index.js");
  }
}

async function getHandler() {
  if (!handlerPromise) {
    handlerPromise = loadBuild().then((build) =>
      createRequestHandler({
        build,
        getLoadContext({ request, context }) {
          return {
            cloudflare: {
              ...context.cloudflare,
              cf: request.cf ?? {},
            },
          };
        },
      })
    );
  }
  return handlerPromise;
}

export default {
  async fetch(request: Request, env: Record<string, unknown>, ctx: ExecutionContext) {
    try {
      const handler = await getHandler();
      return await handler({
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
