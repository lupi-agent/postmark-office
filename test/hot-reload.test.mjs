// hot-reload.test.mjs — the office picks up a rebuilt index without restarting.
//
// The tick used to end with `systemctl restart postmark-office`, because the
// boot-time handle in server.mjs WAS the data. That restart killed every live
// MCP session four times an hour. These tests are the receipt that it can come
// out: a spawned office, a real file swapped underneath it, and the door
// answering the new sha with nobody having reconnected.
//
// The swap is done with `copyFile`, NOT `rename`, on purpose. The box renames
// (new inode); Windows cannot rename over an open handle at all (EPERM), so the
// test overwrites the same inode's bytes instead. The watcher has to notice
// BOTH, which is why its stamp is (ino, mtime, size) and not the inode alone.
//
//   node --test test/hot-reload.test.mjs

import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { copyFileSync, mkdtempSync, renameSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

import { fixtureDb } from "./fixture.mjs";
import { bootOnFreePort } from "./spawn-office.mjs";
import { worldStoreFixture } from "./world-graph-fixture.mjs";
import { worldGraphPayload, resetGraphCache } from "../src/world-graph.mjs";
import { classFieldsFromStore, resetClassFieldsCache } from "../src/world-frames.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// The port is asked of the OS, never chosen (spawn-office.mjs § the port,
// asked for); it was the fixed 43861, a door every pool tree on the box shares.
let PORT, BASE;

// Short enough that the suite does not spend a minute waiting out a
// production-sized grace; long enough that the sweep is still a SECOND tick
// after the swap rather than the same one, which is the ordering under test.
const POLL_MS = 150;
const GRACE_MS = 400;

const A_SHA = "fixturesha000000000000000000000000000000";       // fixture.mjs's own
const B_SHA = "bbbbbbbb1111111111111111111111111111beef";

let child, tmp, dbPath, aPath, bPath, junkPath, worldPath;
const out = { stdout: "", stderr: "" };

/** A second index: same fixture town, one more resident, a different as_of. */
function fixtureB(path) {
  const db = fixtureDb(path);
  db.prepare("UPDATE meta SET value = ? WHERE key = 'as_of'").run(B_SHA);
  db.prepare("UPDATE meta SET value = ? WHERE key = 'hydrated_counts'")
    .run(JSON.stringify({ residents: 4, letters: 6, threads: 1, ledger: 4, bulletin: 1 }));
  db.prepare("INSERT INTO residents VALUES (?, ?)").run("newcomer", JSON.stringify({
    handle: "newcomer", is_office: false, last_active: null,
    address: { data: { since: "2026-08-11" }, body: "# newcomer" },
  }));
  db.close();
  return path;
}

const get = (path) => fetch(`${BASE}${path}`);
const asOfOf = async (path = "/town") => (await get(path)).headers.get("x-postmark-as-of");
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));

/** Poll until `probe()` is truthy, or give up. Returns what the probe last saw. */
async function until(probe, { ms = 8_000, every = 60 } = {}) {
  const deadline = Date.now() + ms;
  for (;;) {
    const seen = await probe();
    if (seen) return seen;
    if (Date.now() > deadline) return seen;
    await sleep(every);
  }
}

before(async () => {
  tmp = mkdtempSync(join(tmpdir(), "postmark-office-reload-"));
  dbPath = join(tmp, "office.db");
  aPath = join(tmp, "a.db");
  bPath = join(tmp, "b.db");
  junkPath = join(tmp, "junk.db");
  worldPath = join(tmp, "world.db");

  fixtureDb(aPath).close();
  fixtureB(bPath);
  writeFileSync(junkPath, "this is not a database, it is a sentence about one\n");
  copyFileSync(aPath, dbPath);
  worldStoreFixture(worldPath);

  ({ child, port: PORT } = await bootOnFreePort((port) => {
    const c = spawn(process.execPath, [join(ROOT, "src", "server.mjs"), "--port", String(port), "--db", dbPath], {
      env: {
        ...process.env,
        OFFICE_KEYS: "reloadkey=keemin:wright",
        TOWN_CLONE: join(tmp, "no-clone-here"),
        WORLD_CLONE: join(tmp, "no-world-clone"),
        WORLD_STORE_DB: worldPath,
        VOICES_LOG: join(tmp, "voices-log.jsonl"),
        TOWN_PUSH: "",
        OFFICE_RELOAD_POLL_MS: String(POLL_MS),
        OFFICE_RETIRE_GRACE_MS: String(GRACE_MS),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    c.stdout.on("data", (d) => { out.stdout += String(d); });
    c.stderr.on("data", (d) => { out.stderr += String(d); });
    return c;
  }));
  BASE = `http://127.0.0.1:${PORT}`;
});

after(async () => {
  if (child && child.exitCode === null) {
    const gone = new Promise((ok) => child.on("exit", ok));
    child.kill();
    await gone; // Windows: the db files stay locked until the child is truly down
  }
  rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

test("the office boots on A and says so", async () => {
  assert.equal(await asOfOf(), A_SHA);
  const town = await (await get("/town")).json();
  assert.equal(town.counts.residents, 3);
});

test("a rebuilt index is picked up in place — header, meta and handle all flip", async () => {
  // Requests in flight ACROSS the swap: the whole point is that nobody is
  // dropped, so the hammer runs for the duration and every answer is checked.
  let hammering = true;
  const seen = [];
  const hammer = (async () => {
    while (hammering) {
      const res = await get("/town");
      seen.push({ status: res.status, asOf: res.headers.get("x-postmark-as-of") });
      await res.json();
    }
  })();

  copyFileSync(bPath, dbPath);
  const flipped = await until(async () => (await asOfOf()) === B_SHA);
  hammering = false;
  await hammer;

  assert.ok(flipped, `door never reached ${B_SHA}; stderr: ${out.stderr.slice(-400)}`);
  assert.ok(seen.length > 0, "the hammer made no requests");
  for (const r of seen) {
    assert.equal(r.status, 200, "a request across the swap window was not answered 200");
    assert.ok(r.asOf === A_SHA || r.asOf === B_SHA, `a request across the swap saw a third as-of: ${r.asOf}`);
  }

  // `meta` swapped (counts + body as_of both come off it) …
  const town = await (await get("/town")).json();
  assert.equal(town.as_of, B_SHA);
  assert.equal(town.counts.residents, 4);
  // … and so did the HANDLE: this row exists only in B.
  const { residents } = await (await get("/residents")).json();
  assert.ok(residents.some((r) => r.handle === "newcomer"), "the new resident row never appeared — the db handle did not swap");

  assert.match(out.stdout, /\[office\] index reloaded — as-of bbbbbbbb1111 \(was fixturesha00\)/);
});

test("the retired index is closed once the grace has passed", async () => {
  const closed = await until(() => out.stdout.includes("[office] retired index as-of fixturesha00 closed"));
  assert.ok(closed, `the retired handle was never closed; stdout tail: ${out.stdout.slice(-400)}`);
  // Closed, and closed QUIETLY: a borrower still holding at close time is the
  // one condition that prints to stderr, and no request here was slow enough.
  assert.ok(!out.stderr.includes("still holding it"), out.stderr.slice(-400));
});

test("a corrupt index is refused — the office keeps serving the last good one", async () => {
  const before = out.stderr.length;
  // HOW the bad file arrives decides how much this test can claim. The box
  // renames, and a rename leaves the live handle on the old inode with its
  // bytes intact — a corrupt arrival costs the office literally nothing.
  // Windows cannot rename over an open handle at all, so there the test
  // overwrites the same inode instead, which really does shred the bytes the
  // live handle points at; no process could keep reading rows out of that. So
  // the DATA claim is made only where the swap was faithful. The claims that
  // hold either way — the office does not ADOPT the bad file, says so once, and
  // recovers — are made always.
  const arriving = join(tmp, "arriving.db");
  copyFileSync(junkPath, arriving);
  let renamed = true;
  try { renameSync(arriving, dbPath); } catch { renamed = false; copyFileSync(arriving, dbPath); }
  // Several polls' worth: the watcher must look, fail, and look again rather
  // than record the stamp and give up on a file that is only mid-write.
  await sleep(POLL_MS * 6);

  assert.equal(await asOfOf(), B_SHA, "a non-database displaced the good index");
  if (renamed) {
    const town = await (await get("/town")).json();
    assert.equal(town.counts.residents, 4, "the retired-inode handle stopped answering B's rows");
  }

  const complaint = out.stderr.slice(before);
  assert.match(complaint, /changed but would not open/);
  assert.match(complaint, /still serving as-of bbbbbbbb1111/);
  // One line per distinct complaint, not one per poll.
  assert.equal(complaint.split("changed but would not open").length - 1, 1);
});

test("...and recovers the moment a good file lands", async () => {
  copyFileSync(aPath, dbPath);
  const flipped = await until(async () => (await asOfOf()) === A_SHA);
  assert.ok(flipped, `never recovered to ${A_SHA}; stderr: ${out.stderr.slice(-400)}`);
  const { residents } = await (await get("/residents")).json();
  assert.ok(!residents.some((r) => r.handle === "newcomer"), "still serving B's rows after recovering to A");
});

// world.db is the one store the office never holds a handle to — every reader
// opens and closes per call — so it is also the only one this platform can swap
// by RENAME, which is what the box actually does to both stores. That makes it
// the place to prove the stamp catches a NEW INODE and not only new bytes; the
// index above can only be swapped in place here, because Windows refuses to
// rename over the handle server.mjs is holding (EPERM, verified).
test("a world.db swap is noticed — by rename (new inode) and by overwrite alike", async () => {
  for (const how of ["rename", "overwrite"]) {
    const before = out.stdout.length;
    const other = join(tmp, `world-${how}.db`);
    worldStoreFixture(other, { l6: "unhandled" });
    if (how === "rename") renameSync(other, worldPath); else copyFileSync(other, worldPath);
    const noticed = await until(() => out.stdout.slice(before).includes("world store changed"));
    assert.ok(noticed, `the world watcher never fired on ${how}; stdout tail: ${out.stdout.slice(-400)}`);
    // The window still answers afterwards — a drop must leave the next reader
    // able to rebuild, not leave a hole where the payload was.
    const view = await (await get("/world/graph")).json();
    assert.equal(view.error, undefined);
    assert.ok(view.counts.nodes > 0);
  }
});

// ── the drops themselves, in process ─────────────────────────────────────────
//
// The two caches below already re-stat their file on the way in, so a swap that
// changes (mtime, size) would invalidate them with no watcher at all — and a
// test that only swapped a file would pass whether or not the drop function did
// anything. So these FOOL the stat: the content is rewritten in place at a
// fixed byte length and the mtime is restored, leaving a file whose stamp is
// identical and whose contents are not. The stale read is asserted first (the
// precondition that makes the test able to fail), and only then the drop.

const FIXED_MTIME = new Date(1_786_000_000_000); // whole ms — NTFS keeps sub-ms, and utimes does not
const stampOf = (p) => { const s = statSync(p); return `${s.ino}|${s.mtimeMs}|${s.size}`; };

/** Rewrite one same-length value in a world store, leaving its stat stamp untouched. */
function rewriteInPlace(path, mutate) {
  utimesSync(path, FIXED_MTIME, FIXED_MTIME);
  const stamp = stampOf(path);
  const db = new DatabaseSync(path);
  mutate(db);
  db.close();
  utimesSync(path, FIXED_MTIME, FIXED_MTIME);
  assert.equal(stampOf(path), stamp, "the in-place rewrite moved the stat stamp — this test can no longer prove anything");
  return stamp;
}

const SHA_A = "f00dcafe0000000000000000000000000000beef";  // world-graph-fixture's AS_OF_WORLD
const SHA_B = "0123456789abcdef0123456789abcdef01234567";  // same length, so the file cannot grow

test("world-graph: resetGraphCache is what invalidates a payload the stat cannot see change", () => {
  const path = join(tmp, "graph-drop.db");
  worldStoreFixture(path);
  utimesSync(path, FIXED_MTIME, FIXED_MTIME);
  assert.equal(worldGraphPayload(path).as_of.world, SHA_A);

  rewriteInPlace(path, (db) => db.prepare("UPDATE meta SET value = ? WHERE key = 'as_of_world'").run(SHA_B));

  assert.equal(worldGraphPayload(path).as_of.world, SHA_A, "the stat guard should NOT have noticed — if it did, this test proves nothing");
  resetGraphCache();
  assert.equal(worldGraphPayload(path).as_of.world, SHA_B, "resetGraphCache did not drop the payload");
});

test("world-frames: resetClassFieldsCache is what invalidates the class read", () => {
  const path = join(tmp, "frames-drop.db");
  worldStoreFixture(path);
  // The window's fixture carries no class-bearing MARK — its `class:` sits on
  // class nodes, and this read only collects `kind='mark'` — so the quay is
  // given one. Setup, before any baseline is taken; the stamp freeze is below.
  const seed = new DatabaseSync(path);
  seed.prepare("UPDATE nodes SET props = ? WHERE id = 'the-town/the-quay'").run(JSON.stringify({ class: "parcel" }));
  seed.close();

  utimesSync(path, FIXED_MTIME, FIXED_MTIME);
  const first = classFieldsFromStore({ worldDb: path });
  assert.equal(first.gate.status, "PRESENT");
  assert.equal(first.fields.get("the-town/the-quay").class, "parcel");

  // "parcel" -> "vessel": six letters for six, so the props blob keeps its length.
  rewriteInPlace(path, (db) => db.prepare("UPDATE nodes SET props = ? WHERE id = 'the-town/the-quay'")
    .run(JSON.stringify({ class: "vessel" })));

  assert.equal(classFieldsFromStore({ worldDb: path }).fields.get("the-town/the-quay").class, "parcel",
    "the stat guard should NOT have noticed — if it did, this test proves nothing");
  resetClassFieldsCache();
  assert.equal(classFieldsFromStore({ worldDb: path }).fields.get("the-town/the-quay").class, "vessel",
    "resetClassFieldsCache did not drop the class read");
});
