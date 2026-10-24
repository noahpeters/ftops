import { useAppState } from "../App";
import { BillingPanel } from "../features/billing/BillingPanel";
export default function Billing() {
  const { selectedWorkspaceId, actor, actorLoading } = useAppState();
  if (actorLoading) return <p>Loading…</p>;
  if (!selectedWorkspaceId) return <p>Select a workspace to manage estimates and billing.</p>;
  if (!actor?.isSystemAdmin && !actor?.workspaceAdminIds.includes(selectedWorkspaceId))
    return <p>Billing is available to workspace administrators.</p>;
  return <BillingPanel key={selectedWorkspaceId} workspaceId={selectedWorkspaceId} />;
}
