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
  non_lost_opportunity_total_cents: number;
  next_follow_up_at: string | null;
  follow_up_urgency: "overdue" | "due_today" | "upcoming" | "none";
  follow_up_reason: string | null;
  last_note_at: string | null;
};
export type CustomerPage = {
  items: CustomerSummary[];
  total: number;
  totalContacts: number;
  limit: number;
  offset: number;
  hasMore: boolean;
};
export type CustomerDetail = {
  customer: CustomerSummary & {
    notes?: string | null;
    lead_source?: string | null;
    integration_id?: string | null;
    quickbooks_customer_id?: string | null;
    source_note_id?: string | null;
    guidance_type?: "date" | "cadence" | "none" | null;
    interpreted_date?: string | null;
    cadence_json?: string | null;
    guidance_confidence?: number | null;
    guidance_explanation?: string | null;
  };
  contacts: Contact[];
  opportunities: Opportunity[];
  addresses: Array<Record<string, unknown>>;
  activities: CustomerActivity[];
  tasks: CustomerTask[];
  files: CustomerFile[];
  estimates: Array<Record<string, unknown>>;
  invoices: Array<Record<string, unknown>>;
  emailNoteCandidates: EmailNoteCandidate[];
};
export type EmailNoteCandidate = {
  id: string;
  ingestion_id: string;
  email_message_id: string | null;
  category: string;
  proposed_subject: string;
  proposed_body: string;
  confidence: number;
  evidence: string | null;
  original_sender_email: string | null;
  original_sender_name: string | null;
  email_subject: string | null;
  email_sent_at: string | null;
  email_received_at: string;
  attachment_count: number;
};
export type CustomerFile = {
  id: string;
  customer_id: string;
  activity_id: string;
  original_filename: string;
  content_type: string;
  size_bytes: number;
  uploaded_by_email: string | null;
  created_at: string;
  deprecated_at: string | null;
  deprecated_by_email: string | null;
  note_subject: string;
  note_occurred_at: string;
};
export type CustomerTask = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  due_at: string | null;
  assigned_to: string | null;
  project_id: string | null;
};
export type Opportunity = {
  id: string;
  description: string;
  opportunity_type: "furniture" | "cabinets" | "other";
  budget_cents: number;
  status: "scoping" | "quoted" | "accepted" | "lost";
  created_at: string;
  updated_at: string;
};
export type Contact = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  display_name: string;
  email: string | null;
  phone: string | null;
  role: string | null;
  status: "active" | "inactive" | "archived";
  is_primary: number;
  archived_at: string | null;
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
  filters: { search?: string; status?: string[]; sort?: string }
) {
  return fetchJson<CustomerSummary[]>(
    buildUrl("/customers", {
      workspaceId,
      search: filters.search,
      status: filters.status?.join(","),
      sort: filters.sort,
    })
  );
}
export function listCustomerPage(
  workspaceId: string,
  filters: { search?: string; status?: string[]; sort?: string; limit: number; offset: number }
) {
  return fetchJson<CustomerPage>(
    buildUrl("/customers", {
      workspaceId,
      search: filters.search,
      status: filters.status?.join(","),
      sort: filters.sort,
      limit: filters.limit,
      offset: filters.offset,
    })
  );
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
export function updateContact(
  customerId: string,
  contactId: string,
  input: Record<string, unknown>
) {
  return fetchJson<CustomerDetail>(buildUrl(`/customers/${customerId}/contacts/${contactId}`), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}
export function archiveContact(customerId: string, contactId: string) {
  return fetchJson<{ archived: boolean }>(
    buildUrl(`/customers/${customerId}/contacts/${contactId}`),
    { method: "DELETE" }
  );
}
export function addOpportunity(id: string, input: Record<string, unknown>) {
  return fetchJson<CustomerDetail>(buildUrl(`/customers/${id}/opportunities`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}
export function updateOpportunity(
  customerId: string,
  opportunityId: string,
  input: Record<string, unknown>
) {
  return fetchJson<CustomerDetail>(
    buildUrl(`/customers/${customerId}/opportunities/${opportunityId}`),
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }
  );
}
export function addAddress(id: string, input: Record<string, unknown>) {
  return fetchJson<CustomerDetail>(buildUrl(`/customers/${id}/addresses`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}
export function addNote(id: string, input: Record<string, unknown>) {
  return fetchJson<CustomerActivity[]>(buildUrl(`/customers/${id}/activities`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}
export function reviewEmailNoteCandidate(candidateId: string, action: "apply" | "dismiss") {
  return fetchJson<{ applied?: boolean; dismissed?: boolean; activityId?: string }>(
    buildUrl(`/customer-emails/candidates/${candidateId}/${action}`),
    { method: "POST" }
  );
}
export function streamCustomerFollowUp(
  customerId: string,
  noteId: string,
  onUpdate: (update: Partial<CustomerSummary>) => void
) {
  const source = new EventSource(
    buildUrl(`/customers/${customerId}/follow-up-stream`, { noteId }),
    { withCredentials: true }
  );
  source.onmessage = (event) => {
    onUpdate(JSON.parse(event.data) as Partial<CustomerSummary>);
    source.close();
  };
  return source;
}
export function initCustomerFileUpload(
  customerId: string,
  input: { activityId: string; filename: string; contentType: string; sizeBytes: number }
) {
  return fetchJson<{ uploadUrl: string; storageKey: string }>(
    buildUrl(`/customers/${customerId}/files/init`),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }
  );
}
export function completeCustomerFileUpload(
  customerId: string,
  input: {
    activityId: string;
    storageKey: string;
    filename: string;
    contentType: string;
    sizeBytes: number;
  }
) {
  return fetchJson<CustomerFile>(buildUrl(`/customers/${customerId}/files/complete`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}
export function getCustomerFileDownload(fileId: string) {
  return fetchJson<{ downloadUrl: string }>(buildUrl(`/customer-files/${fileId}/download`));
}
export function setCustomerFileDeprecated(fileId: string, deprecated: boolean) {
  return fetchJson<CustomerFile>(buildUrl(`/customer-files/${fileId}`), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ deprecated }),
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
