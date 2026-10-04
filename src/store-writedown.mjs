// store-writedown.mjs — the store's write-down, in the drain's place (G1 lane 3).
//
// ── WHAT THIS IS, AND WHAT IT DELIBERATELY IS NOT ────────────────────────────
//
// G1 makes the store the only source. The chain that crosses the town used to
// read household sketchbook branches that the drain had filled from the sqlite
// journal, which was itself a copy of what the store already held:
//
//     store  ->  journal copy  ->  drain  ->  draft/<household>  ->  sweep  ->  fold
//
// Two lossy hops, and the five acts with no journal twin on 2026-09-06 are what
// a lossy hop looks like from the outside: the fold could not see them because a
// COPY failed, not because the store lacked them.
//
// This module removes both hops and nothing else:
//
//     store  ->  draft/<household> (local, never pushed)  ->  sweep  ->  fold
//
// THE FOLD ITSELF IS NOT TOUCHED, AND THAT IS THE WHOLE DESIGN. The grammar that
// decides what publishes — `tools/settlement-sweep.mjs`, `tools/marks-fold.mjs`,
// `tools/settlement-isolate.mjs` — lives in the WORLD repo and is the world's
// law, not the office's. Reader 1's risk paragraph (`jetto-g1-measure-report.md`
// § Reader 1) is explicit that the chain's most valuable machinery is everything
// wrapped around the fold, and that a rewrite which reorganises it is how four
// dated defects come back. So the store path does not teach the sweep a new
// input. It hands the sweep the input it already understands — local sketchbook
// branches — and lets the world's own law judge them exactly as before.
//
// Proven before it was written (the reproduce-first rule), on the box, against a
// clone of the live settlement clone at S63 `256db2fe`: with every
// `refs/remotes/origin/draft/*` deleted and ONE local `refs/heads/draft/*`
// carrying a store-written record, `surveySketchbooks` returned
// `{branches:1, delta_rows:1}`, `draftBranches` returned that one branch, and
// `markDelta` reported the record as an addition. A local-only sketchbook is
// fully visible to the sweep. Receipt: `docs/2026-09-08/jetto-g1-chain-report.md`
// § The design.
//
// ── THE TRAP THIS MODULE EXISTS TO CLOSE ─────────────────────────────────────
//
// The settlement clone is long-lived and its origin is the world repo, so it
// ALREADY holds `refs/remotes/origin/draft/*` — 40 of them on the box today —
// left over from the git era. `settlement-sweep.mjs:325-338` surveys local and
// remote draft refs together, and `:364-379` materializes any remote draft with
// no local counterpart into a local tracking branch. So a store crossing that
// merely stopped FETCHING sketchbooks would still fold every stale git-era
// sketchbook sitting in the clone, silently, and its receipt would say the store
// was the source.
//
// `clearGitSketchbooks` is therefore not hygiene. It is the correctness argument
// for `source: store` meaning what it says, and it runs before the write-down,
// never after.
//
// ── WHAT IS REUSED, RATHER THAN REWRITTEN ────────────────────────────────────
//
// `writeDownHousehold` (world-drain.mjs) does the git half: the private index,
// the content-addressed tree, the compare-and-swap on the ref, the idempotence,
// and GATE A — "a mark's directory is its historical filing: it never moves
// again" (founder-ruled 2026-08-25). All of that is as load-bearing for a store
// write-down as for a journal one, and none of it is about where the rows came
// from. `markRecord` (mark-record.mjs) stays the ONE serializer, for the reason
// its own header gives: two copies of a serialization is how two eras come to
// disagree about the bytes of the same declaration.
//
// Env: WORLD_CLONE (default), and nothing else. This module opens no database
// and holds no credential — the store read is the caller's, handed in as data.

import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

import { sketchbookNameForKey } from "./household-logins.mjs";
import { markRecord } from "./mark-record.mjs";
import { ROOT_PREFIX, pathFor } from "./world-journal.mjs";
// The declared-parent law (postmark#3020) — the word, the predicate and the
// sentence, minted once and shared with the amend door.
import { OUTSIDE_DECLARED_PARENT, declaredParentRefusal, outsideParentDetail } from "./mark-declared-parent.mjs";
import { draftBranch, mainRef } from "./world-branches.mjs";
import { fileFramer, sketchbookBase, writeDownHousehold } from "./world-drain.mjs";
import { WORLD_CLONE } from "./world-store.mjs";
// THE ONE COPY of "what is a docket count", from the module that produces the
// field. The CLI's incomplete-selection refusal reads the same predicate, so the
// producer, the gate and the guard cannot drift into three spellings of it.
import { isDocketCount } from "../world2/tools/fold-delta.mjs";

const git = (repo, args, opts = {}) => execFileSync("git", ["-C", repo, ...args], {
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
  stdio: ["pipe", "pipe", "pipe"],
  ...opts,
});

/**
 * THE TOWN IS NOT A HOUSEHOLD.
 *
 * It owns the LOGOS law nodes, which reach canon by PR and ingest and never by a
 * crossing. The store materializes them into `marks` with a household column
 * like any other row, so nothing in the fold's input distinguishes a law node
 * from a resident's home unless something says so here.
 *
 * Spelled as a bare `"the-town"` because that is this office's own spelling
 * (`world-grants.mjs:309`, `world-apex.mjs:1679`, `world-store.mjs:207`), and
 * matched against both the prefixed household key the store uses (`solo:the-town`)
 * and the bare form, because both shapes reach this module.
 */
const TOWN = "the-town";
const isTheTown = (household) => {
  const k = String(household ?? "");
  return k === TOWN || k.slice(k.indexOf(":") + 1) === TOWN;
};

/** A refusal that names itself, so the chain can put the reason in the receipt verbatim. */
export class FoldInputRefusal extends Error {
  constructor(reason, detail) {
    super(`${reason}: ${detail}`);
    this.name = "FoldInputRefusal";
    this.reason = reason;
    this.detail = detail;
  }
}

// ── THE SEAM WITH LANE 2, NAMED IN ONE PLACE ─────────────────────────────────
//
// Lane 2 (`jetto/g1-render-stakes`) owns the store-side render and the
// store-derived stakes. IT HAS LANDED (`a5ccd224`) and the shape below is no
// longer an assumption — it is read off that file and cited where it is
// consumed. The earlier version of this comment said the branch "carries no
// code"; that was true when written and is kept in the history rather than here.
//
//   entry point   -> { marks: [{ slug, kind, by, household, locked_window, bytes }],
//                      stakes: [{ tick, holder, mark, n, weight }],
//                      as_of: { window, town_sha, world_sha } }
//
// `slug` is the FULL identity, not a leaf. A mark entry is normalized by
// `normalizeMark` below, which accepts the record shape and the bytes shape and
// says why it prefers the first.
export const FOLD_INPUT_CONTRACT = Object.freeze({
  source: "world2/tools/fold-input.mjs § foldInputFromStore / fold-delta.mjs § foldDelta",
  confirmed: true,
  top_level: Object.freeze(["marks", "stakes", "as_of"]),
  as_of: Object.freeze(["window", "world_sha", "town_sha"]),
  stake_row: Object.freeze(["holder", "mark", "n", "weight", "tick"]),
});

/**
 * ONE MARK, NORMALIZED TO THE SHAPE THE GIT HALF ALREADY SPEAKS.
 *
 * The preferred shape carries a RECORD (`fileRec` + `body`), because then
 * `markRecord` serializes it here exactly as it serializes a drained one, and
 * "a store-rendered record is byte-identical to what the drain would have
 * written" stays a falsifiable claim rather than two writers agreeing by luck.
 *
 * The bytes shape is accepted, because lane 2's brief describes its renderer as
 * returning "the `mark.md` bytes", and a chain that refuses its own supplier is
 * not a chain. But it is accepted with its cost stated: when only bytes arrive,
 * this module cannot re-derive them, so the receipt says so (`serialized_here:
 * false`) rather than implying a check that did not happen.
 *
 * When BOTH arrive, they are compared, and a mismatch REFUSES. That comparison
 * is the whole reason to accept both: it is the only place in the chain where
 * the two eras' serializations can be caught disagreeing about one mark.
 */
export function normalizeMark(m) {
  // ── LANE 2's SHAPE, NOW CONFIRMED AND CITED ────────────────────────────────
  //
  // `world2/tools/fold-input.mjs § foldInputFromStore` (lane 2, `a5ccd224`)
  // returns each mark as `{ slug, kind, by, household, locked_window, bytes }`.
  //
  // `slug` IS THE FULL IDENTITY, not a leaf. The store's own column comment says
  // so — `world2/schema/001_tables.sql:102`: *"slug text NOT NULL UNIQUE —
  // <owner>/<name>, the 1.0 path identity"* — and taking it for a leaf would file
  // every mark one directory too deep, silently, since the path would still
  // parse. The `id`/`by`+`slug` form below is the older shape this accepted
  // while lane 2 was unpushed; it is kept because `writeDownHousehold` speaks the
  // leaf form and the drain's callers still use it.
  const id = m?.slug ?? m?.id ?? (m?.by && m?.leaf ? `${m.by}/${m.leaf}` : null);
  if (!id) {
    throw new FoldInputRefusal(
      "mark-without-id",
      `a mark entry carries neither \`id\` nor \`by\`+\`slug\`: ${JSON.stringify(m).slice(0, 200)}`,
    );
  }
  const by = m.by ?? String(id).split("/")[0];
  // The LEAF, always derived from the identity rather than read from a field, so
  // there is one place this split happens and no shape can disagree with itself.
  const slug = String(id).split("/").slice(1).join("/");
  const household = m.household ?? null;
  if (!household) {
    throw new FoldInputRefusal(
      "mark-without-household",
      `${id} names no household, so it has no sketchbook to land in. The git path dropped such a row silently (world-drain.mjs planDrain: "a row with no household has no sketchbook to land in"); the store path refuses, because in the store a standing mark with no household is a defect and not an ordinary quiet row`,
    );
  }

  const hasRecord = m.fileRec !== undefined && m.fileRec !== null;
  const hasBytes = typeof m.bytes === "string" && m.bytes.length > 0;
  if (!hasRecord && !hasBytes) {
    throw new FoldInputRefusal(
      "mark-without-content",
      `${id} carries neither \`fileRec\`+\`body\` nor \`bytes\` — nothing to write down`,
    );
  }

  let bytes = null;
  let serializedHere = false;
  let disagreement = null;
  if (hasRecord) {
    bytes = markRecord(m.fileRec, m.body ?? "");
    serializedHere = true;
    if (hasBytes && m.bytes !== bytes) disagreement = { supplied: m.bytes, derived: bytes };
  } else {
    bytes = m.bytes;
  }

  if (disagreement) {
    throw new FoldInputRefusal(
      "serialization-disagreement",
      `${id}: the bytes the store side rendered are not the bytes \`markRecord\` derives from the same record. `
      + `Two writers disagreeing about one declaration is exactly what mark-record.mjs exists to prevent `
      + `("two copies of a serialization is how two eras come to disagree about the bytes of the same declaration"). `
      + `supplied ${disagreement.supplied.length} bytes, derived ${disagreement.derived.length} bytes`,
    );
  }

  return {
    id, by, slug, household,
    fileRec: hasRecord ? m.fileRec : null,
    body: hasRecord ? String(m.body ?? "") : null,
    bytes,
    serialized_here: serializedHere,
    // The window the store locked this mark at, carried so the crossing can say
    // which of the marks it wrote are THIS crossing's and which are older
    // standing rows that merely arrived in the same answer. Lane 2 supplies it;
    // null from any other supplier, and null is reported rather than assumed.
    locked_window: Number.isFinite(m.locked_window) ? Number(m.locked_window) : null,
    kind: m.kind ?? null,
    // Reported, never a filter — see the unbound-household block in storeWriteDown.
    founder_commit: m.founder_commit ?? null,
    // A path the supplier already knows wins over one we compute — but GATE A in
    // `writeDownHousehold` still overrides both when the branch already files
    // this mark somewhere, which is the freeze and is not ours to weaken.
    plannedPath: m.path ?? null,
    // WHICH FRAME the record's `at`/`points` are in — `"world"` (the door's
    // grammar: a position as the resident spoke it) or `"file"` (the file's own
    // numbers, kept from the seed). Named by the supplier (`mark-render.mjs §
    // frameOfRow`), because the bytes cannot say and the plan must: a world
    // number landing at a nested frozen path is framed there, once; a file
    // number is left alone. `null` is a supplier that did not say, and at a
    // nested path that refuses rather than guessing — see § THE ONE FRAMER.
    at_frame: m.at_frame === "world" || m.at_frame === "file" ? m.at_frame : null,
  };
}

/**
 * THE FOLD INPUT, VALIDATED LOUDLY.
 *
 * The brief's word is "refusing loudly when the store cannot answer", and the
 * distinction this function keeps is the one the receipt composer already keeps
 * for its own fields: an ABSENT answer and an EMPTY one are different states. A
 * missing `as_of.window` is a store that could not say which window it folded —
 * a refusal. A `marks: []` is a store that answered "nothing stands", which is a
 * lawful answer here and is refused one level up by the sweep's own loud-empty
 * guard, where that judgment belongs.
 */
export function normalizeFoldInput(input) {
  if (!input || typeof input !== "object") {
    throw new FoldInputRefusal("no-fold-input", "the store side returned nothing this crossing could read");
  }
  if (input.refused) {
    throw new FoldInputRefusal(String(input.refused), String(input.detail ?? "the store side refused without a detail"));
  }
  for (const key of FOLD_INPUT_CONTRACT.top_level) {
    if (input[key] === undefined || input[key] === null) {
      throw new FoldInputRefusal("fold-input-incomplete", `the store side returned no \`${key}\``);
    }
  }
  if (!Array.isArray(input.marks)) throw new FoldInputRefusal("fold-input-shape", "`marks` is not an array");
  if (!Array.isArray(input.stakes)) throw new FoldInputRefusal("fold-input-shape", "`stakes` is not an array");
  for (const key of FOLD_INPUT_CONTRACT.as_of) {
    if (input.as_of[key] === undefined || input.as_of[key] === null || input.as_of[key] === "") {
      throw new FoldInputRefusal(
        "as-of-incomplete",
        `\`as_of.${key}\` is absent. The keeper reads this triple to tell a quiet crossing from a blind one, `
        + `which is the 2026-08-26 starving-crossing shape in a new dress — a crossing that cannot say what it folded at must not publish`,
      );
    }
  }
  return {
    marks: input.marks.map(normalizeMark),
    stakes: input.stakes,
    // WHICH MODULE ANSWERED. Carried through to the receipt because `source:
    // store` alone does not say WHOSE store read it was: a rehearsal instrument
    // and lane 2's entry point both produce a fold input, and a crossing folded
    // by an instrument must not be indistinguishable from one folded by the
    // register. Null when the supplier did not say, which is itself the finding.
    entry: input.entry ?? null,
    // A REHEARSAL SAYS SO ON ITS OWN RECEIPT. The module name alone cannot carry
    // this: a rehearsal instrument placed at a candidate path answers under that
    // path's name and reads as the real thing. So the supplier declares it, the
    // receipt shows it, and the chain shouts it — a crossing that folded from an
    // instrument is legible as one at a glance, forever, in the history file.
    rehearsal: input.rehearsal === true,
    // WHERE THE STORE'S ESCROW INGEST STANDS against the town this crossing
    // fetched — `world2/tools/fold-input-cli.mjs § ingestOrdering`. Carried to
    // the receipt because an ingest that has stopped running looks exactly like
    // a quiet town, and `behind` climbing across successive receipts is the only
    // thing that would say so.
    ingest: input.ingest ?? null,
    // HOW THE FOLD CHOSE ITS MARKS — `docket` (the closed window's locked set,
    // which is provenance) or `standing` (everything the store holds, which is
    // not). The two produce very different amounts of canon and must never be
    // told apart by reading the code that happened to be deployed.
    //
    // THE FIELDS, and `docket_claims` is the one that is also read rather than
    // only shown:
    //   `by`          — `docket`, the only selector there is
    //   `window`      — which window's docket
    //   `entry`       — the module that selected, checked against the module the
    //                   CLI actually called
    //   `docket_claims` — HOW MANY CLAIMS THE CANDLE LOCKED AT THAT WINDOW, read
    //                   from `claims` by `fold-delta.mjs § foldDelta`. The
    //                   loud-empty guard's third input: beside `marks` on the
    //                   receipt it separates "nobody claimed" (`0, 0` — lawful)
    //                   from "the store did not answer" (`33, 0` — refused).
    //                   Absent from a supplier that does not say, and absent
    //                   means the guard refuses as it did before the field.
    //   `note`        — an empty channel, named rather than omitted
    selection: input.selection ?? null,
    as_of: {
      window: input.as_of.window,
      world_sha: input.as_of.world_sha,
      town_sha: input.as_of.town_sha,
    },
  };
}

/**
 * THE PLAN, PURE. Marks in, per-household write-downs out. No git, no store, no
 * clock — the same property `planDrain` has and for the same reason: the sorting
 * decision is falsifiable without building a repo.
 *
 * `publishedPathOf` answers where canon already keeps a mark, and it is injected
 * rather than read, so the pure half stays pure. GATE A before GATE B, exactly
 * as `planDrain` does it.
 */
export function planStoreWriteDown(marks, { publishedPathOf = null, canonBytesAt = null, toFileFrame = null } = {}) {
  const byHousehold = new Map();
  const bucket = (h) => {
    if (!byHousehold.has(h)) byHousehold.set(h, { household: h, upserts: [], removals: [] });
    return byHousehold.get(h);
  };

  // ── A NESTED MARK FILES UNDER ITS PARENT (S93, 2026-10-03) ──────────────────
  //
  // `pathFor` files a mark that is neither sited nor a parcel (a naming mark, a
  // predicate) at its parent's directory, but only when it is asked where the
  // parent is. This plan never asked, so every such mark with a `parent_id` fell
  // through to the root prefix: Jiang Haijing's naming mark
  // (call-it-fengtian-lou) filed at WORLD/marks/let-there-be-light/ instead of
  // under her parcel, and the keeper refused S93 on it. `planDrain` has always
  // asked (world-drain.mjs § pathOf), and this is its answer in the store's
  // terms: a parent in this same crossing files where THIS plan files it (a
  // parcel and its name can arrive together); otherwise canon's filing; with
  // neither, the root fallback, as before.
  const byId = new Map(marks.map((m) => [m.id, m]));
  const plannedPathOf = new Map();
  const planPath = (m, seen) => {
    if (plannedPathOf.has(m.id)) return plannedPathOf.get(m.id);
    const kind = m.fileRec?.kind ?? m.kind ?? null;
    const path = m.plannedPath ?? (kind ? pathFor(
      { ...(m.fileRec ?? {}), kind, id: m.id, by: m.by, slug: m.slug },
      {
        publishedPathOf,
        parentPathOf: (pid) => {
          // a cycle in parent_id answers the root fallback rather than looping
          if (seen.has(pid)) return null;
          const parent = byId.get(pid);
          const pp = parent ? planPath(parent, new Set([...seen, m.id]))
            : (typeof publishedPathOf === "function" ? publishedPathOf(pid) : null);
          return pp ? pp.replace(/\/mark\.md$/, "") : null;
        },
      },
    ) : null);
    plannedPathOf.set(m.id, path);
    return path;
  };

  const unchanged = [];
  const framed = [];
  for (const m of marks) {
    // `kind` RIDES SEPARATELY AND IT IS LOAD-BEARING. `pathFor` takes GATE A/B —
    // the freeze's "an existing filing never moves", then "a new mark files at
    // its id" — ONLY for `kind` of `sited` or `parcel` (`world-journal.mjs:795`);
    // everything else falls through to the parent-or-root branch. Lane 2 supplies
    // `kind` as a column beside the bytes rather than inside a record, so a
    // caller that only spread `fileRec` would hand `pathFor` no kind at all and
    // file every sited mark under the root prefix instead of at its identity.
    // Caught by F7a: the mark landed, at the wrong path, and the test that
    // noticed was the one comparing against canon's bytes rather than the one
    // checking a file existed.
    const kind = m.fileRec?.kind ?? m.kind ?? null;
    if (!m.plannedPath && !kind) {
      // A MISSING `kind` IS A MISFILING, NOT A MISSING FIELD. `pathFor` takes
      // Gate A/B only for `sited` and `parcel`; with no kind it falls through to
      // the root-prefix branch and files the mark at
      // `WORLD/marks/let-there-be-light/<slug>/mark.md` — a real path, which
      // parses, which the sweep will publish, and which is not where the mark
      // lives. Nothing downstream can tell that apart from a deliberate filing.
      // So it refuses here rather than landing somewhere plausible.
      throw new FoldInputRefusal(
        "mark-without-kind",
        `${m.id} carries no \`kind\`, and \`pathFor\` needs one to take the freeze's Gate A/B `
        + "(world-journal.mjs:795 — the filing branch is `sited` or `parcel` only). Without it the mark files under "
        + "the root prefix instead of at its identity: a plausible path, silently wrong, that the sweep would publish.",
      );
    }
    const path = planPath(m, new Set());
    if (!path) {
      throw new FoldInputRefusal(
        "mark-without-path",
        `${m.id} resolves to no path — neither canon's filing nor its id can place it`,
      );
    }

    // ── THE ONE FRAMER, at the one place a row becomes a file (2026-09-18) ────
    //
    // The rule is #2151's: the record stores what the resident spoke — WORLD
    // coordinates — and the carriage into a filing path converts exactly once,
    // at the moment it decides the path. In the git era that moment was
    // `planDrain`, with `fileFramer` injected; G1 (2026-09-08) put this module
    // in the drain's place and carried the bytes without the framer. It could
    // not have framed them: the fold's entry handed it bytes alone, and bytes
    // do not say which frame their numbers are in.
    //
    // THE THIRD BITE (postmark#2865, the Worldkeeper's 2026-09-18 02:01 EDT
    // refusal of S72): Berthillon's image-only amend of `le-petit-berthillon`
    // carried `at: (221, 95.5)` — the shop's WORLD position — in a record
    // `materialize.mjs` had rewritten from the claim (no `_fileAt`); Gate A
    // filed it at its frozen path under `the-town-centre`, whose origin is
    // (-54, -79.5); the fold read 221/95.5 as an offset. World (167, 16): the
    // shop 54 m west and 79.5 m north, `chez-antoine` no longer its parent,
    // the cones reparented. Suite green, relation wrong, S72 refused twice.
    // A CREATE never reaches this: Gate B files it at `WORLD/marks/<by>/<slug>/`,
    // which is root-framed, so the world number IS the file number.
    //
    // So: a WORLD-framed record landing at a NESTED path is framed here, by
    // the drain's own `fileFramer` (path first, `parent_id` the fallback), and
    // its bytes re-derived by `markRecord` — the same serializer, once. A
    // FILE-framed record (the seed's `_fileAt`) is the file's own numbers in
    // the file's own frame and is left as it is. The nested test is
    // `planDrain`'s, verbatim. What this module will NOT do is write a world
    // number raw at a nested path because nobody handed it a framer or a
    // frame: that is the bug, and it refuses instead — a stopped crossing is a
    // finding; a moved shop under a green suite is the thing this exists to
    // make impossible.
    const nested = path.startsWith(`${ROOT_PREFIX}/`)
      && path.slice(ROOT_PREFIX.length + 1).split("/").length > 2;
    const rec = m.fileRec ?? null;
    // Bytes alone can still be SEEN to carry a position, even if they cannot be
    // framed: a bytes-only supplier at a nested path is refused below, not
    // waved through as "nothing to frame".
    const positioned = rec ? !!(rec.at || rec.points) : /^(at|points):/m.test(String(m.bytes ?? ""));
    let fileRec = rec, body = m.body, bytes = m.bytes;
    if (nested && positioned && m.at_frame !== "file") {
      if (!rec || m.at_frame !== "world") {
        throw new FoldInputRefusal(
          "mark-frame-unnamed",
          `${m.id} lands at the nested filing ${path} carrying \`at\`/\`points\`, and its supplier `
          + (rec ? "did not say which frame those numbers are in (`at_frame` is neither `world` nor `file`)"
            : "handed bytes with no record to frame (`fileRec`/`body` absent)")
          + ". A world number written raw into a frame-relative file is the 2026-09-18 Berthillon carriage "
          + "(postmark#2865); refusing rather than guessing.",
        );
      }
      if (typeof toFileFrame !== "function") {
        throw new FoldInputRefusal(
          "mark-frame-unavailable",
          `${m.id} lands at the nested filing ${path} with world-framed \`at\`/\`points\` and no framer was available `
          + "(`fileFramer` returned null: the world tree does not declare `coords: relative`, or its fold could not be "
          + "read). The drain would have written the world number raw here — the pando-peak and Berthillon carriages — "
          + "so this refuses instead.",
        );
      }
      // ── THE POINT MUST BELONG AT THE PATH (postmark#3020, Keemin 2026-09-20) ─
      //
      // The conversion below is faithful and always was — that is the 2026-09-18
      // fix and it is not in question. What it cannot notice on its own is that
      // the world number it was handed does not belong at the filing it is
      // framing FOR. The Snug mooring: an amend carrying a point five kilometres
      // from the harbour it is filed in, converted correctly into a file that
      // then said "in the harbour" over a geometry that said "at sea", and stood
      // there through S71, S72 and S73.
      //
      // The path declares the parent, so the path and the point have to agree.
      // When they do not, this row refuses EXACTLY as the three frame refusals
      // above it do, and that is said precisely rather than comfortably: a
      // `FoldInputRefusal` is THROWN, so it refuses the CROSSING, not just the
      // row. `deploy/settlement-classify.mjs` grades it and
      // `deploy/refused-marks.mjs` names it, both off the generic shape — neither
      // enumerates reason words, so a new word needs no change there and gets
      // none. (`tools/settlement-isolate.mjs`, the pass that keeps one bad mark
      // from refusing the town, answers a RED SUITE and not a fold-input
      // refusal; this does not reach it, and nothing here changes that either
      // way.) A declared-parent refusal is therefore a loud stop, chosen because
      // the alternative is a mark in the wrong place forever — the same trade
      // the three refusals above already make.
      //
      // The predicate is the clone's own `pointWithinMark`, riding the framer;
      // the door runs the same one over the same parent and refuses under the
      // same word, and `mark-outside-declared-parent.test.mjs` asserts the two
      // agree on these numbers rather than trusting that they do.
      // THE NARROWING (Keemin, 2026-09-20): only an amend that actually MOVES
      // the ground is asked the containment question. Measured over the live
      // record, the unnarrowed guard would have refused nine standing marks'
      // next amend, and eight of them are outside a region whose ring the
      // FOUNDER redrew on 2026-08-24 — not their owners' act, and a words-only
      // amend of one of those must go through. `declaredParentRefusal` carries
      // the gate so that neither door can hold it and the other forget it; the
      // prior here is the last published fold's own record for the mark, which
      // is in world coordinates exactly as this row's numbers are.
      const declared = typeof toFileFrame.declaredParentOf === "function" ? toFileFrame.declaredParentOf(path) : null;
      const standing = typeof toFileFrame.standingMark === "function" ? toFileFrame.standingMark(m.id) : null;
      const outside = declared && declaredParentRefusal({
        id: m.id, prior: standing, next: rec,
        parentId: declared.parentId, parent: declared.parent, pointWithinMark: toFileFrame.pointWithinMark,
      });
      if (outside) throw new FoldInputRefusal(OUTSIDE_DECLARED_PARENT, outsideParentDetail(outside, path));

      const shifted = toFileFrame({ at: rec.at ?? null, points: rec.points ?? null, parent_id: rec.parent_id ?? null, path });
      if (!shifted || !Object.keys(shifted).length) {
        throw new FoldInputRefusal(
          "mark-frame-unresolved",
          `${m.id} lands at the nested filing ${path} with world-framed \`at\`/\`points\`, and the framer could not `
          + "resolve a frame for that path (no enclosing mark the fossil manifest names carries a centre in the folded "
          + "state). Null means do not convert, and an unconverted world number at a nested path is a moved mark.",
        );
      }
      fileRec = { ...rec, ...shifted };
      body = String(m.body ?? "");
      bytes = markRecord(fileRec, body);
      framed.push({ id: m.id, path, from: { at: rec.at ?? null, points: rec.points ?? null }, to: shifted });
    }

    // ── A CROSSING NEVER RE-MATERIALIZES A MARK IT IS NOT CHANGING ────────────
    //
    // The rule, and lane 2 is where it comes from: their `mark-render.mjs`
    // header states the honest narrow claim — *"A MARK A CROSSING WRITES renders
    // byte-identical from the store"* — and says why the corpus-wide claim is
    // not available. Measured on the live corpus at `a5ccd224`: 75 distinct
    // frontmatter field orders on disk, 40+ distinct keys against the door's 13,
    // `extent: { w, h }` on 510 files and `{ h, w }` on 36, and two value forms
    // for `points`. None of that is the store's fault and none of it is
    // reachable, because the door refuses those fields today and jsonb has no
    // key order to return.
    //
    // So a fold that re-rendered every standing mark would REWRITE the whole
    // town's history into the door's present grammar, on one crossing, under a
    // receipt that said it published a handful of marks. The git chain never
    // could: `writeDownHousehold` builds its tree from the base, so a mark no
    // sketchbook touched keeps the bytes it already has.
    //
    // ── THIS IS AN ECONOMY INSIDE THE DOCKET. IT IS NOT THE SELECTOR. ────────
    //
    // AN EARLIER VERSION OF THIS COMMENT ARGUED THE OPPOSITE and the correction
    // is left visible rather than swapped out, because a reader who believed the
    // old sentence would decline to add the filter that actually matters. It
    // said this content check was preferable to a window filter, on the grounds
    // that "a window filter trusts the supplier to have sent only the delta".
    // That is backwards. The supplier's docket IS the provenance — a mark
    // belongs to this crossing because the candle locked it at this window — and
    // a byte comparison is not provenance at all. It happens to narrow 1,031
    // rows to 813, which is not a delta; it is the whole corpus minus whatever
    // renders identically, and it makes the fold's membership depend on the
    // RENDERER, so a change to a field's spelling would silently rewrite eight
    // hundred records.
    //
    // The selector is `foldDelta(client, { window })`, upstream, and the chain
    // REFUSES without it. What this line does, inside that docket, is decline to
    // rewrite a docket mark whose bytes canon already holds — which is worth
    // doing (23 of 33 at window 177) and is worth nothing on its own.
    const canon = typeof canonBytesAt === "function" ? canonBytesAt(path) : null;
    if (canon !== null && canon === bytes) {
      unchanged.push({ id: m.id, path, household: m.household, locked_window: m.locked_window });
      continue;
    }

    bucket(m.household).upserts.push({
      id: m.id, by: m.by, slug: m.slug, path,
      fileRec, body, bytes,
    });
  }

  for (const b of byHousehold.values()) b.upserts.sort((a, c) => a.path.localeCompare(c.path));

  const written = marks.filter((m) => !unchanged.some((u) => u.id === m.id));
  const byWindow = {};
  for (const m of written) {
    const w = m.locked_window === null ? "unknown" : String(m.locked_window);
    byWindow[w] = (byWindow[w] ?? 0) + 1;
  }

  return {
    households: [...byHousehold.values()].sort((a, b) => a.household.localeCompare(b.household)),
    unchanged,
    // THE ROWS THE FRAMER TOUCHED, each with the number that arrived and the
    // number that was written. On the receipt because the failure this closes
    // was silent: a crossing that framed nothing while a nested amend was in
    // its docket is the moved shop, and this is the surface on which it shows.
    framed,
    counts: {
      marks: marks.length,
      written: written.length,
      unchanged: unchanged.length,
      framed: framed.length,
      households: byHousehold.size,
      // WHICH WINDOWS THE WRITTEN MARKS WERE LOCKED AT. The delta contract says a
      // crossing's fold should carry the window's own locked marks; this is the
      // measurement that says whether it does. A crossing writing marks locked at
      // windows long past is folding standing state rather than a delta, and this
      // histogram is where that shows without anyone having to diff a tree.
      written_by_locked_window: byWindow,
    },
  };
}

/**
 * THE LOUD-EMPTY GUARD, RE-DERIVED FOR THE STORE ERA.
 *
 * The git-era guard lives in the world's sweep (`settlement-sweep.mjs:1244-1251`)
 * and its evidence is branch-shaped: *"the sweep found no candidates on any
 * channel, but N escrow-backed mark(s) stand in SKETCHBOOKS"*. In the store era
 * there are no sketchbooks to be starved about, so it cannot fire. Measured, not
 * assumed: an empty store fold on a scratch produced zero sketchbooks and
 * `SETTLEMENT-SWEEP-STARVING` never appeared — the crossing was caught one layer
 * down by `marks-fold.mjs`'s stampless refusal instead. **The guard survived the
 * cutover syntactically and died semantically**, and that is why this exists.
 *
 * THE SHAPE IS THE ORIGINAL'S, and deliberately so — the original's whole design
 * is that it *"re-derives that question by a different path"*, so a guard that
 * asked the same array twice would be a check that cannot disagree with itself:
 *
 *   the FIRST path  — the marks the fold is going to write
 *   the SECOND path — the escrow positions, which come from a different table
 *                     (`escrow_projection`, lane 2's P-006) filled by a
 *                     different writer (`stamp-ingest.mjs`, inside the
 *                     clearing's transaction) at a different time
 *
 * A crossing that writes NOTHING while the store holds staked marks is not a
 * quiet day. A crossing that writes nothing while nothing is staked is.
 *
 * AND IT MUST NOT FIRE ON A LAWFULLY QUIET DELTA, which is the trap: under the
 * delta contract a crossing may honestly carry no changed mark. That is why the
 * test is on what the fold was OFFERED, not on what it wrote — an offered set
 * that is empty while escrow stands is a store that did not answer; an offered
 * set that is entirely unchanged is a town where nothing moved, and those are
 * different states that a `written === 0` test would collapse into one.
 *
 * ── THE THIRD INPUT, AND WHY THE FIRST TWO WERE NOT ENOUGH (2026-09-09) ──────
 *
 * The paragraph above is right about which two states must not be collapsed and
 * was wrong about what `marks` is. Under `foldDelta` the OFFERED set IS the
 * docket, so "nobody claimed in this window" and "the docket had rows and the
 * mark read returned none" reached this function as the same value —
 * `marks.length === 0` — and the collapse the header was written to prevent
 * happened one field earlier than the field it inspected. The guard fired on
 * exactly the lawfully quiet delta it forbids itself.
 *
 * IT WAS NOT RARE. Measured read-only on prod, 2026-09-09, over all 30 closed
 * windows the store has ever had: 6 of them (151, 156, 157, 158, 165, 167 — one
 * in five) had an empty docket. Rehearsed end to end on a `pg_dump` scratch of
 * prod at window 180: `SETTLEMENT EXIT=1`, `world_to` empty, and a refusal
 * naming a resident's mark for a crossing in which no resident did anything.
 *
 * SO THE DOCKET'S SIZE IS PASSED IN, from `fold-delta.mjs § foldDelta`, read
 * from `claims` and not from the `marks` array this function already holds —
 * see that file for why a same-array size would be a check that cannot disagree
 * with itself. With it:
 *
 *   docketClaims === 0            → a lawful quiet crossing. Nobody locked a
 *                                 claim; there is nothing for the store to have
 *                                 failed to answer.
 *   docketClaims > 0, marks empty → `store-starving`, exactly as before. The
 *                                 docket had rows and the mark read returned
 *                                 none while escrow stands: the disagreement.
 *   docketClaims === null         → `store-starving`, exactly as before. A
 *                                 supplier that will not say how big its docket
 *                                 was has not proved the day was quiet, and an
 *                                 unproved quiet is the 2026-08-26 shape. The
 *                                 register's own entry point always says.
 *   anything else                 → `fold-input-shape`. A count is a
 *                                 non-negative integer; `""`, `false` and `[]`
 *                                 all coerce to 0 and would have read as "the
 *                                 docket was empty" on the last guard before
 *                                 publication. See `fold-delta.mjs §
 *                                 isDocketCount`, which is the one copy of that
 *                                 rule and is shared with the CLI.
 *
 * ── WHAT THIS GUARD NOW RESTS ON, SAID OUT LOUD (reviewer, 2026-09-09) ───────
 *
 * Reading the docket from `claims` buys a second path, and it buys one premise
 * with it: **that every locked claim names a mark.** There is exactly one code
 * path where that is false by design — `world2/tools/materialize.mjs:122`:
 *
 *     const named = claims.filter((c) => slugOf(c));   // a stake or escrow
 *                                                      // claim names no mark
 *
 * A locked claim that names no mark is never materialized, so a window whose
 * whole docket was slugless would arrive here as `docketClaims > 0` with an
 * empty mark read while escrow stands — and would refuse, wrongly, because that
 * is a LAWFUL crossing.
 *
 * IT IS NOT REACHABLE TODAY, and that is measured rather than asserted.
 * Read-only on prod, 2026-09-09, over every claim the store holds:
 *
 *   · 831 slugless locked claims, **every one of them at window 150** — the seed
 *     import, which wrote its marks directly rather than through `materialize`
 *     (150 carries 831 locked claims, all slugless, and 820 marks)
 *   · **zero** slugless locked claims at any window after 150
 *   · so window 150 is the one window in the store's history whose entire docket
 *     is slugless — and `foldDelta` folds only the NEWEST closed window, which
 *     150 has not been for thirty windows
 *
 * The live door composes a slug on every path, which is why the count stops at
 * the import. **If that ever stops being true — a claim class that lawfully
 * names no mark reaching a live window — this guard gets a false refusal, and
 * the repair is to count only claims that name a mark.** Written here rather
 * than left for the next reader to rediscover, because the premise is invisible
 * from this file and the failure would arrive as a refusal naming a resident.
 */
export function starvingCheck({
  marks = [], stakes = [], docketClaims = null, carriedAbsent = 0, window = null,
} = {}) {
  const staked = stakes.filter((s) => Number(s.n) > 0);
  const stakedMarks = new Set(staked.map((s) => s.mark));
  const offered = marks.length;
  // ABSENT IS CHECKED SEPARATELY FROM VALID, and the separation is the whole of
  // it: `Number(null)` is 0, which is finite, so the obvious one-liner read a
  // supplier that said NOTHING as a supplier that said "the docket was empty" —
  // and passed quietly on precisely the crossings this guard is the last word
  // on. Caught by F8h, which is the falsifier for the absent case.
  //
  // ABSENT is the only charitable reading there is. Anything PRESENT and not a
  // count REFUSES rather than being coerced: the first version of this line
  // spelled the test `Number.isFinite(Number(docketClaims))`, which reads `""`,
  // `false` and `[]` as a docket of zero and passes them — a fail-open on the
  // last guard before publication (reviewer, 2026-09-09).
  const absent = docketClaims === null || docketClaims === undefined;
  if (!absent && !isDocketCount(docketClaims)) {
    throw new FoldInputRefusal(
      "fold-input-shape",
      `\`selection.docket_claims\` is ${JSON.stringify(docketClaims)}, which is not a count. The docket's size is a `
      + "non-negative integer or it is nothing: an empty string, a false and an empty array all become 0 under "
      + "`Number()`, and a 0 here is read as \"nobody locked a claim\" — a quiet pass on the last guard before the "
      + "crossing publishes. A supplier that cannot say how big its docket was must say NOTHING, which refuses, "
      + "rather than something that coerces to a lawful answer.",
    );
  }
  const docket = absent ? null : docketClaims;

  // ── THE FOURTH INPUT: WHICH PART OF THE OFFERED SET IS THE DOCKET'S ────────
  //                                                              (2026-09-12)
  //
  // The fold now offers this window's docket UNION every standing mark canon does
  // not carry (`world2/tools/fold-delta.mjs § foldDelta`, the second term), so
  // `offered` can lawfully exceed `docket_claims`. There were two ways to take
  // that and only one of them keeps this guard:
  //
  //   WIDEN `docket_claims` to include the carry — tidy arithmetic, and it SPENDS
  //   THE GUARD. A materialization that wrote nothing (7 claims locked, 0 marks
  //   read) alongside two carried rows would arrive here as `offered 2 > 0` and
  //   pass. The disagreement this function exists to catch would be masked by the
  //   repair, and the receipt would show a plausible number for it.
  //
  //   NAME THE CARRY AS ITS OWN TERM — what this does. The guard's subject is
  //   still the DOCKET: it tests `offered − carried`, so a carried row cannot
  //   stand in for a docket mark that never materialized. The two numbers are
  //   both on the receipt, so `offered 9 = docket 7 + carried 2` is a sentence a
  //   keeper can check rather than an identity they have to trust.
  //
  // Absent reads as zero, which is the honest default and not a charity: every
  // fold input written before this field existed carried no rows from any other
  // window, so zero is what it MEANT. The shape test is the shared one, for the
  // reason `isDocketCount` is shared at all.
  const carried = carriedAbsent ?? 0;
  if (!isDocketCount(carried)) {
    throw new FoldInputRefusal(
      "fold-input-shape",
      `\`selection.carried_absent.count\` is ${JSON.stringify(carriedAbsent)}, which is not a count. The carried rows `
      + "are subtracted from the offered set to find the docket's own, and a value that coerces to 0 would hand this "
      + "guard a docket larger than the one the fold actually read.",
    );
  }
  // A SUBSET CANNOT BE LARGER THAN ITS SET, and the reason to say so here is that
  // the next line is a SUBTRACTION. A supplier claiming more carried rows than it
  // offered would produce a negative `docket_offered`, which is not `> 0`, so it
  // would fall through to the quiet branches and read as "the docket offered
  // nothing" — a wrong input arriving as a lawful-looking answer.
  if (carried > offered) {
    throw new FoldInputRefusal(
      "fold-input-shape",
      `the fold says it carried ${carried} canon-absent mark(s) and offered only ${offered}. The carried rows are a `
      + "subset of the offered set, so this input describes no crossing that could have happened, and the docket's own "
      + "count cannot be recovered from it.",
    );
  }
  // WHAT THIS WINDOW'S OWN DOCKET PUT ON THE TABLE. Every test below is about
  // this number and not about `offered`, which is the whole of the repair.
  const docketOffered = offered - carried;
  const counts = {
    offered,
    docket_offered: docketOffered,
    carried_absent: carried,
    docket_claims: docket,
    staked_marks: stakedMarks.size,
    staked_positions: staked.length,
  };

  if (docketOffered > 0) {
    return { starving: false, ...counts };
  }

  if (stakedMarks.size === 0) {
    // Both paths agree there is nothing: a genuinely quiet crossing. The world's
    // own guard makes the same call for the same reason, and saying so here
    // keeps "quiet" a claim this function actually made rather than a default.
    //
    // `quiet` IS FALSE WHEN SOMETHING IS BEING CARRIED, because files are being
    // published. A guard that passed correctly and then told the keeper the
    // crossing was quiet would be right about the town and wrong about the day.
    return {
      starving: false, ...counts, quiet: carried === 0,
      why: carried === 0
        ? "nothing was offered and nothing is staked: both paths agree the crossing is quiet"
        : `this window's docket offered nothing and nothing is staked, and ${carried} mark(s) canon does not carry `
          + "are being carried from earlier window(s)",
    };
  }

  if (docket === 0) {
    // THE LAWFUL QUIET DELTA. Escrow stands — it always does, 281 positions on
    // an ordinary day — but the docket this crossing folds is empty, so there is
    // no store answer missing. The sentence is on the receipt rather than in a
    // log line because the keeper reads receipts twelve hours later, and "the
    // guard passed" and "the guard was never asked" must not look alike.
    return {
      starving: false, ...counts, quiet: carried === 0,
      why: carried === 0
        ? `the docket was empty: nobody locked a claim in window ${window ?? "?"}`
        : `the docket was empty — nobody locked a claim in window ${window ?? "?"} — and ${carried} mark(s) canon does `
          + "not carry are being carried from earlier window(s)",
    };
  }

  const first = [...stakedMarks].sort()[0];
  throw new FoldInputRefusal(
    "store-starving",
    `the fold carries no marks of this window's own docket, but the store holds ${staked.length} escrow position(s) `
    + `across ${stakedMarks.size} mark(s) — first, ${first}. Publishing nothing here would be a quiet day that is not `
    + "one. This is the loud-empty guard's question asked of the register: the marks and the escrow come from "
    + "different tables written by different pens at different times, so the two answers can disagree, and this is "
    + "that disagreement."
    + (carried > 0
      ? ` The ${carried} canon-absent mark(s) this crossing is carrying from earlier window(s) are NOT an answer to `
        + "this one: they are the repair for a window that was cleared outside the sweep's timing, and counting them "
        + "here would let a docket that never materialized pass behind them."
      : ""),
  );
}

/**
 * THE HOUSEHOLD KEY IS NOT A SKETCHBOOK NAME, AND THE NAME IS LOAD-BEARING.
 *
 * Measured on a scratch clone of the live store, 2026-09-08, 1,031 standing
 * marks across 84 households: EVERY household key is prefixed, so not one of
 * them is a legal git branch component.
 *
 *     gh:<github-id>    547 marks · 52 households
 *     solo:<handle>     484 marks · 32 households   (solo:the-town alone is 378)
 *
 * The obvious move is to sanitize — `gh:67605380` becomes `gh-67605380` — and it
 * is the worst available move, because the branch name is read. The sweep's
 * AUTHORSHIP WALL resolves a sketchbook's name through main's own registry
 * (`settlement-sweep.mjs:905-919`): `wallRegistry.logins[branchName.slice(
 * "draft/".length).toLowerCase()]`, where `WORLD/households.json`'s `logins` maps
 * a lowercased GitHub login to a household key. That wall is what keeps "a mark
 * whose registered author belongs to a DIFFERENT household than the branch"
 * drafted. And its own stated rule is that a branch it cannot bind is LEFT
 * ALONE — "unverifiable is the status quo, never a new refusal".
 *
 * So invented branch names would not fail loudly. They would bind to nothing,
 * the wall would stand down for every household in the town at once, every mark
 * would publish unverified, and every test would stay green. A rename would have
 * switched off an authorship check for the whole town, silently. That is the
 * exact defect this file's own trap-closing exists to prevent, arriving from the
 * other side.
 *
 * THE MAPPING, and it is discovered rather than invented — it reproduces the
 * names the git era already uses:
 *
 *   `gh:<id>`      → the login that `logins` binds to that key. `gh:293432145`
 *                    → `aionsolare`, and origin carries `draft/AionSolare`. The
 *                    wall lowercases, so case does not matter to it.
 *   `solo:<handle>` → the handle itself. `solo:ev-attractor` → `ev-attractor`,
 *                    and origin carries `draft/ev-attractor`. These bind to
 *                    nothing in `logins` — and they bind to nothing TODAY too:
 *                    13 of the 40 git-era sketchbooks on origin are already
 *                    unbindable. Matching that is correct; making it a refusal
 *                    would be a new refusal the world's own law forbids.
 *
 * An unprefixed key is taken as-is, which is what a key with no era-marker can
 * mean. A key this cannot turn into a legal branch component REFUSES, because at
 * that point there is no honest name left to choose.
 *
 * THE RESOLVER MOVED, AND THE REFUSALS DID NOT (2026-09-09). The mapping itself
 * is now `household-logins.sketchbookNameForKey` — the same function the
 * registry's own export uses to decide which name to bind a household under, so
 * the name the map binds and the name the branch carries cannot be two different
 * strings. What stays here is the only part that is this module's: turning its
 * reported reason into a refusal that stops a crossing, in this module's words.
 */
export function sketchbookNameFor(householdKey, { logins = {} } = {}) {
  const key = String(householdKey);
  const { name, reason, bound } = sketchbookNameForKey(key, logins);

  if (reason === "ambiguous") {
    throw new FoldInputRefusal(
      "household-key-ambiguous",
      `${key} is bound by ${bound.length} logins in WORLD/households.json (${bound.join(", ")}) — `
      + "picking one would name a sketchbook whose authorship wall binds a household this mark may not belong to",
    );
  }

  if (reason === "unnameable") {
    throw new FoldInputRefusal(
      "household-key-unnameable",
      `household ${key} yields "${name}", which is not a legal sketchbook component — `
      + "there is no honest branch name for it, and inventing one would leave the sweep's authorship wall bound to nothing",
    );
  }

  return name;
}

/** Main's own registry — the SAME resolver the sweep's wall reads, so the two cannot drift. */
export function wallRegistryAt(repo, ref) {
  try {
    const raw = git(repo, ["show", `${ref}:WORLD/households.json`]);
    const r = JSON.parse(raw);
    return { households: r.households ?? {}, logins: r.logins ?? {} };
  } catch {
    // The sweep's own behaviour when the registry is missing: "no registry on
    // main → the wall stands down entirely". Mirrored rather than invented.
    return { households: {}, logins: {} };
  }
}

/**
 * EVERY GIT-ERA SKETCHBOOK REF, GONE FROM THIS CLONE.
 *
 * Local and remote both, and remote is the one that matters: the sweep
 * materializes a remote draft with no local counterpart into a local tracking
 * branch (`settlement-sweep.mjs:364-379`), so leaving them would have the store
 * crossing fold forty stale git-era sketchbooks under a receipt that says
 * `source: store`.
 *
 * The clone is disposable by construction — `settlement-auto.sh` treats it as
 * "the sweep's own clone, never the write pen's checkout", cleans it with
 * `git clean -fdq` on every run, and re-creates it if absent — so deleting refs
 * here destroys nothing. Every one of them is on origin, untouched, which is
 * also what makes the git rollback a flip rather than a restore.
 */
export function clearGitSketchbooks(repo) {
  const refsOf = (pattern) => git(repo, ["for-each-ref", "--format=%(refname)", pattern])
    .split("\n").map((l) => l.trim()).filter(Boolean);

  const remote = refsOf("refs/remotes/origin/draft/");
  const local = refsOf("refs/heads/draft/");
  for (const ref of [...remote, ...local]) git(repo, ["update-ref", "-d", ref]);

  const leftRemote = refsOf("refs/remotes/origin/draft/");
  const leftLocal = refsOf("refs/heads/draft/");
  if (leftRemote.length || leftLocal.length) {
    // Asserted rather than assumed: a ref this could not delete is a sketchbook
    // the sweep would still fold, and the whole `source: store` claim rests on
    // there being none.
    throw new FoldInputRefusal(
      "sketchbook-refs-survived",
      `${leftRemote.length + leftLocal.length} draft ref(s) survived deletion in ${repo} — the sweep would fold git-era sketchbooks under a store receipt`,
    );
  }
  return { removed_remote: remote.length, removed_local: local.length };
}

/**
 * THE WRITE-DOWN. Store rows in, local sketchbooks out, nothing pushed.
 *
 * `at` pins the commit dates for the same reason the drain pins them: without
 * it the same write-down replayed a second later is a different sha and
 * byte-identical convergence is unprovable.
 */
export function storeWriteDown({
  repo = WORLD_CLONE,
  input,
  at = Date.now(),
  clearSketchbooks = true,
  // THE FRAMER, injected (`world-drain.mjs § fileFramer`, built over the same
  // clone at main — the CLI below builds it). Injected rather than built here
  // because `fileFramer` imports the world's fold and is async, and this
  // function's callers are not. Omitted, a world-framed record at a nested
  // path REFUSES rather than landing raw — § THE ONE FRAMER in the plan.
  toFileFrame = null,
} = {}) {
  const world = resolve(repo);
  const whenIso = new Date(at).toISOString();
  const normalized = normalizeFoldInput(input);

  // BEFORE ANY WORK. The guard's job is to refuse a blind crossing rather than
  // to notice afterwards that it built nothing, and a refusal that lands after
  // the clone has been rewritten is a refusal that also has to be undone.
  //
  // `docketClaims` is UNWRAPPED HERE rather than read inside the guard, so the
  // guard stays a function of three plain values and its falsifiers do not have
  // to build a selection to ask it a question. `?? null` is the whole of the
  // back-compatibility: a supplier with no `selection` refuses exactly as it did
  // before this field existed.
  //
  // `carriedAbsent` is unwrapped the same way and defaults to 0 rather than to
  // null, and the difference is deliberate: an absent DOCKET size is unproved
  // quiet and refuses, while an absent CARRY is a supplier that carried nothing,
  // which is what every fold input written before 2026-09-12 did.
  const starving = starvingCheck({
    ...normalized,
    docketClaims: normalized.selection?.docket_claims ?? null,
    carriedAbsent: normalized.selection?.carried_absent?.count ?? 0,
    window: normalized.as_of.window,
  });

  const cleared = clearSketchbooks ? clearGitSketchbooks(world) : { removed_remote: 0, removed_local: 0, skipped: true };

  // Canon's filing, read once at main. Memoized the way the drain memoizes it:
  // built only if some mark actually needs it.
  const mainSha = git(world, ["rev-parse", mainRef(world)]).trim();
  let mainPaths = null;
  const publishedPathOf = (id) => {
    mainPaths ??= new Set(
      git(world, ["ls-tree", "-r", "--name-only", mainSha, "--", "WORLD/marks"])
        .split("\n").map((l) => l.trim()).filter((l) => l.endsWith("/mark.md")),
    );
    const by = String(id).split("/")[0];
    const slug = String(id).split("/").slice(1).join("/");
    for (const p of mainPaths) {
      if (!p.endsWith(`/${slug}/mark.md`)) continue;
      try {
        const blob = git(world, ["show", `${mainSha}:${p}`]);
        if (blob.match(/^by:\s*(.+)$/m)?.[1]?.trim() === by) return p;
      } catch { /* unreadable candidate is not a match */ }
    }
    return null;
  };

  // What canon already holds at a path, or null when it holds nothing there.
  // Memoized per path because the plan asks once per mark and a crossing may see
  // the same path twice through Gate A.
  const canonCache = new Map();
  const canonBytesAt = (path) => {
    if (canonCache.has(path)) return canonCache.get(path);
    let bytes = null;
    try { bytes = git(world, ["show", `${mainSha}:${path}`]); }
    catch { bytes = null; }   // not in canon: a new mark, and new is changed
    canonCache.set(path, bytes);
    return bytes;
  };

  // Read once, from main, the same file the sweep's wall reads.
  const registry = wallRegistryAt(world, mainSha);

  // ── A MARK THE WALL CANNOT BIND IS NOT WRITTEN (ruled 2026-09-08, revised) ──
  //
  // THE FIRST RULING WAS `by: the-town`, AND IT WAS WITHDRAWN ON MEASUREMENT:
  // `by: the-town` is coextensive with household `solo:the-town` — 378 of 1,031
  // rows — so filtering on it would freeze 37% of the town, the 1f3d9/1f916
  // boarding and door marks among them, to protect six law nodes. The recorded
  // defect was never "law is in the store". It was that the write-down OPENED A
  // SKETCHBOOK for `the-town`, which is not a household the sweep's authorship
  // wall can bind.
  //
  // So the test is the wall's own: a docket mark whose household resolves to a
  // sketchbook name that `WORLD/households.json`'s `logins` cannot bind is held
  // out. It is REPORTED (`crossing_output: "unbound-household"`), it is counted
  // on the receipt, and it never opens a branch. A sketchbook the wall cannot
  // bind is a sketchbook whose marks publish unverified — the sweep leaves such
  // a branch alone rather than refusing it — so not opening one is the only
  // place this can be stopped.
  //
  // `founder_commit` rides beside it as the provenance marker and is NOT used as
  // a filter: it is present on 142 rows and covers all five of the-town's docket
  // marks, but making it a second selector would give the crossing two answers
  // to "is this mine" that can disagree.
  // ── AND THE STATED TEST DOES NOT SEPARATE THEM. MEASURED. ─────────────────
  //
  // The ruling's discriminator is "a household the wall cannot bind". Measured
  // against `WORLD/households.json` at S63: **the registry knows only the 73
  // `gh:` keys.** Every `solo:` key is absent from BOTH `households` and
  // `logins` — `solo:the-town`, and equally `solo:amia-semper`,
  // `solo:alta-of-garrison`, `solo:berthillon`, `solo:neth`. So "cannot bind"
  // holds out all 32 solo households and 484 marks, and at window 177's docket
  // it would hold out `amia-semper` and `alta-of-garrison` — **the two marks
  // S63 actually published**. The crossing would publish zero.
  //
  // That contradicts the ruling's own falsifier ("a resident's docket mark →
  // written"), so the stated test cannot be the one, and neither can the
  // registry's `households` map: it knows the same 73 keys and no more.
  //
  // WHAT THE MEASUREMENT DOES SUPPORT is the narrower sentence inside the same
  // ruling: `the-town` "is not a household". It is the town. It owns law nodes
  // that arrive by PR and ingest, and no resident's record is on the other side
  // of that line. So that is the test here — one key, FIVE marks at 177, and not
  // one resident touched.
  //
  // The registry admits a THIRD key shape besides `gh:` and `solo:` — `login:`
  // (`login:cadaeix-bot`, arky's). No standing mark carries one: measured
  // read-only against prod, 0 rows. It is named here rather than handled,
  // because a branch for a shape nothing produces is a branch nothing tests.
  //
  // `by === "the-town"` is a bare literal across this office already
  // (`world-grants.mjs:309`, `world-apex.mjs:1679`, `world-store.mjs:207`), so
  // naming it once here is the house spelling rather than a new convention.
  //
  // The broader question stays visible rather than being resolved by me: every
  // unbindable household is still reported under `wall.unbound`, so if the
  // conductor wants the wider rule the number to act on is already on the
  // receipt.
  const held = [];
  const carried = [];
  for (const m of normalized.marks) {
    if (isTheTown(m.household) || m.by === TOWN) {
      held.push({
        id: m.id,
        household_key: m.household,
        sketchbook: sketchbookNameFor(m.household, registry),
        crossing_output: "unbound-household",
        founder_commit: m.founder_commit ?? null,
      });
      continue;
    }
    carried.push(m);
  }

  const plan = planStoreWriteDown(carried, { publishedPathOf, canonBytesAt, toFileFrame });

  const naming = plan.households.map((h) => ({
    household: h.household,
    sketchbook: sketchbookNameFor(h.household, registry),
    bound: null,
  }));
  for (const n of naming) n.bound = registry.logins[n.sketchbook.toLowerCase()] ?? null;

  const households = [];
  for (const h of plan.households) {
    // A household's sketchbook is built from main every crossing, because in the
    // store era there is no such thing as an undelivered draft to preserve: the
    // store IS the record, and the sketchbook is a scratch surface this crossing
    // makes for the sweep to read. That is the one behavioural difference from
    // the drain's write-down and it is deliberate — `sketchbookBase` exists to
    // protect work that lives ONLY on a branch, and after G1 nothing does.
    const name = naming.find((n) => n.household === h.household).sketchbook;
    git(world, ["branch", "-qf", draftBranch(name), mainSha]);
    households.push({
      ...writeDownHousehold(world, { ...h, household: name }, {
        whenIso,
        message: `store write-down: ${h.upserts.length} mark(s) — ${h.household} (window ${normalized.as_of.window})`,
      }),
      // BOTH NAMES, always. The store speaks household KEYS and the world repo
      // speaks sketchbook names, and a receipt carrying only one of them cannot
      // be checked against the other side. This is the row where the two eras'
      // vocabularies are written down together.
      household_key: h.household,
    });
  }

  return {
    source: "store",
    at: whenIso,
    as_of: normalized.as_of,
    entry: normalized.entry,
    rehearsal: normalized.rehearsal,
    ingest: normalized.ingest,
    selection: normalized.selection,
    marks: normalized.marks.length,
    // WHAT THE CROSSING ACTUALLY WROTE, beside what it was offered. The gap
    // between them is the whole of the "never re-materialize an unchanged mark"
    // rule, and it is the number that says whether a fold is folding a DELTA or
    // rewriting the town: `written` close to `marks` on a quiet crossing means
    // the fold is re-rendering standing state.
    written: plan.counts.written,
    unchanged_skipped: plan.counts.unchanged,
    // The guard's own answer, on every crossing including the ones it passed.
    // "It did not fire" and "nobody asked" are different states, and only one of
    // them is evidence.
    starving_check: starving,
    written_by_locked_window: plan.counts.written_by_locked_window,
    // WHAT THE FRAMER TOUCHED: every world-framed record that landed at a
    // nested frozen path, with the number that arrived and the number written.
    // `framer: false` is a write-down run with no framer at all — lawful only
    // while no nested amend is in the docket, and refused the moment one is.
    framed: plan.framed,
    framer: typeof toFileFrame === "function",
    serialized_here: normalized.marks.filter((m) => m.serialized_here).length,
    supplied_bytes_only: normalized.marks.filter((m) => !m.serialized_here).length,
    sketchbooks_cleared: cleared,
    counts: plan.counts,
    // HOW MANY SKETCHBOOKS THE AUTHORSHIP WALL CAN STILL BIND. On the receipt
    // because the wall's failure mode is silence: an unbindable branch is left
    // alone, not refused, so a fold that renamed every sketchbook would switch
    // the wall off for the whole town and publish a clean-looking crossing.
    // These two numbers are the only surface on which that shows.
    wall: {
      sketchbooks: naming.length,
      bound: naming.filter((n) => n.bound).length,
      // After the ruling this should be ZERO on every crossing: an unbindable
      // household never reaches the plan, so it never opens a sketchbook. A
      // non-zero here would mean a name bound at the hold-out check and not at
      // the naming pass, which is one resolver disagreeing with itself.
      unbound: naming.filter((n) => !n.bound).map((n) => ({ household_key: n.household, sketchbook: n.sketchbook })),
    },
    // THE MARKS THE WALL COULD NOT BIND, held out of the fold and named in full
    // rather than counted: each one is a mark a resident or the town put in this
    // crossing's docket that no sketchbook carried, and the keeper is the one who
    // can tell a law node from a household whose registry row is missing.
    held_unbound: held,
    held_unbound_count: held.length,
    households: households.map(({ household, household_key, branch, base, base_from, commit, changed, touched }) =>
      ({ household, household_key, branch, base, base_from, commit, changed, touched })),
    main: mainSha,
  };
}

export { sketchbookBase };

// ── the CLI ──────────────────────────────────────────────────────────────────
//
// Mirrors `world-drain.mjs`'s: a JSON report on stdout, exit 1 on a refusal, and
// a refusal is a JSON BODY rather than only a non-zero exit — `settlement-auto.sh`
// reads the body for the drain and reads it the same way here, so the receipt
// can carry the store's own words rather than a truncated stderr line.
//
// The fold input arrives on a FILE rather than on argv or stdin. On a file
// because the chain already has one temp dir per crossing and because a store
// read big enough to matter is not an argument; named `--input` rather than
// piped so a rehearsal can re-run the same crossing from the same bytes.
//
// `import.meta.url` is compared against the resolved real path of argv[1], not
// against argv[1] itself: a junction or symlink anywhere above this file makes
// the naive comparison false and the CLI silently exits 0 having done nothing
// (33 fixture reds, 2026-09-05).
if (process.argv[1] && (await import("node:fs")).realpathSync(process.argv[1]).replace(/\\/g, "/").endsWith("/store-writedown.mjs")) {
  const argOf = (n, d = null) => { const i = process.argv.indexOf(n); return i !== -1 ? process.argv[i + 1] : d; };
  const inputPath = argOf("--input");
  const atIso = argOf("--at", null);
  const at = atIso ? Date.parse(atIso) : Date.now();
  if (!inputPath) { console.error("--input <fold-input.json> is required"); process.exit(2); }
  if (!Number.isFinite(at)) { console.error(`unparseable --at: ${atIso}`); process.exit(2); }
  const { readFileSync } = await import("node:fs");
  const world = resolve(argOf("--world", process.env.WORLD_CLONE ?? WORLD_CLONE));
  let report;
  try {
    report = storeWriteDown({
      repo: world,
      input: JSON.parse(readFileSync(inputPath, "utf8")),
      at,
      // The drain's framer, over the same clone at main — the one converter,
      // reached from the crossing's store path exactly as the drain reached it.
      toFileFrame: await fileFramer(world),
    });
  } catch (e) {
    report = e instanceof FoldInputRefusal
      ? { refused: e.reason, detail: e.detail }
      : { refused: "store-writedown-tripped", detail: String(e?.message ?? e) };
  }
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.refused ? 1 : 0);
}
