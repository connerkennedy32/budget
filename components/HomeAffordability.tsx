"use client";

import { useState, useEffect, useMemo } from "react";

// ── Tax constants (2026, Married Filing Jointly, Utah) ────────────────────────
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

function calcFederalTax(taxable: number): number {
  let tax = 0, prev = 0;
  for (const b of BRACKETS) {
    if (taxable <= prev) break;
    tax += (Math.min(taxable, b.upTo) - prev) * b.rate;
    prev = b.upTo;
  }
  return tax;
}

function calcMonthlyAfterTithing(grossAnnual: number): number {
  const taxable = Math.max(0, grossAnnual - STANDARD_DEDUCTION);
  const federal = calcFederalTax(taxable);
  const state = grossAnnual * UT_STATE_RATE;
  const ss = Math.min(grossAnnual, SS_WAGE_BASE) * SS_RATE;
  const medicare =
    grossAnnual * MEDICARE_RATE +
    Math.max(0, grossAnnual - ADD_MEDICARE_THRESHOLD) * ADD_MEDICARE_RATE;
  const takeHome = grossAnnual - federal - state - ss - medicare;
  const tithing = grossAnnual * 0.10;
  return (takeHome - tithing) / 12;
}

function calcMonthlyMortgage(principal: number, annualRate: number, years = 30): number {
  const r = annualRate / 100 / 12;
  const n = years * 12;
  if (r === 0) return principal / n;
  const factor = Math.pow(1 + r, n);
  return (principal * r * factor) / (factor - 1);
}

// Given available cash, back-solve for the max home price affordable
function calcMaxAffordablePrice(availableCash: number, targetMonthly: number, annualRate: number): number {
  if (availableCash <= 0 || targetMonthly <= 0 || annualRate <= 0) return 0;
  const r = annualRate / 100 / 12;
  const n = 360;
  const factor = Math.pow(1 + r, n);
  const L = (factor - 1) / (r * factor); // loan amount per $1 of PI payment
  const k = (0.55 * 0.008736 + 0.004007) / 12; // monthly tax+insurance per $1 of home price
  // Income ceiling: PI must be positive → H < targetMonthly / k
  const hIncomeCap = targetMonthly / k;
  // Case 1: rawDown >= 3.5% (standard down payment)
  // totalCash = H*(1.025 + k*L) - targetMonthly*L  →  solve for H
  const H1 = (availableCash + targetMonthly * L) / (1.025 + k * L);
  const rawDown1 = H1 * (1 + k * L) - targetMonthly * L;
  let H: number;
  if (rawDown1 >= H1 * 0.035) {
    H = H1;
  } else {
    // Case 2: FHA floor binds (3.5% down + 2.5% closing = 6% total)
    H = availableCash / 0.06;
  }
  return Math.min(H, hIncomeCap);
}

// Back-calculate the max loan size that keeps P&I at or under targetPI
function calcMaxLoan(targetPI: number, annualRate: number, years = 30): number {
  const r = annualRate / 100 / 12;
  const n = years * 12;
  if (r === 0) return targetPI * n;
  const factor = Math.pow(1 + r, n);
  return (targetPI * (factor - 1)) / (r * factor);
}

// ── Budget entries from localStorage ─────────────────────────────────────────
interface BudgetEntry { id: string; amount: number; description: string; category: string; }

function loadBudgetEntries(): BudgetEntry[] {
  try {
    const raw = localStorage.getItem("budgetEntries");
    return raw ? (JSON.parse(raw) as BudgetEntry[]) : [];
  } catch { return []; }
}

// ── Core affordability calculation ────────────────────────────────────────────
interface AffordabilityResult {
  monthlyAfterTithing: number;
  monthlyExpenses: number;
  monthlySurplus: number;
  downPayment: number;
  closingCosts: number;
  totalCashNeeded: number;
  monthsToGoal: number | null;   // null = unreachable within 30 yrs
  targetDate: Date | null;
  pi: number;
  propertyTax: number;
  homeInsurance: number;
  mortgagePayment: number;       // actual PITI with derived down payment
  requiredDownPct: number;       // derived from targetMonthly
  monthlyAfterMortgage: number;  // surplus after buying
  dtiRatio: number;              // total PITI / gross monthly
  rows: { month: number; balance: number; interest: number; contributions: number }[];
  alreadyAffordable: boolean;
  targetMonthlyImpossible: boolean; // target monthly < tax+insurance alone
}

function calcAffordability(
  salary: number,
  housePrice: number,
  mortgageRate: number,
  startingSavings: number,
  saleProceeds: number,
  monthlyExpenses: number,
  targetMonthly: number,
  investRate: number,
): AffordabilityResult {
  const monthlyAfterTithing = calcMonthlyAfterTithing(salary);
  const monthlySurplus = monthlyAfterTithing - monthlyExpenses;

  const propertyTax = (housePrice * 0.55 * 0.008736) / 12;
  const homeInsurance = (housePrice * 0.004007) / 12;
  const fixed = propertyTax + homeInsurance;

  // Back-calculate how much loan keeps PITI at targetMonthly
  const targetPI = targetMonthly - fixed;
  const targetMonthlyImpossible = targetPI <= 0;
  const maxLoan = targetPI > 0 ? calcMaxLoan(targetPI, mortgageRate) : 0;

  // Down payment = whatever bridges the gap; minimum 3.5% (FHA floor)
  const rawDown = housePrice - maxLoan;
  const downPayment = Math.max(rawDown, housePrice * 0.035);
  const requiredDownPct = (downPayment / housePrice) * 100;

  const closingCosts = housePrice * 0.025;
  const totalCashNeeded = downPayment + closingCosts;
  const alreadyAffordable = startingSavings + saleProceeds >= totalCashNeeded;

  // Actual PITI using the derived down payment
  const loan = housePrice - downPayment;
  const pi = calcMonthlyMortgage(loan, mortgageRate);
  const mortgagePayment = pi + propertyTax + homeInsurance;
  const monthlyAfterMortgage = monthlyAfterTithing - monthlyExpenses - mortgagePayment;
  const dtiRatio = (mortgagePayment / (salary / 12)) * 100;

  const monthlyRate = investRate / 100 / 12;
  const rows: AffordabilityResult["rows"] = [];
  let balance = startingSavings;
  let monthsToGoal: number | null = null;
  const toInvest = Math.max(0, monthlySurplus);

  for (let m = 1; m <= 360; m++) {
    const interest = balance * monthlyRate;
    balance += interest + toInvest;
    rows.push({ month: m, balance, interest, contributions: toInvest });
    if (monthsToGoal === null && balance + saleProceeds >= totalCashNeeded) {
      monthsToGoal = m;
    }
  }

  let targetDate: Date | null = null;
  if (alreadyAffordable) {
    targetDate = new Date();
  } else if (monthsToGoal !== null) {
    targetDate = new Date(2026, 2, 1); // March 2026 baseline
    targetDate.setMonth(targetDate.getMonth() + monthsToGoal);
  }

  return {
    monthlyAfterTithing, monthlyExpenses, monthlySurplus,
    downPayment, closingCosts, totalCashNeeded,
    monthsToGoal, targetDate,
    pi, propertyTax, homeInsurance, mortgagePayment, requiredDownPct,
    monthlyAfterMortgage, dtiRatio,
    rows, alreadyAffordable, targetMonthlyImpossible,
  };
}

// ── Goal seek ─────────────────────────────────────────────────────────────────
type GoalSeekField = 'salary' | 'housePrice' | 'startingSavings' | 'targetMonthly' | 'investRate';

const GOAL_SEEK_LABELS: Record<GoalSeekField, string> = {
  salary: 'Annual Salary',
  housePrice: 'House Price',
  startingSavings: 'Starting Savings',
  targetMonthly: 'Target Monthly (PITI)',
  investRate: 'Investment Return',
};

function goalSeekCalc(
  targetMonths: number,
  field: GoalSeekField,
  salary: number,
  housePrice: number,
  mortgageRate: number,
  startingSavings: number,
  saleProceeds: number,
  monthlyExpenses: number,
  targetMonthly: number,
  investRate: number,
): number | null {
  function evalMonths(v: number): number {
    let s = salary, hp = housePrice, ss = startingSavings, tm = targetMonthly, ir = investRate;
    if (field === 'salary') s = v;
    else if (field === 'housePrice') hp = v;
    else if (field === 'startingSavings') ss = v;
    else if (field === 'targetMonthly') tm = v;
    else if (field === 'investRate') ir = v;
    if (s <= 0 || hp <= 0 || mortgageRate <= 0 || tm <= 0) return 361;
    const r = calcAffordability(s, hp, mortgageRate, ss, saleProceeds, monthlyExpenses, tm, ir);
    if (r.alreadyAffordable) return 0;
    return r.monthsToGoal ?? 361;
  }

  // inverse: higher value → fewer months
  const isInverse = field === 'salary' || field === 'startingSavings' || field === 'targetMonthly' || field === 'investRate';

  const bounds: Record<GoalSeekField, [number, number]> = {
    salary:         [0,       3_000_000],
    housePrice:     [50_000, 10_000_000],
    startingSavings:[0,       5_000_000],
    targetMonthly:  [100,        50_000],
    investRate:     [0,              30],
  };

  let [lo, hi] = bounds[field];

  if (isInverse) {
    if (evalMonths(hi) > targetMonths) return null; // even max value can't hit target
    if (evalMonths(lo) <= targetMonths) return lo;  // already achievable at minimum
    // Find smallest x where evalMonths(x) <= targetMonths
    for (let i = 0; i < 80; i++) {
      if (hi - lo <= (field === 'investRate' ? 0.01 : 1)) break;
      const mid = (lo + hi) / 2;
      if (evalMonths(mid) <= targetMonths) hi = mid;
      else lo = mid;
    }
    return hi;
  } else {
    if (evalMonths(lo) > targetMonths) return null; // even minimum exceeds target
    if (evalMonths(hi) <= targetMonths) return hi;  // maximum still achievable
    // Find largest x where evalMonths(x) <= targetMonths
    for (let i = 0; i < 80; i++) {
      if (hi - lo <= 1) break;
      const mid = (lo + hi) / 2;
      if (evalMonths(mid) <= targetMonths) lo = mid;
      else hi = mid;
    }
    return lo;
  }
}

// ── Affordable price chart ────────────────────────────────────────────────────
interface ChartPoint { month: number; price: number; }

function AffordableChart({ pts, housePrice, displayMax }: {
  pts: ChartPoint[];
  housePrice: number;
  displayMax: number;
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const PAD = { l: 68, r: 24, t: 20, b: 32 };
  const W = 760, SH = 190;
  const cW = W - PAD.l - PAD.r;
  const cH = SH - PAD.t - PAD.b;

  const priceMax = Math.max(housePrice * 1.2, ...pts.map(p => p.price));
  const magnitude = Math.pow(10, Math.floor(Math.log10(priceMax)));
  const yMax = Math.ceil(priceMax / magnitude) * magnitude;
  const yStep = yMax / 4;

  const toX = (m: number) => PAD.l + (m / displayMax) * cW;
  const toY = (p: number) => PAD.t + (1 - p / yMax) * cH;

  const linePts = pts.map(p => `${toX(p.month).toFixed(1)},${toY(p.price).toFixed(1)}`).join(" ");
  const areaPts = `${toX(0).toFixed(1)},${toY(0).toFixed(1)} ${linePts} ${toX(pts[pts.length - 1].month).toFixed(1)},${toY(0).toFixed(1)}`;

  const yTicks = [1, 2, 3, 4].map(i => i * yStep);
  const xTicks = Array.from({ length: Math.floor(displayMax / 12) + 1 }, (_, i) => i * 12).filter(m => m <= displayMax);
  const crossIdx = pts.findIndex(p => p.price >= housePrice);
  const fmtY = (v: number) => v >= 1_000_000 ? `$${(v / 1_000_000).toFixed(1)}M` : `$${(v / 1_000).toFixed(0)}k`;

  function handlePointer(clientX: number, rect: DOMRect) {
    const svgX = ((clientX - rect.left) / rect.width) * W;
    if (svgX < PAD.l || svgX > W - PAD.r) { setHoverIdx(null); return; }
    const approxMonth = (svgX - PAD.l) / cW * displayMax;
    let nearest = 0, minDist = Infinity;
    pts.forEach((p, i) => {
      const d = Math.abs(p.month - approxMonth);
      if (d < minDist) { minDist = d; nearest = i; }
    });
    setHoverIdx(nearest);
  }

  function handleMouseMove(e: React.MouseEvent<SVGSVGElement>) {
    handlePointer(e.clientX, e.currentTarget.getBoundingClientRect());
  }

  function handleTouchMove(e: React.TouchEvent<SVGSVGElement>) {
    if (e.touches.length > 0) {
      handlePointer(e.touches[0].clientX, e.currentTarget.getBoundingClientRect());
    }
  }

  const hov = hoverIdx !== null ? pts[hoverIdx] : null;
  const ttW = 128;
  const ttX = hov ? Math.min(Math.max(toX(hov.month) - ttW / 2, PAD.l), W - PAD.r - ttW) : 0;
  const ttY = hov ? Math.max(toY(hov.price) - 52, PAD.t) : 0;

  return (
    <svg
      viewBox={`0 0 ${W} ${SH}`}
      style={{ width: "100%", display: "block", cursor: "crosshair" }}
      onMouseMove={handleMouseMove}
      onMouseLeave={() => setHoverIdx(null)}
      onTouchMove={handleTouchMove}
      onTouchEnd={() => setHoverIdx(null)}
    >
      {yTicks.map((v, i) => (
        <line key={i} x1={PAD.l} x2={W - PAD.r} y1={toY(v)} y2={toY(v)} stroke="rgba(200,149,42,0.07)" strokeWidth={1} />
      ))}
      {housePrice > 0 && housePrice < yMax && (
        <>
          <line x1={PAD.l} x2={W - PAD.r} y1={toY(housePrice)} y2={toY(housePrice)} stroke="rgba(200,149,42,0.45)" strokeWidth={1} strokeDasharray="5,4" />
          <text x={W - PAD.r - 2} y={toY(housePrice) - 5} fill="rgba(200,149,42,0.65)" fontSize={9} fontFamily="JetBrains Mono, monospace" textAnchor="end">
            target {fmt(housePrice)}
          </text>
        </>
      )}
      <polygon points={areaPts} fill="rgba(200,149,42,0.05)" />
      <polyline points={linePts} fill="none" stroke="#C8952A" strokeWidth={1.75} strokeLinejoin="round" />
      {crossIdx >= 0 && hoverIdx !== crossIdx && (
        <>
          <circle cx={toX(pts[crossIdx].month)} cy={toY(pts[crossIdx].price)} r={3.5} fill="#C8952A" />
          <text x={toX(pts[crossIdx].month)} y={toY(pts[crossIdx].price) - 9} fill="#C8952A" fontSize={9} fontFamily="JetBrains Mono, monospace" textAnchor="middle">
            Mo {pts[crossIdx].month}
          </text>
        </>
      )}
      {hov && (
        <>
          <line x1={toX(hov.month)} x2={toX(hov.month)} y1={PAD.t} y2={PAD.t + cH} stroke="rgba(200,149,42,0.25)" strokeWidth={1} strokeDasharray="3,3" />
          <circle cx={toX(hov.month)} cy={toY(hov.price)} r={4} fill="#C8952A" stroke="#0A0806" strokeWidth={1.5} />
          <rect x={ttX} y={ttY} width={ttW} height={38} rx={3} fill="#1A160F" stroke="rgba(200,149,42,0.35)" strokeWidth={1} />
          <text x={ttX + ttW / 2} y={ttY + 13} fill="#6B5C45" fontSize={8} fontFamily="JetBrains Mono, monospace" textAnchor="middle">
            {hov.month === 0 ? "Now" : `Month ${hov.month}`}
          </text>
          <text x={ttX + ttW / 2} y={ttY + 29} fill="#C8952A" fontSize={11} fontFamily="JetBrains Mono, monospace" textAnchor="middle" fontWeight={600}>
            {fmt(hov.price)}
          </text>
        </>
      )}
      <line x1={PAD.l} x2={W - PAD.r} y1={PAD.t + cH} y2={PAD.t + cH} stroke="#28200F" strokeWidth={1} />
      <line x1={PAD.l} x2={PAD.l} y1={PAD.t} y2={PAD.t + cH} stroke="#28200F" strokeWidth={1} />
      {yTicks.map((v, i) => (
        <text key={i} x={PAD.l - 6} y={toY(v) + 4} fill="#6B5C45" fontSize={9} fontFamily="JetBrains Mono, monospace" textAnchor="end">
          {fmtY(v)}
        </text>
      ))}
      {xTicks.map(m => (
        <text key={m} x={toX(m)} y={SH - 4} fill="#6B5C45" fontSize={9} fontFamily="JetBrains Mono, monospace" textAnchor="middle">
          {m === 0 ? "Now" : `${m / 12}yr`}
        </text>
      ))}
    </svg>
  );
}

const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function dateLabel(d: Date): string {
  return `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`;
}

function fmt(n: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);
}
function fmtExact(n: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

// ── CSS ───────────────────────────────────────────────────────────────────────
const CSS = `
  .ldg {
    --gold: #C8952A;
    --gold-soft: rgba(200,149,42,0.12);
    --gold-border: rgba(200,149,42,0.28);
    --bg: #0A0806;
    --surface: #121009;
    --surface-2: #1A160F;
    --border: #28200F;
    --text: #F0E8D8;
    --muted: #6B5C45;
    --red: #C0543A;
    --red-soft: rgba(192,84,58,0.12);
    --green: #4a9e6b;
    --green-soft: rgba(74,158,107,0.12);
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
    background-image: repeating-linear-gradient(0deg, transparent, transparent 47px, rgba(200,149,42,0.03) 47px, rgba(200,149,42,0.03) 48px);
    pointer-events: none;
    z-index: 0;
  }
  .ldg-inner { position: relative; z-index: 1; }
  .ldg-serif { font-family: 'Cormorant Garamond', serif; }
  .ldg-mono  { font-family: 'JetBrains Mono', monospace; font-feature-settings: 'tnum'; }

  .ldg-field-label {
    font-size: 0.62rem; letter-spacing: 0.16em; text-transform: uppercase;
    color: var(--muted); margin-bottom: 0.4rem; display: block;
  }
  .ldg-input-wrap { display: inline-flex; flex-direction: column; }
  .ldg-input-rel  { position: relative; }
  .ldg-input-prefix {
    position: absolute; left: 0.85rem; top: 50%; transform: translateY(-50%);
    font-family: 'JetBrains Mono', monospace; color: var(--muted); font-size: 1rem; pointer-events: none;
  }
  .ldg-input-suffix {
    position: absolute; right: 0.85rem; top: 50%; transform: translateY(-50%);
    font-family: 'JetBrains Mono', monospace; color: var(--muted); font-size: 1rem; pointer-events: none;
  }
  .ldg-input {
    background: var(--surface); border: 1px solid var(--border); color: var(--text);
    font-family: 'JetBrains Mono', monospace; font-size: 0.95rem; letter-spacing: 0.02em;
    padding: 0.65rem 1rem; border-radius: 3px; outline: none; width: 150px;
    transition: border-color 0.2s, box-shadow 0.2s;
  }
  .ldg-input-money { padding-left: 1.75rem; }
  .ldg-input-pct   { padding-right: 1.75rem; }
  .ldg-input::placeholder { color: var(--muted); }
  .ldg-input:focus { border-color: var(--gold); box-shadow: 0 0 0 3px rgba(200,149,42,0.1); }

  @keyframes ldg-up {
    from { opacity: 0; transform: translateY(18px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  .ldg-appear { animation: ldg-up 0.5s cubic-bezier(0.22,1,0.36,1) both; }
  .ldg-d1 { animation-delay: 0.07s; }
  .ldg-d2 { animation-delay: 0.14s; }
  .ldg-d3 { animation-delay: 0.21s; }
  .ldg-d4 { animation-delay: 0.28s; }

  /* Answer hero */
  .ldg-answer-box {
    border-radius: 4px;
    padding: 2.75rem 2rem;
    text-align: center;
    border: 1px solid var(--border);
  }
  .ldg-answer-box.achievable  { border-color: var(--gold-border); background: var(--gold-soft); }
  .ldg-answer-box.now         { border-color: rgba(74,158,107,0.35); background: var(--green-soft); }
  .ldg-answer-box.unreachable { border-color: rgba(192,84,58,0.3); background: var(--red-soft); }

  .ldg-answer-months {
    font-family: 'Cormorant Garamond', serif;
    font-size: clamp(4rem, 12vw, 8rem);
    font-weight: 600; line-height: 1; letter-spacing: -0.02em;
  }
  .achievable  .ldg-answer-months { color: var(--gold); }
  .now         .ldg-answer-months { color: var(--green); }
  .unreachable .ldg-answer-months { color: var(--red); }

  /* Stat grid */
  .ldg-stat-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    border: 1px solid var(--border); border-radius: 4px;
    overflow: hidden; background: var(--border); gap: 1px;
  }
  .ldg-stat { background: var(--surface); padding: 1.1rem 1.25rem; }
  .ldg-stat-label { font-size: 0.6rem; letter-spacing: 0.16em; text-transform: uppercase; color: var(--muted); margin-bottom: 0.4rem; }
  .ldg-stat-value { font-family: 'JetBrains Mono', monospace; font-feature-settings: 'tnum'; font-size: 1.1rem; font-weight: 500; }
  .ldg-stat-sub   { font-size: 0.68rem; color: var(--muted); margin-top: 0.15rem; }

  /* Flow rows */
  .ldg-card { background: var(--surface); border: 1px solid var(--border); border-radius: 4px; padding: 1.5rem; }
  .ldg-card-title { font-size: 0.62rem; letter-spacing: 0.16em; text-transform: uppercase; color: var(--gold); margin-bottom: 1.1rem; }
  .ldg-flow-row {
    display: flex; justify-content: space-between; align-items: center;
    padding: 0.42rem 0; border-top: 1px solid var(--border);
  }
  .ldg-flow-row:first-child { border-top: none; }
  .ldg-flow-label { font-size: 0.83rem; }
  .ldg-flow-value { font-family: 'JetBrains Mono', monospace; font-feature-settings: 'tnum'; font-size: 0.83rem; }
  .ldg-flow-label.muted, .ldg-flow-value.muted { color: var(--muted); }
  .ldg-flow-value.bold  { font-weight: 600; }
  .ldg-flow-value.gold  { color: var(--gold); }
  .ldg-flow-value.red   { color: var(--red); }
  .ldg-flow-value.green { color: var(--green); }

  /* Savings table */
  .ldg-tbl-wrap { border: 1px solid var(--border); border-radius: 4px; overflow: auto; max-height: 380px; }
  .ldg-tbl { width: 100%; border-collapse: collapse; font-family: 'JetBrains Mono', monospace; font-feature-settings: 'tnum'; font-size: 0.8rem; }
  .ldg-tbl thead th {
    background: var(--surface-2); color: var(--muted); font-size: 0.6rem; letter-spacing: 0.12em;
    text-transform: uppercase; padding: 0.55rem 1rem; text-align: right;
    position: sticky; top: 0; border-bottom: 1px solid var(--border); white-space: nowrap;
  }
  .ldg-tbl thead th:first-child { text-align: left; }
  .ldg-tbl tbody td { padding: 0.4rem 1rem; border-bottom: 1px solid var(--border); text-align: right; color: var(--text); }
  .ldg-tbl tbody td:first-child { text-align: left; color: var(--muted); }
  .ldg-tbl tbody tr:last-child td { border-bottom: none; }
  .ldg-tbl tbody tr.goal-row td { background: var(--gold-soft) !important; }
  .ldg-tbl tbody tr.goal-row td:first-child { color: var(--gold); font-weight: 700; }
  .ldg-tbl .col-balance { color: var(--gold); font-weight: 600; }
  .ldg-progress-bar { height: 3px; background: var(--border); border-radius: 2px; }
  .ldg-progress-fill { height: 100%; background: var(--gold); border-radius: 2px; transition: width 0.4s; }

  /* Budget notice */
  .ldg-budget-notice {
    background: var(--surface-2); border: 1px solid var(--border); border-radius: 3px;
    padding: 0.6rem 1rem; font-size: 0.78rem; color: var(--muted);
    display: flex; align-items: center; gap: 0.5rem;
  }

  .ldg-divider { border: none; border-top: 1px solid var(--border); margin: 0.5rem 0 1rem; }

  /* Stepper buttons */
  .ldg-step-btns {
    display: flex; flex-direction: column; gap: 1px; flex-shrink: 0;
  }
  .ldg-step-btn {
    background: var(--surface); border: 1px solid var(--border); color: var(--muted);
    cursor: pointer; width: 22px; flex: 1; display: flex; align-items: center;
    justify-content: center; font-size: 0.5rem; border-radius: 2px; padding: 0;
    line-height: 1; user-select: none;
    transition: background 0.12s, color 0.12s, border-color 0.12s;
  }
  .ldg-step-btn:hover { background: var(--gold-soft); color: var(--gold); border-color: var(--gold-border); }
  .ldg-step-btn:active { background: rgba(200,149,42,0.22); }

  /* Goal seek — embedded in answer card */
  .ldg-gs-embed {
    margin-top: 1.75rem; padding-top: 1.5rem;
    border-top: 1px solid rgba(200,149,42,0.13);
  }
  .achievable  .ldg-gs-embed { border-color: rgba(200,149,42,0.18); }
  .unreachable .ldg-gs-embed { border-color: rgba(192,84,58,0.15); }
  .now         .ldg-gs-embed { border-color: rgba(74,158,107,0.15); }

  .ldg-gs-label {
    font-size: 0.54rem; letter-spacing: 0.22em; text-transform: uppercase;
    color: rgba(200,149,42,0.4); margin-bottom: 1.1rem;
  }
  .ldg-gs-sentence {
    display: flex; align-items: baseline; gap: 0.45rem; flex-wrap: wrap;
    justify-content: center; font-size: 0.82rem; color: var(--muted);
  }
  .ldg-gs-inline-input {
    width: 38px; background: transparent; border: none;
    border-bottom: 1px solid rgba(200,149,42,0.4);
    text-align: center; font-family: 'JetBrains Mono', monospace;
    font-size: 0.9rem; color: var(--text); padding: 0 0 2px; outline: none;
  }
  .ldg-gs-inline-input::placeholder { color: rgba(200,149,42,0.3); }
  .ldg-gs-inline-input:focus { border-color: var(--gold); }
  .ldg-gs-inline-select {
    background: transparent; border: none; border-bottom: 1px solid rgba(200,149,42,0.4);
    color: var(--text); font-family: 'JetBrains Mono', monospace; font-size: 0.82rem;
    padding: 0 1.1rem 2px 0; outline: none; cursor: pointer;
    appearance: none; -webkit-appearance: none;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='5' viewBox='0 0 8 5'%3E%3Cpath d='M0 0l4 5 4-5z' fill='%23C8952A' fill-opacity='0.45'/%3E%3C/svg%3E");
    background-repeat: no-repeat; background-position: right 0 center;
  }
  .ldg-gs-inline-select:focus { border-color: var(--gold); }
  .ldg-gs-answer {
    margin-top: 1.5rem; display: flex; flex-direction: column; align-items: center; gap: 0.15rem;
  }
  .ldg-gs-answer-label {
    font-size: 0.57rem; letter-spacing: 0.18em; text-transform: uppercase; color: var(--muted);
  }
  .ldg-gs-answer-value {
    font-family: 'Cormorant Garamond', serif; font-size: clamp(2rem, 6vw, 3rem);
    font-weight: 600; color: var(--gold); line-height: 1;
  }
  .ldg-gs-answer-delta {
    font-family: 'JetBrains Mono', monospace; font-size: 0.7rem;
    color: var(--muted); margin-top: 0.15rem;
  }
  .ldg-gs-apply {
    margin-top: 0.9rem; background: none; border: none; cursor: pointer; padding: 0;
    font-family: 'JetBrains Mono', monospace; font-size: 0.65rem; letter-spacing: 0.14em;
    text-transform: uppercase; color: var(--gold); opacity: 0.55;
    transition: opacity 0.15s; display: flex; align-items: center; gap: 0.25rem;
  }
  .ldg-gs-apply:hover { opacity: 1; }
  .ldg-gs-status {
    margin-top: 0.85rem; font-size: 0.74rem; color: var(--muted); font-style: italic;
  }

  @media (max-width: 720px) {
    .ldg-inner { padding: 1.25rem 1rem 3rem !important; }
    .ldg-stat-grid { grid-template-columns: 1fr 1fr; }
    .ldg-two-col   { grid-template-columns: 1fr !important; }
    .ldg-form-row  { display: grid !important; grid-template-columns: 1fr 1fr !important; gap: 0.75rem !important; align-items: start !important; }
.ldg-input-wrap { width: 100%; }
    .ldg-input     { width: 100% !important; font-size: 0.9rem !important; }
    .ldg-step-row  { width: 100%; }
    .ldg-step-row .ldg-input-rel { flex: 1; min-width: 0; }
  }
  @media (max-width: 480px) {
    .ldg-stat-grid { grid-template-columns: 1fr; }
  }
`;

// ── StepInput ─────────────────────────────────────────────────────────────────
interface StepInputProps {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onStep: (direction: 1 | -1) => void;
  prefix?: string;
  suffix?: string;
  placeholder?: string;
  width?: number;
  extraClass?: string;
  style?: React.CSSProperties;
}

function StepInput({ value, onChange, onStep, prefix, suffix, placeholder, width = 150, extraClass = "", style }: StepInputProps) {
  return (
    <div className="ldg-step-row" style={{ display: "flex", alignItems: "stretch", gap: 2 }}>
      <div className="ldg-input-rel">
        {prefix && <span className="ldg-input-prefix">{prefix}</span>}
        <input
          className={`ldg-input${prefix ? " ldg-input-money" : ""}${suffix ? " ldg-input-pct" : ""} ${extraClass}`}
          style={{ width, ...style }}
          placeholder={placeholder}
          value={value}
          onChange={onChange}
        />
        {suffix && <span className="ldg-input-suffix">{suffix}</span>}
      </div>
      <div className="ldg-step-btns">
        <button className="ldg-step-btn" onClick={() => onStep(1)} tabIndex={-1}>▲</button>
        <button className="ldg-step-btn" onClick={() => onStep(-1)} tabIndex={-1}>▼</button>
      </div>
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────
interface Inputs {
  salary: string;
  housePrice: string;
  mortgageRate: string;
  startingSavings: string;
  targetMonthly: string;
  investRate: string;
  expensesOverride: string;
  // current home sale
  currentHomeSalePrice: string;
  currentHomeMortgageBalance: string;
  commissionRate: string;
}

const STORAGE_KEY = "homeAffordabilityInputs";

export function HomeAffordability() {
  const [inputs, setInputs] = useState<Inputs>({
    salary: "",
    housePrice: "",
    mortgageRate: "",
    startingSavings: "0",
    targetMonthly: "",
    investRate: "7",
    expensesOverride: "",
    currentHomeSalePrice: "",
    currentHomeMortgageBalance: "",
    commissionRate: "6",
  });
  const [budgetEntries, setBudgetEntries] = useState<BudgetEntry[]>([]);
  const [homeSaleOpen, setHomeSaleOpen] = useState<boolean>(() => {
    try { return localStorage.getItem("homeSaleOpen") !== "false"; } catch { return true; }
  });
  const [goalMonths, setGoalMonths] = useState<string>("");
  const [goalSeekField, setGoalSeekField] = useState<GoalSeekField | "">("");

  useEffect(() => {
    setBudgetEntries(loadBudgetEntries());
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

  function stepInput(field: keyof Inputs, delta: number) {
    const rateFields: (keyof Inputs)[] = ["mortgageRate", "investRate", "commissionRate"];
    const current = parseFloat((inputs[field] ?? "").replace(/,/g, "")) || 0;
    const next = Math.max(0, current + delta);
    const formatted = rateFields.includes(field)
      ? parseFloat(next.toFixed(4)).toString()
      : Math.round(next).toString();
    const nextInputs = { ...inputs, [field]: formatted };
    setInputs(nextInputs);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(nextInputs));
  }

  const salary        = parseFloat(inputs.salary.replace(/,/g, "")) || 0;
  const housePrice    = parseFloat(inputs.housePrice.replace(/,/g, "")) || 0;
  const mortgageRate  = parseFloat(inputs.mortgageRate) || 0;
  const startingSavings   = parseFloat((inputs.startingSavings ?? "").replace(/,/g, "")) || 0;
  const targetMonthly     = parseFloat((inputs.targetMonthly ?? "").replace(/,/g, "")) || 0;
  const investRate        = parseFloat(inputs.investRate) || 7;

  const currentHomeSalePrice        = parseFloat((inputs.currentHomeSalePrice ?? "").replace(/,/g, "")) || 0;
  const currentHomeMortgageBalance  = parseFloat((inputs.currentHomeMortgageBalance ?? "").replace(/,/g, "")) || 0;
  const commissionRate              = parseFloat(inputs.commissionRate ?? "6") || 0;

  const saleProceeds = currentHomeSalePrice > 0
    ? Math.max(0, currentHomeSalePrice * (1 - commissionRate / 100) - currentHomeMortgageBalance)
    : 0;
  const effectiveStartingSavings = startingSavings + saleProceeds;

  const budgetTotal   = budgetEntries.reduce((s, e) => s + e.amount, 0);
  const expensesOverride = inputs.expensesOverride.trim();
  const monthlyExpenses = expensesOverride
    ? parseFloat(expensesOverride.replace(/,/g, "")) || 0
    : budgetTotal;

  // The budget may include an existing mortgage payment that goes away after selling.
  // Find and subtract it for the "After Purchase" view.
  const existingMortgageEntry = budgetEntries.find(
    (e) => e.description.trim().toLowerCase() === "mortgage"
  );
  const existingMortgageAmount = existingMortgageEntry?.amount ?? 0;
  const afterPurchaseExpenses = monthlyExpenses - existingMortgageAmount;

  const canCalc = salary > 0 && housePrice > 0 && mortgageRate > 0 && targetMonthly > 0;

  function applyGoalSeek() {
    if (!goalSeekField || goalSeekResult == null) return;
    const rounded = goalSeekField === 'investRate'
      ? goalSeekResult.toFixed(2)
      : Math.round(goalSeekResult).toString();
    const next = { ...inputs, [goalSeekField]: rounded };
    setInputs(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }

  const goalSeekResult = useMemo(() => {
    const gm = parseInt(goalMonths);
    if (!goalSeekField || !gm || gm <= 0 || gm > 360) return undefined;
    // All fields except the one being solved must be valid
    const others = { salary, housePrice, mortgageRate, startingSavings, targetMonthly, investRate };
    const required = (Object.keys(others) as (keyof typeof others)[]).filter(k => k !== goalSeekField);
    if (required.some(k => others[k] <= 0)) return undefined;
    return goalSeekCalc(gm, goalSeekField, salary, housePrice, mortgageRate, startingSavings, saleProceeds, monthlyExpenses, targetMonthly, investRate);
  }, [goalMonths, goalSeekField, salary, housePrice, mortgageRate, startingSavings, saleProceeds, monthlyExpenses, targetMonthly, investRate]);

  const result = canCalc
    ? calcAffordability(salary, housePrice, mortgageRate, startingSavings, saleProceeds, monthlyExpenses, targetMonthly, investRate)
    : null;

  const afterPurchaseRemaining = result
    ? result.monthlyAfterTithing - afterPurchaseExpenses - result.mortgagePayment
    : 0;

  // Build table rows: show all months up to goal (or first 60 if unreachable), milestones highlighted
  const milestoneMonths = new Set([3, 6, 12, 18, 24, 36, 48, 60, 84, 120, 180, 240, 300, 360]);
  const tableRows = result
    ? result.rows.filter((r) => {
        const isGoal = result.monthsToGoal !== null && r.month === result.monthsToGoal;
        const cap = result.monthsToGoal ?? 60;
        return r.month <= cap + 1 && (milestoneMonths.has(r.month) || isGoal || r.month <= 6);
      })
    : [];

  return (
    <>
      <style>{CSS}</style>
      <div className="ldg flex-1 overflow-auto">
        <div className="ldg-inner" style={{ maxWidth: 960, margin: "0 auto", padding: "3rem 2rem 4rem" }}>

          {/* Header */}
          <div style={{ marginBottom: "2.5rem" }}>
            <p className="ldg-mono" style={{ fontSize: "0.68rem", letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--gold)", marginBottom: "0.6rem" }}>
              Purchase Planning
            </p>
            <h1 className="ldg-serif" style={{ fontSize: "clamp(2rem, 4vw, 3rem)", fontWeight: 600, lineHeight: 1.1, margin: 0 }}>
              Home Affordability
            </h1>
          </div>

          {/* Primary inputs */}
          <div className="ldg-form-row" style={{ display: "flex", gap: "1.25rem", flexWrap: "wrap", alignItems: "flex-end", marginBottom: "1rem" }}>
            <div className="ldg-input-wrap">
              <label className="ldg-field-label">Annual Salary</label>
              <StepInput value={inputs.salary} onChange={set("salary")} onStep={d => stepInput("salary", d * 1000)} prefix="$" placeholder="120,000" />
            </div>
            <div className="ldg-input-wrap">
              <label className="ldg-field-label">House Price</label>
              <StepInput value={inputs.housePrice} onChange={set("housePrice")} onStep={d => stepInput("housePrice", d * 5000)} prefix="$" placeholder="500,000" />
            </div>
            <div className="ldg-input-wrap">
              <label className="ldg-field-label">Mortgage Rate</label>
              <StepInput value={inputs.mortgageRate} onChange={set("mortgageRate")} onStep={d => stepInput("mortgageRate", d * 0.125)} suffix="%" placeholder="6.75" width={108} />
            </div>
            <div className="ldg-input-wrap">
              <label className="ldg-field-label">Starting Savings</label>
              <StepInput value={inputs.startingSavings} onChange={set("startingSavings")} onStep={d => stepInput("startingSavings", d * 1000)} prefix="$" placeholder="0" />
            </div>
          </div>

          {/* Secondary inputs */}
          <div className="ldg-form-row" style={{ display: "flex", gap: "1.25rem", flexWrap: "wrap", alignItems: "flex-end", marginBottom: "1.5rem" }}>
            <div className="ldg-input-wrap">
              <label className="ldg-field-label">Target Monthly (PITI)</label>
              <StepInput value={inputs.targetMonthly ?? ""} onChange={set("targetMonthly")} onStep={d => stepInput("targetMonthly", d * 50)} prefix="$" placeholder="2,500" />
            </div>
            <div className="ldg-input-wrap">
              <label className="ldg-field-label">Investment Return</label>
              <StepInput value={inputs.investRate} onChange={set("investRate")} onStep={d => stepInput("investRate", d * 0.5)} suffix="%" placeholder="7" width={108} />
            </div>
            <div className="ldg-input-wrap">
              <label className="ldg-field-label">
                Monthly Expenses
                {budgetTotal > 0 && !expensesOverride && (
                  <span style={{ marginLeft: "0.4rem", color: "var(--gold)", fontStyle: "normal" }}>← from Budget tab</span>
                )}
              </label>
              <StepInput value={inputs.expensesOverride} onChange={set("expensesOverride")} onStep={d => stepInput("expensesOverride", d * 100)} prefix="$" placeholder={budgetTotal > 0 ? fmt(budgetTotal) : "3,000"} width={158} />
            </div>
          </div>

          {/* Current home sale */}
          <div style={{ marginBottom: "1.5rem" }}>
            <button
              onClick={() => {
                const next = !homeSaleOpen;
                setHomeSaleOpen(next);
                try { localStorage.setItem("homeSaleOpen", String(next)); } catch {}
              }}
              style={{
                display: "flex", alignItems: "center", gap: "0.5rem", background: "none",
                border: "none", cursor: "pointer", padding: "0 0 0.85rem", width: "100%", textAlign: "left",
              }}
            >
              <span className="ldg-mono" style={{ fontSize: "0.62rem", letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--gold)" }}>
                Current Home Sale
              </span>
              <span style={{ color: "var(--muted)", fontSize: "0.62rem", fontFamily: "JetBrains Mono, monospace", letterSpacing: "0.1em" }}>· optional</span>
              {saleProceeds > 0 && !homeSaleOpen && (
                <span className="ldg-mono" style={{ marginLeft: "auto", fontSize: "0.78rem", color: "var(--green)", fontWeight: 600 }}>
                  +{fmt(saleProceeds)}
                </span>
              )}
              <span style={{ marginLeft: saleProceeds > 0 && !homeSaleOpen ? "0.4rem" : "auto", color: "var(--muted)", fontSize: "0.7rem" }}>
                {homeSaleOpen ? "▲" : "▼"}
              </span>
            </button>
            {homeSaleOpen && (
              <>
                <div className="ldg-form-row" style={{ display: "flex", gap: "1.25rem", flexWrap: "wrap", alignItems: "flex-end" }}>
                  <div className="ldg-input-wrap">
                    <label className="ldg-field-label">Sale Price</label>
                    <StepInput value={inputs.currentHomeSalePrice ?? ""} onChange={set("currentHomeSalePrice")} onStep={d => stepInput("currentHomeSalePrice", d * 5000)} prefix="$" placeholder="350,000" />
                  </div>
                  <div className="ldg-input-wrap">
                    <label className="ldg-field-label">Remaining Mortgage</label>
                    <StepInput value={inputs.currentHomeMortgageBalance ?? ""} onChange={set("currentHomeMortgageBalance")} onStep={d => stepInput("currentHomeMortgageBalance", d * 5000)} prefix="$" placeholder="200,000" />
                  </div>
                  <div className="ldg-input-wrap">
                    <label className="ldg-field-label">Realtor Commission</label>
                    <StepInput value={inputs.commissionRate ?? ""} onChange={set("commissionRate")} onStep={d => stepInput("commissionRate", d * 0.25)} suffix="%" placeholder="6" width={108} />
                  </div>
                  {saleProceeds > 0 && (
                    <div style={{ alignSelf: "flex-end", paddingBottom: "0.7rem" }}>
                      <p style={{ fontSize: "0.62rem", letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--muted)", marginBottom: "0.2rem" }}>Net Proceeds</p>
                      <p className="ldg-mono" style={{ fontSize: "1.1rem", fontWeight: 600, color: "var(--green)" }}>{fmt(saleProceeds)}</p>
                    </div>
                  )}
                </div>
                {saleProceeds > 0 && (
                  <div className="ldg-budget-notice" style={{ marginTop: "0.75rem" }}>
                    <span style={{ color: "var(--green)" }}>●</span>
                    {fmt(currentHomeSalePrice)} sale − {commissionRate}% commission − {fmt(currentHomeMortgageBalance)} mortgage = {fmt(saleProceeds)} added to your starting balance ({fmt(effectiveStartingSavings)} total)
                  </div>
                )}
              </>
            )}
          </div>

          {/* Budget loaded notice */}
          {budgetEntries.length > 0 && !expensesOverride && (
            <div className="ldg-budget-notice" style={{ marginBottom: "2.5rem" }}>
              <span style={{ color: "var(--gold)" }}>●</span>
              {budgetEntries.length} budget entries loaded · {fmt(budgetTotal)}/mo total expenses · override the field above to use a different number
            </div>
          )}
          {budgetEntries.length === 0 && !expensesOverride && (
            <div className="ldg-budget-notice" style={{ marginBottom: "2.5rem" }}>
              No budget entries found — visit the Budget tab to add expenses, or enter a monthly expenses number above.
            </div>
          )}

          {/* ── Results ── */}
          {result && (
            <>
              {/* Answer */}
              <div
                className={`ldg-answer-box ldg-appear ${result.alreadyAffordable ? "now" : result.monthsToGoal === null ? "unreachable" : "achievable"}`}
                style={{ marginBottom: "2rem" }}
              >
                {result.alreadyAffordable ? (
                  <>
                    <p style={{ fontSize: "0.65rem", letterSpacing: "0.2em", textTransform: "uppercase", color: "var(--green)", marginBottom: "0.75rem" }}>
                      You can afford this house
                    </p>
                    <div className="ldg-answer-months">Right now</div>
                    <p style={{ marginTop: "0.75rem", fontSize: "0.82rem", color: "var(--muted)" }}>
                      You already have {fmt(startingSavings)} — need {fmt(result.totalCashNeeded)} ({result.requiredDownPct.toFixed(1)}% down + closing costs).
                    </p>
                  </>
                ) : result.targetMonthlyImpossible ? (
                  <>
                    <p style={{ fontSize: "0.65rem", letterSpacing: "0.2em", textTransform: "uppercase", color: "var(--red)", marginBottom: "0.75rem" }}>
                      Target monthly too low
                    </p>
                    <div className="ldg-answer-months">—</div>
                    <p style={{ marginTop: "0.75rem", fontSize: "0.82rem", color: "var(--muted)" }}>
                      Property tax + insurance alone is {fmtExact(result.propertyTax + result.homeInsurance)}/mo for this house — your target must be higher than that.
                    </p>
                  </>
                ) : result.monthsToGoal === null ? (
                  <>
                    <p style={{ fontSize: "0.65rem", letterSpacing: "0.2em", textTransform: "uppercase", color: "var(--red)", marginBottom: "0.75rem" }}>
                      Not reachable within 30 years
                    </p>
                    <div className="ldg-answer-months">—</div>
                    <p style={{ marginTop: "0.75rem", fontSize: "0.82rem", color: "var(--muted)" }}>
                      {result.monthlySurplus <= 0
                        ? `Monthly expenses exceed take-home after tithing by ${fmt(Math.abs(result.monthlySurplus))}.`
                        : `Need ${fmt(result.downPayment)} down (${result.requiredDownPct.toFixed(1)}%) — try a lower target monthly or a lower house price.`}
                    </p>
                  </>
                ) : (
                  <>
                    <p style={{ fontSize: "0.65rem", letterSpacing: "0.2em", textTransform: "uppercase", color: "var(--muted)", marginBottom: "0.75rem" }}>
                      You can afford this house in
                    </p>
                    <div className="ldg-answer-months">{result.monthsToGoal}</div>
                    <p style={{ marginTop: "0.15rem", fontSize: "0.68rem", letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--gold)" }}>
                      months
                    </p>
                    {result.targetDate && (
                      <p style={{ marginTop: "0.65rem", fontSize: "0.82rem", color: "var(--muted)" }}>
                        {dateLabel(result.targetDate)} · saving {fmt(result.monthlySurplus)}/mo
                      </p>
                    )}
                  </>
                )}

                {/* ── Embedded Goal Seek ── */}
                <div className="ldg-gs-embed">
                  <p className="ldg-gs-label">Goal Seek</p>
                  <div className="ldg-gs-sentence">
                    <span>Reach in</span>
                    <input
                      className="ldg-gs-inline-input"
                      placeholder="24"
                      value={goalMonths}
                      onChange={e => setGoalMonths(e.target.value)}
                    />
                    <span>months by adjusting</span>
                    <select
                      className="ldg-gs-inline-select"
                      value={goalSeekField}
                      onChange={e => setGoalSeekField(e.target.value as GoalSeekField | "")}
                    >
                      <option value="">— field —</option>
                      <option value="salary">Annual Salary</option>
                      <option value="housePrice">House Price</option>
                      <option value="startingSavings">Starting Savings</option>
                      <option value="targetMonthly">Target Monthly</option>
                      <option value="investRate">Investment Return</option>
                    </select>
                  </div>

                  {goalSeekField && parseInt(goalMonths) > 0 && goalSeekResult === undefined && (
                    <p className="ldg-gs-status">Fill in all other fields above to calculate.</p>
                  )}
                  {goalSeekField && parseInt(goalMonths) > 0 && goalSeekResult === null && (
                    <p className="ldg-gs-status" style={{ color: "var(--red)" }}>No solution found for this goal.</p>
                  )}
                  {goalSeekField && goalSeekResult != null && (
                    <div className="ldg-gs-answer">
                      <p className="ldg-gs-answer-label">
                        {goalSeekField === 'housePrice' ? 'Max House Price' : GOAL_SEEK_LABELS[goalSeekField as GoalSeekField]}
                      </p>
                      <div className="ldg-gs-answer-value">
                        {goalSeekField === 'investRate'
                          ? `${goalSeekResult.toFixed(2)}%`
                          : fmt(Math.round(goalSeekResult))}
                      </div>
                      {(() => {
                        const cv =
                          goalSeekField === 'salary' ? salary :
                          goalSeekField === 'housePrice' ? housePrice :
                          goalSeekField === 'startingSavings' ? startingSavings :
                          goalSeekField === 'targetMonthly' ? targetMonthly : investRate;
                        if (!cv) return null;
                        const diff = goalSeekResult - cv;
                        const pct = Math.abs(diff / cv * 100).toFixed(1);
                        const sign = diff >= 0 ? '+' : '−';
                        const diffFmt = goalSeekField === 'investRate'
                          ? `${sign}${Math.abs(diff).toFixed(2)}%`
                          : `${sign}${fmt(Math.abs(Math.round(diff)))}`;
                        return <p className="ldg-gs-answer-delta">{diffFmt} ({pct}%) from current</p>;
                      })()}
                      <button className="ldg-gs-apply" onClick={applyGoalSeek}>apply ↗</button>
                    </div>
                  )}
                </div>
              </div>

              {/* Stats: cash needed */}
              <div className="ldg-stat-grid ldg-appear ldg-d1" style={{ marginBottom: "1.5rem" }}>
                {[
                  { label: "Required Down Payment", value: fmt(result.downPayment), sub: `${result.requiredDownPct.toFixed(1)}% of ${fmt(housePrice)}` },
                  { label: "Closing Costs", value: fmt(result.closingCosts), sub: "~2.5% estimate" },
                  { label: "Total Cash Needed", value: fmt(result.totalCashNeeded), sub: `${fmt(effectiveStartingSavings)} available${saleProceeds > 0 ? ` (incl. ${fmt(saleProceeds)} from sale)` : ""}` },
                ].map(({ label, value, sub }) => (
                  <div key={label} className="ldg-stat">
                    <p className="ldg-stat-label">{label}</p>
                    <p className="ldg-stat-value ldg-mono">{value}</p>
                    <p className="ldg-stat-sub">{sub}</p>
                  </div>
                ))}
              </div>

              {/* Two-col: money flow + after-purchase check */}
              <div className="ldg-two-col ldg-appear ldg-d2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.25rem", marginBottom: "1.5rem" }}>

                {/* Monthly money flow */}
                <div className="ldg-card">
                  <p className="ldg-card-title">Monthly Money Flow · Pre-Purchase</p>
                  {[
                    { label: "Take-home after tithing", value: fmtExact(result.monthlyAfterTithing), cls: "" },
                    { label: "Monthly expenses", value: `− ${fmtExact(result.monthlyExpenses)}`, cls: "muted" },
                    { label: "Monthly surplus to invest", value: result.monthlySurplus >= 0 ? fmtExact(result.monthlySurplus) : `(${fmtExact(Math.abs(result.monthlySurplus))})`, cls: result.monthlySurplus >= 0 ? "bold gold" : "bold red" },
                  ].map(({ label, value, cls }) => (
                    <div key={label} className="ldg-flow-row">
                      <span className={`ldg-flow-label${cls.includes("muted") ? " muted" : ""}`}>{label}</span>
                      <span className={`ldg-flow-value ldg-mono ${cls}`}>{value}</span>
                    </div>
                  ))}

                  <hr className="ldg-divider" />
                  <p className="ldg-card-title" style={{ marginBottom: "1.1rem" }}>After Purchase</p>
                  {[
                    { label: "Take-home after tithing", value: fmtExact(result.monthlyAfterTithing), cls: "" },
                    { label: `Monthly expenses${existingMortgageAmount > 0 ? ` (excl. current mortgage)` : ""}`, value: `− ${fmtExact(afterPurchaseExpenses)}`, cls: "muted" },
                    { label: "P&I", value: `− ${fmtExact(result.pi)}`, cls: "muted" },
                    { label: "Property tax", value: `− ${fmtExact(result.propertyTax)}`, cls: "muted" },
                    { label: "Homeowner's insurance", value: `− ${fmtExact(result.homeInsurance)}`, cls: "muted" },
                    { label: "Remaining each month", value: afterPurchaseRemaining >= 0 ? fmtExact(afterPurchaseRemaining) : `(${fmtExact(Math.abs(afterPurchaseRemaining))})`, cls: afterPurchaseRemaining >= 0 ? "bold green" : "bold red" },
                  ].map(({ label, value, cls }) => (
                    <div key={label} className="ldg-flow-row">
                      <span className={`ldg-flow-label${cls.includes("muted") ? " muted" : ""}`}>{label}</span>
                      <span className={`ldg-flow-value ldg-mono ${cls}`}>{value}</span>
                    </div>
                  ))}
                </div>

                {/* Mortgage details + DTI */}
                <div className="ldg-card" style={{ alignSelf: "start" }}>
                  <p className="ldg-card-title">Mortgage Details</p>
                  {[
                    { label: "Home price", value: fmt(housePrice) },
                    { label: `Down payment (${result.requiredDownPct.toFixed(1)}%)`, value: fmt(result.downPayment) },
                    { label: "Loan amount", value: fmt(housePrice - result.downPayment) },
                    { label: "Interest rate", value: `${mortgageRate.toFixed(2)}%` },
                    { label: "P&I", value: fmtExact(result.pi) },
                    { label: "Property tax", value: fmtExact(result.propertyTax) },
                    { label: "Homeowner's insurance", value: fmtExact(result.homeInsurance) },
                    { label: "Total monthly (PITI)", value: fmtExact(result.mortgagePayment) },
                  ].map(({ label, value }) => (
                    <div key={label} className="ldg-flow-row">
                      <span className="ldg-flow-label muted">{label}</span>
                      <span className="ldg-flow-value ldg-mono bold">{value}</span>
                    </div>
                  ))}

                  <hr className="ldg-divider" />
                  <p className="ldg-card-title" style={{ marginBottom: "0.75rem" }}>Debt-to-Income</p>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "0.4rem" }}>
                    <span style={{ fontSize: "0.83rem", color: "var(--muted)" }}>Mortgage / gross income</span>
                    <span className="ldg-mono" style={{
                      fontWeight: 700, fontSize: "1.1rem",
                      color: result.dtiRatio <= 28 ? "var(--green)" : result.dtiRatio <= 36 ? "var(--gold)" : "var(--red)"
                    }}>
                      {result.dtiRatio.toFixed(1)}%
                    </span>
                  </div>
                  <div className="ldg-progress-bar">
                    <div className="ldg-progress-fill" style={{
                      width: `${Math.min(100, result.dtiRatio / 50 * 100)}%`,
                      background: result.dtiRatio <= 28 ? "var(--green)" : result.dtiRatio <= 36 ? "var(--gold)" : "var(--red)"
                    }} />
                  </div>
                  <p style={{ fontSize: "0.68rem", color: "var(--muted)", marginTop: "0.4rem" }}>
                    {result.dtiRatio <= 28 ? "✓ Comfortably within the 28% guideline" :
                     result.dtiRatio <= 36 ? "⚠ Above 28% — lenders may still approve" :
                     "✕ Above 36% — likely difficult to qualify"}
                  </p>
                </div>

              </div>

              {/* Savings timeline */}
              {!result.alreadyAffordable && tableRows.length > 0 && (
                <div className="ldg-appear ldg-d3">
                  <p className="ldg-mono" style={{ fontSize: "0.62rem", letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--gold)", marginBottom: "0.75rem" }}>
                    Savings Timeline · {fmt(result.monthlySurplus)}/mo invested at {investRate}%
                  </p>
                  <div className="ldg-tbl-wrap">
                    <table className="ldg-tbl">
                      <thead>
                        <tr>
                          <th>Milestone</th>
                          <th>Interest</th>
                          <th>Balance</th>
                          <th>Progress</th>
                        </tr>
                      </thead>
                      <tbody>
                        {tableRows.map((row) => {
                          const isGoal = result.monthsToGoal === row.month;
                          const pct = Math.min(100, (row.balance / result.totalCashNeeded) * 100);
                          const label = isGoal
                            ? `→ Month ${row.month} (Goal!)`
                            : row.month < 12
                            ? `Month ${row.month}`
                            : row.month % 12 === 0
                            ? `${row.month / 12} yr`
                            : `${row.month} mo`;
                          return (
                            <tr key={row.month} className={isGoal ? "goal-row" : ""}>
                              <td>{label}</td>
                              <td style={{ color: "var(--green)" }}>+{fmt(row.interest)}</td>
                              <td className="col-balance">{fmt(row.balance)}</td>
                              <td>
                                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", justifyContent: "flex-end" }}>
                                  <div style={{ width: 60, height: 3, background: "var(--border)", borderRadius: 2, flexShrink: 0 }}>
                                    <div style={{ width: `${pct}%`, height: "100%", background: isGoal ? "var(--gold)" : "var(--muted)", borderRadius: 2 }} />
                                  </div>
                                  <span style={{ color: "var(--muted)", width: "2.5rem", textAlign: "right" }}>{pct.toFixed(0)}%</span>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}

          {/* Affordable home price trajectory chart */}
          {canCalc && result && (() => {
            const displayMax = result.monthsToGoal ? Math.min(result.monthsToGoal + 12, 120) : 60;
            const pts: ChartPoint[] = [
              { month: 0, price: calcMaxAffordablePrice(startingSavings + saleProceeds, targetMonthly, mortgageRate) },
            ];
            for (const row of result.rows) {
              if (row.month > displayMax) break;
              pts.push({ month: row.month, price: calcMaxAffordablePrice(row.balance + saleProceeds, targetMonthly, mortgageRate) });
            }
            return (
              <div className="ldg-appear ldg-d4" style={{ marginTop: "1.5rem" }}>
                <p className="ldg-mono" style={{ fontSize: "0.62rem", letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--gold)", marginBottom: "0.75rem" }}>
                  Affordable Home Price · Month-by-Month Trajectory
                </p>
                <div className="ldg-card" style={{ padding: "1.25rem 1.5rem" }}>
                  <AffordableChart pts={pts} housePrice={housePrice} displayMax={displayMax} />
                </div>
              </div>
            );
          })()}

          {!canCalc && (
            <div style={{ padding: "3rem 0", textAlign: "center", fontSize: "0.84rem", color: "var(--muted)" }}>
              Enter your salary, house price, mortgage rate, and target monthly payment above to see your timeline.
            </div>
          )}

        </div>
      </div>
    </>
  );
}
