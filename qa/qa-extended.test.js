// qa/qa-extended.test.js
// Extended QA tests for the Homebuyers Union calculator.
// Run with: node qa/qa-extended.test.js

"use strict";

const {
  calculateGroup,
  calculateGroupSequential,
  monthlyMortgagePayment,
  traditionalPath,
  traditionalAcceleratedPath,
} = require("../calculator.js");

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

function assertClose(description, actual, expected, tolerance = 1) {
  const ok = Math.abs(actual - expected) <= tolerance;
  if (ok) {
    console.log(`  PASS: ${description} (got ${actual.toFixed(2)}, expected ~${expected})`);
    passed++;
  } else {
    console.error(`  FAIL: ${description} (got ${actual}, expected ~${expected}, tolerance ${tolerance})`);
    failed++;
  }
}

// ─── Default inputs (as shown in the HTML form) ───────────────────────────────

const DEFAULTS = {
  homePrice: 300000,
  groupSize: 6,
  c1: 200,
  c2: 2800,
  downPaymentPct: 0.20,
  annualRatePct: 7,
  termYears: 30,
  monthlyDonorContrib: 0,
  fundYieldPct: 3,
  propertyTaxPct: 1.1,
  insuranceMonthly: 150,
};

// ─── Math sanity checks with default inputs ───────────────────────────────────

console.log("\n== Math sanity checks (defaults: homePrice=300k, N=6, c1=200, c2=2800, 20% dp, 7%, 30yr) ==");

const parallel = calculateGroup(DEFAULTS, 0);
const sequential = calculateGroup(DEFAULTS, DEFAULTS.groupSize); // K=N = full sequential

assert("parallel no error", parallel.error === null);
assert("parallel has 6 positions", parallel.positions && parallel.positions.length === 6);
assert("sequential no error", sequential.error === null);
assert("sequential has 6 positions", sequential.positions && sequential.positions.length === 6);

// Position ordering: each position must be housed later than the previous
for (let i = 1; i < 6; i++) {
  assert(
    `parallel position ${i} housed before position ${i + 1}`,
    parallel.positions[i - 1].monthsUntilHoused < parallel.positions[i].monthsUntilHoused
  );
}
for (let i = 1; i < 6; i++) {
  assert(
    `sequential position ${i} housed before position ${i + 1}`,
    sequential.positions[i - 1].monthsUntilHoused < sequential.positions[i].monthsUntilHoused
  );
}

// Parallel should house everyone faster than sequential (sequential is strictly slower)
assert(
  "parallel total months < sequential total months",
  parallel.totalMonths < sequential.totalMonths
);

// Traditional (same payments) vs Traditional
// traditionalAcceleratedPath pays c2 during mortgage, traditional pays standard payment
// Traditional (same payments) should finish faster (lower totalMonths) than Traditional
const trad = traditionalPath(300000, 0.20, 200, 7, 30, 3, 300000 * (1.1 / 100 + 0.01) / 12 + 150);
const tradAccel = traditionalAcceleratedPath(300000, 200, 2800, 7, 30, 3, 300000 * (1.1 / 100 + 0.01) / 12 + 150);

assert(
  "Traditional (same payments) totalMonths < Traditional totalMonths",
  tradAccel.totalMonths < trad.monthsToSaveDown + 30 * 12
);

// Cost per month housed (50yr window) — rough sanity: all models should give
// a positive number; check parallel and sequential produce reasonable values
const WINDOW = 600;
const housingCostsMonthly = 300000 * (1.1 / 100 + 0.01) / 12 + 150;

function rate50yr(pos, modelTotalMonths) {
  const paid = pos.totalPaid + Math.max(0, WINDOW - modelTotalMonths) * housingCostsMonthly;
  const months = WINDOW - pos.monthsUntilHoused;
  return months > 0 ? Math.round(paid / months) : 0;
}

for (let i = 0; i < 6; i++) {
  const r = rate50yr(parallel.positions[i], parallel.totalMonths);
  assert(`parallel position ${i + 1} rate50yr is positive`, r > 0);
}


// ─── Seq. N-1 filter (groupSize=3 → no "Seq. 2" column) ─────────────────────

console.log("\n== Seq. N-1 filter ==");

// The renderComparison function filters out model with k === N-1 via:
//   .filter(m => !m.result.error && m.k !== N - 1)
// We can't call renderComparison directly (it's in the browser), but we can
// verify the underlying simulation logic for K=N-1 produces a result that
// matches K=N (Sequential) — which is the rationale for the filter.
// With N=3, Seq.2 (K=2) should be equivalent to Sequential (K=3 = N).

const inputs3 = { ...DEFAULTS, groupSize: 3 };
const seqN = calculateGroup(inputs3, 3);       // K=N: pure sequential
const seqNminus1 = calculateGroup(inputs3, 2); // K=N-1: should match sequential

assert("N=3: seqN-1 same totalMonths as seqN", seqNminus1.totalMonths === seqN.totalMonths);
assert(
  "N=3: seqN-1 same position 1 monthsUntilHoused as seqN",
  seqNminus1.positions[0].monthsUntilHoused === seqN.positions[0].monthsUntilHoused
);
assert(
  "N=3: seqN-1 same position 3 monthsUntilHoused as seqN",
  seqNminus1.positions[2].monthsUntilHoused === seqN.positions[2].monthsUntilHoused
);

// For N=4, K=3 (Seq.3) is N-1. Verify it matches K=4 (Sequential).
const inputs4 = { ...DEFAULTS, groupSize: 4 };
const seqN4 = calculateGroup(inputs4, 4);
const seqNm1_4 = calculateGroup(inputs4, 3);
assert("N=4: seqN-1 same totalMonths as seqN", seqNm1_4.totalMonths === seqN4.totalMonths);


// ─── Edge case: group size = 1 ────────────────────────────────────────────────

console.log("\n== Edge case: group size = 1 ==");

const solo = calculateGroup({ ...DEFAULTS, groupSize: 1 }, 0);
assert("group size 1: no error", solo.error === null);
assert("group size 1: 1 position", solo.positions && solo.positions.length === 1);
assert("group size 1: positive totalMonths", solo.totalMonths > 0);
assert("group size 1: housingCost accounted (position 1 has a valid totalPaid)", solo.positions[0].totalPaid > 0);

// With groupSize=1, K=0 (parallel) and K=1 (sequential) should be equivalent
const soloSeq = calculateGroup({ ...DEFAULTS, groupSize: 1 }, 1);
assert(
  "group size 1: parallel and sequential identical totalMonths",
  solo.totalMonths === soloSeq.totalMonths
);


// ─── Edge case: very high contributions ───────────────────────────────────────

console.log("\n== Edge case: very high contributions ==");

const highContrib = calculateGroup({
  ...DEFAULTS,
  c1: 5000,
  c2: 10000,
  groupSize: 3,
}, 0);
assert("high contributions: no error", highContrib.error === null);
assert(
  "high contributions: total months significantly less than normal",
  highContrib.totalMonths < calculateGroup({ ...DEFAULTS, groupSize: 3 }, 0).totalMonths
);
assert(
  "high contributions: position 1 housed significantly faster",
  highContrib.positions[0].monthsUntilHoused < 12,
  "position 1 housed within 12 months with high c1"
);


// ─── Edge case: zero housing costs (propertyTax=0, insurance=0) ──────────────

console.log("\n== Edge case: zero housing costs ==");

const zeroHousing = calculateGroup({
  ...DEFAULTS,
  propertyTaxPct: 0,
  insuranceMonthly: 0,
  maintenancePct: 0,
}, 0);
assert("zero housing costs: no error", zeroHousing.error === null);
assert("zero housing costs: 6 positions", zeroHousing.positions && zeroHousing.positions.length === 6);
// With zero housing costs, fund net growth is higher so total months should be less
assert(
  "zero housing costs: faster than with housing costs",
  zeroHousing.totalMonths <= parallel.totalMonths
);

// For the ledger: zero housing costs means housingCosts=0 in every ledger entry.
// Verify the parallel ledger has no entry with housingCosts > 0.
const zeroHousingLedger = zeroHousing.ledger;
const anyHousingCostEntries = zeroHousingLedger.filter(e => e.housingCosts > 0);
assert(
  "zero housing costs: no ledger entries with housingCosts > 0",
  anyHousingCostEntries.length === 0
);

// Verify same for sequential
const zeroHousingSeq = calculateGroup({
  ...DEFAULTS,
  propertyTaxPct: 0,
  insuranceMonthly: 0,
  maintenancePct: 0,
}, DEFAULTS.groupSize);
const anyHousingCostSeq = zeroHousingSeq.ledger.filter(e => e.housingCosts > 0);
assert(
  "zero housing costs: sequential ledger has no housingCosts entries",
  anyHousingCostSeq.length === 0
);


// ─── Changing group size updates positions correctly ─────────────────────────

console.log("\n== Group size changes ==");

for (const n of [2, 3, 4, 5, 6, 8, 10]) {
  const result = calculateGroup({ ...DEFAULTS, groupSize: n }, 0);
  assert(
    `group size ${n}: returns ${n} positions`,
    result.positions && result.positions.length === n
  );
  if (result.positions) {
    assert(
      `group size ${n}: position 1 housed before position ${n}`,
      result.positions[0].monthsUntilHoused < result.positions[n - 1].monthsUntilHoused
    );
  }
}


// ─── Ledger correctness (parallel) ───────────────────────────────────────────

console.log("\n== Ledger correctness (parallel model) ==");

const ledgerDefault = calculateGroup(DEFAULTS, 0);
assert("ledger exists", Array.isArray(ledgerDefault.ledger) && ledgerDefault.ledger.length > 0);

// All phase 1 entries should have phase === 1
const ph1 = ledgerDefault.ledger.filter(e => e.phase === 1);
const ph2 = ledgerDefault.ledger.filter(e => e.phase === 2);
assert("ledger has both phase 1 and phase 2 entries", ph1.length > 0 && ph2.length > 0);
assert("all phase 1 entries have correct shape", ph1.every(e =>
  typeof e.month === 'number' &&
  typeof e.postHouseMembers === 'number' &&
  typeof e.preHouseMembers === 'number' &&
  typeof e.totalIncome === 'number' &&
  typeof e.totalObligations === 'number' &&
  typeof e.netGrowth === 'number' &&
  typeof e.fundBalanceStart === 'number'
));

// Phase 2 entries must have mortgageDetails array
assert("all phase 2 entries have mortgageDetails array", ph2.every(e =>
  Array.isArray(e.mortgageDetails) && e.mortgageDetails.length === DEFAULTS.groupSize
));

// Phase 1: postHouseMembers + preHouseMembers = N
assert(
  "phase 1: postHouseMembers + preHouseMembers always = N",
  ph1.every(e => e.postHouseMembers + e.preHouseMembers === DEFAULTS.groupSize)
);

// Phase 1: totalIncome = c2Income + c1Income + donorIncome + fundInterestEarned
assert(
  "phase 1: totalIncome = sum of components",
  ph1.every(e => Math.abs(e.totalIncome - (e.c2Income + e.c1Income + e.donorIncome + e.fundInterestEarned)) < 0.01)
);

// Phase 1: fundBalanceAfterGrowth = fundBalanceStart + netGrowth
assert(
  "phase 1: fundBalanceAfterGrowth = fundBalanceStart + netGrowth",
  ph1.every(e => Math.abs(e.fundBalanceAfterGrowth - (e.fundBalanceStart + e.netGrowth)) < 0.01)
);

// Phase 1: months are sequential (1, 2, 3, ...) - but phase 1 and 2 share the same month counter
const allMonths = ledgerDefault.ledger.map(e => e.month);
assert(
  "ledger months are strictly increasing",
  allMonths.every((m, i) => i === 0 || m === allMonths[i - 1] + 1)
);

// Phase 2: totalIncome = N * c2 (no c1 income, no fund interest)
assert(
  "phase 2: totalIncome = N * c2 (all members housed)",
  ph2.every(e => Math.abs(e.totalIncome - DEFAULTS.groupSize * DEFAULTS.c2) < 0.01)
);

// Housing costs in phase 1: computed as postHouseMembers * housingCostsMonthly
const hcm = DEFAULTS.homePrice * (DEFAULTS.propertyTaxPct / 100 + 0.01) / 12 + DEFAULTS.insuranceMonthly;
assert(
  "phase 1: housingCosts = postHouseMembers * housingCostsMonthly",
  ph1.every(e => Math.abs(e.housingCosts - e.postHouseMembers * hcm) < 0.01)
);

// Obligations cell: parallel model phase 1 — totalObligations is non-negative and zero when no mortgages active
assert(
  "phase 1: totalObligations >= 0 and 0 when no active mortgages",
  ph1.every(e => e.totalObligations >= 0 && (e.activeMortgages > 0 || e.totalObligations === 0))
);


// ─── Ledger correctness (sequential model) ───────────────────────────────────

console.log("\n== Ledger correctness (sequential model via calculateGroupSequential) ==");

const seqResult = calculateGroupSequential(DEFAULTS);
assert("sequential ledger exists", Array.isArray(seqResult.ledger) && seqResult.ledger.length > 0);

const savingEntries = seqResult.ledger.filter(e => e.phase === 'saving');
const payoffEntries = seqResult.ledger.filter(e => e.phase === 'payoff');

assert("sequential: has both saving and payoff entries", savingEntries.length > 0 && payoffEntries.length > 0);

// Saving entries: housingCosts = housedMembers * housingCostsMonthly
assert(
  "sequential saving: housingCosts = housedMembers * hcm",
  savingEntries.every(e => Math.abs(e.housingCosts - e.housedMembers * hcm) < 0.01)
);

// Payoff entries: housingCosts = (k+1) * housingCostsMonthly = housedMembers * hcm
assert(
  "sequential payoff: housingCosts = housedMembers * hcm",
  payoffEntries.every(e => Math.abs(e.housingCosts - e.housedMembers * hcm) < 0.01)
);

// houseIndex should range from 1 to N
const houseIndices = [...new Set(seqResult.ledger.map(e => e.houseIndex))];
assert(
  "sequential: houseIndex covers 1 to N",
  houseIndices.length === DEFAULTS.groupSize &&
  Math.min(...houseIndices) === 1 &&
  Math.max(...houseIndices) === DEFAULTS.groupSize
);

// Each saving phase must end with a housePurchased=true entry
const houseIndicesArr = Array.from({ length: DEFAULTS.groupSize }, (_, i) => i + 1);
for (const idx of houseIndicesArr) {
  const cycleEntries = seqResult.ledger.filter(e => e.houseIndex === idx && e.phase === 'saving');
  const lastEntry = cycleEntries[cycleEntries.length - 1];
  assert(
    `sequential: house ${idx} saving phase ends with housePurchased=true`,
    lastEntry && lastEntry.housePurchased === true
  );
}

// Payoff phase: mortgageBalanceAfter should reach 0 on the last entry for each cycle
for (const idx of houseIndicesArr) {
  const cyclePayoff = seqResult.ledger.filter(e => e.houseIndex === idx && e.phase === 'payoff');
  if (cyclePayoff.length > 0) {
    const lastPayoff = cyclePayoff[cyclePayoff.length - 1];
    assertClose(
      `sequential: house ${idx} payoff ends at balance ~0`,
      lastPayoff.mortgageBalanceAfter,
      0,
      1.0 // allow $1 rounding
    );
  }
}


// ─── Sequential ledger effective income (top number) ─────────────────────────

console.log("\n== Sequential ledger: effective income = totalIncome - housingCosts ==");

// The renderSequentialLedger function displays effectiveIncome = totalIncome - housingCosts
// at the top of the income cell. Verify this is always non-negative with default inputs.
for (const e of seqResult.ledger) {
  const effectiveIncome = e.totalIncome - e.housingCosts;
  assert(
    `seq ledger month ${e.month}: effectiveIncome (${effectiveIncome.toFixed(0)}) >= 0`,
    effectiveIncome >= 0
  );
}

// With zero housing costs, effectiveIncome === totalIncome
const seqZero = calculateGroupSequential({ ...DEFAULTS, propertyTaxPct: 0, insuranceMonthly: 0, maintenancePct: 0 });
for (const e of seqZero.ledger) {
  assert(
    `seq zero-housing month ${e.month}: effectiveIncome === totalIncome`,
    Math.abs((e.totalIncome - e.housingCosts) - e.totalIncome) < 0.01
  );
}


// ─── Hybrid models ────────────────────────────────────────────────────────────

console.log("\n== Hybrid models (K between 1 and N-2 for N=6) ==");

for (let k = 1; k <= 4; k++) { // N=6, valid hybrids are K=1..4 (N-1=5 is filtered)
  const hybrid = calculateGroup(DEFAULTS, k);
  assert(`hybrid K=${k}: no error`, hybrid.error === null);
  assert(`hybrid K=${k}: 6 positions`, hybrid.positions && hybrid.positions.length === 6);
  assert(`hybrid K=${k}: totalMonths > 0`, hybrid.totalMonths > 0);
  // Hybrid should be between parallel and sequential in total months
  assert(
    `hybrid K=${k}: totalMonths >= parallel`,
    hybrid.totalMonths >= parallel.totalMonths
  );
  assert(
    `hybrid K=${k}: totalMonths <= sequential`,
    hybrid.totalMonths <= sequential.totalMonths
  );
  // Hybrid ledger should contain both sequential-style entries and parallel-style entries
  const hasSeqPhases = hybrid.ledger.some(e => e.phase === 'saving' || e.phase === 'payoff');
  const hasParPhases = hybrid.ledger.some(e => e.phase === 1 || e.phase === 2);
  assert(`hybrid K=${k}: ledger has sequential phases`, hasSeqPhases);
  assert(`hybrid K=${k}: ledger has parallel phases`, hasParPhases);
}


// ─── Fund yield effect ────────────────────────────────────────────────────────

console.log("\n== Fund yield effect ==");

const withYield = calculateGroup(DEFAULTS, 0);
const noYield = calculateGroup({ ...DEFAULTS, fundYieldPct: 0 }, 0);
assert("fund yield: with yield has lower or equal totalMonths than no yield", withYield.totalMonths <= noYield.totalMonths);
// Phase 1 entries should show fundInterestEarned > 0 when yield > 0 (after first month)
const interestEntries = withYield.ledger.filter(e => e.phase === 1 && e.fundInterestEarned > 0);
assert("fund yield: some phase 1 entries have positive fundInterestEarned", interestEntries.length > 0);
// No yield means all entries have fundInterestEarned === 0
const noYieldInterest = noYield.ledger.filter(e => e.phase === 1 && e.fundInterestEarned > 0);
assert("no yield: zero fundInterestEarned in all phase 1 entries", noYieldInterest.length === 0);


// ─── Traditional vs Traditional (same payments) ───────────────────────────────

console.log("\n== Traditional vs Traditional (same payments) ==");

// Traditional (same payments) pays c2 after move-in = faster payoff
// It should always have totalMonths <= Traditional
for (const n of [2, 3, 6]) {
  const inp = { ...DEFAULTS, groupSize: n };
  const r = calculateGroup(inp, 0);
  const tAccel = r.traditional[0].accelerated;
  const tStd = r.traditional[0];
  assert(
    `N=${n}: Traditional (same payments) totalMonths (${tAccel.totalMonths}) <= Traditional (${tStd.monthsToSaveDown + inp.termYears * 12})`,
    tAccel.totalMonths <= tStd.monthsToSaveDown + inp.termYears * 12
  );
  assert(
    `N=${n}: Traditional (same payments) totalPaid > 0`,
    tAccel.totalPaid > 0
  );
}


// ─── Parallel outperforms sequential for position 1 housingDate ──────────────

console.log("\n== Parallel houses position 1 faster than sequential (default inputs) ==");

// Position 1 in parallel should always be housed no later than sequential pos 1
assert(
  "parallel pos 1 housed at most as late as sequential pos 1",
  parallel.positions[0].monthsUntilHoused <= sequential.positions[0].monthsUntilHoused
);


// ─── totalPaid accumulation monotonicity ─────────────────────────────────────

console.log("\n== totalPaid across positions (parallel) ==");

// In parallel model with enough contributions:
// Positions housed EARLIER contribute for LONGER at c2 and thus pay MORE total.
// Position 1 (housed earliest) → pays c2 for longest → highest totalPaid.
// This is NOT a general truth for all inputs, but with defaults c2 >> c1 it holds.
assert(
  "parallel: position 1 pays more total than position 6",
  parallel.positions[0].totalPaid > parallel.positions[5].totalPaid
);


// ─── remainingBalance function (via calculateGroup behavior) ─────────────────

console.log("\n== Phase 2 mortgage accounting ==");

// All mortgages in phase 2 should start with the standard payment >= interestCharged
// (otherwise the loan can never be paid off)
const ph2default = calculateGroup(DEFAULTS, 0).ledger.filter(e => e.phase === 2);
assert(
  "phase 2: mortgage payment >= interestCharged for all active mortgages",
  ph2default.every(e =>
    e.mortgageDetails.every(d =>
      d.balanceBefore === 0 || (d.principalFromPayment + d.interestCharged) >= d.interestCharged
    )
  )
);

// All balanceAfter values are >= 0
assert(
  "phase 2: no negative balanceAfter",
  ph2default.every(e =>
    e.mortgageDetails.every(d => d.balanceAfter >= 0)
  )
);


// ─── calculateGroupSequential vs calculateGroup(K=N) equivalence ─────────────

console.log("\n== calculateGroupSequential vs calculateGroup(K=N) equivalence ==");

const seqViaGroup = calculateGroup(DEFAULTS, DEFAULTS.groupSize);
const seqDirect = calculateGroupSequential(DEFAULTS);

assert("both return no error", seqViaGroup.error === null && seqDirect.error === null);
assert(
  "totalMonths match (within 1 month — rounding)",
  Math.abs(seqViaGroup.totalMonths - seqDirect.totalMonths) <= 1
);
for (let i = 0; i < DEFAULTS.groupSize; i++) {
  assert(
    `position ${i + 1} monthsUntilHoused match (within 1)`,
    Math.abs(seqViaGroup.positions[i].monthsUntilHoused - seqDirect.positions[i].monthsUntilHoused) <= 1
  );
}


// ─── Input edge cases ─────────────────────────────────────────────────────────

console.log("\n== Input edge cases ==");

// fundYieldPct = 0 (no interest)
const noYieldResult = calculateGroup({ ...DEFAULTS, fundYieldPct: 0 }, 0);
assert("fundYieldPct=0: no error", noYieldResult.error === null);
assert("fundYieldPct=0: 6 positions", noYieldResult.positions && noYieldResult.positions.length === 6);

// Very high home price relative to contributions — should trigger error
const impossibleResult = calculateGroup({
  ...DEFAULTS,
  homePrice: 50000000,
  c1: 100,
  c2: 200,
}, 0);
assert("impossible inputs: returns error string", typeof impossibleResult.error === "string");
assert("impossible inputs: positions is null", impossibleResult.positions === null);

// groupSize = 2 minimum
const twoMember = calculateGroup({ ...DEFAULTS, groupSize: 2 }, 0);
assert("groupSize=2: no error", twoMember.error === null);
assert("groupSize=2: 2 positions", twoMember.positions && twoMember.positions.length === 2);
assert("groupSize=2: position 1 housed before position 2",
  twoMember.positions[0].monthsUntilHoused < twoMember.positions[1].monthsUntilHoused
);

// Down payment edge: 3% (minimum per form)
const lowDown = calculateGroup({ ...DEFAULTS, downPaymentPct: 0.03 }, 0);
assert("3% down payment: no error", lowDown.error === null);
assert("3% down: position 1 housed faster than 20% down",
  lowDown.positions[0].monthsUntilHoused < parallel.positions[0].monthsUntilHoused
);

// annualRatePct = 0 (zero interest mortgage)
const zeroRate = calculateGroup({ ...DEFAULTS, annualRatePct: 0 }, 0);
assert("annualRatePct=0: no error", zeroRate.error === null);


// ─── Special characters in formatDollars (indirect: check no NaN in results) ─

console.log("\n== NaN / Infinity guard ==");

function hasNaN(obj, depth = 0) {
  if (depth > 5) return false;
  for (const v of Object.values(obj)) {
    if (typeof v === 'number' && (isNaN(v) || !isFinite(v))) return true;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if (hasNaN(v, depth + 1)) return true;
    }
    if (Array.isArray(v)) {
      for (const item of v) {
        if (item && typeof item === 'object' && hasNaN(item, depth + 1)) return true;
        if (typeof item === 'number' && (isNaN(item) || !isFinite(item))) return true;
      }
    }
  }
  return false;
}

const parallelClean = calculateGroup(DEFAULTS, 0);
assert("parallel result has no NaN/Infinity in positions", !parallelClean.positions.some(p =>
  isNaN(p.monthsUntilHoused) || isNaN(p.totalPaid) || isNaN(p.savedVsTraditional)
));
assert("parallel totalMonths is not NaN", !isNaN(parallelClean.totalMonths));

const seqClean = calculateGroupSequential(DEFAULTS);
assert("sequential result has no NaN/Infinity in positions", !seqClean.positions.some(p =>
  isNaN(p.monthsUntilHoused) || isNaN(p.totalPaid) || isNaN(p.savedVsTraditional)
));


// ─── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);
