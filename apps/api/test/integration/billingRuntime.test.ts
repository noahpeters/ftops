import { readFileSync } from "node:fs";
import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";

it("generates and verifies a certificate-signed PDF inside the actual Cloudflare runtime", async () => {
  const bundle = await build({
    stdin: {
      contents:
        "import {signedPdf} from './src/billing/documents'; export default {async fetch(request,env){ const result=await signedPdf({title:'Signed invoice',subtitle:'Runtime verification',paragraphs:['Invoice total $1,250.00']},env.KEY,env.CERT,'Synthetic Issuer','owner@example.test');return new Response(result.bytes,{headers:{'Content-Type':'application/pdf'}});}}",
      resolveDir: process.cwd(),
      sourcefile: "billing-runtime.ts",
    },
    bundle: true,
    platform: "browser",
    format: "esm",
    external: ["node:*"],
    write: false,
  });
  const mf = new Miniflare({
    modules: true,
    script: bundle.outputFiles[0].text,
    compatibilityDate: "2026-01-01",
    compatibilityFlags: ["nodejs_compat"],
    bindings: {
      KEY: readFileSync("test/fixtures/billing/test-key.pem", "utf8"),
      CERT: readFileSync("test/fixtures/billing/test-certificate.pem", "utf8"),
    },
  });
  try {
    const response = await mf.dispatchFetch("http://localhost/sign");
    expect(response.status).toBe(200);
    const pdf = new Uint8Array(await response.arrayBuffer());
    expect((await PDFDocument.load(pdf)).getPageCount()).toBe(1);
    expect(new TextDecoder().decode(pdf)).toContain("/ByteRange");
  } finally {
    await mf.dispose();
  }
});
