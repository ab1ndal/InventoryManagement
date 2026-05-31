// src/utility/supplierBalance.js

export function computeRunningLedger(txns, openingBalance, openingBalanceDate = null) {
  const rows = [];
  let running = Number(openingBalance) || 0;

  rows.push({ type: "opening", running, transaction_id: "opening", opening_balance_date: openingBalanceDate });

  for (const t of txns) {
    const amt = Number(t.amount);
    running += t.type === "bill" ? amt : -amt;
    rows.push({ ...t, running });
  }

  return rows;
}

export function computeSummary(txns, openingBalance) {
  let totalBilled = 0;
  let totalPaid = 0;

  for (const t of txns) {
    const amt = Number(t.amount);
    if (t.type === "bill") totalBilled += amt;
    else totalPaid += amt;
  }

  const netBalance = Number(openingBalance) + totalBilled - totalPaid;
  return { totalBilled, totalPaid, netBalance };
}
