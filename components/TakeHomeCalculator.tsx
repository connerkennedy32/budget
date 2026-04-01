"use client";

import { useState, useEffect } from "react";

// 2026 federal income tax brackets — married filing jointly (Rev. Proc. 2025-32)
const BRACKETS = [
  { rate: 0.10, upTo: 24_800 },
  { rate: 0.12, upTo: 100_800 },
  { rate: 0.22, upTo: 211_400 },
  { rate: 0.24, upTo: 403_550 },
  { rate: 0.32, upTo: 512_450 },
  { rate: 0.35, upTo: 768_700 },
  { rate: 0.37, upTo: Infinity },
];

const STANDARD_DEDUCTION = 32_200;
const SS_RATE = 0.062;
const SS_WAGE_BASE = 168_600;
const MEDICARE_RATE = 0.0145;
const ADD_MEDICARE_RATE = 0.009;
const ADD_MEDICARE_THRESHOLD = 250_000;
const UT_STATE_RATE = 0.045;

function calcFederalTax(taxableIncome: number): number {
  let tax = 0;
  let prev = 0;
  for (const bracket of BRACKETS) {
    if (taxableIncome <= prev) break;
    const taxable = Math.min(taxableIncome, bracket.upTo) - prev;
    tax += taxable * bracket.rate;
    prev = bracket.upTo;
  }
  return tax;
}

function calcFICA(grossIncome: number): { ss: number; medicare: number } {
  const ss = Math.min(grossIncome, SS_WAGE_BASE) * SS_RATE;
  const medicare =
    grossIncome * MEDICARE_RATE +
    Math.max(0, grossIncome - ADD_MEDICARE_THRESHOLD) * ADD_MEDICARE_RATE;
  return { ss, medicare };
}

interface TaxResult {
  gross: number;
  standardDeduction: number;
  taxableIncome: number;
  federalTax: number;
  stateTax: number;
  ss: number;
  medicare: number;
  totalTax: number;
  takeHome: number;
  monthlyTakeHome: number;
  paycheckTakeHome: number;
  tithing: number;
  monthlyAfterTithing: number;
  paycheckAfterTithing: number;
  effectiveRate: number;
  brackets: { rate: number; amount: number; tax: number }[];
}

function calculate(grossAnnual: number): TaxResult {
  const taxableIncome = Math.max(0, grossAnnual - STANDARD_DEDUCTION);
  const federalTax = calcFederalTax(taxableIncome);
  const stateTax = grossAnnual * UT_STATE_RATE;
  const { ss, medicare } = calcFICA(grossAnnual);
  const totalTax = federalTax + stateTax + ss + medicare;
  const takeHome = grossAnnual - totalTax;
  const monthlyTakeHome = takeHome / 12;
  const paycheckTakeHome = takeHome / 24;
  const tithing = grossAnnual * 0.10;
  const monthlyAfterTithing = (takeHome - tithing) / 12;
  const paycheckAfterTithing = (takeHome - tithing) / 24;
  const effectiveRate = (totalTax / grossAnnual) * 100;

  let prev = 0;
  const brackets = BRACKETS.map((b) => {
    const amount = Math.max(0, Math.min(taxableIncome, b.upTo) - prev);
    prev = b.upTo;
    return { rate: b.rate, amount, tax: amount * b.rate };
  }).filter((b) => b.amount > 0);

  return {
    gross: grossAnnual,
    standardDeduction: STANDARD_DEDUCTION,
    taxableIncome,
    federalTax,
    stateTax,
    ss,
    medicare,
    totalTax,
    takeHome,
    monthlyTakeHome,
    paycheckTakeHome,
    tithing,
    monthlyAfterTithing,
    paycheckAfterTithing,
    effectiveRate,
    brackets,
  };
}

function fmt(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

function fmtPct(n: number): string {
  return `${n.toFixed(1)}%`;
}

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
    width: 260px;
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
  .ldg-d1 { animation-delay: 0.04s; }
  .ldg-d2 { animation-delay: 0.10s; }
  .ldg-d3 { animation-delay: 0.16s; }
  .ldg-d4 { animation-delay: 0.22s; }

  .ldg-hero-amount {
    font-family: 'Cormorant Garamond', serif;
    font-feature-settings: 'tnum';
    font-size: clamp(4.5rem, 11vw, 8rem);
    font-weight: 600;
    line-height: 1;
    color: var(--gold);
    letter-spacing: -0.01em;
  }

  .ldg-stat-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    border: 1px solid var(--border);
    border-radius: 4px;
    overflow: hidden;
    background: var(--border);
    gap: 1px;
  }
  .ldg-stat {
    background: var(--surface);
    padding: 1.25rem 1.5rem;
  }
  .ldg-stat-label {
    font-size: 0.65rem;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--muted);
    margin-bottom: 0.4rem;
  }
  .ldg-stat-value {
    font-family: 'JetBrains Mono', monospace;
    font-feature-settings: 'tnum';
    font-size: 1.25rem;
    font-weight: 500;
    color: var(--text);
    margin-bottom: 0.2rem;
  }
  .ldg-stat-sub {
    font-size: 0.72rem;
    color: var(--muted);
  }

  .ldg-card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 1.5rem;
  }
  .ldg-card-title {
    font-size: 0.65rem;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--gold);
    margin-bottom: 1.25rem;
  }

  .ldg-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.45rem 0;
  }
  .ldg-row + .ldg-row { border-top: 1px solid var(--border); }
  .ldg-row-label { font-size: 0.84rem; color: var(--text); }
  .ldg-row-label.muted { color: var(--muted); }
  .ldg-row-value {
    font-family: 'JetBrains Mono', monospace;
    font-feature-settings: 'tnum';
    font-size: 0.84rem;
    color: var(--text);
  }
  .ldg-row-value.muted { color: var(--muted); }
  .ldg-row-value.red { color: var(--red); }
  .ldg-row-value.bold { font-weight: 600; }

  .ldg-bracket-grid {
    display: grid;
    grid-template-columns: 3.5rem 1fr 1fr;
    gap: 0 0.75rem;
  }
  .ldg-bracket-head {
    font-size: 0.62rem;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--muted);
    padding-bottom: 0.6rem;
  }
  .ldg-bracket-row {
    display: contents;
  }
  .ldg-bracket-row > * {
    padding: 0.38rem 0;
    border-top: 1px solid var(--border);
    font-family: 'JetBrains Mono', monospace;
    font-feature-settings: 'tnum';
    font-size: 0.8rem;
  }
  .ldg-bracket-total > * {
    padding: 0.45rem 0;
    border-top: 1px solid var(--gold);
    font-family: 'JetBrains Mono', monospace;
    font-feature-settings: 'tnum';
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--text);
  }

  .ldg-rule { border: none; border-top: 1px solid var(--border); margin: 1rem 0; }

  @media (max-width: 680px) {
    .ldg-stat-grid { grid-template-columns: 1fr; }
    .ldg-detail-grid { grid-template-columns: 1fr !important; }
  }
`;

export function TakeHomeCalculator() {
  const [salary, setSalary] = useState("");
  const [result, setResult] = useState<TaxResult | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const saved = localStorage.getItem("takeHomeSalary");
    if (saved) {
      setSalary(saved);
      const val = parseFloat(saved.replace(/,/g, ""));
      if (!isNaN(val) && val > 0) setResult(calculate(val));
    }
  }, []);

  function handleCalculate() {
    setError("");
    const val = parseFloat(salary.replace(/,/g, ""));
    if (isNaN(val) || val <= 0) {
      setError("Enter a valid salary.");
      return;
    }
    localStorage.setItem("takeHomeSalary", salary);
    setResult(calculate(val));
  }

  return (
    <>
      <style>{CSS}</style>
      <div className="ldg flex-1 overflow-auto">
        <div className="ldg-inner" style={{ maxWidth: 960, margin: "0 auto", padding: "3rem 2rem 4rem" }}>

          {/* Header */}
          <div style={{ marginBottom: "2.75rem" }}>
            <p className="ldg-mono" style={{ fontSize: "0.68rem", letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--gold)", marginBottom: "0.6rem" }}>
              2026 · Married Filing Jointly · Utah
            </p>
            <h1 className="ldg-serif" style={{ fontSize: "clamp(2rem, 4vw, 3rem)", fontWeight: 600, lineHeight: 1.1, margin: 0 }}>
              Take-Home Calculator
            </h1>
          </div>

          {/* Input row */}
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap", marginBottom: result ? "3.5rem" : 0 }}>
            <div className="ldg-input-wrap">
              <span className="ldg-input-prefix">$</span>
              <input
                className="ldg-input"
                placeholder="120,000"
                value={salary}
                onChange={(e) => setSalary(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCalculate()}
              />
            </div>
            <button className="ldg-btn" onClick={handleCalculate}>Calculate</button>
            {error && <span style={{ fontSize: "0.8rem", color: "var(--red)" }}>{error}</span>}
          </div>

          {result && (
            <div>
              {/* Hero paycheck */}
              <div
                className="ldg-appear"
                style={{ borderTop: "1px solid var(--border)", borderBottom: "1px solid var(--border)", padding: "2.5rem 0 2.75rem", textAlign: "center", marginBottom: "2rem" }}
              >
                <p style={{ fontSize: "0.65rem", letterSpacing: "0.2em", textTransform: "uppercase", color: "var(--muted)", marginBottom: "1rem" }}>
                  Per Paycheck · Semi-Monthly
                </p>
                <div className="ldg-hero-amount">{fmt(result.paycheckTakeHome)}</div>
                <p style={{ marginTop: "0.9rem", fontSize: "0.8rem", color: "var(--muted)" }}>
                  <span className="ldg-mono" style={{ color: "var(--text)", opacity: 0.55 }}>{fmt(result.paycheckAfterTithing)}</span>
                  {"  "}after tithing
                </p>
              </div>

              {/* Stat row */}
              <div className="ldg-stat-grid ldg-appear ldg-d1" style={{ marginBottom: "1.75rem" }}>
                {[
                  { label: "Monthly Take-Home", value: fmt(result.monthlyTakeHome), sub: `${fmt(result.monthlyAfterTithing)} after tithing` },
                  { label: "Annual Take-Home", value: fmt(result.takeHome), sub: `${fmtPct(result.effectiveRate)} effective rate` },
                  { label: "Total Tax Burden", value: fmt(result.totalTax), sub: `+ ${fmt(result.tithing)} tithing` },
                ].map((s) => (
                  <div key={s.label} className="ldg-stat">
                    <p className="ldg-stat-label">{s.label}</p>
                    <p className="ldg-stat-value">{s.value}</p>
                    <p className="ldg-stat-sub">{s.sub}</p>
                  </div>
                ))}
              </div>

              {/* Detail cards */}
              <div className="ldg-detail-grid ldg-appear ldg-d2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.25rem" }}>

                {/* Deductions breakdown */}
                <div className="ldg-card">
                  <p className="ldg-card-title">Deductions</p>

                  <div className="ldg-row">
                    <span className="ldg-row-label">Gross salary</span>
                    <span className="ldg-row-value ldg-mono">{fmt(result.gross)}</span>
                  </div>
                  <div className="ldg-row">
                    <span className="ldg-row-label muted">Standard deduction</span>
                    <span className="ldg-row-value ldg-mono muted">− {fmt(result.standardDeduction)}</span>
                  </div>
                  <div className="ldg-row">
                    <span className="ldg-row-label bold" style={{ fontWeight: 600 }}>Taxable income</span>
                    <span className="ldg-row-value ldg-mono bold">{fmt(result.taxableIncome)}</span>
                  </div>

                  <hr className="ldg-rule" />

                  <div className="ldg-row">
                    <span className="ldg-row-label">Federal income tax</span>
                    <span className="ldg-row-value ldg-mono red">− {fmt(result.federalTax)}</span>
                  </div>
                  <div className="ldg-row">
                    <span className="ldg-row-label">Utah state tax (4.5%)</span>
                    <span className="ldg-row-value ldg-mono red">− {fmt(result.stateTax)}</span>
                  </div>
                  <div className="ldg-row">
                    <span className="ldg-row-label muted">Social Security (6.2%)</span>
                    <span className="ldg-row-value ldg-mono muted">− {fmt(result.ss)}</span>
                  </div>
                  <div className="ldg-row">
                    <span className="ldg-row-label muted">Medicare (1.45%+)</span>
                    <span className="ldg-row-value ldg-mono muted">− {fmt(result.medicare)}</span>
                  </div>

                  <hr className="ldg-rule" />

                  <div className="ldg-row">
                    <span className="ldg-row-label">Total taxes withheld</span>
                    <span className="ldg-row-value ldg-mono bold">− {fmt(result.totalTax)}</span>
                  </div>
                  <div className="ldg-row">
                    <span className="ldg-row-label muted">Tithing (10% of gross)</span>
                    <span className="ldg-row-value ldg-mono muted">− {fmt(result.tithing)}</span>
                  </div>
                </div>

                {/* Bracket breakdown */}
                <div className="ldg-card">
                  <p className="ldg-card-title">Federal Bracket Breakdown</p>
                  <div className="ldg-bracket-grid">
                    <span className="ldg-bracket-head">Rate</span>
                    <span className="ldg-bracket-head" style={{ textAlign: "right" }}>Income</span>
                    <span className="ldg-bracket-head" style={{ textAlign: "right" }}>Tax</span>

                    {result.brackets.map((b, i) => (
                      <div key={i} className="ldg-bracket-row">
                        <span style={{ color: "var(--gold)" }}>{fmtPct(b.rate * 100)}</span>
                        <span style={{ textAlign: "right", color: "var(--muted)" }}>{fmt(b.amount)}</span>
                        <span style={{ textAlign: "right", color: "var(--text)" }}>{fmt(b.tax)}</span>
                      </div>
                    ))}

                    <div className="ldg-bracket-total">
                      <span>Total</span>
                      <span style={{ textAlign: "right" }}>{fmt(result.taxableIncome)}</span>
                      <span style={{ textAlign: "right" }}>{fmt(result.federalTax)}</span>
                    </div>
                  </div>
                </div>

              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
