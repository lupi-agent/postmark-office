// hot-reload.test.mjs — the office picks up a rebuilt index without restarting.
//
// The tick used to end with `systemctl restart postmark-office`, because the
// boot-time handle in server.mjs WAS the data. That restart killed every live
// MCP session four times an hour. These tests are the receipt that it can come
// out: a spawned office, a real file swapped underneath it, and the door
// answering the new sha with nobody having reconnected.
//
// The box renames (deploy/office-rehydrate.sh: `mv -f office.db.new office.db`,
// a new inode); Windows cannot rename over an open handle at all (EPERM), so
// there a swap overwrites the same inode's bytes instead. The watcher has to
// notice BOTH, which is why its stamp is (ino, mtime, size) and not the inode
// alone. The rebuilt-index swap renames wherever the platform allows it, as the
// box does; the recovery swap below always overwrites in place.
//
//   node --test test/hot-reload.test.mjs

import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { copyFileSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

import { fixtureDb } from "./fixture.mjs";
import { bootOnFreePort } from "./spawn-office.mjs";

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

let child, tmp, dbPath, aPath, bPath, junkPath;
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

  fixtureDb(aPath).close();
  fixtureB(bPath);
  writeFileSync(junkPath, "this is not a database, it is a sentence about one\n");
  copyFileSync(aPath, dbPath);

  ({ child, port: PORT } = await bootOnFreePort((port) => {
    const c = spawn(process.execPath, [join(ROOT, "src", "server.mjs"), "--port", String(port), "--db", dbPath], {
      env: {
        ...process.env,
        OFFICE_KEYS: "reloadkey=keemin:wright",
        TOWN_CLONE: join(tmp, "no-clone-here"),
        WORLD_CLONE: join(tmp, "no-world-clone"),
        WORLD_GRAPH_NONE: "1",   // this office swaps its INDEX; it serves no world graph (POS-270 lane W 3b)
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
      const body = await res.json();
      seen.push({ status: res.status, asOf: res.headers.get("x-postmark-as-of"), hint: body?.hint });
    }
  })();

  // B arrives the way the box delivers it: written beside, renamed over. A
  // rename leaves every handle still on A reading A's own inode, whole, until
  // it is retired, so a request across the swap has no torn page to read.
  // Only where the platform refuses the rename (Windows, EPERM: the office
  // holds the file open) is B copied over A's bytes in place, and then a
  // request can read a page half A, half B. That is the copy's tear, not a
  // swap the box ever makes (the corrupt-index test below draws the same line).
  const arriving = join(tmp, "arriving-b.db");
  copyFileSync(bPath, arriving);
  let renamed = true;
  try { renameSync(arriving, dbPath); }
  catch (e) {
    if (process.platform !== "win32" || e.code !== "EPERM") throw e;
    renamed = false;
    copyFileSync(arriving, dbPath);
  }
  const flipped = await until(async () => (await asOfOf()) === B_SHA);
  hammering = false;
  await hammer;

  assert.ok(flipped, `door never reached ${B_SHA}; stderr: ${out.stderr.slice(-400)}`);
  assert.ok(seen.length > 0, "the hammer made no requests");
  for (const r of seen) {
    // Overwritten in place, a request that read the torn page is answered by
    // the office's bounce in SQLite's own words for it, and by nothing else.
    if (!renamed && r.status === 500 && r.hint === "database disk image is malformed") continue;
    assert.equal(r.status, 200, `a request across the swap window was not answered 200 (${renamed ? "renamed" : "overwritten in place"}; hint: ${r.hint})`);
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
