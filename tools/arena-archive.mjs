// arena-archive.mjs — the arena's rows out of dynamic.db, once, into a plain
// archive file (Keemin, 2026-09-30: "the arena is not live; it will be
// reimplemented properly later, and nothing should be ported").
//
//   node tools/arena-archive.mjs --out <file.jsonl> [--db <dynamic.db>] [--json]
//
// The arena kept its fight in dynamic.db's `journal`, rows of class
// `arena-act` (P-143). The door is closed now (src/arena.mjs), so nothing
// writes them and nothing folds them; this copies them out so the record of
// every fight survives the file. It is a copy, never a move: the journal is
// left exactly as it was, and deleting it is a separate, later act.
//
// THE FILE. Line 1 is a header, `{"archive":"arena", ...}`, naming the
// source, the class, the row count, and the sha256 of the row lines that
// follow. Every later line is ONE journal row, as stored (every column,
// `seq` included, the JSON columns left as the text they were written as).
// Rows are in `seq` order.
//
// It refuses rather than guesses:
//   - an --out that already exists (an archive is written once),
//   - a dynamic.db that is not there (an absent file is "nothing was ever
//     fought", which is a thing to say, not a file to write),
//   - a written file that does not read back to the same rows and hash.
//
// Exit codes: 0 archived · 2 usage · 3 refused (the reason on stderr).

import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";

import { dynamicDbPath } from "../src/dynamic-store.mjs";
import { CLASS_ARENA_ACT } from "../src/world-journal.mjs";

const sha256 = (s) => createHash("sha256").update(s).digest("hex");

/** The arena's journal rows, as stored, in seq order. Read-only; the file is never written. */
export function arenaRows(dbPath) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    return db.prepare("SELECT * FROM journal WHERE class = ? ORDER BY seq").all(CLASS_ARENA_ACT).map((r) => ({ ...r }));
  } finally { db.close(); }
}

/** The archive's text: a header line, then one line per row. */
export function archiveText(rows, { source, takenAt = new Date().toISOString() } = {}) {
  const body = rows.map((r) => JSON.stringify(r)).join("\n");
  const header = {
    archive: "arena", class: CLASS_ARENA_ACT, source, taken_at: takenAt,
    rows: rows.length, rows_sha256: sha256(body),
    note: "the arena closed 2026-09-30 (Keemin); one journal row per line after this one, as stored in dynamic.db",
  };
  return `${JSON.stringify(header)}\n${body}${rows.length ? "\n" : ""}`;
}

/** Read an archive back: its header and its rows, with the hash checked. */
export function readArchive(text) {
  const lines = text.split("\n").filter((l, i, all) => !(i === all.length - 1 && l === ""));
  const header = JSON.parse(lines[0]);
  const body = lines.slice(1).join("\n");
  if (sha256(body) !== header.rows_sha256) throw new Error("the archive's rows do not hash to its header's rows_sha256");
  const rows = lines.slice(1).map((l) => JSON.parse(l));
  if (rows.length !== header.rows) throw new Error(`the archive's header says ${header.rows} rows and it holds ${rows.length}`);
  return { header, rows };
}

/** Archive once. Returns the header; throws a refusal with `.refused` set. */
export function archiveArena({ dbPath = dynamicDbPath(), out, takenAt } = {}) {
  const refuse = (why) => Object.assign(new Error(why), { refused: true });
  if (!out) throw refuse("name the archive file with --out");
  if (existsSync(out)) throw refuse(`${out} already exists — an archive is written once; move it aside or name another file`);
  if (!existsSync(dbPath)) throw refuse(`no dynamic store at ${dbPath} — nothing was ever fought here, so there is nothing to archive`);
  const rows = arenaRows(dbPath);
  writeFileSync(out, archiveText(rows, { source: dbPath, takenAt }), { flag: "wx" });
  const back = readArchive(readFileSync(out, "utf8"));
  if (JSON.stringify(back.rows) !== JSON.stringify(rows)) throw refuse(`${out} was written but does not read back to the rows it was written from`);
  return back.header;
}

const argOf = (name) => { const i = process.argv.indexOf(name); return i !== -1 ? process.argv[i + 1] : null; };

function main() {
  const out = argOf("--out");
  if (!out) {
    console.error("usage: arena-archive.mjs --out <file.jsonl> [--db <dynamic.db>] [--json]");
    process.exit(2);
  }
  try {
    const header = archiveArena({ dbPath: argOf("--db") ?? dynamicDbPath(), out });
    console.log(process.argv.includes("--json") ? JSON.stringify(header, null, 2)
      : `archived ${header.rows} arena row(s) from ${header.source} to ${out} · rows_sha256 ${header.rows_sha256}`);
  } catch (e) {
    if (!e.refused) throw e;
    console.error(`REFUSED: ${e.message}`);
    process.exit(3);
  }
}

// The entry guard, as law-ingest.mjs's (the junction lesson).
const isMain = (() => {
  if (!process.argv[1]) return false;
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return pathToFileURL(process.argv[1]).href === import.meta.url; }
})();
if (isMain) main();
