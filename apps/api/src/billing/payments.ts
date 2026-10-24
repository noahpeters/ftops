import { decryptSecrets } from "../lib/crypto/secrets";
import type { Env } from "../lib/types";
import { check, now, settings, publicOrigin, audit, BillingError, readText } from "./common";
import { loadRevision, publicProposal } from "./model";

type StripeObject = { id: string; [key: string]: unknown };
export interface PaymentProvider {
  request(
    path: string,
    parameters?: URLSearchParams,
    idempotencyKey?: string
  ): Promise<StripeObject>;
}
export class StripeProvider implements PaymentProvider {
  constructor(private key: string) {}
  async request(
    path: string,
    parameters?: URLSearchParams,
    idempotencyKey?: string
  ): Promise<StripeObject> {
    check(path.startsWith("/") && !path.includes("://"), "invalid_provider_path");
    const response = await fetch(`https://api.stripe.com/v1${path}`, {
      method: parameters ? "POST" : "GET",
      headers: {
        Authorization: `Bearer ${this.key}`,
        "Stripe-Version": "2025-06-30.basil",
        ...(parameters ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
      },
      body: parameters?.toString(),
      signal: AbortSignal.timeout(20000),
      redirect: "manual",
    });
    check(response.ok, "stripe_unavailable", 503);
    return (await response.json()) as StripeObject;
  }
}
async function provider(env: Env, workspace: string, environment?: string) {
  const current = await settings(env, workspace);
  const selected = environment ?? current.environment;
  const saved = await env.DB.prepare(
    "SELECT secrets_key_id,secrets_ciphertext FROM native_stripe_configs WHERE workspace_id=? AND environment=?"
  )
    .bind(workspace, selected)
    .first<{ secrets_key_id: string; secrets_ciphertext: string }>();
  check(saved, "stripe_not_configured", 503);
  const stripeSecrets = JSON.parse(
    await decryptSecrets(env, saved.secrets_key_id, saved.secrets_ciphertext)
  ) as { stripeKey?: string; stripeWebhookSecret?: string };
  check(stripeSecrets.stripeKey, "stripe_not_configured", 503);
  const config = {
    ...current,
    environment: selected,
    secrets: { ...current.secrets, ...stripeSecrets },
  };
  return { stripe: new StripeProvider(stripeSecrets.stripeKey), config };
}
const objectId = (value: unknown): string | null =>
  typeof value === "string"
    ? value
    : value && typeof value === "object" && "id" in value
      ? String(value.id)
      : null;
const amount = (value: unknown) => {
  check(Number.isSafeInteger(value), "invalid_provider_amount", 503);
  return value as number;
};

export async function checkout(env: Env, workspace: string, revisionId: string, invoiceId: string) {
  const row = await loadRevision(env, revisionId, workspace);
  check(row.status === "signed", "signed_documents_required", 409);
  const invoice = await env.DB.prepare(
    "SELECT id,amount_cents,status,label FROM native_invoices WHERE workspace_id=? AND revision_id=? AND id=?"
  )
    .bind(workspace, revisionId, invoiceId)
    .first<{ id: string; amount_cents: number; status: string; label: string }>();
  check(invoice, "invoice_not_found", 404);
  check(["issued", "failed", "processing"].includes(invoice.status), "invoice_not_payable", 409);
  check(invoice.amount_cents > 0, "zero_balance_no_payment_required", 409);
  const { stripe, config } = await provider(env, workspace, publicProposal(row).paymentEnvironment);
  let attempt = await env.DB.prepare(
    "SELECT * FROM native_payment_attempts WHERE workspace_id=? AND invoice_id=? AND state IN ('creating','open','processing','paid')"
  )
    .bind(workspace, invoiceId)
    .first<{
      id: string;
      session_id: string | null;
      state: string;
      created_at: string;
      amount_cents: number;
      environment: string;
    }>();
  if (attempt) {
    check(attempt.environment === config.environment, "payment_environment_changed", 409);
    check(attempt.amount_cents === invoice.amount_cents, "invoice_amount_changed", 409);
  }
  if (attempt?.session_id) {
    const session = await stripe.request(
      `/checkout/sessions/${encodeURIComponent(attempt.session_id)}`
    );
    if (session.status === "open") {
      check(
        typeof session.url === "string" && new URL(session.url).hostname === "checkout.stripe.com",
        "invalid_checkout_url",
        503
      );
      return { url: session.url };
    }
    if (session.status === "expired") {
      await env.DB.prepare(
        "UPDATE native_payment_attempts SET state='expired',updated_at=? WHERE id=? AND state='open'"
      )
        .bind(now(), attempt.id)
        .run();
      attempt = null;
    } else {
      await reconcileAttempt(env, workspace, attempt.id);
      throw new BillingError("payment_already_submitted", 409);
    }
  }
  if (!attempt) {
    const id = crypto.randomUUID();
    try {
      await env.DB.prepare(
        "INSERT INTO native_payment_attempts(id,workspace_id,invoice_id,state,provider,environment,amount_cents,created_at,updated_at) VALUES(?,?,?,'creating','stripe',?,?,?,?)"
      )
        .bind(id, workspace, invoiceId, config.environment, invoice.amount_cents, now(), now())
        .run();
    } catch {
      throw new BillingError("payment_in_progress_retry", 409);
    }
    attempt = {
      id,
      session_id: null,
      state: "creating",
      created_at: now(),
      amount_cents: invoice.amount_cents,
      environment: config.environment,
    };
  }
  check(
    Date.now() - Date.parse(attempt.created_at) < 23 * 60 * 60 * 1000,
    "payment_requires_reconciliation",
    409
  );
  const p = publicProposal(row);
  const origin = publicOrigin(env);
  const params = new URLSearchParams({
    mode: "payment",
    "payment_method_types[0]": "card",
    "payment_method_types[1]": "us_bank_account",
    "line_items[0][price_data][currency]": "usd",
    "line_items[0][price_data][unit_amount]": String(invoice.amount_cents),
    "line_items[0][price_data][product_data][name]": `${config.issuer_name} - ${invoice.label}`,
    "line_items[0][quantity]": "1",
    customer_email: p.signerEmail,
    client_reference_id: attempt.id,
    "metadata[attempt_id]": attempt.id,
    "payment_intent_data[metadata][attempt_id]": attempt.id,
    success_url: `${origin}/billing-public/?payment=returned`,
    cancel_url: `${origin}/billing-public/?payment=cancelled`,
  });
  const session = await stripe.request(
    "/checkout/sessions",
    params,
    `ftops-checkout-${attempt.id}`
  );
  check(
    typeof session.url === "string" && new URL(session.url).hostname === "checkout.stripe.com",
    "invalid_checkout_url",
    503
  );
  await env.DB.prepare(
    "UPDATE native_payment_attempts SET session_id=?,checkout_url=?,state='open',updated_at=? WHERE id=? AND state='creating'"
  )
    .bind(session.id, session.url, now(), attempt.id)
    .run();
  return { url: session.url };
}

async function ledger(
  env: Env,
  workspace: string,
  invoice: string | null,
  id: string,
  kind: string,
  gross: number,
  fee: number | null,
  net: number | null,
  status: string,
  available: string | null,
  details: Record<string, unknown>
) {
  await env.DB.prepare(
    "INSERT INTO native_payment_ledger VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(workspace_id,provider_id,kind) DO UPDATE SET amount_cents=excluded.amount_cents,fee_cents=COALESCE(excluded.fee_cents,native_payment_ledger.fee_cents),net_cents=COALESCE(excluded.net_cents,native_payment_ledger.net_cents),status=CASE WHEN native_payment_ledger.status='available' AND excluded.status='pending' THEN native_payment_ledger.status ELSE excluded.status END,available_at=excluded.available_at,details_json=excluded.details_json,updated_at=excluded.updated_at"
  )
    .bind(
      crypto.randomUUID(),
      workspace,
      invoice,
      id,
      kind,
      gross,
      fee,
      net,
      status,
      available,
      JSON.stringify(details),
      now()
    )
    .run();
}
async function balance(
  env: Env,
  workspace: string,
  invoice: string | null,
  value: unknown,
  stripe: PaymentProvider,
  kind: string,
  fallbackId: string,
  gross: number,
  status: string
) {
  const id = objectId(value);
  if (!id) {
    await ledger(env, workspace, invoice, fallbackId, kind, gross, null, null, status, null, {});
    return;
  }
  const bt = await stripe.request(`/balance_transactions/${encodeURIComponent(id)}`);
  await ledger(
    env,
    workspace,
    invoice,
    kind === "dispute_balance" ? id : fallbackId,
    kind,
    amount(bt.amount),
    amount(bt.fee),
    amount(bt.net),
    String(bt.status),
    typeof bt.available_on === "number" ? new Date(bt.available_on * 1000).toISOString() : null,
    { sourceId: fallbackId, providerStatus: status }
  );
}
export async function reconcileAttempt(
  env: Env,
  workspace: string,
  attemptId: string,
  knownProvider?: PaymentProvider
) {
  const attempt = await env.DB.prepare(
    "SELECT * FROM native_payment_attempts WHERE workspace_id=? AND id=?"
  )
    .bind(workspace, attemptId)
    .first<{
      id: string;
      invoice_id: string;
      session_id: string | null;
      amount_cents: number;
      environment: string;
      created_at: string;
    }>();
  check(attempt, "payment_not_found", 404);
  const { stripe, config } = knownProvider
    ? {
        stripe: knownProvider,
        config: { ...(await settings(env, workspace)), environment: attempt.environment },
      }
    : await provider(env, workspace, attempt.environment);
  check(attempt.environment === config.environment, "payment_environment_changed", 409);
  if (!attempt.session_id) {
    const sessions = await listStripe(
      stripe,
      `/checkout/sessions?created[gte]=${Math.floor(Date.parse(attempt.created_at) / 1000) - 60}`
    );
    const match = sessions.find((s) => s.client_reference_id === attempt.id);
    if (!match) return;
    await env.DB.prepare(
      "UPDATE native_payment_attempts SET session_id=? WHERE id=? AND session_id IS NULL"
    )
      .bind(match.id, attempt.id)
      .run();
    attempt.session_id = match.id;
  }
  const session = await stripe.request(
    `/checkout/sessions/${encodeURIComponent(attempt.session_id)}`
  );
  check(
    session.livemode === (config.environment === "production") &&
      session.currency === "usd" &&
      session.amount_total === attempt.amount_cents &&
      session.client_reference_id === attempt.id,
    "stripe_payment_mismatch",
    409
  );
  const piId = objectId(session.payment_intent);
  let state =
    session.status === "expired" ? "expired" : session.status === "open" ? "open" : "processing";
  let invoiceState = "processing";
  let refundTotal = 0;
  if (piId) {
    const pi = await stripe.request(
      `/payment_intents/${encodeURIComponent(piId)}?expand[]=latest_charge`
    );
    check(
      pi.currency === "usd" && pi.amount === attempt.amount_cents,
      "stripe_payment_mismatch",
      409
    );
    if (pi.status === "succeeded") {
      state = "paid";
      invoiceState = "paid";
    } else if (pi.status === "canceled" || pi.status === "requires_payment_method") {
      state = "failed";
      invoiceState = "failed";
    }
    const charge =
      pi.latest_charge && typeof pi.latest_charge === "object"
        ? (pi.latest_charge as StripeObject)
        : null;
    if (charge) {
      const refunded = amount(charge.amount_refunded ?? 0);
      refundTotal = refunded;
      const disputed = charge.disputed === true;
      if (refunded === attempt.amount_cents && refunded > 0) invoiceState = "refunded";
      if (disputed) invoiceState = "disputed";
      await balance(
        env,
        workspace,
        attempt.invoice_id,
        charge.balance_transaction,
        stripe,
        "charge",
        charge.id,
        amount(charge.amount),
        String(charge.status)
      );
      const refunds = await listStripe(stripe, `/refunds?charge=${encodeURIComponent(charge.id)}`);
      for (const refund of refunds)
        await balance(
          env,
          workspace,
          attempt.invoice_id,
          refund.balance_transaction,
          stripe,
          "refund",
          refund.id,
          -amount(refund.amount),
          String(refund.status)
        );
      {
        const disputes = await listStripe(
          stripe,
          `/disputes?charge=${encodeURIComponent(charge.id)}`
        );
        for (const d of disputes) {
          await ledger(
            env,
            workspace,
            attempt.invoice_id,
            d.id,
            "dispute",
            amount(d.amount),
            null,
            null,
            String(d.status),
            null,
            { dueBy: (d.evidence_details as { due_by?: number } | undefined)?.due_by ?? null }
          );
          for (const transaction of Array.isArray(d.balance_transactions)
            ? d.balance_transactions
            : [])
            await balance(
              env,
              workspace,
              attempt.invoice_id,
              transaction,
              stripe,
              "dispute_balance",
              d.id,
              0,
              String(d.status)
            );
        }
      }
    }
  }
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE native_payment_attempts SET state=?,payment_intent_id=?,updated_at=? WHERE id=? AND (state!='paid' OR ?='paid')"
    ).bind(state, piId, now(), attempt.id, state),
    env.DB.prepare(
      "UPDATE native_invoices SET status=?,refunded_cents=MAX(refunded_cents,?) WHERE id=? AND ? NOT IN ('open','expired','creating') AND NOT(status IN ('paid','refunded','disputed') AND ? IN ('processing','failed'))"
    ).bind(invoiceState, refundTotal, attempt.invoice_id, state, invoiceState),
  ]);
  if (invoiceState === "paid") {
    const invoice = await env.DB.prepare(
      "SELECT revision_id,label FROM native_invoices WHERE workspace_id=? AND id=?"
    )
      .bind(workspace, attempt.invoice_id)
      .first<{ revision_id: string; label: string }>();
    if (invoice) {
      const row = await loadRevision(env, invoice.revision_id, workspace);
      const p = publicProposal(row);
      await env.DB.prepare(
        "INSERT OR IGNORE INTO native_billing_deliveries(id,workspace_id,revision_id,recipient,subject,body,created_at) VALUES(?,?,?,?,?,?,?)"
      )
        .bind(
          `payment-${attempt.id}`,
          workspace,
          row.id,
          p.signerEmail,
          `Payment confirmed: ${invoice.label}`,
          `Your payment of ${(attempt.amount_cents / 100).toFixed(2)} USD for ${invoice.label} has been confirmed. Use your existing secure project link to view invoices and payment status. Bank payout to the business is tracked separately.`,
          now()
        )
        .run();
    }
  }
}
async function listStripe(stripe: PaymentProvider, path: string) {
  const objects: StripeObject[] = [];
  let cursor = "";
  for (let page = 0; page < 100; page++) {
    const result = await stripe.request(
      `${path}${path.includes("?") ? "&" : "?"}limit=100${cursor ? `&starting_after=${encodeURIComponent(cursor)}` : ""}`
    );
    check(Array.isArray(result.data), "invalid_provider_response", 503);
    const rows = result.data as StripeObject[];
    objects.push(...rows);
    if (!result.has_more) return objects;
    check(rows.length > 0, "invalid_provider_pagination", 503);
    cursor = rows[rows.length - 1].id;
  }
  throw new BillingError("provider_reconciliation_page_limit", 503);
}
export async function syncWorkspacePayments(env: Env, workspace: string) {
  const { stripe } = await provider(env, workspace);
  const attempts = await env.DB.prepare(
    "SELECT id FROM native_payment_attempts WHERE workspace_id=? ORDER BY created_at DESC LIMIT 1000"
  )
    .bind(workspace)
    .all<{ id: string }>();
  for (const attempt of attempts.results) await reconcileAttempt(env, workspace, attempt.id);
  const payouts = await listStripe(stripe, "/payouts");
  for (const payout of payouts)
    await ledger(
      env,
      workspace,
      null,
      payout.id,
      "payout",
      amount(payout.amount),
      null,
      null,
      String(payout.status),
      typeof payout.arrival_date === "number"
        ? new Date(payout.arrival_date * 1000).toISOString()
        : null,
      {
        automatic: payout.automatic === true,
        method: payout.method,
        failureCode: payout.failure_code ?? null,
      }
    );
}
export async function refundInvoice(
  env: Env,
  workspace: string,
  invoice: string,
  refundAmount: number,
  reason: string,
  requestId: string
) {
  const attempt = await env.DB.prepare(
    "SELECT id,payment_intent_id,environment FROM native_payment_attempts WHERE workspace_id=? AND invoice_id=? AND state='paid'"
  )
    .bind(workspace, invoice)
    .first<{ id: string; payment_intent_id: string; environment: string }>();
  check(attempt?.payment_intent_id, "paid_payment_not_found", 404);
  const { stripe } = await provider(env, workspace, attempt.environment);
  const refund = await stripe.request(
    "/refunds",
    new URLSearchParams({
      payment_intent: attempt.payment_intent_id,
      amount: String(refundAmount),
      "metadata[ftops_request_id]": requestId,
    }),
    `ftops-refund-${workspace}-${requestId}`
  );
  await audit(env, workspace, null, "refund.requested", "staff", {
    invoice,
    refundId: refund.id,
    amountCents: refundAmount,
    reason,
  });
  await reconcileAttempt(env, workspace, attempt.id);
  return { id: refund.id, status: refund.status };
}

export async function stripeWebhook(
  env: Env,
  workspace: string,
  request: Request,
  environment?: string
) {
  const { config } = await provider(env, workspace, environment);
  check(config.secrets.stripeWebhookSecret, "stripe_webhook_not_configured", 503);
  const raw = await readText(request, 1000000);
  check(raw.length <= 1000000, "request_too_large", 413);
  const header = request.headers.get("stripe-signature") ?? "";
  const parts = header.split(",");
  const timestamp = parts.find((s) => s.startsWith("t="))?.slice(2);
  check(
    timestamp && /^\d+$/.test(timestamp) && Math.abs(Date.now() / 1000 - Number(timestamp)) <= 300,
    "invalid_webhook_signature",
    401
  );
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(config.secrets.stripeWebhookSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"]
  );
  let valid = false;
  for (const part of parts.filter((p) => /^v1=[a-f0-9]{64}$/.test(p))) {
    const bytes = Uint8Array.from(part.slice(3).match(/../g)!, (p) => parseInt(p, 16));
    if (
      await crypto.subtle.verify(
        "HMAC",
        key,
        bytes,
        new TextEncoder().encode(`${timestamp}.${raw}`)
      )
    )
      valid = true;
  }
  check(valid, "invalid_webhook_signature", 401);
  const event = JSON.parse(raw) as {
    id: string;
    type: string;
    livemode: boolean;
    data: { object: StripeObject };
  };
  check(
    typeof event.id === "string" && event.livemode === (config.environment === "production"),
    "invalid_webhook_event",
    400
  );
  if (
    await env.DB.prepare(
      "SELECT id FROM native_payment_events WHERE workspace_id=? AND provider_event_id=?"
    )
      .bind(workspace, event.id)
      .first()
  )
    return;
  const object = event.data.object;
  let attemptId: string | null = null;
  if (event.type.startsWith("checkout.session."))
    attemptId = typeof object.client_reference_id === "string" ? object.client_reference_id : null;
  else {
    let intent = event.type.startsWith("payment_intent.")
      ? object.id
      : objectId(object.payment_intent);
    if (!intent && object.charge) {
      const { stripe } = await provider(env, workspace);
      const charge = await stripe.request(
        `/charges/${encodeURIComponent(objectId(object.charge)!)}`
      );
      intent = objectId(charge.payment_intent);
    }
    if (intent) {
      const attempt = await env.DB.prepare(
        "SELECT id FROM native_payment_attempts WHERE workspace_id=? AND payment_intent_id=?"
      )
        .bind(workspace, intent)
        .first<{ id: string }>();
      attemptId = attempt?.id ?? null;
    }
  }
  if (attemptId) {
    const exists = await env.DB.prepare(
      "SELECT id FROM native_payment_attempts WHERE workspace_id=? AND id=?"
    )
      .bind(workspace, attemptId)
      .first();
    if (exists) await reconcileAttempt(env, workspace, attemptId);
  }
  if (event.type.startsWith("payout.")) await syncWorkspacePayments(env, workspace);
  await env.DB.prepare("INSERT OR IGNORE INTO native_payment_events VALUES(?,?,?,?,?)")
    .bind(crypto.randomUUID(), workspace, event.id, event.type, now())
    .run();
}
