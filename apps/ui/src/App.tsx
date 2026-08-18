"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { NavLink, Outlet, useLocation, useNavigate, useParams } from "react-router";
import stylex from "~/lib/stylex";
import { colors, spacing, radius } from "./theme/tokens.stylex";
import { buildUrl, fetchJson, fetchMe, setDebugEmailHeader } from "./lib/api";
import { DevMigrationBanner } from "./components/DevMigrationBanner";
import { JsonView } from "./components/JsonView";
import { DemoPanel } from "./features/demo/DemoPanel";
import { ContextViewer } from "./features/planPreview/ContextViewer";
import { RecordSidebar } from "./features/planPreview/RecordSidebar";
import { ProjectsPanel } from "./features/projects/ProjectsPanel";
import { TemplatesPanel } from "./features/templates/TemplatesPanel";
import { createProjectFromRecord, materializeProject } from "./features/projects/api";
import { IntegrationsPanel } from "./features/integrations/IntegrationsPanel";
import { IngestPanel } from "./features/ingest/IngestPanel";
import { listWorkspaces, type WorkspaceRow } from "./features/workspaces/api";
import { WorkspacesPanel } from "./features/workspaces/WorkspacesPanel";
import { TasksBoard } from "./features/tasks/TasksBoard";
import { UsersPanel } from "./features/users/UsersPanel";
import { CustomersPanel } from "./features/customers/CustomersPanel";
import { getPreferences, setPreference, type UserPreferences } from "./features/preferences/api";

const EXAMPLE_URIS = ["manual://proposal/demo", "shopify://order/example", "qbo://invoice/example"];

const styles = stylex.create({
  app: {
    minHeight: "100vh",
    backgroundColor: colors.background,
    color: colors.text,
    fontFamily: '"IBM Plex Sans", "Segoe UI", system-ui, -apple-system, sans-serif',
  },
  appShell: {
    display: "grid",
    gridTemplateColumns: "240px minmax(0, 1fr)",
    minHeight: "100vh",
    "@media (max-width: 760px)": {
      gridTemplateColumns: "1fr",
    },
  },
  appShellCollapsed: {
    gridTemplateColumns: "64px minmax(0, 1fr)",
    "@media (max-width: 760px)": {
      gridTemplateColumns: "1fr",
    },
  },
  sidebar: {
    position: "sticky",
    top: 0,
    height: "100vh",
    display: "flex",
    flexDirection: "column",
    borderRight: `1px solid ${colors.border}`,
    backgroundColor: colors.surface,
    overflow: "hidden",
    "@media (max-width: 760px)": {
      position: "fixed",
      zIndex: 30,
      inset: "0 auto 0 0",
      width: "min(86vw, 320px)",
      height: "100vh",
      borderRight: `1px solid ${colors.border}`,
      transform: "translateX(-100%)",
      transition: "transform 180ms ease",
      boxShadow: "0 18px 40px rgba(47, 33, 24, 0.2)",
    },
  },
  sidebarMobileOpen: {
    "@media (max-width: 760px)": {
      transform: "translateX(0)",
    },
  },
  mainContent: {
    minWidth: 0,
  },
  appHeader: {
    display: "flex",
    flexDirection: "column",
    flexShrink: 0,
    gap: spacing.lg,
    padding: "24px 20px 18px",
    borderBottom: `1px solid ${colors.border}`,
  },
  appHeaderCollapsed: {
    display: "none",
    "@media (max-width: 760px)": {
      display: "flex",
    },
  },
  desktopRailToggle: {
    margin: "12px 12px 0",
    minHeight: "36px",
    border: `1px solid ${colors.border}`,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceAlt,
    color: colors.text,
    cursor: "pointer",
    "@media (max-width: 760px)": {
      display: "none",
    },
  },
  mobileTopbar: {
    display: "none",
    "@media (max-width: 760px)": {
      position: "sticky",
      top: 0,
      zIndex: 20,
      display: "flex",
      alignItems: "center",
      gap: spacing.md,
      minHeight: "56px",
      padding: "8px 16px",
      borderBottom: `1px solid ${colors.border}`,
      backgroundColor: colors.surface,
    },
  },
  hamburgerButton: {
    width: "40px",
    height: "40px",
    border: `1px solid ${colors.border}`,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceAlt,
    color: colors.text,
    cursor: "pointer",
    fontSize: "22px",
    lineHeight: 1,
  },
  mobileBrand: {
    fontWeight: 600,
    fontSize: "18px",
  },
  mobileCloseRow: {
    display: "none",
    "@media (max-width: 760px)": {
      display: "flex",
      justifyContent: "flex-end",
      padding: "12px 12px 0",
    },
  },
  mobileOverlay: {
    display: "none",
    "@media (max-width: 760px)": {
      position: "fixed",
      zIndex: 25,
      inset: 0,
      display: "block",
      border: 0,
      backgroundColor: "rgba(47, 33, 24, 0.28)",
    },
  },
  headerControls: {
    display: "flex",
    gap: "16px",
    flexDirection: "column",
    alignItems: "stretch",
  },
  workspaceSelect: {
    display: "flex",
    flexDirection: "column",
    gap: "6px",
  },
  devIdentity: {
    display: "flex",
    flexDirection: "column",
    gap: "6px",
  },
  tabs: {
    display: "flex",
    flexDirection: "column",
    flex: 1,
    minHeight: 0,
    overflowY: "auto",
    gap: spacing.sm,
    padding: "16px 12px",
  },
  tabsCollapsed: {
    padding: "16px 8px",
    alignItems: "center",
    "@media (max-width: 760px)": {
      padding: "16px 12px",
      alignItems: "stretch",
    },
  },
  logoutSection: {
    flexShrink: 0,
    marginTop: "auto",
    padding: "16px 12px",
    borderTop: `1px solid ${colors.border}`,
  },
  logoutSectionCollapsed: {
    padding: "16px 8px",
    display: "flex",
    justifyContent: "center",
    "@media (max-width: 760px)": {
      padding: "16px 12px",
      display: "block",
    },
  },
  tabButton: {
    border: `1px solid ${colors.border}`,
    backgroundColor: colors.surfaceAlt,
    color: colors.textMuted,
    padding: "8px 14px",
    borderRadius: "8px",
    cursor: "pointer",
    fontSize: "13px",
    textDecoration: "none",
    width: "100%",
    boxSizing: "border-box",
  },
  tabButtonActive: {
    backgroundColor: colors.accent,
    color: colors.surface,
    borderColor: colors.accent,
  },
  tabButtonCollapsed: {
    width: "40px",
    minWidth: "40px",
    padding: "9px 0",
    textAlign: "center",
    fontWeight: 600,
    "@media (max-width: 760px)": {
      width: "100%",
      padding: "8px 14px",
      textAlign: "left",
    },
  },
  tabLabelCollapsed: {
    display: "none",
    "@media (max-width: 760px)": {
      display: "inline",
    },
  },
  tabInitial: {
    display: "none",
  },
  tabInitialVisible: {
    display: "inline",
    "@media (max-width: 760px)": {
      display: "none",
    },
  },
  panel: {
    padding: "24px 32px",
  },
  previewLayout: {
    display: "grid",
    gridTemplateColumns: "280px 1fr",
    gap: "24px",
    alignItems: "flex-start",
  },
  previewMain: {
    display: "flex",
    flexDirection: "column",
    gap: "16px",
  },
  formRow: {
    display: "flex",
    flexDirection: "column",
    gap: "6px",
  },
  exampleRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: "8px",
  },
  actions: {
    display: "flex",
    flexWrap: "wrap",
    gap: "8px",
    alignItems: "center",
  },
  secondaryButton: {
    border: `1px solid ${colors.border}`,
    backgroundColor: colors.surface,
    color: colors.text,
    padding: "8px 12px",
    borderRadius: radius.sm,
    cursor: "pointer",
  },
  checkbox: {
    display: "inline-flex",
    gap: "6px",
    alignItems: "center",
  },
  urlHint: {
    fontSize: "12px",
    color: colors.textMuted,
  },
  highlight: {
    padding: "12px 14px",
    borderRadius: radius.md,
    backgroundColor: colors.surfaceAlt,
    border: `1px solid ${colors.border}`,
  },
  highlightWarning: {
    backgroundColor: colors.warnBg,
    borderColor: colors.warnText,
  },
  results: {
    display: "flex",
    flexDirection: "column",
    gap: "12px",
  },
  error: {
    color: colors.errorText,
  },
  meta: {
    display: "flex",
    flexWrap: "wrap",
    gap: "12px",
    fontSize: "12px",
    color: colors.textSubtle,
  },
  metaText: {
    fontSize: "14px",
    lineHeight: "1.5",
    color: colors.textMuted,
  },
  jsonBlock: {
    border: `1px solid ${colors.border}`,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    overflow: "hidden",
  },
  jsonHeader: {
    padding: "10px 14px",
    borderBottom: `1px solid ${colors.border}`,
    backgroundColor: colors.surfaceAlt,
    fontSize: "12px",
    textTransform: "uppercase",
    letterSpacing: "0.08em",
  },
  tableWrap: {
    border: `1px solid ${colors.border}`,
    borderRadius: radius.md,
    overflowX: "auto",
  },
  empty: {
    color: colors.textSubtle,
  },
  divider: {
    height: "1px",
    backgroundColor: colors.border,
    margin: "12px 0",
  },
  panelSub: {
    marginTop: "16px",
  },
  formGrid: {
    display: "grid",
    gap: "12px",
  },
  fullWidth: {
    gridColumn: "1 / -1",
  },
});

type PlanPreviewState = {
  status?: number;
  url?: string;
  durationMs?: number;
  data?: unknown;
  text?: string;
  error?: string;
};

type EventsState = {
  status?: number;
  url?: string;
  durationMs?: number;
  data?: unknown;
  text?: string;
  error?: string;
};

type EventsTestState = {
  status?: number;
  url?: string;
  durationMs?: number;
  data?: unknown;
  text?: string;
  error?: string;
};

type ActorInfo = {
  email: string;
  isSystemAdmin: boolean;
  workspaceIds: string[];
  workspaceAdminIds: string[];
};

type AppContextValue = {
  recordUri: string;
  setRecordUri: (value: string) => void;
  autoRunOnSelect: boolean;
  setAutoRunOnSelect: (value: boolean) => void;
  previewState: PlanPreviewState;
  previewLoading: boolean;
  materializeMessage: string | null;
  materializeLoading: boolean;
  runPreview: (nextUri?: string) => Promise<void>;
  materializeTasks: () => Promise<void>;
  previewUrl: string;
  planId?: string;
  warnings?: string[];
  contextLookup: Record<string, { title?: string | null }>;
  eventsState: EventsState;
  eventsLoading: boolean;
  refreshEvents: () => Promise<void>;
  expandedRowIndex: number | null;
  setExpandedRowIndex: (value: number | null) => void;
  events: unknown[];
  testSource: string;
  setTestSource: (value: string) => void;
  testType: string;
  setTestType: (value: string) => void;
  testExternalId: string;
  setTestExternalId: (value: string) => void;
  testPayload: string;
  setTestPayload: (value: string) => void;
  testState: EventsTestState;
  testLoading: boolean;
  runEventsTest: () => Promise<void>;
  idempotencyKey?: string;
  copyToClipboard: (label: string, value: string) => Promise<void>;
  selectedProjectId: string | null;
  setSelectedProjectId: (value: string | null) => void;
  debugEmail: string;
  setDebugEmail: (value: string) => void;
  workspaces: WorkspaceRow[];
  workspaceLoading: boolean;
  selectedWorkspaceId: string | null;
  setSelectedWorkspaceId: (value: string | null) => void;
  actor: ActorInfo | null;
  actorLoading: boolean;
  userPreferences: UserPreferences;
  updateUserPreference: (
    key: keyof UserPreferences,
    value: UserPreferences[keyof UserPreferences]
  ) => void;
};

const AppContext = createContext<AppContextValue | null>(null);

export function useAppState(): AppContextValue {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error("useAppState must be used within AppContext provider.");
  }
  return context;
}

export default function App(): JSX.Element {
  const navigate = useNavigate();
  const location = useLocation();

  const [recordUri, setRecordUri] = useState<string>("");
  const [autoRunOnSelect, setAutoRunOnSelect] = useState<boolean>(true);

  const [previewState, setPreviewState] = useState<PlanPreviewState>({});
  const [previewLoading, setPreviewLoading] = useState(false);
  const [materializeMessage, setMaterializeMessage] = useState<string | null>(null);
  const [materializeLoading, setMaterializeLoading] = useState(false);

  const [eventsState, setEventsState] = useState<EventsState>({});
  const [eventsLoading, setEventsLoading] = useState(false);
  const [expandedRowIndex, setExpandedRowIndex] = useState<number | null>(null);

  const [testSource, setTestSource] = useState("manual");
  const [testType, setTestType] = useState("preview");
  const [testExternalId, setTestExternalId] = useState("example-1");
  const [testPayload, setTestPayload] = useState('{\n  "hello": "world"\n}');
  const [testState, setTestState] = useState<EventsTestState>({});
  const [testLoading, setTestLoading] = useState(false);

  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [debugEmail, setDebugEmail] = useState<string>("");
  const [workspaces, setWorkspaces] = useState<WorkspaceRow[]>([]);
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(null);
  const [actor, setActor] = useState<ActorInfo | null>(null);
  const [actorLoading, setActorLoading] = useState(false);
  const [userPreferences, setUserPreferences] = useState<UserPreferences>({});
  const [railCollapsed, setRailCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    setDebugEmailHeader(debugEmail);
  }, [debugEmail]);

  const refreshWorkspaces = useCallback(async () => {
    setWorkspaceLoading(true);
    const result = await listWorkspaces();
    if (result.ok && result.data) {
      setWorkspaces(result.data);
      const exists = selectedWorkspaceId
        ? result.data.some((workspace) => workspace.id === selectedWorkspaceId)
        : false;
      if (!exists) {
        const fallback =
          result.data.find((workspace) => workspace.slug === "default") ?? result.data[0];
        setSelectedWorkspaceId(fallback?.id ?? null);
      }
    }
    setWorkspaceLoading(false);
  }, [selectedWorkspaceId]);

  const refreshActor = useCallback(async () => {
    setActorLoading(true);
    const [actorResult, preferenceResult] = await Promise.all([fetchMe(), getPreferences()]);
    if (actorResult.ok && actorResult.data) {
      setActor(actorResult.data);
      const preferences = preferenceResult.ok ? (preferenceResult.data ?? {}) : {};
      setUserPreferences(preferences);
      setRailCollapsed(preferences.left_rail_collapsed ?? false);
    } else {
      setActor(null);
      setUserPreferences({});
      setRailCollapsed(false);
    }
    setActorLoading(false);
  }, []);

  const updateUserPreference = useCallback(
    (key: keyof UserPreferences, value: UserPreferences[keyof UserPreferences]) => {
      setUserPreferences((current) => ({ ...current, [key]: value }));
      void setPreference(key, value);
    },
    []
  );

  useEffect(() => {
    void refreshWorkspaces();
  }, [refreshWorkspaces, debugEmail]);

  useEffect(() => {
    void refreshActor();
  }, [refreshActor, debugEmail]);

  const previewUrl = useMemo(() => {
    if (!recordUri.trim()) return "";
    return buildUrl("/plan/preview", { record_uri: recordUri.trim() });
  }, [recordUri]);

  const contextLookup = useMemo(() => {
    if (!previewState.data || typeof previewState.data !== "object") {
      return {};
    }
    const contexts = (
      previewState.data as {
        contexts?: { deliverables?: Array<{ key: string; title?: string | null }> };
      }
    ).contexts;
    const deliverables = contexts?.deliverables ?? [];
    return deliverables.reduce<Record<string, { title?: string | null }>>((acc, deliverable) => {
      if (deliverable?.key) {
        acc[deliverable.key] = { title: deliverable.title ?? null };
      }
      return acc;
    }, {});
  }, [previewState.data]);

  async function runPreview(nextUri?: string): Promise<void> {
    const targetUri = (nextUri ?? recordUri).trim();
    if (!targetUri) {
      setPreviewState({ error: "Record URI is required." });
      return;
    }

    if (nextUri !== undefined) {
      setRecordUri(nextUri);
    }

    const url = buildUrl("/plan/preview", { record_uri: targetUri });
    setPreviewLoading(true);
    setPreviewState({ url });

    try {
      const result = await fetchJson(url, { method: "GET" });
      setPreviewState({
        url,
        status: result.status,
        durationMs: result.durationMs,
        data: result.data ?? undefined,
        text: result.text,
        error: !result.ok
          ? `Request failed with status ${result.status}.`
          : result.data === null && result.text
            ? "Response was not valid JSON."
            : undefined,
      });
    } catch (error) {
      setPreviewState({
        url,
        error: error instanceof Error ? error.message : "Failed to fetch preview.",
      });
    } finally {
      setPreviewLoading(false);
    }
  }

  async function materializeTasks(): Promise<void> {
    const uri = recordUri.trim();
    if (!uri) {
      setMaterializeMessage("Record URI is required.");
      return;
    }
    setMaterializeLoading(true);
    setMaterializeMessage(null);

    try {
      const projectResult = await createProjectFromRecord(uri, selectedWorkspaceId);
      if (!projectResult.ok || !projectResult.data) {
        setMaterializeMessage(projectResult.text || "Failed to create project.");
        return;
      }

      const projectId = projectResult.data.project.id;
      const materializeResult = await materializeProject(projectId);
      if (!materializeResult.ok || !materializeResult.data) {
        setMaterializeMessage(materializeResult.text || "Failed to materialize tasks.");
        return;
      }

      const { alreadyMaterialized, tasksCreated } = materializeResult.data;
      setMaterializeMessage(
        alreadyMaterialized
          ? "Already materialized (no changes)."
          : `Created ${tasksCreated} tasks.`
      );
      setSelectedProjectId(projectId);
      navigate("/projects");
    } catch (error) {
      setMaterializeMessage(error instanceof Error ? error.message : "Materialize failed.");
    } finally {
      setMaterializeLoading(false);
    }
  }

  async function refreshEvents(): Promise<void> {
    const url = buildUrl("/events");
    setEventsLoading(true);
    setEventsState({ url });
    setExpandedRowIndex(null);

    try {
      const result = await fetchJson(url, { method: "GET", credentials: "include" });
      setEventsState({
        url,
        status: result.status,
        durationMs: result.durationMs,
        data: result.data ?? undefined,
        text: result.text,
        error: !result.ok
          ? `Request failed with status ${result.status}.`
          : result.data === null && result.text
            ? "Response was not valid JSON."
            : undefined,
      });
    } catch (error) {
      setEventsState({
        url,
        error: error instanceof Error ? error.message : "Failed to load events.",
      });
    } finally {
      setEventsLoading(false);
    }
  }

  async function runEventsTest(): Promise<void> {
    const url = buildUrl("/events/test");
    setTestLoading(true);
    setTestState({ url });

    let payload: unknown;
    try {
      payload = testPayload.trim() ? JSON.parse(testPayload) : {};
    } catch (error) {
      setTestState({
        url,
        error: "Payload must be valid JSON.",
      });
      setTestLoading(false);
      return;
    }

    try {
      const result = await fetchJson(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          source: testSource,
          type: testType,
          externalId: testExternalId,
          payload,
        }),
      });

      setTestState({
        url,
        status: result.status,
        durationMs: result.durationMs,
        data: result.data ?? undefined,
        text: result.text,
        error: !result.ok
          ? `Request failed with status ${result.status}.`
          : result.data === null && result.text
            ? "Response was not valid JSON."
            : undefined,
      });
    } catch (error) {
      setTestState({
        url,
        error: error instanceof Error ? error.message : "Failed to post test event.",
      });
    } finally {
      setTestLoading(false);
    }
  }

  const planId =
    typeof previewState.data === "object" && previewState.data
      ? (previewState.data as { plan_id?: string }).plan_id
      : undefined;

  const warnings =
    typeof previewState.data === "object" && previewState.data
      ? (previewState.data as { warnings?: string[] }).warnings
      : undefined;

  const isSystemAdmin = actor?.isSystemAdmin ?? false;
  const isWorkspaceAdmin = Boolean(
    isSystemAdmin || (selectedWorkspaceId && actor?.workspaceAdminIds.includes(selectedWorkspaceId))
  );
  const isWorkspaceMember = Boolean(
    isSystemAdmin || (selectedWorkspaceId && actor?.workspaceIds.includes(selectedWorkspaceId))
  );

  const idempotencyKey =
    typeof testState.data === "object" && testState.data
      ? (testState.data as { idempotencyKey?: string; idempotency_key?: string }).idempotencyKey ||
        (testState.data as { idempotencyKey?: string; idempotency_key?: string }).idempotency_key
      : undefined;

  const events: unknown[] = Array.isArray(eventsState.data)
    ? eventsState.data
    : Array.isArray((eventsState.data as { events?: unknown[] } | undefined)?.events)
      ? ((eventsState.data as { events?: unknown[] }).events ?? [])
      : [];

  async function copyToClipboard(label: string, value: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
      alert(`${label} copied to clipboard.`);
    } catch (error) {
      alert("Copy failed. Please copy manually.");
    }
  }

  const appContextValue: AppContextValue = {
    recordUri,
    setRecordUri,
    autoRunOnSelect,
    setAutoRunOnSelect,
    previewState,
    previewLoading,
    materializeMessage,
    materializeLoading,
    runPreview,
    materializeTasks,
    previewUrl,
    planId,
    warnings,
    contextLookup,
    eventsState,
    eventsLoading,
    refreshEvents,
    expandedRowIndex,
    setExpandedRowIndex,
    events,
    testSource,
    setTestSource,
    testType,
    setTestType,
    testExternalId,
    setTestExternalId,
    testPayload,
    setTestPayload,
    testState,
    testLoading,
    runEventsTest,
    idempotencyKey,
    copyToClipboard,
    selectedProjectId,
    setSelectedProjectId,
    debugEmail,
    setDebugEmail,
    workspaces,
    workspaceLoading,
    selectedWorkspaceId,
    setSelectedWorkspaceId,
    actor,
    actorLoading,
    userPreferences,
    updateUserPreference,
  };

  return (
    <AppContext.Provider value={appContextValue}>
      <div className={stylex(styles.app)}>
        <div className={stylex(styles.appShell, railCollapsed && styles.appShellCollapsed)}>
          {mobileMenuOpen && (
            <button
              type="button"
              data-button-layout="overlay"
              className={stylex(styles.mobileOverlay)}
              aria-label="Close navigation menu"
              onClick={() => setMobileMenuOpen(false)}
            />
          )}
          <aside
            id="app-navigation"
            className={stylex(styles.sidebar, mobileMenuOpen && styles.sidebarMobileOpen)}
          >
            <div className={stylex(styles.mobileCloseRow)}>
              <button
                type="button"
                className={stylex(styles.hamburgerButton)}
                aria-label="Close navigation menu"
                onClick={() => setMobileMenuOpen(false)}
              >
                ×
              </button>
            </div>
            <button
              type="button"
              className={stylex(styles.desktopRailToggle)}
              aria-label={railCollapsed ? "Expand navigation" : "Minimize navigation"}
              aria-expanded={!railCollapsed}
              onClick={() => {
                const next = !railCollapsed;
                setRailCollapsed(next);
                updateUserPreference("left_rail_collapsed", next);
              }}
            >
              {railCollapsed ? "›" : "‹ Minimize"}
            </button>
            <header
              className={stylex(styles.appHeader, railCollapsed && styles.appHeaderCollapsed)}
            >
              <div>
                <h1>ftops</h1>
                <p>Operations</p>
              </div>
              <div className={stylex(styles.headerControls)}>
                <div className={stylex(styles.workspaceSelect)}>
                  <label htmlFor="workspace-select">Workspace</label>
                  <select
                    id="workspace-select"
                    value={selectedWorkspaceId ?? ""}
                    onChange={(event) => setSelectedWorkspaceId(event.target.value)}
                    disabled={workspaceLoading}
                  >
                    {workspaces.map((workspace) => (
                      <option key={workspace.id} value={workspace.id}>
                        {workspace.name}
                      </option>
                    ))}
                  </select>
                </div>
                {import.meta.env.DEV && (
                  <div className={stylex(styles.devIdentity)}>
                    <label htmlFor="debug-email">Dev identity</label>
                    <input
                      id="debug-email"
                      type="email"
                      placeholder="you@example.com"
                      value={debugEmail}
                      onChange={(event) => setDebugEmail(event.target.value)}
                    />
                  </div>
                )}
              </div>
            </header>

            <nav className={stylex(styles.tabs, railCollapsed && styles.tabsCollapsed)}>
              {isSystemAdmin && (
                <AppNavLink to="/plan-preview" label="Plan Preview" collapsed={railCollapsed} />
              )}
              {isSystemAdmin && (
                <AppNavLink to="/events" label="Events Viewer" collapsed={railCollapsed} />
              )}
              {isSystemAdmin && <AppNavLink to="/demo" label="Demo" collapsed={railCollapsed} />}
              {isWorkspaceAdmin && (
                <AppNavLink to="/templates" label="Templates" collapsed={railCollapsed} />
              )}
              {isWorkspaceMember && (
                <AppNavLink to="/customers" label="Customers" collapsed={railCollapsed} />
              )}
              {isWorkspaceMember && (
                <AppNavLink to="/projects" label="Projects" collapsed={railCollapsed} />
              )}
              {isWorkspaceMember && (
                <AppNavLink to="/tasks" label="Tasks" collapsed={railCollapsed} />
              )}
              {isWorkspaceAdmin && (
                <AppNavLink to="/integrations" label="Integrations" collapsed={railCollapsed} />
              )}
              {isWorkspaceAdmin && (
                <AppNavLink to="/ingest" label="Ingest" collapsed={railCollapsed} />
              )}
              {isSystemAdmin && (
                <AppNavLink to="/workspaces" label="Workspaces" collapsed={railCollapsed} />
              )}
              {isWorkspaceAdmin && (
                <AppNavLink to="/users" label="Users" collapsed={railCollapsed} />
              )}
            </nav>
            <div
              className={stylex(
                styles.logoutSection,
                railCollapsed && styles.logoutSectionCollapsed
              )}
            >
              <a
                href="/cdn-cgi/access/logout"
                className={stylex(styles.tabButton, railCollapsed && styles.tabButtonCollapsed)}
                title={railCollapsed ? "Log out" : undefined}
                aria-label={railCollapsed ? "Log out" : undefined}
              >
                <span className={stylex(railCollapsed && styles.tabLabelCollapsed)}>Log out</span>
                <span
                  aria-hidden="true"
                  className={stylex(styles.tabInitial, railCollapsed && styles.tabInitialVisible)}
                >
                  L
                </span>
              </a>
            </div>
          </aside>
          <main className={stylex(styles.mainContent)}>
            <div className={stylex(styles.mobileTopbar)}>
              <button
                type="button"
                className={stylex(styles.hamburgerButton)}
                aria-label="Open navigation menu"
                aria-controls="app-navigation"
                aria-expanded={mobileMenuOpen}
                onClick={() => setMobileMenuOpen(true)}
              >
                ☰
              </button>
              <span className={stylex(styles.mobileBrand)}>ftops</span>
            </div>
            <DevMigrationBanner />
            <Outlet />
          </main>
        </div>
      </div>
    </AppContext.Provider>
  );
}

function AppNavLink({ to, label, collapsed }: { to: string; label: string; collapsed: boolean }) {
  return (
    <NavLink
      className={({ isActive }) =>
        stylex(
          styles.tabButton,
          collapsed && styles.tabButtonCollapsed,
          isActive && styles.tabButtonActive
        )
      }
      to={to}
      title={collapsed ? label : undefined}
      aria-label={collapsed ? label : undefined}
    >
      <span className={stylex(collapsed && styles.tabLabelCollapsed)}>{label}</span>
      <span
        aria-hidden="true"
        className={stylex(styles.tabInitial, collapsed && styles.tabInitialVisible)}
      >
        {label.charAt(0)}
      </span>
    </NavLink>
  );
}

export function PlanPreviewRoute(): JSX.Element {
  const {
    actor,
    actorLoading,
    recordUri,
    setRecordUri,
    autoRunOnSelect,
    setAutoRunOnSelect,
    previewState,
    previewLoading,
    materializeMessage,
    materializeLoading,
    runPreview,
    materializeTasks,
    previewUrl,
    planId,
    warnings,
    copyToClipboard,
  } = useAppState();
  const navigate = useNavigate();
  const { recordUri: recordUriParam } = useParams();
  const lastParamRef = useRef<string | null>(null);

  useEffect(() => {
    if (!recordUriParam) return;
    const decoded = decodeURIComponent(recordUriParam);
    if (decoded && decoded !== recordUri) {
      setRecordUri(decoded);
    }
    if (decoded && autoRunOnSelect && lastParamRef.current !== decoded) {
      lastParamRef.current = decoded;
      void runPreview(decoded);
    }
  }, [autoRunOnSelect, recordUri, recordUriParam, runPreview, setRecordUri]);

  const navigateToRecord = useCallback(
    (nextUri: string, shouldRun: boolean) => {
      const trimmed = nextUri.trim();
      if (!trimmed) return;
      const decodedCurrent = recordUriParam ? decodeURIComponent(recordUriParam) : "";
      setRecordUri(trimmed);
      if (trimmed !== decodedCurrent) {
        navigate(`/plan-preview/${encodeURIComponent(trimmed)}`);
      }
      if (shouldRun) {
        void runPreview(trimmed);
      }
    },
    [navigate, recordUriParam, runPreview, setRecordUri]
  );

  if (actorLoading) {
    return <section className={stylex(styles.panel)}>Loading...</section>;
  }
  if (!actor?.isSystemAdmin) {
    return <NotAuthorized />;
  }

  return (
    <section className={stylex(styles.panel)}>
      <h2>Plan Preview</h2>
      <div className={stylex(styles.previewLayout)}>
        <RecordSidebar
          selectedUri={recordUri}
          onSelect={(uri) => {
            navigateToRecord(uri, autoRunOnSelect);
          }}
        />
        <div className={stylex(styles.previewMain)}>
          <div className={stylex(styles.formRow)}>
            <label htmlFor="record-uri">Record URI</label>
            <input
              id="record-uri"
              type="text"
              value={recordUri}
              onChange={(event) => setRecordUri(event.target.value)}
              placeholder="manual://proposal/demo"
            />
          </div>

          <div className={stylex(styles.exampleRow)}>
            <span>Example URIs:</span>
            {EXAMPLE_URIS.map((uri) => (
              <button key={uri} type="button" onClick={() => navigateToRecord(uri, false)}>
                {uri}
              </button>
            ))}
          </div>

          <div className={stylex(styles.actions)}>
            <button
              type="button"
              onClick={() => {
                void runPreview();
                const trimmed = recordUri.trim();
                if (trimmed) {
                  const decodedCurrent = recordUriParam ? decodeURIComponent(recordUriParam) : "";
                  if (trimmed !== decodedCurrent) {
                    navigate(`/plan-preview/${encodeURIComponent(trimmed)}`);
                  }
                }
              }}
              disabled={previewLoading}
            >
              {previewLoading ? "Running..." : "Run Preview"}
            </button>
            <button
              type="button"
              className={stylex(styles.secondaryButton)}
              onClick={materializeTasks}
              disabled={materializeLoading || !recordUri.trim()}
            >
              {materializeLoading ? "Materializing..." : "Create Project + Materialize Tasks"}
            </button>
            <label className={stylex(styles.checkbox)}>
              <input
                type="checkbox"
                checked={autoRunOnSelect}
                onChange={(event) => setAutoRunOnSelect(event.target.checked)}
              />
              Auto-run on select
            </label>
            {previewUrl && <span className={stylex(styles.urlHint)}>{previewUrl}</span>}
          </div>

          {materializeMessage && (
            <div className={stylex(styles.highlight)}>
              <strong>Materialize:</strong> {materializeMessage}
            </div>
          )}

          <div className={stylex(styles.results)}>
            {previewState.error && <div className={stylex(styles.error)}>{previewState.error}</div>}

            {previewState.status !== undefined && (
              <div className={stylex(styles.meta)}>
                <div>
                  <strong>Status:</strong> {previewState.status}
                </div>
                <div>
                  <strong>Duration:</strong> {previewState.durationMs} ms
                </div>
                <div>
                  <strong>Request URL:</strong> {previewState.url}
                </div>
              </div>
            )}

            {planId && (
              <div className={stylex(styles.highlight)}>
                <div>
                  <strong>plan_id:</strong> {planId}
                </div>
                <button type="button" onClick={() => copyToClipboard("plan_id", planId)}>
                  Copy plan_id
                </button>
              </div>
            )}

            {warnings && warnings.length > 0 && (
              <div className={stylex(styles.highlight, styles.highlightWarning)}>
                <strong>Warnings:</strong>
                <ul>
                  {warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              </div>
            )}

            <ContextViewer data={previewState.data} />

            {previewState.data !== undefined && (
              <div className={stylex(styles.jsonBlock)}>
                <div className={stylex(styles.jsonHeader)}>
                  <strong>Response JSON</strong>
                  <button
                    type="button"
                    onClick={() =>
                      copyToClipboard(
                        "response JSON",
                        previewState.text || JSON.stringify(previewState.data, null, 2)
                      )
                    }
                  >
                    Copy JSON
                  </button>
                </div>
                <JsonView data={previewState.data} />
              </div>
            )}

            {previewState.data === undefined && previewState.text && (
              <div className={stylex(styles.jsonBlock)}>
                <div className={stylex(styles.jsonHeader)}>
                  <strong>Response Text</strong>
                  <button
                    type="button"
                    onClick={() => copyToClipboard("response text", previewState.text || "")}
                  >
                    Copy text
                  </button>
                </div>
                <pre>{previewState.text}</pre>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

export function EventsRoute(): JSX.Element {
  const {
    actor,
    actorLoading,
    eventsState,
    eventsLoading,
    refreshEvents,
    events,
    expandedRowIndex,
    setExpandedRowIndex,
    testSource,
    setTestSource,
    testType,
    setTestType,
    testExternalId,
    setTestExternalId,
    testPayload,
    setTestPayload,
    testState,
    testLoading,
    runEventsTest,
    idempotencyKey,
    copyToClipboard,
  } = useAppState();

  if (actorLoading) {
    return <section className={stylex(styles.panel)}>Loading...</section>;
  }
  if (!actor?.isSystemAdmin) {
    return <NotAuthorized />;
  }

  return (
    <section className={stylex(styles.panel)}>
      <h2>Events Viewer</h2>
      <div className={stylex(styles.actions)}>
        <button type="button" onClick={refreshEvents} disabled={eventsLoading}>
          {eventsLoading ? "Refreshing..." : "Refresh"}
        </button>
        {eventsState.url && <span className={stylex(styles.urlHint)}>{eventsState.url}</span>}
      </div>

      <div className={stylex(styles.results)}>
        {eventsState.error && <div className={stylex(styles.error)}>{eventsState.error}</div>}

        {eventsState.status !== undefined && (
          <div className={stylex(styles.meta)}>
            <div>
              <strong>Status:</strong> {eventsState.status}
            </div>
            <div>
              <strong>Duration:</strong> {eventsState.durationMs} ms
            </div>
          </div>
        )}

        <div className={stylex(styles.tableWrap)}>
          <table>
            <thead>
              <tr>
                <th>source</th>
                <th>type</th>
                <th>external_id</th>
                <th>received_at</th>
                <th>processed_at</th>
                <th>process_error</th>
              </tr>
            </thead>
            <tbody>
              {events.length === 0 && (
                <tr>
                  <td colSpan={6} className={stylex(styles.empty)}>
                    No events loaded yet.
                  </td>
                </tr>
              )}
              {events.map((event, index) => {
                const row = event as Record<string, unknown>;
                const isExpanded = expandedRowIndex === index;
                return (
                  <tr
                    key={index}
                    className={stylex(isExpanded && styles.highlight)}
                    onClick={() => setExpandedRowIndex(isExpanded ? null : index)}
                  >
                    <td>{String(row.source ?? "")}</td>
                    <td>{String(row.type ?? "")}</td>
                    <td>{String(row.external_id ?? row.externalId ?? "")}</td>
                    <td>{String(row.received_at ?? row.receivedAt ?? "")}</td>
                    <td>{String(row.processed_at ?? row.processedAt ?? "")}</td>
                    <td>{String(row.process_error ?? row.processError ?? "")}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {expandedRowIndex !== null && events[expandedRowIndex] !== undefined && (
          <div className={stylex(styles.jsonBlock)}>
            <div className={stylex(styles.jsonHeader)}>
              <strong>Event Details</strong>
            </div>
            <JsonView data={events[expandedRowIndex]} />
          </div>
        )}
      </div>

      <div className={stylex(styles.divider)} />

      <div className={stylex(styles.panelSub)}>
        <h3>POST /events/test</h3>
        <div className={stylex(styles.formGrid)}>
          <label>
            Source
            <input
              type="text"
              value={testSource}
              onChange={(event) => setTestSource(event.target.value)}
            />
          </label>
          <label>
            Type
            <input
              type="text"
              value={testType}
              onChange={(event) => setTestType(event.target.value)}
            />
          </label>
          <label>
            External ID
            <input
              type="text"
              value={testExternalId}
              onChange={(event) => setTestExternalId(event.target.value)}
            />
          </label>
        </div>

        <label className={stylex(styles.fullWidth)}>
          Payload JSON
          <textarea
            rows={6}
            value={testPayload}
            onChange={(event) => setTestPayload(event.target.value)}
          />
        </label>

        <div className={stylex(styles.actions)}>
          <button type="button" onClick={runEventsTest} disabled={testLoading}>
            {testLoading ? "Sending..." : "Send Test Event"}
          </button>
          {testState.url && <span className={stylex(styles.urlHint)}>{testState.url}</span>}
        </div>

        {testState.error && <div className={stylex(styles.error)}>{testState.error}</div>}

        {testState.status !== undefined && (
          <div className={stylex(styles.meta)}>
            <div>
              <strong>Status:</strong> {testState.status}
            </div>
            <div>
              <strong>Duration:</strong> {testState.durationMs} ms
            </div>
          </div>
        )}

        {idempotencyKey && (
          <div className={stylex(styles.highlight)}>
            <div>
              <strong>idempotencyKey:</strong> {idempotencyKey}
            </div>
            <button type="button" onClick={() => copyToClipboard("idempotencyKey", idempotencyKey)}>
              Copy idempotencyKey
            </button>
          </div>
        )}

        {testState.data !== undefined && (
          <div className={stylex(styles.jsonBlock)}>
            <div className={stylex(styles.jsonHeader)}>
              <strong>Response</strong>
            </div>
            <JsonView data={testState.data} />
          </div>
        )}

        {testState.data === undefined && testState.text && (
          <div className={stylex(styles.jsonBlock)}>
            <div className={stylex(styles.jsonHeader)}>
              <strong>Response Text</strong>
            </div>
            <pre>{testState.text}</pre>
          </div>
        )}
      </div>
    </section>
  );
}

export function DemoRoute(): JSX.Element {
  const { actor, actorLoading } = useAppState();
  if (actorLoading) {
    return <section className={stylex(styles.panel)}>Loading...</section>;
  }
  if (!actor?.isSystemAdmin) {
    return <NotAuthorized />;
  }
  return (
    <section className={stylex(styles.panel)}>
      <DemoPanel />
    </section>
  );
}

export function TemplatesRoute(): JSX.Element {
  const { selectedWorkspaceId, actor, actorLoading } = useAppState();
  const { templateKey } = useParams();
  const navigate = useNavigate();
  const selectedKey = templateKey ? decodeURIComponent(templateKey) : undefined;
  const isWorkspaceAdmin = Boolean(
    actor?.isSystemAdmin ||
    (selectedWorkspaceId && actor?.workspaceAdminIds.includes(selectedWorkspaceId))
  );
  if (actorLoading) {
    return <section className={stylex(styles.panel)}>Loading...</section>;
  }
  if (!isWorkspaceAdmin) {
    return <NotAuthorized />;
  }

  return (
    <section className={stylex(styles.panel)}>
      <h2>Templates</h2>
      <TemplatesPanel
        workspaceId={selectedWorkspaceId}
        selectedTemplateKeyOverride={selectedKey}
        onSelectedTemplateKeyChange={(nextKey) => {
          if (nextKey) {
            navigate(`/templates/${encodeURIComponent(nextKey)}`);
          } else {
            navigate("/templates");
          }
        }}
      />
    </section>
  );
}

export function CustomersRoute(): JSX.Element {
  const { selectedWorkspaceId, actor, actorLoading, userPreferences, updateUserPreference } =
    useAppState();
  const { customerId } = useParams();
  const isWorkspaceMember = Boolean(
    actor?.isSystemAdmin ||
    (selectedWorkspaceId && actor?.workspaceIds.includes(selectedWorkspaceId))
  );
  if (actorLoading) return <section className={stylex(styles.panel)}>Loading...</section>;
  if (!isWorkspaceMember) return <NotAuthorized />;
  return (
    <CustomersPanel
      workspaceId={selectedWorkspaceId}
      customerId={customerId ? decodeURIComponent(customerId) : undefined}
      initialStatuses={userPreferences.customer_status_filters ?? ["lead", "active"]}
      onStatusesChange={(statuses) => updateUserPreference("customer_status_filters", statuses)}
    />
  );
}

export function ProjectsRoute(): JSX.Element {
  const {
    selectedProjectId,
    setSelectedProjectId,
    contextLookup,
    selectedWorkspaceId,
    actor,
    actorLoading,
  } = useAppState();
  const { projectId } = useParams();
  const navigate = useNavigate();
  const isWorkspaceMember = Boolean(
    actor?.isSystemAdmin ||
    (selectedWorkspaceId && actor?.workspaceIds.includes(selectedWorkspaceId))
  );

  useEffect(() => {
    if (!isWorkspaceMember || !projectId) return;
    const decoded = decodeURIComponent(projectId);
    if (decoded && decoded !== selectedProjectId) {
      setSelectedProjectId(decoded);
    }
  }, [isWorkspaceMember, projectId, selectedProjectId, setSelectedProjectId]);

  const handleSelectProject = useCallback(
    (nextId: string | null) => {
      const decodedCurrent = projectId ? decodeURIComponent(projectId) : "";
      if (nextId === decodedCurrent) {
        setSelectedProjectId(nextId);
        return;
      }
      setSelectedProjectId(nextId);
      if (nextId) {
        navigate(`/projects/${encodeURIComponent(nextId)}`);
      } else {
        navigate("/projects");
      }
    },
    [navigate, projectId, setSelectedProjectId]
  );

  if (actorLoading) {
    return <section className={stylex(styles.panel)}>Loading...</section>;
  }
  if (!isWorkspaceMember) {
    return <NotAuthorized />;
  }

  return (
    <ProjectsPanel
      workspaceId={selectedWorkspaceId}
      selectedProjectId={selectedProjectId}
      onSelectProject={handleSelectProject}
      contextLookup={contextLookup}
    />
  );
}

export function TasksRoute(): JSX.Element {
  const { selectedWorkspaceId, actor, actorLoading } = useAppState();
  const isWorkspaceMember = Boolean(
    actor?.isSystemAdmin ||
    (selectedWorkspaceId && actor?.workspaceIds.includes(selectedWorkspaceId))
  );
  if (actorLoading) {
    return <section className={stylex(styles.panel)}>Loading...</section>;
  }
  if (!isWorkspaceMember) {
    return <NotAuthorized />;
  }
  return <TasksBoard workspaceId={selectedWorkspaceId} />;
}

export function IntegrationsRoute(): JSX.Element {
  const { selectedWorkspaceId, workspaces, actor, actorLoading } = useAppState();
  const isWorkspaceAdmin = Boolean(
    actor?.isSystemAdmin ||
    (selectedWorkspaceId && actor?.workspaceAdminIds.includes(selectedWorkspaceId))
  );
  if (actorLoading) {
    return <section className={stylex(styles.panel)}>Loading...</section>;
  }
  if (!isWorkspaceAdmin) {
    return <NotAuthorized />;
  }
  return <IntegrationsPanel workspaceId={selectedWorkspaceId} workspaces={workspaces} />;
}

export function IngestRoute(): JSX.Element {
  const { selectedWorkspaceId, workspaces, actor, actorLoading } = useAppState();
  const isWorkspaceAdmin = Boolean(
    actor?.isSystemAdmin ||
    (selectedWorkspaceId && actor?.workspaceAdminIds.includes(selectedWorkspaceId))
  );
  if (actorLoading) {
    return <section className={stylex(styles.panel)}>Loading...</section>;
  }
  if (!isWorkspaceAdmin) {
    return <NotAuthorized />;
  }
  return <IngestPanel workspaceId={selectedWorkspaceId} workspaces={workspaces} />;
}

export function WorkspacesRoute(): JSX.Element {
  const { selectedWorkspaceId, setSelectedWorkspaceId, actor, actorLoading } = useAppState();
  if (actorLoading) {
    return <section className={stylex(styles.panel)}>Loading...</section>;
  }
  if (!actor?.isSystemAdmin) {
    return <NotAuthorized />;
  }
  return (
    <WorkspacesPanel
      selectedWorkspaceId={selectedWorkspaceId}
      onSelectWorkspace={setSelectedWorkspaceId}
    />
  );
}

export function UsersRoute(): JSX.Element {
  const { selectedWorkspaceId, actor, actorLoading } = useAppState();
  const isWorkspaceAdmin = Boolean(
    actor?.isSystemAdmin ||
    (selectedWorkspaceId && actor?.workspaceAdminIds.includes(selectedWorkspaceId))
  );
  if (actorLoading) {
    return <section className={stylex(styles.panel)}>Loading...</section>;
  }
  if (!isWorkspaceAdmin) {
    return <NotAuthorized />;
  }
  return (
    <UsersPanel
      workspaceId={selectedWorkspaceId}
      canEditSystemAdmin={Boolean(actor?.isSystemAdmin)}
    />
  );
}

function NotAuthorized(): JSX.Element {
  return (
    <section className={stylex(styles.panel)}>
      <h2>Not authorized</h2>
      <p className={stylex(styles.metaText)}>Ask an admin for access to this section.</p>
    </section>
  );
}
