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
