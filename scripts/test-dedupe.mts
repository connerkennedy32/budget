// Run with: node --experimental-strip-types scripts/test-dedupe.mts
import { duplicateAccountIds, type DedupeInput } from "../lib/plaidDedupe.ts";
let fails = 0;
const check = (label: string, got: Set<string>, want: string[]) => {
  const ok = [...got].sort().join(",") === want.sort().join(",");
  if (!ok) fails++;
  console.log(ok ? "PASS" : "FAIL", label, ok ? "" : `got=[${[...got]}] want=[${want}]`);
};
const acct = (id: string, mask: string | null, type = "depository", subtype = "checking") => ({ account_id: id, mask, type, subtype });
const wf = "ins_wf", chase = "ins_chase";

check("joint checking on two logins: the earlier copy is the duplicate",
  duplicateAccountIds([{ institutionId: wf, accounts: [acct("his-chk", "6954")] }, { institutionId: wf, accounts: [acct("her-active", "6615", "credit", "credit card"), acct("her-chk", "6954")] }]), ["his-chk"]);
check("different institutions with the same last digits are different accounts",
  duplicateAccountIds([{ institutionId: wf, accounts: [acct("a", "1234")] }, { institutionId: chase, accounts: [acct("b", "1234")] }]), []);
check("same digits inside one login are not duplicates of each other",
  duplicateAccountIds([{ institutionId: wf, accounts: [acct("a", "1234"), acct("b", "1234")] }]), []);
check("accounts with no last digits are never matched",
  duplicateAccountIds([{ institutionId: wf, accounts: [acct("a", null)] }, { institutionId: wf, accounts: [acct("b", null)] }]), []);
check("checking and savings with the same digits are different accounts",
  duplicateAccountIds([{ institutionId: wf, accounts: [acct("a", "9999", "depository", "checking")] }, { institutionId: wf, accounts: [acct("b", "9999", "depository", "savings")] }]), []);
check("a missing institution is never matched",
  duplicateAccountIds([{ institutionId: null, accounts: [acct("a", "1")] }, { institutionId: null, accounts: [acct("b", "1")] }]), []);
check("the same account on three logins: both earlier copies are duplicates",
  duplicateAccountIds([{ institutionId: wf, accounts: [acct("a", "6954")] }, { institutionId: wf, accounts: [acct("b", "6954")] }, { institutionId: wf, accounts: [acct("c", "6954")] }]), ["a", "b"]);
check("if the newer login is missing, the other copy is kept",
  duplicateAccountIds([{ institutionId: wf, accounts: [acct("her-chk", "6954")] }]), []);
check("two cards with different digits on one login are both kept",
  duplicateAccountIds([{ institutionId: wf, accounts: [acct("his-chk", "6954")] }, { institutionId: wf, accounts: [acct("c1", "6615", "credit", "credit card"), acct("c2", "6910", "credit", "credit card")] }]), []);
console.log(fails === 0 ? "\nALL PASSED" : `\n${fails} FAILED`);
process.exit(fails ? 1 : 0);
