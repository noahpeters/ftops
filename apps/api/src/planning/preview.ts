import type { Env } from "../lib/types";
import { stableStringify, sha256Hex } from "./deterministic";
import type { PlanPreviewResponse } from "./types";
import { classifierVersion } from "./classifier";
import { plannerVersion } from "./planner";
import { compilePlanForRecord } from "../plan/compilePlan";

export class NotFoundError extends Error {}

export async function getPlanPreview(env: Env, recordUri: string): Promise<PlanPreviewResponse> {
  let compiled;
  try {
    compiled = await compilePlanForRecord(env, {
      workspaceId: "default",
      recordUri,
    });
  } catch {
    throw new NotFoundError(`Record not found: ${recordUri}`);
  }

  const planInputHash = await sha256Hex(stableStringify(compiled.planInput));
  const planId = await sha256Hex(
    `plan:${compiled.record.uri}:${compiled.record.snapshot_hash}:${planInputHash}`
  );

  return {
    plan_input: compiled.planInput,
    plan_preview: compiled.planPreview,
    record: compiled.recordSummary,
    contexts: compiled.contexts,
    matches: compiled.matches,
    matchedTemplatesByContext: compiled.matchedTemplatesByContext,
    versions: {
      workspace_config_version: compiled.workspaceConfigVersion,
      classifier_version: classifierVersion,
      planner_version: plannerVersion,
    },
    computed_at: new Date().toISOString(),
    debug: {
      plan_id: planId,
      plan_input_hash: planInputHash,
      snapshot_hash: compiled.record.snapshot_hash,
    },
    warnings: compiled.warnings,
  };
}
