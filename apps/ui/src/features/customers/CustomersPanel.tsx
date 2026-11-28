"use client";
import {
  CustomerDirectory,
  customerSorts,
  customerStatuses,
  type CustomerSort,
} from "./CustomerDirectory";
import { InquiryReplies } from "./InquiryReplies";
import { CustomerQualification } from "./CustomerQualification";
import {
  Badge,
  Button,
  Dialog,
  List,
  MenuButton,
  NavigableSidePanel,
  Panel,
  Section,
  SegmentedControl,
  Shimmer,
  SidePanel,
  Select,
  Status,
  Switch,
  TextArea,
  TextInput,
  tablePageSizes,
  type TableQuery,
} from "@from-trees/ui";
import { CustomerNoteForm, customerTimeZone, type CustomerNoteInput } from "./CustomerNoteForm";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router";
import Markdown from "react-markdown";
import stylex from "~/lib/stylex";
import { buildUrl } from "@/lib/api";
import { listUsers, type WorkspaceUser } from "../users/api";
import { TaskEditorDrawer } from "../tasks/TaskDetailDrawer";
import { formatPhoneNumber } from "../../lib/formatPhoneNumber";
import { color, metrics, space } from "@from-trees/ui/tokens.stylex";
import {
  addContact,
  addNote,
  addOpportunity,
  archiveContact,
  createCustomer,
  getCustomer,
  initCustomerFileUpload,
  listCustomerPage,
  completeCustomerFileUpload,
  qboAction,
  qboSearch,
  reviewEmailNoteCandidate,
  updateContact,
  updateCustomer,
  updateOpportunity,
  setCustomerFileDeprecated,
  streamCustomerFollowUp,
  type Contact,
  type CustomerDetail,
  type CustomerPage,
  type CustomerSummary,
  type Opportunity,
} from "./api";

const CUSTOMER_PAGE_SIZE = 25;
const defaultCustomerSort = "next_follow_up_asc";

type NoteUpload = {
  id: string;
  file: File;
  noteId: string;
  customerId: string;
  failed: boolean;
};

const styles = stylex.create({
  panel: {
    padding: { default: "24px 32px", "@media (max-width: 640px)": "12px 4px" },
    minWidth: 0,
  },
  titleRow: {
    display: "flex",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: "12px",
    alignItems: "center",
    marginBottom: "16px",
  },
  directoryActions: { display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "center" },
  panelStack: { display: "grid", gap: space.lg, minWidth: 0 },
  muted: { color: color.muted, fontSize: metrics.small, margin: 0 },
  actions: { display: "flex", gap: space.sm, flexWrap: "wrap", alignItems: "center" },
  form: { display: "grid", gap: space.md },
  record: { display: "grid", gap: space.sm, minWidth: 0, overflowWrap: "anywhere" },
  recordHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    flexWrap: "wrap",
    gap: space.sm,
    minWidth: 0,
    overflowWrap: "anywhere",
  },
  facts: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit,minmax(min(130px,100%),1fr))",
    gap: space.md,
    margin: 0,
    fontSize: metrics.small,
  },
  factValue: { margin: 0, marginTop: space.xs, overflowWrap: "anywhere" },
  phoneLink: { color: color.accent, textDecoration: "underline" },
  markdown: { lineHeight: 1.5, overflowWrap: "anywhere" },
  noteFeedback: { display: "grid", gap: space.sm, overflowWrap: "anywhere" },
  attachmentLink: {
    display: "grid",
    gap: "6px",
    justifyItems: "start",
    color: color.ink,
    textDecoration: "none",
    minWidth: 0,
  },
  attachmentPreview: {
    display: "block",
    overflow: "hidden",
    border: `1px solid ${color.border}`,
    borderRadius: metrics.radius,
    backgroundColor: color.subtle,
  },
  imagePreview: {
    width: "100%",
    height: "auto",
    maxHeight: "120px",
    objectFit: "contain",
    objectPosition: "left center",
  },
  imagePreviewCompact: { maxHeight: "82px" },
  pdfPreviewContainer: {
    position: "relative",
    width: "min(100%, 204px)",
    aspectRatio: "8.5 / 11",
  },
  pdfPreviewContainerCompact: { width: "min(100%, 64px)" },
  pdfPreview: {
    position: "absolute",
    inset: 0,
    width: "100%",
    height: "100%",
    border: 0,
    pointerEvents: "none",
  },
  attachmentName: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    textDecoration: "underline",
  },
});

type CustomerTab =
  | "summary"
  | "contacts"
  | "opportunities"
  | "tasks"
  | "activity"
  | "files"
  | "quickbooks";
const CUSTOMER_TABS: Array<{ id: CustomerTab; label: string }> = [
  { id: "summary", label: "Summary" },
  { id: "contacts", label: "Contacts" },
  { id: "opportunities", label: "Opportunities" },
  { id: "tasks", label: "Tasks" },
  { id: "activity", label: "Activity / Notes" },
  { id: "files", label: "Files" },
  { id: "quickbooks", label: "QuickBooks" },
];

export function CustomersPanel({
  workspaceId,
  customerId,
  initialStatuses,
  onStatusesChange,
}: {
  workspaceId: string | null;
  customerId?: string;
  initialStatuses: string[];
  onStatusesChange: (statuses: string[]) => void;
}) {
  const navigate = useNavigate();
  const selectedCustomer = useRef(customerId);
  selectedCustomer.current = customerId;
  const noteSaveInFlight = useRef(false);
  const uploadsInFlight = useRef(new Set<string>());
  const noteRefreshRequest = useRef(0);
  const latestNoteRef = useRef<HTMLElement>(null);

  const listRequestRef = useRef(0);
  const followUpStreamRef = useRef<EventSource | null>(null);
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const initialStatusKey = initialStatuses.join(",");
  const requestedSort = params.get("sort") ?? defaultCustomerSort;
  const sort = Object.prototype.hasOwnProperty.call(customerSorts, requestedSort)
    ? (requestedSort as CustomerSort)
    : defaultCustomerSort;
  const query = useMemo<TableQuery>(() => {
    const requestedPageSize = Number(params.get("pageSize"));
    const pageSize =
      tablePageSizes.find((size) => size === requestedPageSize) ?? CUSTOMER_PAGE_SIZE;
    const requestedPage = Number(params.get("page"));
    const page =
      Number.isSafeInteger(requestedPage * pageSize) && requestedPage > 0
        ? Math.floor(requestedPage) || 1
        : 1;
    const filters: TableQuery["filters"] = {};
    if (initialStatusKey) filters.status = { operator: "in", value: initialStatusKey.split(",") };
    return {
      search: (params.get("q") ?? "").slice(0, 200),
      filters,
      sort: null,
      page,
      pageSize,
    };
  }, [params, initialStatusKey]);
  const [loaded, setLoaded] = useState<
    (CustomerPage & { query: TableQuery; sort: CustomerSort; workspaceId: string }) | null
  >(null);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string>();
  const [detail, setDetail] = useState<CustomerDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [users, setUsers] = useState<WorkspaceUser[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [integrationId, setIntegrationId] = useState("");
  const [matches, setMatches] = useState<Array<{ id: string; displayName: string }>>([]);
  const [editingContactId, setEditingContactId] = useState<string | null>(null);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [creatingContact, setCreatingContact] = useState(false);
  const [contactCanSave, setContactCanSave] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState(false);
  const [creatingCustomer, setCreatingCustomer] = useState(false);
  const [newCustomerName, setNewCustomerName] = useState("");
  const [savingCustomer, setSavingCustomer] = useState(false);
  const [createCustomerError, setCreateCustomerError] = useState<string | null>(null);
  const [customerHasChanges, setCustomerHasChanges] = useState(false);
  const [creatingNote, setCreatingNote] = useState(false);
  const [noteSaveError, setNoteSaveError] = useState<string | null>(null);
  const [noteUploads, setNoteUploads] = useState<NoteUpload[]>([]);
  const [noteReceipt, setNoteReceipt] = useState<{
    noteId: string;
    followUpAt?: string;
    description?: string;
    assignee?: string;
  } | null>(null);
  const [creatingOpportunity, setCreatingOpportunity] = useState(false);
  const [opportunityCanSave, setOpportunityCanSave] = useState(false);
  const [editingOpportunityId, setEditingOpportunityId] = useState<string | null>(null);
  const [savingNote, setSavingNote] = useState(false);
  const [savingEditor, setSavingEditor] = useState(false);
  const [reviewingEmailCandidateId, setReviewingEmailCandidateId] = useState<string | null>(null);
  const [analyzingFollowUp, setAnalyzingFollowUp] = useState(false);
  const [activeTab, setActiveTab] = useState<CustomerTab>("summary");
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const setRows = useCallback((update: (rows: CustomerSummary[]) => CustomerSummary[]) => {
    setLoaded((page) => (page ? { ...page, items: update(page.items) } : page));
  }, []);
  function changeQuery(next: TableQuery, nextSort: CustomerSort = sort) {
    const nextStatuses = customerStatuses(next);
    if (nextStatuses.join(",") !== initialStatusKey) onStatusesChange(nextStatuses);
    const updated = new URLSearchParams(params);
    for (const [key, value] of [
      ["q", next.search],
      ["sort", nextSort === defaultCustomerSort ? "" : nextSort],
      ["page", next.page === 1 ? "" : String(next.page)],
      ["pageSize", next.pageSize === CUSTOMER_PAGE_SIZE ? "" : String(next.pageSize)],
    ]) {
      if (value) updated.set(key, value);
      else updated.delete(key);
    }
    if (updated.toString() !== params.toString()) setParams(updated, { replace: true });
  }
  function openCustomer(row: CustomerSummary, target?: "activity" | "qualification") {
    navigate(
      { pathname: `/customers/${encodeURIComponent(row.id)}`, search: location.search },
      {
        state: { customerTarget: target },
      }
    );
  }
  const refresh = useCallback(async () => {
    const requestId = ++listRequestRef.current;
    setListError(undefined);
    if (!workspaceId) {
      setLoaded(null);
      setListLoading(false);
      return;
    }
    setListLoading(true);
    try {
      const result = await listCustomerPage(workspaceId, {
        search: query.search,
        status: customerStatuses(query),
        sort,
        limit: query.pageSize,
        offset: (query.page - 1) * query.pageSize,
      });
      if (requestId !== listRequestRef.current) return;
      if (!result.ok || !result.data) throw new Error("Customers could not be loaded.");
      setLoaded({ ...result.data, query, sort, workspaceId });
    } catch {
      if (requestId === listRequestRef.current) setListError("Customers could not be loaded.");
    } finally {
      if (requestId === listRequestRef.current) setListLoading(false);
    }
  }, [workspaceId, query, sort]);
  useEffect(() => {
    void refresh();
    return () => {
      listRequestRef.current += 1;
    };
  }, [refresh]);
  useEffect(() => {
    if (!workspaceId) return setUsers([]);
    void listUsers(workspaceId).then((result) => {
      if (result.ok) setUsers(result.data ?? []);
    });
  }, [workspaceId]);
  useEffect(() => {
    followUpStreamRef.current?.close();
    followUpStreamRef.current = null;
    setAnalyzingFollowUp(false);
    setActiveTab(location.state?.customerTarget === "activity" ? "activity" : "summary");
    setActiveTaskId(null);
    setEditingCustomer(false);
    setCreatingNote(false);
    setCreatingContact(false);
    setEditingContactId(null);
    setConfirmArchive(false);
    setCreatingOpportunity(false);
    setEditingOpportunityId(null);
    if (!customerId) {
      setDetail(null);
      setDetailLoading(false);
      return;
    }
    setDetail(null);
    setDetailLoading(true);
    let canceled = false;
    void getCustomer(customerId).then((r) => {
      if (canceled) return;
      setDetailLoading(false);
      if (r.ok) setDetail(r.data);
      else setError(r.text);
    });
    return () => {
      canceled = true;
    };
  }, [customerId, location.state?.customerTarget]);
  const loadedCustomerId = detail?.customer.id;
  useEffect(() => {
    if (loadedCustomerId && location.state?.customerTarget === "qualification") {
      document.getElementById("customer-qualification")?.focus();
    }
  }, [loadedCustomerId, location.state?.customerTarget]);
  useEffect(() => () => followUpStreamRef.current?.close(), []);
  useEffect(() => {
    if (!creatingNote && noteReceipt) latestNoteRef.current?.scrollIntoView({ block: "start" });
  }, [creatingNote, noteReceipt]);
  async function create() {
    const displayName = newCustomerName.trim();
    if (!workspaceId || !displayName || savingCustomer) return;
    setSavingCustomer(true);
    setCreateCustomerError(null);
    try {
      const r = await createCustomer({ workspaceId, displayName, status: "lead" });
      if (r.ok && r.data) {
        setCreatingCustomer(false);
        setNewCustomerName("");
        await refresh();
        navigate({ pathname: `/customers/${r.data.customer.id}`, search: location.search });
      } else {
        setCreateCustomerError(
          (r.data as { error?: string } | null)?.error || r.text || "Could not create customer."
        );
      }
    } catch (error) {
      setCreateCustomerError(error instanceof Error ? error.message : "Could not create customer.");
    } finally {
      setSavingCustomer(false);
    }
  }
  async function saveCustomer(input: CustomerInput) {
    if (!customerId || savingEditor) return;
    setSavingEditor(true);
    setError(null);
    try {
      const r = await updateCustomer(customerId, input);
      if (r.ok && r.data) {
        setDetail(r.data);
        setEditingCustomer(false);
        await refresh();
      } else
        setError(
          (r.data as { error?: string } | null)?.error || r.text || "Could not save the customer."
        );
    } catch {
      setError("Could not save the customer.");
    } finally {
      setSavingEditor(false);
    }
  }
  async function uploadAttachment(upload: NoteUpload) {
    if (uploadsInFlight.current.has(upload.id)) return;
    uploadsInFlight.current.add(upload.id);
    setNoteUploads((entries) =>
      entries.map((entry) => (entry.id === upload.id ? { ...entry, failed: false } : entry))
    );
    try {
      const metadata = {
        activityId: upload.noteId,
        filename: upload.file.name,
        contentType: upload.file.type || "application/octet-stream",
        sizeBytes: upload.file.size,
      };
      const initialized = await initCustomerFileUpload(upload.customerId, {
        ...metadata,
        uploadId: upload.id,
      });
      if (!initialized.ok || !initialized.data) throw new Error("Could not start file upload.");
      if ("uploadUrl" in initialized.data) {
        const url = initialized.data.uploadUrl.startsWith("/")
          ? buildUrl(initialized.data.uploadUrl)
          : initialized.data.uploadUrl;
        const uploaded = await fetch(url, {
          method: "PUT",
          headers: { "Content-Type": metadata.contentType },
          body: upload.file,
        });
        if (!uploaded.ok) throw new Error("File upload failed.");
        const completed = await completeCustomerFileUpload(upload.customerId, {
          ...metadata,
          storageKey: initialized.data.storageKey,
        });
        if (!completed.ok) throw new Error("Could not finalize file upload.");
      }
      setNoteUploads((entries) => entries.filter((entry) => entry.id !== upload.id));
    } catch {
      setNoteUploads((entries) =>
        entries.map((entry) => (entry.id === upload.id ? { ...entry, failed: true } : entry))
      );
    } finally {
      uploadsInFlight.current.delete(upload.id);
    }
  }
  async function refreshAfterNote(id: string) {
    const request = ++noteRefreshRequest.current;
    try {
      const loaded = await getCustomer(id);
      const updated = loaded.data;
      if (request !== noteRefreshRequest.current) return;
      if (!loaded.ok || !updated) throw new Error("Could not refresh customer.");
      setDetail((current) => (current?.customer.id === id ? updated : current));
    } catch {
      if (request === noteRefreshRequest.current && selectedCustomer.current === id)
        setError("The note was saved. Could not refresh the customer.");
    }
  }
  function observeNoteFollowUp(customerId: string, noteId: string) {
    if (selectedCustomer.current !== customerId) return;
    followUpStreamRef.current?.close();
    setAnalyzingFollowUp(true);
    try {
      const source = streamCustomerFollowUp(customerId, noteId, (update) => {
        setDetail((current) =>
          current?.customer.id === customerId
            ? { ...current, customer: { ...current.customer, ...update } }
            : current
        );
        setRows((current) =>
          current.map((row) => (row.id === customerId ? { ...row, ...update } : row))
        );
        finish();
      });
      function finish() {
        source.close();
        if (followUpStreamRef.current !== source) return;
        followUpStreamRef.current = null;
        setAnalyzingFollowUp(false);
      }
      source.onerror = finish;
      followUpStreamRef.current = source;
    } catch {
      followUpStreamRef.current = null;
      setAnalyzingFollowUp(false);
    }
  }
  async function saveNote({ files, ...noteInput }: CustomerNoteInput) {
    if (!customerId || noteSaveInFlight.current) return;
    noteSaveInFlight.current = true;
    setSavingNote(true);
    setNoteSaveError(null);
    setError(null);
    try {
      const result = await addNote(customerId, noteInput).catch(() => null);
      const noteId = result?.data?.noteId;
      if (!result?.ok || !noteId) {
        if (selectedCustomer.current === customerId)
          setNoteSaveError("Could not save the note. Try again.");
        return;
      }
      setDetail((current) =>
        current?.customer.id === customerId
          ? {
              ...current,
              activities: [
                {
                  id: noteId,
                  activity_type: "note",
                  subject: noteInput.subject,
                  body: noteInput.body,
                  occurred_at: new Date().toISOString(),
                  created_by: null,
                },
                ...current.activities.filter((activity) => activity.id !== noteId),
              ],
            }
          : current
      );
      setNoteReceipt({
        noteId,
        followUpAt: noteInput.followUpAt,
        description: noteInput.followUpDescription,
        assignee: noteInput.followUpAssignedTo,
      });
      observeNoteFollowUp(customerId, noteId);
      const uploads = files.map((file) => ({
        id: crypto.randomUUID(),
        file,
        noteId,
        customerId,
        failed: false,
      }));
      if (uploads.length) {
        setNoteUploads((current) => [...current, ...uploads]);
        for (const upload of uploads) await uploadAttachment(upload);
      }
      await refreshAfterNote(customerId);
      if (selectedCustomer.current === customerId) setCreatingNote(false);
    } finally {
      noteSaveInFlight.current = false;
      setSavingNote(false);
    }
  }
  function openNoteEditor() {
    setNoteSaveError(null);
    setNoteReceipt(null);
    setCreatingNote(true);
  }
  async function retryAttachment(upload: NoteUpload) {
    await uploadAttachment(upload);
    await refreshAfterNote(upload.customerId);
  }
  function noteFeedback(noteId: string) {
    const uploads = noteUploads.filter(
      (upload) => upload.noteId === noteId && upload.customerId === customerId
    );
    const receipt = noteReceipt?.noteId === noteId ? noteReceipt : null;
    if (!receipt && uploads.length === 0) return null;
    return (
      <div className={stylex(styles.noteFeedback)}>
        {receipt && uploads.length === 0 && (
          <Status tone="success">
            {receipt.followUpAt ? "Note saved and follow-up scheduled." : "Note saved."}
          </Status>
        )}
        {receipt?.followUpAt && (
          <div className={stylex(styles.muted)}>
            {receipt.description} · {formatDateTime(receipt.followUpAt)} ·{" "}
            {users.find((user) => user.user_id === receipt.assignee)?.name || "Unassigned"}
          </div>
        )}
        {uploads.map((upload) => (
          <div key={upload.id} className={stylex(styles.noteFeedback)}>
            <div id={`note-attachment-${upload.id}`}>
              <Status tone={upload.failed ? "warning" : "neutral"}>
                {upload.failed
                  ? `Note saved. ${upload.file.name} could not be uploaded.`
                  : `Uploading ${upload.file.name}…`}
              </Status>
            </div>
            {upload.failed && (
              <div>
                <Button
                  aria-describedby={`note-attachment-${upload.id}`}
                  onPress={() => void retryAttachment(upload)}
                >
                  Retry attachment
                </Button>
              </div>
            )}
          </div>
        ))}
      </div>
    );
  }
  async function toggleFileDeprecated(fileId: string, deprecated: boolean) {
    const result = await setCustomerFileDeprecated(fileId, deprecated);
    if (!result.ok) return setError(result.text || "Could not update file.");
    await reloadDetail();
  }
  async function reloadDetail() {
    if (!customerId) return;
    const loaded = await getCustomer(customerId);
    if (loaded.ok) setDetail(loaded.data);
    else setError(loaded.text);
  }
  async function reviewEmailCandidate(candidateId: string, action: "apply" | "dismiss") {
    setReviewingEmailCandidateId(candidateId);
    setError(null);
    const result = await reviewEmailNoteCandidate(candidateId, action);
    setReviewingEmailCandidateId(null);
    if (!result.ok) return setError(result.text || "Could not review the email suggestion.");
    await reloadDetail();
    if (action === "apply") await refresh();
  }
  async function saveOpportunity(input: OpportunityInput, opportunityId?: string) {
    if (!customerId || savingEditor) return;
    setSavingEditor(true);
    setError(null);
    try {
      const payload = { ...input, budgetCents: Math.round(input.budget * 100) };
      const r = opportunityId
        ? await updateOpportunity(customerId, opportunityId, payload)
        : await addOpportunity(customerId, payload);
      if (r.ok && r.data) {
        setDetail(r.data);
        setCreatingOpportunity(false);
        setEditingOpportunityId(null);
      } else
        setError(
          (r.data as { error?: string } | null)?.error ||
            r.text ||
            "Could not save the opportunity."
        );
    } catch {
      setError("Could not save the opportunity.");
    } finally {
      setSavingEditor(false);
    }
  }
  async function saveContact(input: ContactInput, contactId?: string) {
    if (!customerId || savingEditor) return;
    setSavingEditor(true);
    setError(null);
    try {
      const r = contactId
        ? await updateContact(customerId, contactId, input)
        : await addContact(customerId, input);
      if (r.ok && r.data) {
        setDetail(r.data);
        setEditingContactId(null);
        setCreatingContact(false);
        await refresh();
      } else
        setError(
          (r.data as { error?: string } | null)?.error || r.text || "Could not save the contact."
        );
    } catch {
      setError("Could not save the contact.");
    } finally {
      setSavingEditor(false);
    }
  }
  async function removeContact(contact: Contact): Promise<boolean> {
    if (!customerId) return false;
    const r = await archiveContact(customerId, contact.id);
    if (!r.ok) {
      setError(r.text);
      return false;
    }
    const loaded = await getCustomer(customerId);
    if (loaded.ok) setDetail(loaded.data);
    await refresh();
    return true;
  }
  async function action(name: string, extra: Record<string, unknown> = {}) {
    if (!customerId || !integrationId) return setError("Enter the QuickBooks integration ID.");
    const r = await qboAction(customerId, name, { integrationId, ...extra });
    if (r.ok) setDetail(r.data);
    else setError((r.data as { error?: string } | null)?.error || r.text);
  }
  async function findMatches() {
    if (!customerId || !integrationId) return setError("Enter the QuickBooks integration ID.");
    const r = await qboSearch(customerId, integrationId, detail?.customer.display_name || "");
    if (r.ok) setMatches((r.data ?? []) as Array<{ id: string; displayName: string }>);
    else setError(r.text);
  }
  const editingContact = detail?.contacts.find((contact) => contact.id === editingContactId);
  const editingOpportunity = detail?.opportunities.find(
    (opportunity) => opportunity.id === editingOpportunityId
  );
  const currentFiles = detail?.files.filter((file) => !file.deprecated_at) ?? [];
  const deprecatedFiles = detail?.files.filter((file) => file.deprecated_at) ?? [];
  const primaryContact = detail?.contacts.find((contact) => contact.is_primary);
  const tabCounts: Partial<Record<CustomerTab, number>> = {
    tasks: detail?.tasks.filter((task) => task.status !== "done" && task.status !== "canceled")
      .length,
    opportunities: detail?.opportunities.filter((opportunity) => opportunity.status !== "lost")
      .length,
    files: currentFiles.length,
  };
  const tabOptions = CUSTOMER_TABS.map(({ id, label }) => ({
    value: id,
    label: tabCounts[id] === undefined ? label : `${label} (${tabCounts[id]})`,
  }));
  const sectionLabel = CUSTOMER_TABS.find(({ id }) => id === activeTab)?.label ?? "Summary";
  const recentNotes = recentCustomerNotes(
    detail?.activities ?? [],
    noteUploads.filter((upload) => upload.customerId === customerId).map((upload) => upload.noteId)
  );

  function renderActivity(activity: CustomerDetail["activities"][number]) {
    const attachments = currentFiles.filter((file) => file.activity_id === activity.id);
    return (
      <article
        key={activity.id}
        className={stylex(styles.record)}
        ref={activity.id === noteReceipt?.noteId ? latestNoteRef : undefined}
      >
        <strong>{activity.subject}</strong>
        {noteFeedback(activity.id)}
        <span className={stylex(styles.muted)}>
          {activity.created_by ? `by ${activity.created_by} · ` : ""}
          {formatDateTime(activity.occurred_at)}
        </span>
        {activity.body && (
          <div className={stylex(styles.markdown)}>
            <Markdown>{activity.body}</Markdown>
          </div>
        )}
        {attachments.length > 0 && (
          <div className={stylex(styles.actions)}>
            {attachments.map((file) => (
              <CustomerFileLink key={file.id} file={file} compact />
            ))}
          </div>
        )}
      </article>
    );
  }

  let editor:
    | {
        key: string;
        title: string;
        formId: string;
        label: string;
        busy: boolean;
        disabled?: boolean;
        cancel: () => void;
        content: ReactNode;
      }
    | undefined;
  if (detail && creatingNote) {
    editor = {
      key: "note",
      title: "Add note",
      formId: "customer-note-editor-form",
      label: "Save note",
      busy: savingNote,
      cancel: () => setCreatingNote(false),
      content: (
        <CustomerNoteForm
          id="customer-note-editor-form"
          onSave={saveNote}
          saving={savingNote}
          users={users}
          saveError={noteSaveError}
        />
      ),
    };
  } else if (detail && editingCustomer) {
    editor = {
      key: "customer",
      title: `Edit ${detail.customer.display_name}`,
      formId: "customer-editor-form",
      label: "Save customer",
      busy: savingEditor,
      disabled: !customerHasChanges,
      cancel: () => setEditingCustomer(false),
      content: (
        <CustomerForm
          id="customer-editor-form"
          customer={detail.customer}
          onSave={saveCustomer}
          onDirtyChange={setCustomerHasChanges}
        />
      ),
    };
  } else if (detail && (creatingContact || editingContact)) {
    const cancel = () => {
      setConfirmArchive(false);
      setCreatingContact(false);
      setEditingContactId(null);
    };
    editor = {
      key: "contact",
      title: editingContact ? `Edit ${editingContact.display_name}` : "Add contact",
      formId: "customer-contact-editor-form",
      label: editingContact ? "Save contact" : "Add contact",
      busy: savingEditor,
      disabled: !contactCanSave,
      cancel,
      content: (
        <>
          <ContactForm
            id="customer-contact-editor-form"
            contact={editingContact}
            onSave={(input) => saveContact(input, editingContact?.id)}
            onCanSaveChange={setContactCanSave}
          />
          {editingContact && editingContact.status !== "archived" && (
            <div>
              <Button
                variant="danger"
                isDisabled={savingEditor}
                onPress={() => setConfirmArchive(true)}
              >
                Archive contact
              </Button>
              <Dialog
                title="Archive contact?"
                open={confirmArchive}
                dismissible={!savingEditor}
                onOpenChange={setConfirmArchive}
                footer={
                  <>
                    <Button isDisabled={savingEditor} onPress={() => setConfirmArchive(false)}>
                      Cancel
                    </Button>
                    <Button
                      variant="danger"
                      busy={savingEditor}
                      onPress={async () => {
                        setSavingEditor(true);
                        try {
                          if (await removeContact(editingContact)) cancel();
                          else setConfirmArchive(false);
                        } catch {
                          setError("Could not archive the contact.");
                          setConfirmArchive(false);
                        } finally {
                          setSavingEditor(false);
                        }
                      }}
                    >
                      Archive contact
                    </Button>
                  </>
                }
              >
                <p>Archive {editingContact.display_name}?</p>
              </Dialog>
            </div>
          )}
        </>
      ),
    };
  } else if (detail && (creatingOpportunity || editingOpportunity)) {
    editor = {
      key: "opportunity",
      title: editingOpportunity ? "Edit opportunity" : "Add opportunity",
      formId: "customer-opportunity-editor-form",
      label: editingOpportunity ? "Save opportunity" : "Add opportunity",
      busy: savingEditor,
      disabled: !opportunityCanSave,
      cancel: () => {
        setCreatingOpportunity(false);
        setEditingOpportunityId(null);
      },
      content: (
        <OpportunityForm
          id="customer-opportunity-editor-form"
          opportunity={editingOpportunity}
          onSave={(input) => saveOpportunity(input, editingOpportunity?.id)}
          onCanSaveChange={setOpportunityCanSave}
        />
      ),
    };
  }
  return (
    <section className={stylex(styles.panel)}>
      <div className={stylex(styles.titleRow)}>
        <h2>Customers</h2>
        <div className={stylex(styles.directoryActions)}>
          <Select
            aria-label="Sort customers"
            value={sort}
            onChange={(event) =>
              changeQuery({ ...query, page: 1 }, event.target.value as CustomerSort)
            }
          >
            {Object.entries(customerSorts).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </Select>
          <Button
            icon="add"
            variant="primary"
            isDisabled={!workspaceId || creatingCustomer}
            onPress={() => {
              setNewCustomerName("");
              setCreateCustomerError(null);
              setCreatingCustomer(true);
            }}
          >
            Create customer
          </Button>
        </div>
      </div>
      {creatingCustomer && (
        <SidePanel
          title="Create customer"
          open
          dismissible={!savingCustomer}
          onOpenChange={(open) => {
            if (!open) setCreatingCustomer(false);
          }}
          footer={
            <>
              <Button isDisabled={savingCustomer} onPress={() => setCreatingCustomer(false)}>
                Cancel
              </Button>
              <Button
                type="submit"
                form="customer-create-form"
                variant="primary"
                busy={savingCustomer}
                isDisabled={!workspaceId || !newCustomerName.trim()}
              >
                Create customer
              </Button>
            </>
          }
        >
          <form
            id="customer-create-form"
            className={stylex(styles.form)}
            onSubmit={(event) => {
              event.preventDefault();
              void create();
            }}
          >
            <TextInput
              label="Customer display name"
              name="displayName"
              required
              autoFocus
              disabled={savingCustomer}
              value={newCustomerName}
              onChange={(event) => setNewCustomerName(event.target.value)}
            />
            {createCustomerError && <Status tone="danger">{createCustomerError}</Status>}
          </form>
        </SidePanel>
      )}
      {error && !customerId && <Status tone="danger">{error}</Status>}
      <div>
        <CustomerDirectory
          query={query}
          page={loaded?.workspaceId === workspaceId && loaded?.sort === sort ? loaded : null}
          loading={listLoading}
          error={listError || (!workspaceId ? "Choose a workspace to view customers." : undefined)}
          onChange={changeQuery}
          onRetry={() => void refresh()}
          onOpen={openCustomer}
        />
        <NavigableSidePanel
          open={Boolean(customerId)}
          onOpenChange={(open) => {
            if (open || editor?.busy) return;
            if (editor) editor.cancel();
            else navigate({ pathname: "/customers", search: location.search });
          }}
          title={editor?.title ?? detail?.customer.display_name ?? "Customer"}
          description={editor ? detail?.customer.display_name : undefined}
          pageKey={editor?.key ?? "details"}
          dismissible={!editor?.busy}
          back={
            editor && !editor.busy
              ? { label: `Back to ${sectionLabel}`, onPress: editor.cancel }
              : undefined
          }
          footer={
            editor ? (
              <>
                <Button isDisabled={editor.busy} onPress={editor.cancel}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  form={editor.formId}
                  icon="save"
                  variant="primary"
                  busy={editor.busy}
                  isDisabled={editor.disabled}
                >
                  {editor.busy ? "Saving…" : editor.label}
                </Button>
              </>
            ) : undefined
          }
        >
          {editor ? (
            <div className={stylex(styles.panelStack)}>
              {error && !creatingNote && <Status tone="danger">{error}</Status>}
              {editor.content}
            </div>
          ) : detailLoading ? (
            <CustomerDetailGlimmer />
          ) : !detail ? (
            <Status tone={error ? "danger" : "neutral"}>{error || "Select a customer."}</Status>
          ) : (
            <>
              <div className={stylex(styles.panelStack)}>
                {error && <Status tone="danger">{error}</Status>}
                <SegmentedControl
                  label="Customer sections"
                  narrowBehavior="select"
                  value={activeTab}
                  onChange={(value) => setActiveTab(value as CustomerTab)}
                  options={tabOptions}
                />
                {activeTab === "summary" && (
                  <>
                    <Panel
                      title="Customer"
                      actions={
                        <Button
                          icon="edit"
                          onPress={() => {
                            setError(null);
                            setCustomerHasChanges(false);
                            setEditingCustomer(true);
                          }}
                        >
                          Edit customer
                        </Button>
                      }
                    >
                      <dl className={stylex(styles.facts)}>
                        <div>
                          <dt>Status</dt>
                          <dd className={stylex(styles.factValue)}>
                            <Badge>{readableLabel(detail.customer.status)}</Badge>
                          </dd>
                        </div>
                        <div>
                          <dt>Lead source</dt>
                          <dd className={stylex(styles.factValue)}>
                            {detail.customer.lead_source || "—"}
                          </dd>
                        </div>
                      </dl>
                      <div>
                        <Status
                          tone={
                            detail.customer.follow_up_urgency === "overdue" ? "warning" : "neutral"
                          }
                        >
                          {analyzingFollowUp
                            ? "Analyzing follow-up…"
                            : followUpLabel(
                                detail.customer.next_follow_up_at,
                                detail.customer.follow_up_urgency
                              )}
                        </Status>
                        {detail.customer.follow_up_reason && (
                          <p className={stylex(styles.muted)}>{detail.customer.follow_up_reason}</p>
                        )}
                      </div>
                    </Panel>
                    {workspaceId && (
                      <InquiryReplies
                        key={workspaceId + detail.customer.id}
                        workspace={workspaceId}
                        customer={detail.customer.id}
                      />
                    )}
                    <Panel title="Primary contact">
                      {primaryContact ? (
                        <div>
                          <strong>{primaryContact.display_name}</strong>
                          <div className={stylex(styles.muted)}>
                            {primaryContact.email || "No email"} ·{" "}
                            <PhoneLink phone={primaryContact.phone} />
                          </div>
                        </div>
                      ) : (
                        <EmptyCustomerSection>No primary contact.</EmptyCustomerSection>
                      )}
                    </Panel>
                    <div id="customer-qualification" tabIndex={-1}>
                      <Panel title="Qualification">
                        <CustomerQualification
                          key={detail.customer.id}
                          customerId={detail.customer.id}
                          qualification={detail.qualification}
                          onChange={(next) => {
                            setDetail((current) =>
                              current?.customer.id === next.customer.id ? next : current
                            );
                            setRows((current) =>
                              current.map((row) =>
                                row.id === next.customer.id
                                  ? {
                                      ...row,
                                      qualification_classification:
                                        next.qualification?.current?.classification ?? null,
                                    }
                                  : row
                              )
                            );
                          }}
                        />
                      </Panel>
                    </div>
                    {!!detail.emailNoteCandidates?.length && (
                      <Panel
                        title="Email note suggestions"
                        actions={<Badge>{detail.emailNoteCandidates.length}</Badge>}
                      >
                        <p className={stylex(styles.muted)}>
                          Review information from forwarded emails before adding it to Notes.
                        </p>
                        {detail.emailNoteCandidates.map((candidate) => (
                          <article key={candidate.id} className={stylex(styles.record)}>
                            <strong>{candidate.proposed_subject}</strong>
                            <div className={stylex(styles.muted)}>
                              {candidate.category === "email_summary"
                                ? "Complete email summary"
                                : candidate.category}
                              {" · "}
                              {Math.round(candidate.confidence * 100)}% confidence
                              {candidate.original_sender_email
                                ? ` · from ${candidate.original_sender_name || candidate.original_sender_email}`
                                : ""}
                              {candidate.attachment_count
                                ? ` · ${candidate.attachment_count} ${candidate.attachment_count === 1 ? "attachment" : "attachments"}`
                                : ""}
                              {candidate.email_sent_at
                                ? ` · sent ${formatDateTime(candidate.email_sent_at)}`
                                : ""}
                            </div>
                            <div className={stylex(styles.markdown)}>
                              <Markdown>{candidate.proposed_body}</Markdown>
                            </div>
                            {candidate.evidence && (
                              <p className={stylex(styles.muted)}>Evidence: {candidate.evidence}</p>
                            )}
                            <div className={stylex(styles.actions)}>
                              <Button
                                isDisabled={reviewingEmailCandidateId === candidate.id}
                                onPress={() => void reviewEmailCandidate(candidate.id, "apply")}
                              >
                                Apply to notes
                              </Button>
                              <Button
                                variant="ghost"
                                isDisabled={reviewingEmailCandidateId === candidate.id}
                                onPress={() => void reviewEmailCandidate(candidate.id, "dismiss")}
                              >
                                Dismiss
                              </Button>
                            </div>
                          </article>
                        ))}
                      </Panel>
                    )}
                    <Panel
                      title="Recent notes"
                      actions={
                        <Button variant="primary" icon="add" onPress={openNoteEditor}>
                          Add note
                        </Button>
                      }
                    >
                      {recentNotes.length ? (
                        recentNotes.map(renderActivity)
                      ) : (
                        <EmptyCustomerSection>No notes yet.</EmptyCustomerSection>
                      )}
                    </Panel>
                  </>
                )}
                {activeTab === "contacts" && (
                  <>
                    <Panel
                      title="Contacts"
                      actions={
                        <Button
                          variant="primary"
                          icon="add"
                          onPress={() => {
                            setError(null);
                            setContactCanSave(false);
                            setCreatingContact(true);
                          }}
                        >
                          Add contact
                        </Button>
                      }
                    >
                      {detail.contacts.length === 0 && (
                        <EmptyCustomerSection>No contacts yet.</EmptyCustomerSection>
                      )}
                      {detail.contacts.map((contact) => (
                        <article key={contact.id} className={stylex(styles.record)}>
                          <div className={stylex(styles.recordHeader)}>
                            <strong>{contact.display_name}</strong>
                            <Button
                              variant="ghost"
                              icon="edit"
                              aria-label={`Edit ${contact.display_name}`}
                              onPress={() => {
                                setError(null);
                                setContactCanSave(false);
                                setEditingContactId(contact.id);
                              }}
                            >
                              Edit
                            </Button>
                          </div>
                          <div className={stylex(styles.actions)}>
                            <Badge>{readableLabel(contact.status)}</Badge>
                            {contact.is_primary ? <Badge tone="success">Primary</Badge> : null}
                            <span>{contact.role || "Contact"}</span>
                          </div>
                          <div>
                            {contact.email || "No email"} · <PhoneLink phone={contact.phone} />
                          </div>
                          <div className={stylex(styles.muted)}>
                            Marketing email:{" "}
                            {contact.marketing_email_permission === "allowed"
                              ? "Allowed"
                              : contact.marketing_email_permission === "not_allowed"
                                ? "Not allowed"
                                : "Unknown"}
                          </div>
                        </article>
                      ))}
                    </Panel>
                    <Panel title="Addresses">
                      <List
                        label="Customer addresses"
                        emptyMessage="No addresses yet."
                        items={detail.addresses.map((address) => ({
                          id: String(address.id),
                          title: readableLabel(String(address.address_type)),
                          metadata: [
                            address.line1,
                            address.line2,
                            address.city,
                            address.region,
                            address.postal_code,
                            address.country,
                          ]
                            .filter(Boolean)
                            .join(", "),
                        }))}
                      />
                    </Panel>
                  </>
                )}
                {activeTab === "opportunities" && (
                  <Panel
                    title="Opportunities"
                    actions={
                      <Button
                        variant="primary"
                        icon="add"
                        onPress={() => {
                          setError(null);
                          setOpportunityCanSave(false);
                          setCreatingOpportunity(true);
                        }}
                      >
                        Add opportunity
                      </Button>
                    }
                  >
                    {detail.opportunities.length === 0 && (
                      <EmptyCustomerSection>No opportunities yet.</EmptyCustomerSection>
                    )}
                    {detail.opportunities.map((opportunity) => (
                      <article key={opportunity.id} className={stylex(styles.record)}>
                        <div className={stylex(styles.recordHeader)}>
                          <strong>{opportunity.description}</strong>
                          <Button
                            variant="ghost"
                            icon="edit"
                            aria-label={`Edit ${opportunity.description}`}
                            onPress={() => {
                              setError(null);
                              setOpportunityCanSave(false);
                              setEditingOpportunityId(opportunity.id);
                            }}
                          >
                            Edit
                          </Button>
                        </div>
                        <div className={stylex(styles.actions)}>
                          <Badge>{readableLabel(opportunity.status)}</Badge>
                          <span>
                            {readableLabel(opportunity.opportunity_type)} ·{" "}
                            {formatBudget(opportunity.budget_cents)}
                          </span>
                        </div>
                      </article>
                    ))}
                  </Panel>
                )}
                {activeTab === "tasks" && (
                  <Panel title="Tasks">
                    {detail.tasks.length === 0 && (
                      <EmptyCustomerSection>No customer tasks.</EmptyCustomerSection>
                    )}
                    {detail.tasks.map((task) => {
                      const assignee = users.find((user) => user.user_id === task.assigned_to);
                      return (
                        <article key={task.id} className={stylex(styles.record)}>
                          <div className={stylex(styles.recordHeader)}>
                            <strong>{task.title}</strong>
                            <Button
                              variant="ghost"
                              icon="edit"
                              aria-label={`Open task ${task.title}`}
                              onPress={() => setActiveTaskId(task.id)}
                            >
                              Open
                            </Button>
                          </div>
                          <div className={stylex(styles.actions)}>
                            <Badge
                              tone={
                                task.status === "done"
                                  ? "success"
                                  : task.status === "blocked"
                                    ? "warning"
                                    : "neutral"
                              }
                            >
                              {readableLabel(task.status)}
                            </Badge>
                            <span>{task.due_at ? formatDateTime(task.due_at) : "No due date"}</span>
                          </div>
                          <span className={stylex(styles.muted)}>
                            {assignee ? `${assignee.name} (${assignee.email})` : "Unassigned"} ·{" "}
                            {task.project_id ? "Linked to project" : "Customer-only"}
                          </span>
                          {task.description && <div>{task.description}</div>}
                        </article>
                      );
                    })}
                  </Panel>
                )}
                {activeTab === "activity" && (
                  <Panel
                    title="Activity"
                    actions={
                      <Button variant="primary" icon="add" onPress={openNoteEditor}>
                        Add note
                      </Button>
                    }
                  >
                    {detail.activities.length ? (
                      detail.activities.map(renderActivity)
                    ) : (
                      <EmptyCustomerSection>No activity yet.</EmptyCustomerSection>
                    )}
                  </Panel>
                )}
                {activeTab === "files" && (
                  <Panel title="Files">
                    {currentFiles.length ? (
                      currentFiles.map((file) => (
                        <CustomerFileRow
                          key={file.id}
                          file={file}
                          onDeprecated={() => void toggleFileDeprecated(file.id, true)}
                        />
                      ))
                    ) : (
                      <EmptyCustomerSection>No current files.</EmptyCustomerSection>
                    )}
                    {!!deprecatedFiles.length && (
                      <Section title={`Deprecated files (${deprecatedFiles.length})`} collapsible>
                        {deprecatedFiles.map((file) => (
                          <CustomerFileRow
                            key={file.id}
                            file={file}
                            onDeprecated={() => void toggleFileDeprecated(file.id, false)}
                            deprecated
                          />
                        ))}
                      </Section>
                    )}
                  </Panel>
                )}
                {activeTab === "quickbooks" && (
                  <>
                    <Panel title="QuickBooks synchronization">
                      <dl className={stylex(styles.facts)}>
                        <div>
                          <dt>Sync status</dt>
                          <dd className={stylex(styles.factValue)}>
                            <Badge>{readableLabel(detail.customer.quickbooks_sync_status)}</Badge>
                          </dd>
                        </div>
                        <div>
                          <dt>Last sync</dt>
                          <dd className={stylex(styles.factValue)}>
                            {detail.customer.last_synced_at
                              ? formatDateTime(detail.customer.last_synced_at)
                              : "Never"}
                          </dd>
                        </div>
                      </dl>
                      {detail.customer.last_error && (
                        <Status tone="warning">{detail.customer.last_error}</Status>
                      )}
                      <TextInput
                        label="Integration ID"
                        value={integrationId}
                        onChange={(event) => setIntegrationId(event.target.value)}
                      />
                      <div className={stylex(styles.actions)}>
                        <Button icon="search" onPress={() => void findMatches()}>
                          Find matches
                        </Button>
                        <MenuButton
                          label="Sync actions"
                          text="Sync actions"
                          actions={[
                            {
                              id: "create",
                              label: "Create in QuickBooks",
                              onAction: () => void action("create"),
                            },
                            {
                              id: "refresh",
                              label: "Refresh",
                              onAction: () => void action("refresh"),
                            },
                            {
                              id: "retry",
                              label: "Retry failed sync",
                              onAction: () => void action("retry"),
                            },
                          ]}
                        />
                      </div>
                      {matches.map((match) => (
                        <div key={match.id} className={stylex(styles.recordHeader)}>
                          <span>{match.displayName}</span>
                          <Button onPress={() => void action("link", { externalId: match.id })}>
                            Confirm link
                          </Button>
                        </div>
                      ))}
                    </Panel>
                    <Financial title="Estimates" rows={detail.estimates} />
                    <Financial title="Invoices" rows={detail.invoices} />
                  </>
                )}
              </div>
              {activeTaskId && (
                <TaskEditorDrawer
                  taskId={activeTaskId}
                  workspaceId={workspaceId}
                  users={users}
                  onClose={() => setActiveTaskId(null)}
                  onUpdated={reloadDetail}
                />
              )}
            </>
          )}
        </NavigableSidePanel>
      </div>
    </section>
  );
}
function CustomerDetailGlimmer() {
  return (
    <div className={stylex(styles.panelStack)} aria-label="Loading customer details" role="status">
      <Shimmer width="60%" height={32} />
      <Shimmer width="100%" height={132} variant="block" />
      <Shimmer width="100%" height={100} variant="block" />
    </div>
  );
}

function EmptyCustomerSection({ children }: { children: ReactNode }) {
  return <p className={stylex(styles.muted)}>{children}</p>;
}

function readableLabel(value: string) {
  const readable = value.replace(/_/g, " ");
  return readable.charAt(0).toUpperCase() + readable.slice(1);
}
function CustomerFileRow({
  file,
  onDeprecated,
  deprecated = false,
}: {
  file: CustomerDetail["files"][number];
  onDeprecated: () => void;
  deprecated?: boolean;
}) {
  return (
    <article className={stylex(styles.record)}>
      <CustomerFileLink file={file} />
      <div className={stylex(styles.muted)}>
        {formatFileSize(file.size_bytes)} · attached to “{file.note_subject}” ·{" "}
        {formatDateTime(file.created_at)}
      </div>
      <div className={stylex(styles.actions)}>
        <Button variant="ghost" icon={deprecated ? "undo" : undefined} onPress={onDeprecated}>
          {deprecated ? "Restore" : "Mark deprecated"}
        </Button>
      </div>
    </article>
  );
}
function CustomerFileLink({
  file,
  compact = false,
}: {
  file: CustomerDetail["files"][number];
  compact?: boolean;
}) {
  const inlinePreviewUrl = buildUrl(`/customer-files/${file.id}/preview`);
  const previewKind = customerFilePreviewKind(file);
  const openUrl = previewKind ? inlinePreviewUrl : buildUrl(`/customer-files/${file.id}/blob`);
  const previewUrl =
    previewKind === "pdf" ? `${inlinePreviewUrl}#page=1&view=Fit&toolbar=0` : inlinePreviewUrl;
  return (
    <a
      className={stylex(styles.attachmentLink)}
      href={openUrl}
      target="_blank"
      rel="noopener noreferrer"
      title={`Open ${file.original_filename} in a new tab`}
    >
      {previewKind === "image" && (
        <img
          className={stylex(
            styles.attachmentPreview,
            styles.imagePreview,
            compact && styles.imagePreviewCompact
          )}
          src={previewUrl}
          alt={`Preview of ${file.original_filename}`}
          loading="lazy"
        />
      )}
      {previewKind === "pdf" && (
        <span
          className={stylex(
            styles.attachmentPreview,
            styles.pdfPreviewContainer,
            compact && styles.pdfPreviewContainerCompact
          )}
        >
          <iframe
            className={stylex(styles.pdfPreview)}
            src={previewUrl}
            title={`Preview of ${file.original_filename}`}
            loading="lazy"
            tabIndex={-1}
          />
        </span>
      )}
      <b className={stylex(styles.attachmentName)}>{file.original_filename}</b>
    </a>
  );
}
function customerFilePreviewKind(file: CustomerDetail["files"][number]): "image" | "pdf" | null {
  const contentType = file.content_type.toLowerCase();
  const filename = file.original_filename.toLowerCase();
  if (
    ["image/avif", "image/gif", "image/jpeg", "image/png", "image/webp"].includes(contentType) ||
    /\.(avif|gif|jpe?g|png|webp)$/.test(filename)
  ) {
    return "image";
  }
  if (contentType === "application/pdf" || filename.endsWith(".pdf")) return "pdf";
  return null;
}
function formatFileSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
type OpportunityInput = {
  description: string;
  type: string;
  budget: number;
  status: string;
};
function OpportunityForm({
  id,
  opportunity,
  onSave,
  onCanSaveChange,
}: {
  id: string;
  opportunity?: Opportunity;
  onSave: (input: OpportunityInput) => void;
  onCanSaveChange: (canSave: boolean) => void;
}) {
  const [description, setDescription] = useState(opportunity?.description || "");
  const [type, setType] = useState<string>(opportunity?.opportunity_type || "furniture");
  const [budget, setBudget] = useState(opportunity ? String(opportunity.budget_cents / 100) : "");
  const [status, setStatus] = useState<string>(opportunity?.status || "scoping");
  const parsedBudget = Number(budget);
  const isValid = Boolean(description.trim()) && budget !== "" && parsedBudget >= 0;
  const hasChanges = opportunity
    ? description.trim() !== opportunity.description ||
      type !== opportunity.opportunity_type ||
      parsedBudget !== opportunity.budget_cents / 100 ||
      status !== opportunity.status
    : isValid;
  useEffect(() => onCanSaveChange(isValid && hasChanges), [hasChanges, isValid, onCanSaveChange]);
  return (
    <form
      id={id}
      className={stylex(styles.form)}
      onSubmit={(event) => {
        event.preventDefault();
        onSave({ description: description.trim(), type, budget: parsedBudget, status });
      }}
    >
      <TextArea
        label="Opportunity description"
        placeholder="Describe the opportunity"
        required
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />
      <Select label="Opportunity type" value={type} onChange={(e) => setType(e.target.value)}>
        <option value="furniture">furniture</option>
        <option value="cabinets">cabinets</option>
        <option value="other">other</option>
      </Select>
      <TextInput
        label="Opportunity budget"
        type="number"
        min="0"
        step="0.01"
        placeholder="Budget"
        required
        value={budget}
        onChange={(e) => setBudget(e.target.value)}
      />
      <Select label="Opportunity status" value={status} onChange={(e) => setStatus(e.target.value)}>
        <option value="scoping">scoping</option>
        <option value="quoted">quoted</option>
        <option value="accepted">accepted</option>
        <option value="lost">lost</option>
      </Select>
    </form>
  );
}
function formatBudget(cents: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}
function PhoneLink({ phone }: { phone: string | null | undefined }) {
  const formatted = formatPhoneNumber(phone);
  if (!formatted || !phone) return <>No phone</>;
  return (
    <a className={stylex(styles.phoneLink)} href={`tel:${phone.trim()}`}>
      {formatted}
    </a>
  );
}
type CustomerInput = { displayName: string; status: string; leadSource: string };
function CustomerForm({
  id,
  customer,
  onSave,
  onDirtyChange,
}: {
  id: string;
  customer: CustomerDetail["customer"];
  onSave: (input: CustomerInput) => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const [displayName, setDisplayName] = useState(customer.display_name);
  const [status, setStatus] = useState(customer.status);
  const [leadSource, setLeadSource] = useState(customer.lead_source || "");
  const hasChanges =
    displayName.trim() !== customer.display_name ||
    status !== customer.status ||
    leadSource.trim() !== (customer.lead_source || "");
  useEffect(() => onDirtyChange(hasChanges), [hasChanges, onDirtyChange]);
  return (
    <form
      id={id}
      className={stylex(styles.form)}
      onSubmit={(event) => {
        event.preventDefault();
        onSave({ displayName: displayName.trim(), status, leadSource: leadSource.trim() });
      }}
    >
      <TextInput
        label="Customer name"
        required
        value={displayName}
        onChange={(event) => setDisplayName(event.target.value)}
      />
      <Select
        label="Customer status"
        value={status}
        onChange={(event) => setStatus(event.target.value)}
      >
        {["lead", "active", "completed", "archived"].map((value) => (
          <option key={value} value={value}>
            {readableLabel(value)}
          </option>
        ))}
      </Select>
      <TextInput
        label="Lead source"
        value={leadSource}
        onChange={(event) => setLeadSource(event.target.value)}
      />
    </form>
  );
}
function formatDateTime(value: string) {
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: customerTimeZone,
    timeZoneName: "short",
  });
}
function recentCustomerNotes(activities: CustomerDetail["activities"], pendingNoteIds: string[]) {
  const notes = activities.filter((activity) => activity.activity_type === "note");
  const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const recentCount = notes.filter(
    (activity) => new Date(activity.occurred_at).getTime() >= oneWeekAgo
  ).length;
  return notes.filter(
    (note, index) => index < Math.max(3, recentCount) || pendingNoteIds.includes(note.id)
  );
}
function followUpLabel(
  value: string | null,
  urgency: "overdue" | "due_today" | "upcoming" | "none"
) {
  if (!value) return "No follow-up required";
  const prefix =
    urgency === "overdue"
      ? "Follow-up overdue"
      : urgency === "due_today"
        ? "Follow-up due today"
        : "Next follow-up";
  return `${prefix}: ${formatDateTime(value)}`;
}
type ContactInput = {
  marketingEmailPermission?: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  role: string;
  status: string;
  isPrimary: boolean;
};
function ContactForm({
  id,
  contact,
  onSave,
  onCanSaveChange,
}: {
  id: string;
  contact?: Contact;
  onSave: (input: ContactInput) => void;
  onCanSaveChange: (canSave: boolean) => void;
}) {
  const [firstName, setFirstName] = useState(contact?.first_name || "");
  const [lastName, setLastName] = useState(contact?.last_name || "");
  const [email, setEmail] = useState(contact?.email || "");
  const [phone, setPhone] = useState(contact?.phone || "");
  const [role, setRole] = useState(contact?.role || "");
  const [status, setStatus] = useState<string>(contact?.status || "active");
  const [permission, setPermission] = useState(contact?.marketing_email_permission || "unknown");
  const [isPrimary, setIsPrimary] = useState(Boolean(contact?.is_primary));
  const hasName = Boolean(firstName.trim() || lastName.trim() || contact?.display_name);
  const hasChanges = contact
    ? firstName.trim() !== (contact.first_name || "") ||
      lastName.trim() !== (contact.last_name || "") ||
      email.trim() !== (contact.email || "") ||
      phone.trim() !== (contact.phone || "") ||
      role.trim() !== (contact.role || "") ||
      status !== contact.status ||
      permission !== (contact.marketing_email_permission || "unknown") ||
      isPrimary !== Boolean(contact.is_primary)
    : hasName;
  useEffect(() => onCanSaveChange(hasName && hasChanges), [hasChanges, hasName, onCanSaveChange]);
  return (
    <form
      id={id}
      className={stylex(styles.form)}
      onSubmit={(event) => {
        event.preventDefault();
        onSave({
          ...(permission !== (contact?.marketing_email_permission || "unknown")
            ? { marketingEmailPermission: permission }
            : {}),
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          email: email.trim(),
          phone: phone.trim(),
          role: role.trim(),
          status,
          isPrimary,
        });
      }}
    >
      <TextInput
        label="First name"
        placeholder="First name"
        value={firstName}
        onChange={(e) => setFirstName(e.target.value)}
      />
      <TextInput
        label="Last name"
        placeholder="Last name"
        value={lastName}
        onChange={(e) => setLastName(e.target.value)}
      />
      <TextInput
        label="Email"
        placeholder="Email"
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <TextInput
        label="Phone"
        placeholder="Phone"
        type="tel"
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
      />
      <TextInput
        label="Role"
        placeholder="Role"
        value={role}
        onChange={(e) => setRole(e.target.value)}
      />
      <Select
        label="Marketing email"
        value={permission}
        onChange={(e) => setPermission(e.target.value as typeof permission)}
      >
        <option value="unknown">Marketing email: Unknown</option>
        <option value="allowed">Marketing email: Allowed</option>
        <option value="not_allowed">Marketing email: Not allowed</option>
      </Select>
      <Select label="Contact status" value={status} onChange={(e) => setStatus(e.target.value)}>
        <option value="active">active</option>
        <option value="inactive">inactive</option>
        {contact && <option value="archived">archived</option>}
      </Select>
      <Switch label="Primary contact" selected={isPrimary} onChange={setIsPrimary} />
    </form>
  );
}
function Financial({ title, rows }: { title: string; rows: Array<Record<string, unknown>> }) {
  const label = title.toLowerCase();
  return (
    <Panel title={title} actions={<Badge>Read-only</Badge>}>
      <List
        label={`QuickBooks ${label}`}
        emptyMessage={`No QuickBooks ${label}.`}
        items={rows.map((row) => ({
          id: String(row.id),
          title: String(row.doc_number || "—"),
          metadata: `Total $${Number(row.total || 0).toFixed(2)} · Balance ${row.balance == null ? "—" : `$${Number(row.balance).toFixed(2)}`}`,
          status: { label: readableLabel(String(row.status || "—")) },
        }))}
      />
    </Panel>
  );
}
