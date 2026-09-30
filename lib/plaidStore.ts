import fs from "node:fs";
import path from "node:path";

const STORE_DIR = path.join(process.cwd(), ".plaid");
const STORE_FILE = path.join(STORE_DIR, "data.json");

export type PlaidCredentials = {
  accessToken: string;
  itemId: string;
};

export function getPlaidCredentials(): PlaidCredentials | null {
  // A deployed copy can't write files, so its token comes from the environment.
  if (process.env.PLAID_ACCESS_TOKEN) {
    return {
      accessToken: process.env.PLAID_ACCESS_TOKEN,
      itemId: process.env.PLAID_ITEM_ID ?? "env",
    };
  }
  if (!fs.existsSync(STORE_FILE)) {
    return null;
  }
  const raw = fs.readFileSync(STORE_FILE, "utf-8");
  return JSON.parse(raw) as PlaidCredentials;
}

export function savePlaidCredentials(creds: PlaidCredentials): void {
  if (!fs.existsSync(STORE_DIR)) {
    fs.mkdirSync(STORE_DIR, { recursive: true });
  }
  fs.writeFileSync(STORE_FILE, JSON.stringify(creds, null, 2), "utf-8");
}

const PENDING_FILE = path.join(STORE_DIR, "pending-link.json");

// Plaid link tokens expire after 4 hours; stop offering them a little sooner.
const PENDING_MAX_AGE_MS = 3 * 60 * 60 * 1000;

type PendingLink = { linkToken: string; createdAt: number };

export function savePendingLink(linkToken: string): void {
  if (!fs.existsSync(STORE_DIR)) {
    fs.mkdirSync(STORE_DIR, { recursive: true });
  }
  const pending: PendingLink = { linkToken, createdAt: Date.now() };
  fs.writeFileSync(PENDING_FILE, JSON.stringify(pending), "utf-8");
}

export function getPendingLinkToken(): string | null {
  if (!fs.existsSync(PENDING_FILE)) {
    return null;
  }
  const pending = JSON.parse(fs.readFileSync(PENDING_FILE, "utf-8")) as PendingLink;
  return Date.now() - pending.createdAt < PENDING_MAX_AGE_MS
    ? pending.linkToken
    : null;
}

export function clearPendingLink(): void {
  if (fs.existsSync(PENDING_FILE)) {
    fs.rmSync(PENDING_FILE);
  }
}
