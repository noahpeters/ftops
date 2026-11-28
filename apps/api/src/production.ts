import { processH2Inquiries } from "./services/h2InquiryQueue";
import { WorkerEntrypoint } from "cloudflare:workers";
import type { Env } from "./lib/types";
import { handleH2WebsiteIntake } from "./routes/websiteIntake";

export { default } from "./index";
export { H2AcquisitionIngest } from "./h2AcquisitionIngest";

export class H2InquiryIntake extends WorkerEntrypoint<Env> {
  async fetch(request: Request) {
    if (request.method === "POST" && new URL(request.url).pathname === "/inquiries-ready") {
      this.ctx.waitUntil(processH2Inquiries(this.env, this.ctx));
      return new Response(null, { status: 202 });
    }
    return await handleH2WebsiteIntake(request, this.env, this.ctx);
  }
}
