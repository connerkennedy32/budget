# Plaid Transactions Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Plaid" tab to the budget app that shows the last 30 days of transactions from one linked bank account, starting against Plaid Sandbox.

**Architecture:** Server-side Plaid client + a flat gitignored JSON file for the single stored access token, four Route Handlers under `app/api/plaid/`, and a client page at `/plaid` that walks the user through linking (via `react-plaid-link`) then displays transactions.

**Tech Stack:** Next.js 16 App Router (Route Handlers), React 19, `plaid` (server SDK, v47), `react-plaid-link` (v5, client hook), existing shadcn-style UI components (`components/ui/*`).

**Spec:** `docs/superpowers/specs/2026-09-29-plaid-transactions-design.md`

## Global Constraints

- No database — credentials persist in `.plaid/data.json`, gitignored, never committed.
- No client-side caching of transactions — fetch fresh from Plaid on every page load (confirmed free: Plaid bills per linked Item/month, not per call).
- Build against Plaid **Sandbox** (`PLAID_ENV=sandbox`); switching to Production later must require only an env change.
- No automated test suite exists in this repo and this feature does not introduce one — every task is verified manually (curl for API routes, browser for UI), per the spec.
- One linked Item only; no multi-account UI, no un-link UI, no webhooks/background sync.

---

### Task 1: Install dependencies and scaffold env/gitignore

**Files:**
- Modify: `package.json` (via npm install)
- Modify: `.gitignore`
- Create: `.env.local.example`

**Interfaces:**
- Produces: `PLAID_CLIENT_ID`, `PLAID_SECRET`, `PLAID_ENV` env vars that Task 2 reads; `.plaid/` directory ignored by git for Task 3's store file.

- [ ] **Step 1: Install the Plaid packages**

Run: `npm install plaid react-plaid-link`

- [ ] **Step 2: Add `.plaid/` to `.gitignore`**

Append to `.gitignore`:

```
# plaid
/.plaid/
```

- [ ] **Step 3: Create an env example file**

Create `.env.local.example`:

```
# Get these from https://dashboard.plaid.com/developers/keys
PLAID_CLIENT_ID=
PLAID_SECRET=
PLAID_ENV=sandbox
```

- [ ] **Step 4: Create your real `.env.local` (not committed) with your Sandbox keys**

Copy `.env.local.example` to `.env.local` and fill in your actual Sandbox `client_id`/`secret` from the Plaid dashboard. This file is already covered by the repo's existing `.env*` gitignore rule.

- [ ] **Step 5: Verify nothing sensitive is staged**

Run: `git status`
Expected: only `package.json`, `package-lock.json`, `.gitignore`, `.env.local.example` show as changed — `.env.local` must NOT appear.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json .gitignore .env.local.example
git commit -m "chore: add plaid and react-plaid-link dependencies"
```

---

### Task 2: Plaid API client

**Files:**
- Create: `lib/plaid.ts`

**Interfaces:**
- Consumes: `PLAID_CLIENT_ID`, `PLAID_SECRET`, `PLAID_ENV` from `process.env` (Task 1).
- Produces: `plaidClient: PlaidApi` — a configured Plaid client instance, imported by every route handler in Tasks 4-7.

- [ ] **Step 1: Write `lib/plaid.ts`**

```ts
import { Configuration, PlaidApi, PlaidEnvironments } from "plaid";

const env = process.env.PLAID_ENV ?? "sandbox";

const configuration = new Configuration({
  basePath: PlaidEnvironments[env as keyof typeof PlaidEnvironments],
  baseOptions: {
    headers: {
      "PLAID-CLIENT-ID": process.env.PLAID_CLIENT_ID,
      "PLAID-SECRET": process.env.PLAID_SECRET,
    },
  },
});

export const plaidClient = new PlaidApi(configuration);
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors referencing `lib/plaid.ts`.

- [ ] **Step 3: Commit**

```bash
git add lib/plaid.ts
git commit -m "feat: add plaid api client"
```

---

### Task 3: Local credential store

**Files:**
- Create: `lib/plaidStore.ts`

**Interfaces:**
- Produces:
  - `type PlaidCredentials = { accessToken: string; itemId: string }`
  - `getPlaidCredentials(): PlaidCredentials | null`
  - `savePlaidCredentials(creds: PlaidCredentials): void`
- Used by: Task 5 (`exchange-token` writes), Task 4 (`status` reads), Task 6 (`transactions` reads).

- [ ] **Step 1: Write `lib/plaidStore.ts`**

```ts
import fs from "node:fs";
import path from "node:path";

const STORE_DIR = path.join(process.cwd(), ".plaid");
const STORE_FILE = path.join(STORE_DIR, "data.json");

export type PlaidCredentials = {
  accessToken: string;
  itemId: string;
};

export function getPlaidCredentials(): PlaidCredentials | null {
  if (!fs.existsSync(STORE_FILE)) {
    return null;
  }
  const raw = fs.readFileSync(STORE_FILE, "utf-8");
  return JSON.parse(raw) as PlaidCredentials;
}

export function savePlaidCredentials(creds: PlaidCredentials): void {
  if (!fs.existsSync(STORE_DIR)) {
    fs.mkdirSync(STORE_DIR, { recursive: true });
  }
  fs.writeFileSync(STORE_FILE, JSON.stringify(creds, null, 2), "utf-8");
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors referencing `lib/plaidStore.ts`.

(The read path is exercised for real in Task 4's manual test, and the write path in Task 8's manual test — no standalone script needed.)

- [ ] **Step 3: Commit**

```bash
git add lib/plaidStore.ts
git commit -m "feat: add local plaid credential store"
```

---

### Task 4: Status route

**Files:**
- Create: `app/api/plaid/status/route.ts`

**Interfaces:**
- Consumes: `getPlaidCredentials()` from `lib/plaidStore.ts` (Task 3).
- Produces: `GET /api/plaid/status` → `{ linked: boolean }`. Consumed by the UI in Task 8.

- [ ] **Step 1: Write the route**

```ts
import { NextResponse } from "next/server";
import { getPlaidCredentials } from "@/lib/plaidStore";

export async function GET() {
  const creds = getPlaidCredentials();
  return NextResponse.json({ linked: creds !== null });
}
```

- [ ] **Step 2: Manually verify**

Run: `npm run dev` (in one terminal), then in another:

Run: `curl -s http://localhost:3000/api/plaid/status`
Expected: `{"linked":false}`

- [ ] **Step 3: Commit**

```bash
git add app/api/plaid/status/route.ts
git commit -m "feat: add plaid status route"
```

---

### Task 5: Link-token and exchange-token routes

**Files:**
- Create: `app/api/plaid/link-token/route.ts`
- Create: `app/api/plaid/exchange-token/route.ts`

**Interfaces:**
- Consumes: `plaidClient` (Task 2), `savePlaidCredentials` (Task 3).
- Produces:
  - `POST /api/plaid/link-token` → `{ linkToken: string }` on success, `{ error: string }` (status 500) on failure. Consumed by the UI in Task 8.
  - `POST /api/plaid/exchange-token` with body `{ publicToken: string }` → `{ ok: true }` on success, `{ error: string }` (status 500) on failure. Consumed by the UI in Task 8.

- [ ] **Step 1: Write the link-token route**

```ts
// app/api/plaid/link-token/route.ts
import { NextResponse } from "next/server";
import { CountryCode, Products } from "plaid";
import { plaidClient } from "@/lib/plaid";

export async function POST() {
  try {
    const response = await plaidClient.linkTokenCreate({
      user: { client_user_id: "budget-app-local-user" },
      client_name: "Budget",
      products: [Products.Transactions],
      country_codes: [CountryCode.Us],
      language: "en",
    });
    return NextResponse.json({ linkToken: response.data.link_token });
  } catch (err) {
    console.error("plaid link-token error", err);
    return NextResponse.json(
      { error: "Failed to create Plaid link token." },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 2: Write the exchange-token route**

```ts
// app/api/plaid/exchange-token/route.ts
import { NextResponse } from "next/server";
import { plaidClient } from "@/lib/plaid";
import { savePlaidCredentials } from "@/lib/plaidStore";

export async function POST(request: Request) {
  const { publicToken } = (await request.json()) as { publicToken?: string };
  if (!publicToken) {
    return NextResponse.json(
      { error: "Missing publicToken." },
      { status: 400 }
    );
  }

  try {
    const response = await plaidClient.itemPublicTokenExchange({
      public_token: publicToken,
    });
    savePlaidCredentials({
      accessToken: response.data.access_token,
      itemId: response.data.item_id,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("plaid exchange-token error", err);
    return NextResponse.json(
      { error: "Failed to exchange Plaid public token." },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 3: Manually verify link-token creation**

Run: `npm run dev`, then:

Run: `curl -s -X POST http://localhost:3000/api/plaid/link-token`
Expected: JSON with a `linkToken` field starting with `link-sandbox-`. If you instead get `{"error": "..."}`, double check `.env.local` has valid Sandbox `PLAID_CLIENT_ID`/`PLAID_SECRET`.

(The exchange-token route is verified end-to-end in Task 8, since it needs a real `public_token` from the Link widget.)

- [ ] **Step 4: Commit**

```bash
git add app/api/plaid/link-token/route.ts app/api/plaid/exchange-token/route.ts
git commit -m "feat: add plaid link-token and exchange-token routes"
```

---

### Task 6: Transactions route

**Files:**
- Create: `app/api/plaid/transactions/route.ts`

**Interfaces:**
- Consumes: `plaidClient` (Task 2), `getPlaidCredentials` (Task 3).
- Produces: `GET /api/plaid/transactions` →
  `{ transactions: Array<{ id: string; date: string; name: string; amount: number; category: string | null }> }`
  on success, or `{ error: string }` with status 400 (`"not_linked"`) or 500. Consumed by the UI in Task 8.

- [ ] **Step 1: Write the route**

```ts
import { NextResponse } from "next/server";
import { plaidClient } from "@/lib/plaid";
import { getPlaidCredentials } from "@/lib/plaidStore";

export async function GET() {
  const creds = getPlaidCredentials();
  if (!creds) {
    return NextResponse.json(
      { error: "not_linked" },
      { status: 400 }
    );
  }

  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - 30);
  const toIsoDate = (d: Date) => d.toISOString().slice(0, 10);

  try {
    const response = await plaidClient.transactionsGet({
      access_token: creds.accessToken,
      start_date: toIsoDate(startDate),
      end_date: toIsoDate(endDate),
      options: { count: 250, offset: 0 },
    });

    const transactions = response.data.transactions
      .map((t) => ({
        id: t.transaction_id,
        date: t.date,
        name: t.merchant_name ?? t.name,
        amount: t.amount,
        category: t.personal_finance_category?.primary ?? null,
      }))
      .sort((a, b) => (a.date < b.date ? 1 : -1));

    return NextResponse.json({ transactions });
  } catch (err) {
    console.error("plaid transactions error", err);
    const message =
      typeof err === "object" &&
      err !== null &&
      "response" in err &&
      // @ts-expect-error - narrowing a third-party error shape
      err.response?.data?.error_code === "ITEM_LOGIN_REQUIRED"
        ? "Your linked bank needs to be reconnected. Click Connect a bank to relink."
        : "Failed to fetch transactions from Plaid.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
```

- [ ] **Step 2: Manually verify with no linked account**

Run: `rm -rf .plaid` (ensure clean state), `npm run dev`, then:

Run: `curl -s http://localhost:3000/api/plaid/transactions`
Expected: `{"error":"not_linked"}` with a 400 status (check with `curl -i` for the status line).

(Full success-path verification happens in Task 8 after linking a Sandbox account.)

- [ ] **Step 3: Commit**

```bash
git add app/api/plaid/transactions/route.ts
git commit -m "feat: add plaid transactions route"
```

---

### Task 7: Add Plaid tab to nav

**Files:**
- Modify: `components/TabNav.tsx`

**Interfaces:**
- Produces: a nav entry linking to `/plaid`, matching the existing `TABS` array shape (`label`, `shortLabel`, `href`, `icon`).

- [ ] **Step 1: Add a Plaid entry to the `TABS` array**

In `components/TabNav.tsx`, add this object to the `TABS` array (after the "Affordability" entry):

```tsx
  {
    label: "Plaid",
    shortLabel: "Plaid",
    href: "/plaid",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="5" width="20" height="14" rx="2" />
        <path d="M2 10h20" />
      </svg>
    ),
  },
```

- [ ] **Step 2: Manually verify**

Run: `npm run dev`, open `http://localhost:3000` in a browser.
Expected: a "Plaid" tab appears in the nav bar (it will 404 until Task 8 adds the page — that's expected at this point).

- [ ] **Step 3: Commit**

```bash
git add components/TabNav.tsx
git commit -m "feat: add plaid tab to nav"
```

---

### Task 8: Plaid page (connect flow + transactions table)

**Files:**
- Create: `app/plaid/page.tsx`

**Interfaces:**
- Consumes: `GET /api/plaid/status`, `POST /api/plaid/link-token`, `POST /api/plaid/exchange-token`, `GET /api/plaid/transactions` (Tasks 4-6); `usePlaidLink` from `react-plaid-link` (Task 1); `Button`, `Card`, `CardHeader`, `CardTitle`, `CardContent` from `@/components/ui/*` (existing).
- Produces: the `/plaid` route the nav (Task 7) links to.

- [ ] **Step 1: Write `app/plaid/page.tsx`**

```tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import { usePlaidLink } from "react-plaid-link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Transaction = {
  id: string;
  date: string;
  name: string;
  amount: number;
  category: string | null;
};

type Status = "loading" | "not_linked" | "linked";

export default function PlaidPage() {
  const [status, setStatus] = useState<Status>("loading");
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [error, setError] = useState<string | null>(null);

  const checkStatus = useCallback(async () => {
    setError(null);
    const res = await fetch("/api/plaid/status");
    const data = (await res.json()) as { linked: boolean };
    setStatus(data.linked ? "linked" : "not_linked");
  }, []);

  const loadTransactions = useCallback(async () => {
    setError(null);
    const res = await fetch("/api/plaid/transactions");
    const data = (await res.json()) as
      | { transactions: Transaction[] }
      | { error: string };
    if ("error" in data) {
      setError(data.error);
      return;
    }
    setTransactions(data.transactions);
  }, []);

  useEffect(() => {
    checkStatus();
  }, [checkStatus]);

  useEffect(() => {
    if (status === "linked") {
      loadTransactions();
    }
  }, [status, loadTransactions]);

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

  return (
    <div className="mx-auto max-w-2xl p-4">
      <Card>
        <CardHeader>
          <CardTitle>Plaid</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {error && (
            <div className="flex flex-col gap-2 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
              <span>{error}</span>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  status === "linked" ? loadTransactions() : checkStatus()
                }
              >
                Retry
              </Button>
            </div>
          )}

          {status === "loading" && <p className="text-sm text-muted-foreground">Loading...</p>}

          {status === "not_linked" && (
            <Button onClick={fetchLinkToken}>Connect a bank</Button>
          )}

          {status === "linked" && (
            <div className="flex flex-col gap-2">
              {transactions.length === 0 && !error && (
                <p className="text-sm text-muted-foreground">
                  No transactions in the last 30 days.
                </p>
              )}
              {transactions.map((t) => (
                <div
                  key={t.id}
                  className="flex items-center justify-between border-b border-border/50 py-2 text-sm last:border-0"
                >
                  <div className="flex flex-col">
                    <span>{t.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {t.date}
                      {t.category ? ` · ${t.category}` : ""}
                    </span>
                  </div>
                  <span>${t.amount.toFixed(2)}</span>
                </div>
              ))}
              <Button
                size="sm"
                variant="outline"
                onClick={fetchLinkToken}
                className="mt-2 self-start"
              >
                Connect another bank
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Manually verify the full flow in the browser**

Run: `rm -rf .plaid` (start clean), `npm run dev`, open `http://localhost:3000/plaid`.

Expected:
1. Page loads, shows "Connect a bank" button.
2. Click it — Plaid Link opens in a modal.
3. Search for "Platypus" (a Plaid Sandbox test institution) or any listed bank, select it.
4. When prompted for credentials, enter username `user_good` and password `pass_good`.
5. Complete the flow — modal closes, page shows a list of transactions (Sandbox fake data) with date/name/amount/category.
6. Reload the page — transactions still load (fetched fresh, confirms `/api/plaid/status` now reports linked and `/api/plaid/transactions` succeeds).

- [ ] **Step 3: Commit**

```bash
git add app/plaid/page.tsx
git commit -m "feat: add plaid transactions page"
```

---

### Task 9: End-to-end verification pass

**Files:** none (verification only)

- [ ] **Step 1: Verify not-linked state renders cleanly**

Run: `rm -rf .plaid`, `npm run dev`, visit `/plaid`.
Expected: "Connect a bank" button, no console errors.

- [ ] **Step 2: Verify the full link → transactions flow**

Repeat Task 8 Step 2's manual flow end to end once more from a clean `.plaid` state.
Expected: transactions render with real-looking Sandbox data (merchant names, dates in the last 30 days, dollar amounts).

- [ ] **Step 3: Verify error handling**

Temporarily rename `.env.local` (`mv .env.local .env.local.bak`), restart `npm run dev`, click "Connect a bank".
Expected: the page shows the inline error box with a "Retry" button instead of crashing.
Restore: `mv .env.local.bak .env.local`.

- [ ] **Step 4: Type-check the whole project**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Lint the whole project**

Run: `npm run lint`
Expected: no errors.

No commit for this task — it's verification only. If any step fails, fix the relevant task's code and re-run that task's own verification step before returning here.
