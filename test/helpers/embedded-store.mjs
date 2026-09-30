// embedded-store.mjs — a REAL Postgres for a store test, when one is to hand.
//
// "A round trip through a JS stub is not a round trip through Postgres": a stub
// keeps what the database would reorder, refuse or collate differently. So a
// test that holds the store to office.db runs on a Postgres server this helper
// starts and deletes itself: the `embedded-postgres` package, found through
// EMBEDDED_PG_DIR (a directory whose node_modules holds it). The office does not
// depend on it. Without it the test SKIPS and says why, never passes silently.
//
//   EMBEDDED_PG_DIR=/path/to/dir node --test test/<file>.test.mjs
//
// The floor is CI's (guard-falsifier-floor.sh): every world2/schema/[0-9]*.sql
// in name order, 003 skipped, applied as `world2_owner`, after the roles the box
// makes by hand. Every connection is built here; WORLD2_PG_URL and PG* are never
// read, so no test can reach a real store by accident.

import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { createRequire } from "node:module";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCHEMA = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "world2", "schema");
const ROLES = ["world2_owner", "office_api", "clearing_job", "law_ingester", "snapshot_reader",
  "review_publisher", "earpiece", "stance_reader"];
const PW = "local";

const freePort = () => new Promise((ok, no) => {
  const s = createServer();
  s.unref();
  s.on("error", no);
  s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => ok(port)); });
});

/**
 * Start a store with the whole schema applied. Answers `{ skip }` with the reason
 * when no embedded Postgres can be found; otherwise `{ connect(role), stop() }`,
 * where `connect` hands back a connected `pg.Client`.
 */
export async function startStore({ db = "town_index_test" } = {}) {
  const dir = process.env.EMBEDDED_PG_DIR;
  if (!dir) return { skip: "EMBEDDED_PG_DIR is not set: this test needs a real Postgres (the embedded-postgres package) and will not stand a stub in for one" };
  let EmbeddedPostgres;
  try {
    const req = createRequire(join(dir, "noop.js"));
    EmbeddedPostgres = (await import(pathToFileURL(req.resolve("embedded-postgres")).href)).default;
  } catch (e) {
    return { skip: `EMBEDDED_PG_DIR=${dir} holds no embedded-postgres (${String(e?.message ?? e).slice(0, 120)})` };
  }
  const { default: pg } = await import("pg");
  const scratch = mkdtempSync(join(tmpdir(), "office-store-"));
  const port = await freePort();
  const server = new EmbeddedPostgres({
    databaseDir: join(scratch, "data"), user: "postgres", password: PW, port, persistent: false,
    onLog: () => {}, onError: () => {},
  });
  await server.initialise();
  await server.start();
  const connect = async (user, database = db) => {
    const c = new pg.Client({ host: "127.0.0.1", port, user, password: PW, database });
    c.on("error", () => {});
    await c.connect();
    return c;
  };
  const su = await connect("postgres", "postgres");
  for (const r of ROLES) await su.query(`CREATE ROLE ${r} LOGIN PASSWORD '${PW}'`);
  await su.query(`CREATE DATABASE ${db} OWNER world2_owner`);
  await su.end();
  const owner = await connect("world2_owner");
  for (const f of readdirSync(SCHEMA).filter((n) => /^\d{3}_.+\.sql$/.test(n) && n !== "003_falsifier_roles.sql").sort())
    await owner.query(readFileSync(join(SCHEMA, f), "utf8"));
  await owner.end();
  return {
    connect,
    /** A connection string for a role, for a child process (a spawned office) to dial. */
    url: (user, database = db) => `postgres://${user}:${PW}@127.0.0.1:${port}/${database}`,
    async stop() {
      // Windows can hold the data directory for a moment after the server has
      // gone; a scratch directory left in tmp is not a test failure.
      try { await server.stop(); }
      finally {
        try { rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); }
        catch (e) { console.error(`[embedded-store] left ${scratch} behind (${e.code ?? e.message})`); }
      }
    },
  };
}
