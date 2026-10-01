#!/usr/bin/env node
// falsifier-twins-equality.mjs — the three portfolio-side twins against the doors
// they stand in for, on one office's REAL data (POS-142).
//
// `/world2/my-marks`, `/world2/stake` and `/world2/investigate` were built on
// 2026-09-17 (976b3de, POS-104 box 2), each with a fixture falsifier that plants
// a store-only row and counts the store's queries
// (test/world2-{my-marks,stake,investigate}-reads.test.mjs). Those prove each
// twin READS THE STORE. None of them proves the twin answers what the door it
// replaces answers, on the town's own rows — and DESIGN-standing-flip.md § 5.6
// moves no read until "its falsifier [is] green on prod first". This is that
// falsifier for these three.
//
//   ASK BOTH DOORS THE SAME QUESTION, ON ONE OFFICE, AND NAME EVERY FIELD THEY
//   DISAGREE ABOUT.
//
// It speaks HTTP only: GETs against one office, nothing else. It opens no
// database, reads no clone, and writes nothing anywhere, so it is read-only by
// construction rather than by role — the safe instrument to run against prod.
//
// ── WHAT IS EXCLUDED, AND WHO DECIDES ───────────────────────────────────────
//
// Each twin names, on its own answer, the fields it cannot serve from rows:
// `tree_only: { "<declaration>": "<why>" }`. THIS FILE HARD-CODES NO EXCLUSION.
// It reads each answer's own `tree_only` keys and parses them as paths:
//
//   "a.b"              the 1.0 field at that path is not compared
//   "a[].b"            ... at that path inside every element of array `a`
//   "x · y · z"        several declarations in one key, split on " · "
//   "a[] tie order"    array `a` is compared as a MULTISET, not a sequence —
//                      the order is declared, the members are still held equal
//
// A declaration that parses as none of those is a FINDING, never a silent
// exclusion: a twin cannot widen its own exemptions with a sentence. Every
// excluded path is printed with the 1.0 value it hid, each run, so a gap that
// grows is seen growing.
//
// Keys the twin ADDS at the top level and 1.0 never had (`what`, `tree_only`,
// `escrow_at_town_sha`) are reported as additions and are not divergences: they
// describe the answer, they are not part of it. Everything else is total — a
// 1.0 field the twin lacks, a field the twin carries that 1.0 does not (below
// the top level), and every value, is compared leaf by leaf.
//
// ── THE SAME-SETTLEMENT ASSERTION ───────────────────────────────────────────
//
// Two doors over two DIFFERENT states agree by accident or disagree by
// staleness, and either way the comparison is about the states, not the port.
// So each door is compared only when both sides stand on one state:
//
//   world  1.0's blessed world (`/world/store` → `blessed.sha`) against the
//          store's `projection_heads['world-marks']` (`/world2/status`) —
//          investigate, my-marks
//   town   1.0's town index (`/release` → `as_of`, rehydrated from the same
//          clone 1.0's stake read opens) against `projection_heads['town']`
//          — stake, my-marks
//
// A skew is CANNOT RUN (exit 2) for that door, named with both shas.
// `--compare-anyway` still compares and prints the findings — useful to measure
// the gaps on a store that is behind — but it can never make a skewed door
// green: the exit stays 2.
//
// ── EXIT CODES ──────────────────────────────────────────────────────────────
//
//   0  every door compared, on one state, and every field agreed
//   1  RED — a divergence, named by door, mark and path, with both values
//   2  CANNOT RUN — a skew, a door that would not answer, a door that compared
//      nothing, or a --prove-can-fail break that did not turn red
//
// There is no code for "checked nothing and found nothing" (the siblings' rule).
//
// ── RUNNING IT ──────────────────────────────────────────────────────────────
//
//   node world2/tools/falsifier-twins-equality.mjs --base https://postmark.town/api \
//     --key-env POSTMARK_KEY [--sample 12] [--mark <by>/<slug> ...] \
//     [--doors stake,investigate,my-marks] [--json] [--compare-anyway] [--prove-can-fail]
//
// `--key-env` names the env var holding a resident Bearer key; only my-marks
// needs one (both its doors are key-scoped) and the key is never printed. An
// office behind Cloudflare Access (dev) takes CF_ACCESS_CLIENT_ID and
// CF_ACCESS_CLIENT_SECRET from the environment, sent as headers and never printed.
//
// The sample is deterministic: every `--mark`, then `--sample` slugs at an even
// stride over `/world2/marks` sorted by slug, then (for stake) the marks the
// key's household has backed per 1.0's own my-marks — a sample of unstaked marks
// would hold zero equal to zero and prove little about the stake door.

import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

const argv = process.argv.slice(2);
const arg = (n, fallback = null) => { const i = argv.indexOf(n); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : fallback; };
const args = (n) => argv.flatMap((a, i) => (a === n && i + 1 < argv.length ? [argv[i + 1]] : []));
const has = (n) => argv.includes(n);

export const DOORS = ["stake", "investigate", "my-marks"];
export const TWIN_ADDITIONS_NOTE = "top-level keys only the twin carries describe the answer (what it is, what it cannot serve, which sha it stands on); they are reported, not compared";

// ── the pure core: declarations, comparison, skew ──────────────────────────

/**
 * Parse a twin's `tree_only` keys into exclusions. Returns
 * `{ paths: string[][], multisets: string[][], bad: string[] }` where a path is
 * an array of segments and `"[]"` is "every element".
 */
export function parseDeclarations(treeOnly) {
  const paths = [], multisets = [], bad = [];
  if (treeOnly == null) return { paths, multisets, bad };
  if (typeof treeOnly !== "object" || Array.isArray(treeOnly)) return { paths, multisets, bad: [`tree_only is not an object: ${JSON.stringify(treeOnly).slice(0, 80)}`] };
  for (const key of Object.keys(treeOnly)) {
    for (const raw of key.split(" · ")) {
      const token = raw.trim();
      const tie = token.match(/^([A-Za-z_][\w-]*(?:(?:\.|\[\]\.)[A-Za-z_][\w-]*)*)\[\] tie order$/);
      if (tie) { multisets.push(segments(tie[1])); continue; }
      if (/^[A-Za-z_][\w-]*(?:(?:\.|\[\]\.)[A-Za-z_][\w-]*)*$/.test(token)) { paths.push(segments(token)); continue; }
      bad.push(token);
    }
  }
  return { paths, multisets, bad };
}

const segments = (p) => p.split(".").flatMap((s) => (s.endsWith("[]") ? [s.slice(0, -2), "[]"] : [s]));

// Does a concrete path (keys and numeric indices) match a declared one?
const matches = (decl, concrete) => decl.length === concrete.length
  && decl.every((d, i) => (d === "[]" ? typeof concrete[i] === "number" : d === concrete[i]));
const show = (p) => p.map((s) => (typeof s === "number" ? `[${s}]` : `.${s}`)).join("").replace(/^\./, "") || "(root)";
const canon = (v) => JSON.stringify(v, (_k, x) => (x && typeof x === "object" && !Array.isArray(x)
  ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])) : x));

/**
 * Compare one 1.0 answer with its twin's. PURE. Returns
 * `{ compared, findings[], excluded[], additions[], declared }`.
 */
export function twinFindings(one, two, { label = "" } = {}) {
  const findings = [], excluded = [];
  let compared = 0;
  if (!one || typeof one !== "object" || !two || typeof two !== "object") {
    return { compared, findings: [`${label} one side is not an object (1.0 ${typeof one}, twin ${typeof two})`], excluded, additions: [], declared: null };
  }
  const declared = parseDeclarations(two.tree_only);
  for (const b of declared.bad) findings.push(`${label} tree_only declares "${b}", which names no path — a twin cannot exempt a field with a sentence`);

  const additions = Object.keys(two).filter((k) => !(k in one));
  // Which declarations matched a 1.0 field in this pair, so a run can name the
  // ones that never did: an exemption for a field 1.0 no longer carries is a
  // stale sentence, and a stale exemption is one nobody watches.
  const seen = new Set();
  const hit = (list, p) => { const d = list.find((x) => matches(x, p)); if (d) seen.add(d.join(".")); return !!d; };
  const isExcluded = (p) => hit(declared.paths, p);
  const isMultiset = (p) => hit(declared.multisets, p);

  const walk = (a, b, p) => {
    if (isExcluded(p)) { excluded.push({ path: show(p), one: a === undefined ? "(absent on 1.0)" : canon(a).slice(0, 200) }); return; }
    if (Array.isArray(a) && Array.isArray(b) && isMultiset(p)) {
      compared++;
      const x = a.map(canon).sort(), y = b.map(canon).sort();
      if (canon(x) !== canon(y)) findings.push(`${label} ${show(p)} differs as a multiset (order declared, members not): 1.0 ${canon(a).slice(0, 200)} · twin ${canon(b).slice(0, 200)}`);
      return;
    }
    if (a && b && typeof a === "object" && typeof b === "object" && Array.isArray(a) === Array.isArray(b)) {
      if (Array.isArray(a)) {
        if (a.length !== b.length) findings.push(`${label} ${show(p)} has ${a.length} element(s) on 1.0 and ${b.length} on the twin`);
        for (let i = 0; i < Math.min(a.length, b.length); i++) walk(a[i], b[i], [...p, i]);
        return;
      }
      const top = p.length === 0;
      for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
        if (top && additions.includes(k)) continue;
        // A twin that drops a whole object a declaration reaches INTO (investigate
        // declares three `receipt.*` fields and omits `receipt`) is walked as an
        // empty object: the declared fields exclude, and every other field of it
        // is named absent one by one rather than hidden under its parent's name.
        const under = [...p, k];
        if (!(k in b) && a[k] && typeof a[k] === "object" && !Array.isArray(a[k])
            && declared.paths.some((d) => d.length > under.length && matches(d.slice(0, under.length), under))) {
          walk(a[k], {}, under);
          continue;
        }
        if (!(k in b) && !isExcluded([...p, k])) { findings.push(`${label} ${show([...p, k])} is on 1.0 and absent from the twin: 1.0 ${canon(a[k]).slice(0, 200)}`); continue; }
        if (!(k in a) && !isExcluded([...p, k])) { findings.push(`${label} ${show([...p, k])} is on the twin and not on 1.0: twin ${canon(b[k]).slice(0, 200)}`); continue; }
        walk(a[k], b[k], [...p, k]);
      }
      return;
    }
    compared++;
    if (canon(a) !== canon(b)) findings.push(`${label} ${show(p)}: 1.0 ${canon(a)?.slice(0, 200)} · twin ${canon(b)?.slice(0, 200)}`);
  };
  walk(one, two, []);
  const unseen = [...declared.paths, ...declared.multisets].map((d) => d.join(".")).filter((d) => !seen.has(d));
  return { compared, findings, excluded, additions, declared, unseen };
}

/**
 * Across one door's answered pairs: a top-level twin-only key is an ADDITION only
 * if it is twin-only on every pair; on some pairs only, it is a finding. PURE.
 */
export function additionsAcross(counts, pairs, door = "") {
  const additions = [], findings = [];
  for (const [k, n] of Object.entries(counts)) {
    if (n === pairs) additions.push(k);
    else findings.push(`${door} the twin carries "${k}" where 1.0 does not on ${n} of ${pairs} answers — not an addition the twin makes to every answer, so the two doors answered different kinds of thing`);
  }
  return { additions, findings };
}

// ── path helpers for the proof ─────────────────────────────────────────────

/** The first primitive both answers hold equal at the same path, outside any declaration. */
export function agreeingLeaf(one, two) {
  const declared = parseDeclarations(two?.tree_only);
  const out = (p) => declared.paths.some((d) => matches(d, p)) || declared.multisets.some((d) => matches(d, p));
  const find = (a, b, p) => {
    if (out(p)) return null;
    if (a && b && typeof a === "object" && typeof b === "object") {
      for (const k of Object.keys(a)) {
        if (p.length === 0 && k === "tree_only") continue;
        if (!(k in b)) continue;
        const r = find(a[k], b[k], [...p, Array.isArray(a) ? Number(k) : k]);
        if (r) return r;
      }
      return null;
    }
    return p.length && (a === null || typeof a !== "object") && canon(a) === canon(b) ? p : null;
  };
  return find(one, two, []);
}
export const getAt = (o, p) => p.reduce((x, k) => x?.[k], o);
export const setAt = (o, p, v) => { getAt(o, p.slice(0, -1))[p.at(-1)] = v; };
export const deleteAt = (o, p) => { const parent = getAt(o, p.slice(0, -1)); if (Array.isArray(parent)) parent.splice(p.at(-1), 1); else delete parent[p.at(-1)]; };
/** A concrete path as the declaration grammar spells it (indices become `[]`). */
export const declarationOf = (p) => p.reduce((s, k) => (typeof k === "number" ? `${s}[]` : s ? `${s}.${k}` : k), "");

/** Which states a door needs to agree on, and whether they do. PURE. */
export const NEEDS = { stake: ["town"], investigate: ["world"], "my-marks": ["world", "town"] };
export function skewFor(door, states) {
  const skews = [];
  for (const side of NEEDS[door]) {
    const s = states[side];
    if (!s?.one || !s?.two) skews.push(`${side}: ${!s?.one ? "1.0's sha could not be read" : "the store's head could not be read"} (1.0 ${s?.one ?? "?"} · store ${s?.two ?? "?"})`);
    else if (s.one !== s.two) skews.push(`${side}: 1.0 stands on ${s.one.slice(0, 12)}${s.oneLabel ? ` (${s.oneLabel})` : ""}, the store on ${s.two.slice(0, 12)}`);
  }
  return skews;
}

// ── the HTTP half ──────────────────────────────────────────────────────────

async function main() {
  const BASE = String(arg("--base", "") ?? "").replace(/\/+$/, "");
  const die = (msg) => { console.error(`CANNOT RUN · ${msg}`); process.exit(2); };
  if (has("--help") || !BASE) die("usage: falsifier-twins-equality.mjs --base <office api url> [--key-env VAR] [--sample N] [--mark <id> ...] [--doors a,b] [--json] [--compare-anyway] [--prove-can-fail]");
  const doors = String(arg("--doors", DOORS.join(","))).split(",").map((s) => s.trim()).filter(Boolean);
  for (const d of doors) if (!DOORS.includes(d)) die(`no door "${d}" — doors: ${DOORS.join(", ")}`);
  const SAMPLE = Math.max(0, Number(arg("--sample", "12")) || 0);
  const JSON_OUT = has("--json");
  const ANYWAY = has("--compare-anyway");
  const PROVE = has("--prove-can-fail") || has("--can-fail-proof");
  const keyEnv = arg("--key-env", "POSTMARK_KEY");
  const KEY = process.env[keyEnv] ?? null;
  if (doors.includes("my-marks") && !KEY) die(`my-marks is key-scoped on both doors and ${keyEnv} is empty — pass --key-env, or --doors without my-marks`);

  const headers = {};
  if (process.env.CF_ACCESS_CLIENT_ID && process.env.CF_ACCESS_CLIENT_SECRET) {
    headers["CF-Access-Client-Id"] = process.env.CF_ACCESS_CLIENT_ID;
    headers["CF-Access-Client-Secret"] = process.env.CF_ACCESS_CLIENT_SECRET;
  }
  const get = async (path, { keyed = false } = {}) => {
    const r = await fetch(BASE + path, { headers: { ...headers, ...(keyed ? { Authorization: `Bearer ${KEY}` } : {}) }, redirect: "manual" });
    const text = await r.text();
    let body = null;
    try { body = JSON.parse(text); } catch { /* the code says the rest */ }
    return { code: r.status, body, text };
  };
  const must = async (path, opts) => {
    const r = await get(path, opts);
    if (r.code !== 200 || !r.body) die(`${path} answered HTTP ${r.code}: ${r.text.slice(0, 160)}`);
    return r.body;
  };

  // The states both sides stand on.
  const [store, status, release] = await Promise.all([must("/world/store"), must("/world2/status"), must("/release")]);
  const head = (repo) => (status.projection_heads ?? []).find((h) => h.repo === repo)?.sha ?? null;
  const states = {
    world: { one: store.blessed?.sha ?? null, oneLabel: store.blessed?.as_of_settlement ?? null, two: head("world-marks") },
    town: { one: release.as_of ?? null, oneLabel: "the office's town index", two: head("town") },
  };

  // The sample.
  const listed = await must("/world2/marks");
  const slugs = [...new Set((listed.marks ?? []).map((m) => m.slug).filter(Boolean))].sort();
  const sample = [...args("--mark")];
  if (SAMPLE && slugs.length) {
    const stride = Math.max(1, Math.floor(slugs.length / SAMPLE));
    for (let i = 0; i < slugs.length && sample.length < args("--mark").length + SAMPLE; i += stride) sample.push(slugs[i]);
  }
  let mineOne = null;
  if (KEY && (doors.includes("my-marks") || doors.includes("stake"))) {
    const r = await get("/world/my-marks", { keyed: true });
    if (r.code === 200) mineOne = r.body;
  }
  const backed = (mineOne?.backed ?? []).map((b) => b.id).filter(Boolean);
  const stakeSample = [...new Set([...sample, ...backed])];
  const markSample = [...new Set(sample)];
  if (!markSample.length) die("the sample is empty: /world2/marks listed no slugs and no --mark was given");

  // Ask both doors.
  const pairs = [];
  const enc = encodeURIComponent;
  for (const door of doors) {
    if (door === "my-marks") {
      const one = mineOne ? { code: 200, body: mineOne } : await get("/world/my-marks", { keyed: true });
      const two = await get("/world2/my-marks", { keyed: true });
      pairs.push({ door, mark: "(the key's household)", one, two });
      continue;
    }
    for (const mark of door === "stake" ? stakeSample : markSample) {
      const [one, two] = await Promise.all([get(`/world/${door}?mark=${enc(mark)}`), get(`/world2/${door}?mark=${enc(mark)}`)]);
      pairs.push({ door, mark, one, two });
    }
  }

  const report = { base: BASE, at: new Date().toISOString(), states, doors: {} };
  for (const door of doors) {
    const skews = skewFor(door, states);
    const mine = pairs.filter((p) => p.door === door);
    const d = { skews, asked: mine.length, compared: 0, pairs_compared: 0, both_refused: 0, findings: [], excluded: {}, additions: new Set(), additionCounts: {} };
    for (const p of mine) {
      if (p.one.code !== 200 || p.two.code !== 200) {
        // Both refusing the same question is agreement about a refusal (a mark
        // only one side holds is NOT that — it is a finding).
        if (p.one.code === p.two.code && p.one.code >= 400) { d.both_refused++; continue; }
        d.findings.push(`${door} ${p.mark}: 1.0 answered HTTP ${p.one.code}, the twin HTTP ${p.two.code}${p.two.code !== 200 ? ` (${(p.two.body?.defect ?? p.two.text).slice(0, 120)})` : ""}`);
        continue;
      }
      if (skews.length && !ANYWAY) continue;
      const r = twinFindings(p.one.body, p.two.body, { label: `${door} ${p.mark}` });
      d.compared += r.compared; d.pairs_compared++;
      d.findings.push(...r.findings);
      for (const x of r.excluded) (d.excluded[x.path.replace(/\[\d+\]/g, "[]")] ??= []).push(x.one);
      r.additions.forEach((a) => { d.additions.add(a); d.additionCounts[a] = (d.additionCounts[a] ?? 0) + 1; });
      // unseen for the DOOR only if no pair matched it
      d.unseen = d.unseen == null ? new Set(r.unseen) : new Set([...d.unseen].filter((x) => r.unseen.includes(x)));
    }
    // AN ADDITION IS A KEY THE TWIN ADDS TO EVERY ANSWER. A top-level key the
    // twin carries on SOME answers and 1.0 does not is 1.0 answering a different
    // kind of thing for those marks (a locked mark the world has not reached
    // yet answers `mark`/`standing`/`note`, not `id`/`kind`/…), and that is a
    // divergence, never a description.
    const adds = additionsAcross(d.additionCounts, d.pairs_compared, door);
    d.findings.push(...adds.findings);
    d.additions = adds.additions;
    delete d.additionCounts;
    d.unseen = [...(d.unseen ?? [])];
    report.doors[door] = d;
  }

  // ── --prove-can-fail: break each door's real answers in memory ─────────────
  let proof = null;
  if (PROVE) {
    proof = [];
    for (const door of doors) {
      // A leaf the two sides AGREE on, at any depth: breaking one that already
      // differs moves no count, and the proof would be measuring the baseline's
      // own finding (my-marks on dev agrees on no top-level primitive at all).
      let p = null, leaf = null;
      for (const x of pairs.filter((y) => y.door === door && y.one.code === 200 && y.two.code === 200)) {
        leaf = agreeingLeaf(x.one.body, x.two.body);
        if (leaf) { p = x; break; }
      }
      if (!p) { proof.push({ door, brk: "any", red: false, why: "no answered pair has a field both sides agree on to break" }); continue; }
      const one = p.one.body, two = structuredClone(p.two.body);
      // the clean baseline on these two bodies, to compare each break against
      const base = twinFindings(one, two, { label: "base" }).findings.length;
      const leafName = declarationOf(leaf);
      const breaks = [
        [`a leaf value moves (${leafName})`, (t) => { setAt(t, leaf, `${canon(getAt(t, leaf))}~broken`); }],
        [`a 1.0 field goes missing (${leafName})`, (t) => { deleteAt(t, leaf); }],
        ["the twin grows a field below the top", (t) => { const k = Object.keys(t).find((x) => t[x] && typeof t[x] === "object" && !Array.isArray(t[x]) && x !== "tree_only"); if (k) t[k] = { ...t[k], "~planted": 1 }; else t["~planted"] = 1; }],
        ["a declaration that names no path", (t) => { t.tree_only = { ...(t.tree_only ?? {}), "this is a sentence, not a path!": "planted" }; }],
      ];
      for (const [brk, f] of breaks) {
        const t = structuredClone(two); f(t);
        // planted at the top level, a new key is an ADDITION by this file's rule
        // and correctly not red; the break plants below the top where it can be.
        const n = twinFindings(one, t, { label: "proof" }).findings.length;
        proof.push({ door, brk, red: n > base, base, broken: n });
      }
      // the positive control: a declaration READ OFF THE ANSWER excludes its field
      {
        const t = structuredClone(two); setAt(t, leaf, `${canon(getAt(t, leaf))}~broken`);
        t.tree_only = { ...(t.tree_only ?? {}), [leafName]: "declared by the proof" };
        const n = twinFindings(one, t, { label: "proof" }).findings.length;
        proof.push({ door, brk: `declaring ${leafName} excludes it (must NOT go red)`, red: n <= base, base, broken: n, control: true });
      }
    }
    // and the skew refuses
    proof.push({ door: "(all)", brk: "a skewed state refuses", red: skewFor("my-marks", { world: { one: "a", two: "b" }, town: { one: "c", two: "c" } }).length === 1 });
  }

  // ── the verdict ────────────────────────────────────────────────────────────
  const lines = [];
  lines.push(`falsifier-twins-equality · ${BASE} · ${report.at}`);
  lines.push(`  world: 1.0 ${states.world.one?.slice(0, 12)} (${states.world.oneLabel}) · store world-marks ${states.world.two?.slice(0, 12)}`);
  lines.push(`  town:  1.0 ${states.town.one?.slice(0, 12)} (${states.town.oneLabel}) · store town ${states.town.two?.slice(0, 12)}`);
  let reds = 0, cannot = [];
  for (const [door, d] of Object.entries(report.doors)) {
    lines.push(`\n── ${door}: ${d.asked} asked · ${d.pairs_compared} compared (${d.compared} fields) · ${d.both_refused} refused by both · ${d.findings.length} finding(s)`);
    for (const s of d.skews) lines.push(`  SKEW ${s}`);
    if (d.additions.length) lines.push(`  twin additions: ${d.additions.join(", ")} — ${TWIN_ADDITIONS_NOTE}`);
    for (const u of d.unseen ?? []) lines.push(`  declared in tree_only and on no 1.0 answer this run: ${u.replaceAll(".[]", "[]")} — a stale exemption, or a field this sample never reached`);
    for (const [path, vals] of Object.entries(d.excluded)) lines.push(`  excluded by the twin's own tree_only: ${path} (${vals.length}×; e.g. 1.0 ${String(vals[0]).slice(0, 100)})`);
    for (const f of d.findings) lines.push(`  ✗ ${f}`);
    if (d.skews.length) cannot.push(`${door} skewed`);
    else if (!d.pairs_compared || !d.compared) cannot.push(`${door} compared nothing`);
    reds += d.findings.length;
  }
  if (proof) {
    lines.push("\n── --prove-can-fail");
    for (const p of proof) lines.push(`  ${p.red ? "✓" : "✗"} ${p.door} · ${p.brk}${p.base != null ? ` (findings ${p.base} → ${p.broken})` : ""}${p.why ? ` — ${p.why}` : ""}`);
    if (proof.some((p) => !p.red)) cannot.push("a break did not turn red — this falsifier cannot fail, so its green means nothing");
  }
  if (JSON_OUT) console.log(JSON.stringify({ ...report, proof }, null, 2));
  else console.log(lines.join("\n"));

  if (cannot.length) { console.error(`\nCANNOT RUN · ${cannot.join("; ")}${reds ? ` (${reds} finding(s) printed above, measured anyway)` : ""}`); process.exit(2); }
  if (reds) { console.error(`\nRED · ${reds} divergence(s)`); process.exit(1); }
  console.error("\nGREEN · every door, one state, every field");
  process.exit(0);
}

// Run as a tool; import as a module for its pure half (the test does).
const isMain = (() => {
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return false; }
})();
if (isMain) main().catch((e) => { console.error(`CANNOT RUN · ${String(e?.stack ?? e).slice(0, 400)}`); process.exit(2); });
