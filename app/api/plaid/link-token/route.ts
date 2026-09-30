import { NextResponse } from "next/server";
import { CountryCode, Products } from "plaid";
import { plaidClient } from "@/lib/plaid";
import { linkingDisabled, linkingDisabledResponse } from "@/lib/plaidLinking";
import {
  getPendingLinkToken,
  getPlaidCredentials,
  savePendingLink,
} from "@/lib/plaidStore";

// The token from an in-progress link, so the page can resume after the
// bank's OAuth site sends the browser back.
export async function GET() {
  if (linkingDisabled()) return linkingDisabledResponse();
  return NextResponse.json({ linkToken: getPendingLinkToken() });
}

export async function POST() {
  if (linkingDisabled()) return linkingDisabledResponse();
  if (getPlaidCredentials()) {
    return NextResponse.json(
      { error: "A bank is already connected." },
      { status: 409 }
    );
  }

  try {
    const response = await plaidClient.linkTokenCreate({
      user: { client_user_id: "budget-app-local-user" },
      client_name: "Budget",
      products: [Products.Transactions],
      country_codes: [CountryCode.Us],
      language: "en",
      // Required for banks that sign you in on their own site (OAuth).
      redirect_uri: process.env.PLAID_REDIRECT_URI || undefined,
    });
    savePendingLink(response.data.link_token);
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
