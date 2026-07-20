import { buildUrl, fetchJson } from "../../lib/api";

export type CustomerSummary = {
  id: string;
  display_name: string;
  company_name: string | null;
  status: string;
  primary_contact: string | null;
  email: string | null;
  phone: string | null;
  quickbooks_sync_status: string;
  last_synced_at: string | null;
  last_error: string | null;
  open_estimate_count: number;
  open_invoice_balance: number;
};
export type CustomerDetail = {
  customer: CustomerSummary & {
    notes?: string | null;
    lead_source?: string | null;
    integration_id?: string | null;
    quickbooks_customer_id?: string | null;
  };
  contacts: Array<Record<string, unknown>>;
  addresses: Array<Record<string, unknown>>;
  activities: CustomerActivity[];
  estimates: Array<Record<string, unknown>>;
  invoices: Array<Record<string, unknown>>;
};

export type CustomerActivity = {
  id: string;
  activity_type: string;
  subject: string;
  body: string | null;
  occurred_at: string;
  created_by: string | null;
};

export function listCustomers(
  workspaceId: string,
  filters: { search?: string; status?: string; sync?: string }
) {
  return fetchJson<CustomerSummary[]>(buildUrl("/customers", { workspaceId, ...filters }));
}
export function getCustomer(id: string) {
  return fetchJson<CustomerDetail>(buildUrl(`/customers/${id}`));
}
export function createCustomer(input: Record<string, unknown>) {
  return fetchJson<CustomerDetail>(buildUrl("/customers"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}
export function updateCustomer(id: string, input: Record<string, unknown>) {
  return fetchJson<CustomerDetail>(buildUrl(`/customers/${id}`), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}
export function addContact(id: string, input: Record<string, unknown>) {
  return fetchJson<CustomerDetail>(buildUrl(`/customers/${id}/contacts`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}
export function addAddress(id: string, input: Record<string, unknown>) {
  return fetchJson<CustomerDetail>(buildUrl(`/customers/${id}/addresses`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}
export function addNote(id: string, input: Record<string, unknown>) {
  return fetchJson(buildUrl(`/customers/${id}/activities`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}
export function qboSearch(id: string, integrationId: string, q: string) {
  return fetchJson<
    Array<{ id: string; displayName: string; companyName?: string; email?: string; phone?: string }>
  >(buildUrl(`/customers/${id}/quickbooks/search`, { integrationId, q }));
}
export function qboAction(id: string, action: string, input: Record<string, unknown>) {
  return fetchJson<CustomerDetail>(buildUrl(`/customers/${id}/quickbooks/${action}`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}
