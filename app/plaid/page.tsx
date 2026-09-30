"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePlaidLink } from "react-plaid-link";

type Transaction = {
  id: string;
  date: string;
  name: string;
  amount: number;
  category: string | null;
};

type Account = {
  id: string;
  name: string;
  type: string;
  balance: number;
};

type TransactionsResponse =
  | { transactions: Transaction[]; accounts: Account[] }
  | { error: string };

type Status = "loading" | "not_linked" | "linked";

// Money moving between your own accounts, or coming in, isn't spending.
const NON_SPENDING = new Set(["INCOME", "TRANSFER_IN", "TRANSFER_OUT"]);

const formatMoney = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD" });

// Credit and loan balances are amounts owed, so they reduce the total.
const isLiability = (type: string) => type === "credit" || type === "loan";

const formatCategory = (raw: string | null) => {
  if (!raw) return "Uncategorized";
  const words = raw.toLowerCase().replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
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

export default function PlaidPage() {
  const [status, setStatus] = useState<Status>("loading");
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [error, setError] = useState<string | null>(null);

  const checkStatus = useCallback(async () => {
    const res = await fetch("/api/plaid/status");
    const data = (await res.json()) as { linked: boolean };
    setStatus(data.linked ? "linked" : "not_linked");
  }, []);

  const loadTransactions = useCallback(async () => {
    const res = await fetch("/api/plaid/transactions");
    const data = (await res.json()) as TransactionsResponse;
    if ("error" in data) {
      setError(data.error);
      return;
    }
    setTransactions(data.transactions);
    setAccounts(data.accounts);
  }, []);

  useEffect(() => {
    fetch("/api/plaid/status")
      .then((res) => res.json() as Promise<{ linked: boolean }>)
      .then((data) => setStatus(data.linked ? "linked" : "not_linked"));
  }, []);

  useEffect(() => {
    if (status !== "linked") return;
    fetch("/api/plaid/transactions")
      .then((res) => res.json() as Promise<TransactionsResponse>)
      .then((data) => {
        if ("error" in data) {
          setError(data.error);
          return;
        }
        setTransactions(data.transactions);
        setAccounts(data.accounts);
      });
  }, [status]);

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
      if (t.category && NON_SPENDING.has(t.category)) continue;
      const key = formatCategory(t.category);
      byCategory.set(key, (byCategory.get(key) ?? 0) + t.amount);
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
                  return status === "linked" ? loadTransactions() : checkStatus();
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
              <header className="pld-hero">
                <h1 className="pld-title">Spent in the last 30 days</h1>
                <p className="pld-spent pld-serif">{formatMoney(totalSpent)}</p>
                {accounts.length > 0 && (
                  <p className="pld-hero-sub">
                    Total balance{" "}
                    <strong className="pld-mono">{formatMoney(totalBalance)}</strong>
                  </p>
                )}
              </header>

              <section className="pld-card">
                <h2 className="pld-card-title">By category</h2>
                {categories.length === 0 ? (
                  <p className="pld-muted">No spending in the last 30 days.</p>
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
                  <p className="pld-muted">No transactions in the last 30 days.</p>
                )}
                {transactions.map((t) => {
                  const credit = t.amount < 0;
                  return (
                    <div className="pld-txn" key={t.id}>
                      <div className="pld-txn-main">
                        <div className="pld-txn-name">{t.name}</div>
                        <div className="pld-txn-meta">
                          {formatDate(t.date)} · {formatCategory(t.category)}
                        </div>
                      </div>
                      <span
                        className={`pld-mono pld-txn-amt${credit ? " pld-credit" : ""}`}
                      >
                        {credit ? "+" : ""}
                        {formatMoney(Math.abs(t.amount))}
                      </span>
                    </div>
                  );
                })}
              </section>

              <button className="pld-btn pld-btn-quiet" onClick={fetchLinkToken}>
                Connect another bank
              </button>
            </>
          )}
        </div>
      </div>
    </>
  );
}
