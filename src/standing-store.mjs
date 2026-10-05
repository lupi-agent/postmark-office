// standing-store.mjs — the standing ledger, READ FROM AND WRITTEN TO THE STORE
// (POS-347, migration 060).
//
// `src/standing.mjs` holds the grammar, the fold, the honest sentence and the
// gate. This file is the half that touches Postgres: it reads and appends
// `standing_acts` through the office's ONE pool (`world2-acts.mjs actsQuery`,
// `WORLD2_PG_URL`, role `office_api`), and it renders the town's
// `tools/standing-ledger.md` from the rows, so the file is an export.
//
// ── NULL IS NOT EMPTY ───────────────────────────────────────────────────────
//
// The registry-store rule (src/registry-store.mjs § NULL IS NOT EMPTY), kept
// all the way up: `loadStandingActs()` answers `null` for "this office is not
// pointed at the record" and an array for "I looked". The gate reads null as
// "no standing record here", which is the ordinary case for an office with no
// store (a test, a dev box): nobody can have been suspended in a record that
// does not exist. A store that is pointed at and THROWS is different, and the
// gate says so (src/standing.mjs § standingBounce): it never reads an error as
// good standing.

import { actsQuery } from "./world2-acts.mjs";
import { parseStandingLine, foldStanding, formatStandingLine, looksLikeAct } from "./standing.mjs";

const ROW_SQL = `
  SELECT id, date, act, handle, by_who, founder_word, reason, line, source, actor
    FROM standing_acts`;

/** One store row → the record shape the fold and the town's parse both hold. */
export const recordOfRow = (r) => ({
  id: Number(r.id),
  date: r.date, act: r.act, handle: r.handle,
  by: r.by_who, founderWord: r.founder_word ?? null, reason: r.reason,
  line: r.line, source: r.source, actor: r.actor ?? null,
});

/** Every act, in the order it was written. `null` when not pointed at the record. */
export async function loadStandingActs(env = process.env) {
  const rows = await actsQuery(`${ROW_SQL} ORDER BY id`, [], env);
  return rows === null ? null : rows.map(recordOfRow);
}

/**
 * The newest act for each of `handles`, folded: `Map<handle, standing>`, or
 * `null` when not pointed at the record. One indexed read per write call
 * (060's `standing_acts_handle_idx`), so a lift lands at the next call, never
 * at a restart or a pull.
 */
export async function standingForHandles(handles, env = process.env) {
  const list = [...new Set([...(handles ?? [])].map(String))];
  if (!list.length) return new Map();
  const rows = await actsQuery(
    `SELECT DISTINCT ON (handle) id, date, act, handle, by_who, founder_word, reason, line, source, actor
       FROM standing_acts WHERE handle = ANY($1::text[]) ORDER BY handle, id DESC`, [list], env);
  if (rows === null) return null;
  return foldRecords(rows.map(recordOfRow)).standing;
}

/** The fold over records already in append order (the file fold's twin). */
export function foldRecords(records) {
  const standing = new Map();
  for (const rec of records) {
    standing.set(rec.handle, {
      state: rec.act === "lift" ? "clear" : rec.act === "revoke" ? "revoked" : "quarantined",
      since: rec.date, by: rec.by, reason: rec.reason, founderWord: rec.founderWord, line: rec.line,
    });
  }
  return { standing };
}

/**
 * Append acts in one transaction, in the order given. A record whose line the
 * store already holds is skipped (`line` is UNIQUE), so adopting the file
 * twice adopts nothing, and a door retry after a lost push resumes.
 * Answers the rows actually inserted, or `null` when not pointed at the record.
 */
export async function insertStandingActs(records, { source, actor = null } = {}, env = process.env) {
  if (!["door", "git"].includes(source)) throw new Error(`standing_acts.source must be door or git, not ${source}`);
  if (!records.length) return [];
  const values = [];
  const params = [];
  for (const r of records) {
    const line = r.line ?? formatStandingLine(r);
    const back = parseStandingLine(line);
    if (!back || back.handle !== r.handle || back.act !== r.act || back.reason !== r.reason)
      throw new Error(`standing act does not parse back to itself: ${line}`);
    const n = params.length;
    values.push(`($${n + 1}, $${n + 2}, $${n + 3}, $${n + 4}, $${n + 5}, $${n + 6}, $${n + 7}, $${n + 8}, $${n + 9})`);
    params.push(r.date, r.act, r.handle, r.by, r.founderWord ?? null, r.reason, line, source, actor);
  }
  // ONE statement, so the rows land whole or not at all, and IDENTITY hands
  // out ids in VALUES order: the file's line order survives the adoption.
  const rows = await actsQuery(
    `INSERT INTO standing_acts (date, act, handle, by_who, founder_word, reason, line, source, actor)
     VALUES ${values.join(", ")}
     ON CONFLICT (line) DO NOTHING
     RETURNING id, date, act, handle, by_who, founder_word, reason, line, source, actor`, params, env);
  return rows === null ? null : rows.map(recordOfRow).sort((a, b) => a.id - b.id);
}

// ── THE FILE AS AN EXPORT ────────────────────────────────────────────────────
//
// The preamble (the ledger's header prose, everything above its first act
// line) is the town's to write and is kept byte for byte; every act line below
// it is rendered from the store, in id order. So `render(file, rows) === file`
// holds exactly when the store holds every line the file holds, in the same
// order, and nothing else — which is what `standing-drain --check` asks.

/** The file split at its first act-shaped line: `{ preamble, lines }`. */
export function splitLedger(text) {
  const src = String(text ?? "").replace(/\r\n/g, "\n");
  const all = src.split("\n");
  const first = all.findIndex((l) => looksLikeAct(l));
  if (first < 0) return { preamble: src.replace(/\n*$/, "\n\n"), lines: [] };
  return { preamble: all.slice(0, first).join("\n") + "\n", lines: all.slice(first).filter((l) => l.trim() !== "") };
}

/** The file the store renders, given the current file (for its preamble). */
export function renderStandingLedger(fileText, records, { header = DEFAULT_HEADER } = {}) {
  const { preamble } = fileText ? splitLedger(fileText) : { preamble: header };
  return preamble + records.map((r) => r.line).join("\n") + (records.length ? "\n" : "");
}

/**
 * What the FILE holds that the STORE does not: the lines a git commit wrote
 * (the backfill, and any hand commit after it — the store reads git). Answers
 * `{ missing: [record…], unparsed: [line…] }` in file order. An act-shaped line
 * the grammar cannot read is never adopted and never dropped: it comes back in
 * `unparsed`, and the drain refuses until a person fixes it.
 */
export function missingFromStore(fileText, records) {
  const held = new Set(records.map((r) => r.line));
  const { unparsed } = foldStanding(fileText);
  const missing = [];
  for (const line of splitLedger(fileText).lines) {
    const rec = parseStandingLine(line);
    if (rec && !held.has(rec.line)) missing.push(rec);
  }
  return { missing, unparsed };
}

// The header a town with no ledger file gets: the town's own words for what
// the file is, plus the one sentence that is new — where the record lives.
export const DEFAULT_HEADER = `# standing-ledger — the Registrar's audit, witnessed

Machine-first, append-only, single-writer (the Registrar). The record is the
office's store (\`standing_acts\`, postmark-office migration 060); this file is
its export, rendered by \`tools/standing-drain.mjs\`. Grammar and fold:
\`tools/registrar-audit.mjs\`.

---

`;
