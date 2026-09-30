import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

// Overridable so tests can use a scratch directory instead of the real one.
const STORE_DIR = process.env.PLAID_STORE_DIR ?? path.join(process.cwd(), ".plaid");
const STORE_FILE = path.join(STORE_DIR, "data.json");

// A guard against burning Plaid slots by linking too many banks by accident.
export const MAX_CONNECTIONS = Number(process.env.PLAID_MAX_CONNECTIONS ?? 5);

export type PlaidCredentials = {
  accessToken: string;
  itemId: string;
};

const ensureStoreDir = () => {
  if (!fs.existsSync(STORE_DIR)) {
    fs.mkdirSync(STORE_DIR, { recursive: true });
  }
};

// The file holds { items: [...] }. The original format was one bare
// { accessToken, itemId } object, which is still read.
function readFileCredentials(): PlaidCredentials[] {
  if (!fs.existsSync(STORE_FILE)) {
    return [];
  }
  const parsed = JSON.parse(fs.readFileSync(STORE_FILE, "utf-8")) as
    | { items?: PlaidCredentials[] }
    | PlaidCredentials;
  if ("items" in parsed && Array.isArray(parsed.items)) {
    return parsed.items;
  }
  if ("accessToken" in parsed && parsed.accessToken) {
    return [parsed];
  }
  return [];
}

// Every connected bank. A deployed copy can't write files, so its tokens come
// from the environment (PLAID_ACCESS_TOKENS, comma separated; the older
// single PLAID_ACCESS_TOKEN still works).
export function getAllPlaidCredentials(): PlaidCredentials[] {
  const fromEnv = [
    ...(process.env.PLAID_ACCESS_TOKENS?.split(",") ?? []),
    process.env.PLAID_ACCESS_TOKEN ?? "",
  ]
    .map((t) => t.trim())
    .filter(Boolean);
  if (fromEnv.length > 0) {
    return [...new Set(fromEnv)].map((accessToken) => ({
      accessToken,
      // A stable id that doesn't reveal the token.
      itemId: `env-${createHash("sha256").update(accessToken).digest("hex").slice(0, 10)}`,
    }));
  }
  return readFileCredentials();
}

// Returns false if this connection (by item id) was already stored.
export function addPlaidCredentials(creds: PlaidCredentials): boolean {
  const items = readFileCredentials();
  if (items.some((c) => c.itemId === creds.itemId)) {
    return false;
  }
  ensureStoreDir();
  fs.writeFileSync(
    STORE_FILE,
    JSON.stringify({ items: [...items, creds] }, null, 2),
    "utf-8"
  );
  return true;
}

const PENDING_FILE = path.join(STORE_DIR, "pending-link.json");

// Plaid link tokens expire after 4 hours; stop offering them a little sooner.
const PENDING_MAX_AGE_MS = 3 * 60 * 60 * 1000;

// itemId is set when the link is re-authenticating an existing connection
// (update mode) rather than adding a new one.
export type PendingLink = { linkToken: string; createdAt: number; itemId?: string };

export function savePendingLink(linkToken: string, itemId?: string): void {
  ensureStoreDir();
  const pending: PendingLink = { linkToken, createdAt: Date.now(), itemId };
  fs.writeFileSync(PENDING_FILE, JSON.stringify(pending), "utf-8");
}

export function getPendingLink(): PendingLink | null {
  if (!fs.existsSync(PENDING_FILE)) {
    return null;
  }
  const pending = JSON.parse(fs.readFileSync(PENDING_FILE, "utf-8")) as PendingLink;
  return Date.now() - pending.createdAt < PENDING_MAX_AGE_MS ? pending : null;
}

export function clearPendingLink(): void {
  if (fs.existsSync(PENDING_FILE)) {
    fs.rmSync(PENDING_FILE);
  }
}
