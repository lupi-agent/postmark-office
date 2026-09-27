// state-log-from-store.mjs — THE PHOTOGRAPH, RE-DERIVED FROM THE REGISTER.
//
// ── WHAT THIS IS, AND WHY IT HAD TO EXIST BEFORE THE SWAP ────────────────────
//
// `src/world-drain.mjs` does two jobs the G1 plan counts as one. Besides the
// sketchbooks it writes `STATE/log/<N>.journal.jsonl` (+ `.journal.meta.json`)
// and commits them into the world repo — the last git-era crossing's receipt
// names `state_commit cae5f27b`. Drop the drain and that writer goes with it.
//
// The drain's own header says why nobody could re-derive those rows, verbatim:
//
//     "The journal's rows are CONSUMED — after the truncate they exist nowhere
//      else — so crossing-save could never re-derive them, and the first time it
//      rewrote a window it would erase them."
//
// That sentence is true of the SQLITE journal and false of the register. In the
// store the same acts are rows in `acts`, and nothing truncates them. So the
// re-derivation the drain calls impossible is possible — and this module is it.
//
// ── WHAT IT IS NOT ───────────────────────────────────────────────────────────
//
// It is NOT a second serializer. `world-drain.logLine` owns the line grammar and
// this module reproduces its field order deliberately, in one place, with the
// drain's own comment quoted at the reconstruction so the two cannot drift
// silently. If `logLine` gains a column, `LINE_FIELDS` below goes red in
// `test/state-log-from-store.test.mjs` before anything reaches a world repo.
//
// ── THE THREE THINGS THE REGISTER CANNOT GIVE BACK, MEASURED ─────────────────
//
// Measured on prod 2026-09-08 against `STATE/log/177.journal.jsonl` at
// `settlement/S63` (`256db2fe`), 11 lines, seq 1364–1378:
//
//   1. `seq` — NO STORE SOURCE AT ALL. `acts.journal_seq` is the shadow-era
//      pairing key and it is NULL for 4,483 of 4,689 rows; its highest non-null
//      value is 1115, from 2026-09-05. Every act in window 177 has it null,
//      because the pen for those lanes is already flipped and there was no
//      sqlite seq to pair. `acts.id` is the register's own sequence and it is
//      monotone in exactly the order the journal's was, so it is the honest
//      successor — but it is a DIFFERENT NUMBERING, which is why `seqOf` is a
//      parameter and why `MERGE_HAZARD` below is a refusal and not a note.
//
//   2. `at`, for a PRIVATE DRAFT declaration. Phase 5.6 defers an unstaked mark
//      (`world-journal.mjs § privateDraftAct`): the sqlite row is written at the
//      COMPOSE and no act is mirrored until a stake puts it forward, and
//      `world2-claims.mjs § promoteDraftOnStake` dates the act at the putting-
//      forward — "the world witnessed a resident put this mark forward; it did
//      not witness them thinking about it". Both instants are correct and the
//      register holds only the later one. In window 177 that is three of eleven
//      lines, 8.9s / 9.0s / 13.4s late. The compose instant survives in the
//      photograph and NOWHERE ELSE: `claims.data._deferred_act` is consumed on
//      promotion and `claims.submitted_at` is the promotion. `payload.date` is
//      the door's own stamp and is 360ms off the journal's, so it is not it
//      either. This is named, not papered: `deferred` marks each such line.
//
//   3. `payload` KEY ORDER. Postgres `jsonb` does not preserve object key order;
//      it stores keys sorted by (length, bytes). The drain wrote whatever the
//      door built, in insertion order. For a `voice` payload — `{text, place}` —
//      the two orders coincide by accident. For a `mark` payload they do not.
//      `standing` and `witnesses` ARE recoverable, because their shapes are
//      fixed by `the-witnessed-line` and this module rebuilds them under their
//      own field lists; `payload` is arbitrary and is not. See `PAYLOAD_ORDER`.
//
// ── ONE FACT, TWO PENS: THE NOTARY ───────────────────────────────────────────
//
// `world2/tools/snapshot-export.mjs` already exports `archives/acts/<window>.
// jsonl` from the same rows — frozen on write, certified, 26 windows live at
// 150–175. It is the same acts, in the RAW ROW shape (`id`, `at_anchor`,
// `at_dx`, `at_dy`, `journal_seq`, `inserted_at`), grouped by half-open window
// `(previous closed, N]` rather than by exact crossing value. So the two files
// are one fact written twice in two shapes into two repos. Which one the
// readers should move to is a conductor call and the costing is in the lane
// report; this module does the re-derivation the swap needs TODAY, so that the
// call can be made without the photograph going dark in the meantime.
//
// No env. No clock. No git. The caller supplies the register client, the window,
// the horizon, and the two mappings — because the household resolver lives in
// lane 3's `src/store-writedown.mjs § sketchbookNameFor` and belongs there, not
// in a second copy here.

/**
 * The drain's line grammar, field for field, IN ORDER.
 *
 * `world-drain.logLine` returns an object literal and JSON.stringify emits its
 * keys in insertion order, so this list IS the byte order of every line in
 * every `STATE/log/<N>.journal.jsonl` the town holds. It is duplicated here on
 * purpose and bound by a falsifier that imports `logLine` itself, because the
 * alternative — importing `logLine` and rebuilding from its output — would make
 * this module read a row it does not have.
 */
export const LINE_FIELDS = Object.freeze([
  "at", "type", "actor", "seq", "class", "object",
  "household", "crossing", "standing", "witnesses", "effect", "payload",
]);

/** `the-witnessed-line`'s anchor+offset, in the pen's own order. */
export const STANDING_FIELDS = Object.freeze(["anchor", "dx", "dy"]);

/** One witness, in the pen's own order. The envelope is `{source, list}`. */
export const WITNESS_FIELDS = Object.freeze(["handle", "anchor", "dx", "dy"]);

/**
 * WHY THERE IS NO `PAYLOAD_FIELDS`.
 *
 * A payload is whatever the door built. Naming an order here would be a fixture
 * built to the shape I imagine rather than the shape the town produces, and it
 * would go quietly wrong the first time a door added a key. The honest position
 * is that payload key order does not survive `jsonb` and this module does not
 * pretend otherwise: `compareWindow` names it as "key ORDER only" whenever the
 * values are equal, so a caller counts the cost instead of meeting it in a git
 * diff. This sentence used to promise a `payload_order_lost` field the module
 * never had — a comment describing a reader that does not exist, which is the
 * defect this whole lane is about, committed inside the fix for it.
 */
export const PAYLOAD_ORDER = "not recoverable from jsonb — named by compareWindow, never invented";

/**
 * A window that the DRAIN already photographed must never be re-derived into.
 *
 * `world-drain.writeJournalWindow` merges by `seq` and rewrites the file whole.
 * The register's `seq` is a different numbering from the journal's, so a
 * re-derivation of an already-written window does not overwrite its lines — it
 * ADDS a second copy of every one of them under new numbers. Window 177 would
 * go from 11 lines to 22, and the merge would look like it worked.
 *
 * So the boundary is a refusal, not a caution. The caller names the last window
 * the drain wrote; anything at or below it is refused by name.
 */
export const MERGE_HAZARD =
  "the drain already photographed this window and the register's seq is a different numbering — "
  + "re-deriving it would merge a second copy of every line, not replace them";

/**
 * The instant, in the journal's own spelling — millisecond ISO with a `Z`.
 *
 * The `pg` driver hands a `timestamptz` back as a Date; `psql` and a JSON
 * fixture hand it back as `2026-09-08T12:07:55.964+00:00`. The journal wrote a
 * JS ISO string, so `Z` and three fractional digits IS the grammar, and both
 * spellings must land on it or the bytes differ for a reason that is about the
 * driver rather than about the record.
 *
 * A source instant carrying MORE than three fractional digits would be silently
 * truncated by `toISOString`, so it is refused instead. `acts.at` is the pen's
 * own ISO string for every mirrored row, which is why this has never fired —
 * but `now()` is microsecond and one column defaulting that way is all it would
 * take, and a photograph that quietly rounded its own timestamps is the kind of
 * thing nobody finds until a twin cannot be paired.
 */
export function journalInstant(v) {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString();
  const s = String(v);
  const frac = /\.(\d+)/.exec(s);
  if (frac && frac[1].length > 3 && !/0+$/.test(frac[1].slice(3))) {
    throw new Error(`instant ${s} carries sub-millisecond precision the journal's grammar cannot hold`);
  }
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) throw new Error(`instant ${s} is not a time`);
  return d.toISOString();
}

/** Reorder an object's keys into `fields`, keeping any extra key after them in its own order. */
function inOrder(obj, fields) {
  if (obj == null || typeof obj !== "object" || Array.isArray(obj)) return obj;
  const out = {};
  for (const f of fields) if (f in obj) out[f] = obj[f];
  for (const k of Object.keys(obj)) if (!(k in out)) out[k] = obj[k];
  return out;
}

/**
 * `standing`, rebuilt from the register's three columns.
 *
 * The drain carried `row.at` — the sqlite TEXT column the pen wrote — straight
 * through. The register splits it into `at_anchor / at_dx / at_dy` (the columns
 * `the-anchor` asked for), so this puts it back together.
 *
 * A ROW WITH NO ANCHOR STILL GETS THE OBJECT, and this is the one place I got it
 * wrong by reasoning instead of reading. `logLine` writes `row.at ?? null`, and
 * the pen's `row.at` for a standing-less act is the JSON text
 * `{"anchor":null,"dx":null,"dy":null}` — an object, which is truthy, so the
 * `?? null` never fires. Returning a bare `null` here looked obviously right and
 * is not what any file in the town holds.
 *
 * MEASURED, not assumed: across every `STATE/log/*.journal.jsonl` in world main
 * at `256db2fe` there are 483 lines with no anchor — 231 `exit`, 215 `enter`,
 * 24 arena `join`, 11 arena `leave`, 2 `declare-stance-on` — and ALL 483 spell
 * it as the object of nulls. Not one spells it `null`. So there is no ambiguity
 * for the register to fail to resolve: one shape, always.
 */
export function standingFieldOf(act, fields = STANDING_FIELDS) {
  // Built THROUGH the field list, and the list is the ONLY thing that decides
  // the order. The first version of this built a literal in the right order and
  // then copied it through the loop, which reads as a binding and is not one:
  // deleting the loop returned the same bytes, so the falsifier that claimed to
  // hold the list load-bearing could not fail. The columns are a LOOKUP now, with
  // no order of their own, so reordering `fields` reorders the output — which is
  // what F16 flips.
  const column = { anchor: "at_anchor", dx: "at_dx", dy: "at_dy" };
  const out = {};
  for (const f of fields) out[f] = act[column[f]] ?? null;
  return out;
}

/**
 * `witnesses`, with the pen's key order restored at both levels.
 *
 * The envelope the pen writes is `{source, list}` and each entry is
 * `{handle, anchor, dx, dy}`; `jsonb` hands them back sorted. Restoring the
 * order here is legitimate where restoring `payload`'s is not, because this
 * shape is FIXED BY LAW — `the-witnessed-line` says a line carries "an anchor
 * and an offset: where the actor stood, relative to what, at that instant" —
 * and a shape the law fixes is one this module may name.
 *
 * An entry carrying a key outside the four is kept, after them, rather than
 * dropped: a helper that discards a field is a test that cannot see it.
 */
export function witnessesOf(act) {
  const w = act.witnesses;
  if (w == null) return null;
  if (typeof w !== "object" || Array.isArray(w)) return w;
  const out = {};
  if ("source" in w) out.source = w.source;
  if (Array.isArray(w.list)) out.list = w.list.map((e) => inOrder(e, WITNESS_FIELDS));
  for (const k of Object.keys(w)) if (!(k in out)) out[k] = w[k];
  return out;
}

/**
 * ONE ACT → ONE PHOTOGRAPH LINE, in `world-drain.logLine`'s own field order.
 *
 * `householdNameFor` maps the register's household KEY to the name the journal
 * spelled — `solo:xf3s` → `xf3s`, `gh:<github-id>` → the login bound in
 * `WORLD/households.json`. It is injected rather than implemented because lane
 * 3 already owns that resolution (`src/store-writedown.mjs § sketchbookNameFor`)
 * and it is load-bearing there for the sweep's authorship wall: two copies of it
 * is how the wall and the photograph come to disagree about who wrote a mark.
 * A null return is passed through as null — a household this resolver cannot
 * name is a finding for the caller, not a value to guess.
 *
 * `seqOf` is injected for the reason in `MERGE_HAZARD`: there is no journal seq
 * to recover, and which number stands in its place is a decision about a file
 * other tools merge by, not a detail.
 */
export function logLineFromAct(act, { householdNameFor = (k) => k, seqOf = (a) => a.id, fields = LINE_FIELDS } = {}) {
  const line = {
    at: journalInstant(act.at),
    type: act.action,
    actor: act.actor,
    seq: seqOf(act),
    class: act.class,
    object: act.object ?? null,
    household: act.household == null ? null : householdNameFor(act.household),
    crossing: act.crossing == null ? null : Number(act.crossing),
    standing: standingFieldOf(act),
    witnesses: witnessesOf(act),
    effect: act.effect ?? null,
    payload: act.payload ?? null,
  };
  // The field list is the grammar. Building the literal above in order is what
  // makes the bytes right; this assertion is what makes a future edit that
  // reorders it fail here instead of in a world repo.
  // `fields` is a test seam, and it exists because DELETING THIS GUARD IS
  // INVISIBLE: the guard can only fire on an edit that reorders the literal
  // above, so no falsifier over the real grammar can ever make it throw, and a
  // future hand could remove it with the whole suite green. Handing the guard
  // its expectation lets a test drive it to its own red without touching the
  // literal — the one way to show it is wired at all. Nothing in production
  // passes it. (My reviewer's item; not a merge condition, one line.)
  const keys = Object.keys(line);
  if (keys.length !== fields.length || keys.some((k, i) => k !== fields[i])) {
    throw new Error(`the line grammar drifted: built [${keys}], LINE_FIELDS is [${fields}]`);
  }
  return line;
}

/**
 * The counts a caller needs to judge the re-derivation, per line.
 *
 * `deferred` is the private-draft `at` divergence (§ 2 above): true when the
 * register's instant is the putting-forward and the journal's was the compose.
 * It cannot be detected from the act alone — the compose instant is gone — so
 * it is detected against the file being compared to, and reported by
 * `compareWindow` rather than claimed here.
 */
export function windowFromActs(acts, opts = {}) {
  return acts
    .map((a) => logLineFromAct(a, opts))
    .sort((a, b) => (a.seq === b.seq ? 0 : a.seq < b.seq ? -1 : 1));
}

/** The bytes `writeJournalWindow` would put on disk for these lines. */
export function windowBytes(lines) {
  return lines.length ? `${lines.map((l) => JSON.stringify(l)).join("\n")}\n` : "";
}

/**
 * `.journal.meta.json`, in `writeJournalWindow`'s own field order and grammar.
 *
 * The grammar sentence is copied verbatim from the drain rather than reworded,
 * because it is the file's own description of itself and a paraphrase would be
 * a second claim about what the file holds.
 */
export const META_GRAMMAR =
  "one line per journal row, in seq order; `standing` and `witnesses` are the-witnessed-line's anchor+offset, "
  + "pinned at the write instant and carried here unchanged";

export function metaFor(crossing, lines, { asOfWorld = null } = {}) {
  const counts = {};
  for (const l of lines) counts[l.type] = (counts[l.type] ?? 0) + 1;
  return {
    crossing,
    source: "dynamic.db/journal",
    grammar: META_GRAMMAR,
    as_of_world: asOfWorld,
    first_seq: lines.length ? lines[0].seq : null,
    last_seq: lines.length ? lines.at(-1).seq : null,
    event_count: lines.length,
    counts,
  };
}

/**
 * THE RE-DERIVATION.
 *
 * `client` is anything with `query(text, params) -> { rows }` — the office's
 * `pg` pool, a pooled client, or a scratch connection. This module never opens
 * one: the register it should read is the caller's decision, and a module that
 * chose its own would be one `WORLD2_PG_URL` away from reading prod during a
 * rehearsal.
 *
 * `window` is the EXACT crossing value, not the integer part. The drain groups
 * by `row.crossing` verbatim — `planDrain`: "Grouped by the row's OWN crossing,
 * so a drain that spans a boundary splits into the two windows it actually
 * covers rather than filing both under 'now'" — which is why the town holds
 * `177.journal.jsonl` beside `177.0872.journal.jsonl`. Equality on a numeric
 * column is exact, and that is the grouping this reproduces.
 *
 * `upto` is the horizon: the instant the drain would have run. Without it a
 * re-derivation of an old window silently picks up acts that arrived after that
 * crossing's drain and belong to the next one's file.
 *
 * `lastDrainedWindow`, when given, refuses at the boundary — see `MERGE_HAZARD`.
 */
export async function stateLogFromStore(client, {
  window,
  upto = null,
  asOfWorld = null,
  householdNameFor = (k) => k,
  seqOf = (a) => Number(a.id),
  lastDrainedWindow = null,
} = {}) {
  if (window == null || !Number.isFinite(Number(window))) {
    throw new Error(`stateLogFromStore needs an exact crossing value, got ${JSON.stringify(window)}`);
  }
  if (lastDrainedWindow != null && Number(window) <= Number(lastDrainedWindow)) {
    throw new Error(`window ${window} is at or below the last drained window ${lastDrainedWindow} — ${MERGE_HAZARD}`);
  }
  const params = [Number(window)];
  let sql = "SELECT id, at, crossing, actor, action, object, at_anchor, at_dx, at_dy,"
    // `journal_seq` IS GONE from this select with the column (G1 / POS-156,
    // migration 025). The `seq` gap below is unchanged and its cause now reads
    // without pointing at a column: the world's record has no store source for
    // the old sqlite sequence, and the register's `id` is the sequence it has.
    + " witnesses, class, payload, effect, household"
    + " FROM acts WHERE crossing = $1";
  if (upto != null) { params.push(upto); sql += ` AND at <= $${params.length}`; }
  sql += " ORDER BY id";

  const { rows } = await client.query(sql, params);
  const lines = windowFromActs(rows, { householdNameFor, seqOf });
  return {
    crossing: Number(window),
    lines,
    bytes: windowBytes(lines),
    meta: metaFor(Number(window), lines, { asOfWorld }),
    // Named so a caller can see what it is standing on rather than inferring it
    // from a line count: a household the resolver could not name is a finding.
    // Resolved off the ROWS, not off `lines` by index — the lines are sorted by
    // seq and the rows by id, and an index join across two orderings is the
    // quiet way a report names the wrong household.
    unnamed_households: [...new Set(rows
      .filter((r) => r.household != null && householdNameFor(r.household) == null)
      .map((r) => r.household))],
  };
}

/**
 * THE DIFF, LINE BY LINE, WITH EACH DIFFERENCE'S CAUSE NAMED.
 *
 * Reproduce-before-fix, made permanent: this is the instrument the lane used to
 * measure window 177 by hand, kept so the next window can be measured the same
 * way instead of by eye. It pairs on `(actor, type, object)` plus ordinal —
 * NOT on `at`, because the private-draft divergence is exactly a difference in
 * `at`, and a pairing key that included it would call three paired lines
 * "missing" and three "added" and report the one real finding as four wrong
 * ones. `falsifier-pen-flip.mjs § THE RELEASED-DRAFT KEY` learned this first.
 */
export function compareWindow(fileLines, derivedLines) {
  const key = (l) => JSON.stringify([String(l.actor), String(l.type), l.object == null ? null : String(l.object)]);
  const bucket = (ls) => {
    const m = new Map();
    for (const l of ls) { const k = key(l); if (!m.has(k)) m.set(k, []); m.get(k).push(l); }
    return m;
  };
  const fb = bucket(fileLines), db = bucket(derivedLines);
  const equal = [], differing = [], onlyInFile = [], onlyInDerived = [];

  for (const [k, fs] of fb) {
    const ds = db.get(k) ?? [];
    for (let i = 0; i < Math.max(fs.length, ds.length); i++) {
      const f = fs[i], d = ds[i];
      if (f && !d) { onlyInFile.push(f); continue; }
      if (d && !f) { onlyInDerived.push(d); continue; }
      const causes = [];
      for (const field of LINE_FIELDS) {
        const fv = JSON.stringify(f[field]), dv = JSON.stringify(d[field]);
        if (fv === dv) continue;
        if (field === "seq") causes.push({ field, cause: "no store source — `acts.journal_seq` was dropped by G1 (migration 025) and was NULL on every flipped row before that; this is the register's own id" });
        else if (field === "at") causes.push({ field, cause: "the private-draft deferral: the register holds the putting-forward instant, the journal held the compose", file: f.at, derived: d.at });
        else if (field === "household") causes.push({ field, cause: "household spelling — the register keys it, the journal named it", file: f.household, derived: d.household });
        else if (field === "payload" && JSON.stringify(sorted(f[field])) === JSON.stringify(sorted(d[field]))) {
          causes.push({ field, cause: "payload key ORDER only — jsonb does not preserve it; the values are equal" });
        } else causes.push({ field, cause: "values differ", file: f[field], derived: d[field] });
      }
      if (causes.length) differing.push({ key: k, causes }); else equal.push(f);
    }
  }
  for (const [k, ds] of db) if (!fb.has(k)) onlyInDerived.push(...ds);

  return { equal: equal.length, differing, onlyInFile, onlyInDerived };
}

/** Deep key-sort, so "same values, different order" can be told from "different values". */
function sorted(v) {
  if (Array.isArray(v)) return v.map(sorted);
  if (v && typeof v === "object") {
    const out = {};
    for (const k of Object.keys(v).sort()) out[k] = sorted(v[k]);
    return out;
  }
  return v;
}
