#!/usr/bin/env node
// gangway-drain.mjs — the store -> the town's HARBOR/GANGWAY.md (POS-353).
//
// The gangway is store-of-record (062_gangway_acts.sql). This drain makes the
// founder's file a RENDERING of it, in the standing and registry drains' shape:
//
//   node tools/gangway-drain.mjs --check    0 when the file says what the
//                                           store's newest row says; 1 naming
//                                           what differs
//   node tools/gangway-drain.mjs --apply    adopt a state the file holds and
//                                           the store does not, then write and
//                                           commit the file only when it differs
//
// ── THE STORE READS GIT ─────────────────────────────────────────────────────
//
// A founder commit to the file is honoured. The file says one thing — its
// `state:` and `since:` — and the drain must tell "the founder wrote a new
// state" from "the store moved and the file has not caught up". The pair
// decides: a (state, since) the store has NEVER held is a commit, and it is
// adopted (source `git`); a pair the store has held is an old rendering, and
// the newest row is rendered over it. A founder re-raising the gangway writes
// the day he raised it, so his pair is new. The first run against an empty
// store adopts whatever the file says (the backfill).
//
// Env: TOWN_CLONE, TOWN_PUSH=1, BOT_NAME/BOT_EMAIL, WORLD2_PG=1 + WORLD2_PG_URL.
// Nothing is sourced and no secret is printed.

import { readFileSync, realpathSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { actsQuery } from "../src/world2-acts.mjs";
import { GANGWAY_PATH, gangwayOfFile, renderGangwayFile, insertGangwayAct } from "../src/gangway.mjs";
import { penCommit } from "../src/write.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const opt = (name, fallback = null) => { const i = argv.indexOf(name); return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback; };
const CLONE = opt("--clone", process.env.TOWN_CLONE ?? resolve(HERE, "..", "town-clone"));

const townDate = () => new Intl.DateTimeFormat("en-CA", { timeZone: process.env.TOWN_TZ ?? "America/New_York" }).format(new Date());
const readFile = (clone) => { try { return readFileSync(join(clone, GANGWAY_PATH), "utf8"); } catch { return null; } };

async function allRows(env) {
  const rows = await actsQuery("SELECT id, state, since FROM gangway_acts ORDER BY id", [], env);
  return rows === null ? null : rows.map((r) => ({ id: Number(r.id), state: r.state, since: r.since }));
}

/**
 * Adopt the file's state when the store has never held its (state, since).
 * `{ adopted: row|null, newest }`, or `{ skipped }` when not pointed at the record.
 */
export async function adoptFromGit({ clone = CLONE, env = process.env } = {}) {
  const rows = await allRows(env);
  if (rows === null) return { skipped: "this office is not pointed at the record" };
  const file = readFile(clone);
  if (file === null) return { adopted: null, newest: rows.at(-1) ?? null };
  const said = gangwayOfFile(file);
  const since = said.since ?? townDate();
  const held = rows.some((r) => r.state === said.state && r.since === since);
  if (held) return { adopted: null, newest: rows.at(-1) ?? null };
  const row = await insertGangwayAct({ state: said.state, since, by: "git", source: "git" }, env);
  return { adopted: row, newest: row };
}

/** Read only: does the file say what the store's newest row says? */
export async function checkGangway({ clone = CLONE, env = process.env } = {}) {
  const rows = await allRows(env);
  if (rows === null) return { ran: false };
  const newest = rows.at(-1) ?? null;
  const file = readFile(clone);
  if (!newest) return { ran: true, equal: false, why: "the store holds no gangway row yet (--apply adopts the file)" };
  const rendered = renderGangwayFile(file, newest);
  return { ran: true, equal: rendered === file, why: rendered === file ? null : `the file does not say the store's newest row (${newest.state} since ${newest.since})` };
}

/** Adopt, then write and commit the file only when it differs. `commit` injected for tests. */
export async function drainGangway({ clone = CLONE, env = process.env, commit = penCommit, note = null } = {}) {
  const a = await adoptFromGit({ clone, env });
  if (a.skipped) return { ran: false, skipped: a.skipped, changed: false, commit: null };
  if (!a.newest) return { ran: true, adopted: null, changed: false, commit: null };
  const file = readFile(clone);
  const rendered = renderGangwayFile(file, a.newest);
  if (rendered === file) return { ran: true, adopted: a.adopted, changed: false, commit: null, state: a.newest.state };
  const abs = join(clone, GANGWAY_PATH);
  if (!existsSync(dirname(abs))) mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, rendered);
  const sha = commit(clone, [abs],
    `gangway: ${a.newest.state} since ${a.newest.since}, rendered from the store (via postmark-office, gangway-drain)`
      + (note ? `\n\n${note}` : ""));
  return { ran: true, adopted: a.adopted, changed: true, commit: sha, state: a.newest.state };
}

async function main() {
  const CHECK = flag("--check");
  const APPLY = flag("--apply");
  if (CHECK === APPLY) {
    console.error("gangway-drain: pass exactly one of --check or --apply\n"
      + "  --check   0 when HARBOR/GANGWAY.md says what the store's newest gangway row says, 1 naming the difference\n"
      + "  --apply   adopts a state the file holds and the store never has (the store reads git), then writes and commits the file only when it differs");
    process.exit(2);
  }
  if (CHECK) {
    const r = await checkGangway();
    if (!r.ran) { console.error("gangway-drain --check: this office is not pointed at the record (WORLD2_PG=1 and WORLD2_PG_URL) — the check did not run"); process.exit(1); }
    if (!r.equal) { console.error(`gangway-drain --check: ${r.why}`); process.exit(1); }
    console.error("gangway-drain --check: the file says what the store says");
    return;
  }
  const r = await drainGangway();
  if (!r.ran) { console.error(`gangway-drain --apply: ${r.skipped}`); process.exit(1); }
  if (r.adopted) console.error(`gangway-drain --apply: adopted from the town's file (the store reads git): ${r.adopted.state} since ${r.adopted.since}`);
  console.error(r.changed ? `gangway-drain --apply: wrote ${GANGWAY_PATH} (${r.state}), commit ${r.commit ?? "(empty diff)"}` : "gangway-drain --apply: the file already says what the store says — nothing written");
}

const isMain = (() => {
  if (!process.argv[1]) return false;
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return pathToFileURL(process.argv[1]).href === import.meta.url; }
})();

if (isMain) main().then(() => process.exit(0), (e) => { console.error(String(e?.stack ?? e)); process.exit(1); });
