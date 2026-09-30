// unread-store.mjs — UNREAD MAIL, THE WAY EMAIL HAS IT (POS-286).
//
// Ruled by Keemin 2026-09-27: "Unread = delivered letters this household has
// not opened. Private to the household: the office keeps it, it never enters
// the public ledger." Opening a letter in full clears it; `mark-all-read`
// clears a backlog; the doorstep and the house read count it, and only unread
// is called "new".
//
// ── DERIVED: DELIVERED MINUS OPENED ─────────────────────────────────────────
//
// Delivered is the ferry's delivery row (the town's mail-ledger, `ledger` kind
// 'delivery' in the office index, one row per letter id). Opened is
// `letter_opens` in the store (029_letter_opens.sql, which says why the pen
// writes at opening and never at delivery). So nothing is stored for an unread
// letter, and a letter still standing ahead of the crossing, having no
// delivery row, is never unread.
//
// ── PRIVATE BY THE ROW POLICY, ONE HOUSEHOLD AT A TIME ──────────────────────
//
// Every store question here runs inside a transaction that declared the
// recipient's household (`officeWrite`'s R1, the earpiece's read does the
// same), so 029's policy is what keeps a house's openings its own. The index
// half is public already (the ledger is the town's record); the difference
// between the two is what only the household may see, and the callers attach
// it only behind the doorstep's ownership gate.
//
// ── NOT THE LAW'S SEQUENCE STATES ───────────────────────────────────────────
//
// `new_inbound` / `they_spoke_again` (the town's tools/mail-state.mjs) say whose
// word came last in a conversation, however old. Nothing here reads or changes
// them; queries.mjs § NEW_INBOUND_NOTE is the pointer that rides beside them
// for one release.

import { officeRead, officeWrite } from "./world2-pen.mjs";
import { householdKeyFor } from "./world2-claims.mjs";
import { refuse } from "./events.mjs";

export const HOW_READ = "read";
export const HOW_MARK_ALL = "mark-all-read";
/** How many unread letters the doorstep block lists; `count` is always the whole. */
export const UNREAD_LISTED = 20;

export const UNREAD_CLEARS = 'opening a letter in full clears it: household { read: "letter", args: { id } }. household { do: "mark-all-read" } clears every one';
export const UNREAD_NOTE = "letters delivered to this resident that their household has not opened, newest first. Private to your household: no other key sees this block, and the town's record never holds it. Whose turn it is in a conversation is a different thing, and lives in awaiting's letter threads";

/**
 * The ferry's delivery rows to `handle`, newest first (the ledger's own order),
 * each with the letter's `delivered_at` where the index has it.
 */
export function deliveredTo(db, handle) {
  return db.prepare(
    `SELECT d.id, d.from_h AS "from", d.date, l.delivered_at
       FROM ledger d LEFT JOIN letters l ON l.id = d.id
      WHERE d.kind = 'delivery' AND d.to_h = ?
      ORDER BY d.seq DESC`).all(handle);
}

/** The recipients of a letter: its `toList` when present, else `to` (the town's `recipientsOf`). */
const recipientsOf = (l) => (Array.isArray(l?.toList) && l.toList.length ? l.toList : [l?.to]).filter(Boolean);

/** Group handles by their household key, one read-only resolution per handle. */
async function byHousehold(handles, env) {
  const keys = await officeRead(async (c) => {
    const out = [];
    for (const h of handles) out.push([h, await householdKeyFor(c, h)]);
    return out;
  }, { env });
  const groups = new Map();
  for (const [h, hh] of keys) groups.set(hh, [...(groups.get(hh) ?? []), h]);
  return groups;
}

async function openedIn(client, handles) {
  const { rows } = await client.query("SELECT handle, letter FROM letter_opens WHERE handle = ANY($1)", [handles]);
  return rows;
}

/**
 * Unread for each of `handles`: Map handle → the unread delivery rows, newest
 * first. The CALLER owns the privacy question (only handles its key holds);
 * this answers it, one household transaction at a time. Throws when the store
 * cannot be read: an unknown count is never a zero.
 */
export async function unreadFor(db, handles, { env = process.env, ix = null } = {}) {
  const out = new Map();
  if (!handles.length) return out;
  for (const [household, group] of await byHousehold(handles, env)) {
    const opened = await officeWrite((c) => openedIn(c, group), { env, household });
    const seen = new Set(opened.map((r) => `${r.handle}\n${r.letter}`));
    for (const h of group) out.set(h, (ix ? await ix.deliveredTo(h) : deliveredTo(db, h)).filter((d) => !seen.has(`${h}\n${d.id}`)));
  }
  return out;
}

/** The doorstep's `unread` block for one resident, from `unreadFor`'s rows (or its failure). */
export function unreadBlock(rows, err = null) {
  if (err) return {
    count: null,
    unavailable: `unread lives in the office's record, and the record could not be read (${String(err?.message ?? err).slice(0, 160)}) — unknown, not zero`,
    clears: UNREAD_CLEARS,
  };
  const letters = rows.slice(0, UNREAD_LISTED).map((r) => ({ id: r.id, from: r.from, date: r.date, delivered_at: r.delivered_at ?? null }));
  return {
    count: rows.length,
    letters,
    ...(rows.length > letters.length ? { letters_note: `the newest ${letters.length} of ${rows.length}; household { read: "mail", view: "inbox" } walks the rest` } : {}),
    clears: UNREAD_CLEARS,
    note: UNREAD_NOTE,
  };
}

async function insertOpens(client, { handles, letters, household, how, now }) {
  if (!letters.length) return 0;
  const { rowCount } = await client.query(
    `INSERT INTO letter_opens (handle, letter, household, opened_at, how)
     SELECT h, l, $3, $4, $5 FROM unnest($1::text[], $2::text[]) AS t(h, l)
     ON CONFLICT (handle, letter) DO NOTHING`,
    [handles, letters, household, new Date(now).toISOString(), how]);
  return rowCount ?? 0;
}

/**
 * A full fetch of letter `l` by `key` opens it for every recipient the key
 * holds. A key that holds only the sender opens nothing: a letter you wrote
 * was never unread to you. Returns the handles it was opened for.
 */
export async function openLetter(l, key, { env = process.env, now = Date.now() } = {}) {
  const held = new Set(key?.handles ?? []);
  const mine = recipientsOf(l).filter((h) => held.has(h));
  if (!mine.length || !l?.id) return [];
  for (const [household, group] of await byHousehold(mine, env))
    await officeWrite((c) => insertOpens(c, { handles: group, letters: group.map(() => l.id), household, how: HOW_READ, now }), { env, household });
  return mine;
}

/**
 * EVERY DOOR THAT ANSWERS A LETTER IN FULL clears it for the recipients the
 * caller's key holds (Wright's ruling (a), 2026-09-28: "opening a letter clears
 * it, the way email does", at all three doors: household { read: "letter" },
 * the flat read_letter and town { read: "letter" }, and their REST faces).
 * Returns the answer to send: `l` itself, byte for byte, or `l` with
 * `unread_note` when the clear could not be written. A keyless read, or a key
 * holding no recipient, writes nothing. An office pointed at no record keeps
 * no unread, so there is nothing to say. A failed clear never fails the read.
 *
 * These reads write, so a keyed one stays on the main thread: read-workers.mjs
 * § opensALetter.
 */
export async function answerOpening(l, key, opts = {}) {
  if (!l || !key?.handles) return l;
  try {
    await openLetter(l, key, opts);
    return l;
  } catch (e) {
    if (e?.name === "NoRecordError") return l;
    return { ...l, unread_note: "this letter could not be marked read (the office's record did not answer); it stays unread until a later opening or mark-all-read" };
  }
}

/**
 * household { do: "mark-all-read", args: { handle? } }. Bare, every resident
 * the key holds; `handle:` narrows to one. Not an act in `acts`: what a
 * household has read never enters the public record.
 */
export async function markAllReadAtOffice(db, fields, key, { env = process.env, now = Date.now() } = {}) {
  const held = [...(key?.handles ?? [])];
  const named = String(fields?.handle ?? "").trim();
  if (named && !held.includes(named))
    throw refuse(403, `"${named}" is not one of your residents`, `your key acts for ${held.join(", ") || "no resident"}`);
  const handles = named ? [named] : held;
  if (!handles.length) throw refuse(403, "marking mail read is a resident's act", "your key holds no resident — declare a household first");
  const marked = {};
  for (const [household, group] of await byHousehold(handles, env)) {
    await officeWrite(async (c) => {
      const seen = new Set((await openedIn(c, group)).map((r) => `${r.handle}\n${r.letter}`));
      const hs = [], ls = [];
      for (const h of group) {
        const unread = deliveredTo(db, h).filter((d) => !seen.has(`${h}\n${d.id}`));
        marked[h] = unread.length;
        for (const d of unread) { hs.push(h); ls.push(d.id); }
      }
      await insertOpens(c, { handles: hs, letters: ls, household, how: HOW_MARK_ALL, now });
    }, { env, household });
  }
  const total = Object.values(marked).reduce((a, b) => a + b, 0);
  return {
    marked,
    unread: Object.fromEntries(handles.map((h) => [h, 0])),
    receipt: total ? `marked ${total} letter${total === 1 ? "" : "s"} read — your unread count is 0` : "nothing was unread",
    note: "private to your household: the town's record does not hold what you have read",
  };
}
