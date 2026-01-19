import { jsx, jsxs, Fragment } from "react/jsx-runtime";
import { ServerRouter, UNSAFE_withComponentProps, Meta, Links, Outlet, ScrollRestoration, Scripts, useNavigate, NavLink, useParams, redirect } from "react-router";
import { useState, useEffect, useRef, useMemo, useCallback, createContext, useContext } from "react";
async function handleRequest(request, responseStatusCode, responseHeaders, reactRouterContext) {
  const serverRuntime = await import("react-dom/server");
  let didError = false;
  const onError = (error) => {
    didError = true;
    console.error(error);
  };
  if (typeof serverRuntime.renderToReadableStream === "function") {
    const stream = await serverRuntime.renderToReadableStream(
      /* @__PURE__ */ jsx(ServerRouter, { context: reactRouterContext, url: request.url }),
      { onError }
    );
    responseHeaders.set("Content-Type", "text/html; charset=utf-8");
    return new Response(stream, {
      status: didError ? 500 : responseStatusCode,
      headers: responseHeaders
    });
  }
  const { PassThrough, Readable } = await import("node:stream");
  const renderToPipeableStream = serverRuntime.renderToPipeableStream;
  if (typeof renderToPipeableStream !== "function") {
    throw new Error("react-dom/server does not provide a streaming renderer.");
  }
  return await new Promise((resolve, reject) => {
    let passThrough = null;
    const stream = renderToPipeableStream(
      /* @__PURE__ */ jsx(ServerRouter, { context: reactRouterContext, url: request.url }),
      {
        onAllReady() {
          passThrough = new PassThrough();
          stream.pipe(passThrough);
          const body = Readable.toWeb(passThrough);
          responseHeaders.set("Content-Type", "text/html; charset=utf-8");
          resolve(
            new Response(body, {
              status: didError ? 500 : responseStatusCode,
              headers: responseHeaders
            })
          );
        },
        onError
      }
    );
    request.signal.addEventListener("abort", () => {
      stream.abort();
      passThrough?.destroy();
      reject(request.signal.reason);
    });
  });
}
const entryServer = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: handleRequest
}, Symbol.toStringTag, { value: "Module" }));
const root$1 = UNSAFE_withComponentProps(function Root() {
  return /* @__PURE__ */ jsxs("html", {
    lang: "en",
    children: [/* @__PURE__ */ jsxs("head", {
      suppressHydrationWarning: true,
      children: [/* @__PURE__ */ jsx("meta", {
        charSet: "utf-8"
      }), /* @__PURE__ */ jsx("meta", {
        name: "viewport",
        content: "width=device-width, initial-scale=1"
      }), false, /* @__PURE__ */ jsx(Meta, {}), /* @__PURE__ */ jsx(Links, {})]
    }), /* @__PURE__ */ jsxs("body", {
      className: "x7e92ml xvqfk9l x1sc3s7d",
      children: [/* @__PURE__ */ jsx(Outlet, {}), /* @__PURE__ */ jsx(ScrollRestoration, {
        getKey: (_location, matches) => matches[matches.length - 1]?.id ?? ""
      }), /* @__PURE__ */ jsx(Scripts, {})]
    })]
  });
});
const route0 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: root$1
}, Symbol.toStringTag, { value: "Module" }));
function getApiBase() {
  return "https://api.from-trees.com";
}
function buildUrl(path, params) {
  const base = getApiBase().replace(/\/$/, "");
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const url = new URL(`${base}${normalizedPath}`);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value === void 0 || value === null) continue;
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}
async function fetchJson(url, init = {}) {
  const start = performance.now();
  let response;
  let text = "";
  let data = null;
  const headers = new Headers(init.headers || {});
  try {
    response = await fetch(url, {
      ...init,
      credentials: "include",
      headers
    });
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : "Network request failed");
  }
  try {
    text = await response.text();
    if (text) {
      data = JSON.parse(text);
    }
  } catch (error) {
    const durationMs2 = Math.round(performance.now() - start);
    return {
      ok: response.ok,
      status: response.status,
      data: null,
      text,
      headers: response.headers,
      durationMs: durationMs2
    };
  }
  const durationMs = Math.round(performance.now() - start);
  return {
    ok: response.ok,
    status: response.status,
    data,
    text,
    headers: response.headers,
    durationMs
  };
}
function DevMigrationBanner() {
  const [status, setStatus] = useState(null);
  useEffect(() => {
    return;
  }, []);
  return null;
}
function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function renderValue(value) {
  if (value === null) return "null";
  if (typeof value === "string") return `"${value}"`;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    return /* @__PURE__ */ jsxs("details", { open: true, children: [
      /* @__PURE__ */ jsxs("summary", { children: [
        "[",
        value.length,
        "]"
      ] }),
      /* @__PURE__ */ jsx("div", { className: "xf18ygs x78zum5 xdt5ytf x1jnr06f", children: value.map((item, index2) => /* @__PURE__ */ jsxs("div", { className: "x78zum5 x17d4w8g x1pha0wt", children: [
        /* @__PURE__ */ jsx("span", { className: "x1e3jit x1s688f", children: index2 }),
        /* @__PURE__ */ jsx("span", { className: "xo8r7s1", children: ":" }),
        /* @__PURE__ */ jsx("span", { className: "xvqfk9l", children: renderValue(item) })
      ] }, index2)) })
    ] });
  }
  if (isPlainObject(value)) {
    const entries = Object.entries(value);
    if (entries.length === 0) return "{}";
    return /* @__PURE__ */ jsxs("details", { open: true, children: [
      /* @__PURE__ */ jsxs("summary", { children: [
        "{...}",
        " ",
        entries.length,
        " keys"
      ] }),
      /* @__PURE__ */ jsx("div", { className: "xf18ygs x78zum5 xdt5ytf x1jnr06f", children: entries.map(([key, item]) => /* @__PURE__ */ jsxs("div", { className: "x78zum5 x17d4w8g x1pha0wt", children: [
        /* @__PURE__ */ jsx("span", { className: "x1e3jit x1s688f", children: key }),
        /* @__PURE__ */ jsx("span", { className: "xo8r7s1", children: ":" }),
        /* @__PURE__ */ jsx("span", { className: "xvqfk9l", children: renderValue(item) })
      ] }, key)) })
    ] });
  }
  return String(value);
}
function JsonView({
  data
}) {
  return /* @__PURE__ */ jsx("div", { className: "xze3p7c xfifm61 xvqfk9l", children: renderValue(data) });
}
function PayloadEditor({
  payloadText,
  onChange
}) {
  return /* @__PURE__ */ jsx("div", { className: "x78zum5 xdt5ytf x167g77z", children: /* @__PURE__ */ jsxs("label", { className: "x78zum5 xdt5ytf x17d4w8g", children: [
    "Advanced: Edit Payload",
    /* @__PURE__ */ jsx("textarea", { rows: 8, value: payloadText, onChange: (event) => onChange(event.target.value) })
  ] }) });
}
function ScenarioDetails({
  scenario
}) {
  return /* @__PURE__ */ jsxs("div", { className: "xc7ga6q xur7f20 xht5q6y", children: [
    /* @__PURE__ */ jsx("h3", { children: scenario.name }),
    /* @__PURE__ */ jsx("p", { children: scenario.description })
  ] });
}
function ScenarioPicker({
  scenarios,
  selectedId,
  onSelect
}) {
  return /* @__PURE__ */ jsx("div", { className: "x78zum5 xdt5ytf x17d4w8g", children: /* @__PURE__ */ jsxs("label", { children: [
    "Scenario",
    /* @__PURE__ */ jsx("select", { value: selectedId, onChange: (event) => onSelect(event.target.value), children: scenarios.map((scenario) => /* @__PURE__ */ jsx("option", { value: scenario.id, children: scenario.name }, scenario.id)) })
  ] }) });
}
function buildManualProposalPayload(externalId) {
  return {
    record: {
      uri: `manual://proposal/${externalId}`,
      kind: "proposal",
      customer: { display: "Jane Smith" },
      commitments: {
        quotedDeliveryDate: "2026-03-15",
        quotedInstallDate: "2026-03-20"
      },
      currency: "USD"
    },
    line_items: [
      {
        uri: `manual://proposal/${externalId}/line/table`,
        title: "Ash Dining Table",
        category_key: "furniture",
        deliverable_key: "dining_table",
        quantity: 1,
        position: 1,
        config: {
          woodSpecies: "ash",
          finish: "smoke",
          dimensions: { length: 84, width: 40, height: 30 },
          requiresDesign: true,
          requiresApproval: true
        }
      },
      {
        uri: `manual://proposal/${externalId}/line/delivery`,
        title: "White-glove delivery",
        category_key: "delivery",
        deliverable_key: "delivery_service",
        quantity: 1,
        position: 2,
        config: { deliveryRequired: true }
      },
      {
        uri: `manual://proposal/${externalId}/line/install`,
        title: "On-site installation",
        category_key: "install",
        deliverable_key: "install_service",
        quantity: 1,
        position: 3,
        config: { installRequired: true }
      }
    ]
  };
}
function buildCabinetryPayload(externalId) {
  return {
    record: {
      uri: `manual://proposal/${externalId}`,
      kind: "proposal",
      customer: { display: "Anderson Residence" },
      commitments: { quotedInstallDate: "2026-04-10" },
      currency: "USD"
    },
    line_items: [
      {
        uri: `manual://proposal/${externalId}/line/kitchen`,
        title: "Kitchen base cabinets",
        category_key: "cabinetry",
        deliverable_key: "cabinet_run",
        group_key: "kitchen",
        quantity: 1,
        position: 1,
        config: {
          room: "Kitchen",
          style: "Shaker",
          material: "Painted maple",
          requiresSamples: true,
          installRequired: true
        }
      },
      {
        uri: `manual://proposal/${externalId}/line/pantry`,
        title: "Pantry storage cabinets",
        category_key: "cabinetry",
        deliverable_key: "cabinet_run",
        group_key: "kitchen",
        quantity: 1,
        position: 2,
        config: {
          room: "Pantry",
          style: "Shaker",
          material: "Painted maple",
          requiresSamples: true,
          installRequired: true
        }
      }
    ]
  };
}
function buildDesignOnlyPayload(externalId) {
  return {
    record: {
      uri: `manual://proposal/${externalId}`,
      kind: "proposal",
      customer: { display: "Lopez Condo" },
      currency: "USD"
    },
    line_items: [
      {
        uri: `manual://proposal/${externalId}/line/design`,
        title: "Custom kitchen design package",
        category_key: "design",
        deliverable_key: "design_services",
        quantity: 1,
        position: 1,
        config: {
          revisionLimit: 3,
          deliverables: ["3D renderings", "AR walkthrough"],
          requiresApproval: true
        }
      }
    ]
  };
}
function buildIdempotencyPayload(externalId, requiresDesign) {
  return {
    record: {
      uri: `manual://proposal/${externalId}`,
      kind: "proposal",
      customer: { display: "Replay Test" },
      currency: "USD"
    },
    line_items: [
      {
        uri: `manual://proposal/${externalId}/line/table`,
        title: "Walnut Coffee Table",
        category_key: "furniture",
        deliverable_key: "coffee_table",
        quantity: 1,
        position: 1,
        config: { woodSpecies: "walnut", requiresDesign }
      }
    ]
  };
}
const DEFAULT_SCENARIOS = [
  {
    id: "manual-proposal",
    name: "Manual proposal (furniture + delivery + install)",
    description: "Dining table with delivery/install line items and design/approval flags.",
    defaultRequest: {
      source: "manual",
      type: "commercial_record_upserted",
      baseExternalId: "proposal-demo",
      payload: buildManualProposalPayload("proposal-demo")
    },
    supports: {
      idStrategies: ["increment", "random", "fixed", "timestamped"]
    },
    buildRequest: ({ externalId }) => ({
      source: "manual",
      type: "commercial_record_upserted",
      payload: buildManualProposalPayload(externalId)
    })
  },
  {
    id: "cabinetry-grouped",
    name: "Cabinetry (shared samples + install)",
    description: "Grouped cabinet runs that require samples and install for shared planning.",
    defaultRequest: {
      source: "manual",
      type: "commercial_record_upserted",
      baseExternalId: "cabinet-demo",
      payload: buildCabinetryPayload("cabinet-demo")
    },
    supports: {
      idStrategies: ["increment", "random", "fixed", "timestamped"]
    },
    buildRequest: ({ externalId }) => ({
      source: "manual",
      type: "commercial_record_upserted",
      payload: buildCabinetryPayload(externalId)
    })
  },
  {
    id: "design-only",
    name: "Design-only engagement",
    description: "Design services only, with approval flag and no delivery/install.",
    defaultRequest: {
      source: "manual",
      type: "commercial_record_upserted",
      baseExternalId: "design-demo",
      payload: buildDesignOnlyPayload("design-demo")
    },
    supports: {
      idStrategies: ["increment", "random", "fixed", "timestamped"]
    },
    buildRequest: ({ externalId }) => ({
      source: "manual",
      type: "commercial_record_upserted",
      payload: buildDesignOnlyPayload(externalId)
    })
  },
  {
    id: "idempotency-variant",
    name: "Idempotency + change detection",
    description: "Re-send with fixed externalId and flip requiresDesign to test idempotency.",
    defaultRequest: {
      source: "manual",
      type: "commercial_record_upserted",
      baseExternalId: "idempotency-demo",
      payload: buildIdempotencyPayload("idempotency-demo", false)
    },
    supports: {
      idStrategies: ["fixed", "timestamped", "random"]
    }
  }
];
function buildIdempotencyVariant(externalId, variant) {
  return buildIdempotencyPayload(externalId, variant === "on");
}
const DEFAULT_STATE = {
  selectedScenarioId: DEFAULT_SCENARIOS[0]?.id ?? "",
  counters: {},
  payloadOverrides: {},
  variantByScenario: {},
  baseExternalId: DEFAULT_SCENARIOS[0]?.defaultRequest.baseExternalId ?? "",
  idStrategy: "increment",
  repeatCount: 3,
  delayMs: 300
};
function DemoPanel() {
  const [state, setState] = useState(DEFAULT_STATE);
  const [logs, setLogs] = useState([]);
  const [error, setError] = useState(null);
  const [sending, setSending] = useState(false);
  const stopRef = useRef(false);
  const navigate = useNavigate();
  const scenario = useMemo(() => {
    return DEFAULT_SCENARIOS.find((item) => item.id === state.selectedScenarioId) ?? DEFAULT_SCENARIOS[0];
  }, [state.selectedScenarioId]);
  const payloadText = useMemo(() => {
    const override = state.payloadOverrides[scenario.id];
    if (override !== void 0) return override;
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
  function updateState(patch) {
    setState((prev) => ({
      ...prev,
      ...patch
    }));
  }
  function handleScenarioSelect(id) {
    const selected = DEFAULT_SCENARIOS.find((item) => item.id === id);
    if (!selected) return;
    updateState({
      selectedScenarioId: id,
      baseExternalId: selected.defaultRequest.baseExternalId,
      idStrategy: selected.supports.idStrategies.includes(state.idStrategy) ? state.idStrategy : selected.supports.idStrategies[0] ?? "fixed"
    });
  }
  function handleLoadScenario() {
    updateState({
      baseExternalId: scenario.defaultRequest.baseExternalId,
      payloadOverrides: {
        ...state.payloadOverrides,
        [scenario.id]: JSON.stringify(scenario.defaultRequest.payload, null, 2)
      }
    });
  }
  function handleResetScenario() {
    const nextOverrides = {
      ...state.payloadOverrides
    };
    delete nextOverrides[scenario.id];
    updateState({
      payloadOverrides: nextOverrides,
      baseExternalId: scenario.defaultRequest.baseExternalId,
      idStrategy: scenario.supports.idStrategies[0] ?? "fixed"
    });
  }
  function setPayloadOverride(value) {
    updateState({
      payloadOverrides: {
        ...state.payloadOverrides,
        [scenario.id]: value
      }
    });
  }
  function updateCounter(nextValue) {
    updateState({
      counters: {
        ...state.counters,
        [scenario.id]: nextValue
      }
    });
  }
  function updateVariant(nextValue) {
    updateState({
      variantByScenario: {
        ...state.variantByScenario,
        [scenario.id]: nextValue
      }
    });
  }
  function addLog(entry2) {
    setLogs((prev) => [entry2, ...prev].slice(0, 50));
  }
  function buildExternalId(counter) {
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
  function buildPayload(externalId, nowIso) {
    if (scenario.id === "idempotency-variant") {
      const variant = state.variantByScenario[scenario.id] ?? "off";
      return buildIdempotencyVariant(externalId, variant);
    }
    if (scenario.buildRequest) {
      return scenario.buildRequest({
        externalId,
        nowIso
      }).payload;
    }
    try {
      return JSON.parse(payloadText);
    } catch {
      return scenario.defaultRequest.payload;
    }
  }
  async function sendOnce(count) {
    if (payloadError) {
      setError("Fix payload JSON before sending.");
      return;
    }
    setError(null);
    setSending(true);
    stopRef.current = false;
    let counter = state.counters[scenario.id] ?? 0;
    for (let index2 = 0; index2 < count; index2 += 1) {
      if (stopRef.current) break;
      const nowIso = (/* @__PURE__ */ new Date()).toISOString();
      const externalId = buildExternalId(counter);
      const payload = buildPayload(externalId, nowIso);
      const result = await fetchJson(buildUrl("/events/test"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          source: scenario.defaultRequest.source,
          type: scenario.defaultRequest.type,
          externalId,
          payload
        })
      });
      const idempotencyKey = result.data && typeof result.data === "object" ? result.data.idempotencyKey || result.data.idempotency_key || null : null;
      addLog({
        id: `${scenario.id}-${Date.now()}-${index2}`,
        time: nowIso,
        scenarioId: scenario.id,
        scenarioName: scenario.name,
        externalId,
        status: result.status,
        idempotencyKey,
        error: result.ok ? null : result.text || "Request failed."
      });
      if (state.idStrategy === "increment") {
        counter += 1;
        updateCounter(counter);
      }
      if (index2 < count - 1 && state.delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, state.delayMs));
      }
    }
    setSending(false);
  }
  function stopSending() {
    stopRef.current = true;
    setSending(false);
  }
  function openInPlanPreview(externalId) {
    const uri = `manual://proposal/${externalId}`;
    navigate(`/plan-preview/${encodeURIComponent(uri)}`);
  }
  return /* @__PURE__ */ jsxs("div", { className: "x78zum5 xdt5ytf xou54vl", children: [
    /* @__PURE__ */ jsx("div", { className: "x78zum5 x1qughib", children: /* @__PURE__ */ jsxs("div", { children: [
      /* @__PURE__ */ jsx("h2", { children: "Demo" }),
      /* @__PURE__ */ jsx("p", { children: "Trigger example events via POST /events/test." })
    ] }) }),
    /* @__PURE__ */ jsxs("div", { className: "x78zum5 x1a02dak x1v2ro7d x6s0dn4", children: [
      /* @__PURE__ */ jsx(ScenarioPicker, { scenarios: DEFAULT_SCENARIOS, selectedId: scenario.id, onSelect: handleScenarioSelect }),
      /* @__PURE__ */ jsxs("div", { className: "x78zum5 x1a02dak x167g77z x6s0dn4", children: [
        /* @__PURE__ */ jsx("button", { type: "button", onClick: handleLoadScenario, children: "Load scenario" }),
        /* @__PURE__ */ jsx("button", { type: "button", className: "xht5q6y xvqfk9l x1arfzav xur7f20 x1ypdohk", onClick: handleResetScenario, children: "Reset to defaults" })
      ] })
    ] }),
    /* @__PURE__ */ jsx(ScenarioDetails, { scenario }),
    /* @__PURE__ */ jsxs("div", { className: "xrvj5dj x1v2ro7d", children: [
      /* @__PURE__ */ jsxs("label", { children: [
        "Source",
        /* @__PURE__ */ jsx("input", { type: "text", value: scenario.defaultRequest.source, disabled: true })
      ] }),
      /* @__PURE__ */ jsxs("label", { children: [
        "Type",
        /* @__PURE__ */ jsx("input", { type: "text", value: scenario.defaultRequest.type, disabled: true })
      ] }),
      /* @__PURE__ */ jsxs("label", { children: [
        "Base External ID",
        /* @__PURE__ */ jsx("input", { type: "text", value: state.baseExternalId, onChange: (event) => updateState({
          baseExternalId: event.target.value
        }) })
      ] }),
      /* @__PURE__ */ jsxs("label", { children: [
        "ID Strategy",
        /* @__PURE__ */ jsx("select", { value: state.idStrategy, onChange: (event) => updateState({
          idStrategy: event.target.value
        }), children: scenario.supports.idStrategies.map((strategy) => /* @__PURE__ */ jsx("option", { value: strategy, children: strategy }, strategy)) })
      ] }),
      /* @__PURE__ */ jsxs("label", { children: [
        "Repeat Count",
        /* @__PURE__ */ jsx("input", { type: "number", min: 1, value: state.repeatCount, onChange: (event) => updateState({
          repeatCount: Number(event.target.value)
        }) })
      ] }),
      /* @__PURE__ */ jsxs("label", { children: [
        "Delay (ms)",
        /* @__PURE__ */ jsx("input", { type: "number", min: 0, value: state.delayMs, onChange: (event) => updateState({
          delayMs: Number(event.target.value)
        }) })
      ] })
    ] }),
    scenario.id === "idempotency-variant" && /* @__PURE__ */ jsxs("div", { className: "x78zum5 x1v2ro7d x6s0dn4 x1a02dak", children: [
      /* @__PURE__ */ jsx("span", { children: "Variant" }),
      /* @__PURE__ */ jsxs("label", { className: "x3nfvp2 x6s0dn4 x17d4w8g", children: [
        /* @__PURE__ */ jsx("input", { type: "radio", name: "variant", checked: (state.variantByScenario[scenario.id] ?? "off") === "off", onChange: () => updateVariant("off") }),
        "requiresDesign false"
      ] }),
      /* @__PURE__ */ jsxs("label", { className: "x3nfvp2 x6s0dn4 x17d4w8g", children: [
        /* @__PURE__ */ jsx("input", { type: "radio", name: "variant", checked: (state.variantByScenario[scenario.id] ?? "off") === "on", onChange: () => updateVariant("on") }),
        "requiresDesign true"
      ] })
    ] }),
    /* @__PURE__ */ jsx(PayloadEditor, { payloadText, onChange: setPayloadOverride }),
    payloadError && /* @__PURE__ */ jsx("div", { className: "x1tp81k5", children: payloadError }),
    error && /* @__PURE__ */ jsx("div", { className: "x1tp81k5", children: error }),
    /* @__PURE__ */ jsxs("div", { className: "x78zum5 x1a02dak x167g77z x6s0dn4", children: [
      /* @__PURE__ */ jsx("button", { type: "button", onClick: () => sendOnce(1), disabled: sending, children: "Send Once" }),
      /* @__PURE__ */ jsxs("button", { type: "button", onClick: () => sendOnce(state.repeatCount), disabled: sending, children: [
        "Send ",
        state.repeatCount
      ] }),
      /* @__PURE__ */ jsx("button", { type: "button", className: "xht5q6y xvqfk9l x1arfzav xur7f20 x1ypdohk", onClick: stopSending, children: "Stop" })
    ] }),
    /* @__PURE__ */ jsxs("section", { className: "xur7f20 xc7ga6q xht5q6y", children: [
      /* @__PURE__ */ jsxs("div", { className: "x78zum5 x1qughib x6s0dn4 x1e56ztr", children: [
        /* @__PURE__ */ jsx("h3", { children: "Results Log" }),
        /* @__PURE__ */ jsx("span", { children: "Last 50" })
      ] }),
      logs.length === 0 && /* @__PURE__ */ jsx("div", { className: "xo8r7s1", children: "No events sent yet." }),
      logs.length > 0 && /* @__PURE__ */ jsx("div", { className: "xur7f20 xw2csxc", children: /* @__PURE__ */ jsxs("table", { children: [
        /* @__PURE__ */ jsx("thead", { children: /* @__PURE__ */ jsxs("tr", { children: [
          /* @__PURE__ */ jsx("th", { children: "time" }),
          /* @__PURE__ */ jsx("th", { children: "scenario" }),
          /* @__PURE__ */ jsx("th", { children: "external_id" }),
          /* @__PURE__ */ jsx("th", { children: "status" }),
          /* @__PURE__ */ jsx("th", { children: "idempotencyKey" }),
          /* @__PURE__ */ jsx("th", { children: "open" }),
          /* @__PURE__ */ jsx("th", { children: "error" })
        ] }) }),
        /* @__PURE__ */ jsx("tbody", { children: logs.map((entry2) => /* @__PURE__ */ jsxs("tr", { children: [
          /* @__PURE__ */ jsx("td", { children: entry2.time }),
          /* @__PURE__ */ jsx("td", { children: entry2.scenarioName }),
          /* @__PURE__ */ jsx("td", { children: entry2.externalId }),
          /* @__PURE__ */ jsx("td", { children: entry2.status ?? "" }),
          /* @__PURE__ */ jsx("td", { children: entry2.idempotencyKey ?? "" }),
          /* @__PURE__ */ jsx("td", { children: entry2.error ? "" : /* @__PURE__ */ jsx("button", { type: "button", className: "x1heipig x1bvjpef x1717udv x1ypdohk", onClick: () => openInPlanPreview(entry2.externalId), children: "Open" }) }),
          /* @__PURE__ */ jsx("td", { children: entry2.error ?? "" })
        ] }, entry2.id)) })
      ] }) })
    ] })
  ] });
}
function ContextViewer({
  data
}) {
  const [showRuleIds, setShowRuleIds] = useState(false);
  const [selectedDeliverable, setSelectedDeliverable] = useState(null);
  const [deliverableQuery, setDeliverableQuery] = useState("");
  const contexts = useMemo(() => {
    return data?.contexts;
  }, [data]);
  const matchedTemplatesByContext = useMemo(() => {
    return data?.matchedTemplatesByContext ?? {};
  }, [data]);
  const shared = useMemo(() => Array.isArray(contexts?.shared) ? contexts?.shared ?? [] : [], [contexts]);
  const deliverables = useMemo(() => Array.isArray(contexts?.deliverables) ? contexts?.deliverables ?? [] : [], [contexts]);
  const filteredDeliverables = useMemo(() => {
    const query = deliverableQuery.trim().toLowerCase();
    if (!query) return deliverables;
    return deliverables.filter((deliverable) => {
      const matchKey = `deliverable::${deliverable.key}`;
      const matched = matchedTemplatesByContext[matchKey] ?? [];
      const templateText = matched.map((item) => `${item.templateKey} ${item.title ?? ""}`).join(" ");
      const haystack = [deliverable.key, deliverable.title, deliverable.category_key, deliverable.deliverable_key, deliverable.group_key, templateText].filter(Boolean).join(" ").toLowerCase();
      return haystack.includes(query);
    });
  }, [deliverables, deliverableQuery, matchedTemplatesByContext]);
  const getMatches = (type, key) => matchedTemplatesByContext[`${type}::${key}`] ?? [];
  if (!contexts || !contexts.project) {
    return null;
  }
  return /* @__PURE__ */ jsxs("div", { className: "x78zum5 xdt5ytf xou54vl x9hd93c x1tamke2 xht5q6y", children: [
    /* @__PURE__ */ jsxs("div", { className: "x78zum5 xuk3077 x1qughib x1v2ro7d", children: [
      /* @__PURE__ */ jsxs("div", { children: [
        /* @__PURE__ */ jsx("h3", { children: "Contexts" }),
        /* @__PURE__ */ jsx("p", { children: "Derived contexts and rule matches for this record." })
      ] }),
      /* @__PURE__ */ jsxs("label", { className: "x3nfvp2 x17d4w8g x6s0dn4", children: [
        /* @__PURE__ */ jsx("input", { type: "checkbox", checked: showRuleIds, onChange: (event) => setShowRuleIds(event.target.checked) }),
        "Show rule IDs"
      ] })
    ] }),
    /* @__PURE__ */ jsxs("div", { className: "x78zum5 xdt5ytf x167g77z", children: [
      /* @__PURE__ */ jsx("h4", { children: "Project" }),
      /* @__PURE__ */ jsxs("details", { className: "x9hd93c xc7ga6q xh2izcj", open: true, children: [
        /* @__PURE__ */ jsxs("summary", { className: "x78zum5 x1a02dak x167g77z x6s0dn4 x1ypdohk", children: [
          /* @__PURE__ */ jsx("span", { className: "xmfpazt xur7f20 x1j6dyjg xtvhhri x1dgsrnt xczs1px x1jfab7n", children: "Project" }),
          /* @__PURE__ */ jsx("span", { className: "xze3p7c xfifm61", children: shorten$2(contexts.project.key) }),
          contexts.project.customer_display && /* @__PURE__ */ jsx("span", { className: "x1s688f", children: contexts.project.customer_display })
        ] }),
        /* @__PURE__ */ jsxs("div", { className: "x1xmf6yo x78zum5 xdt5ytf x883omv", children: [
          /* @__PURE__ */ jsxs("div", { className: "xrvj5dj x17d4w8g xfifm61 x1e3jit", children: [
            /* @__PURE__ */ jsxs("div", { children: [
              /* @__PURE__ */ jsx("strong", { children: "record_uri:" }),
              " ",
              contexts.project.record_uri
            ] }),
            /* @__PURE__ */ jsxs("div", { children: [
              /* @__PURE__ */ jsx("strong", { children: "quoted_delivery_date:" }),
              " ",
              contexts.project.quoted_delivery_date ?? "n/a"
            ] }),
            /* @__PURE__ */ jsxs("div", { children: [
              /* @__PURE__ */ jsx("strong", { children: "quoted_install_date:" }),
              " ",
              contexts.project.quoted_install_date ?? "n/a"
            ] }),
            /* @__PURE__ */ jsxs("div", { children: [
              /* @__PURE__ */ jsx("strong", { children: "snapshot_hash:" }),
              " ",
              contexts.project.snapshot_hash ?? "n/a"
            ] })
          ] }),
          /* @__PURE__ */ jsx(MatchesList, { matches: getMatches("project", contexts.project.key), showRuleIds })
        ] })
      ] })
    ] }),
    /* @__PURE__ */ jsxs("div", { className: "x78zum5 xdt5ytf x167g77z", children: [
      /* @__PURE__ */ jsx("h4", { children: "Shared" }),
      shared.length === 0 && /* @__PURE__ */ jsx("p", { className: "xo8r7s1", children: "No shared contexts." }),
      shared.map((context) => /* @__PURE__ */ jsxs("details", { className: "x9hd93c xc7ga6q xh2izcj", children: [
        /* @__PURE__ */ jsxs("summary", { className: "x78zum5 x1a02dak x167g77z x6s0dn4 x1ypdohk", children: [
          /* @__PURE__ */ jsx("span", { className: "xmfpazt xur7f20 x1j6dyjg xtvhhri x1dgsrnt x1lsnha7 x3ycguq", children: "Shared" }),
          /* @__PURE__ */ jsx("span", { className: "xze3p7c xfifm61", children: shorten$2(context.key) }),
          /* @__PURE__ */ jsxs("span", { className: "x1s688f", children: [
            context.line_items.length,
            " line items"
          ] })
        ] }),
        /* @__PURE__ */ jsxs("div", { className: "x1xmf6yo x78zum5 xdt5ytf x883omv", children: [
          /* @__PURE__ */ jsxs("div", { className: "xrvj5dj x17d4w8g xfifm61 x1e3jit", children: [
            /* @__PURE__ */ jsxs("div", { children: [
              /* @__PURE__ */ jsx("strong", { children: "group_key:" }),
              " ",
              context.group_key
            ] }),
            /* @__PURE__ */ jsxs("div", { children: [
              /* @__PURE__ */ jsx("strong", { children: "requiresSamples:" }),
              " ",
              String(context.derived?.requiresSamples ?? false)
            ] }),
            /* @__PURE__ */ jsxs("div", { children: [
              /* @__PURE__ */ jsx("strong", { children: "installRequired:" }),
              " ",
              String(context.derived?.installRequired ?? false)
            ] }),
            /* @__PURE__ */ jsxs("div", { children: [
              /* @__PURE__ */ jsx("strong", { children: "deliveryRequired:" }),
              " ",
              String(context.derived?.deliveryRequired ?? false)
            ] })
          ] }),
          /* @__PURE__ */ jsx("div", { className: "x78zum5 xdt5ytf x1jnr06f", children: context.line_items.map((item) => /* @__PURE__ */ jsxs("div", { children: [
            shorten$2(item.line_item_uri),
            " — ",
            item.title ?? "Untitled",
            " (",
            item.category_key,
            "/",
            item.deliverable_key,
            ")"
          ] }, item.line_item_uri)) }),
          /* @__PURE__ */ jsx(MatchesList, { matches: getMatches("shared", context.key), showRuleIds })
        ] })
      ] }, context.key))
    ] }),
    /* @__PURE__ */ jsxs("div", { className: "x78zum5 xdt5ytf x167g77z", children: [
      /* @__PURE__ */ jsxs("div", { className: "x78zum5 x6s0dn4 x1qughib", children: [
        /* @__PURE__ */ jsx("h4", { children: "Deliverables" }),
        /* @__PURE__ */ jsxs("div", { className: "x78zum5 x6s0dn4 x167g77z x1a02dak", children: [
          /* @__PURE__ */ jsx("input", { type: "text", placeholder: "Search deliverables...", value: deliverableQuery, onChange: (event) => setDeliverableQuery(event.target.value) }),
          selectedDeliverable && /* @__PURE__ */ jsx("button", { type: "button", className: "xht5q6y xvqfk9l xk61eof xiq63ov x1ypdohk", onClick: () => setSelectedDeliverable(null), children: "Clear selection" })
        ] })
      ] }),
      filteredDeliverables.length === 0 && /* @__PURE__ */ jsx("p", { className: "xo8r7s1", children: "No deliverable contexts match." }),
      filteredDeliverables.map((context) => {
        const matches = getMatches("deliverable", context.key);
        const isSelected = selectedDeliverable === context.key;
        const showMatches = !selectedDeliverable || selectedDeliverable === context.key;
        return /* @__PURE__ */ jsxs("details", { className: {
          0: "x9hd93c xc7ga6q xh2izcj",
          1: "x9hd93c xc7ga6q x1hdarym x1tiokuu"
        }[!!isSelected << 0], onClick: () => setSelectedDeliverable(isSelected ? null : context.key), children: [
          /* @__PURE__ */ jsxs("summary", { className: "x78zum5 x1a02dak x167g77z x6s0dn4 x1ypdohk", children: [
            /* @__PURE__ */ jsx("span", { className: "xmfpazt xur7f20 x1j6dyjg xtvhhri x1dgsrnt x1el1eiv x1tp81k5", children: "Deliverable" }),
            /* @__PURE__ */ jsx("span", { className: "xze3p7c xfifm61", children: shorten$2(context.key) }),
            /* @__PURE__ */ jsx("span", { className: "x1s688f", children: context.title ?? "Untitled" }),
            /* @__PURE__ */ jsxs("span", { className: "xfifm61 xo8r7s1", children: [
              context.category_key,
              "/",
              context.deliverable_key
            ] }),
            context.group_key && /* @__PURE__ */ jsxs("span", { className: "xfifm61 xo8r7s1", children: [
              "group: ",
              context.group_key
            ] })
          ] }),
          /* @__PURE__ */ jsxs("div", { className: "x1xmf6yo x78zum5 xdt5ytf x883omv", children: [
            /* @__PURE__ */ jsxs("div", { className: "xrvj5dj x17d4w8g xfifm61 x1e3jit", children: [
              /* @__PURE__ */ jsxs("div", { children: [
                /* @__PURE__ */ jsx("strong", { children: "quantity:" }),
                " ",
                context.quantity ?? 0
              ] }),
              /* @__PURE__ */ jsxs("div", { children: [
                /* @__PURE__ */ jsx("strong", { children: "position:" }),
                " ",
                context.position ?? "n/a"
              ] }),
              /* @__PURE__ */ jsxs("div", { children: [
                /* @__PURE__ */ jsx("strong", { children: "config_hash:" }),
                " ",
                context.config_hash ?? "n/a"
              ] }),
              context.configParseError && /* @__PURE__ */ jsxs("div", { className: "x1tp81k5", children: [
                /* @__PURE__ */ jsx("strong", { children: "config error:" }),
                " ",
                context.configParseError
              ] })
            ] }),
            context.config && /* @__PURE__ */ jsx("pre", { className: "x1tja46j xvqfk9l x7z7khe xiq63ov x1j6dyjg xw2csxc", children: JSON.stringify(context.config, null, 2) }),
            showMatches && /* @__PURE__ */ jsx(MatchesList, { matches, showRuleIds }),
            !showMatches && /* @__PURE__ */ jsx("p", { className: "xo8r7s1", children: "Select to view matches." })
          ] })
        ] }, context.key);
      })
    ] })
  ] });
}
function MatchesList({
  matches,
  showRuleIds
}) {
  if (!matches.length) {
    return /* @__PURE__ */ jsx("p", { className: "xo8r7s1", children: "No matching templates." });
  }
  return /* @__PURE__ */ jsxs("div", { className: "x78zum5 xdt5ytf x17d4w8g xfifm61", children: [
    /* @__PURE__ */ jsx("strong", { children: "Matched templates" }),
    /* @__PURE__ */ jsx("ul", { children: matches.map((match, index2) => /* @__PURE__ */ jsxs("li", { children: [
      /* @__PURE__ */ jsx("span", { className: "x1s688f", children: match.title ?? match.templateKey }),
      /* @__PURE__ */ jsx("span", { className: "x1e3jit x16vho4v", children: match.templateKey }),
      /* @__PURE__ */ jsxs("span", { className: "xo8r7s1 x16vho4v", children: [
        "priority ",
        match.rulePriority
      ] }),
      showRuleIds && /* @__PURE__ */ jsxs("span", { className: "xo8r7s1 x16vho4v", children: [
        "rule ",
        match.ruleId
      ] })
    ] }, `${match.templateKey}-${match.ruleId}-${index2}`)) })
  ] });
}
function shorten$2(value, max = 36) {
  if (value.length <= max) return value;
  return `${value.slice(0, 18)}…${value.slice(-14)}`;
}
function listCommercialRecords(params) {
  return fetchJson(
    buildUrl("/commercial-records", {
      limit: params.limit,
      offset: params.offset,
      query: params.query
    }),
    { method: "GET" }
  );
}
function RecordSidebar({
  selectedUri,
  onSelect
}) {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [error, setError] = useState(null);
  useEffect(() => {
    const handle = setTimeout(() => {
      void fetchRecords(query);
    }, 300);
    return () => clearTimeout(handle);
  }, [query]);
  useEffect(() => {
    void fetchRecords("");
  }, []);
  async function fetchRecords(nextQuery) {
    setLoading(true);
    setError(null);
    const result = await listCommercialRecords({
      limit: 50,
      offset: 0,
      query: nextQuery || void 0
    });
    if (!result.ok) {
      const apiError = result.data && typeof result.data === "object" ? result.data.error : void 0;
      if (apiError === "commercial_schema_not_installed") {
        setError("Commercial schema is not installed in this environment yet.");
      } else {
        setError(result.text || "Failed to load commercial records.");
      }
      setRecords([]);
      setLoading(false);
      return;
    }
    setRecords(result.data?.records ?? []);
    setLoading(false);
  }
  return /* @__PURE__ */ jsxs("aside", { className: "x9hd93c xc7ga6q xht5q6y x78zum5 xdt5ytf x1v2ro7d", children: [
    /* @__PURE__ */ jsxs("div", { className: "x78zum5 x6s0dn4 x1qughib", children: [
      /* @__PURE__ */ jsx("h3", { children: "Commercial Records" }),
      /* @__PURE__ */ jsx("button", { type: "button", onClick: () => fetchRecords(query), children: "Refresh" })
    ] }),
    /* @__PURE__ */ jsxs("label", { className: "x78zum5 xdt5ytf x17d4w8g xfifm61", children: [
      "Search",
      /* @__PURE__ */ jsx("input", { type: "text", placeholder: "uri, customer, external_id", value: query, onChange: (event) => setQuery(event.target.value) })
    ] }),
    loading && /* @__PURE__ */ jsx("div", { className: "xo8r7s1", children: "Loading records..." }),
    error && /* @__PURE__ */ jsx("div", { className: "x1tp81k5", children: error }),
    !loading && !error && records.length === 0 && /* @__PURE__ */ jsx("div", { className: "xo8r7s1", children: "No records found." }),
    /* @__PURE__ */ jsx("div", { className: "x78zum5 xdt5ytf x167g77z", children: records.map((record) => {
      const isSelected = record.uri === selectedUri;
      return /* @__PURE__ */ jsxs("button", { type: "button", className: {
        0: "xdpxx8g xiq63ov x7z7khe xh2izcj x1ypdohk",
        1: "xdpxx8g xiq63ov x7z7khe x1ypdohk x1hdarym x1tiokuu"
      }[!!isSelected << 0], onClick: () => onSelect(record.uri), children: [
        /* @__PURE__ */ jsx("div", { className: "x1s688f xfifm61", children: shorten$1(record.uri) }),
        /* @__PURE__ */ jsxs("div", { className: "x78zum5 xdt5ytf x1jnr06f x1j6dyjg x1e3jit", children: [
          /* @__PURE__ */ jsxs("span", { children: [
            record.source,
            "/",
            record.kind
          ] }),
          record.customer_display && /* @__PURE__ */ jsx("span", { children: record.customer_display }),
          /* @__PURE__ */ jsx("span", { children: record.last_seen_at || "no last_seen_at" })
        ] })
      ] }, record.uri);
    }) })
  ] });
}
function shorten$1(uri) {
  if (uri.length <= 48) return uri;
  return `${uri.slice(0, 24)}…${uri.slice(-16)}`;
}
async function listProjects() {
  return fetchJson(buildUrl("/projects"));
}
async function getProject(id) {
  return fetchJson(buildUrl(`/projects/${id}`));
}
async function getProjectTasks(projectId) {
  return fetchJson(buildUrl(`/projects/${projectId}/tasks`));
}
async function patchTaskStatus(taskId, status) {
  return fetchJson(buildUrl(`/tasks/${taskId}`), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status })
  });
}
async function listTaskNotes(taskId) {
  return fetchJson(buildUrl(`/tasks/${taskId}/notes`));
}
async function addTaskNote(taskId, body) {
  return fetchJson(buildUrl(`/tasks/${taskId}/notes`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ body })
  });
}
async function createProjectFromRecord(recordUri) {
  return fetchJson(buildUrl("/projects/from-record"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ recordUri })
  });
}
async function materializeProject(projectId) {
  return fetchJson(buildUrl(`/projects/${projectId}/materialize`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dryRun: false })
  });
}
const STATUS_OPTIONS = ["todo", "doing", "blocked", "done", "canceled"];
function ProjectsPanel({
  selectedProjectId,
  onSelectProject,
  contextLookup
}) {
  const [projects2, setProjects] = useState([]);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [projectsError, setProjectsError] = useState(null);
  const [project, setProject] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [tasksLoading, setTasksLoading] = useState(false);
  const [tasksError, setTasksError] = useState(null);
  const [expandedTasks, setExpandedTasks] = useState({});
  const [notesByTask, setNotesByTask] = useState({});
  const [notesLoading, setNotesLoading] = useState({});
  const [noteDrafts, setNoteDrafts] = useState({});
  const [statusSaving, setStatusSaving] = useState({});
  const [noteError, setNoteError] = useState(null);
  useEffect(() => {
    void refreshProjects();
  }, []);
  useEffect(() => {
    if (!selectedProjectId) {
      setProject(null);
      setTasks([]);
      return;
    }
    void loadProject(selectedProjectId);
    void loadTasks(selectedProjectId);
  }, [selectedProjectId]);
  async function refreshProjects() {
    setProjectsLoading(true);
    setProjectsError(null);
    const result = await listProjects();
    if (!result.ok) {
      setProjectsError(result.text || "Failed to load projects.");
    } else {
      setProjects(result.data ?? []);
    }
    setProjectsLoading(false);
  }
  async function loadProject(projectId) {
    const result = await getProject(projectId);
    if (result.ok) {
      setProject(result.data ?? null);
    }
  }
  async function loadTasks(projectId) {
    setTasksLoading(true);
    setTasksError(null);
    const result = await getProjectTasks(projectId);
    if (!result.ok) {
      setTasksError(result.text || "Failed to load tasks.");
      setTasks([]);
    } else {
      setTasks(result.data ?? []);
    }
    setTasksLoading(false);
  }
  async function handleStatusChange(taskId, nextStatus) {
    if (!selectedProjectId) return;
    setStatusSaving((prev) => ({
      ...prev,
      [taskId]: true
    }));
    const result = await patchTaskStatus(taskId, nextStatus);
    if (result.ok) {
      await loadTasks(selectedProjectId);
    }
    setStatusSaving((prev) => ({
      ...prev,
      [taskId]: false
    }));
  }
  async function toggleNotes(taskId) {
    setExpandedTasks((prev) => ({
      ...prev,
      [taskId]: !prev[taskId]
    }));
    if (!notesByTask[taskId]) {
      setNotesLoading((prev) => ({
        ...prev,
        [taskId]: true
      }));
      const result = await listTaskNotes(taskId);
      if (result.ok) {
        setNotesByTask((prev) => ({
          ...prev,
          [taskId]: result.data ?? []
        }));
      }
      setNotesLoading((prev) => ({
        ...prev,
        [taskId]: false
      }));
    }
  }
  async function submitNote(taskId) {
    const body = noteDrafts[taskId]?.trim();
    if (!body) {
      setNoteError("Note body cannot be empty.");
      return;
    }
    setNoteError(null);
    const result = await addTaskNote(taskId, body);
    if (result.ok) {
      setNoteDrafts((prev) => ({
        ...prev,
        [taskId]: ""
      }));
      const refreshed = await listTaskNotes(taskId);
      if (refreshed.ok) {
        setNotesByTask((prev) => ({
          ...prev,
          [taskId]: refreshed.data ?? []
        }));
      }
    } else {
      setNoteError(result.text || "Failed to add note.");
    }
  }
  const groupedTasks = useMemo(() => {
    const groups = {
      project: [],
      shared: [],
      deliverable: []
    };
    tasks.forEach((task) => {
      groups[task.scope]?.push(task);
    });
    return groups;
  }, [tasks]);
  const deliverableGroups = useMemo(() => {
    const map = /* @__PURE__ */ new Map();
    groupedTasks.deliverable.forEach((task) => {
      const key = task.line_item_uri ?? "unknown";
      const list = map.get(key) ?? [];
      list.push(task);
      map.set(key, list);
    });
    return map;
  }, [groupedTasks.deliverable]);
  const sharedGroups = useMemo(() => {
    const map = /* @__PURE__ */ new Map();
    groupedTasks.shared.forEach((task) => {
      const key = task.group_key ?? "ungrouped";
      const list = map.get(key) ?? [];
      list.push(task);
      map.set(key, list);
    });
    return map;
  }, [groupedTasks.shared]);
  return /* @__PURE__ */ jsxs("section", { className: "x15ji50x", children: [
    /* @__PURE__ */ jsx("h2", { children: "Projects" }),
    /* @__PURE__ */ jsxs("div", { className: "xrvj5dj x14sj8ly xou54vl", children: [
      /* @__PURE__ */ jsxs("div", { className: "x9hd93c xc7ga6q xht5q6y x78zum5 xdt5ytf x1v2ro7d", children: [
        /* @__PURE__ */ jsx("div", { className: "x78zum5 x167g77z", children: /* @__PURE__ */ jsx("button", { type: "button", onClick: refreshProjects, disabled: projectsLoading, children: projectsLoading ? "Loading..." : "Refresh" }) }),
        projectsError && /* @__PURE__ */ jsx("div", { className: "x1tp81k5", children: projectsError }),
        /* @__PURE__ */ jsxs("ul", { className: "xe8uvvx x1717udv x1ghz6dp x78zum5 xdt5ytf x167g77z", children: [
          projects2.map((item) => /* @__PURE__ */ jsx("li", { children: /* @__PURE__ */ jsxs("button", { type: "button", className: {
            0: "xdpxx8g xh8yej3 xiq63ov x7z7khe xh2izcj x1ypdohk x78zum5 xdt5ytf x1jnr06f",
            1: "xdpxx8g xh8yej3 xiq63ov x7z7khe x1ypdohk x78zum5 xdt5ytf x1jnr06f x1hdarym x1tiokuu"
          }[!!(selectedProjectId === item.id) << 0], onClick: () => onSelectProject(item.id), children: [
            /* @__PURE__ */ jsx("strong", { children: item.title }),
            /* @__PURE__ */ jsx("span", { children: item.status }),
            /* @__PURE__ */ jsx("span", { className: "xo8r7s1", children: item.updated_at ?? item.created_at })
          ] }) }, item.id)),
          projects2.length === 0 && !projectsLoading && /* @__PURE__ */ jsx("li", { className: "xo8r7s1", children: "No projects yet." })
        ] })
      ] }),
      /* @__PURE__ */ jsxs("div", { className: "x9hd93c x1tamke2 xht5q6y x78zum5 xdt5ytf x1v2ro7d", children: [
        !selectedProjectId && /* @__PURE__ */ jsx("p", { className: "xo8r7s1", children: "Select a project." }),
        selectedProjectId && /* @__PURE__ */ jsxs(Fragment, { children: [
          /* @__PURE__ */ jsxs("div", { className: "x78zum5 x6s0dn4 x1qughib x1v2ro7d", children: [
            /* @__PURE__ */ jsxs("div", { children: [
              /* @__PURE__ */ jsx("h3", { children: project?.title ?? "Project" }),
              /* @__PURE__ */ jsxs("p", { className: "xo8r7s1", children: [
                "Record: ",
                project?.commercial_record_uri ?? "n/a"
              ] })
            ] }),
            /* @__PURE__ */ jsx("button", { type: "button", className: "xht5q6y xvqfk9l xk61eof xiq63ov x1ypdohk", onClick: () => onSelectProject(null), children: "Back to list" })
          ] }),
          tasksError && /* @__PURE__ */ jsx("div", { className: "x1tp81k5", children: tasksError }),
          tasksLoading && /* @__PURE__ */ jsx("p", { className: "xo8r7s1", children: "Loading tasks..." }),
          !tasksLoading && /* @__PURE__ */ jsxs("div", { className: "x78zum5 xdt5ytf xou54vl", children: [
            /* @__PURE__ */ jsx(TaskGroup, { title: "Project", tasks: groupedTasks.project, onStatusChange: handleStatusChange, statusSaving, onToggleNotes: toggleNotes, expandedTasks, notesByTask, notesLoading, noteDrafts, setNoteDrafts, submitNote, noteError }),
            /* @__PURE__ */ jsx(TaskGroupCollection, { title: "Shared", groups: sharedGroups, contextLookup, onStatusChange: handleStatusChange, statusSaving, onToggleNotes: toggleNotes, expandedTasks, notesByTask, notesLoading, noteDrafts, setNoteDrafts, submitNote, noteError }),
            /* @__PURE__ */ jsx(TaskGroupCollection, { title: "Deliverable", groups: deliverableGroups, contextLookup, onStatusChange: handleStatusChange, statusSaving, onToggleNotes: toggleNotes, expandedTasks, notesByTask, notesLoading, noteDrafts, setNoteDrafts, submitNote, noteError })
          ] })
        ] })
      ] })
    ] })
  ] });
}
function TaskGroup({
  title,
  tasks,
  onStatusChange,
  statusSaving,
  onToggleNotes,
  expandedTasks,
  notesByTask,
  notesLoading,
  noteDrafts,
  setNoteDrafts,
  submitNote,
  noteError
}) {
  if (!tasks.length) {
    return /* @__PURE__ */ jsxs("div", { className: "x78zum5 xdt5ytf x167g77z", children: [
      /* @__PURE__ */ jsx("h4", { children: title }),
      /* @__PURE__ */ jsx("p", { className: "xo8r7s1", children: "No tasks." })
    ] });
  }
  return /* @__PURE__ */ jsxs("div", { className: "x78zum5 xdt5ytf x167g77z", children: [
    /* @__PURE__ */ jsx("h4", { children: title }),
    tasks.map((task) => /* @__PURE__ */ jsx(TaskRowView, { task, onStatusChange, statusSaving, onToggleNotes, expandedTasks, notesByTask, notesLoading, noteDrafts, setNoteDrafts, submitNote, noteError }, task.id))
  ] });
}
function TaskGroupCollection({
  title,
  groups,
  contextLookup,
  ...taskProps
}) {
  return /* @__PURE__ */ jsxs("div", { className: "x78zum5 xdt5ytf x167g77z", children: [
    /* @__PURE__ */ jsx("h4", { children: title }),
    groups.size === 0 && /* @__PURE__ */ jsx("p", { className: "xo8r7s1", children: "No tasks." }),
    Array.from(groups.entries()).map(([key, tasks]) => {
      const contextTitle = contextLookup?.[key]?.title;
      return /* @__PURE__ */ jsxs("div", { className: "x9hd93c x7z7khe xh2izcj x78zum5 xdt5ytf x167g77z", children: [
        /* @__PURE__ */ jsxs("div", { className: "x78zum5 xdt5ytf x1jnr06f", children: [
          /* @__PURE__ */ jsx("strong", { children: contextTitle ?? shorten(key) }),
          contextTitle && /* @__PURE__ */ jsx("span", { className: "xo8r7s1", children: shorten(key) })
        ] }),
        tasks.map((task) => /* @__PURE__ */ jsx(TaskRowView, { task, ...taskProps }, task.id))
      ] }, key);
    })
  ] });
}
function TaskRowView({
  task,
  onStatusChange,
  statusSaving,
  onToggleNotes,
  expandedTasks,
  notesByTask,
  notesLoading,
  noteDrafts,
  setNoteDrafts,
  submitNote,
  noteError
}) {
  const isExpanded = expandedTasks[task.id];
  const notes = notesByTask[task.id] ?? [];
  const isSaving = statusSaving[task.id];
  return /* @__PURE__ */ jsxs("div", { className: "x9hd93c x7z7khe xht5q6y x78zum5 xdt5ytf x883omv", children: [
    /* @__PURE__ */ jsxs("div", { className: "x78zum5 x1qughib x1v2ro7d x1a02dak", children: [
      /* @__PURE__ */ jsxs("div", { children: [
        /* @__PURE__ */ jsx("strong", { children: task.title }),
        /* @__PURE__ */ jsx("div", { className: "xfifm61 x1e3jit", children: /* @__PURE__ */ jsx("span", { children: task.template_key }) })
      ] }),
      /* @__PURE__ */ jsxs("div", { className: "x78zum5 x167g77z x6s0dn4", children: [
        /* @__PURE__ */ jsx("select", { value: task.status, onChange: (event) => onStatusChange(task.id, event.target.value), disabled: isSaving, children: STATUS_OPTIONS.map((status) => /* @__PURE__ */ jsx("option", { value: status, children: status }, status)) }),
        /* @__PURE__ */ jsx("button", { type: "button", className: "xht5q6y xvqfk9l xk61eof xiq63ov x1ypdohk", onClick: () => onToggleNotes(task.id), children: isExpanded ? "Hide notes" : "Notes" })
      ] })
    ] }),
    isExpanded && /* @__PURE__ */ jsxs("div", { className: "x889kno x78zum5 xdt5ytf x167g77z", children: [
      notesLoading[task.id] && /* @__PURE__ */ jsx("p", { className: "xo8r7s1", children: "Loading notes..." }),
      noteError && /* @__PURE__ */ jsx("div", { className: "x1tp81k5", children: noteError }),
      notes.length === 0 && !notesLoading[task.id] && /* @__PURE__ */ jsx("p", { className: "xo8r7s1", children: "No notes yet." }),
      notes.map((note) => /* @__PURE__ */ jsxs("div", { className: "xur7f20 xe8ttls xh2izcj", children: [
        /* @__PURE__ */ jsxs("div", { className: "x78zum5 x167g77z xfifm61 x1e3jit", children: [
          /* @__PURE__ */ jsx("strong", { children: note.author_email }),
          /* @__PURE__ */ jsx("span", { children: note.created_at })
        ] }),
        /* @__PURE__ */ jsx("p", { children: note.body })
      ] }, note.id)),
      /* @__PURE__ */ jsx("textarea", { value: noteDrafts[task.id] ?? "", onChange: (event) => setNoteDrafts((prev) => ({
        ...prev,
        [task.id]: event.target.value
      })), rows: 3, placeholder: "Add a note..." }),
      /* @__PURE__ */ jsx("button", { type: "button", onClick: () => submitNote(task.id), children: "Add note" })
    ] })
  ] });
}
function shorten(value, max = 42) {
  if (value.length <= max) return value;
  return `${value.slice(0, 18)}…${value.slice(-12)}`;
}
function listTemplates() {
  return fetchJson(buildUrl("/templates"), {
    method: "GET"
  });
}
function getTemplate(key) {
  return fetchJson(buildUrl(`/templates/${encodeURIComponent(key)}`), {
    method: "GET"
  });
}
function createTemplate(body) {
  return fetchJson(buildUrl("/templates"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}
function updateTemplate(key, body) {
  return fetchJson(buildUrl(`/templates/${encodeURIComponent(key)}`), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}
function deleteTemplate(key) {
  return fetchJson(buildUrl(`/templates/${encodeURIComponent(key)}`), {
    method: "DELETE"
  });
}
function createRule(templateKey, body) {
  return fetchJson(buildUrl(`/templates/${encodeURIComponent(templateKey)}/rules`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}
function updateRule(templateKey, ruleId, body) {
  return fetchJson(
    buildUrl(`/templates/${encodeURIComponent(templateKey)}/rules/${ruleId}`),
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }
  );
}
function deleteRule(templateKey, ruleId) {
  return fetchJson(
    buildUrl(`/templates/${encodeURIComponent(templateKey)}/rules/${ruleId}`),
    { method: "DELETE" }
  );
}
const EMPTY_RULE_JSON = '{\n  "attach_to": "project"\n}';
const TEMPLATE_KINDS = ["task", "checklist", "milestone"];
function TemplatesPanel({
  selectedTemplateKeyOverride,
  onSelectedTemplateKeyChange
}) {
  const [templatesState, setTemplatesState] = useState({});
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [templateDetailState, setTemplateDetailState] = useState({});
  const [templateDetailLoading, setTemplateDetailLoading] = useState(false);
  const [actionError, setActionError] = useState(null);
  const [selectedTemplateKey, setSelectedTemplateKey] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [templateForm, setTemplateForm] = useState({
    title: "",
    kind: "task",
    scope: "project",
    category_key: "",
    deliverable_key: "",
    default_position: "",
    default_state_json: "",
    is_active: true
  });
  const [ruleCreateForm, setRuleCreateForm] = useState({
    priority: "100",
    is_active: true,
    match_json: EMPTY_RULE_JSON
  });
  const [ruleEdits, setRuleEdits] = useState({});
  const [showNewTemplateModal, setShowNewTemplateModal] = useState(false);
  const [newTemplateForm, setNewTemplateForm] = useState({
    key: "",
    title: "",
    kind: "task",
    scope: "project",
    category_key: "",
    deliverable_key: "",
    default_position: "",
    default_state_json: "",
    is_active: true
  });
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [deletingTemplate, setDeletingTemplate] = useState(false);
  const [creatingTemplate, setCreatingTemplate] = useState(false);
  const [creatingRule, setCreatingRule] = useState(false);
  const [savingRuleId, setSavingRuleId] = useState(null);
  const [deletingRuleId, setDeletingRuleId] = useState(null);
  const updateSelectedTemplateKey = useCallback((nextKey, syncRoute = true) => {
    setSelectedTemplateKey(nextKey);
    if (syncRoute) {
      onSelectedTemplateKeyChange?.(nextKey);
    }
  }, [onSelectedTemplateKeyChange]);
  useEffect(() => {
    if (selectedTemplateKeyOverride === void 0) return;
    if (selectedTemplateKeyOverride === selectedTemplateKey) return;
    updateSelectedTemplateKey(selectedTemplateKeyOverride || "", false);
  }, [selectedTemplateKey, selectedTemplateKeyOverride, updateSelectedTemplateKey]);
  const refreshTemplates = useCallback(async () => {
    setTemplatesLoading(true);
    setActionError(null);
    const result = await listTemplates();
    setTemplatesState({
      status: result.status,
      durationMs: result.durationMs,
      data: result.data ?? void 0,
      text: result.text,
      error: result.ok ? void 0 : formatApiError(result, "Failed to load templates.")
    });
    if (result.ok && Array.isArray(result.data)) {
      const keys = result.data.map((item) => item.key);
      if (!selectedTemplateKey || !keys.includes(selectedTemplateKey)) {
        updateSelectedTemplateKey(keys[0] || "", !selectedTemplateKeyOverride);
      }
    }
    setTemplatesLoading(false);
  }, [selectedTemplateKey, selectedTemplateKeyOverride, updateSelectedTemplateKey]);
  const loadTemplateDetail = useCallback(async (key) => {
    if (!key) {
      setTemplateDetailState({});
      return;
    }
    setTemplateDetailLoading(true);
    setActionError(null);
    const result = await getTemplate(key);
    setTemplateDetailState({
      status: result.status,
      durationMs: result.durationMs,
      data: result.data ?? void 0,
      text: result.text,
      error: result.ok ? void 0 : formatApiError(result, "Failed to load template.")
    });
    setTemplateDetailLoading(false);
  }, []);
  useEffect(() => {
    if (templatesState.data) {
      return;
    }
    void refreshTemplates();
  }, [refreshTemplates, templatesState.data]);
  useEffect(() => {
    if (!selectedTemplateKey) {
      return;
    }
    void loadTemplateDetail(selectedTemplateKey);
  }, [loadTemplateDetail, selectedTemplateKey]);
  useEffect(() => {
    if (!templateDetailState.data) {
      return;
    }
    const template = templateDetailState.data.template;
    setTemplateForm({
      title: template.title ?? "",
      kind: template.kind ?? "task",
      scope: template.scope ?? "project",
      category_key: template.category_key ?? "",
      deliverable_key: template.deliverable_key ?? "",
      default_position: template.default_position !== null && template.default_position !== void 0 ? String(template.default_position) : "",
      default_state_json: template.default_state_json ?? "",
      is_active: Boolean(template.is_active)
    });
    const nextRuleEdits = {};
    for (const rule of templateDetailState.data.rules ?? []) {
      nextRuleEdits[rule.id] = {
        priority: String(rule.priority ?? ""),
        is_active: Boolean(rule.is_active),
        match_json: rule.match_json ?? ""
      };
    }
    setRuleEdits(nextRuleEdits);
  }, [templateDetailState.data]);
  const templates2 = useMemo(() => templatesState.data ?? [], [templatesState.data]);
  const filteredTemplates = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return templates2;
    return templates2.filter((template) => {
      return template.key.toLowerCase().includes(term) || template.title.toLowerCase().includes(term) || template.scope.toLowerCase().includes(term);
    });
  }, [templates2, searchTerm]);
  const templateDetail = templateDetailState.data;
  const rules = templateDetail?.rules ?? [];
  async function handleCreateTemplate() {
    if (!newTemplateForm.key.trim() || !newTemplateForm.title.trim()) {
      setActionError("Template key and title are required.");
      return;
    }
    const defaultState = parseJsonOrError(newTemplateForm.default_state_json);
    if (defaultState.error) {
      setActionError("Default state JSON must be valid.");
      return;
    }
    setCreatingTemplate(true);
    setActionError(null);
    const result = await createTemplate({
      key: newTemplateForm.key.trim(),
      title: newTemplateForm.title.trim(),
      kind: newTemplateForm.kind,
      scope: newTemplateForm.scope,
      category_key: newTemplateForm.category_key || void 0,
      deliverable_key: newTemplateForm.deliverable_key || void 0,
      default_state_json: defaultState.value,
      default_position: normalizePosition(newTemplateForm.default_position),
      is_active: newTemplateForm.is_active
    });
    if (!result.ok) {
      setActionError(formatApiError(result, "Failed to create template."));
      setCreatingTemplate(false);
      return;
    }
    setShowNewTemplateModal(false);
    setNewTemplateForm({
      key: "",
      title: "",
      kind: "task",
      scope: "project",
      category_key: "",
      deliverable_key: "",
      default_position: "",
      default_state_json: "",
      is_active: true
    });
    if (result.data?.template?.key) {
      updateSelectedTemplateKey(result.data.template.key);
      setTemplateDetailState({
        status: result.status,
        durationMs: result.durationMs,
        data: result.data,
        text: result.text
      });
    }
    await refreshTemplates();
    setCreatingTemplate(false);
  }
  async function handleUpdateTemplate() {
    if (!templateDetail?.template?.key) {
      return;
    }
    const defaultState = parseJsonOrError(templateForm.default_state_json);
    if (defaultState.error) {
      setActionError("Default state JSON must be valid.");
      return;
    }
    setSavingTemplate(true);
    setActionError(null);
    const result = await updateTemplate(templateDetail.template.key, {
      title: templateForm.title,
      kind: templateForm.kind,
      scope: templateForm.scope,
      category_key: templateForm.category_key || null,
      deliverable_key: templateForm.deliverable_key || null,
      default_state_json: defaultState.value,
      default_position: normalizePosition(templateForm.default_position),
      is_active: templateForm.is_active
    });
    if (!result.ok) {
      setActionError(formatApiError(result, "Failed to update template."));
      setSavingTemplate(false);
      return;
    }
    setTemplateDetailState({
      status: result.status,
      durationMs: result.durationMs,
      data: result.data ?? void 0,
      text: result.text
    });
    await refreshTemplates();
    setSavingTemplate(false);
  }
  async function handleDeleteTemplate() {
    if (!templateDetail?.template?.key) {
      return;
    }
    if (!confirm(`Delete template ${templateDetail.template.key}?`)) {
      return;
    }
    setDeletingTemplate(true);
    setActionError(null);
    const result = await deleteTemplate(templateDetail.template.key);
    if (!result.ok) {
      setActionError(formatApiError(result, "Failed to delete template."));
      setDeletingTemplate(false);
      return;
    }
    setTemplateDetailState({});
    updateSelectedTemplateKey("");
    await refreshTemplates();
    setDeletingTemplate(false);
  }
  async function handleCreateRule() {
    if (!templateDetail?.template?.key) {
      return;
    }
    setCreatingRule(true);
    setActionError(null);
    const priority = Number(ruleCreateForm.priority);
    if (Number.isNaN(priority)) {
      setActionError("Rule priority must be a number.");
      setCreatingRule(false);
      return;
    }
    const result = await createRule(templateDetail.template.key, {
      priority,
      match_json: ruleCreateForm.match_json,
      is_active: ruleCreateForm.is_active
    });
    if (!result.ok) {
      setActionError(formatApiError(result, "Failed to create rule."));
      setCreatingRule(false);
      return;
    }
    setRuleCreateForm({
      priority: "100",
      is_active: true,
      match_json: EMPTY_RULE_JSON
    });
    await loadTemplateDetail(templateDetail.template.key);
    setCreatingRule(false);
  }
  async function handleSaveRule(rule) {
    if (!templateDetail?.template?.key) {
      return;
    }
    const edit = ruleEdits[rule.id];
    if (!edit) {
      return;
    }
    const priority = Number(edit.priority);
    if (Number.isNaN(priority)) {
      setActionError("Rule priority must be a number.");
      return;
    }
    setSavingRuleId(rule.id);
    setActionError(null);
    const result = await updateRule(templateDetail.template.key, rule.id, {
      priority,
      match_json: edit.match_json,
      is_active: edit.is_active
    });
    if (!result.ok) {
      setActionError(formatApiError(result, "Failed to update rule."));
      setSavingRuleId(null);
      return;
    }
    await loadTemplateDetail(templateDetail.template.key);
    setSavingRuleId(null);
  }
  async function handleDeleteRule(rule) {
    if (!templateDetail?.template?.key) {
      return;
    }
    if (!confirm(`Delete rule ${rule.id}?`)) {
      return;
    }
    setDeletingRuleId(rule.id);
    setActionError(null);
    const result = await deleteRule(templateDetail.template.key, rule.id);
    if (!result.ok) {
      setActionError(formatApiError(result, "Failed to delete rule."));
      setDeletingRuleId(null);
      return;
    }
    await loadTemplateDetail(templateDetail.template.key);
    setDeletingRuleId(null);
  }
  function updateRuleEdit(ruleId, patch) {
    setRuleEdits((prev) => ({
      ...prev,
      [ruleId]: {
        ...prev[ruleId],
        ...patch
      }
    }));
  }
  return /* @__PURE__ */ jsxs("div", { className: "x78zum5 xdt5ytf xou54vl", children: [
    /* @__PURE__ */ jsxs("div", { className: "x78zum5 x1qughib x1v2ro7d x1a02dak", children: [
      /* @__PURE__ */ jsxs("div", { className: "x78zum5 x6s0dn4 x167g77z", children: [
        /* @__PURE__ */ jsx("label", { htmlFor: "template-search", children: "Search templates" }),
        /* @__PURE__ */ jsx("input", { id: "template-search", type: "text", placeholder: "Filter by key, title, scope", value: searchTerm, onChange: (event) => setSearchTerm(event.target.value) })
      ] }),
      /* @__PURE__ */ jsxs("div", { className: "x78zum5 x6s0dn4 x167g77z x1a02dak", children: [
        /* @__PURE__ */ jsx("button", { type: "button", onClick: refreshTemplates, disabled: templatesLoading, children: templatesLoading ? "Refreshing..." : "Refresh" }),
        /* @__PURE__ */ jsx("button", { type: "button", onClick: () => setShowNewTemplateModal(true), children: "New Template" })
      ] })
    ] }),
    templatesState.error && /* @__PURE__ */ jsx("div", { className: "x1tp81k5", children: templatesState.error }),
    actionError && /* @__PURE__ */ jsx("div", { className: "x1tp81k5", children: actionError }),
    /* @__PURE__ */ jsxs("div", { className: "xrvj5dj x1jptsyt xou54vl", children: [
      /* @__PURE__ */ jsxs("div", { className: "xur7f20 xc7ga6q xht5q6y x78zum5 xdt5ytf x167g77z", children: [
        /* @__PURE__ */ jsxs("div", { className: "x1s688f", children: [
          /* @__PURE__ */ jsx("strong", { children: "Templates" }),
          /* @__PURE__ */ jsxs("span", { children: [
            filteredTemplates.length,
            " shown"
          ] })
        ] }),
        filteredTemplates.length === 0 && /* @__PURE__ */ jsx("div", { className: "xo8r7s1", children: "No templates found." }),
        filteredTemplates.map((template) => {
          const isSelected = template.key === selectedTemplateKey;
          return /* @__PURE__ */ jsxs("button", { type: "button", className: {
            0: "xur7f20 x7z7khe xh2izcj xdpxx8g x1ypdohk",
            1: "xur7f20 x7z7khe xdpxx8g x1ypdohk x1hdarym x1tja46j"
          }[!!isSelected << 0], onClick: () => updateSelectedTemplateKey(template.key), children: [
            /* @__PURE__ */ jsx("div", { className: "x1s688f", children: template.key }),
            /* @__PURE__ */ jsxs("div", { className: "x78zum5 x17d4w8g x1a02dak xfifm61 x1e3jit", children: [
              /* @__PURE__ */ jsx("span", { children: template.title }),
              /* @__PURE__ */ jsxs("span", { children: [
                template.kind,
                " · ",
                template.scope,
                template.category_key ? ` · ${template.category_key}` : "",
                template.deliverable_key ? `/${template.deliverable_key}` : ""
              ] }),
              /* @__PURE__ */ jsx("span", { className: {
                0: "x1tp81k5 x1s688f",
                1: "x3ycguq x1s688f"
              }[!!template.is_active << 0], children: template.is_active ? "active" : "inactive" })
            ] })
          ] }, template.key);
        })
      ] }),
      /* @__PURE__ */ jsxs("div", { className: "xur7f20 xc7ga6q xht5q6y x78zum5 xdt5ytf x1v2ro7d", children: [
        /* @__PURE__ */ jsxs("div", { className: "x78zum5 x1qughib x167g77z x1a02dak", children: [
          /* @__PURE__ */ jsx("strong", { children: "Template Editor" }),
          templateDetailState.status !== void 0 && /* @__PURE__ */ jsxs("span", { className: "xfifm61 xo8r7s1", children: [
            "Status ",
            templateDetailState.status,
            " · ",
            templateDetailState.durationMs,
            "ms"
          ] })
        ] }),
        templateDetailLoading && /* @__PURE__ */ jsx("div", { className: "xo8r7s1", children: "Loading template details..." }),
        templateDetailState.error && /* @__PURE__ */ jsx("div", { className: "x1tp81k5", children: templateDetailState.error }),
        !templateDetail && !templateDetailLoading && /* @__PURE__ */ jsx("div", { className: "xo8r7s1", children: "Select a template to edit." }),
        templateDetail && /* @__PURE__ */ jsxs(Fragment, { children: [
          /* @__PURE__ */ jsxs("section", { className: "x1xmf6yo x78zum5 xdt5ytf x1v2ro7d", children: [
            /* @__PURE__ */ jsx("h3", { children: "Template" }),
            /* @__PURE__ */ jsxs("div", { className: "xrvj5dj x1v2ro7d", children: [
              /* @__PURE__ */ jsxs("label", { children: [
                "Key",
                /* @__PURE__ */ jsx("input", { type: "text", value: templateDetail.template.key, disabled: true })
              ] }),
              /* @__PURE__ */ jsxs("label", { children: [
                "Title",
                /* @__PURE__ */ jsx("input", { type: "text", value: templateForm.title, onChange: (event) => setTemplateForm((prev) => ({
                  ...prev,
                  title: event.target.value
                })) })
              ] }),
              /* @__PURE__ */ jsxs("label", { children: [
                "Kind",
                /* @__PURE__ */ jsx("select", { value: templateForm.kind, onChange: (event) => setTemplateForm((prev) => ({
                  ...prev,
                  kind: event.target.value
                })), children: TEMPLATE_KINDS.map((kind) => /* @__PURE__ */ jsx("option", { value: kind, children: kind }, kind)) })
              ] }),
              /* @__PURE__ */ jsxs("label", { children: [
                "Scope",
                /* @__PURE__ */ jsxs("select", { value: templateForm.scope, onChange: (event) => setTemplateForm((prev) => ({
                  ...prev,
                  scope: event.target.value
                })), children: [
                  /* @__PURE__ */ jsx("option", { value: "project", children: "project" }),
                  /* @__PURE__ */ jsx("option", { value: "shared", children: "shared" }),
                  /* @__PURE__ */ jsx("option", { value: "deliverable", children: "deliverable" })
                ] })
              ] }),
              /* @__PURE__ */ jsxs("label", { children: [
                "Category Key",
                /* @__PURE__ */ jsx("input", { type: "text", value: templateForm.category_key, onChange: (event) => setTemplateForm((prev) => ({
                  ...prev,
                  category_key: event.target.value
                })) })
              ] }),
              /* @__PURE__ */ jsxs("label", { children: [
                "Deliverable Key",
                /* @__PURE__ */ jsx("input", { type: "text", value: templateForm.deliverable_key, onChange: (event) => setTemplateForm((prev) => ({
                  ...prev,
                  deliverable_key: event.target.value
                })) })
              ] }),
              /* @__PURE__ */ jsxs("label", { children: [
                "Default Position",
                /* @__PURE__ */ jsx("input", { type: "number", value: templateForm.default_position, onChange: (event) => setTemplateForm((prev) => ({
                  ...prev,
                  default_position: event.target.value
                })) })
              ] }),
              /* @__PURE__ */ jsxs("label", { className: "x3nfvp2 x17d4w8g x6s0dn4", children: [
                /* @__PURE__ */ jsx("input", { type: "checkbox", checked: templateForm.is_active, onChange: (event) => setTemplateForm((prev) => ({
                  ...prev,
                  is_active: event.target.checked
                })) }),
                "Active"
              ] })
            ] }),
            /* @__PURE__ */ jsxs("details", { className: "xur7f20 x7z7khe", children: [
              /* @__PURE__ */ jsx("summary", { children: "Advanced: Default State JSON" }),
              /* @__PURE__ */ jsx("textarea", { rows: 6, value: templateForm.default_state_json, onChange: (event) => setTemplateForm((prev) => ({
                ...prev,
                default_state_json: event.target.value
              })) })
            ] }),
            /* @__PURE__ */ jsxs("div", { className: "x78zum5 x6s0dn4 x167g77z x1a02dak", children: [
              /* @__PURE__ */ jsx("button", { type: "button", onClick: handleUpdateTemplate, disabled: savingTemplate, children: savingTemplate ? "Saving..." : "Save Template" }),
              /* @__PURE__ */ jsx("button", { type: "button", className: "x1el1eiv x1tp81k5 xk61eof xur7f20 x1ypdohk", onClick: handleDeleteTemplate, disabled: deletingTemplate, children: deletingTemplate ? "Deleting..." : "Delete Template" })
            ] })
          ] }),
          /* @__PURE__ */ jsxs("section", { className: "x1xmf6yo x78zum5 xdt5ytf x1v2ro7d", children: [
            /* @__PURE__ */ jsx("h3", { children: "Rules" }),
            /* @__PURE__ */ jsxs("div", { className: "xur7f20 x7z7khe xh2izcj", children: [
              /* @__PURE__ */ jsxs("label", { children: [
                "Priority",
                /* @__PURE__ */ jsx("input", { type: "number", value: ruleCreateForm.priority, onChange: (event) => setRuleCreateForm((prev) => ({
                  ...prev,
                  priority: event.target.value
                })) })
              ] }),
              /* @__PURE__ */ jsxs("label", { className: "x3nfvp2 x17d4w8g x6s0dn4", children: [
                /* @__PURE__ */ jsx("input", { type: "checkbox", checked: ruleCreateForm.is_active, onChange: (event) => setRuleCreateForm((prev) => ({
                  ...prev,
                  is_active: event.target.checked
                })) }),
                "Active"
              ] }),
              /* @__PURE__ */ jsxs("label", { className: "x78zum5 xdt5ytf x17d4w8g", children: [
                "Match JSON",
                /* @__PURE__ */ jsx("textarea", { rows: 4, value: ruleCreateForm.match_json, onChange: (event) => setRuleCreateForm((prev) => ({
                  ...prev,
                  match_json: event.target.value
                })) })
              ] }),
              /* @__PURE__ */ jsx("button", { type: "button", onClick: handleCreateRule, disabled: creatingRule, children: creatingRule ? "Creating..." : "Create Rule" })
            ] }),
            rules.length === 0 && /* @__PURE__ */ jsx("div", { className: "xo8r7s1", children: "No rules yet." }),
            /* @__PURE__ */ jsx("div", { className: "x78zum5 xdt5ytf x883omv", children: rules.map((rule) => {
              const edit = ruleEdits[rule.id];
              const attachTo = getAttachTo(rule.match_json);
              return /* @__PURE__ */ jsxs("div", { className: "xur7f20 x7z7khe xht5q6y", children: [
                /* @__PURE__ */ jsxs("div", { className: "x78zum5 x167g77z x6s0dn4 x1e56ztr", children: [
                  /* @__PURE__ */ jsxs("strong", { children: [
                    "Rule ",
                    rule.id
                  ] }),
                  attachTo && /* @__PURE__ */ jsx("span", { className: "x1dumkz1 xur7f20 x1j6dyjg x1tiokuu xw5m2i1", children: attachTo })
                ] }),
                /* @__PURE__ */ jsxs("div", { className: "xrvj5dj x1v2ro7d", children: [
                  /* @__PURE__ */ jsxs("label", { children: [
                    "Priority",
                    /* @__PURE__ */ jsx("input", { type: "number", value: edit?.priority ?? "", onChange: (event) => updateRuleEdit(rule.id, {
                      priority: event.target.value
                    }) })
                  ] }),
                  /* @__PURE__ */ jsxs("label", { className: "x3nfvp2 x17d4w8g x6s0dn4", children: [
                    /* @__PURE__ */ jsx("input", { type: "checkbox", checked: edit?.is_active ?? false, onChange: (event) => updateRuleEdit(rule.id, {
                      is_active: event.target.checked
                    }) }),
                    "Active"
                  ] }),
                  /* @__PURE__ */ jsxs("label", { className: "x78zum5 xdt5ytf x17d4w8g", children: [
                    "Match JSON",
                    /* @__PURE__ */ jsx("textarea", { rows: 4, value: edit?.match_json ?? "", onChange: (event) => updateRuleEdit(rule.id, {
                      match_json: event.target.value
                    }) })
                  ] })
                ] }),
                /* @__PURE__ */ jsxs("div", { className: "x78zum5 x6s0dn4 x167g77z x1a02dak", children: [
                  /* @__PURE__ */ jsx("button", { type: "button", onClick: () => handleSaveRule(rule), disabled: savingRuleId === rule.id, children: savingRuleId === rule.id ? "Saving..." : "Save" }),
                  /* @__PURE__ */ jsx("button", { type: "button", className: "x1el1eiv x1tp81k5 xk61eof xur7f20 x1ypdohk", onClick: () => handleDeleteRule(rule), disabled: deletingRuleId === rule.id, children: deletingRuleId === rule.id ? "Deleting..." : "Delete" })
                ] })
              ] }, rule.id);
            }) })
          ] }),
          /* @__PURE__ */ jsxs("section", { className: "x1xmf6yo x78zum5 xdt5ytf x1v2ro7d", children: [
            /* @__PURE__ */ jsx("h3", { children: "Raw JSON" }),
            /* @__PURE__ */ jsx("div", { className: "xur7f20 x7z7khe xh2izcj", children: /* @__PURE__ */ jsx(JsonView, { data: templateDetail }) })
          ] })
        ] })
      ] })
    ] }),
    showNewTemplateModal && /* @__PURE__ */ jsx("div", { className: "xixxii4 x10a8y8t x1i66cv5 x78zum5 x6s0dn4 xl56j7k xggk2y7", role: "dialog", "aria-modal": "true", children: /* @__PURE__ */ jsxs("div", { className: "xht5q6y xur7f20 x1qhigcl xoww62b", children: [
      /* @__PURE__ */ jsx("h3", { children: "New Template" }),
      /* @__PURE__ */ jsxs("div", { className: "xrvj5dj x1v2ro7d", children: [
        /* @__PURE__ */ jsxs("label", { children: [
          "Key",
          /* @__PURE__ */ jsx("input", { type: "text", value: newTemplateForm.key, onChange: (event) => setNewTemplateForm((prev) => ({
            ...prev,
            key: event.target.value
          })) })
        ] }),
        /* @__PURE__ */ jsxs("label", { children: [
          "Title",
          /* @__PURE__ */ jsx("input", { type: "text", value: newTemplateForm.title, onChange: (event) => setNewTemplateForm((prev) => ({
            ...prev,
            title: event.target.value
          })) })
        ] }),
        /* @__PURE__ */ jsxs("label", { children: [
          "Kind",
          /* @__PURE__ */ jsx("select", { value: newTemplateForm.kind, onChange: (event) => setNewTemplateForm((prev) => ({
            ...prev,
            kind: event.target.value
          })), children: TEMPLATE_KINDS.map((kind) => /* @__PURE__ */ jsx("option", { value: kind, children: kind }, kind)) })
        ] }),
        /* @__PURE__ */ jsxs("label", { children: [
          "Scope",
          /* @__PURE__ */ jsxs("select", { value: newTemplateForm.scope, onChange: (event) => setNewTemplateForm((prev) => ({
            ...prev,
            scope: event.target.value
          })), children: [
            /* @__PURE__ */ jsx("option", { value: "project", children: "project" }),
            /* @__PURE__ */ jsx("option", { value: "shared", children: "shared" }),
            /* @__PURE__ */ jsx("option", { value: "deliverable", children: "deliverable" })
          ] })
        ] }),
        newTemplateForm.scope === "deliverable" && /* @__PURE__ */ jsxs(Fragment, { children: [
          /* @__PURE__ */ jsxs("label", { children: [
            "Category Key",
            /* @__PURE__ */ jsx("input", { type: "text", value: newTemplateForm.category_key, onChange: (event) => setNewTemplateForm((prev) => ({
              ...prev,
              category_key: event.target.value
            })) })
          ] }),
          /* @__PURE__ */ jsxs("label", { children: [
            "Deliverable Key",
            /* @__PURE__ */ jsx("input", { type: "text", value: newTemplateForm.deliverable_key, onChange: (event) => setNewTemplateForm((prev) => ({
              ...prev,
              deliverable_key: event.target.value
            })) })
          ] })
        ] }),
        /* @__PURE__ */ jsxs("label", { children: [
          "Default Position",
          /* @__PURE__ */ jsx("input", { type: "number", value: newTemplateForm.default_position, onChange: (event) => setNewTemplateForm((prev) => ({
            ...prev,
            default_position: event.target.value
          })) })
        ] }),
        /* @__PURE__ */ jsxs("label", { className: "x3nfvp2 x17d4w8g x6s0dn4", children: [
          /* @__PURE__ */ jsx("input", { type: "checkbox", checked: newTemplateForm.is_active, onChange: (event) => setNewTemplateForm((prev) => ({
            ...prev,
            is_active: event.target.checked
          })) }),
          "Active"
        ] })
      ] }),
      /* @__PURE__ */ jsxs("details", { className: "xur7f20 x7z7khe", children: [
        /* @__PURE__ */ jsx("summary", { children: "Advanced: Default State JSON" }),
        /* @__PURE__ */ jsx("textarea", { rows: 6, value: newTemplateForm.default_state_json, onChange: (event) => setNewTemplateForm((prev) => ({
          ...prev,
          default_state_json: event.target.value
        })) })
      ] }),
      /* @__PURE__ */ jsxs("div", { className: "x78zum5 x6s0dn4 x167g77z x1a02dak", children: [
        /* @__PURE__ */ jsx("button", { type: "button", onClick: handleCreateTemplate, disabled: creatingTemplate, children: creatingTemplate ? "Creating..." : "Create" }),
        /* @__PURE__ */ jsx("button", { type: "button", className: "xht5q6y xvqfk9l xk61eof xur7f20 x1ypdohk", onClick: () => setShowNewTemplateModal(false), children: "Cancel" })
      ] })
    ] }) })
  ] });
}
function formatApiError(result, fallback) {
  if (result.data && typeof result.data === "object") {
    const data = result.data;
    if (data.error) {
      return data.details ? `${data.error}: ${JSON.stringify(data.details)}` : data.error;
    }
  }
  if (result.text) {
    return result.text;
  }
  return fallback;
}
function getAttachTo(matchJson) {
  try {
    const parsed = JSON.parse(matchJson);
    return parsed.attach_to || "";
  } catch {
    return "";
  }
}
function parseJsonOrError(value) {
  if (!value.trim()) {
    return {
      value: null,
      error: false
    };
  }
  try {
    return {
      value: JSON.parse(value),
      error: false
    };
  } catch {
    return {
      value: null,
      error: true
    };
  }
}
function normalizePosition(value) {
  if (!value.trim()) {
    return null;
  }
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}
async function listIntegrations(workspaceId) {
  return fetchJson(
    buildUrl("/integrations", workspaceId ? { workspaceId } : void 0)
  );
}
async function createIntegration(body) {
  return fetchJson(buildUrl("/integrations"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}
async function updateIntegration(id, body) {
  return fetchJson(buildUrl(`/integrations/${id}`), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}
async function deleteIntegration(id) {
  return fetchJson(buildUrl(`/integrations/${id}`), { method: "DELETE" });
}
const PROVIDERS$1 = [{
  value: "shopify",
  label: "Shopify"
}, {
  value: "qbo",
  label: "QuickBooks"
}];
const ENVIRONMENTS$1 = ["sandbox", "production"];
function IntegrationsPanel({
  workspaceId,
  workspaces: workspaces2
}) {
  const [integrations2, setIntegrations] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [provider, setProvider] = useState("shopify");
  const [environment, setEnvironment] = useState("production");
  const [externalAccountId, setExternalAccountId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [secretValue, setSecretValue] = useState("");
  const [secretUpdate, setSecretUpdate] = useState({});
  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await listIntegrations(workspaceId);
    if (result.ok) {
      setIntegrations(result.data ?? []);
    } else {
      setError(result.text || "Failed to load integrations.");
    }
    setLoading(false);
  }, [workspaceId]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  async function submitIntegration() {
    if (!workspaceId) {
      setError("Select a workspace first.");
      return;
    }
    const secrets = provider === "shopify" ? {
      webhookSecret: secretValue
    } : {
      webhookVerifierToken: secretValue
    };
    const result = await createIntegration({
      workspaceId,
      provider,
      environment,
      externalAccountId,
      displayName,
      secrets
    });
    if (!result.ok) {
      setError(result.text || "Failed to create integration.");
      return;
    }
    setExternalAccountId("");
    setDisplayName("");
    setSecretValue("");
    await refresh();
  }
  async function toggleActive(integration) {
    await updateIntegration(integration.id, {
      is_active: integration.is_active ? 0 : 1
    });
    await refresh();
  }
  async function saveSecrets(integration) {
    const next = secretUpdate[integration.id]?.trim();
    if (!next) return;
    const secrets = integration.provider === "shopify" ? {
      webhookSecret: next
    } : {
      webhookVerifierToken: next
    };
    await updateIntegration(integration.id, {
      secrets
    });
    setSecretUpdate((prev) => ({
      ...prev,
      [integration.id]: ""
    }));
    await refresh();
  }
  async function removeIntegration(id) {
    await deleteIntegration(id);
    await refresh();
  }
  return /* @__PURE__ */ jsxs("section", { className: "x15ji50x", children: [
    /* @__PURE__ */ jsx("h2", { children: "Integrations" }),
    /* @__PURE__ */ jsxs("p", { className: "xo8r7s1", children: [
      "Webhook endpoints:",
      /* @__PURE__ */ jsx("br", {}),
      "Shopify: ",
      /* @__PURE__ */ jsx("code", { children: "https://api.from-trees.com/ingest/shopify/webhook?env=production" }),
      /* @__PURE__ */ jsx("br", {}),
      "QBO: ",
      /* @__PURE__ */ jsx("code", { children: "https://api.from-trees.com/ingest/qbo/webhook?env=production" })
    ] }),
    /* @__PURE__ */ jsxs("div", { className: "xw7yly9", children: [
      /* @__PURE__ */ jsx("h3", { children: "Create Integration" }),
      /* @__PURE__ */ jsxs("div", { className: "xrvj5dj x1v2ro7d", children: [
        /* @__PURE__ */ jsxs("div", { className: "x78zum5 xdt5ytf x17d4w8g", children: [
          /* @__PURE__ */ jsx("label", { children: "Workspace" }),
          /* @__PURE__ */ jsx("select", { value: workspaceId ?? "", onChange: () => void 0, disabled: true, children: workspaces2.map((workspace) => /* @__PURE__ */ jsx("option", { value: workspace.id, children: workspace.name }, workspace.id)) })
        ] }),
        /* @__PURE__ */ jsxs("div", { className: "x78zum5 xdt5ytf x17d4w8g", children: [
          /* @__PURE__ */ jsx("label", { children: "Provider" }),
          /* @__PURE__ */ jsx("select", { value: provider, onChange: (event) => setProvider(event.target.value), children: PROVIDERS$1.map((item) => /* @__PURE__ */ jsx("option", { value: item.value, children: item.label }, item.value)) })
        ] }),
        /* @__PURE__ */ jsxs("div", { className: "x78zum5 xdt5ytf x17d4w8g", children: [
          /* @__PURE__ */ jsx("label", { children: "Environment" }),
          /* @__PURE__ */ jsx("select", { value: environment, onChange: (event) => setEnvironment(event.target.value), children: ENVIRONMENTS$1.map((item) => /* @__PURE__ */ jsx("option", { value: item, children: item }, item)) })
        ] }),
        /* @__PURE__ */ jsxs("div", { className: "x78zum5 xdt5ytf x17d4w8g", children: [
          /* @__PURE__ */ jsx("label", { children: "External account ID" }),
          /* @__PURE__ */ jsx("input", { value: externalAccountId, onChange: (event) => setExternalAccountId(event.target.value), placeholder: provider === "shopify" ? "shop.myshopify.com" : "realmId" })
        ] }),
        /* @__PURE__ */ jsxs("div", { className: "x78zum5 xdt5ytf x17d4w8g", children: [
          /* @__PURE__ */ jsx("label", { children: "Display name" }),
          /* @__PURE__ */ jsx("input", { value: displayName, onChange: (event) => setDisplayName(event.target.value), placeholder: "Optional label" })
        ] }),
        /* @__PURE__ */ jsxs("div", { className: "x78zum5 xdt5ytf x17d4w8g", children: [
          /* @__PURE__ */ jsx("label", { children: provider === "shopify" ? "Webhook secret" : "Webhook verifier token" }),
          /* @__PURE__ */ jsx("input", { value: secretValue, onChange: (event) => setSecretValue(event.target.value), placeholder: "Secret" })
        ] })
      ] }),
      /* @__PURE__ */ jsx("div", { className: "x78zum5 x1a02dak x167g77z x1anpbxc", children: /* @__PURE__ */ jsx("button", { type: "button", onClick: submitIntegration, children: "Save integration" }) }),
      error && /* @__PURE__ */ jsx("div", { className: "x1tp81k5", children: error })
    ] }),
    /* @__PURE__ */ jsxs("div", { className: "xw7yly9", children: [
      /* @__PURE__ */ jsx("h3", { children: "Existing Integrations" }),
      loading && /* @__PURE__ */ jsx("p", { className: "xo8r7s1", children: "Loading..." }),
      integrations2.length === 0 && !loading && /* @__PURE__ */ jsx("p", { className: "xo8r7s1", children: "None yet." }),
      /* @__PURE__ */ jsx("div", { className: "x9hd93c xw2csxc", children: /* @__PURE__ */ jsxs("table", { children: [
        /* @__PURE__ */ jsx("thead", { children: /* @__PURE__ */ jsxs("tr", { children: [
          /* @__PURE__ */ jsx("th", { children: "Provider" }),
          /* @__PURE__ */ jsx("th", { children: "Env" }),
          /* @__PURE__ */ jsx("th", { children: "Account" }),
          /* @__PURE__ */ jsx("th", { children: "Name" }),
          /* @__PURE__ */ jsx("th", { children: "Active" }),
          /* @__PURE__ */ jsx("th", { children: "Secrets" }),
          /* @__PURE__ */ jsx("th", { children: "Actions" })
        ] }) }),
        /* @__PURE__ */ jsx("tbody", { children: integrations2.map((integration) => /* @__PURE__ */ jsxs("tr", { children: [
          /* @__PURE__ */ jsx("td", { children: integration.provider }),
          /* @__PURE__ */ jsx("td", { children: integration.environment }),
          /* @__PURE__ */ jsx("td", { children: integration.external_account_id }),
          /* @__PURE__ */ jsx("td", { children: integration.display_name ?? "-" }),
          /* @__PURE__ */ jsx("td", { children: integration.is_active ? "yes" : "no" }),
          /* @__PURE__ */ jsx("td", { children: /* @__PURE__ */ jsx("input", { value: secretUpdate[integration.id] ?? "", onChange: (event) => setSecretUpdate((prev) => ({
            ...prev,
            [integration.id]: event.target.value
          })), placeholder: "Replace secret" }) }),
          /* @__PURE__ */ jsxs("td", { children: [
            /* @__PURE__ */ jsx("button", { type: "button", onClick: () => saveSecrets(integration), children: "Save secret" }),
            /* @__PURE__ */ jsx("button", { type: "button", className: "xht5q6y xvqfk9l xk61eof xiq63ov x1ypdohk x16vho4v", onClick: () => toggleActive(integration), children: integration.is_active ? "Disable" : "Enable" }),
            /* @__PURE__ */ jsx("button", { type: "button", className: "x1el1eiv x1tp81k5 xk61eof xiq63ov x1ypdohk x16vho4v", onClick: () => removeIntegration(integration.id), children: "Delete" })
          ] })
        ] }, integration.id)) })
      ] }) })
    ] })
  ] });
}
async function listIngestRequests(params) {
  return fetchJson(buildUrl("/ingest/requests", params));
}
async function getIngestRequest(id) {
  return fetchJson(buildUrl(`/ingest/requests/${id}`));
}
const PROVIDERS = ["shopify", "qbo"];
const ENVIRONMENTS = ["production", "sandbox"];
function IngestPanel({
  workspaceId,
  workspaces: workspaces2
}) {
  const [provider, setProvider] = useState("shopify");
  const [environment, setEnvironment] = useState("production");
  const [requests, setRequests] = useState([]);
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const workspaceMap = new Map(workspaces2.map((ws) => [ws.id, ws.name]));
  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await listIngestRequests({
      provider,
      environment,
      workspaceId: workspaceId ?? void 0,
      limit: 50
    });
    if (result.ok) {
      setRequests(result.data?.requests ?? []);
      setSelected(null);
    } else {
      setError(result.text || "Failed to load ingest requests.");
    }
    setLoading(false);
  }, [environment, provider, workspaceId]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  async function loadDetail(id) {
    const result = await getIngestRequest(id);
    if (result.ok) {
      setSelected(result.data ?? null);
    } else {
      setError(result.text || "Failed to load detail.");
    }
  }
  return /* @__PURE__ */ jsxs("section", { className: "x15ji50x", children: [
    /* @__PURE__ */ jsx("h2", { children: "Ingest" }),
    /* @__PURE__ */ jsxs("div", { className: "x78zum5 x167g77z x1a02dak x6s0dn4", children: [
      /* @__PURE__ */ jsx("select", { value: provider, onChange: (event) => setProvider(event.target.value), children: PROVIDERS.map((item) => /* @__PURE__ */ jsx("option", { value: item, children: item }, item)) }),
      /* @__PURE__ */ jsx("select", { value: environment, onChange: (event) => setEnvironment(event.target.value), children: ENVIRONMENTS.map((item) => /* @__PURE__ */ jsx("option", { value: item, children: item }, item)) }),
      /* @__PURE__ */ jsx("select", { value: workspaceId ?? "", onChange: () => void 0, disabled: true, children: workspaces2.map((workspace) => /* @__PURE__ */ jsx("option", { value: workspace.id, children: workspace.name }, workspace.id)) }),
      /* @__PURE__ */ jsx("button", { type: "button", onClick: refresh, disabled: loading, children: loading ? "Loading..." : "Refresh" })
    ] }),
    error && /* @__PURE__ */ jsx("div", { className: "x1tp81k5", children: error }),
    /* @__PURE__ */ jsxs("div", { className: "xrvj5dj xzi7dhk xou54vl xw7yly9", children: [
      /* @__PURE__ */ jsx("div", { className: "x9hd93c xw2csxc xht5q6y", children: /* @__PURE__ */ jsxs("table", { children: [
        /* @__PURE__ */ jsx("thead", { children: /* @__PURE__ */ jsxs("tr", { children: [
          /* @__PURE__ */ jsx("th", { children: "received_at" }),
          /* @__PURE__ */ jsx("th", { children: "workspace" }),
          /* @__PURE__ */ jsx("th", { children: "integration" }),
          /* @__PURE__ */ jsx("th", { children: "routed" }),
          /* @__PURE__ */ jsx("th", { children: "verified" }),
          /* @__PURE__ */ jsx("th", { children: "topic" }),
          /* @__PURE__ */ jsx("th", { children: "shop" }),
          /* @__PURE__ */ jsx("th", { children: "webhook_id" }),
          /* @__PURE__ */ jsx("th", { children: "error" })
        ] }) }),
        /* @__PURE__ */ jsxs("tbody", { children: [
          requests.map((request) => /* @__PURE__ */ jsxs("tr", { onClick: () => loadDetail(request.id), children: [
            /* @__PURE__ */ jsx("td", { children: request.received_at }),
            /* @__PURE__ */ jsx("td", { children: workspaceMap.get(request.workspace_id) ?? request.workspace_id }),
            /* @__PURE__ */ jsx("td", { children: request.integration_display_name ?? "-" }),
            /* @__PURE__ */ jsx("td", { children: request.integration_id ? "yes" : "no" }),
            /* @__PURE__ */ jsx("td", { children: request.signature_verified ? "yes" : "no" }),
            /* @__PURE__ */ jsx("td", { children: request.topic ?? "-" }),
            /* @__PURE__ */ jsx("td", { children: request.shop_domain ?? "-" }),
            /* @__PURE__ */ jsx("td", { children: request.webhook_id ?? "-" }),
            /* @__PURE__ */ jsx("td", { children: request.verify_error ?? "-" })
          ] }, request.id)),
          requests.length === 0 && /* @__PURE__ */ jsx("tr", { children: /* @__PURE__ */ jsx("td", { colSpan: 10, className: "xo8r7s1", children: "No requests." }) })
        ] })
      ] }) }),
      /* @__PURE__ */ jsx("div", { className: "x9hd93c xc7ga6q xht5q6y", children: selected ? /* @__PURE__ */ jsxs(Fragment, { children: [
        /* @__PURE__ */ jsx("h3", { children: "Request Detail" }),
        /* @__PURE__ */ jsx("pre", { children: JSON.stringify(selected, null, 2) })
      ] }) : /* @__PURE__ */ jsx("p", { className: "xo8r7s1", children: "Select a request to inspect." }) })
    ] })
  ] });
}
async function listWorkspaces() {
  return fetchJson(buildUrl("/workspaces"));
}
async function createWorkspace(body) {
  return fetchJson(buildUrl("/workspaces"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}
async function updateWorkspace(id, body) {
  return fetchJson(buildUrl(`/workspaces/${id}`), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}
async function deleteWorkspace(id) {
  return fetchJson(buildUrl(`/workspaces/${id}`), { method: "DELETE" });
}
const SLUG_REGEX = /^[a-z0-9-]{3,40}$/;
function WorkspacesPanel({
  selectedWorkspaceId,
  onSelectWorkspace
}) {
  const [workspaces2, setWorkspaces] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [createSlug, setCreateSlug] = useState("");
  const [createName, setCreateName] = useState("");
  const [editTarget, setEditTarget] = useState(null);
  const [editSlug, setEditSlug] = useState("");
  const [editName, setEditName] = useState("");
  const [deleteError, setDeleteError] = useState(null);
  useEffect(() => {
    void refresh();
  }, []);
  async function refresh() {
    setLoading(true);
    setError(null);
    const result = await listWorkspaces();
    if (result.ok) {
      setWorkspaces(result.data ?? []);
    } else {
      setError(result.text || "Failed to load workspaces.");
    }
    setLoading(false);
  }
  async function handleCreate() {
    if (!SLUG_REGEX.test(createSlug)) {
      setError("Slug must be 3-40 chars: lowercase letters, digits, hyphens.");
      return;
    }
    if (!createName.trim()) {
      setError("Name is required.");
      return;
    }
    const result = await createWorkspace({
      slug: createSlug,
      name: createName
    });
    if (!result.ok) {
      setError(result.text || "Failed to create workspace.");
      return;
    }
    setCreateSlug("");
    setCreateName("");
    await refresh();
  }
  async function handleUpdate() {
    if (!editTarget) return;
    if (editSlug && !SLUG_REGEX.test(editSlug)) {
      setError("Slug must be 3-40 chars: lowercase letters, digits, hyphens.");
      return;
    }
    const result = await updateWorkspace(editTarget.id, {
      slug: editSlug || editTarget.slug || void 0,
      name: editName || editTarget.name
    });
    if (!result.ok) {
      setError(result.text || "Failed to update workspace.");
      return;
    }
    setEditTarget(null);
    setEditSlug("");
    setEditName("");
    await refresh();
  }
  async function handleDelete(workspace) {
    if (!confirm(`Delete workspace ${workspace.slug}?`)) {
      return;
    }
    setDeleteError(null);
    const result = await deleteWorkspace(workspace.id);
    if (!result.ok) {
      let message = result.text || "Delete failed.";
      if (result.data && typeof result.data === "object") {
        const payload = result.data;
        if (payload.error === "workspace_not_empty" && payload.counts) {
          const detail = Object.entries(payload.counts).map(([key, value]) => `${key}: ${value}`).join(", ");
          message = `Workspace not empty. ${detail}`;
        }
        if (payload.error === "cannot_delete_default_workspace") {
          message = "Default workspace cannot be deleted.";
        }
      }
      setDeleteError(message);
      return;
    }
    if (selectedWorkspaceId === workspace.id) {
      onSelectWorkspace(null);
    }
    await refresh();
  }
  return /* @__PURE__ */ jsxs("section", { className: "x15ji50x", children: [
    /* @__PURE__ */ jsx("h2", { children: "Workspaces" }),
    error && /* @__PURE__ */ jsx("div", { className: "x1tp81k5", children: error }),
    deleteError && /* @__PURE__ */ jsx("div", { className: "x1tp81k5", children: deleteError }),
    /* @__PURE__ */ jsxs("div", { className: "xw7yly9", children: [
      /* @__PURE__ */ jsx("h3", { children: "Create Workspace" }),
      /* @__PURE__ */ jsxs("div", { className: "xrvj5dj x1v2ro7d", children: [
        /* @__PURE__ */ jsxs("div", { className: "x78zum5 xdt5ytf x17d4w8g", children: [
          /* @__PURE__ */ jsx("label", { children: "Slug" }),
          /* @__PURE__ */ jsx("input", { value: createSlug, onChange: (event) => setCreateSlug(event.target.value), placeholder: "acme-production" })
        ] }),
        /* @__PURE__ */ jsxs("div", { className: "x78zum5 xdt5ytf x17d4w8g", children: [
          /* @__PURE__ */ jsx("label", { children: "Name" }),
          /* @__PURE__ */ jsx("input", { value: createName, onChange: (event) => setCreateName(event.target.value), placeholder: "Acme Production" })
        ] })
      ] }),
      /* @__PURE__ */ jsx("div", { className: "x78zum5 x167g77z x1anpbxc x1a02dak", children: /* @__PURE__ */ jsx("button", { type: "button", onClick: handleCreate, children: "Create" }) })
    ] }),
    /* @__PURE__ */ jsxs("div", { className: "xw7yly9", children: [
      /* @__PURE__ */ jsx("h3", { children: "Existing Workspaces" }),
      loading && /* @__PURE__ */ jsx("p", { className: "xo8r7s1", children: "Loading..." }),
      /* @__PURE__ */ jsx("div", { className: "xur7f20 xw2csxc", children: /* @__PURE__ */ jsxs("table", { children: [
        /* @__PURE__ */ jsx("thead", { children: /* @__PURE__ */ jsxs("tr", { children: [
          /* @__PURE__ */ jsx("th", { children: "slug" }),
          /* @__PURE__ */ jsx("th", { children: "name" }),
          /* @__PURE__ */ jsx("th", { children: "created" }),
          /* @__PURE__ */ jsx("th", { children: "updated" }),
          /* @__PURE__ */ jsx("th", { children: "actions" })
        ] }) }),
        /* @__PURE__ */ jsxs("tbody", { children: [
          workspaces2.map((workspace) => /* @__PURE__ */ jsxs("tr", { children: [
            /* @__PURE__ */ jsx("td", { children: workspace.slug ?? "-" }),
            /* @__PURE__ */ jsx("td", { children: workspace.name }),
            /* @__PURE__ */ jsx("td", { children: workspace.created_at ?? "-" }),
            /* @__PURE__ */ jsx("td", { children: workspace.updated_at ?? "-" }),
            /* @__PURE__ */ jsxs("td", { children: [
              /* @__PURE__ */ jsx("button", { type: "button", onClick: () => {
                setEditTarget(workspace);
                setEditSlug(workspace.slug ?? "");
                setEditName(workspace.name);
              }, children: "Edit" }),
              /* @__PURE__ */ jsx("button", { type: "button", className: "x1el1eiv x1tp81k5 xk61eof xur7f20 x1ypdohk x16vho4v", onClick: () => handleDelete(workspace), children: "Delete" })
            ] })
          ] }, workspace.id)),
          workspaces2.length === 0 && !loading && /* @__PURE__ */ jsx("tr", { children: /* @__PURE__ */ jsx("td", { colSpan: 5, className: "xo8r7s1", children: "No workspaces yet." }) })
        ] })
      ] }) })
    ] }),
    editTarget && /* @__PURE__ */ jsx("div", { className: "xixxii4 x10a8y8t x1i66cv5 x78zum5 x6s0dn4 xl56j7k xggk2y7", children: /* @__PURE__ */ jsxs("div", { className: "xht5q6y xur7f20 x1qhigcl x1cy49o3", children: [
      /* @__PURE__ */ jsx("h3", { children: "Edit Workspace" }),
      /* @__PURE__ */ jsxs("div", { className: "xrvj5dj x1v2ro7d", children: [
        /* @__PURE__ */ jsxs("div", { className: "x78zum5 xdt5ytf x17d4w8g", children: [
          /* @__PURE__ */ jsx("label", { children: "Slug" }),
          /* @__PURE__ */ jsx("input", { value: editSlug, onChange: (event) => setEditSlug(event.target.value) })
        ] }),
        /* @__PURE__ */ jsxs("div", { className: "x78zum5 xdt5ytf x17d4w8g", children: [
          /* @__PURE__ */ jsx("label", { children: "Name" }),
          /* @__PURE__ */ jsx("input", { value: editName, onChange: (event) => setEditName(event.target.value) })
        ] })
      ] }),
      /* @__PURE__ */ jsxs("div", { className: "x78zum5 x167g77z x1anpbxc x1a02dak", children: [
        /* @__PURE__ */ jsx("button", { type: "button", onClick: handleUpdate, children: "Save" }),
        /* @__PURE__ */ jsx("button", { type: "button", className: "xht5q6y xvqfk9l xk61eof xur7f20 x1ypdohk", onClick: () => setEditTarget(null), children: "Cancel" })
      ] })
    ] }) })
  ] });
}
const EXAMPLE_URIS = ["manual://proposal/demo", "shopify://order/example", "qbo://invoice/example"];
const AppContext = createContext(null);
function useAppState() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error("useAppState must be used within AppContext provider.");
  }
  return context;
}
function App() {
  const navigate = useNavigate();
  const [recordUri, setRecordUri] = useState("");
  const [autoRunOnSelect, setAutoRunOnSelect] = useState(true);
  const [previewState, setPreviewState] = useState({});
  const [previewLoading, setPreviewLoading] = useState(false);
  const [materializeMessage, setMaterializeMessage] = useState(null);
  const [materializeLoading, setMaterializeLoading] = useState(false);
  const [eventsState, setEventsState] = useState({});
  const [eventsLoading, setEventsLoading] = useState(false);
  const [expandedRowIndex, setExpandedRowIndex] = useState(null);
  const [testSource, setTestSource] = useState("manual");
  const [testType, setTestType] = useState("preview");
  const [testExternalId, setTestExternalId] = useState("example-1");
  const [testPayload, setTestPayload] = useState('{\n  "hello": "world"\n}');
  const [testState, setTestState] = useState({});
  const [testLoading, setTestLoading] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState(null);
  const [debugEmail, setDebugEmail] = useState("");
  const [workspaces2, setWorkspaces] = useState([]);
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState(null);
  useEffect(() => {
    return;
  }, [debugEmail]);
  const refreshWorkspaces = useCallback(async () => {
    setWorkspaceLoading(true);
    const result = await listWorkspaces();
    if (result.ok && result.data) {
      setWorkspaces(result.data);
      const exists = selectedWorkspaceId ? result.data.some((workspace) => workspace.id === selectedWorkspaceId) : false;
      if (!exists) {
        const fallback = result.data.find((workspace) => workspace.slug === "default") ?? result.data[0];
        setSelectedWorkspaceId(fallback?.id ?? null);
      }
    }
    setWorkspaceLoading(false);
  }, [selectedWorkspaceId]);
  useEffect(() => {
    void refreshWorkspaces();
  }, [refreshWorkspaces]);
  const previewUrl = useMemo(() => {
    if (!recordUri.trim()) return "";
    return buildUrl("/plan/preview", {
      record_uri: recordUri.trim()
    });
  }, [recordUri]);
  const contextLookup = useMemo(() => {
    if (!previewState.data || typeof previewState.data !== "object") {
      return {};
    }
    const contexts = previewState.data.contexts;
    const deliverables = contexts?.deliverables ?? [];
    return deliverables.reduce((acc, deliverable) => {
      if (deliverable?.key) {
        acc[deliverable.key] = {
          title: deliverable.title ?? null
        };
      }
      return acc;
    }, {});
  }, [previewState.data]);
  async function runPreview(nextUri) {
    const targetUri = (nextUri ?? recordUri).trim();
    if (!targetUri) {
      setPreviewState({
        error: "Record URI is required."
      });
      return;
    }
    if (nextUri !== void 0) {
      setRecordUri(nextUri);
    }
    const url = buildUrl("/plan/preview", {
      record_uri: targetUri
    });
    setPreviewLoading(true);
    setPreviewState({
      url
    });
    try {
      const result = await fetchJson(url, {
        method: "GET"
      });
      setPreviewState({
        url,
        status: result.status,
        durationMs: result.durationMs,
        data: result.data ?? void 0,
        text: result.text,
        error: !result.ok ? `Request failed with status ${result.status}.` : result.data === null && result.text ? "Response was not valid JSON." : void 0
      });
    } catch (error) {
      setPreviewState({
        url,
        error: error instanceof Error ? error.message : "Failed to fetch preview."
      });
    } finally {
      setPreviewLoading(false);
    }
  }
  async function materializeTasks() {
    const uri = recordUri.trim();
    if (!uri) {
      setMaterializeMessage("Record URI is required.");
      return;
    }
    setMaterializeLoading(true);
    setMaterializeMessage(null);
    try {
      const projectResult = await createProjectFromRecord(uri);
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
      const {
        alreadyMaterialized,
        tasksCreated
      } = materializeResult.data;
      setMaterializeMessage(alreadyMaterialized ? "Already materialized (no changes)." : `Created ${tasksCreated} tasks.`);
      setSelectedProjectId(projectId);
      navigate("/projects");
    } catch (error) {
      setMaterializeMessage(error instanceof Error ? error.message : "Materialize failed.");
    } finally {
      setMaterializeLoading(false);
    }
  }
  async function refreshEvents() {
    const url = buildUrl("/events");
    setEventsLoading(true);
    setEventsState({
      url
    });
    setExpandedRowIndex(null);
    try {
      const result = await fetchJson(url, {
        method: "GET",
        credentials: "include"
      });
      setEventsState({
        url,
        status: result.status,
        durationMs: result.durationMs,
        data: result.data ?? void 0,
        text: result.text,
        error: !result.ok ? `Request failed with status ${result.status}.` : result.data === null && result.text ? "Response was not valid JSON." : void 0
      });
    } catch (error) {
      setEventsState({
        url,
        error: error instanceof Error ? error.message : "Failed to load events."
      });
    } finally {
      setEventsLoading(false);
    }
  }
  async function runEventsTest() {
    const url = buildUrl("/events/test");
    setTestLoading(true);
    setTestState({
      url
    });
    let payload;
    try {
      payload = testPayload.trim() ? JSON.parse(testPayload) : {};
    } catch (error) {
      setTestState({
        url,
        error: "Payload must be valid JSON."
      });
      setTestLoading(false);
      return;
    }
    try {
      const result = await fetchJson(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          source: testSource,
          type: testType,
          externalId: testExternalId,
          payload
        })
      });
      setTestState({
        url,
        status: result.status,
        durationMs: result.durationMs,
        data: result.data ?? void 0,
        text: result.text,
        error: !result.ok ? `Request failed with status ${result.status}.` : result.data === null && result.text ? "Response was not valid JSON." : void 0
      });
    } catch (error) {
      setTestState({
        url,
        error: error instanceof Error ? error.message : "Failed to post test event."
      });
    } finally {
      setTestLoading(false);
    }
  }
  const planId = typeof previewState.data === "object" && previewState.data ? previewState.data.plan_id : void 0;
  const warnings = typeof previewState.data === "object" && previewState.data ? previewState.data.warnings : void 0;
  const idempotencyKey = typeof testState.data === "object" && testState.data ? testState.data.idempotencyKey || testState.data.idempotency_key : void 0;
  const events2 = Array.isArray(eventsState.data) ? eventsState.data : Array.isArray(eventsState.data?.events) ? eventsState.data.events ?? [] : [];
  async function copyToClipboard(label, value) {
    try {
      await navigator.clipboard.writeText(value);
      alert(`${label} copied to clipboard.`);
    } catch (error) {
      alert("Copy failed. Please copy manually.");
    }
  }
  const appContextValue = {
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
    events: events2,
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
    workspaces: workspaces2,
    workspaceLoading,
    selectedWorkspaceId,
    setSelectedWorkspaceId
  };
  return /* @__PURE__ */ jsx(AppContext.Provider, { value: appContextValue, children: /* @__PURE__ */ jsxs("div", { className: "xg6iff7 x7e92ml xvqfk9l x17i4hy", children: [
    /* @__PURE__ */ jsxs("header", { className: "x78zum5 x1cy8zhl x1qughib x1vxykrk x1opzaxk xht5q6y", children: [
      /* @__PURE__ */ jsxs("div", { children: [
        /* @__PURE__ */ jsx("h1", { children: "ftops internal UI" }),
        /* @__PURE__ */ jsx("p", { children: "Plan preview + events viewer for ftops endpoints." })
      ] }),
      /* @__PURE__ */ jsxs("div", { className: "x78zum5 xou54vl xuk3077 x1a02dak", children: [
        /* @__PURE__ */ jsxs("div", { className: "x78zum5 xdt5ytf x17d4w8g", children: [
          /* @__PURE__ */ jsx("label", { htmlFor: "workspace-select", children: "Workspace" }),
          /* @__PURE__ */ jsx("select", { id: "workspace-select", value: selectedWorkspaceId ?? "", onChange: (event) => setSelectedWorkspaceId(event.target.value), disabled: workspaceLoading, children: workspaces2.map((workspace) => /* @__PURE__ */ jsx("option", { value: workspace.id, children: workspace.name }, workspace.id)) })
        ] }),
        false
      ] })
    ] }),
    /* @__PURE__ */ jsx(DevMigrationBanner, {}),
    /* @__PURE__ */ jsxs("nav", { className: "x78zum5 x15668s1 x132eafk x1a02dak", children: [
      /* @__PURE__ */ jsx(NavLink, { className: ({
        isActive
      }) => ({
        0: "xh2izcj x1e3jit xbnpv00 xur7f20 x1ypdohk x4z9k3i",
        1: "xbnpv00 xur7f20 x1ypdohk x4z9k3i xvz32qw xmfno27 x1hdarym"
      })[!!isActive << 0], to: "/plan-preview", children: "Plan Preview" }),
      /* @__PURE__ */ jsx(NavLink, { className: ({
        isActive
      }) => ({
        0: "xh2izcj x1e3jit xbnpv00 xur7f20 x1ypdohk x4z9k3i",
        1: "xbnpv00 xur7f20 x1ypdohk x4z9k3i xvz32qw xmfno27 x1hdarym"
      })[!!isActive << 0], to: "/events", children: "Events Viewer" }),
      /* @__PURE__ */ jsx(NavLink, { className: ({
        isActive
      }) => ({
        0: "xh2izcj x1e3jit xbnpv00 xur7f20 x1ypdohk x4z9k3i",
        1: "xbnpv00 xur7f20 x1ypdohk x4z9k3i xvz32qw xmfno27 x1hdarym"
      })[!!isActive << 0], to: "/demo", children: "Demo" }),
      /* @__PURE__ */ jsx(NavLink, { className: ({
        isActive
      }) => ({
        0: "xh2izcj x1e3jit xbnpv00 xur7f20 x1ypdohk x4z9k3i",
        1: "xbnpv00 xur7f20 x1ypdohk x4z9k3i xvz32qw xmfno27 x1hdarym"
      })[!!isActive << 0], to: "/templates", children: "Templates" }),
      /* @__PURE__ */ jsx(NavLink, { className: ({
        isActive
      }) => ({
        0: "xh2izcj x1e3jit xbnpv00 xur7f20 x1ypdohk x4z9k3i",
        1: "xbnpv00 xur7f20 x1ypdohk x4z9k3i xvz32qw xmfno27 x1hdarym"
      })[!!isActive << 0], to: "/projects", children: "Projects" }),
      /* @__PURE__ */ jsx(NavLink, { className: ({
        isActive
      }) => ({
        0: "xh2izcj x1e3jit xbnpv00 xur7f20 x1ypdohk x4z9k3i",
        1: "xbnpv00 xur7f20 x1ypdohk x4z9k3i xvz32qw xmfno27 x1hdarym"
      })[!!isActive << 0], to: "/integrations", children: "Integrations" }),
      /* @__PURE__ */ jsx(NavLink, { className: ({
        isActive
      }) => ({
        0: "xh2izcj x1e3jit xbnpv00 xur7f20 x1ypdohk x4z9k3i",
        1: "xbnpv00 xur7f20 x1ypdohk x4z9k3i xvz32qw xmfno27 x1hdarym"
      })[!!isActive << 0], to: "/ingest", children: "Ingest" }),
      /* @__PURE__ */ jsx(NavLink, { className: ({
        isActive
      }) => ({
        0: "xh2izcj x1e3jit xbnpv00 xur7f20 x1ypdohk x4z9k3i",
        1: "xbnpv00 xur7f20 x1ypdohk x4z9k3i xvz32qw xmfno27 x1hdarym"
      })[!!isActive << 0], to: "/workspaces", children: "Workspaces" })
    ] }),
    /* @__PURE__ */ jsx(Outlet, {})
  ] }) });
}
function PlanPreviewRoute() {
  const {
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
    copyToClipboard
  } = useAppState();
  const navigate = useNavigate();
  const {
    recordUri: recordUriParam
  } = useParams();
  const lastParamRef = useRef(null);
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
  const navigateToRecord = useCallback((nextUri, shouldRun) => {
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
  }, [navigate, recordUriParam, runPreview, setRecordUri]);
  return /* @__PURE__ */ jsxs("section", { className: "x15ji50x", children: [
    /* @__PURE__ */ jsx("h2", { children: "Plan Preview" }),
    /* @__PURE__ */ jsxs("div", { className: "xrvj5dj x14sj8ly x1665zp3 x1cy8zhl", children: [
      /* @__PURE__ */ jsx(RecordSidebar, { selectedUri: recordUri, onSelect: (uri) => {
        navigateToRecord(uri, autoRunOnSelect);
      } }),
      /* @__PURE__ */ jsxs("div", { className: "x78zum5 xdt5ytf xou54vl", children: [
        /* @__PURE__ */ jsxs("div", { className: "x78zum5 xdt5ytf x17d4w8g", children: [
          /* @__PURE__ */ jsx("label", { htmlFor: "record-uri", children: "Record URI" }),
          /* @__PURE__ */ jsx("input", { id: "record-uri", type: "text", value: recordUri, onChange: (event) => setRecordUri(event.target.value), placeholder: "manual://proposal/demo" })
        ] }),
        /* @__PURE__ */ jsxs("div", { className: "x78zum5 x1a02dak x167g77z", children: [
          /* @__PURE__ */ jsx("span", { children: "Example URIs:" }),
          EXAMPLE_URIS.map((uri) => /* @__PURE__ */ jsx("button", { type: "button", onClick: () => navigateToRecord(uri, false), children: uri }, uri))
        ] }),
        /* @__PURE__ */ jsxs("div", { className: "x78zum5 x1a02dak x167g77z x6s0dn4", children: [
          /* @__PURE__ */ jsx("button", { type: "button", onClick: () => {
            void runPreview();
            const trimmed = recordUri.trim();
            if (trimmed) {
              const decodedCurrent = recordUriParam ? decodeURIComponent(recordUriParam) : "";
              if (trimmed !== decodedCurrent) {
                navigate(`/plan-preview/${encodeURIComponent(trimmed)}`);
              }
            }
          }, disabled: previewLoading, children: previewLoading ? "Running..." : "Run Preview" }),
          /* @__PURE__ */ jsx("button", { type: "button", className: "xht5q6y xvqfk9l x153ncpu xiq63ov x1ypdohk", onClick: materializeTasks, disabled: materializeLoading || !recordUri.trim(), children: materializeLoading ? "Materializing..." : "Create Project + Materialize Tasks" }),
          /* @__PURE__ */ jsxs("label", { className: "x3nfvp2 x17d4w8g x6s0dn4", children: [
            /* @__PURE__ */ jsx("input", { type: "checkbox", checked: autoRunOnSelect, onChange: (event) => setAutoRunOnSelect(event.target.checked) }),
            "Auto-run on select"
          ] }),
          previewUrl && /* @__PURE__ */ jsx("span", { className: "xfifm61 x1e3jit", children: previewUrl })
        ] }),
        materializeMessage && /* @__PURE__ */ jsxs("div", { className: "x1gqud3g x9hd93c xh2izcj", children: [
          /* @__PURE__ */ jsx("strong", { children: "Materialize:" }),
          " ",
          materializeMessage
        ] }),
        /* @__PURE__ */ jsxs("div", { className: "x78zum5 xdt5ytf x1v2ro7d", children: [
          previewState.error && /* @__PURE__ */ jsx("div", { className: "x1tp81k5", children: previewState.error }),
          previewState.status !== void 0 && /* @__PURE__ */ jsxs("div", { className: "x78zum5 x1a02dak x1v2ro7d xfifm61 xo8r7s1", children: [
            /* @__PURE__ */ jsxs("div", { children: [
              /* @__PURE__ */ jsx("strong", { children: "Status:" }),
              " ",
              previewState.status
            ] }),
            /* @__PURE__ */ jsxs("div", { children: [
              /* @__PURE__ */ jsx("strong", { children: "Duration:" }),
              " ",
              previewState.durationMs,
              " ms"
            ] }),
            /* @__PURE__ */ jsxs("div", { children: [
              /* @__PURE__ */ jsx("strong", { children: "Request URL:" }),
              " ",
              previewState.url
            ] })
          ] }),
          planId && /* @__PURE__ */ jsxs("div", { className: "x1gqud3g x9hd93c xh2izcj", children: [
            /* @__PURE__ */ jsxs("div", { children: [
              /* @__PURE__ */ jsx("strong", { children: "plan_id:" }),
              " ",
              planId
            ] }),
            /* @__PURE__ */ jsx("button", { type: "button", onClick: () => copyToClipboard("plan_id", planId), children: "Copy plan_id" })
          ] }),
          warnings && warnings.length > 0 && /* @__PURE__ */ jsxs("div", { className: "x1gqud3g x9hd93c xio89g7 x1cmdin5", children: [
            /* @__PURE__ */ jsx("strong", { children: "Warnings:" }),
            /* @__PURE__ */ jsx("ul", { children: warnings.map((warning) => /* @__PURE__ */ jsx("li", { children: warning }, warning)) })
          ] }),
          /* @__PURE__ */ jsx(ContextViewer, { data: previewState.data }),
          previewState.data !== void 0 && /* @__PURE__ */ jsxs("div", { className: "x9hd93c xht5q6y xb3r6kr", children: [
            /* @__PURE__ */ jsxs("div", { className: "x15x03d9 xh2izcj xfifm61 xtvhhri x9pfba7", children: [
              /* @__PURE__ */ jsx("strong", { children: "Response JSON" }),
              /* @__PURE__ */ jsx("button", { type: "button", onClick: () => copyToClipboard("response JSON", previewState.text || JSON.stringify(previewState.data, null, 2)), children: "Copy JSON" })
            ] }),
            /* @__PURE__ */ jsx(JsonView, { data: previewState.data })
          ] }),
          previewState.data === void 0 && previewState.text && /* @__PURE__ */ jsxs("div", { className: "x9hd93c xht5q6y xb3r6kr", children: [
            /* @__PURE__ */ jsxs("div", { className: "x15x03d9 xh2izcj xfifm61 xtvhhri x9pfba7", children: [
              /* @__PURE__ */ jsx("strong", { children: "Response Text" }),
              /* @__PURE__ */ jsx("button", { type: "button", onClick: () => copyToClipboard("response text", previewState.text || ""), children: "Copy text" })
            ] }),
            /* @__PURE__ */ jsx("pre", { children: previewState.text })
          ] })
        ] })
      ] })
    ] })
  ] });
}
function EventsRoute() {
  const {
    eventsState,
    eventsLoading,
    refreshEvents,
    events: events2,
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
    copyToClipboard
  } = useAppState();
  return /* @__PURE__ */ jsxs("section", { className: "x15ji50x", children: [
    /* @__PURE__ */ jsx("h2", { children: "Events Viewer" }),
    /* @__PURE__ */ jsxs("div", { className: "x78zum5 x1a02dak x167g77z x6s0dn4", children: [
      /* @__PURE__ */ jsx("button", { type: "button", onClick: refreshEvents, disabled: eventsLoading, children: eventsLoading ? "Refreshing..." : "Refresh" }),
      eventsState.url && /* @__PURE__ */ jsx("span", { className: "xfifm61 x1e3jit", children: eventsState.url })
    ] }),
    /* @__PURE__ */ jsxs("div", { className: "x78zum5 xdt5ytf x1v2ro7d", children: [
      eventsState.error && /* @__PURE__ */ jsx("div", { className: "x1tp81k5", children: eventsState.error }),
      eventsState.status !== void 0 && /* @__PURE__ */ jsxs("div", { className: "x78zum5 x1a02dak x1v2ro7d xfifm61 xo8r7s1", children: [
        /* @__PURE__ */ jsxs("div", { children: [
          /* @__PURE__ */ jsx("strong", { children: "Status:" }),
          " ",
          eventsState.status
        ] }),
        /* @__PURE__ */ jsxs("div", { children: [
          /* @__PURE__ */ jsx("strong", { children: "Duration:" }),
          " ",
          eventsState.durationMs,
          " ms"
        ] })
      ] }),
      /* @__PURE__ */ jsx("div", { className: "x9hd93c xw2csxc", children: /* @__PURE__ */ jsxs("table", { children: [
        /* @__PURE__ */ jsx("thead", { children: /* @__PURE__ */ jsxs("tr", { children: [
          /* @__PURE__ */ jsx("th", { children: "source" }),
          /* @__PURE__ */ jsx("th", { children: "type" }),
          /* @__PURE__ */ jsx("th", { children: "external_id" }),
          /* @__PURE__ */ jsx("th", { children: "received_at" }),
          /* @__PURE__ */ jsx("th", { children: "processed_at" }),
          /* @__PURE__ */ jsx("th", { children: "process_error" })
        ] }) }),
        /* @__PURE__ */ jsxs("tbody", { children: [
          events2.length === 0 && /* @__PURE__ */ jsx("tr", { children: /* @__PURE__ */ jsx("td", { colSpan: 6, className: "xo8r7s1", children: "No events loaded yet." }) }),
          events2.map((event, index2) => {
            const row = event;
            const isExpanded = expandedRowIndex === index2;
            return /* @__PURE__ */ jsxs("tr", { className: {
              0: "",
              1: "x1gqud3g x9hd93c xh2izcj"
            }[!!isExpanded << 0], onClick: () => setExpandedRowIndex(isExpanded ? null : index2), children: [
              /* @__PURE__ */ jsx("td", { children: String(row.source ?? "") }),
              /* @__PURE__ */ jsx("td", { children: String(row.type ?? "") }),
              /* @__PURE__ */ jsx("td", { children: String(row.external_id ?? row.externalId ?? "") }),
              /* @__PURE__ */ jsx("td", { children: String(row.received_at ?? row.receivedAt ?? "") }),
              /* @__PURE__ */ jsx("td", { children: String(row.processed_at ?? row.processedAt ?? "") }),
              /* @__PURE__ */ jsx("td", { children: String(row.process_error ?? row.processError ?? "") })
            ] }, index2);
          })
        ] })
      ] }) }),
      expandedRowIndex !== null && events2[expandedRowIndex] !== void 0 && /* @__PURE__ */ jsxs("div", { className: "x9hd93c xht5q6y xb3r6kr", children: [
        /* @__PURE__ */ jsx("div", { className: "x15x03d9 xh2izcj xfifm61 xtvhhri x9pfba7", children: /* @__PURE__ */ jsx("strong", { children: "Event Details" }) }),
        /* @__PURE__ */ jsx(JsonView, { data: events2[expandedRowIndex] })
      ] })
    ] }),
    /* @__PURE__ */ jsx("div", { className: "xjm9jq1 xcxfhbo x9rwyo8" }),
    /* @__PURE__ */ jsxs("div", { className: "xw7yly9", children: [
      /* @__PURE__ */ jsx("h3", { children: "POST /events/test" }),
      /* @__PURE__ */ jsxs("div", { className: "xrvj5dj x1v2ro7d", children: [
        /* @__PURE__ */ jsxs("label", { children: [
          "Source",
          /* @__PURE__ */ jsx("input", { type: "text", value: testSource, onChange: (event) => setTestSource(event.target.value) })
        ] }),
        /* @__PURE__ */ jsxs("label", { children: [
          "Type",
          /* @__PURE__ */ jsx("input", { type: "text", value: testType, onChange: (event) => setTestType(event.target.value) })
        ] }),
        /* @__PURE__ */ jsxs("label", { children: [
          "External ID",
          /* @__PURE__ */ jsx("input", { type: "text", value: testExternalId, onChange: (event) => setTestExternalId(event.target.value) })
        ] })
      ] }),
      /* @__PURE__ */ jsxs("label", { className: "x1osaytk", children: [
        "Payload JSON",
        /* @__PURE__ */ jsx("textarea", { rows: 6, value: testPayload, onChange: (event) => setTestPayload(event.target.value) })
      ] }),
      /* @__PURE__ */ jsxs("div", { className: "x78zum5 x1a02dak x167g77z x6s0dn4", children: [
        /* @__PURE__ */ jsx("button", { type: "button", onClick: runEventsTest, disabled: testLoading, children: testLoading ? "Sending..." : "Send Test Event" }),
        testState.url && /* @__PURE__ */ jsx("span", { className: "xfifm61 x1e3jit", children: testState.url })
      ] }),
      testState.error && /* @__PURE__ */ jsx("div", { className: "x1tp81k5", children: testState.error }),
      testState.status !== void 0 && /* @__PURE__ */ jsxs("div", { className: "x78zum5 x1a02dak x1v2ro7d xfifm61 xo8r7s1", children: [
        /* @__PURE__ */ jsxs("div", { children: [
          /* @__PURE__ */ jsx("strong", { children: "Status:" }),
          " ",
          testState.status
        ] }),
        /* @__PURE__ */ jsxs("div", { children: [
          /* @__PURE__ */ jsx("strong", { children: "Duration:" }),
          " ",
          testState.durationMs,
          " ms"
        ] })
      ] }),
      idempotencyKey && /* @__PURE__ */ jsxs("div", { className: "x1gqud3g x9hd93c xh2izcj", children: [
        /* @__PURE__ */ jsxs("div", { children: [
          /* @__PURE__ */ jsx("strong", { children: "idempotencyKey:" }),
          " ",
          idempotencyKey
        ] }),
        /* @__PURE__ */ jsx("button", { type: "button", onClick: () => copyToClipboard("idempotencyKey", idempotencyKey), children: "Copy idempotencyKey" })
      ] }),
      testState.data !== void 0 && /* @__PURE__ */ jsxs("div", { className: "x9hd93c xht5q6y xb3r6kr", children: [
        /* @__PURE__ */ jsx("div", { className: "x15x03d9 xh2izcj xfifm61 xtvhhri x9pfba7", children: /* @__PURE__ */ jsx("strong", { children: "Response" }) }),
        /* @__PURE__ */ jsx(JsonView, { data: testState.data })
      ] }),
      testState.data === void 0 && testState.text && /* @__PURE__ */ jsxs("div", { className: "x9hd93c xht5q6y xb3r6kr", children: [
        /* @__PURE__ */ jsx("div", { className: "x15x03d9 xh2izcj xfifm61 xtvhhri x9pfba7", children: /* @__PURE__ */ jsx("strong", { children: "Response Text" }) }),
        /* @__PURE__ */ jsx("pre", { children: testState.text })
      ] })
    ] })
  ] });
}
function DemoRoute() {
  return /* @__PURE__ */ jsx("section", { className: "x15ji50x", children: /* @__PURE__ */ jsx(DemoPanel, {}) });
}
function TemplatesRoute() {
  const {
    templateKey
  } = useParams();
  const navigate = useNavigate();
  const selectedKey = templateKey ? decodeURIComponent(templateKey) : void 0;
  return /* @__PURE__ */ jsxs("section", { className: "x15ji50x", children: [
    /* @__PURE__ */ jsx("h2", { children: "Templates" }),
    /* @__PURE__ */ jsx(TemplatesPanel, { selectedTemplateKeyOverride: selectedKey, onSelectedTemplateKeyChange: (nextKey) => {
      if (nextKey) {
        navigate(`/templates/${encodeURIComponent(nextKey)}`);
      } else {
        navigate("/templates");
      }
    } })
  ] });
}
function ProjectsRoute() {
  const {
    selectedProjectId,
    setSelectedProjectId,
    contextLookup
  } = useAppState();
  const {
    projectId
  } = useParams();
  const navigate = useNavigate();
  useEffect(() => {
    if (!projectId) return;
    const decoded = decodeURIComponent(projectId);
    if (decoded && decoded !== selectedProjectId) {
      setSelectedProjectId(decoded);
    }
  }, [projectId, selectedProjectId, setSelectedProjectId]);
  const handleSelectProject = useCallback((nextId) => {
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
  }, [navigate, projectId, setSelectedProjectId]);
  return /* @__PURE__ */ jsx(ProjectsPanel, { selectedProjectId, onSelectProject: handleSelectProject, contextLookup });
}
function IntegrationsRoute() {
  const {
    selectedWorkspaceId,
    workspaces: workspaces2
  } = useAppState();
  return /* @__PURE__ */ jsx(IntegrationsPanel, { workspaceId: selectedWorkspaceId, workspaces: workspaces2 });
}
function IngestRoute() {
  const {
    selectedWorkspaceId,
    workspaces: workspaces2
  } = useAppState();
  return /* @__PURE__ */ jsx(IngestPanel, { workspaceId: selectedWorkspaceId, workspaces: workspaces2 });
}
function WorkspacesRoute() {
  const {
    selectedWorkspaceId,
    setSelectedWorkspaceId
  } = useAppState();
  return /* @__PURE__ */ jsx(WorkspacesPanel, { selectedWorkspaceId, onSelectWorkspace: setSelectedWorkspaceId });
}
function ServerStatus() {
  const [now, setNow] = useState("");
  useEffect(() => {
    setNow((/* @__PURE__ */ new Date()).toISOString());
  }, []);
  return /* @__PURE__ */ jsxs("div", { className: "xvz32qw xmfno27 x1iwkndl xfifm61 x9pfba7 xtvhhri", children: [
    /* @__PURE__ */ jsx("span", { className: "x1s688f x1db2dqx", children: "Server time" }),
    /* @__PURE__ */ jsx("span", { className: "x1ffyjt3", children: now || "—" })
  ] });
}
const root = UNSAFE_withComponentProps(function Root2() {
  return /* @__PURE__ */ jsxs(Fragment, {
    children: [/* @__PURE__ */ jsx(ServerStatus, {}), /* @__PURE__ */ jsx(App, {})]
  });
});
const route1 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: root
}, Symbol.toStringTag, { value: "Module" }));
function loader() {
  return redirect("/projects");
}
const index = UNSAFE_withComponentProps(function Index() {
  return null;
});
const route2 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: index,
  loader
}, Symbol.toStringTag, { value: "Module" }));
const planPreview = UNSAFE_withComponentProps(function PlanPreview() {
  return /* @__PURE__ */ jsx(PlanPreviewRoute, {});
});
const route3 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: planPreview
}, Symbol.toStringTag, { value: "Module" }));
const planPreviewRecord = UNSAFE_withComponentProps(function PlanPreviewRecord() {
  return /* @__PURE__ */ jsx(PlanPreviewRoute, {});
});
const route4 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: planPreviewRecord
}, Symbol.toStringTag, { value: "Module" }));
const events = UNSAFE_withComponentProps(function Events() {
  return /* @__PURE__ */ jsx(EventsRoute, {});
});
const route5 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: events
}, Symbol.toStringTag, { value: "Module" }));
const demo = UNSAFE_withComponentProps(function Demo() {
  return /* @__PURE__ */ jsx(DemoRoute, {});
});
const route6 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: demo
}, Symbol.toStringTag, { value: "Module" }));
const templates = UNSAFE_withComponentProps(function Templates() {
  return /* @__PURE__ */ jsx(TemplatesRoute, {});
});
const route7 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: templates
}, Symbol.toStringTag, { value: "Module" }));
const templatesTemplate = UNSAFE_withComponentProps(function TemplatesTemplate() {
  return /* @__PURE__ */ jsx(TemplatesRoute, {});
});
const route8 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: templatesTemplate
}, Symbol.toStringTag, { value: "Module" }));
const projects = UNSAFE_withComponentProps(function Projects() {
  return /* @__PURE__ */ jsx(ProjectsRoute, {});
});
const route9 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: projects
}, Symbol.toStringTag, { value: "Module" }));
const projectsProject = UNSAFE_withComponentProps(function ProjectsProject() {
  return /* @__PURE__ */ jsx(ProjectsRoute, {});
});
const route10 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: projectsProject
}, Symbol.toStringTag, { value: "Module" }));
const integrations = UNSAFE_withComponentProps(function Integrations() {
  return /* @__PURE__ */ jsx(IntegrationsRoute, {});
});
const route11 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: integrations
}, Symbol.toStringTag, { value: "Module" }));
const ingest = UNSAFE_withComponentProps(function Ingest() {
  return /* @__PURE__ */ jsx(IngestRoute, {});
});
const route12 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: ingest
}, Symbol.toStringTag, { value: "Module" }));
const workspaces = UNSAFE_withComponentProps(function Workspaces() {
  return /* @__PURE__ */ jsx(WorkspacesRoute, {});
});
const route13 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: workspaces
}, Symbol.toStringTag, { value: "Module" }));
const notFound = UNSAFE_withComponentProps(function NotFound() {
  return /* @__PURE__ */ jsxs("section", {
    className: "xm2aqkj x1e3jit",
    children: [/* @__PURE__ */ jsx("h2", {
      children: "Not Found"
    }), /* @__PURE__ */ jsx("p", {
      children: "That page does not exist."
    })]
  });
});
const route14 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: notFound
}, Symbol.toStringTag, { value: "Module" }));
const serverManifest = { "entry": { "module": "/assets/entry.client-CuX5_hGp.js", "imports": ["/assets/jsx-runtime-BTp501oS.js", "/assets/chunk-EPOLDU6W-DaRFMLBV.js"], "css": [] }, "routes": { "root": { "id": "root", "parentId": void 0, "path": "", "index": void 0, "caseSensitive": void 0, "hasAction": false, "hasLoader": false, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasErrorBoundary": false, "module": "/assets/root-oH9OgR08.js", "imports": ["/assets/jsx-runtime-BTp501oS.js", "/assets/chunk-EPOLDU6W-DaRFMLBV.js"], "css": ["/assets/root-B97oAh65.css"], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "routes/root": { "id": "routes/root", "parentId": "root", "path": "", "index": void 0, "caseSensitive": void 0, "hasAction": false, "hasLoader": false, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasErrorBoundary": false, "module": "/assets/root-D8pLGe0h.js", "imports": ["/assets/chunk-EPOLDU6W-DaRFMLBV.js", "/assets/jsx-runtime-BTp501oS.js", "/assets/App-CSgV0mTs.js"], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "routes/index": { "id": "routes/index", "parentId": "routes/root", "path": void 0, "index": true, "caseSensitive": void 0, "hasAction": false, "hasLoader": true, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasErrorBoundary": false, "module": "/assets/index-kHHunH1k.js", "imports": ["/assets/chunk-EPOLDU6W-DaRFMLBV.js"], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "routes/plan-preview": { "id": "routes/plan-preview", "parentId": "routes/root", "path": "plan-preview", "index": void 0, "caseSensitive": void 0, "hasAction": false, "hasLoader": false, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasErrorBoundary": false, "module": "/assets/plan-preview-DrryDpDO.js", "imports": ["/assets/chunk-EPOLDU6W-DaRFMLBV.js", "/assets/jsx-runtime-BTp501oS.js", "/assets/App-CSgV0mTs.js"], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "routes/plan-preview-record": { "id": "routes/plan-preview-record", "parentId": "routes/root", "path": "plan-preview/:recordUri", "index": void 0, "caseSensitive": void 0, "hasAction": false, "hasLoader": false, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasErrorBoundary": false, "module": "/assets/plan-preview-record-BXaSECUL.js", "imports": ["/assets/chunk-EPOLDU6W-DaRFMLBV.js", "/assets/jsx-runtime-BTp501oS.js", "/assets/App-CSgV0mTs.js"], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "routes/events": { "id": "routes/events", "parentId": "routes/root", "path": "events", "index": void 0, "caseSensitive": void 0, "hasAction": false, "hasLoader": false, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasErrorBoundary": false, "module": "/assets/events-B8tI1Ldt.js", "imports": ["/assets/chunk-EPOLDU6W-DaRFMLBV.js", "/assets/jsx-runtime-BTp501oS.js", "/assets/App-CSgV0mTs.js"], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "routes/demo": { "id": "routes/demo", "parentId": "routes/root", "path": "demo", "index": void 0, "caseSensitive": void 0, "hasAction": false, "hasLoader": false, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasErrorBoundary": false, "module": "/assets/demo-BwNtoo0B.js", "imports": ["/assets/chunk-EPOLDU6W-DaRFMLBV.js", "/assets/jsx-runtime-BTp501oS.js", "/assets/App-CSgV0mTs.js"], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "routes/templates": { "id": "routes/templates", "parentId": "routes/root", "path": "templates", "index": void 0, "caseSensitive": void 0, "hasAction": false, "hasLoader": false, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasErrorBoundary": false, "module": "/assets/templates-ijYqABk3.js", "imports": ["/assets/chunk-EPOLDU6W-DaRFMLBV.js", "/assets/jsx-runtime-BTp501oS.js", "/assets/App-CSgV0mTs.js"], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "routes/templates-template": { "id": "routes/templates-template", "parentId": "routes/root", "path": "templates/:templateKey", "index": void 0, "caseSensitive": void 0, "hasAction": false, "hasLoader": false, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasErrorBoundary": false, "module": "/assets/templates-template-CZLXShRi.js", "imports": ["/assets/chunk-EPOLDU6W-DaRFMLBV.js", "/assets/jsx-runtime-BTp501oS.js", "/assets/App-CSgV0mTs.js"], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "routes/projects": { "id": "routes/projects", "parentId": "routes/root", "path": "projects", "index": void 0, "caseSensitive": void 0, "hasAction": false, "hasLoader": false, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasErrorBoundary": false, "module": "/assets/projects-67cQ3LO0.js", "imports": ["/assets/chunk-EPOLDU6W-DaRFMLBV.js", "/assets/jsx-runtime-BTp501oS.js", "/assets/App-CSgV0mTs.js"], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "routes/projects-project": { "id": "routes/projects-project", "parentId": "routes/root", "path": "projects/:projectId", "index": void 0, "caseSensitive": void 0, "hasAction": false, "hasLoader": false, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasErrorBoundary": false, "module": "/assets/projects-project-C94FSd1q.js", "imports": ["/assets/chunk-EPOLDU6W-DaRFMLBV.js", "/assets/jsx-runtime-BTp501oS.js", "/assets/App-CSgV0mTs.js"], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "routes/integrations": { "id": "routes/integrations", "parentId": "routes/root", "path": "integrations", "index": void 0, "caseSensitive": void 0, "hasAction": false, "hasLoader": false, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasErrorBoundary": false, "module": "/assets/integrations-CBrh1MX7.js", "imports": ["/assets/chunk-EPOLDU6W-DaRFMLBV.js", "/assets/jsx-runtime-BTp501oS.js", "/assets/App-CSgV0mTs.js"], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "routes/ingest": { "id": "routes/ingest", "parentId": "routes/root", "path": "ingest", "index": void 0, "caseSensitive": void 0, "hasAction": false, "hasLoader": false, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasErrorBoundary": false, "module": "/assets/ingest-zHsQSC41.js", "imports": ["/assets/chunk-EPOLDU6W-DaRFMLBV.js", "/assets/jsx-runtime-BTp501oS.js", "/assets/App-CSgV0mTs.js"], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "routes/workspaces": { "id": "routes/workspaces", "parentId": "routes/root", "path": "workspaces", "index": void 0, "caseSensitive": void 0, "hasAction": false, "hasLoader": false, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasErrorBoundary": false, "module": "/assets/workspaces-swJawayo.js", "imports": ["/assets/chunk-EPOLDU6W-DaRFMLBV.js", "/assets/jsx-runtime-BTp501oS.js", "/assets/App-CSgV0mTs.js"], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "routes/not-found": { "id": "routes/not-found", "parentId": "routes/root", "path": "*", "index": void 0, "caseSensitive": void 0, "hasAction": false, "hasLoader": false, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasErrorBoundary": false, "module": "/assets/not-found-BLBsAbVE.js", "imports": ["/assets/chunk-EPOLDU6W-DaRFMLBV.js", "/assets/jsx-runtime-BTp501oS.js"], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 } }, "url": "/assets/manifest-941daf3a.js", "version": "941daf3a", "sri": void 0 };
const assetsBuildDirectory = "build/client";
const basename = "/";
const future = { "unstable_optimizeDeps": false, "unstable_subResourceIntegrity": false, "unstable_trailingSlashAwareDataRequests": false, "v8_middleware": false, "v8_splitRouteModules": false, "v8_viteEnvironmentApi": false };
const ssr = true;
const isSpaMode = false;
const prerender = [];
const routeDiscovery = { "mode": "lazy", "manifestPath": "/__manifest" };
const publicPath = "/";
const entry = { module: entryServer };
const routes = {
  "root": {
    id: "root",
    parentId: void 0,
    path: "",
    index: void 0,
    caseSensitive: void 0,
    module: route0
  },
  "routes/root": {
    id: "routes/root",
    parentId: "root",
    path: "",
    index: void 0,
    caseSensitive: void 0,
    module: route1
  },
  "routes/index": {
    id: "routes/index",
    parentId: "routes/root",
    path: void 0,
    index: true,
    caseSensitive: void 0,
    module: route2
  },
  "routes/plan-preview": {
    id: "routes/plan-preview",
    parentId: "routes/root",
    path: "plan-preview",
    index: void 0,
    caseSensitive: void 0,
    module: route3
  },
  "routes/plan-preview-record": {
    id: "routes/plan-preview-record",
    parentId: "routes/root",
    path: "plan-preview/:recordUri",
    index: void 0,
    caseSensitive: void 0,
    module: route4
  },
  "routes/events": {
    id: "routes/events",
    parentId: "routes/root",
    path: "events",
    index: void 0,
    caseSensitive: void 0,
    module: route5
  },
  "routes/demo": {
    id: "routes/demo",
    parentId: "routes/root",
    path: "demo",
    index: void 0,
    caseSensitive: void 0,
    module: route6
  },
  "routes/templates": {
    id: "routes/templates",
    parentId: "routes/root",
    path: "templates",
    index: void 0,
    caseSensitive: void 0,
    module: route7
  },
  "routes/templates-template": {
    id: "routes/templates-template",
    parentId: "routes/root",
    path: "templates/:templateKey",
    index: void 0,
    caseSensitive: void 0,
    module: route8
  },
  "routes/projects": {
    id: "routes/projects",
    parentId: "routes/root",
    path: "projects",
    index: void 0,
    caseSensitive: void 0,
    module: route9
  },
  "routes/projects-project": {
    id: "routes/projects-project",
    parentId: "routes/root",
    path: "projects/:projectId",
    index: void 0,
    caseSensitive: void 0,
    module: route10
  },
  "routes/integrations": {
    id: "routes/integrations",
    parentId: "routes/root",
    path: "integrations",
    index: void 0,
    caseSensitive: void 0,
    module: route11
  },
  "routes/ingest": {
    id: "routes/ingest",
    parentId: "routes/root",
    path: "ingest",
    index: void 0,
    caseSensitive: void 0,
    module: route12
  },
  "routes/workspaces": {
    id: "routes/workspaces",
    parentId: "routes/root",
    path: "workspaces",
    index: void 0,
    caseSensitive: void 0,
    module: route13
  },
  "routes/not-found": {
    id: "routes/not-found",
    parentId: "routes/root",
    path: "*",
    index: void 0,
    caseSensitive: void 0,
    module: route14
  }
};
const allowedActionOrigins = false;
export {
  allowedActionOrigins,
  serverManifest as assets,
  assetsBuildDirectory,
  basename,
  entry,
  future,
  isSpaMode,
  prerender,
  publicPath,
  routeDiscovery,
  routes,
  ssr
};
