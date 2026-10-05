#!/usr/bin/env node
// town-index-ingest.mjs — the `law_ingester` pen, the town's third projection:
// office.db's tables, kept in the store (POS-268; 033_town_index.sql).
//
// ── THE LAW THIS IMPLEMENTS (Keemin 2026-09-27, POS-277) ─────────────────────
//
//   "let's aim to have essentially everything snapshotted per
//    settlement/clearing, and only live compute the delta between settlement
//    snapshots."
//
// The town's clearing is the CROSSING, closed by the Postmark Pen's
// `seal: re-seal at the crossing` commit (00:0x and 12:0x UTC). So:
//
//   --seed        once, at install: the whole derivation (the one history walk
//                 there will ever be), every table written in one transaction,
//                 recorded as the `seed` snapshot.
//   (default)     the commits since the head only. Tables are re-derived where
//                 that is cheap, and only for the touched keys where it is not;
//                 every row whose digest did not move is left alone. Appends only
//                 to the history and the mail ledger. The stamp folds are added,
//                 not refolded.
//   --snapshot    the checkout stands on a crossing's seal: after the delta,
//                 record it in `town_index_snapshots` with each table's count and
//                 digest.
//   --seals-to R  print the seal commits between the head and R, oldest first:
//                 the steps a runner checks out and ingests with --snapshot
//                 before it ingests R itself.
//
// ── THE STATELESS CONTRACT (law-ingest's and stamp-ingest's) ─────────────────
//
// The caller supplies the checkout; this tool never creates, fetches, moves or
// cleans one. It reads git (rev-parse, log, diff, show), never writes it.
//
// ── ONE DERIVATION ───────────────────────────────────────────────────────────
//
// Every row comes from src/town-index.mjs, the same code hydrate.mjs writes
// office.db from. This file decides only WHICH rows to re-derive and which to
// write.
//
// ── USAGE ────────────────────────────────────────────────────────────────────
//
//   PGHOST=… PGDATABASE=world2_dev PGUSER=law_ingester PGPASSWORD=… \
//     node world2/tools/town-index-ingest.mjs --town-repo <checkout> --sha <sha> [--seed] [--snapshot] [--json]
//   node world2/tools/town-index-ingest.mjs --town-repo <checkout> --seals-to <ref>

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { assertSha } from "./law-ingest.mjs";
import { readTown } from "../../vendor/tools/lib/town.mjs";
import {
  TOWN_TABLES, deriveTownIndex, readHistory, residentRows, letterRows, threadRows, bulletinRows, townDocsValue,
  ledgerLines, mailStateRows, stampFold, stampTipOf, fundingRows, questRows, atlasRows,
} from "../../src/town-index.mjs";
import { isResidentHandle } from "../../src/residency.mjs";

export const HEAD_KEY = "town-index";                     // projection_heads.repo
export const SEAL_SUBJECT = "seal: re-seal at the crossing";
const CHUNK = 500;
const quiet = { log() {}, warn() {} };

const git = (repo, ...a) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
const tableOf = (name) => `town_${name}`;
const hasDigest = (name) => name !== "repo_log";
export const digestOf = (row) => createHash("md5").update(JSON.stringify(row)).digest("hex");

/** A row's key, as one string, from the table's own key (or seq) columns. */
function keyOf(name) {
  const { cols, key, seq } = TOWN_TABLES[name];
  const at = (seq ? ["seq"] : key).map((k) => cols.indexOf(k));
  return (row) => JSON.stringify(at.map((i) => row[i]));
}
const keyCols = (name) => (TOWN_TABLES[name].seq ? ["seq"] : TOWN_TABLES[name].key);

// ── reading the store ────────────────────────────────────────────────────────

export async function readHead(client) {
  const r = await client.query("SELECT sha FROM projection_heads WHERE repo = $1", [HEAD_KEY]);
  return r.rows[0]?.sha ?? null;
}

/** key -> digest for a table, or for the given keys only. */
async function storedDigests(client, name) {
  const cols = keyCols(name);
  const r = await client.query(`SELECT ${cols.join(", ")}, digest FROM ${tableOf(name)}`);
  const out = new Map();
  for (const row of r.rows) out.set(JSON.stringify(cols.map((c) => row[c])), row.digest);
  return out;
}

// ── writing the store ────────────────────────────────────────────────────────

/**
 * repo_log's rows with `n`, each file's place in its own commit. A commit's
 * rows arrive contiguous (git log's name-status block), so the count restarts at
 * each new sha; the store keeps the order sqlite gave by rowid.
 */
function withOrdinal(rows) {
  let sha = null, n = 0;
  return rows.map((r) => { if (r[0] !== sha) { sha = r[0]; n = 0; } return [...r, ++n]; });
}

async function insertRows(client, name, rowsIn, tally) {
  if (!rowsIn.length) return;
  const rows = name === "repo_log" ? withOrdinal(rowsIn) : rowsIn;
  const cols = [...TOWN_TABLES[name].cols, ...(hasDigest(name) ? ["digest"] : []), ...(name === "repo_log" ? ["n"] : [])];
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const params = [];
    const tuples = chunk.map((row) => {
      const vals = hasDigest(name) ? [...row, digestOf(row)] : row;
      return `(${vals.map((v) => { params.push(v); return `$${params.length}`; }).join(", ")})`;
    });
    await client.query(`INSERT INTO ${tableOf(name)} (${cols.join(", ")}) VALUES ${tuples.join(", ")}`, params);
  }
  tally[name] ??= { inserted: 0, deleted: 0 };
  tally[name].inserted += rowsIn.length;
}

async function deleteKeys(client, name, keys, tally) {
  if (!keys.length) return;
  const cols = keyCols(name);
  const parsed = keys.map((k) => JSON.parse(k));
  for (let i = 0; i < parsed.length; i += CHUNK) {
    const chunk = parsed.slice(i, i + CHUNK);
    const arrays = cols.map((_, j) => chunk.map((k) => k[j]));
    const types = cols.map((c) => (c === "seq" ? "integer[]" : "text[]"));
    const r = await client.query(
      `DELETE FROM ${tableOf(name)} WHERE (${cols.join(", ")}) IN (SELECT * FROM unnest(${arrays.map((_, j) => `$${j + 1}::${types[j]}`).join(", ")}))`,
      arrays);
    tally[name] ??= { inserted: 0, deleted: 0 };
    tally[name].deleted += r.rowCount;
  }
}

/**
 * Write the difference between the candidate rows and the stored ones. With
 * `scope` (a Set of key strings), only those keys are in play: a stored key in
 * scope with no candidate is deleted, and nothing outside scope is read as gone.
 * Answers the keys whose row changed or went (the delta's "touched" set).
 */
async function diffTable(client, name, candidates, tally, { scope = null, stored = null } = {}) {
  const key = keyOf(name);
  stored ??= await storedDigests(client, name);
  const want = new Map(candidates.map((r) => [key(r), r]));
  const gone = [], put = [];
  for (const [k, d] of stored) {
    if (scope && !scope.has(k)) continue;
    const c = want.get(k);
    if (!c) gone.push(k);
    else if (digestOf(c) !== d) { gone.push(k); put.push(c); }
  }
  for (const [k, c] of want) if (!stored.has(k)) put.push(c);
  await deleteKeys(client, name, gone, tally);
  await insertRows(client, name, put, tally);
  tally[name] ??= { inserted: 0, deleted: 0 };
  return new Set([...gone, ...put.map(key)]);
}

async function setHead(client, sha) {
  await client.query(
    `INSERT INTO projection_heads (repo, sha, ingested_at) VALUES ($1, $2, now())
     ON CONFLICT (repo) DO UPDATE SET sha = EXCLUDED.sha, ingested_at = EXCLUDED.ingested_at`, [HEAD_KEY, sha]);
}

/** Each table's row count and content digest, computed in the store. */
export async function tableFingerprints(client) {
  const counts = {}, digests = {};
  for (const name of Object.keys(TOWN_TABLES)) {
    const t = tableOf(name);
    const q = hasDigest(name)
      ? `SELECT count(*)::int n, md5(coalesce(string_agg(digest, '' ORDER BY ${keyCols(name).map((c) => (c === "seq" ? c : `${c} COLLATE "C"`)).join(", ")}), '')) d FROM ${t}`
      : `SELECT count(*)::int n, md5(coalesce(string_agg(sha || op || coalesce(path, ''), '|' ORDER BY sha COLLATE "C", path COLLATE "C", op COLLATE "C"), '')) d FROM ${t}`;
    const r = (await client.query(q)).rows[0];
    counts[name] = r.n; digests[name] = r.d;
  }
  return { counts, digests };
}

async function recordSnapshot(client, repo, sha, kind) {
  const { counts, digests } = await tableFingerprints(client);
  const crossedAt = kind === "crossing" ? git(repo, "log", "-1", "--format=%cI", sha).trim() : null;
  await client.query(
    `INSERT INTO town_index_snapshots (sha, kind, crossed_at, counts, digests) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (sha) DO NOTHING`, [sha, kind, crossedAt, JSON.stringify(counts), JSON.stringify(digests)]);
  return counts;
}

// ── the seed ─────────────────────────────────────────────────────────────────

/** The whole derivation, every table replaced, the seed snapshot. The one history walk. */
export async function seed(client, { townRepo, sha, log = quiet }) {
  const tally = {};
  const ms = {};
  let t0 = Date.now();
  const { tables } = await deriveTownIndex(townRepo, { log });
  ms.derive = Date.now() - t0; t0 = Date.now();
  for (const name of Object.keys(TOWN_TABLES)) {
    const r = await client.query(`DELETE FROM ${tableOf(name)}`);
    tally[name] = { inserted: 0, deleted: r.rowCount };
    await insertRows(client, name, tables[name], tally);
  }
  ms.write = Date.now() - t0; t0 = Date.now();
  const counts = await recordSnapshot(client, townRepo, sha, "seed");
  ms.snapshot = Date.now() - t0;
  await setHead(client, sha);
  return { mode: "seed", head: null, sha, tally, counts, ms };
}

// ── the delta ────────────────────────────────────────────────────────────────

const partiesOfLetter = (json) => {
  try { const l = JSON.parse(json); return [l.from, l.to, ...(l.toList ?? [])].filter(Boolean); }
  catch { return []; }
};
const participantsOf = (json) => { try { return JSON.parse(json).participants ?? []; } catch { return []; } };

/** Rows of a table for the given keys, as the store holds them. */
async function storedRows(client, name, keys, cols) {
  if (!keys.length) return [];
  const kc = keyCols(name);
  if (kc.length !== 1) throw new Error(`storedRows: ${name} has a composite key`);
  const r = await client.query(`SELECT ${cols.join(", ")} FROM ${tableOf(name)} WHERE ${kc[0]} = ANY($1::text[])`, [keys.map((k) => JSON.parse(k)[0])]);
  return r.rows;
}

/**
 * The commits `head..sha`, applied. Every table is written only where its rows
 * moved; the counts of what was written come back in `tally`, per table.
 */
export async function applyDelta(client, { townRepo, head, sha, log = quiet }) {
  const tally = Object.fromEntries(Object.keys(TOWN_TABLES).map((n) => [n, { inserted: 0, deleted: 0 }]));
  if (head === sha) return { mode: "delta", head, sha, tally, commits: 0 };
  // Where the time goes, per phase, in the result: the delta's cost is a claim
  // the report makes, so the tool measures it rather than the report guessing.
  const ms = {};
  let t0 = Date.now();
  const lap = (name) => { const t = Date.now(); ms[name] = t - t0; t0 = t; };
  try { git(townRepo, "merge-base", "--is-ancestor", head, sha); }
  catch {
    throw new Error(`the head ${head} is not an ancestor of ${sha}: the town's history was rewritten under the index. ` +
      `Nothing was written. Re-seed (--seed --reseed) once the rewrite is understood.`);
  }
  const commits = Number(git(townRepo, "rev-list", "--count", `${head}..${sha}`).trim());
  const changed = git(townRepo, "-c", "core.quotepath=false", "diff", "--name-only", "--no-renames", head, sha).split("\n").filter(Boolean);
  const history = readHistory(townRepo, { range: `${head}..${sha}`, log });
  lap("git");
  const town = readTown(townRepo);
  lap("readTown");

  // history: appended, never re-walked
  await insertRows(client, "repo_log", history.rows, tally);
  lap("repo_log");

  // letters: every letter re-derived (readTown already holds them), written only
  // where the digest moved. delivered_at is the OLDEST add of the file: what the
  // store already holds for that path wins, and only a path first added in this
  // delta takes the delta's time.
  const heldAt = new Map((await client.query("SELECT path, delivered_at FROM town_letters WHERE path IS NOT NULL")).rows
    .filter((r) => r.delivered_at).map((r) => [r.path, r.delivered_at]));
  const letterCands = letterRows(town, (p) => heldAt.get(p) ?? history.deliveredAt.get(p) ?? null);
  const beforeLetters = await storedDigests(client, "letters");
  const touchedLetters = [...(await (async () => {
    const key = keyOf("letters");
    const want = new Map(letterCands.map((r) => [key(r), r]));
    const out = new Set();
    for (const [k, d] of beforeLetters) { const c = want.get(k); if (!c || digestOf(c) !== d) out.add(k); }
    for (const k of want.keys()) if (!beforeLetters.has(k)) out.add(k);
    return out;
  })())];
  const oldLetterRows = await storedRows(client, "letters", touchedLetters, ["id", "json"]);
  await diffTable(client, "letters", letterCands, tally, { stored: beforeLetters });
  lap("letters");

  // threads: re-derived whole from the letters (a reply can merge two), written where moved
  const threadCands = threadRows(town);
  const beforeThreads = await storedDigests(client, "threads");
  const threadKey = keyOf("threads");
  const touchedThreads = new Set();
  { const want = new Map(threadCands.map((r) => [threadKey(r), r]));
    for (const [k, d] of beforeThreads) { const c = want.get(k); if (!c || digestOf(c) !== d) touchedThreads.add(k); }
    for (const k of want.keys()) if (!beforeThreads.has(k)) touchedThreads.add(k); }
  const oldThreadRows = await storedRows(client, "threads", [...touchedThreads], ["root", "json"]);
  await diffTable(client, "threads", threadCands, tally, { stored: beforeThreads });
  lap("threads");

  // the mail ledger: append-only; a changed prefix is refused, never rewritten
  const lines = ledgerLines(town);
  const held = (await client.query("SELECT count(*)::int n FROM town_ledger")).rows[0].n;
  if (lines.length < held) throw new Error(`the mail ledger shrank (${held} lines held, ${lines.length} now): it is append-only by town law. Nothing was written.`);
  // Every held line is checked, not only the last: an edit to line 1 of 10,000
  // is exactly the change a last-line check cannot see. (seq, digest) pairs only.
  for (const { seq, digest } of (await client.query("SELECT seq, digest FROM town_ledger ORDER BY seq")).rows) {
    if (digest !== digestOf([seq, ...lines[seq - 1]]))
      throw new Error(`the mail ledger's line ${seq} is not the line the index holds: its past changed, and it is append-only by town law. Nothing was written.`);
  }
  const newLines = lines.slice(held).map((l, i) => [held + i + 1, ...l]);
  await insertRows(client, "ledger", newLines, tally);
  lap("ledger");

  // residents: only the handles whose own pages the delta touched, or whose
  // history moved; a handle whose directory went is deleted.
  const nowHandles = new Set(town.residents.map((r) => r.handle).filter(isResidentHandle));
  const storedResidents = await storedDigests(client, "residents");
  const affected = new Set();
  for (const p of changed) { const m = /^WHITE_PAGES\/([^/]+)\//.exec(p); if (m) affected.add(m[1]); }
  for (const h of history.lastActive.keys()) affected.add(h);
  const scopeResidents = new Set([...affected].map((h) => JSON.stringify([h])));
  for (const k of storedResidents.keys()) if (!nowHandles.has(JSON.parse(k)[0])) scopeResidents.add(k);
  const heldActive = new Map((await storedRows(client, "residents", [...scopeResidents], ["handle", "json"]))
    .map((r) => { try { return [r.handle, JSON.parse(r.json).last_active ?? null]; } catch { return [r.handle, null]; } }));
  const resCands = residentRows(townRepo, town, (h) => history.lastActive.get(h) ?? heldActive.get(h) ?? null,
    { log, only: new Set([...affected].filter((h) => nowHandles.has(h))) });
  await diffTable(client, "residents", resCands, tally, { scope: scopeResidents, stored: storedResidents });
  lap("residents");

  // mail_state: recomputed only for the parties of what moved — every letter
  // that changed (before and after), every thread that changed (before and
  // after), every new ledger line. The town's mailState walks the whole record
  // per resident; this is where the delta earns its keep.
  const parties = new Set();
  for (const r of oldLetterRows) partiesOfLetter(r.json).forEach((h) => parties.add(h));
  const letterKey = keyOf("letters");
  const touchedLetterSet = new Set(touchedLetters);
  for (const r of letterCands) if (touchedLetterSet.has(letterKey(r))) partiesOfLetter(r[8]).forEach((h) => parties.add(h));
  for (const r of oldThreadRows) participantsOf(r.json).forEach((h) => parties.add(h));
  for (const r of threadCands) if (touchedThreads.has(threadKey(r))) participantsOf(r[1]).forEach((h) => parties.add(h));
  for (const l of newLines) { const e = JSON.parse(l[6]); for (const h of [e.from, e.to]) if (h) parties.add(h); }
  const townHandles = new Set(town.residents.map((r) => r.handle));
  const storedMail = await storedDigests(client, "mail_state");
  for (const h of townHandles) if (!storedMail.has(JSON.stringify([h]))) parties.add(h);
  const scopeMail = new Set([...parties].map((h) => JSON.stringify([h])));
  for (const k of storedMail.keys()) if (!townHandles.has(JSON.parse(k)[0])) scopeMail.add(k);
  const mailCands = await mailStateRows(townRepo, town, { log, only: new Set([...parties].filter((h) => townHandles.has(h))) });
  if (mailCands) await diffTable(client, "mail_state", mailCands, tally, { scope: scopeMail, stored: storedMail });
  lap("mail_state");

  // stamps: the town's folds are additive (docs/town-index-store.md), so the
  // lines past the head are folded and ADDED to what the store holds. The
  // ledger's past must be the past the head saw.
  const meta = new Map((await client.query("SELECT key, value FROM town_meta")).rows.map((r) => [r.key, r.value]));
  let minted = meta.get("stamps_minted") ?? null;
  let tip = meta.get("stamps_tip") ?? "";
  const hasStamps = existsSync(join(townRepo, "tools", "stamp-mint.mjs")) && existsSync(join(townRepo, "WHITE_PAGES", "stamp-ledger.md"));
  if (hasStamps) {
    const { parseStampLedger } = await import(pathToFileURL(resolve(townRepo, "tools", "stamp-mint.mjs")));
    let before = [];
    try { before = parseStampLedger(git(townRepo, "show", `${head}:WHITE_PAGES/stamp-ledger.md`)); } catch { before = []; }
    const all = parseStampLedger(execFileSync("git", ["-C", townRepo, "show", `${sha}:WHITE_PAGES/stamp-ledger.md`], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 }));
    if (JSON.stringify(all.slice(0, before.length)) !== JSON.stringify(before))
      throw new Error("the stamp ledger's past changed since the head: it is append-only by town law. Nothing was written.");
    const d = await stampFold(townRepo, { entries: all.slice(before.length) });
    const rowsHeld = new Map((await client.query("SELECT handle, balance, mint_count, staked FROM town_stamps")).rows
      .map((r) => [r.handle, [r.handle, r.balance, r.mint_count, r.staked]]));
    const accts = new Set([...d.balance.keys(), ...d.mintCount.keys(), ...d.staked.keys()].filter((a) => a !== "MINT" && a !== "BURN"));
    const cands = [...accts].map((a) => {
      const h = rowsHeld.get(a) ?? [a, 0, 0, 0];
      return [a, h[1] + (d.balance.get(a) ?? 0), h[2] + (d.mintCount.get(a) ?? 0), h[3] + (d.staked.get(a) ?? 0)];
    });
    await diffTable(client, "stamps", cands, tally, { scope: new Set([...accts].map((a) => JSON.stringify([a]))) });
    minted = String(Number(minted ?? 0) + -(d.balance.get("MINT") ?? 0));
    tip = stampTipOf(all);
  }
  lap("stamps");

  // the small folds: re-derived whole (each under half a second), written where moved
  const funding = await fundingRows(townRepo, { log });
  for (const name of ["pots", "funding_roll", "funding_holo", "funding_keeping_mint", "pot_receipts", "pot_escrow", "pot_stakers", "funding_invalid"])
    await diffTable(client, name, funding[name], tally);
  lap("funding");
  const q = await questRows(townRepo, town, { log });
  if (q) {
    await diffTable(client, "quest_progress", q.progress, tally);
    if (q.standing) await diffTable(client, "quest_standing", q.standing, tally);
  }
  lap("quests");
  await diffTable(client, "bulletin", bulletinRows(town), tally);
  const atlas = atlasRows(townRepo, town, { log });
  if (atlas) { await diffTable(client, "regions", atlas.regions, tally); await diffTable(client, "homes", atlas.homes, tally); }

  // meta, in hydrate's order
  const metaRows = [
    ["as_of", sha],
    ["town_path", resolve(townRepo)],
    ["hydrated_counts", JSON.stringify({
      residents: town.residents.length, letters: town.letters.length,
      threads: town.threads.length, ledger: town.ledger.length,
      bulletin: (town.bulletin ?? []).length,
    })],
    ["docs", townDocsValue(town)], // POS-351, in the seed's position (src/town-index.mjs)
  ];
  if (hasStamps) metaRows.push(["stamps_minted", minted], ["stamps_tip", tip]);
  if (q) metaRows.push(["quest_day", q.questDay], ["quest_registry", q.questRegistry]);
  await diffTable(client, "meta", metaRows, tally);
  lap("bulletin+atlas+meta");

  await setHead(client, sha);
  return { mode: "delta", head, sha, tally, commits, changed: changed.length, ms };
}

/**
 * One ingest, one transaction, under the pen's advisory lock: seed when asked
 * (or refuse a seed over a head), else the delta; then the snapshot if the
 * checkout stands on a seal.
 */
export async function ingest(client, { townRepo, sha, seed: seeding = false, reseed = false, snapshot = false, log = quiet }) {
  await client.query("BEGIN");
  try {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`town-index-ingest`]);
    const head = await readHead(client);
    let out;
    if (seeding) {
      if (head && !reseed) throw new Error(`the index already has a head (${head}); a seed would replace every row. Pass --reseed to mean it.`);
      out = await seed(client, { townRepo, sha, log });
    } else {
      if (!head) throw new Error("the index has no head yet: seed it first (--seed). A delta needs somewhere to start.");
      out = await applyDelta(client, { townRepo, head, sha, log });
      if (snapshot) {
        const subject = git(townRepo, "log", "-1", "--format=%s", sha).trim();
        if (subject !== SEAL_SUBJECT) throw new Error(`--snapshot: ${sha} is not a crossing's seal ("${subject}")`);
        out.counts = await recordSnapshot(client, townRepo, sha, "crossing");
      }
    }
    await client.query("COMMIT");
    return out;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  }
}

/** The crossing seals between `head` and `ref`, oldest first. */
export function sealsBetween(townRepo, head, ref) {
  const out = git(townRepo, "log", "--reverse", "--format=%H%x1f%s", `${head}..${ref}`);
  return out.split("\n").filter(Boolean).map((l) => l.split("\x1f")).filter(([, s]) => s === SEAL_SUBJECT).map(([h]) => h);
}

// ── the CLI ──────────────────────────────────────────────────────────────────

const argOf = (name) => { const i = process.argv.indexOf(name); return i === -1 ? null : process.argv[i + 1] ?? null; };
const flag = (name) => process.argv.includes(name);

async function main() {
  const townRepo = argOf("--town-repo");
  const declared = argOf("--sha");
  const sealsTo = argOf("--seals-to");
  if (!townRepo || (!declared && !sealsTo)) {
    console.error("usage: town-index-ingest.mjs --town-repo <checkout> (--sha <sha> [--seed [--reseed]] [--snapshot] [--json] | --seals-to <ref>)");
    process.exit(2);
  }
  const { default: pg } = await import("pg");
  const client = new pg.Client();
  await client.connect();
  try {
    if (sealsTo) {
      const head = await readHead(client);
      if (!head) { console.error("the index has no head yet: seed it first"); process.exit(3); }
      for (const s of sealsBetween(townRepo, head, sealsTo)) console.log(s);
      return;
    }
    const sha = assertSha(townRepo, declared);
    const t0 = Date.now();
    const out = await ingest(client, { townRepo, sha, seed: flag("--seed"), reseed: flag("--reseed"), snapshot: flag("--snapshot"), log: console });
    out.ms = Date.now() - t0;
    if (flag("--json")) { console.log(JSON.stringify(out, null, 2)); return; }
    const writes = Object.entries(out.tally).filter(([, t]) => t.inserted || t.deleted)
      .map(([n, t]) => `${n} +${t.inserted}/-${t.deleted}`).join(", ") || "nothing";
    console.log(`${out.mode} ${sha.slice(0, 12)}${out.head ? ` from ${out.head.slice(0, 12)} (${out.commits} commits)` : ""} in ${out.ms} ms — wrote ${writes}` +
      (out.counts && out.mode !== "seed" ? " · snapshot recorded" : ""));
  } finally { await client.end(); }
}

// Entry guard: real paths, the junction lesson (stamp-ingest.mjs § entry guard).
const isMain = (() => {
  if (!process.argv[1]) return false;
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return pathToFileURL(process.argv[1]).href === import.meta.url; }
})();
if (isMain) {
  main().catch((e) => { console.error(String(e?.stack ?? e)); process.exit(1); });
}
