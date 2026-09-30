import { NextResponse } from "next/server";
import { plaidClient } from "@/lib/plaid";
import { linkingDisabled, linkingDisabledResponse } from "@/lib/plaidLinking";
import {
  addPlaidCredentials,
  clearPendingLink,
  getPendingLink,
} from "@/lib/plaidStore";

// If the browser never reported a finished link (a popup closed, an OAuth
// redirect got lost), ask Plaid whether the pending session actually
// succeeded and finish the exchange here, so a completed sign-in isn't
// wasted. Safe to call any time: with nothing pending it does nothing.
export async function POST() {
  if (linkingDisabled()) return linkingDisabledResponse();
  const pending = getPendingLink();
  // Re-authenticating an existing connection has no public token to exchange,
  // and by the time the page asks again that attempt is over.
  if (pending?.itemId) clearPendingLink();
  if (!pending || pending.itemId) {
    return NextResponse.json({ recovered: false });
  }

  try {
    const session = await plaidClient.linkTokenGet({ link_token: pending.linkToken });
    // Plaid reports a finished sign-in under results; on_success is the older field.
    const publicToken = session.data.link_sessions
      ?.flatMap((s) => [
        ...(s.results?.item_add_results.map((r) => r.public_token) ?? []),
        s.on_success?.public_token,
      ])
      .find(Boolean);
    if (!publicToken) {
      return NextResponse.json({ recovered: false });
    }

    const response = await plaidClient.itemPublicTokenExchange({
      public_token: publicToken,
    });
    addPlaidCredentials({
      accessToken: response.data.access_token,
      itemId: response.data.item_id,
    });
    clearPendingLink();
    console.info("plaid recover: saved item", response.data.item_id);
    return NextResponse.json({ recovered: true });
  } catch (err) {
    console.error("plaid recover error", err);
    return NextResponse.json({ error: "Recovery failed." }, { status: 500 });
  }
}
