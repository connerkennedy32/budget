"use client";

import { useState, useEffect } from "react";

const STORAGE_KEY = "savingsInputs";
const MILESTONES = [6, 12, 18, 24, 36, 60, 120];

interface Inputs {
  contribution: string;
  startingBalance: string;
  annualRate: string;
}

interface MonthRow {
  month: number;
  contribution: number;
  interestEarned: number;
  totalContributed: number;
  balance: number;
}

function buildProjection(contribution: number, startingBalance: number, annualRate: number, months: number): MonthRow[] {
  const monthlyRate = annualRate / 100 / 12;
  const rows: MonthRow[] = [];
  let balance = startingBalance;
  let totalContributed = startingBalance;

  for (let m = 1; m <= months; m++) {
    const interest = balance * monthlyRate;
    balance = balance + interest + contribution;
    totalContributed += contribution;
    rows.push({
      month: m,
      contribution,
      interestEarned: interest,
      totalContributed,
      balance,
    });
  }
  return rows;
}

function fmt(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n);
}

function fmtExact(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

function monthLabel(m: number): string {
  if (m < 12) return `${m}mo`;
  const y = m / 12;
  return y === Math.floor(y) ? `${y}yr` : `${y}yr`;
}

const CSS = `
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
    --green: #4a9e6b;
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

  .ldg-field-label {
    font-size: 0.62rem;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--muted);
    margin-bottom: 0.4rem;
    display: block;
  }

  .ldg-input-wrap { position: relative; display: inline-flex; flex-direction: column; }
  .ldg-input-prefix {
    position: absolute; left: 0.85rem; top: 50%; transform: translateY(-50%);
    font-family: 'JetBrains Mono', monospace;
    color: var(--muted); font-size: 1rem; pointer-events: none;
  }
  .ldg-input-suffix {
    position: absolute; right: 0.85rem; top: 50%; transform: translateY(-50%);
    font-family: 'JetBrains Mono', monospace;
    color: var(--muted); font-size: 1rem; pointer-events: none;
  }
  .ldg-input {
    background: var(--surface);
    border: 1px solid var(--border);
    color: var(--text);
    font-family: 'JetBrains Mono', monospace;
    font-size: 1rem;
    letter-spacing: 0.02em;
    padding: 0.7rem 1rem;
    border-radius: 3px;
    outline: none;
    transition: border-color 0.2s, box-shadow 0.2s;
    width: 160px;
  }
  .ldg-input-money { padding-left: 1.75rem; }
  .ldg-input-pct   { padding-right: 1.75rem; }
  .ldg-input::placeholder { color: var(--muted); }
  .ldg-input:focus {
    border-color: var(--gold);
    box-shadow: 0 0 0 3px rgba(200,149,42,0.1);
  }

  @keyframes ldg-up {
    from { opacity: 0; transform: translateY(16px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  .ldg-appear { animation: ldg-up 0.5s cubic-bezier(0.22,1,0.36,1) both; }
  .ldg-d1 { animation-delay: 0.06s; }
  .ldg-d2 { animation-delay: 0.12s; }
  .ldg-d3 { animation-delay: 0.18s; }

  /* Milestone cards */
  .ldg-milestone-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    border: 1px solid var(--border);
    border-radius: 4px;
    overflow: hidden;
    background: var(--border);
    gap: 1px;
  }
  .ldg-milestone {
    background: var(--surface);
    padding: 1.25rem 1.25rem;
    cursor: default;
  }
  .ldg-milestone-label {
    font-size: 0.62rem;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--muted);
    margin-bottom: 0.5rem;
  }
  .ldg-milestone-value {
    font-family: 'Cormorant Garamond', serif;
    font-feature-settings: 'tnum';
    font-size: 1.9rem;
    font-weight: 600;
    line-height: 1;
    color: var(--gold);
  }
  .ldg-milestone-sub {
    margin-top: 0.45rem;
    font-size: 0.72rem;
    color: var(--muted);
    font-family: 'JetBrains Mono', monospace;
  }

  /* Hero */
  .ldg-hero-amount {
    font-family: 'Cormorant Garamond', serif;
    font-feature-settings: 'tnum';
    font-size: clamp(3.5rem, 9vw, 6.5rem);
    font-weight: 600;
    line-height: 1;
    color: var(--gold);
    letter-spacing: -0.01em;
  }

  /* Table */
  .ldg-tbl-wrap {
    border: 1px solid var(--border);
    border-radius: 4px;
    overflow: auto;
    max-height: 420px;
  }
  .ldg-tbl {
    width: 100%;
    border-collapse: collapse;
    font-family: 'JetBrains Mono', monospace;
    font-feature-settings: 'tnum';
    font-size: 0.8rem;
  }
  .ldg-tbl thead th {
    background: var(--surface-2);
    color: var(--muted);
    font-size: 0.62rem;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    padding: 0.6rem 1rem;
    text-align: right;
    position: sticky;
    top: 0;
    border-bottom: 1px solid var(--border);
    white-space: nowrap;
  }
  .ldg-tbl thead th:first-child { text-align: left; }
  .ldg-tbl tbody td {
    padding: 0.45rem 1rem;
    border-bottom: 1px solid var(--border);
    text-align: right;
    color: var(--text);
  }
  .ldg-tbl tbody td:first-child { text-align: left; color: var(--muted); }
  .ldg-tbl tbody tr:last-child td { border-bottom: none; }
  .ldg-tbl tbody tr.milestone-row td { background: var(--gold-soft); }
  .ldg-tbl tbody tr.milestone-row td:first-child { color: var(--gold); font-weight: 600; }
  .ldg-tbl .col-balance { color: var(--gold) !important; font-weight: 600; }
  .ldg-tbl .col-interest { color: var(--green); }

  .ldg-card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 1.5rem;
  }
  .ldg-card-title {
    font-size: 0.62rem;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--gold);
    margin-bottom: 1.25rem;
  }

  /* Growth bar */
  .ldg-growth-bar {
    height: 4px;
    border-radius: 2px;
    background: var(--border);
    overflow: hidden;
    margin-top: 0.5rem;
  }
  .ldg-growth-bar-fill {
    height: 100%;
    border-radius: 2px;
    transition: width 0.6s cubic-bezier(0.22,1,0.36,1);
  }

  @media (max-width: 700px) {
    .ldg-inner { padding: 1.25rem 1rem 3rem !important; }
    .ldg-milestone-grid { grid-template-columns: repeat(2, 1fr); }
    .ldg-form-row { flex-direction: column !important; align-items: stretch !important; }
    .ldg-input { width: 100% !important; }
    .ldg-input-wrap { width: 100%; }
    .ldg-long-grid { grid-template-columns: 1fr !important; }
  }
`;

export function SavingsProjection() {
  const [inputs, setInputs] = useState<Inputs>({
    contribution: "",
    startingBalance: "0",
    annualRate: "7.00",
  });

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) setInputs(JSON.parse(saved));
    } catch {}
  }, []);

  function set(field: keyof Inputs) {
    return (e: React.ChangeEvent<HTMLInputElement>) => {
      const next = { ...inputs, [field]: e.target.value };
      setInputs(next);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    };
  }

  const contribution = parseFloat(inputs.contribution.replace(/,/g, "")) || 0;
  const startingBalance = parseFloat(inputs.startingBalance.replace(/,/g, "")) || 0;
  const annualRate = parseFloat(inputs.annualRate) || 0;

  const hasValidInputs = contribution > 0 || startingBalance > 0;

  const rows = hasValidInputs ? buildProjection(contribution, startingBalance, annualRate, 120) : [];

  const milestoneSet = new Set(MILESTONES);

  function atMonth(m: number) {
    return rows[m - 1];
  }

  const at12 = atMonth(12);
  const at18 = atMonth(18);

  // For growth bar max = 10yr balance
  const maxBalance = rows.length ? rows[rows.length - 1].balance : 1;

  return (
    <>
      <style>{CSS}</style>
      <div className="ldg flex-1 overflow-auto">
        <div className="ldg-inner" style={{ maxWidth: 960, margin: "0 auto", padding: "3rem 2rem 4rem" }}>

          {/* Header */}
          <div style={{ marginBottom: "2.75rem" }}>
            <p className="ldg-mono" style={{ fontSize: "0.68rem", letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--gold)", marginBottom: "0.6rem" }}>
              Compound Growth
            </p>
            <h1 className="ldg-serif" style={{ fontSize: "clamp(2rem, 4vw, 3rem)", fontWeight: 600, lineHeight: 1.1, margin: 0 }}>
              Savings Projection
            </h1>
          </div>

          {/* Inputs — live, no button needed */}
          <div className="ldg-form-row" style={{ display: "flex", alignItems: "flex-end", gap: "1.25rem", flexWrap: "wrap", marginBottom: "3rem" }}>
            <div className="ldg-input-wrap">
              <label className="ldg-field-label">Monthly Contribution</label>
              <div style={{ position: "relative" }}>
                <span className="ldg-input-prefix">$</span>
                <input className="ldg-input ldg-input-money" placeholder="500" value={inputs.contribution} onChange={set("contribution")} />
              </div>
            </div>
            <div className="ldg-input-wrap">
              <label className="ldg-field-label">Starting Balance</label>
              <div style={{ position: "relative" }}>
                <span className="ldg-input-prefix">$</span>
                <input className="ldg-input ldg-input-money" placeholder="0" value={inputs.startingBalance} onChange={set("startingBalance")} />
              </div>
            </div>
            <div className="ldg-input-wrap">
              <label className="ldg-field-label">Annual Return Rate</label>
              <div style={{ position: "relative" }}>
                <input className="ldg-input ldg-input-pct" placeholder="7.00" value={inputs.annualRate} onChange={set("annualRate")} />
                <span className="ldg-input-suffix">%</span>
              </div>
            </div>
          </div>

          {hasValidInputs && rows.length > 0 && (
            <>
              {/* Milestone grid */}
              <div className="ldg-milestone-grid ldg-appear ldg-d1" style={{ marginBottom: "2rem" }}>
                {[6, 12, 18, 24].map((m) => {
                  const row = atMonth(m);
                  if (!row) return null;
                  const gained = row.balance - row.totalContributed;
                  return (
                    <div key={m} className="ldg-milestone">
                      <p className="ldg-milestone-label">{monthLabel(m)}</p>
                      <p className="ldg-milestone-value">{fmt(row.balance)}</p>
                      <p className="ldg-milestone-sub">+{fmt(gained)} earned</p>
                    </div>
                  );
                })}
              </div>

              {/* Longer-term cards + table */}
              <div className="ldg-appear ldg-d2 ldg-long-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.25rem", marginBottom: "1.5rem" }}>

                {/* Long-term milestones */}
                <div className="ldg-card">
                  <p className="ldg-card-title">Long-Term Growth</p>
                  {[36, 60, 120].map((m) => {
                    const row = atMonth(m);
                    if (!row) return null;
                    const gainPct = row.totalContributed > 0
                      ? ((row.balance - row.totalContributed) / row.totalContributed) * 100
                      : 0;
                    const barPct = (row.balance / maxBalance) * 100;
                    return (
                      <div key={m} style={{ marginBottom: "1.1rem" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                          <span style={{ fontSize: "0.8rem", color: "var(--muted)", letterSpacing: "0.08em" }}>{monthLabel(m)}</span>
                          <span className="ldg-mono" style={{ fontSize: "1rem", color: "var(--gold)", fontWeight: 600 }}>{fmt(row.balance)}</span>
                        </div>
                        <div className="ldg-growth-bar">
                          <div className="ldg-growth-bar-fill" style={{ width: `${barPct}%`, background: "var(--gold)" }} />
                        </div>
                        <p style={{ fontSize: "0.68rem", color: "var(--muted)", marginTop: "0.25rem" }}>
                          {fmt(row.totalContributed)} in · <span style={{ color: "var(--green)" }}>+{gainPct.toFixed(0)}% gain</span>
                        </p>
                      </div>
                    );
                  })}
                </div>

                {/* Assumptions */}
                <div className="ldg-card" style={{ alignSelf: "start" }}>
                  <p className="ldg-card-title">Assumptions</p>
                  {[
                    { label: "Monthly contribution", value: fmtExact(contribution) },
                    { label: "Starting balance", value: fmtExact(startingBalance) },
                    { label: "Annual return", value: `${annualRate.toFixed(2)}%` },
                    { label: "Compounding", value: "Monthly" },
                    { label: "Contributions", value: "End of month" },
                  ].map(({ label, value }) => (
                    <div key={label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.4rem 0", borderTop: "1px solid var(--border)" }}>
                      <span style={{ fontSize: "0.82rem", color: "var(--muted)" }}>{label}</span>
                      <span className="ldg-mono" style={{ fontSize: "0.82rem" }}>{value}</span>
                    </div>
                  ))}
                </div>

              </div>

              {/* Month-by-month table */}
              <div className="ldg-appear ldg-d3">
                <p className="ldg-mono" style={{ fontSize: "0.62rem", letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--gold)", marginBottom: "0.75rem" }}>
                  Month-by-Month · 10 Years
                </p>
                <div className="ldg-tbl-wrap">
                  <table className="ldg-tbl">
                    <thead>
                      <tr>
                        <th>Month</th>
                        <th>Contribution</th>
                        <th>Interest</th>
                        <th>Total In</th>
                        <th>Balance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row) => {
                        const isMilestone = milestoneSet.has(row.month);
                        return (
                          <tr key={row.month} className={isMilestone ? "milestone-row" : ""}>
                            <td>{isMilestone ? `→ ${monthLabel(row.month)}` : `Mo ${row.month}`}</td>
                            <td>{fmt(row.contribution)}</td>
                            <td className="col-interest">{fmt(row.interestEarned)}</td>
                            <td>{fmt(row.totalContributed)}</td>
                            <td className="col-balance">{fmt(row.balance)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}

          {!hasValidInputs && (
            <div style={{ padding: "3rem 0", textAlign: "center", fontSize: "0.84rem", color: "var(--muted)" }}>
              Enter a monthly contribution or starting balance above to see your projection.
            </div>
          )}

        </div>
      </div>
    </>
  );
}
