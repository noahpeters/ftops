"use client";

import { useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import stylex from "~/lib/stylex";
import { colors } from "../../theme/tokens.stylex";
import { buildUrl, fetchJson } from "../../lib/api";
import { PayloadEditor } from "./PayloadEditor";
import { ScenarioDetails } from "./ScenarioDetails";
import { ScenarioPicker } from "./ScenarioPicker";
import { DEFAULT_SCENARIOS, buildIdempotencyVariant } from "./scenarios";

type IdStrategy = "increment" | "random" | "fixed" | "timestamped";

type DemoState = {
  selectedScenarioId: string;
  counters: Record<string, number>;
  payloadOverrides: Record<string, string>;
  variantByScenario: Record<string, "off" | "on">;
  baseExternalId: string;
  idStrategy: IdStrategy;
  repeatCount: number;
  delayMs: number;
};

type DemoLogEntry = {
  id: string;
  time: string;
  scenarioId: string;
  scenarioName: string;
  externalId: string;
  status: number | null;
  idempotencyKey: string | null;
  error: string | null;
};

const DEFAULT_STATE: DemoState = {
  selectedScenarioId: DEFAULT_SCENARIOS[0]?.id ?? "",
  counters: {},
  payloadOverrides: {},
  variantByScenario: {},
  baseExternalId: DEFAULT_SCENARIOS[0]?.defaultRequest.baseExternalId ?? "",
  idStrategy: "increment",
  repeatCount: 3,
  delayMs: 300,
};

const styles = stylex.create({
  panel: {
    display: "flex",
    flexDirection: "column",
    gap: "16px",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
  },
  controls: {
    display: "flex",
    flexWrap: "wrap",
    gap: "12px",
    alignItems: "center",
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
    padding: "6px 12px",
    borderRadius: "8px",
    cursor: "pointer",
  },
  formGrid: {
    display: "grid",
    gap: "12px",
  },
  variantToggle: {
    display: "flex",
    gap: "12px",
    alignItems: "center",
    flexWrap: "wrap",
  },
  radio: {
    display: "inline-flex",
    alignItems: "center",
    gap: "6px",
  },
  error: {
    color: colors.errorText,
  },
  demoLog: {
    border: `1px solid ${colors.border}`,
    borderRadius: "8px",
    padding: "12px",
    backgroundColor: colors.surface,
  },
  demoLogHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: "8px",
  },
  empty: {
    color: colors.textSubtle,
  },
  tableWrap: {
    border: `1px solid ${colors.border}`,
    borderRadius: "8px",
    overflowX: "auto",
  },
  linkButton: {
    color: colors.accent,
    textDecoration: "underline",
    background: "none",
    border: "none",
    padding: 0,
    cursor: "pointer",
  },
});

export function DemoPanel(): JSX.Element {
  const [state, setState] = useState<DemoState>(DEFAULT_STATE);
  const [logs, setLogs] = useState<DemoLogEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const stopRef = useRef(false);
  const navigate = useNavigate();

  const scenario = useMemo(() => {
    return (
      DEFAULT_SCENARIOS.find((item) => item.id === state.selectedScenarioId) ?? DEFAULT_SCENARIOS[0]
    );
  }, [state.selectedScenarioId]);

  const payloadText = useMemo(() => {
    const override = state.payloadOverrides[scenario.id];
    if (override !== undefined) return override;
    return JSON.stringify(scenario.defaultRequest.payload, null, 2);
  }, [scenario, state.payloadOverrides]);

  const payloadError = useMemo(() => {
    try {
      JSON.parse(payloadText);
      return null;
    } catch {
      return "Payload JSON must be valid.";
    }
  }, [payloadText]);

  function updateState(patch: Partial<DemoState>) {
    setState((prev) => ({ ...prev, ...patch }));
  }

  function handleScenarioSelect(id: string) {
    const selected = DEFAULT_SCENARIOS.find((item) => item.id === id);
    if (!selected) return;
    updateState({
      selectedScenarioId: id,
      baseExternalId: selected.defaultRequest.baseExternalId,
      idStrategy: selected.supports.idStrategies.includes(state.idStrategy)
        ? state.idStrategy
        : (selected.supports.idStrategies[0] ?? "fixed"),
    });
  }

  function handleLoadScenario() {
    updateState({
      baseExternalId: scenario.defaultRequest.baseExternalId,
      payloadOverrides: {
        ...state.payloadOverrides,
        [scenario.id]: JSON.stringify(scenario.defaultRequest.payload, null, 2),
      },
    });
  }

  function handleResetScenario() {
    const nextOverrides = { ...state.payloadOverrides };
    delete nextOverrides[scenario.id];
    updateState({
      payloadOverrides: nextOverrides,
      baseExternalId: scenario.defaultRequest.baseExternalId,
      idStrategy: scenario.supports.idStrategies[0] ?? "fixed",
    });
  }

  function setPayloadOverride(value: string) {
    updateState({
      payloadOverrides: { ...state.payloadOverrides, [scenario.id]: value },
    });
  }

  function updateCounter(nextValue: number) {
    updateState({
      counters: { ...state.counters, [scenario.id]: nextValue },
    });
  }

  function updateVariant(nextValue: "off" | "on") {
    updateState({
      variantByScenario: { ...state.variantByScenario, [scenario.id]: nextValue },
    });
  }

  function addLog(entry: DemoLogEntry) {
    setLogs((prev) => [entry, ...prev].slice(0, 50));
  }

  function buildExternalId(counter: number) {
    switch (state.idStrategy) {
      case "increment":
        return `${state.baseExternalId}-${counter + 1}`;
      case "random":
        return `${state.baseExternalId}-${Math.random().toString(36).slice(2, 8)}`;
      case "timestamped":
        return `${state.baseExternalId}-${Date.now()}`;
      case "fixed":
      default:
        return state.baseExternalId;
    }
  }

  function buildPayload(externalId: string, nowIso: string) {
    if (scenario.id === "idempotency-variant") {
      const variant = state.variantByScenario[scenario.id] ?? "off";
      return buildIdempotencyVariant(externalId, variant);
    }
    if (scenario.buildRequest) {
      return scenario.buildRequest({ externalId, nowIso }).payload;
    }
    try {
      return JSON.parse(payloadText) as Record<string, unknown>;
    } catch {
      return scenario.defaultRequest.payload;
    }
  }

  async function sendOnce(count: number) {
    if (payloadError) {
      setError("Fix payload JSON before sending.");
      return;
    }
    setError(null);
    setSending(true);
    stopRef.current = false;

    let counter = state.counters[scenario.id] ?? 0;

    for (let index = 0; index < count; index += 1) {
      if (stopRef.current) break;
      const nowIso = new Date().toISOString();
      const externalId = buildExternalId(counter);
      const payload = buildPayload(externalId, nowIso);

      const result = await fetchJson(buildUrl("/events/test"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source: scenario.defaultRequest.source,
          type: scenario.defaultRequest.type,
          externalId,
          payload,
        }),
      });

      const idempotencyKey =
        result.data && typeof result.data === "object"
          ? (result.data as { idempotencyKey?: string; idempotency_key?: string }).idempotencyKey ||
            (result.data as { idempotencyKey?: string; idempotency_key?: string })
              .idempotency_key ||
            null
          : null;

      addLog({
        id: `${scenario.id}-${Date.now()}-${index}`,
        time: nowIso,
        scenarioId: scenario.id,
        scenarioName: scenario.name,
        externalId,
        status: result.status,
        idempotencyKey,
        error: result.ok ? null : result.text || "Request failed.",
      });

      if (state.idStrategy === "increment") {
        counter += 1;
        updateCounter(counter);
      }

      if (index < count - 1 && state.delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, state.delayMs));
      }
    }

    setSending(false);
  }

  function stopSending() {
    stopRef.current = true;
    setSending(false);
  }

  function openInPlanPreview(externalId: string) {
    const uri = `manual://proposal/${externalId}`;
    navigate(`/plan-preview/${encodeURIComponent(uri)}`);
  }

  return (
    <div className={stylex(styles.panel)}>
      <div className={stylex(styles.header)}>
        <div>
          <h2>Demo</h2>
          <p>Trigger example events via POST /events/test.</p>
        </div>
      </div>

      <div className={stylex(styles.controls)}>
        <ScenarioPicker
          scenarios={DEFAULT_SCENARIOS}
          selectedId={scenario.id}
          onSelect={handleScenarioSelect}
        />
        <div className={stylex(styles.actions)}>
          <button type="button" onClick={handleLoadScenario}>
            Load scenario
          </button>
          <button
            type="button"
            className={stylex(styles.secondaryButton)}
            onClick={handleResetScenario}
          >
            Reset to defaults
          </button>
        </div>
      </div>

      <ScenarioDetails scenario={scenario} />

      <div className={stylex(styles.formGrid)}>
        <label>
          Source
          <input type="text" value={scenario.defaultRequest.source} disabled />
        </label>
        <label>
          Type
          <input type="text" value={scenario.defaultRequest.type} disabled />
        </label>
        <label>
          Base External ID
          <input
            type="text"
            value={state.baseExternalId}
            onChange={(event) => updateState({ baseExternalId: event.target.value })}
          />
        </label>
        <label>
          ID Strategy
          <select
            value={state.idStrategy}
            onChange={(event) => updateState({ idStrategy: event.target.value as IdStrategy })}
          >
            {scenario.supports.idStrategies.map((strategy) => (
              <option key={strategy} value={strategy}>
                {strategy}
              </option>
            ))}
          </select>
        </label>
        <label>
          Repeat Count
          <input
            type="number"
            min={1}
            value={state.repeatCount}
            onChange={(event) => updateState({ repeatCount: Number(event.target.value) })}
          />
        </label>
        <label>
          Delay (ms)
          <input
            type="number"
            min={0}
            value={state.delayMs}
            onChange={(event) => updateState({ delayMs: Number(event.target.value) })}
          />
        </label>
      </div>

      {scenario.id === "idempotency-variant" && (
        <div className={stylex(styles.variantToggle)}>
          <span>Variant</span>
          <label className={stylex(styles.radio)}>
            <input
              type="radio"
              name="variant"
              checked={(state.variantByScenario[scenario.id] ?? "off") === "off"}
              onChange={() => updateVariant("off")}
            />
            requiresDesign false
          </label>
          <label className={stylex(styles.radio)}>
            <input
              type="radio"
              name="variant"
              checked={(state.variantByScenario[scenario.id] ?? "off") === "on"}
              onChange={() => updateVariant("on")}
            />
            requiresDesign true
          </label>
        </div>
      )}

      <PayloadEditor payloadText={payloadText} onChange={setPayloadOverride} />
      {payloadError && <div className={stylex(styles.error)}>{payloadError}</div>}
      {error && <div className={stylex(styles.error)}>{error}</div>}

      <div className={stylex(styles.actions)}>
        <button type="button" onClick={() => sendOnce(1)} disabled={sending}>
          Send Once
        </button>
        <button type="button" onClick={() => sendOnce(state.repeatCount)} disabled={sending}>
          Send {state.repeatCount}
        </button>
        <button type="button" className={stylex(styles.secondaryButton)} onClick={stopSending}>
          Stop
        </button>
      </div>

      <section className={stylex(styles.demoLog)}>
        <div className={stylex(styles.demoLogHeader)}>
          <h3>Results Log</h3>
          <span>Last 50</span>
        </div>
        {logs.length === 0 && <div className={stylex(styles.empty)}>No events sent yet.</div>}
        {logs.length > 0 && (
          <div className={stylex(styles.tableWrap)}>
            <table>
              <thead>
                <tr>
                  <th>time</th>
                  <th>scenario</th>
                  <th>external_id</th>
                  <th>status</th>
                  <th>idempotencyKey</th>
                  <th>open</th>
                  <th>error</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((entry) => (
                  <tr key={entry.id}>
                    <td>{entry.time}</td>
                    <td>{entry.scenarioName}</td>
                    <td>{entry.externalId}</td>
                    <td>{entry.status ?? ""}</td>
                    <td>{entry.idempotencyKey ?? ""}</td>
                    <td>
                      {entry.error ? (
                        ""
                      ) : (
                        <button
                          type="button"
                          className={stylex(styles.linkButton)}
                          onClick={() => openInPlanPreview(entry.externalId)}
                        >
                          Open
                        </button>
                      )}
                    </td>
                    <td>{entry.error ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
