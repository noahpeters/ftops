import type { Env } from "../lib/types";
import { check } from "./common";
import {
  checkout,
  reconcileAttempt,
  syncWorkspacePayments,
  refundInvoice,
  stripeWebhook,
} from "./payments";

// Application routes depend on commercial operations, not Stripe API payloads.
// A subsequent provider can implement this contract without changing agreements,
// signature evidence, invoices or the customer payment journey.
export interface PaymentAdapter {
  createCheckout(
    env: Env,
    workspace: string,
    revisionId: string,
    invoiceId: string
  ): Promise<{ url: unknown }>;
  reconcile(env: Env, workspace: string): Promise<void>;
  reconcilePayment(env: Env, workspace: string, paymentId: string): Promise<void>;
  refund(
    env: Env,
    workspace: string,
    invoiceId: string,
    amountCents: number,
    reason: string,
    requestId: string
  ): Promise<{ id: string; status: unknown }>;
  handleWebhook(env: Env, workspace: string, request: Request, environment?: string): Promise<void>;
}
const stripe: PaymentAdapter = {
  createCheckout: checkout,
  reconcile: syncWorkspacePayments,
  reconcilePayment: reconcileAttempt,
  refund: refundInvoice,
  handleWebhook: stripeWebhook,
};
export function paymentAdapter(provider = "stripe"): PaymentAdapter {
  check(provider === "stripe", "payment_provider_not_configured", 503);
  return stripe;
}
