// falsifier-conversations-equality.mjs — the conversations port against 1.0's
// own `voices.mjs`, on identical inputs.
//
// `conversations.mjs` serves `/world2/conversations` from `acts` so the voices
// log can die at the read flip. This is what holds it to the page it replaces.
//
// THE ORACLE IS 1.0'S OWN MODULE, imported live — `createVoices(...).conversations()`
// reading the real `voices-log.jsonl`, and `clusterVoices` itself. Nothing here
// re-expresses a derivation; every comparison feeds one input to two
// implementations and asks whether they agree.
//
//   C1  THE RECORD   the voice records `acts` yields, against the ones 1.0's own
//                    log reader yields, row for row — scoped to the era `acts`
//                    holds, with the era boundary and both deltas named.
//   C2  THE VENDOR   the vendored `clusterVoices` against 1.0's imported one, on
//                    identical voices. This is the drift tripwire, and it is the
//                    only comparison here that is about the COPY rather than
//                    about the data.
//   C3  THE PAGE     1.0's whole `conversations()` against the port's
//                    `conversationsOf`, over the SAME voices at the SAME instant
//                    — thread for thread, field for field. The end-to-end one,
//                    and it runs 1.0's real render: `threadOf` is module-private
//                    in `voices.mjs`, so the only way to reach it is through
//                    `conversations()`, which reads a log. So the acts-derived
//                    voices are written to a TEMP log in the log's own format and
//                    1.0's own reader is pointed at it. Identical inputs, two
//                    whole pipelines. (Nothing the store owns is written; the
//                    temp file is deleted on the way out.)
//   C4  THE DIALS    the dials read from `marks` against `voices.mjs`'s own
//                    `SAY_DIALS`. See the honest limit below.
//
// ── THE ERA BOUNDARY, AND WHY THE COMPARISON IS SCOPED ──────────────────────
//
// `acts` holds the crystallized emission record the seed imported plus whatever
// has been said live since; the prod office's `voices-log.jsonl` holds every
// voice the town has ever spoken on that box. Measured 2026-08-29: 1,630
// emission acts against 2,691 log lines — 1,630 of 1,630 matching inside the
// acts era with zero field drift, 823 log lines before it and 238 after.
//
// So the comparison is FROZEN ERA TO FROZEN ERA (ab-compare's AB-P2 lesson, and
// E2's and E6's): both deltas are counted and printed, and a log line INSIDE an
// era with no act is a finding. Widening to the whole log would report the store
// as missing 1,061 voices it was never supposed to have.
//
// AND THE ERAS ARE SCOPED SEPARATELY, which the first cut of this file did not
// do — see `c1Record`. `acts` holds two stretches with a gap between them (the
// frontier: spoken, not yet crystallized), and one range over both swallows it.
//
// ⚑ THE LIMIT OF ERA SCOPING, found by this file's own can-fail proof: C1
// derives the era from the ACTS side's own extent, so a voice lost at the very
// FIRST or LAST instant of the record moves the boundary with it and is not
// compared. C1 covers the record's INTERIOR. The FRONTIER is
// `falsifier-acts-lane-closure.mjs`'s — it compares each lane's own pen against
// `acts` from a standing `--since`, which is a boundary no loss can move — and
// the two together are what cover the whole record. Stated rather than tuned
// away: a proof lying in the safe direction is the worst kind.
//
// ── THE ONE LOSS, ALLOWED BY NAME ───────────────────────────────────────────
//
// `world2/tools/README.md` § the lane-closure falsifier records exactly one act
// lost before the say lane was closed:
//
//   "exactly ONE act was lost before the lanes closed — wright's say at
//    2026-08-28T16:18:38.744Z, the lab's first witnessed act, which lives in
//    voices-log.jsonl and never reached `acts`."
//
// It is in `LOST_TO_THE_PRE_FIX_ERA` below, keyed on `(at, handle)` — ONE row,
// with its receipt. Not a widened window, not a tolerance, not a skipped check:
// a named exception that this falsifier PRINTS whether or not it fires, so a
// second loss cannot hide behind the first one's excuse. An allowlist entry that
// goes unexercised is reported too — an excuse nobody needs is an excuse that
// should be deleted.
//
// It reads UNEXERCISED today, and that is correct rather than idle: 16:18:38
// sits in the FRONTIER between the crystallized era and the live one, which no
// era covers, so nothing has asked about it yet. It starts biting the day the
// live era's range reaches back over it. The frontier itself belongs to the
// lane-closure falsifier, not to this file — see the limit note above.
//
// EXIT CODES: 0 green · 1 RED · 2 cannot run. No code for "checked nothing":
// every comparison reports its own `compared`, and one that compared zero rows
// exits 2.
//
//   WORLD2_PG_URL=postgres://snapshot_reader:…@localhost/world2_dev \
//     node world2/tools/falsifier-conversations-equality.mjs \
//       --voices-log /srv/postmark-office/voices-log.jsonl [--can-fail-proof] [--json]

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import * as talk from "./conversations.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const OFFICE = resolve(HERE, "..", "..");

const arg = (n) => { const i = process.argv.indexOf(n); return i === -1 ? null : process.argv[i + 1]; };
const has = (n) => process.argv.includes(n);
const die = (why) => { console.error(`CANNOT RUN · ${why}`); process.exit(2); };

/**
 * THE ONE ACT THE PRE-FIX ERA LOST, by name, with its receipt.
 *
 * Keyed `(at, handle)`. It is lawfully absent from `acts` and lawfully present
 * in the lab office's voices log, so a comparison against THAT log differs by
 * exactly this row and by nothing else.
 */
export const LOST_TO_THE_PRE_FIX_ERA = Object.freeze([{
  at: "2026-08-28T16:18:38.744Z", handle: "wright",
  receipt: "world2/tools/README.md § falsifier-acts-lane-closure, and the merge commit 87f4fe65: the lab's first " +
           "witnessed act, spoken before the say lane reached `acts` (the lane hook deployed 2026-08-29T00:20Z). " +
           "In voices-log.jsonl, never in acts. The standing --since is dated at that deploy so it excuses the " +
           "pre-fix era and nothing after.",
}]);
const lostKey = new Set(LOST_TO_THE_PRE_FIX_ERA.map((l) => `${Date.parse(l.at)}|${l.handle}`));

const key = (v) => `${v.at}|${v.handle}`;
const firstDiff = (a, b) => { let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++; return i; };

/**
 * THE VENDOR TRIPWIRE, for the OFFICE half.
 *
 * `falsifier-live-equality.mjs`'s own tripwire skips everything that is not in
 * the world repo (`if (v.repo !== "keeminlee/postmark-world") continue`) — the
 * office-side vendors there are unwatched. These two are in THIS repo, so the
 * check is one `git rev-parse` and there is no reason not to make it.
 *
 * It says "re-check", not "you are wrong": a moved file is a fact about the
 * checkout, and whether the vendored function moved with it is a question for a
 * person. It has already earned itself once — `src/world-journal.mjs` moved from
 * `70c5a1f8` to `fc8cda4c` the same night this landed, and `composeAnchor` was
 * byte-identical across the move.
 */
export function vendorDrift(repoRoot) {
  const out = [];
  for (const [name, v] of Object.entries(talk.VENDOR)) {
    if (v.repo !== "keeminlee/postmark-office") continue;
    let blob = null;
    try { blob = execFileSync("git", ["-C", repoRoot, "rev-parse", `HEAD:${v.path}`], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); }
    catch { continue; }   // not a checkout, or a path this sha does not carry
    if (blob !== v.blob) out.push({ name, path: v.path, vendored: v.blob, checkout: blob });
  }
  return out;
}

// ── C1 · the record ─────────────────────────────────────────────────────────

/**
 * PER ERA, NOT PER RECORD — and the first cut of this check got it wrong.
 *
 * It scoped to `[min(acts), max(acts)]` as one contiguous stretch, which is true
 * while `acts` holds only the crystallized record. The moment a LIVE say lands,
 * that range swallows the frontier between them: the voices spoken after the
 * last crossing save and not yet crystallized. The run that found it reported
 * five prod voices as missing from `acts` when every one of them was simply
 * un-crystallized — a false finding manufactured by the check's own scoping,
 * which is exactly the shape `ab-compare.mjs`'s AB-P1 note warns about.
 *
 * So each era is compared inside its OWN extent, and the GAP between them is
 * reported as the named frontier it is. That is AB-P2's sentence applied
 * honestly: compare the frozen era to the frozen era, and say what lies outside.
 */
export function c1Record(fromActs, fromLog) {
  const findings = [];
  if (!fromActs.length) return { findings: ["C1 `acts` holds no voices — nothing to compare, and a green here would be unearned"], compared: 0 };

  const byAct = new Map(fromActs.map((v) => [key(v), v]));
  const excused = [];
  const spans = [];
  let compared = 0;
  const covered = [];

  for (const era of ["crystallized", "live"]) {
    const mine = fromActs.filter((v) => v.era === era);
    if (!mine.length) continue;
    const lo = Math.min(...mine.map((v) => v.at));
    const hi = Math.max(...mine.map((v) => v.at));
    spans.push({ era, lo, hi, acts: mine.length });
    covered.push([lo, hi]);

    for (const l of fromLog.filter((v) => v.at >= lo && v.at <= hi)) {
      const a = byAct.get(key(l));
      if (!a) {
        if (lostKey.has(key(l))) { excused.push(key(l)); continue; }
        findings.push(`C1 [${era}] the log holds a voice inside this era that \`acts\` does not: ${new Date(l.at).toISOString()} ${l.handle} — "${l.text.slice(0, 60)}"`);
        continue;
      }
      compared++;
      for (const f of ["text", "x", "y", "place", "aboard"]) {
        if (JSON.stringify(l[f]) !== JSON.stringify(a[f])) {
          findings.push(`C1 [${era}] the two records disagree at ${new Date(l.at).toISOString()} ${l.handle} · field ${f}\n      log:  ${JSON.stringify(l[f])}\n      acts: ${JSON.stringify(a[f])}`);
          break;
        }
      }
    }
  }

  const inAnyEra = (t) => covered.some(([lo, hi]) => t >= lo && t <= hi);
  const byLog = new Map(fromLog.map((v) => [key(v), v]));
  for (const a of fromActs) {
    if (!byLog.has(key(a))) findings.push(`C1 [${a.era}] \`acts\` holds a voice inside its own era that the log does not: ${new Date(a.at).toISOString()} ${a.handle} (act ${a.act_id})`);
  }

  const outside = fromLog.filter((v) => !inAnyEra(v.at));
  const first = spans.length ? Math.min(...spans.map((s) => s.lo)) : 0;
  const last = spans.length ? Math.max(...spans.map((s) => s.hi)) : 0;
  const frontier = outside.filter((v) => v.at > first && v.at < last).length;
  return { findings, compared, excused,
    note: spans.map((s) => `${s.era} ${new Date(s.lo).toISOString()} → ${new Date(s.hi).toISOString()} (${s.acts})`).join(" · ") +
      ` · log before ${outside.filter((v) => v.at < first).length}` +
      (frontier ? ` · ${frontier} between the eras (spoken, not yet crystallized)` : "") +
      ` · after ${outside.filter((v) => v.at > last).length}` };
}

// ── C2 · the vendored clusterVoices against 1.0's ───────────────────────────

export function c2Vendor(voices, oracleCluster, { earshotM, fadeMs }) {
  const findings = [];
  const shape = (cs) => cs.map((c) => ({ latest: c.latest, voices: c.voices.map((v) => v.act_id ?? `${v.at}|${v.handle}`) }));
  const o = JSON.stringify(shape(oracleCluster(voices, { earshotM, fadeMs })));
  const m = JSON.stringify(shape(talk.clusterVoices(voices, { earshotM, fadeMs })));
  if (o !== m) {
    const i = firstDiff(o, m);
    findings.push(`C2 the vendored clusterVoices differs from voices.mjs's — first divergence at char ${i}\n` +
      `      1.0:  …${o.slice(Math.max(0, i - 60), i + 60)}…\n      port: …${m.slice(Math.max(0, i - 60), i + 60)}…`);
  }
  return { findings, compared: voices.length };
}

// ── C3 · the whole page ─────────────────────────────────────────────────────

export function c3Page(oracleBody, portBody) {
  const findings = [];
  let compared = 0;
  for (const half of ["live", "closed"]) {
    const o = oracleBody[half] ?? [];
    const m = portBody[half] ?? [];
    if (o.length !== m.length) {
      findings.push(`C3 the ${half} half holds ${o.length} thread(s) in 1.0 and ${m.length} in the port`);
      continue;
    }
    for (let i = 0; i < o.length; i++) {
      compared++;
      const a = JSON.stringify(o[i]), b = JSON.stringify(m[i]);
      if (a === b) continue;
      const d = firstDiff(a, b);
      findings.push(`C3 ${half} thread ${i} (${o[i].id}) differs — first divergence at char ${d}\n` +
        `      1.0:  …${a.slice(Math.max(0, d - 70), d + 70)}…\n      port: …${b.slice(Math.max(0, d - 70), d + 70)}…`);
    }
  }
  for (const k of ["earshot_m", "fade_minutes", "close_minutes"]) {
    if (oracleBody[k] !== portBody[k]) findings.push(`C3 the body's ${k} is ${oracleBody[k]} in 1.0 and ${portBody[k]} in the port`);
    else compared++;
  }
  return { findings, compared };
}

// ── C4 · the dials ──────────────────────────────────────────────────────────

export function c4Dials(fromMarks, oracleDials) {
  const findings = [];
  let compared = 0;
  for (const [slot, d] of Object.entries(fromMarks)) {
    const o = oracleDials[slot];
    if (!o) { findings.push(`C4 voices.mjs has no dial named ${slot} — the spec and the store disagree about what speech has dials for`); continue; }
    compared++;
    if (Number(o.value) !== Number(d.value)) {
      findings.push(`C4 dial ${slot}: voices.mjs reads ${o.value} (${o.source}) and the store reads ${d.value} (${d.source})`);
    }
  }
  const indistinguishable = Object.entries(fromMarks)
    .filter(([slot, d]) => d.read && Number(d.value) === Number(talk.SAY_DIAL_SPEC[slot][0])).map(([slot]) => slot);
  return { findings, compared,
    note: indistinguishable.length === compared
      ? `all ${compared} recorded values EQUAL the module fallbacks, so this comparison cannot currently tell a good read from a fallback — it becomes a real check the day a dial moves`
      : `${compared - indistinguishable.length} dial(s) differ from their fallback, so this comparison has teeth` };
}

// ── the run ─────────────────────────────────────────────────────────────────

async function main() {
  const logPath = arg("--voices-log");
  if (!logPath) die("--voices-log <path> is required — 1.0's own record is the oracle, and this check has none without it");
  if (!existsSync(logPath)) die(`no voices log at ${logPath}`);
  if (!process.env.WORLD2_PG_URL) die("WORLD2_PG_URL missing");

  // 1.0's own module, imported live. It reads the say dials off the sqlite world
  // store at import; whatever it answers there is 1.0's answer and is what C4
  // compares against.
  let voicesMod;
  try { voicesMod = await import(pathToFileURL(resolve(OFFICE, "src", "voices.mjs")).href); }
  catch (e) { die(`could not import 1.0's src/voices.mjs — there is no oracle without it: ${e.message}`); }

  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: process.env.WORLD2_PG_URL });
  try { await client.connect(); } catch (e) { die(`cannot connect: ${e.message}`); }

  let out = {};
  try {
    const { rows } = await client.query(
      `SELECT id, at, actor, action, at_anchor, at_dx, at_dy, payload FROM acts
        WHERE action = ANY($1) ${talk.VOICE_ORDER_SQL}`, [talk.VOICE_ACTIONS]);
    // The door's own anchors (every mark the store holds) and its own dials (only what stands).
    const { rows: markRows } = await client.query(talk.ANCHOR_MARKS_SQL);
    const centres = talk.anchorCentres(markRows);

    let derived;
    try { derived = talk.voiceRecords(rows, { centreOf: (id) => centres.get(id) ?? null }); }
    catch (e) { die(`the port refuses an act it cannot explain, so there is nothing to compare: ${e.message}`); }

    const dials = talk.sayDials(markRows.filter((m) => m.status === "standing"));
    const earshotM = dials.earshot_m.value;
    const closeMs = dials.conversation_lull_min.ms;
    const fadeMs = dials.fade_min.ms;

    // 1.0's own reader over the same log file, with its own clock pinned so both
    // sides answer the same instant. `standpoint` is never reached by
    // `conversations()`; it is required by the constructor.
    const nowMs = Date.now();
    const oracle = voicesMod.createVoices({
      standpoint: async () => null, logPath: () => logPath, now: () => nowMs,
      earshotM, fadeMs, closeMs,
      // The WHOLE log, not 1.0's last-2,000 RAM window. C1's question is "does
      // the store hold the record" and the window is a property of a running
      // process — truncating the oracle would silently move the era boundary
      // and report a shorter history as agreement. (Caught by the first run:
      // the truncated log said 119 voices predate the era where the whole log
      // says 823.)
      memoryMax: Infinity,
    });
    const fromLog = oracle._voices();
    if (!fromLog.length) die(`${logPath} holds no readable voices — the oracle is empty and a green would be unearned`);

    const c1 = c1Record(derived.voices, fromLog);
    // C2 and C3 are fed the ACTS-derived voices, so they are about the
    // derivations rather than about the two records agreeing — which is C1's
    // question and is asked separately. (The live lane's lesson: a break fed to
    // both sides of an equality proves nothing.)
    const c2 = c2Vendor(derived.voices, voicesMod.clusterVoices, { earshotM, fadeMs: closeMs });

    // The page, both ways, over ONE voice list at ONE instant. 1.0's side runs
    // its whole pipeline — its `hydrate`, its `clusterVoices`, its private
    // `threadOf` — over a temp log carrying exactly the voices `acts` yielded.
    const portBody = talk.conversationsOf(derived.voices, { now: nowMs, earshotM, closeMs, fadeMs });
    const scratch = mkdtempSync(join(tmpdir(), "world2-conv-"));
    let oracleBody;
    try {
      const mirror = join(scratch, "voices-log.jsonl");
      writeFileSync(mirror, derived.voices.map((v) => JSON.stringify({
        at: new Date(v.at).toISOString(), handle: v.handle, text: v.text,
        x: v.x, y: v.y, place: v.place, aboard: v.aboard,
      })).join("\n") + "\n");
      oracleBody = voicesMod.createVoices({
        standpoint: async () => null, logPath: () => mirror, now: () => nowMs,
        earshotM, fadeMs, closeMs,
        // `MEMORY_MAX_VOICES` (2000) is 1.0's RAM window — "the look-back the
        // page can serve after a restart" — not a law about the page. The port
        // holds no window; it queries. Comparing against a truncated oracle
        // would report the port as wrong by exactly the size of a bound that
        // does not exist on its side. The DIVERGENCE IS REAL and named in
        // conversations.mjs § DISCLOSURES; what it is not is a derivation
        // finding, so it is lifted here and counted below.
        memoryMax: Infinity,
      }).conversations();
    } finally { rmSync(scratch, { recursive: true, force: true }); }
    const c3 = c3Page(oracleBody, portBody);
    const c4 = c4Dials(dials, voicesMod.SAY_DIALS);

    const e = { C1: c1, C2: c2, C3: c3, C4: c4 };
    out = {
      store: { voice_acts: rows.length, voices: derived.voices.length, eras: derived.eras,
               non_sound_emissions: derived.non_sound_emissions, log_voices: fromLog.length },
      dials: Object.fromEntries(Object.entries(dials).map(([k, d]) => [k, `${d.value} (${d.source})`])),
      equalities: Object.fromEntries(Object.entries(e).map(([k, r]) => [k, { compared: r.compared, findings: r.findings.length, ...(r.note ? { note: r.note } : {}) }])),
      unchecked: Object.entries(e).filter(([, r]) => !r.compared).map(([k]) => k),
      findings: Object.values(e).flatMap((r) => r.findings),
      vendor_drift: vendorDrift(OFFICE),
      refusals: derived.refusals,
      unplaced: derived.unplaced,
      allowlist: LOST_TO_THE_PRE_FIX_ERA.map((l) => ({ ...l, exercised: (c1.excused ?? []).includes(`${Date.parse(l.at)}|${l.handle}`) })),
    };

    if (has("--can-fail-proof")) {
      const results = [];
      const proof = (label, run) => {
        try { const r = run(); results.push({ mangle: label, findings: r.findings.length, bit: r.bit, first: r.findings[0]?.split("\n")[0] ?? null }); }
        catch (err) { results.push({ mangle: label, findings: -1, bit: null, note: `threw: ${String(err.message).slice(0, 140)}` }); }
      };

      // 1 · A VOICE DROPPED FROM THE MIDDLE. Aimed at C1, whose oracle is the
      //     log — a side the break cannot reach.
      //
      //     FROM THE MIDDLE, AND THE FIRST CUT OF THIS PROOF WAS NOT A PROOF.
      //     It dropped the LAST voice and read SILENT, which looked like the
      //     check missing a loss and was not: C1 derives the era from the acts
      //     side's own min/max, so removing an edge voice moves the boundary and
      //     the removed row lands outside the compared range. That is a REAL
      //     LIMIT of era scoping and it is stated rather than tuned away — C1
      //     covers the INTERIOR of the record, and the FRONTIER is
      //     `falsifier-acts-lane-closure.mjs`'s job, which compares each lane's
      //     own pen against `acts` from a standing `--since` and therefore has a
      //     boundary no loss can move.
      proof("a voice missing from the middle of `acts` (the say lane silently open again)", () => {
        const mid = Math.floor(derived.voices.length / 2);
        const victim = derived.voices[mid];
        const cut = derived.voices.filter((v) => key(v) !== key(victim));
        return { bit: derived.voices.length - cut.length, findings: c1Record(cut, fromLog).findings };
      });
      // 2 · A VOICE'S TEXT BENT. Aimed at C1's field comparison.
      proof("a voice's text bent in the act", () => {
        const bent = derived.voices.map((v, i) => (i === 0 ? { ...v, text: `${v.text} (forged)` } : v));
        return { bit: 1, findings: c1Record(bent, fromLog).findings };
      });
      // 3 · THE DECK RULE DROPPED from the vendored `chains`. Aimed at C2,
      //     whose oracle is voices.mjs's own function.
      //     `bit` IS THE PRECONDITION, NOT THE COUNT OF ABOARD VOICES. The deck
      //     exception only decides anything when two aboard voices are within one
      //     lull of each other AND beyond earshot — that is the sailing-night case
      //     it was written for. Counting aboard voices instead would report SILENT
      //     on a record that simply never sailed anyone out of earshot, which is
      //     the proof lying in the safe direction (the standing lane's INERT
      //     lesson, applied to the break's own precondition rather than to its
      //     inputs).
      proof("the vendored chain rule loses the deck exception (two aboard voices no longer one room)", () => {
        const aboard = derived.voices.filter((v) => v.aboard).sort((a, b) => a.at - b.at);
        let pairs = 0;
        for (let i = 0; i < aboard.length; i++) {
          for (let j = i + 1; j < aboard.length; j++) {
            if (aboard[j].at - aboard[i].at > closeMs) break;
            if (Math.hypot(aboard[i].x - aboard[j].x, aboard[i].y - aboard[j].y) > earshotM) pairs++;
          }
        }
        if (!pairs) return { bit: 0, findings: [] };   // INERT: the record holds no such pair
        const grounded = derived.voices.map((v) => ({ ...v, aboard: false }));
        const shape = (cs) => JSON.stringify(cs.map((c) => c.voices.map((v) => v.act_id)));
        const o = shape(voicesMod.clusterVoices(derived.voices, { earshotM, fadeMs: closeMs }));
        const m = shape(talk.clusterVoices(grounded, { earshotM, fadeMs: closeMs }));
        return { bit: pairs, findings: o === m ? [] : [`the deck exception changes the clustering (${pairs} aboard pair(s) beyond earshot) — it is load-bearing`] };
      });
      // 4 · THE EAR'S CLOCK USED FOR THE RECORD. Aimed at C3: fadeMs instead of
      //     closeMs is the sailing-night bug, and it shatters the threads.
      proof("the record clustered on the EAR's clock (fadeMs, not the lull)", () => {
        const bent = talk.conversationsOf(derived.voices, { now: nowMs, earshotM, closeMs: fadeMs, fadeMs });
        return { bit: derived.voices.length, findings: c3Page(oracleBody, bent).findings };
      });
      // 5 · THE EARSHOT WIDENED — the town as one room.
      proof("the earshot widened to the whole town", () => {
        const bent = talk.conversationsOf(derived.voices, { now: nowMs, earshotM: 1e9, closeMs, fadeMs });
        return { bit: derived.voices.length, findings: c3Page(oracleBody, bent).findings };
      });
      // 6 · A REFUSAL SWALLOWED — an act shape no era explains, skipped instead
      //     of named. Aimed at `voiceRecords`' own strictness. A say with no
      //     actor is unreadable; a say whose anchor is gone is only UNPLACED and
      //     is answered around and disclosed (#351), so it is not this proof's act.
      proof("an unreadable voice act skipped instead of refused", () => {
        const forged = { id: "999999", at: new Date(), actor: null, action: "say", at_anchor: "world", at_dx: 1, at_dy: 1, payload: { text: "" } };
        let threw = false;
        try { talk.voiceRecords([...rows, forged], { centreOf: (id) => centres.get(id) ?? null }); } catch { threw = true; }
        return { bit: 1, findings: threw ? ["the strict read refuses a say with no actor"] : [] };
      });
      // 7 · THE ALLOWLIST MUST BE A ROW, NOT A WINDOW. A second loss inside the
      //     era must not shelter behind the first one's excuse. Taken from the
      //     interior, for break 1's reason.
      proof("a SECOND lost voice, not the allowed one", () => {
        const inner = derived.voices.slice(1, -1).filter((v) => !lostKey.has(key(v)));
        const victim = inner[Math.floor(inner.length / 2)];
        if (!victim) return { bit: 0, findings: [] };
        const cut = derived.voices.filter((v) => key(v) !== key(victim));
        return { bit: 1, findings: c1Record(cut, fromLog).findings };
      });

      out.can_fail = {
        results,
        silent: results.filter((r) => r.findings === 0 && r.bit !== 0).map((r) => r.mangle),
        inert: results.filter((r) => r.bit === 0).map((r) => r.mangle),
      };
    }
  } catch (err) {
    die(err.message);
  } finally { await client.end(); }

  report(out);
  if (out.unchecked?.length) process.exit(2);
  if (out.can_fail?.silent.length) process.exit(1);
  process.exit(out.findings.length ? 1 : 0);
}

function report(out) {
  if (has("--json")) { console.log(JSON.stringify(out, null, 2)); return; }
  const s = out.store;
  console.log(`${s.voice_acts} voice act(s) → ${s.voices} voices (crystallized ${s.eras.crystallized} · live ${s.eras.live})` +
    `${s.non_sound_emissions ? ` · ${s.non_sound_emissions} non-sound emission(s) skipped` : ""} · ${s.log_voices} in 1.0's log`);
  console.log(`  dials: ${Object.entries(out.dials).map(([k, v]) => `${k} ${v}`).join(" · ")}`);
  for (const [k, v] of Object.entries(out.equalities))
    console.log(`  ${v.findings ? "✗" : "·"} ${k}  compared ${String(v.compared).padStart(5)}  findings ${v.findings}${v.note ? `\n         ${v.note}` : ""}`);
  for (const v of out.vendor_drift ?? [])
    console.log(`  ⚑ the vendored ${v.path} has MOVED: ${v.vendored.slice(0, 8)} when copied, ${v.checkout.slice(0, 8)} in this checkout — re-check conversations.mjs`);
  for (const a of out.allowlist)
    console.log(`  ${a.exercised ? "⚑ EXCUSED" : "· unexercised"}: ${a.at} ${a.handle} — ${a.receipt.slice(0, 110)}…`);
  for (const r of out.refusals.slice(0, 5)) console.log(`  ⚑ refused: ${r}`);
  for (const f of out.findings) console.log(`  ✗ ${f}`);
  if (out.unchecked.length) console.log(`  ⚑ compared nothing: ${out.unchecked.join(", ")} — a green here is unearned`);
  if (out.can_fail) {
    console.log("\ncan-fail proof (the port's inputs broken in memory; the store is never touched):");
    for (const r of out.can_fail.results)
      console.log(r.bit === 0
        ? `  INERT  ${r.mangle} — the break altered no input, so it proves nothing here`
        : `  ${r.findings > 0 ? "RED   " : r.findings === 0 ? "SILENT" : "THREW "} ${r.mangle} — ${r.findings > 0 ? `${r.findings} finding(s)` : r.findings === 0 ? "NOTHING NOTICED" : r.note}`);
    console.log(out.can_fail.silent.length
      ? `  can-fail NOT PROVEN: ${out.can_fail.silent.length} break(s) went unnoticed`
      : "  can-fail PROVEN: every break turned the falsifier red");
  }
  console.log(out.findings.length ? `\nRED · ${out.findings.length} finding(s)` : "\nGREEN · the port and 1.0's own voices.mjs agree on every row compared");
}

// ── entry guard ──────────────────────────────────────────────────────────────
// The junction lesson (2026-09-05, HQ memory `junctions-defeat-main-guards`):
// `pathToFileURL(process.argv[1]).href === import.meta.url` is FALSE when the
// entry path reaches this file through a Windows junction — the ESM loader
// realpaths the entry, argv[1] is not — so the tool exits 0 having done nothing.
// Compare real paths (world2/tools/await-clearing.mjs's idiom); the URL compare is
// only the fallback for an argv[1] that cannot be realpath'd. The office's
// test/cli-guard.test.mjs imports this file and spawns it through a junction.
const isMain = (() => {
  if (!process.argv[1]) return false;
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return pathToFileURL(process.argv[1]).href === import.meta.url; }
})();
if (isMain) {
  main().catch((e) => { console.error(String(e?.stack ?? e)); process.exit(2); });
}
