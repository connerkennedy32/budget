import { NextResponse } from "next/server";
import { getPlaidCredentials } from "@/lib/plaidStore";

export async function GET() {
  const creds = getPlaidCredentials();
  return NextResponse.json({ linked: creds !== null });
}
