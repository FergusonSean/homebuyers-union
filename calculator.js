// calculator.js
// Pure logic for the Homebuyers Union group simulation.
// No DOM references. Exposes a single calculateGroup(inputs) function.

"use strict";

// ─── Mortgage helpers ────────────────────────────────────────────────────────

// Returns the monthly payment for a fully-amortizing fixed-rate mortgage.
// principal: loan amount
// annualRatePct: annual interest rate as a percentage (e.g. 7 for 7%)
// termYears: loan term in years
function monthlyMortgagePayment(principal, annualRatePct, termYears) {
  const r = annualRatePct / 100 / 12;
  const n = termYears * 12;
  if (r === 0) {
    return principal / n;
  }
  return principal * (r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
}

// Returns the outstanding loan balance after `monthsPaid` payments.
function remainingBalance(principal, annualRatePct, termYears, monthsPaid) {
  const r = annualRatePct / 100 / 12;
  const n = termYears * 12;
  if (r === 0) {
    return principal * (1 - monthsPaid / n);
  }
  const payment = monthlyMortgagePayment(principal, annualRatePct, termYears);
  return principal * Math.pow(1 + r, monthsPaid) - payment * (Math.pow(1 + r, monthsPaid) - 1) / r;
}

// ─── Traditional path comparison ─────────────────────────────────────────────

// Computes total cost of the traditional homeownership path:
//   1. Saving C1/month until you accumulate the down payment.
//   2. Paying the full mortgage over the loan term.
// Returns { monthsToSaveDown, totalPaid }.
function traditionalPath(homePrice, downPaymentPct, c1, annualRatePct, termYears) {
  const downPayment = homePrice * downPaymentPct;
  const monthsToSaveDown = Math.ceil(downPayment / c1);
  const loanPrincipal = homePrice - downPayment;
  const payment = monthlyMortgagePayment(loanPrincipal, annualRatePct, termYears);
  const totalMortgagePaid = payment * termYears * 12;
  return {
    monthsToSaveDown,
    totalPaid: downPayment + totalMortgagePaid,
  };
}

// ─── Group simulation ─────────────────────────────────────────────────────────

// Simulates the full lifecycle of a Homebuyers Union group.
//
// inputs:
//   homePrice           – purchase price of each home ($)
//   groupSize           – number of members (N)
//   c1                  – monthly pre-house contribution per member ($)
//   c2                  – monthly post-house contribution per member ($)
//   downPaymentPct      – down payment as a decimal (e.g. 0.20 for 20%)
//   annualRatePct       – mortgage interest rate as a percentage (e.g. 7)
//   termYears           – mortgage term in years (default 30)
//   monthlyDonorContrib – monthly donor contribution to the whole fund ($, default 0)
//
// Returns:
//   { positions, totalMonths, traditional, error }
//   positions: array of N objects { position, monthsUntilHoused, totalPaid, savedVsTraditional }
//   totalMonths: months until all mortgages are paid off and org dissolves
//   traditional: { monthsToSaveDown, totalPaid }
//   error: string if simulation could not complete, otherwise null

function calculateGroup(inputs) {
  const {
    homePrice,
    groupSize: N,
    c1,
    c2,
    downPaymentPct,
    annualRatePct,
    termYears = 30,
    monthlyDonorContrib = 0,
  } = inputs;

  // Validate that the fund can make forward progress. If post-house income
  // minus one mortgage payment is non-positive, the fund will stall once
  // members are housed. We allow simulation to proceed but will catch the
  // 600-month cap.
  const downPaymentTarget = homePrice * downPaymentPct;
  const loanPrincipal = homePrice * (1 - downPaymentPct);
  const mortgagePayment = monthlyMortgagePayment(loanPrincipal, annualRatePct, termYears);

  const MAX_MONTHS = 600;

  // Track per-position state.
  // housedAtMonth[k] = month at which position k+1 was housed (0-indexed positions).
  const housedAtMonth = new Array(N).fill(null);
  // totalPaid[k] = running total paid by member at position k+1.
  const totalPaid = new Array(N).fill(0);

  let month = 0;
  let fundBalance = 0;
  let housedCount = 0; // number of members already in a house

  // Phase 1: buy houses one by one until all N are bought.
  while (housedCount < N) {
    if (month >= MAX_MONTHS) {
      return { error: "Simulation exceeded 600 months. Try different inputs.", positions: null, totalMonths: null, traditional: null };
    }

    // Monthly fund income at this stage.
    const postHouseMembers = housedCount;
    const preHouseMembers = N - housedCount;
    const fundIncome = postHouseMembers * c2 + preHouseMembers * c1 + monthlyDonorContrib;

    // Monthly fund obligations: one mortgage payment per house already bought.
    const fundObligations = housedCount * mortgagePayment;

    const netGrowth = fundIncome - fundObligations;
    fundBalance += netGrowth;

    // Record what each member paid this month.
    for (let k = 0; k < N; k++) {
      if (housedAtMonth[k] !== null) {
        // Already housed — paying C2.
        totalPaid[k] += c2;
      } else {
        // Not yet housed — paying C1.
        totalPaid[k] += c1;
      }
    }

    month++;

    // After each month, check whether the fund can now buy the next house.
    // The fund needs to have accumulated >= the down payment target.
    if (fundBalance >= downPaymentTarget) {
      // Buy the next house. The down payment comes out of the fund.
      fundBalance -= downPaymentTarget;
      housedAtMonth[housedCount] = month;
      housedCount++;
    }
  }

  // Phase 2: all members are housed. The fund collects C2 from all members
  // and uses it to pay down mortgages. Track remaining balances for each
  // mortgage (each mortgage started at loanPrincipal on the month its house
  // was bought).
  //
  // We simulate month by month: each month, collect N*c2 + donor, pay all
  // active mortgages, accumulate any surplus, and apply surplus to reduce
  // balances. We continue until all balances are zero.
  //
  // For simplicity (and in keeping with the spec: "fund continues collecting
  // C2 to accelerate mortgage payoffs"), we model this as: each month the
  // fund receives N*c2 + donor, and the total available is distributed to pay
  // mortgages. The standard monthly payment per mortgage is mortgagePayment.
  // Any surplus above standard payments is applied to reduce the principal
  // of the mortgage with the highest balance (greedy payoff).

  // Rebuild mortgage age array: at the start of phase 2, mortgage k has been
  // running for (month - housedAtMonth[k]) months.
  let mortgageAges = housedAtMonth.map(h => month - h); // months already paid

  // We'll work with remaining balances.
  let balances = mortgageAges.map(age => {
    const bal = remainingBalance(loanPrincipal, annualRatePct, termYears, age);
    return Math.max(0, bal);
  });

  // Carry over any surplus fund balance from phase 1 into phase 2.
  let phase2FundSurplus = fundBalance;

  const phase2StartMonth = month;

  // Apply any surplus from phase 1 immediately to highest balance.
  if (phase2FundSurplus > 0) {
    balances = applyExtraPayment(balances, phase2FundSurplus);
    phase2FundSurplus = 0;
  }

  while (balances.some(b => b > 0)) {
    if (month >= MAX_MONTHS) {
      return { error: "Simulation exceeded 600 months. Try different inputs.", positions: null, totalMonths: null, traditional: null };
    }

    const monthlyIncome = N * c2 + monthlyDonorContrib;
    const requiredPayments = balances.reduce((sum, b) => sum + (b > 0 ? mortgagePayment : 0), 0);

    // Record what each member paid this month (all paying C2 in phase 2).
    for (let k = 0; k < N; k++) {
      totalPaid[k] += c2;
    }

    month++;

    if (monthlyIncome >= requiredPayments) {
      // Pay all standard mortgage payments.
      balances = balances.map((b, i) => {
        if (b <= 0) return 0;
        const r = annualRatePct / 100 / 12;
        const interest = b * r;
        const principalPaid = mortgagePayment - interest;
        return Math.max(0, b - principalPaid);
      });

      // Apply any surplus to accelerate payoff.
      const surplus = monthlyIncome - requiredPayments;
      if (surplus > 0) {
        balances = applyExtraPayment(balances, surplus);
      }
    } else {
      // Income is less than required — pay proportionally (degenerate case).
      // This should not happen with reasonable inputs where c2 > mortgagePayment/N.
      const ratio = monthlyIncome / requiredPayments;
      balances = balances.map((b, i) => {
        if (b <= 0) return 0;
        const r = annualRatePct / 100 / 12;
        const interest = b * r;
        const principalPaid = (mortgagePayment - interest) * ratio;
        return Math.max(0, b - principalPaid);
      });
    }
  }

  const totalMonths = month;

  // Build per-position results.
  const trad = traditionalPath(homePrice, downPaymentPct, c1, annualRatePct, termYears);

  const positions = housedAtMonth.map((housedMonth, k) => {
    return {
      position: k + 1,
      monthsUntilHoused: housedMonth,
      totalPaid: Math.round(totalPaid[k]),
      savedVsTraditional: Math.round(trad.totalPaid - totalPaid[k]),
    };
  });

  return {
    positions,
    totalMonths,
    traditional: {
      monthsToSaveDown: trad.monthsToSaveDown,
      totalPaid: Math.round(trad.totalPaid),
    },
    error: null,
  };
}

// Applies an extra lump-sum payment toward the mortgage with the highest
// remaining balance. Returns an updated copy of the balances array.
function applyExtraPayment(balances, extraAmount) {
  const updated = balances.slice();
  // Find the index with the highest balance.
  let maxIdx = -1;
  let maxBal = 0;
  for (let i = 0; i < updated.length; i++) {
    if (updated[i] > maxBal) {
      maxBal = updated[i];
      maxIdx = i;
    }
  }
  if (maxIdx >= 0) {
    updated[maxIdx] = Math.max(0, updated[maxIdx] - extraAmount);
  }
  return updated;
}

// ─── Export ───────────────────────────────────────────────────────────────────

// Support both CommonJS (for tests) and browser global.
if (typeof module !== "undefined" && module.exports) {
  module.exports = { calculateGroup, monthlyMortgagePayment, traditionalPath };
} else {
  window.calculateGroup = calculateGroup;
}
