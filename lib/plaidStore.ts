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

const RULES_FILE = path.join(STORE_DIR, "rules.json");

// merchant key -> category the user assigned to it
export type CategoryRules = Record<string, string>;

export const ruleKey = (merchant: string) => merchant.trim().toLowerCase();

export function getCategoryRules(): CategoryRules {
  if (!fs.existsSync(RULES_FILE)) {
    return {};
  }
  return JSON.parse(fs.readFileSync(RULES_FILE, "utf-8")) as CategoryRules;
}

// A null category removes the rule.
export function setCategoryRule(merchant: string, category: string | null): void {
  const rules = getCategoryRules();
  const key = ruleKey(merchant);
  if (category === null) {
    delete rules[key];
  } else {
    rules[key] = category;
  }
  if (!fs.existsSync(STORE_DIR)) {
    fs.mkdirSync(STORE_DIR, { recursive: true });
  }
  fs.writeFileSync(RULES_FILE, JSON.stringify(rules, null, 2), "utf-8");
}
