"use client";
import {
  CustomerDirectory,
  customerSorts,
  customerStatuses,
  type CustomerSort,
} from "./CustomerDirectory";
import { CustomerQualification } from "./CustomerQualification";
import {
  Button,
  NavigableSidePanel,
  Select,
  Status,
  tablePageSizes,
  type TableQuery,
} from "@from-trees/ui";
import { CustomerNoteForm, customerTimeZone, type CustomerNoteInput } from "./CustomerNoteForm";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router";
import Markdown from "react-markdown";
import stylex from "~/lib/stylex";
import { buildUrl } from "@/lib/api";
import { listUsers, type WorkspaceUser } from "../users/api";
import { TaskEditorDrawer } from "../tasks/TaskDetailDrawer";
import { RightSideEditor } from "../../components/RightSideEditor";
import { formatPhoneNumber } from "../../lib/formatPhoneNumber";
import { colors, radius } from "../../theme/tokens.stylex";
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

const glimmer = stylex.keyframes({
  "0%": { backgroundPosition: "200% 0" },
  "100%": { backgroundPosition: "-200% 0" },
});

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
  panel: { padding: { default: "24px 32px", "@media (max-width: 600px)": "16px" }, minWidth: 0 },
  titleRow: {
    display: "flex",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: "12px",
    alignItems: "center",
    marginBottom: "16px",
  },
  directoryActions: { display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "center" },
  glimmer: {
    borderRadius: radius.sm,
    backgroundImage: `linear-gradient(90deg, ${colors.neutralBg} 25%, ${colors.surfaceStrong} 50%, ${colors.neutralBg} 75%)`,
    backgroundSize: "200% 100%",
    animationName: glimmer,
    animationDuration: "1.4s",
    animationIterationCount: "infinite",
    animationTimingFunction: "ease-in-out",
  },
  glimmerLine: { height: "14px", marginBottom: "12px" },
  glimmerLineShort: { width: "42%" },
  glimmerLineMedium: { width: "68%" },
  detailGlimmerHeader: { height: "28px", width: "46%", marginBottom: "18px" },
  detailGlimmerTabs: { height: "40px", marginBottom: "18px" },
  detailGlimmerCard: { height: "150px" },
  muted: { color: colors.textSubtle, fontSize: "13px" },
  error: { color: colors.errorText },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit,minmax(min(220px,100%),1fr))",
    gap: "12px",
    padding: "8px",
  },
  section: { borderTop: `1px solid ${colors.border}`, paddingTop: "12px", marginTop: "16px" },
  table: { width: "100%", borderCollapse: "collapse" },
  cell: { padding: "7px", borderBottom: `1px solid ${colors.border}`, textAlign: "left" },
  actions: { display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" },
  editorDangerZone: {
    marginTop: "auto",
    paddingTop: "16px",
    borderTop: `1px solid ${colors.border}`,
  },
  dangerButton: {
    borderColor: colors.errorText,
    color: colors.errorText,
  },
  form: { display: "grid", gap: "8px", padding: "12px 0" },
  check: { display: "flex", gap: "6px", alignItems: "center" },
  contact: { borderBottom: `1px solid ${colors.border}`, padding: "10px 0" },
  textarea: { minHeight: "120px", resize: "vertical", font: "inherit" },
  note: { borderBottom: `1px solid ${colors.border}`, padding: "10px 0" },
  noteFeedback: { display: "grid", gap: "8px", marginBlock: "8px", overflowWrap: "anywhere" },
  markdown: { lineHeight: 1.5 },
  detailTabs: {
    display: "flex",
    gap: "6px",
    flexWrap: "wrap",
    padding: "10px 0 0",
    borderBottom: `1px solid ${colors.border}`,
    "@media (max-width: 760px)": {
      display: "none",
    },
  },
  mobileTabPicker: {
    display: "none",
    "@media (max-width: 760px)": {
      display: "grid",
      gap: "6px",
      padding: "10px 0 4px",
    },
  },
  mobileTabSelect: {
    width: "100%",
    minHeight: "44px",
    boxSizing: "border-box",
    border: `1px solid ${colors.border}`,
    borderRadius: radius.sm,
    padding: "8px 10px",
    backgroundColor: colors.surfaceAlt,
    color: colors.text,
    font: "inherit",
  },
  detailTab: {
    border: `1px solid ${colors.border}`,
    borderRadius: `${radius.sm} ${radius.sm} 0 0`,
    padding: "6px 8px 8px",
    color: colors.textMuted,
    cursor: "pointer",
  },
  detailTabActive: {
    color: colors.text,
    borderBottom: "none",
    boxShadow: "none",
    marginBottom: "-1px",
    padding: "8px 10px",
    backgroundColor: colors.surface,
    fontWeight: 600,
  },
  tabBadge: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minWidth: "20px",
    height: "20px",
    marginLeft: "6px",
    padding: "0 6px",
    borderRadius: "999px",
    backgroundColor: colors.neutralBg,
    color: colors.neutralText,
    fontSize: "11px",
    fontWeight: 600,
  },
  summaryCard: {
    border: `1px solid ${colors.border}`,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceAlt,
    padding: "8px",
  },
  attachmentLink: {
    display: "grid",
    gap: "6px",
    justifyItems: "start",
    color: colors.text,
    textDecoration: "none",
    minWidth: 0,
  },
  attachmentPreview: {
    display: "block",
    overflow: "hidden",
    border: `1px solid ${colors.border}`,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceStrong,
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
    if (!customerId) return;
    setSavingEditor(true);
    const r = await updateCustomer(customerId, input);
    setSavingEditor(false);
    if (r.ok && r.data) {
      setDetail(r.data);
      setEditingCustomer(false);
      await refresh();
    } else setError((r.data as { error?: string } | null)?.error || r.text);
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
    if (!customerId) return;
    setSavingEditor(true);
    const payload = { ...input, budgetCents: Math.round(input.budget * 100) };
    const r = opportunityId
      ? await updateOpportunity(customerId, opportunityId, payload)
      : await addOpportunity(customerId, payload);
    setSavingEditor(false);
    if (r.ok && r.data) {
      setDetail(r.data);
      setCreatingOpportunity(false);
      setEditingOpportunityId(null);
    } else setError((r.data as { error?: string } | null)?.error || r.text);
  }
  async function saveContact(input: ContactInput, contactId?: string) {
    if (!customerId) return;
    setSavingEditor(true);
    const r = contactId
      ? await updateContact(customerId, contactId, input)
      : await addContact(customerId, input);
    setSavingEditor(false);
    if (r.ok && r.data) {
      setDetail(r.data);
      setEditingContactId(null);
      setCreatingContact(false);
      await refresh();
    } else setError((r.data as { error?: string } | null)?.error || r.text);
  }
  async function removeContact(contact: Contact): Promise<boolean> {
    if (!customerId || !confirm(`Archive ${contact.display_name}?`)) return false;
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
  const openTaskCount =
    detail?.tasks.filter((task) => task.status !== "done" && task.status !== "canceled").length ??
    0;
  const nonLostOpportunityCount =
    detail?.opportunities.filter((opportunity) => opportunity.status !== "lost").length ?? 0;
  const currentFileCount = detail?.files.filter((file) => !file.deprecated_at).length ?? 0;
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
        <RightSideEditor
          eyebrow="Customer"
          title="Create customer"
          formId="customer-create-form"
          saveLabel="Create customer"
          saveDisabled={!workspaceId || !newCustomerName.trim()}
          saving={savingCustomer}
          onCancel={() => setCreatingCustomer(false)}
        >
          <form
            id="customer-create-form"
            className={stylex(styles.form)}
            onSubmit={(event) => {
              event.preventDefault();
              void create();
            }}
          >
            <label>
              Customer display name
              <input
                name="displayName"
                type="text"
                required
                autoFocus
                disabled={savingCustomer}
                value={newCustomerName}
                onChange={(event) => setNewCustomerName(event.target.value)}
              />
            </label>
            {createCustomerError && (
              <p className={stylex(styles.error)} role="alert">
                {createCustomerError}
              </p>
            )}
          </form>
        </RightSideEditor>
      )}
      {error && <p className={stylex(styles.error)}>{error}</p>}
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
            if (open || savingNote) return;
            if (creatingNote) setCreatingNote(false);
            else navigate({ pathname: "/customers", search: location.search });
          }}
          title={creatingNote ? "Add note" : detail?.customer.display_name || "Customer"}
          description={creatingNote ? detail?.customer.display_name : undefined}
          pageKey={creatingNote ? "add-note" : "customer"}
          dismissible={!savingNote}
          back={
            creatingNote && !savingNote
              ? {
                  label: activeTab === "summary" ? "Back to Summary" : "Back to Activity",
                  onPress: () => setCreatingNote(false),
                }
              : undefined
          }
          footer={
            creatingNote ? (
              <>
                <Button isDisabled={savingNote} onPress={() => setCreatingNote(false)}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  form="customer-note-editor-form"
                  variant="primary"
                  icon="save"
                  busy={savingNote}
                >
                  {savingNote ? "Saving note…" : "Save note"}
                </Button>
              </>
            ) : undefined
          }
        >
          {creatingNote && detail ? (
            <CustomerNoteForm
              id="customer-note-editor-form"
              onSave={saveNote}
              saving={savingNote}
              users={users}
              saveError={noteSaveError}
            />
          ) : detailLoading ? (
            <CustomerDetailGlimmer />
          ) : !detail ? (
            <p className={stylex(styles.muted)}>Select a customer.</p>
          ) : (
            <>
              {error && <Status tone="danger">{error}</Status>}
              <div
                className={stylex(styles.detailTabs)}
                role="tablist"
                aria-label="Customer details"
              >
                {CUSTOMER_TABS.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={activeTab === tab.id}
                    className={stylex(
                      styles.detailTab,
                      activeTab === tab.id && styles.detailTabActive
                    )}
                    onClick={() => setActiveTab(tab.id)}
                  >
                    {tab.label}
                    {tab.id === "tasks" && (
                      <span className={stylex(styles.tabBadge)}>{openTaskCount}</span>
                    )}
                    {tab.id === "opportunities" && (
                      <span className={stylex(styles.tabBadge)}>{nonLostOpportunityCount}</span>
                    )}
                    {tab.id === "files" && (
                      <span className={stylex(styles.tabBadge)}>{currentFileCount}</span>
                    )}
                  </button>
                ))}
              </div>
              <label className={stylex(styles.mobileTabPicker)}>
                <span className={stylex(styles.muted)}>Customer section</span>
                <select
                  className={stylex(styles.mobileTabSelect)}
                  value={activeTab}
                  onChange={(event) => setActiveTab(event.target.value as CustomerTab)}
                >
                  {CUSTOMER_TABS.map((tab) => (
                    <option key={tab.id} value={tab.id}>
                      {tab.label}
                      {tab.id === "tasks" ? ` (${openTaskCount})` : ""}
                      {tab.id === "opportunities" ? ` (${nonLostOpportunityCount})` : ""}
                      {tab.id === "files" ? ` (${currentFileCount})` : ""}
                    </option>
                  ))}
                </select>
              </label>
              {activeTab === "summary" && (
                <div className={stylex(styles.grid)} role="tabpanel">
                  <div>
                    <div className={stylex(styles.actions)}>
                      <b>Customer</b>
                      {!editingCustomer && (
                        <button
                          onClick={() => {
                            setCustomerHasChanges(false);
                            setEditingCustomer(true);
                          }}
                        >
                          Edit customer
                        </button>
                      )}
                    </div>
                    <p>Name: {detail.customer.display_name}</p>
                    <p>Status: {detail.customer.status}</p>
                    <p>Lead source: {detail.customer.lead_source || "—"}</p>
                    <p>
                      {analyzingFollowUp
                        ? "Analyzing follow-up…"
                        : followUpLabel(
                            detail.customer.next_follow_up_at,
                            detail.customer.follow_up_urgency
                          )}
                    </p>
                    <div id="customer-qualification" tabIndex={-1}>
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
                    </div>
                    {detail.customer.follow_up_reason && (
                      <p className={stylex(styles.muted)}>{detail.customer.follow_up_reason}</p>
                    )}
                  </div>
                  <div className={stylex(styles.summaryCard)}>
                    <b>Primary contact</b>
                    {detail.contacts.find((contact) => contact.is_primary) ? (
                      <>
                        <p>{detail.contacts.find((contact) => contact.is_primary)?.display_name}</p>
                        <p className={stylex(styles.muted)}>
                          {detail.contacts.find((contact) => contact.is_primary)?.email ||
                            "No email"}{" "}
                          ·{" "}
                          <PhoneLink
                            phone={detail.contacts.find((contact) => contact.is_primary)?.phone}
                          />
                        </p>
                      </>
                    ) : (
                      <p className={stylex(styles.muted)}>No primary contact.</p>
                    )}
                  </div>
                </div>
              )}
              {activeTab === "contacts" && (
                <div className={stylex(styles.section)} role="tabpanel">
                  <h4>Contacts</h4>
                  {!creatingContact && !editingContactId && (
                    <button
                      onClick={() => {
                        setContactCanSave(false);
                        setCreatingContact(true);
                      }}
                    >
                      Add contact
                    </button>
                  )}
                  {detail.contacts.map((contact) => (
                    <div key={contact.id} className={stylex(styles.contact)}>
                      <b>{contact.display_name}</b>
                      {contact.is_primary ? " · Primary" : ""}
                      <div>
                        {contact.role || "Contact"} · {contact.status}
                      </div>
                      <div>
                        Marketing email:{" "}
                        {contact.marketing_email_permission === "allowed"
                          ? "Allowed"
                          : contact.marketing_email_permission === "not_allowed"
                            ? "Not allowed"
                            : "Unknown"}
                      </div>
                      <div>
                        {contact.email || "No email"} · <PhoneLink phone={contact.phone} />
                      </div>
                      <div className={stylex(styles.actions)}>
                        <button
                          onClick={() => {
                            setContactCanSave(false);
                            setEditingContactId(contact.id);
                          }}
                        >
                          Edit
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {activeTab === "opportunities" && (
                <div className={stylex(styles.section)} role="tabpanel">
                  <h4>Opportunities</h4>
                  {!creatingOpportunity && !editingOpportunityId && (
                    <button
                      onClick={() => {
                        setOpportunityCanSave(false);
                        setCreatingOpportunity(true);
                      }}
                    >
                      Add opportunity
                    </button>
                  )}
                  {detail.opportunities.map((opportunity) => (
                    <article key={opportunity.id} className={stylex(styles.contact)}>
                      <b>{opportunity.description}</b>
                      <div>
                        {opportunity.opportunity_type} · {opportunity.status} ·{" "}
                        {formatBudget(opportunity.budget_cents)}
                      </div>
                      <button
                        onClick={() => {
                          setOpportunityCanSave(false);
                          setEditingOpportunityId(opportunity.id);
                        }}
                      >
                        Edit
                      </button>
                    </article>
                  ))}
                </div>
              )}
              {activeTab === "tasks" && (
                <div className={stylex(styles.section)} role="tabpanel">
                  <h4>Tasks</h4>
                  {detail.tasks.length === 0 && (
                    <p className={stylex(styles.muted)}>No customer tasks.</p>
                  )}
                  {detail.tasks.map((task) => {
                    const assignee = users.find((user) => user.user_id === task.assigned_to);
                    return (
                      <article
                        key={task.id}
                        className={stylex(styles.note)}
                        onClick={() => setActiveTaskId(task.id)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            setActiveTaskId(task.id);
                          }
                        }}
                      >
                        <b>{task.title}</b>
                        <div className={stylex(styles.muted)}>
                          {task.status} ·{" "}
                          {task.due_at ? formatDateTime(task.due_at) : "No due date"}
                          {` · ${assignee ? `${assignee.name} (${assignee.email})` : "Unassigned"}`}
                          {task.project_id ? " · Linked to project" : " · Customer-only"}
                        </div>
                        {task.description && <div>{task.description}</div>}
                      </article>
                    );
                  })}
                </div>
              )}
              {activeTaskId && (
                <TaskEditorDrawer
                  taskId={activeTaskId}
                  workspaceId={workspaceId}
                  users={users}
                  onClose={() => setActiveTaskId(null)}
                  onUpdated={reloadDetail}
                />
              )}
              {editingCustomer && (
                <RightSideEditor
                  eyebrow="Customer"
                  title={`Edit ${detail.customer.display_name}`}
                  formId="customer-editor-form"
                  saveDisabled={!customerHasChanges}
                  saving={savingEditor}
                  onCancel={() => setEditingCustomer(false)}
                >
                  <CustomerForm
                    id="customer-editor-form"
                    customer={detail.customer}
                    onSave={saveCustomer}
                    onDirtyChange={setCustomerHasChanges}
                  />
                </RightSideEditor>
              )}
              {(creatingContact || editingContact) && (
                <RightSideEditor
                  eyebrow="Contact"
                  title={editingContact ? `Edit ${editingContact.display_name}` : "Add contact"}
                  formId="customer-contact-editor-form"
                  saveDisabled={!contactCanSave}
                  saving={savingEditor}
                  saveLabel={editingContact ? "Save" : "Add contact"}
                  onCancel={() => {
                    setCreatingContact(false);
                    setEditingContactId(null);
                  }}
                >
                  <ContactForm
                    id="customer-contact-editor-form"
                    contact={editingContact}
                    onSave={(input) => saveContact(input, editingContact?.id)}
                    onCanSaveChange={setContactCanSave}
                  />
                  {editingContact && editingContact.status !== "archived" && (
                    <div className={stylex(styles.editorDangerZone)}>
                      <button
                        type="button"
                        className={stylex(styles.dangerButton)}
                        disabled={savingEditor}
                        onClick={() => {
                          void (async () => {
                            setSavingEditor(true);
                            const archived = await removeContact(editingContact);
                            setSavingEditor(false);
                            if (archived) setEditingContactId(null);
                          })();
                        }}
                      >
                        Archive contact
                      </button>
                    </div>
                  )}
                </RightSideEditor>
              )}
              {(creatingOpportunity || editingOpportunity) && (
                <RightSideEditor
                  eyebrow="Opportunity"
                  title={editingOpportunity ? "Edit opportunity" : "Add opportunity"}
                  formId="customer-opportunity-editor-form"
                  saveDisabled={!opportunityCanSave}
                  saving={savingEditor}
                  saveLabel={editingOpportunity ? "Save" : "Add opportunity"}
                  onCancel={() => {
                    setCreatingOpportunity(false);
                    setEditingOpportunityId(null);
                  }}
                >
                  <OpportunityForm
                    id="customer-opportunity-editor-form"
                    opportunity={editingOpportunity}
                    onSave={(input) => saveOpportunity(input, editingOpportunity?.id)}
                    onCanSaveChange={setOpportunityCanSave}
                  />
                </RightSideEditor>
              )}
              {activeTab === "contacts" && (
                <div className={stylex(styles.section)} role="tabpanel">
                  <h4>Addresses</h4>
                  {detail.addresses.map((x) => (
                    <p key={String(x.id)}>
                      {String(x.address_type)}: {String(x.line1 || "")}, {String(x.city || "")}
                    </p>
                  ))}
                </div>
              )}
              {activeTab === "summary" && (
                <div className={stylex(styles.section)} role="tabpanel">
                  {(detail.emailNoteCandidates?.length ?? 0) > 0 && (
                    <section aria-label="Email note suggestions">
                      <h4>
                        Email note suggestions
                        <span className={stylex(styles.tabBadge)}>
                          {detail.emailNoteCandidates?.length ?? 0}
                        </span>
                      </h4>
                      <p className={stylex(styles.muted)}>
                        Review information extracted from forwarded customer emails before it is
                        added to Notes.
                      </p>
                      {(detail.emailNoteCandidates ?? []).map((candidate) => (
                        <article key={candidate.id} className={stylex(styles.note)}>
                          <b>{candidate.proposed_subject}</b>
                          <div className={stylex(styles.muted)}>
                            {candidate.category === "email_summary"
                              ? "Complete email summary"
                              : candidate.category}{" "}
                            · {Math.round(candidate.confidence * 100)}% confidence
                            {candidate.original_sender_email
                              ? ` · from ${candidate.original_sender_name || candidate.original_sender_email}`
                              : ""}
                            {candidate.attachment_count
                              ? ` · ${candidate.attachment_count} attachment${candidate.attachment_count === 1 ? "" : "s"}`
                              : ""}
                            {candidate.email_sent_at
                              ? ` · sent ${new Date(candidate.email_sent_at).toLocaleDateString()}`
                              : ""}
                          </div>
                          <div className={stylex(styles.markdown)}>
                            <Markdown>{candidate.proposed_body}</Markdown>
                          </div>
                          {candidate.evidence && (
                            <p className={stylex(styles.muted)}>Evidence: {candidate.evidence}</p>
                          )}
                          <div className={stylex(styles.actions)}>
                            <button
                              type="button"
                              disabled={reviewingEmailCandidateId === candidate.id}
                              onClick={() => void reviewEmailCandidate(candidate.id, "apply")}
                            >
                              Apply to notes
                            </button>
                            <button
                              type="button"
                              disabled={reviewingEmailCandidateId === candidate.id}
                              onClick={() => void reviewEmailCandidate(candidate.id, "dismiss")}
                            >
                              Dismiss
                            </button>
                          </div>
                        </article>
                      ))}
                    </section>
                  )}
                  <div className={stylex(styles.actions)}>
                    <h4>Recent notes</h4>
                    <Button variant="primary" icon="add" onPress={openNoteEditor}>
                      Add note
                    </Button>
                  </div>
                  {!detail.activities.some((activity) => activity.activity_type === "note") && (
                    <p className={stylex(styles.muted)}>No notes yet.</p>
                  )}
                  {recentCustomerNotes(
                    detail.activities,
                    noteUploads
                      .filter((upload) => upload.customerId === customerId)
                      .map((upload) => upload.noteId)
                  ).map((activity) => (
                    <article
                      key={activity.id}
                      ref={activity.id === noteReceipt?.noteId ? latestNoteRef : undefined}
                      className={stylex(styles.note)}
                    >
                      <b>{activity.subject}</b>
                      {noteFeedback(activity.id)}
                      <div className={stylex(styles.muted)}>
                        {activity.created_by ? `by ${activity.created_by} · ` : ""}
                        {formatDateTime(activity.occurred_at)}
                      </div>
                      {activity.body && (
                        <div className={stylex(styles.markdown)}>
                          <Markdown>{activity.body}</Markdown>
                        </div>
                      )}
                      {detail.files
                        .filter((file) => file.activity_id === activity.id && !file.deprecated_at)
                        .map((file) => (
                          <CustomerFileLink key={file.id} file={file} compact />
                        ))}
                    </article>
                  ))}
                </div>
              )}
              {activeTab === "files" && (
                <div className={stylex(styles.section)} role="tabpanel">
                  <h4>Files</h4>
                  {detail.files.filter((file) => !file.deprecated_at).length === 0 && (
                    <p className={stylex(styles.muted)}>No current files.</p>
                  )}
                  {detail.files
                    .filter((file) => !file.deprecated_at)
                    .map((file) => (
                      <CustomerFileRow
                        key={file.id}
                        file={file}
                        onDeprecated={() => toggleFileDeprecated(file.id, true)}
                      />
                    ))}
                  {detail.files.some((file) => file.deprecated_at) && (
                    <details>
                      <summary>Deprecated files</summary>
                      {detail.files
                        .filter((file) => file.deprecated_at)
                        .map((file) => (
                          <CustomerFileRow
                            key={file.id}
                            file={file}
                            onDeprecated={() => toggleFileDeprecated(file.id, false)}
                            deprecated
                          />
                        ))}
                    </details>
                  )}
                </div>
              )}
              {activeTab === "activity" && (
                <div className={stylex(styles.section)} role="tabpanel">
                  <h4>Activity</h4>
                  <Button variant="primary" icon="add" onPress={openNoteEditor}>
                    Add note
                  </Button>
                  {detail.activities.map((activity) => (
                    <article
                      key={activity.id}
                      ref={activity.id === noteReceipt?.noteId ? latestNoteRef : undefined}
                      className={stylex(styles.note)}
                    >
                      <b>{activity.subject}</b> {noteFeedback(activity.id)}
                      <span className={stylex(styles.muted)}>
                        {activity.created_by ? `by ${activity.created_by} · ` : ""}
                        {activity.occurred_at}
                      </span>
                      {activity.body && (
                        <div className={stylex(styles.markdown)}>
                          <Markdown>{activity.body}</Markdown>
                        </div>
                      )}
                      {activity.activity_type === "note" && (
                        <div className={stylex(styles.actions)}>
                          {detail.files
                            .filter(
                              (file) => file.activity_id === activity.id && !file.deprecated_at
                            )
                            .map((file) => (
                              <CustomerFileLink key={file.id} file={file} compact />
                            ))}
                        </div>
                      )}
                    </article>
                  ))}
                </div>
              )}
              {activeTab === "quickbooks" && (
                <>
                  <div className={stylex(styles.section)} role="tabpanel">
                    <h4>QuickBooks fields</h4>
                    <p>State: {detail.customer.quickbooks_sync_status}</p>
                    <p>Last sync: {detail.customer.last_synced_at || "Never"}</p>
                    {detail.customer.last_error && (
                      <p className={stylex(styles.error)}>{detail.customer.last_error}</p>
                    )}
                  </div>
                  <Financial title="Estimates" rows={detail.estimates} />
                  <Financial title="Invoices" rows={detail.invoices} />
                  <div className={stylex(styles.section)}>
                    <h4>QuickBooks synchronization</h4>
                    <input
                      placeholder="Integration ID"
                      value={integrationId}
                      onChange={(e) => setIntegrationId(e.target.value)}
                    />
                    <div className={stylex(styles.actions)}>
                      <button onClick={findMatches}>Find matches</button>
                      <button onClick={() => action("create")}>Create in QuickBooks</button>
                      <button onClick={() => action("refresh")}>Refresh</button>
                      <button onClick={() => action("retry")}>Retry failed sync</button>
                    </div>
                    {matches.map((m) => (
                      <p key={m.id}>
                        {m.displayName}{" "}
                        <button onClick={() => action("link", { externalId: m.id })}>
                          Confirm link
                        </button>
                      </p>
                    ))}
                  </div>
                </>
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
    <div aria-label="Loading customer details" role="status">
      <div className={stylex(styles.glimmer, styles.detailGlimmerHeader)} />
      <div className={stylex(styles.glimmer, styles.detailGlimmerTabs)} />
      <div className={stylex(styles.grid)}>
        <div className={stylex(styles.glimmer, styles.detailGlimmerCard)} />
        <div className={stylex(styles.glimmer, styles.detailGlimmerCard)} />
      </div>
    </div>
  );
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
    <article className={stylex(styles.note)}>
      <CustomerFileLink file={file} />
      <div className={stylex(styles.muted)}>
        {formatFileSize(file.size_bytes)} · attached to “{file.note_subject}” · {file.created_at}
      </div>
      <div className={stylex(styles.actions)}>
        <button onClick={onDeprecated}>{deprecated ? "Restore" : "Mark deprecated"}</button>
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
      <textarea
        aria-label="Opportunity description"
        className={stylex(styles.textarea)}
        placeholder="Describe the opportunity"
        required
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />
      <select aria-label="Opportunity type" value={type} onChange={(e) => setType(e.target.value)}>
        <option value="furniture">furniture</option>
        <option value="cabinets">cabinets</option>
        <option value="other">other</option>
      </select>
      <input
        aria-label="Opportunity budget"
        type="number"
        min="0"
        step="0.01"
        placeholder="Budget"
        required
        value={budget}
        onChange={(e) => setBudget(e.target.value)}
      />
      <select
        aria-label="Opportunity status"
        value={status}
        onChange={(e) => setStatus(e.target.value)}
      >
        <option value="scoping">scoping</option>
        <option value="quoted">quoted</option>
        <option value="accepted">accepted</option>
        <option value="lost">lost</option>
      </select>
    </form>
  );
}
function formatBudget(cents: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}
function PhoneLink({ phone }: { phone: string | null | undefined }) {
  const formatted = formatPhoneNumber(phone);
  if (!formatted || !phone) return <>No phone</>;
  return <a href={`tel:${phone.trim()}`}>{formatted}</a>;
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
      <label>
        Name
        <input
          aria-label="Customer name"
          required
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
        />
      </label>
      <label>
        Status
        <select
          aria-label="Edit customer status"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          {["lead", "active", "completed", "archived"].map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </label>
      <label>
        Lead source
        <input
          aria-label="Lead source"
          value={leadSource}
          onChange={(e) => setLeadSource(e.target.value)}
        />
      </label>
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
      <input
        aria-label="First name"
        placeholder="First name"
        value={firstName}
        onChange={(e) => setFirstName(e.target.value)}
      />
      <input
        aria-label="Last name"
        placeholder="Last name"
        value={lastName}
        onChange={(e) => setLastName(e.target.value)}
      />
      <input
        aria-label="Email"
        placeholder="Email"
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <input
        aria-label="Phone"
        placeholder="Phone"
        type="tel"
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
      />
      <input
        aria-label="Role"
        placeholder="Role"
        value={role}
        onChange={(e) => setRole(e.target.value)}
      />
      <select
        aria-label="Marketing email"
        value={permission}
        onChange={(e) => setPermission(e.target.value as typeof permission)}
      >
        <option value="unknown">Marketing email: Unknown</option>
        <option value="allowed">Marketing email: Allowed</option>
        <option value="not_allowed">Marketing email: Not allowed</option>
      </select>
      <select
        aria-label="Contact status"
        value={status}
        onChange={(e) => setStatus(e.target.value)}
      >
        <option value="active">active</option>
        <option value="inactive">inactive</option>
        {contact && <option value="archived">archived</option>}
      </select>
      <label className={stylex(styles.check)}>
        <input
          type="checkbox"
          checked={isPrimary}
          onChange={(e) => setIsPrimary(e.target.checked)}
        />{" "}
        Primary contact
      </label>
    </form>
  );
}
function Financial({ title, rows }: { title: string; rows: Array<Record<string, unknown>> }) {
  return (
    <div className={stylex(styles.section)}>
      <h4>
        {title} <small>(read-only from QuickBooks)</small>
      </h4>
      <table className={stylex(styles.table)}>
        <thead>
          <tr>
            <th className={stylex(styles.cell)}>Number</th>
            <th className={stylex(styles.cell)}>Status</th>
            <th className={stylex(styles.cell)}>Total</th>
            <th className={stylex(styles.cell)}>Balance</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((x) => (
            <tr key={String(x.id)}>
              <td className={stylex(styles.cell)}>{String(x.doc_number || "—")}</td>
              <td className={stylex(styles.cell)}>{String(x.status || "—")}</td>
              <td className={stylex(styles.cell)}>${Number(x.total || 0).toFixed(2)}</td>
              <td className={stylex(styles.cell)}>
                {x.balance == null ? "—" : `$${Number(x.balance).toFixed(2)}`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
