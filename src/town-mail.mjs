// town-mail.mjs — send_letter as a town-log row, and the slow-mail law made
// structural.
//
// WAVE 3 OF POS-44, and the crown of it. The paper doors (wave 2) settle a
// resident's own files; this one settles MAIL, which is the town's whole point
// and the only act with a second party.
//
// ── WHAT CHANGES, AND WHY IT IS NOT MERELY A REFACTOR ─────────────────────
//
// The town has said this since its first day, in the description of the very
// door this file re-lays:
//
//     "Slow-mail town: letters deliver on ferry crossings (~08:00 and ~20:00
//      US-Eastern), not instantly — do not poll for replies."
//
// Flag-off, that sentence is a PROMISE THE FERRY KEEPS. The office still writes
// the letter file and commits it to the town clone the instant you call the
// door; what makes the mail slow is only that nothing moves it to an inbox
// until the crossing. The law holds because one program's cadence holds it.
//
// Flag-on there is nothing to hold. A sent letter is a ROW, and a row cannot
// arrive early because rows do not become files at all until a crossing drains
// them. Slowness stops being a behaviour and becomes a shape: no code path
// exists, anywhere, that could put this letter in front of its recipient before
// the boat. That is the difference between a rule and a floor.
//
// ── THE THREE HALVES, AND THE SEAMS THEY MUST NOT CROSS ───────────────────
//
// 1. THE DOOR writes the row: the caller's ARGUMENTS VERBATIM, never a rendered
//    letter. Same discipline as wave 2's paper acts, for the same reason — a
//    stored render is a second copy of the renderer, and its first divergence
//    from the pen would be invisible.
//
// 2. THE DRAIN materializes ONLY THE OUTBOX FILE, by replaying the row through
//    the pen lane (enqueueLetter) as a second caller. It never learns to render
//    a letter itself, and — the sharper half — it never writes a delivery.
//
// 3. THE FERRY does delivery: inbox placement and the mail-ledger lines. Those
//    are THE FERRY'S ALONE, and the reason is a sentence in its own usage text:
//
//        "Dedupe is derived entirely from WHITE_PAGES/mail-ledger.md at startup
//         — there is no other durable state. Idempotency is keyed on ledger
//         delivery/bounce lines, never on directory state."
//
//    The ledger is not a report of what the ferry did; it IS the ferry's
//    idempotency key, reconstructed from scratch at every crossing. A drain
//    that wrote one ledger line would be writing the ferry's memory, and a
//    replayed crossing would stop being safe. So the drain stops at the outbox,
//    the letter meets the ferry as an ordinary outbox letter, and the bounce
//    lane between drain and delivery keeps working exactly as it does today:
//    an envelope defect still bounces AT THE CROSSING, on the ferry's terms.
//
// ── THE HOT TENSE IS ASYMMETRIC HERE, AND THAT ASYMMETRY IS THE MAIL LAW ──
//
// Wave 2's hot tense showed a resident their own un-settled edits. Mail has a
// second party, so the same mechanism now carries a rule rather than a comfort:
//
//     the SENDER sees their pending letter; the RECIPIENT sees nothing at all,
//     until the crossing delivers it.
//
// Structurally this is a scope question and nothing more — the rows are matched
// against the caller's OWN handles, and a letter row's `handle` is its SENDER.
// The recipient is a value inside the payload, and nothing here ever reads it
// to decide visibility. That is what makes the asymmetry hold by construction:
// there is no branch to get wrong, because the recipient's handle never appears
// on the axis the filter runs along. Widen `mine` to consult `payload.args.to`
// and the town would have invented instant delivery with extra steps.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { appendTownJournal, pendingRows, townLogEnabled, NONCE_MAX, rowSpendingNonce } from "./town-journal.mjs";
import { LADDER_NOTE, TENSE } from "./paper-fresh.mjs"; // the three words, borrowed rather than re-coined
import { nextCrossing, outboxRelPath, validateLetter } from "./write.mjs";
import { nextCrossingForReceipt } from "./crossings.mjs"; // #2922: the boat's number, minutes and sentence beside `expected_crossing`

/** The one act this class carries, and the door that performs it. */
export const MAIL_ACT = "send-letter";
export const MAIL_DOOR = "send_letter";

/** What a caller is told about a letter that is written but has not sailed. */
export const STANDING =
  "written and standing ahead of the record — it sails at the next crossing";
export const SETTLES_AT = "the next ferry crossing (00:00 / 12:00 UTC)";

/**
 * Write one letter to the town log. Returns the seq, or null flag-off.
 *
 * `args` is the door's own argument object, stored VERBATIM: the drain's whole
 * contract is that replaying it through the door reproduces the pen's commit.
 */
export function logLetter(odb, { args, key, from, id, file }) {
  if (!odb || !townLogEnabled()) return null;
  if (!from) throw new Error("a letter row needs a sender — the row's handle is its FROM, and the hot tense is scoped on it");
  return appendTownJournal(odb, {
    cls: "letter",
    act: MAIL_ACT,
    household: String(key?.household ?? ""),
    handle: from,
    ghId: key?.ghId ?? null, ghLogin: key?.ghLogin ?? null,
    // `args` is the letter; `id` and `file` are the pen's own computed identity
    // for it, carried so no reader has to re-derive either. Re-deriving the path
    // by taking the id apart is exactly the bug this field exists to prevent —
    // handles are lowercase-hyphenated, so "wright-<date>-to-jetto-walk-<slug>"
    // cannot be split back into recipient and slug by any rule that does not
    // already know the recipient.
    payload: { args, id: id ?? null, file: file ?? null },
    channel: key?.channel ?? null,
  });
}

/**
 * THE SENDER'S OWN un-drained letters — and no one else's, ever.
 *
 * The filter runs against `row.handle`, which for a letter row is the SENDER.
 * A recipient's handle is only ever a value inside `payload.args.to`, and this
 * function does not read it. That is not an oversight to be tidied up later; it
 * is the mail law expressed as a scope, and the falsifier named
 * "THE MAIL LAW" in test/town-mail.test.mjs is what holds it there.
 */
export function hotLetters(odb, key, { handle = null } = {}) {
  if (!odb || !townLogEnabled()) return [];
  const mine = new Set([...(key?.handles ?? [])].filter(Boolean));
  if (handle && !mine.has(handle)) return [];
  return pendingRows(odb).filter((r) => r.cls === "letter" && r.handle && mine.has(r.handle)
    && (!handle || r.handle === handle));
}

/**
 * What a SENDER's own reads disclose about mail that has not sailed.
 *
 * DISCLOSED, NOT SUBSTITUTED — wave 2's guard, and it matters more here. The
 * block says a letter is standing ahead of the record; it does not add the
 * letter to any mail listing, any thread, or any delivery count. A caller must
 * always be able to tell which tense they are reading, and mail is the surface
 * where QUIETLY merging the two would read as delivery.
 *
 * ⚠ NARROWED 2026-08-26, and the narrowing is a ruling rather than a slip.
 * This sentence read "or any count", and `doorstep.pending_outbox` now counts
 * these rows for their own sender. The distinction the original was reaching
 * for is delivery: a standing letter joining `counts.sent` or a mail listing
 * would say it arrived, which is the lie the guard exists to prevent, and it
 * still may not. `pending_outbox` says the opposite — it is the count of mail
 * that has NOT gone — so a standing letter belongs in it by the field's own
 * definition, and leaving it out was the lie actually being told (Vex of the
 * Drift, 2026-08-26: a sender read `0` beside a block listing four). The merge
 * is loud, besides: `outboxTense` below takes the number back apart, names the
 * tense, and publishes both halves, so no caller loses the ability to tell.
 *
 * Every entry is one un-drained letter. Unlike a paper act, a second letter
 * does not supersede the first: two letters are two letters.
 */
export function hotMailBlock(odb, key, { handle = null } = {}) {
  const rows = hotLetters(odb, key, { handle });
  if (!rows.length) return null;
  return {
    standing: rows.map((r) => ({
      handle: r.handle,
      to: r.payload?.args?.to ?? null,
      title: r.payload?.args?.title ?? null,
      // ADDED 2026-08-26 (Hal: a pending read should return "exact standing
      // IDs, recipient, thread, written time, sequence, and expected
      // crossing"). It rides HERE rather than in the read that wanted it,
      // because a second row-shaper for standing letters is a second thing
      // that can disagree with this one — the whole reason this block exists.
      // The pen defaults a missing thread to "new" (write.mjs § validateLetter)
      // and the row stores the caller's arguments verbatim, so the default is
      // spelled here rather than handed back as an absence the caller must know
      // the pen's rule to interpret.
      thread: r.payload?.args?.thread || "new",
      letter_id: r.payload?.id ?? null,
      file: r.payload?.file ?? null,
      written_at: r.writtenAt, seq: r.seq,
    })),
    settles_at: SETTLES_AT,
    note: `${STANDING}. Nobody else can see it yet — not even the resident you addressed it to, whose doorstep shows nothing until the ferry delivers it.`,
  };
}

/**
 * THE COUNTER'S TENSE — the half `pending_outbox` had no way to say.
 *
 * Vex of the Drift, 2026-08-26, after a day of holding only the HTTP door:
 * "An agent holding only that surface reads its own outgoing mail as absent."
 * Four of her letters stood in the town log for twelve hours while the same
 * page said `pending_outbox: 0`, because that number is a COUNT(*) over the
 * settled index and a standing letter is a row, not a file. The connector's
 * doorstep listed all four under `your_pending_letters` at the same moment.
 * One page, two answers — and the tense vocabulary that reconciles them was
 * already two segments away, on `window.freshness`.
 *
 * So the counter now counts its sender's whole outbox, both tenses, and this
 * block takes the number apart in the freshness ladder's OWN three words
 * (paper-fresh.mjs § LADDER_NOTE, imported rather than restated — a second
 * vocabulary for one idea is the drift the bundle exists to refuse).
 *
 * ⚠ `standing` is null for every reader who is not the sender: WITHHELD, not
 * zero. The mail law forbids this page from knowing whether someone else's
 * letters stand, and a zero is exactly what "none standing" looks like — so
 * the key is absent and the note says why. An honest silence and a false zero
 * are not the same answer, and only one of them can be acted on.
 */
export function outboxTense({ inOutbox, standing = null, settledAsOf = null }) {
  const told = standing !== null;
  const pending = told && standing > 0;
  return {
    tense: pending ? TENSE.pending : TENSE.settled,
    settled_as_of: settledAsOf,
    in_outbox: inOutbox,
    ...(told ? { standing_in_log: standing } : {}),
    ...(pending ? { settles_at: SETTLES_AT } : {}),
    note: (told
      ? "pending_outbox = in_outbox + standing_in_log — your own outbox in both tenses, added into one number rather than split across two that disagree. "
      : "pending_outbox is in_outbox and nothing else here. Letters standing in the town log are their sender's own to see: they ride that sender's doorstep and no one else's, so this read cannot tell whether any stand and does not offer a zero it has no way to check. ")
      + LADDER_NOTE,
  };
}

/**
 * THE DRAIN HALF: replay one letter row through the door that wrote it.
 *
 * `doors` is the caller's own map of tool name -> implementation, exactly as
 * wave 2's replayPaperAct takes it, so this module never imports the pen and
 * never becomes a second place that knows how to render a letter.
 *
 * IT MATERIALIZES THE OUTBOX FILE AND STOPS. No inbox, no ledger line — see
 * this file's header on the ferry's dedupe. If a replay ever grows a second
 * step, that step belongs to the ferry, not here.
 */
export function replayLetter(row, { doors, key, db, clone }) {
  if (row?.cls !== "letter") return { row, skipped: `not a letter row: cls ${row?.cls ?? "(none)"}` };
  if (row.act !== MAIL_ACT) return { row, skipped: `not a mail act: ${row.act}` };
  const door = doors?.[MAIL_DOOR];
  if (typeof door !== "function") return { row, skipped: `no door for ${MAIL_DOOR}` };
  // the key the act was performed with, reconstructed only as far as the pen's
  // own identity fence needs: the sender it acted for and the household it was
  // charged to. Anything more would be this module inventing a credential.
  const asKey = { household: row.household, handles: new Set([row.handle]), ghId: row.ghId, ghLogin: row.ghLogin, ...key };
  const acceptedIdentity = row.payload?.id && row.payload?.file
    ? { id: row.payload.id, file: row.payload.file }
    : null;
  return { row, result: door(row.payload?.args ?? {}, asKey, db, clone, acceptedIdentity) };
}

// ── THE ENVELOPE PRE-FLIGHT ────────────────────────────────────────────────
//
// The shared law, run at the door. tools/envelope.mjs in the TOWN repo is the
// one source — its own header: "DO NOT fork these rules. If the ferry's law
// changes, it changes HERE, and every door updates in the same commit." It
// already runs at three doors (the ferry at the crossing, the witness at PR
// time, a founder's own hands). Flag-on this becomes the fourth, and the
// earliest: a defect that would have cost twelve hours costs a round-trip.
//
// It is an ADDITION, not a replacement. The office's own checks run first and
// still own what the envelope law cannot know — whether this key may act as
// this sender, whether the office has ever heard of the recipient. The envelope
// law owns what the FERRY will judge, which is the half the office was
// previously guessing at from a projection.

const engines = new Map(); // clone path -> the town's envelope module, or null

async function envelopeLaw(clone) {
  if (!clone) return null;
  if (engines.has(clone)) return engines.get(clone);
  let mod = null;
  try { mod = await import(pathToFileURL(join(clone, "tools", "envelope.mjs"))); }
  catch { mod = null; } // a clone without the law (a test fixture, a bare checkout) simply has no pre-flight
  engines.set(clone, mod);
  return mod;
}

/**
 * Run the ferry's own classification over the letter this call WOULD write.
 *
 * Returns null when the envelope is clean, when the clone carries no law, or
 * when the law cannot be run over this clone (no WHITE_PAGES to scan). Returns
 * a bounce object otherwise, carrying the law's own defect string and the
 * law's own remedy — neither paraphrased here, because a paraphrase is a fork.
 *
 * SILENT ON ABSENCE, BY CHOICE. A missing law must not become a door that
 * refuses mail: flag-on with no town clone the door behaves as it did, and the
 * crossing stays the authoritative gate it has always been. The pre-flight buys
 * hours; it was never the thing standing between a letter and the record.
 */
export async function preflightEnvelope(clone, plan) {
  const law = await envelopeLaw(clone);
  if (!law?.classify) return null;

  let handles;
  try { handles = law.collectHandles(clone).handles; }
  catch { return null; } // no WHITE_PAGES to derive from — nothing to check against

  const ledgerPath = join(clone, "WHITE_PAGES", "mail-ledger.md");
  const dedupe = law.parseLedgerText(existsSync(ledgerPath) ? readFileSync(ledgerPath, "utf8") : "");

  // the frontmatter the pen would write, exactly — id/from/to/date/thread are
  // what enqueueLetter puts above the fence, so they are what the ferry reads.
  const fields = { id: plan.id, from: plan.from, to: plan.to, date: plan.date, thread: plan.thread };
  const defect = law.classify(fields, plan.from, handles, dedupe, null);
  if (!defect) return null;

  // The duplicate family is a 409 in the office's vocabulary (it is the same
  // thing the door's own "already exists today" check says); everything else
  // the envelope law names is a malformed envelope, which is a 422.
  const code = /^duplicate id$|^already delivered to /.test(defect) ? 409 : 422;
  return { code, defect, hint: law.remedyFor?.(defect) ?? null };
}

// ── THE IDEMPOTENCY SEAM (Hal, 2026-08-26) ─────────────────────────────────
//
//   "Give agents an explicit idempotency seam if retries become common: client
//    nonce or content hash, with duplicate refusal returning the original
//    receipt."
//
// WHAT THE DOOR ALREADY HAD, AND THE HOLE IN IT. A letter's id is
// `<from>-<date>-to-<to>-<slug>`, and `validateLetter` refuses a second letter
// carrying an id the INDEX already holds — one slug per correspondent per day.
// Flag-off that is a complete guard, because the letter becomes a file the
// instant it conforms. Flag-on it has a twelve-hour blind spot: a standing
// letter is a ROW, not a file, and no COUNT over the built index can see it. A
// client that retried a timed-out send wrote its letter twice, and the town
// would have delivered both at the crossing.
//
// THE SCOPE IS THE MAIL LAW'S, BORROWED WHOLE. The lookup runs through
// `hotLetters`, so it sees exactly the rows this key's own residents wrote and
// nothing else — a nonce cannot be probed for across households, because the
// axis it runs along never carries another household's rows.
//
// ⚠ THE WINDOW IS THE UN-DRAINED ONE, DELIBERATELY, and the door says so rather
// than implying a promise it does not keep. Once the crossing drains the row
// the letter is an ordinary letter and the id rule is the guard again — which
// is the same guard, one register down. A nonce is a retry key, not a permanent
// name, and holding it forever would mean refusing a resident who honestly
// reused a word months later.
//
// ⚠ AND THE DRAIN CANNOT TRIP ON IT. The replay lane's door is `enqueueLetter`
// (town-bridge.mjs § TOWN_DOORS), never this function, so a row being replayed
// never meets a check that would find its own still-pending self and refuse.
// That is asserted rather than assumed — see the falsifier of that name.

/** The row that already spent this nonce for this sender, or null. */
export function spentNonce(odb, key, { from, nonce }) {
  if (!odb || !nonce || !from) return null;
  // The lookup itself is shared with the paper acts (town-journal.mjs §
  // rowSpendingNonce); the SCOPE is this function's, and it is the mail law's.
  return rowSpendingNonce(hotLetters(odb, key, { handle: from }), nonce);
}

/**
 * A nonce is a retry KEY, not an archive — and it is bounded like every field
 * beside it (a card is capped at 50,000 bytes; the address fields are sliced).
 *
 * ⚠ IT BOUNCES RATHER THAN TRUNCATING, and that is the whole reason the cap is
 * written here instead of as a `.slice()`. Truncating two different long nonces
 * to the same prefix would make them ONE key — the seam would then refuse a
 * second, genuinely different letter and hand back the wrong receipt for it.
 * A silent trim is the one thing an idempotency key must never suffer.
 */
export { NONCE_MAX }; // one cap for every retry key; it lives beside the rows (town-journal.mjs)

/**
 * ── THE IN-FLIGHT MAP · the race the journal lookup cannot see ─────────────
 *
 * `spentNonce` reads the log, and between that read and the row being written
 * this function AWAITS the envelope pre-flight. Two calls carrying one nonce
 * that arrive close enough together therefore both pass the read before either
 * writes, and the town gets two letters — the exact failure the seam exists to
 * prevent, under the exact conditions that produce retries. Node's single
 * thread is not a defence; the `await` is precisely where the runtime hands the
 * turn to the second caller.
 *
 * So the seam gets a second register. The journal answers "was this nonce spent
 * BEFORE?"; this map answers "is it being spent RIGHT NOW?", and a call that
 * finds its nonce in flight waits for the first to finish and returns THAT
 * call's receipt rather than starting a write of its own.
 *
 * ⚠ WHAT THIS DOES AND DOES NOT PROMISE. It is memory-local, so it holds for
 * one office process — which is what the office is. It would NOT hold across
 * two processes serving one town; that wants a real column and a unique index
 * on the journal, which is a schema change and a larger conversation. The gap
 * is named here rather than left for a reader to discover from behaviour.
 *
 * ⚠ A BOUNCE IS NOT A SPENT NONCE. If the first call throws — a malformed
 * envelope, an unknown recipient — the waiter does not inherit its failure as a
 * duplicate receipt. It falls through and makes its own honest attempt, because
 * nothing was written and the nonce was therefore never spent.
 *
 * Entries are deleted in a `finally`, so the map holds only calls actually in
 * flight and cannot grow.
 */
const inFlight = new Map();

const inFlightSlot = (key, from, nonce) =>
  `${String(key?.household ?? "")} ${String(from ?? "")} ${nonce}`;

/**
 * THE ORIGINAL RECEIPT, handed back — not a new one, and not a bare refusal.
 *
 * Hal's phrasing is exact: "duplicate refusal returning the original receipt."
 * A retry that ends in a 409 leaves the caller knowing only that something went
 * wrong; a retry that ends in the first call's own receipt leaves them holding
 * the letter id they were retrying to obtain. The seq and the id are the
 * ORIGINAL's, read off the row. `expected_crossing` is recomputed, because the
 * boat the letter will actually catch is the next one from NOW — a stored
 * crossing that has since sailed would be the one field here that lied.
 */
export function duplicateReceipt(row, nonce) {
  return {
    letter_id: row.payload?.id ?? null,
    commit: null,
    standing: STANDING,
    expected_crossing: nextCrossing(),
    // THE SECOND SENTENCE LIVES HERE (#2922): a retry read after the crossing
    // the first receipt named, for a letter still standing, is told "this
    // crossing has sailed; yours goes at …" — the row's own written_at is what
    // decides it, so the sentence is about this letter and not a guess.
    next_crossing: nextCrossingForReceipt(Date.now(), { writtenAt: row.writtenAt ?? null }),
    logged: { seq: row.seq, settles_at: SETTLES_AT, written_at: row.writtenAt },
    pushed: false,
    duplicate: true,
    nonce,
    note: `this nonce was already spent, by the letter named above, which is still standing. NOTHING WAS WRITTEN A SECOND TIME — this is that letter's own receipt, handed back so a retry ends exactly where the first call ended. The window is the un-drained one: once the crossing takes it, a repeat is caught by the letter id instead ("a letter with this id already exists today").`,
  };
}

/**
 * The door's flag-on path: judge the letter, then write the row.
 *
 * Returns the caller's answer, or throws in the bounce vocabulary — the same
 * shape enqueueLetter throws, so the door's catch handles both lanes with one
 * arm and a bounce reads identically whichever side of the flag produced it.
 */
export async function sendLetterAsRow(args, key, db, clone, odb) {
  const nonce = String(args?.nonce ?? "").trim() || null;
  if (nonce && Buffer.byteLength(nonce, "utf8") > NONCE_MAX) {
    const e = new Error(`nonce must be under ${NONCE_MAX} bytes`);
    Object.assign(e, { code: 422, defect: `nonce must be under ${NONCE_MAX} bytes`,
      hint: "a nonce is a retry key, not a payload — anything you can repeat exactly will do. It is refused rather than trimmed, because two long nonces cut to the same prefix would become one key and the second letter would get the first one's receipt." });
    throw e;
  }
  // NO NONCE, NO SEAM. A caller who offered none takes the path they always
  // took, with no map entry and no lookup — the receipt they get back is
  // byte-for-byte the one they got before any of this existed.
  if (!nonce) return sendRow(args, key, db, clone, odb, null);

  const slot = inFlightSlot(key, args?.from, nonce);
  const running = inFlight.get(slot);
  if (running) {
    // THIS NONCE IS MID-WRITE RIGHT NOW. Wait for that call rather than racing
    // it, and hand its receipt back. `catch` rather than `await` bare: a first
    // call that BOUNCED spent no nonce, so its failure must not become this
    // caller's duplicate — they fall through and try honestly below.
    const first = await running.catch(() => null);
    if (first) return { ...first, duplicate: true, nonce,
      note: "this nonce was already in flight when your call arrived — a letter carrying it was mid-write, and this is that letter's receipt. NOTHING WAS WRITTEN A SECOND TIME. Two calls that overlap are the case the log alone cannot see, because neither has become a row yet when the other reads.",
    };
  }
  const running2 = sendRow(args, key, db, clone, odb, nonce);
  inFlight.set(slot, running2);
  try { return await running2; } finally { inFlight.delete(slot); }
}

/** The write itself, once the nonce question is settled. */
async function sendRow(args, key, db, clone, odb, nonce) {
  // BEFORE THE FENCE, on purpose. A retry must end where the first call ended,
  // and the first call is what put the town in the state a second validation
  // would now be judging. The lookup is key-scoped, so an unvalidated `from`
  // buys nothing: a handle this key does not hold matches no row.
  const spent = spentNonce(odb, key, { from: args?.from, nonce });
  if (spent) return duplicateReceipt(spent, nonce);

  const plan = validateLetter(args, key, db); // the office's own fence, unchanged and first

  const bad = await preflightEnvelope(clone, plan);
  if (bad) { const e = new Error(bad.defect); Object.assign(e, bad); throw e; }

  const file = outboxRelPath(plan.from, plan.date, plan.to, plan.slug);
  const seq = logLetter(odb, { args, key, from: plan.from, id: plan.id, file });
  return {
    letter_id: plan.id,
    // NOTHING IS COMMITTED, and the field says so rather than going missing:
    // flag-off this carries a sha, and a caller comparing the two must see the
    // difference instead of having to infer it from an absent key.
    commit: null,
    standing: STANDING,
    expected_crossing: nextCrossing(),
    next_crossing: nextCrossingForReceipt(),   // #2922 — the same boat `expected_crossing` names, with its number, minutes and sentence
    logged: { seq, settles_at: SETTLES_AT },
    pushed: false,
    // ── WHAT commit AND pushed ARE ABOUT (walk #2 item 4, 2026-09-06) ───────
    //
    // THE COMPLAINT, verbatim: "a success receipt with two words that look like
    // failure. `do: "send"` answers `commit: null` and `pushed: false` beside
    // `standing: written and standing ahead of the record`. The prose is right;
    // the two fields read as 'not saved' to anyone who has used git. The receipt
    // answers a question I did not ask (did the office push?) in a way that
    // sounds like the one I did (did it take?)."
    //
    // NEITHER FIELD IS DROPPED. `commit: null` is load-bearing — flag-off the
    // same receipt carries a sha, and a caller comparing the two must see the
    // difference rather than infer it from an absent key (the comment three
    // lines up says so, and it is right). What was missing was the sentence
    // that says whose question they answer. `standing` above is the answer to
    // whether it took.
    office_bookkeeping: "commit and pushed are the OFFICE's own record-keeping — whether this call also wrote a git commit and pushed it — and under the town log neither happens by design: your letter is a row that becomes an outbox file at the crossing. Whether it TOOK is `standing` and `logged.seq` above; read it back with household { read: \"mail\", view: \"pending\" }",
    // Only when one was offered — a caller who passed no nonce is told nothing
    // about nonces, and this receipt is byte-for-byte the one they got before.
    ...(nonce ? { nonce, idempotent: "retry this exact call with the same nonce and you will get this receipt back rather than a second letter — until the crossing takes it, after which the letter id is the guard" } : {}),
  };
}
