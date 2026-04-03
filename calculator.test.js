// calculator.test.js
// Tests for calculator.js pure logic.
// Run with: node calculator.test.js

"use strict";

const { calculateGroup, monthlyMortgagePayment, traditionalPath } = require("./calculator.js");

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
    console.log(`  PASS: ${description} (got ${actual}, expected ~${expected})`);
    passed++;
  } else {
    console.error(`  FAIL: ${description} (got ${actual}, expected ~${expected}, tolerance ${tolerance})`);
    failed++;
  }
}

// ─── monthlyMortgagePayment ───────────────────────────────────────────────────

console.log("\nmontlyMortgagePayment:");

// Standard: $336,000 at 7% for 30 years ≈ $2,235.78/month
assertClose(
  "336k at 7% 30yr",
  monthlyMortgagePayment(336000, 7, 30),
  2235.78,
  0.5
);

// Zero rate: payment = principal / months
assertClose(
  "zero rate: 120k over 10 years = 1000/month",
  monthlyMortgagePayment(120000, 0, 10),
  1000,
  0.01
);

// Shorter term: same principal, higher payment
assert(
  "15yr term yields higher payment than 30yr",
  monthlyMortgagePayment(336000, 7, 15) > monthlyMortgagePayment(336000, 7, 30)
);

// ─── traditionalPath ──────────────────────────────────────────────────────────

console.log("\ntraditionalPath:");

// $420k home, 20% down, saving $667/month (c1), 7% rate, 30yr term.
// Down payment = $84k. Months to save = ceil(84000/667) = 126.
// Loan = $336k. Payment ~$2235.78/month. Total mortgage paid = 2235.78*360 ≈ $804,881.
// Total = 84000 + 804881 ≈ $888,881.
const trad = traditionalPath(420000, 0.20, 667, 7, 30);
assertClose("months to save down at 667/mo", trad.monthsToSaveDown, 126, 1);
assert("totalPaid > home price", trad.totalPaid > 420000);
assertClose("total paid on $420k home at 7% 30yr", trad.totalPaid, 888881, 5000);

// ─── calculateGroup — basic happy path ────────────────────────────────────────

console.log("\ncalculateGroup — group of 3:");

const result = calculateGroup({
  homePrice: 420000,
  groupSize: 3,
  c1: 667,
  c2: 2500,
  downPaymentPct: 0.20,
  annualRatePct: 7,
  termYears: 30,
  monthlyDonorContrib: 0,
});

assert("no error returned", result.error === null);
assert("returns 3 positions", result.positions && result.positions.length === 3);
assert("totalMonths is a positive number", result.totalMonths > 0);
assert("traditional path present", result.traditional !== null);

if (result.positions) {
  // Position 1 is housed first — smallest monthsUntilHoused.
  assert(
    "position 1 is housed before position 2",
    result.positions[0].monthsUntilHoused < result.positions[1].monthsUntilHoused
  );
  assert(
    "position 2 is housed before position 3",
    result.positions[1].monthsUntilHoused < result.positions[2].monthsUntilHoused
  );

  // Position 1 (housed earliest) pays the most total because they contribute
  // C2 for longer.
  assert(
    "position 1 pays more total than position 3",
    result.positions[0].totalPaid > result.positions[2].totalPaid
  );

  // Later positions always pay less than the traditional path — they wait
  // longer but contribute less overall. Position 1 may pay more depending
  // on inputs because they subsidize others for the full lifecycle.
  // In a group of 3 with these inputs, positions 2 and 3 save significantly.
  assert(
    "position 2 pays less than traditional path",
    result.positions[1].totalPaid < result.traditional.totalPaid
  );
  assert(
    "position 3 pays less than traditional path",
    result.positions[2].totalPaid < result.traditional.totalPaid
  );
  assert(
    "position 2 savedVsTraditional is positive",
    result.positions[1].savedVsTraditional > 0
  );
  assert(
    "position 3 savedVsTraditional is positive",
    result.positions[2].savedVsTraditional > 0
  );
  // savedVsTraditional correctly reflects totalPaid vs traditional.
  assert(
    "position 1 savedVsTraditional equals traditional minus totalPaid",
    result.positions[0].savedVsTraditional === result.traditional.totalPaid - result.positions[0].totalPaid
  );
}

// ─── calculateGroup — single member ───────────────────────────────────────────

console.log("\ncalculateGroup — single member:");

const solo = calculateGroup({
  homePrice: 300000,
  groupSize: 1,
  c1: 1000,
  c2: 1800,
  downPaymentPct: 0.20,
  annualRatePct: 6,
  termYears: 30,
  monthlyDonorContrib: 0,
});

assert("single member no error", solo.error === null);
assert("single member has 1 position", solo.positions && solo.positions.length === 1);
// Down payment = 60k. With 1 member at c1=1000 and no obligations, fund grows
// at 1000/mo. Months to house = ceil(60000/1000) = 60.
if (solo.positions) {
  assertClose("single member housed in ~60 months", solo.positions[0].monthsUntilHoused, 60, 2);
}

// ─── calculateGroup — donor contribution accelerates housing ──────────────────

console.log("\ncalculateGroup — donor contribution:");

const withDonor = calculateGroup({
  homePrice: 420000,
  groupSize: 3,
  c1: 667,
  c2: 2500,
  downPaymentPct: 0.20,
  annualRatePct: 7,
  termYears: 30,
  monthlyDonorContrib: 500,
});

const withoutDonor = calculateGroup({
  homePrice: 420000,
  groupSize: 3,
  c1: 667,
  c2: 2500,
  downPaymentPct: 0.20,
  annualRatePct: 7,
  termYears: 30,
  monthlyDonorContrib: 0,
});

assert("donor contribution no error", withDonor.error === null);
assert(
  "donor contribution reduces time to first house",
  withDonor.positions[0].monthsUntilHoused <= withoutDonor.positions[0].monthsUntilHoused
);
assert(
  "donor contribution reduces total months",
  withDonor.totalMonths <= withoutDonor.totalMonths
);

// ─── calculateGroup — month cap ───────────────────────────────────────────────

console.log("\ncalculateGroup — month cap error:");

// Pathological inputs: tiny c1, huge home price, zero c2 → fund never grows.
const capped = calculateGroup({
  homePrice: 10000000,
  groupSize: 5,
  c1: 1,
  c2: 1,
  downPaymentPct: 0.20,
  annualRatePct: 7,
  termYears: 30,
  monthlyDonorContrib: 0,
});

assert("capped simulation returns error string", typeof capped.error === "string" && capped.error.length > 0);
assert("capped simulation positions is null", capped.positions === null);

// ─── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);
