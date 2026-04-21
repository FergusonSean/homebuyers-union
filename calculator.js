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
function traditionalPath(homePrice, downPaymentPct, c1, annualRatePct, termYears, fundYieldPct = 0, housingCostsMonthly = 0, closingCosts = 0) {
  const downPayment  = homePrice * downPaymentPct;
  const savingTarget = downPayment + closingCosts;
  const loanPrincipal = homePrice - downPayment;
  const r            = fundYieldPct / 100 / 12;

  let monthsToSaveDown;
  if (r === 0) {
    monthsToSaveDown = Math.ceil(savingTarget / c1);
  } else {
    // Solve for n: c1 × ((1+r)^n − 1) / r = savingTarget
    // n = log(1 + savingTarget × r / c1) / log(1 + r)
    monthsToSaveDown = Math.ceil(Math.log(1 + savingTarget * r / c1) / Math.log(1 + r));
  }

  const payment           = monthlyMortgagePayment(loanPrincipal, annualRatePct, termYears);
  const totalMortgagePaid = payment * termYears * 12;
  const totalHousingCosts = housingCostsMonthly * termYears * 12;

  return {
    monthsToSaveDown,
    totalPaid: monthsToSaveDown * c1 + totalMortgagePaid + totalHousingCosts,
  };
}

// Same saving phase as traditionalPath (20% down at C1/month), but pays C2/month
// total during the mortgage phase. Housing costs come out of C2 first, so the
// actual mortgage payment is (C2 - housingCostsMonthly), finishing faster than
// the standard 30-year term. Total paid is exactly C2/month — no extra on top.
// Returns { monthsToSaveDown, monthsToPayoff, totalMonths, totalPaid }.
function traditionalAcceleratedPath(homePrice, c1, c2, annualRatePct, termYears, fundYieldPct = 0, housingCostsMonthly = 0, closingCosts = 0) {
  const downPayment      = homePrice * 0.20;
  const savingTarget     = downPayment + closingCosts;
  const loanPrincipal    = homePrice - downPayment;
  const r                = fundYieldPct / 100 / 12;
  const mr               = annualRatePct / 100 / 12;
  const mortgagePayment  = c2 - housingCostsMonthly;

  let monthsToSaveDown;
  if (r === 0) {
    monthsToSaveDown = Math.ceil(savingTarget / c1);
  } else {
    monthsToSaveDown = Math.ceil(Math.log(1 + savingTarget * r / c1) / Math.log(1 + r));
  }

  let monthsToPayoff;
  if (loanPrincipal <= 0) {
    monthsToPayoff = 0;
  } else if (mr === 0) {
    monthsToPayoff = Math.ceil(loanPrincipal / mortgagePayment);
  } else if (mortgagePayment <= mr * loanPrincipal) {
    // Mortgage payment doesn't cover first month's interest — fall back to standard term.
    monthsToPayoff = termYears * 12;
  } else {
    monthsToPayoff = Math.ceil(Math.log(mortgagePayment / (mortgagePayment - mr * loanPrincipal)) / Math.log(1 + mr));
  }

  return {
    monthsToSaveDown,
    monthsToPayoff,
    totalMonths: monthsToSaveDown + monthsToPayoff,
    totalPaid: monthsToSaveDown * c1 + monthsToPayoff * c2,
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
    propertyTaxPct = 0,
    insuranceMonthly = 0,
    closingCostsPct = 0,
    maintenancePct = 1,
    homePrices = Array.from({ length: N }, () => homePrice),
  } = inputs;

  const closingCostsList = homePrices.map(p => p * closingCostsPct / 100);
  const downPayments     = homePrices.map(p => p * downPaymentPct);
  const purchaseTargets  = homePrices.map((p, k) => downPayments[k] + closingCostsList[k]);
  const loanPrincipals   = homePrices.map((p, k) => p - downPayments[k]);
  const mortgagePayments = loanPrincipals.map(lp => monthlyMortgagePayment(lp, annualRatePct, termYears));
  const housingCostsList = homePrices.map(p => p * (propertyTaxPct / 100 + maintenancePct / 100) / 12 + insuranceMonthly);

  // Prefix sum: housingCostsCumulative[k] = total housing costs for k housed members.
  // Includes index N (all members housed) so payoff-phase access at k+1 is always valid.
  const housingCostsCumulative = Array.from({ length: N + 1 }, (_, k) =>
    housingCostsList.slice(0, k).reduce((a, b) => a + b, 0)
  );

  const r     = annualRatePct / 100 / 12;
  const fundR = fundYieldPct  / 100 / 12;

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
    // Saving sub-phase: k prior mortgages paid off; fund grows to purchaseTargets[k].
    const savingC2   = k * c2;
    const savingC1   = (N - k) * c1;
    let   savingFund = carryover;
    carryover        = 0;

    while (savingFund < purchaseTargets[k]) {
      if (month >= MAX_MONTHS) {
        return { error: "Simulation exceeded 1200 months. Try different inputs.", positions: null, totalMonths: null, traditional: null, ledger: null };
      }
      for (let i = 0; i < N; i++) totalPaid[i] += i < k ? c2 : c1;
      const fundInterestEarned = savingFund * fundR;
      savingFund += savingC2 + savingC1 + monthlyDonorContrib + fundInterestEarned - housingCostsCumulative[k];
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
        housingCosts:   housingCostsCumulative[k],
        fundBalance:    savingFund,
        downPaymentTarget: purchaseTargets[k],
        closingCosts:   closingCostsList[k],
        housePurchased: savingFund >= purchaseTargets[k],
        mortgageBalanceBefore: null, interestCharged: null,
        principalPaid: null, mortgageBalanceAfter: null, overpayment: null,
      });
    }

    savingFund -= purchaseTargets[k];
    housedAtMonth[k] = month;

    // Payoff sub-phase: k+1 members housed; ALL income → this mortgage.
    const payoffC2           = (k + 1) * c2;
    const payoffC1           = (N - k - 1) * c1;
    const payoffHousingCosts = housingCostsCumulative[k + 1];
    const payoffGrossIncome  = payoffC2 + payoffC1 + monthlyDonorContrib;
    const payoffIncome       = payoffGrossIncome - payoffHousingCosts;

    let mortgageBalance = Math.max(0, loanPrincipals[k] - savingFund);
    if (savingFund > loanPrincipals[k]) carryover = savingFund - loanPrincipals[k];

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
        totalIncome:    payoffGrossIncome,
        housingCosts:   payoffHousingCosts,
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

    // Sum mortgage payments only for Phase-B positions that have a live mortgage.
    const totalObligations = mortgageStartMonth.reduce((sum, startMonth, k) =>
      startMonth !== null ? sum + mortgagePayments[k] : sum, 0
    );

    // Sum housing costs for all currently housed members.
    const currentHousingCosts = housedAtMonth.reduce((sum, hMonth, k) =>
      hMonth !== null ? sum + housingCostsList[k] : sum, 0
    );

    const netGrowth        = totalIncome - totalObligations - currentHousingCosts;
    const fundBalanceStart = fundBalance;

    for (let k = 0; k < N; k++) {
      totalPaid[k] += housedAtMonth[k] !== null ? c2 : c1;
    }

    fundBalance += netGrowth;
    month++;

    const fundBalanceAfterGrowth = fundBalance;

    const activeMortgagesSnapshot = mortgageCount;

    let housePurchased = null;
    if (fundBalance >= purchaseTargets[housedCount]) {
      const idx = housedCount;
      fundBalance -= purchaseTargets[idx];
      housedAtMonth[idx]      = month;
      mortgageStartMonth[idx] = month;
      housePurchased = {
        position:             idx + 1,
        outright:             false,
        downPaymentWithdrawn: purchaseTargets[idx],
        closingCosts:         closingCostsList[idx],
        downPayment:          downPayments[idx],
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
      housingCosts:         currentHousingCosts,
      activeMortgages:      activeMortgagesSnapshot,
      mortgagePaymentStd:   null,
      totalObligations,
      netGrowth,
      fundBalanceStart,
      fundBalanceAfterGrowth,
      fundBalanceEnd:       fundBalance,
      fundTarget:           purchaseTargets[housedCount] ?? null,
      housePurchased,
      mortgageDetails:      null,
      surplus:              0,
    });
  }

  // ── Phase 2: pay off mortgages ────────────────────────────────────────────

  // Only positions bought with a mortgage (mortgageStartMonth[k] !== null) have
  // a remaining balance; outright positions stay at zero.
  let balances = mortgageStartMonth.map((h, k) =>
    h !== null ? Math.max(0, remainingBalance(loanPrincipals[k], annualRatePct, termYears, month - h)) : 0
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
    const totalAllHousingCosts = housingCostsList.reduce((a, b) => a + b, 0);

    // Sum the standard payment only for mortgages still carrying a positive balance.
    const totalObligations = balances.reduce((sum, b, k) =>
      b > 0 ? sum + mortgagePayments[k] : sum, 0
    );

    const surplus = Math.max(0, totalIncome - totalAllHousingCosts - totalObligations);

    for (let k = 0; k < N; k++) {
      totalPaid[k] += c2;
    }

    month++;

    // Apply per-mortgage standard amortization payment to each active mortgage.
    const mortgageDetails = balances.map((b, i) => {
      if (b <= 0) {
        return { position: i + 1, balanceBefore: 0, interestCharged: 0, principalFromPayment: 0, extraPrincipal: 0, balanceAfter: 0 };
      }
      const interestCharged      = b * r;
      const principalFromPayment = Math.min(mortgagePayments[i] - interestCharged, b);
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
      housingCosts: totalAllHousingCosts,
      activeMortgages,
      mortgagePaymentStd: null,
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

  // Compute per-position traditional comparisons using each member's own home price.
  const tradPerPosition = homePrices.map((p, k) => {
    const path  = traditionalPath(p, 0.20, c1, annualRatePct, termYears, fundYieldPct, housingCostsList[k], closingCostsList[k]);
    const accel = traditionalAcceleratedPath(p, c1, c2, annualRatePct, termYears, fundYieldPct, housingCostsList[k], closingCostsList[k]);
    return { path, accel };
  });

  const positions = housedAtMonth.map((housedMonth, k) => {
    const paid = Math.round(totalPaid[k]);
    return {
      position: k + 1,
      monthsUntilHoused: housedMonth,
      totalPaid: paid,
      savedVsTraditional: Math.round(tradPerPosition[k].path.totalPaid - paid),
    };
  });

  return {
    positions,
    totalMonths,
    traditional: tradPerPosition.map(t => ({
      monthsToSaveDown: t.path.monthsToSaveDown,
      totalPaid: Math.round(t.path.totalPaid),
      accelerated: {
        monthsToSaveDown: t.accel.monthsToSaveDown,
        monthsToPayoff: t.accel.monthsToPayoff,
        totalMonths: t.accel.totalMonths,
        totalPaid: Math.round(t.accel.totalPaid),
      },
    })),
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
    propertyTaxPct = 0,
    insuranceMonthly = 0,
    closingCostsPct = 0,
    maintenancePct = 1,
    homePrices = Array.from({ length: N }, () => homePrice),
  } = inputs;

  const closingCostsList = homePrices.map(p => p * closingCostsPct / 100);
  const downPayments     = homePrices.map(p => p * downPaymentPct);
  const purchaseTargets  = homePrices.map((p, k) => downPayments[k] + closingCostsList[k]);
  const loanPrincipals   = homePrices.map((p, k) => p - downPayments[k]);
  const housingCostsList = homePrices.map(p => p * (propertyTaxPct / 100 + maintenancePct / 100) / 12 + insuranceMonthly);

  // Prefix sum: housingCostsCumulative[k] = total housing costs for k housed members.
  // Includes index N (all members housed) so payoff-phase access at k+1 is always valid.
  const housingCostsCumulative = Array.from({ length: N + 1 }, (_, k) =>
    housingCostsList.slice(0, k).reduce((a, b) => a + b, 0)
  );

  const r          = annualRatePct / 100 / 12;
  const fundR      = fundYieldPct  / 100 / 12;
  const MAX_MONTHS = 600;

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

    while (fundBalance < purchaseTargets[k]) {
      if (month >= MAX_MONTHS) {
        return { error: "Simulation exceeded 600 months. Try different inputs.", positions: null, totalMonths: null, traditional: null, ledger: null };
      }

      for (let i = 0; i < N; i++) {
        totalPaid[i] += i < k ? c2 : c1;
      }
      const fundInterestEarned = fundBalance * fundR;
      fundBalance += savingIncome + fundInterestEarned - housingCostsCumulative[k];
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
        housingCosts: housingCostsCumulative[k],
        fundBalance,
        downPaymentTarget: purchaseTargets[k],
        closingCosts: closingCostsList[k],
        housePurchased: fundBalance >= purchaseTargets[k],
        mortgageBalanceBefore: null,
        interestCharged: null,
        principalPaid: null,
        mortgageBalanceAfter: null,
        overpayment: null,
      });
    }

    // Buy house k+1: withdraw purchase target (down payment + closing costs), member k moves in.
    fundBalance -= purchaseTargets[k];
    housedAtMonth[k] = month;

    // ── Payoff phase ─────────────────────────────────────────────────────
    // k+1 members now housed (C2). Members k+1..N-1 still waiting (C1).
    // ALL monthly income goes toward paying off this mortgage.
    const payoffC2           = (k + 1) * c2;
    const payoffC1           = (N - k - 1) * c1;
    const payoffHousingCosts = housingCostsCumulative[k + 1];
    const payoffGrossIncome  = payoffC2 + payoffC1 + monthlyDonorContrib;
    const payoffIncome       = payoffGrossIncome - payoffHousingCosts;

    // The saving-phase overshoot reduces the starting mortgage balance.
    // If the overshoot fully covers the loan principal (including the 100% down
    // payment case where loanPrincipal = 0), the excess carries to the next cycle.
    let mortgageBalance = Math.max(0, loanPrincipals[k] - fundBalance);
    if (fundBalance > loanPrincipals[k]) {
      carryover = fundBalance - loanPrincipals[k];
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
        totalIncome: payoffGrossIncome,
        housingCosts: payoffHousingCosts,
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

  // Compute per-position traditional comparisons using each member's own home price.
  const tradPerPosition = homePrices.map((p, k) => {
    const path  = traditionalPath(p, 0.20, c1, annualRatePct, termYears, fundYieldPct, housingCostsList[k], closingCostsList[k]);
    const accel = traditionalAcceleratedPath(p, c1, c2, annualRatePct, termYears, fundYieldPct, housingCostsList[k], closingCostsList[k]);
    return { path, accel };
  });

  const positions = housedAtMonth.map((housedMonth, k) => {
    const paid = Math.round(totalPaid[k]);
    return {
      position: k + 1,
      monthsUntilHoused: housedMonth,
      totalPaid: paid,
      savedVsTraditional: Math.round(tradPerPosition[k].path.totalPaid - paid),
    };
  });

  return {
    positions,
    totalMonths,
    traditional: tradPerPosition.map(t => ({
      monthsToSaveDown: t.path.monthsToSaveDown,
      totalPaid: Math.round(t.path.totalPaid),
      accelerated: {
        monthsToSaveDown: t.accel.monthsToSaveDown,
        monthsToPayoff: t.accel.monthsToPayoff,
        totalMonths: t.accel.totalMonths,
        totalPaid: Math.round(t.accel.totalPaid),
      },
    })),
    ledger,
    error: null,
  };
}

// ─── Traditional ledger helpers ──────────────────────────────────────────────

// Simulates traditionalPath month-by-month and returns a ledger array alongside
// the same summary scalars as traditionalPath.
// Returns { ledger, monthsToSaveDown, totalPaid }.
function traditionalPathLedger(homePrice, downPaymentPct, c1, annualRatePct, termYears, fundYieldPct = 0, housingCostsMonthly = 0, closingCosts = 0) {
  const downPayment    = homePrice * downPaymentPct;
  const savingTarget   = downPayment + closingCosts;
  const loanPrincipal  = homePrice - downPayment;
  const r              = fundYieldPct / 100 / 12;
  const mr             = annualRatePct / 100 / 12;
  const mortgagePayment = monthlyMortgagePayment(loanPrincipal, annualRatePct, termYears);

  const ledger = [];
  let month = 0;
  let fundBalance = 0;

  // Saving phase
  while (fundBalance < savingTarget) {
    month++;
    const interestEarned = fundBalance * r;
    fundBalance += c1 + interestEarned;
    const purchased = fundBalance >= savingTarget;
    ledger.push({ month, phase: 'saving', contribution: c1, interestEarned, fundBalance: Math.min(fundBalance, savingTarget), downPaymentTarget: savingTarget, purchased });
    if (purchased) break;
  }
  const monthsToSaveDown = month;

  // Mortgage phase
  let balance = loanPrincipal;
  const totalMortgageMonths = termYears * 12;
  for (let i = 0; i < totalMortgageMonths && balance > 0; i++) {
    month++;
    const interestCharged = balance * mr;
    const principalPaid   = Math.min(mortgagePayment - interestCharged, balance);
    const balanceBefore   = balance;
    balance               = Math.max(0, balance - principalPaid);
    ledger.push({ month, phase: 'mortgage', payment: mortgagePayment, interestCharged, principalPaid, balanceBefore, balanceAfter: balance, housingCostsMonthly });
  }

  const totalPaid = monthsToSaveDown * c1 + mortgagePayment * termYears * 12 + housingCostsMonthly * termYears * 12;
  return { ledger, monthsToSaveDown, totalPaid };
}

// Simulates traditionalAcceleratedPath month-by-month and returns a ledger array
// alongside the same summary scalars as traditionalAcceleratedPath.
// Returns { ledger, monthsToSaveDown, monthsToPayoff, totalMonths, totalPaid }.
function traditionalAcceleratedPathLedger(homePrice, c1, c2, annualRatePct, termYears, fundYieldPct = 0, housingCostsMonthly = 0, closingCosts = 0) {
  const downPayment    = homePrice * 0.20;
  const savingTarget   = downPayment + closingCosts;
  const loanPrincipal  = homePrice - downPayment;
  const r              = fundYieldPct / 100 / 12;
  const mr             = annualRatePct / 100 / 12;
  let mortgagePayment  = c2 - housingCostsMonthly;

  // Edge case: payment doesn't cover first month's interest — fall back to standard.
  if (mr > 0 && mortgagePayment <= mr * loanPrincipal) {
    mortgagePayment = monthlyMortgagePayment(loanPrincipal, annualRatePct, termYears);
  }

  const ledger = [];
  let month = 0;
  let fundBalance = 0;

  // Saving phase
  while (fundBalance < savingTarget) {
    month++;
    const interestEarned = fundBalance * r;
    fundBalance += c1 + interestEarned;
    const purchased = fundBalance >= savingTarget;
    ledger.push({ month, phase: 'saving', contribution: c1, interestEarned, fundBalance: Math.min(fundBalance, savingTarget), downPaymentTarget: savingTarget, purchased });
    if (purchased) break;
  }
  const monthsToSaveDown = month;

  // Mortgage phase
  let balance = loanPrincipal;
  let monthsToPayoff = 0;
  while (balance > 0) {
    month++;
    monthsToPayoff++;
    const interestCharged = balance * mr;
    const principalPaid   = Math.min(mortgagePayment - interestCharged, balance);
    const balanceBefore   = balance;
    balance               = Math.max(0, balance - principalPaid);
    ledger.push({ month, phase: 'mortgage', payment: c2, mortgagePayment, interestCharged, principalPaid, balanceBefore, balanceAfter: balance, housingCostsMonthly });
  }

  const totalPaid = monthsToSaveDown * c1 + monthsToPayoff * c2;
  return { ledger, monthsToSaveDown, monthsToPayoff, totalMonths: monthsToSaveDown + monthsToPayoff, totalPaid };
}

// ─── Dropout scenario simulation ─────────────────────────────────────────────

// Simulates the Homebuyers Union group with a single member dropout at a
// specified month, supporting any sequentialCount (0 through N).
//
// dropout: { memberIndex: number (0-based), month: number (1-indexed), salePrice: number }
//
// Pre-move-in dropout:
//   - Member stops contributing C1 immediately.
//   - Fund pays back exactly what that member contributed (their totalPaid[k]).
//   - Member's house position is permanently skipped.
//
// Post-move-in dropout:
//   - Member stops contributing C2 immediately.
//   - Fund services that mortgage for 2 more months (member contributes nothing).
//   - At dropout month + 2: fund receives (salePrice - remainingMortgageBalance).
//   - Mortgage is removed entirely after the sale.
//
// Returns the same shape as calculateGroup plus a `dropout` echo field.
function calculateGroupWithDropout(inputs, sequentialCount, dropout) {
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
    propertyTaxPct = 0,
    insuranceMonthly = 0,
    closingCostsPct = 0,
    maintenancePct = 1,
    homePrices = Array.from({ length: N }, () => homePrice),
  } = inputs;

  const { memberIndex: dropoutIdx, month: dropoutMonth, salePrice } = dropout;

  const closingCostsList = homePrices.map(p => p * closingCostsPct / 100);
  const downPayments     = homePrices.map(p => p * downPaymentPct);
  const purchaseTargets  = homePrices.map((p, k) => downPayments[k] + closingCostsList[k]);
  const loanPrincipals   = homePrices.map((p, k) => p - downPayments[k]);
  const mortgagePayments = loanPrincipals.map(lp => monthlyMortgagePayment(lp, annualRatePct, termYears));
  const housingCostsList = homePrices.map(p => p * (propertyTaxPct / 100 + maintenancePct / 100) / 12 + insuranceMonthly);

  // Prefix sum: housingCostsCumulative[k] = total housing costs for k housed members.
  const housingCostsCumulative = Array.from({ length: N + 1 }, (_, k) =>
    housingCostsList.slice(0, k).reduce((a, b) => a + b, 0)
  );

  const r     = annualRatePct / 100 / 12;
  const fundR = fundYieldPct  / 100 / 12;

  const MAX_MONTHS = 1200;

  // Track when each member was housed (1-indexed month), null if not yet housed.
  const housedAtMonth      = new Array(N).fill(null);
  // Track when each member's Phase-B mortgage started (for balance calculation).
  const mortgageStartMonth = new Array(N).fill(null);
  // Running total paid per member.
  const totalPaid          = new Array(N).fill(0);

  // contributing[k] = true while member k is actively paying into the fund.
  // Starts true for all; set false when the dropout event fires.
  const contributing = new Array(N).fill(true);

  // Dropout state — all flags start unset.
  let dropoutApplied             = false;
  let dropoutMemberExcluded      = false; // pre-move-in: member's position skipped forever
  let dropoutMortgagePendingSale = false; // post-move-in: mortgage awaiting sale
  let dropoutSaleMonth           = null;  // month proceeds arrive
  let dropoutType                = null;  // 'pre-move-in' | 'post-move-in'

  const ledger    = [];
  let month       = 0;
  let fundBalance = 0;

  // ── Phase A: sequential buy+payoff for the first sequentialCount homes ────────
  //
  // Mirrors calculateGroup's Phase A, but respects the contributing[] array and
  // applies the dropout event mid-loop.

  let carryover    = 0;
  let phaseAHouseIndexOfDropout = null; // which sequential position the dropout member occupies

  for (let k = 0; k < sequentialCount; k++) {
    // Members 0..k-1 are housed (paying C2). Members k..N-1 are waiting (paying C1).
    // housedMembers = indices 0..k-1; waitingMembers = indices k..N-1.

    // ── Saving sub-phase ─────────────────────────────────────────────────────
    let savingFund = carryover;
    carryover      = 0;

    // Returns true if we need to break out of the saving loop early because the
    // dropout member is at sequential position k and just dropped out pre-move-in.
    let skipThisK = false;

    // Housing costs for positions 0..k-1 that were actually housed and whose house
    // has not since been sold (a prior position may have been skipped due to pre-move-in
    // dropout, or sold due to post-move-in dropout).
    const savingPhaseCosts = housingCostsList.slice(0, k).reduce((a, hc, i) =>
      (housedAtMonth[i] !== null && !(i === dropoutIdx && dropoutMemberExcluded)) ? a + hc : a, 0);

    while (savingFund < purchaseTargets[k]) {
      if (month >= MAX_MONTHS) {
        return { error: "Simulation exceeded 1200 months. Try different inputs.", positions: null, totalMonths: null, traditional: null, ledger: null };
      }

      // Income from contributing members only; also track contributing counts for ledger display.
      let c2Income = 0, c1Income = 0, contributingHoused = 0, contributingWaiting = 0;
      for (let i = 0; i < k;     i++) { if (contributing[i]) { c2Income += c2; contributingHoused++;  } }
      for (let i = k; i < N;     i++) { if (contributing[i]) { c1Income += c1; contributingWaiting++; } }

      for (let i = 0; i < N; i++) {
        if (!contributing[i]) continue;
        totalPaid[i] += i < k ? c2 : c1;
      }

      const fundInterestEarned = savingFund * fundR;
      savingFund += c2Income + c1Income + monthlyDonorContrib + fundInterestEarned - savingPhaseCosts;
      month++;

      ledger.push({
        month,
        phase:          'saving',
        houseIndex:     k + 1,
        housedMembers:  contributingHoused,
        waitingMembers: contributingWaiting,
        c2Income,
        c1Income,
        donorIncome:    monthlyDonorContrib,
        fundInterestEarned,
        totalIncome:    c2Income + c1Income + monthlyDonorContrib + fundInterestEarned,
        housingCosts:   savingPhaseCosts,
        fundBalance:    savingFund,
        downPaymentTarget: purchaseTargets[k],
        closingCosts:   closingCostsList[k],
        housePurchased: savingFund >= purchaseTargets[k],
        mortgageBalanceBefore: null, interestCharged: null,
        principalPaid: null, mortgageBalanceAfter: null, overpayment: null,
      });

      // Apply dropout event if this is the dropout month.
      if (month === dropoutMonth && !dropoutApplied) {
        dropoutApplied = true;
        contributing[dropoutIdx] = false;

        if (housedAtMonth[dropoutIdx] === null) {
          // Pre-move-in dropout in Phase A.
          dropoutType           = 'pre-move-in';
          const c1Refund        = totalPaid[dropoutIdx];
          savingFund           -= c1Refund;
          dropoutMemberExcluded = true;

          ledger[ledger.length - 1].dropoutEvent = {
            memberIndex: dropoutIdx,
            type:        'pre-move-in',
            c1Refund,
            saleMonth:   null,
          };

          // If this position k IS the dropout member, stop saving for k and skip it.
          if (k === dropoutIdx) {
            skipThisK = true;
            break;
          }
        } else {
          // Post-move-in dropout in Phase A (dropout member was housed in an earlier cycle).
          dropoutType                = 'post-move-in';
          dropoutSaleMonth           = month + 2;
          dropoutMortgagePendingSale = true;
          phaseAHouseIndexOfDropout  = dropoutIdx;

          ledger[ledger.length - 1].dropoutEvent = {
            memberIndex: dropoutIdx,
            type:        'post-move-in',
            c1Refund:    null,
            saleMonth:   dropoutSaleMonth,
          };
        }
      }

      // Consume sale proceeds if the sale month arrives during the saving sub-phase.
      if (dropoutMortgagePendingSale && month === dropoutSaleMonth) {
        // Phase A mortgages don't have a mortgageStartMonth entry — they are tracked
        // by how many months into the payoff sub-phase they ran. At this point the
        // dropout occurred while an earlier cycle was in saving sub-phase, so
        // the dropout member's mortgage was being paid off in a prior payoff sub-phase.
        // We approximate the balance using elapsed months since they were housed.
        const monthsPaid   = month - housedAtMonth[dropoutIdx];
        const remainingBal = Math.max(0, remainingBalance(loanPrincipals[dropoutIdx], annualRatePct, termYears, monthsPaid));
        const proceeds     = salePrice - remainingBal;
        savingFund                += proceeds;
        dropoutMortgagePendingSale = false;
        dropoutMemberExcluded      = true;   // stop charging housing costs for sold house

        ledger[ledger.length - 1].saleEvent = {
          memberIndex:      dropoutIdx,
          salePrice,
          remainingBalance: remainingBal,
          proceeds,
        };
      }
    }

    // If the dropout member was at position k and dropped out pre-move-in, skip k.
    if (skipThisK) {
      // housedAtMonth[k] stays null; the sequential position k is abandoned.
      // savingFund already has the c1Refund deducted — pass it as carryover so the
      // next position doesn't lose the savings accumulated before the dropout.
      carryover = savingFund;
      continue;
    }

    savingFund -= purchaseTargets[k];
    housedAtMonth[k] = month;

    // ── Payoff sub-phase ─────────────────────────────────────────────────────
    let mortgageBalance = Math.max(0, loanPrincipals[k] - savingFund);
    if (savingFund > loanPrincipals[k]) carryover = savingFund - loanPrincipals[k];

    // Housing costs for positions 0..k that were actually housed and whose house has
    // not since been sold (earlier positions may have been skipped or sold due to dropout).
    const payoffPhaseCosts = housingCostsList.slice(0, k + 1).reduce((a, hc, i) =>
      (housedAtMonth[i] !== null && !(i === dropoutIdx && dropoutMemberExcluded)) ? a + hc : a, 0);

    while (mortgageBalance > 0) {
      if (month >= MAX_MONTHS) {
        return { error: "Simulation exceeded 1200 months. Try different inputs.", positions: null, totalMonths: null, traditional: null, ledger: null };
      }

      // Income from contributing members only; also track contributing counts for ledger display.
      // At this point k+1 positions are housed (0..k) and N-k-1 are waiting (k+1..N-1).
      let c2Income = 0, c1Income = 0, contributingHoused = 0, contributingWaiting = 0;
      for (let i = 0;     i <= k; i++) { if (contributing[i]) { c2Income += c2; contributingHoused++;  } }
      for (let i = k + 1; i < N;  i++) { if (contributing[i]) { c1Income += c1; contributingWaiting++; } }

      for (let i = 0; i < N; i++) {
        if (!contributing[i]) continue;
        totalPaid[i] += i <= k ? c2 : c1;
      }

      const grossIncome    = c2Income + c1Income + monthlyDonorContrib;
      const payoffIncome   = grossIncome - payoffPhaseCosts;

      const balanceBefore  = mortgageBalance;
      const interestCharged = balanceBefore * r;
      const totalOwed      = balanceBefore + interestCharged;
      const payment        = Math.min(payoffIncome, totalOwed);
      const principalPaid  = payment - interestCharged;
      const overpayment    = Math.max(0, payoffIncome - totalOwed);

      mortgageBalance = Math.max(0, balanceBefore - principalPaid);
      month++;
      if (overpayment > 0) carryover = overpayment;

      ledger.push({
        month,
        phase:          'payoff',
        houseIndex:     k + 1,
        housedMembers:  contributingHoused,
        waitingMembers: contributingWaiting,
        c2Income,
        c1Income,
        donorIncome:    monthlyDonorContrib,
        totalIncome:    grossIncome,
        housingCosts:   payoffPhaseCosts,
        fundBalance: null, downPaymentTarget: null, housePurchased: null,
        mortgageBalanceBefore: balanceBefore,
        interestCharged,
        principalPaid,
        mortgageBalanceAfter: mortgageBalance,
        overpayment,
      });

      // Apply dropout event if this is the dropout month.
      if (month === dropoutMonth && !dropoutApplied) {
        dropoutApplied = true;
        contributing[dropoutIdx] = false;

        if (housedAtMonth[dropoutIdx] === null) {
          // Pre-move-in dropout during payoff sub-phase.
          dropoutType           = 'pre-move-in';
          const c1Refund        = totalPaid[dropoutIdx];
          // Cannot reduce mortgageBalance directly — we will treat it as a fund-level
          // adjustment carried into Phase B. We record the refund in the ledger.
          dropoutMemberExcluded = true;
          carryover            -= c1Refund; // reduces what carries into next phase

          ledger[ledger.length - 1].dropoutEvent = {
            memberIndex: dropoutIdx,
            type:        'pre-move-in',
            c1Refund,
            saleMonth:   null,
          };
        } else {
          // Post-move-in dropout during payoff sub-phase.
          dropoutType                = 'post-move-in';
          dropoutSaleMonth           = month + 2;
          dropoutMortgagePendingSale = true;
          phaseAHouseIndexOfDropout  = dropoutIdx;

          ledger[ledger.length - 1].dropoutEvent = {
            memberIndex: dropoutIdx,
            type:        'post-move-in',
            c1Refund:    null,
            saleMonth:   dropoutSaleMonth,
          };
        }
      }

      // Consume sale proceeds if the sale month arrives during the payoff sub-phase.
      if (dropoutMortgagePendingSale && month === dropoutSaleMonth && phaseAHouseIndexOfDropout !== null) {
        dropoutMortgagePendingSale = false;

        let proceeds, remainingBal;
        if (k === dropoutIdx) {
          // The current payoff IS for the dropout member's house. The sale closes out
          // this mortgage immediately — use the actual tracked balance (which may differ
          // from the amortization schedule if income was insufficient to cover interest).
          remainingBal    = mortgageBalance;
          proceeds        = salePrice - remainingBal;
          mortgageBalance = 0;                        // terminates the payoff while loop
          carryover      += proceeds;                 // negative proceeds reduce the fund
        } else {
          // Sale of an earlier-cycle house — add net proceeds to carryover.
          const monthsPaid = month - housedAtMonth[dropoutIdx];
          remainingBal  = Math.max(0, remainingBalance(loanPrincipals[dropoutIdx], annualRatePct, termYears, monthsPaid));
          proceeds      = salePrice - remainingBal;
          carryover    += proceeds;
        }
        dropoutMemberExcluded = true;   // stop charging housing costs for sold house in subsequent cycles

        ledger[ledger.length - 1].saleEvent = {
          memberIndex:      dropoutIdx,
          salePrice,
          remainingBalance: remainingBal,
          proceeds,
        };
      }
    }
  }

  // Phase B starts with carryover as the initial fund balance; sequentialCount
  // members are already housed with their mortgages fully paid off.
  fundBalance = carryover;
  let housedCount   = sequentialCount;
  let mortgageCount = 0;

  // ── Phase B1: buy remaining (N − sequentialCount) homes with mortgages ──────

  // The index of the next member to be housed in Phase B (skipping dropout member
  // if they were excluded pre-move-in).
  function nextBHousingIndex() {
    for (let k = sequentialCount; k < N; k++) {
      if (housedAtMonth[k] !== null) continue;
      if (k === dropoutIdx && dropoutMemberExcluded) continue;
      return k;
    }
    return -1;
  }

  function allBMembersHoused() {
    for (let k = sequentialCount; k < N; k++) {
      if (k === dropoutIdx && dropoutMemberExcluded) continue;
      if (housedAtMonth[k] === null) return false;
    }
    return true;
  }

  while (!allBMembersHoused()) {
    if (month >= MAX_MONTHS) {
      return { error: "Simulation exceeded 1200 months. Try different inputs.", positions: null, totalMonths: null, traditional: null, ledger: null };
    }

    // Collect income: housed members pay C2, unhoused pay C1 — for contributing members only.
    let postHouseMembers = 0;
    let preHouseMembers  = 0;
    for (let k = 0; k < N; k++) {
      if (!contributing[k]) continue;
      if (housedAtMonth[k] !== null) {
        postHouseMembers++;
      } else {
        preHouseMembers++;
      }
    }

    const c2Income           = postHouseMembers * c2;
    const c1Income           = preHouseMembers  * c1;
    const fundInterestEarned = fundBalance * fundR;
    const totalIncome        = c2Income + c1Income + monthlyDonorContrib + fundInterestEarned;

    // Sum mortgage obligations: Phase-B mortgages only. Pending-sale mortgage still paid until sale.
    let totalObligations = 0;
    for (let k = 0; k < N; k++) {
      if (mortgageStartMonth[k] === null) continue;
      if (k === dropoutIdx && dropoutMortgagePendingSale && month >= dropoutSaleMonth) continue;
      totalObligations += mortgagePayments[k];
    }

    // Housing costs: currently housed members (dropout's house excluded after sale).
    let currentHousingCosts = 0;
    for (let k = 0; k < N; k++) {
      if (housedAtMonth[k] === null) continue;
      if (k === dropoutIdx && dropoutMortgagePendingSale && month >= dropoutSaleMonth) continue;
      if (k === dropoutIdx && dropoutMemberExcluded) continue;
      currentHousingCosts += housingCostsList[k];
    }

    const netGrowth        = totalIncome - totalObligations - currentHousingCosts;
    const fundBalanceStart = fundBalance;

    for (let k = 0; k < N; k++) {
      if (!contributing[k]) continue;
      totalPaid[k] += housedAtMonth[k] !== null ? c2 : c1;
    }

    fundBalance += netGrowth;
    month++;

    const fundBalanceAfterGrowth  = fundBalance;
    const activeMortgagesSnapshot = mortgageCount;

    // Apply dropout event if this is the dropout month.
    let dropoutEventThisMonth = null;
    if (month === dropoutMonth && !dropoutApplied) {
      dropoutApplied           = true;
      contributing[dropoutIdx] = false;

      if (housedAtMonth[dropoutIdx] === null) {
        // Pre-move-in dropout in Phase B.
        dropoutType           = 'pre-move-in';
        const c1Refund        = totalPaid[dropoutIdx];
        fundBalance          -= c1Refund;
        dropoutMemberExcluded = true;

        dropoutEventThisMonth = {
          memberIndex: dropoutIdx,
          type:        'pre-move-in',
          c1Refund,
          saleMonth:   null,
        };
      } else {
        // Post-move-in dropout in Phase B.
        dropoutType                = 'post-move-in';
        dropoutSaleMonth           = month + 2;
        dropoutMortgagePendingSale = true;

        dropoutEventThisMonth = {
          memberIndex: dropoutIdx,
          type:        'post-move-in',
          c1Refund:    null,
          saleMonth:   dropoutSaleMonth,
        };
      }
    }

    // Apply sale proceeds if this is the sale month.
    let saleEventThisMonth = null;
    if (dropoutMortgagePendingSale && month === dropoutSaleMonth) {
      const startMonth   = mortgageStartMonth[dropoutIdx] ?? housedAtMonth[dropoutIdx];
      const monthsPaid   = month - startMonth;
      const remainingBal = Math.max(0, remainingBalance(loanPrincipals[dropoutIdx], annualRatePct, termYears, monthsPaid));
      const proceeds     = salePrice - remainingBal;
      fundBalance       += proceeds;
      dropoutMortgagePendingSale = false;
      if (mortgageStartMonth[dropoutIdx] !== null) mortgageCount--;
      mortgageStartMonth[dropoutIdx] = null;   // stop charging obligations for sold house
      dropoutMemberExcluded          = true;   // stop charging housing costs for sold house

      saleEventThisMonth = {
        memberIndex:      dropoutIdx,
        salePrice,
        remainingBalance: remainingBal,
        proceeds,
      };
    }

    // Check if fund can buy the next Phase-B house.
    let housePurchased = null;
    const nextIdx = nextBHousingIndex();
    if (nextIdx >= 0 && fundBalance >= purchaseTargets[nextIdx]) {
      fundBalance                 -= purchaseTargets[nextIdx];
      housedAtMonth[nextIdx]       = month;
      mortgageStartMonth[nextIdx]  = month;
      housePurchased = {
        position:             nextIdx + 1,
        outright:             false,
        downPaymentWithdrawn: purchaseTargets[nextIdx],
        closingCosts:         closingCostsList[nextIdx],
        downPayment:          downPayments[nextIdx],
      };
      housedCount++;
      mortgageCount++;
    }

    const entry = {
      month,
      phase: 1,
      postHouseMembers,
      preHouseMembers,
      c2Income,
      c1Income,
      donorIncome:          monthlyDonorContrib,
      fundInterestEarned,
      totalIncome,
      housingCosts:         currentHousingCosts,
      activeMortgages:      activeMortgagesSnapshot,
      mortgagePaymentStd:   null,
      totalObligations,
      netGrowth,
      fundBalanceStart,
      fundBalanceAfterGrowth,
      fundBalanceEnd:       fundBalance,
      fundTarget:           nextBHousingIndex() >= 0 ? purchaseTargets[nextBHousingIndex()] : null,
      housePurchased,
      mortgageDetails:      null,
      surplus:              0,
    };

    if (dropoutEventThisMonth) entry.dropoutEvent = dropoutEventThisMonth;
    if (saleEventThisMonth)    entry.saleEvent    = saleEventThisMonth;

    ledger.push(entry);
  }

  // ── Phase B2: pay off all remaining active Phase-B mortgages ─────────────────

  // Compute starting balances for Phase-B mortgages. Dropout member's mortgage
  // is 0 (sold or never opened in Phase B).
  let balances = mortgageStartMonth.map((startMonth, k) => {
    if (startMonth === null) return 0;
    if (k === dropoutIdx) return 0;
    return Math.max(0, remainingBalance(loanPrincipals[k], annualRatePct, termYears, month - startMonth));
  });

  // Apply any surplus fund balance carried over from Phase B1.
  if (fundBalance > 0) {
    const result = applyExtraPayment(balances, fundBalance);
    balances    = result.updatedBalances;
    fundBalance = 0;
  }

  while (balances.some(b => b > 0)) {
    if (month >= MAX_MONTHS) {
      return { error: "Simulation exceeded 1200 months. Try different inputs.", positions: null, totalMonths: null, traditional: null, ledger: null };
    }

    const activeMortgages = balances.filter(b => b > 0).length;

    // Income: contributing members only (dropout excluded).
    const c2Income    = contributing.filter(c => c).length * c2;
    const totalIncome = c2Income + monthlyDonorContrib;

    // Housing costs: all housed members except the dropout.
    const totalHousingCosts = housingCostsList.reduce((sum, cost, k) => {
      if (!contributing[k] && k === dropoutIdx) return sum;
      if (housedAtMonth[k] === null) return sum;
      return sum + cost;
    }, 0);

    const totalObligations = balances.reduce((sum, b, k) =>
      b > 0 ? sum + mortgagePayments[k] : sum, 0
    );

    const surplus = Math.max(0, totalIncome - totalHousingCosts - totalObligations);

    for (let k = 0; k < N; k++) {
      if (!contributing[k]) continue;
      totalPaid[k] += c2;
    }

    month++;

    const mortgageDetails = balances.map((b, i) => {
      if (b <= 0) {
        return { position: i + 1, balanceBefore: 0, interestCharged: 0, principalFromPayment: 0, extraPrincipal: 0, balanceAfter: 0 };
      }
      const interestCharged      = b * r;
      const principalFromPayment = Math.min(mortgagePayments[i] - interestCharged, b);
      return {
        position:            i + 1,
        balanceBefore:       b,
        interestCharged,
        principalFromPayment,
        extraPrincipal:      0,
        balanceAfter:        Math.max(0, b - principalFromPayment),
      };
    });

    balances = mortgageDetails.map(d => d.balanceAfter);

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
      postHouseMembers: contributing.filter(c => c).length,
      preHouseMembers:  0,
      c2Income,
      c1Income:         0,
      donorIncome:      monthlyDonorContrib,
      fundInterestEarned: 0,
      totalIncome,
      housingCosts:     totalHousingCosts,
      activeMortgages,
      mortgagePaymentStd: null,
      totalObligations,
      netGrowth:        surplus,
      fundBalanceStart: 0,
      fundBalanceAfterGrowth: 0,
      fundBalanceEnd:   0,
      fundTarget:       null,
      housePurchased:   null,
      mortgageDetails,
      surplus,
    });
  }

  const totalMonths = month;

  const tradPerPosition = homePrices.map((p, k) => {
    const path  = traditionalPath(p, 0.20, c1, annualRatePct, termYears, fundYieldPct, housingCostsList[k], closingCostsList[k]);
    const accel = traditionalAcceleratedPath(p, c1, c2, annualRatePct, termYears, fundYieldPct, housingCostsList[k], closingCostsList[k]);
    return { path, accel };
  });

  const positions = housedAtMonth.map((housedMonth, k) => {
    const paid            = Math.round(totalPaid[k]);
    const isDropoutMember = k === dropoutIdx && dropoutApplied;
    return {
      position:           k + 1,
      monthsUntilHoused:  isDropoutMember ? null : housedMonth,
      totalPaid:          paid,
      savedVsTraditional: isDropoutMember ? null : Math.round(tradPerPosition[k].path.totalPaid - paid),
      dropoutExitMonth:   isDropoutMember ? dropoutMonth : null,
    };
  });

  return {
    positions,
    totalMonths,
    traditional: tradPerPosition.map(t => ({
      monthsToSaveDown: t.path.monthsToSaveDown,
      totalPaid:        Math.round(t.path.totalPaid),
      accelerated: {
        monthsToSaveDown: t.accel.monthsToSaveDown,
        monthsToPayoff:   t.accel.monthsToPayoff,
        totalMonths:      t.accel.totalMonths,
        totalPaid:        Math.round(t.accel.totalPaid),
      },
    })),
    ledger,
    sequentialCount,
    dropout,
    error: null,
  };
}

// ─── Export ───────────────────────────────────────────────────────────────────

// Support both CommonJS (for tests) and browser global.
if (typeof module !== "undefined" && module.exports) {
  module.exports = { calculateGroup, calculateGroupSequential, calculateGroupWithDropout, monthlyMortgagePayment, traditionalPath, traditionalAcceleratedPath, traditionalPathLedger, traditionalAcceleratedPathLedger };
} else {
  window.calculateGroup                      = calculateGroup;
  window.calculateGroupSequential            = calculateGroupSequential;
  window.calculateGroupWithDropout           = calculateGroupWithDropout;
  window.traditionalPathLedger               = traditionalPathLedger;
  window.traditionalAcceleratedPathLedger    = traditionalAcceleratedPathLedger;
}
// calculateGroup(inputs, K) covers all cases:
//   K = 0           → pure parallel  (default)
//   0 < K < N       → hybrid: first K homes paid off sequentially, rest parallel
//   K = N           → pure sequential (equivalent to calculateGroupSequential)
