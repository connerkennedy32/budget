"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePlaidLink } from "react-plaid-link";

type Transaction = {
  id: string;
  date: string;
  name: string;
  amount: number;
  category: string;
  isCustom: boolean;
};

type Account = {
  id: string;
  name: string;
  type: string;
  balance: number;
};

type TransactionsResponse =
  | { transactions: Transaction[]; accounts: Account[]; categories: string[] }
  | { error: string };

type Status = "loading" | "not_linked" | "linked";

// Money moving between your own accounts, or coming in, isn't spending.
const NON_SPENDING = new Set(["Income", "Transfer in", "Transfer out"]);

const NEW_CATEGORY = "__new__";
// Plaid keeps about two years of history.
const MONTHS_BACK = 23;

const formatMoney = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD" });

// Credit and loan balances are amounts owed, so they reduce the total.
const isLiability = (type: string) => type === "credit" || type === "loan";

const monthOf = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

const shiftMonth = (month: string, delta: number) => {
  const [y, m] = month.split("-").map(Number);
  return monthOf(new Date(y, m - 1 + delta, 1));
};

const monthLabel = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
};

// Parsed by hand: new Date("YYYY-MM-DD") is UTC and can show the previous day.
const formatDate = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
};

const CSS = `
  .pld {
    --gold: #C8952A;
    --gold-soft: rgba(200, 149, 42, 0.12);
    --gold-border: rgba(200, 149, 42, 0.28);
    --bg: #0A0806;
    --surface: #121009;
    --border: #28200F;
    --text: #F0E8D8;
    --muted: #8A7A60;
    --red: #C0543A;
    --green: #4a9e6b;
    font-family: 'Figtree', sans-serif;
    background: var(--bg);
    color: var(--text);
    min-height: 100%;
  }
  .pld-serif { font-family: 'Cormorant Garamond', serif; }
  .pld-mono { font-family: 'JetBrains Mono', monospace; font-feature-settings: 'tnum'; }
  .pld-inner { max-width: 720px; margin: 0 auto; padding: 1.75rem 1rem 3rem; }
  .pld-title { font-size: 0.9rem; font-weight: 400; color: var(--muted); margin: 0 0 0.35rem; }
  .pld-hero { margin-bottom: 1.75rem; }
  .pld-spent {
    font-size: clamp(3rem, 14vw, 4.75rem);
    font-weight: 600; line-height: 1; margin: 0;
  }
  .pld-hero-sub { margin: 0.6rem 0 0; font-size: 0.85rem; color: var(--muted); }
  .pld-hero-sub strong { color: var(--text); font-weight: 500; }

  .pld-card {
    background: var(--surface); border: 1px solid var(--border);
    border-radius: 14px; padding: 1.1rem 1rem; margin-bottom: 1rem;
  }
  .pld-card-title { font-size: 0.95rem; font-weight: 600; margin: 0 0 1rem; }

  .pld-cat { margin-bottom: 1rem; }
  .pld-cat:last-child { margin-bottom: 0; }
  .pld-cat-head {
    display: flex; justify-content: space-between; align-items: baseline;
    gap: 0.75rem; font-size: 0.9rem; margin-bottom: 0.4rem;
  }
  .pld-cat-amt { display: flex; gap: 0.6rem; align-items: baseline; }
  .pld-cat-pct { font-size: 0.72rem; color: var(--muted); min-width: 2.4rem; text-align: right; }
  .pld-track { height: 8px; border-radius: 4px; background: var(--gold-soft); overflow: hidden; }
  .pld-bar {
    height: 100%; border-radius: 4px; background: var(--gold);
    transform-origin: left; animation: pld-grow 0.7s cubic-bezier(0.22,1,0.36,1) both;
  }
  @keyframes pld-grow { from { transform: scaleX(0); } }

  .pld-acct {
    display: flex; justify-content: space-between; gap: 0.75rem;
    font-size: 0.88rem; padding: 0.35rem 0;
  }
  .pld-acct-total {
    border-top: 1px solid var(--border); margin-top: 0.4rem; padding-top: 0.7rem;
    font-weight: 600;
  }

  .pld-txn {
    display: flex; justify-content: space-between; align-items: center;
    gap: 0.75rem; padding: 0.75rem 0; border-bottom: 1px solid var(--border);
  }
  .pld-txn:last-child { border-bottom: 0; padding-bottom: 0; }
  .pld-txn-main { min-width: 0; }
  .pld-txn-name { font-size: 0.92rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .pld-txn-meta { font-size: 0.75rem; color: var(--muted); margin-top: 0.15rem; }
  .pld-txn-amt { font-size: 0.9rem; white-space: nowrap; }
  .pld-credit { color: var(--green); }

  .pld-monthnav {
    display: flex; align-items: center; justify-content: space-between;
    margin-bottom: 1.5rem;
  }
  .pld-month { font-size: 1.1rem; font-weight: 600; }
  .pld-arrow {
    width: 44px; height: 44px; border-radius: 10px; cursor: pointer;
    background: transparent; color: var(--gold); font-size: 1.4rem; line-height: 1;
    border: 1px solid var(--gold-border);
  }
  .pld-arrow:disabled { opacity: 0.3; cursor: default; }
  .pld-arrow:focus-visible { outline: 2px solid var(--text); outline-offset: 2px; }
  .pld-loading { opacity: 0.45; transition: opacity 0.15s; }

  .pld-txn-row { border-bottom: 1px solid var(--border); }
  .pld-txn-row:last-child { border-bottom: 0; }
  .pld-txn-row .pld-txn { border-bottom: 0; width: 100%; background: none; border: 0; color: inherit;
    font: inherit; text-align: left; cursor: pointer; }
  .pld-txn-row:last-child .pld-txn { padding-bottom: 0.75rem; }
  .pld-txn:focus-visible { outline: 2px solid var(--gold); outline-offset: 2px; border-radius: 6px; }
  .pld-tag { color: var(--gold); }
  .pld-editor {
    background: var(--gold-soft); border-radius: 10px; padding: 0.9rem;
    margin-bottom: 0.75rem; display: flex; flex-direction: column; gap: 0.6rem;
  }
  .pld-editor label { font-size: 0.8rem; color: var(--muted); }
  .pld-input {
    font: inherit; font-size: 1rem; color: var(--text); background: var(--bg);
    border: 1px solid var(--gold-border); border-radius: 8px;
    padding: 0.65rem 0.75rem; min-height: 44px; width: 100%;
  }
  .pld-input:focus-visible { outline: 2px solid var(--gold); outline-offset: 1px; }
  .pld-editor-note { font-size: 0.78rem; color: var(--muted); margin: 0; }
  .pld-editor-actions { display: flex; gap: 0.5rem; flex-wrap: wrap; }
  .pld-editor-actions .pld-btn { padding: 0.6rem 1rem; font-size: 0.9rem; }

  .pld-btn {
    font: inherit; font-size: 0.95rem; font-weight: 600; cursor: pointer;
    background: var(--gold); color: #0A0806; border: 0; border-radius: 10px;
    padding: 0.8rem 1.25rem; min-height: 44px;
  }
  .pld-btn:hover { filter: brightness(1.08); }
  .pld-btn-quiet {
    background: transparent; color: var(--gold);
    border: 1px solid var(--gold-border);
  }
  .pld-btn:focus-visible { outline: 2px solid var(--text); outline-offset: 2px; }
  .pld-empty { text-align: center; padding: 2.5rem 1rem; }
  .pld-empty p { color: var(--muted); font-size: 0.9rem; margin: 0.4rem 0 1.4rem; }
  .pld-error {
    display: flex; flex-direction: column; align-items: flex-start; gap: 0.75rem;
    border: 1px solid var(--red); border-radius: 12px; padding: 0.9rem 1rem;
    margin-bottom: 1rem; font-size: 0.9rem; color: #E8A090;
  }
  .pld-muted { color: var(--muted); font-size: 0.9rem; }

  @media (min-width: 640px) {
    .pld-inner { padding: 3rem 2rem 4rem; }
    .pld-card { padding: 1.4rem 1.5rem; }
  }
  @media (prefers-reduced-motion: reduce) {
    .pld-bar { animation: none; }
  }
`;

function CategoryEditor({
  txn,
  categories,
  onDone,
}: {
  txn: Transaction;
  categories: string[];
  onDone: (saved: boolean) => void;
}) {
  const [choice, setChoice] = useState(txn.category);
  const [custom, setCustom] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const options = categories.includes(txn.category)
    ? categories
    : [...categories, txn.category].sort();
  const finalCategory = choice === NEW_CATEGORY ? custom.trim() : choice;

  const save = async (category: string | null) => {
    setSaving(true);
    setError(null);
    const res = await fetch("/api/plaid/category-rule", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ merchant: txn.name, category }),
    });
    setSaving(false);
    if (!res.ok) {
      setError("Couldn't save that category. Try again.");
      return;
    }
    onDone(true);
  };

  return (
    <div className="pld-editor">
      <label htmlFor={`cat-${txn.id}`}>Category for {txn.name}</label>
      <select
        id={`cat-${txn.id}`}
        className="pld-input"
        value={choice}
        onChange={(e) => setChoice(e.target.value)}
      >
        {options.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
        <option value={NEW_CATEGORY}>New category…</option>
      </select>
      {choice === NEW_CATEGORY && (
        <input
          className="pld-input"
          placeholder="Category name"
          maxLength={40}
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          autoFocus
        />
      )}
      <p className="pld-editor-note">
        Every {txn.name} transaction, past and future, will use this category.
      </p>
      {error && <p className="pld-editor-note" role="alert" style={{ color: "#E8A090" }}>{error}</p>}
      <div className="pld-editor-actions">
        <button
          className="pld-btn"
          disabled={saving || !finalCategory}
          onClick={() => save(finalCategory)}
        >
          Save
        </button>
        {txn.isCustom && (
          <button
            className="pld-btn pld-btn-quiet"
            disabled={saving}
            onClick={() => save(null)}
          >
            Reset to default
          </button>
        )}
        <button className="pld-btn pld-btn-quiet" onClick={() => onDone(false)}>
          Cancel
        </button>
      </div>
    </div>
  );
}

export default function PlaidPage() {
  const [status, setStatus] = useState<Status>("loading");
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [month, setMonth] = useState(() => monthOf(new Date()));
  const [refresh, setRefresh] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);
  const [data, setData] = useState<{
    month: string;
    transactions: Transaction[];
    accounts: Account[];
    categories: string[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const currentMonth = monthOf(new Date());
  const transactions = useMemo(() => data?.transactions ?? [], [data]);
  const accounts = data?.accounts ?? [];
  const categoryOptions = data?.categories ?? [];
  const loading = status === "linked" && data?.month !== month && !error;

  const checkStatus = useCallback(async () => {
    const res = await fetch("/api/plaid/status");
    const data = (await res.json()) as { linked: boolean };
    setStatus(data.linked ? "linked" : "not_linked");
  }, []);

  useEffect(() => {
    fetch("/api/plaid/status")
      .then((res) => res.json() as Promise<{ linked: boolean }>)
      .then((data) => setStatus(data.linked ? "linked" : "not_linked"));
  }, []);

  useEffect(() => {
    if (status !== "linked") return;
    let stale = false;
    fetch(`/api/plaid/transactions?month=${month}`)
      .then((res) => res.json() as Promise<TransactionsResponse>)
      .then((json) => {
        if (stale) return;
        if ("error" in json) {
          setError(json.error);
          return;
        }
        setError(null);
        setData({ month, ...json });
      })
      .catch(() => {
        if (!stale) setError("Couldn't reach the server. Check your connection.");
      });
    return () => {
      stale = true;
    };
  }, [status, month, refresh]);

  const fetchLinkToken = useCallback(async () => {
    setError(null);
    const res = await fetch("/api/plaid/link-token", { method: "POST" });
    const data = (await res.json()) as
      | { linkToken: string }
      | { error: string };
    if ("error" in data) {
      setError(data.error);
      return;
    }
    setLinkToken(data.linkToken);
  }, []);

  const { open, ready } = usePlaidLink({
    token: linkToken,
    onSuccess: async (publicToken) => {
      const res = await fetch("/api/plaid/exchange-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ publicToken }),
      });
      const data = (await res.json()) as { ok?: true; error?: string };
      if (data.error) {
        setError(data.error);
        return;
      }
      setLinkToken(null);
      await checkStatus();
    },
    onExit: (err, metadata) => {
      console.info("plaid link exit", err, metadata);
      setLinkToken(null);
      if (err) {
        setError(
          err.display_message ||
            err.error_message ||
            "Plaid couldn't connect to your bank. Try again."
        );
      }
    },
    onEvent: (eventName, metadata) => {
      console.info("plaid link event", eventName, metadata);
    },
  });

  useEffect(() => {
    if (linkToken && ready) {
      open();
    }
  }, [linkToken, ready, open]);

  const { totalSpent, categories } = useMemo(() => {
    const byCategory = new Map<string, number>();
    for (const t of transactions) {
      if (t.amount <= 0) continue;
      if (NON_SPENDING.has(t.category)) continue;
      byCategory.set(t.category, (byCategory.get(t.category) ?? 0) + t.amount);
    }
    const sorted = [...byCategory.entries()]
      .map(([name, total]) => ({ name, total }))
      .sort((a, b) => b.total - a.total);
    return {
      totalSpent: sorted.reduce((sum, c) => sum + c.total, 0),
      categories: sorted,
    };
  }, [transactions]);

  const totalBalance = accounts.reduce(
    (sum, a) => sum + (isLiability(a.type) ? -a.balance : a.balance),
    0
  );

  return (
    <>
      <style>{CSS}</style>
      <div className="pld flex-1 overflow-auto">
        <div className="pld-inner">
          {error && (
            <div className="pld-error" role="alert">
              <span>{error}</span>
              <button
                className="pld-btn pld-btn-quiet"
                onClick={() => {
                  setError(null);
                  if (status === "linked") setRefresh((n) => n + 1);
                  else checkStatus();
                }}
              >
                Try again
              </button>
            </div>
          )}

          {status === "loading" && <p className="pld-muted">Loading…</p>}

          {status === "not_linked" && (
            <div className="pld-card pld-empty">
              <h1 className="pld-serif" style={{ fontSize: "2rem", margin: 0 }}>
                See where your money goes
              </h1>
              <p>Connect a bank to break down the last 30 days by category.</p>
              <button className="pld-btn" onClick={fetchLinkToken}>
                Connect a bank
              </button>
            </div>
          )}

          {status === "linked" && (
            <>
              <div className="pld-monthnav">
                <button
                  className="pld-arrow"
                  aria-label="Previous month"
                  disabled={month <= shiftMonth(currentMonth, -MONTHS_BACK)}
                  onClick={() => setMonth(shiftMonth(month, -1))}
                >
                  ‹
                </button>
                <span className="pld-month pld-serif" style={{ fontSize: "1.5rem" }}>
                  {monthLabel(month)}
                </span>
                <button
                  className="pld-arrow"
                  aria-label="Next month"
                  disabled={month >= currentMonth}
                  onClick={() => setMonth(shiftMonth(month, 1))}
                >
                  ›
                </button>
              </div>

              <div className={loading ? "pld-loading" : undefined} aria-busy={loading}>
              <header className="pld-hero">
                <h1 className="pld-title">
                  {month === currentMonth ? "Spent so far this month" : "Spent this month"}
                </h1>
                <p className="pld-spent pld-serif">{formatMoney(totalSpent)}</p>
                {accounts.length > 0 && (
                  <p className="pld-hero-sub">
                    Current balance{" "}
                    <strong className="pld-mono">{formatMoney(totalBalance)}</strong>
                  </p>
                )}
              </header>

              <section className="pld-card">
                <h2 className="pld-card-title">By category</h2>
                {categories.length === 0 ? (
                  <p className="pld-muted">No spending in {monthLabel(month)}.</p>
                ) : (
                  categories.map((c) => {
                    const pct = (c.total / totalSpent) * 100;
                    return (
                      <div className="pld-cat" key={c.name}>
                        <div className="pld-cat-head">
                          <span>{c.name}</span>
                          <span className="pld-cat-amt">
                            <span className="pld-mono">{formatMoney(c.total)}</span>
                            <span className="pld-mono pld-cat-pct">
                              {Math.round(pct)}%
                            </span>
                          </span>
                        </div>
                        <div className="pld-track">
                          <div className="pld-bar" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    );
                  })
                )}
              </section>

              {accounts.length > 0 && (
                <section className="pld-card">
                  <h2 className="pld-card-title">Accounts</h2>
                  {accounts.map((a) => (
                    <div className="pld-acct" key={a.id}>
                      <span>{a.name}</span>
                      <span className="pld-mono">
                        {isLiability(a.type) ? "-" : ""}
                        {formatMoney(a.balance)}
                      </span>
                    </div>
                  ))}
                  {accounts.length > 1 && (
                    <div className="pld-acct pld-acct-total">
                      <span>Total</span>
                      <span className="pld-mono">{formatMoney(totalBalance)}</span>
                    </div>
                  )}
                </section>
              )}

              <section className="pld-card">
                <h2 className="pld-card-title">Transactions</h2>
                {transactions.length === 0 && !error && (
                  <p className="pld-muted">No transactions in {monthLabel(month)}.</p>
                )}
                {transactions.map((t) => {
                  const credit = t.amount < 0;
                  const open = openId === t.id;
                  return (
                    <div className="pld-txn-row" key={t.id}>
                      <button
                        className="pld-txn"
                        aria-expanded={open}
                        onClick={() => setOpenId(open ? null : t.id)}
                      >
                        <div className="pld-txn-main">
                          <div className="pld-txn-name">{t.name}</div>
                          <div className="pld-txn-meta">
                            {formatDate(t.date)} ·{" "}
                            <span className={t.isCustom ? "pld-tag" : undefined}>
                              {t.category}
                            </span>
                          </div>
                        </div>
                        <span
                          className={`pld-mono pld-txn-amt${credit ? " pld-credit" : ""}`}
                        >
                          {credit ? "+" : ""}
                          {formatMoney(Math.abs(t.amount))}
                        </span>
                      </button>
                      {open && (
                        <CategoryEditor
                          txn={t}
                          categories={categoryOptions}
                          onDone={(saved) => {
                            setOpenId(null);
                            if (saved) setRefresh((n) => n + 1);
                          }}
                        />
                      )}
                    </div>
                  );
                })}
              </section>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
