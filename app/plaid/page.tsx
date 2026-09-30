"use client";

import { useCallback, useEffect, useState } from "react";
import { usePlaidLink } from "react-plaid-link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Transaction = {
  id: string;
  date: string;
  name: string;
  amount: number;
  category: string | null;
};

type Account = {
  id: string;
  name: string;
  type: string;
  balance: number;
};

const formatMoney = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD" });

// Credit and loan balances are amounts owed, so they reduce the total.
const isLiability = (type: string) => type === "credit" || type === "loan";

type Status = "loading" | "not_linked" | "linked";

export default function PlaidPage() {
  const [status, setStatus] = useState<Status>("loading");
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [error, setError] = useState<string | null>(null);

  const checkStatus = useCallback(async () => {
    const res = await fetch("/api/plaid/status");
    const data = (await res.json()) as { linked: boolean };
    setStatus(data.linked ? "linked" : "not_linked");
  }, []);

  const loadTransactions = useCallback(async () => {
    const res = await fetch("/api/plaid/transactions");
    const data = (await res.json()) as
      | { transactions: Transaction[]; accounts: Account[] }
      | { error: string };
    if ("error" in data) {
      setError(data.error);
      return;
    }
    setTransactions(data.transactions);
    setAccounts(data.accounts);
  }, []);

  useEffect(() => {
    fetch("/api/plaid/status")
      .then((res) => res.json() as Promise<{ linked: boolean }>)
      .then((data) => setStatus(data.linked ? "linked" : "not_linked"));
  }, []);

  useEffect(() => {
    if (status !== "linked") return;
    fetch("/api/plaid/transactions")
      .then(
        (res) =>
          res.json() as Promise<
            { transactions: Transaction[]; accounts: Account[] } | { error: string }
          >
      )
      .then((data) => {
        if ("error" in data) {
          setError(data.error);
          return;
        }
        setTransactions(data.transactions);
        setAccounts(data.accounts);
      });
  }, [status]);

  const fetchLinkToken = useCallback(async () => {
    setError(null);
    const res = await fetch("/api/plaid/link-token", { method: "POST" });
    const data = (await res.json()) as
      | { linkToken: string }
      | { error: string };
    if ("error" in data) {
      setError(data.error);
      return;
    }
    setLinkToken(data.linkToken);
  }, []);

  const { open, ready } = usePlaidLink({
    token: linkToken,
    onSuccess: async (publicToken) => {
      const res = await fetch("/api/plaid/exchange-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ publicToken }),
      });
      const data = (await res.json()) as { ok?: true; error?: string };
      if (data.error) {
        setError(data.error);
        return;
      }
      setLinkToken(null);
      await checkStatus();
    },
  });

  useEffect(() => {
    if (linkToken && ready) {
      open();
    }
  }, [linkToken, ready, open]);

  return (
    <div className="mx-auto max-w-2xl p-4">
      <Card>
        <CardHeader>
          <CardTitle>Plaid</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {error && (
            <div className="flex flex-col gap-2 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
              <span>{error}</span>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setError(null);
                  return status === "linked" ? loadTransactions() : checkStatus();
                }}
              >
                Retry
              </Button>
            </div>
          )}

          {status === "loading" && <p className="text-sm text-muted-foreground">Loading...</p>}

          {status === "not_linked" && (
            <Button onClick={fetchLinkToken}>Connect a bank</Button>
          )}

          {status === "linked" && (
            <div className="flex flex-col gap-2">
              {accounts.length > 0 && (
                <div className="mb-2 flex flex-col gap-1 rounded-lg bg-muted/50 p-3 text-sm">
                  <div className="flex items-center justify-between font-medium">
                    <span>Total balance</span>
                    <span>
                      {formatMoney(
                        accounts.reduce(
                          (sum, a) =>
                            sum + (isLiability(a.type) ? -a.balance : a.balance),
                          0
                        )
                      )}
                    </span>
                  </div>
                  {accounts.map((a) => (
                    <div
                      key={a.id}
                      className="flex items-center justify-between text-xs text-muted-foreground"
                    >
                      <span>{a.name}</span>
                      <span>
                        {isLiability(a.type) ? "-" : ""}
                        {formatMoney(a.balance)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {transactions.length === 0 && !error && (
                <p className="text-sm text-muted-foreground">
                  No transactions in the last 30 days.
                </p>
              )}
              {transactions.map((t) => (
                <div
                  key={t.id}
                  className="flex items-center justify-between border-b border-border/50 py-2 text-sm last:border-0"
                >
                  <div className="flex flex-col">
                    <span>{t.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {t.date}
                      {t.category ? ` · ${t.category}` : ""}
                    </span>
                  </div>
                  <span>${t.amount.toFixed(2)}</span>
                </div>
              ))}
              <Button
                size="sm"
                variant="outline"
                onClick={fetchLinkToken}
                className="mt-2 self-start"
              >
                Connect another bank
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
