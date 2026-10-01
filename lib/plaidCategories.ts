export const EXTRA = "Extra";
export const HOUSING = "Housing";
export const TITHING = "Tithing";
export const SUBSCRIPTION = "Subscription";
export const INSURANCE = "Insurance";
export const GROCERIES = "Food and drink > Groceries";
export const EATING_OUT = "Food and drink > Eating out";

// Plaid's finer-grained food categories, mapped onto the two subcategories.
// Anything else Plaid files under food and drink stays in the parent.
export const foodSubcategory = (detailed: string | null | undefined): string | undefined => {
  if (detailed === "FOOD_AND_DRINK_GROCERIES") return GROCERIES;
  if (
    detailed === "FOOD_AND_DRINK_RESTAURANT" ||
    detailed === "FOOD_AND_DRINK_FAST_FOOD" ||
    detailed === "FOOD_AND_DRINK_COFFEE"
  )
    return EATING_OUT;
  return undefined;
};

// Categories that no longer exist, and where they went (keys are lowercase).
const MERGED_INTO: Record<string, string> = {
  "general merchandise": EXTRA,
  "general services": EXTRA,
  entertainment: EXTRA,
  "personal care": EXTRA,
  "bank fees": EXTRA,
  "loan payments": HOUSING,
  "rent and utilities": HOUSING,
  // Now subcategories of Extra ("Parent > Child").
  "home improvement": "Extra > Home improvement",
  travel: "Extra > Travel",
  medical: "Extra > Medical",
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
  costco: GROCERIES,
  target: GROCERIES,
  harmons: GROCERIES,
  maceys: GROCERIES,
  "google play store": SUBSCRIPTION,
  "google one": SUBSCRIPTION,
  netflix: SUBSCRIPTION,
  xfinity: SUBSCRIPTION,
  "state farm": "Transportation",
  apple: SUBSCRIPTION,
  spotify: SUBSCRIPTION,
  cursor: SUBSCRIPTION,
  anthropic: SUBSCRIPTION,
  vercel: SUBSCRIPTION,
  "jack and jill lanes": EXTRA,
  "avolta aams sbx": "Travel",
  "byu idaho": SUBSCRIPTION,
  "rocky mountain movers": SUBSCRIPTION,
  excelappraise: HOUSING,
  "sunset blvd": "Food and drink",
  slackwater: "Food and drink",
  "last chance 2": "Transportation",
  copenhagen: "Travel",
  "gudvangen fjordtel gud": "Travel",
  bergen: "Travel",
  walmart: GROCERIES,
  "usaa insurance payment www.usaa.com": "Transportation",
  "utah dmv delta office": "Transportation",
  sierra: EXTRA,
  "vrf automatgondol voss": EXTRA,
  "borgund stavkyrkje": EXTRA,
  "utah state tax commission": EXTRA,
  "snipe island crafthouse": EXTRA,
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
