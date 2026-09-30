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
