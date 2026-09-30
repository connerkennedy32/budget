import fs from "node:fs";
import path from "node:path";

const STORE_DIR = path.join(process.cwd(), ".plaid");
const STORE_FILE = path.join(STORE_DIR, "data.json");

export type PlaidCredentials = {
  accessToken: string;
  itemId: string;
};

export function getPlaidCredentials(): PlaidCredentials | null {
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
