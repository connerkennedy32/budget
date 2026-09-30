import { NextResponse } from "next/server";
import type { AccountBase, Transaction } from "plaid";
import { plaidClient } from "@/lib/plaid";
import { defaultCategory, EXTRA, normalizeCategory, TITHING } from "@/lib/plaidCategories";
import { getPlaidCredentials } from "@/lib/plaidStore";

const PLAID_CATEGORIES = [
  "FOOD_AND_DRINK",
  "GOVERNMENT_AND_NON_PROFIT",
  "HOME_IMPROVEMENT",
  "INCOME",
  "LOAN_PAYMENTS",
  "MEDICAL",
  "RENT_AND_UTILITIES",
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

export async function GET(request: Request) {
  const creds = getPlaidCredentials();
  if (!creds) {
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
  const endDate = monthEnd > today ? today : monthEnd;

  try {
    const plaidTransactions: Transaction[] = [];
    let accounts: AccountBase[] = [];
    let total = Infinity;
    while (plaidTransactions.length < total) {
      const response = await plaidClient.transactionsGet({
        access_token: creds.accessToken,
        start_date: toIsoDate(monthStart),
        end_date: toIsoDate(endDate),
        options: { count: 250, offset: plaidTransactions.length },
      });
      total = response.data.total_transactions;
      accounts = response.data.accounts;
      if (response.data.transactions.length === 0) break;
      plaidTransactions.push(...response.data.transactions);
    }

    const transactions = plaidTransactions
      .map((t) => ({
        id: t.transaction_id,
        date: t.date,
        name: t.merchant_name ?? t.name,
        amount: t.amount,
        category:
          defaultCategory(t.merchant_name, t.name) ??
          normalizeCategory(formatCategory(t.personal_finance_category?.primary ?? null)),
      }))
      .sort((a, b) => (a.date < b.date ? 1 : -1));

    const categories = [...PLAID_CATEGORIES.map(formatCategory), EXTRA, TITHING].sort();

    return NextResponse.json({
      transactions,
      categories,
      accounts: accounts.map((a) => ({
        id: a.account_id,
        name: a.name,
        type: a.type,
        balance: a.balances.current ?? 0,
      })),
    });
  } catch (err) {
    console.error("plaid transactions error", err);
    const message =
      typeof err === "object" &&
      err !== null &&
      "response" in err &&
      // @ts-expect-error - narrowing a third-party error shape
      err.response?.data?.error_code === "ITEM_LOGIN_REQUIRED"
        ? "Your bank connection has expired. Delete .plaid/data.json and reload to reconnect."
        : "Failed to fetch transactions from Plaid.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
