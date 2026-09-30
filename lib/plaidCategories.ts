export const EXTRA = "Extra";
export const HOUSING = "Housing";
export const TITHING = "Tithing";
export const SUBSCRIPTION = "Subscription";
export const INSURANCE = "Insurance";

// Categories that no longer exist, and where they went (keys are lowercase).
const MERGED_INTO: Record<string, string> = {
  "general merchandise": EXTRA,
  "general services": EXTRA,
  entertainment: EXTRA,
  "personal care": EXTRA,
  "bank fees": EXTRA,
  "loan payments": HOUSING,
  "rent and utilities": HOUSING,
};

// Applies to Plaid's categories and to anything typed or saved by hand, so
// "entertainment" typed into the picker lands in Extra, and older saved
// rules pointing at "Rent and utilities" show as Housing.
export const normalizeCategory = (name: string) =>
  MERGED_INTO[name.trim().toLowerCase()] ?? name;

// Credit card autopays and transfers to your own cards. Plaid files them under
// Loan payments; here they go to Extra. Only used for that Plaid category, so a
// transfer Plaid calls "Transfer out" stays out of spending.
export const isCardPaymentOrTransfer = (...names: Array<string | null | undefined>) =>
  names.some((n) => n && /^(chase credit crd|online transfer)/i.test(n.trim()));

export const isTithing = (...names: Array<string | null | undefined>) =>
  names.some((n) => n && /church of jesus christ/i.test(n));

// Merchants Plaid files under the wrong category for this budget, matched on
// the exact name (so "American Fork UT" is a different merchant).
const CATEGORY_BY_NAME: Record<string, string> = {
  "american fork": HOUSING,
  costco: "Food and drink",
  target: "Food and drink",
  "google play store": SUBSCRIPTION,
  "google one": SUBSCRIPTION,
  netflix: SUBSCRIPTION,
  "state farm": INSURANCE,
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
