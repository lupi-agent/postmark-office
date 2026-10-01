// prod-flip-falsifiers.test.mjs — the Sunday runner's read-only promise, held on
// a REAL Postgres (POS-142, lane S3, item 3).
//
// `world2/tools/prod-flip-falsifiers.mjs` runs apex, standing and live against
// prod's store and claims a write would be REFUSED rather than land. That is a
// claim about what Postgres does with the session, so a stub cannot prove it:
// the real-server cases start an embedded Postgres on the schema floor
// (test/helpers/embedded-store.mjs) and SKIP by name without EMBEDDED_PG_DIR.
//
// The load-bearing case uses a role that CAN write (`world2_owner`, the floor's
// owner). Through `readOnlyUrl` its INSERT, its UPDATE inside BEGIN … ROLLBACK
// (standing's `--can-fail-proof` shape) and its CREATE are refused; through the
// bare URL the same INSERT lands. So the refusal is the session option's, not
// the role's. `snapshot_reader`, the role the box uses, is refused by privilege
// as well: two layers, each shown on its own.
//
// Run: EMBEDDED_PG_DIR=<dir with embedded-postgres> node --test test/prod-flip-falsifiers.test.mjs

import test, { before, after } from "node:test";
import assert from "node:assert/strict";

import { readOnlyUrl, READ_ONLY_OPTION, childEnv, preflight, worst, FALSIFIERS }
  from "../world2/tools/prod-flip-falsifiers.mjs";
import { startStore } from "./helpers/embedded-store.mjs";

// ── the pure half ───────────────────────────────────────────────────────────

test("readOnlyUrl adds the read-only startup option, and keeps an option already there", () => {
  const u = new URL(readOnlyUrl("postgres://snapshot_reader:pw@localhost:5432/world2_dev"));
  assert.equal(u.searchParams.get("options"), READ_ONLY_OPTION);
  const kept = new URL(readOnlyUrl("postgres://r:pw@h/db?options=-c%20role%3Dsnapshot_reader"));
  assert.equal(kept.searchParams.get("options"), `-c role=snapshot_reader ${READ_ONLY_OPTION}`);
});

test("the children's environment is minimal: the read-only URL, PGOPTIONS, the checkout, the named pass-throughs, and none of the office's flags", () => {
  const env = childEnv({ PATH: "/bin", HOME: "/home/m", W2_PEN: "all", WORLD_POSITIONS: "1", W2_GUARDS: "1",
    WORLD2_PG: "1", OFFICE_KEYS: "secret", WORLD_STORE_DB: "/srv/x/world.db" },
    { url: "postgres://snapshot_reader:pw@localhost/world2_dev", repo: "/srv/w" });
  assert.deepEqual(Object.keys(env).sort(), ["HOME", "PATH", "PGOPTIONS", "WORLD2_PG_URL", "WORLD_CLONE", "WORLD_STORE_DB"]);
  assert.equal(env.PGOPTIONS, READ_ONLY_OPTION);
  assert.match(env.WORLD2_PG_URL, /options=/);
});

test("standing gets NO proof flag: its proof writes inside a rolled-back transaction", () => {
  assert.equal(FALSIFIERS.find((f) => f.id === "standing").proof, null);
  assert.ok(FALSIFIERS.find((f) => f.id === "apex").proof);
  assert.ok(FALSIFIERS.find((f) => f.id === "live").proof);
});

test("the guard's G5 runs as a fourth read-only check, through its own entry, with its own in-memory breaks", () => {
  const g5 = FALSIFIERS.find((f) => f.id === "guard-g5");
  assert.ok(g5, "guard-g5 is on the runner");
  assert.equal(g5.file, "falsifier-guard-g5.mjs");
  assert.equal(g5.proof, "--prove-can-fail");
  assert.ok(!FALSIFIERS.some((f) => f.file === "falsifier-guard-equality.mjs"), "the whole guard (which writes a scratch) is never on the read-only runner");
});

test("the worst exit wins, and a child that died without a code is CANNOT RUN", () => {
  assert.equal(worst([0, 0, 0]), 0);
  assert.equal(worst([0, 1, 0]), 1);
  assert.equal(worst([1, 2, 0]), 2);
  assert.equal(worst([0, null]), 2);
});

test("the preflight REFUSES a session that is not read-only, before any falsifier runs", async () => {
  const answers = { off: "off", on: "on" };
  for (const [name, ro] of Object.entries(answers)) {
    const q = async (sql) => ({ rows: [/SHOW/.test(sql) ? { default_transaction_read_only: ro }
      : /current_user AS u/.test(sql) ? { u: "snapshot_reader", d: "world2_dev" }
      : /has_table_privilege/.test(sql) ? { i: false } : { sha: "abc" }] });
    const r = await preflight(q, { repoHead: "abc" });
    assert.equal(r.refusals.length, name === "off" ? 1 : 0, name);
    assert.equal(r.same_state, true);
  }
});

// ── the real server ─────────────────────────────────────────────────────────

let store = null;
let WHY = null;
before(async () => {
  const s = await startStore({ db: "ro_probe" });
  if (s.skip) { WHY = s.skip; return; }
  store = s;
  const owner = await store.connect("world2_owner");
  await owner.query("CREATE TABLE ro_canary (n int)");
  await owner.query("GRANT SELECT ON ro_canary TO snapshot_reader");
  await owner.query("INSERT INTO projection_heads (repo, sha) VALUES ('world-marks', 'abc123') ON CONFLICT DO NOTHING").catch(() => {});
  await owner.end();
});
after(async () => { if (store) await store.stop(); });

const { default: pg } = await import("pg");
const dial = async (connectionString) => { const c = new pg.Client({ connectionString }); c.on("error", () => {}); await c.connect(); return c; };
const refused = async (c, sql) => {
  try { await c.query(sql); return null; }
  catch (e) { return String(e.message); }
};

test("REAL POSTGRES · a role that CAN write is refused through readOnlyUrl: INSERT, BEGIN…UPDATE…ROLLBACK, CREATE", async (t) => {
  if (!store) return t.skip(WHY);
  const c = await dial(readOnlyUrl(store.url("world2_owner")));
  try {
    assert.match(await refused(c, "INSERT INTO ro_canary VALUES (1)") ?? "LANDED", /read-only transaction/);
    await c.query("BEGIN");
    assert.match(await refused(c, "UPDATE ro_canary SET n = 2") ?? "LANDED", /read-only transaction/);
    await c.query("ROLLBACK");
    assert.match(await refused(c, "CREATE TABLE ro_other (n int)") ?? "LANDED", /read-only transaction/);
  } finally { await c.end(); }
  const check = await store.connect("world2_owner");
  const { rows: [{ n }] } = await check.query("SELECT count(*)::int AS n FROM ro_canary");
  await check.end();
  assert.equal(n, 0, "nothing landed");
});

test("REAL POSTGRES · the CONTROL: the same role through the bare URL writes, so the refusal above is the session option's", async (t) => {
  if (!store) return t.skip(WHY);
  const c = await dial(store.url("world2_owner"));
  try {
    assert.equal(await refused(c, "INSERT INTO ro_canary VALUES (7)"), null, "the bare URL must be able to write, or the refusal proves nothing");
    await c.query("DELETE FROM ro_canary");
  } finally { await c.end(); }
});

test("REAL POSTGRES · PGOPTIONS alone makes a client the falsifier builds with no options read-only", async (t) => {
  if (!store) return t.skip(WHY);
  const prev = process.env.PGOPTIONS;
  process.env.PGOPTIONS = childEnv({}, { url: store.url("world2_owner"), repo: "/x" }).PGOPTIONS;
  let c;
  try {
    c = new pg.Client({ connectionString: store.url("world2_owner") }); c.on("error", () => {});
    await c.connect();
    assert.match(await refused(c, "INSERT INTO ro_canary VALUES (1)") ?? "LANDED", /read-only transaction/);
  } finally {
    await c?.end();
    if (prev == null) delete process.env.PGOPTIONS; else process.env.PGOPTIONS = prev;
  }
});

test("REAL POSTGRES · the box's role, snapshot_reader, is refused by privilege too, and the preflight reads both layers", async (t) => {
  if (!store) return t.skip(WHY);
  const bare = await dial(store.url("snapshot_reader"));
  try { assert.match(await refused(bare, "INSERT INTO ro_canary VALUES (1)") ?? "LANDED", /permission denied/); }
  finally { await bare.end(); }
  const c = await dial(readOnlyUrl(store.url("snapshot_reader")));
  try {
    const r = await preflight((sql) => c.query(sql), { repoHead: null });
    assert.equal(r.read_only, "on");
    assert.equal(r.role, "snapshot_reader");
    assert.equal(r.role_can_insert_marks, false);
    assert.deepEqual(r.refusals, []);
  } finally { await c.end(); }
});
