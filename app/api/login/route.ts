import { NextResponse } from "next/server";
import {
  passwordMatches,
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  sessionToken,
} from "@/lib/auth";

export async function POST(request: Request) {
  const password = process.env.APP_PASSWORD;
  if (!password) {
    return NextResponse.json(
      { error: "APP_PASSWORD is not set." },
      { status: 503 }
    );
  }

  const { password: attempt } = (await request.json()) as { password?: string };
  if (typeof attempt !== "string" || !passwordMatches(attempt, password)) {
    // Slow down guessing.
    await new Promise((resolve) => setTimeout(resolve, 1000));
    return NextResponse.json({ error: "Wrong password." }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, sessionToken(password), {
    httpOnly: true,
    sameSite: "lax",
    secure: request.url.startsWith("https://"),
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
  return response;
}
