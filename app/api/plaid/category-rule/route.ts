import { NextResponse } from "next/server";
import { setCategoryRule } from "@/lib/plaidStore";

export async function POST(request: Request) {
  const { merchant, category } = (await request.json()) as {
    merchant?: string;
    category?: string | null;
  };

  const cleaned = typeof category === "string" ? category.trim() : category;
  if (
    !merchant?.trim() ||
    cleaned === undefined ||
    (cleaned !== null && (cleaned === "" || cleaned.length > 40))
  ) {
    return NextResponse.json(
      { error: "A merchant and a category of 1-40 characters are required." },
      { status: 400 }
    );
  }

  setCategoryRule(merchant, cleaned);
  return NextResponse.json({ ok: true });
}
