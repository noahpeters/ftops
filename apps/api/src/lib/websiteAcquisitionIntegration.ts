import type { Env } from "./types";

export async function websiteAcquisitionIntegration(env: Env) {
  if (!env.H2_ACQUISITION_INTEGRATION_ID) return null;
  return env.DB.prepare(
    `SELECT id, workspace_id, external_account_id AS domain, is_active
     FROM integrations WHERE id=? AND provider='website' AND environment='production'`
  )
    .bind(env.H2_ACQUISITION_INTEGRATION_ID)
    .first<{
      id: string;
      workspace_id: string;
      domain: string;
      is_active: number;
    }>();
}
