"use client";

import { useEffect, useRef, useState } from "react";

const DOWN_PAYMENT_STEP = 10_000;
const DOWN_PAYMENT_ROWS = 15;
const RATE_STEP = 0.05;
const RATE_COLS = 91;
const LOAN_TERM = 30;

function calcPI(principal: number, annualRate: number): number {
  const monthlyRate = annualRate / 100 / 12;
  const n = LOAN_TERM * 12;
  const factor = Math.pow(1 + monthlyRate, n);
  return (principal * monthlyRate * factor) / (factor - 1);
}

function buildTable(price: number, firstDown: number, firstRate: number) {
  const taxes = (price * 0.55 * 0.008736) / 12;
  const insurance = (price * 0.004007) / 12;
  const fixed = taxes + insurance;
  const closingCosts = price * 0.025;

  // Each row represents total cash to close (down payment + closing costs).
  // The actual down payment = cashToClose - closingCosts; loan = price - actualDown.
  const cashAmounts = Array.from(
    { length: DOWN_PAYMENT_ROWS },
    (_, i) => firstDown + i * DOWN_PAYMENT_STEP
  ).filter((cash) => cash - closingCosts >= 0 && cash < price + closingCosts);

  const rates = Array.from({ length: RATE_COLS }, (_, i) =>
    Math.round((firstRate + i * RATE_STEP) * 10000) / 10000
  );

  let min = Infinity;
  let max = -Infinity;
  const grid = cashAmounts.map((cash) =>
    rates.map((rate) => {
      const actualDown = cash - closingCosts;
      const val = calcPI(price - actualDown, rate) + fixed;
      if (val < min) min = val;
      if (val > max) max = val;
      return val;
    })
  );

  return { price, taxes, insurance, closingCosts, cashAmounts, rates, grid, min, max };
}

function formatShort(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

function formatDown(value: number): string {
  if (value === 0) return "$0";
  if (value >= 1_000) return `$${value / 1_000}k`;
  return `$${value}`;
}

function heatColor(t: number): string {
  const hue = Math.round(120 - t * 120);
  return `hsl(${hue}, 50%, 22%)`;
}

function makeToggle(set: (fn: (prev: number | null) => number | null) => void) {
  return (i: number) => set((prev) => (prev === i ? null : i));
}

type TableData = ReturnType<typeof buildTable>;

const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;500;600;700&family=JetBrains+Mono:wght@300;400;500;600&family=Figtree:wght@300;400;500;600;700&display=swap');

  .ldg {
    --gold: #C8952A;
    --gold-soft: rgba(200, 149, 42, 0.12);
    --gold-border: rgba(200, 149, 42, 0.28);
    --bg: #0A0806;
    --surface: #121009;
    --surface-2: #1A160F;
    --border: #28200F;
    --text: #F0E8D8;
    --muted: #6B5C45;
    --red: #C0543A;
    font-family: 'Figtree', sans-serif;
    background: var(--bg);
    color: var(--text);
    min-height: 100%;
    position: relative;
  }

  .ldg::after {
    content: '';
    position: fixed;
    inset: 0;
    background-image:
      repeating-linear-gradient(0deg, transparent, transparent 47px, rgba(200,149,42,0.03) 47px, rgba(200,149,42,0.03) 48px);
    pointer-events: none;
    z-index: 0;
  }

  .ldg-inner { position: relative; z-index: 1; }

  .ldg-serif { font-family: 'Cormorant Garamond', serif; }
  .ldg-mono  { font-family: 'JetBrains Mono', monospace; font-feature-settings: 'tnum'; }

  .ldg-input-wrap { position: relative; display: inline-block; }
  .ldg-input-prefix {
    position: absolute; left: 1rem; top: 50%; transform: translateY(-50%);
    font-family: 'JetBrains Mono', monospace;
    color: var(--muted); font-size: 1.25rem; pointer-events: none;
  }
  .ldg-input {
    background: var(--surface);
    border: 1px solid var(--border);
    color: var(--text);
    font-family: 'JetBrains Mono', monospace;
    font-size: 1.375rem;
    letter-spacing: 0.02em;
    padding: 0.8rem 1.25rem 0.8rem 2.25rem;
    border-radius: 3px;
    outline: none;
    width: 220px;
    transition: border-color 0.2s, box-shadow 0.2s;
  }
  .ldg-input::placeholder { color: var(--muted); }
  .ldg-input:focus {
    border-color: var(--gold);
    box-shadow: 0 0 0 3px rgba(200,149,42,0.1);
  }

  .ldg-btn {
    background: var(--gold);
    color: #0A0806;
    font-family: 'Figtree', sans-serif;
    font-weight: 700;
    font-size: 0.75rem;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    padding: 0.8rem 2.25rem;
    border: none; border-radius: 3px; cursor: pointer;
    transition: opacity 0.15s, transform 0.1s;
  }
  .ldg-btn:hover { opacity: 0.88; }
  .ldg-btn:active { transform: scale(0.98); }

  @keyframes ldg-up {
    from { opacity: 0; transform: translateY(20px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  .ldg-appear { animation: ldg-up 0.55s cubic-bezier(0.22,1,0.36,1) both; }

  .ldg-inline-edit {
    background: var(--surface);
    border: 1px solid var(--gold);
    color: var(--text);
    font-family: 'JetBrains Mono', monospace;
    font-feature-settings: 'tnum';
    font-size: 0.8rem;
    padding: 0.15rem 0.4rem;
    border-radius: 3px;
    outline: none;
    text-align: center;
  }
  .ldg-inline-trigger {
    cursor: pointer;
    text-decoration: underline;
    text-decoration-style: dashed;
    text-underline-offset: 2px;
    color: var(--gold);
  }
  .ldg-inline-trigger:hover { opacity: 0.8; }

  .ldg-tbl-wrap {
    flex: 1;
    min-height: 0;
    overflow: auto;
    border: 1px solid var(--border);
    border-radius: 4px;
  }
  .ldg-tbl {
    border-collapse: collapse;
    font-family: 'JetBrains Mono', monospace;
    font-feature-settings: 'tnum';
    font-size: 0.8rem;
  }
  .ldg-tbl th, .ldg-tbl td {
    border: 1px solid var(--border);
    padding: 0.4rem 0.65rem;
    white-space: nowrap;
  }
  .ldg-tbl thead th {
    background: var(--surface-2);
    color: var(--muted);
    font-size: 0.68rem;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    font-weight: 600;
    position: sticky;
    top: 0;
    z-index: 20;
    cursor: pointer;
    user-select: none;
  }
  .ldg-tbl thead th:first-child {
    left: 0;
    z-index: 30;
    text-align: left;
  }
  .ldg-tbl thead th:not(:first-child) {
    text-align: center;
  }
  .ldg-tbl tbody td:first-child {
    background: var(--surface);
    color: var(--text);
    font-weight: 600;
    position: sticky;
    left: 0;
    z-index: 10;
    cursor: pointer;
    user-select: none;
  }
  .ldg-tbl tbody td:first-child:hover { background: var(--surface-2); }
  .ldg-tbl tbody td:not(:first-child) {
    text-align: center;
    cursor: pointer;
  }
  .ldg-tbl-sel-col { background: var(--gold-soft) !important; color: var(--gold) !important; }
  .ldg-tbl-sel-row td:first-child { background: var(--gold-soft) !important; color: var(--gold) !important; }

  @media (max-width: 640px) {
    .ldg-inner { padding: 1.25rem 1rem 3rem !important; }
    .ldg-mortgage-row { flex-direction: column !important; align-items: stretch !important; }
    .ldg-input-wrap { width: 100%; }
    .ldg-input { width: 100% !important; }
    .ldg-btn { width: 100%; }
  }
`;

function InlineEdit({
  value,
  onCommit,
  format,
  width,
}: {
  value: string;
  onCommit: (val: string) => void;
  format: (val: string) => string;
  width?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  function open() {
    setDraft(value);
    setEditing(true);
  }

  function commit() {
    setEditing(false);
    onCommit(draft);
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        className="ldg-inline-edit"
        style={{ width: width ?? "5rem" }}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") setEditing(false);
        }}
      />
    );
  }

  return (
    <span className="ldg-inline-trigger" title="Click to edit" onClick={open}>
      {format(value)}
    </span>
  );
}

export function MortgageCalculator() {
  const [homePrice, setHomePrice] = useState("");
  const [startDown, setStartDown] = useState("0");
  const [startRate, setStartRate] = useState("6.00");
  const [error, setError] = useState("");
  const [tableData, setTableData] = useState<TableData | null>(null);
  const [selectedRow, setSelectedRow] = useState<number | null>(null);
  const [selectedCol, setSelectedCol] = useState<number | null>(null);

  const toggleRow = makeToggle(setSelectedRow);
  const toggleCol = makeToggle(setSelectedCol);

  useEffect(() => {
    const price = localStorage.getItem("homePrice") ?? "";
    const down = localStorage.getItem("startDown") ?? "0";
    const rate = localStorage.getItem("startRate") ?? "6.00";
    setHomePrice(price);
    setStartDown(down);
    setStartRate(rate);
    const p = parseFloat(price);
    const d = parseFloat(down);
    const r = parseFloat(rate);
    if (p > 0 && d >= 0 && r > 0) setTableData(buildTable(p, d, r));
  }, []);

  function calculate(down = startDown, rate = startRate) {
    setError("");
    const price = parseFloat(homePrice.replace(/,/g, ""));
    const firstDown = parseFloat(down.replace(/,/g, ""));
    const firstRate = parseFloat(rate);

    if (isNaN(price) || price <= 0) {
      setError("Please enter a valid home price.");
      return;
    }
    if (isNaN(firstDown) || firstDown < 0) return;
    if (isNaN(firstRate) || firstRate <= 0 || firstRate > 30) return;

    localStorage.setItem("homePrice", homePrice);
    localStorage.setItem("startDown", down);
    localStorage.setItem("startRate", rate);
    setTableData(buildTable(price, firstDown, firstRate));
  }

  return (
    <>
      <style>{CSS}</style>
      <div className="ldg flex-1 overflow-auto" style={{ display: "flex", flexDirection: "column" }}>
        <div className="ldg-inner" style={{ flex: 1, display: "flex", flexDirection: "column", maxWidth: 1200, margin: "0 auto", width: "100%", padding: "3rem 2rem 4rem" }}>

          {/* Header */}
          <div style={{ marginBottom: "2.75rem" }}>
            <p className="ldg-mono" style={{ fontSize: "0.68rem", letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--gold)", marginBottom: "0.6rem" }}>
              30-Year Fixed · Heat Map View
            </p>
            <h1 className="ldg-serif" style={{ fontSize: "clamp(2rem, 4vw, 3rem)", fontWeight: 600, lineHeight: 1.1, margin: 0 }}>
              Mortgage Rate Explorer
            </h1>
          </div>

          {/* Input row */}
          <div className="ldg-mortgage-row" style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap", marginBottom: tableData ? "2rem" : 0 }}>
            <div className="ldg-input-wrap">
              <span className="ldg-input-prefix">$</span>
              <input
                className="ldg-input"
                placeholder="400,000"
                value={homePrice}
                onChange={(e) => setHomePrice(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && calculate()}
              />
            </div>
            <button className="ldg-btn" onClick={() => calculate()}>Generate Table</button>
            {error && <span style={{ fontSize: "0.8rem", color: "var(--red)" }}>{error}</span>}
          </div>

          {/* Table */}
          {tableData && (
            <div className="ldg-appear" style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
              {/* Table meta */}
              <div style={{ marginBottom: "1rem" }}>
                <p className="ldg-mono" style={{ fontSize: "0.65rem", letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--gold)", marginBottom: "0.35rem" }}>
                  Monthly Payment — {LOAN_TERM}-year fixed · {formatShort(tableData.price)} home price
                </p>
                <p style={{ fontSize: "0.75rem", color: "var(--muted)" }}>
                  Each cell includes P&amp;I + property taxes ({formatShort(tableData.taxes)}/mo) + homeowner&apos;s insurance ({formatShort(tableData.insurance)}/mo).
                  Row labels show total cash to close — closing costs ({formatShort(tableData.closingCosts)}) are subtracted first, the remainder is your down payment.
                  Click a column or row header to highlight. Click a cell to select intersection.
                </p>
              </div>

              <div className="ldg-tbl-wrap">
                <table className="ldg-tbl">
                  <thead>
                    <tr>
                      <th style={{ left: 0, position: "sticky", top: 0, zIndex: 30, background: "var(--surface-2)", textAlign: "left" }}>
                        Cash to Close
                      </th>
                      {tableData.rates.map((rate, i) => {
                        const isSelected = selectedCol === i;
                        return (
                          <th
                            key={rate}
                            onClick={() => toggleCol(i)}
                            style={{
                              background: isSelected ? "var(--gold-soft)" : "var(--surface-2)",
                              color: isSelected ? "var(--gold)" : "var(--muted)",
                            }}
                          >
                            {i === 0 ? (
                              <InlineEdit
                                value={startRate}
                                onCommit={(val) => { setStartRate(val); calculate(startDown, val); }}
                                format={(v) => `${parseFloat(v).toFixed(2)}%`}
                                width="4.5rem"
                              />
                            ) : (
                              `${rate.toFixed(2)}%`
                            )}
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {tableData.cashAmounts.map((dp, rowIdx) => {
                      const isSelectedRow = selectedRow === rowIdx;
                      const hasSelection = selectedRow !== null || selectedCol !== null;
                      return (
                        <tr key={dp}>
                          <td
                            onClick={() => toggleRow(rowIdx)}
                            style={{
                              background: isSelectedRow ? "var(--gold-soft)" : "var(--surface)",
                              color: isSelectedRow ? "var(--gold)" : "var(--text)",
                            }}
                          >
                            {rowIdx === 0 ? (
                              <InlineEdit
                                value={startDown}
                                onCommit={(val) => { setStartDown(val); calculate(val, startRate); }}
                                format={(v) => formatDown(parseFloat(v.replace(/,/g, "")))}
                                width="5rem"
                              />
                            ) : (
                              formatDown(dp)
                            )}
                          </td>
                          {tableData.grid[rowIdx].map((val, colIdx) => {
                            const t = (val - tableData.min) / (tableData.max - tableData.min);
                            const inCol = selectedCol === colIdx;
                            const isIntersection = isSelectedRow && inCol;
                            const dimmed = hasSelection && !isSelectedRow && !inCol;
                            return (
                              <td
                                key={colIdx}
                                onClick={() => {
                                  const alreadySelected = selectedRow === rowIdx && selectedCol === colIdx;
                                  setSelectedRow(alreadySelected ? null : rowIdx);
                                  setSelectedCol(alreadySelected ? null : colIdx);
                                }}
                                style={{
                                  backgroundColor: heatColor(t),
                                  opacity: dimmed ? 0.45 : 1,
                                  outline: isIntersection ? "2px solid var(--gold)" : undefined,
                                  outlineOffset: isIntersection ? "-2px" : undefined,
                                  fontWeight: isIntersection ? 700 : undefined,
                                  color: isIntersection ? "var(--gold)" : "var(--text)",
                                }}
                              >
                                {formatShort(val)}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Legend */}
              <div style={{ display: "flex", alignItems: "center", gap: "1.5rem", marginTop: "1rem" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.72rem", color: "var(--muted)" }}>
                  <span style={{ display: "inline-block", height: "0.75rem", width: "1.5rem", borderRadius: "2px", background: heatColor(0) }} />
                  Lower payment
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.72rem", color: "var(--muted)" }}>
                  <span style={{ display: "inline-block", height: "0.75rem", width: "1.5rem", borderRadius: "2px", background: heatColor(1) }} />
                  Higher payment
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
