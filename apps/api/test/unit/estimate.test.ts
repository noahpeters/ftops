import { describe, expect, it } from "vitest";
import {
  calculateEstimate,
  customerEstimate,
  priceForMargin,
  priceWithMarkup,
  paymentSchedule,
  projectProfitability,
  type EstimateDraft,
  type EstimateLine,
} from "../../src/domain/estimate";

const line = (patch: Partial<EstimateLine> = {}): EstimateLine => ({
  id: "furniture",
  description: "Custom table",
  quantityMillis: 1000,
  unitPriceCents: 10000,
  unitCostCents: 6000,
  discountCents: 0,
  taxRatePpm: 87500,
  ...patch,
});
const draft = (lines = [line()], depositBps = 5000): EstimateDraft => ({
  currency: "USD",
  lines,
  deposit: { kind: "percentage", bps: depositBps },
});

describe("native estimate arithmetic", () => {
  it("reconciles discounted fractional items, tax, private economics and deposit", () => {
    const result = calculateEstimate(
      draft([
        line({ quantityMillis: 1500, discountCents: 1000 }),
        line({ id: "delivery", unitPriceCents: 999, unitCostCents: 500, taxRatePpm: 0 }),
      ])
    );
    expect(result).toMatchObject({
      subtotalCents: 15999,
      discountCents: 1000,
      netCents: 14999,
      taxCents: 1225,
      totalCents: 16224,
      costCents: 9500,
      profitCents: 5499,
      markupBps: 5788,
      marginBps: 3666,
      depositCents: 8112,
      remainingCents: 8112,
    });
    expect(result.lines.reduce((sum, item) => sum + item.totalCents, 0)).toBe(result.totalCents);
    expect(result.depositCents + result.remainingCents).toBe(result.totalCents);
  });

  it("rounds half cents once per line and deposits half up", () => {
    const result = calculateEstimate(
      draft([
        line({ unitPriceCents: 1, unitCostCents: 1, quantityMillis: 500, taxRatePpm: 500000 }),
        line({ id: "second", unitPriceCents: 1, unitCostCents: 0, taxRatePpm: 0 }),
      ])
    );
    expect(result.lines[0]).toMatchObject({ netCents: 1, costCents: 1, taxCents: 1 });
    expect(result).toMatchObject({ totalCents: 3, depositCents: 2, remainingCents: 1 });
  });

  it("keeps unknown costs unknown and handles zero revenue, zero cost and losses", () => {
    expect(calculateEstimate(draft([line({ unitCostCents: null })]))).toMatchObject({
      costCents: null,
      profitCents: null,
      marginBps: null,
      markupBps: null,
    });
    expect(calculateEstimate(draft([line({ unitPriceCents: 0 })]))).toMatchObject({
      profitCents: -6000,
      marginBps: null,
      markupBps: -10000,
    });
    expect(calculateEstimate(draft([line({ unitCostCents: 0 })]))).toMatchObject({
      profitCents: 10000,
      marginBps: 10000,
      markupBps: null,
    });
    expect(calculateEstimate(draft([line({ discountCents: 10000 })]))).toMatchObject({
      netCents: 0,
      taxCents: 0,
      totalCents: 0,
    });
    expect(calculateEstimate(draft(undefined, 0)).depositCents).toBe(0);
    expect(calculateEstimate(draft(undefined, 10000)).remainingCents).toBe(0);
  });

  it("distinguishes markup from gross margin", () => {
    expect(priceWithMarkup(10000, 5000)).toBe(15000);
    expect(priceForMargin(10000, 5000)).toBe(20000);
    expect(() => priceForMargin(10000, 10000)).toThrow();
    expect(() => priceWithMarkup(-1, 0)).toThrow();
  });

  it.each([
    { quantityMillis: 0 },
    { quantityMillis: 1.5 },
    { unitPriceCents: -1 },
    { unitCostCents: NaN },
    { unitCostCents: Infinity },
    { discountCents: 10001 },
    { taxRatePpm: 1000001 },
    { description: "" },
    { id: "" },
    { unitPriceCents: Number.MAX_SAFE_INTEGER, quantityMillis: 2000 },
  ])("rejects invalid input or overflow: %j", (patch) => {
    expect(() => calculateEstimate(draft([line(patch)]))).toThrow();
  });

  it("rejects aggregate overflow, duplicate IDs, unsupported currency and bad deposits", () => {
    expect(() => calculateEstimate(draft([line(), line()]))).toThrow();
    expect(() => calculateEstimate(draft([]))).toThrow();
    expect(() =>
      calculateEstimate({ ...draft(), currency: "EUR" } as unknown as EstimateDraft)
    ).toThrow();
    for (const rate of [-1, 10001, NaN, 0.1])
      expect(() => calculateEstimate(draft(undefined, rate))).toThrow();
    expect(() =>
      calculateEstimate(
        draft([
          line({ unitPriceCents: Number.MAX_SAFE_INTEGER, taxRatePpm: 0 }),
          line({ id: "overflow", taxRatePpm: 0 }),
        ])
      )
    ).toThrow("estimate_amount_overflow");
  });

  it("allows only customer-facing amounts even if private fields are added later", () => {
    const input = {
      ...draft(),
      supplier: "secret supplier",
      internalNotes: "private notes",
      lines: [{ ...line(), vendor: "secret vendor", source: { editKey: "secret edit key" } }],
    };
    const result = customerEstimate(input);
    expect(result).toEqual({
      calculationVersion: "usd-line-half-up-v1",
      currency: "USD",
      lines: [
        {
          id: "furniture",
          description: "Custom table",
          quantityMillis: 1000,
          unitPriceCents: 10000,
          extendedPriceCents: 10000,
          discountCents: 0,
          netCents: 10000,
          taxRatePpm: 87500,
          taxCents: 875,
          totalCents: 10875,
        },
      ],
      subtotalCents: 10000,
      discountCents: 0,
      netCents: 10000,
      taxCents: 875,
      totalCents: 10875,
      deposit: { kind: "percentage", bps: 5000 },
      depositCents: 5438,
      remainingCents: 5437,
    });
    for (const word of ["cost", "profit", "markup", "margin", "secret", "private", "source"]) {
      expect(JSON.stringify(result).toLowerCase()).not.toContain(word);
    }
    expect(input.lines[0].unitCostCents).toBe(6000);
  });
});

it("supports fixed deposits and exact milestone/final schedules", () => {
  expect(
    calculateEstimate({ ...draft(), deposit: { kind: "fixed", amountCents: 3000 } })
  ).toMatchObject({ depositCents: 3000, remainingCents: 7875 });
  expect(() =>
    calculateEstimate({ ...draft(), deposit: { kind: "fixed", amountCents: 20000 } })
  ).toThrow();
  expect(
    paymentSchedule(10001, [
      { id: "deposit", kind: "deposit", amount: { kind: "percentage", bps: 5000 } },
      { id: "fabrication", kind: "milestone", amount: { kind: "fixed", amountCents: 3000 } },
    ])
  ).toEqual([
    { id: "deposit", kind: "deposit", amountCents: 5001 },
    { id: "fabrication", kind: "milestone", amountCents: 3000 },
    { id: "final", kind: "final", amountCents: 2000 },
  ]);
  expect(() =>
    paymentSchedule(100, [
      { id: "one", kind: "deposit", amount: { kind: "fixed", amountCents: 101 } },
    ])
  ).toThrow("schedule_exceeds_contract_total");
  expect(() =>
    paymentSchedule(100, [
      { id: "one", kind: "milestone", amount: { kind: "fixed", amountCents: 10 } },
      { id: "two", kind: "deposit", amount: { kind: "fixed", amountCents: 10 } },
    ])
  ).toThrow("invalid_deposit_order");
});

it("includes payment, refund and dispute fees in private project profitability", () => {
  const input = {
    revenueCents: 1000000,
    costCents: 600000,
    processingFeesCents: 29030,
    refundFeesCents: 500,
    disputeFeesCents: 1500,
  };
  expect(projectProfitability(input)).toEqual({
    revenueCents: 1000000,
    costCents: 600000,
    paymentFeesCents: 31030,
    profitAfterFeesCents: 368970,
    marginAfterFeesBps: 3690,
  });
  expect(projectProfitability({ ...input, costCents: null }).profitAfterFeesCents).toBeNull();
  expect(projectProfitability({ ...input, revenueCents: 0 }).marginAfterFeesBps).toBeNull();
  expect(() => projectProfitability({ ...input, processingFeesCents: -1 })).toThrow();
});
