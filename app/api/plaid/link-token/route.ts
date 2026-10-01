import { NextResponse } from "next/server";
import { CountryCode, Products } from "plaid";
import { plaidClient } from "@/lib/plaid";
import { linkingDisabled, linkingDisabledResponse } from "@/lib/plaidLinking";
import {
  getAllPlaidCredentials,
  getPendingLink,
  MAX_CONNECTIONS,
  savePendingLink,
} from "@/lib/plaidStore";

// The token from an in-progress link, so the page can resume after the
// bank's OAuth site sends the browser back.
export async function GET() {
  if (linkingDisabled()) return linkingDisabledResponse();
  const pending = getPendingLink();
  return NextResponse.json({
    linkToken: pending?.linkToken ?? null,
    // Set when this link is re-authenticating an existing connection.
    itemId: pending?.itemId ?? null,
  });
}

// With { itemId }, creates a token that re-authenticates that connection
// (Plaid "update mode": same token, no new slot). Without it, adds a bank.
export async function POST(request: Request) {
  if (linkingDisabled()) return linkingDisabledResponse();

  const { itemId } = (await request.json().catch(() => ({}))) as {
    itemId?: string;
  };
  const connections = getAllPlaidCredentials();

  let accessToken: string | undefined;
  if (itemId) {
    accessToken = connections.find((c) => c.itemId === itemId)?.accessToken;
    if (!accessToken) {
      return NextResponse.json({ error: "Unknown connection." }, { status: 404 });
    }
  } else if (connections.length >= MAX_CONNECTIONS) {
    return NextResponse.json(
      { error: `You already have ${connections.length} connected accounts, the limit.` },
      { status: 409 }
    );
  }

  try {
    const response = await plaidClient.linkTokenCreate({
      user: { client_user_id: "budget-app-local-user" },
      client_name: "Budget",
      country_codes: [CountryCode.Us],
      language: "en",
      // Required for banks that sign you in on their own site (OAuth).
      redirect_uri: process.env.PLAID_REDIRECT_URI || undefined,
      ...(accessToken
        ? { access_token: accessToken }
        : {
            products: [Products.Transactions],
            // Plaid fetches 90 days unless asked for more, and the amount is
            // fixed when the bank is linked. 730 days is the most it allows.
            transactions: { days_requested: 730 },
          }),
    });
    savePendingLink(response.data.link_token, itemId);
    return NextResponse.json({ linkToken: response.data.link_token });
  } catch (err) {
    console.error(
      "plaid link-token error",
      (err as { response?: { data?: unknown } }).response?.data ?? err
    );
    return NextResponse.json(
      { error: "Failed to create Plaid link token." },
      { status: 500 }
    );
  }
}
