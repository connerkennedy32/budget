# Plaid Transactions Tab — Design

## Purpose

Add a new "Plaid" tab to the budget app that shows the last month of
transactions from a linked bank account, using the user's free Plaid
developer account. Start against Plaid's Sandbox environment (fake
data) and be able to switch to Production (real bank data) later via
config only.

## Constraints

- The app currently has no backend, database, or auth of any kind —
  it's a purely client-side calculator (see `app/*/page.tsx`,
  `components/*Calculator*`). This feature introduces the app's first
  server-side/API surface.
- Single user, run locally (`next dev` / `next start`) — no multi-user
  concerns.
- Must not incur Plaid costs. Plaid bills per linked account (Item)
  per month, not per API call, so fetching transactions on every page
  load is free beyond the cost of having one linked Item.
- Keep the Plaid developer account free: build against Sandbox first;
  Production is a config swap, not a rewrite.

## Architecture

- **Env-driven Plaid client** — `lib/plaid.ts` constructs a Plaid API
  client from `PLAID_CLIENT_ID`, `PLAID_SECRET`, and `PLAID_ENV`
  (`sandbox` | `development` | `production`), read from
  `.env.local` (gitignored, not committed).
- **Local credential store** — `.plaid/data.json` (gitignored) holds
  `{ accessToken, itemId }` for the one linked bank. Read/written via
  `lib/plaidStore.ts`. No database; a flat file is sufficient for a
  single-user local app.
- **API routes** (Next.js App Router Route Handlers under
  `app/api/plaid/`):
  - `GET /api/plaid/status` → `{ linked: boolean }`
  - `POST /api/plaid/link-token` → creates and returns a Plaid
    `link_token` (server holds the secret; client never sees it)
  - `POST /api/plaid/exchange-token` → body `{ publicToken }`,
    exchanges it for an `access_token`/`item_id` via Plaid, persists
    them via `plaidStore`
  - `GET /api/plaid/transactions` → reads the stored access token,
    calls Plaid for transactions in the last 30 days, returns a
    normalized JSON array
- **UI** — `app/plaid/page.tsx` (client component):
  - On mount, calls `/api/plaid/status`.
  - If not linked: shows a "Connect a bank" button. Click → fetch a
    link token → open Plaid Link via `react-plaid-link`'s
    `usePlaidLink` hook → on success, POST the public token to
    `/api/plaid/exchange-token` → refetch status.
  - If linked: fetch `/api/plaid/transactions` on every mount (no
    client-side caching) and render as a table (date, merchant name,
    amount, category), sorted newest-first.
- **Nav** — add a "Plaid" entry to `components/TabNav.tsx` pointing at
  `/plaid`, following the existing tab pattern (icon + label).

## Data flow

1. First run: user opens `/plaid`, sees "Connect a bank", clicks it.
2. Client asks server for a link token; server asks Plaid; token
   returned to client.
3. Plaid Link widget opens in-browser, user picks their bank (Sandbox:
   `user_good`/`pass_good`), Plaid returns a `public_token` to the
   client's `onSuccess` callback.
4. Client posts `public_token` to the server; server exchanges it with
   Plaid for a permanent `access_token` + `item_id`, writes both to
   `.plaid/data.json`.
5. Client refetches status → now linked → fetches transactions →
   renders table.
6. Every subsequent visit to `/plaid`: status is "linked", so it goes
   straight to fetching and rendering transactions for the trailing 30
   days.

## Error handling

- Plaid API errors during link-token creation, token exchange, or
  transaction fetch are caught in the route handlers and returned as
  `{ error: string }` with a non-200 status.
- The `/plaid` page renders a plain error message with a "Retry"
  button on any failed fetch, instead of throwing/crashing.
- If Plaid reports the Item needs re-authentication (e.g.
  `ITEM_LOGIN_REQUIRED`), the transactions route surfaces that as a
  distinct error message telling the user to reconnect (re-running the
  link flow overwrites the stored credentials).

## Testing

- Manual end-to-end verification in the browser against Plaid
  Sandbox: link a fake account with `user_good`/`pass_good`, confirm
  the transactions table renders with Sandbox's fake transaction data,
  confirm the "not linked" and error states render correctly.
- No automated test suite exists in this repo today; not introducing
  one as part of this feature (consistent with existing calculator
  components, which also have no tests).

## Out of scope

- Multi-account / multi-institution support (one linked Item only).
- Transaction caching, background sync, or webhooks.
- Any UI for un-linking/removing the stored credentials (can delete
  `.plaid/data.json` by hand if needed).
- Production Plaid access approval steps — this spec builds against
  Sandbox; switching to Production later is a config/env change plus
  whatever Plaid dashboard steps they require, not a code change.
