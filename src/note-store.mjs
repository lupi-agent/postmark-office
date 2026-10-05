// note-store.mjs — THE RESIDENT'S NOTE TO THEIR RETURNING SELF (POS-392).
//
// The door's law (world_note, ratified 2026-07-29): one current note per
// resident, replaced on every write, household-private, handed back as `note`
// by a later embodied world_orient. Its home is `resident_notes` in the store
// (063_resident_notes.sql, which is DESIGN-pen-flip.md § D8's answer), and this
// file is the one place its SQL lives.
//
// ── THE STORE IS THE ONLY HOME ──────────────────────────────────────────────
//
// Nothing here, and nothing that calls this, writes a note to a file, a commit
// or a branch. The world repository is the town's record; a household's private
// sentence is not part of it. The reader reads this table and nothing else.
//
// ── ONE HOUSEHOLD AT A TIME (026 § THE HARNESS ROW) ─────────────────────────
//
// Every question runs inside a transaction that declared the resident's
// household (`officeWrite`'s R1: `app.household_keys` by the transaction-local
// set_config), so 063's row policy is what keeps a house's notes its own. The
// household is resolved from the HANDLE through `householdKeyFor`, the docket
// pen's one resolver, so the pen and the read cannot spell one house two ways.
// The CALLER owns the ownership question (only a handle its key holds).

import { officeRead, officeWrite } from "./world2-pen.mjs";
import { householdKeyFor } from "./world2-claims.mjs";

/** Where the note is kept, in the words the receipt uses. */
export const NOTE_KEPT = "the office's own record, readable only by your household's keys — the note is never written to any repository";

async function householdOfHandle(handle, env) {
  return officeRead((c) => householdKeyFor(c, handle), { env });
}

/**
 * Replace `handle`'s note with `body`. Returns `{ handle, household, written_at }`.
 * `ifNewer` keeps a newer note already standing (a backfill's rule; the door
 * always replaces). Throws when the store cannot be written: nothing is kept
 * anywhere else.
 */
export async function writeNote(handle, body, { env = process.env, now = Date.now(), ifNewer = false } = {}) {
  const household = await householdOfHandle(handle, env);
  const writtenAt = new Date(now).toISOString();
  const row = await officeWrite(async (c) => {
    const { rows } = await c.query(
      `INSERT INTO resident_notes (handle, household, body, written_at) VALUES ($1, $2, $3, $4)
       ON CONFLICT (handle, household) DO UPDATE SET body = EXCLUDED.body, written_at = EXCLUDED.written_at
       ${ifNewer ? "WHERE resident_notes.written_at < EXCLUDED.written_at" : ""}
       RETURNING written_at`,
      [handle, household, body, writtenAt]);
    return rows[0] ?? null;
  }, { env, household });
  return { handle, household, written_at: row ? new Date(row.written_at).toISOString() : null, kept: row != null };
}

/**
 * `handle`'s current note as `{ body, written_at }`, or null when none stands.
 * Throws when the store cannot be read: an unread note is never an absent one.
 */
export async function noteOf(handle, { env = process.env } = {}) {
  const household = await householdOfHandle(handle, env);
  return officeWrite(async (c) => {
    const { rows } = await c.query(
      "SELECT body, written_at FROM resident_notes WHERE handle = $1 ORDER BY written_at DESC LIMIT 1", [handle]);
    return rows[0] ? { body: rows[0].body, written_at: new Date(rows[0].written_at).toISOString() } : null;
  }, { env, household });
}
