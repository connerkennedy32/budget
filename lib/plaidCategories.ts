// These Plaid categories are folded into one "Extra" bucket.
const MERGED_INTO_EXTRA = new Set([
  "general merchandise",
  "general services",
  "entertainment",
  "personal care",
  "bank fees",
]);

export const EXTRA = "Extra";
export const TITHING = "Tithing";
export const SUBSCRIPTION = "Subscription";

// Applies to Plaid's categories and to anything typed or saved by hand, so
// "entertainment" typed into the picker also lands in Extra.
export const normalizeCategory = (name: string) =>
  MERGED_INTO_EXTRA.has(name.trim().toLowerCase()) ? EXTRA : name;

export const isTithing = (...names: Array<string | null | undefined>) =>
  names.some((n) => n && /church of jesus christ/i.test(n));

// Merchants Plaid files under the wrong category for this budget, matched on
// the exact name (so "American Fork UT" is a different merchant).
const CATEGORY_BY_NAME: Record<string, string> = {
  "american fork": "Rent and utilities",
  costco: "Food and drink",
  target: "Food and drink",
  "google play store": SUBSCRIPTION,
  "google one": SUBSCRIPTION,
  netflix: SUBSCRIPTION,
  apple: SUBSCRIPTION,
  spotify: SUBSCRIPTION,
  cursor: SUBSCRIPTION,
  anthropic: SUBSCRIPTION,
  vercel: SUBSCRIPTION,
};

// Names that begin with these, for merchants whose statement text has a
// suffix ("Amazon Prime*AB12CD"). Kept narrow: plain "Amazon" is shopping.
const CATEGORY_BY_PREFIX: Array<[string, string]> = [["amazon prime", SUBSCRIPTION]];

// The category a merchant gets before any rule saved on a device applies.
export const defaultCategory = (
  ...names: Array<string | null | undefined>
): string | undefined => {
  if (isTithing(...names)) return TITHING;
  for (const n of names) {
    const found = n ? CATEGORY_BY_NAME[n.trim().toLowerCase()] : undefined;
    if (found) return found;
    const lower = n?.trim().toLowerCase() ?? "";
    const byPrefix = CATEGORY_BY_PREFIX.find(([prefix]) => lower.startsWith(prefix));
    if (byPrefix) return byPrefix[1];
  }
  return undefined;
};
