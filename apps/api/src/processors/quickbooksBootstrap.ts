import type { Env, EventQueuePayload } from "../lib/types";
import { nowISO } from "../lib/utils";
import { getQboIntegration, queryQboPage, upsertQboEntity } from "../services/quickbooks";
import { bootstrapMessage } from "../routes/qboIntegration";
import { sanitizeExternalError } from "../lib/security";

const TYPES = ["customer", "estimate", "invoice"] as const;
const PAGE_SIZE = 100;

export async function processQuickbooksBootstrap(env: Env, message: EventQueuePayload) {
  const jobId = (message.payload as { jobId?: string } | undefined)?.jobId;
  if (!jobId) throw new Error("quickbooks_bootstrap_job_missing");
  const job = await env.DB.prepare(`SELECT * FROM qbo_bootstrap_jobs WHERE id=?`)
    .bind(jobId)
    .first<{
      id: string;
      integration_id: string;
      entity_type: (typeof TYPES)[number];
      start_position: number;
      imported_count: number;
      status: string;
    }>();
  if (!job || job.status === "complete") return;
  const integration = await getQboIntegration(env, job.integration_id);
  if (!integration) throw new Error("quickbooks_integration_not_found");
  await env.DB.prepare(
    `UPDATE qbo_bootstrap_jobs SET status='running',last_error=NULL,updated_at=? WHERE id=?`
  )
    .bind(nowISO(), job.id)
    .run();
  try {
    const entities = await queryQboPage(
      env,
      integration,
      job.entity_type,
      job.start_position,
      PAGE_SIZE
    );
    for (const entity of entities) {
      const externalId = typeof entity.Id === "string" ? entity.Id : "";
      if (!externalId) continue;
      await upsertQboEntity(env, { integration, entityType: job.entity_type, externalId, entity });
    }
    const imported = job.imported_count + entities.length;
    if (entities.length === PAGE_SIZE) {
      const next = job.start_position + PAGE_SIZE;
      await env.DB.prepare(
        `UPDATE qbo_bootstrap_jobs SET start_position=?,imported_count=?,status='queued',updated_at=? WHERE id=?`
      )
        .bind(next, imported, nowISO(), job.id)
        .run();
      await env.EVENT_QUEUE.send(bootstrapMessage(job.id));
      return;
    }
    const index = TYPES.indexOf(job.entity_type);
    const nextType = TYPES[index + 1];
    if (nextType) {
      await env.DB.prepare(
        `UPDATE qbo_bootstrap_jobs SET entity_type=?,start_position=1,imported_count=?,status='queued',updated_at=? WHERE id=?`
      )
        .bind(nextType, imported, nowISO(), job.id)
        .run();
      await env.EVENT_QUEUE.send(bootstrapMessage(job.id));
      return;
    }
    const now = nowISO();
    await env.DB.prepare(
      `UPDATE qbo_bootstrap_jobs SET imported_count=?,status='complete',completed_at=?,updated_at=? WHERE id=?`
    )
      .bind(imported, now, now, job.id)
      .run();
    await env.DB.prepare(
      `UPDATE integrations SET last_successful_sync_at=?,connection_error=NULL WHERE id=?`
    )
      .bind(now, integration.id)
      .run();
  } catch (error) {
    const message = sanitize(error);
    await env.DB.prepare(
      `UPDATE qbo_bootstrap_jobs SET status='failed',last_error=?,updated_at=? WHERE id=?`
    )
      .bind(message, nowISO(), job.id)
      .run();
    throw error;
  }
}
function sanitize(error: unknown) {
  return sanitizeExternalError(error, "quickbooks_bootstrap_failed");
}
