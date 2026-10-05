// house-key.mjs — ONE HOUSEHOLD, ONE KEY, written at admission on every road.
//
// RULED (Darko, 2026-10-04): "one household, one key, no exceptions". The mint
// caps a household by the key the town's `currentHouseholds` gives each
// handle, and a house whose residents carry two keys mints as two households
// with two daily caps. The house's key is `hh:<slug>`, and the town learns it
// from a signed, dated `registry: <handle> = hh:<slug>` line in the stamp
// ledger.
//
// THE CLASS (postmark-town/postmark#3429). Admission wrote the resident's pin
// (their human's `gh:<id>`) and left the registry line to the town drain, at
// the next crossing, and only for the joins the drain sees. The drain sees
// none of the pen road's joins (it skips a handle whose ADDRESS already
// stands), so a pen join into a house already on `hh:<slug>` left the house
// split until somebody repaired it by hand: five binds on 10-03, Kev's house
// on 10-04, tonzhub on 10-05.
//
// SO THE LINE IS PART OF ADMISSION, and this file is its one writer. Every
// road that admits a resident calls `planHouseKey` BEFORE it writes a single
// store row, and `appendHouseKey` into the same pen commit as the pin:
//
//   · the pen join          src/join-bind.mjs     § bindUnderLock
//   · the declaration       src/declare-exec.mjs  (and the berth co-sign, which walks it)
//   · the settled PR join   src/settle-join.mjs   § settleUnderLock (the Registrar's door, the tick's pass)
//   · the crossing          src/town-bridge.mjs   § runTownDrain → src/town-drain.mjs § writeTownDrain
//
// The lines are the joiner's AND one for every resident of the house whose
// current key is not `hh:<slug>` (116 of 142 houses still mint under their
// human's `gh:<id>` on 10-05), so a join never leaves a house half re-keyed.
// The current keys are the TOWN's fold over the clone being written, and the
// split is judged by the TOWN's predicate (tools/household-keys.mjs): a join
// that would still leave the house split REFUSES, and nothing is written.
//
// ── THE DATING RULE (proposed in office #3429's PR) ─────────────────────────
//
// A line is dated by the US Eastern date at write, never earlier than the
// ledger's tail (the ledger is append-only and forward-dated, the town's own
// rule). A line dated D re-keys every mint the ledger already holds on day D,
// so a housemate who earned stamps this morning under `gh:<id>` would have
// them counted again under `hh:<slug>`, and stamp-verify's replay could
// diverge (Wright measured it on 10-05). So before a line is written:
//
//   1. QUIET: if no handle the lines name has any ledger line or delivery
//      dated D or later, the lines cannot change anything already recorded.
//      The usual case: the joiner is new, and a quiet house re-keys freely.
//   2. VERIFIED: otherwise the town's own stamp-verify runs over the ledger
//      with the signed lines appended (in memory; the clone is not touched).
//      A problem that the ledger did not already carry means the lines would
//      rewrite today, and the admission REFUSES for today (TODAY below): the
//      door says to ask again after midnight Eastern, the tick's settle pass
//      holds the merge for its next tick, and the crossing holds the row.
//      Re-keying a whole house that minted under one `gh:<id>` keeps every cap
//      grouping, so this comes back green; it refuses only when the grouping
//      truly changes (a resident on `solo:`/`login:`, or a key shared beyond
//      the house).
//
// "Mints owed" is not a divergence: a delivery today that no mint pass has
// recorded yet is minted under whatever key the ledger says when the pass
// runs, so those two sentences are left out of the comparison.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { DRAIN_KEY_PATH, signedRegistryLines } from "./ledger-pen.mjs";

export const LEDGER_REL = "WHITE_PAGES/stamp-ledger.md";

/** The dated ledger line an appended registry row carries. APPEND ONLY. */
export const registryLine = (date, handle, householdSlug) =>
  `- ${date} · registry: ${handle} = hh:${householdSlug}`;

/** handle -> current mint key, from the clone's own `currentHouseholds`. */
export function currentKeysOf(clone) {
  const engineDir = process.env.STAMP_ENGINE_DIR ?? join(clone, "tools");
  const script = [
    "const [clone, engineDir] = process.argv.slice(1);",
    "const { pathToFileURL } = await import('node:url');",
    "const { currentHouseholds } = await import(pathToFileURL(engineDir + '/stamp-mint.mjs'));",
    "const out = {};",
    "for (const [h, v] of currentHouseholds(clone)) out[h] = v.key;",
    "process.stdout.write(JSON.stringify(out));",
  ].join("\n");
  return new Map(Object.entries(JSON.parse(execFileSync(process.execPath,
    ["--input-type=module", "-e", script, clone, engineDir], { encoding: "utf8" }))));
}

/**
 * The bare registry lines a set of admissions appends, in signing order.
 *
 * `joins` is `[{ seq?, handle, slug, residents }]`, `residents` being the
 * house's residents as they will stand after the join. Each line carries the
 * `seq` of the join it belongs to (so a crossing row that stalls drops its
 * lines and only its lines). The joiner's line is skipped only when the fold
 * already keys them `hh:<slug>` (a berth the declaration keyed, coming ashore
 * at a crossing); housemates the fold does not know (no room yet) mint nothing
 * and get their line at their own join. Returns `{ lines: [{ seq, handle, key,
 * line }], keys }`, `keys` being `keys` with these lines folded in.
 */
export function houseKeyLines(joins, { date, keys }) {
  const now = new Map(keys);
  const lines = [];
  const add = (seq, handle, slug) => {
    const key = `hh:${slug}`;
    lines.push({ seq, handle, key, line: registryLine(date, handle, slug) });
    now.set(handle, key);
  };
  for (const { seq = null, handle, slug, residents = [] } of joins) {
    if (now.get(handle) !== `hh:${slug}`) add(seq, handle, slug);
    for (const h of residents)
      if (h !== handle && now.has(h) && now.get(h) !== `hh:${slug}`) add(seq, h, slug);
  }
  return { lines, keys: now };
}

/**
 * THE REFUSAL'S PREDICATE is the TOWN'S tools/household-keys.mjs, run in a
 * subprocess against the clone being written (never restated here): the
 * planned lines folded over the clone's roll by the town's own `rollWith`,
 * judged against the registry as it will stand. Scoped to the houses these
 * lines touch: a split elsewhere is the alarm's to raise, and refusing every
 * join over it would fix nothing. One sentence per defect, the town's.
 */
export function householdKeySplits(clone, lines, registry) {
  const engineDir = process.env.STAMP_ENGINE_DIR ?? join(clone, "tools");
  const script = [
    "const [clone, engineDir] = process.argv.slice(1);",
    "const { readFileSync } = await import('node:fs');",
    "const { pathToFileURL } = await import('node:url');",
    "const { currentHouseholds } = await import(pathToFileURL(engineDir + '/stamp-mint.mjs'));",
    "const { householdKeySplits, rollWith, describe } = await import(pathToFileURL(engineDir + '/household-keys.mjs'));",
    "const { lines, houses, touched } = JSON.parse(readFileSync(0, 'utf8'));",
    "const r = householdKeySplits({ roll: rollWith(currentHouseholds(clone), lines), houses });",
    "const t = new Set(touched);",
    "process.stdout.write(JSON.stringify(describe({",
    "  split: r.split.filter((s) => t.has(s.house)),",
    "  shared: r.shared.filter((s) => s.houses.some((h) => t.has(h))),",
    "})));",
  ].join("\n");
  const touched = [...new Set(lines.map((l) => l.key.slice("hh:".length)))];
  return JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", script, clone, engineDir],
    { input: JSON.stringify({ lines: lines.map((l) => l.line), houses: registry?.households ?? {}, touched }), encoding: "utf8" }));
}

/** The newest date on the ledger's lines, or null. */
export function ledgerTail(text) {
  let tail = null;
  for (const m of String(text ?? "").matchAll(/^- (\d{4}-\d{2}-\d{2}) · /gm))
    if (!tail || m[1] > tail) tail = m[1];
  return tail;
}

/**
 * § THE DATING RULE, steps 1 and 2: do these signed lines, dated `date`, leave
 * the ledger's replay as it stands? Runs in the clone's own engine. Step 2
 * overlays the planned ledger on the ONE path the verifier reads it from
 * (`fs.readFileSync`, re-synced into the engine's ESM imports), so nothing is
 * written to the clone and a crash leaves no stray line behind.
 *
 * Returns `{ holds, checked: "quiet" | "verified", active, fresh }`: `active`
 * the named handles with activity on or after `date`, `fresh` the problems
 * the lines would add.
 */
export function replayHolds(clone, { signed, handles, date }) {
  const engineDir = process.env.STAMP_ENGINE_DIR ?? join(clone, "tools");
  const script = [
    "const [clone, engineDir, date] = process.argv.slice(1);",
    "const fs = (await import('node:fs')).default;",
    "const { syncBuiltinESMExports } = await import('node:module');",
    "const { resolve } = await import('node:path');",
    "const { pathToFileURL } = await import('node:url');",
    "const { signed, handles } = JSON.parse(fs.readFileSync(0, 'utf8'));",
    "const ledgerAbs = resolve(clone, 'WHITE_PAGES', 'stamp-ledger.md');",
    "const before = fs.readFileSync(ledgerAbs, 'utf8');",
    "const engine = await import(pathToFileURL(engineDir + '/stamp-mint.mjs'));",
    // 1. quiet: any ledger line or delivery dated `date` or later naming one of the handles
    "const want = new Set(handles), active = new Set();",
    "for (const e of engine.parseStampLedger(before)) {",
    "  const d = /^- (\\d{4}-\\d{2}-\\d{2}) /.exec(e.canonical)?.[1];",
    "  if (!d || d < date) continue;",
    "  for (const t of e.canonical.split(/[^A-Za-z0-9._-]+/)) if (want.has(t)) active.add(t);",
    "}",
    "for (const d of engine.parseDeliveries(clone)) {",
    "  if (!(d.date >= date)) continue;",
    "  for (const h of [d.from, d.to]) if (want.has(h)) active.add(h);",
    "}",
    "if (!active.size) { process.stdout.write(JSON.stringify({ holds: true, checked: 'quiet', active: [], fresh: [] })); process.exit(0); }",
    // 2. verified: the town's stamp-verify over the ledger with the lines appended
    "const after = before.replace(/\\s*$/, '\\n') + signed.join('\\n') + '\\n';",
    "let overlay = true;",
    "const read = fs.readFileSync;",
    "fs.readFileSync = function (p, ...rest) {",
    "  if (overlay && typeof p === 'string' && resolve(p) === ledgerAbs) return rest.length ? after : Buffer.from(after, 'utf8');",
    "  return read.call(this, p, ...rest);",
    "};",
    "syncBuiltinESMExports();",
    "const { verifyStampLedger } = await import(pathToFileURL(engineDir + '/stamp-verify.mjs'));",
    "const owed = (p) => /mints owed|settlement owed/.test(p);",
    "const withLines = (verifyStampLedger(clone).problems ?? []).filter((p) => !owed(p));",
    "let fresh = [];",
    "if (withLines.length) {",
    "  overlay = false;",
    "  const standing = new Set(verifyStampLedger(clone).problems ?? []);",
    "  fresh = withLines.filter((p) => !standing.has(p));",
    "}",
    "process.stdout.write(JSON.stringify({ holds: fresh.length === 0, checked: 'verified', active: [...active].sort(), fresh }));",
  ].join("\n");
  return JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", script, clone, engineDir, date],
    { input: JSON.stringify({ signed, handles }), encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }));
}

// ── THE REFUSALS ────────────────────────────────────────────────────────────
//
// Frozen, in the office's `{ code, field, defect, hint }` bounce shape, so a
// road relays the whole refusal without re-typing a word of it.
export const HOUSE_KEY_REFUSALS = Object.freeze({
  SPLIT: Object.freeze({
    code: 409,
    field: "household",
    defect: "this join would leave the house earning stamps under more than one key",
    hint: "one household, one key: the office writes the house's key for the joiner and for every resident still off it in the same act, and here that would still leave a split. Nothing was written; a person reads the house.",
  }),
  TODAY: Object.freeze({
    code: 409,
    field: "household",
    defect: "this house's residents have already earned stamps today under the key this join replaces",
    hint: "a join moves the whole house onto its own key from today, and today's stamps were already counted under the old one, so landing it now would rewrite them. Nothing was written and nothing is lost: ask again after midnight US Eastern, when the town's day turns.",
  }),
  AHEAD: Object.freeze({
    code: 409,
    field: null,
    defect: "the stamp ledger's newest line is dated ahead of today",
    hint: "the ledger is append-only and forward-dated, so the house's key line, dated today, cannot follow it. Nothing was written; a person reads the ledger's tail.",
  }),
  NO_PEN: Object.freeze({
    code: 503,
    field: null,
    defect: "the ledger pen's key is absent",
    hint: "a join writes the house's signed key line in the same act as the pin, and this office cannot sign it. Nothing was written; try again once the pen is back.",
  }),
});

/** A refusal as a thrown bounce: the detail leads the hint. */
export function houseKeyBounce(refusal, detail = null) {
  return Object.assign(new Error(refusal.defect), {
    code: refusal.code, field: refusal.field, defect: refusal.defect,
    hint: detail ? `${detail} — ${refusal.hint}` : refusal.hint, refusal,
  });
}

/**
 * Judge planned lines and sign them, before anything is written: the tail,
 * the split, the pen, the replay. Returns `{ signed, refusal, detail, splits,
 * replay }`; `refusal` is null when the lines may be written.
 */
export function judgeHouseKey(clone, planned, { date, registry }) {
  const lines = planned?.lines ?? [];
  if (!lines.length) return { signed: [], refusal: null };
  const tail = ledgerTail(readFileSync(join(clone, LEDGER_REL), "utf8"));
  if (tail && tail > date) return { signed: [], refusal: HOUSE_KEY_REFUSALS.AHEAD, detail: `the tail is ${tail}, today is ${date}` };
  const splits = householdKeySplits(clone, lines, registry);
  if (splits.length) return { signed: [], refusal: HOUSE_KEY_REFUSALS.SPLIT, detail: splits.join(" · "), splits };
  if (!existsSync(DRAIN_KEY_PATH())) return { signed: [], refusal: HOUSE_KEY_REFUSALS.NO_PEN, detail: DRAIN_KEY_PATH() };
  const signed = signedRegistryLines(clone, lines.map((l) => l.line));
  const replay = replayHolds(clone, { signed, handles: [...new Set(lines.map((l) => l.handle))], date });
  if (!replay.holds)
    return { signed: [], refusal: HOUSE_KEY_REFUSALS.TODAY, replay,
      detail: `${replay.active.join(", ")} already ${replay.active.length === 1 ? "has" : "have"} stamps on ${date}; the town's verifier would read ${replay.fresh[0]}` };
  return { signed, refusal: null, replay };
}

/**
 * THE ADMISSION'S HALF, for a road admitting one resident under the lock:
 * the current keys, the lines, and the judgment, in that order. Call it
 * before the first store row; write with `appendHouseKey` after the last.
 * Answers null when the clone carries no ledger (nothing to key).
 */
export function planHouseKey(clone, joins, { date, registry }) {
  if (!existsSync(join(clone, LEDGER_REL))) return null;
  const planned = houseKeyLines(joins, { date, keys: currentKeysOf(clone) });
  return { lines: planned.lines, ...judgeHouseKey(clone, planned, { date, registry }) };
}

/**
 * Append signed lines to the clone's ledger. Returns the absolute path for
 * the road's pen commit, or null when there was nothing to append.
 */
export function appendHouseKey(clone, signed) {
  if (!signed?.length) return null;
  const abs = join(clone, LEDGER_REL);
  const prior = readFileSync(abs, "utf8");
  writeFileSync(abs, prior.replace(/\s*$/, "\n") + signed.join("\n") + "\n");
  return abs;
}

/** The registry as it will stand once `handle` lives in `slug` (for the split check). */
export function registryWith(registry, slug, residents, house = {}) {
  const households = { ...(registry?.households ?? {}) };
  households[slug] = { ...(households[slug] ?? house), residents: [...residents] };
  return { ...(registry ?? {}), households };
}
