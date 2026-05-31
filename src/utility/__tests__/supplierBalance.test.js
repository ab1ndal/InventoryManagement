import { computeRunningLedger, computeSummary } from "../supplierBalance";

describe("computeRunningLedger", () => {
  it("starts with opening balance", () => {
    const rows = computeRunningLedger([], 500);
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe("opening");
    expect(rows[0].running).toBe(500);
  });

  it("bills add to balance", () => {
    const txns = [{ transaction_id: 1, type: "bill", amount: "1000", transaction_date: "2026-01-01", notes: null }];
    const rows = computeRunningLedger(txns, 0);
    expect(rows[1].running).toBe(1000);
  });

  it("payments reduce balance", () => {
    const txns = [
      { transaction_id: 1, type: "bill",    amount: "1000", transaction_date: "2026-01-01", notes: null },
      { transaction_id: 2, type: "payment", amount: "400",  transaction_date: "2026-01-02", notes: null },
    ];
    const rows = computeRunningLedger(txns, 0);
    expect(rows[2].running).toBe(600);
  });

  it("advances reduce balance", () => {
    const txns = [
      { transaction_id: 1, type: "advance", amount: "200", transaction_date: "2026-01-01", notes: null },
    ];
    const rows = computeRunningLedger(txns, 0);
    expect(rows[1].running).toBe(-200);
  });

  it("negative opening balance (supplier owes us)", () => {
    const rows = computeRunningLedger([], -300);
    expect(rows[0].running).toBe(-300);
  });
});

describe("computeSummary", () => {
  it("returns totals from ledger rows", () => {
    const txns = [
      { transaction_id: 1, type: "bill",    amount: "2000", transaction_date: "2026-01-01", notes: null },
      { transaction_id: 2, type: "payment", amount: "800",  transaction_date: "2026-01-02", notes: null },
      { transaction_id: 3, type: "advance", amount: "300",  transaction_date: "2026-01-03", notes: null },
    ];
    const s = computeSummary(txns, 0);
    expect(s.totalBilled).toBe(2000);
    expect(s.totalPaid).toBe(1100);   // 800 + 300
    expect(s.netBalance).toBe(900);   // 0 + 2000 - 800 - 300
  });
});
