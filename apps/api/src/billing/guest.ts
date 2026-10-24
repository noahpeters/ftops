import type { Env } from "../lib/types";
import { json } from "../lib/http";
import {
  BillingError,
  check,
  now,
  hashObject,
  randomToken,
  readBody,
  publicOrigin,
  sendEmail,
  audit,
} from "./common";
import { loadRevision, publicProposal, estimatePdf, money, type Revision } from "./model";
import { document } from "./documents";
import { paymentAdapter } from "./provider";
import { billingFailure } from "../routes/billing";
import { guestHtml } from "./guestPage";

const INTENT =
  "I approve this estimate and its payment schedule, accept the exact terms shown, and intend my typed name to be my electronic signature.";
type Grant = {
  id: string;
  workspace_id: string;
  revision_id: string;
  email: string;
  expires_at: string;
  revoked_at: string | null;
  code_hash: string | null;
  code_expires_at: string | null;
  code_attempts: number;
  verified_at: string | null;
  session_expires_at: string | null;
};
async function activeGrant(env: Env, grant: Grant | null) {
  check(
    grant && !grant.revoked_at && Date.parse(grant.expires_at) > Date.now(),
    "link_invalid_or_expired",
    401
  );
  const row = await loadRevision(env, grant.revision_id, grant.workspace_id);
  check(["issued", "signing", "signed"].includes(row.status), "estimate_unavailable", 409);
  if (row.status !== "signed")
    check(
      row.revision === row.current_revision && Date.parse(row.expires_at) > Date.now(),
      "estimate_expired_or_superseded",
      409
    );
  return { grant, row };
}
async function session(env: Env, request: Request) {
  const cookie = request.headers
    .get("Cookie")
    ?.split(";")
    .map((v) => v.trim())
    .find((v) => v.startsWith("ftops_billing="))
    ?.slice(14);
  check(cookie && /^[a-f0-9]{64}$/.test(cookie), "verification_required", 401);
  const grant = await env.DB.prepare("SELECT * FROM native_guest_grants WHERE session_hash=?")
    .bind(await hashObject(cookie))
    .first<Grant>();
  check(
    grant?.verified_at &&
      grant.session_expires_at &&
      Date.parse(grant.session_expires_at) > Date.now(),
    "verification_required",
    401
  );
  return await activeGrant(env, grant);
}
type Evidence = {
  id: string;
  signer_name: string;
  signer_email: string;
  signed_at: string;
  evidence_hash: string;
  grant_id: string;
  verified_at: string;
  intent: string;
  disclosure: string;
};
export async function completeSignature(env: Env, row: Revision) {
  const evidence = await env.DB.prepare(
    "SELECT * FROM native_signature_evidence WHERE workspace_id=? AND revision_id=?"
  )
    .bind(row.workspace_id, row.id)
    .first<Evidence>();
  check(evidence, "signature_not_recorded", 409);
  const p = publicProposal(row);
  const approved = {
    name: evidence.signer_name,
    email: evidence.signer_email,
    signedAt: evidence.signed_at,
    evidenceHash: evidence.evidence_hash,
  };
  await document(
    env,
    row.workspace_id,
    `approved:${row.id}`,
    "approved_estimate",
    row.id,
    row.terms_id,
    estimatePdf(row, approved)
  );
  await document(
    env,
    row.workspace_id,
    `accepted-terms:${row.id}`,
    "accepted_terms",
    row.id,
    row.terms_id,
    {
      issuer: p.issuer,
      title: p.terms.title,
      subtitle: `Accepted terms | ${p.terms.label}`,
      rows: [
        ["Customer", p.customer],
        ["Estimate", `${p.title} | revision ${row.revision}`],
        ["Terms content SHA-256", p.terms.hash],
        [
          "Accepted and electronically signed",
          `${evidence.signer_name} (${evidence.signer_email}) | ${evidence.signed_at}`,
        ],
      ],
      paragraphs: [p.terms.content],
      attachments: [
        { filename: "accepted-terms.txt", content: p.terms.content, mimeType: "text/plain" },
      ],
      evidenceParagraphs: [
        "Electronic record disclosure accepted:",
        evidence.disclosure,
        evidence.intent,
        `Evidence SHA-256: ${evidence.evidence_hash}`,
      ],
    }
  );
  for (const [index, entry] of p.schedule.entries()) {
    const id = `${row.id}-${index}`;
    const number = `FT-${row.estimate_id.replace(/-/g, "").toUpperCase()}-R${row.revision}-${index + 1}`;
    await env.DB.prepare(
      "INSERT OR IGNORE INTO native_invoices(id,workspace_id,revision_id,number,label,kind,amount_cents,status,created_at) VALUES(?,?,?,?,?,?,?,'draft',?)"
    )
      .bind(id, row.workspace_id, row.id, number, entry.label, entry.kind, entry.amountCents, now())
      .run();
    await document(env, row.workspace_id, `invoice:${id}`, "invoice", row.id, row.terms_id, {
      issuer: p.issuer,
      title: "Invoice",
      subtitle: `${number} | ${entry.label}`,
      rows: [
        ["Customer", p.customer],
        ["Agreement", `${p.title} | revision ${row.revision}`],
        ["Payment trigger", entry.label],
        ["Installment before allocated tax", money(entry.amountCents - entry.taxCents)],
        ["Allocated sales tax", money(entry.taxCents)],
        ["Amount due for this invoice", money(entry.amountCents)],
        [
          "Contract itemization (reference only; not additional charges)",
          p.estimate.lines
            .map(
              (l) => `${l.description} | ${l.quantityMillis / 1000} units | ${money(l.totalCents)}`
            )
            .join("\n"),
        ],
        ["Full contract total", money(p.estimate.totalCents)],
        ["Terms version", p.terms.label],
      ],
      paragraphs: [
        `Issued ${now()}. Payment due according to the accepted ${entry.label.toLowerCase()} schedule.`,
        `This invoice requests only the installment amount shown. The full contract itemization is a reference and is not billed again.`,
        `This digitally signed invoice is not a payment receipt. Payment status is shown separately in your customer portal.`,
      ],
    });
  }
  const projectId = `billing-${row.estimate_id}`;
  await env.DB.batch([
    env.DB.prepare(
      "INSERT OR IGNORE INTO projects(id,title,project_type,status,customer_name,created_at,updated_at,workspace_id) SELECT ?,?,'commercial','intake',?,?,?,? WHERE EXISTS(SELECT 1 FROM native_estimates WHERE id=? AND project_id IS NULL)"
    ).bind(projectId, p.title, p.customer, now(), now(), row.workspace_id, row.estimate_id),
    env.DB.prepare("UPDATE native_estimates SET project_id=COALESCE(project_id,?) WHERE id=?").bind(
      projectId,
      row.estimate_id
    ),
    env.DB.prepare(
      "UPDATE native_invoices SET status=CASE WHEN amount_cents=0 THEN 'paid' ELSE 'issued' END WHERE workspace_id=? AND revision_id=? AND status='draft'"
    ).bind(row.workspace_id, row.id),
    env.DB.prepare(
      "UPDATE native_estimate_revisions SET status='signed' WHERE id=? AND status='signing'"
    ).bind(row.id),
  ]);
  await audit(env, row.workspace_id, row.id, "agreement.signed", evidence.signer_email, {
    evidenceId: evidence.id,
  });
  const existing = await env.DB.prepare("SELECT id FROM native_billing_deliveries WHERE id=?")
    .bind(`signed-${row.id}`)
    .first();
  if (!existing)
    await env.DB.prepare(
      "INSERT OR IGNORE INTO native_billing_deliveries(id,workspace_id,revision_id,recipient,subject,body,created_at) VALUES(?,?,?,?,?,?,?)"
    )
      .bind(
        `signed-${row.id}`,
        row.workspace_id,
        row.id,
        evidence.signer_email,
        `Your signed documents: ${p.title}`,
        `Your estimate and terms have been signed. Use your original secure invitation link to review your signed documents and invoices. You can download and retain each PDF. Contact the business if you need a renewed link or paper copy.`,
        now()
      )
      .run();
}
export async function flushBillingDeliveries(env: Env) {
  const rows = await env.DB.prepare(
    "SELECT * FROM native_billing_deliveries WHERE status='pending' AND attempts<20 LIMIT 25"
  ).all<{ id: string; workspace_id: string; recipient: string; subject: string; body: string }>();
  for (const row of rows.results) {
    try {
      await sendEmail(env, row.recipient, row.subject, row.body, `billing-${row.id}`);
      await env.DB.prepare(
        "UPDATE native_billing_deliveries SET status='sent',sent_at=? WHERE id=?"
      )
        .bind(now(), row.id)
        .run();
    } catch {
      await env.DB.prepare("UPDATE native_billing_deliveries SET attempts=attempts+1 WHERE id=?")
        .bind(row.id)
        .run();
    }
  }
}
export async function resumeBillingDocuments(env: Env) {
  const rows = await env.DB.prepare(
    "SELECT id,workspace_id FROM native_estimate_revisions WHERE status='signing' LIMIT 20"
  ).all<{ id: string; workspace_id: string }>();
  for (const row of rows.results) {
    try {
      await completeSignature(env, await loadRevision(env, row.id, row.workspace_id));
    } catch {
      /* Durable signing state is retried on the next invocation. */
    }
  }
  await flushBillingDeliveries(env);
}
export async function handleBillingGuest(segments: string[], request: Request, env: Env) {
  try {
    if (segments[0] === "stripe" && segments.length === 2 && request.method === "POST") {
      await paymentAdapter().handleWebhook(env, segments[1], request, segments[2]);
      await flushBillingDeliveries(env);
      return json({ received: true });
    }
    if (segments.length === 0 && request.method === "GET")
      return new Response(guestHtml(), {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
          "Referrer-Policy": "no-referrer",
          "X-Content-Type-Options": "nosniff",
          "X-Frame-Options": "DENY",
          "Content-Security-Policy":
            "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self'; form-action 'self' https://checkout.stripe.com; base-uri 'none'; frame-ancestors 'none'",
        },
      });
    if (request.method === "POST")
      check(request.headers.get("Origin") === publicOrigin(env), "csrf_origin_invalid", 403);
    if (segments.length === 1 && segments[0] === "exchange" && request.method === "POST") {
      const body = await readBody(request);
      check(
        typeof body.token === "string" && /^[a-f0-9]{64}$/.test(body.token),
        "invalid_invitation",
        401
      );
      const { grant } = await activeGrant(
        env,
        await env.DB.prepare("SELECT * FROM native_guest_grants WHERE token_hash=?")
          .bind(await hashObject(body.token))
          .first<Grant>()
      );
      return json({
        challengeId: grant.id,
        emailHint: grant.email.replace(/^(.).+(@.+)$/, "$1***$2"),
      });
    }
    if (segments.length === 1 && segments[0] === "code" && request.method === "POST") {
      const body = await readBody(request);
      check(
        typeof body.token === "string" && /^[a-f0-9]{64}$/.test(body.token),
        "invalid_invitation",
        401
      );
      const { grant } = await activeGrant(
        env,
        await env.DB.prepare("SELECT * FROM native_guest_grants WHERE token_hash=?")
          .bind(await hashObject(body.token))
          .first<Grant>()
      );
      check(env.INTEGRATIONS_MASTER_KEY, "billing_not_configured", 503);
      const values = new Uint32Array(1);
      do {
        crypto.getRandomValues(values);
      } while (values[0] >= 4294000000);
      const code = String(values[0] % 1000000).padStart(6, "0");
      const sentAt = now();
      const digest = await hashObject({
        grant: grant.id,
        code,
        secret: env.INTEGRATIONS_MASTER_KEY,
      });
      const result = await env.DB.prepare(
        "UPDATE native_guest_grants SET code_hash=?,code_expires_at=?,code_sent_at=?,code_attempts=0 WHERE id=? AND (code_sent_at IS NULL OR code_sent_at<?)"
      )
        .bind(
          digest,
          new Date(Date.now() + 10 * 60 * 1000).toISOString(),
          sentAt,
          grant.id,
          new Date(Date.now() - 60000).toISOString()
        )
        .run();
      check(result.meta.changes === 1, "wait_before_requesting_another_code", 429);
      await sendEmail(
        env,
        grant.email,
        "Your From Trees verification code",
        `Your verification code is ${code}. It expires in 10 minutes. If you did not request this code, ignore this message.`,
        `billing-code-${grant.id}-${sentAt}`
      );
      return json({ sent: true });
    }
    if (segments.length === 1 && segments[0] === "verify" && request.method === "POST") {
      const body = await readBody(request);
      check(
        typeof body.token === "string" &&
          /^[a-f0-9]{64}$/.test(body.token) &&
          typeof body.code === "string" &&
          /^\d{6}$/.test(body.code),
        "invalid_verification"
      );
      const { grant } = await activeGrant(
        env,
        await env.DB.prepare("SELECT * FROM native_guest_grants WHERE token_hash=?")
          .bind(await hashObject(body.token))
          .first<Grant>()
      );
      check(
        grant.code_hash && grant.code_expires_at && Date.parse(grant.code_expires_at) > Date.now(),
        "code_expired",
        401
      );
      const attempt = await env.DB.prepare(
        "UPDATE native_guest_grants SET code_attempts=code_attempts+1 WHERE id=? AND code_attempts<6 AND code_hash=?"
      )
        .bind(grant.id, grant.code_hash)
        .run();
      check(attempt.meta.changes === 1, "too_many_attempts", 429);
      check(
        (await hashObject({
          grant: grant.id,
          code: body.code,
          secret: env.INTEGRATIONS_MASTER_KEY,
        })) === grant.code_hash,
        "invalid_code",
        401
      );
      const token = randomToken();
      const verified = now();
      const result = await env.DB.prepare(
        "UPDATE native_guest_grants SET session_hash=?,session_expires_at=?,verified_at=?,code_hash=NULL WHERE id=? AND code_hash=? AND code_attempts<=6"
      )
        .bind(
          await hashObject(token),
          new Date(Date.now() + 7 * 86400000).toISOString(),
          verified,
          grant.id,
          grant.code_hash
        )
        .run();
      check(result.meta.changes === 1, "code_already_used", 401);
      const secure = new URL(publicOrigin(env)).protocol === "https:" ? "; Secure" : "";
      return new Response(JSON.stringify({ verified: true }), {
        headers: {
          "Content-Type": "application/json",
          "Set-Cookie": `ftops_billing=${token}; Path=/billing-public; HttpOnly; SameSite=Lax; Max-Age=604800${secure}`,
        },
      });
    }
    const { grant, row } = await session(env, request);
    if (segments[0] === "view" && segments.length === 1 && request.method === "GET") {
      const documents = await env.DB.prepare(
        "SELECT d.id,d.kind,d.sha256,d.signing_profile,d.created_at, i.label AS invoice_label FROM native_documents d LEFT JOIN native_invoices i ON d.source_key='invoice:'||i.id AND i.workspace_id=d.workspace_id WHERE d.workspace_id=? AND d.revision_id=? AND d.kind IN ('issued_estimate','approved_estimate','accepted_terms','invoice') ORDER BY d.created_at"
      )
        .bind(grant.workspace_id, row.id)
        .all();
      const invoices = await env.DB.prepare(
        "SELECT id,number,label,kind,amount_cents,status,refunded_cents FROM native_invoices WHERE workspace_id=? AND revision_id=? AND status!='draft' ORDER BY created_at,number"
      )
        .bind(grant.workspace_id, row.id)
        .all();
      return json({
        proposal: publicProposal(row),
        revision: row.revision,
        hash: row.content_hash,
        status: row.status,
        intent: INTENT,
        documents: documents.results,
        invoices: invoices.results,
      });
    }
    if (segments[0] === "sign" && segments.length === 1 && request.method === "POST") {
      const body = await readBody(request);
      const p = publicProposal(row);
      check(
        body.contentHash === row.content_hash && body.termsHash === p.terms.hash,
        "document_changed",
        409
      );
      check(
        body.approveEstimate === true &&
          body.acceptTerms === true &&
          body.electronicConsent === true &&
          body.signerAuthority === true &&
          body.intent === INTENT,
        "explicit_acceptance_required"
      );
      check(
        typeof body.signerName === "string" &&
          body.signerName.trim().length >= 2 &&
          body.signerName.length <= 150,
        "invalid_signer_name"
      );
      const existing = await env.DB.prepare(
        "SELECT * FROM native_signature_evidence WHERE revision_id=?"
      )
        .bind(row.id)
        .first<Evidence>();
      if (existing) {
        check(
          existing.signer_name === body.signerName.trim() && existing.signer_email === grant.email,
          "already_signed_by_another_identity",
          409
        );
        if (row.status === "signed") return json({ signed: true });
      } else {
        check(row.status === "issued", "estimate_not_signable", 409);
        const at = now(),
          id = crypto.randomUUID();
        const name = body.signerName.trim();
        const agent = (request.headers.get("User-Agent") ?? "").slice(0, 500);
        const evidence = {
          id,
          revisionId: row.id,
          grantId: grant.id,
          signerName: name,
          email: grant.email,
          contentHash: row.content_hash,
          termsHash: p.terms.hash,
          disclosure: p.disclosure,
          intent: INTENT,
          verifiedAt: grant.verified_at,
          signedAt: at,
          userAgent: agent,
        };
        const hash = await hashObject(evidence);
        await env.DB.batch([
          env.DB.prepare(
            "INSERT INTO native_signature_evidence SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM native_estimate_revisions r JOIN native_estimates e ON e.id=r.estimate_id WHERE r.id=? AND r.status='issued' AND e.current_revision=r.revision AND r.expires_at>?)"
          ).bind(
            id,
            grant.workspace_id,
            row.id,
            grant.id,
            name,
            grant.email,
            row.content_hash,
            p.terms.hash,
            p.disclosure,
            INTENT,
            grant.verified_at,
            at,
            agent,
            hash,
            row.id,
            at
          ),
          env.DB.prepare(
            "UPDATE native_estimate_revisions SET status='signing' WHERE id=? AND status='issued' AND EXISTS(SELECT 1 FROM native_signature_evidence WHERE revision_id=?)"
          ).bind(row.id, row.id),
        ]);
        check(
          await env.DB.prepare("SELECT id FROM native_signature_evidence WHERE id=?")
            .bind(id)
            .first(),
          "estimate_state_changed",
          409
        );
      }
      await completeSignature(env, row);
      await flushBillingDeliveries(env);
      return json({ signed: true });
    }
    if (segments[0] === "finish" && segments.length === 1 && request.method === "POST") {
      const evidence = await env.DB.prepare(
        "SELECT signer_email FROM native_signature_evidence WHERE revision_id=?"
      )
        .bind(row.id)
        .first<{ signer_email: string }>();
      check(evidence?.signer_email === grant.email, "signature_not_recorded", 409);
      if (row.status !== "signed") await completeSignature(env, row);
      await flushBillingDeliveries(env);
      return json({ signed: true });
    }
    if (segments[0] === "checkout" && segments.length === 1 && request.method === "POST") {
      const body = await readBody(request);
      check(typeof body.invoiceId === "string", "invalid_invoice");
      return json(
        await paymentAdapter().createCheckout(env, grant.workspace_id, row.id, body.invoiceId)
      );
    }
    if (segments[0] === "documents" && segments.length === 2 && request.method === "GET") {
      const record = await env.DB.prepare(
        "SELECT object_key,sha256 FROM native_documents WHERE workspace_id=? AND revision_id=? AND id=?"
      )
        .bind(grant.workspace_id, row.id, segments[1])
        .first<{ object_key: string; sha256: string }>();
      check(record, "document_not_found", 404);
      const file = await env.R2_BILLING_DOCUMENTS_BUCKET?.get(record.object_key);
      check(file, "document_not_found", 404);
      return new Response(file.body, {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": 'attachment; filename="from-trees-document.pdf"',
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
          "X-Document-SHA256": record.sha256,
        },
      });
    }
    throw new BillingError("route_not_found", 404);
  } catch (error) {
    return billingFailure(error);
  }
}
