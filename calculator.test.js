// calculator.test.js
// Tests for calculator.js pure logic.
// Run with: node calculator.test.js

"use strict";

const { calculateGroup, calculateGroupWithDropout, monthlyMortgagePayment, traditionalPath } = require("./calculator.js");

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
    result.positions[1].totalPaid < result.traditional[1].totalPaid
  );
  assert(
    "position 3 pays less than traditional path",
    result.positions[2].totalPaid < result.traditional[2].totalPaid
  );
  assert(
    "position 2 savedVsTraditional is positive",
    result.positions[1].savedVsTraditional > 0
  );
  assert(
    "position 3 savedVsTraditional is positive",
    result.positions[2].savedVsTraditional > 0
  );
  // savedVsTraditional correctly reflects totalPaid vs traditional (per position).
  assert(
    "position 1 savedVsTraditional equals traditional minus totalPaid",
    result.positions[0].savedVsTraditional === result.traditional[0].totalPaid - result.positions[0].totalPaid
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

// ─── calculateGroupWithDropout ────────────────────────────────────────────────

console.log("\ncalculateGroupWithDropout — pre-move-in dropout:");

// Member 2 (index 1) drops out at month 5, before they would be housed.
// With c1=2000 and groupSize=3, members get housed early enough that dropout at
// month 5 is definitely before member index 1 (position 2) is housed.
const preDropoutInputs = {
  homePrice:    300000,
  groupSize:    3,
  c1:           2000,
  c2:           3000,
  downPaymentPct: 0.20,
  annualRatePct:  7,
  termYears:      30,
  monthlyDonorContrib: 0,
};

// First run the baseline (no dropout) to confirm member index 1 is housed later than month 5.
const baselineResult = calculateGroup(preDropoutInputs, 0);
assert(
  "baseline: member 1 (index 1) is housed after month 5",
  baselineResult.positions[1].monthsUntilHoused > 5
);

const preDropout = calculateGroupWithDropout(preDropoutInputs, 0, {
  memberIndex: 1,
  month:       5,
  salePrice:   0, // ignored for pre-move-in
});

assert("pre-move-in dropout: no error", preDropout.error === null);
assert("pre-move-in dropout: returns 3 positions", preDropout.positions && preDropout.positions.length === 3);
assert(
  "pre-move-in dropout: dropped member (index 1) has null monthsUntilHoused",
  preDropout.positions[1].monthsUntilHoused === null
);
assert(
  "pre-move-in dropout: remaining members (0 and 2) are housed",
  preDropout.positions[0].monthsUntilHoused !== null &&
  preDropout.positions[2].monthsUntilHoused !== null
);

// The fund must have been reduced by exactly the c1Refund at dropout month.
// Verify via the ledger: the dropoutEvent entry should exist.
const preDropoutEvent = preDropout.ledger.find(e => e.dropoutEvent);
assert("pre-move-in dropout: ledger contains a dropoutEvent entry", preDropoutEvent !== null && preDropoutEvent !== undefined);
if (preDropoutEvent) {
  assert("pre-move-in dropout: dropoutEvent.type is pre-move-in",   preDropoutEvent.dropoutEvent.type === 'pre-move-in');
  assert("pre-move-in dropout: dropoutEvent.memberIndex is 1",       preDropoutEvent.dropoutEvent.memberIndex === 1);
  assert("pre-move-in dropout: dropoutEvent.c1Refund >= 0",          preDropoutEvent.dropoutEvent.c1Refund >= 0);
  // The refund should equal what the dropped member paid: 4 months (months 1-4) × c1=2000 = 8000
  // (they contribute in months 1-4, then dropout is applied after month 5 contributions but
  // the refund is based on totalPaid at that point: 5 months × 2000 = 10000)
  assertClose(
    "pre-move-in dropout: c1Refund equals 5 months of c1 (months 1-5 contributed before dropout applied)",
    preDropoutEvent.dropoutEvent.c1Refund,
    5 * preDropoutInputs.c1,
    preDropoutInputs.c1 // tolerance of one month (timing of when totalPaid is snapshot)
  );
  assert("pre-move-in dropout: dropoutEvent.saleMonth is null",      preDropoutEvent.dropoutEvent.saleMonth === null);
}

console.log("\ncalculateGroupWithDropout — post-move-in dropout:");

// Use a small group with high contributions so position 0 is housed quickly,
// then member 0 drops out after they are housed.
const postDropoutInputs = {
  homePrice:    200000,
  groupSize:    3,
  c1:           5000,
  c2:           4000,
  downPaymentPct: 0.20,
  annualRatePct:  6,
  termYears:      30,
  monthlyDonorContrib: 0,
};

// Baseline: find when member 0 is housed.
const baselinePost = calculateGroup(postDropoutInputs, 0);
const member0HousedMonth = baselinePost.positions[0].monthsUntilHoused;

assert("baseline: member 0 is housed before month 20", member0HousedMonth < 20);

// Dropout at member0HousedMonth + 2 (definitely post-move-in).
const postDropoutMonth = member0HousedMonth + 2;
const testSalePrice    = 180000; // below or near loan amount to get measurable sale event

const postDropout = calculateGroupWithDropout(postDropoutInputs, 0, {
  memberIndex: 0,
  month:       postDropoutMonth,
  salePrice:   testSalePrice,
});

assert("post-move-in dropout: no error", postDropout.error === null);
assert(
  "post-move-in dropout: dropped member (index 0) has null monthsUntilHoused",
  postDropout.positions[0].monthsUntilHoused === null
);
assert(
  "post-move-in dropout: remaining members (1 and 2) are housed",
  postDropout.positions[1].monthsUntilHoused !== null &&
  postDropout.positions[2].monthsUntilHoused !== null
);

// The ledger should contain both a dropoutEvent and a saleEvent.
const postDropoutEvent = postDropout.ledger.find(e => e.dropoutEvent);
const postSaleEvent    = postDropout.ledger.find(e => e.saleEvent);

assert("post-move-in dropout: ledger contains a dropoutEvent entry", postDropoutEvent !== null && postDropoutEvent !== undefined);
assert("post-move-in dropout: ledger contains a saleEvent entry",    postSaleEvent    !== null && postSaleEvent    !== undefined);

if (postDropoutEvent) {
  assert("post-move-in dropout: dropoutEvent.type is post-move-in", postDropoutEvent.dropoutEvent.type === 'post-move-in');
  assert("post-move-in dropout: dropoutEvent.saleMonth = dropoutMonth + 2",
    postDropoutEvent.dropoutEvent.saleMonth === postDropoutMonth + 2);
  assert("post-move-in dropout: dropoutEvent.c1Refund is null", postDropoutEvent.dropoutEvent.c1Refund === null);
}

if (postSaleEvent) {
  assert("post-move-in dropout: saleEvent.memberIndex is 0",     postSaleEvent.saleEvent.memberIndex === 0);
  assert("post-move-in dropout: saleEvent.salePrice matches input", postSaleEvent.saleEvent.salePrice === testSalePrice);
  // The saleEvent month should be dropoutMonth + 2.
  assert("post-move-in dropout: saleEvent occurs at dropout month + 2",
    postSaleEvent.month === postDropoutMonth + 2);
  // Sale model: the departing member owes the fund back for the full financial
  // responsibility it took on for their house — the fund's tracked cash outlay (A),
  // plus the remaining mortgage balance it must pay off (B), plus the sale-side
  // transaction costs (C) — less what the member paid in, plus a 1% fee. The buyer
  // pays cash; the member walks away with max(0, salePrice − amountOwed).
  //   responsibility = fundOutlay + remainingBalance + saleTxnCosts
  //   amountOwed     = responsibility − memberPaid + 0.01*memberPaid
  //   fundNet        = salePrice − memberWalkAway − saleTxnCosts − remainingBalance
  // Conservation: remainingBalance + saleTxnCosts + fundNet + memberWalkAway === salePrice.
  const se = postSaleEvent.saleEvent;
  assert("post-move-in dropout: saleEvent exposes fundOutlay",     typeof se.fundOutlay === 'number');
  assert("post-move-in dropout: saleEvent exposes saleTxnCosts",   typeof se.saleTxnCosts === 'number');
  assert("post-move-in dropout: saleEvent exposes responsibility", typeof se.responsibility === 'number');
  assert("post-move-in dropout: saleEvent exposes amountOwed",     typeof se.amountOwed === 'number');
  assert("post-move-in dropout: saleEvent exposes memberWalkAway", typeof se.memberWalkAway === 'number');
  assert("post-move-in dropout: saleEvent exposes fundNet",        typeof se.fundNet === 'number');
  assertClose("post-move-in dropout: responsibility === fundOutlay + remainingBalance + saleTxnCosts",
    se.responsibility, se.fundOutlay + se.remainingBalance + se.saleTxnCosts, 1e-6);
  assertClose("post-move-in dropout: amountOwed === responsibility − memberPaid + 0.01*memberPaid",
    se.amountOwed, se.responsibility - se.memberPaid + 0.01 * se.memberPaid, 1e-6);
  assertClose("post-move-in dropout: memberWalkAway === max(0, salePrice − amountOwed)",
    se.memberWalkAway, Math.max(0, se.salePrice - se.amountOwed), 1e-6);
  assert("post-move-in dropout: memberWalkAway is floored at 0", se.memberWalkAway >= 0);
  assertClose(
    "post-move-in dropout: conservation (remainingBalance + saleTxnCosts + fundNet + memberWalkAway === salePrice)",
    se.remainingBalance + se.saleTxnCosts + se.fundNet + se.memberWalkAway,
    se.salePrice,
    1e-6
  );
  assertClose(
    "post-move-in dropout: dropoutRecovery.amount equals rounded memberWalkAway",
    postDropout.dropoutRecovery.amount,
    Math.round(se.memberWalkAway),
    1e-6
  );
}

console.log("\ncalculateGroupWithDropout — post-move-in sale split: fair-price vs underwater:");

// Helper: pull the first saleEvent out of a dropout result.
function firstSaleEvent(result) {
  const entry = result.ledger.find(e => e.saleEvent);
  return entry ? entry.saleEvent : null;
}

// Fair-price case: a high sale price so the member walks away with a positive
// amount after paying the fund back for its responsibility (less what they paid,
// plus the fee).
const fairPriceResult = calculateGroupWithDropout(postDropoutInputs, 0, {
  memberIndex: 0,
  month:       postDropoutMonth,
  salePrice:   1000000,
});
const fairSale = firstSaleEvent(fairPriceResult);
assert("fair-price sale: no error", fairPriceResult.error === null);
assert("fair-price sale: saleEvent present", fairSale !== null);
if (fairSale) {
  assert("fair-price sale: member walks away with a positive amount", fairSale.memberWalkAway > 0);
  assert("fair-price sale: amount owed below sale price", fairSale.amountOwed < fairSale.salePrice);
  assertClose(
    "fair-price sale: responsibility === fundOutlay + remainingBalance + saleTxnCosts",
    fairSale.responsibility, fairSale.fundOutlay + fairSale.remainingBalance + fairSale.saleTxnCosts, 1e-6
  );
  assertClose(
    "fair-price sale: amountOwed === responsibility − memberPaid + 0.01*memberPaid",
    fairSale.amountOwed, fairSale.responsibility - fairSale.memberPaid + 0.01 * fairSale.memberPaid, 1e-6
  );
  assertClose(
    "fair-price sale: conservation (remainingBalance + saleTxnCosts + fundNet + memberWalkAway === salePrice)",
    fairSale.remainingBalance + fairSale.saleTxnCosts + fairSale.fundNet + fairSale.memberWalkAway,
    fairSale.salePrice,
    1e-6
  );
  assertClose(
    "fair-price sale: recovery.amount === round(memberWalkAway)",
    fairPriceResult.dropoutRecovery.amount,
    Math.round(fairSale.memberWalkAway),
    1e-6
  );
}

// Underwater case: a sale price far below what the member owes the fund, so the
// member walks away with 0 and the fund eats a loss (fundNet negative) after paying
// off the mortgage and sale costs out of the small proceeds.
const underwaterResult = calculateGroupWithDropout(postDropoutInputs, 0, {
  memberIndex: 0,
  month:       postDropoutMonth,
  salePrice:   1000,
});
const underwaterSale = firstSaleEvent(underwaterResult);
assert("underwater sale: no error", underwaterResult.error === null);
assert("underwater sale: saleEvent present", underwaterSale !== null);
if (underwaterSale) {
  assert("underwater sale: amount owed exceeds sale price", underwaterSale.amountOwed > underwaterSale.salePrice);
  assert("underwater sale: member walks away with exactly 0", underwaterSale.memberWalkAway === 0);
  assert("underwater sale: fundNet is negative (a loss)", underwaterSale.fundNet < 0);
  // With memberWalkAway 0: fundNet = salePrice − saleTxnCosts − remainingBalance.
  assertClose(
    "underwater sale: fundNet === salePrice − saleTxnCosts − remainingBalance",
    underwaterSale.fundNet,
    underwaterSale.salePrice - underwaterSale.saleTxnCosts - underwaterSale.remainingBalance,
    1e-6
  );
  assertClose(
    "underwater sale: conservation (remainingBalance + saleTxnCosts + fundNet + memberWalkAway === salePrice)",
    underwaterSale.remainingBalance + underwaterSale.saleTxnCosts + underwaterSale.fundNet + underwaterSale.memberWalkAway,
    underwaterSale.salePrice,
    1e-6
  );
  assert("underwater sale: recovery.amount is 0", underwaterResult.dropoutRecovery.amount === 0);
}

console.log("\ncalculateGroupWithDropout — dropout month beyond simulation end:");

// Dropout month set far beyond when the simulation will complete.
// The dropout event is never triggered; result should complete normally.
const lateDropout = calculateGroupWithDropout(
  { homePrice: 200000, groupSize: 2, c1: 5000, c2: 5000, downPaymentPct: 0.20, annualRatePct: 6, termYears: 30, monthlyDonorContrib: 0 },
  0,
  { memberIndex: 0, month: 9999, salePrice: 0 }
);

assert("late dropout: no error", lateDropout.error === null);
assert("late dropout: all members housed", lateDropout.positions.every(p => p.monthsUntilHoused !== null));
// No dropout event should appear in the ledger.
const hasDropoutEvent = lateDropout.ledger.some(e => e.dropoutEvent);
assert("late dropout: no dropoutEvent in ledger (dropout month never reached)", !hasDropoutEvent);

console.log("\ncalculateGroupWithDropout — sequentialCount=1 now supported:");

// sequentialCount > 0 is now fully supported. A dropout at month 5 in a hybrid
// K=1 group of 3 should complete without error.
const hybridDropout = calculateGroupWithDropout(
  { homePrice: 300000, groupSize: 3, c1: 1000, c2: 2500, downPaymentPct: 0.20, annualRatePct: 7, termYears: 30, monthlyDonorContrib: 0 },
  1,
  { memberIndex: 2, month: 5, salePrice: 0 }
);
assert("hybrid dropout K=1: no error (sequentialCount > 0 is supported)", hybridDropout.error === null);
assert("hybrid dropout K=1: returns 3 positions", hybridDropout.positions && hybridDropout.positions.length === 3);

// ─── calculateGroupWithDropout — sequentialCount > 0 ──────────────────────────

console.log("\ncalculateGroupWithDropout — pre-move-in dropout with sequentialCount=1:");

// Group of 3, K=1. Member 0 is the first sequential target.
// Member 0 drops out before being housed at month 3 — earlier than it would take
// to save the down payment (with c1=800 and homePrice=300000 at 20% down = $60,000,
// it takes many months, so month 3 is definitely pre-move-in).
const seqPreDropoutInputs = {
  homePrice:      300000,
  groupSize:      3,
  c1:             800,
  c2:             2500,
  downPaymentPct: 0.20,
  annualRatePct:  7,
  termYears:      30,
  monthlyDonorContrib: 0,
};

const seqPreDropout = calculateGroupWithDropout(seqPreDropoutInputs, 1, {
  memberIndex: 0,
  month:       3,
  salePrice:   0, // ignored for pre-move-in
});

assert("seq pre-move-in dropout K=1: no error", seqPreDropout.error === null);
assert("seq pre-move-in dropout K=1: returns 3 positions", seqPreDropout.positions && seqPreDropout.positions.length === 3);
assert(
  "seq pre-move-in dropout K=1: dropped member (index 0) has null monthsUntilHoused",
  seqPreDropout.positions[0].monthsUntilHoused === null
);
assert(
  "seq pre-move-in dropout K=1: remaining members (1 and 2) are housed",
  seqPreDropout.positions[1].monthsUntilHoused !== null &&
  seqPreDropout.positions[2].monthsUntilHoused !== null
);
// The ledger must contain a dropoutEvent entry of type pre-move-in.
const seqPreEvent = seqPreDropout.ledger.find(e => e.dropoutEvent);
assert("seq pre-move-in dropout K=1: ledger contains a dropoutEvent entry", !!seqPreEvent);
if (seqPreEvent) {
  assert("seq pre-move-in dropout K=1: type is pre-move-in", seqPreEvent.dropoutEvent.type === 'pre-move-in');
  assert("seq pre-move-in dropout K=1: c1Refund >= 0", seqPreEvent.dropoutEvent.c1Refund >= 0);
  // Refund should equal 3 months of c1 contributions (months 1-3).
  assertClose(
    "seq pre-move-in dropout K=1: c1Refund equals 3 months of c1",
    seqPreEvent.dropoutEvent.c1Refund,
    3 * seqPreDropoutInputs.c1,
    seqPreDropoutInputs.c1
  );
}

console.log("\ncalculateGroupWithDropout — post-move-in dropout with sequentialCount=2:");

// Group of 4, K=2. With high contributions, member 0 is housed quickly in the
// first sequential cycle (saving phase). Member 0 then drops out after being housed.
const seqPostDropoutInputs = {
  homePrice:      200000,
  groupSize:      4,
  c1:             8000,
  c2:             5000,
  downPaymentPct: 0.20,
  annualRatePct:  6,
  termYears:      30,
  monthlyDonorContrib: 0,
};

// Find when member 0 is housed under the baseline K=2 model.
const baselineK2 = calculateGroupWithDropout(seqPostDropoutInputs, 2, {
  memberIndex: 3,
  month:       9999,
  salePrice:   0,
});
assert("seq post-move-in dropout K=2: baseline completes", baselineK2.error === null);

const member0HousedInK2 = baselineK2.positions[0].monthsUntilHoused;
assert("seq post-move-in dropout K=2: member 0 is housed", member0HousedInK2 !== null);

// Dropout at member0HousedInK2 + 2 (definitely post-move-in).
const seqPostDropout = calculateGroupWithDropout(seqPostDropoutInputs, 2, {
  memberIndex: 0,
  month:       member0HousedInK2 + 2,
  salePrice:   180000,
});

assert("seq post-move-in dropout K=2: no error", seqPostDropout.error === null);
assert(
  "seq post-move-in dropout K=2: dropped member (index 0) has null monthsUntilHoused",
  seqPostDropout.positions[0].monthsUntilHoused === null
);
assert(
  "seq post-move-in dropout K=2: remaining members (1, 2, 3) are housed",
  seqPostDropout.positions[1].monthsUntilHoused !== null &&
  seqPostDropout.positions[2].monthsUntilHoused !== null &&
  seqPostDropout.positions[3].monthsUntilHoused !== null
);
const seqPostEvent = seqPostDropout.ledger.find(e => e.dropoutEvent);
assert("seq post-move-in dropout K=2: ledger contains a dropoutEvent entry", !!seqPostEvent);
if (seqPostEvent) {
  assert("seq post-move-in dropout K=2: type is post-move-in", seqPostEvent.dropoutEvent.type === 'post-move-in');
  assert("seq post-move-in dropout K=2: saleMonth = dropoutMonth + 2",
    seqPostEvent.dropoutEvent.saleMonth === member0HousedInK2 + 2 + 2);
}

// ─── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);
