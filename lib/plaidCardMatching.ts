// Finds card payments that appear twice: once leaving a bank account and once
// arriving on a credit card. The bank-side line is then hidden by default and
// the card-side line is treated as a transfer, so the money isn't counted on
// top of the card's own charges. Both sides must be present to match, so this
// only fires once the card itself is connected.

export type MatchTxn = {
  id: string;
  date: string; // YYYY-MM-DD
  name: string;
  amount: number; // Plaid: positive = money out, negative = money in
  accountId: string;
  // Plaid's detailed category, e.g. LOAN_PAYMENTS_CREDIT_CARD_PAYMENT.
  detailed?: string | null;
};

export type MatchAccount = { id: string; type: string };

const CARD_PAYMENT = "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT";
const MAX_DAYS_APART = 5;

// What a payment looks like from the card's side.
const CARD_SIDE_NAME = /payment|pymt|autopay|thank you/i;
// What it looks like leaving a bank account.
const BANK_SIDE_NAME = /autopay|online transfer|payment|pymt|credit crd|credit card/i;

const dayNumber = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000);
};

export function matchCardPayments(
  txns: MatchTxn[],
  accounts: MatchAccount[]
): { bankSideIds: Set<string>; cardSideIds: Set<string> } {
  const type = new Map(accounts.map((a) => [a.id, a.type]));

  const cardSide = txns.filter(
    (t) =>
      type.get(t.accountId) === "credit" &&
      t.amount < 0 &&
      (t.detailed === CARD_PAYMENT || CARD_SIDE_NAME.test(t.name))
  );
  const bankSide = txns
    .filter(
      (t) =>
        type.get(t.accountId) === "depository" &&
        t.amount > 0 &&
        (t.detailed === CARD_PAYMENT || BANK_SIDE_NAME.test(t.name))
    )
    .sort((a, b) => dayNumber(a.date) - dayNumber(b.date));

  const bankSideIds = new Set<string>();
  const cardSideIds = new Set<string>();
  for (const bank of bankSide) {
    // The closest unmatched card credit of the same amount, within a few days.
    let best: MatchTxn | undefined;
    let bestGap = Infinity;
    for (const card of cardSide) {
      if (cardSideIds.has(card.id)) continue;
      if (Math.abs(card.amount + bank.amount) > 0.01) continue;
      const gap = Math.abs(dayNumber(card.date) - dayNumber(bank.date));
      if (gap <= MAX_DAYS_APART && gap < bestGap) {
        best = card;
        bestGap = gap;
      }
    }
    if (best) {
      bankSideIds.add(bank.id);
      cardSideIds.add(best.id);
    }
  }
  return { bankSideIds, cardSideIds };
}
