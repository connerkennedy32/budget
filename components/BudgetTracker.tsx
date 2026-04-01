"use client";

import { useState, useEffect, useId } from "react";

const CATEGORIES = [
  "Housing",
  "Utilities",
  "Groceries",
  "Dining",
  "Transport",
  "Healthcare",
  "Insurance",
  "Entertainment",
  "Clothing",
  "Personal",
  "Savings",
  "Other",
];

const STORAGE_KEY = "budgetEntries";

interface Entry {
  id: string;
  description: string;
  amount: number;
  category: string;
}

function fmt(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

function loadEntries(): Entry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as Entry[];
  } catch {
    return [];
  }
}

function saveEntries(entries: Entry[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries, null, 2));
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
    position: absolute; left: 1rem; top: 50%; transform: translateY(-50%);
    font-family: 'JetBrains Mono', monospace;
    color: var(--muted); font-size: 1.1rem; pointer-events: none;
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
  }
  .ldg-input-amount {
    padding-left: 2rem;
    width: 140px;
  }
  .ldg-input-desc {
    width: 280px;
  }
  .ldg-input::placeholder { color: var(--muted); }
  .ldg-input:focus {
    border-color: var(--gold);
    box-shadow: 0 0 0 3px rgba(200,149,42,0.1);
  }

  .ldg-select {
    background: var(--surface);
    border: 1px solid var(--border);
    color: var(--text);
    font-family: 'Figtree', sans-serif;
    font-size: 0.9rem;
    padding: 0.7rem 2.25rem 0.7rem 1rem;
    border-radius: 3px;
    outline: none;
    cursor: pointer;
    appearance: none;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' fill='none'%3E%3Cpath d='M1 1l5 5 5-5' stroke='%236B5C45' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: right 0.85rem center;
    transition: border-color 0.2s, box-shadow 0.2s;
    width: 160px;
  }
  .ldg-select:focus {
    border-color: var(--gold);
    box-shadow: 0 0 0 3px rgba(200,149,42,0.1);
  }
  .ldg-select option { background: #1A160F; }

  .ldg-btn {
    background: var(--gold);
    color: #0A0806;
    font-family: 'Figtree', sans-serif;
    font-weight: 700;
    font-size: 0.75rem;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    padding: 0.7rem 1.75rem;
    border: none; border-radius: 3px; cursor: pointer;
    transition: opacity 0.15s, transform 0.1s;
    align-self: flex-end;
  }
  .ldg-btn:hover { opacity: 0.88; }
  .ldg-btn:active { transform: scale(0.98); }
  .ldg-btn:disabled { opacity: 0.4; cursor: not-allowed; transform: none; }

  @keyframes ldg-up {
    from { opacity: 0; transform: translateY(16px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  .ldg-appear { animation: ldg-up 0.45s cubic-bezier(0.22,1,0.36,1) both; }

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
    font-size: 0.62rem;
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
  }

  .ldg-hero-amount {
    font-family: 'Cormorant Garamond', serif;
    font-feature-settings: 'tnum';
    font-size: clamp(3.5rem, 9vw, 6rem);
    font-weight: 600;
    line-height: 1;
    color: var(--gold);
    letter-spacing: -0.01em;
  }

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

  .ldg-entry-row {
    display: grid;
    grid-template-columns: 1fr auto auto auto auto;
    align-items: center;
    gap: 0.5rem;
    padding: 0.65rem 0;
    border-top: 1px solid var(--border);
  }
  .ldg-entry-row:first-child { border-top: none; }
  .ldg-entry-desc { font-size: 0.88rem; color: var(--text); }
  .ldg-entry-cat {
    font-size: 0.65rem;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--muted);
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 2px;
    padding: 0.15rem 0.5rem;
    white-space: nowrap;
  }
  .ldg-entry-amount {
    font-family: 'JetBrains Mono', monospace;
    font-feature-settings: 'tnum';
    font-size: 0.9rem;
    color: var(--text);
    text-align: right;
    white-space: nowrap;
  }
  .ldg-icon-btn {
    background: none;
    border: none;
    color: var(--muted);
    cursor: pointer;
    font-size: 0.95rem;
    padding: 0.15rem 0.35rem;
    border-radius: 2px;
    line-height: 1;
    transition: color 0.15s, background 0.15s;
  }
  .ldg-icon-btn:hover { color: var(--text); background: var(--surface-2); }
  .ldg-icon-btn.del:hover { color: var(--red); background: rgba(192,84,58,0.1); }
  .ldg-icon-btn.confirm:hover { color: #6dbb6d; background: rgba(109,187,109,0.1); }

  .ldg-entry-row-editing {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.55rem 0;
    border-top: 1px solid var(--gold-border);
    flex-wrap: wrap;
    background: var(--gold-soft);
    margin: 0 -1.5rem;
    padding-left: 1.5rem;
    padding-right: 1.5rem;
  }
  .ldg-entry-row-editing:first-child { border-top: none; }
  .ldg-edit-input {
    background: var(--surface);
    border: 1px solid var(--gold-border);
    color: var(--text);
    font-family: 'JetBrains Mono', monospace;
    font-size: 0.82rem;
    padding: 0.3rem 0.6rem;
    border-radius: 3px;
    outline: none;
    transition: border-color 0.15s, box-shadow 0.15s;
  }
  .ldg-edit-input:focus {
    border-color: var(--gold);
    box-shadow: 0 0 0 2px rgba(200,149,42,0.15);
  }
  .ldg-edit-input-desc { flex: 1; min-width: 120px; }
  .ldg-edit-input-amount { width: 100px; }
  .ldg-edit-select {
    background: var(--surface);
    border: 1px solid var(--gold-border);
    color: var(--text);
    font-family: 'Figtree', sans-serif;
    font-size: 0.82rem;
    padding: 0.3rem 1.8rem 0.3rem 0.6rem;
    border-radius: 3px;
    outline: none;
    cursor: pointer;
    appearance: none;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' fill='none'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%236B5C45' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: right 0.6rem center;
    transition: border-color 0.15s;
  }
  .ldg-edit-select:focus { border-color: var(--gold); }
  .ldg-edit-select option { background: #1A160F; }

  .ldg-cat-header {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    padding: 0.5rem 0 0.5rem;
    margin-top: 1rem;
  }
  .ldg-cat-header:first-child { margin-top: 0; }
  .ldg-cat-name {
    font-size: 0.62rem;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--gold);
  }
  .ldg-cat-total {
    font-family: 'JetBrains Mono', monospace;
    font-feature-settings: 'tnum';
    font-size: 0.78rem;
    color: var(--muted);
  }

  .ldg-rule { border: none; border-top: 1px solid var(--border); margin: 1rem 0; }

  .ldg-empty {
    padding: 3rem 0;
    text-align: center;
    font-size: 0.84rem;
    color: var(--muted);
  }

  .ldg-error { font-size: 0.8rem; color: var(--red); align-self: flex-end; padding-bottom: 0.7rem; }

  @media (max-width: 700px) {
    .ldg-stat-grid { grid-template-columns: 1fr; }
    .ldg-form-row { flex-direction: column !important; align-items: stretch !important; }
    .ldg-input-desc, .ldg-input-amount, .ldg-select { width: 100% !important; }
    .ldg-budget-grid { grid-template-columns: 1fr !important; }
    .ldg-entry-row { grid-template-columns: 1fr auto auto auto; }
    .ldg-entry-cat { display: none; }
  }
`;

interface EditDraft {
  description: string;
  amount: string;
  category: string;
}

export function BudgetTracker() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [desc, setDesc] = useState("");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [error, setError] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<EditDraft>({ description: "", amount: "", category: CATEGORIES[0] });
  const formId = useId();

  useEffect(() => {
    setEntries(loadEntries());
  }, []);

  function addEntry() {
    setError("");
    const trimmed = desc.trim();
    if (!trimmed) { setError("Enter a description."); return; }
    const val = parseFloat(amount.replace(/,/g, ""));
    if (isNaN(val) || val <= 0) { setError("Enter a valid amount."); return; }

    const next: Entry[] = [
      ...entries,
      { id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, description: trimmed, amount: val, category },
    ];
    setEntries(next);
    saveEntries(next);
    setDesc("");
    setAmount("");
  }

  function deleteEntry(id: string) {
    const next = entries.filter((e) => e.id !== id);
    setEntries(next);
    saveEntries(next);
  }

  function startEdit(entry: Entry) {
    setEditingId(entry.id);
    setEditDraft({ description: entry.description, amount: String(entry.amount), category: entry.category });
  }

  function commitEdit() {
    if (!editingId) return;
    const trimmed = editDraft.description.trim();
    const val = parseFloat(editDraft.amount.replace(/,/g, ""));
    if (!trimmed || isNaN(val) || val <= 0) return;
    const next = entries.map((e) =>
      e.id === editingId ? { ...e, description: trimmed, amount: val, category: editDraft.category } : e
    );
    setEntries(next);
    saveEntries(next);
    setEditingId(null);
  }

  function cancelEdit() {
    setEditingId(null);
  }

  const total = entries.reduce((s, e) => s + e.amount, 0);

  // Group by category, preserving CATEGORIES order
  const grouped = CATEGORIES.reduce<Record<string, Entry[]>>((acc, cat) => {
    const items = entries.filter((e) => e.category === cat);
    if (items.length) acc[cat] = items;
    return acc;
  }, {});
  // Append any custom categories not in the list
  entries.forEach((e) => {
    if (!CATEGORIES.includes(e.category) && !grouped[e.category]) {
      grouped[e.category] = entries.filter((x) => x.category === e.category);
    }
  });

  const categoryTotals = Object.entries(grouped).map(([cat, items]) => ({
    cat,
    total: items.reduce((s, e) => s + e.amount, 0),
  }));

  const topCategory = categoryTotals.length
    ? categoryTotals.reduce((a, b) => (b.total > a.total ? b : a))
    : null;

  return (
    <>
      <style>{CSS}</style>
      <div className="ldg flex-1 overflow-auto">
        <div className="ldg-inner" style={{ maxWidth: 960, margin: "0 auto", padding: "3rem 2rem 4rem" }}>

          {/* Header */}
          <div style={{ marginBottom: "2.75rem" }}>
            <p className="ldg-mono" style={{ fontSize: "0.68rem", letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--gold)", marginBottom: "0.6rem" }}>
              Monthly Budget
            </p>
            <h1 className="ldg-serif" style={{ fontSize: "clamp(2rem, 4vw, 3rem)", fontWeight: 600, lineHeight: 1.1, margin: 0 }}>
              Expense Tracker
            </h1>
          </div>

          {/* Add entry form */}
          <div style={{ marginBottom: "3rem" }}>
            <div className="ldg-form-row" style={{ display: "flex", alignItems: "flex-end", gap: "0.75rem", flexWrap: "wrap" }}>
              <div className="ldg-input-wrap">
                <label className="ldg-field-label" htmlFor={`${formId}-desc`}>Description</label>
                <input
                  id={`${formId}-desc`}
                  className="ldg-input ldg-input-desc"
                  placeholder="e.g. Rent, Netflix, Groceries"
                  value={desc}
                  onChange={(e) => setDesc(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addEntry()}
                />
              </div>

              <div style={{ position: "relative", display: "inline-flex", flexDirection: "column" }}>
                <label className="ldg-field-label" htmlFor={`${formId}-amount`}>Amount</label>
                <div style={{ position: "relative" }}>
                  <span className="ldg-input-prefix" style={{ top: "50%", left: "0.85rem" }}>$</span>
                  <input
                    id={`${formId}-amount`}
                    className="ldg-input ldg-input-amount"
                    placeholder="0.00"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && addEntry()}
                  />
                </div>
              </div>

              <div style={{ display: "inline-flex", flexDirection: "column" }}>
                <label className="ldg-field-label" htmlFor={`${formId}-cat`}>Category</label>
                <select
                  id={`${formId}-cat`}
                  className="ldg-select"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                >
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>

              <button className="ldg-btn" onClick={addEntry} disabled={!desc.trim() || !amount}>
                Add Entry
              </button>

              {error && <span className="ldg-error">{error}</span>}
            </div>
          </div>

          {entries.length > 0 && (
            <>
              {/* Hero total */}
              <div
                className="ldg-appear"
                style={{ borderTop: "1px solid var(--border)", borderBottom: "1px solid var(--border)", padding: "2.5rem 0 2.75rem", textAlign: "center", marginBottom: "2rem" }}
              >
                <p style={{ fontSize: "0.65rem", letterSpacing: "0.2em", textTransform: "uppercase", color: "var(--muted)", marginBottom: "1rem" }}>
                  Total Monthly Spend
                </p>
                <div className="ldg-hero-amount">{fmt(total)}</div>
              </div>

              {/* Stat row */}
              <div className="ldg-stat-grid ldg-appear" style={{ marginBottom: "2rem", animationDelay: "0.06s" }}>
                <div className="ldg-stat">
                  <p className="ldg-stat-label">Entries</p>
                  <p className="ldg-stat-value ldg-mono">{entries.length}</p>
                </div>
                <div className="ldg-stat">
                  <p className="ldg-stat-label">Categories</p>
                  <p className="ldg-stat-value ldg-mono">{categoryTotals.length}</p>
                </div>
                <div className="ldg-stat">
                  <p className="ldg-stat-label">Largest Category</p>
                  <p className="ldg-stat-value ldg-mono" style={{ fontSize: "0.95rem" }}>
                    {topCategory ? `${topCategory.cat} — ${fmt(topCategory.total)}` : "—"}
                  </p>
                </div>
              </div>

              {/* Grid: entries + category breakdown */}
              <div className="ldg-budget-grid ldg-appear" style={{ display: "grid", gridTemplateColumns: "1fr 280px", gap: "1.25rem", animationDelay: "0.12s" }}>

                {/* Entry list grouped by category */}
                <div className="ldg-card">
                  <p className="ldg-card-title">All Entries</p>
                  {Object.entries(grouped).map(([cat, items]) => (
                    <div key={cat}>
                      <div className="ldg-cat-header">
                        <span className="ldg-cat-name">{cat}</span>
                        <span className="ldg-cat-total">{fmt(items.reduce((s, e) => s + e.amount, 0))}</span>
                      </div>
                      {items.map((entry) =>
                        editingId === entry.id ? (
                          <div key={entry.id} className="ldg-entry-row-editing">
                            <input
                              autoFocus
                              className="ldg-edit-input ldg-edit-input-desc"
                              value={editDraft.description}
                              onChange={(e) => setEditDraft((d) => ({ ...d, description: e.target.value }))}
                              onKeyDown={(e) => { if (e.key === "Enter") commitEdit(); if (e.key === "Escape") cancelEdit(); }}
                            />
                            <input
                              className="ldg-edit-input ldg-edit-input-amount"
                              value={editDraft.amount}
                              onChange={(e) => setEditDraft((d) => ({ ...d, amount: e.target.value }))}
                              onKeyDown={(e) => { if (e.key === "Enter") commitEdit(); if (e.key === "Escape") cancelEdit(); }}
                            />
                            <select
                              className="ldg-edit-select"
                              value={editDraft.category}
                              onChange={(e) => setEditDraft((d) => ({ ...d, category: e.target.value }))}
                            >
                              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                            </select>
                            <button className="ldg-icon-btn confirm" onClick={commitEdit} title="Save">✓</button>
                            <button className="ldg-icon-btn del" onClick={cancelEdit} title="Cancel">✕</button>
                          </div>
                        ) : (
                          <div key={entry.id} className="ldg-entry-row">
                            <span className="ldg-entry-desc">{entry.description}</span>
                            <span className="ldg-entry-cat">{entry.category}</span>
                            <span className="ldg-entry-amount">{fmt(entry.amount)}</span>
                            <button className="ldg-icon-btn" onClick={() => startEdit(entry)} title="Edit">✎</button>
                            <button className="ldg-icon-btn del" onClick={() => deleteEntry(entry.id)} title="Remove">×</button>
                          </div>
                        )
                      )}
                    </div>
                  ))}

                  <hr className="ldg-rule" />
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontSize: "0.84rem", fontWeight: 600 }}>Total</span>
                    <span className="ldg-mono" style={{ fontWeight: 600, fontSize: "1rem" }}>{fmt(total)}</span>
                  </div>
                </div>

                {/* Category breakdown */}
                <div className="ldg-card" style={{ alignSelf: "start" }}>
                  <p className="ldg-card-title">By Category</p>
                  {categoryTotals.map(({ cat, total: catTotal }) => {
                    const pct = total > 0 ? (catTotal / total) * 100 : 0;
                    return (
                      <div key={cat}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "0.45rem 0" }}>
                          <span style={{ fontSize: "0.84rem", color: "var(--text)" }}>{cat}</span>
                          <span className="ldg-mono" style={{ fontSize: "0.84rem", color: "var(--text)" }}>{fmt(catTotal)}</span>
                        </div>
                        <div style={{ height: "3px", background: "var(--border)", borderRadius: "2px", marginBottom: "0.2rem" }}>
                          <div style={{ height: "100%", width: `${pct}%`, background: "var(--gold)", borderRadius: "2px", transition: "width 0.4s cubic-bezier(0.22,1,0.36,1)" }} />
                        </div>
                        <p style={{ fontSize: "0.68rem", color: "var(--muted)", marginBottom: "0.3rem" }}>{pct.toFixed(1)}% of total</p>
                      </div>
                    );
                  })}
                </div>

              </div>
            </>
          )}

          {entries.length === 0 && (
            <div className="ldg-empty">
              No entries yet — add your first expense above.
            </div>
          )}

        </div>
      </div>
    </>
  );
}
