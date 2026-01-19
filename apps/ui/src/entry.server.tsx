import { renderToPipeableStream } from "react-dom/server";
import { ServerRouter, type EntryContext } from "react-router";

export default async function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  reactRouterContext: EntryContext
) {
  const { PassThrough, Readable } = await import("node:stream");

  return await new Promise<Response>((resolve, reject) => {
    let didError = false;
    let passThrough: InstanceType<typeof PassThrough> | null = null;

    const stream = renderToPipeableStream(
      <ServerRouter context={reactRouterContext} url={request.url} />,
      {
        onAllReady() {
          passThrough = new PassThrough();
          stream.pipe(passThrough);
          const body = Readable.toWeb(passThrough) as ReadableStream;

          responseHeaders.set("Content-Type", "text/html");
          resolve(
            new Response(body, {
              status: didError ? 500 : responseStatusCode,
              headers: responseHeaders,
            })
          );
        },
        onError(error) {
          didError = true;
          console.error(error);
        },
      }
    );

    request.signal.addEventListener("abort", () => {
      stream.abort();
      passThrough?.destroy();
      reject(request.signal.reason);
    });
  });
}
