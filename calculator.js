// calculator.js
// Pure logic for the Homebuyers Union group simulation.
// No DOM references. Exposes calculateGroup and calculateGroupSequential.

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
//   1. Saving C1/month (with compound interest at fundYieldPct) until the
//      down payment is accumulated.
//   2. Paying the full mortgage over the loan term.
//
// Savings period uses the future-value-of-annuity formula:
//   FV = c1 × ((1+r)^n − 1) / r  →  n = log(1 + FV×r/c1) / log(1+r)
// When fundYieldPct is 0, this reduces to the simple n = ceil(downPayment/c1).
//
// totalPaid = contributions made during savings + total mortgage payments.
// Interest earned on savings is NOT counted as a cost — it reduces the number
// of months of contributions needed.
//
// Returns { monthsToSaveDown, totalPaid }.
function traditionalPath(homePrice, downPaymentPct, c1, annualRatePct, termYears, fundYieldPct = 0) {
  const downPayment  = homePrice * downPaymentPct;
  const loanPrincipal = homePrice - downPayment;
  const r            = fundYieldPct / 100 / 12;

  let monthsToSaveDown;
  if (r === 0) {
    monthsToSaveDown = Math.ceil(downPayment / c1);
  } else {
    // Solve for n: c1 × ((1+r)^n − 1) / r = downPayment
    // n = log(1 + downPayment × r / c1) / log(1 + r)
    monthsToSaveDown = Math.ceil(Math.log(1 + downPayment * r / c1) / Math.log(1 + r));
  }

  const payment           = monthlyMortgagePayment(loanPrincipal, annualRatePct, termYears);
  const totalMortgagePaid = payment * termYears * 12;

  return {
    monthsToSaveDown,
    totalPaid: monthsToSaveDown * c1 + totalMortgagePaid,
  };
}

// ─── Extra-payment helper ─────────────────────────────────────────────────────

// Applies an extra lump-sum payment toward the mortgage with the highest
// remaining balance. Returns { updatedBalances, targetIndex, actualAmount }.
function applyExtraPayment(balances, extraAmount) {
  const updated = balances.slice();
  let maxIdx = -1;
  let maxBal = 0;
  for (let i = 0; i < updated.length; i++) {
    if (updated[i] > maxBal) {
      maxBal = updated[i];
      maxIdx = i;
    }
  }
  let actualAmount = 0;
  if (maxIdx >= 0) {
    actualAmount = Math.min(extraAmount, updated[maxIdx]);
    updated[maxIdx] = Math.max(0, updated[maxIdx] - extraAmount);
  }
  return { updatedBalances: updated, targetIndex: maxIdx, actualAmount };
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
//   { positions, totalMonths, traditional, ledger, error }
//
//   positions: array of N objects { position, monthsUntilHoused, totalPaid, savedVsTraditional }
//   totalMonths: months until all mortgages are paid off and org dissolves
//   traditional: { monthsToSaveDown, totalPaid }
//   ledger: array of monthly records — one entry per month of simulation.
//     Each entry has the same shape regardless of phase (see below).
//   error: string if simulation could not complete, otherwise null
//
// ── Ledger entry shape ──────────────────────────────────────────────────────
//   month                  : 1-indexed month number
//   phase                  : 1 = buying houses, 2 = paying off mortgages
//
//   // Contributions collected this month
//   postHouseMembers       : members already in a house (paying C2)
//   preHouseMembers        : members not yet in a house (paying C1)
//   c2Income               : postHouseMembers × C2
//   c1Income               : preHouseMembers × C1
//   donorIncome            : monthlyDonorContrib
//   totalIncome            : c2Income + c1Income + donorIncome
//
//   // Fund obligations this month
//   activeMortgages        : number of mortgages being serviced
//   mortgagePaymentStd     : standard monthly payment per mortgage
//   totalObligations       : activeMortgages × mortgagePaymentStd
//
//   // Fund balance movement
//   netGrowth              : totalIncome - totalObligations
//   fundBalanceStart       : fund balance at the start of this month
//   fundBalanceAfterGrowth : fundBalanceStart + netGrowth (before any purchase)
//   fundBalanceEnd         : balance after any down payment is withdrawn
//
//   // House purchased this month? (phase 1 only, null in phase 2)
//   housePurchased: null | {
//     position             : which queue position received the house (1-indexed)
//     downPaymentWithdrawn : amount withdrawn from the fund
//   }
//
//   // Phase 2 only: per-mortgage breakdown (null in phase 1)
//   mortgageDetails: null | Array of {
//     position             : which queue position owns this mortgage
//     balanceBefore        : balance at the start of this month
//     interestCharged      : balanceBefore × (annualRatePct / 100 / 12)
//     principalFromPayment : standard payment minus interestCharged
//     extraPrincipal       : surplus payment applied to this mortgage (0 for most)
//     balanceAfter         : balance at end of this month
//   }
//   surplus                : income above required payments (phase 2), applied to highest balance

// sequentialCount controls a spectrum from pure-parallel (0) to pure-sequential (N):
//   0        → pure parallel: all homes bought with mortgages, serviced simultaneously.
//   1 to N-1 → hybrid: pay off the first K mortgages one-at-a-time before switching
//              to the parallel model for the remaining N-K homes.
//   N        → pure sequential: equivalent to calculateGroupSequential.
function calculateGroup(inputs, sequentialCount = 0) {
  const {
    homePrice,
    groupSize: N,
    c1,
    c2,
    downPaymentPct,
    annualRatePct,
    termYears = 30,
    monthlyDonorContrib = 0,
    fundYieldPct = 0,
  } = inputs;

  const downPaymentTarget  = homePrice * downPaymentPct;
  const loanPrincipal      = homePrice * (1 - downPaymentPct);
  const mortgagePaymentStd = monthlyMortgagePayment(loanPrincipal, annualRatePct, termYears);
  const r      = annualRatePct / 100 / 12;
  const fundR  = fundYieldPct  / 100 / 12;

  const MAX_MONTHS = 1200;

  const housedAtMonth      = new Array(N).fill(null);
  // mortgageStartMonth[k] is set only for positions bought in Phase B (parallel part).
  // Phase A mortgages are fully paid off before Phase B and don't carry over.
  const mortgageStartMonth = new Array(N).fill(null);
  const totalPaid          = new Array(N).fill(0);
  const ledger             = [];

  let month         = 0;
  let fundBalance   = 0;
  let housedCount   = 0;
  let mortgageCount = 0; // only Phase-B houses carry a live mortgage

  // ── Phase A: sequential buy+payoff for the first sequentialCount homes ────────
  //
  // For k = 0 to sequentialCount-1:
  //   1. Save the down payment (no mortgage obligations — prior ones are paid off).
  //   2. Buy house k with a standard mortgage.
  //   3. Pour ALL group income into paying off that one mortgage before saving next.
  // Any fund overshoot from saving reduces initial mortgage balance; any final
  // overpayment in the payoff month carries into the next saving phase.
  //
  // Ledger entries use phase:'saving'/'payoff' with houseIndex, matching
  // calculateGroupSequential's entry shape for compatible rendering.

  let carryover = 0;

  for (let k = 0; k < sequentialCount; k++) {
    // Saving sub-phase: k prior mortgages paid off; fund grows to downPaymentTarget.
    const savingC2   = k * c2;
    const savingC1   = (N - k) * c1;
    let   savingFund = carryover;
    carryover        = 0;

    while (savingFund < downPaymentTarget) {
      if (month >= MAX_MONTHS) {
        return { error: "Simulation exceeded 1200 months. Try different inputs.", positions: null, totalMonths: null, traditional: null, ledger: null };
      }
      for (let i = 0; i < N; i++) totalPaid[i] += i < k ? c2 : c1;
      const fundInterestEarned = savingFund * fundR;
      savingFund += savingC2 + savingC1 + monthlyDonorContrib + fundInterestEarned;
      month++;
      ledger.push({
        month,
        phase:          'saving',
        houseIndex:     k + 1,
        housedMembers:  k,
        waitingMembers: N - k,
        c2Income:       savingC2,
        c1Income:       savingC1,
        donorIncome:    monthlyDonorContrib,
        fundInterestEarned,
        totalIncome:    savingC2 + savingC1 + monthlyDonorContrib + fundInterestEarned,
        fundBalance:    savingFund,
        downPaymentTarget,
        housePurchased: savingFund >= downPaymentTarget,
        mortgageBalanceBefore: null, interestCharged: null,
        principalPaid: null, mortgageBalanceAfter: null, overpayment: null,
      });
    }

    savingFund -= downPaymentTarget;
    housedAtMonth[k] = month;

    // Payoff sub-phase: k+1 members housed; ALL income → this mortgage.
    const payoffC2     = (k + 1) * c2;
    const payoffC1     = (N - k - 1) * c1;
    const payoffIncome = payoffC2 + payoffC1 + monthlyDonorContrib;

    let mortgageBalance = Math.max(0, loanPrincipal - savingFund);
    if (savingFund > loanPrincipal) carryover = savingFund - loanPrincipal;

    while (mortgageBalance > 0) {
      if (month >= MAX_MONTHS) {
        return { error: "Simulation exceeded 1200 months. Try different inputs.", positions: null, totalMonths: null, traditional: null, ledger: null };
      }
      for (let i = 0; i < N; i++) totalPaid[i] += i <= k ? c2 : c1;

      const balanceBefore   = mortgageBalance;
      const interestCharged = balanceBefore * r;
      const totalOwed       = balanceBefore + interestCharged;
      const payment         = Math.min(payoffIncome, totalOwed);
      const principalPaid   = payment - interestCharged;
      const overpayment     = Math.max(0, payoffIncome - totalOwed);

      mortgageBalance = Math.max(0, balanceBefore - principalPaid);
      month++;
      if (overpayment > 0) carryover = overpayment;

      ledger.push({
        month,
        phase:          'payoff',
        houseIndex:     k + 1,
        housedMembers:  k + 1,
        waitingMembers: N - k - 1,
        c2Income:       payoffC2,
        c1Income:       payoffC1,
        donorIncome:    monthlyDonorContrib,
        totalIncome:    payoffIncome,
        fundBalance: null, downPaymentTarget: null, housePurchased: null,
        mortgageBalanceBefore: balanceBefore,
        interestCharged,
        principalPaid,
        mortgageBalanceAfter: mortgageBalance,
        overpayment,
      });
    }
  }

  // Phase B starts with carryover as the initial fund balance; sequentialCount
  // members are already housed with their mortgages fully paid off.
  fundBalance = carryover;
  housedCount = sequentialCount;

  // ── Phase B1: buy remaining (N − sequentialCount) homes with mortgages ──────

  while (housedCount < N) {
    if (month >= MAX_MONTHS) {
      return { error: "Simulation exceeded 1200 months. Try different inputs.", positions: null, totalMonths: null, traditional: null, ledger: null };
    }

    const postHouseMembers   = housedCount;
    const preHouseMembers    = N - housedCount;
    const c2Income           = postHouseMembers * c2;
    const c1Income           = preHouseMembers  * c1;
    const fundInterestEarned = fundBalance * fundR;
    const totalIncome        = c2Income + c1Income + monthlyDonorContrib + fundInterestEarned;
    const totalObligations   = mortgageCount * mortgagePaymentStd;
    const netGrowth          = totalIncome - totalObligations;
    const fundBalanceStart   = fundBalance;

    for (let k = 0; k < N; k++) {
      totalPaid[k] += housedAtMonth[k] !== null ? c2 : c1;
    }

    fundBalance += netGrowth;
    month++;

    const fundBalanceAfterGrowth = fundBalance;

    let housePurchased = null;
    if (fundBalance >= downPaymentTarget) {
      fundBalance -= downPaymentTarget;
      housedAtMonth[housedCount]      = month;
      mortgageStartMonth[housedCount] = month;
      housePurchased = {
        position:             housedCount + 1,
        outright:             false,
        downPaymentWithdrawn: downPaymentTarget,
      };
      housedCount++;
      mortgageCount++;
    }

    ledger.push({
      month,
      phase: 1,
      postHouseMembers,
      preHouseMembers,
      c2Income,
      c1Income,
      donorIncome:          monthlyDonorContrib,
      fundInterestEarned,
      totalIncome,
      activeMortgages:      mortgageCount,
      mortgagePaymentStd,
      totalObligations,
      netGrowth,
      fundBalanceStart,
      fundBalanceAfterGrowth,
      fundBalanceEnd:       fundBalance,
      fundTarget:           downPaymentTarget,
      housePurchased,
      mortgageDetails:      null,
      surplus:              0,
    });
  }

  // ── Phase 2: pay off mortgages ────────────────────────────────────────────

  // Only positions bought with a mortgage (mortgageStartMonth[k] !== null) have
  // a remaining balance; outright positions stay at zero.
  let balances = mortgageStartMonth.map(h =>
    h !== null ? Math.max(0, remainingBalance(loanPrincipal, annualRatePct, termYears, month - h)) : 0
  );

  // Apply any surplus fund balance carried over from phase 1 immediately.
  if (fundBalance > 0) {
    const result = applyExtraPayment(balances, fundBalance);
    balances = result.updatedBalances;
    fundBalance = 0;
  }

  while (balances.some(b => b > 0)) {
    if (month >= MAX_MONTHS) {
      return { error: "Simulation exceeded 1200 months. Try different inputs.", positions: null, totalMonths: null, traditional: null, ledger: null };
    }

    const activeMortgages  = balances.filter(b => b > 0).length;
    const totalIncome      = N * c2 + monthlyDonorContrib;
    const totalObligations = activeMortgages * mortgagePaymentStd;
    const surplus          = Math.max(0, totalIncome - totalObligations);

    for (let k = 0; k < N; k++) {
      totalPaid[k] += c2;
    }

    month++;

    // Apply standard amortization payment to each active mortgage.
    const mortgageDetails = balances.map((b, i) => {
      if (b <= 0) {
        return { position: i + 1, balanceBefore: 0, interestCharged: 0, principalFromPayment: 0, extraPrincipal: 0, balanceAfter: 0 };
      }
      const interestCharged      = b * r;
      const principalFromPayment = Math.min(mortgagePaymentStd - interestCharged, b);
      return {
        position: i + 1,
        balanceBefore: b,
        interestCharged,
        principalFromPayment,
        extraPrincipal: 0,
        balanceAfter: Math.max(0, b - principalFromPayment),
      };
    });

    balances = mortgageDetails.map(d => d.balanceAfter);

    // Apply any monthly surplus to the mortgage with the highest remaining balance.
    if (surplus > 0) {
      const result = applyExtraPayment(balances, surplus);
      if (result.targetIndex >= 0) {
        mortgageDetails[result.targetIndex].extraPrincipal = result.actualAmount;
        mortgageDetails[result.targetIndex].balanceAfter   = result.updatedBalances[result.targetIndex];
      }
      balances = result.updatedBalances;
    }

    ledger.push({
      month,
      phase: 2,
      postHouseMembers: N,
      preHouseMembers: 0,
      c2Income: N * c2,
      c1Income: 0,
      donorIncome: monthlyDonorContrib,
      fundInterestEarned: 0,
      totalIncome,
      activeMortgages,
      mortgagePaymentStd,
      totalObligations,
      netGrowth: surplus,
      fundBalanceStart: 0,
      fundBalanceAfterGrowth: 0,
      fundBalanceEnd: 0,
      fundTarget: null,
      housePurchased: null,
      mortgageDetails,
      surplus,
    });
  }

  const totalMonths = month;
  const trad        = traditionalPath(homePrice, downPaymentPct, c1, annualRatePct, termYears, fundYieldPct);

  const positions = housedAtMonth.map((housedMonth, k) => ({
    position: k + 1,
    monthsUntilHoused: housedMonth,
    totalPaid: Math.round(totalPaid[k]),
    savedVsTraditional: Math.round(trad.totalPaid - totalPaid[k]),
  }));

  return {
    positions,
    totalMonths,
    traditional: {
      monthsToSaveDown: trad.monthsToSaveDown,
      totalPaid: Math.round(trad.totalPaid),
    },
    ledger,
    sequentialCount,
    error: null,
  };
}

// ─── Sequential payoff simulation ────────────────────────────────────────────

// Simulates the Homebuyers Union group under the sequential payoff model:
// each mortgage is paid off in full before the fund begins saving for the
// next house. One cycle per member: save → buy → pay off → repeat.
//
// All monthly income during the payoff phase goes directly to the active
// mortgage (not split across multiple mortgages as in calculateGroup).
// Any overpayment in the final month of payoff carries into the next
// saving phase as a head start on the next down payment.
//
// Returns the same shape as calculateGroup:
//   { positions, totalMonths, traditional, ledger, error }
//
// ── Ledger entry shape (sequential) ────────────────────────────────────────
//   month         : 1-indexed month number
//   phase         : 'saving' or 'payoff'
//   houseIndex    : which house this cycle is for (1-indexed)
//
//   // Contributions collected this month (same regardless of phase)
//   housedMembers  : members already in a fully-paid-off home (paying C2)
//   waitingMembers : members not yet in a home (paying C1)
//   c2Income       : housedMembers × C2  [during payoff: includes the new occupant]
//   c1Income       : waitingMembers × C1
//   donorIncome    : monthlyDonorContrib
//   totalIncome    : c2Income + c1Income + donorIncome
//
//   // Saving-phase fields (null during payoff)
//   fundBalance    : cumulative fund balance after this month's income
//   downPaymentTarget : target the fund is saving toward
//   housePurchased : true on the month the fund hits the target
//
//   // Payoff-phase fields (null during saving)
//   mortgageBalanceBefore : balance at the start of this month
//   interestCharged       : mortgageBalanceBefore × (annualRatePct / 100 / 12)
//   principalPaid         : totalIncome − interestCharged (capped at remaining balance)
//   mortgageBalanceAfter  : balance at the end of this month
//   overpayment           : amount by which income exceeded what was owed (carried to next cycle)

function calculateGroupSequential(inputs) {
  const {
    homePrice,
    groupSize: N,
    c1,
    c2,
    downPaymentPct,
    annualRatePct,
    termYears = 30,
    monthlyDonorContrib = 0,
    fundYieldPct = 0,
  } = inputs;

  const downPaymentTarget = homePrice * downPaymentPct;
  const loanPrincipal     = homePrice * (1 - downPaymentPct);
  const r                 = annualRatePct / 100 / 12;
  const fundR             = fundYieldPct  / 100 / 12;
  const MAX_MONTHS        = 600;

  const housedAtMonth = new Array(N).fill(null);
  const totalPaid     = new Array(N).fill(0);
  const ledger        = [];

  let month     = 0;
  let carryover = 0; // overpayment from previous payoff cycle

  for (let k = 0; k < N; k++) {
    // ── Saving phase ────────────────────────────────────────────────────
    // k mortgages are now fully paid off.
    // Members 0..k-1 are housed (C2). Members k..N-1 are waiting (C1).
    const savingC2      = k * c2;
    const savingC1      = (N - k) * c1;
    const savingIncome  = savingC2 + savingC1 + monthlyDonorContrib;
    let   fundBalance   = carryover;
    carryover           = 0;

    while (fundBalance < downPaymentTarget) {
      if (month >= MAX_MONTHS) {
        return { error: "Simulation exceeded 600 months. Try different inputs.", positions: null, totalMonths: null, traditional: null, ledger: null };
      }

      for (let i = 0; i < N; i++) {
        totalPaid[i] += i < k ? c2 : c1;
      }
      const fundInterestEarned = fundBalance * fundR;
      fundBalance += savingIncome + fundInterestEarned;
      month++;

      ledger.push({
        month,
        phase: 'saving',
        houseIndex: k + 1,
        housedMembers: k,
        waitingMembers: N - k,
        c2Income: savingC2,
        c1Income: savingC1,
        donorIncome: monthlyDonorContrib,
        fundInterestEarned,
        totalIncome: savingIncome + fundInterestEarned,
        fundBalance,
        downPaymentTarget,
        housePurchased: fundBalance >= downPaymentTarget,
        mortgageBalanceBefore: null,
        interestCharged: null,
        principalPaid: null,
        mortgageBalanceAfter: null,
        overpayment: null,
      });
    }

    // Buy house k+1: withdraw down payment, member k moves in.
    fundBalance -= downPaymentTarget;
    housedAtMonth[k] = month;

    // ── Payoff phase ─────────────────────────────────────────────────────
    // k+1 members now housed (C2). Members k+1..N-1 still waiting (C1).
    // ALL monthly income goes toward paying off this mortgage.
    const payoffC2     = (k + 1) * c2;
    const payoffC1     = (N - k - 1) * c1;
    const payoffIncome = payoffC2 + payoffC1 + monthlyDonorContrib;

    // The saving-phase overshoot reduces the starting mortgage balance.
    // If the overshoot fully covers the loan principal (including the 100% down
    // payment case where loanPrincipal = 0), the excess carries to the next cycle.
    let mortgageBalance = Math.max(0, loanPrincipal - fundBalance);
    if (fundBalance > loanPrincipal) {
      carryover = fundBalance - loanPrincipal;
    }

    while (mortgageBalance > 0) {
      if (month >= MAX_MONTHS) {
        return { error: "Simulation exceeded 600 months. Try different inputs.", positions: null, totalMonths: null, traditional: null, ledger: null };
      }

      for (let i = 0; i < N; i++) {
        totalPaid[i] += i <= k ? c2 : c1;
      }

      const balanceBefore    = mortgageBalance;
      const interestCharged  = balanceBefore * r;
      const totalOwed        = balanceBefore + interestCharged;
      const payment          = Math.min(payoffIncome, totalOwed);
      const principalPaid    = payment - interestCharged;
      const overpayment      = Math.max(0, payoffIncome - totalOwed);

      mortgageBalance = Math.max(0, balanceBefore - principalPaid);
      month++;

      ledger.push({
        month,
        phase: 'payoff',
        houseIndex: k + 1,
        housedMembers: k + 1,
        waitingMembers: N - k - 1,
        c2Income: payoffC2,
        c1Income: payoffC1,
        donorIncome: monthlyDonorContrib,
        totalIncome: payoffIncome,
        fundBalance: null,
        downPaymentTarget: null,
        housePurchased: null,
        mortgageBalanceBefore: balanceBefore,
        interestCharged,
        principalPaid,
        mortgageBalanceAfter: mortgageBalance,
        overpayment,
      });

      if (overpayment > 0) {
        carryover = overpayment;
      }
    }
  }

  const totalMonths = month;
  const trad        = traditionalPath(homePrice, downPaymentPct, c1, annualRatePct, termYears, fundYieldPct);

  const positions = housedAtMonth.map((housedMonth, k) => ({
    position: k + 1,
    monthsUntilHoused: housedMonth,
    totalPaid: Math.round(totalPaid[k]),
    savedVsTraditional: Math.round(trad.totalPaid - totalPaid[k]),
  }));

  return {
    positions,
    totalMonths,
    traditional: {
      monthsToSaveDown: trad.monthsToSaveDown,
      totalPaid: Math.round(trad.totalPaid),
    },
    ledger,
    error: null,
  };
}

// ─── Export ───────────────────────────────────────────────────────────────────

// Support both CommonJS (for tests) and browser global.
if (typeof module !== "undefined" && module.exports) {
  module.exports = { calculateGroup, calculateGroupSequential, monthlyMortgagePayment, traditionalPath };
} else {
  window.calculateGroup           = calculateGroup;
  window.calculateGroupSequential = calculateGroupSequential;
}
// calculateGroup(inputs, K) covers all cases:
//   K = 0           → pure parallel  (default)
//   0 < K < N       → hybrid: first K homes paid off sequentially, rest parallel
//   K = N           → pure sequential (equivalent to calculateGroupSequential)
