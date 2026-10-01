// mark-receipt.mjs — THE CANON RECEIPT: what happened to your mark, and where.
//
// THE PROMISE THIS KEEPS, verbatim, from the town's own bulletin entry
// `the-world` — a sentence the town published and did not keep:
//
//   "The World runs on the clock; judgment runs on the Worldkeeper. If your
//    mark does not ride a crossing, the reason is knowable — held, contested,
//    unbacked, or malformed — and the door will tell you which."
//
// and from `LOGOS/the-response-function § Residents: words, at their own pace`,
// which the plan of record names as the clause the town is breaking:
//
//   the resident's loop is "a replayable, cursor-ordered read of every effect
//   on your own node since you last looked" — and a crossing publishing or
//   refusing your mark is an effect on your node.
//
// ── THE WALK THAT PRODUCED IT (2026-09-06 05:53 EDT, #2526) ────────────────
//
// One staked mark, one crossing later, five doors, five different answers and
// none of them the promised one: the focus said "no mark or terrain feature";
// the marks shadow said `drafts / status: added`; the escrow said 1✦ standing;
// the `backed` row said `yours: false` with every field null; `since:` said,
// with a completeness guarantee, that nothing had happened to the resident.
//
// ── IT IS A DERIVED, AND IT IS STORED BY NOBODY ────────────────────────────
//
// `LOGOS/classes.md § The derived`: "a value the record implies at a save —
// computed at the read, stored never, authored by nobody." So there is no new
// table, no new column, and no new file. Every field below is read out of a
// record that already holds it:
//
//   status/window/cause   `claims` (status, window_id, submitted_at,
//                         decided_at, refusal_check) — world2/schema/001+007
//   crossing/sha          the world repo's own `settlement/S<n>` TAGS, which
//                         `settlements.mjs` already reads: "the truth is the
//                         world repo's own git TAGS … which exist only when a
//                         settlement actually landed"
//   published             canon — `publishedState(repo).state.marks`
//   draft (private)       the household's own delta — the sketchbook half
//
// ── THE PURE HALF, AND WHY ─────────────────────────────────────────────────
//
// `receiptFrom` takes RECORDS, not a repo and not a key, for the reason
// `world-hold.mjs § deps` gives: "deps exist so the ordering can be proven on a
// hand-built store with no world db and no Postgres — the door injects the real
// ones." Every sentence a resident reads is decided here, where a falsifier can
// hand it any tense without a settlement, a candle, or a clone.

import { execFileSync } from "node:child_process";

// ── the clock, named every time (R4) ────────────────────────────────────────
//
// THREE CLOCKS WEAR THE WORD "CROSSING" and the walk found all three in one
// sitting: the world's `since:` cursor counts 12h crossings from 00:00/12:00Z
// (`crossings.mjs § CROSSING_DERIVATION`), the ferry sails the mail on the same
// 00/12Z beat, and the keeper's SETTLEMENT runs at 05:45/17:45Z and numbers its
// blessings S1, S2, … — "the number counts blessings, not beats"
// (`settlements.mjs`), so it cannot be derived from any clock at all.
//
// This receipt speaks in the SETTLEMENT's epoch and says so on every answer.
// `window` is the candle's, and it is labelled as the candle's. Nothing here
// re-uses the bare word "crossing" for either.
export const RECEIPT_CLOCK =
  "crossing = the SETTLEMENT epoch (S-number + the sha it blessed, 05:45/17:45Z) — not the ferry's 00:00/12:00Z crossing, and not the candle's window";

/**
 * The bulletin's own five words for why a mark did not ride.
 *
 * A refusal names a CHECK (`claims.refusal_check`, "refused always names its
 * failing check — attributable by construction", 001_tables.sql) and a resident
 * was promised one of FIVE WORDS. This is the only place the two vocabularies
 * meet, and it is a map rather than a rename: `cause` is the promised word and
 * `cause_row` always carries the record it came from, so nothing is lost in the
 * translation and a reader can go check.
 *
 * ⚑ AN UNMAPPED CHECK IS NOT "malformed". It answers `null` with the raw check
 * beside it, because guessing one of five promised words for a refusal nobody
 * has classified would be the town keeping its promise in appearance only.
 *
 * ── THE COLUMN HOLDS `<name>: <detail>`, AND THE FIRST MAP READ THE WHOLE
 *    STRING (repaired 2026-09-07, reviewer-measured) ─────────────────────────
 *
 * The first version of this map was built from the SWEEP's channel names and
 * never measured against the writers that actually fill the column. Every one
 * of them — `world2/tools/clearing-job.mjs` at 129, 131, 141, 158, 176, 190-191
 * and `world2/tools/review-rule.mjs` at 247-248 — writes `<name>: <detail>`:
 *
 *     duplicate: a standing mark already carries this slug
 *     superseded: a later claim in this window amends this one
 *     insufficient-stamps: staked 3, liquid 1 at town 9f2a1b0c
 *     parcel-overlap: standing parcel "k-of-garrison/the-long-field"
 *     counterclaim: collides with 77 — a mind rules (census D2)
 *     review-ruling: wright refused this contest — <because>
 *
 * A map keyed on whole strings matched **0 of 8**. So every refusal the town
 * can currently produce answered `cause: null` — the `null`-rather-than-guess
 * discipline is the only reason that was an honest silence rather than a lie,
 * and it is the reason this was a repair and not an incident.
 *
 * THE CHECK IS THE PREFIX. Split on the FIRST colon: the detail carries commas,
 * quotes, em-dashes and its own colons ("review-ruling: wright refused this:
 * it collides"), and only the segment before the first one is a check name.
 *
 * `test/mark-receipt.test.mjs § REAL_REFUSAL_CHECKS` holds all eight verbatim
 * with the line each came from. A ninth prefix is not guessed at — it answers
 * `null` and says so, which is asserted there too.
 */
/**
 * ⚑ `unpublished` IS THE SIXTH WORD, RULED BY KEEMIN 2026-09-08 (postmark#2594).
 *
 * The bulletin's published sentence promises four — "held, contested, unbacked,
 * or malformed" — and `quarantined` was already a fifth this file carried. The
 * nightly read's canon-absent FINDING — nothing at the candle writes it; the
 * lock-time refusal was withdrawn the same day — is none of them: the record is typically well
 * formed, nobody else claims the slug, the stake is fine, and `held` is spent on
 * `held_review` and defined as "it did not ride and IT WAS NOT REFUSED". It has
 * a name — the world has no file for it — and the ruling is that a refusal with
 * a name must not answer null.
 *
 * THE BULLETIN'S OWN SENTENCE IS NOT THIS REPO'S TO EDIT. `the-world`'s entry
 * lives in the town repo and is mirrored into the site's `bulletin.json`; the
 * office answering a word the bulletin does not list is a seam, and it is
 * carried up in `docs/2026-09-08/jetto-candle-refusal-report.md` with the exact
 * sentence to change rather than edited here.
 */
export const CAUSE_WORDS = Object.freeze(["held", "contested", "unbacked", "malformed", "quarantined", "unpublished"]);

const CAUSE_OF_CHECK = Object.freeze({
  // ── the CANDLE's writers (world2/tools/clearing-job.mjs) ──────────────────
  // A slug already standing, or a claim a later one amends: two claims for one
  // thing, which is what "contested" means to a resident.
  "duplicate": "contested",
  "superseded": "contested",
  "parcel-overlap": "contested",
  "counterclaim": "contested",
  // Not enough liquid stamps behind the stake at the pinned candle read.
  "insufficient-stamps": "unbacked",
  // NOTHING staked on a commons mark at the pinned town read (step 5.5, ruled a
  // G1 blocker 2026-09-08). `unbacked` and not `unpublished`: the world's own
  // sweep would refuse this too — "commons needs escrow > 0" — so the mark is
  // not merely unpublished, it is unbacked, and the resident's move is a stake
  // rather than a wait. The two #2594 checks — this one at the candle,
  // `canon-absent` on the nightly read — land on different words on purpose,
  // because they ask a resident for different things.
  "escrow-absent": "unbacked",
  // ── the REVIEW lane's writer (world2/tools/review-rule.mjs) ───────────────
  //
  // ⚑ `contested`, NOT `held` (repaired 2026-09-07, reviewer-found — and it is
  // the SAME MISTAKE AS THE 0-of-8, one level deeper). The first mapping read
  // the writer's NAME — "a mind ruled, so: held" — instead of the STATE that
  // writer leaves the row in. `review-rule.mjs:245-248` is explicit:
  //
  //     const check = next !== "refused" ? null
  //       : kind === "refuse" ? `review-ruling: ${by} refused this contest — …`
  //                           : `review-ruling: ${by} granted ${slug} — …`;
  //
  // The check is written ONLY on `refused`. The `hold` arm (`kind === "hold"` →
  // `held_review`) writes NO check at all. So a `review-ruling:` string never
  // sits on a held row — it always sits on a row a mind has definitively ruled
  // AGAINST, either refusing the contest or granting it to somebody else.
  //
  // Mapping it to `held` printed "refused at window N — held" on one object,
  // while the `held_review` arm below spends `held` on the opposite state and
  // defines it as "it did not ride and IT WAS NOT REFUSED". A resident told
  // "refused — held" reasonably concludes a mind is still deciding, when a mind
  // has decided against them and the contest is over.
  //
  // Both shapes are contest outcomes, so `contested` is the word — which leaves
  // `held` meaning exactly `held_review`. One word, one state.
  "review-ruling": "contested",
  // ── the NIGHTLY READ's finding (world2/tools/falsifier-canon-locks.mjs) ───
  //
  // RULED 2026-09-08 by Keemin: `unpublished`. The world has no file for the
  // mark, which is a fact about the WORLD and not about the resident's record —
  // so none of the four older words is honest here (see CAUSE_WORDS above).
  // This map answered `null` for one lap, by its own guess-nothing rule; a
  // refusal that has a name gets the name.
  "canon-absent": "unpublished",
  // ── the note that lap left, kept because it is the argument (postmark#2594)
  //
  // ⚑ TENSE, CORRECTED: NOTHING WRITES THIS CHECK ONTO A CLAIM. The lock-time
  // refusal this note was written for was WITHDRAWN on 2026-09-08 — the
  // settlement pushes minutes after the candle clears, so a canon check at the
  // lock step would refuse the marks its own crossing locked. The string reaches
  // `causeOf` from `falsifier-canon-locks.mjs`, the nightly read, which composes
  // it per finding so this word keeps a reader on the only path that still
  // produces the class.
  //
  // The argument for the WORD is unchanged and is why the note is kept: no
  // honest fit among the five. Not `contested` (nobody else claims the slug),
  // not `unbacked` (the stake is fine — that is `escrow-absent`, a different
  // check with a different word), not `quarantined`, and not `held`, which this
  // file spends on `held_review` and defines as "it did not ride and IT WAS NOT
  // REFUSED". `malformed` is the near miss and still wrong: the record is
  // usually perfectly well formed and the world simply has no file for it.
  //
  // For one lap it answered `null` WITH THE RAW CHECK BESIDE IT, by this file's
  // own rule one paragraph up: "guessing one of five promised words for a
  // refusal nobody has classified would be the town keeping its promise in
  // appearance only." The founder then classified it, which is the difference
  // between a guess and a word — so the map answers `unpublished` and the
  // guess-nothing rule is untouched for the NEXT unclassified check.
  //
  // ⚑ THE TOWN HALF IS STILL OWED: the bulletin's published sentence lists four
  // words and the office now answers a sixth. The exact sentence to change is in
  // `docs/2026-09-08/jetto-candle-refusal-report.md`; the town repo is not this
  // branch's to edit.
  // ── the SWEEP's own channels (world tools/settlement-sweep.mjs) ───────────
  // Kept: the 1.0 sweep still refuses on these, and a mark can be refused by
  // either lane. Measured against the sweep's source, not guessed.
  "suite-quarantine": "held",
  "grammar-suite": "held",
  "held-review": "held",
  "collision": "contested",
  "escrow": "unbacked",
  "no-stake": "unbacked",
  "unstaked": "unbacked",
  "commons-minimum": "unbacked",
  "geometry": "malformed",
  "fold-error": "malformed",
  "filing": "malformed",
  "schema": "malformed",
  "quarantine": "quarantined",
  "registrar-quarantine": "quarantined",
});

/** The check name a stored `refusal_check` carries — everything before the FIRST colon. */
export function checkNameOf(refusalCheck) {
  const raw = String(refusalCheck ?? "").trim();
  if (!raw) return null;
  const i = raw.indexOf(":");
  return (i === -1 ? raw : raw.slice(0, i)).trim().toLowerCase() || null;
}

const CAUSE_ROW_PREFIX = "claims.refusal_check = ";

export function causeOf(refusalCheck) {
  const raw = String(refusalCheck ?? "").trim();
  if (!raw) return { cause: null, cause_row: null };
  const key = checkNameOf(raw);
  const word = CAUSE_OF_CHECK[key]
    ?? CAUSE_WORDS.find((w) => key === w)
    ?? null;
  return { cause: word, cause_row: `${CAUSE_ROW_PREFIX}${JSON.stringify(raw)}` };
}

/**
 * `causeOf`'s inverse: the stored `refusal_check` a `cause_row` quotes, or null.
 * Beside its writer so the two cannot drift; a row this did not write reads as
 * null rather than as a guess (POS-241 part 5 reads it for my-marks' `refused`).
 */
export function refusalCheckOf(causeRow) {
  const s = String(causeRow ?? "");
  if (!s.startsWith(CAUSE_ROW_PREFIX)) return null;
  try { const v = JSON.parse(s.slice(CAUSE_ROW_PREFIX.length)); return typeof v === "string" ? v : null; }
  catch { return null; }
}

/**
 * THE DERIVATION, pure over the records.
 *
 * `records` is what the readers below found:
 *   { id, canon, published_at, claims, sketchbook, withdrawn, settlement, site_pin }
 *
 *   canon         the mark's row in published world-state, or null
 *   published_at  { s, sha, at } — the settlement that first carried it, or null
 *   claims        the store's rows for this slug, newest first, or null when the
 *                 store is not configured (NOT the same as "no rows" — see below)
 *   sketchbook    the caller's own delta entry for this mark, or null
 *   withdrawn     true when the caller's delta proposes its deletion
 *   settlement    { s, sha, at } — the newest settlement the record holds
 *   site_pin      the postmark-world sha the SITE is pinned to, or null
 *
 * ── THREE ABSENCES, THREE SENTENCES (walk #7 item 4) ──────────────────────
 *
 * "No mark" is only for a mark the record NEVER SAW. A withdrawn mark, an
 * unindexed-but-published mark, and a never-was are three states and they get
 * three sentences here. `unreadable` is a fourth and it is not an absence at
 * all: a store the office cannot reach must never be reported as an empty
 * docket, which is the `the-town/the-disclosure` law — "refuse or disclose
 * absent inputs; never quietly substitute".
 */
export function receiptFrom(records = {}) {
  const {
    id = null, canon = null, published_at = null, claims = null,
    sketchbook = null, withdrawn = false, settlement = null, site_pin = null,
    terrain = false,
  } = records;

  // ── 0 · TERRAIN IS NOT A MARK (repaired 2026-09-07, reviewer-found) ───────
  //
  // `investigate` answers a terrain feature with `{ kind: "terrain", … }` and
  // no error — a real answer about a real thing. This receipt is derived from
  // `claims` and canon MARKS, and neither has ever held a terrain feature, so
  // the first version hung `status: "never-was"` on the town's own river:
  // "the record holds no mark of this id". That is the mislabel class this lane
  // fixed one door over, introduced by this lane one commit later.
  //
  // It gets a SENTENCE rather than no receipt at all. Dropping the field would
  // make a terrain focus the one answer on this door with no account of itself,
  // and a third kind of silence is what this lane exists to end — a reader
  // walking `receipt` should never have to know in advance which ids have one.
  if (terrain) {
    return {
      id, window: null, crossing: null, settlement_sha: null, site_pin,
      cause: null, cause_row: null, clock: RECEIPT_CLOCK, sources: ["skeleton"],
      status: "terrain",
      says: "terrain — the world's own ground, authored by the record's skeleton rather than declared by a resident. It rides no docket and no settlement carries it; there is nothing here for a crossing to rule on.",
    };
  }

  const sources = [];
  // ⚑ A ROW MUST BE ABOUT THE MARK BEING ASKED ABOUT (2026-09-07). `claims` is
  // INJECTED, and this function's whole design is that a caller hands it
  // records — so "the reader already filtered" is a guarantee living in another
  // file, and a pure function that trusts it is not pure, it is coupled.
  //
  // `claimRowsForSlug` does filter (`WHERE slug = $1`), and SQL's `NULL = x` is
  // never true, so the six real SLUGLESS rows on prod cannot reach it today.
  // The falsifier that found this handed them in anyway and watched a claim
  // that names NO mark decide a named mark's tense — `status: "locked"` on a
  // receipt for a slug that row has nothing to do with. Cheap to close, and it
  // makes the injection contract honest.
  const rows = Array.isArray(claims)
    ? claims.filter((r) => r && r.slug != null && String(r.slug) === String(id))
    : null;
  if (rows) sources.push("claims");
  if (canon) sources.push("canon");
  if (sketchbook) sources.push("sketchbook");

  // The newest row the store holds for this slug decides the tense; older rows
  // are its history, not its state. `latest-wins` is the log's own rule and the
  // amend chain's (`supersedes`), so a receipt that averaged them would be
  // inventing a state no record holds.
  const row = rows?.[0] ?? null;

  const base = {
    id,
    window: row?.window_id ?? null,
    crossing: null,
    settlement_sha: null,
    site_pin,
    cause: null,
    cause_row: null,
    clock: RECEIPT_CLOCK,
    sources,
    ...(rows === null
      ? { docket: { readable: false, reason: "the office could not read the docket store — this receipt is drawn from the record alone, and a claim standing on the docket would not appear in it" } }
      : {}),
  };

  // 1 · PUBLISHED. Canon holds it, so the settlement ruled and the answer is a
  // fact about the world, whatever the docket says about the claim behind it.
  if (canon) {
    return {
      ...base,
      status: "published",
      crossing: published_at ?? settlement ?? null,
      settlement_sha: published_at?.sha ?? settlement?.sha ?? null,
      says: published_at
        ? `published at S${published_at.s} (${String(published_at.sha).slice(0, 8)})${published_at.at ? ` on ${published_at.at}` : ""}`
        : "published — the record holds this mark, and which settlement carried it could not be read from the tags",
      ...(withdrawn
        ? { withdrawal_standing: "you have declared this mark withdrawn; it stands in the world until a crossing carries the removal" }
        : {}),
    };
  }

  // 2 · THE DOCKET RULED, and canon does not hold it. This is the sentence the
  // bulletin promised and no door said.
  if (row?.status === "refused") {
    const { cause, cause_row } = causeOf(row.refusal_check);
    return {
      ...base, status: "refused", cause, cause_row,
      crossing: settlement ?? null,
      settlement_sha: settlement?.sha ?? null,
      says: `refused at window ${row.window_id}${cause ? ` — ${cause}` : ""}${row.decided_at ? ` (${row.decided_at})` : ""}`
        + (cause ? "" : " — the check that refused it has no word in the bulletin's five yet; the row is named beside this"),
    };
  }
  if (row?.status === "locked") {
    return {
      ...base, status: "locked",
      crossing: settlement ?? null,
      settlement_sha: settlement?.sha ?? null,
      says: `locked at window ${row.window_id} — the candle ruled for it; it reaches the world at the settlement that carries the window`,
    };
  }
  if (row?.status === "retracted") {
    return { ...base, status: "retracted", says: `retracted at window ${row.window_id} — you took it off the docket before the close` };
  }
  if (row?.status === "held_review") {
    return { ...base, status: "held_review", cause: "held", cause_row: "claims.status = \"held_review\"",
      says: `held at window ${row.window_id} — a mind rules on it; it did not ride and it was not refused` };
  }

  // 3 · PENDING. On the public docket, waiting for the candle.
  if (row?.status === "pending") {
    return {
      ...base, status: "pending",
      says: `pending at window ${row.window_id} — staked and on the public docket since ${row.submitted_at ?? "its stake"}; it rides when that window closes`,
    };
  }

  // 4 · DRAFT. Private, and it rides nothing until it is staked.
  if (row?.status === "draft" || sketchbook) {
    return {
      ...base, status: "draft",
      says: "draft — this stands in your own compose space, on no docket and in no public answer. Staking it is what puts it forward (a commons mark publishes only with escrow behind it).",
    };
  }

  // 5 · WITHDRAWN, with nothing left standing.
  if (withdrawn) {
    return { ...base, status: "withdrawn", says: "withdrawn — you let this one go, and the record holds no standing copy of it" };
  }

  // 6 · THE RECORD NEVER SAW IT. The only case that may say "no mark".
  return {
    ...base, status: "never-was",
    says: rows === null
      ? "the record holds no mark of this id — and the docket could not be read, so a claim standing on it would not show here"
      : "the record holds no mark of this id: no canon entry, no claim on the docket, and nothing in your own compose space",
  };
}

// ── the readers ─────────────────────────────────────────────────────────────

const git = (repo, args) => execFileSync("git", ["-C", repo, ...args], {
  encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024,
});

/**
 * WHICH SETTLEMENT CARRIED THIS MARK — derived, because nothing records it.
 *
 * `WORLD/settlement-publications.json` is a map of WHICH marks are published
 * and, in `settlements.mjs`'s own words, "holds neither an index nor a date".
 * So the settlement a mark rode is not a stored fact anywhere in the town, and
 * this derives it from the two things that ARE stored: the commit that first
 * added the mark's file, and the `settlement/S<n>` tags that contain it.
 *
 * Two git calls, on the clone the office already keeps. Null — never a guess —
 * when either is unreadable: an invented S-number on a receipt is worse than an
 * absent one, because the resident has no way to tell it is invented.
 *
 * ── THE OLDEST ADD, AND `--follow` (repaired 2026-09-07, reviewer-measured) ──
 *
 * The first version ran `--diff-filter=A **-1**` and called the answer "the
 * FIRST settlement that carried it". Both halves of that were wrong, and each
 * broke a different real case, measured on a tagged fixture:
 *
 *   a mark AMENDED after publication   truth S2 · answered S2   ok
 *   a mark WITHDRAWN and RE-LEFT       truth S4 · answered S6   wrong
 *   a mark whose FILE MOVED            truth S7 · answered S8   wrong
 *
 *   `-1` returns git's FIRST output line, which is the NEWEST add — so a slug
 *        let go and taken up again named the second arrival.
 *   no `--follow` makes a rename read as an add at the new path — so the
 *        receipt printed the settlement that MOVED the file as the settlement
 *        that CARRIED the mark, with a real sha.
 *
 * The move is the live one: the filing freeze says "the settlement writes a
 * mark once; nothing moves it after", and the-town's own class marks were moved
 * in August anyway. A wrong S-number with a real sha behind it is exactly what
 * this function's own null-rather-than-guess rule exists to prevent, so it was
 * failing at the one thing it was written to do.
 *
 * Each flag fixes a different case and BOTH are needed: `--follow` alone still
 * answers S6 for the re-leave, oldest-add alone still answers S8 for the move.
 * `test/mark-receipt.test.mjs § THE THREE LIVES A MARK'S FILE CAN HAVE`.
 */
export function settlementThatCarried(repo, path, { tags = null, ref = "HEAD" } = {}) {
  if (!repo || !path) return null;
  let added;
  try {
    // --follow so a rename is one life, not two; no -1 so every add is listed
    // (newest first) and the OLDEST is taken below. `--follow` takes exactly one
    // pathspec, which is what this function is handed.
    const adds = git(repo, ["log", "--follow", "--diff-filter=A", "--format=%H", ref, "--", path])
      .split("\n").map((s) => s.trim()).filter(Boolean);
    added = adds.length ? adds[adds.length - 1] : "";
  } catch { return null; }
  if (!added) return null;
  let containing;
  try {
    containing = git(repo, ["tag", "--list", "settlement/S*", "--contains", added])
      .split("\n").map((s) => s.trim()).filter(Boolean);
  } catch { return null; }
  const ns = containing
    .map((t) => /^settlement\/S(\d+)$/.exec(t))
    .filter(Boolean)
    .map((m) => Number(m[1]))
    .filter((n) => Number.isInteger(n));
  if (!ns.length) return null;
  // The lowest S-number among the tags that CONTAIN the oldest add — every
  // later settlement contains it too, and the receipt wants the one that
  // carried the mark. True now that `added` is the oldest add of one followed
  // life; it was false while `-1` handed this the newest.
  const s = Math.min(...ns);
  const known = (tags ?? []).find((t) => t.n === s) ?? null;
  // ⚑ THE WHOLE SHA, NOT THE SETTLEMENTS DOOR'S. `readSettlementTags` resolves
  // its shas with `rev-parse --short` — right for that door, which RENDERS a
  // list a reader skims. A receipt's sha is an IDENTIFIER: it is the thing a
  // resident pastes into `git show` and the thing a reviewer compares against
  // `read_at.sha`, and comparing a short spelling with a long one is how two
  // names for one commit start disagreeing. The tag's DATE is taken from the
  // list, because that costs a subprocess and means the same either way.
  let sha = null;
  try { sha = git(repo, ["rev-parse", `settlement/S${s}^{commit}`]).trim() || null; } catch { /* named absent, never guessed */ }
  return { s, sha, at: known?.date ?? null, added_at: added };
}

/**
 * THE DOOR'S READER: gather every record that speaks about one mark, then let
 * `receiptFrom` decide the sentence.
 *
 * Never throws. Every source is attached inside its own try, and a source the
 * office cannot read is DISCLOSED rather than reported as empty — the law is
 * `the-town/the-disclosure`, "refuse or disclose absent inputs; never quietly
 * substitute", which is why `claims: null` and `claims: []` stay two different
 * things all the way through `receiptFrom`.
 *
 * @param id    `<by>/<slug>` — the full mark identity.
 * @param repo  the world clone.
 * @param key   the caller's credential, or null. It buys exactly one thing: the
 *              caller's own private drafts (007's row policy).
 * @param canon the mark's canon row when the caller already has it — the focus
 *              does, it just folded the world — else null and this reads it.
 */
export async function readMarkReceipt(id, { repo, key = null, canon = null, publishedSha = null, terrain = false } = {}) {
  const markId = String(id ?? "").trim();
  if (!markId) return null;

  // Terrain short-circuits before any source is opened: there is nothing in
  // `claims`, canon or a sketchbook that could speak about the world's own
  // ground, so reading them would be spending four lookups to arrive at a
  // sentence that is decided by the kind alone.
  if (terrain) return receiptFrom({ id: markId, terrain: true, site_pin: null });

  const branches = await import("./world-branches.mjs");

  // ── canon ────────────────────────────────────────────────────────────────
  //
  // `canon` and `publishedSha` are HANDED IN by the focus, which has just
  // folded the world and holds both. Reading them again here would cost a
  // second `git show` of a 1 MiB world-state.json per read — the exact class
  // `world-branches.mjs § GIT_MAX_BUFFER` records as an outage. The fallback is
  // for a caller with neither.
  let canonRow = canon, sha = publishedSha;
  if (!canonRow || !sha) {
    try {
      const ps = branches.publishedState(repo);
      sha = sha ?? ps.sha;
      if (!canonRow) canonRow = (ps.state?.marks ?? []).find((m) => m.id === markId) ?? null;
    } catch { /* an unreadable clone leaves canon null; `sources` says so */ }
  }

  // ── the settlement epoch ─────────────────────────────────────────────────
  let settlement = null, tags = [];
  try {
    const { settlements } = await import("./settlements.mjs");
    const s = settlements(repo);
    settlement = s.current ?? null;
    tags = s.recent ?? [];
  } catch { /* no tags, no S-number — and never a guessed one */ }

  let carried = null;
  if (canonRow && sha) {
    try {
      const { filedPathOfAt } = await import("./world-journal.mjs");
      const path = filedPathOfAt(repo, sha)(markId);
      if (path) {
        const c = settlementThatCarried(repo, path, { tags, ref: sha });
        if (c) carried = { s: c.s, sha: c.sha, at: c.at };
      }
    } catch { /* the filing index's absence is not a receipt's to invent around */ }
  }

  // ── the docket ───────────────────────────────────────────────────────────
  let claims = null;
  try {
    const { world2Enabled } = await import("./world2-acts.mjs");
    if (world2Enabled()) {
      const { claimRowsForSlug } = await import("./world2-claims.mjs");
      claims = await claimRowsForSlug(markId, { key });
    }
  } catch { claims = null; }

  // ── the caller's own compose space ───────────────────────────────────────
  let sketchbook = null, withdrawn = false;
  if (key) {
    try {
      const { guardedDraftsForKey } = await import("./world2-guards.mjs");
      const delta = await guardedDraftsForKey(repo, key);
      const row = (delta?.marks ?? []).find((m) => m.id === markId) ?? null;
      if (row) { withdrawn = row.status === "deleted"; sketchbook = withdrawn ? null : row; }
    } catch { /* the overlay is one source of five; its absence is not the answer */ }
  }

  return receiptFrom({
    id: markId, canon: canonRow, published_at: carried, claims,
    sketchbook, withdrawn, settlement,
    // ⚑ NOTHING RECORDS THE SITE PIN, and this is the honest null rather than a
    // guess. `site_pin` is the `postmark-world` version `keeminlee/postmark-site`
    // is built against; the office holds no clone of the site and no record of
    // its pin, so the one field of the plan's receipt shape that the store
    // cannot derive is this one. It is a FINDING, not a schema change: either
    // the site publishes its pin at a door the office can read, or the field
    // leaves the shape. Reported in the lane's day doc.
    site_pin: null,
  });
}
