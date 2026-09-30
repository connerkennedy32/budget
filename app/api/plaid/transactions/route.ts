import { NextResponse } from "next/server";
import type { AccountBase, Transaction } from "plaid";
import { plaidClient } from "@/lib/plaid";
import { matchCardPayments } from "@/lib/plaidCardMatching";
import {
  defaultCategory,
  EXTRA,
  HOUSING,
  INSURANCE,
  isCardPaymentOrTransfer,
  normalizeCategory,
  SUBSCRIPTION,
  TITHING,
} from "@/lib/plaidCategories";
import { getAllPlaidCredentials, type PlaidCredentials } from "@/lib/plaidStore";

const PLAID_CATEGORIES = [
  "FOOD_AND_DRINK",
  "GOVERNMENT_AND_NON_PROFIT",
  "HOME_IMPROVEMENT",
  "INCOME",
  "MEDICAL",
  "TRANSFER_IN",
  "TRANSFER_OUT",
  "TRANSPORTATION",
  "TRAVEL",
];

const formatCategory = (raw: string | null) => {
  if (!raw) return "Uncategorized";
  const words = raw.toLowerCase().replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
};

const pad = (n: number) => String(n).padStart(2, "0");
const toIsoDate = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// A payment posted on the last day of a month can show up on the card a few
// days into the next one, so fetch a little past the month on both sides to
// pair them up, then return only the month itself.
const MATCH_PADDING_DAYS = 7;

const plaidErrorCode = (err: unknown) =>
  (err as { response?: { data?: { error_code?: string } } }).response?.data?.error_code;

type ItemResult = {
  itemId: string;
  accounts: AccountBase[];
  transactions: Transaction[];
};

async function fetchItem(
  creds: PlaidCredentials,
  startDate: string,
  endDate: string
): Promise<ItemResult> {
  const transactions: Transaction[] = [];
  let accounts: AccountBase[] = [];
  let total = Infinity;
  while (transactions.length < total) {
    const response = await plaidClient.transactionsGet({
      access_token: creds.accessToken,
      start_date: startDate,
      end_date: endDate,
      options: { count: 250, offset: transactions.length },
    });
    total = response.data.total_transactions;
    accounts = response.data.accounts;
    if (response.data.transactions.length === 0) break;
    transactions.push(...response.data.transactions);
  }
  return { itemId: creds.itemId, accounts, transactions };
}

export async function GET(request: Request) {
  const connections = getAllPlaidCredentials();
  if (connections.length === 0) {
    return NextResponse.json({ error: "not_linked" }, { status: 400 });
  }

  const today = new Date();
  const month =
    new URL(request.url).searchParams.get("month") ??
    `${today.getFullYear()}-${pad(today.getMonth() + 1)}`;
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    return NextResponse.json({ error: "Invalid month." }, { status: 400 });
  }

  const [year, monthNumber] = month.split("-").map(Number);
  const monthStart = new Date(year, monthNumber - 1, 1);
  if (monthStart > today) {
    return NextResponse.json({ error: "That month hasn't happened yet." }, { status: 400 });
  }
  const monthEnd = new Date(year, monthNumber, 0);

  const fetchStart = new Date(monthStart);
  fetchStart.setDate(fetchStart.getDate() - MATCH_PADDING_DAYS);
  const fetchEnd = new Date(monthEnd);
  fetchEnd.setDate(fetchEnd.getDate() + MATCH_PADDING_DAYS);
  const monthFirst = toIsoDate(monthStart);
  const monthLast = toIsoDate(monthEnd);

  // One connection failing must not hide the others.
  const settled = await Promise.allSettled(
    connections.map((c) =>
      fetchItem(c, toIsoDate(fetchStart), toIsoDate(fetchEnd > today ? today : fetchEnd))
    )
  );

  const itemErrors: { itemId: string; message: string; loginRequired: boolean }[] = [];
  const results: ItemResult[] = [];
  settled.forEach((outcome, i) => {
    if (outcome.status === "fulfilled") {
      results.push(outcome.value);
      return;
    }
    const code = plaidErrorCode(outcome.reason);
    console.error("plaid transactions error", connections[i].itemId, code ?? outcome.reason);
    itemErrors.push({
      itemId: connections[i].itemId,
      loginRequired: code === "ITEM_LOGIN_REQUIRED",
      message:
        code === "ITEM_LOGIN_REQUIRED"
          ? "This bank connection has expired. Reconnect it to see new transactions."
          : code === "PRODUCT_NOT_READY"
            ? "Plaid is still loading this account. Try again in a minute."
            : "Couldn't load this account from Plaid.",
    });
  });

  if (results.length === 0) {
    return NextResponse.json(
      { error: itemErrors[0]?.message ?? "Failed to fetch transactions from Plaid.", itemErrors },
      { status: 500 }
    );
  }

  const accounts = results.flatMap((r) =>
    r.accounts.map((a) => ({
      id: a.account_id,
      name: a.name,
      mask: a.mask ?? null,
      type: a.type,
      subtype: a.subtype ?? null,
      balance: a.balances.current ?? 0,
      itemId: r.itemId,
    }))
  );

  const raw = results.flatMap((r) => r.transactions);
  const matches = matchCardPayments(
    raw.map((t) => ({
      id: t.transaction_id,
      date: t.date,
      name: t.merchant_name ?? t.name,
      amount: t.amount,
      accountId: t.account_id,
      detailed: t.personal_finance_category?.detailed ?? null,
    })),
    accounts
  );

  const transactions = raw
    .filter((t) => t.date >= monthFirst && t.date <= monthLast)
    .map((t) => {
      const plaidPrimary = t.personal_finance_category?.primary ?? null;
      // The card's side of a payment is money moving, not a refund.
      const category = matches.cardSideIds.has(t.transaction_id)
        ? "Transfer in"
        : (defaultCategory(t.merchant_name, t.name) ??
          (plaidPrimary === "LOAN_PAYMENTS" && isCardPaymentOrTransfer(t.merchant_name, t.name)
            ? EXTRA
            : normalizeCategory(formatCategory(plaidPrimary))));
      return {
        id: t.transaction_id,
        date: t.date,
        name: t.merchant_name ?? t.name,
        amount: t.amount,
        category,
        accountId: t.account_id,
        // The bank-side copy of a card payment starts hidden; you can un-hide it.
        defaultHidden: matches.bankSideIds.has(t.transaction_id),
      };
    })
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  const categories = [
    ...PLAID_CATEGORIES.map(formatCategory),
    EXTRA,
    HOUSING,
    INSURANCE,
    SUBSCRIPTION,
    TITHING,
  ].sort();

  return NextResponse.json({ transactions, categories, accounts, itemErrors });
}
