// stamp-sandbox.test.mjs — the stamp sandbox's own checks can fail (POS-366).
//
// The sandbox (tools/stamp-sandbox.mjs) is the gate every stamp-touching PR
// passes, so its checks are the thing that must not be a probe that cannot go
// red. Each check is driven here into its refusal on a small ledger built with
// the town's OWN engine (the town checkout's tools/stamp-mint.mjs, as the
// sandbox uses it), plus the one property the copy depends on: re-signing a
// ledger under another key moves no seal and verifies under that key.
//
// The whole sandbox run (minutes, a Postgres, the town's history) is not run
// here; it is the command a PR attaches. These are its parts.

import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";

import { resignLedger, chainCheck, conservation, holdings, judge } from "../tools/stamp-sandbox.mjs";
import { NO_TOWN, townClone, townModuleUrl } from "./fixture-paths.mjs";

const TOWN = townClone();
const ENGINE = TOWN ? await import(townModuleUrl("tools", "stamp-mint.mjs")) : null;
const SKIP = !TOWN && NO_TOWN;

const keys = () => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return { key: privateKey.export({ type: "pkcs8", format: "pem" }), pub: publicKey.export({ type: "spki", format: "pem" }) };
};

// A ledger of signed canonicals, built the way appendSigned builds one.
function ledgerOf(canonicals, key) {
  const seals = ENGINE.sealChain(canonicals);
  return `# a test ledger\n\n${canonicals.map((c, i) => `${c} · sig: ${ENGINE.signSeal(seals[i], key)}`).join("\n")}\n`;
}

const BASE = [
  "- 2026-06-12 · rules: stamps-v1",
  "- 2026-06-13 · MINT → ada · 1 · for: letter-a (sent)",
  "- 2026-06-13 · MINT → bea · 1 · for: letter-a (received)",
];

test("re-signing moves no seal, and the copy verifies under the new key, line for line", { skip: SKIP }, () => {
  const a = keys(), b = keys();
  const text = ledgerOf(BASE, a.key);
  const copy = resignLedger(text, b.key, ENGINE);
  const e0 = ENGINE.parseStampLedger(text), e1 = ENGINE.parseStampLedger(copy);
  assert.deepEqual(e1.map((e) => e.canonical), e0.map((e) => e.canonical));
  assert.notDeepEqual(e1.map((e) => e.sig), e0.map((e) => e.sig));
  // every line of the copy checks under b, from an empty prefix
  assert.deepEqual(chainCheck(ENGINE, "", copy, b.pub).problems, []);
  // and the original does not
  assert.ok(chainCheck(ENGINE, "", text, b.pub).problems.length === BASE.length);
});

test("the chain check refuses a rewritten past, a forged signature and an unsigned line", { skip: SKIP }, () => {
  const k = keys();
  const prev = ledgerOf(BASE, k.key);
  const next = ledgerOf([...BASE, "- 2026-06-14 · MINT → ada · 1 · for: letter-b (sent)"], k.key);
  assert.deepEqual(chainCheck(ENGINE, prev, next, k.pub).problems, []);

  const rewritten = next.replace("letter-a (sent)", "letter-z (sent)");
  assert.match(chainCheck(ENGINE, prev, rewritten, k.pub).problems.join("\n"), /append-only/);

  const forged = next.replace(/sig: \S+\n$/, `sig: ${"A".repeat(86)}\n`);
  assert.match(chainCheck(ENGINE, prev, forged, k.pub).problems.join("\n"), /bad signature at line 4/);

  const unsigned = `${prev}- 2026-06-14 · MINT → ada · 1 · for: letter-b (sent)\n`;
  assert.match(chainCheck(ENGINE, prev, unsigned, k.pub).problems.join("\n"), /unsigned line 4/);
});

test("conservation refuses a resident below zero", { skip: SKIP }, () => {
  const ok = ENGINE.parseStampLedger(BASE.join("\n"));
  assert.deepEqual(conservation(ENGINE, ok), []);
  const over = ENGINE.parseStampLedger([...BASE, "- 2026-06-14 · ada → bea · 3 · via: mail:letter-c"].join("\n"));
  assert.match(conservation(ENGINE, over).join("\n"), /ada is negative \(-2\)/);
});

test("the judge holds every number the script writes, and every resident it does not name", { skip: SKIP }, () => {
  const before = holdings(ENGINE, ENGINE.parseStampLedger(BASE.join("\n")));
  const added = ["- 2026-06-14 · MINT → ada · 1 · for: letter-b (sent)", "- 2026-06-14 · MINT → cid · 1 · for: letter-b (received)"];
  const all = ENGINE.parseStampLedger([...BASE, ...added].join("\n"));
  const after = holdings(ENGINE, all);
  const appended = all.slice(BASE.length);

  assert.deepEqual(judge(ENGINE, { lines: { mint: 2 }, bal: { ada: 1, cid: 1 } }, before, after, appended).problems, []);
  // a wrong count, a wrong figure, a resident moved without being named
  assert.match(judge(ENGINE, { lines: { mint: 1 }, bal: { ada: 1, cid: 1 } }, before, after, appended).problems.join("\n"), /lines of kind mint: expected 1, got 2/);
  assert.match(judge(ENGINE, { lines: { mint: 2 }, bal: { ada: 2, cid: 1 } }, before, after, appended).problems.join("\n"), /ada: balance moved 1, expected 2/);
  assert.match(judge(ENGINE, { lines: { mint: 2 }, bal: { ada: 1 } }, before, after, appended).problems.join("\n"), /cid was not named and its balance moved 1/);
  // a household's sum
  assert.deepEqual(judge(ENGINE, { lines: { mint: 2 }, sums: [{ handles: ["ada", "cid"], bal: 2 }] }, before, after, appended).problems, []);
});
