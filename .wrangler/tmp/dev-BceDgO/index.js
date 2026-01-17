var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/lib/http.ts
var JSON_HEADERS = { "content-type": "application/json" };
function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...JSON_HEADERS, ...headers }
  });
}
__name(json, "json");
function badRequest(message, extra = {}) {
  return json({ error: message, ...extra }, 400);
}
__name(badRequest, "badRequest");
function notFound(message, extra = {}) {
  return json({ error: message, ...extra }, 404);
}
__name(notFound, "notFound");
function methodNotAllowed(allowed) {
  return json({ error: "Method Not Allowed", allowed }, 405, {
    allow: allowed.join(", ")
  });
}
__name(methodNotAllowed, "methodNotAllowed");
function serverError(message, extra = {}) {
  return json({ error: message, ...extra }, 500);
}
__name(serverError, "serverError");

// src/lib/utils.ts
function nowISO() {
  return (/* @__PURE__ */ new Date()).toISOString();
}
__name(nowISO, "nowISO");
function buildIdempotencyKey(source, type, externalId) {
  return `${source}:${type}:${externalId}`;
}
__name(buildIdempotencyKey, "buildIdempotencyKey");

// src/routes/events.ts
async function handleEvents(segments, request, env, _ctx, url) {
  return handleSegment(
    segments,
    request,
    env,
    _ctx,
    url,
    {
      test: handleEventsTest
    },
    handleEventsRoot
  );
}
__name(handleEvents, "handleEvents");
async function handleEventsRoot(segments, request, env, _ctx, _url) {
  if (segments.length > 0) {
    return notFound("Route not found");
  }
  if (request.method !== "GET") {
    return methodNotAllowed(["GET"]);
  }
  const result = await env.DB.prepare(
    `SELECT source, type, external_id, idempotency_key, received_at, processed_at, process_error
     FROM events
     ORDER BY received_at DESC
     LIMIT 50`
  ).all();
  return json(result.results);
}
__name(handleEventsRoot, "handleEventsRoot");
async function handleEventsTest(segments, request, env, _ctx, _url) {
  if (segments.length > 0) {
    return notFound("Route not found");
  }
  if (request.method !== "POST") {
    return methodNotAllowed(["POST"]);
  }
  const body = await request.json();
  const source = body.source ?? "manual";
  const type = body.type ?? "test_event";
  const externalId = body.externalId ?? "default";
  const idempotencyKey = buildIdempotencyKey(source, type, externalId);
  await env.EVENT_QUEUE.send({
    source,
    type,
    externalId,
    idempotencyKey,
    payload: body.payload ?? body,
    receivedAt: nowISO()
  });
  return json({ enqueued: true, idempotencyKey }, 202);
}
__name(handleEventsTest, "handleEventsTest");

// src/routes/health.ts
async function handleHealth(segments, request, _env, _ctx, _url) {
  if (segments.length > 0) {
    return notFound("Route not found");
  }
  if (request.method !== "GET") {
    return methodNotAllowed(["GET"]);
  }
  return json({ status: "ok" });
}
__name(handleHealth, "handleHealth");

// src/planning/classifier.ts
var classifierVersion = "v0";
function classifyLineItem(lineItem, registries, _config, parsedConfig) {
  const warnings = [];
  const config = parsedConfig ?? safeParseConfig(lineItem.config_json, warnings);
  const categoryEntry = registries.categories.get(lineItem.category_key);
  if (!categoryEntry) {
    warnings.push(`unknown category_key: ${lineItem.category_key}`);
  } else if (!categoryEntry.is_active) {
    warnings.push(`inactive category_key: ${lineItem.category_key}`);
  }
  const deliverableEntry = registries.deliverables.get(lineItem.deliverable_key);
  if (!deliverableEntry) {
    warnings.push(`unknown deliverable_key: ${lineItem.deliverable_key}`);
  } else {
    if (!deliverableEntry.is_active) {
      warnings.push(`inactive deliverable_key: ${lineItem.deliverable_key}`);
    }
    if (deliverableEntry.category_key && deliverableEntry.category_key !== lineItem.category_key) {
      warnings.push(
        `deliverable category mismatch: ${lineItem.deliverable_key} -> ${deliverableEntry.category_key}`
      );
    }
  }
  const flags = extractFlags(config);
  const facts = extractFacts(config);
  let confidence = 1;
  if (warnings.some((warning) => warning.startsWith("invalid config_json"))) {
    confidence = Math.min(confidence, 0.7);
  }
  if (!categoryEntry || !deliverableEntry) {
    confidence = Math.min(confidence, 0.5);
  }
  return {
    category_key: lineItem.category_key,
    deliverable_key: lineItem.deliverable_key,
    flags,
    facts,
    confidence,
    warnings,
    parsed_config: config
  };
}
__name(classifyLineItem, "classifyLineItem");
function safeParseConfig(configJson, warnings) {
  try {
    const parsed = JSON.parse(configJson);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed;
    }
    return {};
  } catch {
    warnings.push("invalid config_json");
    return {};
  }
}
__name(safeParseConfig, "safeParseConfig");
function extractFlags(config) {
  const workflow = config.workflow ?? config.flags ?? config;
  return {
    requiresDesign: Boolean(workflow?.requiresDesign),
    requiresApproval: Boolean(workflow?.requiresApproval),
    requiresSamples: Boolean(workflow?.requiresSamples),
    installRequired: Boolean(workflow?.installRequired),
    deliveryRequired: Boolean(workflow?.deliveryRequired)
  };
}
__name(extractFlags, "extractFlags");
function extractFacts(config) {
  return {
    woodSpecies: config.woodSpecies ?? null,
    finish: config.finish ?? null,
    dimensions: config.dimensions ?? null,
    room: config.room ?? null,
    revisionLimit: config.revisionLimit ?? null,
    deliverables: Array.isArray(config.deliverables) ? config.deliverables : null
  };
}
__name(extractFacts, "extractFacts");

// src/planning/deterministic.ts
function stableStringify(value) {
  return JSON.stringify(sortValue(value));
}
__name(stableStringify, "stableStringify");
function sortValue(value) {
  if (Array.isArray(value)) {
    return value.map(sortValue);
  }
  if (value && typeof value === "object") {
    const record = value;
    const sortedKeys = Object.keys(record).sort();
    const result = {};
    for (const key of sortedKeys) {
      const nextValue = record[key];
      if (nextValue !== void 0) {
        result[key] = sortValue(nextValue);
      }
    }
    return result;
  }
  return value;
}
__name(sortValue, "sortValue");
async function sha256Hex(input) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error("WebCrypto subtle API not available");
  }
  const data = new TextEncoder().encode(input);
  const hash = await subtle.digest("SHA-256", data);
  const bytes = Array.from(new Uint8Array(hash));
  return bytes.map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
__name(sha256Hex, "sha256Hex");

// src/planning/planner.ts
var plannerVersion = "v0";
var PROJECT_TEMPLATE_KEYS = ["core.project.intake", "core.project.materials_review"];
function derivePlan(planInput, _config) {
  const warnings = [];
  const groups = /* @__PURE__ */ new Map();
  const projectId = `project::${planInput.record.uri}`;
  const projectGroup = ensureGroup(groups, {
    id: projectId,
    kind: "project",
    line_item_uris: [],
    template_candidates: [],
    warnings: []
  });
  if (planInput.line_items.length === 0) {
    warnings.push("no line items");
  }
  for (const templateKey of PROJECT_TEMPLATE_KEYS) {
    addCandidate(projectGroup, templateKey);
  }
  for (const lineItem of planInput.line_items) {
    projectGroup.line_item_uris.push(lineItem.uri);
    const deliverableId = `deliverable::${lineItem.uri}`;
    const deliverableGroup = ensureGroup(groups, {
      id: deliverableId,
      kind: "deliverable",
      title: lineItem.title ?? void 0,
      line_item_uris: [lineItem.uri],
      template_candidates: [],
      warnings: []
    });
    const sharedId = lineItem.group_key ? `shared::${planInput.record.uri}::${lineItem.group_key}` : null;
    if (sharedId) {
      const sharedGroup = ensureGroup(groups, {
        id: sharedId,
        kind: "shared",
        line_item_uris: [],
        template_candidates: [],
        warnings: []
      });
      sharedGroup.line_item_uris.push(lineItem.uri);
    }
    const baseKey = `${lineItem.category_key}.${lineItem.deliverable_key}.base`;
    addCandidate(deliverableGroup, baseKey);
    if (lineItem.classification.flags.requiresDesign) {
      addCandidate(
        deliverableGroup,
        `${lineItem.category_key}.${lineItem.deliverable_key}.design`
      );
    }
    if (lineItem.classification.flags.requiresApproval) {
      addCandidate(
        deliverableGroup,
        `${lineItem.category_key}.${lineItem.deliverable_key}.approval`
      );
    }
    if (lineItem.classification.flags.requiresSamples) {
      if (sharedId) {
        addCandidate(groups.get(sharedId), "core.shared.samples");
      } else {
        addCandidate(projectGroup, "core.shared.samples");
      }
    }
    if (lineItem.classification.flags.installRequired) {
      addCandidate(projectGroup, "core.shared.install_planning");
    }
    if (lineItem.classification.flags.deliveryRequired) {
      addCandidate(projectGroup, "core.shared.delivery_planning");
    }
  }
  const sortedGroups = Array.from(groups.values()).sort(
    (a, b) => a.id.localeCompare(b.id)
  );
  for (const group of sortedGroups) {
    group.line_item_uris = Array.from(new Set(group.line_item_uris)).sort();
    group.template_candidates = Array.from(new Set(group.template_candidates)).sort();
  }
  return { groups: sortedGroups, warnings };
}
__name(derivePlan, "derivePlan");
function ensureGroup(groups, group) {
  const existing = groups.get(group.id);
  if (existing) {
    return existing;
  }
  groups.set(group.id, group);
  return group;
}
__name(ensureGroup, "ensureGroup");
function addCandidate(group, key) {
  group.template_candidates.push(key);
}
__name(addCandidate, "addCandidate");

// src/planning/workspaceConfig.ts
var workspaceConfigVersion = "v0";
async function loadWorkspaceConfig(_env) {
  return {
    workspace_config_version: workspaceConfigVersion,
    samples_default_group: "project"
  };
}
__name(loadWorkspaceConfig, "loadWorkspaceConfig");

// src/planning/preview.ts
var NotFoundError = class extends Error {
  static {
    __name(this, "NotFoundError");
  }
};
async function getPlanPreview(env, recordUri) {
  const config = await loadWorkspaceConfig(env);
  const registries = await loadRegistries(env);
  const record = await loadRecord(env, recordUri);
  if (!record) {
    throw new NotFoundError(`Record not found: ${recordUri}`);
  }
  const lineItems = await loadLineItems(env, recordUri);
  const warnings = [];
  const planLineItems = lineItems.map((lineItem) => {
    const classification = classifyLineItem(lineItem, registries, config);
    if (classification.warnings.length > 0) {
      warnings.push(
        ...classification.warnings.map((warning) => `line_item ${lineItem.uri}: ${warning}`)
      );
    }
    const categoryLabel = registries.categories.get(lineItem.category_key)?.label ?? null;
    const deliverableLabel = registries.deliverables.get(lineItem.deliverable_key)?.label ?? null;
    return {
      uri: lineItem.uri,
      record_uri: lineItem.record_uri,
      title: lineItem.title,
      position: lineItem.position,
      quantity: lineItem.quantity,
      category_key: lineItem.category_key,
      category_label: categoryLabel,
      deliverable_key: lineItem.deliverable_key,
      deliverable_label: deliverableLabel,
      group_key: lineItem.group_key,
      config: classification.parsed_config,
      config_hash: lineItem.config_hash,
      classification
    };
  });
  const planInput = {
    record: {
      uri: record.uri,
      source: record.source,
      kind: record.kind,
      external_id: record.external_id,
      customer_uri: record.customer_uri,
      customer_display: record.customer_display,
      quoted_delivery_date: record.quoted_delivery_date,
      quoted_install_date: record.quoted_install_date,
      currency: record.currency,
      total_amount_cents: record.total_amount_cents,
      snapshot_hash: record.snapshot_hash
    },
    line_items: planLineItems
  };
  const planPreview = derivePlan(planInput, config);
  if (planPreview.warnings.length > 0) {
    warnings.push(...planPreview.warnings);
  }
  const planInputHash = await sha256Hex(stableStringify(planInput));
  const planId = await sha256Hex(
    `plan:${record.uri}:${record.snapshot_hash}:${planInputHash}`
  );
  return {
    plan_input: planInput,
    plan_preview: planPreview,
    versions: {
      workspace_config_version: config.workspace_config_version,
      classifier_version: classifierVersion,
      planner_version: plannerVersion
    },
    computed_at: (/* @__PURE__ */ new Date()).toISOString(),
    debug: {
      plan_id: planId,
      plan_input_hash: planInputHash,
      snapshot_hash: record.snapshot_hash
    },
    warnings
  };
}
__name(getPlanPreview, "getPlanPreview");
async function loadRegistries(env) {
  const categories = await env.DB.prepare(
    "SELECT key, label, is_active FROM line_item_categories"
  ).all();
  const deliverables = await env.DB.prepare(
    "SELECT key, label, category_key, is_active FROM deliverable_kinds"
  ).all();
  const categoryMap = /* @__PURE__ */ new Map();
  for (const row of categories.results) {
    categoryMap.set(row.key, row);
  }
  const deliverableMap = /* @__PURE__ */ new Map();
  for (const row of deliverables.results) {
    deliverableMap.set(row.key, row);
  }
  return { categories: categoryMap, deliverables: deliverableMap };
}
__name(loadRegistries, "loadRegistries");
async function loadRecord(env, recordUri) {
  return env.DB.prepare(
    `SELECT uri, source, kind, external_id, customer_uri, customer_display,
            quoted_delivery_date, quoted_install_date, currency, total_amount_cents,
            snapshot_json, snapshot_hash, first_seen_at, last_seen_at, last_event_id,
            created_at, updated_at
     FROM commercial_records
     WHERE uri = ?`
  ).bind(recordUri).first();
}
__name(loadRecord, "loadRecord");
async function loadLineItems(env, recordUri) {
  const result = await env.DB.prepare(
    `SELECT uri, record_uri, category_key, deliverable_key, group_key, title, quantity,
            unit_price_cents, amount_cents, position, config_json, config_hash,
            snapshot_json, snapshot_hash, created_at, updated_at
     FROM commercial_line_items
     WHERE record_uri = ?
     ORDER BY position, uri`
  ).bind(recordUri).all();
  return result.results ?? [];
}
__name(loadLineItems, "loadLineItems");

// src/routes/plan.ts
async function handlePlan(segments, request, env, ctx, url) {
  return handleSegment(
    segments,
    request,
    env,
    ctx,
    url,
    {
      preview: handlePlanPreview
    },
    () => notFound("Route not found")
  );
}
__name(handlePlan, "handlePlan");
async function handlePlanPreview(segments, request, env, _ctx, url) {
  if (segments.length > 0) {
    return notFound("Route not found");
  }
  if (request.method !== "GET") {
    return methodNotAllowed(["GET"]);
  }
  const recordUri = url.searchParams.get("record_uri");
  if (!recordUri) {
    return badRequest("Missing record_uri query parameter");
  }
  try {
    const response = await getPlanPreview(env, recordUri);
    return json(response);
  } catch (error) {
    if (error instanceof NotFoundError) {
      return notFound(error.message);
    }
    return serverError("Failed to build plan preview");
  }
}
__name(handlePlanPreview, "handlePlanPreview");

// src/routes/projects.ts
async function handleProjects(segments, request, env, _ctx, _url) {
  if (segments.length > 0) {
    return notFound("Route not found");
  }
  if (request.method === "GET") {
    const result = await env.DB.prepare(
      "SELECT * FROM projects ORDER BY created_at DESC"
    ).all();
    return json(result.results);
  }
  if (request.method === "POST") {
    const id = crypto.randomUUID();
    const now = (/* @__PURE__ */ new Date()).toISOString();
    await env.DB.prepare(
      `
      INSERT INTO projects (id, title, project_type, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `
    ).bind(id, "Test Project", "internal", "intake", now, now).run();
    return json({ id }, 201);
  }
  return methodNotAllowed(["GET", "POST"]);
}
__name(handleProjects, "handleProjects");

// src/lib/router.ts
async function route(request, env, ctx) {
  const url = new URL(request.url);
  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length === 0) {
    return notFound("Route not found");
  }
  return routesRoot(segments, request, env, ctx, url);
}
__name(route, "route");
async function handleSegment(segments, request, env, ctx, url, handlers, fallback) {
  if (segments.length === 0) {
    return fallback(segments, request, env, ctx, url);
  }
  const [head, ...tail] = segments;
  const handler = handlers[head];
  if (!handler) {
    return fallback(tail, request, env, ctx, url);
  }
  return handler(tail, request, env, ctx, url);
}
__name(handleSegment, "handleSegment");
async function routesRoot(segments, request, env, ctx, url) {
  return handleSegment(
    segments,
    request,
    env,
    ctx,
    url,
    {
      health: handleHealth,
      projects: handleProjects,
      events: handleEvents,
      plan: handlePlan
    },
    () => notFound("Route not found")
  );
}
__name(routesRoot, "routesRoot");

// src/index.ts
var src_default = {
  async fetch(request, env, ctx) {
    return route(request, env, ctx);
  },
  async queue(batch, env, _ctx) {
    for (const msg of batch.messages) {
      const evt = msg.body;
      const now = nowISO();
      try {
        await env.DB.prepare(
          `INSERT INTO events
            (id, source, type, external_id, idempotency_key, payload, received_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          crypto.randomUUID(),
          evt.source,
          evt.type,
          evt.externalId ?? null,
          evt.idempotencyKey,
          JSON.stringify(evt.payload ?? {}),
          evt.receivedAt ?? now
        ).run();
      } catch {
        msg.ack();
        continue;
      }
      await env.DB.prepare(
        `UPDATE events
         SET processed_at = ?, process_error = NULL
         WHERE idempotency_key = ?`
      ).bind(now, evt.idempotencyKey).run();
      msg.ack();
    }
  }
};

// node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    return Response.json(error, {
      status: 500,
      headers: { "MF-Experimental-Error-Stack": "true" }
    });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-AODA0F/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = src_default;

// node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-AODA0F/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=index.js.map
