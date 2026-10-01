# Multiple Accounts (Chase card + Wells Fargo cards) Implementation Plan

**Goal:** Show every charge from every account the household uses (Wells Fargo checking/debit, a Chase credit card, two Wells Fargo credit cards under a second Wells Fargo login) in one month view, without counting card payments twice, and let each connection be re-authenticated without using a new Plaid slot.

**Decisions (from the user)**
- No per-person labels; the household shares everything. Rows are tagged and filtered by **account**, not owner.
- One shared app password; all accounts visible to whoever signs in.
- Wife's two cards share one Wells Fargo login, so they are one Plaid connection.

## Constraints

- Each *new* Plaid connection permanently uses one of ten free slots; deleting does not free one. Two new connections are planned (Chase, wife's Wells Fargo). Everything is built and tested in **Sandbox** before any real linking.
- Re-authenticating an expired connection uses Plaid **update mode** (link token created with the existing `access_token`). It creates no new Item and the token does not change (confirmed in Plaid's update-mode docs).
- Linking only runs on the local machine (needs an HTTPS redirect URL via a tunnel). The deployed site only reads tokens from env.
- Chase and Wells Fargo are OAuth banks. The pending-link recovery route already exists and must keep working with several connections.
- Card-payment matching can only be tuned against real data (not known how Plaid labels card-side payments).

## Design

### Storage
- `.plaid/data.json` holds a list of connections `{ accessToken, itemId }`. The old single-object shape is read and upgraded in place.
- Deployed: `PLAID_ACCESS_TOKENS` (comma separated). The legacy `PLAID_ACCESS_TOKEN` is still read and counts as one.
- Linking is capped (default 5 connections) as a guard against burning slots by accident. The "only one bank" 409 is replaced by the cap.
- Recovery (`/api/plaid/recover`) must recover a finished sign-in even when other connections already exist, and skip an `itemId` already stored.

### Transactions API
- Fetch every connection in parallel; one failing connection must not break the others. The response gains `itemErrors: [{ itemId, message, loginRequired }]`.
- Each transaction gains `accountId`; accounts gain `mask`, `subtype`, `itemId`.
- Fetch a window padded by 7 days each side so a payment posted on the last day of a month can still be matched; only the requested month is returned.

### Not counting card money twice
- **Card-side payments** (credit account, negative amount, payment-like name) that match a **bank-side debit** (payment-like name: `chase credit crd…`, `online transfer … to …`, `autopay`, `payment`) by amount (±$0.01) within ±5 days are a matched pair.
- The bank-side debit gets `defaultHidden: true`; the card-side credit is classified "Transfer in" (not spending).
- Matching needs both sides present, so it only fires once the card is linked. Unmatched items are left alone.
- `defaultHidden` is a default: the user can un-hide. Client state: explicit-hide list (existing) + new explicit-show list; `hidden = shown ? false : (explicitHidden || defaultHidden)`.

### Update mode
- `POST /api/plaid/link-token` accepts `{ itemId }`; with it, the link token is created from that connection's `access_token` (no `products`). In Link, `onSuccess` needs no exchange; the page just reloads data.
- `itemErrors` with `loginRequired` show a **Reconnect** button (local only; deployed copy says to open the app on the computer).
- The old "delete `.plaid/data.json`" error text is removed.

### UI
- Row tag with the account name and last 4 digits, shown only when there is more than one account.
- An account filter (select, "All accounts") applying to the total, category bars, Not counted line and list.
- Accounts card lists every account; credit balances are money owed.
- **Add an account** button (local only) when under the cap; shows how many are connected.

## Tasks

1. **Store + status** — list-shaped storage with migration, env list, cap, `count`/`canLink` in `/api/plaid/status`. Verify by curl and by reading an old single-object file.
2. **Linking routes** — link-token (new + update mode), exchange-token (append, dedupe), recover (multi-connection). Verify in Sandbox: link two connections, recover a lost one.
3. **Transactions route** — parallel fetch, padded window, `itemErrors`, account fields. Verify: two Sandbox connections merge; one forced to `ITEM_LOGIN_REQUIRED` still returns the other.
4. **Card-payment matching** — pure function plus a synthetic test script covering matches, near-misses (different amount, outside window, refund vs payment), and month edges.
5. **Page** — tags, filter, accounts list, item errors + Reconnect, Add account, default-hidden logic. Verify in the browser.
6. **Sandbox end to end** — `sandbox/item/reset_login` then Reconnect through update mode; confirm the token and item ID are unchanged.
7. **Deploy code** (nothing changes for the user yet). Commit and push.
8. **Live linking, one at a time** (user present, tunnel up): Chase, then the wife's Wells Fargo. Copy each new token into Vercel `PLAID_ACCESS_TOKENS` and save it in a password manager.
9. **Tune on real data** — check card-side payment labels, matching, and the double-count totals together.

## Risks / unknowns

- Chase may need Transactions access or OAuth registration approved in Plaid production; check the dashboard before linking.
- Pending transactions get a new ID when they post, so a manual hide on a pending charge can be lost (already true for Wells Fargo).
- The wife must consent and sign into her own account during the session.

## Status

Tasks 1-6 done and verified in Sandbox (two connections, a forced expired login, update mode through Link). Task 7 (deploy) and the live linking (8-9) remain.

Notes from the Sandbox run:
- Update mode reuses the same access token; the connection came back with no exchange and no new Item.
- A failing connection returns `itemErrors` and the others still load. While the card side is unavailable the bank-side autopay is *not* hidden (nothing to match against), so spending briefly counts it until the card reconnects.
- Update mode for a Sandbox "custom user" needs the original username and the JSON password; real banks use their normal login.
- `scripts/test-card-matching.mts` and `scripts/test-plaid-store.mts` are runnable with `node --experimental-strip-types`.

## Live linking notes

- Chase card and the wife's Wells Fargo login were linked on 2026-09-30.
- The wife's login also contained the joint Everyday Checking account, so it arrived twice (two logins, different transaction ids, copies synced at different times). `lib/plaidDedupe.ts` keeps the earlier connection's copy; `scripts/test-dedupe.mts` covers it. Keeping the earlier copy keeps already-hidden transaction ids valid.
- Matching worked on real data: every Chase autopay and every "Online Transfer ... to Wells Fargo" line paired with a payment on the card side (July-September).
