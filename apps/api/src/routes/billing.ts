import { calculateEstimate } from "../domain/estimate";
import type { Env } from "../lib/types";
import { canAdminWorkspace, requireActor } from "../lib/access";
import { isTrustedMutationOrigin } from "../lib/security";
import { json } from "../lib/http";
import { encryptSecrets, decryptSecrets } from "../lib/crypto/secrets";
import {
  BillingError,
  check,
  text,
  readBody,
  settings,
  now,
  hashObject,
  randomToken,
  publicOrigin,
  audit,
  type BillingSecrets,
} from "../billing/common";
import { document, signingIdentity } from "../billing/documents";
import { proposalInput, loadRevision, estimatePdf } from "../billing/model";
import { paymentAdapter } from "../billing/provider";

export async function handleBilling(
  segments: string[],
  request: Request,
  env: Env,
  _ctx: ExecutionContext,
  url: URL
) {
  try {
    check(
      ["cf-access-authenticated-user-email", "x-auth-request-email", "x-debug-user-email"].some(
        (h) => request.headers.get(h)
      ),
      "unauthorized",
      401
    );
    const result = await requireActor(env, request);
    if (!result.ok) return result.response;
    const workspace = text(url.searchParams.get("workspaceId"), "workspace_id");
    check(canAdminWorkspace(result.actor, workspace), "forbidden", 403);
    if (request.method !== "GET")
      check(isTrustedMutationOrigin(request), "csrf_origin_invalid", 403);
    const actor = result.actor.email;
    if (segments[0] === "settings" && segments.length === 1) {
      if (request.method === "GET") {
        const exists = await env.DB.prepare(
          "SELECT workspace_id FROM native_billing_settings WHERE workspace_id=?"
        )
          .bind(workspace)
          .first();
        if (!exists) return json({ configured: false });
        const config = await settings(env, workspace);
        return json({
          configured: true,
          webhookUrl: `${publicOrigin(env)}/billing-public/stripe/${workspace}/${config.environment}`,
          issuerName: config.issuer_name,
          replyEmail: config.reply_email,
          disclosure: config.disclosure,
          environment: config.environment,
          hasStripe: !!config.secrets.stripeKey,
          hasWebhookSecret: !!config.secrets.stripeWebhookSecret,
          hasTimestamp: !!config.secrets.timestampUrl && !!config.secrets.timestampTrustPem,
          hasSigning: !!config.secrets.signingKeyPkcs8 && !!config.secrets.signingCertificatePem,
        });
      }
      if (request.method === "POST") {
        const body = await readBody(request);
        const issuer = text(body.issuerName, "issuer_name", 150);
        const email = text(body.replyEmail, "reply_email");
        check(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email), "invalid_reply_email");
        const disclosure = text(body.disclosure, "disclosure", 8000);
        const environment = text(body.environment, "environment");
        check(["sandbox", "production"].includes(environment), "invalid_environment");
        const existing = await env.DB.prepare(
          "SELECT workspace_id FROM native_billing_settings WHERE workspace_id=?"
        )
          .bind(workspace)
          .first();
        const previous = existing ? await settings(env, workspace) : null;
        const target = await env.DB.prepare(
          "SELECT secrets_key_id,secrets_ciphertext FROM native_stripe_configs WHERE workspace_id=? AND environment=?"
        )
          .bind(workspace, environment)
          .first<{ secrets_key_id: string; secrets_ciphertext: string }>();
        const targetSecrets = target
          ? (JSON.parse(
              await decryptSecrets(env, target.secrets_key_id, target.secrets_ciphertext)
            ) as BillingSecrets)
          : {};
        const secrets: BillingSecrets = {
          ...(previous?.secrets ?? {}),
          stripeKey: targetSecrets.stripeKey,
          stripeWebhookSecret: targetSecrets.stripeWebhookSecret,
        };
        for (const key of [
          "timestampUrl",
          "timestampTrustPem",
          "stripeKey",
          "stripeWebhookSecret",
          "signingKeyPkcs8",
          "signingCertificatePem",
        ] as const)
          if (body[key] !== undefined) secrets[key] = text(body[key], key, 100000);
        if (secrets.timestampUrl || secrets.timestampTrustPem) {
          check(
            secrets.timestampUrl && secrets.timestampTrustPem,
            "timestamp_url_and_trust_required"
          );
          check(new URL(secrets.timestampUrl).protocol === "https:", "timestamp_requires_https");
        }
        if (secrets.stripeKey)
          check(
            secrets.stripeKey.startsWith(environment === "sandbox" ? "sk_test_" : "sk_live_") ||
              secrets.stripeKey.startsWith(environment === "sandbox" ? "rk_test_" : "rk_live_"),
            "stripe_key_environment_mismatch"
          );
        if (secrets.stripeWebhookSecret)
          check(secrets.stripeWebhookSecret.startsWith("whsec_"), "invalid_webhook_secret");
        if (secrets.signingKeyPkcs8 || secrets.signingCertificatePem) {
          check(
            secrets.signingKeyPkcs8 && secrets.signingCertificatePem,
            "signing_key_and_certificate_required"
          );
          await signingIdentity(secrets.signingKeyPkcs8, secrets.signingCertificatePem);
        }
        const encrypted = await encryptSecrets(env, JSON.stringify(secrets));
        await env.DB.prepare(
          "INSERT INTO native_billing_settings VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(workspace_id) DO UPDATE SET issuer_name=excluded.issuer_name,reply_email=excluded.reply_email,disclosure=excluded.disclosure,environment=excluded.environment,secrets_key_id=excluded.secrets_key_id,secrets_ciphertext=excluded.secrets_ciphertext,updated_at=excluded.updated_at"
        )
          .bind(
            workspace,
            issuer,
            email,
            disclosure,
            environment,
            encrypted.keyId,
            encrypted.ciphertext,
            now()
          )
          .run();
        const stripeSecrets = await encryptSecrets(
          env,
          JSON.stringify({
            stripeKey: secrets.stripeKey,
            stripeWebhookSecret: secrets.stripeWebhookSecret,
          })
        );
        await env.DB.prepare(
          "INSERT INTO native_stripe_configs VALUES(?,?,?,?,?) ON CONFLICT(workspace_id,environment) DO UPDATE SET secrets_key_id=excluded.secrets_key_id,secrets_ciphertext=excluded.secrets_ciphertext,updated_at=excluded.updated_at"
        )
          .bind(workspace, environment, stripeSecrets.keyId, stripeSecrets.ciphertext, now())
          .run();
        await audit(env, workspace, null, "settings.updated", actor);
        return json({ ok: true });
      }
    }
    if (segments[0] === "terms" && segments.length === 1) {
      if (request.method === "GET")
        return json(
          (
            await env.DB.prepare(
              "SELECT id,version_label,title,content,content_hash,created_at FROM native_terms_versions WHERE workspace_id=? ORDER BY created_at DESC"
            )
              .bind(workspace)
              .all()
          ).results
        );
      if (request.method === "POST") {
        const body = await readBody(request);
        const label = text(body.versionLabel, "version_label", 100),
          title = text(body.title, "terms_title", 200),
          content = text(body.content, "terms_content", 60000);
        const hash = await hashObject({ label, title, content });
        let row = await env.DB.prepare(
          "SELECT id,content_hash FROM native_terms_versions WHERE workspace_id=? AND version_label=?"
        )
          .bind(workspace, label)
          .first<{ id: string; content_hash: string }>();
        if (row) check(row.content_hash === hash, "terms_version_already_exists", 409);
        else {
          row = { id: crypto.randomUUID(), content_hash: hash };
          await env.DB.prepare("INSERT INTO native_terms_versions VALUES(?,?,?,?,?,?,?,?)")
            .bind(row.id, workspace, label, title, content, hash, now(), actor)
            .run();
        }
        const documentId = await document(
          env,
          workspace,
          `terms:${row.id}`,
          "terms_master",
          null,
          row.id,
          {
            title,
            subtitle: `Terms version ${label}`,
            paragraphs: [content, `Content SHA-256: ${hash}`],
          }
        );
        return json({ id: row.id, documentId }, 201);
      }
    }
    if (segments[0] === "estimates" && segments.length === 1) {
      if (request.method === "GET")
        return json(
          (
            await env.DB.prepare(
              "SELECT r.id,r.estimate_id,r.revision,r.status,r.title,r.public_json,r.created_at,e.customer_id,e.project_id,e.contact_id FROM native_estimates e JOIN native_estimate_revisions r ON r.estimate_id=e.id AND r.revision=e.current_revision WHERE e.workspace_id=? ORDER BY r.created_at DESC"
            )
              .bind(workspace)
              .all()
          ).results
        );
      if (request.method === "POST") {
        const body = await readBody(request);
        const config = await settings(env, workspace);
        const data = await proposalInput(
          env,
          workspace,
          body,
          config.disclosure,
          config.environment,
          { name: config.issuer_name, replyEmail: config.reply_email }
        );
        const estimateId = crypto.randomUUID(),
          revisionId = crypto.randomUUID();
        await env.DB.batch([
          env.DB.prepare("INSERT INTO native_estimates VALUES(?,?,?,?,?,?,?)").bind(
            estimateId,
            workspace,
            data.customerId,
            data.projectId,
            data.contactId,
            1,
            now()
          ),
          env.DB.prepare(
            "INSERT INTO native_estimate_revisions VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)"
          ).bind(
            revisionId,
            workspace,
            estimateId,
            1,
            "draft",
            data.proposal.title,
            JSON.stringify(data.snapshot),
            JSON.stringify(data.proposal),
            data.hash,
            data.proposal.terms.id,
            data.expiresAt,
            now(),
            actor
          ),
        ]);
        return json({ id: revisionId, estimateId }, 201);
      }
    }
    if (segments[0] === "estimates" && segments[1]) {
      const row = await loadRevision(env, segments[1], workspace);
      if (request.method === "GET" && segments.length === 2) {
        const [documents, evidence, invoices, audits] = await Promise.all([
          env.DB.prepare(
            "SELECT id,kind,sha256,certificate_fingerprint,signing_profile,created_at FROM native_documents WHERE workspace_id=? AND revision_id=? ORDER BY created_at"
          )
            .bind(workspace, row.id)
            .all(),
          env.DB.prepare(
            "SELECT * FROM native_signature_evidence WHERE workspace_id=? AND revision_id=?"
          )
            .bind(workspace, row.id)
            .first(),
          env.DB.prepare(
            "SELECT * FROM native_invoices WHERE workspace_id=? AND revision_id=? ORDER BY created_at,number"
          )
            .bind(workspace, row.id)
            .all(),
          env.DB.prepare(
            "SELECT action,actor,occurred_at,details_json FROM native_billing_audit WHERE workspace_id=? AND revision_id=? ORDER BY occurred_at"
          )
            .bind(workspace, row.id)
            .all(),
        ]);
        const draft = JSON.parse(row.snapshot_json) as {
          draft: Parameters<typeof calculateEstimate>[0];
        };
        const calculation = calculateEstimate(draft.draft);
        const transactions = await env.DB.prepare(
          "SELECT l.* FROM native_payment_ledger l JOIN native_invoices i ON i.id=l.invoice_id AND i.workspace_id=l.workspace_id WHERE i.workspace_id=? AND i.revision_id=?"
        )
          .bind(workspace, row.id)
          .all<{
            kind: string;
            amount_cents: number;
            fee_cents: number | null;
            status: string;
            details_json: string;
            invoice_id: string;
          }>();
        const proposal = JSON.parse(row.public_json) as {
          schedule: Array<{ amountCents: number; taxCents: number }>;
        };
        let fees = 0,
          feePending = 0,
          refundNet = 0,
          chargebackNet = 0,
          collected = 0;
        for (const transaction of transactions.results) {
          if (["charge", "refund", "dispute_balance"].includes(transaction.kind)) {
            if (transaction.fee_cents === null) feePending++;
            else fees += transaction.fee_cents;
          }
          const details = JSON.parse(transaction.details_json) as { providerStatus?: string };
          const confirmed =
            ["available", "succeeded"].includes(transaction.status) ||
            details.providerStatus === "succeeded";
          if (transaction.kind === "charge" && confirmed) collected += transaction.amount_cents;
          const part = proposal.schedule[Number(transaction.invoice_id.split("-").pop())];
          if (part && part.amountCents > 0) {
            const pretax = Math.round(
              (Math.abs(transaction.amount_cents) * (part.amountCents - part.taxCents)) /
                part.amountCents
            );
            if (transaction.kind === "refund" && confirmed) refundNet += pretax;
            if (transaction.kind === "dispute" && transaction.status === "lost")
              chargebackNet += pretax;
          }
        }
        const financials = {
          netSellingCents: calculation.netCents,
          estimatedCostCents: calculation.costCents,
          estimatedProfitBeforeFeesCents: calculation.profitCents,
          knownPaymentFeesCents: fees,
          pendingFeeRecords: feePending,
          refundedRevenueCents: refundNet,
          lostDisputeRevenueCents: chargebackNet,
          collectedGrossCents: collected,
          estimatedProfitAfterKnownFeesCents:
            calculation.costCents === null
              ? null
              : calculation.netCents - refundNet - chargebackNet - calculation.costCents - fees,
        };
        return json({
          revision: row,
          financials,
          documents: documents.results,
          evidence,
          invoices: invoices.results,
          audit: audits.results,
        });
      }
      if (request.method === "POST" && segments[2] === "access" && segments.length === 3) {
        check(row.status === "signed", "signed_estimate_required", 409);
        const token = randomToken(),
          proposal = JSON.parse(row.public_json) as { signerEmail: string };
        await env.DB.prepare(
          "INSERT INTO native_guest_grants(id,workspace_id,revision_id,token_hash,email,expires_at) VALUES(?,?,?,?,?,?)"
        )
          .bind(
            crypto.randomUUID(),
            workspace,
            row.id,
            await hashObject(token),
            proposal.signerEmail,
            new Date(Date.now() + 90 * 86400000).toISOString()
          )
          .run();
        await audit(env, workspace, row.id, "customer_access.renewed", actor);
        return json({ url: `${publicOrigin(env)}/billing-public/#${token}`, sent: false });
      }
      if (request.method === "POST" && segments[2] === "issue" && segments.length === 3) {
        check(row.status === "draft" || row.status === "issued", "estimate_not_issuable", 409);
        check(row.revision === row.current_revision, "stale_estimate", 409);
        check(Date.parse(row.expires_at) > Date.now(), "estimate_expired", 409);
        await document(
          env,
          workspace,
          `issued:${row.id}`,
          "issued_estimate",
          row.id,
          row.terms_id,
          estimatePdf(row)
        );
        const token = randomToken();
        const id = crypto.randomUUID();
        const proposal = JSON.parse(row.public_json) as { signerEmail: string };
        await env.DB.batch([
          env.DB.prepare(
            "UPDATE native_estimate_revisions SET status='issued' WHERE id=? AND status IN ('draft','issued')"
          ).bind(row.id),
          env.DB.prepare(
            "INSERT INTO native_guest_grants(id,workspace_id,revision_id,token_hash,email,expires_at) VALUES(?,?,?,?,?,?)"
          ).bind(
            id,
            workspace,
            row.id,
            await hashObject(token),
            proposal.signerEmail,
            row.expires_at
          ),
        ]);
        await audit(env, workspace, row.id, "estimate.issued", actor);
        return json({ url: `${publicOrigin(env)}/billing-public/#${token}`, sent: false });
      }
      if (request.method === "POST" && segments[2] === "revise" && segments.length === 3) {
        check(
          ["draft", "issued", "withdrawn"].includes(row.status),
          "signed_estimate_requires_separate_change_order",
          409
        );
        const body = await readBody(request);
        const config = await settings(env, workspace);
        const data = await proposalInput(
          env,
          workspace,
          body,
          config.disclosure,
          config.environment,
          { name: config.issuer_name, replyEmail: config.reply_email }
        );
        const id = crypto.randomUUID();
        await env.DB.batch([
          env.DB.prepare(
            "UPDATE native_estimates SET current_revision=current_revision+1,customer_id=?,project_id=?,contact_id=? WHERE id=? AND current_revision=? AND EXISTS(SELECT 1 FROM native_estimate_revisions WHERE id=? AND status IN ('draft','issued','withdrawn'))"
          ).bind(
            data.customerId,
            data.projectId,
            data.contactId,
            row.estimate_id,
            row.revision,
            row.id
          ),
          env.DB.prepare(
            "INSERT INTO native_estimate_revisions SELECT ?,?,?,?,'draft',?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM native_estimates WHERE id=? AND current_revision=?)"
          ).bind(
            id,
            workspace,
            row.estimate_id,
            row.revision + 1,
            data.proposal.title,
            JSON.stringify(data.snapshot),
            JSON.stringify(data.proposal),
            data.hash,
            data.proposal.terms.id,
            data.expiresAt,
            now(),
            actor,
            row.estimate_id,
            row.revision + 1
          ),
          env.DB.prepare(
            "UPDATE native_estimate_revisions SET status='withdrawn' WHERE id=? AND status IN ('draft','issued') AND EXISTS(SELECT 1 FROM native_estimate_revisions WHERE id=?)"
          ).bind(row.id, id),
          env.DB.prepare(
            "UPDATE native_guest_grants SET revoked_at=? WHERE revision_id=? AND EXISTS(SELECT 1 FROM native_estimate_revisions WHERE id=?)"
          ).bind(now(), row.id, id),
        ]);
        check(
          await env.DB.prepare("SELECT id FROM native_estimate_revisions WHERE id=?")
            .bind(id)
            .first(),
          "revision_conflict",
          409
        );
        return json({ id }, 201);
      }
      if (request.method === "POST" && segments[2] === "withdraw" && segments.length === 3) {
        check(row.status === "draft" || row.status === "issued", "estimate_not_withdrawable", 409);
        const updated = await env.DB.prepare(
          "UPDATE native_estimate_revisions SET status='withdrawn' WHERE id=? AND status IN ('draft','issued')"
        )
          .bind(row.id)
          .run();
        check(updated.meta.changes === 1, "estimate_state_changed", 409);
        await env.DB.prepare("UPDATE native_guest_grants SET revoked_at=? WHERE revision_id=?")
          .bind(now(), row.id)
          .run();
        await audit(env, workspace, row.id, "estimate.withdrawn", actor);
        return json({ ok: true });
      }
    }
    if (segments[0] === "documents" && segments.length === 2 && request.method === "GET") {
      const row = await env.DB.prepare(
        "SELECT object_key FROM native_documents WHERE workspace_id=? AND id=?"
      )
        .bind(workspace, segments[1])
        .first<{ object_key: string }>();
      check(row, "document_not_found", 404);
      const file = await env.R2_BILLING_DOCUMENTS_BUCKET?.get(row.object_key);
      check(file, "document_not_found", 404);
      return new Response(file.body, {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": 'attachment; filename="ftops-document.pdf"',
          "Cache-Control": "no-store",
        },
      });
    }
    if (segments[0] === "payments" && segments.length === 1 && request.method === "GET")
      return json(
        (
          await env.DB.prepare(
            "SELECT * FROM native_payment_ledger WHERE workspace_id=? ORDER BY updated_at DESC LIMIT 500"
          )
            .bind(workspace)
            .all()
        ).results
      );
    if (segments[0] === "reconcile" && segments.length === 1 && request.method === "POST") {
      await paymentAdapter().reconcile(env, workspace);
      return json({ ok: true });
    }
    if (
      segments[0] === "invoices" &&
      segments[1] &&
      segments[2] === "refund" &&
      segments.length === 3 &&
      request.method === "POST"
    ) {
      const body = await readBody(request);
      const amount = body.amountCents as number;
      check(Number.isSafeInteger(amount) && amount > 0, "invalid_refund_amount");
      return json(
        await paymentAdapter().refund(
          env,
          workspace,
          segments[1],
          amount,
          text(body.reason, "refund_reason"),
          text(body.requestId, "request_id")
        )
      );
    }
    throw new BillingError("route_not_found", 404);
  } catch (error) {
    return billingFailure(error);
  }
}
export function billingFailure(error: unknown) {
  const known = error instanceof BillingError;
  return json(
    { error: known ? error.message : "billing_operation_failed" },
    known ? error.status : 503
  );
}
