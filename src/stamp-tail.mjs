// stamp-tail.mjs — SNAPSHOT 7: what a stamp door holds is town_stamps plus the
// ledger's tail, never the whole file (POS-314).
//
// The four stamp doors parsed and folded the whole 3.4 MB stamp-ledger.md on
// every act, ~50 ms of synchronous work each (measured 2026-10-04 at 15,872
// entries: parse 25-75 ms, foldBalances 13-71 ms, foldStaked 22-53 ms). The store
// already holds that fold: town_stamps, written by the town-index ingest at its
// head (033, world2/tools/town-index-ingest.mjs). The ledger is append-only and
// the three folds are additive (docs/town-index-store.md, which the ingest's own
// delta relies on), so the fold at the head plus the fold of the lines after it
// is the fold of the whole file. That equality is the gate, held by
// test/stamp-tail.test.mjs on a real Postgres.
//
// ── WHERE THE TAIL STARTS ────────────────────────────────────────────────────
//
// The ingest keeps the head's last line in town_meta as `stamps_tip`
// (town-index.mjs § stampTipOf). It is always a SIGNED line, and a signature is
// over the seal chain of every line before it. So finding that exact line in the
// clone's ledger proves the clone's past is the past town_stamps was folded
// from, and the tail is everything after it. The file is read backwards from its
// end, a chunk at a time, until the tip turns up. Between two ingests that is a
// few kilobytes, not the whole file.
//
// ── THE FULL DERIVATION WINS (POS-277, ruled 10-02) ──────────────────────────
//
// Every case this reader cannot vouch for answers null, and the door then folds
// the whole file exactly as before. Those cases are: no tip, a tip missing from
// this clone (a clone behind the ingest's, or a ledger whose past moved), and a
// store that can't be reached. The ledger is the stamps' record. town_stamps is
// its projection, so falling back to the record is the ruled answer here, not
// the other-index fallback the town index refuses (town-index-store.mjs § THE
// SWITCH).

import { closeSync, fstatSync, openSync, readSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const CHUNK = 64 * 1024;

/**
 * The ledger text after the line `tip`, or null when `tip` is not a line of the
 * file. It reads backwards from the end and doubles the window until the tip is
 * found or the whole file has been searched. `tip` is matched as a WHOLE line:
 * it starts the file or follows a newline, and it ends at a newline (CRLF
 * allowed) or at the end of the file.
 */
export function ledgerTailAfter(path, tip, { chunk = CHUNK } = {}) {
  if (!tip) return null;
  let fd;
  try { fd = openSync(path, "r"); } catch { return null; }
  try {
    const size = fstatSync(fd).size;
    const needle = Buffer.from(tip, "utf8");
    for (let n = Math.min(chunk, size); ; n = Math.min(n * 2, size)) {
      const buf = Buffer.alloc(n);
      readSync(fd, buf, 0, n, size - n);
      const whole = n === size;
      let from = buf.length;
      while (from >= 0) {
        const i = buf.lastIndexOf(needle, from);
        if (i === -1) break;
        const startsLine = i === 0 ? whole : buf[i - 1] === 0x0a;
        let end = i + needle.length;
        if (buf[end] === 0x0d) end += 1;
        const endsLine = end === buf.length || buf[end] === 0x0a;
        // A window that cut the line's left edge can't say whether it starts a
        // line: widen the window rather than guess.
        if (i === 0 && !whole) break;
        if (startsLine && endsLine) return buf.subarray(end === buf.length ? end : end + 1).toString("utf8");
        from = i - 1;
      }
      if (whole) return null;
    }
  } finally { closeSync(fd); }
}

/**
 * `{ liquid, staked }` for one handle from the store's town_stamps plus the
 * clone's ledger tail, or null when this reader cannot vouch for the answer (see
 * § THE FULL DERIVATION WINS). `q` is anything with pg's `query`. The tip and the
 * row are read in ONE statement, so both come from the same snapshot of an
 * ingest. `engine` is the town's stamp-mint module, injected or imported from
 * the clone.
 */
export async function heldFromIndex(q, clone, handle, { engine = null } = {}) {
  const { rows: [r] } = await q.query(
    `SELECT (SELECT value FROM town_meta WHERE key = 'stamps_tip') AS tip,
            (SELECT balance FROM town_stamps WHERE handle = $1) AS balance,
            (SELECT staked FROM town_stamps WHERE handle = $1) AS staked`, [handle]);
  if (!r?.tip) return null;
  const tail = ledgerTailAfter(join(clone, "WHITE_PAGES", "stamp-ledger.md"), r.tip);
  if (tail == null) return null;
  const mint = engine ?? await import(pathToFileURL(join(clone, "tools", "stamp-mint.mjs")).href);
  const entries = mint.parseStampLedger(tail);
  return {
    liquid: Number(r.balance ?? 0) + (mint.foldBalances(entries).get(handle) ?? 0),
    staked: Number(r.staked ?? 0) + (mint.foldStaked(entries).get(handle) ?? 0),
  };
}

/** The ledger's last entry line (`raw`, as parseStampLedger gives it), read from the end of the file; "" for an empty ledger. */
export function lastLedgerLine(path) {
  let fd;
  try { fd = openSync(path, "r"); } catch { return ""; }
  try {
    const size = fstatSync(fd).size;
    for (let n = Math.min(CHUNK, size); ; n = Math.min(n * 2, size)) {
      const buf = Buffer.alloc(n);
      readSync(fd, buf, 0, n, size - n);
      const lines = buf.toString("utf8").replace(/\r\n/g, "\n").split("\n");
      // the first line of a partial window may be cut, so it is never an answer
      const whole = n === size;
      for (let k = lines.length - 1; k >= (whole ? 0 : 1); k--) if (lines[k].startsWith("- ")) return lines[k];
      if (whole) return "";
    }
  } finally { closeSync(fd); }
}
