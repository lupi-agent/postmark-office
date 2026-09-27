// funding-report.test.mjs — falsifiers for the one read the founder's sixty
// seconds are spent on.
//
// THE VALIDATION RULE (Keemin, 2026-08-21): every falsifier CITES THE SENTENCE
// OF LAW IT ASSERTS, quoted verbatim in the test itself.
//
// The claim under test is not "it renders" — it is that the report cannot
// present a quiet queue as an all-clear while a watcher is down, cannot show a
// stuck row without saying what will unstick it, and cannot silently reconcile
// the pot file's own number with the ledger's.

import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";

import { foldFunding, readPots, parseLedgerText } from "../src/funding.mjs";
import { railHealth, anomalies, render, readyToWitness, witnessCommand, STALE_MINUTES, TOWN_LOCK } from "../tools/funding-report.mjs";
import { stripeQueue } from "../tools/funding-report.mjs";
import { decide, decodeSession, OUTSIDE_FROM, HANDLE_FIELD } from "../tools/stripe-watch.mjs";
import { townLoginHands } from "../src/household-logins.mjs";
import { NO_TOWN, townClone, townModuleUrl } from "./fixture-paths.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const TOWN = [townClone()].filter(Boolean)
  .find((p) => existsSync(join(p, "tools", "stamp-mint.mjs")));

// The town engine, imported once — the same one the fixture copies into each
// throwaway repo, so the falsifiers below read households through the town s own
// resolver rather than a second answer.
// Guarded: a top-level await import of a clone that is not there takes the
// whole module down at load, and its cases then neither pass nor fail.
const ENGINE = TOWN ? await import(townModuleUrl("tools", "stamp-mint.mjs")) : null;
const SKIP = !TOWN && NO_TOWN;

const NOW = Date.UTC(2026, 7, 26, 12, 0, 0);
const minsAgo = (m) => new Date(NOW - m * 60_000).toISOString();

const EMPTY = { fold: { invalid: [] }, potsInvalid: [], stripe: { anomaly: [] }, usdcReport: null, walletInvalid: [], mapInvalid: [] };

function seamTown({ pins = { paz: { login: "p", id: 2 }, stan: { login: "s", id: 1 } } } = {}) {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const repo = mkdtempSync(join(tmpdir(), "report-town-"));
  mkdirSync(join(repo, "tools"), { recursive: true });
  mkdirSync(join(repo, "WHITE_PAGES"), { recursive: true });
  writeFileSync(join(repo, "tools", "github-ids.json"), JSON.stringify(pins));
  writeFileSync(join(repo, "WHITE_PAGES", "mail-ledger.md"), "# ledger\n\n- 2026-06-12 · m-1 · stan → paz · thread: new\n");
  writeFileSync(join(repo, "tools", "stamp-pubkey.pem"), publicKey.export({ type: "spki", format: "pem" }));
  writeFileSync(join(repo, "ECONOMY-DIALS.json"), JSON.stringify({
    law_side: { town_issuance: { treasury_handle: "the-town", once_purposes: [] }, keeping: { sigma: 0.5, rho: 0.5, rho_constitutional_ceiling: 0.5 } },
  }));
  // received_usd deliberately LEFT AT 0 while a receipt lands, so the two-clock
  // disclosure has something to disagree about.
  writeFileSync(join(repo, "WHITE_PAGES", "pot-keep.json"), JSON.stringify({ pot: "keep", status: "open", title: "Keep the lights on", beneficiary: "keeper", target_usd_per_epoch: 100, epoch_cadence: "monthly", received_usd: 0 }));
  const keyFile = join(repo, "stamp-key.pem");
  writeFileSync(keyFile, privateKey.export({ type: "pkcs8", format: "pem" }));
  // a real git repo and the town's real tools, so the command this report PRINTS
  // can be executed here exactly as the operator would paste it
  for (const f of ["stamp-mint.mjs", "epoch-close.mjs"])
    writeFileSync(join(repo, "tools", f), readFileSync(join(TOWN, "tools", f)));
  execFileSync("git", ["init", "-q"], { cwd: repo, encoding: "utf8" });
  execFileSync("git", ["add", "-A"], { cwd: repo, encoding: "utf8" });
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "fixture"], { cwd: repo, encoding: "utf8" });
  execFileSync(process.execPath, [join(TOWN, "tools", "stamp-mint.mjs"), "--append", "--key", keyFile, "--repo", repo], { encoding: "utf8" });
  return { repo, keyFile };
}

const receipt = ({ repo, keyFile }, { pot = "keep", rail = "stripe", usd = 10, from = "paz", ref, date = "2026-08-01" }) =>
  execFileSync(process.execPath, [
    join(TOWN, "tools", "epoch-close.mjs"), "--receipt", "--pot", pot, "--rail", rail,
    "--usd", String(usd), "--from", from, "--ref", ref, "--date", date, "--key", keyFile, "--repo", repo,
  ], { encoding: "utf8", stdio: "pipe" });

const foldOf = (repo) => foldFunding(parseLedgerText(readFileSync(join(repo, "WHITE_PAGES", "stamp-ledger.md"), "utf8")));

// ════════════════════════════════════════════════════════════════════════════
// A DEAD WATCHER IS THE LOUDEST ANOMALY
// ════════════════════════════════════════════════════════════════════════════

test("a rail that has not ticked is reported as one, and its silence is refused as evidence", { skip: SKIP }, () => {
  // LAW (tools/usdc-watch.mjs, on an unreachable chain, verbatim): "a silent
  //     empty report from a blind watcher is indistinguishable from a quiet day,
  //     and the second one is a lie." A report built on a stale watcher's
  //     artifacts inherits exactly that hazard, one layer up.
  const fresh = railHealth("usdc-watch", { last_run: minsAgo(3) }, { now: NOW });
  assert.equal(fresh.ok, true);

  const stale = railHealth("usdc-watch", { last_run: minsAgo(STALE_MINUTES + 1) }, { now: NOW });
  assert.equal(stale.ok, false);
  assert.match(stale.note, /a quiet queue here proves nothing/);

  // never-run and long-ago are DIFFERENT answers and must not be folded together
  const never = railHealth("stripe-watch", {}, { now: NOW });
  assert.equal(never.ok, false);
  assert.equal(never.last_run, null);
  assert.match(never.note, /has never run/);
  assert.notEqual(never.note, stale.note);
});

test("the rendered report carries the warning banner whenever any rail is down, and not when none is", { skip: SKIP }, () => {
  const down = render({
    now: NOW, pots: [], potsInvalid: [], fold: foldFunding([]), anomalyRows: [],
    rails: [railHealth("stripe-watch", {}, { now: NOW }), railHealth("usdc-watch", { last_run: minsAgo(1) }, { now: NOW })],
    stripe: { hold: [] }, usdcReport: null, registry: { addresses: 0, wallet_files: 0, mapped_pots: 0 },
  });
  assert.match(down, /A rail that has not ticked is not a quiet rail/);

  const up = render({
    now: NOW, pots: [], potsInvalid: [], fold: foldFunding([]), anomalyRows: [],
    rails: [railHealth("stripe-watch", { last_run: minsAgo(1) }, { now: NOW }), railHealth("usdc-watch", { last_run: minsAgo(1) }, { now: NOW })],
    stripe: { hold: [] }, usdcReport: null, registry: { addresses: 0, wallet_files: 0, mapped_pots: 0 },
  });
  assert.ok(!/A rail that has not ticked/.test(up), "no banner when both rails are alive");
});

// ════════════════════════════════════════════════════════════════════════════
// EVERY STUCK ROW SAYS WHAT UNSTICKS IT
// ════════════════════════════════════════════════════════════════════════════

test("every anomaly, from every source, carries a rule AND what resolves it", { skip: SKIP }, () => {
  const rows = anomalies({
    fold: { invalid: [{ row_kind: "pot-receipt", line: "- 2026-08-01 · pot-receipt · pot: keep · …", reason: "a space after the colon" }] },
    potsInvalid: [{ row_kind: "pot-file", line: "WHITE_PAGES/pot-x.json", reason: "unparseable JSON" }],
    walletInvalid: [{ row_kind: "wallet-registration", line: '{"act":"register","address":"0xnope"}', reason: "not an address" }],
    mapInvalid: [{ row_kind: "intake-map", line: "addresses[\"0xzz\"]", reason: "not a Base address" }],
    stripe: { anomaly: [{ anomaly: "needs-pot", session: "cs_1", amount_total: 1000, email: "a@b.test", why: "no client_reference_id", resolves: "the founder, by hand" }] },
    usdcReport: {
      needs_pot: [{ txhash: "0xa", usd: 40, handle: "paz", why: "the address serves more than one open pot" }],
      over_cap: [{ txhash: "0xb", usd: 40, pot: "keep", why: "past the posted target", hint: "only $10 more" }],
      unclaimed: [{ txhash: "0xc", usd: 40, from_address: "0xdead", age_days: 9, why: "no household has registered this address" }],
    },
  });
  // ledger 1 + pots 1 + wallets 1 + intake-map 1 + stripe 1 + usdc (needs-pot,
  // over-cap, unclaimed) 3 = 8. Counted from the fixture above, not from memory.
  assert.equal(rows.length, 8, "one row per stuck thing, none folded away");
  assert.deepEqual([...new Set(rows.map((r) => r.source))].sort(), ["intake-map", "ledger", "pots", "stripe", "usdc", "wallets"]);
  for (const r of rows) {
    assert.ok(r.rule && String(r.rule).length > 5, `${r.source}/${r.kind} states why it is stuck`);
    assert.ok(r.resolves && String(r.resolves).length > 5, `${r.source}/${r.kind} states what will unstick it`);
  }
  // the unclaimed row must name the sink rule AND say it is off, because that is
  // the decision the queue exists to inform
  const unclaimed = rows.find((r) => r.kind === "unclaimed");
  assert.match(unclaimed.resolves, /PROPOSED, NOT ENABLED/);
});

test("a clean town says so plainly, and the clean sentence is not reachable while anything is stuck", { skip: SKIP }, () => {
  const clean = render({
    now: NOW, pots: [], potsInvalid: [], fold: foldFunding([]), anomalyRows: [],
    rails: [railHealth("x", { last_run: minsAgo(1) }, { now: NOW })],
    stripe: { hold: [] }, usdcReport: null, registry: { addresses: 1, wallet_files: 1, mapped_pots: 1 },
  });
  assert.match(clean, /Every dollar the town has seen is attached to a pot and a hand/);

  const stuck = render({
    now: NOW, pots: [], potsInvalid: [], fold: foldFunding([]),
    anomalyRows: anomalies({ ...EMPTY, usdcReport: { unclaimed: [{ txhash: "0xc", usd: 40, from_address: "0xdead", age_days: 9, why: "unregistered" }] } }),
    rails: [railHealth("x", { last_run: minsAgo(1) }, { now: NOW })],
    stripe: { hold: [] }, usdcReport: null, registry: { addresses: 0, wallet_files: 0, mapped_pots: 0 },
  });
  assert.ok(!/Every dollar the town has seen is attached/.test(stuck));
  assert.match(stuck, /0xc/);
});

test("`Needs a person` sits above the rails and above the books", { skip: SKIP }, () => {
  // The founder's own test for this lane: read it in sixty seconds and have zero
  // matching work, only vetoes. A report you have to search for the broken thing
  // fails that whether or not the broken thing is in it. (`Ready to witness` sits
  // above all three — see its own test; this one pins the remaining order.)
  const md = render({
    now: NOW, pots: [], potsInvalid: [], fold: foldFunding([]), anomalyRows: [],
    rails: [railHealth("x", { last_run: minsAgo(1) }, { now: NOW })],
    stripe: { hold: [] }, usdcReport: null, registry: { addresses: 0, wallet_files: 0, mapped_pots: 0 },
  });
  const order = ["## Needs a person", "## The rails", "## The pots"].map((h) => md.indexOf(h));
  assert.ok(order.every((i) => i > -1), "all three sections are present");
  assert.deepEqual(order, order.slice().sort((a, b) => a - b), "and in that order");
});

// ════════════════════════════════════════════════════════════════════════════
// THE BOOKS
// ════════════════════════════════════════════════════════════════════════════

test("the pot file's received_usd and the ledger's rows are disclosed SIDE BY SIDE, never reconciled", { skip: SKIP }, () => {
  // LAW (src/funding.mjs § TEACH.receipts, verbatim): "the pot file's received
  //     and this sum are two clocks, disclosed side by side, never silently
  //     reconciled".
  const town = seamTown();
  receipt(town, { ref: "stripe:cs_x", usd: 10 });
  const fold = foldOf(town.repo);
  // the town CLI refreshes the pot file, so read it back rather than assuming
  const potJson = JSON.parse(readFileSync(join(town.repo, "WHITE_PAGES", "pot-keep.json"), "utf8"));
  const { pots } = readPots(town.repo);
  const md = render({
    now: NOW, pots, potsInvalid: [], fold, anomalyRows: [],
    rails: [railHealth("x", { last_run: minsAgo(1) }, { now: NOW })],
    stripe: { hold: [] }, usdcReport: null, registry: { addresses: 0, wallet_files: 0, mapped_pots: 0 },
  });
  assert.match(md, /witnessed this epoch \(receipts no close has settled\): \*\*\$10\*\*/);
  assert.match(md, new RegExp(`the pot file's \`received_usd\` says \\$${potJson.received_usd}`));
  assert.match(md, /`stripe:cs_x`/, "the ref that makes the dollar unique is on the page");
  assert.match(md, /\| 2026-08-01 \| stripe \| paz \| \$10 \|/);
});

test("a pot file that will not read is surfaced by name rather than dropped from the books", { skip: SKIP }, () => {
  // LAW (src/funding.mjs, verbatim): "A file that will not parse, or misses a
  //     money field, is surfaced invalid — a pot with no target is not a smaller
  //     pot, it is not a pot."
  const town = seamTown();
  writeFileSync(join(town.repo, "WHITE_PAGES", "pot-broken.json"), "{ not json");
  const { pots, invalid } = readPots(town.repo);
  assert.equal(pots.length, 1);
  assert.equal(invalid.length, 1);
  const md = render({
    now: NOW, pots, potsInvalid: invalid, fold: foldOf(town.repo), anomalyRows: anomalies({ ...EMPTY, potsInvalid: invalid }),
    rails: [railHealth("x", { last_run: minsAgo(1) }, { now: NOW })],
    stripe: { hold: [] }, usdcReport: null, registry: { addresses: 0, wallet_files: 0, mapped_pots: 0 },
  });
  assert.match(md, /pot-broken\.json/);
  assert.match(md, /Pot files that will not read/);
});

test("a card payment in the grace window is shown with the typo the operator must catch", { skip: SKIP }, () => {
  const md = render({
    now: NOW, pots: [], potsInvalid: [], fold: foldFunding([]), anomalyRows: [],
    rails: [railHealth("x", { last_run: minsAgo(1) }, { now: NOW })],
    usdcReport: null, registry: { addresses: 0, wallet_files: 0, mapped_pots: 0 },
    stripe: { hold: [{
      session: "cs_1", amount_total: 1000, email: "patron@example.test",
      plan: { pot: "keep", from: "outside:stripe", attributed: false, handle_typed: "pazz" },
      witnesses_after: "2026-08-27T00:00:00.000Z",
    }] },
  });
  assert.match(md, /after it, the ref is spent forever/);
  assert.match(md, /pazz/, "the handle they actually typed");
  assert.match(md, /gift, no holo/);
  assert.match(md, /patron@example\.test/, "and how to reach them inside the window");
});

test("a table cell can never break the table, however the reason was worded", { skip: SKIP }, () => {
  // A reason carrying a pipe would silently shear a row into gibberish, and a
  // report that mangles the one line explaining why money is stuck is worse than
  // no report.
  const rows = anomalies({ ...EMPTY, potsInvalid: [{ row_kind: "pot-file", line: "WHITE_PAGES/pot-x.json", reason: "missing a | b\nand a newline" }] });
  const md = render({
    now: NOW, pots: [], potsInvalid: [], fold: foldFunding([]), anomalyRows: rows,
    rails: [railHealth("x", { last_run: minsAgo(1) }, { now: NOW })],
    stripe: { hold: [] }, usdcReport: null, registry: { addresses: 0, wallet_files: 0, mapped_pots: 0 },
  });
  const row = md.split("\n").find((l) => l.includes("pot-x.json"));
  assert.match(row, /missing a \\\| b and a newline/, "the pipe is escaped and the newline flattened");
  assert.equal(row.split(/(?<!\\)\|/).length - 1, 6, "the row still has exactly the table's columns");
});


// ════════════════════════════════════════════════════════════════════════════
// STAGE A — one command per payment, and it must actually work
// ════════════════════════════════════════════════════════════════════════════

test("THE PRINTED COMMAND ACTUALLY RECORDS THE PAYMENT — run, not asserted", { skip: SKIP }, async () => {
  // Stage A's entire write path is a line this report prints and a person pastes.
  // A report that printed a plausible-looking command nobody had ever executed
  // would be [[states-with-no-receipt]] in its purest form: the founder would
  // find out at the moment he needed it to work.
  //
  // So: build the command the report would print, pull its payload back out, and
  // run the SAME recorder the /fund door uses. The `flock` prefix is asserted
  // textually (there is no flock on this machine); the recording is asserted by
  // executing it.
  const town = seamTown();
  const cmd = witnessCommand({ pot: "keep", usd: 10, from: "paz", ref: "stripe:cs_stagea", rail: "stripe", date: "2026-08-01" });
  assert.match(cmd, new RegExp(`^flock -w 30 ${TOWN_LOCK} node `), "the lock is IN the command — a pasted line has no office around it to take one");
  assert.match(cmd, /src\/fund-exec\.mjs '/, "and it is the office's own recorder, not a new tool");

  const payload = cmd.slice(cmd.indexOf("'") + 1, cmd.lastIndexOf("'"));
  assert.deepEqual(JSON.parse(payload), {
    pot: "keep", usd: 10, from: "paz", ref: "stripe:cs_stagea", rail: "stripe",
    date: "2026-08-01", via: "the operator by hand",
  });

  const out = execFileSync(process.execPath, [join(HERE, "..", "src", "fund-exec.mjs"), payload], {
    encoding: "utf8",
    env: { ...process.env, TOWN_CLONE: town.repo, STAMP_KEY: town.keyFile, TOWN_PUSH: "", BOT_NAME: "t", BOT_EMAIL: "t@t" },
  });
  const result = JSON.parse(out.trim().split("\n").at(-1));
  assert.equal(result.error, undefined, `the pasted command recorded cleanly: ${out}`);
  assert.equal(result.rail, "stripe");

  const ledger = readFileSync(join(town.repo, "WHITE_PAGES", "stamp-ledger.md"), "utf8");
  assert.match(ledger, /pot-receipt · pot:keep · rail: stripe · usd: 10 · from: paz · ref: stripe:cs_stagea/);

  // and pasting it TWICE is safe, because the ledger refuses a ref it holds —
  // which is the sentence the report tells the operator
  const again = execFileSync(process.execPath, [join(HERE, "..", "src", "fund-exec.mjs"), payload], {
    encoding: "utf8",
    env: { ...process.env, TOWN_CLONE: town.repo, STAMP_KEY: town.keyFile, TOWN_PUSH: "", BOT_NAME: "t", BOT_EMAIL: "t@t" },
  });
  const second = JSON.parse(again.trim().split("\n").at(-1));
  assert.equal(second.error?.code, 409);
  assert.match(second.error.defect, /already recorded/);
  assert.equal(readFileSync(join(town.repo, "WHITE_PAGES", "stamp-ledger.md"), "utf8").split("pot-receipt").length - 1, 1, "one payment, one receipt");
});

test("a payload that could break out of its own quoting is REFUSED, never printed", { skip: SKIP }, () => {
  // The command is single-quoted in the shell, so a single quote in the payload
  // would end the quoting and hand the rest of the line to the shell. Pots,
  // handles, refs and dates cannot contain one — and this says so rather than
  // trusting it, because the day one can is the day this prints a shell injection
  // into a document a human is told to paste.
  assert.throws(() => witnessCommand({ pot: "keep", usd: 1, from: "it's-me", ref: "r", rail: "stripe", date: "2026-08-01" }),
    /refusing to print an unquotable command/);
});

test("STAGE A HAS NO TIMER, so a fresh payment is listed anyway — and says the operator is the window", { skip: SKIP }, () => {
  // The grace window is a STAGE B mechanism. In Stage A nothing will ever witness
  // a held session later, so hiding it behind a clock would hide it forever. Both
  // are listed; the fresh one carries what the window was for.
  const ready = readyToWitness({
    stripe: {
      witness: [{ session: "cs_ripe", pot: "keep", usd: 10, from: "paz", ref: "stripe:cs_ripe", attributed: true }],
      hold: [{ session: "cs_fresh", email: "p@example.test", plan: { pot: "keep", usd: 5, from: "outside:stripe", ref: "stripe:cs_fresh", attributed: false, handle_typed: "pazz" } }],
    },
    usdcReport: null,
    date: "2026-08-01",
  });
  assert.equal(ready.length, 2, "nothing is hidden behind a clock that will never strike");
  const fresh = ready.find((r) => r.session === "cs_fresh");
  assert.equal(fresh.fresh, true);
  assert.match(fresh.note, /In Stage A you are that window: check the typed handle before pasting/);
  assert.equal(fresh.handle_typed, "pazz");
  assert.ok(ready.every((r) => r.command.includes("fund-exec.mjs")));
});

test("`Ready to witness` is the first section — it is the founder's actual work", { skip: SKIP }, () => {
  const md = render({
    now: NOW, pots: [], potsInvalid: [], fold: foldFunding([]), anomalyRows: [],
    rails: [railHealth("x", { last_run: minsAgo(1) }, { now: NOW })],
    stripe: { hold: [] }, usdcReport: null, registry: { addresses: 0, path: "/srv/x", present: false, mapped_pots: 0 },
    ready: readyToWitness({ stripe: { witness: [{ session: "cs_1", pot: "keep", usd: 10, from: "paz", ref: "stripe:cs_1", attributed: true }] }, usdcReport: null, date: "2026-08-01" }),
  });
  const order = ["## Ready to witness", "## Needs a person", "## The rails", "## The pots"].map((h) => md.indexOf(h));
  assert.ok(order.every((i) => i > -1), "all four sections present");
  assert.deepEqual(order, order.slice().sort((a, b) => a - b), "and in that order");
  assert.match(md, /flock -w 30/, "the command is on the page, ready to paste");
  assert.match(md, /Re-running one is safe/, "and it says so, because the operator will wonder");
});

test("an UNREAD card rail is never presented as a quiet one", { skip: SKIP }, () => {
  // The Stage A live read can fail (no key, refused key, Stripe down). Reporting
  // an empty card queue then is the same lie as a blind watcher reporting a quiet
  // day — usdc-watch.mjs's own words: "indistinguishable from a quiet day, and
  // the second one is a lie."
  const unread = { rail: "stripe (live read)", ok: false, last_run: null, note: "the live read FAILED (401) — the card rail was NOT read" };
  const md = render({
    now: NOW, pots: [], potsInvalid: [], fold: foldFunding([]), anomalyRows: [],
    rails: [unread, railHealth("usdc-watch", { last_run: minsAgo(1) }, { now: NOW })],
    stripe: { hold: [] }, usdcReport: null, registry: { addresses: 0, path: "/srv/x", present: false, mapped_pots: 0 }, ready: [],
  });
  assert.match(md, /the card rail was NOT read/);
  assert.match(md, /A rail that has not ticked is not a quiet rail/);
});

test("the report names the OFFICE-SIDE registry and never a town path", { skip: SKIP }, () => {
  const md = render({
    now: NOW, pots: [], potsInvalid: [], fold: foldFunding([]), anomalyRows: [],
    rails: [railHealth("x", { last_run: minsAgo(1) }, { now: NOW })],
    stripe: { hold: [] }, usdcReport: null, ready: [],
    registry: { addresses: 2, path: "/srv/postmark-wallets/registrations.jsonl", present: true, mapped_pots: 0 },
  });
  assert.match(md, /office-side; never the town repo/);
  assert.match(md, /\/srv\/postmark-wallets\/registrations\.jsonl/);
  assert.ok(!/WHITE_PAGES\/[^/]*\/wallet/.test(md), "no town-repo wallet path anywhere on the page");
});

// ════════════════════════════════════════════════════════════════════════════
// THE TWO STAGES MUST REACH THE SAME HAND
// ════════════════════════════════════════════════════════════════════════════

test("Stage A's report and Stage B's tick resolve the SAME payment to the SAME hand", { skip: SKIP }, () => {
  // LAW (tools/funding-report.mjs, verbatim): the queue is decided "through the
  //     WATCHER'S OWN pure resolver — one copy of the rule, so this report and
  //     the tick that may later act on it cannot disagree."
  //
  // The trap this exists for, found while building the login-pin channel: one
  // copy of the RULE is not one copy of the INPUTS. `resolveSession` only
  // answers with what it was handed, so a second channel threaded into the
  // watcher and not into the report gives the founder a page that says "an
  // outside gift" over the exact payment the timer will witness to a household.
  // Same function, same session, opposite answers, and nothing red anywhere.
  const town = seamTown({ pins: { paz: { login: "pazmartina", id: 2 }, stan: { login: "s", id: 1 } } });
  const engine = ENGINE;
  const entries = parseLedgerText(readFileSync(join(town.repo, "WHITE_PAGES", "stamp-ledger.md"), "utf8"));
  const loginHands = townLoginHands(town.repo, engine);
  const now = 2_000_000_000_000;
  const raw = {
    id: "cs_live_shared0000000000000000", object: "checkout.session",
    created: Math.floor(now / 1000) - 86_400, status: "complete", payment_status: "paid",
    livemode: true, amount_total: 2000, currency: "usd", client_reference_id: "keep",
    customer_details: { email: "payer@example.test" },
    custom_fields: [{ key: HANDLE_FIELD, type: "text", text: { value: "pazmartina" } }],
    payment_intent: "pi_shared",
  };

  // Stage B — the tick that would write the row
  const { todo } = decide({ sessions: [raw], engine, entries, clone: town.repo, households: engine.householdKeys(town.repo), loginHands, now });

  // Stage A — the report the founder reads, fed the journal shape
  const journal = [{ kind: "seen", ...decodeSession(raw) }];
  const buckets = stripeQueue({ journal, engine, entries, clone: town.repo, households: engine.householdKeys(town.repo), loginHands, now });

  assert.equal(todo.length, 1, "Stage B would witness exactly this payment");
  assert.equal(buckets.witness.length, 1, "and Stage A lists exactly this payment");
  assert.equal(todo[0].from, "paz");
  assert.equal(buckets.witness[0].from, todo[0].from, "the page and the timer name the same hand");
  assert.equal(buckets.witness[0].attributed_via, "login-pin");
  assert.notEqual(buckets.witness[0].from, OUTSIDE_FROM, "the report must not call a pinned hand a gift");
});


test("POS-183 · the report reads a EUR payment's SETTLED dollars from the journal, the late `settled` row included", { skip: SKIP }, () => {
  // LAW (tools/stripe-watch.mjs, the header, verbatim): "A settlement held
  //     only in this process's memory would give the report and the tick two
  //     answers for one payment — the report would say "unsettled" over a
  //     dollar the tick witnessed."
  //
  // Driven through the report's own CLI with no STRIPE_KEY, so it takes the
  // journal branch the box's operator reads. The settlement arrives as its own
  // row a tick after the session was first journalled, which is the case a
  // reader of `seen` rows alone would get wrong.
  const town = seamTown();
  const scratch = mkdtempSync(join(tmpdir(), "report-settled-"));
  const created = Math.floor(Date.now() / 1000) - 2 * 86_400;
  const raw = {
    id: "cs_live_eur000000000000000000000", object: "checkout.session", created, status: "complete", payment_status: "paid",
    livemode: true, amount_total: 1840, currency: "eur", client_reference_id: "keep",
    customer_details: { email: "payer@example.test" },
    custom_fields: [{ key: HANDLE_FIELD, type: "text", text: { value: "paz" } }],
    payment_intent: "pi_eur",
  };
  const pending = { ...raw, id: "cs_live_eurpending000000000000000", payment_intent: "pi_pending" };
  const journalPath = join(scratch, "stripe-intake.jsonl");
  writeFileSync(journalPath, [
    { kind: "seen", at: "T0", ...decodeSession(raw) },
    { kind: "seen", at: "T0", ...decodeSession(pending) },
    { kind: "settled", at: "T1", session: raw.id, settled: { balance_transaction: "txn_eur", currency: "usd", amount: 2013 } },
  ].map((r) => JSON.stringify(r)).join("\n") + "\n");

  const out = execFileSync(process.execPath, [
    join(HERE, "..", "tools", "funding-report.mjs"),
    "--clone", town.repo,
    "--stripe-state", join(scratch, "state.json"),
    "--stripe-journal", journalPath,
    "--usdc-state", join(scratch, "usdc-state.json"),
    "--usdc-report", join(scratch, "usdc-report.json"),
  ], { encoding: "utf8", env: { ...process.env, STRIPE_KEY: "", TOWN_CLONE: "" }, maxBuffer: 16 * 1024 * 1024 });

  assert.match(out, /"usd":20/, "the paste-ready command carries the settled whole dollars");
  assert.match(out, /presented as 18\.40 EUR; it settled to \$20\.13/, "and the page says what was shown and what settled");
  // the one still waiting on its balance transaction is named in its own currency
  assert.match(out, /cs_live_eurpending0+ · 18\.40 EUR/);
  assert.doesNotMatch(out, /\$18\.4\b/, "a euro amount is never printed with a dollar sign");
});

test("a payment resolved through a PIN says so on the page a person actually reads", { skip: SKIP }, () => {
  // LAW (tools/stripe-watch.mjs, the header, verbatim): "AND IT SAYS SO ON THE
  //     ROW. The pin is the only channel that pays a hand the payer did not
  //     type, so a resolution through it carries `attributed_via: "login-pin"`
  //     and a note naming what was typed, what it became, and on whose
  //     authority — because the grace window exists for a person to veto a
  //     resolution, and one nobody can see is not reviewable."
  //
  // A disclosure carried on an object and never printed is not a disclosure.
  // Without this, a pin resolution renders on the founder's report identically
  // to a handle that was simply typed correctly — and it is the ONE row where
  // the office chose a hand the payer never wrote down.
  const plan = {
    pot: "keep", usd: 20, from: "paz", rail: "stripe", ref: "stripe:cs_pin",
    attributed: true, attributed_via: "login-pin", handle_typed: "pazmartina",
    pin_note: '"pazmartina" is not a resident handle — it is the GitHub login the town\'s own pins bind to household gh:2, whose one hand is paz. The town\'s own verified pin is the hand — attributed, not guessed.',
  };
  const ready = readyToWitness({ stripe: { witness: [{ ...plan, session: "cs_pin" }], hold: [] }, usdcReport: null, date: "2026-08-27" });
  const md = render({
    now: NOW, pots: [], potsInvalid: [], fold: foldFunding([]), anomalyRows: [],
    rails: [railHealth('x', { last_run: minsAgo(1) }, { now: NOW })],
    stripe: { hold: [] }, usdcReport: null, registry: { addresses: 0, wallet_files: 0, mapped_pots: 0 },
    ready,
  });

  assert.match(md, /pazmartina/, "the string the payer typed reaches the page");
  assert.match(md, /attributed, not guessed/, "and the authority it was resolved on");

  // and a plain handle match says nothing extra — the disclosure belongs to the
  // channel that earned it, not to every attributed row
  const plainReady = readyToWitness({
    stripe: { witness: [{ pot: "keep", usd: 5, from: "paz", rail: "stripe", ref: "stripe:cs_plain", attributed: true, attributed_via: "handle", handle_typed: "paz", session: "cs_plain" }], hold: [] },
    usdcReport: null, date: "2026-08-27",
  });
  const plainMd = render({
    now: NOW, pots: [], potsInvalid: [], fold: foldFunding([]), anomalyRows: [],
    rails: [railHealth('x', { last_run: minsAgo(1) }, { now: NOW })],
    stripe: { hold: [] }, usdcReport: null, registry: { addresses: 0, wallet_files: 0, mapped_pots: 0 },
    ready: plainReady,
  });
  assert.doesNotMatch(plainMd, /attributed, not guessed/);

  // THE HOLD TABLE, the other surface. It already shows "as" beside "typed", so
  // a pin resolution is visible there — but two differing cells read like a
  // DEFECT unless the page says why they differ, and this is the row a person is
  // most likely to want to veto while the ref is still unspent.
  const held = render({
    now: NOW, pots: [], potsInvalid: [], fold: foldFunding([]), anomalyRows: [],
    rails: [railHealth('x', { last_run: minsAgo(1) }, { now: NOW })],
    usdcReport: null, registry: { addresses: 0, wallet_files: 0, mapped_pots: 0 }, ready: [],
    stripe: { hold: [{ session: 'cs_h', amount_total: 2000, email: null, witnesses_after: '2026-08-28T00:00:00Z', plan: { ...plan } }] },
  });
  assert.match(held, /Where \*\*as\*\* differs from \*\*typed\*\*/, 'the table explains the difference it is showing');
  assert.match(held, /pays a hand the payer did not type/);

  // and a hold with no pin resolution gets no such footnote
  const plainHeld = render({
    now: NOW, pots: [], potsInvalid: [], fold: foldFunding([]), anomalyRows: [],
    rails: [railHealth('x', { last_run: minsAgo(1) }, { now: NOW })],
    usdcReport: null, registry: { addresses: 0, wallet_files: 0, mapped_pots: 0 }, ready: [],
    stripe: { hold: [{ session: 'cs_p', amount_total: 500, email: null, witnesses_after: '2026-08-28T00:00:00Z', plan: { pot: 'keep', usd: 5, from: 'paz', attributed: true, attributed_via: 'handle', handle_typed: 'paz' } }] },
  });
  assert.doesNotMatch(plainHeld, /Where \*\*as\*\* differs from \*\*typed\*\*/);
});

// ════════════════════════════════════════════════════════════════════════════
// POS-218 · THE REPORT READS A CORRECTION THE WAY THE CLOSE DOES
// ════════════════════════════════════════════════════════════════════════════

test("POS-218 · a founder pot-correction re-hands the receipt on the report exactly as the close mints it — and an uncorrected outside receipt stays outside", { skip: SKIP }, () => {
  // LAW (town tools/stamp-mint.mjs § foldPotReceipts, verbatim): "The hand is
  //     corrected here — every reader should show who really paid". The close
  //     reads that fold; the report must name the same payer for the same dollars.
  const town = seamTown();
  receipt(town, { ref: "stripe:cs_fixed", usd: 10, from: "outside:stripe", date: "2026-08-01" });
  receipt(town, { ref: "stripe:cs_stays", usd: 5, from: "outside:stripe", date: "2026-08-02" });
  // the founder's hand, through the town's own verb — the only writer of this row
  execFileSync(process.execPath, [
    join(TOWN, "tools", "epoch-close.mjs"), "--correct-hand", "--ref", "stripe:cs_fixed", "--from", "outside:stripe", "--to", "paz",
    "--reason", "founder-directed-attribution", "--by", "keemin", "--date", "2026-08-03", "--key", town.keyFile, "--repo", town.repo,
  ], { encoding: "utf8", stdio: "pipe" });

  // the close's own answer, never run for real
  const dry = execFileSync(process.execPath, [
    join(TOWN, "tools", "epoch-close.mjs"), "--close", "--pot", "keep", "--epoch", "2026-08", "--date", "2026-08-31", "--dry-run", "--repo", town.repo,
  ], { encoding: "utf8", stdio: "pipe" });
  // one holo row per receipt the close settles, naming its payer and its ref
  const closePayer = (ref) => dry.split(/\r?\n/).map((l) => /holo · (\S+) · \d+ · pot:keep · epoch:2026-08 · ref: (\S+)$/.exec(l.trim())).find((m) => m?.[2] === ref)?.[1];
  assert.equal(closePayer("stripe:cs_fixed"), "paz", "the close mints the corrected receipt to the corrected hand");
  assert.equal(closePayer("stripe:cs_stays"), "outside:stripe", "and the uncorrected one to outside");

  const fold = foldOf(town.repo);
  const { pots } = readPots(town.repo);
  const md = render({
    now: NOW, pots, potsInvalid: [], fold, anomalyRows: [],
    rails: [railHealth("x", { last_run: minsAgo(1) }, { now: NOW })],
    stripe: { hold: [] }, usdcReport: null, registry: { addresses: 0, wallet_files: 0, mapped_pots: 0 },
  });
  const reportPayer = (ref) => new RegExp(String.raw`^\| \S+ \| stripe \| (?:\*\*)?([^ |*]+)(?:\*\*)?[^|]* \| \$\d+ \| \`${ref}\``, "m").exec(md)?.[1];
  assert.equal(reportPayer("stripe:cs_fixed"), closePayer("stripe:cs_fixed"), "report and close name the same payer for the corrected $10");
  assert.equal(reportPayer("stripe:cs_stays"), closePayer("stripe:cs_stays"), "report and close name the same payer for the uncorrected $5");
  assert.match(md, /\*\*paz\*\* \(corrected from outside:stripe, 2026-08-03 · founder-directed-attribution\) \| \$10 \|/, "the page says the hand was corrected, and from what");
  assert.match(md, /\| 2026-08-02 \| stripe \| outside:stripe \| \$5 \|/, "an uncorrected outside receipt still prints as outside, unannotated");
  assert.doesNotMatch(md, /Corrections that did not apply/);
});

test("POS-218 · a correction the town's rule refuses is named on the report and changes no hand", { skip: SKIP }, () => {
  const town = seamTown();
  receipt(town, { ref: "stripe:cs_r", usd: 10, from: "outside:stripe", date: "2026-08-01" });
  const ledger = readFileSync(join(town.repo, "WHITE_PAGES", "stamp-ledger.md"), "utf8");
  // unsigned rows are enough for a READ: the fold reads canonical text, and the
  // town's CLI would refuse to write either of these (that refusal is its law)
  const entries = parseLedgerText(ledger + [
    "- 2026-08-02 · pot-correction · ref: stripe:cs_r · from stan to paz · founder-directed-attribution · by: keemin",
    "- 2026-08-02 · pot-correction · ref: stripe:cs_nothing · from outside:stripe to paz · founder-directed-attribution · by: keemin",
  ].join("\n") + "\n");
  const town2 = ENGINE.foldPotReceipts(entries).corrections.map((c) => [c.ref, c.applied, c.refused]);
  const fold = foldFunding(entries);
  assert.deepEqual(fold.corrections.map((c) => [c.ref, c.applied, c.refused]), town2, "the office refuses exactly what the town refuses");
  const { pots } = readPots(town.repo);
  const md = render({
    now: NOW, pots, potsInvalid: [], fold, anomalyRows: [],
    rails: [railHealth("x", { last_run: minsAgo(1) }, { now: NOW })],
    stripe: { hold: [] }, usdcReport: null, registry: { addresses: 0, wallet_files: 0, mapped_pots: 0 },
  });
  assert.match(md, /\| 2026-08-01 \| stripe \| outside:stripe \| \$10 \|/, "a stale-from correction moves no hand");
  assert.match(md, /### Corrections that did not apply/);
  assert.match(md, /`stripe:cs_r` — the correction says from \*\*stan\*\*, the receipt reads \*\*outside:stripe\*\*/);
  assert.match(md, /`stripe:cs_nothing` — no receipt carries this ref/);
});
