// dynamic-store.mjs — `dynamic.db`, the town's THIRD database: the live layer.
//
// office.db indexes the TOWN repo. world.db indexes the WORLD repo. Both are
// pure indexes — deleted and rebuilt whole on every hydration, holding nothing
// they cannot recompute. This one is different, and the difference is the whole
// point of Stage 2:
//
//   dynamic.db is STORE-CANON. It is writable between hydrations and it holds
//   state no repo currently holds — where a resident is standing, what they are
//   riding, what was said and is still hanging in the air.
//
// From the three state classes (LOGOS/state-and-time.md):
//
//   store-canon-durable  entity positions, attachments. Loss is bounded by the
//                        crossing-save: at most half a crossing of movement.
//   store-ephemeral      emission PRESENCE, under a TTL. Loss *is* fading — a
//                        restart is a thunderclap and the air clears. The
//                        OCCURRENCE survives, in the crossing log.
//
// So this file is not exempt from the covenant, it carries a narrower one:
//
//   EVERY ROW IS RE-DERIVABLE OR CROSSING-SAVE-RECOVERABLE. Entities re-derive
//   from the walk ledger (via world.db's events). Attachments recover from the
//   last STATE save plus the logs after it. Emissions do neither by design:
//   presence is allowed to be lost, and `tools/dynamic-rebuild.mjs` says so
//   rather than pretending to restore it.
//
// One consequence that shapes the code below: an emission row is NOT deleted
// when its TTL expires. Presence is a QUERY (`presentEmissions`), never a
// delete, because the occurrence has to survive long enough to reach a crossing
// log. `pruneEmissions` is gated on `meta.logged_through` — the instant up to
// which the crossing-save has crystallized occurrences into the world repo —
// so nothing is ever dropped before it is history.
//
// Env:
//   WORLD_EMISSIONS=1   world/say dual-writes an emission beside the voices log
//   WORLD_MOVEMENT_V2=1 Stage D: the movement record, after the ledger's freeze
//   WORLD_SINGLE_LOG=1  POS-5 slice 1: every world mutation enters the journal
//                       (one INSERT) instead of the per-write git checkout. OFF
//                       is byte-identical to the git lane — a falsifier, not a
//                       hope (test/world-journal.test.mjs § FLAG OFF).
//   WORLD_DYNAMIC_DB    the file (default: dynamic.db beside world.db)

import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

import { OFFICE_ROOT, WORLD_CLONE } from "./world-store.mjs";
import { servedCanonSha } from "./world-serve.mjs";
// THE CODE FALLBACK IS AN EDGE, NOT A COPY. The no-literals law says a class
// constant has exactly one home; until every reader edges to the class mark,
// the office's shipped constants are the second-best home, and this module
// carries none of its own. There is no `60` in this file.
import { EARSHOT_M, FADE_MS, CLOSE_MS, HEAR_MAX } from "./voices.mjs";

// ── the flag ─────────────────────────────────────────────────────────────────
// Read from the environment on every call, never latched at import — the same
// discipline world-serve.mjs uses, for the same reason: a test flips it between
// cases, and an operator flipping it is restarting the office anyway.

export const emissionsEnabled = () => process.env.WORLD_EMISSIONS === "1";

// STAGE D's switch lives here, beside the store flag it governs, rather than in
// `world-movement.mjs` where the rest of the cutover lives: the entity deriver
// has to know whether to read the `movements` table, and reaching up to the
// movement module for that answer would put a cycle between the store and the
// thing that reads the store. `world-movement.mjs` re-exports it, so callers
// still find it under the name that describes what it does.
export const movementV2Enabled = () => process.env.WORLD_MOVEMENT_V2 === "1";

// POS-5 slice 1's switch, beside the other two for the same reason: the table it
// governs is declared in the DDL below, so the flag and the store it turns on
// live in one file. `world-journal.mjs` re-exports it under its own name.
//
// ON: every world mutation enters the journal — one INSERT, no lease, no lock,
// no checkout. OFF: the git write path runs untouched, byte for byte, and that
// is asserted rather than assumed (test/world-journal.test.mjs § flag-off).
export const singleLogEnabled = () => process.env.WORLD_SINGLE_LOG === "1";

export const DEFAULT_DYNAMIC_DB = join(OFFICE_ROOT, "dynamic.db");
export const dynamicDbPath = () => process.env.WORLD_DYNAMIC_DB ?? DEFAULT_DYNAMIC_DB;

// ── the DDL ──────────────────────────────────────────────────────────────────
//
// IF NOT EXISTS everywhere, and no destructive migration anywhere: this file is
// not rebuilt from scratch, so a schema change that silently dropped a table
// would be the one way Stage 2 could lose the town's state. A version mismatch
// refuses instead (see `openDynamic`).

// THE VERSION GUARDS SHAPE, NOT SIZE. It refuses when an existing store's tables
// mean something different from what this office believes they mean — the one
// way state nothing else holds could be lost silently. ADDING a table is not
// that: every column an older office reads still means what it meant, and the
// DDL below is `IF NOT EXISTS` throughout, so a store predating `movements`
// simply grows it on the next open. Bumping for an additive change would refuse
// every live store on the box for no fact in dispute, and an operator who has
// learned that the version bounces for harmless reasons is an operator who
// migrates without reading. So Stage D's table lands at version 1, and this
// paragraph is the rule that says when the number DOES move: a column removed,
// a column's meaning changed, or a table's rows reinterpreted.
export const DYNAMIC_SCHEMA_VERSION = "1";

export const DYNAMIC_SCHEMA = `
  CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);

  -- ENTITIES (store-canon-durable, mobility: free).
  --
  -- An entity's identity lives in the repo; its POSITION does not — that single
  -- move is what makes moving residents possible without directory churn. There
  -- is no parent column and there never will be one: an entity has no geometric
  -- parent, ever, and "what am I within" is a query over position answered
  -- freshly whenever asked (LOGOS/kinds.md).
  --
  -- \`provenance\` carries the DERIVATION'S INPUT beside its output: the
  -- governing departure record, and how it was read. A row of bare coordinates
  -- is a photograph of a moving thing — it cannot be carried forward to any
  -- other instant, which is exactly what \`derived_at\` and this column exist to
  -- make possible.
  CREATE TABLE IF NOT EXISTS entities (
    handle TEXT PRIMARY KEY,
    x REAL, y REAL,
    derived_at TEXT,
    provenance TEXT
  );

  -- ATTACHMENTS (store-canon-durable). Declared, then validated by presence —
  -- never inferred from geometry. \`declared_by\` is who said it, which is what
  -- kills the forged boarding line: nobody writes a movement record on anyone
  -- else's behalf. \`policy\` is stamped at edge birth (cascade | detach).
  CREATE TABLE IF NOT EXISTS attachments (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    entity TEXT, target TEXT,
    policy TEXT, declared_by TEXT, born_at TEXT
  );
  CREATE INDEX IF NOT EXISTS attachments_entity ON attachments (entity, born_at);
  CREATE INDEX IF NOT EXISTS attachments_target ON attachments (target, born_at);
  CREATE UNIQUE INDEX IF NOT EXISTS attachments_once ON attachments (entity, target, born_at);

  -- MOVEMENTS (store-canon-durable). STAGE D: the movement record, after the
  -- walk ledger is frozen with honor.
  --
  -- The GRAMMAR IS THE LEDGER'S, column for column, and deliberately so: a
  -- departure is a departure whether it was written in markdown or in SQLite,
  -- and \`readMovements\` hands these rows back in exactly the shape world.db's
  -- \`events\` table yields, so \`governingAt\`, \`buildSave\` and every replay read
  -- one vocabulary from two eras. Latest wins across BOTH — the founding era's
  -- lines keep governing anyone who has not moved since the seam.
  --
  -- \`within_w/h\` is the target's arrival rect FROZEN at departure, the tense
  -- law's ancestor, never re-resolved from the mark. \`declared_by\` is who said
  -- it: the office writes nobody's movement but their own.
  CREATE TABLE IF NOT EXISTS movements (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    actor TEXT, at TEXT,
    from_x REAL, from_y REAL,
    toward_x REAL, toward_y REAL,
    crossing REAL,
    within_w REAL, within_h REAL,
    to_mark TEXT, pace REAL,
    declared_by TEXT, note TEXT
  );
  CREATE INDEX IF NOT EXISTS movements_actor ON movements (actor, at);
  CREATE INDEX IF NOT EXISTS movements_at ON movements (at);

  -- EMISSIONS (store-ephemeral for presence, permanent-until-saved for
  -- occurrence). An emission rides its source and is EXEMPT FROM CONTAINMENT:
  -- there is no parent column here either, and the x/y is where the source stood
  -- when it happened.
  --
  -- \`source\` is the thing that emitted — for the human lane, the RESIDENT the
  -- human is stood with, because humans are not entities and do not walk.
  -- \`props.spoken_by\` carries the human's own label. That is disclosure, never
  -- impersonation (the sound class's human lane).
  CREATE TABLE IF NOT EXISTS emissions (
    id TEXT PRIMARY KEY,
    class TEXT, source TEXT,
    x REAL, y REAL,
    born_at TEXT, ttl_expires_at TEXT,
    props TEXT
  );
  CREATE INDEX IF NOT EXISTS emissions_born ON emissions (born_at);
  CREATE INDEX IF NOT EXISTS emissions_expires ON emissions (ttl_expires_at);
  CREATE INDEX IF NOT EXISTS emissions_source ON emissions (source, born_at);
  CREATE INDEX IF NOT EXISTS emissions_class ON emissions (class, born_at);

  -- THE JOURNAL (store-canon-durable until the drain). POS-5 slice 1: the one
  -- append-only log every world mutation enters. See world-journal.mjs for what
  -- each column is and which of them the 2026-08-23 ruling named.
  --
  -- APPEND-ONLY IS THE WHOLE DESIGN, and it is why amend and withdraw are rows
  -- rather than an UPDATE and a DELETE: supersession-by-latest costs this table
  -- nothing, and a log that is ever rewritten cannot be replayed. Nothing in the
  -- office issues an UPDATE or a DELETE against it; only the drain's truncate
  -- (slice 2), after the write-down, as one act with it (the-atomic-drain).
  --
  -- ADDITIVE, so DYNAMIC_SCHEMA_VERSION does not move — the rule two paragraphs
  -- up says the number goes when a column is removed, a column's meaning
  -- changes, or a table's rows are reinterpreted. A new table is none of those,
  -- and every live store on the box grows it on the next open.
  --
  -- \`at_anchor/at_dx/at_dy\` is ONE field, the-witnessed-line's "an anchor and an
  -- offset: where the actor stood, relative to what, at that instant". Three
  -- columns rather than a JSON blob because the drain and the frame graph both
  -- query it, and because a raw world x,y is a photograph of a moving thing —
  -- exactly what §8's four bugs were made of.
  CREATE TABLE IF NOT EXISTS journal (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    crossing REAL,
    actor TEXT NOT NULL,
    action TEXT NOT NULL,
    object TEXT,
    at_anchor TEXT, at_dx REAL, at_dy REAL,
    witnesses TEXT,
    class TEXT NOT NULL,
    payload TEXT,
    effect TEXT,
    household TEXT,
    written_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS journal_household ON journal (household, seq);
  CREATE INDEX IF NOT EXISTS journal_object ON journal (object, seq);
  CREATE INDEX IF NOT EXISTS journal_class ON journal (class, seq);
`;

/**
 * Open (and create, once) the dynamic store.
 *
 * WAL because two processes hold this file: the office writes emissions on the
 * say path while `tools/crossing-save.mjs` reads and stamps it from its own
 * systemd unit. A busy timeout rather than a lock: the office must never lose a
 * resident's voice because a save was mid-flight.
 */
/**
 * THE READER'S OPENER — one definition, because there are nine call sites and
 * two copies of this rule would be two answers to "may a read write" (runbook
 * DEC-4 / G3, lap 3).
 *
 * Returns a READ-ONLY handle, or **null when the store is not there**, and the
 * null is the whole point of the function existing.
 *
 * ⚑ WHY NULL AND NOT A THROW, WHICH IS WHAT MY LAP-1 FIX DID. Passing
 * `{ readOnly: true }` straight to `openDynamic` throws on an absent store,
 * where the write-mode default used to CREATE one and then read it empty. My
 * report said "no caller depends on that". One does: `test/hold-wirings.test
 * .mjs` WIRING 1 is green at the base and red at that pin, because
 * `groundWithinReach` went from answering about the ground to answering "the
 * ground could not be read". The suite had said so from the moment the change
 * landed and my § 8 was an empty placeholder, so nobody looked.
 *
 * An absent journal means NOTHING HAS BEEN JOURNALLED, which is a fact a reader
 * can state. It does not mean the reader is blind, and it certainly does not
 * mean the reader should create the file to find that out. So: null here, and
 * every caller treats null as EMPTY — which is byte-for-byte the answer the
 * write-mode default produced, minus the write.
 */
export function openDynamicReadOnly(path = dynamicDbPath()) {
  if (!existsSync(path)) return null;
  return openDynamic(path, { readOnly: true });
}

export function openDynamic(path = dynamicDbPath(), { readOnly = false } = {}) {
  if (readOnly && !existsSync(path)) throw new Error(`no dynamic store at ${path} — run: npm run dynamic:rebuild`);
  if (!readOnly) mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path, readOnly ? { readOnly: true } : {});
  // EVERY throw past this line closes the handle first. A file that is not a
  // database throws on the very first PRAGMA, and on Windows an unclosed handle
  // locks the file — so a corrupt store would have leaked one handle per say,
  // turning a recoverable index into an un-deletable one. (Found by the test
  // that asks whether a corrupt store can stop anyone speaking.)
  try {
    if (!readOnly) {
      db.exec("PRAGMA journal_mode = WAL");
      db.exec(DYNAMIC_SCHEMA);
    }
    db.exec("PRAGMA busy_timeout = 5000");

    const version = db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get()?.value ?? null;
    if (version == null && !readOnly) {
      db.prepare("INSERT OR REPLACE INTO meta VALUES (?, ?)").run("schema_version", DYNAMIC_SCHEMA_VERSION);
      db.prepare("INSERT OR REPLACE INTO meta VALUES (?, ?)").run("created_at", new Date().toISOString());
    } else if (version != null && version !== DYNAMIC_SCHEMA_VERSION) {
      // Refuse, loudly. This file holds state nothing else holds; a store opened
      // under the wrong schema is the one way to lose it silently.
      throw new Error(`dynamic store at ${path} is schema ${version}, this office speaks ${DYNAMIC_SCHEMA_VERSION} — migrate deliberately, never automatically`);
    }
  } catch (e) {
    try { db.close(); } catch { /* already gone */ }
    throw e;
  }
  return db;
}

export const getMeta = (db, key) => db.prepare("SELECT value FROM meta WHERE key = ?").get(key)?.value ?? null;
export const putMeta = (db, key, value) => db.prepare("INSERT OR REPLACE INTO meta VALUES (?, ?)").run(key, value == null ? null : String(value));

// ── the class mark's dials ───────────────────────────────────────────────────
//
// "`dials:` is the one home for a constant. If a number appears anywhere else —
// in office code, in a tool, in a test — it must EDGE to the class rather than
// restate it" (LOGOS/classes.md). This is that edge, for the sound class.
//
// The class mark stands in the world repo and reaches this office through
// world.db, which the hydrator builds. So the read has an absent-input story,
// and the customs-house's deriver's law governs it: REFUSE OR DISCLOSE, NEVER
// QUIETLY SUBSTITUTE.
//
// Three rungs, and the middle one is a ruling worth stating rather than
// discovering:
//
//   store readable, fresh          the class mark governs. `fresh: true`.
//   store readable, STALE          the class mark STILL governs, and the
//                                  staleness is disclosed on every emission and
//                                  on the health surface. A world.db one commit
//                                  behind main holds the real class mark at an
//                                  older commit; the alternative — the office's
//                                  own constants — is a strictly OLDER copy of
//                                  the same number with no commit attached at
//                                  all. Using the older law and naming its sha
//                                  is more truthful than substituting a
//                                  hardcoded one. (This is deliberately NOT
//                                  Stage 1's rule, where exact freshness is
//                                  required because place words must match the
//                                  fold byte-for-byte. A dial has no fold to
//                                  match.)
//   store absent / FAILED /        the office's shipped constants, DISCLOSED,
//   class mark or dial absent      per dial. Never silently.
//
// Disclosure is PER DIAL. A class mark that carries three of four dials hands
// over three, and the fourth says where it actually came from — mixing them
// silently would be the exact substitution the law forbids.

export const SOUND_CLASS_MARK = "the-town/sound";

/** The office's shipped constants, as the sound class's dial names. The fallback, and the only place this module names a number — by importing it. */
export const CODE_SOUND_DIALS = Object.freeze({
  radius_m: EARSHOT_M,
  hearing_ttl_min: FADE_MS / 60_000,
  flood_cap: HEAR_MAX,
  thread_close_min: CLOSE_MS / 60_000,
});

const DIAL_NAMES = Object.keys(CODE_SOUND_DIALS);

// The world.db read is cached on the FILE (mtime+size), like world-serve's
// snapshot: a rehydration rewrites the file even at the same sha, and a cache
// nobody can invalidate is worse than no cache.
let _classSnap = null;

function classMarkSnapshot(worldDbPath) {
  let st;
  try { st = statSync(worldDbPath); }
  catch { return { error: "store-absent", detail: `no world store at ${worldDbPath}` }; }
  if (_classSnap && _classSnap.path === worldDbPath && _classSnap.mtimeMs === st.mtimeMs && _classSnap.size === st.size)
    return _classSnap;
  try {
    const db = new DatabaseSync(worldDbPath, { readOnly: true });
    const meta = Object.fromEntries(
      db.prepare("SELECT key, value FROM meta WHERE key IN ('as_of_world','hydrated_at','hydration_status')").all()
        .map((r) => [r.key, r.value]));
    const row = db.prepare("SELECT props FROM nodes WHERE id = ?").get(SOUND_CLASS_MARK);
    db.close();
    if (String(meta.hydration_status ?? "").startsWith("FAILED"))
      return { error: "store-failed", detail: meta.hydration_status };
    let props = null;
    try { props = row?.props ? JSON.parse(row.props) : null; } catch { props = null; }
    _classSnap = {
      path: worldDbPath, mtimeMs: st.mtimeMs, size: st.size,
      asOfWorld: meta.as_of_world ?? null, hydratedAt: meta.hydrated_at ?? null,
      present: Boolean(row), props,
    };
    return _classSnap;
  } catch (e) {
    return { error: "store-unreadable", detail: String(e?.message ?? e).slice(0, 200) };
  }
}

/** Drop the cached class read — for tests that rewrite world.db in place. */
export function resetClassCache() { _classSnap = null; }

/**
 * The sound class, as this office will actually apply it.
 *
 * Returns `{ dials, sources, disclosed, version, mark, store }` — never throws,
 * because a class read that could take down `say` would make the law more
 * fragile than the code it replaced.
 */
export function soundClass({ worldDb = null, repo = WORLD_CLONE } = {}) {
  const worldDbPath = worldDb ?? process.env.WORLD_STORE_DB ?? join(OFFICE_ROOT, "world.db");
  const snap = classMarkSnapshot(worldDbPath);

  const dials = { ...CODE_SOUND_DIALS };
  const sources = Object.fromEntries(DIAL_NAMES.map((d) => [d, "code-fallback"]));
  let version = null;
  let gate = { status: "ABSENT", reason: snap.error ?? null, detail: snap.detail ?? null };
  let fresh = null;
  let asOfWorld = null;

  if (!snap.error) {
    asOfWorld = snap.asOfWorld;
    if (!snap.present) gate = { status: "ABSENT", reason: "class-mark-absent", detail: `${SOUND_CLASS_MARK} is not in the store` };
    else {
      const declared = snap.props?.dials;
      if (!declared || typeof declared !== "object")
        gate = { status: "ABSENT", reason: "class-dials-absent", detail: `${SOUND_CLASS_MARK} carries no dials: — the hydrator may predate the class fields` };
      else {
        version = Number.isFinite(Number(snap.props.class_version)) ? Number(snap.props.class_version) : null;
        for (const d of DIAL_NAMES) {
          const v = Number(declared[d]);
          if (Number.isFinite(v) && v > 0) { dials[d] = v; sources[d] = "class-mark"; }
        }
        const taken = DIAL_NAMES.filter((d) => sources[d] === "class-mark").length;
        gate = taken === DIAL_NAMES.length
          ? { status: "PRESENT", reason: null, detail: `${taken} dials from ${SOUND_CLASS_MARK}@${version ?? "?"}` }
          : { status: "PARTIAL", reason: "class-dials-incomplete", detail: `${taken} of ${DIAL_NAMES.length} dials declared; the rest fall back to the office's constants` };
      }
    }
    // Freshness is measured but never withheld — see the ruling above.
    try { fresh = asOfWorld != null && asOfWorld === servedCanonSha(repo); }   // the blessed sha, as every gate (postmark#2934)
    catch { fresh = null; }
  }

  const disclosed = DIAL_NAMES.filter((d) => sources[d] !== "class-mark");
  // The `dials:` field and the office's constants are two homes for one number
  // until every reader edges to the class. Where they disagree, say so: this is
  // the standing lint's finding made visible at read time rather than at audit.
  const drift = DIAL_NAMES
    .filter((d) => sources[d] === "class-mark" && dials[d] !== CODE_SOUND_DIALS[d])
    .map((d) => ({ dial: d, class_mark: dials[d], office_code: CODE_SOUND_DIALS[d] }));

  return {
    dials, sources, disclosed, drift,
    version, gate,
    mark: SOUND_CLASS_MARK,
    store: { path: worldDbPath, as_of_world: asOfWorld, hydrated_at: snap.hydratedAt ?? null, fresh },
  };
}

/** The sound class's TTL and close window in milliseconds — the shape every caller actually wants. */
export const soundMs = (cls) => ({
  earshotM: cls.dials.radius_m,
  ttlMs: cls.dials.hearing_ttl_min * 60_000,
  closeMs: cls.dials.thread_close_min * 60_000,
  floodCap: cls.dials.flood_cap,
});

// ── the operator's surface ───────────────────────────────────────────────────

export function dynamicHealth({ repo = WORLD_CLONE } = {}) {
  const path = dynamicDbPath();
  const cls = soundClass({ repo });
  const base = {
    enabled: emissionsEnabled(),
    flags: {
      WORLD_EMISSIONS: process.env.WORLD_EMISSIONS ?? null,
      WORLD_MOVEMENT_V2: process.env.WORLD_MOVEMENT_V2 ?? null,
      WORLD_SINGLE_LOG: process.env.WORLD_SINGLE_LOG ?? null,
    },
    db: { path, present: existsSync(path) },
    sound_class: {
      mark: cls.mark, version: cls.version,
      dials: cls.dials, dial_sources: cls.sources,
      gate: cls.gate,
      // Named rather than implied: an operator reading this must be able to see
      // at a glance whether the town's law or the office's copy is in force.
      disclosed_fallbacks: cls.disclosed,
      drift_from_office_constants: cls.drift,
      world_store: cls.store,
    },
  };
  if (!base.db.present) return base;
  try {
    const db = openDynamic(path, { readOnly: true });
    const one = (sql, ...a) => db.prepare(sql).get(...a);
    const now = new Date().toISOString();
    base.db = {
      ...base.db,
      schema_version: getMeta(db, "schema_version"),
      entities: one("SELECT COUNT(*) c FROM entities").c,
      entities_as_of: getMeta(db, "entities_as_of"),
      entities_source_sha: getMeta(db, "entities_source_sha"),
      attachments: one("SELECT COUNT(*) c FROM attachments").c,
      // STAGE D. `movements` and the freeze stamp ride the health surface
      // together on purpose: an operator's first question after a cutover is
      // "is the new pen actually receiving anything", and the answer is only
      // legible beside the instant the old one stopped. Feature-detected: a
      // read-only open of a pre-D store cannot create the table, and flag-off
      // must never require era-2 schema (the byte-identity gate caught exactly
      // this — the whole stats block died on the missing table).
      ...(one("SELECT name n FROM sqlite_master WHERE type='table' AND name='movements'")
        ? { movements: one("SELECT COUNT(*) c FROM movements").c,
            movements_latest: one("SELECT MAX(at) a FROM movements").a ?? null }
        : { movements: null, movements_latest: null }),
      // THE JOURNAL, feature-detected for the same reason `movements` is: a
      // read-only open of a store predating this slice cannot create the table,
      // and flag-off must never require the new schema.
      //
      // ── WHAT THESE NUMBERS MEAN AFTER G1 (POS-156, 2026-09-22) ───────────
      //
      // They used to answer "is the one pen receiving". G1 deleted the general
      // INSERT, so what is left in this table is the ARENA's rows and nothing
      // else — the named exemption (DEC-1/P-143, `world-journal.mjs §
      // appendArenaRow`) — plus whatever history predates the deletion and has
      // not been drained. So this is now the surface on which that exception is
      // VISIBLE, which is the thing a named exception with a death condition
      // most needs and the reason these three were kept rather than deleted
      // with the other journal readers.
      //
      // ⚑ AND `tools/g1-dev-proof.mjs` READS THEM. `db.journal` and
      // `db.journal_head` from this answer are the proof's DEFAULT source for
      // "the doors round-tripped through the store with no journal row behind
      // them". Dropping the keys would not red that probe — it would make it
      // read `(absent)` and pass trivially, which is a falsifier that can no
      // longer fail. Keep them, or move the proof first.
      ...(one("SELECT name n FROM sqlite_master WHERE type='table' AND name='journal'")
        ? { journal: one("SELECT COUNT(*) c FROM journal").c,
            journal_head: one("SELECT MAX(seq) s FROM journal").s ?? 0,
            journal_latest: one("SELECT MAX(written_at) a FROM journal").a ?? null,
            journal_drained_through: getMeta(db, "journal_drained_through") }
        : { journal: null, journal_head: null, journal_latest: null, journal_drained_through: null }),
      ledger_frozen_at: getMeta(db, "ledger_frozen_at"),
      emissions_total: one("SELECT COUNT(*) c FROM emissions").c,
      emissions_present: one("SELECT COUNT(*) c FROM emissions WHERE born_at <= ? AND ttl_expires_at > ?", now, now).c,
      emissions_oldest: one("SELECT MIN(born_at) b FROM emissions").b ?? null,
      // The prune's own gate, on the surface: everything older than this is
      // already history in the world repo and may be dropped; everything newer
      // is presence that has not yet been crystallized and may not.
      logged_through: getMeta(db, "logged_through"),
      last_crossing_saved: getMeta(db, "last_crossing_saved"),
      last_save_at: getMeta(db, "last_save_at"),
      last_save_commit: getMeta(db, "last_save_commit"),
    };
    db.close();
  } catch (e) {
    base.db.error = String(e?.message ?? e).slice(0, 200);
  }
  return base;
}

if (process.argv[1]?.endsWith("dynamic-store.mjs")) {
  console.log(JSON.stringify(dynamicHealth(), null, 2));
}
