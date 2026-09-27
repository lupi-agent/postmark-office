// world2-acts.mjs — THE WORLD 2.0 SHADOW PEN (office_api's acts writer, dev era).
//
// Phase 3a of the World 2.0 gold plan (G:/Starstory/PULSE/gold-plans/
// postmark-world-2/): every row appendJournal writes into the sqlite journal is
// MIRRORED into Postgres `acts` — the permanent event log that replaces the
// journal-truncate-drain-to-git cycle at cutover. During the shadow era the
// sqlite journal remains the store the office READS; Postgres is the store
// being proven. The parity falsifier (world2/tools/falsifier-acts-parity.mjs)
// asserts every undrained journal row has its acts twin.
//
// ── THIS IS A SHIM, AND IT SHIPS WITH ITS OWN DEATH (anti-rebake rule 5) ─────
// The mirror exists so 1.0 and 2.0 can be A/B'd on the same live dev traffic
// (phase 4). At cutover the journal INSERT dies, this file's mirror becomes the
// door's ONE awaited write, and `acts.journal_seq` is dropped. The expiry
// falsifiers red past a lane's own backstop (below) so the shim cannot become
// furniture.
//
// ── WRITE DISCIPLINE ─────────────────────────────────────────────────────────
// appendJournal is synchronous; the mirror is an in-process serial queue —
// fire-and-forget FOR THE CALLER, never for the operator: a failed mirror
// write logs loudly, lands in `mirrorStatus().failed`, and the parity
// falsifier turns red at the next check. That is acceptable ONLY because the
// sqlite journal is still the SoT this era; the cutover rewrite awaits the
// insert and refuses at the door instead.
//
// Env:
//   WORLD2_PG=1        the mirror is on
//   WORLD2_PG_URL      postgres://office_api:<pw>@localhost:5432/world2_dev
//   (read per call like WORLD_SINGLE_LOG — a test flips it between cases)

// ── THE MIRROR'S EXPIRY MACHINERY IS GONE (G1 / POS-156, 2026-09-22) ─────
//
// `MIRROR_EXPIRES`, `LANE_MIRROR` and the five functions over them
// (`mirrorExpiresFor`, `laneMirrorExpired`, `expiredLanes`, `exemptLanes`,
// `mirrorExpiryLine`, `mirrorExpired`) were the pressure mechanism on a shim:
// per-lane backstop dates that RED a falsifier if a lane was still mirroring
// past them. DEC-2's own rule said what ends a lane's obligation -- "DELETING
// its row from LANE_MIRROR", ports landed and deletion ruled, never a clock
// running out -- and this file said where that happened: the map "is deleted
// whole by G1 (POS-156), with the journal INSERT".
//
// That is this change. Every governed lane's read ports have landed -- frame
// and the ride's entry stop in POS-152, hold in POS-153 and POS-162, walkers in
// POS-154, occupancy in POS-194, the stance candidates in POS-195 -- and the
// INSERT the map was pressuring is deleted in the same commit. A death clock
// outliving the thing it was counting down is furniture, which is rule 5
// pointed the other way.
//
// THE ARENA'S EXEMPTION DID NOT LIVE HERE AND DOES NOT DIE HERE. `LANE_MIRROR.
// arena.expires` was null carrying P-143's words, and the ruling itself is
// unchanged and now carried where the exception actually is: `FLIP_REFUSED` in
// `world-journal.mjs`, and `appendArenaRow`, the one sqlite INSERT G1 leaves
// standing, which refuses any other class by name. An exemption stated at the
// code that implements it is stronger than one stated in a map beside it.

/**
 * THE LANES EXEMPT BY RULING — the one thing the deleted map carried that
 * OUTLIVES it, kept because a live tool reads it and a ruling is not a shim.
 *
 * `world2/tools/state-log-rederive.mjs § classifyAbsence` asks which lanes may
 * be ABSENT from the register without that absence being a finding. That
 * question survives G1 whole: it is about the arena, and the arena's exemption
 * is P-143, which no deletion of this lane's touches.
 *
 * It used to be derived from `LANE_MIRROR` by reading which rows had a null
 * expiry — a map about the REVERSE MIRROR's death clock, which G1 deleted along
 * with the INSERT it was pressuring. The answer was never really about expiry
 * dates, so it is stated directly now:
 *
 *   P-143, RULED (Keemin, 2026-08-29 party night: "we can just keep the arena
 *   on sqlite for now") — the lane stays sqlite-first, no read port, the
 *   hardened rebuild lands 2.0-native instead. Lifting this is a founder ruling
 *   PLUS the arena read ports, together.
 *
 * ⛑ A LANE IS NOT EXEMPT BY BEING ABSENT FROM THIS LIST. That was `LANE_MIRROR`'s
 * own fail-closed rule ("an unnamed lane must never buy immortality by being
 * unnamed") and it is the same here: this names the exemptions, and everything
 * not named is governed.
 */
export const EXEMPT_LANES = Object.freeze(["arena"]);

/** The lanes exempt by ruling — what a red must say it did NOT count. */
export function exemptLanes(lanes = EXEMPT_LANES) {
  return [...lanes];
}

// ── WHEN EACH LANE'S PEN FLIPPED — DATES AS DATA, NOT AS PROSE ───────────────
//
// THE DEFECT THIS EXISTS TO KILL (w2-hold-say-flip-report.md § Findings 2,
// 2026-09-03, verbatim): "`--since` is one clock for every lane, and lanes flip
// on different days. Asked for `--lanes stance,hold,say --since <the stance
// flip>`, it read 81 mirror-era say acts (`journal_seq` NULL by the mirror's
// design, never flipped) as 'flipped acts lacking twins'. The pairing key
// 'journal_seq NULL' does not distinguish a flipped row from a mirror-written
// row of a lane that never had journal rows."
//
// The pairing key CANNOT distinguish them and never will: before a lane flips,
// its mirror writes `acts` rows with `journal_seq` NULL too (the say gap and the
// holding gap were closed by the mirror, not by the journal — the lane simply
// had no journal row to carry a seq). The only thing that separates a flipped
// row from a mirror row of the same lane is WHEN — so the moment each lane's pen
// flipped is a fact the store needs written down, and this is where it lives:
// here. (It used to sit beside `LANE_MIRROR`, "the one home for per-lane truth
// about the shim"; G1 deleted that map with the journal INSERT it was
// pressuring, and these dates OUTLIVE it -- they are a fact about `W2_PEN` on a
// box, not about a shim's death clock, and the flipped-era acts they date still
// exist.) A falsifier that carried these dates in its own argv would make every
// operator re-type them, and a date re-typed is a date eventually mistyped.
//
// THE VALUE IS THE SERVICE-RESTART MOMENT, from that lane's own flip report —
// not the first act observed after it. An act is evidence the flip happened
// BEFORE it; the restart is the flip.
//
// `null` means THIS LANE HAS NOT FLIPPED. It is not "unknown" and it is not a
// backstop: a lane with a null here has no flipped era at all, so a reverse-
// parity check over it is a comparison with nothing to compare (its
// `journal_seq`-NULL rows are the mirror's, and pairing them against a journal
// that never held them manufactures exactly the 81 false reds above). A lane
// ABSENT from this map is also unflipped — nothing becomes "flipped" by being
// unnamed, which is LANE_MIRROR's own fail-closed rule pointed the other way.
//
// A lane's row changes ONCE, when its pen flips, and the change carries the
// report that names the restart. Rolling a lane back (removing it from `W2_PEN`)
// does NOT clear its row: the flipped-era acts it wrote still exist and still
// need pairing. A second flip after a rollback is a second era, and the honest
// shape for that is a list rather than a scalar — deliberately not built until
// a rollback actually happens, because a shape nobody needs is furniture.
export const LANE_FLIPPED_AT = Object.freeze({
  // C1 · `W2_PEN=stance`, postmark-office.service restarted 21:01:58Z
  // (G:/Starstory/docs/2026-09-02/w2-stance-flip-report.md).
  stance: "2026-09-02T21:01:58Z",
  // C2 + C4 · `W2_PEN=stance,hold,say`, one restart, both lanes
  // (G:/Starstory/docs/2026-09-03/w2-hold-say-flip-report.md: "FLIPPED ON PROD
  // 2026-09-03 18:58:05Z").
  hold: "2026-09-03T18:58:05Z",
  say: "2026-09-03T18:58:05Z",
  // C3, C5, C6 flipped on prod 2026-09-05, one lane at a time, each with the
  // refusal proof before the flag and the reverse-parity arm after its first
  // live act (walk 1/1, frame 3/3; mark's amend paired by hand — see the
  // report's finding on the held-act release instant). The arena stays null by
  // ruling (P-143). This table records when a lane's pen ACTUALLY flipped on a
  // box, which is a fact about `W2_PEN`, not about the code: a wired lane whose
  // flag has never named it has no flipped era, and a date written before the
  // flag moved would hand the reverse-parity arm a window in which every
  // `journal_seq`-NULL row is the mirror's — finding 2, planted by hand. The
  // founder's flip sets each line, in the same change as the flag.
  // C3 · `W2_PEN=stance,hold,say,walk`, postmark-office.service restarted 19:09:37Z
  // (G:/Starstory/docs/2026-09-05/w2-walk-frame-mark-flip-report.md).
  walk: "2026-09-05T19:09:37Z",
  // C5 · `W2_PEN=stance,hold,say,walk,frame`, restarted 19:11:01Z (same report).
  frame: "2026-09-05T19:11:01Z",
  // C6 · `W2_PEN=stance,hold,say,walk,frame,mark`, restarted 19:12:06Z (same report).
  mark: "2026-09-05T19:12:06Z",
  arena: null,
});

/**
 * The instant this lane's pen flipped, or null when it never has.
 *
 * Fail-closed the way `mirrorExpiresFor` is, and toward the opposite answer for
 * the opposite reason: an unnamed lane there must not buy IMMORTALITY, an
 * unnamed lane here must not buy a FLIPPED ERA it never had. Both defaults are
 * the answer that cannot manufacture a passing check out of an omission.
 */
export function laneFlippedAt(lane, lanes = LANE_FLIPPED_AT) {
  const at = Object.prototype.hasOwnProperty.call(lanes, lane) ? lanes[lane] : null;
  return at ?? null;
}

/** The lanes whose pen has flipped — what a reverse-parity check can ask about. */
export function flippedLanesAt(lanes = LANE_FLIPPED_AT) {
  return Object.keys(lanes).filter((lane) => laneFlippedAt(lane, lanes) !== null);
}

const state = {
  queue: Promise.resolve(),
  written: 0,
  failed: 0,
  lastError: null,
  pool: null,
  // The stance read's SECOND credential, deliberately not `pool` — see
  // § THE STANCE READ'S OWN CREDENTIAL at the foot of this file. `office_api`
  // and `stance_reader` must never share a connection.
  stancePool: null,
};

export function world2Enabled(env = process.env) {
  return env.WORLD2_PG === "1" && !!env.WORLD2_PG_URL;
}

/** Test seam: hand the module a pool (the late-crossing test uses a recording stub). Never used by the office. */
export function __setPoolForTest(p) { state.pool = p; }

async function pool(env = process.env) {
  if (state.pool) return state.pool;
  const { default: pg } = await import("pg");
  state.pool = new pg.Pool({ connectionString: env.WORLD2_PG_URL, max: 2 });
  return state.pool;
}

/**
 * Mirror one journal row into Postgres `acts`. `row` is the exact object
 * appendJournal built (post-normalization: witnesses/payload already JSON
 * strings, at_anchor/at_dx/at_dy split, written_at an ISO string); `seq` is
 * the sqlite rowid it landed at. Fire-and-forget for the caller; serialized
 * so acts receives rows in journal order.
 */
export function mirrorAct(row, seq, env = process.env) {
  if (!world2Enabled(env)) return;
  state.queue = state.queue.then(async () => {
    try {
      const p = await pool(env);
      // ONE SPELLING (enforced 2026-08-29; see world2-pen.insertAct for the
      // whole argument): the resolved household KEY, via the docket pen's own
      // resolver on the docket pen's own input — never the key's name, never a
      // gh:<id>, or acts and claims spell one fact two ways and every reader
      // joining them loses rows silently (the guards lane measured it live).
      const { householdKeyFor } = await import("./world2-claims.mjs");
      // THE LATE-CROSSING GUARD RUNS HERE TOO (2026-09-04). This path inserted
      // straight into acts and, that evening, filed four backfilled holding rows
      // at crossing 157 — certified history — while the pen's insertAct would
      // have refused or re-stamped them. One guard, both pens: a row that may
      // not file through the door may not file through the mirror either.
      const { lateCrossingGuard, actsInsert } = await import("./world2-pen.mjs");
      const guarded = lateCrossingGuard(row, { env });
      const household = guarded.household == null ? null : await householdKeyFor(p, guarded.household);
      // `acts.journal_seq` IS DROPPED (G1 / POS-156, migration 025). This path
      // is the ARENA's now -- the one lane that still writes a sqlite row and
      // so the one caller that still HAS a seq -- and even here the column has
      // no job: nothing pairs the two stores any more, and the arena's seq is
      // its identity inside its own fold, not a key into the record.
      const { text, values } = actsInsert(guarded, household);
      await p.query(text, values);
      state.written += 1;
    } catch (err) {
      state.failed += 1;
      state.lastError = String(err?.message ?? err);
      // Loud, always: a silent shadow is a shadow nobody can trust.
      console.error(`[world2-acts] MIRROR WRITE FAILED (seq ${seq}): ${state.lastError}`);
    }
  });
  return state.queue;
}

/**
 * Status for the office's status answer.
 *
 * `expires` and `lane_expiry` are GONE with the map that fed them (G1). They
 * answered "when does this shim's backstop fire", and there is no shim: this
 * queue is the ARENA's path now, the one lane exempt by ruling, and an
 * exemption has no expiry by definition. A field left behind answering `null`
 * for every lane would read as "nothing is owed" rather than "nothing is
 * governed", which are different sentences.
 */
export function mirrorStatus() {
  const { written, failed, lastError } = state;
  return { enabled: world2Enabled(), written, failed, lastError };
}

/** Await everything queued (tests + graceful shutdown). */
export function mirrorSettled() {
  return state.queue;
}

/**
 * READ the register, through the pool this module already owns.
 *
 * WHY IT LIVES IN THE WRITE MIRROR'S FILE. Three modules — `world2-serve`,
 * `world2-claims`, `world2-pen` — each carry their own private `pool(env)`,
 * and this file is the fourth. A fifth copy in `world-stance.mjs` would be the
 * office learning one word five times, so the read ports borrow the pool from
 * the module that owns the TABLE rather than opening another. (That there are
 * four already is a finding handed up, not a licence to add the fifth.)
 *
 * Returns `null` — never a throw and never `[]` — when the register is not
 * configured. **The distinction is the whole point:** a read port that answered
 * an empty array for "I could not look" would tell its caller the town has no
 * stances, which is the #2454 shape (a door that takes an act, keeps it, and
 * shows a world in which it never happened). `null` means "not asked"; `[]`
 * means "asked, and the answer is none".
 */
export async function actsQuery(text, params = [], env = process.env) {
  if (!world2Enabled(env)) return null;
  const p = await pool(env);
  const { rows } = await p.query(text, params);
  return rows;
}

// ═════════════════════════════════════════════════════════════════════════════
// THE STANCE READ'S OWN CREDENTIAL (POS-195, RULING 2, 2026-09-22)
// ═════════════════════════════════════════════════════════════════════════════
//
// Every other pool in this office is built from ONE connection string,
// `WORLD2_PG_URL`, role `office_api`. That is deliberate and it stays: one door,
// one credential, and the 2026-09-22 measurement counted the four copies of the
// idiom as a finding handed up rather than a licence to add a fifth.
//
// THIS IS THE FIFTH, AND IT IS A DIFFERENT KIND. The other four are four spellings
// of the same credential; this is a SECOND credential, and the separation is the
// whole security property. `stance_reader` may see another household's draft
// (023_stance_reader.sql § the carve). `office_api` may not, and must not learn
// how — so the two cannot share a pool, and the env key that carries the second
// is read in exactly one place, here.
//
// WHY IT SITS BESIDE `actsQuery` RATHER THAN IN `world-stance.mjs`. The same
// reason the read ports borrow this pool: the office should learn the word
// "pool" once per table, not once per caller. Putting it here also means the one
// grep that finds every credential this office holds (`WORLD2_.*_URL` in
// `src/`) finds this one, which is not true of a pool opened in a door file.
//
// ── ABSENT IS `unreachable`, AND NEVER THE JOURNAL ──────────────────────────
//
// `actsQuery` returns `null` for "not asked" because its caller has a 1.0 arm to
// fall back to. THIS READ HAS NONE, by ruling: the sqlite arm is deleted from
// `worldForStances`, not flagged. So the absence of `WORLD2_STANCE_URL` is a
// state the door must SAY, not one it can paper over — a stance read that
// quietly answered "no candidates" because a credential was missing is the
// #2454 shape (a door showing a world in which the thing never happened), and
// here it would silently delete the-late-welcome on the first crossing.
//
// Hence a tagged answer rather than `null`: `{ unreachable: "<why>" }` or
// `{ rows }`. A caller cannot mistake one for the other by forgetting a check,
// which is what `null` invites.
//
// ── NO `WORLD2_PG=1` GATE, AND THAT IS NOT AN OVERSIGHT ─────────────────────
//
// `world2Enabled` asks for the mirror flag because the ACTS mirror is a shim
// that ships with its own death (rule 5) and must be switchable off. This read
// is not a shim — it is the only source `worldForStances` has after G1 — so its
// one condition is whether the credential exists. Gating it on the mirror flag
// would mean turning the mirror off silently empties the stance inbox.

/** Test seam: hand the module a stance pool. Never used by the office. */
export function __setStancePoolForTest(p) { state.stancePool = p; }

const STANCE_URL_KEY = "WORLD2_STANCE_URL";

async function stancePool(env = process.env) {
  if (state.stancePool) return state.stancePool;
  const { default: pg } = await import("pg");
  state.stancePool = new pg.Pool({ connectionString: env[STANCE_URL_KEY], max: 2 });
  return state.stancePool;
}

/**
 * Read `claims` as `stance_reader` — the ONE reader of the draft carve.
 *
 * Returns `{ rows }` when it asked, `{ unreachable: "<sentence>" }` when it
 * could not. Never throws and never falls back: a caller that gets
 * `unreachable` must say so at its door.
 */
export async function stanceQuery(text, params = [], env = process.env) {
  if (!env[STANCE_URL_KEY]) {
    return { unreachable:
      `the stance read has no credential — ${STANCE_URL_KEY} is not set on this office. It is the only source for ` +
      `whether an unpublished sketch stands on your ground (the-late-welcome), and this read will not substitute the ` +
      `1.0 journal for it: that arm was deleted by ruling, not flagged. Set ${STANCE_URL_KEY} to stance_reader's ` +
      `credential (world2/schema/023_stance_reader.sql) and restart the office.` };
  }
  try {
    const p = await stancePool(env);
    const { rows } = await p.query(text, params);
    return { rows };
  } catch (e) {
    return { unreachable:
      `the stance read could not reach the store (${String(e?.message ?? e).slice(0, 160)}) — the candidate list is ` +
      `unknown, which is a different fact from "nothing awaits your word" and is said rather than rounded to it` };
  }
}
