import {
  calculateEstimate,
  customerEstimate,
  paymentSchedule,
  type EstimateDraft,
  type EstimateLine,
  type ScheduledPayment,
} from "../domain/estimate";
import type { Env } from "../lib/types";
import { check, text, hashObject } from "./common";

export type PublicProposal = {
  paymentEnvironment: string;
  issuer: { name: string; replyEmail: string };
  title: string;
  scope: string;
  customer: string;
  signerEmail: string;
  signerName: string;
  projectId: string | null;
  estimate: ReturnType<typeof customerEstimate>;
  schedule: Array<{
    id: string;
    kind: "deposit" | "milestone" | "final";
    amountCents: number;
    label: string;
    taxCents: number;
  }>;
  terms: { id: string; label: string; title: string; content: string; hash: string };
  disclosure: string;
  expiresAt: string;
  design: {
    businessId: string;
    slug: string;
    revision: number;
    hash: string;
    description: string;
  } | null;
};
export type Revision = {
  id: string;
  workspace_id: string;
  estimate_id: string;
  revision: number;
  status: string;
  title: string;
  snapshot_json: string;
  public_json: string;
  content_hash: string;
  terms_id: string;
  expires_at: string;
  current_revision: number;
};
export async function loadRevision(env: Env, id: string, workspace?: string) {
  const row = await env.DB.prepare(
    "SELECT r.*,e.current_revision FROM native_estimate_revisions r JOIN native_estimates e ON e.id=r.estimate_id AND e.workspace_id=r.workspace_id WHERE r.id=?" +
      (workspace ? " AND r.workspace_id=?" : "")
  )
    .bind(id, ...(workspace ? [workspace] : []))
    .first<Revision>();
  check(row, "estimate_not_found", 404);
  return row;
}
export function publicProposal(row: Revision): PublicProposal {
  return JSON.parse(row.public_json) as PublicProposal;
}
export async function proposalInput(
  env: Env,
  workspace: string,
  body: Record<string, unknown>,
  disclosure: string,
  environment: string,
  issuer: { name: string; replyEmail: string }
) {
  const customerId = text(body.customerId, "customer_id");
  const contactId = text(body.contactId, "contact_id");
  const customer = await env.DB.prepare(
    "SELECT display_name FROM customers WHERE workspace_id=? AND id=?"
  )
    .bind(workspace, customerId)
    .first<{ display_name: string }>();
  const contact = await env.DB.prepare(
    "SELECT email,display_name FROM contacts WHERE workspace_id=? AND customer_id=? AND id=? AND archived_at IS NULL"
  )
    .bind(workspace, customerId, contactId)
    .first<{ email: string; display_name: string }>();
  check(
    customer && contact && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email),
    "customer_or_signer_not_found"
  );
  const projectId = body.projectId ? text(body.projectId, "project_id") : null;
  if (projectId)
    check(
      await env.DB.prepare("SELECT id FROM projects WHERE workspace_id=? AND id=?")
        .bind(workspace, projectId)
        .first(),
      "project_not_found",
      404
    );
  const termsId = text(body.termsId, "terms_id");
  const terms = await env.DB.prepare(
    "SELECT * FROM native_terms_versions WHERE workspace_id=? AND id=?"
  )
    .bind(workspace, termsId)
    .first<{
      id: string;
      version_label: string;
      title: string;
      content: string;
      content_hash: string;
    }>();
  check(terms, "terms_not_found", 404);
  const title = text(body.title, "title", 200);
  const scope = text(body.scope, "scope", 15000);
  check(Array.isArray(body.lines), "invalid_estimate_lines");
  const lines: EstimateLine[] = body.lines.map((value: unknown) => {
    check(value && typeof value === "object", "invalid_estimate_line");
    const item = value as Record<string, unknown>;
    return {
      id: text(item.id, "line_id"),
      description: text(item.description, "description", 1000),
      quantityMillis: item.quantityMillis as number,
      unitPriceCents: item.unitPriceCents as number,
      unitCostCents: item.unitCostCents === null ? null : (item.unitCostCents as number),
      discountCents: item.discountCents as number,
      taxRatePpm: item.taxRatePpm as number,
    };
  });
  const draft: EstimateDraft = {
    currency: "USD",
    lines,
    deposit: body.deposit as EstimateDraft["deposit"],
  };
  const calculation = calculateEstimate(draft);
  const deposit: ScheduledPayment = { id: "deposit", kind: "deposit", amount: draft.deposit };
  check(!body.milestones || Array.isArray(body.milestones), "invalid_milestones");
  const milestones = (body.milestones ?? []) as Array<{
    id: string;
    label: string;
    amount: ScheduledPayment["amount"];
  }>;
  check(milestones.length <= 24, "too_many_milestones");
  const amounts = paymentSchedule(calculation.totalCents, [
    deposit,
    ...milestones.map((m) => ({
      id: text(m.id, "milestone_id"),
      kind: "milestone" as const,
      amount: m.amount,
    })),
  ]);
  let taxAllocated = 0;
  const schedule = amounts.map((entry, index) => {
    const taxCents =
      index === amounts.length - 1
        ? calculation.taxCents - taxAllocated
        : Math.min(
            calculation.taxCents - taxAllocated,
            calculation.totalCents === 0
              ? 0
              : Math.floor(
                  Number(
                    (BigInt(entry.amountCents) * BigInt(calculation.taxCents)) /
                      BigInt(calculation.totalCents)
                  )
                )
          );
    taxAllocated += taxCents;
    return {
      ...entry,
      label:
        entry.kind === "deposit"
          ? "Deposit"
          : entry.kind === "final"
            ? "Final balance"
            : text(milestones[index - 1].label, "milestone_label"),
      taxCents,
    };
  });
  const expiresAt = text(body.expiresAt, "expiry");
  check(
    Number.isFinite(Date.parse(expiresAt)) && Date.parse(expiresAt) > Date.now(),
    "invalid_expiry"
  );
  // Cabinitron snapshots enter only through a future server-authenticated importer,
  // never through browser-supplied private JSON or arbitrary tenant URLs.
  const proposal: PublicProposal = {
    paymentEnvironment: environment,
    issuer,
    title,
    scope,
    customer: customer.display_name,
    signerEmail: contact.email.trim().toLowerCase(),
    signerName: contact.display_name,
    projectId,
    estimate: customerEstimate(draft),
    schedule,
    terms: {
      id: terms.id,
      label: terms.version_label,
      title: terms.title,
      content: terms.content,
      hash: terms.content_hash,
    },
    disclosure,
    expiresAt,
    design: null,
  };
  const snapshot = {
    draft,
    milestones,
    scope,
    title,
    customerId,
    contactId,
    projectId,
    termsId,
    expiresAt,
  };
  return {
    customerId,
    contactId,
    projectId,
    proposal,
    snapshot,
    hash: await hashObject(proposal),
    expiresAt,
  };
}
export const money = (cents: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
export function estimatePdf(
  row: Revision,
  approved?: { name: string; email: string; signedAt: string; evidenceHash: string }
) {
  const p = publicProposal(row);
  return {
    issuer: p.issuer,
    title: approved ? "Approved estimate" : "Estimate",
    subtitle: `${p.title} | Revision ${row.revision}`,
    rows: [
      ["Customer", p.customer],
      ["Scope", p.scope],
      ...p.estimate.lines.map((l) => [
        l.description,
        `${l.quantityMillis / 1000} × ${money(l.unitPriceCents)} | Discount ${money(l.discountCents)} | Tax ${money(l.taxCents)} | ${money(l.totalCents)}`,
      ]),
      ["Contract total", money(p.estimate.totalCents)],
      ["Payment schedule", p.schedule.map((s) => `${s.label}: ${money(s.amountCents)}`).join("\n")],
      ["Terms", `${p.terms.title} | ${p.terms.label} | ${p.terms.hash}`],
      ["Content SHA-256", row.content_hash],
    ] as Array<[string, string]>,
    attachments: [
      { filename: "estimate-public.json", content: row.public_json, mimeType: "application/json" },
    ],
    paragraphs: approved
      ? []
      : [
          `Valid until ${p.expiresAt}. Review the separate complete terms before accepting. This estimate has not been accepted or paid.`,
        ],
    evidenceParagraphs: approved
      ? [
          `Approved and electronically signed by ${approved.name} (${approved.email}) at ${approved.signedAt}.`,
          `Evidence SHA-256: ${approved.evidenceHash}`,
        ]
      : undefined,
  };
}
