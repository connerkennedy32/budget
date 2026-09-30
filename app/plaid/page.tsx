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
  const [openCategory, setOpenCategory] = useState<string | null>(null);
  const [picker, setPicker] = useState<{ key: string; n: number } | null>(null);
  const [data, setData] = useState<{
    month: string;
    transactions: RawTransaction[];
    accounts: Account[];
    categories: string[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const currentMonth = monthOf(new Date());
  const accounts = useMemo(() => data?.accounts ?? [], [data]);
  // A filter for an account that's no longer listed falls back to "All".
  const activeFilter = accounts.some((a) => a.id === accountFilter) ? accountFilter : "all";
  const accountById = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);
  const accountLabel = (a: Account) =>
    `${a.name.length > 22 ? `${a.name.slice(0, 21)}…` : a.name}${a.mask ? ` ···${a.mask}` : ""}`;
  const transactions = useMemo<Transaction[]>(() => {
    const hidden = new Set(hiddenIds);
    const shown = new Set(shownIds);
    const isHidden = (t: RawTransaction) =>
      shown.has(t.id) ? false : hidden.has(t.id) || t.defaultHidden === true;
    const fromBank = (data?.transactions ?? []).map((t) => {
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
    const shownMonth = data?.month ?? month;
    const mine = manual
      .filter((m) => m.date.startsWith(shownMonth))
      .map((m) => ({
        ...m,
        category: normalizeCategory(m.category),
        isCustom: false,
        hidden: hidden.has(m.id),
        manual: true,
      }));
    // Manual entries belong to no account, so they only show under "All".
    const everything = activeFilter === "all" ? [...fromBank, ...mine] : fromBank.filter((t) => t.accountId === activeFilter);
    return everything.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  }, [data, rules, hiddenIds, shownIds, manual, month, activeFilter]);
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
    const byCategory = new Map<string, { counted: Transaction[]; hidden: Transaction[] }>();
    for (const t of transactions) {
      if (t.amount <= 0 || NON_SPENDING.has(t.category)) continue;
      const group = byCategory.get(t.category) ?? { counted: [], hidden: [] };
      (t.hidden ? group.hidden : group.counted).push(t);
      byCategory.set(t.category, group);
    }
    const sorted = [...byCategory.entries()]
      .map(([name, { counted, hidden }]) => ({
        name,
        countedCount: counted.length,
        hiddenCount: hidden.length,
        // Biggest charges first: that's what you scan a bucket for.
        all: [...counted, ...hidden].sort((a, b) => b.amount - a.amount),
        total: counted.reduce((sum, t) => sum + t.amount, 0),
      }))
      .sort((a, b) => b.total - a.total);
    return {
      totalSpent: sorted.reduce((sum, c) => sum + c.total, 0),
      categories: sorted,
    };
  }, [transactions]);

  // Everything the spending total leaves out, each transaction counted once.
  const notCounted = useMemo(() => {
    const groups = [
      { key: "hidden", one: "hidden", many: "hidden", count: 0, total: 0 },
      { key: "transfer", one: "transfer", many: "transfers", count: 0, total: 0 },
      { key: "income", one: "income deposit", many: "income deposits", count: 0, total: 0 },
      { key: "tithing", one: "tithing payment", many: "tithing payments", count: 0, total: 0 },
      { key: "refund", one: "refund", many: "refunds", count: 0, total: 0 },
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
      else if (t.amount < 0) add("refund", t);
    }
    return groups.filter((g) => g.count > 0);
  }, [transactions]);

  const totalBalance = accounts.reduce(
    (sum, a) => sum + (isLiability(a.type) ? -a.balance : a.balance),
    0
  );

  // Rendered in the full list and inside an expanded category, so a charge
  // can be recategorized or hidden from either place.
  const renderTransaction = (t: Transaction, scope: string) => {
        const credit = t.amount < 0;
        const rowKey = `${scope}:${t.id}`;
    const open = openId === rowKey;
        return (
          <div className="pld-txn-row" key={rowKey}>
            <button
              className={`pld-txn${t.hidden ? " pld-txn-hidden" : ""}`}
              aria-expanded={open}
              onClick={(e) => {
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
                    const expanded = openCategory === c.name;
                    return (
                      <div className="pld-cat" key={c.name}>
                        <button
                          className="pld-cat-btn"
                          aria-expanded={expanded}
                          onClick={() => setOpenCategory(expanded ? null : c.name)}
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
                            {c.all.map((t) => renderTransaction(t, "bucket"))}
                          </div>
                        )}
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
                      <span>{accountLabel(a)}</span>
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
      </div>
    </>
  );
}
