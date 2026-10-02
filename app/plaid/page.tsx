"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePlaidLink } from "react-plaid-link";
import { normalizeCategory } from "@/lib/plaidCategories";

type RawTransaction = {
  id: string;
  date: string;
  name: string;
  amount: number;
  category: string;
  // Present on bank transactions (not manual ones).
  accountId?: string;
  // A card payment that also shows on the card: hidden unless you un-hide it.
  defaultHidden?: boolean;
};

type Transaction = RawTransaction & {
  isCustom: boolean;
  hidden: boolean;
  manual: boolean;
};

// Charges from one merchant within a category, with refunds netted in.
type MerchantGroup = {
  key: string;
  name: string;
  items: Transaction[];
  total: number;
  counted: number;
};

// A subcategory is written "Parent > Child", e.g. "Food and drink > Groceries".
const SUB_SEPARATOR = " > ";
const splitCategory = (name: string): [string, string | null] => {
  const i = name.indexOf(SUB_SEPARATOR);
  return i === -1 ? [name, null] : [name.slice(0, i), name.slice(i + SUB_SEPARATOR.length)];
};

// Entered by hand; the id is prefixed so it can't collide with a Plaid id.
type ManualTransaction = RawTransaction;

// merchant name (lowercase) -> category the user picked for it
type CategoryRules = Record<string, string>;

type Account = {
  id: string;
  name: string;
  mask: string | null;
  type: string;
  balance: number;
  itemId: string;
};

// One connected bank that couldn't be loaded.
type ItemError = { itemId: string; message: string; loginRequired: boolean };

type TransactionsResponse =
  | {
      transactions: RawTransaction[];
      accounts: Account[];
      categories: string[];
      itemErrors: ItemError[];
      duplicateAccounts?: number;
    }
  | { error: string; itemErrors?: ItemError[] };

type StatusResponse = { linked: boolean; count: number; canLink: boolean };

type Status = "loading" | "not_linked" | "linked";

// Money moving between your own accounts, or coming in, isn't spending, and
// tithing is set aside from the budget rather than spent out of it.
const NON_SPENDING = new Set(["Income", "Transfer in", "Transfer out", "Tithing"]);

const NEW_CATEGORY = "__new__";
const RULES_KEY = "plaid-category-rules-v1";
const HIDDEN_KEY = "plaid-hidden-v1";
// Charges you un-hid that would otherwise start hidden (matched card payments).
const SHOWN_KEY = "plaid-shown-v1";
const MANUAL_KEY = "plaid-manual-v1";
const ruleKey = (merchant: string) => merchant.trim().toLowerCase();

// Applies the choices saved on this device (category rules, hidden charges) to
// one month of bank transactions plus any manual entries from that month.
const resolveTransactions = (
  raw: RawTransaction[],
  manual: ManualTransaction[],
  month: string,
  rules: CategoryRules,
  hiddenIds: string[],
  shownIds: string[]
): Transaction[] => {
  const hidden = new Set(hiddenIds);
  const shown = new Set(shownIds);
  const isHidden = (t: RawTransaction) =>
    shown.has(t.id) ? false : hidden.has(t.id) || t.defaultHidden === true;
  const fromBank = raw.map((t) => {
    const stored = rules[ruleKey(t.name)];
    const custom = stored === undefined ? undefined : normalizeCategory(stored);
    return {
      ...t,
      category: custom ?? t.category,
      isCustom: custom !== undefined,
      hidden: isHidden(t),
      manual: false,
    };
  });
  const mine = manual
    .filter((m) => m.date.startsWith(month))
    .map((m) => ({
      ...m,
      category: normalizeCategory(m.category),
      isCustom: false,
      hidden: hidden.has(m.id),
      manual: true,
    }));
  return [...fromBank, ...mine];
};

// The page can load from the service worker's cache after the login has
// expired, so a 401 means "sign in again", not "no bank linked".
const apiFetch = async (url: string, init?: RequestInit) => {
  const res = await fetch(url, init);
  if (res.status === 401) {
    window.location.assign("/login?next=/plaid");
    return new Promise<never>(() => {});
  }
  return res;
};

const readStored = <T,>(key: string, fallback: T): T => {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
};

const writeStored = (key: string, value: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage can be blocked; the change still applies until the page reloads.
  }
};

const isoToday = () => {
  const d = new Date();
  return `${monthOf(d)}-${String(d.getDate()).padStart(2, "0")}`;
};

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
  .pld-cat-btn { display: block; width: 100%; background: none; border: 0; padding: 0;
    color: inherit; font: inherit; text-align: left; cursor: pointer; }
  .pld-cat-btn:focus-visible { outline: 2px solid var(--gold); outline-offset: 4px; border-radius: 6px; }
  .pld-chev { color: var(--gold); display: inline-block; width: 0.9em; }
  .pld-cat-count { color: var(--muted); font-size: 0.8rem; }
  .pld-bucket { margin: 0.5rem 0 0.25rem 0.35rem; padding-left: 0.75rem;
    border-left: 2px solid var(--gold-border); }
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
  .pld-txn-amt-group { display: flex; align-items: center; gap: 0.4rem; }
  .pld-txn-amt-group .pld-chev { width: 0.9em; text-align: center; }
  .pld-merchant-items { margin: 0 0 0.6rem 0.5rem; padding-left: 0.75rem;
    border-left: 2px solid var(--gold-border); }
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
  .pld-catlabel { text-decoration: underline dotted; text-underline-offset: 3px; }
  .pld-catlabel:hover { color: var(--gold); }
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

  .pld-cardhead { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; }
  .pld-cardhead .pld-card-title { margin: 0; }
  .pld-btn-small { padding: 0.5rem 0.9rem; min-height: 40px; font-size: 0.85rem; }
  .pld-filter { margin-bottom: 1rem; }
  .pld-sub { border-bottom: 1px solid var(--border); }
  .pld-sub:last-child { border-bottom: 0; }
  .pld-sub-btn {
    display: flex; justify-content: space-between; align-items: center; width: 100%;
    background: none; border: 0; color: inherit; font: inherit; font-size: 0.95rem;
    padding: 0.7rem 0; cursor: pointer; text-align: left;
  }
  .pld-txn-selected { background: var(--gold-soft); box-shadow: -3px 0 0 var(--gold); }
  .pld-selbar {
    position: fixed; left: 50%; transform: translateX(-50%);
    bottom: max(1rem, env(safe-area-inset-bottom)); z-index: 50;
    display: flex; align-items: center; gap: 1rem;
    background: var(--bg); color: var(--text); border: 1px solid var(--gold);
    border-radius: 18px; padding: 0.5rem 0.6rem 0.5rem 1.1rem;
    flex-wrap: wrap; justify-content: center; max-width: calc(100% - 2rem);
    box-shadow: 0 6px 24px rgba(0, 0, 0, 0.35); font-size: 0.9rem;
  }
  .pld-selbar-select { width: auto; min-height: 40px; padding: 0.4rem 0.6rem; font-size: 0.9rem; }
  .pld-chips { display: flex; flex-wrap: wrap; gap: 0.4rem; margin-bottom: 0.7rem; }
  .pld-chip {
    font: inherit; font-size: 0.85rem; color: var(--text); background: transparent;
    border: 1px solid var(--gold-border); border-radius: 999px;
    padding: 0.4rem 0.8rem; min-height: 36px; cursor: pointer;
  }
  .pld-chip-on { background: var(--gold-soft); border-color: var(--gold); font-weight: 600; }
  .pld-txn-hidden { opacity: 0.45; }
  .pld-txn-hidden .pld-txn-name, .pld-txn-hidden .pld-txn-amt { text-decoration: line-through; }
  .pld-form { display: flex; flex-direction: column; gap: 0.5rem; margin-bottom: 1rem;
    background: var(--gold-soft); border-radius: 10px; padding: 0.6rem; }
  .pld-form-row { display: flex; gap: 0.5rem; }
  .pld-form-row > * { min-width: 0; }
  .pld-form .pld-input { min-height: 40px; padding: 0.45rem 0.6rem; }
  .pld-draft { display: flex; flex-direction: column; gap: 0.4rem; padding-bottom: 0.6rem;
    border-bottom: 1px dashed var(--gold-border); }
  .pld-draft:last-of-type { border-bottom: 0; padding-bottom: 0; }
  .pld-x { flex: 0 0 36px; min-height: 40px; border-radius: 8px; cursor: pointer; font-size: 1.1rem;
    background: transparent; color: var(--muted); border: 1px solid var(--gold-border); }
  .pld-form-actions { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
  .pld-form-actions .pld-editor-note { margin-left: auto; text-align: right; }
  .pld-danger { color: #E8A090; border-color: rgba(192, 84, 58, 0.5); }

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
  onSave,
  onToggleHidden,
  onDelete,
  onCancel,
  pickerToken,
}: {
  txn: Transaction;
  categories: string[];
  onSave: (category: string | null) => void;
  // Changes each time the category label is tapped, to open the picker.
  pickerToken: number;
  onToggleHidden: () => void;
  onDelete?: () => void;
  onCancel: () => void;
}) {
  const [choice, setChoice] = useState(txn.category);
  const [custom, setCustom] = useState("");
  const selectRef = useRef<HTMLSelectElement>(null);

  useEffect(() => {
    if (!pickerToken) return;
    const el = selectRef.current;
    el?.focus();
    try {
      // Not every browser can open a select from code; focus is the fallback.
      el?.showPicker();
    } catch {}
  }, [pickerToken]);

  const options = categories.includes(txn.category)
    ? categories
    : [...categories, txn.category].sort();
  const finalCategory = normalizeCategory(
    (choice === NEW_CATEGORY ? custom.trim() : choice).slice(0, 40)
  );

  return (
    <div className="pld-editor">
      <label htmlFor={`cat-${txn.id}`}>Category for {txn.name}</label>
      <select
        id={`cat-${txn.id}`}
        ref={selectRef}
        className="pld-input"
        value={choice}
        onChange={(e) => {
          const picked = e.target.value;
          setChoice(picked);
          // Opened from the category label: picking one is the whole action.
          if (pickerToken && picked !== NEW_CATEGORY) onSave(picked);
        }}
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
          onKeyDown={(e) => {
            if (e.key === "Enter" && finalCategory) onSave(finalCategory);
          }}
          autoFocus
        />
      )}
      <p className="pld-editor-note">
        {txn.manual
          ? "This applies to this transaction only."
          : `Every ${txn.name} transaction, past and future, will use this category on this device.`}
      </p>
      <div className="pld-editor-actions">
        <button
          className="pld-btn"
          disabled={!finalCategory}
          onClick={() => onSave(finalCategory)}
        >
          Save
        </button>
        {txn.isCustom && (
          <button className="pld-btn pld-btn-quiet" onClick={() => onSave(null)}>
            Reset to default
          </button>
        )}
        <button className="pld-btn pld-btn-quiet" onClick={onToggleHidden}>
          {txn.hidden ? "Show in totals" : "Hide from totals"}
        </button>
        {onDelete && (
          <button className="pld-btn pld-btn-quiet pld-danger" onClick={onDelete}>
            Delete
          </button>
        )}
        <button className="pld-btn pld-btn-quiet" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

type DraftRow = {
  key: string;
  name: string;
  amount: string;
  category: string;
  date: string;
};

function AddTransactionsForm({
  month,
  categories,
  onAdd,
  onDone,
}: {
  month: string;
  categories: string[];
  onAdd: (txns: ManualTransaction[]) => void;
  onDone: () => void;
}) {
  const today = isoToday();
  const defaultDate = today.startsWith(month) ? today : `${month}-01`;
  const [rows, setRows] = useState<DraftRow[]>([
    { key: crypto.randomUUID(), name: "", amount: "", category: "", date: defaultDate },
  ]);

  const [y, m] = month.split("-").map(Number);
  const firstDay = `${month}-01`;
  const lastDay = `${month}-${String(new Date(y, m, 0).getDate()).padStart(2, "0")}`;
  const isBlank = (r: DraftRow) => !r.name.trim() && !r.amount.trim();

  // Editing a row keeps the empty rows below it in step on category and date,
  // and typing into the last row opens another one.
  const update = (key: string, patch: Partial<DraftRow>) =>
    setRows((prev) => {
      const at = prev.findIndex((r) => r.key === key);
      const next = prev.map((r, i) =>
        i === at
          ? { ...r, ...patch }
          : i > at && isBlank(r)
            ? { ...r, category: patch.category ?? r.category, date: patch.date ?? r.date }
            : r
      );
      const last = next[next.length - 1];
      if (!isBlank(last)) {
        next.push({ key: crypto.randomUUID(), name: "", amount: "", category: last.category, date: last.date });
      }
      return next;
    });

  const remove = (key: string) =>
    setRows((prev) => (prev.length > 1 ? prev.filter((r) => r.key !== key) : prev));

  // Typing "food and drink" should land in the existing "Food and drink".
  const canonicalCategory = (typed: string) => {
    const t = typed.trim().slice(0, 40);
    const named = normalizeCategory(t);
    return categories.find((c) => c.toLowerCase() === named.toLowerCase()) ?? named;
  };

  const filled = rows.filter((r) => !isBlank(r));
  const checked = filled.map((r) => {
    const value = Number(r.amount);
    const ok =
      r.name.trim() !== "" &&
      r.amount.trim() !== "" &&
      Number.isFinite(value) &&
      value !== 0 &&
      r.category.trim() !== "" &&
      r.date >= firstDay &&
      r.date <= lastDay;
    return { r, value, ok };
  });
  const incomplete = checked.filter((c) => !c.ok).length;
  const valid = checked.filter((c) => c.ok);

  return (
    <form
      className="pld-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (incomplete > 0 || valid.length === 0) return;
        onAdd(
          valid.map(({ r, value }) => ({
            id: `manual-${crypto.randomUUID()}`,
            date: r.date,
            name: r.name.trim().slice(0, 60),
            amount: value,
            category: canonicalCategory(r.category),
          }))
        );
        onDone();
      }}
    >
      <datalist id="add-categories">
        {categories.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
      {rows.map((r, i) => (
        <div className="pld-draft" key={r.key}>
          <div className="pld-form-row">
            <input
              id={`add-name-${i}`}
              className="pld-input"
              style={{ flex: 1 }}
              aria-label={`Description, row ${i + 1}`}
              placeholder="Description"
              maxLength={60}
              value={r.name}
              onChange={(e) => update(r.key, { name: e.target.value })}
              autoFocus={i === 0}
            />
            <input
              className="pld-input"
              style={{ width: "5.5rem" }}
              aria-label={`Amount, row ${i + 1}`}
              placeholder="Amount"
              inputMode="decimal"
              value={r.amount}
              onChange={(e) => update(r.key, { amount: e.target.value })}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                e.preventDefault();
                document.getElementById(`add-name-${i + 1}`)?.focus();
              }}
            />
            <button
              type="button"
              className="pld-x"
              aria-label={`Remove row ${i + 1}`}
              disabled={rows.length === 1}
              onClick={() => remove(r.key)}
            >
              ×
            </button>
          </div>
          <div className="pld-form-row">
            <input
              className="pld-input"
              style={{ flex: 1 }}
              list="add-categories"
              aria-label={`Category, row ${i + 1}`}
              placeholder="Category (pick or type)"
              maxLength={40}
              value={r.category}
              onChange={(e) => update(r.key, { category: e.target.value })}
            />
            <input
              type="date"
              className="pld-input"
              style={{ flex: "0 0 8.75rem" }}
              aria-label={`Date, row ${i + 1}`}
              value={r.date}
              min={firstDay}
              max={lastDay}
              onChange={(e) => update(r.key, { date: e.target.value })}
            />
          </div>
        </div>
      ))}
      <div className="pld-form-actions">
        <button className="pld-btn pld-btn-small" disabled={valid.length === 0 || incomplete > 0}>
          {valid.length > 0 ? `Add ${valid.length}` : "Add"}
        </button>
        <button type="button" className="pld-btn pld-btn-quiet pld-btn-small" onClick={onDone}>
          Cancel
        </button>
        <span className="pld-editor-note">
          {incomplete > 0
            ? `${incomplete} incomplete row${incomplete > 1 ? "s" : ""}`
            : "Negative amount = refund"}
        </span>
      </div>
    </form>
  );
}

export default function PlaidPage() {
  const [status, setStatus] = useState<Status>("loading");
  const [linkToken, setLinkToken] = useState<string | null>(null);
  // Set when the bank's OAuth site sends the browser back to this page.
  const [receivedRedirectUri, setReceivedRedirectUri] = useState<string | undefined>();
  const [month, setMonth] = useState(() => monthOf(new Date()));
  const [refresh, setRefresh] = useState(0);
  // Read once on the client. Nothing rendered before the data loads depends on it.
  const [rules, setRules] = useState<CategoryRules>(() =>
    readStored<CategoryRules>(RULES_KEY, {})
  );
  const [hiddenIds, setHiddenIds] = useState<string[]>(() =>
    readStored<string[]>(HIDDEN_KEY, [])
  );
  const [shownIds, setShownIds] = useState<string[]>(() =>
    readStored<string[]>(SHOWN_KEY, [])
  );
  const [accountFilter, setAccountFilter] = useState("all");
  const [search, setSearch] = useState("");
  // Months picked for the averages card, and each one's bank transactions
  // (fetched when first picked; keys carry the refresh count so a refresh refetches).
  const [avgMonths, setAvgMonths] = useState<string[]>([]);
  const [monthCache, setMonthCache] = useState<Record<string, RawTransaction[]>>({});
  const [avgError, setAvgError] = useState<string | null>(null);
  const [itemErrors, setItemErrors] = useState<ItemError[]>([]);
  const [connections, setConnections] = useState({ count: 0, canLink: false });
  // Set while Link is re-authenticating an existing connection rather than
  // adding one. A ref as well, because Link's callbacks are created once.
  const [updatingItem, setUpdatingItem] = useState<string | null>(null);
  const updatingRef = useRef<string | null>(null);
  const [manual, setManual] = useState<ManualTransaction[]>(() =>
    readStored<ManualTransaction[]>(MANUAL_KEY, [])
  );
  const [adding, setAdding] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [openCategories, setOpenCategories] = useState<string[]>([]);
  const [openMerchants, setOpenMerchants] = useState<string[]>([]);
  // Rows picked for a running total (shift/cmd/ctrl-click, or any tap once
  // something is picked). The anchor is where a shift-click range starts.
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [anchor, setAnchor] = useState<{ scope: string; id: string } | null>(null);
  const [bulkChoice, setBulkChoice] = useState("");
  const [bulkCustom, setBulkCustom] = useState("");
  const [picker, setPicker] = useState<{ key: string; n: number } | null>(null);
  const [data, setData] = useState<{
    month: string;
    transactions: RawTransaction[];
    accounts: Account[];
    categories: string[];
    duplicateAccounts?: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const currentMonth = monthOf(new Date());
  const accounts = useMemo(() => data?.accounts ?? [], [data]);
  // A filter for an account that's no longer listed falls back to "All".
  const activeFilter = accounts.some((a) => a.id === accountFilter) ? accountFilter : "all";
  const accountById = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);
  // Plaid's names can end in "...6954" (the digits are shown separately) and
  // contain broken characters where a ® was.
  const accountLabel = (a: Account) => {
    const name = a.name
      .replace(/\uFFFD+/g, "")
      .replace(/\s*\.{3}\d+\s*$/, "")
      .replace(/\s+/g, " ")
      .trim();
    return `${name.length > 28 ? `${name.slice(0, 27)}…` : name}${a.mask ? ` ···${a.mask}` : ""}`;
  };
  const transactions = useMemo<Transaction[]>(() => {
    const all = resolveTransactions(
      data?.transactions ?? [],
      manual,
      data?.month ?? month,
      rules,
      hiddenIds,
      shownIds
    );
    // Manual entries belong to no account, so they only show under "All".
    const everything = activeFilter === "all" ? all : all.filter((t) => t.accountId === activeFilter);
    return everything.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  }, [data, rules, hiddenIds, shownIds, manual, month, activeFilter]);
  // Logged once per page load so the choices made on this device can be pasted
  // somewhere and turned into rules in code. Hidden/shown charges are listed
  // with their name, date and amount, since the bare ids mean nothing.
  const configLogged = useRef(false);
  useEffect(() => {
    if (!data || configLogged.current) return;
    configLogged.current = true;
    const describe = (ids: string[]) =>
      ids.map((id) => {
        const t = data.transactions.find((x) => x.id === id) ?? manual.find((x) => x.id === id);
        return t ? { id, name: t.name, date: t.date, amount: t.amount } : { id };
      });
    console.log(
      "Plaid custom config:\n" +
        JSON.stringify(
          { rules, hidden: describe(hiddenIds), shown: describe(shownIds), manual },
          null,
          2
        )
    );
  }, [data, rules, hiddenIds, shownIds, manual]);

  const categoryOptions = useMemo(
    () =>
      [
        ...new Set([
          ...(data?.categories ?? []),
          ...Object.values(rules).map(normalizeCategory),
          ...manual.map((m) => normalizeCategory(m.category)),
        ]),
      ].sort(),
    [data, rules, manual]
  );

  const saveRule = (merchant: string, category: string | null) => {
    const next = { ...rules };
    if (category === null) delete next[ruleKey(merchant)];
    else next[ruleKey(merchant)] = normalizeCategory(category);
    setRules(next);
    writeStored(RULES_KEY, next);
    setOpenId(null);
  };

  // Hidden starts from the charge's default (matched card payments start
  // hidden) and is overridden by anything you chose yourself.
  const toggleHidden = (t: Transaction) => {
    let nextHidden = hiddenIds.filter((h) => h !== t.id);
    let nextShown = shownIds.filter((s) => s !== t.id);
    if (t.hidden) {
      if (t.defaultHidden) nextShown = [...nextShown, t.id];
    } else {
      nextHidden = [...nextHidden, t.id];
    }
    setHiddenIds(nextHidden);
    setShownIds(nextShown);
    writeStored(HIDDEN_KEY, nextHidden);
    writeStored(SHOWN_KEY, nextShown);
    setOpenId(null);
  };

  const saveManual = (next: ManualTransaction[]) => {
    setManual(next);
    writeStored(MANUAL_KEY, next);
  };

  const deleteManual = (id: string) => {
    saveManual(manual.filter((m) => m.id !== id));
    const nextHidden = hiddenIds.filter((h) => h !== id);
    setHiddenIds(nextHidden);
    writeStored(HIDDEN_KEY, nextHidden);
    setOpenId(null);
  };
  const loading = status === "linked" && data?.month !== month && !error;

  const checkStatus = useCallback(async () => {
    const res = await apiFetch("/api/plaid/status");
    const data = (await res.json()) as StatusResponse;
    setConnections({ count: data.count, canLink: data.canLink });
    setStatus(data.linked ? "linked" : "not_linked");
  }, []);

  useEffect(() => {
    apiFetch("/api/plaid/status")
      .then((res) => res.json() as Promise<StatusResponse>)
      .then((data) => {
        setConnections({ count: data.count, canLink: data.canLink });
        setStatus(data.linked ? "linked" : "not_linked");
      });
  }, []);

  useEffect(() => {
    if (status !== "linked") return;
    let stale = false;
    apiFetch(`/api/plaid/transactions?month=${month}`)
      .then((res) => res.json() as Promise<TransactionsResponse>)
      .then((json) => {
        if (stale) return;
        setItemErrors(json.itemErrors ?? []);
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

  useEffect(() => {
    if (status !== "linked") return;
    const missing = avgMonths.filter((m) => !monthCache[`${refresh}:${m}`]);
    if (missing.length === 0) return;
    let stale = false;
    Promise.all(
      missing.map(async (m) => {
        const res = await apiFetch(`/api/plaid/transactions?month=${m}`);
        const json = (await res.json()) as TransactionsResponse;
        if ("error" in json) throw new Error(json.error);
        return [`${refresh}:${m}`, json.transactions] as const;
      })
    )
      .then((entries) => {
        if (stale) return;
        setAvgError(null);
        setMonthCache((c) => ({ ...c, ...Object.fromEntries(entries) }));
      })
      .catch((e: unknown) => {
        if (!stale) setAvgError(e instanceof Error ? e.message : "Couldn't load those months.");
      });
    return () => {
      stale = true;
    };
  }, [status, avgMonths, monthCache, refresh]);

  // With an itemId, re-authenticates that connection (no new Plaid slot).
  const fetchLinkToken = useCallback(async (itemId?: string) => {
    setError(null);
    const res = await fetch("/api/plaid/link-token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(itemId ? { itemId } : {}),
    });
    const data = (await res.json()) as
      | { linkToken: string }
      | { error: string };
    if ("error" in data) {
      setError(data.error);
      return;
    }
    updatingRef.current = itemId ?? null;
    setUpdatingItem(itemId ?? null);
    setLinkToken(data.linkToken);
  }, []);

  // Ask the server whether a sign-in finished that the browser never reported.
  const recover = useCallback(async () => {
    const res = await fetch("/api/plaid/recover", { method: "POST" });
    const data = (await res.json()) as { recovered?: boolean };
    if (data.recovered) {
      await checkStatus();
      setRefresh((n) => n + 1);
    }
  }, [checkStatus]);

  const { open, ready } = usePlaidLink({
    token: linkToken,
    receivedRedirectUri,
    onSuccess: async (publicToken) => {
      if (updatingRef.current) {
        // Re-authenticated an existing connection: same token, nothing to exchange.
        updatingRef.current = null;
        setUpdatingItem(null);
        setLinkToken(null);
        setReceivedRedirectUri(undefined);
        window.history.replaceState(null, "", "/plaid");
        setError(null);
        setRefresh((n) => n + 1);
        return;
      }
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
      setReceivedRedirectUri(undefined);
      window.history.replaceState(null, "", "/plaid");
      await checkStatus();
      setRefresh((n) => n + 1);
    },
    onExit: (err, metadata) => {
      console.info("plaid link exit", err, metadata);
      setLinkToken(null);
      setReceivedRedirectUri(undefined);
      updatingRef.current = null;
      setUpdatingItem(null);
      window.history.replaceState(null, "", "/plaid");
      recover();
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

  // Coming back from a bank's own sign-in page: resume the same Link session.
  // Otherwise, finish any sign-in the browser lost track of (with nothing
  // pending, the server just says no).
  useEffect(() => {
    if (status === "loading") return;
    if (window.location.search.includes("oauth_state_id")) {
      fetch("/api/plaid/link-token")
        .then((res) => res.json() as Promise<{ linkToken?: string | null; itemId?: string | null }>)
        .then((json) => {
          if (json.linkToken) {
            updatingRef.current = json.itemId ?? null;
            setUpdatingItem(json.itemId ?? null);
            setReceivedRedirectUri(window.location.href);
            setLinkToken(json.linkToken);
          }
        });
      return;
    }
    fetch("/api/plaid/recover", { method: "POST" })
      .then((res) => res.json() as Promise<{ recovered?: boolean }>)
      .then((json) => {
        if (!json.recovered) return;
        setStatus("linked");
        setRefresh((n) => n + 1);
      });
  }, [status]);

  useEffect(() => {
    if (linkToken && ready) {
      open();
    }
  }, [linkToken, ready, open]);

  const { totalSpent, categories } = useMemo(() => {
    // A hidden charge stays in its bucket (crossed out) but adds nothing to it.
    // Credits (refunds) net against the charges, and charges from the same
    // merchant collapse into one line that expands to the individual ones.
    type Merchant = MerchantGroup;
    const byCategory = new Map<string, Map<string, Merchant>>();
    for (const t of transactions) {
      if (NON_SPENDING.has(t.category)) continue;
      const merchants = byCategory.get(t.category) ?? new Map<string, Merchant>();
      const key = ruleKey(t.name);
      const m = merchants.get(key) ?? { key, name: t.name, items: [], total: 0, counted: 0 };
      m.items.push(t);
      if (!t.hidden) {
        m.total += t.amount;
        m.counted += 1;
      }
      merchants.set(key, m);
      byCategory.set(t.category, merchants);
    }
    const sorted = [...byCategory.entries()]
      .map(([name, merchants]) => {
        const list = [...merchants.values()]
          .map((m) => ({
            ...m,
            // Biggest charges first: that's what you scan a merchant for.
            items: m.items.sort((a, b) => b.amount - a.amount),
          }))
          .sort((a, b) => b.total - a.total);
        return {
          name,
          merchants: list,
          countedCount: list.reduce((sum, m) => sum + m.counted, 0),
          hiddenCount: list.reduce((sum, m) => sum + m.items.length - m.counted, 0),
          total: list.reduce((sum, m) => sum + m.total, 0),
        };
      })
      .sort((a, b) => b.total - a.total);
    // Subcategories roll up into their parent. A parent that only has charges of
    // its own (no subcategories) is shown as before.
    const parents = new Map<string, typeof sorted>();
    for (const c of sorted) {
      const parent = splitCategory(c.name)[0];
      parents.set(parent, [...(parents.get(parent) ?? []), c]);
    }
    const groups = [...parents.entries()]
      .map(([name, entries]) => {
        const plain = entries.length === 1 && splitCategory(entries[0].name)[1] === null;
        return {
          name,
          total: entries.reduce((sum, c) => sum + c.total, 0),
          countedCount: entries.reduce((sum, c) => sum + c.countedCount, 0),
          hiddenCount: entries.reduce((sum, c) => sum + c.hiddenCount, 0),
          merchants: plain ? entries[0].merchants : [],
          subs: plain
            ? []
            : entries.map((c) => ({ ...c, label: splitCategory(c.name)[1] ?? "Other" })),
        };
      })
      .sort((a, b) => b.total - a.total);
    return {
      totalSpent: sorted.reduce((sum, c) => sum + c.total, 0),
      categories: groups,
    };
  }, [transactions]);

  // Everything the spending total leaves out, each transaction counted once.
  const notCounted = useMemo(() => {
    const groups = [
      { key: "hidden", one: "hidden", many: "hidden", count: 0, total: 0 },
      { key: "transfer", one: "transfer", many: "transfers", count: 0, total: 0 },
      { key: "income", one: "income deposit", many: "income deposits", count: 0, total: 0 },
      { key: "tithing", one: "tithing payment", many: "tithing payments", count: 0, total: 0 },
    ];
    const add = (key: string, t: Transaction) => {
      const g = groups.find((x) => x.key === key)!;
      g.count += 1;
      g.total += Math.abs(t.amount);
    };
    for (const t of transactions) {
      if (t.hidden) add("hidden", t);
      else if (t.category === "Transfer in" || t.category === "Transfer out") add("transfer", t);
      else if (t.category === "Income") add("income", t);
      else if (t.category === "Tithing") add("tithing", t);
    }
    return groups.filter((g) => g.count > 0);
  }, [transactions]);

  // Per-category spending averaged over the picked months. A month with no
  // spending in a category counts as zero, so the numbers are "per month".
  const averages = useMemo(() => {
    const loaded = avgMonths.filter((m) => monthCache[`${refresh}:${m}`]);
    if (loaded.length === 0) return null;
    const totals = new Map<string, number>();
    for (const m of loaded) {
      const all = resolveTransactions(monthCache[`${refresh}:${m}`], manual, m, rules, hiddenIds, shownIds);
      for (const t of all) {
        if (t.hidden || NON_SPENDING.has(t.category)) continue;
        if (activeFilter !== "all" && t.accountId !== activeFilter) continue;
        totals.set(t.category, (totals.get(t.category) ?? 0) + t.amount);
      }
    }
    const rows = [...totals.entries()]
      .map(([name, sum]) => ({ name, avg: sum / loaded.length }))
      .sort((a, b) => b.avg - a.avg);
    return { rows, total: rows.reduce((sum, r) => sum + r.avg, 0), count: loaded.length };
  }, [avgMonths, monthCache, refresh, manual, rules, hiddenIds, shownIds, activeFilter]);
  const avgLoading = avgMonths.some((m) => !monthCache[`${refresh}:${m}`]) && !avgError;

  // Charges whose name contains the search text, for "how much at Costco".
  // Hidden ones are listed (crossed out) but add nothing; refunds net out.
  const searchResults = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return null;
    const matches = transactions.filter((t) => t.name.toLowerCase().includes(q));
    return {
      matches,
      total: matches.reduce((sum, t) => sum + (t.hidden ? 0 : t.amount), 0),
    };
  }, [transactions, search]);

  const totalBalance = accounts.reduce(
    (sum, a) => sum + (isLiability(a.type) ? -a.balance : a.balance),
    0
  );

  // Rendered in the full list and inside an expanded category, so a charge
  // can be recategorized or hidden from either place.
  const renderMerchants = (merchants: MerchantGroup[], catKey: string) => (
    <>
      {merchants.map((m) => {
                              if (m.items.length === 1) return renderTransaction(m.items[0], "bucket");
                              const mKey = `${catKey}:${m.key}`;
                              const mOpen = openMerchants.includes(mKey);
                              return (
                                <div className="pld-txn-row" key={mKey}>
                                  <button
                                    className="pld-txn"
                                    aria-expanded={mOpen}
                                    onClick={() =>
                                      setOpenMerchants(
                                        mOpen
                                          ? openMerchants.filter((x) => x !== mKey)
                                          : [...openMerchants, mKey]
                                      )
                                    }
                                  >
                                    <div className="pld-txn-main">
                                      <div className="pld-txn-name">{m.name}</div>
                                      <div className="pld-txn-meta">
                                        {m.items.length} transactions
                                      </div>
                                    </div>
                                    <span className="pld-txn-amt-group">
                                      <span className="pld-mono pld-txn-amt">
                                        {formatMoney(m.total)}
                                      </span>
                                      <span className="pld-chev" aria-hidden>
                                        {mOpen ? "▾" : "▸"}
                                      </span>
                                    </span>
                                  </button>
                                  {mOpen && (
                                    <div className="pld-merchant-items">
                                      {m.items.map((t) => renderTransaction(t, "bucket"))}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
    </>
  );

  const selection = useMemo(() => {
    const ids = new Set(selectedIds);
    const picked = transactions.filter((t) => ids.has(t.id));
    return { ids, count: picked.length, total: picked.reduce((sum, t) => sum + t.amount, 0) };
  }, [selectedIds, transactions]);

  const clearSelection = () => {
    setSelectedIds([]);
    setAnchor(null);
    setBulkChoice("");
    setBulkCustom("");
  };

  const picked = transactions.filter((t) => selection.ids.has(t.id));
  const allPickedHidden = picked.length > 0 && picked.every((t) => t.hidden);

  // Hides every picked charge, or, if they're all hidden already, shows them.
  // Matched card payments start hidden, so showing one is recorded explicitly.
  const setPickedHidden = (hide: boolean) => {
    const ids = new Set(picked.map((t) => t.id));
    const nextHidden = hiddenIds.filter((h) => !ids.has(h));
    const nextShown = shownIds.filter((x) => !ids.has(x));
    for (const t of picked) {
      if (hide) nextHidden.push(t.id);
      else if (t.defaultHidden) nextShown.push(t.id);
    }
    setHiddenIds(nextHidden);
    setShownIds(nextShown);
    writeStored(HIDDEN_KEY, nextHidden);
    writeStored(SHOWN_KEY, nextShown);
    clearSelection();
  };

  // Bank charges are categorized by merchant, so this sets the rule for each
  // picked merchant (it applies to their other charges too). Manual entries
  // carry their own category.
  const setPickedCategory = (category: string) => {
    const name = normalizeCategory(category.trim().slice(0, 40));
    if (!name) return;
    const nextRules = { ...rules };
    for (const t of picked) if (!t.manual) nextRules[ruleKey(t.name)] = name;
    setRules(nextRules);
    writeStored(RULES_KEY, nextRules);
    const manualIds = new Set(picked.filter((t) => t.manual).map((t) => t.id));
    if (manualIds.size > 0) {
      saveManual(manual.map((m) => (manualIds.has(m.id) ? { ...m, category: name } : m)));
    }
    clearSelection();
  };

  const toggleSelected = (id: string) =>
    setSelectedIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));

  // A shift-click picks every visible row of this list between the anchor and
  // the clicked row, in the order they appear on screen.
  const selectRange = (scope: string, id: string) => {
    const rows = [...document.querySelectorAll<HTMLElement>(`[data-scope="${scope}"]`)];
    const ids = rows.map((r) => r.dataset.txnId as string);
    const from = anchor?.scope === scope ? ids.indexOf(anchor.id) : -1;
    const to = ids.indexOf(id);
    if (from === -1 || to === -1) {
      toggleSelected(id);
    } else {
      const [lo, hi] = from < to ? [from, to] : [to, from];
      setSelectedIds((cur) => [...new Set([...cur, ...ids.slice(lo, hi + 1)])]);
    }
    setAnchor({ scope, id });
  };

  const renderTransaction = (t: Transaction, scope: string) => {
        const credit = t.amount < 0;
        const rowKey = `${scope}:${t.id}`;
    const open = openId === rowKey;
        return (
          <div
            className={`pld-txn-row${selection.ids.has(t.id) ? " pld-txn-selected" : ""}`}
            key={rowKey}
            data-scope={scope}
            data-txn-id={t.id}
          >
            <button
              className={`pld-txn${t.hidden ? " pld-txn-hidden" : ""}`}
              aria-expanded={open}
              // Keeps a shift-click from also highlighting text.
              onMouseDown={(e) => {
                if (e.shiftKey) e.preventDefault();
              }}
              onClick={(e) => {
          if (e.shiftKey) return selectRange(scope, t.id);
          if (e.metaKey || e.ctrlKey || selection.count > 0) {
            toggleSelected(t.id);
            setAnchor({ scope, id: t.id });
            return;
          }
          // Tapping the category label goes straight to the category picker.
          if ((e.target as HTMLElement).closest("[data-category]")) {
            setOpenId(rowKey);
            setPicker((p) => ({ key: rowKey, n: (p?.n ?? 0) + 1 }));
            return;
          }
          setPicker(null);
          setOpenId(open ? null : rowKey);
        }}
            >
              <div className="pld-txn-main">
                <div className="pld-txn-name">{t.name}</div>
                <div className="pld-txn-meta">
                  {formatDate(t.date)} ·{" "}
                  <span
                className={`pld-catlabel${t.isCustom ? " pld-tag" : ""}`}
                data-category
              >
                    {t.category}
                  </span>
                  {accounts.length > 1 && t.accountId && accountById.get(t.accountId) &&
                    ` · ${accountLabel(accountById.get(t.accountId)!)}`}
                  {t.manual && " · Added by you"}
                  {t.hidden && (t.defaultHidden ? " · Hidden (card payment)" : " · Hidden")}
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
                pickerToken={picker?.key === rowKey ? picker.n : 0}
                categories={categoryOptions}
                onSave={(category) => {
                  if (!t.manual) return saveRule(t.name, category);
                  saveManual(
                    manual.map((m) =>
                      m.id === t.id && category ? { ...m, category } : m
                    )
                  );
                  setOpenId(null);
                }}
                onToggleHidden={() => toggleHidden(t)}
                onDelete={t.manual ? () => deleteManual(t.id) : undefined}
                onCancel={() => setOpenId(null)}
              />
            )}
          </div>
        );
  };

  return (
    <>
      <style>{CSS}</style>
      <div className="pld flex-1 overflow-auto">
        <div className="pld-inner">
          {itemErrors.map((e) => (
            <div className="pld-error" role="alert" key={e.itemId}>
              <span>{e.message}</span>
              {e.loginRequired &&
                (connections.canLink || updatingItem === e.itemId ? (
                  <button
                    className="pld-btn pld-btn-quiet"
                    disabled={updatingItem === e.itemId}
                    onClick={() => fetchLinkToken(e.itemId)}
                  >
                    Reconnect
                  </button>
                ) : (
                  <span className="pld-muted">
                    Open this app on your computer to reconnect it.
                  </span>
                ))}
            </div>
          ))}

          {error && itemErrors.length === 0 && (
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
              <button className="pld-btn" onClick={() => fetchLinkToken()}>
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

              {accounts.length > 1 && (
                <select
                  className="pld-input pld-filter"
                  aria-label="Show transactions from"
                  value={activeFilter}
                  onChange={(e) => setAccountFilter(e.target.value)}
                >
                  <option value="all">All accounts</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {accountLabel(a)}
                    </option>
                  ))}
                </select>
              )}

              <input
                className="pld-input pld-filter"
                type="search"
                aria-label="Search transactions"
                placeholder="Search this month, e.g. Costco"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              {searchResults && (
                <section className="pld-card">
                  <h2 className="pld-card-title">
                    “{search.trim()}” in {monthLabel(month)}
                  </h2>
                  {searchResults.matches.length === 0 ? (
                    <p className="pld-muted">No matching transactions.</p>
                  ) : (
                    <>
                      <p className="pld-spent pld-serif" style={{ fontSize: "2rem" }}>
                        {formatMoney(searchResults.total)}
                      </p>
                      <p className="pld-muted">
                        {searchResults.matches.length}{" "}
                        {searchResults.matches.length === 1 ? "transaction" : "transactions"}
                      </p>
                      {searchResults.matches.map((t) => renderTransaction(t, "search"))}
                    </>
                  )}
                </section>
              )}

              <div className={loading ? "pld-loading" : undefined} aria-busy={loading}>
              <header className="pld-hero">
                <h1 className="pld-title">
                  {month === currentMonth ? "Spent so far this month" : "Spent this month"}
                </h1>
                <p className="pld-spent pld-serif">{formatMoney(totalSpent)}</p>
                {notCounted.length > 0 && (
                  <p className="pld-hero-sub">
                    Not counted:{" "}
                    {notCounted
                      .map(
                        (g) =>
                          `${g.count} ${g.count === 1 ? g.one : g.many} (${formatMoney(g.total)})`
                      )
                      .join(", ")}
                  </p>
                )}
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
                    const pct = totalSpent > 0 ? (c.total / totalSpent) * 100 : 0;
                    const expanded = openCategories.includes(c.name);
                    return (
                      <div className="pld-cat" key={c.name}>
                        <button
                          className="pld-cat-btn"
                          aria-expanded={expanded}
                          onClick={() =>
                            setOpenCategories(
                              expanded
                                ? openCategories.filter((n) => n !== c.name)
                                : [...openCategories, c.name]
                            )
                          }
                        >
                          <div className="pld-cat-head">
                            <span>
                              <span className="pld-chev" aria-hidden>
                                {expanded ? "▾" : "▸"}
                              </span>{" "}
                              {c.name}
                              <span className="pld-cat-count">
                                {c.countedCount > 0 && ` · ${c.countedCount}`}
                                {c.hiddenCount > 0 &&
                                  `${c.countedCount > 0 ? "," : " ·"} ${c.hiddenCount} hidden`}
                              </span>
                            </span>
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
                        </button>
                        {expanded && (
                          <div className="pld-bucket">
                            {c.subs.length === 0 ? (
                              renderMerchants(c.merchants, c.name)
                            ) : (
                              c.subs.map((sub) => {
                                // Prefixed so "Other" (named after its parent) has its own open state.
                                const subKey = `sub:${sub.name}`;
                                const subOpen = openCategories.includes(subKey);
                                return (
                                  <div className="pld-sub" key={sub.name}>
                                    <button
                                      className="pld-sub-btn"
                                      aria-expanded={subOpen}
                                      onClick={() =>
                                        setOpenCategories(
                                          subOpen
                                            ? openCategories.filter((n) => n !== subKey)
                                            : [...openCategories, subKey]
                                        )
                                      }
                                    >
                                      <span>
                                        {sub.label}
                                        <span className="pld-cat-count">
                                          {sub.countedCount > 0 && ` · ${sub.countedCount}`}
                                          {sub.hiddenCount > 0 &&
                                            `${sub.countedCount > 0 ? "," : " ·"} ${sub.hiddenCount} hidden`}
                                        </span>
                                      </span>
                                      <span className="pld-txn-amt-group">
                                        <span className="pld-mono">{formatMoney(sub.total)}</span>
                                        <span className="pld-chev" aria-hidden>
                                          {subOpen ? "▾" : "▸"}
                                        </span>
                                      </span>
                                    </button>
                                    {subOpen && (
                                      <div className="pld-bucket">
                                        {renderMerchants(sub.merchants, sub.name)}
                                      </div>
                                    )}
                                  </div>
                                );
                              })
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </section>

              <section className="pld-card">
                <h2 className="pld-card-title">Monthly averages</h2>
                <p className="pld-muted" style={{ marginTop: 0 }}>
                  Pick months to see what you spend per month in each category.
                </p>
                <div className="pld-chips">
                  {Array.from({ length: 12 }, (_, i) => shiftMonth(currentMonth, -i)).map((m) => {
                    const on = avgMonths.includes(m);
                    return (
                      <button
                        key={m}
                        className={`pld-chip${on ? " pld-chip-on" : ""}`}
                        aria-pressed={on}
                        onClick={() =>
                          setAvgMonths(on ? avgMonths.filter((x) => x !== m) : [...avgMonths, m])
                        }
                      >
                        {new Date(Number(m.slice(0, 4)), Number(m.slice(5)) - 1, 1).toLocaleDateString(
                          "en-US",
                          { month: "short", year: "2-digit" }
                        )}
                      </button>
                    );
                  })}
                </div>
                <div className="pld-chips">
                  {[3, 6, 12].map((n) => (
                    <button
                      key={n}
                      className="pld-btn pld-btn-quiet pld-btn-small"
                      onClick={() =>
                        setAvgMonths(Array.from({ length: n }, (_, i) => shiftMonth(currentMonth, -(i + 1))))
                      }
                    >
                      Last {n} full months
                    </button>
                  ))}
                  {avgMonths.length > 0 && (
                    <button
                      className="pld-btn pld-btn-quiet pld-btn-small"
                      onClick={() => setAvgMonths([])}
                    >
                      Clear
                    </button>
                  )}
                </div>
                {avgError && <p className="pld-muted">{avgError}</p>}
                {avgLoading && <p className="pld-muted">Loading months…</p>}
                {avgMonths.includes(currentMonth) && (
                  <p className="pld-editor-note">
                    This month isn’t over, so it pulls the averages down.
                  </p>
                )}
                {averages && (
                  <div style={{ marginTop: "0.9rem" }}>
                    <p className="pld-title">
                      Average per month over {averages.count}{" "}
                      {averages.count === 1 ? "month" : "months"}
                    </p>
                    <p className="pld-spent pld-serif" style={{ fontSize: "2rem" }}>
                      {formatMoney(averages.total)}
                    </p>
                    {averages.rows.map((r) => {
                      const pct = averages.total > 0 ? (r.avg / averages.total) * 100 : 0;
                      return (
                        <div className="pld-cat" key={r.name}>
                          <div className="pld-cat-head">
                            <span>{r.name}</span>
                            <span className="pld-cat-amt">
                              <span className="pld-mono">{formatMoney(r.avg)}</span>
                              <span className="pld-mono pld-cat-pct">{Math.round(pct)}%</span>
                            </span>
                          </div>
                          <div className="pld-track">
                            <div className="pld-bar" style={{ width: `${pct}%` }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>

              <section className="pld-card">
                <div className="pld-cardhead">
                  <h2 className="pld-card-title">Transactions</h2>
                  {!adding && (
                    <button
                      className="pld-btn pld-btn-quiet pld-btn-small"
                      onClick={() => setAdding(true)}
                    >
                      Add transaction
                    </button>
                  )}
                </div>
                {adding && (
                  <AddTransactionsForm
                    month={data?.month ?? month}
                    categories={categoryOptions}
                    onAdd={(txns) => saveManual([...manual, ...txns])}
                    onDone={() => setAdding(false)}
                  />
                )}
                {transactions.length === 0 && !error && (
                  <p className="pld-muted">No transactions in {monthLabel(month)}.</p>
                )}
                {transactions.map((t) => renderTransaction(t, "all"))}
              </section>
              </div>

              {connections.canLink && (
                <button className="pld-btn pld-btn-quiet" onClick={() => fetchLinkToken()}>
                  Add an account ({connections.count} connected)
                </button>
              )}
            </>
          )}
        </div>
        {selection.count > 0 && (
          <div className="pld-selbar" role="status">
            <span>{selection.count} selected</span>
            <strong className="pld-mono">{formatMoney(selection.total)}</strong>
            <button
              className="pld-btn pld-btn-quiet pld-btn-small"
              onClick={() => setPickedHidden(!allPickedHidden)}
            >
              {allPickedHidden ? "Show all" : "Hide all"}
            </button>
            <select
              className="pld-input pld-selbar-select"
              aria-label="Set category for all selected"
              value={bulkChoice}
              onChange={(e) => {
                const v = e.target.value;
                if (v === NEW_CATEGORY || v === "") setBulkChoice(v);
                else setPickedCategory(v);
              }}
            >
              <option value="">Set category…</option>
              {categoryOptions.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
              <option value={NEW_CATEGORY}>New category…</option>
            </select>
            {bulkChoice === NEW_CATEGORY && (
              <>
                <input
                  className="pld-input pld-selbar-select"
                  aria-label="New category name"
                  placeholder="Category name"
                  maxLength={40}
                  value={bulkCustom}
                  onChange={(e) => setBulkCustom(e.target.value)}
                />
                <button
                  className="pld-btn pld-btn-small"
                  disabled={bulkCustom.trim() === ""}
                  onClick={() => setPickedCategory(bulkCustom)}
                >
                  Apply
                </button>
              </>
            )}
            <button className="pld-btn pld-btn-quiet pld-btn-small" onClick={clearSelection}>
              Clear
            </button>
          </div>
        )}
      </div>
    </>
  );
}
