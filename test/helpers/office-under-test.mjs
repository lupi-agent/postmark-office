// office-under-test.mjs — the town index a test's office reads: the store.
//
// office.db is leaving (POS-268): the office will refuse to boot without
// TOWN_INDEX_READS=store. So a test that boots an office (or calls its doors
// in-process) gives it a store seeded from the same fixture office.db the test
// already builds, the way the ingest would have written it. The fixture stays
// the test's one statement of the town; this helper turns it into the store.
//
//   const ix = await indexStore(dbPath);      // in before()
//   spawn(node, [server.mjs, ...], { env: { ...process.env, ...ix.env } });
//   await ix.reseed();                        // after the test rewrote office.db
//   await ix.stop();                          // in after()
//
// While office.db still exists, OFFICE_TEST_INDEX=office runs the same file the
// old way (no store, the switch off), so each moved file can be shown green
// both ways. The deletion removes that mode.
//
// A file that cannot start its store FAILS with embedded-store.mjs § NO_STORE.

import { DatabaseSync } from "node:sqlite";
import { startStore } from "./embedded-store.mjs";
import { copyIndexToStore } from "./index-to-store.mjs";

/** Which index this run's offices read: "store" (the default) or "office" (the old way, until the deletion). */
export const testIndex = () => (process.env.OFFICE_TEST_INDEX === "office" ? "office" : "store");

/**
 * A store seeded from the office.db at `dbPath` (a path, or an open DatabaseSync),
 * or an empty town index when `dbPath` is null (a test whose doors never had one).
 * `env` is what an office (spawned, or this process via `useInProcess`) needs to
 * read it; office_api is the office's own pen.
 */
export async function indexStore(dbPath, { db: name = "office_test" } = {}) {
  if (testIndex() === "office") return { env: {}, reseed: async () => {}, stop: async () => {}, useInProcess: async () => () => {} };
  const s = await startStore({ db: name });
  const seed = async () => {
    if (dbPath == null) return;
    const db = typeof dbPath === "string" ? new DatabaseSync(dbPath, { readOnly: true }) : dbPath;
    const w = await s.connect("law_ingester");
    try { await copyIndexToStore(w, db); }
    finally { await w.end(); if (typeof dbPath === "string") db.close(); }
  };
  await seed();
  const env = { TOWN_INDEX_READS: "store", WORLD2_PG: "1", WORLD2_PG_URL: s.url("office_api") };
  return {
    env,
    store: s,
    /** Copy the office.db again, after the test changed it. */
    reseed: seed,
    /**
     * Switch THIS process to the store (for a test that calls mcp / household
     * in-process) and load the roll and the write path's probe. Answers a
     * function that puts the environment back.
     */
    // The switch, and the index read through a pool of its own
    // (town-index-store.mjs § __setTownIndexPoolForTest): the record's env is
    // left as the test set it, so a suite that stubs the record's pen keeps its
    // stub and still reads a real index.
    async useInProcess() {
      const keep = process.env.TOWN_INDEX_READS;
      process.env.TOWN_INDEX_READS = "store";
      const { default: pg } = await import("pg");
      const pool = new pg.Pool({ connectionString: s.url("office_api"), max: 3 });
      pool.on("error", () => {});
      const tis = await import("../../src/town-index-store.mjs");
      tis.__setTownIndexPoolForTest(pool);
      await tis.refreshStoreRoll();
      await tis.refreshStoreProbe();
      return async () => {
        tis.__setTownIndexPoolForTest(null);
        await pool.end().catch(() => {});
        if (keep === undefined) delete process.env.TOWN_INDEX_READS; else process.env.TOWN_INDEX_READS = keep;
      };
    },
    stop: () => s.stop(),
  };
}

/**
 * A store filled the way the box fills it: the town-index ingest's seed over a
 * town checkout at `sha` (default HEAD), written by its own pen. For a test
 * that builds a real town rather than a fixture office.db.
 */
export async function indexStoreFromTown(townRepo, { sha = null, db: name = "office_test" } = {}) {
  if (testIndex() === "office") return { env: {}, stop: async () => {} };
  const { execFileSync } = await import("node:child_process");
  const at = sha ?? execFileSync("git", ["-C", townRepo, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const s = await startStore({ db: name });
  const { ingest } = await import("../../world2/tools/town-index-ingest.mjs");
  const w = await s.connect("law_ingester");
  try { await ingest(w, { townRepo, sha: at, seed: true }); }
  finally { await w.end(); }
  return { env: { TOWN_INDEX_READS: "store", WORLD2_PG: "1", WORLD2_PG_URL: s.url("office_api") }, store: s, stop: () => s.stop() };
}
