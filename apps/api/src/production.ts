import { WorkerEntrypoint } from "cloudflare:workers";
import type { Env } from "./lib/types";
import { handleH2WebsiteIntake } from "./routes/websiteIntake";

export { default } from "./index";
export { H2AcquisitionIngest } from "./h2AcquisitionIngest";

export class H2InquiryIntake extends WorkerEntrypoint<Env> {
  async fetch(request: Request) {
    return await handleH2WebsiteIntake(request, this.env, this.ctx);
  }
}
