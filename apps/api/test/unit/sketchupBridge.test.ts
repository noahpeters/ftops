import { expect, it, vi } from "vitest";
import {
  sketchupContext,
  importMessage,
  matchingImportResult,
} from "../../../ui/src/features/configurator/sketchupBridge";
const nonce = "a".repeat(64),
  requestId = "12345678-1234-1234-1234-123456789012";
it("requires the installed SketchUp callback and current window nonce", () => {
  const send = vi.fn();
  expect(sketchupContext(`?sketchup=1&bridge=${nonce}`)).toBeNull();
  expect(sketchupContext("?sketchup=1&bridge=wrong", { fromTreesImport: send })).toBeNull();
  const context = sketchupContext(`?sketchup=1&bridge=${nonce}`, { fromTreesImport: send })!;
  const manifest = { parts: [{ name: "'; system('evil'); #" }] };
  context.send(importMessage(context.nonce, requestId, manifest));
  expect(JSON.parse(send.mock.calls[0][0])).toEqual({ nonce, requestId, manifest });
});
it("accepts only the matching native import result, including failure", () => {
  expect(
    matchingImportResult({ nonce: "wrong", requestId, ok: true, message: "ok" }, nonce, requestId)
  ).toBeNull();
  expect(
    matchingImportResult({ nonce, requestId: "another", ok: true, message: "ok" }, nonce, requestId)
  ).toBeNull();
  expect(
    matchingImportResult(
      { nonce, requestId, ok: false, message: "Non-solid part" },
      nonce,
      requestId
    )
  ).toEqual({ ok: false, message: "Non-solid part" });
});
