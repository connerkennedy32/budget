import { createHash, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "budget_session";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

const digest = (value: string) => createHash("sha256").update(value).digest();

// The cookie holds a hash derived from the password, so changing
// APP_PASSWORD signs every device out.
export const sessionToken = (password: string) =>
  digest(`budget-session:${password}`).toString("hex");

export function passwordMatches(attempt: string, password: string): boolean {
  return timingSafeEqual(digest(attempt), digest(password));
}

export function hasValidSession(
  cookie: string | undefined,
  password: string
): boolean {
  if (!cookie) return false;
  const expected = sessionToken(password);
  return (
    cookie.length === expected.length &&
    timingSafeEqual(Buffer.from(cookie), Buffer.from(expected))
  );
}
