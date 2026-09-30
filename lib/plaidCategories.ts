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

// Applies to Plaid's categories and to anything typed or saved by hand, so
// "entertainment" typed into the picker also lands in Extra.
export const normalizeCategory = (name: string) =>
  MERGED_INTO_EXTRA.has(name.trim().toLowerCase()) ? EXTRA : name;

export const isTithing = (...names: Array<string | null | undefined>) =>
  names.some((n) => n && /church of jesus christ/i.test(n));
