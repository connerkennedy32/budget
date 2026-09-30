import { NextResponse } from "next/server";
import { linkingDisabled } from "@/lib/plaidLinking";
import { getAllPlaidCredentials, MAX_CONNECTIONS } from "@/lib/plaidStore";

export async function GET() {
  const count = getAllPlaidCredentials().length;
  return NextResponse.json({
    linked: count > 0,
    count,
    // Whether "Add an account" should be offered: only on your own computer,
    // and only while under the connection cap.
    canLink: !linkingDisabled() && count < MAX_CONNECTIONS,
  });
}
