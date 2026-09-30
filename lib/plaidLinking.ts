import { NextResponse } from "next/server";

// Linking a bank writes the token to a local file and needs a registered
// redirect URL, so it only runs on your own machine. A deployed copy reads
// PLAID_ACCESS_TOKEN instead.
export const linkingDisabled = () => Boolean(process.env.VERCEL);

export const linkingDisabledResponse = () =>
  NextResponse.json(
    { error: "Connecting a bank only works when the app runs on your own computer." },
    { status: 404 }
  );
