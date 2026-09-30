import { NextResponse } from "next/server";
import { plaidClient } from "@/lib/plaid";
import { linkingDisabled, linkingDisabledResponse } from "@/lib/plaidLinking";
import {
  addPlaidCredentials,
  clearPendingLink,
  getAllPlaidCredentials,
  MAX_CONNECTIONS,
} from "@/lib/plaidStore";

export async function POST(request: Request) {
  if (linkingDisabled()) return linkingDisabledResponse();
  if (getAllPlaidCredentials().length >= MAX_CONNECTIONS) {
    return NextResponse.json(
      { error: "The connection limit has been reached." },
      { status: 409 }
    );
  }

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
    addPlaidCredentials({
      accessToken: response.data.access_token,
      itemId: response.data.item_id,
    });
    clearPendingLink();
    console.info("plaid exchange-token: saved item", response.data.item_id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("plaid exchange-token error", err);
    return NextResponse.json(
      { error: "Failed to exchange Plaid public token." },
      { status: 500 }
    );
  }
}
