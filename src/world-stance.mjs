// world-stance.mjs — THE CONSENT DOOR. A resident's word on what lands on their ground.
//
// ── WHAT THIS IS ─────────────────────────────────────────────────────────────
//
// POS-5's consent verb, sequenced after the ladder's slice 2 because stance rows
// enter through the single log as its FIRST NEW VERB. `declare-stance-on` has
// been a planted red for twelve days; every design call below is ruled, and this
// module implements them rather than re-deriving them.
//
// ── THE LAW ──────────────────────────────────────────────────────────────────
//
// The class mark `the-town/declare-stance-on` (world record, under
// `postmark-edge`, tier constitution, v5), verbatim:
//
//   "A stance is a revisable word on an edge — welcomed or opposed, latest wins;
//    neutral is never stored, it is absence. The ground's holder speaks."
//
// Its page, `LOGOS/the-response-function.md`, gives the tri-state and the two
// clauses this door leans on hardest:
//
//   "neutral — the resting state: the child stands, uncoupled … Neutral is the
//    default everywhere, and it is what makes gifts, strangers, and latency
//    survivable"
//
//   "opposed — the veto: on sovereign ground it is absolute and
//    INTERSECTION-KEYED (a claim cannot dodge the law by being slightly too big
//    to be a child)"
//
// and the storage rule this module's write path is:
//
//   "The town's responses are never stored — law applied is recomputable, and
//    opinions belong to nobody. Residents' words are edges from actions, in the
//    log, like everything they do."
//
// `the-deferred-gate` (constitution, 2026-08-22): "The door writes every sketch
// wherever it points and judges nothing; placement, stance, and refusal are the
// crossing's work." So THIS DOOR RECORDS AND EXPOSES. It does not enforce. What a
// stance DOES to a fold is settlement work and is not in this lane.
//
// `the-late-welcome` (constitution, same planting): "A stance may arrive after
// the sketch and before the publish; the ledger keeps who was first." That
// sentence is why the candidate inbox can show a sketch that has not published:
// if a stance could only be spoken after canonization there would be nothing for
// the crossing to read, and the deferred gate would have deferred to nobody.
//
// ── WHO MAY SPEAK ────────────────────────────────────────────────────────────
//
// "The ground's holder speaks." A mark with extent IS ground, so the speakers for
// an incoming mark are the holders of every already-standing mark whose extent it
// overlaps — precedent weighs in on the newcomer, never the reverse. Overlap, not
// containment: that is `intersection-keyed`, and the engine's own `overlapArea`
// is what answers it, read at a ref rather than re-implemented here.
//
// ── NEUTRAL HAS NO ARGUMENT, DELIBERATELY ────────────────────────────────────
//
// There are two stances and there is no third. Returning to neutral has no
// grammar today and that is the law's own consequence, not an omission: a row
// meaning "no opinion" would BE a stored neutral, and neutral is absence. A
// resident revises by declaring the other word; latest wins.
//
// ── THE CANDIDATE SET IS DERIVED, NEVER STORED ───────────────────────────────
//
// No subscriptions, no inbox table, no fan-out. A candidate is computed at read
// time from geometry plus the store: the marks you hold, the marks that overlap
// them and postdate them, minus the ones you have already spoken about. That is
// O(k·m) over declarations where k is the handful of marks a household holds —
// the read-side cost the ladder's §0 certainty ruling explicitly permits ("the
// engine's `childrenByGeometry` at the read — O(k·m) client-side over
// declarations, no fold"), and emphatically not a fold.
//
// Env: WORLD_SINGLE_LOG=1. A stance door with no journal has no write path at
// all, so the write bounces by name when the flag is off; the reads degrade to
// canon-only rather than failing.

import { singleLogEnabled } from "./dynamic-store.mjs";
import { WORLD_CLONE } from "./world-store.mjs"; // the standing-scoped inbox door defaults to the office's own world checkout
import { worldFreezeBounce } from "./freeze.mjs";
import { appendActFlipped, appendJournal, laneFlipped } from "./world-journal.mjs";
// `stanceQuery` is the stance read's OWN credential (`stance_reader`), and the
// only place in `src/` that is not `office_api`. It lives beside `actsQuery` so
// the office learns "pool" once per table — see world2-acts.mjs § THE STANCE
// READ'S OWN CREDENTIAL.
import { stanceQuery } from "./world2-acts.mjs";
import { mainRef, materializeAtRef, publishedState, resolvedWorldHousehold } from "./world-branches.mjs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";

// ── THE TEACHING LINE (walk #1 item 4 · walk #2, 2026-09-05/06) ─────────────
//
// WHAT A RESIDENT ASKED, twice, in their own words:
//
//   "The law line says 'A stance is a revisable word on an edge — welcomed or
//    opposed, latest wins; neutral is never stored.' It does NOT say what my
//    'opposed' would DO to a mark the town has already published, nor why I was
//    not asked when it was laid. … 'welcomed or opposed' on a done thing feels
//    like a survey."
//
// The `law:` line below has always been right and has never been enough: it
// says what a stance IS, and the question is what one DOES. So the read now
// carries a second block that answers it out of the record.
//
// READ, NEVER TYPED. `the-town/the-media`'s doctrine, applied here: "Ids only.
// The sentences live in the record and arrive by read" (household-media.mjs
// § the three marks this door stands on). A sentence typed into this file is a
// copy nothing keeps honest — the exact class the 2026-08-31 civic-quarter lane
// found on a page. So the two sentences are SLICED OUT of the world checkout's
// own `LOGOS/the-response-function.md` at read time, by anchors that either
// match or say plainly that they did not.
//
// NO SECOND STAMP. The brief for this lane asked for the sha of the world pin
// beside the quote. It is deliberately absent: the office's world checkout
// already reports which version it read at the world reads (and Lane A is this
// week fixing exactly the case where a fresh stamp sat on a stale answer), and
// a second stamp minted here would be a second answer to "which world is this"
// — one stamp for one answer. The block names the FILE; the checkout names the
// version.
const RESPONSE_FUNCTION_FILE = join("LOGOS", "the-response-function.md");
// The two anchors, and both are load-bearing sentences of the law rather than
// convenient landmarks: the first is what `opposed` DOES, the second is what
// standing under an unanswered word costs you (nothing).
const RESPONSE_ANCHORS = Object.freeze([
  { key: "opposed", from: "opposed — the veto:", to: "\n" },
  { key: "neutral_and_revisable", from: "the default is neutral-and-revisable:", to: "Nothing blocks; nothing is lost." },
  // THE HALF THAT MAKES THE GAP A PAIR RATHER THAN A SILENCE (fresh reviewer,
  // 2026-09-07). The response function does not merely fail to speak about a
  // word declared after publication — it says the resident's word is safe
  // WHENEVER it arrives, which pulls directly against the late welcome's
  // "before the publish". Two sentences that disagree are an UNRULED PAIR, and
  // conflict-matrix.md's last section names exactly that shape.
  { key: "any_latency", from: "this is safe at any latency", to: "Nothing blocks; nothing is lost." },
]);

// ── UNWRAP BEFORE YOU SEARCH ────────────────────────────────────────────────
//
// `the-response-function.md` is hand-wrapped prose, and both sentences this
// door quotes straddle a line break in the file today. An anchor matched
// against the raw bytes therefore depends on where the author's editor happened
// to break the line — the falsifier's fixture wrapped one of them one word
// earlier than the live file does and the anchor missed, which is the whole
// class in miniature: a quote whose retrieval depends on typography is a quote
// that silently stops being served the next time somebody reflows a paragraph.
//
// So the file is normalized FIRST and the anchors are matched against the
// normalized text: emphasis dropped (a reader hears none), wrapped lines
// rejoined, and a line that begins a new bullet or heading left as its own line
// so the three tri-state bullets stay three sentences and not one.
const unwrap = (text) => text
  .replace(/\*\*/g, "")
  .replace(/\r\n/g, "\n")
  .replace(/([^\n])\n(?![\n\-#*])[ \t]*/g, "$1 ")
  .replace(/^[ \t]*-[ \t]+/gm, "");
// The two marks whose bodies bound the answer. `the-late-welcome` is the one
// that says where the law STOPS, which is the honest half of the teaching.
export const STANCE_LAW_MARK = "the-town/declare-stance-on";
export const LATE_WELCOME_MARK = "the-town/the-late-welcome";

const TEACH_CACHE = new Map();

/** Markdown emphasis stripped, whitespace folded — the sentence as a reader hears it. */
const plain = (s) => s.replace(/\*\*/g, "").replace(/\s+/g, " ").trim();

/**
 * The response function's own two sentences, sliced out of the file at `repo`.
 *
 * Returns `{ says, and, from }`, or `{ unresolved }` — never a paraphrase. If
 * the file moves, is rewritten, or loses an anchor, this says so and the door
 * teaches one sentence less. That is strictly better than teaching a sentence
 * the record no longer contains.
 */
export function responseFunctionSays(repo = WORLD_CLONE) {
  const path = join(repo, RESPONSE_FUNCTION_FILE);
  let key;
  try { const s = statSync(path); key = `${s.mtimeMs}|${s.size}`; }
  catch { return { unresolved: `the world checkout carries no ${RESPONSE_FUNCTION_FILE.replace(/\\/g, "/")} — the law stands in the record either way` }; }
  const hit = TEACH_CACHE.get(path);
  if (hit && hit.key === key) return hit.out;

  let text;
  try { text = unwrap(readFileSync(path, "utf8")); }
  catch { return { unresolved: `${RESPONSE_FUNCTION_FILE.replace(/\\/g, "/")} could not be read from the world checkout` }; }

  const found = {};
  const missing = [];
  for (const a of RESPONSE_ANCHORS) {
    const start = text.indexOf(a.from);
    if (start < 0) { missing.push(a.key); continue; }
    const end = text.indexOf(a.to, start + a.from.length);
    if (end < 0) { missing.push(a.key); continue; }
    // The line-terminated anchor stops AT the break; the sentence-terminated one
    // keeps the sentence that ends it.
    found[a.key] = plain(text.slice(start, a.to === "\n" ? end : end + a.to.length));
  }
  const out = missing.length === RESPONSE_ANCHORS.length
    ? { unresolved: `${RESPONSE_FUNCTION_FILE.replace(/\\/g, "/")} no longer carries the sentences this door quotes (${missing.join(", ")}) — it was rewritten, and this door will not paraphrase what it can no longer read` }
    : {
        ...(found.opposed ? { what_opposed_does: found.opposed } : {}),
        ...(found.neutral_and_revisable ? { until_you_speak: found.neutral_and_revisable } : {}),
        // Not a field of the answer — the unruled-pair sentence quotes it, and
        // it rides here so that block reads it from the same slice rather than
        // opening the file a second time. A key added to RESPONSE_ANCHORS and
        // not to this mapping is silently dropped, which is how the first draft
        // of the pair sentence quoted only one of its two halves.
        ...(found.any_latency ? { any_latency: found.any_latency } : {}),
        from: RESPONSE_FUNCTION_FILE.replace(/\\/g, "/"),
        ...(missing.length ? { unquoted: missing } : {}),
      };
  TEACH_CACHE.set(path, { key, out });
  return out;
}

/**
 * The teaching block the stances read carries.
 *
 * ⚠ AND THE HALF THAT IS AN HONEST GAP. The law's window on a late word ENDS AT
 * THE PUBLISH — `the-town/the-late-welcome`, verbatim from the record: "A stance
 * may arrive after the sketch and before the publish; the ledger keeps who was
 * first." Nothing in `LOGOS/` says what a word declared AFTER a mark is
 * published does to the published mark, and the resident who asked was asking
 * exactly that (a home was laid on their terrace on 09-01, published, and the
 * doorstep asked for their stance on 09-05). The brief for this lane said: if
 * the law does not say, the teach line says THAT. It says that. It is Lane D's
 * to rule, not this door's to invent.
 */
export function stanceTeach(repo = WORLD_CLONE, { lateWelcome = null } = {}) {
  const said = responseFunctionSays(repo);
  return {
    ...said,
    after_it_is_published: {
      // The mark's body as the record holds it, handed in from the set
      // `stanceInbox` has already loaded — one `find` over an array in memory,
      // never a second read of the world. NO TYPED FALLBACK: a sentence this
      // door could not read is reported as unread, because a hard-coded twin
      // would be right until the day the record changed and wrong silently
      // after it.
      ...(lateWelcome
        ? { the_law_reaches: lateWelcome }
        : { the_law_reaches: null, unresolved: `${LATE_WELCOME_MARK} could not be read from this world checkout — the law stands in the record either way` }),
      law_mark: LATE_WELCOME_MARK,
      // ⚠ NOT A SILENCE — AN UNRULED PAIR, and the difference is the whole
      // correction (fresh reviewer, 2026-09-07). The record does not fall quiet
      // here; it says two things that pull against each other, and
      // conflict-matrix.md's last section names that shape: "Where two claims
      // collide in a shape no law yet covers, the collision is refused noisily
      // and named — never resolved by silent default. An unruled pair is a
      // finding for the founders' desk." So the door names BOTH sentences,
      // sliced from the files like every other quote in this block, and calls
      // the thing by the law's own word rather than by my summary of it.
      unruled: [
        "these two sentences pull against each other, and the record has not ruled between them.",
        said.any_latency
          ? `The response function says: "${said.any_latency}"`
          : "The response function's latency clause could not be read from this checkout.",
        lateWelcome
          ? `And ${LATE_WELCOME_MARK} says: "${lateWelcome}"`
          : `And ${LATE_WELCOME_MARK} could not be read from this checkout.`,
        "The first says your word is safe whenever it arrives; the second gives it a window that closes at the publish. That is an UNRULED PAIR in the town's own sense — a finding for the founders' desk, never a default this door may pick. So a stance you speak on something already standing is your word on the record, revisable, and this door will not tell you it undoes anything.",
      ].join(" "),
    },
    law_mark: STANCE_LAW_MARK,
  };
}

/** The journal class for a resident's word. The single log's first new verb. */
export const CLASS_STANCE = "stance";
export const ACTION_STANCE = "declare-stance-on";

/** The two words, and there is no third — see the header. */
export const STANCES = Object.freeze(["welcomed", "opposed"]);

/** The ambient block's size, per the founder-blessed exposure model: "first ~3 candidates, newest first". */
export const AMBIENT_CAP = 3;
/** The shadow read's page size. A cursor, not a feed. */
export const PAGE_SIZE = 20;

const bounce = (code, defect, hint) => { const e = new Error(defect); Object.assign(e, { code, defect, hint }); return e; };

// ── the engine's geometry, read at a ref ─────────────────────────────────────
//
// `rect` and `overlapArea` are the world's own, and the fold itself decides
// ground contests with `overlapArea(...) > 0` ("intersection-only; densities
// compared region by region"). Re-implementing a rectangle intersection here
// would be a second geometry for one question — the drift this office keeps
// nailing shut. Null when the engine cannot be read, and every caller treats
// null as "cannot answer" rather than "no overlap".
let _geom = null;
export async function stanceGeometry(repo) {
  if (_geom?.repo === repo) return _geom.mod;
  try {
    const dir = materializeAtRef(repo, mainRef(repo), "tools");
    const g = await import(pathToFileURL(join(dir, "tools", "geometry.mjs")));
    if (typeof g.overlapArea !== "function" || typeof g.rect !== "function") return null;
    _geom = { repo, mod: g };
    return g;
  } catch { return null; }
}

/** Drop the cached engine read — for tests that rewrite a clone in place. */
export function resetStanceGeometry() { _geom = null; }

// ── the pure half ────────────────────────────────────────────────────────────

/**
 * PRECEDENCE. "Precedent weighs in on the newcomer, never the reverse."
 *
 * A mark's `date` is what the record carries and what the door stamps, so it is
 * the ordering. The id breaks a tie deterministically rather than letting two
 * marks declared in the same millisecond each claim to be the newcomer — a
 * coin-flip here would make the speaker set depend on read order.
 */
export function standsBefore(ground, incoming) {
  const a = Date.parse(ground?.date ?? "") || 0;
  const b = Date.parse(incoming?.date ?? "") || 0;
  if (a !== b) return a < b;
  return String(ground?.id ?? "") < String(incoming?.id ?? "");
}

/**
 * WHO MAY SPEAK ABOUT THIS MARK — the ground it landed on, and whose it is.
 *
 * Pure: marks in, holders out. `overlaps` is injected (the engine's, above) so
 * the decision can be falsified without a clone.
 *
 * A mark is never its own ground: an author does not consent to their own
 * declaration, and without this a resident could welcome themselves onto
 * anybody's parcel by overlapping their own earlier mark.
 */
export function groundFor(incoming, marks, overlaps) {
  if (!incoming?.at || !incoming?.extent) return [];
  return (marks ?? [])
    .filter((g) => g?.id && g.id !== incoming.id
      && g.by !== incoming.by
      && g.at && g.extent
      && standsBefore(g, incoming)
      && overlaps(g, incoming))
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

/**
 * THE CANDIDATE INBOX, folded. Pure.
 *
 * `mine` is the marks this caller holds; `all` is every mark the caller may see
 * (canon plus the sketches touching their own ground — see the header on
 * the-late-welcome); `spoken` is the set of ids this caller has already given a
 * current word to. A candidate is an incoming mark that overlaps ground of mine
 * which stands before it, and which I have not answered.
 *
 * Newest first, because that is what the exposure model asks the ambient block
 * for and there is no reason for the two orders to differ.
 */
export function candidatesFrom({ mine = [], all = [], spoken = new Set(), overlaps }) {
  const mineById = new Map(mine.map((m) => [m.id, m]));
  const out = [];
  for (const incoming of all) {
    if (!incoming?.id || mineById.has(incoming.id)) continue;
    if (spoken.has(incoming.id)) continue;
    const ground = groundFor(incoming, mine, overlaps);
    if (!ground.length) continue;
    out.push({
      mark: incoming.id,
      by: incoming.by,
      kind: incoming.kind ?? null,
      at: incoming.at ?? null,
      extent: incoming.extent ?? null,
      date: incoming.date ?? null,
      body: incoming.body ?? "",
      published: incoming.published !== false,
      // WHICH of your marks makes you a speaker. Without it a resident is told
      // to judge something with no way to see why it is theirs to judge.
      on_your_ground: ground.map((g) => g.id),
    });
  }
  out.sort((a, b) => (a.date === b.date
    ? String(a.mark).localeCompare(String(b.mark))
    : String(b.date ?? "").localeCompare(String(a.date ?? ""))));
  return out;
}

/**
 * LATEST WINS, folded from the log. Pure.
 *
 * Rows in seq order, last word per (speaker, object) standing. There is no
 * tombstone to skip because there is no neutral row to write — absence is the
 * third state and it is expressed by never appearing here.
 *
 * ── "LATEST" IS NOW READ, NOT ASSUMED (G1 lane 3b, 2026-09-08) ──────────────
 *
 * This used to fold by overwriting a Map in the caller's order — whatever row
 * came last won — and to sort its answer by `seq` descending. Both were correct
 * exactly while one numbering existed. `stanceRows` now merges the register with
 * the 1.0 halves, and `acts.id` is a different sequence from `journal.seq`
 * (4,000s against 1,000s), so a caller handing rows in any order at all could
 * make a 2026-09-02 declaration outrank a 2026-09-08 one purely on the size of
 * its id.
 *
 * So the fold COMPARES the instant instead of trusting arrival order, and the
 * answer is ordered by instant with seq only as a tiebreak within one instant.
 * A pure function that silently depends on its caller's sort is a contract
 * written nowhere; this one now holds whatever order it is handed.
 */
const laterStance = (a, b) => {
  if (!a) return true;
  const ai = String(a.written_at ?? ""), bi = String(b.written_at ?? "");
  if (ai !== bi) return bi > ai;
  return Number(b.seq ?? 0) >= Number(a.seq ?? 0);
};

export function standingStances(rows, { by = null } = {}) {
  const latest = new Map();
  for (const r of rows) {
    if (r.class !== CLASS_STANCE || !r.object) continue;
    if (by && r.actor !== by) continue;
    const k = `${r.actor} ${r.object}`;
    if (laterStance(latest.get(k), r)) latest.set(k, r);
  }
  return [...latest.values()]
    .map((r) => ({
      on: r.object,
      stance: r.payload?.stance ?? null,
      by: r.actor,
      at: r.written_at,
      crossing: r.crossing,
      seq: r.seq,
    }))
    .sort((a, b) => (String(a.at) === String(b.at) ? b.seq - a.seq : (String(a.at) < String(b.at) ? 1 : -1)));
}

// ── reading the world this door needs ────────────────────────────────────────

// ── THE NARROW READ'S COLUMN LIST (POS-195, 2026-09-22) ─────────────────────
//
// `claims.body` IS DELIBERATELY ABSENT, and its absence is the security
// property this whole lane is built on. `stance_reader` HOLDS `SELECT` on the
// table — 023's policy is `USING (true)`, because "overlaps ground you hold" is
// the world engine's answer and not a predicate this table can state — so the
// narrowing has to live somewhere the store cannot do it, and this is where.
// A draft's text is never fetched, so no downstream caller can re-expose it by
// forgetting a filter, and no future field added to a shared shaper can carry it
// along. Add a column here and you are widening a carve; 023's header says so
// and `falsifier-draft-privacy.mjs § the stance carve` reds if you do.
//
// EVERY FIELD IS `claims`' OWN. There is no join: `at` and `extent` are keys of
// the row's `geometry` jsonb, `kind` and `date` keys of its `data` spill, which
// is why 023 grants SELECT on one table and names no other.
//
// `stake` is NOT read. "Weight" in the ruling is the mark's EXTENT — the ground
// it covers, which is what `groundFor` weighs — and no stance arm has ever
// carried a stake. An unread column would be a widening bought for nothing.
const STANCE_CLAIM_SELECT = `
  SELECT slug,
         claimant,
         status,
         geometry -> 'at'      AS at,
         geometry -> 'extent'  AS extent,
         data ->> 'kind'       AS kind,
         data ->> 'date'       AS date,
         data ->> 'by'         AS declared_by
    FROM claims
   WHERE status = ANY($1)
   ORDER BY slug`;

// The same two statuses `guard-reads.mjs § LIVE_STATUSES` reads, spelled here
// rather than imported: `world2/tools/` is the port's own tree and `src/` does
// not reach into it. `held_review` is excluded for the reason that file records
// under "Unruled, and teed rather than guessed" — it has no 1.0 counterpart and
// there are zero rows of it today.
const LIVE_CLAIM_STATUSES = Object.freeze(["draft", "pending"]);

/**
 * One `claims` row → the candidate record the stance arms read.
 *
 * `published: false` is TOLD, not assumed, exactly as the 1.0 arm told it: a row
 * in `claims` at draft or pending has not been through a settlement, so it is
 * not canon. Canon overwrites these by id in `worldForStances`.
 *
 * `by` is the DECLARED author, falling back to the claimant column and then to
 * the id's own first segment — 1.0's own derivation (`p.by ?? id.split("/")[0]`),
 * kept because `groundFor` refuses a mark as its own ground on this field and a
 * wrong answer there would let a resident welcome themselves onto their own
 * parcel.
 */
function stanceCandidateOf(row) {
  const id = row?.slug;
  if (!id) return null;
  return {
    id,
    by: row.declared_by ?? row.claimant ?? String(id).split("/")[0],
    kind: row.kind ?? null,
    at: row.at ?? null,
    extent: row.extent ?? null,
    date: row.date ?? null,
    // ⚠ NOT `row.body`. There is no `row.body` — see § THE NARROW READ'S COLUMN
    // LIST. The empty string keeps `candidatesFrom`'s shape unchanged for every
    // caller; `ambientLine` omits the key rather than publishing an empty
    // sentence.
    body: "",
    published: false,
  };
}

/**
 * The marks a caller may weigh in about, and the ones they hold.
 *
 * Canon is `publishedState` (one cached JSON read at a ref). The live layer is
 * the store's own live claims across households — and that is the ONE place a
 * sketch becomes visible to somebody who did not write it. It is narrow by
 * construction: `candidatesFrom` only ever surfaces a mark that overlaps ground
 * the caller already holds, so nobody learns about a sketch anywhere else in
 * town. The-late-welcome is what asks for it ("a stance may arrive after the
 * sketch and before the publish"), and without it the crossing would have no
 * stance to read when it judges.
 */
// ── THE NARROW 2.0 READ, BUILT (POS-195 / DEC-14, RULING 2, 2026-09-22) ──────
//
// This arm read the sqlite journal until 2026-09-22. It now reads the store,
// through `stance_reader` — a credential that exists for this one function.
//
// WHAT WAS IN THE WAY, and why the port needed a migration rather than a wire.
// DEC-14 (runbook, ruled 2026-09-03) gave this list "its own narrow 2.0 read
// that may see overlapping drafts across households" and judged it "blocks
// nothing today". G1 removes the journal INSERT that was this arm's source, and
// G1 comes before G2, so that note stopped being true. The 2026-09-22
// measurement then found the road right and the PERMISSION absent: a private
// draft's only row in the store is `claims` at status 'draft', 007's
// `claims_read` binds PUBLIC with no `TO` clause, RLS is ENABLE so only
// `world2_owner` escapes it, 002 bars that role from runtime, and there is no
// `SECURITY DEFINER` and no `BYPASSRLS` anywhere in `world2/`. Not unwired —
// unrepresentable. RULING 2 made the law; `world2/schema/023_stance_reader.sql`
// is it, and that file's header carries the argument.
//
// ── THE BODY IS NOT FETCHED, WHICH IS STRONGER THAN NOT RETURNED ────────────
//
// The ruling: "the derivation's OUTPUT carries what the 1.0 read carries today
// — a candidate's existence, standing and weight — never a draft's body."
//
// ⚠ MEASURED, AND IT IS A BEHAVIOUR CHANGE, NOT A PRESERVATION. The 1.0 read
// DID carry the body: `candidatesFrom` copied `body` onto every candidate, tier
// 2 published a 120-character excerpt as `says`, and tier 3's page carried the
// body WHOLE and untruncated. So a resident could read another household's
// unstaked sketch, in full, at `read: "declare-stance-on"`. The ruling's own
// apposition reads that as already-narrow and it was not. Reported to Wright as
// this lane's STOP; built the way the ruling's operative clause says, because
// "never a draft's body" is the half a falsifier can hold and the half the
// sentinel test asserts.
//
// `stanceQuery`'s column list does not include `claims.body`. The draft's text
// is not filtered out downstream — it is never read out of the store, so there
// is no path by which a future caller re-exposes it by forgetting a filter.
// A CANON mark keeps its body: it is published, every resident may read it, and
// the teaching block (`lateWelcome`) is one of those bodies.
//
// ── ABSENT CREDENTIAL IS `unreachable`, NEVER THE JOURNAL ───────────────────
//
// There is no fallback arm. `WORLD2_STANCE_URL` unset, or a store that will not
// answer, returns `{ unreachable }` and every tier says so — `stanceInbox` turns
// it into its own `unavailable`, which tiers 1, 2 and 3 already render. A read
// that answered `[]` instead would tell a resident nothing awaits their word
// while a sketch sat on their ground, which is the exact failure the-late-welcome
// exists to prevent.
export async function worldForStances(repo, { dbPath: _dbPath = null, env = process.env } = {}) {
  const canon = publishedState(repo).state?.marks ?? [];
  const answer = await stanceQuery(STANCE_CLAIM_SELECT, [LIVE_CLAIM_STATUSES], env);
  if (answer.unreachable) return { unreachable: answer.unreachable };

  const live = answer.rows
    .map(stanceCandidateOf)
    .filter((m) => m && m.at && m.extent);

  // Canon wins an id collision: a drained draft is in both, and the published
  // copy is the one everybody else can see.
  const byId = new Map();
  for (const m of live) byId.set(m.id, m);
  for (const m of canon) if (m?.id) byId.set(m.id, { ...m, published: true });
  return { marks: [...byId.values()] };
}

// ── A STANCE OUTLIVES THE WINDOW IT WAS SPOKEN IN (postmark#2454, 2026-09-04) ──
//
// The crossing-save drains the live journal into `STATE/log/<n>.journal.jsonl`
// and truncates it. This read used to fold the live journal ALONE, so every
// stance vanished from `standing` the moment its window closed and the mark
// went back to `stances_awaiting` — lupi's seq 920 (crossing 167) was declared,
// read back, and "gone the next morning" while the act sat safe in the record
// and in the photograph. Absence is the third state; a drain is not absence.
//
// So the rows are the photographs ∪ the live journal, merged by seq — the same
// union the reverse-parity falsifier calls the record. Photographs are read
// from the world checkout the drain writes into (WORLD_CLONE by default; the
// caller's repo in tests) and cached per file by size+mtime, because a window
// once written is only ever rewritten by the drain itself. At cutover this
// read moves to the acts record (G2); until then the mirror + the photographs
// ARE the record on 1.0.
const PHOTO_CACHE = new Map(); // path → { key, rows }
function photographStanceRows(worldClone) {
  const dir = join(worldClone, "STATE", "log");
  if (!existsSync(dir)) return [];
  const out = [];
  let names;
  try { names = readdirSync(dir).filter((n) => /^\d+\.journal\.jsonl$/.test(n)); } catch { return []; }
  for (const name of names) {
    const path = join(dir, name);
    let st; try { st = statSync(path); } catch { continue; }
    const key = `${st.size}:${st.mtimeMs}`;
    const hit = PHOTO_CACHE.get(path);
    if (hit && hit.key === key) { out.push(...hit.rows); continue; }
    const rows = [];
    let text; try { text = readFileSync(path, "utf8"); } catch { continue; }
    for (const raw of text.split("\n")) {
      const line = raw.trim();
      if (!line || !line.includes('"class":"stance"')) continue;
      try {
        const l = JSON.parse(line);
        if (l?.class !== CLASS_STANCE || !Number.isFinite(l?.seq)) continue;
        // the photograph keeps the journal's own vocabulary (`type`, `at`);
        // the read speaks hydrateRow's (`action`, `written_at`) — one shape out
        rows.push({
          seq: Number(l.seq), crossing: l.crossing == null ? null : Number(l.crossing),
          actor: l.actor, action: l.type ?? l.action ?? null, object: l.object ?? null,
          class: l.class, payload: l.payload ?? null, household: l.household ?? null,
          written_at: l.at ?? l.written_at ?? null, photograph: name,
        });
      } catch { /* a bent line is not a reason to lose the window */ }
    }
    PHOTO_CACHE.set(path, { key, rows });
    out.push(...rows);
  }
  return out;
}

// ── THE READ MOVES TO THE REGISTER (G1 lane 3b, 2026-09-08) ─────────────────
//
// The comment above this function used to end "At cutover this read moves to
// the acts record (G2); until then the mirror + the photographs ARE the record
// on 1.0." This is that move, pulled forward, because G1 cannot ship without it.
//
// THE DEFECT IT CLOSES, and it is #2454 wearing a different coat. Both of the
// old union's halves die at the store cutover: the drain stops writing
// `STATE/log/<n>.journal.jsonl` (there is no drain), and the sqlite journal
// stops being the pen. So on the first store crossing this read would answer
// `[]` for a town with live stances, every `standing` stance would go back to
// `stances_awaiting`, and the door would show a world in which the declaration
// never happened — which is the exact sentence #2454 was written to make false.
//
// AND THE MERGE KEY HAD TO CHANGE, WHICH IS NOT A DETAIL. The old union merged
// by `seq`, which was sound while both halves carried the SAME numbering: a
// photograph line and a live journal row for one act share the journal's seq.
// The register does not. `acts.id` is its own sequence (in the 4,000s where the
// journal is in the 1,000s) and `acts.journal_seq` is null for 4,483 of 4,689
// rows, so a seq-keyed union would have carried EVERY act twice — once under
// its journal seq and once under its act id — and `standingStances` would then
// have picked whichever copy happened to be last. The key is the twin key
// `(actor, action, object, written_at)`, which is `falsifier-pen-flip`'s own
// (`twinKey`) and the only thing that names one act across two numberings.
//
// A stance is safe under that key where a MARK would not be: Phase 5.6's
// deferral moves an unstaked declaration's instant, and only marks are deferred
// (`world-journal.mjs § privateDraftAct` is `CLASS_MARK` + leave-mark/amend).
// Measured 2026-09-08: 29 stance lines in the photograph, 28 in the register,
// and the one extra is a genuine duplicate — seq 1084 and 1123 are lupi's same
// declaration at the same instant, written twice. The twin key collapses it,
// which is the register being right.
//
// THE REGISTER IS PREFERRED, NOT EXCLUSIVE. It is the copy that survives the
// cutover, so where both hold an act the register's row is the one kept. But a
// register that cannot be reached must not empty the town: `actsQuery` answers
// `null` for "not asked" and an array for "asked", and only the array is
// allowed to be the whole answer.

/** One act, across two numberings. `falsifier-pen-flip.twinKey`'s own key — the only thing that names an act in both the journal's sequence and the register's. */
const stanceTwinKey = (r) =>
  JSON.stringify([String(r.actor), String(r.action), r.object == null ? null : String(r.object), String(r.written_at)]);

/** A register row in `hydrateRow`'s vocabulary, so one shape leaves this function whichever source produced it. */
function stanceRowFromAct(a) {
  return {
    seq: Number(a.id),
    crossing: a.crossing == null ? null : Number(a.crossing),
    actor: a.actor,
    action: a.action,
    object: a.object ?? null,
    at: { anchor: a.at_anchor ?? null, dx: a.at_dx ?? null, dy: a.at_dy ?? null },
    witnesses: a.witnesses ?? null,
    class: a.class,
    payload: a.payload ?? null,
    effect: a.effect ?? null,
    household: a.household ?? null,
    written_at: a.at instanceof Date ? a.at.toISOString() : String(a.at),
    register: true,   // which side answered, so a caller can say so rather than infer it
  };
}

/**
 * Every stance row in the record: the REGISTER, plus the drained photographs
 * beside it, merged by the twin key. Empty (never a throw) when neither can be
 * read.
 *
 * ASYNC as of this change, because the register is. There is exactly one caller
 * (`stanceInbox`, already async) and it awaits — a second synchronous copy of
 * this read is how the two would come to disagree about who is standing.
 *
 * ── THE SQLITE ARM IS GONE (G1 / POS-156, 2026-09-22) ──────────────────────
 *
 * This merged THREE sources: the photographs ∪ the live sqlite journal ∪ the
 * register, register last so it wins. The middle one is deleted with the
 * journal INSERT, and deleting it CHANGES NO ANSWER — which is why it is a
 * deletion rather than a port. POS-156's measurement put it plainly: "the
 * register arm holds the same acts and already overwrites the sqlite arm
 * wherever both hold one."
 *
 * The photographs stay, and they are not the same thing. `<n>.journal.jsonl`
 * is the DRAINED history in the world repo, written by the crossing-save, and
 * it is the reason a stance outlives the window it was spoken in (postmark#2454
 * — lupi's seq 920, declared, read back, and "gone the next morning" when this
 * read folded the live journal alone). Absence is the third state; a drain is
 * not absence, and neither is a deletion.
 */
export async function stanceRows({ dbPath = null, worldClone = WORLD_CLONE, acts = null } = {}) {
  const byTwin = new Map();

  // The photographs first, so the register's copy overwrites them where both
  // hold the act. Order is the preference, and it is stated here rather than
  // left to whichever loop happens to run last.
  if (singleLogEnabled()) {
    for (const r of photographStanceRows(worldClone)) byTwin.set(stanceTwinKey(r), r);
  }

  let rows = acts;
  if (rows == null) {
    try {
      const { actsQuery } = await import("./world2-acts.mjs");
      rows = await actsQuery(
        "SELECT id, at, crossing, actor, action, object, at_anchor, at_dx, at_dy,"
        + " witnesses, class, payload, effect, household FROM acts WHERE class = $1 ORDER BY id",
        [CLASS_STANCE]);
    } catch { rows = null; /* the register is unreachable — `null`, not `[]`; see actsQuery */ }
  }
  if (Array.isArray(rows)) for (const a of rows) {
    const r = stanceRowFromAct(a);
    byTwin.set(stanceTwinKey(r), r);
  }

  // SORTED BY THE INSTANT, not by seq. `standingStances` folds "latest wins" out
  // of this order, and seq stopped being comparable the moment two numberings
  // arrived in one list — a 1.0 row at seq 1,340 would have sorted BELOW every
  // register row at id 4,700 and lost every contest regardless of when it was
  // spoken. The instant is the one thing both sides mean the same way.
  return [...byTwin.values()].sort((a, b) => {
    const ai = String(a.written_at), bi = String(b.written_at);
    return ai === bi ? a.seq - b.seq : (ai < bi ? -1 : 1);
  });
}

/** The handles a key acts for — whose marks are "mine". */
const handlesOf = (key) => new Set([...(key?.handles ?? [])]);

/**
 * THE ONE DERIVATION every tier reads from. The integer, the ambient block and
 * the shadow are three renderings of this, never three computations of it.
 *
 * Never throws: a consent read that could take down the bare world read would
 * have bought a courtesy with the door itself. `unavailable` says which.
 */
export async function stanceInbox(repo, key, { dbPath = null } = {}) {
  const mineHandles = handlesOf(key);
  if (!mineHandles.size) return { candidates: [], standing: [], mine: [] };
  const geom = await stanceGeometry(repo);
  if (!geom) return { candidates: [], standing: [], mine: [], unavailable: "the world's own geometry could not be read — overlap is the engine's answer, never this door's" };
  const overlaps = (a, b) => geom.overlapArea(geom.rect(a), geom.rect(b)) > 0;

  // THE READ MAY BE UNREACHABLE, AND THAT IS SAID RATHER THAN ROUNDED TO ZERO.
  // `worldForStances` has no 1.0 arm to fall back on since POS-195; an office
  // without `WORLD2_STANCE_URL`, or a store that will not answer, hands back
  // `unreachable`. Answering `candidates: []` here would tell a resident nothing
  // awaits their word while a sketch sat on their ground — the-late-welcome's
  // own failure, arriving as a cheerful empty. It becomes this read's
  // `unavailable`, which all three tiers already render.
  const world = await worldForStances(repo, { dbPath });
  if (world.unreachable) return { candidates: [], standing: [], mine: [], unavailable: world.unreachable };
  const all = world.marks;
  const mine = all.filter((m) => mineHandles.has(m.by) && m.at && m.extent);
  const rows = await stanceRows({ dbPath, worldClone: repo });
  const standing = standingStances(rows).filter((s) => mineHandles.has(s.by));
  const spoken = new Set(standing.map((s) => s.on));

  return { candidates: candidatesFrom({ mine, all, spoken, overlaps }), standing, mine: mine.map((m) => m.id),
    // Carried for the set-down group (`stanceShadow`'s `setDowns`), which needs
    // the same world and the same stance rows — never a second read of either.
    // Nothing renders these two keys; the shadow names every field it answers.
    marks: all, stanceRows: rows,
    // The teaching block's one mark body, taken off the set this read already
    // holds — never a second read of the world for one sentence.
    lateWelcome: all.find((m) => m.id === LATE_WELCOME_MARK)?.body?.trim() || null };
}

// ── WHOSE GROUND THIS NUMBER COUNTED (walk #1 item 3, 2026-09-05) ───────────
//
// THE COMPLAINT, verbatim: "`household { read: "doorstep" }` says
// `stances_awaiting: 23`; `world { since: … }` for the same handle says
// `stances_awaiting: 45`. The world door is counting my household's ground
// (`on_your_ground: rei/the-lanternseed-gardens`), the household door only mine
// — but both say *stances_awaiting* and neither says whose ground it counted.
// … which number is my job?"
//
// BOTH NUMBERS WERE RIGHT. The bare world read counts `key.handles` — the whole
// house; the doorstep segment names one handle, because that page is about one
// person (doorstep-bundle.mjs § THE SUBJECT NOTE says so, to itself, and never
// to the reader). The defect was one name over two denominators.
//
// So every producer of the integer now says its scope beside it, in one field,
// in the shape the brief asked for: "household" or "resident:<handle>".
//
// ⚠ NOT SPELLED `ground`. `stanceShadow` has answered `ground:` since the door
// opened and it means something else there — the mark IDs your household holds.
// Two meanings under one key at one door is the exact confusion this field
// exists to end, so the name says what it qualifies: the number.
export const stancesGround = (handles) => {
  const held = [...new Set([...(handles ?? [])].filter(Boolean))].sort();
  return held.length === 1 ? `resident:${held[0]}` : "household";
};

// ── tier 1 + 2 · what rides the bare read ────────────────────────────────────

/**
 * One candidate, as the ambient block shows it: one line each.
 *
 * ── `says` IS OMITTED WHEN THERE IS NO BODY TO SAY (POS-195, 2026-09-22) ────
 *
 * Since the narrow 2.0 read, an UNPUBLISHED candidate carries no body — the
 * store read never fetches `claims.body` (world2-acts.mjs § stanceQuery's column
 * list), because a draft's text is its author's until submit. A published
 * candidate still carries its own, which every resident may read anyway.
 *
 * So this key is now absent rather than empty. `says: ""` would be a sentence
 * the door invented about a sketch it declined to read, and a resident cannot
 * tell that from a sketch whose author wrote nothing — the same distinction
 * `household-media` holds one door over ("an unread mark must not be given a
 * sentence"). Omit, do not negate: what a reader does not see, they do not have
 * to interpret.
 */
const ambientLine = (c) => ({
  mark: c.mark, by: c.by, at: c.at, date: c.date,
  on_your_ground: c.on_your_ground[0] ?? null,
  ...(c.body ? { says: c.body.length > 120 ? `${c.body.slice(0, 117)}…` : c.body } : {}),
  published: c.published,
});

/**
 * THE BARE READ'S CONSENT BLOCK — the founder-blessed exposure model, tiers 1
 * and 2, verbatim from `dev/door-plan/DESIGN.md § the two additions`:
 *
 *   "the bare read carries ONE INTEGER everywhere: `stances_awaiting: N`;
 *    on your own parcel, it expands to a compact ambient block (first ~3
 *    candidates, newest first)"
 *
 * So the integer is unconditional and the detail is not. `onOwnParcel` is the
 * caller's containment spine answering whether they are standing on their own
 * ground — ambient detail belongs where you live, and a market read never grows
 * it however many candidates are waiting.
 *
 * Returns null when the caller holds nothing, so a spread adds no key at all and
 * an anonymous read is byte-identical to what it was.
 */
export async function stancesBlock(repo, key, { spine = [], dbPath = null } = {}) {
  try {
    if (!handlesOf(key).size) return null;
    const inbox = await stanceInbox(repo, key, { dbPath });
    const ground = stancesGround(handlesOf(key));
    if (inbox.unavailable) return { stances_awaiting: 0, unavailable: inbox.unavailable };
    const n = inbox.candidates.length;
    const mine = new Set(inbox.mine);
    // YOUR OWN PARCEL, IN YOUR OWN SPINE. The spine is the containment chain the
    // bare read already computed; a mark of yours in it means you are standing
    // inside your own ground, which is the one place the model expands.
    const onOwnGround = (spine ?? []).some((m) => mine.has(m?.id));
    // ⚠ TIER 1 STAYS ONE INTEGER, and this lane does not get to change that.
    // dev/door-plan/DESIGN.md § the two additions is founder-blessed and
    // verbatim: "the bare read carries ONE INTEGER everywhere:
    // `stances_awaiting: N`". A market read that grew a second key would be
    // this lane overturning a ruling it was not given. The scope rides the two
    // tiers that already carry a block — which is where BOTH numbers the
    // resident compared actually came from (walk #1 item 3: the doorstep's 23
    // is tier 3, the world `since:` read's 45 is tier 2, both below).
    if (!onOwnGround || n === 0) return { stances_awaiting: n };
    return {
      stances_awaiting: n,
      stances_awaiting_ground: ground,
      awaiting: inbox.candidates.slice(0, AMBIENT_CAP).map(ambientLine),
      ...(n > AMBIENT_CAP ? { more: n - AMBIENT_CAP } : {}),
      // ⚑ TRUED 2026-09-02 (#2392). This sentence taught the WORLD door for
      // both halves, and BOTH were dead: the grant hangs on the `household`
      // class node, which nobody is and nothing sites, so neither the read nor
      // the act was ever afforded at a standpoint — a resident who followed
      // this line from their own parcel got a 422 naming coordinates
      // (null, null). What awaits your word is derived from what your house
      // HOLDS, so both halves live at the household door. This block still
      // rides the WORLD's bare read, which is right: the notice belongs where
      // you are standing even though the answering does not.
      how: `household { read: "stances" } for the whole inbox; household { do: "${ACTION_STANCE}", args: { on, stance: "welcomed"|"opposed" } } to speak — a stance is spoken from STANDING, not from a standpoint, so both live at the household door`,
    };
  } catch (e) {
    // The bare read answers without it rather than not at all.
    console.error(`[stance] the consent block tripped (${String(e?.message ?? e).slice(0, 160)}) — the read answers without it`);
    return null;
  }
}

// ── tier 3 · the verb's shadow ───────────────────────────────────────────────

/**
 * One candidate on the shadow's page.
 *
 * ── THIS TIER CARRIED THE BODY WHOLE (POS-195, 2026-09-22) ─────────────────
 *
 * Tier 2 truncated to 120 characters; this one published `body` UNTRUNCATED,
 * because it passed `candidatesFrom`'s records straight through. So the full
 * text of another household's unstaked sketch was readable at
 * `read: "declare-stance-on"` by anyone holding overlapping ground. That was
 * measured on the 1.0 arm and is the finding RULING 2's "never a draft's body"
 * settles.
 *
 * The store read no longer fetches a draft's body at all, so the key is empty
 * for every unpublished candidate and omitting it is the honest rendering — the
 * same reasoning as `ambientLine`, kept as its own function rather than shared,
 * because the two tiers spell the field differently (`says` against `body`) and
 * one shaper pretending otherwise is how a widening reaches two doors at once.
 */
const shadowLine = (c) => {
  if (c.body) return c;
  const { body: _withheld, ...rest } = c;
  return rest;
};

/**
 * THE FULL INBOX, cursor-paginated: "every candidate overlapping any mark you
 * hold (a mark with extent IS ground, so overlapping-precedent-holders are the
 * speakers), plus your standing stances."
 *
 * A cursor, not a feed — the same shape `world_say`'s `latest` and the apex's
 * `since:` already proved. The cursor is an opaque index into the derived,
 * newest-first order; a set that changes between pages simply changes, which is
 * what a derived inbox is.
 */
export async function stanceShadow(repo, key, { cursor = null, limit = PAGE_SIZE, dbPath = null, setDowns = false, setDownDeps = {} } = {}) {
  const inbox = await stanceInbox(repo, key, { dbPath });
  if (inbox.unavailable) return { unavailable: inbox.unavailable, stances_awaiting_ground: stancesGround(key?.handles), awaiting: [],
    ...(setDowns ? { set_downs_awaiting: [], set_downs_unavailable: "the world could not be read, so neither group of this read could be — this is not an answer that nothing waits" } : {}),
    standing: [] };

  const n = Math.max(1, Math.min(Number(limit) || PAGE_SIZE, 100));
  const start = Math.max(0, Number.parseInt(String(cursor ?? "0"), 10) || 0);
  const page = inbox.candidates.slice(start, start + n).map(shadowLine);
  const next = start + n < inbox.candidates.length ? String(start + n) : null;

  return {
    stances_awaiting: inbox.candidates.length,
    // WHOSE GROUND THAT NUMBER COUNTED — see § WHOSE GROUND THIS NUMBER COUNTED.
    stances_awaiting_ground: stancesGround(key?.handles),
    awaiting: page,
    cursor: next,
    // Said out loud rather than left to be inferred from a short page — the same
    // courtesy the presence read's `capped` pays.
    complete: next == null,
    // THE SECOND GROUP (POS-138, Keemin 2026-09-24: "yes, in the same stances
    // read"): another household has set down a thing your house made, and it
    // waits on your house's word. Opt-in, so only the reads that promise it
    // (the household's stances read and the doorstep's segment of it) pay its
    // store read; the world door's shadow and the two ground-set builders
    // (`since:`'s claim effects) answer exactly what they did.
    ...(setDowns ? await setDownsGroup(key, inbox, setDownDeps) : {}),
    standing: inbox.standing,
    ground: inbox.mine,
    law: "A stance is a revisable word on an edge — welcomed or opposed, latest wins; neutral is never stored, it is absence. The ground's holder speaks.",
    // WHAT THE LAW LINE SAYS A STANCE IS; WHAT `teach` SAYS IT DOES. Two
    // residents' walks asked the second question and this read only ever
    // answered the first — see § THE TEACHING LINE above.
    teach: stanceTeach(repo ?? WORLD_CLONE, { lateWelcome: inbox.lateWelcome ?? null }),
  };
}

// ── the fourth tier · the inbox WITHOUT a standpoint ─────────────────────────
//
// THE PROBLEM THE FOUNDER NAMED (2026-08-25): the shadow above is pull-only and
// STANDPOINT-DISCOVERED. `declare-stance-on` is granted by the `household`
// class node (WORLD/marks/…/entity/household), so the apex serves its read only
// where that grant is in your spine or reach — and measured against the live
// store, `world { read: "declare-stance-on", handle: "wright" }` bounces 422,
// "not an action anywhere in your view — nothing to read", while
// `stanceInbox` for that same resident holds NINETEEN candidates awaiting their
// word. Nothing tells them. A consent law nobody is told they are party to is
// a law with no door, which is the shape the town has ruled against before.
//
// SO THE INBOX GETS A STANDING-SCOPED DOOR, and this is the round-2 precedent
// applied, not a new idea: mail folded under `household` because a letter needs
// STANDING, never a standpoint. What awaits your word is the same shape — it is
// derived from what you HOLD (`stanceInbox` keys on `key.handles` and nothing
// else), never from where your feet are. The world's read is unchanged and
// stays what it is: what you find when standing on your own ground.
//
// ONE DERIVATION, TWO DOORS. This wraps `stanceShadow` and never re-implements
// it, exactly as the town apex names a flat verb rather than copying it.
//
// AND IT NEVER THROWS. The doorstep is the recommended first read of the day;
// a morning page that 500s because the world engine is mid-write would be a
// courtesy bought with the door itself. The catch lives HERE, in the one
// function both doors call, so the two can never disagree about what a
// degraded world looks like.
export async function stancesForHandles(handles, { cursor = null, limit = PAGE_SIZE, repo = null, dbPath = null, setDowns = false, setDownDeps = {} } = {}) {
  const set = new Set([...(handles ?? [])].filter(Boolean));
  try {
    const answer = await stanceShadow(repo ?? WORLD_CLONE, { handles: set }, { cursor, limit, dbPath, setDowns, setDownDeps });
    // An honest empty, said out loud rather than left as a bare zero — psaFold's
    // manners: "no entry landed inside the window" is a real state and not a
    // failure to read. A resident with nothing awaiting must be able to tell
    // that from a door that did not answer.
    // A waiting set-down is a word awaited too, so the note that says nothing
    // awaits is only true when BOTH groups are empty.
    if (!answer.unavailable && (answer.stances_awaiting ?? 0) === 0 && !(answer.set_downs_awaiting?.length))
      return { ...answer, note: "nothing awaits your word — no mark has been laid over ground you hold since you last spoke. This is an ordinary state, not a quiet failure." };
    return answer;
  } catch (e) {
    return {
      unavailable: `the consent inbox could not be read (${String(e?.message ?? e).slice(0, 160)})`,
      awaiting: [], standing: [],
    };
  }
}

/**
 * A READ NEVER PERFORMS.
 *
 * `read:` is `do:`'s sibling, not a second way to act — so an envelope carrying
 * the act's own field is refused BY NAME rather than quietly ignored. Ignoring
 * it is worse than bouncing: a resident who typed a stance into a read and got a
 * cheerful listing back has been told their word was recorded when it was not.
 *
 * It lives here rather than inline in the apex because the wording is this
 * verb's, and because a decision inside a switch arm is a decision no falsifier
 * can reach without building the whole door around it.
 */
export function readNeverPerforms(fields) {
  if (!fields?.stance) return null;
  return {
    error: "bounce", code: 422, defect: "a read never performs",
    // The door named here is the household's, for the same reason the ambient
    // block's `how` was trued (#2392): the world apex affords this act at no
    // standpoint, so telling a caller to re-send it there would be sending
    // them from one refusal to another.
    hint: `to speak, use do: — household { do: "${ACTION_STANCE}", args: { on: …, stance: "welcomed"|"opposed" } }, which is the door a stance is spoken from. read: only ever shows you what is waiting; household { read: "stances" } is the whole inbox.`,
  };
}

// ── the write ────────────────────────────────────────────────────────────────

/**
 * declare-stance-on — one row in the single log.
 *
 * The door RECORDS AND EXPOSES; it does not enforce. Per the-deferred-gate,
 * "placement, stance, and refusal are the crossing's work" — so nothing here
 * consults a fold, blocks a mark, or changes what anybody's world looks like.
 * It writes the word down with its witnesses and gets out of the way.
 */
// ── THE SET-DOWN ARM's two halves ────────────────────────────────────────────

/**
 * Is there a set-down of `thing` by ANOTHER household standing unanswered-or-
 * answered on the record — and a test for who may answer it. Never throws.
 *
 * Returns `{ speakerHouse }` always (the author's-household test, for the
 * caller), plus `drop` / `stood` when the latest holding act on the thing is a
 * drop by a household the town's record says is not the author's. A household
 * record that cannot be read is NOT a stranger's set-down — the arm opens only
 * on what it can prove, like the hold door's own ladder.
 *
 * `deps` (`readRows`, `householdOf`) are injectable so a falsifier drives this
 * with the rows and the household map it supplies.
 */
export async function setDownFor(thing, target, marks = [], deps = {}) {
  const hold = await import("./world-hold.mjs");
  let householdOf = deps.householdOf;
  if (householdOf === undefined) {
    try { ({ householdOf } = await import("./households.mjs")); } catch { householdOf = null; }
  }
  const madeBy = String(target?.by ?? String(thing).split("/")[0]);
  const speakerHouse = (h) => hold.sameHousehold(madeBy, String(h), householdOf).same;
  let rows;
  try {
    rows = deps.readRows ? await deps.readRows(thing)
      : await (await import("./world2-guards.mjs")).standsRowsFromStore(thing);
  } catch (e) { return { speakerHouse, unreadable: String(e?.message ?? e).slice(0, 160) }; }
  if (!rows) return { speakerHouse };
  if (hold.liveHolder(rows.attachments ?? [], String(thing))) return { speakerHouse }; // held, not set down
  const drop = hold.latestDrop(rows.journal ?? [], String(thing));
  if (!drop || drop.actor == null) return { speakerHouse };
  const setter = hold.sameHousehold(madeBy, String(drop.actor), householdOf);
  if (setter.same || setter.how !== "household") return { speakerHouse };
  const { composeAnchor } = await import("./world-journal.mjs");
  const centreOf = (id) => marks.find((m) => m.id === id)?.at ?? null;
  return { speakerHouse, drop, stood: composeAnchor(drop.at ?? {}, centreOf), householdOf, madeBy };
}

// ── THE SET-DOWNS WAITING ON YOUR HOUSE'S WORD (POS-138, the read) ──────────
//
// Keemin, 2026-09-24: an author's house must be told when another household
// has set down a thing it made, "in the same stances read". The answer exists
// already (#184: `declare-stance-on` on the thing, bound to the drop's act id);
// this is the read that tells the house there is something to answer.
//
// ONE READER. Whether a set-down is a stranger's is `setDownFor`'s question and
// whether the house has answered it is `setDownAnswer`'s; this group asks both
// and derives neither. The candidates are the things the scope's handles MADE
// that have a drop on the holding record (`world2-guards.mjs §
// setDownRowsForMakers`), so the read never asks about a thing the house did
// not make — which is also the privacy line: a house sees set-downs of its own
// residents' things and nobody else's.
//
// A SET-DOWN LEAVES THIS GROUP when the author's house has welcomed or opposed
// that drop (its stance then reads in `standing`, the way every stance the
// house has spoken does: `standingStances` keeps each speaker's latest word on
// each object, and a set-down's answer is a stance on the thing), or when the
// thing is picked up again (`setDownFor` reads a live holder as held, not set
// down). A later drop by somebody else is a new question, because an answer
// belongs to ONE drop.

/** The exact call that answers one waiting set-down. */
export const setDownAnswerCall = (thing) =>
  `household { do: "${ACTION_STANCE}", args: { on: "${thing}", stance: "welcomed" | "opposed" } } — welcomed files ${String(thing).split("/")[0]}'s amend that re-sites it where it was set down; opposed keeps canon where it is`;

/**
 * The waiting group for `handles`, newest first. Never throws: an unreadable
 * record is `unavailable`, said out loud, never an empty group.
 *
 * `deps.rowsForMakers(handles)` stands in for the store read and
 * `deps.householdOf` for the town's household map, so a falsifier drives this
 * over the rows the real doors wrote.
 */
export async function setDownsAwaiting(handles, { marks = [], stances = [], deps = {} } = {}) {
  const makers = [...new Set([...(handles ?? [])].filter(Boolean).map(String))].sort();
  if (!makers.length) return { rows: [] };
  let byThing;
  try {
    byThing = deps.rowsForMakers ? await deps.rowsForMakers(makers)
      : await (await import("./world2-guards.mjs")).setDownRowsForMakers(makers);
  } catch (e) {
    return { rows: [], unavailable: `the holding record could not be read (${String(e?.message ?? e).slice(0, 160)}) — this is not an answer that nothing waits` };
  }
  if (byThing == null)
    return { rows: [], unavailable: "this office cannot read the holding record — not an answer that nothing waits" };

  const hold = await import("./world-hold.mjs");
  const rows = [];
  for (const [thing, rec] of byThing) {
    const mark = marks.find((m) => m?.id === thing) ?? null;
    const sd = await setDownFor(thing, mark, marks, {
      readRows: async () => rec,
      ...(deps.householdOf !== undefined ? { householdOf: deps.householdOf } : {}),
    });
    if (!sd.drop || !makers.includes(String(sd.madeBy))) continue;
    if (hold.setDownAnswer({ stances, thing, dropSeq: sd.drop.seq ?? null, madeBy: sd.madeBy, householdOf: sd.householdOf })) continue;
    const canon = mark?.at && Number.isFinite(Number(mark.at.x)) && Number.isFinite(Number(mark.at.y))
      ? { x: Number(mark.at.x), y: Number(mark.at.y) } : null;
    rows.push({
      thing, made_by: sd.madeBy, set_down_by: String(sd.drop.actor),
      at: sd.stood ?? null, when: sd.drop.written_at ?? null,
      act_id: sd.drop.seq == null ? null : String(sd.drop.seq),
      canon_at: canon,
      answer: setDownAnswerCall(thing),
    });
  }
  rows.sort((a, b) => (String(a.when) === String(b.when) ? (a.thing < b.thing ? -1 : 1) : (String(a.when) < String(b.when) ? 1 : -1)));
  return { rows };
}

/** The shadow's rendering of the group: the rows, and `unavailable` only when it could not be read. */
async function setDownsGroup(key, inbox, deps = {}) {
  const g = await setDownsAwaiting(handlesOf(key), { marks: inbox.marks ?? [], stances: inbox.stanceRows ?? [], deps });
  return { set_downs_awaiting: g.rows, ...(g.unavailable ? { set_downs_unavailable: g.unavailable } : {}) };
}

/**
 * The author's house answers a stranger's set-down: one stance row, and on
 * `welcomed` the author's amend. Everything that can refuse refuses BEFORE the
 * row is written, so a refusal leaves nothing behind.
 */
async function answerSetDown({ repo, on, stance, by, key, target, sd, dbPath, witnessStamp, crossing, deps = {} }) {
  const hold = await import("./world-hold.mjs");
  const { drop, stood, householdOf, madeBy } = sd;
  const setter = String(drop.actor);
  const place = (p) => `(${Number(p.x)}, ${Number(p.y)})`;
  if (!stood) throw bounce(409, `the record does not place ${setter}'s set-down of ${on}`,
    "a set-down is answered at the place it was made, and the act's anchor could not be composed — nothing was written");

  const prior = hold.setDownAnswer({
    stances: await stanceRows({ dbPath, worldClone: repo }), thing: on, dropSeq: drop.seq, madeBy, householdOf });
  if (prior?.stance === "welcomed" && stance === "opposed")
    throw bounce(409, `your house has already accepted ${setter}'s set-down of ${on}`,
      `accepting filed the amend that re-sites it in ${madeBy}'s name, so there is no set-down left to refuse — to move it back, amend the mark with world { do: "leave-mark", args: { slug, amend: true, at } }. Nothing was written.`);

  let amendDeps = deps;
  if (stance === "welcomed") {
    // The amend is filed in the AUTHOR's name through the leave-mark door, and
    // that door refuses a key that does not act for them. Asked here, first,
    // so the refusal comes before the stance row rather than after it.
    if (!key?.handles?.has(madeBy))
      throw bounce(403, `accepting moves ${madeBy}'s mark, and this key does not act for ${madeBy}`,
        `the amend that re-sites it is filed in ${madeBy}'s name, so a key that holds ${madeBy} speaks the welcome — nothing was written`);
    const mark = deps.mark !== undefined ? deps.mark
      : (await (await import("./world.mjs")).worldMarkById(on)).mark;
    const built = hold.setDownAmend({ thing: on, mark, stood, actor: setter });
    if (built.refused) throw bounce(409, `${on} cannot be re-sited by an amend at this door`, `${built.refused} — nothing was written`);
    amendDeps = { ...deps, mark };
  }

  const stamp = witnessStamp ? await witnessStamp(by) : { at: { anchor: null, dx: null, dy: null }, witnesses: { source: "unread", reason: "no witness reader supplied", list: [] } };
  const setDown = { act_id: drop.seq == null ? null : String(drop.seq), by: setter, at: stood };
  let row;
  {
    const entry = {
      crossing, actor: by, household: resolvedWorldHousehold(key) ?? null,
      action: ACTION_STANCE, object: on, cls: CLASS_STANCE,
      at: stamp.at, witnesses: stamp.witnesses,
      payload: { on, stance, by, answers: hold.ANSWERS_SET_DOWN, set_down: setDown },
      effect: stance === "welcomed"
        ? `the author's house accepts ${setter}'s set-down — the amend that re-sites it is filed in ${madeBy}'s name`
        : `the author's house refuses ${setter}'s set-down — canon keeps it where ${madeBy} put it`,
    };
    try {
      row = laneFlipped("stance") ? await appendActFlipped(null, entry) : await appendJournal(null, entry);
    } catch (err) {
      if (err?.name === "PenUnreachableError")
        throw bounce(503, err.message,
          "this door's pen is the office's record; when it cannot be reached the door refuses rather than writing anywhere else — your stance is safe to speak again");
      throw err;
    }
  }

  const amend = stance === "welcomed"
    ? await hold.fileAuthorsAmend({ thing: on, stood, key, actor: setter, actId: drop.seq ?? null, writtenAt: drop.written_at ?? null,
        extra: { stance_act_id: row.actId == null ? null : String(row.actId) }, deps: amendDeps })
    : null;
  const canonAt = target?.at ?? null;
  const effect = stance === "opposed"
    ? `your house refuses ${setter}'s set-down: canon keeps ${on} at ${canonAt ? place(canonAt) : "the place it was last folded"}, and the read answers canon from now on.`
    : amend.filed && amend.put_forward
      ? `your house accepts ${setter}'s set-down: the amend that re-sites ${on} at ${place(stood)} is filed in ${madeBy}'s name, and canon moves it at the next crossing.`
      : amend.filed
        ? `your house accepts ${setter}'s set-down: the amend that re-sites ${on} at ${place(stood)} is filed in ${madeBy}'s name as a private draft — no escrow behind it clears the ground it now stands on, so canon keeps it where it was folded until it is put forward.`
        : `your house accepts ${setter}'s set-down, but the amend that re-sites ${on} was not filed (${amend.why}) — canon keeps it where it was folded; speak welcomed again to file it.`;
  return {
    on, stance, by, answers: hold.ANSWERS_SET_DOWN, set_down: setDown,
    seq: row.actId, crossing: row.crossing, log: row.record ?? "acts",
    witnesses: row.witnesses ? JSON.parse(row.witnesses) : null,
    ...(prior ? { superseded: { stance: prior.stance, at: prior.at, seq: prior.seq } } : {}),
    ...(amend ? { amend } : {}),
    effect,
    note: "a set-down of your house's thing by another household is yours to answer: welcomed re-sites it in your name, opposed keeps canon where you put it, and silence leaves it unaccepted",
  };
}

export async function declareStanceViaOffice(repo, args = {}, key = null, { dbPath = null, witnessStamp = null, crossing = null, setDownDeps = {} } = {}) {
  // THE WORLD-FREEZE GATE (the engine cutover, 2026-08-24). A stance is a
  // ground act — the freeze's own bounce names it in the list — so this door
  // pauses with the other ten while the town changes engines. It is FIRST,
  // ahead of the log check below, because a frozen world's answer must not
  // depend on which office you asked: a box running without WORLD_SINGLE_LOG
  // would otherwise answer 501 "no pen here" to a question the freeze has
  // already settled with a 503.
  //
  // RETURNED, NOT THROWN, against this module's own throw-a-bounce grammar —
  // freeze.mjs § the returned shape: "every write entry this gates propagates a
  // returned { error: "bounce" } shape through both skins, while throw
  // conventions vary by module". The apex hands a run()'s return value straight
  // back, so a returned bounce reaches the caller unaltered; matching the gate's
  // one shape across all eleven doors is worth the local inconsistency.
  { const fz = worldFreezeBounce(); if (fz) return fz; }
  if (!singleLogEnabled())
    throw bounce(501, "the consent door has no pen at this office",
      "a stance is a row in the single log, and the log is switched off here — the operator runs it behind WORLD_SINGLE_LOG=1");

  const handles = [...(key?.handles ?? [])];
  const by = args.by ?? args.handle ?? (handles.length === 1 ? handles[0] : undefined);
  if (!by) throw bounce(422, "which resident is speaking?",
    handles.length ? `pass handle: one of ${handles.join(", ")}` : "this key acts for no resident");
  if (!key?.handles?.has(by)) throw bounce(403, `"${by}" is not one of your residents`,
    `this key acts for: ${handles.join(", ") || "(none)"}`);

  const on = String(args.on ?? "").trim();
  if (!on || !on.includes("/")) throw bounce(422, "which mark?",
    `pass on: "<by>/<slug>" — the mark you are speaking about, as the telling shows its id`);

  const stance = String(args.stance ?? "").trim();
  if (stance === "neutral")
    throw bounce(422, "neutral is never stored, it is absence",
      "the class mark's own words. Neutral is the resting state every mark already has until you speak — there is nothing to declare. To change your mind, declare the other word; latest wins.");
  if (!STANCES.includes(stance))
    throw bounce(422, `stance must be ${STANCES.join(" or ")}`,
      `got ${JSON.stringify(args.stance ?? null)} — welcomed confers your ground's standing on it, opposed is your veto. Both are revisable forever.`);

  // ── THE GROUND'S HOLDER SPEAKS ───────────────────────────────────────────
  const geom = await stanceGeometry(repo);
  if (!geom) throw bounce(503, "the world's own geometry could not be read",
    "overlap is the engine's answer and this door will not substitute its own — try again once the world store is readable");
  const overlaps = (a, b) => geom.overlapArea(geom.rect(a), geom.rect(b)) > 0;

  // A 503 rather than a 404, and the distinction is the act's whole safety: an
  // unreachable candidate read cannot tell "no such mark" from "I could not
  // look", and answering `no mark "<on>"` to the second would teach a resident
  // their neighbour's sketch does not exist. The world-geometry refusal three
  // lines up is the same shape and the same wording.
  const world = await worldForStances(repo, { dbPath });
  if (world.unreachable) throw bounce(503, "the stance candidate list could not be read", world.unreachable);
  const all = world.marks;
  const target = all.find((m) => m.id === on);
  if (!target) throw bounce(404, `no mark "${on}"`, "ids are <by>/<slug> — see the telling, or your own inbox: world { read: \"" + ACTION_STANCE + "\" }");

  // ── THE SET-DOWN ARM (POS-138; Keemin, 2026-09-24: "I agree with you here") ─
  //
  // A set-down by ANOTHER household is a drafted amend of the author's thing,
  // and the drafted amend IS the drop act. The author's house answers it here:
  // welcomed files the author's amend (`world-hold.mjs § fileAuthorsAmend`,
  // the same call the author's own drop makes), opposed files nothing and the
  // read answers canon, and silence leaves it unaccepted. This arm is asked
  // BEFORE the ground's-holder arm because it is the one case where the
  // author speaks about their own mark — which the ground arm refuses by name,
  // and still does for every other case.
  const sd = await setDownFor(on, target, all, setDownDeps);
  // An UNREADABLE holding record opens no arm and closes none: the door goes on
  // to the answer it has always given, and says the set-down could not be
  // checked. Turning every author's ordinary 422 into a 503 because a store
  // blinked would make an outage look like a new law (the suite caught it).
  if (sd?.drop && sd.speakerHouse(by))
    return await answerSetDown({ repo, on, stance, by, key, target, sd, dbPath, witnessStamp, crossing, deps: setDownDeps });

  if (target.by === by) throw bounce(422, "a mark is never its own ground",
    "you do not consent to your own declaration — a stance is the word of the ground it landed on"
    + (sd?.unreadable ? ` (whether another household has set it down, which is the one thing its author's house answers here, could not be checked: the holding record did not answer)` : ""));

  const mine = all.filter((m) => key.handles.has(m.by) && m.at && m.extent);
  const ground = groundFor(target, mine, overlaps);
  if (!ground.length)
    throw bounce(403, `"${on}" does not stand on your ground`,
      "the ground's holder speaks: a mark with extent IS ground, so you may answer only what overlaps a mark of yours that stood there first — precedent weighs in on the newcomer, never the reverse"
      + (sd?.drop ? ` — and ${sd.drop.actor}'s set-down of it is ${target.by}'s to answer: a set-down of ${target.by}'s thing is accepted or refused by ${target.by}'s house alone` : ""));

  const stamp = witnessStamp ? await witnessStamp(by) : { at: { anchor: null, dx: null, dy: null }, witnesses: { source: "unread", reason: "no witness reader supplied", list: [] } };

  {
    // THE SUPERSEDED COURTESY READS THE WHOLE RECORD, NOT ONE STORE.
    //
    // This computed `prior` from `readJournal(db)` alone — the live sqlite
    // journal — while the read side had already moved to photographs ∪ journal
    // (#2454) and now to the register beside them. So a resident re-declaring a
    // stance whose first word had been drained got a receipt saying nothing was
    // superseded, which is the #2454 sentence in the smallest possible type: the
    // town knew, and the door told them it did not.
    //
    // AND MY OWN REAPER ACCELERATES IT. Once a stance row's twin is confirmed in
    // `acts` the reaper takes the sqlite row, so this window shrinks from "until
    // the next drain" to "until the next reap". A courtesy field decaying faster
    // because of a fix I shipped in the same lane is not a courtesy, it is a
    // regression I would have introduced and then not been able to see — nothing
    // asserts `superseded`, which is why it took my reviewer to find it.
    //
    // `stanceRows` is the one derivation every tier reads from; this now shares
    // it rather than keeping a fourth opinion about what has been said.
    const prior = standingStances(await stanceRows({ dbPath, worldClone: repo }), { by }).find((s) => s.on === on) ?? null;
    const entry = {
      crossing, actor: by, household: resolvedWorldHousehold(key) ?? null,
      action: ACTION_STANCE, object: on, cls: CLASS_STANCE,
      at: stamp.at, witnesses: stamp.witnesses,
      payload: { on, stance, by, on_your_ground: ground.map((g) => g.id) },
      effect: stance === "welcomed"
        ? "your ground welcomes it — the crossing confers your standing on it when it judges"
        : "your ground opposes it — the crossing reads your veto when it judges",
    };
    // ── LANE ONE OF THE PEN FLIP (W2_PEN=stance; Keemin ruled the shape
    // 2026-08-29 — D1 per lane, D2 refuse, D3 reverse mirror). The design's
    // own pick for first: "the one door that has never had a second pen to
    // disagree with." Flipped, the record is Postgres `acts`, committed and
    // awaited BEFORE anything else; sqlite gets the reverse-mirror copy after.
    // Unreachable Postgres = the ruled refusal, and nothing was written.
    // ── BOTH ARMS REFUSE NOW (G1 / POS-156, RULING 3) ─────────────────────
    //
    // The unflipped arm was `appendJournal(db, entry)` — a sqlite row written
    // here and a Postgres copy queued behind it. The sqlite row is gone, so
    // that call awaits the record and throws exactly as the flipped one does,
    // and this door's refusal is one sentence for both. It names no flag:
    // `W2_PEN` decides which function writes, not whether the record is the
    // record.
    let row;
    try {
      row = laneFlipped("stance")
        ? await appendActFlipped(null, entry)
        : await appendJournal(null, entry);
    } catch (err) {
      if (err?.name === "PenUnreachableError")
        throw bounce(503, err.message,
          "this door's pen is the office's record; when it cannot be reached the door refuses rather than writing anywhere else — your stance is safe to speak again");
      throw err;
    }
    return {
      on, stance, by,
      on_your_ground: ground.map((g) => g.id),
      // `seq` IS THE ACT'S ID NOW (G1): there is no sqlite rowid to answer
      // with, and the record's own sequence is the one sequence left.
      seq: row.actId, crossing: row.crossing,
      // Which store is the RECORD for this act. One answer since G1, because
      // there is one record — the reverse-mirror copy this used to distinguish
      // no longer exists.
      log: row.record ?? "acts",
      witnesses: row.witnesses ? JSON.parse(row.witnesses) : null,
      ...(prior ? { superseded: { stance: prior.stance, at: prior.at, seq: prior.seq } } : {}),
      // The door does not enforce, and says so where the resident is standing
      // rather than only in a doc: the-deferred-gate, in its own words.
      effect: row.effect,
      note: "the door writes; the crossing judges — your word is recorded now and read at the next settlement",
    };
  }
}

// ── the door's schema ────────────────────────────────────────────────────────
//
// STANCE_TOOLS ride the apex's SCHEMA lookup without joining the flat door's
// tool list — the CROSSING_TOOLS precedent, for the same reason and with the
// same consequence: seam 4 says the fields an act takes come from the act's own
// schema, so inventing a second grammar beside the apex row would be exactly the
// drift that seam exists to close. The flat `tools/list` count is unchanged.
export const STANCE_TOOLS = [
  { name: "world_declare_stance",
    description: "Speak your word on something standing on your ground — welcomed or opposed. A stance is a revisable word on an edge: latest wins, and neutral is never stored because neutral is what everything already is until you speak. WHO MAY SPEAK: the ground's holder. A mark with extent IS ground, so you may answer any mark that overlaps a mark of yours which stood there first — precedent weighs in on the newcomer, never the reverse. AND ONE MORE CASE: when another household has set down a thing your house made, your house answers that set-down here, on the thing itself — welcomed re-sites it where they left it, filed in your name; opposed keeps canon where you put it; silence leaves it unaccepted. THIS DOOR RECORDS; IT DOES NOT ENFORCE: the door writes and the crossing judges, so your word is read at the next settlement rather than blocking anything now. To see what is waiting for you, read this same action.",
    inputSchema: { type: "object", properties: {
      on: { type: "string", description: "the mark you are speaking about — <by>/<slug>, as ids appear in the telling and in your own inbox" },
      stance: { type: "string", enum: ["welcomed", "opposed"], description: "welcomed confers your ground's standing on it; opposed is your veto. There is no third word — returning to neutral has no grammar, because neutral is absence. Change your mind by declaring the other one." },
      cursor: { type: "string", description: "READ ONLY — the page to continue from, as the previous read's `cursor` returned it" },
      limit: { type: "number", description: "READ ONLY — how many candidates per page (default 20, cap 100)" },
      handle: { type: "string", description: "which of YOUR residents is speaking (omit if your key holds one; a multi-resident key must name one)" },
    }, additionalProperties: false } },
];
