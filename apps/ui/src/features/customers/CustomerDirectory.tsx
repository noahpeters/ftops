import {
  DataTable,
  tableQueryKey,
  type TableColumn,
  type TableFilter,
  type TableQuery,
} from "@from-trees/ui";
import type { CustomerPage, CustomerSummary } from "./api";
import { formatPhoneNumber } from "../../lib/formatPhoneNumber";

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const date = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "America/Los_Angeles",
  timeZoneName: "short",
});

export const customerSorts = {
  next_follow_up_asc: "Next follow-up (soonest)",
  name_asc: "Name (A–Z)",
  last_note_desc: "Last note (newest)",
};

export type CustomerSort = keyof typeof customerSorts;

export const customerStatusFilter = {
  id: "status",
  label: "Status",
  operators: ["in"],
  options: [
    { value: "lead", label: "Lead" },
    { value: "active", label: "Active" },
    { value: "completed", label: "Completed" },
    { value: "archived", label: "Archived" },
  ],
} satisfies TableFilter;

export function customerStatuses(query: TableQuery): string[] {
  const filter = query.filters.status;
  return filter?.operator === "in" ? filter.value : [];
}

const statusLabels = new Map(
  customerStatusFilter.options.map(({ value, label }) => [value, label])
);

const columns: TableColumn<CustomerSummary>[] = [
  {
    id: "customer",
    label: "Customer",
    kind: "text",
    value: (row) => row.display_name,
    metadata: (row) => (row.company_name === row.display_name ? null : row.company_name),
  },
  {
    id: "primary_contact",
    label: "Primary contact",
    kind: "text",
    value: (row) => row.primary_contact,
    metadata: (row) => row.email || formatPhoneNumber(row.phone) || null,
  },
  {
    id: "status",
    label: "Status",
    kind: "status",
    value: (row) => ({
      label: statusLabels.get(row.status) ?? row.status,
      tone: row.status === "active" ? "success" : row.status === "lead" ? "warning" : "neutral",
    }),
  },
  {
    id: "follow_up",
    label: "Next follow-up",
    kind: "text",
    value: (row) => (row.next_follow_up_at ? date.format(new Date(row.next_follow_up_at)) : null),
    metadata: (row) =>
      row.follow_up_urgency === "overdue"
        ? "Overdue"
        : row.follow_up_urgency === "due_today"
          ? "Due today"
          : null,
  },
  {
    id: "quickbooks",
    label: "QuickBooks",
    kind: "status",
    value: (row) => {
      const label = (
        {
          linked: "Linked",
          not_linked: "Unlinked",
          pending_push: "Pending push",
          pending_refresh: "Pending refresh",
          conflict: "Conflict",
          error: "Error",
        } as Record<string, string>
      )[row.quickbooks_sync_status];
      return {
        label: label ?? row.quickbooks_sync_status,
        tone:
          row.quickbooks_sync_status === "error"
            ? "danger"
            : row.quickbooks_sync_status === "conflict"
              ? "warning"
              : "neutral",
      };
    },
  },
  {
    id: "qualification",
    label: "Qualification",
    kind: "status",
    value: (row) => {
      const classification = row.qualification_classification;
      if (!classification) return null;
      const label = { qualified: "Qualified", not_qualified: "Unqualified", unclear: "Unclear" }[
        classification
      ];
      return { label, tone: classification === "qualified" ? "success" : "warning" };
    },
  },
  {
    id: "work",
    label: "Work",
    kind: "text",
    value: (row) =>
      `${row.open_estimate_count} open ${row.open_estimate_count === 1 ? "estimate" : "estimates"}`,
    metadata: (row) =>
      `${money.format(row.open_invoice_balance || 0)} due · ${money.format((row.non_lost_opportunity_total_cents || 0) / 100)} opportunities`,
  },
];

export function CustomerDirectory({
  query,
  page,
  loading,
  error,
  onChange,
  onRetry,
  onOpen,
}: {
  query: TableQuery;
  page: (CustomerPage & { query: TableQuery }) | null;
  loading: boolean;
  error: string | undefined;
  onChange: (query: TableQuery) => void;
  onRetry: () => void;
  onOpen: (row: CustomerSummary, mode?: "activity" | "qualification") => void;
}) {
  return (
    <>
      <DataTable
        label="customers"
        columns={columns}
        query={query}
        onQueryChange={onChange}
        page={page}
        loading={loading}
        error={error}
        onRetry={onRetry}
        filters={[customerStatusFilter]}
        getRowId={(row) => row.id}
        getRowLabel={(row) => row.display_name}
        onOpenRow={onOpen}
        rowActions={(row) => [
          { id: "open", label: "View customer", icon: "view", onAction: () => onOpen(row) },
          {
            id: "activity",
            label: "Activity / Notes",
            icon: "history",
            onAction: () => onOpen(row, "activity"),
          },
          {
            id: "qualification",
            label: "Review qualification",
            icon: "check",
            onAction: () => onOpen(row, "qualification"),
          },
        ]}
      />
      {page && tableQueryKey(page.query) === tableQueryKey(query) && !loading && !error && (
        <p aria-live="polite">
          {page.totalContacts} {page.totalContacts === 1 ? "matching contact" : "matching contacts"}
        </p>
      )}
    </>
  );
}
