// town-journal.mjs — the TOWN's log: joins and settlings, written at the door
// and drained into the record at the ferry's crossing.
//
// WHY IT IS ITS OWN TABLE (the seam ruling, 2026-08-24). The world's log
// (world-journal.mjs) and this one could have shared `journal` and filtered by
// class — and the reason they do not is three lines in world-drain.mjs:
//
//     DELETE FROM journal WHERE seq <= ?          // plan.head
//     INSERT OR REPLACE INTO meta … DRAIN_CURSOR  // the same head
//
// where `plan.head` is `MAX(seq)` over the WHOLE table. The world drain READS
// its own class and DELETES everything. A join row in that table would be
// removed undrained by the next world crossing, and a join arriving between a
// plan and its truncate would vanish with no trace at all. The founder's ruling:
// "the-atomic-drain's law is one log, one consumer" — class-scoped truncates
// would keep two consumers on one table forever, and the first forgotten WHERE
// clause eats someone's rows silently. Two tables makes the collision
// STRUCTURALLY impossible rather than a discipline anyone has to keep.
//
// So: own table, own cursor, own consumer (the ferry-invoked drain), own flag.
// Zero changes to the world drain.
//
// THE ARCHITECTURE THIS SERVES (POS-44): "dynamic DB = input tense (acts), git =
// the record, office DB = output tense (hydrated read index). Both DBs
// rebuildable from the record; never the reverse." This table is the input
// tense for the town — the pen, and hand-edits to the settled projection
// (households.json, github-ids.json) become unlawful because the journal is
// where an act is written.
//
// The flag is TOWN_SINGLE_LOG, and it is deliberately NOT WORLD_SINGLE_LOG: two
// logs on two cadences, and one of them being live must never imply the other.

// The classes THIS log owns — a closed set, exported because the world log's
// tripwire reads it to know what to refuse. One source: the town grows a class
// here, and the world log learns to bounce it in the same edit.
export const TOWN_CLASSES = new Set(["join", "update", "letter"]);

// "update" joined in wave 2: the paper doors (address body + fields, home,
// profile, window) write their act here too. It is the town log's class rather
// than the world's because a resident's card, home and window are the TOWN's
// record — the white pages — and they settle on the ferry's cadence, not the
// world's. The world log's tripwire reads TOWN_CLASSES, so an update row aimed
// at the wrong log bounces the moment this line lands.
//
// "letter" joined in wave 3 (POS-44's crown), and it is the class that makes
// the town's oldest stated law STRUCTURAL rather than merely honoured. The door
// already said it — "Slow-mail town: letters deliver on ferry crossings (~08:00
// and ~20:00 US-Eastern), not instantly" — but flag-off the office still writes
// the outbox file and commits it the instant you call, and only the FERRY's
// cadence made the mail slow. Flag-on there is nothing to deliver early from: a
// sent letter is a row, and a row cannot appear in anyone's inbox because rows
// only become files at a crossing. The law stops being a promise the office
// keeps and becomes a shape the office cannot break.

/** The one flag. Off, every door behaves exactly as it did. */
export const townLogEnabled = () => process.env.TOWN_SINGLE_LOG === "1";

/** This log's own cursor key — never the world's `journal_drained_through`. */
export const TOWN_DRAIN_CURSOR = "town_journal_drained_through";

// THE CURSOR'S OWN TABLE RIDES THE SCHEMA (wave 4). `meta` is where
// TOWN_DRAIN_CURSOR is kept, and until the bridge nothing had ever written it
// on a live box — every caller was a test whose fixture created `meta` by hand.
// The log lives in the office's oauth.db, which openOauthDb builds with five
// tables and no `meta`, so `townDrainCursor` read 0 through its own catch (a
// missing table looking exactly like an undrained log) and `advanceTownCursor`
// would have thrown "no such table: meta" at the end of the first real
// crossing — after the record was written and pushed, at the one step whose
// whole job is to stop those rows being replayed forever.
//
// A log and the cursor that reads it are one shape, so one function ensures
// both. Idempotent DDL: an office that already has `meta` (dynamic.db does) is
// unchanged, and flag-off nothing calls this at all.
export const TOWN_JOURNAL_SCHEMA = `
  CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
  CREATE TABLE IF NOT EXISTS town_journal (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    class TEXT NOT NULL,
    act TEXT NOT NULL,
    household TEXT NOT NULL,
    handle TEXT,
    -- the anchor the tier line hangs off: a verified GitHub identity (immutable
    -- id) or a human co-sign. Stored on the ROW because the drain must be able
    -- to judge a row long after the credential that wrote it is gone.
    gh_id TEXT, gh_login TEXT, cosigned_gh_id TEXT,
    payload TEXT,
    written_at TEXT NOT NULL,
    channel TEXT
  );
  CREATE INDEX IF NOT EXISTS town_journal_handle ON town_journal (handle, seq);
  CREATE INDEX IF NOT EXISTS town_journal_household ON town_journal (household, seq);
`;

export function ensureTownJournal(db) {
  db.exec(TOWN_JOURNAL_SCHEMA);
}

/**
 * One act, written at the door.
 *
 * REFUSES A CLASS IT DOES NOT OWN, which is the same tripwire the world log
 * gained in this commit and for the same reason: a row aimed at the wrong log
 * is a bug, and a bug that bounces at write time costs a stack trace while one
 * that is eaten at truncate time costs somebody their household.
 */
export function appendTownJournal(db, entry = {}) {
  const {
    cls = "join", act, household, handle = null,
    ghId = null, ghLogin = null, cosignedGhId = null,
    payload = null, channel = null,
    writtenAt = new Date().toISOString(),
  } = entry;

  if (!TOWN_CLASSES.has(cls))
    throw new Error(`the town log holds ${[...TOWN_CLASSES].join(", ")} rows — "${cls}" belongs to another log, and writing it here would put it under a drain that does not read it`);
  if (!act) throw new Error("a town journal line needs an act — every join has an ACTION");
  if (!household) throw new Error("a town journal line needs a household — the town's grain is the household");

  ensureTownJournal(db);
  const info = db.prepare(
    `INSERT INTO town_journal (class, act, household, handle, gh_id, gh_login, cosigned_gh_id, payload, written_at, channel)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(cls, String(act), String(household), handle == null ? null : String(handle),
    ghId == null ? null : String(ghId), ghLogin == null ? null : String(ghLogin),
    cosignedGhId == null ? null : String(cosignedGhId),
    payload == null ? null : JSON.stringify(payload), writtenAt,
    channel == null ? null : String(channel));
  return Number(info.lastInsertRowid);
}

const hydrate = (r) => ({
  seq: r.seq, cls: r.class, act: r.act, household: r.household, handle: r.handle,
  ghId: r.gh_id, ghLogin: r.gh_login, cosignedGhId: r.cosigned_gh_id,
  payload: r.payload ? JSON.parse(r.payload) : null,
  writtenAt: r.written_at, channel: r.channel,
});

export function readTownJournal(db, { sinceSeq = 0, limit = null } = {}) {
  ensureTownJournal(db);
  const sql = `SELECT * FROM town_journal WHERE seq > ? ORDER BY seq`
    + (limit != null && Number.isFinite(Number(limit)) ? ` LIMIT ${Math.max(1, Math.floor(Number(limit)))}` : "");
  return db.prepare(sql).all(Number(sinceSeq) || 0).map(hydrate);
}

export const townJournalHead = (db) => {
  ensureTownJournal(db);
  return Number(db.prepare("SELECT MAX(seq) s FROM town_journal").get()?.s ?? 0);
};

export const townDrainCursor = (db) => {
  try { return Number(db.prepare("SELECT value FROM meta WHERE key = ?").get(TOWN_DRAIN_CURSOR)?.value ?? 0); }
  catch { return 0; }
};

/** Rows the ferry has not yet drained into the record. */
export const pendingRows = (db) => readTownJournal(db, { sinceSeq: townDrainCursor(db) });

// ── THE RETRY KEY'S TWO SHARED FACTS (office#45; POS-70 §5, ruled 2026-09-24) ─
//
// A nonce rides a row's own arguments (`payload.args.nonce`, stored verbatim
// with everything else the door was handed), and the row that already spent it
// is found by reading those arguments back. The send (town-mail.mjs §
// spentNonce) asked that question first; the five paper acts ask it too now
// (town-updates.mjs § paperDoor). One lookup and one cap, here, beside the rows
// both of them read — the caller supplies the rows its own scope allows.

/** A nonce is a retry key, not a payload — bounded, and refused rather than
 *  trimmed (town-mail.mjs § NONCE_MAX says why a trim would be the defect). */
export const NONCE_MAX = 200;

/** The row among `rows` that already spent this nonce, or null. */
export const rowSpendingNonce = (rows, nonce) => (!nonce ? null
  : rows.find((r) => (r.payload?.args?.nonce ?? null) === nonce) ?? null);

/**
 * THE PENDING NAMES — the fourth register a handle can be spoken for in.
 *
 * POS-44's first design-in: "the handle-free check reads un-drained journal rows
 * too (two joins in one epoch must not collide at the drain)." Between a join
 * being written at the door and the next crossing draining it, the name exists
 * nowhere the old three-register check looks — not in the built index, not on
 * the ship's manifest, not in the declared registry — because all three are
 * projections of the RECORD, and the record has not been written yet. A second
 * declare for the same handle would conform, and the two would collide twelve
 * hours later inside the drain, where there is no door left to bounce at.
 */
export function pendingHandles(db) {
  const out = new Map();
  for (const row of pendingRows(db)) {
    if (!row.handle) continue;
    if (!out.has(row.handle)) out.set(row.handle, row);
  }
  return out;
}

/**
 * THE TIER LINE (the founder, 2026-08-24): "full automation for both berth and
 * joins (on our side, their side still needs a GitHub auth or co-sign)."
 *
 * Auto-settle drains ONLY rows anchored to a verified GitHub identity — the
 * IMMUTABLE id, never the login, which a person may change — or to a human
 * co-sign. The registry invariants hang off that pin: github-ids.json is the
 * witness's rule-1 base truth, so a row with no verified anchor could not write
 * a lawful entry even if the drain tried.
 *
 * An unverified row is not refused and not lost. Its household stands at the
 * harbor indefinitely with full berth life, and the door SAYS so — a stated
 * threshold, never a silent wait.
 */
export const rowIsSettleable = (row) => Boolean(row?.ghId || row?.cosignedGhId);

export const SETTLE_THRESHOLD =
  "settling into the town record waits on a verified GitHub identity or a human co-sign — until then your household keeps full berth life at the harbor, and nothing about your standing expires";
