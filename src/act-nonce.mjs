// act-nonce.mjs — A WORLD ACT'S RETRY KEY (POS-246, w41)
//
// "A retried world act writes once." The paper grammar POS-70 §5 ruled for the
// send and the five paper acts (town-updates.mjs § paperDoor) — the in-flight
// map, the lookup before the act, the first act's receipt read back off its
// row, the disclosure when the key cannot be kept — applied to the acts the
// world door dispatches. The say is NOT here: it keeps its own key for one
// conversation lull (voices.mjs § THE RETRY KEY, migration 027), and the door
// hands it through untouched.
//
// ── WHERE THE KEY IS KEPT ───────────────────────────────────────────────────
//
// On the act, in 027's `acts.nonce` column, never in the payload (the payload
// leaves the box in the notary's archive; a retry key is not a fact about the
// act). `acts` is append-only (002), so the key cannot be stamped after the
// write: it rides the INSERT. The door does not thread it through the eleven
// handlers and their twenty append sites; it opens a scope around the handler,
// and `world2-pen.mjs § actsInsert` asks `nonceForActRow` for it. The FIRST act
// row the call writes carries it, and only that one: an act that writes a
// second row (a walk set down by its ground, a stake beside a mark) is one act,
// and one key.
//
// The kept spelling is `<door action>:<nonce>`, so the same word spent on a
// walk and then on a stake is two acts — the paper door narrows its lookup to
// the one act for the same reason ("handing the home's receipt back for the
// window would be the wrong receipt"). The lookup is scoped to the caller's
// own residents, so a nonce cannot be probed across households.
//
// ── WHAT THE ANSWER CAN AND CANNOT SAY ──────────────────────────────────────
//
// A repeat answers the FIRST act's receipt read back off its row — id, instant,
// crossing, actor, action, object — never a replay of the live answer, which a
// walk or a ride composes from the world as it stood and which no row holds.
// An act that wrote no row (an unstaked mark is a private draft, and a private
// draft never reaches `acts`: world-journal.mjs § THE DEFERRAL) has nowhere to
// keep its key; it lands, and says so (`nonce_honoured: false`), exactly as a
// paper act says so on an office with no town log.
//
// Migration 052 is the guard between two offices (or two calls that race past
// the lookup): a unique index refuses the second row, and that refusal answers
// as the first act's receipt rather than as a refused pen.

import { AsyncLocalStorage } from "node:async_hooks";
import { NONCE_MAX } from "./town-journal.mjs";

const scope = new AsyncLocalStorage();
const inFlight = new Map(); // "<actors>|<door action>|<nonce>" -> the first call's promise

/** The spelling a world act's key is kept under on its row. */
export const keptNonce = (action, nonce) => `${action}:${nonce}`;

/**
 * The nonce an `acts` INSERT should carry: the row's own (the say's), else the
 * open door scope's — once, on the first row, and never on a say.
 */
export function nonceForActRow(row) {
  if (row?.nonce != null) return row.nonce;
  const s = scope.getStore();
  if (!s || s.stamped || row?.action === "say") return null;
  s.stamped = true;
  return s.kept;
}

const SPENT_SQL =
  "SELECT id, at, crossing, actor, action, object FROM acts " +
  "WHERE nonce = $1 AND actor = ANY($2::text[]) AND action <> 'say' ORDER BY id LIMIT 1";

/** The act that already spent this key for one of these actors, or null. */
export async function spentWorldNonce(kept, actors) {
  if (!kept || !actors?.length) return null;
  const { officeRead } = await import("./world2-pen.mjs");
  return officeRead(async (c) => (await c.query(SPENT_SQL, [kept, actors])).rows[0] ?? null);
}

const isUniqueViolation = (e) => e?.code === "23505" || e?.cause?.code === "23505";

/** The first act's receipt, read back off its row. */
export function worldDuplicateReceipt(row, nonce, { raced = false } = {}) {
  return {
    duplicate: true,
    nonce,
    act: {
      id: row.id == null ? null : String(row.id),
      at: row.at instanceof Date ? row.at.toISOString() : row.at,
      crossing: row.crossing == null ? null : Number(row.crossing),
      actor: row.actor, action: row.action, object: row.object ?? null,
    },
    note: raced
      ? "this nonce was spent by a call that raced yours to the record, and the record kept the first. NOTHING WAS WRITTEN A SECOND TIME — this is that act's receipt, read back off its row."
      : "this nonce was already spent, by the act named above. NOTHING WAS WRITTEN A SECOND TIME — this is that act's own receipt, read back off its row, not a replay of its answer.",
  };
}

/** What a world act says when it was handed a key it could not keep. */
export const WORLD_NONCE_NOT_KEPT = {
  store: "this office's record keeps no nonce on an act (migration 027 is not on its store), so a nonce cannot be remembered and this receipt is NOT idempotent by it.",
  unwritten: "this act wrote no row to the acts record (an unstaked mark, for one, is a private draft, and a private draft never reaches it), so there was nowhere to keep the nonce and this receipt is NOT idempotent by it.",
};

export const WORLD_NONCE_IDEMPOTENT = "retry this exact call with the same nonce and you will get this act's receipt back rather than a second act";

/** A nonce the door refuses, or null. The paper door's bound, the paper door's words. */
export function nonceDefect(nonce) {
  if (typeof nonce !== "string" || !nonce.trim()) return { defect: "nonce must be a non-empty string", hint: "a nonce is a retry key of your own choosing: anything you can repeat exactly will do" };
  if (Buffer.byteLength(nonce, "utf8") > NONCE_MAX) return { defect: `nonce must be under ${NONCE_MAX} bytes`,
    hint: "a nonce is a retry key, not a payload — anything you can repeat exactly will do. It is refused rather than trimmed, because two long nonces cut to the same prefix would become one key." };
  return null;
}

/**
 * Run one world act under its retry key.
 *
 * `run()` is the handler; a bounce it THROWS propagates (the door's own catch
 * rebuilds it), and a bounce it RETURNS is handed back with nothing added — a
 * bounced first call spends no key, because it wrote no row.
 *
 * Answers one of:
 *   { duplicate }                    the first act's receipt; nothing ran
 *   { result, disclosure }           the act ran; `disclosure` is what the
 *                                    answer says about the key
 */
export async function actUnderNonce({ action, nonce, actors, kept: storeKeeps, run }) {
  if (!storeKeeps) {
    const result = await run();
    return { result, disclosure: result?.error ? null : { nonce, nonce_honoured: false, nonce_note: WORLD_NONCE_NOT_KEPT.store } };
  }
  const kept = keptNonce(action, nonce);
  const slot = `${[...actors].sort().join(",")}|${kept}`;
  const running = inFlight.get(slot);
  if (running) {
    const first = await running.catch(() => null);
    if (first?.duplicate) return first;
    const row = first?.stamped && !first.result?.error ? await spentWorldNonce(kept, actors) : null;
    if (row)
      return { duplicate: { ...worldDuplicateReceipt(row, nonce), in_flight: true,
        note: "this nonce was already in flight when your call arrived — an act carrying it was mid-write, and this is that act's receipt. NOTHING WAS WRITTEN A SECOND TIME." } };
  }
  const p = once({ kept, nonce, actors, run });
  inFlight.set(slot, p);
  try {
    const out = await p;
    if (out.duplicate) return out;
    return { result: out.result,
      disclosure: out.result?.error ? null
        : out.stamped ? { nonce, idempotent: WORLD_NONCE_IDEMPOTENT }
        : { nonce, nonce_honoured: false, nonce_note: WORLD_NONCE_NOT_KEPT.unwritten } };
  } finally {
    if (inFlight.get(slot) === p) inFlight.delete(slot);
  }
}

async function once({ kept, nonce, actors, run }) {
  const spent = await spentWorldNonce(kept, actors);
  if (spent) return { duplicate: worldDuplicateReceipt(spent, nonce) };
  const s = { kept, stamped: false };
  try {
    const result = await scope.run(s, run);
    return { result, stamped: s.stamped };
  } catch (e) {
    if (s.stamped && isUniqueViolation(e)) {
      const first = await spentWorldNonce(kept, actors);
      if (first) return { duplicate: worldDuplicateReceipt(first, nonce, { raced: true }) };
    }
    throw e;
  }
}
