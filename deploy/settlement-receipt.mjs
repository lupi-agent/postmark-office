// settlement-receipt.mjs — the crossing's receipt, composed rather than printf'd.
//
// ── WHY THIS FILE EXISTS ─────────────────────────────────────────────────────
//
// The receipt used to be six `printf` fields in settlement-auto.sh, and it said
// exactly one thing about what the crossing did: `"detail": "14 published"`.
// The sweep has SIX outcome channels — published, unpublished, left_drafted,
// withdrawn, quarantined, dropped — and three of them appeared on no surface at
// all. On 2026-08-26 a crossing left 42 marks drafted and reported nothing; a
// starving crossing printed "0 published, 0 unpublished" and read as a quiet day
// for two days.
//
// A receipt that can only be extended by editing a printf format string will be
// extended by nobody. This composes the receipt from the sweep's own report, so
// a channel the sweep learns to name appears here without anyone remembering to
// add it: `CHANNELS` is the enumeration, and a channel present in the sweep's
// report but missing from `CHANNELS` is reported as an unnamed channel rather
// than dropped silently.
//
// ── THE LAW IT ANSWERS ───────────────────────────────────────────────────────
//
// LOGOS `the-town/the-crossing-speaks` is not a planted law; this file answers
// the founder's 2026-08-27 mandate directly instead: "RECEIPTS LIE BY OMISSION
// — the settlement commit says 'sweep N published, M unpublished' but
// left_drafted, dropped, quarantined never appear." The rule this encodes:
//
//   A CROSSING NAMES EVERY CHANNEL IT HAS A WORD FOR, INCLUDING THE EMPTY ONES,
//   AND A PASS THAT PUBLISHED NOTHING SAYS WHAT IT SURVEYED.
//
// The empty ones matter as much as the full ones: "0 quarantined" is a fact
// about this crossing, and its ABSENCE is indistinguishable from a crossing
// that never looked.
//
// Input is env, not argv, because settlement-auto.sh calls this from a `report`
// shell function where every value may legitimately be empty and quoting empty
// positional arguments in POSIX sh is how you get an off-by-one receipt.

import { readFileSync } from "node:fs";

// The one writer of what a crossing's `surveyed` counts are counts of. The
// quiet-pass echo in settlement-auto.sh takes its wording from the same file.
import { surveyedReading } from "./surveyed-reading.mjs";

// WHICH MARK DIED AND IN WHOSE WORDS. The sweep writes the fold's own sentence
// into a quarantined row's `detail` and into a fold refusal's `cause`; this file
// carried neither, so S71 published a receipt that named Mari's household and
// not her mark, her cap, or her number. Pure and separate because a line
// composed in a script is watched by nothing — the lesson `escrowLines` paid for.
import { refusedMarks } from "./refused-marks.mjs";

const env = (name) => {
  const v = process.env[name];
  return v === undefined || v === "" ? null : v;
};

/** A JSON file that may not exist, may be half-written, or may never have been produced. */
const readJson = (path) => {
  if (!path) return null;
  try { return JSON.parse(readFileSync(path, "utf8")); }
  catch { return null; }
};

// The sweep's outcome channels, in the order a reader wants them: what happened
// to the record first, what was held back second, what was set aside last.
const CHANNELS = ["published", "unpublished", "left_drafted", "withdrawn", "quarantined", "suite_quarantined", "dropped", "rebased"];

// WHICH RECORD THIS CROSSING FOLDED, read once. Two fields answer this question
// — `source` and `surveyed_reading` — and a receipt that answered it two
// different ways would be worse than one that answered it not at all, so they
// read the same constant rather than the env twice.
const SOURCE = env("SETTLEMENT_SOURCE_MODE") ?? "git";

const sweep = readJson(env("SETTLEMENT_SWEEP_JSON"));
const drain = readJson(env("SETTLEMENT_DRAIN_JSON"));
const isolate = readJson(env("SETTLEMENT_ISOLATE_JSON"));
// THE HARM GATE (founder-ruled 2026-09-16): the crossing's refusing gate — five
// data-shaped checks over the tree the sweep produced, each naming its marks.
// Present on every crossing that reached it, harm or none; null when the
// crossing refused before it ran, which is a different state and stays one.
const harm = readJson(env("SETTLEMENT_HARM_JSON"));
// THE GRAMMAR SUITE, run AFTER the push as a checker. `red: true` on a PUBLISHED
// crossing is a warning — an issue is filed and nothing is held.
const suite = readJson(env("SETTLEMENT_SUITE_JSON"));
// THE RETIREMENT (G1 lane 1). Not a sweep channel — the sweep holds no database
// credential and never will — so it arrives on its own report, like the drain's.
// It is named on every crossing including the ones where it retired nothing,
// for the drain's own reason: "retired: 0" is the receipt that the step RAN,
// and its absence is indistinguishable from a step nobody called.
const retire = readJson(env("SETTLEMENT_RETIRE_JSON"));
// The refusal's CLASS — deploy/settlement-classify.mjs's verdict, when this
// crossing refused. Added 2026-08-30 to retire `"phase":"unknown"`: a refusal
// that cannot say whether a rerun could ever clear it makes the operator guess,
// and on 2026-08-31T02:39Z the guess (rerun) happened to be right.
const refusal = readJson(env("SETTLEMENT_REFUSAL_JSON"));
// THE STORE'S OWN WRITE-DOWN (G1 lane 3), when the crossing folded from the
// store. Like the drain's and the retirement's, it arrives on its own report
// rather than as a sweep channel — the sweep holds no store credential.
const store = readJson(env("SETTLEMENT_STORE_JSON"));
// THE HOUSEHOLD REGISTRY REFRESH (2026-09-09). Named on every crossing, like the
// drain's and the retirement's, and for the sharpest version of their reason:
// this step's whole point is that "the registry was re-derived" and "nobody
// re-derived it for 33 days" printed identically for 33 days. `changed: false`
// is the receipt that the crossing LOOKED; its absence is the state that made
// the step necessary.
const registry = readJson(env("SETTLEMENT_REGISTRY_JSON"));

// POS-155. `--check` writes a verdict and `--write` writes a report; both land
// here through the same file, and `STATE_LOG_MODE` is what says which one this
// is. Read as a plain string with no default: an empty mode on a store crossing
// means the step did not run, and inventing `sqlite` for it would put a word on
// the receipt for a pen that never moved.
const stateLog = readJson(env("SETTLEMENT_STATE_LOG_JSON"));
const STATE_LOG_MODE = env("SETTLEMENT_STATE_LOG_MODE") || null;

// Read once, from both places the fold's sentence reaches this side — the
// quarantined rows' `detail` and a fold refusal's `cause`. See `refused` below.
const refused = refusedMarks(sweep, refusal);

const channels = {};
let unnamed = null;
if (sweep) {
  for (const name of CHANNELS) channels[name] = Array.isArray(sweep[name]) ? sweep[name].length : 0;
  // A channel the sweep grew and this file does not know about is NAMED as
  // unknown rather than silently dropped — the failure mode this file exists to
  // end must not be reintroduced by the file itself.
  // `eol_boundary` is a list of paths the repo's own line-ending law cannot
  // reconcile, not an outcome channel — naming it here would put a permanent
  // "channels_unnamed" line on every receipt and teach the reader to skip the
  // field, which is the opposite of what it is for.
  const NOT_A_CHANNEL = new Set(["findings", "eol_boundary"]);
  const extra = Object.keys(sweep).filter((k) => Array.isArray(sweep[k]) && !CHANNELS.includes(k) && !NOT_A_CHANNEL.has(k));
  if (extra.length) unnamed = Object.fromEntries(extra.map((k) => [k, sweep[k].length]));
}

const receipt = {
  at: env("SETTLEMENT_AT"),
  status: env("SETTLEMENT_STATUS"),
  town_sha: env("SETTLEMENT_TOWN_SHA") ?? "",
  world_from: env("SETTLEMENT_WORLD_FROM") ?? "",
  world_to: env("SETTLEMENT_WORLD_TO") ?? "",

  // ── WHERE THIS CROSSING'S RECORD CAME FROM (G1 lane 3) ─────────────────────
  //
  // `store` or `git`, and it is on EVERY receipt including the git ones. A field
  // that appears only when the answer is interesting teaches its reader that its
  // absence means "git", and then the day it is absent for some other reason —
  // an older receipt, a half-written one, a composer that failed — the reader
  // silently gets a wrong answer to the most consequential question on the page.
  //
  // Read straight from the mode the script decided, not inferred from whether a
  // store report exists: a store crossing that REFUSED before its write-down has
  // no store report, and its receipt must still say it was a store crossing, or
  // the operator reading a refusal cannot tell which path refused.
  source: SOURCE,

  // ── AND WHETHER A PERSON STARTED IT (postmark#2786, 2026-09-14) ────────────
  //
  // `true` only when the operator door was used: the docket was the newest
  // CLOSED window still holding a locked claim with no materialized mark, rather
  // than a window that cleared during this crossing's own wait. Two publications
  // with identical channel counts mean different things depending on this field —
  // one is the clock, one is somebody finishing a crossing the clock refused —
  // and without it the history log cannot tell them apart afterwards.
  //
  // ON EVERY RECEIPT, `false` included, for `source`'s own reason one field up: a
  // field that appears only when the answer is interesting teaches its reader
  // that absence means "scheduled", and then the first receipt missing it for
  // some other reason hands them a wrong answer about who published the town.
  //
  // Read from the mode the script decided, never inferred from the docket: a
  // by-hand crossing that REFUSED before it reached a docket still has to say it
  // was a person's act, or the journal and the receipt disagree about what ran.
  by_hand: env("SETTLEMENT_BY_HAND") === "1",

  // ── WHAT A ROLLBACK CROSSING SWEPT UP BEFORE IT LOOKED (repair 1) ──────────
  //
  // A `git` crossing after a `store` one used to fold the store's leftover local
  // sketchbooks — 57 of them at S63 — under a receipt saying `source: git`. The
  // git path now clears the twin-less locals it can attribute to a store
  // crossing and KEEPS the ones it cannot, because a twin-less local is also how
  // an undelivered first drain survives.
  //
  // Both numbers are here and neither is folded into the other: `ghosts` climbing
  // means store crossings are dying before their own cleanup, and `kept` climbing
  // means a household's first drain has been failing to deliver for days. They
  // are different alarms and a single count would hide whichever was smaller.
  // Null on a store crossing, where the question is not asked.
  sketchbook_ghosts: env("SETTLEMENT_GHOSTS") === null ? null : Number(env("SETTLEMENT_GHOSTS")),
  sketchbook_kept_undelivered: env("SETTLEMENT_KEPT_UNDELIVERED") === null ? null : Number(env("SETTLEMENT_KEPT_UNDELIVERED")),
  // A THIRD NUMBER, never folded into the first. A ghost is a leftover DELETED;
  // a reset is a store scratch taken OFF a surviving origin twin, and that twin
  // lives on. The repairs differ — ghosts climbing means store crossings are
  // dying before their own cleanup, resets climbing means store crossings are
  // taking git-era sketchbook names — and one count would hide whichever was
  // smaller, which is the argument the two fields above already make for
  // themselves. It was folded into `ghosts` for one lap; the reviewer caught it.
  sketchbook_resets: env("SETTLEMENT_RESETS") === null ? null : Number(env("SETTLEMENT_RESETS")),

  // THE `as_of` TRIPLE — the window, the world sha and the town sha the store
  // was read at. Reader 5's finding, in the keeper's own terms: without the
  // store cursor beside the three git shas he cannot tell a quiet crossing from
  // a blind one, "which is the 2026-08-26 starving-crossing shape in a new
  // dress". Null on a git crossing, because there is no store read to name —
  // and null is the honest answer there rather than an echo of the git shas,
  // which would make the field look answered when nothing consulted a store.
  as_of: store?.as_of ?? null,

  // THE DRAIN, named on every crossing including the ones where it did nothing.
  // "drained: 0" is the receipt that the drain RAN; its absence is the receipt
  // that nobody knows whether it did, which is the state this whole night is
  // about (the drain had a function and no caller for three days).
  drain: drain
    ? (drain.refused
        ? { ran: true, refused: drain.refused, detail: drain.detail ?? null }
        : {
            ran: true,
            drained: drain.drained ?? 0,
            cursor: drain.cursor ?? null,
            head: drain.head ?? null,
            remaining: drain.remaining ?? null,
            households: (drain.households ?? []).filter((h) => h.changed).map((h) => h.household),
            state_commit: drain.state_commit ?? null,
          })
    : { ran: false, reason: "the drain step did not run for this crossing" },

  // ── THE STORE'S WRITE-DOWN (G1 lane 3) ─────────────────────────────────────
  //
  // Named on every crossing, including git ones where it says so — same rule as
  // the drain's block and for the same reason: "the store step did not run" and
  // "nobody knows whether it did" are different states.
  //
  // `sketchbooks_cleared` is here and not folded into a count because it is the
  // evidence for the word `store` in the field above. The settlement clone is
  // long-lived and carries git-era `origin/draft/*` refs that the sweep would
  // otherwise fold; these two numbers say how many were removed before the fold
  // looked. A store crossing reporting `removed_remote: 0` on a box that has
  // ever run a git crossing is a finding, not a tidy line.
  //
  // `supplied_bytes_only` counts marks whose bytes the store side rendered and
  // this side could not re-derive, because no record came with them. It should
  // be 0. Anything else means two writers are serializing the same declaration,
  // which is the state `src/mark-record.mjs` exists to prevent, and the keeper
  // should read it as such rather than as a statistic.
  store: store
    ? {
        ran: true,
        // WHOSE STORE READ THIS WAS. `source: store` says the register was the
        // record; this says which module produced it. A rehearsal instrument
        // and lane 2's entry point both make a fold input, and a crossing
        // folded by an instrument must never be indistinguishable from one
        // folded by the register — that is the same defect as a freshness stamp
        // naming a source it did not come from.
        entry: store.entry ?? null,
        // TRUE means this crossing folded from a rehearsal instrument, not from
        // lane 2's entry point. It is on the receipt rather than only in a log
        // line because the history file outlives the terminal that ran it, and
        // "which of these crossings was a rehearsal" is a question somebody asks
        // weeks later with nothing but these receipts to answer it from.
        rehearsal: store.rehearsal === true,
        // THE AUTHORSHIP WALL'S REACH, and it is on the receipt because the
        // wall's failure mode is silence. The sweep leaves a sketchbook it
        // cannot bind ALONE rather than refusing it, so a fold that named its
        // branches differently would bind none of them, publish every mark
        // unverified, and produce a receipt that looked exactly like a clean
        // crossing. `bound` falling is the only thing that shows it.
        wall: store.wall ?? null,
        // MARKS IN THE DOCKET THE WALL COULD NOT BIND, held out of the fold
        // rather than written into a sketchbook nobody can verify. Named in full,
        // not counted: the keeper is the one who can tell a law node from a
        // household whose registry row is simply missing, and a count would make
        // those two look the same.
        held_unbound: store.held_unbound ?? null,
        held_unbound_count: store.held_unbound_count ?? null,
        // WHERE THE ESCROW INGEST STANDS. `behind: 0` is the ordinary case; a
        // number that climbs across crossings is an ingest that has stopped
        // running, which is otherwise indistinguishable from a quiet town.
        ingest: store.ingest ?? null,
        // The selector, on every store crossing. `by: "standing"` on a crossing
        // that was meant to fold a docket is the single most consequential thing
        // this receipt can say, and its absence would be indistinguishable from
        // the correct case.
        //
        // `selection.docket_claims` IS READ WITH `marks` BELOW, NOT ALONE. It is
        // how many claims the candle locked at this window (`claims`, read by
        // `fold-delta.mjs § foldDelta`), and `marks` is what the mark read
        // returned. `0` and `0` is a town where nobody claimed — lawful, and one
        // prod window in five. Any positive `docket_claims` over `marks: 0` is a
        // docket that was never materialized, and the crossing refuses.
        selection: store.selection ?? null,
        marks: store.marks ?? 0,
        // OFFERED vs WRITTEN. A crossing must never re-materialize a mark it is
        // not changing: the corpus carries 75 frontmatter field orders and 40+
        // keys against the door's 13, so a fold that re-rendered everything
        // standing would rewrite the town's whole history into the door's
        // present grammar under a receipt claiming a handful of marks. `written`
        // close to `marks` on a quiet crossing is that failure, visible.
        written: store.written ?? null,
        unchanged_skipped: store.unchanged_skipped ?? null,
        // THE STORE-ERA LOUD-EMPTY GUARD's own answer, on every crossing
        // including the ones it passed. The git-era guard fires from the world's
        // sweep and cannot fire at all in the store era, so this is the surface
        // that says the question was asked. "It did not fire" and "nobody asked"
        // are different states and only one of them is evidence.
        starving_check: store.starving_check ?? null,
        written_by_locked_window: store.written_by_locked_window ?? null,
        households: (store.households ?? []).length,
        changed: (store.households ?? []).filter((h) => h.changed).length,
        serialized_here: store.serialized_here ?? null,
        supplied_bytes_only: store.supplied_bytes_only ?? null,
        // WHAT THE FRAMER TOUCHED (2026-09-18, postmark#2865 the third bite):
        // every world-framed record the write-down carried into a NESTED frozen
        // filing, with the number that arrived and the number written. The
        // failure this reports was silent — Berthillon's image-only amend moved
        // the shop 54 m under a green suite because the store path carried the
        // world number raw — so the count rides even when it is zero, and
        // `framer: false` names a write-down that ran with no framer at all.
        framed: store.framed ?? null,
        framer: store.framer ?? null,
        sketchbooks_cleared: store.sketchbooks_cleared ?? null,
      }
    : { ran: false, reason: "the store write-down did not run for this crossing" },

  // THE ARCHIVE'S EVENT LOG, AND WHETHER THIS CROSSING WROTE IT (POS-155).
  //
  // On the receipt rather than only in a log line, for the reason the whole
  // lane exists: the act journal `STATE/log/<c>.journal.jsonl` went dark at the
  // swap on 2026-09-11 and NOTHING SAID SO. Eleven days of crossings published
  // green receipts over an archive that had stopped being written, because no
  // channel on the receipt had a word for it. A hole nobody can see on the
  // instrument is a hole nobody finds.
  //
  // `mode` is which pen ran — `store` wrote, `sqlite` only looked — and it is
  // first because every other field here means something different under each.
  // `clean` is the CHECK's verdict and is null under `store`, where there is
  // nothing to check against: the write is the answer.
  //
  // `would_write` is the size of the hole, in lines, and it is the number to
  // read while the default is `sqlite`. A `clean: false` with `absent` against
  // every crossing and `would_write: 38` is the archive saying exactly how much
  // of itself is missing this window.
  state_log: stateLog
    ? (stateLog.refused
        ? { ran: true, mode: STATE_LOG_MODE, refused: stateLog.refused, detail: stateLog.detail ?? null }
        : {
            ran: true,
            mode: STATE_LOG_MODE,
            // The CANDLE window this crossing closed, and the FERRY crossing
            // values its acts fell in. Both, because they are two clocks and
            // the receipt is the one place a reader can see that they differ:
            // window 204's acts land in files 203 and 204, and a receipt
            // naming only the window would read as though one file were
            // missing. (`state-log-write.mjs § WINDOW_BOUNDARY`.)
            window: stateLog.window ?? null,
            files: (stateLog.crossings ?? stateLog.windows ?? []).map((c) => c.crossing),
            clean: STATE_LOG_MODE === "store" ? null : (stateLog.clean ?? false),
            // Under `store`: what was written and committed. `state_commit`
            // null with lines written is the idempotent case — the same bytes
            // were already there — and is not a failure.
            lines: (stateLog.windows ?? []).reduce((n, c) => n + (c.lines ?? 0), 0) || null,
            state_commit: stateLog.state_commit ?? null,
            // Under `sqlite`: the verdict, summed across the window's files.
            // The classes are NAMED and not totalled into one number, because
            // `absent` and `unexplained` are the two that mean something and
            // they mean opposite things — the first is the known hole, the
            // second is a line the register and the file disagree about.
            //
            // NULL UNDER `store`, all three, and not zero. A `--write` run
            // compares nothing, so `would_write: 0` beside it would read as
            // "nothing was due this window" — which is the opposite of what a
            // write that just put 38 lines on main means. A field that answers
            // a question the run did not ask says so.
            classes: STATE_LOG_MODE === "store" ? null : (stateLog.crossings ?? []).reduce((acc, c) => {
              for (const [k, v] of Object.entries(c.classes ?? {})) acc[k] = (acc[k] ?? 0) + v;
              return acc;
            }, {}),
            would_write: STATE_LOG_MODE === "store" ? null
              : (stateLog.crossings ?? []).reduce((n, c) => n + (c.derived_lines ?? 0), 0),
            first_difference: STATE_LOG_MODE === "store" ? null
              : ((stateLog.crossings ?? []).find((c) => !c.byte_equal)?.first_difference ?? null),
            // A household the resolver could not name is a finding, never a
            // guess written into an archive (`state-log-rederive.mjs §
            // householdNamerFor` returns null rather than picking one).
            unnamed_households: [...new Set((stateLog.crossings ?? stateLog.windows ?? [])
              .flatMap((c) => c.unnamed_households ?? []))],
          })
    : { ran: false },

  // ── THE HOUSEHOLD REGISTRY THIS CROSSING FOLDED ON ─────────────────────────
  //
  // `town_sha` is the tree the mapping was DERIVED from and `changed` says
  // whether this crossing moved it. Both are needed and neither substitutes for
  // the other: an unchanged registry keeps an older `town_sha`, so `town_sha`
  // alone reads as staleness where there is none, and `changed: false` alone
  // says nothing about which town the standing file came from.
  //
  // `added`, `removed` and `rekeyed` are carried BY NAME, not counted. A handle
  // that joined a household and a handle that was re-keyed to a different
  // credential have the same count and completely different consequences: the
  // first can only group marks that were ungrouped, the second moves marks
  // between households and can push one over the parcel-claim cap. The keeper is
  // the reader who can tell those apart, and a count would hide the difference.
  registry: registry
    ? (registry.refused
        ? { ran: true, verified: false, refused: registry.refused, detail: registry.detail ?? null }
        : registry.ran === false
          ? {
              ran: false,
              // LOUD, and on every unverified crossing. `verified: false` beside
              // `bypass: true` is the pair a reader needs: the first says the
              // registry was not checked against the town, the second says a
              // person meant that. An unverified crossing that reads like an
              // ordinary one is the 2026-08-07 shape in this lane's own clothes.
              verified: false,
              bypass: registry.bypass === true,
              reason: registry.reason ?? "the registry refresh did not run for this crossing",
            }
          : {
              ran: true,
              verified: true,
              // THE SHA IT WAS CHECKED AGAINST, which is not the stamp the file
              // carries. A registry re-derived and found unchanged keeps an
              // older stamp and is fresh; `verified_at` is the field that says
              // so, and `town_sha` below is the file's own. Two facts, two
              // fields, because conflating them refuses every quiet crossing.
              verified_at: registry.verified_at ?? null,
              changed: registry.changed === true,
              commit: env("SETTLEMENT_REGISTRY_COMMIT") ?? null,
              town_sha: registry.town_sha ?? null,
              generated_at: registry.generated_at ?? null,
              previous_generated_at: registry.previous_generated_at ?? null,
              previous_town_sha: registry.previous_town_sha ?? null,
              handles: registry.handles ?? null,
              households: registry.households ?? null,
              logins: registry.logins ?? null,
              added: registry.added ?? [],
              removed: registry.removed ?? [],
              rekeyed: registry.rekeyed ?? [],
            })
    : { ran: false, verified: false, bypass: false, reason: "the registry refresh did not run for this crossing" },

  // WHAT THE CROSSING SURVEYED. A quiet pass without this is a claim with no
  // receipt: "nothing eligible" and "I looked at nothing" print identically.
  surveyed: sweep?.surveyed ?? null,

  // ── AND WHAT THOSE THREE COUNTS ARE COUNTS OF (G1 lane 3, 2026-09-09) ──────
  //
  // The numbers above mean two different things in the two eras, and they print
  // identically. On a git crossing they are draft refs that were STANDING before
  // the crossing looked — an independent second opinion, which is the whole
  // reason the loud-empty guard can catch a blind crossing. On a store crossing
  // `src/store-writedown.mjs` deletes every draft ref and then BUILDS one
  // sketchbook per household, so the same three numbers are the write-down's own
  // output read back, and a zero means it carried nothing rather than that the
  // town was quiet.
  //
  // The world's tools cannot make this distinction and must not try: a ref count
  // is not an era, and the store path deliberately keeps it non-zero. `source:`
  // above is the only place in the chain that knows, which is why the sentence
  // is here, one field away from it.
  surveyed_reading: surveyedReading(SOURCE, sweep?.surveyed ?? null),

  // ── WHAT THE STORE WAS TOLD (G1 lane 1) ────────────────────────────────────
  //
  // The keeper reads this line to answer the question that had no surface at
  // all before it: did the register hear that the world let these marks go.
  // `absent` is carried in full rather than as a count because it is the one
  // row that means something is wrong somewhere else — a slug the world
  // unpublished that the store never held is either founding estate or a
  // materialization the candle missed, and the keeper is the one who can tell.
  retired: retire
    ? (retire.ran === false
        ? { ran: false, reason: retire.reason ?? "the retire step did not run for this crossing" }
        : {
            ran: true,
            count: retire.count ?? (retire.retired ?? []).length,
            slugs: (retire.retired ?? []).map((r) => r.slug),
            window: retire.window ?? null,
            cause: retire.cause ?? null,
            already_retired: (retire.already_retired ?? []).map((r) => r.slug),
            absent: (retire.absent ?? []).map((r) => r.slug),
          })
    : { ran: false, reason: "the retire step did not run for this crossing" },

  channels: sweep ? channels : null,
  ...(unnamed ? { channels_unnamed: unnamed } : {}),

  // The rows an operator has to act on, in full rather than as a count — these
  // are the two channels where somebody is waiting to be told something.
  //
  // `reason` here is the sketchbook's, and it is the SAME SENTENCE every time
  // ("this sketchbook's own published rows could not be admitted…"): it says a
  // household was set aside and nothing about which mark or which rule. The mark
  // and the rule are in `refused` below, parsed out of the sweep's `detail` — not
  // copied into this row, because one fact written in two places drifts.
  quarantined: (sweep?.quarantined ?? []).map((q) => ({
    household: q.household ?? null, ref: q.ref ?? null, reason: q.reason ?? null, row: q.row ?? null,
  })),

  // ── WHICH MARK THE CROSSING REFUSED, AND WHY, IN THE FOLD'S OWN WORDS ──────
  //
  // S71, 2026-09-15: a crossing whose receipt read `status: "published"`,
  // `class: null`, `refusal: null`, `quarantined: [{ …, row: null }]`. It had
  // refused Mari's parcel on the world's per-household claim cap, the sweep had
  // written the whole sentence, and this file mapped the row to four fields that
  // did not include it. She found out twelve hours later, from a person.
  //
  // ABSENT ON AN ORDINARY CROSSING, and that is the one place this file breaks
  // its own "name the empty ones too" rule on purpose. The other blocks name a
  // step that RAN — "drained: 0" is the receipt that the drain ran at all. This
  // is not a step; it is the fold's answer about particular marks, and there is
  // no such answer on a crossing that refused nothing. `channels.quarantined`
  // already carries the empty count, so nothing goes unsaid.
  ...(refused ? { refused } : {}),
  isolated: isolate
    ? {
        attributed: true,
        rounds: isolate.rounds ?? null,
        quarantined: (isolate.quarantined ?? []).map((q) => ({
          household: q.household ?? null, id: q.id ?? null, path: q.path ?? null,
        })),
        suite_red_before: isolate.suite_red_before ?? null,
      }
    : null,
  harm: harm
    ? {
        ok: harm.ok === true,
        base: harm.base ?? null,
        checks: (harm.checks ?? []).map((c) => ({
          name: c.name ?? null, ok: c.ok === true, count: c.count ?? 0, rows: c.rows ?? [], note: c.note ?? null,
        })),
      }
    : null,
  suite: suite
    ? {
        ran: suite.ran === true,
        red: suite.red === true,
        reds: suite.reds ?? [],
        reds_total: suite.reds_total ?? (suite.reds ?? []).length,
        log: suite.log ?? null,
      }
    : null,

  // ── WHOSE NIGHT IS THIS. Top-level because it is the first thing read, and
  // null on a crossing that did not refuse — an absent field and a field saying
  // "we could not tell" are different states and the receipt must keep them so.
  class: refusal?.class ?? null,
  next_step: refusal?.next_step ?? null,
  refusal: refusal
    ? {
        cause: refusal.cause ?? "",
        ref: refusal.ref ?? null,
        paths_in_canon: refusal.paths_in_canon ?? [],
        paths_in_inputs: refusal.paths_in_inputs ?? [],
        errors_claimed: refusal.errors_claimed ?? null,
        errors_seen: refusal.errors_seen ?? null,
      }
    : null,

  detail: env("SETTLEMENT_DETAIL") ?? "",
};

process.stdout.write(`${JSON.stringify(receipt, null, 1)}\n`);
