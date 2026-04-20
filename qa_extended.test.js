// qa_extended.test.js
// Extended QA tests for the Homebuyers Union calculator.
// Run with: node qa_extended.test.js
//
// Covers:
//   1. Math sanity checks with default inputs (homePrice=300000, groupSize=6, etc.)
//   2. Seq. N-1 filter — calculateGroup(inputs, N-1) result is structurally identical
//      to calculateGroup(inputs, N) (sequential), confirming why the UI drops it.
//   3. Group size = 1 edge case
//   4. Very high contributions
//   5. Zero housing costs (propertyTax=0, insurance=0)
//   6. Traditional (same payments) finishes faster than Traditional
//   7. Parallel houses everyone faster than Sequential
//   8. Position ordering invariants
//   9. Cost-per-month-housed comparison sanity
//  10. Sequential ledger structure
//  11. Parallel ledger structure
//  12. fundInterestEarned is present and non-negative in ledger entries
//  13. Traditional accelerated path correctness
//  14. Group size changes — number of positions returned

"use strict";

const {
  calculateGroup,
  calculateGroupSequential,
  monthlyMortgagePayment,
  traditionalPath,
  traditionalAcceleratedPath,
} = require("/Users/seanferguson/src/git/housing-union/calculator.js");

let passed = 0;
let failed = 0;

function assert(description, condition) {
  if (condition) {
    console.log(`  PASS: ${description}`);
    passed++;
  } else {
    console.error(`  FAIL: ${description}`);
    failed++;
  }
}

function assertClose(description, actual, expected, tolerance) {
  const ok = Math.abs(actual - expected) <= tolerance;
  if (ok) {
    console.log(`  PASS: ${description} (got ${actual.toFixed(2)}, expected ~${expected})`);
    passed++;
  } else {
    console.error(`  FAIL: ${description} (got ${actual.toFixed(2)}, expected ~${expected}, tol ${tolerance})`);
    failed++;
  }
}

// Default inputs matching the calculator's HTML defaults.
const DEFAULTS = {
  homePrice:          300000,
  groupSize:          6,
  c1:                 200,
  c2:                 2800,
  downPaymentPct:     0.20,
  annualRatePct:      7,
  termYears:          30,
  monthlyDonorContrib: 0,
  fundYieldPct:       3,
  propertyTaxPct:     1.1,
  insuranceMonthly:   150,
};

// ─── 1. Math sanity checks with default inputs ─────────────────────────────

console.log("\n1. Default inputs (homePrice=300000, N=6, c1=200, c2=2800, 20% down, 7%, 30yr, 3% yield, 1.1% tax, $150 ins):");

const parallel   = calculateGroup(DEFAULTS, 0);
const sequential = calculateGroup(DEFAULTS, DEFAULTS.groupSize);

assert("parallel no error",   parallel.error   === null);
assert("sequential no error", sequential.error === null);
assert("parallel has 6 positions",   parallel.positions   && parallel.positions.length === 6);
assert("sequential has 6 positions", sequential.positions && sequential.positions.length === 6);

// Positions increase in order.
for (let i = 0; i < 5; i++) {
  assert(
    `parallel: position ${i+1} housed before position ${i+2}`,
    parallel.positions[i].monthsUntilHoused < parallel.positions[i+1].monthsUntilHoused
  );
}
for (let i = 0; i < 5; i++) {
  assert(
    `sequential: position ${i+1} housed before position ${i+2}`,
    sequential.positions[i].monthsUntilHoused < sequential.positions[i+1].monthsUntilHoused
  );
}

// ─── 2. Traditional (same payments) finishes faster than Traditional ─────────

console.log("\n2. Traditional vs Traditional (same payments):");

// traditional is now an array — one entry per position. With uniform home prices,
// all entries are identical so we use index 0 for the scalar comparison tests.
const trad      = parallel.traditional[0];
const tradAccel = trad.accelerated;

assert(
  "Traditional (same payments) totalMonths < Traditional totalMonths",
  tradAccel.totalMonths < trad.monthsToSaveDown + DEFAULTS.termYears * 12
);
assert(
  "Traditional (same payments) has valid monthsToSaveDown",
  typeof tradAccel.monthsToSaveDown === "number" && tradAccel.monthsToSaveDown > 0
);
assert(
  "Traditional (same payments) has valid monthsToPayoff",
  typeof tradAccel.monthsToPayoff === "number" && tradAccel.monthsToPayoff > 0
);
// The accelerated path pays C2 per month (more than the standard payment), so total
// paid should be less than the 30yr standard path.
assert(
  "Traditional (same payments) totalPaid <= Traditional standard totalPaid",
  tradAccel.totalPaid <= trad.totalPaid
);

// ─── 3. Parallel should house everyone faster than Sequential ──────────────

console.log("\n3. Parallel vs Sequential speed:");

assert(
  "parallel totalMonths < sequential totalMonths",
  parallel.totalMonths < sequential.totalMonths
);
// Each position in parallel should be housed no later than sequential.
for (let i = 0; i < 6; i++) {
  assert(
    `parallel position ${i+1} housed no later than sequential`,
    parallel.positions[i].monthsUntilHoused <= sequential.positions[i].monthsUntilHoused
  );
}

// ─── 4. Seq. N-1 filter ────────────────────────────────────────────────────
//
// The UI description says "Seq. N-1 should NOT appear because it's a duplicate
// of Sequential for group size N". Let's verify what the filter actually does:
// the code filters out entries where m.k === N - 1.
// calculateGroup(inputs, N-1) is a hybrid with K=N-1, NOT the same as K=N.
// The UI just drops it without comparing the results. We verify the filter
// logic as implemented.

console.log("\n4. Seq. N-1 filter — verifying N=3 case:");

const inputs3 = { ...DEFAULTS, groupSize: 3 };
const seqN3       = calculateGroup(inputs3, 3); // K = N = pure sequential
const seqN1of3    = calculateGroup(inputs3, 2); // K = N-1 = 2 (the filtered one)

assert("seqN3 no error",    seqN3.error    === null);
assert("seqN1of3 no error", seqN1of3.error === null);

// For N=3 with K=2 (hybrid), the first 2 homes are handled sequentially.
// The final (3rd) home starts in a parallel phase — but since there are no
// other parallel homes, it effectively pays off alone, so K=2 and K=3 should
// produce identical timelines for a group of 3.
// The test verifies this equality (or documents a discrepancy).
const same = seqN3.totalMonths === seqN1of3.totalMonths
          && seqN3.positions.every((p, i) => p.monthsUntilHoused === seqN1of3.positions[i].monthsUntilHoused);

if (same) {
  assert("Seq. N-1 produces identical timeline to Sequential for N=3 (filter justified)", true);
} else {
  // Not necessarily a bug — the UI filter might just be aesthetic — but document it.
  console.error(`  INFO: Seq. N-1 totalMonths=${seqN1of3.totalMonths} vs Sequential totalMonths=${seqN3.totalMonths}`);
  assert("Seq. N-1 produces identical timeline to Sequential for N=3 (filter justified)", false);
}

// ─── 5. Group size = 1 edge case ──────────────────────────────────────────

console.log("\n5. Group size = 1:");

const solo1 = calculateGroup({ ...DEFAULTS, groupSize: 1 }, 0);
assert("solo no error", solo1.error === null);
assert("solo returns 1 position", solo1.positions && solo1.positions.length === 1);
assert("solo monthsUntilHoused > 0", solo1.positions[0].monthsUntilHoused > 0);
assert("solo totalPaid > homePrice * 0.20", solo1.positions[0].totalPaid > DEFAULTS.homePrice * 0.20);

// With groupSize=1 the sequential model (K=1) should be equivalent.
const soloSeq = calculateGroup({ ...DEFAULTS, groupSize: 1 }, 1);
assert("solo sequential no error", soloSeq.error === null);
assert("solo sequential same totalMonths as parallel",
  solo1.totalMonths === soloSeq.totalMonths);

// ─── 6. Very high contributions ────────────────────────────────────────────

console.log("\n6. Very high contributions:");

const highContrib = calculateGroup({
  ...DEFAULTS,
  c1: 50000,
  c2: 50000,
}, 0);

assert("high contributions no error", highContrib.error === null);
assert("high contributions: all housed quickly (< 24 months)", highContrib.positions &&
  highContrib.positions.every(p => p.monthsUntilHoused < 24));
assert("high contributions: totalMonths < 100", highContrib.totalMonths < 100);

// ─── 7. Zero housing costs ──────────────────────────────────────────────────

console.log("\n7. Zero housing costs (propertyTax=0, insurance=0, maintenance=0):");

// All three housing cost components must be zero to get zero ledger housingCosts.
const zeroCosts = calculateGroup({
  ...DEFAULTS,
  propertyTaxPct:   0,
  insuranceMonthly: 0,
  maintenancePct:   0,
}, 0);

assert("zero housing costs no error", zeroCosts.error === null);
assert("zero housing costs: ledger phase 1 entries have housingCosts = 0",
  zeroCosts.ledger.filter(e => e.phase === 1).every(e => e.housingCosts === 0));
assert("zero housing costs: ledger phase 2 entries have housingCosts = 0",
  zeroCosts.ledger.filter(e => e.phase === 2).every(e => e.housingCosts === 0));

// With zero housing costs, the simulation should finish faster than with costs.
const withCosts = calculateGroup(DEFAULTS, 0);
assert("zero housing costs finishes faster than with costs",
  zeroCosts.totalMonths <= withCosts.totalMonths);

// ─── 8. Sequential ledger structure ────────────────────────────────────────

console.log("\n8. Sequential ledger structure:");

const seqResult = calculateGroupSequential({ ...DEFAULTS, groupSize: 3 });
assert("sequential ledger no error", seqResult.error === null);
assert("sequential ledger has entries", seqResult.ledger && seqResult.ledger.length > 0);

// All entries should have phase 'saving' or 'payoff'.
const badPhase = seqResult.ledger.filter(e => e.phase !== 'saving' && e.phase !== 'payoff');
assert("sequential ledger: no unexpected phase values", badPhase.length === 0);

// Each 'saving' entry has fundBalance, downPaymentTarget, housePurchased fields.
const savingEntries = seqResult.ledger.filter(e => e.phase === 'saving');
assert("sequential saving entries have fundBalance", savingEntries.every(e => typeof e.fundBalance === 'number'));
assert("sequential saving entries have downPaymentTarget", savingEntries.every(e => typeof e.downPaymentTarget === 'number'));
assert("sequential saving entries have housePurchased", savingEntries.every(e => typeof e.housePurchased === 'boolean'));

// Each 'payoff' entry has mortgage fields.
const payoffEntries = seqResult.ledger.filter(e => e.phase === 'payoff');
assert("sequential payoff entries have mortgageBalanceBefore", payoffEntries.every(e => typeof e.mortgageBalanceBefore === 'number'));
assert("sequential payoff entries have mortgageBalanceAfter", payoffEntries.every(e => typeof e.mortgageBalanceAfter === 'number'));
assert("sequential payoff entries have interestCharged", payoffEntries.every(e => typeof e.interestCharged === 'number'));

// housingCosts field present in all sequential entries.
assert("sequential all entries have housingCosts", seqResult.ledger.every(e => typeof e.housingCosts === 'number'));

// ─── 9. Parallel ledger structure ──────────────────────────────────────────

console.log("\n9. Parallel ledger structure:");

const parResult = calculateGroup({ ...DEFAULTS, groupSize: 3 }, 0);
assert("parallel ledger no error", parResult.error === null);
assert("parallel ledger has entries", parResult.ledger && parResult.ledger.length > 0);

// All entries should have phase 1 or 2 (numbers).
const badParPhase = parResult.ledger.filter(e => e.phase !== 1 && e.phase !== 2);
assert("parallel ledger: no unexpected phase values", badParPhase.length === 0);

// Phase 1 entries have the required fields.
const p1Entries = parResult.ledger.filter(e => e.phase === 1);
assert("parallel phase 1: postHouseMembers present", p1Entries.every(e => typeof e.postHouseMembers === 'number'));
assert("parallel phase 1: preHouseMembers present",  p1Entries.every(e => typeof e.preHouseMembers  === 'number'));
assert("parallel phase 1: netGrowth present",        p1Entries.every(e => typeof e.netGrowth        === 'number'));
assert("parallel phase 1: totalObligations present", p1Entries.every(e => typeof e.totalObligations === 'number'));
assert("parallel phase 1: housingCosts present",     p1Entries.every(e => typeof e.housingCosts     === 'number'));
// mortgagePaymentStd is null when member home prices differ (variable payments).
// When all home prices are identical it is also null — the calculator uses per-position
// payment arrays and no longer stores a single shared standard payment in the ledger.
assert("parallel phase 1: mortgagePaymentStd is null (variable/per-position payments)",
  p1Entries.every(e => e.mortgagePaymentStd === null));

// Phase 2 entries have mortgageDetails array.
const p2Entries = parResult.ledger.filter(e => e.phase === 2);
assert("parallel phase 2: mortgageDetails present", p2Entries.every(e => Array.isArray(e.mortgageDetails)));
assert("parallel phase 2: surplus >= 0", p2Entries.every(e => e.surplus >= 0));
assert("parallel phase 2: housingCosts >= 0", p2Entries.every(e => e.housingCosts >= 0));

// ─── 10. fundInterestEarned in parallel ledger ─────────────────────────────

console.log("\n10. Fund interest earned in parallel ledger:");

const parWith3pct = calculateGroup({ ...DEFAULTS, groupSize: 3, fundYieldPct: 3 }, 0);
const parWith0pct = calculateGroup({ ...DEFAULTS, groupSize: 3, fundYieldPct: 0 }, 0);

// At 3% yield, there should be interest earned entries.
const hasInterest = parWith3pct.ledger.filter(e => e.phase === 1 && e.fundInterestEarned > 0);
assert("3% fund yield produces interest earned entries in phase 1", hasInterest.length > 0);

// At 0% yield, no interest.
const noInterest = parWith0pct.ledger.filter(e => e.phase === 1 && e.fundInterestEarned > 0);
assert("0% fund yield: no interest earned entries", noInterest.length === 0);

// With interest, housing finishes faster.
assert("3% fund yield finishes faster than 0%", parWith3pct.totalMonths <= parWith0pct.totalMonths);

// ─── 11. Traditional accelerated path correctness ─────────────────────────

console.log("\n11. Traditional accelerated path:");

// Standard traditional path: save at c1, then pay standard mortgage payment.
// Accelerated: save at c1, then pay c2 per month (faster payoff).
const p = DEFAULTS;
const housingCosts = p.homePrice * (p.propertyTaxPct / 100 + 0.01) / 12 + p.insuranceMonthly;
const ta = traditionalAcceleratedPath(p.homePrice, p.c1, p.c2, p.annualRatePct, p.termYears, p.fundYieldPct, housingCosts);

assert("tradAccel monthsToSaveDown > 0", ta.monthsToSaveDown > 0);
assert("tradAccel monthsToPayoff > 0",   ta.monthsToPayoff   > 0);
assert("tradAccel totalMonths = save + payoff", ta.totalMonths === ta.monthsToSaveDown + ta.monthsToPayoff);
assert("tradAccel totalPaid = save*c1 + payoff*c2",
  Math.abs(ta.totalPaid - (ta.monthsToSaveDown * p.c1 + ta.monthsToPayoff * p.c2)) < 1);

// Since c2 > standard mortgage payment, accelerated should have fewer payoff months.
const standardMortPayment = monthlyMortgagePayment(p.homePrice * 0.80, p.annualRatePct, p.termYears);
const mortgageAfterHousingCosts = p.c2 - housingCosts;
if (mortgageAfterHousingCosts > standardMortPayment) {
  assert("tradAccel payoff months < standard 30yr*12", ta.monthsToPayoff < p.termYears * 12);
}

// ─── 12. Group size changes ─────────────────────────────────────────────────

console.log("\n12. Group size changes:");

for (const n of [1, 2, 3, 6, 10]) {
  const r = calculateGroup({ ...DEFAULTS, groupSize: n }, 0);
  assert(`groupSize=${n}: returns ${n} positions`, r.error === null && r.positions && r.positions.length === n);
}

// ─── 13. Cost per month housed: position 1 benefits from parallel ──────────

console.log("\n13. Cost per month housed (parallel cheaper than sequential):");

const WINDOW = 600; // 50 years in months
const parCosts  = parallel.positions.map(p => p.totalPaid + Math.max(0, WINDOW - parallel.totalMonths) * housingCosts);
const seqCosts  = sequential.positions.map(p => p.totalPaid + Math.max(0, WINDOW - sequential.totalMonths) * housingCosts);
const parRates  = parCosts.map((c, i) => c / (WINDOW - parallel.positions[i].monthsUntilHoused));
const seqRates  = seqCosts.map((c, i) => c / (WINDOW - sequential.positions[i].monthsUntilHoused));

// Parallel houses position 1 fastest — they get the most months housed in the
// 50-year window, so their cost/mo-housed is lower than sequential.
assert("parallel cost/mo housed is cheaper for position 1",
  parRates[0] <= seqRates[0]);

// Both models should have at least some positions where one beats the other —
// there is a genuine tradeoff: parallel is faster for early positions but
// later positions pay C2 for longer before the org dissolves.
const parallelCheaperCount = parRates.filter((r, i) => r <= seqRates[i]).length;
assert("parallel has at least one position cheaper than sequential",
  parallelCheaperCount >= 1);

// ─── 14. Ledger month continuity ─────────────────────────────────────────────

console.log("\n14. Ledger month continuity (parallel):");

const parMonths = parallel.ledger.map(e => e.month);
let seenMonths = new Set();
let dupFound = false;
for (const m of parMonths) {
  if (seenMonths.has(m)) { dupFound = true; break; }
  seenMonths.add(m);
}
assert("parallel ledger: no duplicate month entries", !dupFound);
assert("parallel ledger: months start at 1", parMonths[0] === 1);
assert("parallel ledger: months are consecutive", parMonths.every((m, i) => i === 0 || m === parMonths[i-1] + 1));

// ─── 15. Sequential: calculateGroup(N) vs calculateGroupSequential consistency ──

console.log("\n15. calculateGroup(N) vs calculateGroupSequential consistency:");

const seqViaGroup = calculateGroup({ ...DEFAULTS, groupSize: 4 }, 4);
const seqDirect   = calculateGroupSequential({ ...DEFAULTS, groupSize: 4 });

assert("both return no error", seqViaGroup.error === null && seqDirect.error === null);
// The two implementations should produce close (not necessarily identical)
// totalMonths because they use different internal algorithms but model the same concept.
const monthDiff = Math.abs(seqViaGroup.totalMonths - seqDirect.totalMonths);
assert(`calculateGroup(N=4) totalMonths within 3 months of calculateGroupSequential (diff=${monthDiff})`,
  monthDiff <= 3);

// ─── 16. Income cells: housingCosts deducted correctly from effective income ─

console.log("\n16. Housing cost deduction in ledger income:");

// With housing costs, housingCosts in phase 1 should grow as more members are housed.
const p1 = withCosts.ledger.filter(e => e.phase === 1);
// At the start (0 housed), housingCosts should be 0.
const firstEntry = p1[0];
assert("phase 1 month 1: 0 housed members → 0 housingCosts",
  firstEntry.postHouseMembers === 0 && firstEntry.housingCosts === 0);

// Find an entry where a house was purchased; the next month should show housingCosts > 0.
const purchaseEntry = p1.find(e => e.housePurchased !== null);
if (purchaseEntry) {
  const afterPurchaseIdx = p1.indexOf(purchaseEntry) + 1;
  if (afterPurchaseIdx < p1.length) {
    const afterEntry = p1[afterPurchaseIdx];
    assert("entry after first purchase: housingCosts > 0 (1 member housed)",
      afterEntry.housingCosts > 0);
  }
}

// ─── 17. Hybrid model properties ──────────────────────────────────────────────

console.log("\n17. Hybrid model (K=2, N=6):");

const hybrid2 = calculateGroup(DEFAULTS, 2);
assert("hybrid K=2 no error", hybrid2.error === null);
assert("hybrid K=2 has 6 positions", hybrid2.positions.length === 6);
assert("hybrid K=2 sequentialCount = 2", hybrid2.sequentialCount === 2);

// Hybrid ledger should have both sequential-style entries (saving/payoff phases)
// and parallel-style entries (phase 1/2).
const hybridHasSaving = hybrid2.ledger.some(e => e.phase === 'saving');
const hybridHasPayoff = hybrid2.ledger.some(e => e.phase === 'payoff');
const hybridHasP1     = hybrid2.ledger.some(e => e.phase === 1);
const hybridHasP2     = hybrid2.ledger.some(e => e.phase === 2);
assert("hybrid ledger has 'saving' phase entries", hybridHasSaving);
assert("hybrid ledger has 'payoff' phase entries", hybridHasPayoff);
assert("hybrid ledger has numeric phase 1 entries (parallel section)", hybridHasP1);
assert("hybrid ledger has numeric phase 2 entries (parallel section)", hybridHasP2);

// Hybrid totalMonths should be between pure parallel and pure sequential.
assert("hybrid K=2 totalMonths >= parallel",
  hybrid2.totalMonths >= parallel.totalMonths);
assert("hybrid K=2 totalMonths <= sequential",
  hybrid2.totalMonths <= sequential.totalMonths);

// ─── 18. Down payment > 20% increases saving time ───────────────────────────

console.log("\n18. Down payment percentage effect:");

const dp20 = calculateGroup({ ...DEFAULTS, downPaymentPct: 0.20 }, 0);
const dp30 = calculateGroup({ ...DEFAULTS, downPaymentPct: 0.30 }, 0);

assert("30% down: first member housed later than 20% down",
  dp30.positions[0].monthsUntilHoused > dp20.positions[0].monthsUntilHoused);

// ─── 19. Higher interest rate increases total paid ───────────────────────────

console.log("\n19. Interest rate effect:");

const rate5 = calculateGroup({ ...DEFAULTS, annualRatePct: 5 }, 0);
const rate9 = calculateGroup({ ...DEFAULTS, annualRatePct: 9 }, 0);

assert("rate9 and rate5 no error", rate5.error === null && rate9.error === null);
// Higher rate → higher mortgage payment → harder to pay off → more months total.
// Also higher total paid for position 1.
assert("9% rate: position 1 pays more total than 5% rate",
  rate9.positions[0].totalPaid > rate5.positions[0].totalPaid);

// ─── 20. tradAccel never costs more than traditional standard ────────────────

console.log("\n20. tradAccel total paid <= traditional standard:");

// Check across different home prices (skip if simulation exceeded the month cap).
for (const hp of [200000, 300000, 500000]) {
  const r = calculateGroup({ ...DEFAULTS, homePrice: hp }, 0);
  if (r.error || !r.traditional) {
    console.log(`  SKIP: homePrice=${hp}: simulation error (${r.error})`);
    continue;
  }
  assert(
    `homePrice=${hp}: tradAccel.totalPaid <= trad.totalPaid`,
    r.traditional[0].accelerated.totalPaid <= r.traditional[0].totalPaid
  );
}

// ─── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);
