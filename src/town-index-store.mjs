// town-index-store.mjs — the office.db readers that have moved to the store
// (POS-268). Each one answers exactly what its office.db twin in queries.mjs
// answers, over the town_* tables (033_town_index.sql), and each has a test
// holding the two equal: test/town-index-reads.test.mjs.
//
// ── THE SWITCH ───────────────────────────────────────────────────────────────
//
// `TOWN_INDEX_READS=store` moves every door listed in MOVED to these readers.
// Unset, the office reads office.db exactly as before; rolling back is unsetting
// it. There is no fallback between the two: a door switched to the store that
// cannot reach it says so (the pen's 503), rather than quietly answering from the
// other index (`the-town/the-disclosure`).
//
// ── WHAT A PORT HAS TO CARRY ─────────────────────────────────────────────────
//
// Three sqlite behaviours the doors' answers depended on without saying so:
//   · text compares and sorts BYTEWISE. Postgres' default collation does not, so
//     every comparison and ORDER BY on text here is `COLLATE "C"`.
//   · LIKE ignores ASCII case, and only ASCII case. `ilike` would fold more
//     than that, so both sides are folded with `translate` over A–Z alone.
//   · rows come back in insert order where nothing orders them (a commit's files
//     by rowid). The store keeps that order as `n` (town_repo_log).
// And one it did say: `GROUP BY sha ORDER BY committed_at DESC` breaks ties by
// sha ascending (measured on the live index: 47 tied timestamps, 0 positions
// that differ from that order), so the port names the tiebreak.
//
// Every reader takes a client (anything with pg's `query`), so a caller runs it
// inside `officeRead`'s READ ONLY transaction and a test runs it on its own.

import {
  repoLogPage, repoLogCommit, regionListing, regionPage, regionWhole,
  bulletinListing, bulletinTeaserOf, bulletinEntryOf,
  stampsRosterPage, stampsDetailOf, stampParties,
  potBoardOf, questBoardWith,
} from "./queries.mjs";

// The row SHAPES are queries.mjs's own exported functions, the ones its office.db
// readers call; only the SQL is written twice. A port that restated the shape
// would be the private copy that drifts.
import { freshnessFor, composeHome } from "./paper-fresh.mjs"; // the freshness ladder, as queries.home uses it

export const MOVED = Object.freeze(["repoLog", "regionList", "regionOne", "bulletinList", "bulletinTeaser", "bulletinEntry", "home", "stampsRoster", "stampsDetail", "potBoard", "questBoardFor", "standingFor", "townQuestBoard"]);

/** Is the switch on? Only the exact value `store` turns it on. */
export const townIndexReads = (env = process.env) => env.TOWN_INDEX_READS === "store";

const UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ", LOWER = "abcdefghijklmnopqrstuvwxyz";
/** sqlite's LIKE: ASCII case folded on both sides, nothing else. */
const likeAscii = (col, param, escape = "\\") => `translate(${col}, '${UPPER}', '${LOWER}') LIKE translate(${param}, '${UPPER}', '${LOWER}') ESCAPE '${escape}'`;

/** The sha the store's index was last ingested at (town_meta `as_of`), or null. */
export async function townIndexAsOf(q) {
  const r = await q.query("SELECT value FROM town_meta WHERE key = 'as_of'");
  return r.rows[0]?.value ?? null;
}

/** queries.repoLog, from the store. The same filters, page, total and notes. */
export async function repoLog(q, opts = {}) {
  const limit = Math.min(Math.max(Number(opts.limit) || 30, 1), 200);
  const offset = Math.max(Number(opts.offset) || 0, 0);
  const where = [];
  const params = [];
  const p = (v) => { params.push(v); return `$${params.length}`; };
  const likePrefix = opts.path ? String(opts.path).replace(/[\\%_]/g, (c) => "\\" + c) + "%" : null;
  if (likePrefix) where.push(likeAscii("path", p(likePrefix)));
  if (opts.author) where.push(likeAscii("author", p(`%${opts.author}%`), "")); // sqlite's author LIKE has no escape at all
  if (opts.since) where.push(`committed_at COLLATE "C" >= ${p(String(opts.since))}`);
  if (opts.until) {
    const u = String(opts.until);
    where.push(`committed_at COLLATE "C" <= ${p(u.length === 10 ? `${u}T23:59:59.999Z` : u)}`);
  }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const fixed = params.slice();
  // One commit's rows share its time, author and subject, so min() is that value.
  const commits = (await q.query(
    `SELECT sha, min(committed_at) AS committed_at, min(author) AS author, min(subject) AS subject
       FROM town_repo_log ${clause} GROUP BY sha
      ORDER BY min(committed_at) COLLATE "C" DESC, sha COLLATE "C" LIMIT ${p(limit)} OFFSET ${p(offset)}`, params)).rows;
  const total = Number((await q.query(`SELECT COUNT(DISTINCT sha) AS n FROM town_repo_log ${clause}`, fixed)).rows[0].n);
  const filesWhere = likePrefix ? `sha = $1 AND ${likeAscii("path", "$2")}` : "sha = $1";
  const filesArgs = (sha) => (likePrefix ? [sha, likePrefix] : [sha]);
  const out = [];
  for (const c of commits) {
    const files = (await q.query(`SELECT op, path FROM town_repo_log WHERE ${filesWhere} ORDER BY n LIMIT 100`, filesArgs(c.sha))).rows
      .map((r) => ({ op: r.op, path: r.path }));
    const ft = files.length === 100
      ? Number((await q.query(`SELECT COUNT(*) AS n FROM town_repo_log WHERE ${filesWhere}`, filesArgs(c.sha))).rows[0].n)
      : files.length;
    out.push(repoLogCommit(c, files, ft));
  }
  return repoLogPage({ total, limit, offset }, out);
}

const REGIONS_PAGE = 25;

/** queries.regionList, from the store. */
export async function regionList(q, { limit, offset } = {}) {
  const n = Math.min(Math.max(Number(limit) || REGIONS_PAGE, 1), 200);
  const start = Math.max(Number(offset) || 0, 0);
  const total = Number((await q.query("SELECT COUNT(*) AS n FROM town_regions")).rows[0].n);
  const rows = (await q.query(`SELECT id, name, json FROM town_regions ORDER BY id COLLATE "C" LIMIT $1 OFFSET $2`, [n, start])).rows;
  return regionPage({ total, n, start }, rows.map(regionListing));
}

/**
 * queries.regionOne, from the store. sqlite's `.get()` on `id = ? OR name = ?`
 * answers the first row in table order; a slug that is one region's id and
 * another's name is not a case the atlas has, and the id match is taken first.
 */
export async function regionOne(q, slug) {
  const row = (await q.query(
    `SELECT id, name, json FROM town_regions WHERE id = $1 OR name = $1 ORDER BY (id = $1) DESC, id COLLATE "C" LIMIT 1`, [slug])).rows[0];
  return row ? regionWhole(row) : null;
}

/** queries.bulletinList, from the store: every posting's listing line, by slug, bytewise. */
export async function bulletinList(q) {
  return (await q.query(`SELECT slug, json FROM town_bulletin ORDER BY slug COLLATE "C"`)).rows.map(bulletinListing);
}

/** queries.bulletinTeaser, from the store (read_bulletin's paged answer; the doorstep keeps office.db's until it moves). */
export async function bulletinTeaser(q, opts = {}) {
  return bulletinTeaserOf(await bulletinList(q), opts);
}

/** queries.bulletinEntry, from the store: one posting whole, or null. */
export async function bulletinEntry(q, slug) {
  const row = (await q.query("SELECT json FROM town_bulletin WHERE slug = $1", [slug])).rows[0];
  return row ? bulletinEntryOf(row.json) : null;
}

const STAMPS_PAGE = 50;

/** queries.stampsRoster, from the store; the minted total is the store's own meta. */
export async function stampsRoster(q, { limit, offset } = {}) {
  const n = Math.min(Math.max(Number(limit) || STAMPS_PAGE, 1), 200);
  const start = Math.max(Number(offset) || 0, 0);
  const accounts = Number((await q.query("SELECT COUNT(*) AS n FROM town_stamps")).rows[0].n);
  const balances = (await q.query(
    `SELECT handle, balance FROM town_stamps ORDER BY balance DESC, handle COLLATE "C" LIMIT $1 OFFSET $2`, [n, start])).rows;
  const minted = (await q.query("SELECT value FROM town_meta WHERE key = 'stamps_minted'")).rows[0]?.value;
  return stampsRosterPage({ minted, accounts, n, start }, balances);
}

/** queries.stampsDetail, from the store. */
export async function stampsDetail(q, handle) {
  const row = (await q.query("SELECT balance, mint_count, staked FROM town_stamps WHERE handle = $1", [handle])).rows[0];
  const parties = stampParties(handle);
  const holoRows = (await q.query(
    `SELECT h.party, h.pot, h.holo, h.epoch, h.date, h.receipt, r.usd AS usd
       FROM town_funding_holo h LEFT JOIN town_pot_receipts r ON r.receipt = h.receipt
      WHERE h.party = ANY($1::text[]) ORDER BY h.date COLLATE "C", h.seq, r.seq`, [parties])).rows;
  const keepingRows = (await q.query(
    `SELECT pot, n, epoch, date FROM town_funding_keeping_mint WHERE party = ANY($1::text[]) ORDER BY date COLLATE "C", seq`, [parties])).rows;
  return stampsDetailOf(row, { holoRows, keepingRows });
}

/** queries.potBoardRows, from the store: the same rows, the same order (bytewise where sqlite compared text). */
export async function potBoardRows(q) {
  const pots = (await q.query(`SELECT id, json FROM town_pots ORDER BY id COLLATE "C"`)).rows;
  const out = [];
  for (const r of pots) {
    out.push({
      id: r.id, json: r.json,
      roll: (await q.query(`SELECT patron, usd, date, receipt, holo FROM town_funding_roll WHERE pot = $1 ORDER BY date COLLATE "C", seq`, [r.id])).rows,
      receipts: (await q.query(`SELECT rail, usd, date, receipt, payer FROM town_pot_receipts WHERE pot = $1 ORDER BY date COLLATE "C", seq`, [r.id])).rows,
      staked: (await q.query("SELECT staked FROM town_pot_escrow WHERE pot = $1", [r.id])).rows[0]?.staked ?? 0,
      stakers: (await q.query(`SELECT handle, staked FROM town_pot_stakers WHERE pot = $1 ORDER BY staked DESC, handle COLLATE "C"`, [r.id])).rows,
    });
  }
  return { pots: out, invalid: (await q.query("SELECT row_kind, line, reason FROM town_funding_invalid ORDER BY seq")).rows };
}

/** queries.potBoard, from the store. */
export async function potBoard(q, extraInvalid = []) {
  return potBoardOf(await potBoardRows(q), extraInvalid);
}

/** queries.standingFor, from the store: the standing row, or null. */
export async function standingFor(q, handle) {
  const row = (await q.query("SELECT json FROM town_quest_standing WHERE handle = $1", [handle])).rows[0];
  return row?.json ? JSON.parse(row.json) : null;
}

/** The index meta a quest board reads (quest_registry, quest_day), from the store's own town_meta. */
async function questMeta(q) {
  const rows = (await q.query("SELECT key, value FROM town_meta WHERE key IN ('quest_registry', 'quest_day')")).rows;
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

/** questBoardWith's reads, from the store. */
const storeQuestSource = (q) => ({
  progressRow: async (handle) => (await q.query(
    "SELECT handle, send, receive, house_size, house_send, house_receive, sent_to, heard_from FROM town_quest_progress WHERE handle = $1", [handle])).rows[0],
  standing: (handle) => standingFor(q, handle),
  pots: (extraInvalid) => potBoard(q, extraInvalid),
  potIds: async () => (await q.query("SELECT id FROM town_pots")).rows.map((r) => r.id),
});

/**
 * queries.questBoardFor, from the store. Its meta (the registry and the day the
 * progress was folded on) is the store's own, never a caller's office.db meta:
 * the progress rows and the day they are good for come from one index.
 */
export async function questBoardFor(q, handle, clone, opts = {}) {
  return questBoardWith(storeQuestSource(q), await questMeta(q), handle, clone, opts);
}

/** queries.townQuestBoard's answer, from the store: the board with no resident named. */
export async function townQuestBoard(q, clone) {
  return questBoardFor(q, null, clone);
}

/**
 * The reads household-stamps makes, from the store: queries.officeIndex's
 * methods, over one client (the door's one READ ONLY transaction).
 */
export const storeIndex = (q, clone) => ({
  stampsDetail: (handle) => stampsDetail(q, handle),
  questBoard: (handle, opts) => questBoardFor(q, handle, clone, opts),
  potBoard: (extraInvalid) => potBoard(q, extraInvalid),
});

/**
 * queries.home, from the store. The freshness ladder composes over the row
 * exactly as it does for office.db's, with ONE deliberate difference: its
 * `asOf` is the STORE's head, never a caller's. The ladder asks "has the pen
 * written this since the index this row came from", and the row came from the
 * store; a caller passing office.db's as-of would date a store row by the other
 * index's clock. (`fresh.asOf` is ignored here for that reason.) `fresh` is
 * paper-fresh's `freshFor` context, pending rows already read, as the door
 * hands it to the office.db reader.
 */
export async function home(q, handle, fresh = null) {
  const row = (await q.query("SELECT json FROM town_homes WHERE handle = $1", [handle])).rows[0];
  if (!row) return null;
  const asOf = await townIndexAsOf(q);
  return composeHome(JSON.parse(row.json), freshnessFor(handle, { ...fresh, asOf }));
}

/**
 * Run one store reader in the pen's READ ONLY transaction, with the index's
 * as-of from the same snapshot. A caller that cannot reach the store gets the
 * pen's own error, which its door turns into the 503.
 */
export async function readTownIndex(fn, { env = process.env } = {}) {
  const { officeRead } = await import("./world2-pen.mjs");
  return officeRead(async (client) => ({ out: await fn(client), asOf: await townIndexAsOf(client) }), { env });
}

/** The refusal a switched door gives when the store cannot answer. Fixed words, never the driver's message. */
export const UNREACHABLE = Object.freeze({
  error: "bounce",
  defect: "the office's town index (the store) cannot be reached — nothing was read",
  hint: "this door reads the store (TOWN_INDEX_READS=store); ask again shortly, and it answers when the store does",
});

/**
 * A switched door's answer: `{ out, asOf }` from the store, or `{ refused }`
 * (UNREACHABLE) when it cannot be read. Doors turn the refusal into their 503.
 */
export async function storeAnswer(fn, { env = process.env } = {}) {
  // Only a store that cannot be reached is the refusal. An error the reader
  // itself throws (a clone with no quest tools, say) is that reader's own, and
  // goes to the door's own catch exactly as it does on office.db's path: calling
  // it "the store cannot be reached" would name the wrong thing.
  let own = null;
  try { return await readTownIndex(async (c) => { try { return await fn(c); } catch (e) { own = e; throw e; } }, { env }); }
  catch (e) { if (own && e === own) throw e; return { refused: UNREACHABLE }; }
}
