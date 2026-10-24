// Pure USD draft arithmetic. Tax classification and jurisdiction lookup belong to
// a reviewed tax policy/provider; supplied rates are not a tax determination.
export const ESTIMATE_CALCULATION_VERSION = "usd-line-half-up-v1";
const MAX = BigInt(Number.MAX_SAFE_INTEGER);

export type EstimateLine = {
  id: string;
  description: string;
  quantityMillis: number;
  unitPriceCents: number;
  unitCostCents: number | null;
  discountCents: number;
  taxRatePpm: number;
};

export type EstimateDraft = {
  currency: "USD";
  lines: readonly EstimateLine[];
  deposit: { kind: "percentage"; bps: number } | { kind: "fixed"; amountCents: number };
};

function integer(value: number, name: string, maximum = Number.MAX_SAFE_INTEGER): bigint {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
    throw new Error(`invalid_${name}`);
  }
  return BigInt(value);
}

function cents(value: bigint): number {
  if (value > MAX || value < -MAX) throw new Error("estimate_amount_overflow");
  return Number(value);
}

function roundRatio(numerator: bigint, denominator: bigint): bigint {
  const sign = numerator < 0n ? -1n : 1n;
  const absolute = numerator * sign;
  return sign * ((absolute + denominator / 2n) / denominator);
}

function economics(priceCents: number, costCents: number | null) {
  if (costCents === null)
    return { costCents: null, profitCents: null, markupBps: null, marginBps: null };
  const profit = BigInt(priceCents) - BigInt(costCents);
  return {
    costCents,
    profitCents: cents(profit),
    markupBps: costCents === 0 ? null : cents(roundRatio(profit * 10000n, BigInt(costCents))),
    marginBps: priceCents === 0 ? null : cents(roundRatio(profit * 10000n, BigInt(priceCents))),
  };
}

export function calculateEstimate(draft: EstimateDraft) {
  if (draft.currency !== "USD") throw new Error("unsupported_estimate_currency");
  if (!draft.deposit || !["percentage", "fixed"].includes(draft.deposit.kind)) {
    throw new Error("invalid_deposit");
  }
  if (!Array.isArray(draft.lines) || draft.lines.length === 0 || draft.lines.length > 1000) {
    throw new Error("invalid_estimate_lines");
  }
  const ids = new Set<string>();
  const lines = draft.lines.map((line) => {
    if (typeof line.id !== "string" || !line.id.trim() || ids.has(line.id)) {
      throw new Error("invalid_estimate_line_id");
    }
    ids.add(line.id);
    if (typeof line.description !== "string" || !line.description.trim()) {
      throw new Error("invalid_estimate_description");
    }
    const quantity = integer(line.quantityMillis, "quantity_millis");
    if (quantity === 0n) throw new Error("invalid_quantity_millis");
    const price = integer(line.unitPriceCents, "unit_price_cents");
    const discount = integer(line.discountCents, "discount_cents");
    const rate = integer(line.taxRatePpm, "tax_rate_ppm", 1000000);
    const extendedPrice = roundRatio(price * quantity, 1000n);
    if (discount > extendedPrice) throw new Error("discount_exceeds_line_price");
    const net = extendedPrice - discount;
    const tax = roundRatio(net * rate, 1000000n);
    const cost =
      line.unitCostCents === null
        ? null
        : cents(roundRatio(integer(line.unitCostCents, "unit_cost_cents") * quantity, 1000n));
    return {
      id: line.id,
      description: line.description,
      quantityMillis: line.quantityMillis,
      unitPriceCents: line.unitPriceCents,
      extendedPriceCents: cents(extendedPrice),
      discountCents: line.discountCents,
      netCents: cents(net),
      taxRatePpm: line.taxRatePpm,
      taxCents: cents(tax),
      totalCents: cents(net + tax),
      ...economics(cents(net), cost),
    };
  });
  const sum = (pick: (line: (typeof lines)[number]) => number) =>
    cents(lines.reduce((total, line) => total + BigInt(pick(line)), 0n));
  const subtotalCents = sum((line) => line.extendedPriceCents);
  const discountCents = sum((line) => line.discountCents);
  const netCents = sum((line) => line.netCents);
  const taxCents = sum((line) => line.taxCents);
  const totalCents = cents(BigInt(netCents) + BigInt(taxCents));
  const costCents = lines.some((line) => line.costCents === null)
    ? null
    : sum((line) => line.costCents!);
  const depositCents =
    draft.deposit.kind === "fixed"
      ? cents(integer(draft.deposit.amountCents, "deposit_cents"))
      : cents(
          roundRatio(BigInt(totalCents) * integer(draft.deposit.bps, "deposit_bps", 10000), 10000n)
        );
  if (depositCents > totalCents) throw new Error("deposit_exceeds_estimate_total");
  return {
    calculationVersion: ESTIMATE_CALCULATION_VERSION,
    currency: draft.currency,
    lines,
    subtotalCents,
    discountCents,
    netCents,
    taxCents,
    totalCents,
    deposit:
      draft.deposit.kind === "fixed"
        ? { kind: "fixed" as const, amountCents: draft.deposit.amountCents }
        : { kind: "percentage" as const, bps: draft.deposit.bps },
    depositCents,
    remainingCents: totalCents - depositCents,
    ...economics(netCents, costCents),
  };
}

// Recompute and construct an allowlist. Never spread internal records into a
// customer response, PDF, email, signature envelope, or provider metadata.
export function customerEstimate(draft: EstimateDraft) {
  const result = calculateEstimate(draft);
  return {
    calculationVersion: result.calculationVersion,
    currency: result.currency,
    lines: result.lines.map((line) => ({
      id: line.id,
      description: line.description,
      quantityMillis: line.quantityMillis,
      unitPriceCents: line.unitPriceCents,
      extendedPriceCents: line.extendedPriceCents,
      discountCents: line.discountCents,
      netCents: line.netCents,
      taxRatePpm: line.taxRatePpm,
      taxCents: line.taxCents,
      totalCents: line.totalCents,
    })),
    subtotalCents: result.subtotalCents,
    discountCents: result.discountCents,
    netCents: result.netCents,
    taxCents: result.taxCents,
    totalCents: result.totalCents,
    deposit: result.deposit,
    depositCents: result.depositCents,
    remainingCents: result.remainingCents,
  };
}

export function priceWithMarkup(costCents: number, markupBps: number): number {
  const cost = integer(costCents, "cost_cents");
  const markup = integer(markupBps, "markup_bps");
  return cents(roundRatio(cost * (10000n + markup), 10000n));
}

export function priceForMargin(costCents: number, marginBps: number): number {
  const cost = integer(costCents, "cost_cents");
  const margin = integer(marginBps, "margin_bps", 9999);
  return cents(roundRatio(cost * 10000n, 10000n - margin));
}

export type ScheduledPayment = {
  id: string;
  kind: "deposit" | "milestone";
  amount: { kind: "fixed"; amountCents: number } | { kind: "percentage"; bps: number };
};

// Every percentage uses the full contract total (including approved tax).
// Final balance absorbs rounding; no silent scaling of overcommitted schedules.
export function paymentSchedule(totalCents: number, payments: readonly ScheduledPayment[]) {
  const total = integer(totalCents, "contract_total_cents");
  const ids = new Set<string>(["final"]);
  let allocated = 0n;
  let deposits = 0;
  const installments = payments.map((payment, index) => {
    if (typeof payment.id !== "string" || !payment.id.trim() || ids.has(payment.id)) {
      throw new Error("invalid_payment_id");
    }
    ids.add(payment.id);
    if (!["deposit", "milestone"].includes(payment.kind)) throw new Error("invalid_payment_kind");
    if (payment.kind === "deposit" && (++deposits > 1 || index !== 0))
      throw new Error("invalid_deposit_order");
    if (!payment.amount || !["fixed", "percentage"].includes(payment.amount.kind))
      throw new Error("invalid_payment_amount");
    const amount =
      payment.amount.kind === "fixed"
        ? integer(payment.amount.amountCents, "payment_amount_cents")
        : roundRatio(total * integer(payment.amount.bps, "payment_bps", 10000), 10000n);
    allocated += amount;
    if (allocated > total) throw new Error("schedule_exceeds_contract_total");
    return { id: payment.id, kind: payment.kind, amountCents: cents(amount) };
  });
  return [
    ...installments,
    { id: "final", kind: "final" as const, amountCents: cents(total - allocated) },
  ];
}

// Revenue is exclusive of tax and net of recognized refunds/credits/losses.
// Fee inputs are positive net expenses after fee reversals. Pending dispute
// withdrawals are cash exposure, not automatically recognized revenue losses.
export function projectProfitability(input: {
  revenueCents: number;
  costCents: number | null;
  processingFeesCents: number;
  refundFeesCents: number;
  disputeFeesCents: number;
}) {
  const revenue = integer(input.revenueCents, "revenue_cents");
  const fees =
    integer(input.processingFeesCents, "processing_fees_cents") +
    integer(input.refundFeesCents, "refund_fees_cents") +
    integer(input.disputeFeesCents, "dispute_fees_cents");
  const cost = input.costCents === null ? null : integer(input.costCents, "cost_cents");
  const profit = cost === null ? null : revenue - cost - fees;
  return {
    revenueCents: input.revenueCents,
    costCents: input.costCents,
    paymentFeesCents: cents(fees),
    profitAfterFeesCents: profit === null ? null : cents(profit),
    marginAfterFeesBps:
      profit === null || revenue === 0n ? null : cents(roundRatio(profit * 10000n, revenue)),
  };
}
