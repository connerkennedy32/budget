// The same bank account can arrive through two logins (a joint account linked
// by both people). Plaid gives each login its own transaction ids, so the two
// copies would otherwise show every transaction twice.

export type DedupeInput = {
  institutionId: string | null | undefined;
  accounts: Array<{
    account_id: string;
    type: string;
    subtype?: string | null;
    mask?: string | null;
  }>;
};

// Returns the ids of accounts that duplicate one already seen on an earlier
// connection. The earlier connection's copy is the one kept, which also keeps
// transaction ids you've already hidden valid.
export function duplicateAccountIds(items: DedupeInput[]): Set<string> {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const item of items) {
    const thisItem = new Set<string>();
    for (const a of item.accounts) {
      // Without an institution or last digits there's nothing safe to compare.
      if (!item.institutionId || !a.mask) continue;
      const key = `${item.institutionId}|${a.type}|${a.subtype ?? ""}|${a.mask}`;
      if (seen.has(key)) duplicates.add(a.account_id);
      else thisItem.add(key);
    }
    // Added after the loop so two accounts inside one login never match each other.
    thisItem.forEach((k) => seen.add(k));
  }
  return duplicates;
}
