// town-updates.mjs — the paper doors as town-journal rows, and the hot tense.
//
// WAVE 2 OF POS-44. The five paper doors — update_address_body, the new
// update_address_fields, update_home, update_profile, update_window — write
// `cls: "update"` rows to the town log when TOWN_SINGLE_LOG is on, and the
// ferry's drain materializes the same pen commits it would have made anyway.
//
// WHY THE TOWN LOG AND NOT THE WORLD'S: a resident's card, home page and window
// are the TOWN's record — the white pages — and they settle on the ferry's
// cadence. The world log holds ground. The two are separate tables (slice 1's
// ruling), so `update` is registered in TOWN_CLASSES and the world log's
// tripwire bounces it on sight.
//
// ONE IMPLEMENTATION, SECOND CALLER — the same discipline slice 1's drain kept
// with buildJoinFiles. The row carries the door's own arguments, and the drain
// replays them through THE DOOR ITSELF. There is no second renderer of an
// ADDRESS card here, so there is nothing that can drift from what the pen
// writes; the drain's output is the door's output because it is the door.
//
// THE HOT TENSE, and it is the half that is easy to get wrong. Flag-on, a
// resident's own edit is REAL to them immediately — the doorstep hands back the
// window they just hung, not the one the last crossing settled. The record is
// still the record and the crossing is still what makes it durable; what the
// hot tense fixes is that a resident should never be shown a stale version of
// their OWN act and be left wondering whether the door worked. It is scoped to
// the caller's own handles for exactly that reason: it is not a preview of the
// town, it is your own pen not lying to you.
//
// ⚠ HALF OF THAT LAST SENTENCE WAS OVERTURNED (the founder, 2026-08-25). The
// public reads of a resident's paper now compose the pending edit for EVERYONE,
// each field carrying a stamp saying which tense it is in — the freshness
// ladder, src/paper-fresh.mjs. Both states are left standing above rather than
// tidied into one, because the reasoning that made the hot tense caller-scoped
// is still exactly the reasoning behind `hotTenseBlock`, which is unchanged: a
// DISCLOSURE to the owner, never a substitution. What is new is that the town
// gets a STAMPED compose as well, and the stamp is what keeps a compose from
// being a substitution nobody was told about. `pendingPaperRows` is its feed.

import { appendTownJournal, pendingRows, townLogEnabled, NONCE_MAX, rowSpendingNonce } from "./town-journal.mjs";

/** The paper doors, and the file each one settles. */
export const PAPER_ACTS = Object.freeze({
  "address-body": { tool: "update_address_body", file: (h) => `WHITE_PAGES/${h}/ADDRESS.md` },
  "address-fields": { tool: "update_address_fields", file: (h) => `WHITE_PAGES/${h}/ADDRESS.md` },
  // ⚠ `HOME/HOME.md`, not `HOME.md` — corrected 2026-08-25. The door has always
  // written `WHITE_PAGES/<h>/HOME/HOME.md` (edit.mjs § updateHomeUnlogged: `const
  // rel = ["WHITE_PAGES", handle, "HOME", "HOME.md"]`), and this line named a
  // path no town has ever had, so `your_pending_edits` told a resident with a
  // pending home edit to look at a file that does not exist. The old falsifier
  // asserted `typeof file === "string"` — a probe that could not have caught a
  // wrong path if it tried. The one below it now compares this table against
  // what the doors return, which closes the class rather than this instance.
  home: { tool: "update_home", file: (h) => `WHITE_PAGES/${h}/HOME/HOME.md` },
  profile: { tool: "update_profile", file: (h) => `WHITE_PAGES/${h}/PROFILE.md` },
  window: { tool: "update_window", file: (h) => `WHITE_PAGES/${h}/WINDOW/window.html` },
});

export const PAPER_ACT_NAMES = Object.freeze(Object.keys(PAPER_ACTS));

/**
 * THE ACT'S WHOLE OUTCOME, as commits — the shas this call actually landed.
 *
 * #2302: the row stores its args and the drain replays them, and the contract
 * sentence below only holds if the file is still what it was. The sha the pen
 * returned is the one thing that says "this act is already in the history",
 * which is what lets the drain tell a resume from a re-imposition.
 *
 * ONE LEVEL DEEP, ON PURPOSE. A paper act is not always one commit: the w37
 * profile door routes `display_name` to the ADDRESS card through
 * `updateAddressFieldsUnlogged` and hands its result back nested (`named`), so
 * that act's outcome is TWO commits under ONE row — and a call that was only a
 * display name returns `commit: null, unchanged: true` at the top while
 * `named.commit` holds a real sha. A guard that read only `out.commit` would
 * call that act a no-op and re-impose it, which is this issue with a second
 * face. Walking the answer's own object-valued properties covers `named` today
 * and a third half tomorrow without a second edit here; a door that buries its
 * pen deeper than one level must say so at that level or add its sha itself.
 *
 * Deduped and order-preserving; a door that returned no sha contributes none,
 * which is how an EMPTY list comes to mean "this act wrote nothing".
 */
export function paperActCommits(out) {
  if (!out || typeof out !== "object") return [];
  const seen = new Set();
  const take = (v) => { if (typeof v === "string" && v) seen.add(v); };
  take(out.commit);
  for (const v of Object.values(out))
    if (v && typeof v === "object" && !Array.isArray(v)) take(v.commit);
  return [...seen];
}

/**
 * Write one paper act to the town log. Returns the seq, or null flag-off.
 *
 * The row carries the door's arguments VERBATIM, because the drain's whole
 * contract is that replaying them through the door reproduces the commit. A row
 * that stored a rendered result instead would be a second copy of the render,
 * and the first divergence would be invisible.
 *
 * IT ALSO CARRIES THE OUTCOME (#2302), and the two are not the same kind of
 * thing. The args are what to replay; `commits` is what this call already did,
 * and it is the drain's resume key — the exact role `payload.file` plays for a
 * letter row (town-bridge.mjs § idempotence). Storing it is not "a second copy
 * of the render": a sha is not a rendering of anything, it is a name for a
 * point in the history that either is or is not behind the clone's HEAD.
 *
 * A DOCUMENTED NO-OP IS NOT LOGGED. `commits: []` — the caller looked and the
 * act landed nothing — writes no row, because a row that wrote nothing has
 * nothing to settle and replaying it can only re-impose args against a file
 * that has moved on. That is the whole of the 63a38162 instance: a "clear these
 * four fields" call that was a no-op against a file without them, replayed at
 * the crossing against a file that by then had them.
 *
 * ABSENT IS NOT EMPTY. `commits` undefined means the caller did not say what it
 * landed — the direct callers in test/ and any future one — and such a row is
 * logged and replayed exactly as before. The absent-reads-as-falsy shortcut is
 * refused deliberately here and again in the drain's guard.
 */
export function logPaperAct(odb, { act, handle, household, args, key, commits }) {
  if (!odb || !townLogEnabled()) return null;
  if (!PAPER_ACTS[act]) throw new Error(`"${act}" is not a paper act — the town log's update rows are ${PAPER_ACT_NAMES.join(", ")}`);
  if (Array.isArray(commits) && commits.length === 0) return null;
  return appendTownJournal(odb, {
    cls: "update",
    act,
    household: String(household ?? key?.household ?? ""),
    handle,
    ghId: key?.ghId ?? null, ghLogin: key?.ghLogin ?? null,
    payload: Array.isArray(commits) ? { args, commits } : { args },
    channel: key?.channel ?? null,
  });
}

/**
 * THE DOOR THAT LOGS ITSELF — one seam, and the reason it moved here.
 *
 * Wave 2 put the logging in mcp.mjs's FLAT-TOOL switch, one call site beside
 * one of the three ways a paper act reaches a door. The dev rehearsal found the
 * other two: `PATCH /profile/{handle}` calls the verb directly in server.mjs,
 * and the household apex's `do: "profile"` calls it directly in
 * household-apex.mjs. Both skipped the log entirely — and since the flats are
 * the DELISTED path, flag-on in production most paper edits would never have
 * reached the log at all, while `your_pending_edits` went on reporting a hot
 * tense it could not see. A disclosure that lies by omission is worse than one
 * that is missing, because it reads as an answer.
 *
 * So the log now lives where the pen commit lives. A skin cannot forget it,
 * because a skin no longer has the option: there is nothing to remember.
 *
 * THE LOG HANDLE IS THE FIFTH ARGUMENT, and that is load-bearing rather than
 * plumbing. `replayPaperAct` calls the door with FOUR — `door(args, asKey, db,
 * clone)` — so the drain physically cannot pass one, and a replay therefore
 * cannot write a row for the row it is draining. That is the same structural
 * guard wave 4 gave the mail door by binding `send_letter` to the flag-off pen:
 * the drain's safety is a shape, not a flag anybody has to check.
 *
 * AND IT RECORDS WHAT IT DID (#2302). The door is the only place that holds
 * both halves at once — the args, and the sha its own pen just returned — so
 * it is the only place that can hand the drain a resume key without a second
 * reader inventing one. `out` is in scope here and was already being spread
 * into the answer; the row now carries its shas too.
 */
export function paperDoor(act, impl) {
  return function paperDoorCall(args, key, db, clone, odb = null) {
    // ── THE NONCE (POS-70 §5, ruled 2026-09-24) ─────────────────────────────
    //
    // The send's retry key, served here with the send's own lookup
    // (town-journal.mjs § rowSpendingNonce) over rows this door already
    // writes. A door field, never the act's: it is taken off before `impl`
    // sees the args, and it stays in the row's args (verbatim, as a letter
    // row keeps its own), which is where the lookup reads it back. The
    // drain's replay reaches this function with FOUR arguments and no log, so
    // it strips the nonce, looks nothing up and discloses nothing.
    //
    // NO IN-FLIGHT MAP, unlike the send's, and not by omission: `impl` is
    // synchronous, so between the lookup and the row nothing can yield the
    // turn to a second caller. The send's race lives in an `await`; this
    // door has none.
    const nonce = String(args?.nonce ?? "").trim() || null;
    const logOn = townLogEnabled();
    if (nonce && logOn && odb) {
      if (Buffer.byteLength(nonce, "utf8") > NONCE_MAX) {
        const e = new Error(`nonce must be under ${NONCE_MAX} bytes`);
        Object.assign(e, { code: 422, defect: `nonce must be under ${NONCE_MAX} bytes`,
          hint: "a nonce is a retry key, not a payload — anything you can repeat exactly will do. It is refused rather than trimmed, because two long nonces cut to the same prefix would become one key." });
        throw e;
      }
      const spent = spentPaperNonce(odb, key, { act, handle: args?.handle, nonce });
      if (spent) return paperDuplicateReceipt(spent, nonce);
    }
    const { nonce: _nonce, ...actArgs } = args ?? {};
    const out = impl(args && Object.prototype.hasOwnProperty.call(args, "nonce") ? actArgs : args, key, db, clone);
    // AFTER success only. A bounce throws out of `impl` and never reaches this
    // line, so no row can ever claim an edit that did not happen — and so a
    // bounced first call spends no key.
    if (out?.error) return out;
    // FLAG-OFF, DISCLOSED exactly as the send discloses it (send-at-door.mjs):
    // an office with no town log cannot remember a key, and says so.
    if (nonce && !logOn)
      return { ...out, nonce, nonce_honoured: false, nonce_note: PAPER_NONCE_NOT_HONOURED };
    if (!odb) return out;
    let seq = null;
    try {
      seq = logPaperAct(odb, { act, handle: args?.handle, household: key?.household, args, key,
        commits: paperActCommits(out) });
    } catch (e) {
      // THE EDIT LANDED — the pen commit is already in the town clone, so
      // failing the call here would tell the caller a true thing about the log
      // by telling them a false thing about their edit. But it does not vanish
      // either, which is what the old seam did: flag-on, a log that will not
      // write means the crossing will not settle this act and the hot tense is
      // blind to it, and nobody would ever know. It is loud on stderr, in the
      // office's own instrumentation grammar, and the answer still carries the
      // edit.
      console.error(`[town-log] paper act "${act}" for ${args?.handle ?? "(no handle)"} did NOT reach the log: ${String(e?.message ?? e)}`);
      return out;
    }
    return seq == null ? out : { ...out, logged: { seq, settles_at: SETTLES_AT },
      // Only when one was offered — a caller who passed no nonce is told
      // nothing about nonces, and their receipt is byte-for-byte what it was.
      ...(nonce ? { nonce, idempotent: "retry this exact call with the same nonce and you will get this receipt back rather than a second edit — until the crossing settles it" } : {}) };
  };
}

/**
 * The row that already spent this nonce on THIS act for THIS resident, or null.
 *
 * The lookup is the send's (town-journal.mjs § rowSpendingNonce); the scope is
 * `hotPaperActs`', which reads only the caller's own residents' un-drained rows
 * — so a nonce cannot be probed across households, exactly as F12c holds for
 * mail. It is narrowed to the one act as well: the same word spent on a home
 * edit and then on a window is two edits, and handing the home's receipt back
 * for the window would be the wrong receipt.
 */
export function spentPaperNonce(odb, key, { act, handle, nonce }) {
  if (!odb || !nonce || !handle) return null;
  return rowSpendingNonce(hotPaperActs(odb, key, { handle }).filter((r) => r.act === act), nonce);
}

/**
 * THE FIRST EDIT'S RECEIPT, handed back — read off its row, as the send's
 * duplicate receipt is (town-mail.mjs § duplicateReceipt). The row holds what
 * the first call landed (`commits`, #2302) and when; `updated`, `file`,
 * `commit` and `logged` are its own, so a retry ends where the first call
 * ended. Nothing is written a second time.
 */
export function paperDuplicateReceipt(row, nonce) {
  const commits = Array.isArray(row.payload?.commits) ? row.payload.commits : [];
  return {
    updated: row.handle,
    file: PAPER_ACTS[row.act]?.file(row.handle) ?? null,
    commit: commits[0] ?? null,
    ...(commits.length > 1 ? { commits } : {}),
    logged: { seq: row.seq, settles_at: SETTLES_AT, written_at: row.writtenAt },
    duplicate: true,
    nonce,
    note: "this nonce was already spent, by the edit named above, which is still standing ahead of the record. NOTHING WAS WRITTEN A SECOND TIME — this is that edit's own receipt, read back off its row. Once the crossing settles it, the page itself is the guard: the same edit again changes nothing and answers `unchanged: true`.",
  };
}

/** What a paper act says flag-off when it was handed a nonce — the send's
 *  disclosure, with the guard that DOES hold on paper named instead of the
 *  letter's id. */
export const PAPER_NONCE_NOT_HONOURED = "this office keeps no town log, so a nonce cannot be remembered and this receipt is NOT idempotent by it. The guard that is holding is the page itself: your edit became a pen commit the moment it conformed, and the same call again changes nothing and answers `unchanged: true`.";

/** What a caller is told about when their logged edit becomes the record. */
export const SETTLES_AT = "the next ferry crossing (00:00 / 12:00 UTC)";

/**
 * THE HOT TENSE: the un-drained paper acts belonging to THIS caller.
 *
 * Newest-last, so a caller who edited twice sees the second edit — the log is
 * append-only and the later row is the later truth.
 */
export function hotPaperActs(odb, key, { handle = null } = {}) {
  if (!odb || !townLogEnabled()) return [];
  const mine = new Set([...(key?.handles ?? [])].filter(Boolean));
  if (handle) { if (!mine.has(handle)) return []; }
  return pendingRows(odb).filter((r) => r.cls === "update" && r.handle && mine.has(r.handle)
    && (!handle || r.handle === handle));
}

/**
 * THE PUBLIC HALF: the un-drained paper rows for ONE handle, whoever is asking.
 *
 * `hotPaperActs` above is scoped to the caller's own handles and its own note
 * says why — "it is not a preview of the town, it is your own pen not lying to
 * you." That was the whole of the rule until 2026-08-25, when the founder ruled
 * the other half in: the public reads of a resident's paper compose the pending
 * edit too, stamped with its tense, for everyone. Both statements are true of
 * their own function. The owner's block is a DISCLOSURE and is unchanged; this
 * one feeds a stamped COMPOSE (paper-fresh.mjs), and the stamp is what keeps
 * the compose from being a substitution nobody was told about.
 *
 * No key, deliberately. The caller's identity has no bearing on whether a town
 * read is fresh, and taking one here would invite a scope check that reads like
 * a privacy guard while guarding nothing. The gate that DOES apply — a
 * suspended handle gets no overlay — is standing's, and it lives at the
 * composer beside the reasoning for it.
 */
export function pendingPaperRows(odb, handle) {
  if (!odb || !townLogEnabled() || !handle) return [];
  return pendingRows(odb).filter((r) => r.cls === "update" && r.handle === handle);
}

/**
 * The freshest value a caller should be shown for one of their own papers:
 * the un-drained row if there is one, otherwise nothing (and the caller falls
 * back to the record, which is the settled truth).
 */
export function hotestFor(odb, key, act, handle) {
  const rows = hotPaperActs(odb, key, { handle });
  for (let i = rows.length - 1; i >= 0; i--) if (rows[i].act === act) return rows[i];
  return null;
}

/**
 * What a caller's own reads should disclose about their pending edits.
 *
 * DISCLOSED, NOT SUBSTITUTED. The block says which papers have an edit standing
 * ahead of the record and when it settles — it does not quietly rewrite the
 * answer so the caller cannot tell which tense they are looking at. That is the
 * disclosure guard the world reads keep (`unreadable: true` rather than a
 * substituted "no"), applied to a tense instead of a failure.
 */
export function hotTenseBlock(odb, key, { handle = null } = {}) {
  const rows = hotPaperActs(odb, key, { handle });
  if (!rows.length) return null;
  const byPaper = new Map();
  for (const r of rows) byPaper.set(`${r.handle}:${r.act}`, r);
  return {
    pending: [...byPaper.values()].map((r) => ({
      handle: r.handle, act: r.act, file: PAPER_ACTS[r.act]?.file(r.handle) ?? null,
      written_at: r.writtenAt, seq: r.seq,
    })),
    settles_at: SETTLES_AT,
    note: "your own edits, already made and not yet settled into the record — the town's copy still reads as it did until the crossing",
  };
}

/**
 * The drain half: replay one update row through the door that wrote it.
 *
 * `doors` is the caller's own map of tool name -> implementation, so this
 * module never imports edit.mjs and never becomes a second place that knows how
 * to write an ADDRESS card.
 */
export function replayPaperAct(row, { doors, key, db, clone }) {
  const spec = PAPER_ACTS[row.act];
  if (!spec) return { row, skipped: `not a paper act: ${row.act}` };
  const door = doors?.[spec.tool];
  if (typeof door !== "function") return { row, skipped: `no door for ${spec.tool}` };
  // the key the act was performed with, reconstructed only as far as the doors'
  // own scope check needs: the handle it acted for, and the household it was
  // charged to. Anything more would be this module inventing a credential.
  const asKey = { household: row.household, handles: new Set([row.handle]), ghId: row.ghId, ghLogin: row.ghLogin, ...key };
  return { row, result: door(row.payload?.args ?? {}, asKey, db, clone) };
}
