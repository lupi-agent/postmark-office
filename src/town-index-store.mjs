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
  excerpt, LETTER_READING_LAW_LINE, MAIL_PAGE, SEARCH_LETTERS, SEARCH_RESIDENTS,
  mailListOf, letterListNoRegion, letterListPage, correspondentsOf, mailAwaitingOf, searchPage, metricsMailOf,
  rollEntry, residentPageOf, townSummaryOf, residentOf, windowReadOf, psaFoldOf, doorstepOf, DOORSTEP_SIZES, PSA_SLUG, CARD_MAIL,
} from "./queries.mjs";
import { isResidentHandle } from "./residency.mjs"; // the door's admission grammar, as readRoll filters by it
import { holdStoreProbe, UNREACHABLE_DEFECT, UNREACHABLE_HINT } from "./index-probe.mjs";

// The row SHAPES are queries.mjs's own exported functions, the ones its office.db
// readers call; only the SQL is written twice. A port that restated the shape
// would be the private copy that drifts.
import { freshnessFor, composeHome } from "./paper-fresh.mjs"; // the freshness ladder, as queries.home uses it

export const MOVED = Object.freeze(["repoLog", "regionList", "regionOne", "bulletinList", "bulletinTeaser", "bulletinEntry", "home", "stampsRoster", "stampsDetail", "potBoard", "questBoardFor", "standingFor", "townQuestBoard",
  "letter", "letterAnswer", "letterList", "mailList", "mailCorrespondents", "mailAwaiting", "search", "metricsMail", "outboxSettled",
  "residentList", "residentPage", "resident", "townSummary", "officeHandles", "windowRead", "psaFold", "doorstep",
  "hasResident", "hasLetter", "loginIndex", "unansweredFrom"]);

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
  const parties = await stampParties(handle);
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
  // a bent row is null, exactly as office.db's reader answers it
  try { return row?.json ? JSON.parse(row.json) : null; } catch { return null; }
}

/** The index meta a quest board reads (quest_registry, quest_day), from the store's own town_meta. */
async function questMeta(q) {
  const rows = (await q.query("SELECT key, value FROM town_meta WHERE key IN ('quest_registry', 'quest_day')")).rows;
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

// ── THE QUEST BOARD: ITS ROWS IN THE TRANSACTION, THE BOARD AFTER IT (POS-370) ──
//
// The board is more than its index rows. Between reading the resident's
// progress and their standing, questBoardWith loads the town's quest tools from
// the clone and asks the WORLD whether their home stands (worldSitedFor), and
// with the kept positions on that world read rebuilds the positions projection
// through the pen. Composed inside the transaction, the board held one pen
// connection while that rebuild waited for another from the same pool of three:
// on 2026-10-04 three boards per worker held all three, the rebuild waited for a
// fourth forever, and the office stalled for an hour (nine sessions idle in
// transaction, every one last running the progress read below).
//
// So the store half is ONLY reads: every row the board can ask for, read in the
// caller's transaction (questIndexRows), and the board is composed from those
// rows once the connection is back (questBoardOfRows). questBoardAnswer is the
// two together, for a door.

const PROGRESS_SQL = "SELECT handle, send, receive, house_size, house_send, house_receive, sent_to, heard_from FROM town_quest_progress WHERE handle = $1";

/**
 * Every index row a quest board can read, from one client, and nothing else.
 *
 * Each read's failure is KEPT and handed back where the board asks for that row,
 * so the board fails exactly where it failed when it read the store itself (a
 * pot table it cannot read is the pots section's own degrade, not the whole
 * board's). The progress row is read whatever its day: the board decides
 * freshness from the town's own clock, and one row it does not use costs nothing.
 */
export async function questIndexRows(q, handle) {
  const named = !(handle == null || String(handle).trim() === "");
  const kept = async (fn) => { try { return { v: await fn() }; } catch (e) { return { e }; } };
  const rows = { handle, meta: await questMeta(q) };
  if (named) {
    rows.progress = await kept(async () => (await q.query(PROGRESS_SQL, [handle])).rows[0]);
    rows.standing = await kept(() => standingFor(q, handle));
  }
  rows.potIds = await kept(async () => (await q.query("SELECT id FROM town_pots")).rows.map((r) => r.id));
  rows.potRows = await kept(() => potBoardRows(q));
  return rows;
}

/** questBoardWith's reads, answered from rows already read. A handle the rows were not read for is a programming error, named. */
function heldQuestSource(rows) {
  const take = (r) => { if (r.e) throw r.e; return r.v; };
  const ours = (h, what) => {
    if (h !== rows.handle) throw new Error(`the quest board's ${what} was read for ${JSON.stringify(rows.handle)}, not ${JSON.stringify(h)}`);
  };
  return {
    progressRow: async (h) => { ours(h, "progress"); return take(rows.progress); },
    standing: async (h) => { ours(h, "standing"); return take(rows.standing); },
    pots: async (extraInvalid) => potBoardOf(take(rows.potRows), extraInvalid),
    potIds: async () => take(rows.potIds),
  };
}

/**
 * queries.questBoardFor, from rows the store answered. Its meta (the registry and
 * the day the progress was folded on) is the store's own, never a caller's
 * office.db meta: the progress rows and the day they are good for come from one
 * index. Holds no connection: call it after the transaction has ended.
 */
export async function questBoardOfRows(rows, clone, opts = {}) {
  return questBoardWith(heldQuestSource(rows), rows.meta, rows.handle, clone, opts);
}

/** A door's quest board from the store: storeAnswer's `{ out, asOf }` or `{ refused }`, the board composed after the connection is back. */
export function questBoardAnswer(handle, clone, opts = {}, { env = process.env } = {}) {
  return storeAnswer((c) => questIndexRows(c, handle), { env, then: (rows) => questBoardOfRows(rows, clone, opts) });
}

/**
 * The reads household-stamps makes, from the store: queries.officeIndex's
 * methods, over one client (the door's one READ ONLY transaction).
 */
export const storeIndex = (q, clone) => ({
  stampsDetail: (handle) => stampsDetail(q, handle),
  // rows first, then the board: a caller holding `q` inside a pen transaction
  // would still be holding it while the board asks the world (see above), and
  // the pen refuses that by name (store-pool.mjs § NestedStoreError)
  questBoard: async (handle, opts) => questBoardOfRows(await questIndexRows(q, handle), clone, opts),
  potBoard: (extraInvalid) => potBoard(q, extraInvalid),
});

/** Thrown by a pooled index method when the store cannot be reached; a door turns it into its 503. */
export class TownIndexUnreachable extends Error {
  constructor(refused = UNREACHABLE) { super(refused.defect); this.name = "TownIndexUnreachable"; this.refused = refused; }
}

/**
 * The same methods as storeIndex, each in its OWN short READ ONLY transaction.
 *
 * THIS IS THE ONE A DOOR USES. A composed read (the estate, a doorstep) does
 * more than read the index between its reads: the world's siting, the quest
 * tools, a household's store writes. Holding one pooled connection across all
 * of that while other work asks the same small pool (max 3) for another is how
 * three concurrent readers each hold one connection and wait forever for a
 * second. So each method takes a connection, reads, and gives it back. A store
 * that cannot be reached throws TownIndexUnreachable, never an empty answer.
 */
export function storeIndexPooled(clone, { env = process.env } = {}) {
  // `then` is the half of a read that is not the index: it runs after the
  // connection is back (storeAnswer § then), with the same arguments.
  const via = (fn, then = null) => async (...args) => {
    const r = await storeAnswer((c) => fn(c, ...args), { env, then: then && ((out) => then(out, ...args)) });
    if (r.refused) throw new TownIndexUnreachable(r.refused);
    return r.out;
  };
  return {
    stampsDetail: via((c, handle) => stampsDetail(c, handle)),
    questBoard: via((c, handle) => questIndexRows(c, handle), (rows, _handle, opts) => questBoardOfRows(rows, clone, opts)),
    potBoard: via((c, extraInvalid) => potBoard(c, extraInvalid)),
    // the doorstep's and the house's reads (group 3)
    asOf: via((c) => townIndexAsOf(c)),
    doorstep: via((c, handle, asOf, opts) => doorstep(c, handle, asOf, opts)),
    residentSegments: via((c, handle, fresh) => residentSegments(c, handle, fresh)),
    hasResident: via((c, handle) => hasResident(c, handle)),
    lastActive: via((c, handle) => lastActive(c, handle)),
    mailAwaiting: via((c, handle, opts) => mailAwaiting(c, handle, opts)),
    standing: via((c, handle) => standingFor(c, handle)),
    home: via((c, handle, fresh) => home(c, handle, fresh)),
    deliveredTo: via((c, handle) => deliveredTo(c, handle)),
    resident: via((c, handle, fresh) => resident(c, handle, fresh)),
    windowRead: via((c, handle, fresh) => windowRead(c, handle, fresh)),
  };
}

// ── letters and mail (group 2) ───────────────────────────────────────────────

// A letter row as the shapes read it: the office.db columns, never `digest`.
const LETTER_COLS = "id, from_h, to_h, date, thread, box, owner, path, json, delivered_at";
// queries.mjs § NEWEST, bytewise: real timestamps win over a bare same-day date.
const NEWEST = `COALESCE(delivered_at, date) COLLATE "C" DESC, id COLLATE "C"`;
const count = async (q, sql, params = []) => Number((await q.query(sql, params)).rows[0].n);

/** queries.letter, from the store: one letter whole, or null. */
export async function letter(q, id) {
  const row = (await q.query("SELECT json FROM town_letters WHERE id = $1", [id])).rows[0];
  return row ? JSON.parse(row.json) : null;
}

/** queries.letterAnswer, from the store. */
export async function letterAnswer(q, id) {
  const l = await letter(q, id);
  return l ? { reading_law: LETTER_READING_LAW_LINE, ...l } : null;
}

/** queries.mailList, from the store: one box, newest first, paged. */
export async function mailList(q, handle, box = "inbox", opts = {}) {
  return mailListOf(handle, box, await mailPage(q, handle, box, opts));
}

/** queries.mailPage, from the store: { total, limit, offset, letters } for one box. */
export async function mailPage(q, handle, box, { since, until, limit, offset } = {}) {
  const where = [`${box === "outbox" ? "from_h" : "to_h"} = $1`];
  if (box !== "outbox") where.push("(box = 'inbox' OR box IS NULL)");
  const params = [handle];
  if (since) { params.push(since); where.push(`date COLLATE "C" >= $${params.length}`); }
  if (until) { params.push(until); where.push(`date COLLATE "C" <= $${params.length}`); }
  const clause = `WHERE ${where.join(" AND ")}`;
  const n = Math.min(Math.max(Number(limit) || MAIL_PAGE, 1), 200);
  const start = Math.max(Number(offset) || 0, 0);
  const total = await count(q, `SELECT COUNT(*) AS n FROM town_letters ${clause}`, params);
  const rows = (await q.query(`SELECT ${LETTER_COLS} FROM town_letters ${clause} ORDER BY ${NEWEST} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, n, start])).rows;
  return { total, limit: n, offset: start, letters: rows.map(excerpt) };
}

/** queries.outboxSettled, from the store: the letters in a resident's outbox. */
export async function outboxSettled(q, handle) {
  return count(q, "SELECT COUNT(*) AS n FROM town_letters WHERE from_h = $1 AND box = 'outbox'", [handle]);
}

/** queries.regionResidents, from the store: a region's roll, by slug or display name. */
export async function regionResidents(q, slugOrName) {
  const row = (await q.query(`SELECT json FROM town_regions WHERE id = $1 OR name = $1 ORDER BY (id = $1) DESC, id COLLATE "C" LIMIT 1`, [slugOrName])).rows[0];
  return row ? (JSON.parse(row.json).residents ?? []) : [];
}

/** queries.officeHandles, from the store: every resident whose card says office (the roster's flag). */
export async function officeHandles(q) {
  return (await roster(q)).filter((e) => e.is_office).map((e) => e.handle);
}

// ── THE ROSTER, READ ONCE PER INGEST (group 3) ──────────────────────────────
//
// Every resident's card is ~125 KB (it carries their boxes), 26 MB in all, and
// half the office wants only the roll's line from each: the roll memo behind
// the position doors, the roster, the town card's offices, the doorstep's
// arrivals. So the lines are kept, keyed on the store's own head (town_meta
// as_of, one row): a new ingest moves the head and the next read re-reads the
// cards once. office.db's residentList memo keyed on its handle's change stamp
// for exactly this reason; this is the same memo on the store's clock.
// Entries hold rollEntry's line for EVERY row (the admission grammar is applied
// by the readers that want it, as office.db's are), never a card.
let _roster = { asOf: undefined, entries: null };
export async function roster(q) {
  const asOf = await townIndexAsOf(q);
  if (_roster.entries && _roster.asOf === asOf) return _roster.entries;
  const rows = (await q.query(`SELECT handle, json FROM town_residents ORDER BY handle COLLATE "C"`)).rows;
  const entries = rows.map((r) => rollEntry(r.handle, JSON.parse(r.json)));
  _roster = { asOf, entries };
  return entries;
}
// THE ROLL'S HANDLES, HELD FOR THE SYNC READERS. The position doors
// (server.mjs § townRoll) and the MCP roll (mcp.mjs § rollOf) ask for the roll
// synchronously, on every call. With the switch on they read this: the store's
// roll as the office last loaded it, refreshed by the office's own reload poll
// (refreshStoreRoll) and at boot. Null until the first load, and null is what
// those readers already disclose as "the roll could not be read", never an
// empty town.
let _rollHandles = null;
export const storeRollHandles = () => _rollHandles;
export async function refreshStoreRoll({ env = process.env } = {}) {
  const r = await storeAnswer((c) => residentList(c), { env }).catch(() => ({ refused: UNREACHABLE }));
  if (!r.refused) _rollHandles = r.out.map((e) => e.handle);
  return _rollHandles;
}

// THE WRITE PATH'S PROBE (group 4; index-probe.mjs says what it answers). The
// resident handles (every row, as office.db's `SELECT 1 FROM residents` saw
// every row), the letter ids, and each resident's GitHub line in office.db's
// rowid order, which is the vendored readTown's sorted listing: bytewise. The
// GitHub line is picked in JS from the two jsonb values, with office.db's own
// `??`, so a JSON null and a missing key read alike on both sides.
export async function probeRows(q, { letters = true, logins = true } = {}) {
  const rows = (await q.query(logins
    ? `SELECT handle, json::jsonb -> 'github' AS g1, json::jsonb -> 'address' -> 'data' -> 'github' AS g2 FROM town_residents ORDER BY handle COLLATE "C"`
    : `SELECT handle FROM town_residents`)).rows;
  return {
    asOf: await townIndexAsOf(q),
    handles: new Set(rows.map((r) => r.handle)),
    letters: letters ? new Set((await q.query("SELECT id FROM town_letters")).rows.map((r) => r.id)) : null,
    logins: logins ? rows.map((r) => ({ handle: r.handle, github: r.g1 ?? r.g2 ?? "" })) : null,
  };
}

// A question the snapshot was not loaded to answer is a programming error, named.
const notLoaded = (what) => { throw new Error(`the store's probe was loaded without ${what}`); };

/** The probe over a snapshot. `mail` holds the mail_state rows a caller read for this call (handle -> json|null). */
export function probeOver(rows, { mail = null } = {}) {
  return Object.freeze({
    hasResident: (h) => rows.handles.has(h),
    hasLetter: (id) => (rows.letters ?? notLoaded("letter ids")).has(id),
    loginStamp: () => `store:${rows.asOf}`,
    loginRows: () => rows.logins ?? notLoaded("GitHub lines"),
    mailStateJson: (h) => (mail?.has(h) ? mail.get(h) : notLoaded(`${h}'s mail_state`)),
  });
}

// THE OFFICE'S HELD SNAPSHOT: loaded at boot and on the reload poll beside the
// roll, and re-read only when the store's head moved. A refresh that cannot
// reach the store keeps the last snapshot, as a failed office.db reload kept
// the file it had; a process that never loaded one refuses every check (503).
let _probeRows = null;
export async function refreshStoreProbe({ env = process.env, letters = true, logins = true } = {}) {
  const r = await storeAnswer(async (c) => {
    if (_probeRows && _probeRows.asOf === await townIndexAsOf(c)) return _probeRows;
    return probeRows(c, { letters, logins });
  }, { env }).catch(() => ({ refused: UNREACHABLE }));
  if (!r.refused) { _probeRows = r.out; holdStoreProbe(probeOver(_probeRows)); }
  return !r.refused;
}

/**
 * The held probe with one resident's mail_state row read now, for the reply
 * hint a send draws. Throws when the store cannot answer; the send has already
 * gone by then, so its caller says nothing rather than refuse a sent letter.
 */
export async function probeWithMailState(handle, { env = process.env } = {}) {
  if (!_probeRows) throw new TownIndexUnreachable();
  const r = await storeAnswer(async (c) => (await c.query("SELECT json FROM town_mail_state WHERE handle = $1", [handle])).rows[0]?.json ?? null, { env });
  if (r.refused) throw new TownIndexUnreachable();
  return probeOver(_probeRows, { mail: new Map([[handle, r.out]]) });
}

/** Test seam: forget the roster memo (a suite that rewrites rows under one head). */
export function __resetRosterForTest() { _roster = { asOf: undefined, entries: null }; }
/** Test seam: forget the held probe (a suite whose stores share one head, the fixture's). */
export function __resetProbeForTest() { _probeRows = null; holdStoreProbe(null); }

/** queries.residentList, from the store: the roll, admission grammar applied, each caller its own copies. */
export async function residentList(q) {
  return (await roster(q)).filter((e) => isResidentHandle(e.handle)).map((e) => ({ ...e }));
}

/** queries.residentPage, from the store. */
export async function residentPage(q, opts = {}) {
  return residentPageOf(await residentList(q), opts);
}

/** The index meta the town card reads, from the store's own town_meta. */
async function storeMeta(q) {
  return Object.fromEntries((await q.query("SELECT key, value FROM town_meta")).rows.map((r) => [r.key, r.value]));
}

/** queries.townSummary, from the store: its own meta, never a caller's. */
export async function townSummary(q) {
  const all = (await roster(q)).filter((e) => e.is_office).map((e) => e.handle).sort();
  return townSummaryOf(await storeMeta(q), all, (await residentList(q)).length);
}

/** A resident's stored card, parsed, or null. */
async function card(q, handle) {
  const row = (await q.query("SELECT json FROM town_residents WHERE handle = $1", [handle])).rows[0];
  return row ? JSON.parse(row.json) : null;
}

/** The freshness context for a row the STORE answered: dated by the store's head (home's rule). */
async function storeFresh(q, handle, fresh) {
  return freshnessFor(handle, { ...fresh, asOf: await townIndexAsOf(q) });
}

/** queries.resident, from the store: the composed address card. */
export async function resident(q, handle, fresh = null) {
  const d = await card(q, handle);
  if (!d) return null;
  const ctx = await storeFresh(q, handle, fresh);
  const pages = {};
  for (const box of ["inbox", "outbox"]) pages[box] = await mailPage(q, handle, box, { limit: CARD_MAIL });
  return residentOf(d, pages, handle, ctx);
}

/** queries.windowRead, from the store. */
export async function windowRead(q, handle, fresh = null) {
  const d = await card(q, handle);
  if (!d) return null;
  return windowReadOf(d.window_state ?? null, handle, await storeFresh(q, handle, fresh));
}

/** queries.psaFold, from the store. */
export async function psaFold(q, opts = {}) {
  const row = (await q.query("SELECT json FROM town_bulletin WHERE slug = $1", [PSA_SLUG])).rows[0];
  return psaFoldOf(row?.json ?? null, opts);
}

/** house-bundle § residentSegments, from the store: one resident's own segments, at the house read's bounds. */
export async function residentSegments(q, handle, fresh) {
  const { residentSegmentsOf, DOORSTEP_INBOX: HOUSE_INBOX } = await import("./house-bundle.mjs");
  const one = (sql, params) => count(q, sql, params);
  return residentSegmentsOf({
    mail: await mailList(q, handle, "inbox", { limit: HOUSE_INBOX }),
    awaiting: await mailAwaiting(q, handle, { offset: 0 }),
    stamps: await stampsDetail(q, handle),
    window: await windowRead(q, handle, fresh),
    pendingOutbox: await outboxSettled(q, handle),
    counts: {
      received: await one("SELECT COUNT(*) AS n FROM town_ledger WHERE kind = 'delivery' AND to_h = $1", [handle]),
      sent: await one("SELECT COUNT(*) AS n FROM town_ledger WHERE kind = 'delivery' AND from_h = $1", [handle]),
    },
  }, handle);
}

/** Is there a resident row for this handle? (house-bundle's ashore test) */
export async function hasResident(q, handle) {
  return (await q.query("SELECT 1 FROM town_residents WHERE handle = $1", [handle])).rows.length > 0;
}

/** A resident's last_active from their card, or null (house-bundle § lastActiveOf). */
export async function lastActive(q, handle) {
  try { return (await card(q, handle))?.last_active ?? null; } catch { return null; }
}

/** unread-store § deliveredTo, from the store: the resident's deliveries, newest first. */
export async function deliveredTo(q, handle) {
  return (await q.query(`SELECT d.id, d.from_h AS "from", d.date, l.delivered_at
       FROM town_ledger d LEFT JOIN town_letters l ON l.id = d.id
      WHERE d.kind = 'delivery' AND d.to_h = $1
      ORDER BY d.seq DESC`, [handle])).rows;
}

/**
 * queries.doorstep, from the store: every segment read by its store twin and
 * composed by the same doorstepOf. The bundle's `as_of` is the STORE's head,
 * whatever the caller passes: the segments came from this index.
 */
export async function doorstep(q, handle, _asOf, opts = {}) {
  const { nowMs = Date.now(), conversationsOffset = 0, fresh = null, slim = false } = opts;
  if (!(await hasResident(q, handle))) return null;
  const asOf = await townIndexAsOf(q);
  const offset = Math.max(Number(conversationsOffset) || 0, 0);
  const one = (sql, params = []) => count(q, sql, params);
  const parts = {
    arrivals: (await roster(q)).map((e) => ({ handle: e.handle, joined: e.joined, is_office: e.is_office })),
    awaiting: await mailAwaiting(q, handle, { offset }),
    mail: await mailList(q, handle, "inbox", { limit: slim ? DOORSTEP_SIZES.inboxSlim : DOORSTEP_SIZES.inbox }),
    stamps: await stampsDetail(q, handle),
    bulletin: await bulletinTeaser(q, { limit: DOORSTEP_SIZES.bulletin }),
    pulse: await metricsMail(q, { days: DOORSTEP_SIZES.pulseDays }),
    window: await windowRead(q, handle, fresh),
    psa: await psaFold(q, { now: nowMs }),
    pendingOutbox: await outboxSettled(q, handle),
    counts: {
      received: await one("SELECT COUNT(*) AS n FROM town_ledger WHERE kind = 'delivery' AND to_h = $1", [handle]),
      sent: await one("SELECT COUNT(*) AS n FROM town_ledger WHERE kind = 'delivery' AND from_h = $1", [handle]),
    },
    town: {
      residents: await one("SELECT COUNT(*) AS n FROM town_residents"),
      deliveries: await one("SELECT COUNT(*) AS n FROM town_ledger WHERE kind = 'delivery'"),
      lastDelivery: (await q.query(`SELECT MAX(date COLLATE "C") AS d FROM town_ledger WHERE kind = 'delivery'`)).rows[0]?.d ?? null,
    },
  };
  return doorstepOf(parts, handle, asOf, opts);
}

/** queries.letterList, from the store: the filtered list, newest first, paged. */
export async function letterList(q, opts = {}) {
  const limit = Math.min(Math.max(Number(opts.limit) || 50, 1), 200);
  const offset = Math.max(Number(opts.offset) || 0, 0);
  const asOf = await townIndexAsOf(q);
  const where = [];
  const params = [];
  const p = (v) => { params.push(v); return `$${params.length}`; };
  if (opts.resident) { const r = p(opts.resident); where.push(`(from_h = ${r} OR to_h = ${r})`); }
  if (opts.region) {
    const handles = await regionResidents(q, opts.region);
    if (!handles.length) return letterListNoRegion({ limit, offset, asOf, region: opts.region });
    const h = p(handles);
    where.push(`(from_h = ANY(${h}::text[]) OR to_h = ANY(${h}::text[]))`);
  }
  if (opts.since) where.push(`date COLLATE "C" >= ${p(opts.since)}`);
  if (opts.until) where.push(`date COLLATE "C" <= ${p(opts.until)}`);
  if (opts.excludeOffice) {
    const off = await officeHandles(q);
    if (off.length) { const o = p(off); where.push(`NOT (from_h = ANY(${o}::text[])) AND NOT (to_h = ANY(${o}::text[]))`); }
  }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const fixed = params.slice();
  const rows = (await q.query(`SELECT ${LETTER_COLS} FROM town_letters ${clause} ORDER BY ${NEWEST} LIMIT ${p(limit)} OFFSET ${p(offset)}`, params)).rows;
  const total = await count(q, `SELECT COUNT(*) AS n FROM town_letters ${clause}`, fixed);
  return letterListPage({ total, rows, limit, offset, full: opts.full, asOf });
}

/** queries.mailCorrespondents, from the store. */
export async function mailCorrespondents(q, handle, opts = {}) {
  // `multi` is the letter's json only where a toList may stand in it, as
  // office.db's reader does; the list's answer does not depend on the test
  // (a json without a toList array keeps the column's own recipient either way).
  const rows = (await q.query(`SELECT id, from_h, to_h, date, delivered_at,
      CASE WHEN strpos(json, '"toList"') > 0 THEN json ELSE NULL END AS multi
    FROM town_letters`)).rows;
  return correspondentsOf(rows, handle, opts);
}

/** The newest day the mail ledger holds (bytewise, as sqlite's MAX over text), or null. */
async function ledgerNewest(q) {
  return (await q.query(`SELECT MAX(date COLLATE "C") AS d FROM town_ledger WHERE date IS NOT NULL`)).rows[0]?.d ?? null;
}

/** queries.mailAwaiting, from the store. */
export async function mailAwaiting(q, handle, opts = {}) {
  const row = (await q.query("SELECT json FROM town_mail_state WHERE handle = $1", [handle])).rows[0];
  // a bent law is no law, exactly as office.db's reader answers it
  let law = null;
  try { law = row ? JSON.parse(row.json) : null; } catch { law = null; }
  return mailAwaitingOf(law, await ledgerNewest(q), handle, opts);
}

// sqlite's LIKE with no ESCAPE clause: ASCII case folded, no escape character
const like = (col, param) => likeAscii(col, param, "");

/** queries.search, from the store. */
export async function search(q, term, { limit, offset } = {}) {
  const pattern = `%${term}%`;
  const n = Math.min(Math.max(Number(limit) || SEARCH_LETTERS, 1), 200);
  const start = Math.max(Number(offset) || 0, 0);
  const lettersTotal = await count(q, `SELECT COUNT(*) AS n FROM town_letters WHERE ${like("id", "$1")} OR ${like("json", "$1")}`, [pattern]);
  const residentsTotal = await count(q, `SELECT COUNT(*) AS n FROM town_residents WHERE ${like("handle", "$1")} OR ${like("json", "$1")}`, [pattern]);
  const residents = (await q.query(`SELECT handle FROM town_residents
      WHERE ${like("handle", "$1")} OR ${like("json", "$1")}
      ORDER BY CASE
        WHEN handle = $2        THEN 0
        WHEN ${like("handle", "$3")} THEN 1
        WHEN ${like("handle", "$1")} THEN 2
        ELSE 3 END, handle COLLATE "C"
      LIMIT $4`, [pattern, term, `${term}%`, SEARCH_RESIDENTS])).rows.map((r) => r.handle);
  const letters = (await q.query(`SELECT ${LETTER_COLS} FROM town_letters WHERE ${like("id", "$1")} OR ${like("json", "$1")} ORDER BY ${NEWEST} LIMIT $2 OFFSET $3`,
    [pattern, n, start])).rows.map(excerpt);
  return searchPage({ q: term, n, start, lettersTotal, residentsTotal, residents, letters });
}

/** queries.metricsMail, from the store. */
export async function metricsMail(q, opts = {}) {
  const newest = await ledgerNewest(q);
  const dayCounts = (await q.query("SELECT date, kind, COUNT(*) AS n FROM town_ledger WHERE date IS NOT NULL GROUP BY date, kind")).rows
    .map((r) => ({ date: r.date, kind: r.kind, n: Number(r.n) }));
  const totals = {
    deliveries: await count(q, "SELECT COUNT(*) AS n FROM town_ledger WHERE kind = 'delivery'"),
    bounces: await count(q, "SELECT COUNT(*) AS n FROM town_ledger WHERE kind = 'bounce'"),
    letters: await count(q, "SELECT COUNT(*) AS n FROM town_letters"),
    threads: await count(q, "SELECT COUNT(*) AS n FROM town_threads"),
    residents: await count(q, "SELECT COUNT(*) AS n FROM town_residents"),
  };
  const threadJsons = newest ? (await q.query("SELECT json FROM town_threads")).rows.map((t) => t.json) : [];
  return metricsMailOf({ newest, dayCounts, totals, threadJsons: () => threadJsons }, opts);
}

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
  const read = async (client) => ({ out: await fn(client), asOf: await townIndexAsOf(client) });
  const { officeRead } = await import("./world2-pen.mjs");
  // the test seam's pool takes the pen's own shape, its one-connection-per-chain
  // guard included, so a suite on it sees what the office would
  if (_indexPoolForTest) return officeRead(read, { pool: _indexPoolForTest, by: "readTownIndex" });
  return officeRead(read, { env });
}

// TEST SEAM: the town index's own pool. A suite that stubs the record's pen (a
// JS stand-in for the acts tables, test/acts-pen-stub.mjs) still reads its town
// index from a real Postgres through this; the office never sets it, and with
// it unset every read goes through the pen exactly as above.
let _indexPoolForTest = null;
export function __setTownIndexPoolForTest(pool) { _indexPoolForTest = pool; }

/** The refusal a switched door gives when the store cannot answer. Fixed words, never the driver's message. */
export const UNREACHABLE = Object.freeze({ error: "bounce", defect: UNREACHABLE_DEFECT, hint: UNREACHABLE_HINT });

/**
 * A switched door's answer: `{ out, asOf }` from the store, or `{ refused }`
 * (UNREACHABLE) when it cannot be read. Doors turn the refusal into their 503.
 */
export async function storeAnswer(fn, { env = process.env, then = null } = {}) {
  // Only a store that cannot be reached is the refusal. An error the reader
  // itself throws (a clone with no quest tools, say) is that reader's own, and
  // goes to the door's own catch exactly as it does on office.db's path: calling
  // it "the store cannot be reached" would name the wrong thing.
  let own = null, r;
  try { r = await readTownIndex(async (c) => { try { return await fn(c); } catch (e) { own = e; throw e; } }, { env }); }
  catch (e) { if (own && e === own) throw e; return { refused: UNREACHABLE }; }
  // THE REST OF THE ANSWER, AFTER THE CONNECTION IS BACK (POS-370). `then` is
  // whatever the read needs that is not the index (the quest board's quest tools
  // and its world read): it runs here, holding nothing, and its errors are the
  // reader's own, never the store's absence.
  return then ? { ...r, out: await then(r.out) } : r;
}
