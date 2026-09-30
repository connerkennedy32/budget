// Run with: node --experimental-strip-types scripts/test-plaid-store.mts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let fails = 0;
const check = (label: string, ok: boolean, detail = "") => {
  if (!ok) fails++;
  console.log(ok ? "PASS" : "FAIL", label, ok ? "" : detail);
};
let n = 0;
// The store reads its settings when first imported, so each scenario imports a fresh copy.
const load = async (env: Record<string, string | undefined>) => {
  for (const k of ["PLAID_STORE_DIR", "PLAID_ACCESS_TOKENS", "PLAID_ACCESS_TOKEN", "PLAID_MAX_CONNECTIONS"]) delete process.env[k];
  Object.assign(process.env, Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined)));
  return import(`../lib/plaidStore.ts?case=${++n}`);
};
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "plaid-store-"));

{
  const store = await load({ PLAID_STORE_DIR: tmp() });
  check("empty store has no connections", store.getAllPlaidCredentials().length === 0);
}
{
  const dir = tmp();
  fs.writeFileSync(path.join(dir, "data.json"), JSON.stringify({ accessToken: "access-old", itemId: "item-old" }));
  const store = await load({ PLAID_STORE_DIR: dir });
  check("old single-token file is still read", JSON.stringify(store.getAllPlaidCredentials()) === JSON.stringify([{ accessToken: "access-old", itemId: "item-old" }]));
  check("adding a second connection succeeds", store.addPlaidCredentials({ accessToken: "access-new", itemId: "item-new" }) === true);
  const after = JSON.parse(fs.readFileSync(path.join(dir, "data.json"), "utf-8"));
  check("file is upgraded to a list and keeps the old one", Array.isArray(after.items) && after.items.length === 2 && after.items[0].itemId === "item-old");
  check("adding the same item again is refused", store.addPlaidCredentials({ accessToken: "x", itemId: "item-new" }) === false);
  check("still exactly two after the duplicate", store.getAllPlaidCredentials().length === 2);
}
{
  const store = await load({ PLAID_STORE_DIR: tmp(), PLAID_ACCESS_TOKENS: "tok-a, tok-b ,tok-a", PLAID_ACCESS_TOKEN: "tok-c" });
  const all = store.getAllPlaidCredentials();
  check("env list + legacy env token, deduped", all.map((c: { accessToken: string }) => c.accessToken).join(",") === "tok-a,tok-b,tok-c");
  check("env ids are stable and don't contain the token", all.every((c: { itemId: string; accessToken: string }) => c.itemId.startsWith("env-") && !c.itemId.includes(c.accessToken)));
  const again = (await load({ PLAID_STORE_DIR: tmp(), PLAID_ACCESS_TOKENS: "tok-a" })).getAllPlaidCredentials();
  check("same token gives the same id in a fresh process", again[0].itemId === all[0].itemId);
}
{
  const dir = tmp();
  fs.writeFileSync(path.join(dir, "data.json"), JSON.stringify({ items: [{ accessToken: "file-tok", itemId: "file-item" }] }));
  const store = await load({ PLAID_STORE_DIR: dir, PLAID_ACCESS_TOKEN: "env-tok" });
  check("env tokens win over the file (deployed copy)", store.getAllPlaidCredentials().length === 1 && store.getAllPlaidCredentials()[0].accessToken === "env-tok");
}
{
  const store = await load({ PLAID_STORE_DIR: tmp() });
  check("default connection cap is 5", store.MAX_CONNECTIONS === 5);
  check("cap is configurable", (await load({ PLAID_STORE_DIR: tmp(), PLAID_MAX_CONNECTIONS: "3" })).MAX_CONNECTIONS === 3);
}
{
  const store = await load({ PLAID_STORE_DIR: tmp() });
  store.savePendingLink("link-1");
  check("pending link for a new bank has no item id", store.getPendingLink().linkToken === "link-1" && store.getPendingLink().itemId === undefined);
  store.savePendingLink("link-2", "item-x");
  check("pending link remembers the item being re-authenticated", store.getPendingLink().itemId === "item-x");
  store.clearPendingLink();
  check("cleared", store.getPendingLink() === null);
}
console.log(fails === 0 ? "\nALL PASSED" : `\n${fails} FAILED`);
process.exit(fails ? 1 : 0);
