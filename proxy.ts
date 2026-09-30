import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { hasValidSession, SESSION_COOKIE } from "@/lib/auth";

export function proxy(request: NextRequest) {
  const password = process.env.APP_PASSWORD;

  if (!password) {
    // A deployed copy without a password would expose bank data, so it
    // refuses to serve anything. Local development stays open.
    if (process.env.VERCEL) {
      return new NextResponse("APP_PASSWORD is not set.", { status: 503 });
    }
    return NextResponse.next();
  }

  const { pathname, search } = request.nextUrl;
  if (pathname === "/login" || pathname === "/api/login") {
    return NextResponse.next();
  }
  if (hasValidSession(request.cookies.get(SESSION_COOKIE)?.value, password)) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("next", pathname + search);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: [
    // Static files the browser fetches without a session (install manifest,
    // icons, the service worker) stay public; everything else is gated.
    "/((?!_next/static|_next/image|favicon.ico|icon.svg|icon-192x192.png|icon-512x512.png|apple-icon.png|manifest.webmanifest|sw.js).*)",
  ],
};
