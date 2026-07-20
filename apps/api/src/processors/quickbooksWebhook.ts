import type { Env } from "../lib/types";
import { getQboIntegration, persistSyncError, syncQboEntity } from "../services/quickbooks";

type Change = {
  name?: string;
  id?: string;
  operation?: string;
  lastUpdated?: string;
};

export async function processQuickbooksWebhook(
  env: Env,
  input: { integrationId?: string | null; body: unknown }
) {
  const changes = extractChanges(input.body);
  if (changes.length === 0) return;
  if (!input.integrationId) throw new Error("quickbooks_integration_missing");
  const integration = await getQboIntegration(env, input.integrationId);
  if (!integration) throw new Error("quickbooks_integration_not_found");
  for (const change of changes) {
    const entityType = change.name?.toLowerCase();
    if (!change.id || !isSupported(entityType)) continue;
    try {
      await syncQboEntity(env, {
        integration,
        entityType,
        externalId: change.id,
        operation: change.operation,
        eventUpdatedAt: change.lastUpdated ?? null,
      });
    } catch (error) {
      await persistSyncError(env, integration, entityType, change.id, error);
      throw error;
    }
  }
  await env.DB.prepare(
    `UPDATE integrations SET last_successful_sync_at=?, connection_error=NULL WHERE id=?`
  )
    .bind(new Date().toISOString(), integration.id)
    .run();
}

export function extractChanges(body: unknown): Change[] {
  if (!body || typeof body !== "object") return [];
  const notifications = (body as { eventNotifications?: unknown }).eventNotifications;
  if (!Array.isArray(notifications)) return [];
  const changes: Change[] = [];
  for (const notification of notifications) {
    if (!notification || typeof notification !== "object") continue;
    const entities = (notification as { dataChangeEvent?: { entities?: unknown } }).dataChangeEvent
      ?.entities;
    if (Array.isArray(entities)) changes.push(...(entities as Change[]));
  }
  return changes;
}

function isSupported(value: string | undefined): value is "customer" | "estimate" | "invoice" {
  return value === "customer" || value === "estimate" || value === "invoice";
}
