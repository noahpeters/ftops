import type { WorkspaceConfig } from "./types";

export const workspaceConfigVersion = "v0";

export async function loadWorkspaceConfig(_env: unknown): Promise<WorkspaceConfig> {
  return {
    workspace_config_version: workspaceConfigVersion,
    samples_default_group: "project",
  };
}
