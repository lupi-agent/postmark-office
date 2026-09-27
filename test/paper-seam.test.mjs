// paper-seam.test.mjs — POS-44, the paper seam: every skin logs a paper act,
// because the DOOR logs it.
//
//   node --test test/paper-seam.test.mjs
//
// THE DEFECT THIS FILE HOLDS SHUT. Wave 2 wrote the town-log row in mcp.mjs's
// FLAT-TOOL switch — one call site beside one of the three ways a paper act
// reaches a door. The dev rehearsal (both flags on) found the other two:
//
//   PATCH /profile/wright        → pen commit 608cdf01, NO row
//   household do: "profile"      → dispatched_to update_profile, NO row
//   flat  update_profile         → row
//
// and the flats are the DELISTED path, so flag-on in production most real paper
// edits would never have reached the log at all — while `your_pending_edits`
// went on reporting a hot tense it could not see. A disclosure that lies by
// omission is worse than a missing one, because it reads as an answer.
//
// The repair is placement, not policy: the log moved to where the pen commit
// already lives, so a skin cannot forget it because a skin no longer has the
// option. These falsifiers are therefore mostly PER-SKIN — the bug was never in
// the logging rule, it was in how many places had to remember it.

import "./helpers/drain-pen.mjs"; // #2040: fixtures get a real ledger pen
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync,
} from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

import { fixtureDb } from "./fixture.mjs";
import { openOauthDb } from "../src/oauth.mjs";
import { readTownJournal, ensureTownJournal } from "../src/town-journal.mjs";
import { PAPER_ACTS, paperDoor, replayPaperAct, SETTLES_AT } from "../src/town-updates.mjs";
import { updateProfile, updateHome, updateWindow, updateAddressBody, updateAddressFields } from "../src/edit.mjs";
import * as doorsModule from "../src/edit.mjs";
import { runTownDrain, TOWN_DOORS } from "../src/town-bridge.mjs";
import { withRecordFrom } from "./registry-pool-stub.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
delete process.env.TOWN_PUSH; // nothing here may leave the machine

// ── fixtures ────────────────────────────────────────────────────────────────

/** A town clone with the rooms the paper doors write into, under git. */
function townClone() {
  const dir = mkdtempSync(join(tmpdir(), "pm-seam-"));
  for (const h of ["wright", "limen"]) {
    mkdirSync(join(dir, "WHITE_PAGES", h, "HOME"), { recursive: true });
    mkdirSync(join(dir, "WHITE_PAGES", h, "WINDOW"), { recursive: true });
    writeFileSync(join(dir, "WHITE_PAGES", h, "ADDRESS.md"), `---\nhandle: ${h}\ngithub: gh-${h}\nsince: 2026-01-01\n---\n\n# ${h}\n`);
    writeFileSync(join(dir, "WHITE_PAGES", h, "PROFILE.md"), `---\nhandle: ${h}\ncolor: "#334455"\n---\n\nprofile body\n`);
  }
  mkdirSync(join(dir, "tools"), { recursive: true });
  writeFileSync(join(dir, "tools", "households.json"), JSON.stringify({ schema_version: 1, households: {} }, null, 2) + "\n");
  const git = (...a) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8" });
  git("init", "-q"); git("add", "-A");
  git("-c", "user.name=fixture", "-c", "user.email=fixture@test.invalid", "commit", "-q", "-m", "fixture town");
  return dir;
}

const homes = [];
function logHome() {
  const dir = mkdtempSync(join(tmpdir(), "pm-seam-odb-"));
  homes.push(dir);
  return join(dir, "oauth.db");
}
const dropHomes = () => { for (const d of homes.splice(0)) rmSync(d, { recursive: true, force: true, maxRetries: 5 }); };

const key = { household: "keemin", handles: new Set(["wright"]), ghId: "42", ghLogin: "keeminlee" };
const db = fixtureDb();

const rowsIn = (path) => {
  const o = openOauthDb(path);
  try { ensureTownJournal(o); return readTownJournal(o); } finally { o.close(); }
};

// ASYNC-AWARE SINCE POS-158. `return fn()` handed back a promise and the
// `finally` then cleared the flag while the work was still running — a teardown
// racing the thing it tears down, which fails somewhere else entirely.
const flagOn = async (fn) => {
  process.env.TOWN_SINGLE_LOG = "1";
  try { return await fn(); } finally { delete process.env.TOWN_SINGLE_LOG; }
};

// ═══════════════════════════════════════════════════════════════════════════
// P1-P3 · ONE EDIT, THREE SKINS, OVER REAL HTTP — each one logs
// ═══════════════════════════════════════════════════════════════════════════

test("P1-P4 · EVERY SKIN LOGS: REST PATCH, household apex, flat tool — one row each", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "pm-seam-srv-"));
  const clone = townClone();
  let child;
  try {
    const dbPath = join(tmp, "fixture.db");
    fixtureDb(dbPath).close();
    const odbPath = join(tmp, "oauth.db");
    openOauthDb(odbPath).close();

    const PORT = 43899;
    const BASE = `http://127.0.0.1:${PORT}`;
    const KEY = "seamkey";
    child = spawn(process.execPath, [join(ROOT, "src", "server.mjs"), "--port", String(PORT), "--db", dbPath, "--oauth-db", odbPath], {
      env: {
        ...process.env, TOWN_SINGLE_LOG: "1", OFFICE_KEYS: `${KEY}=keemin:wright`,
        TOWN_CLONE: clone, WORLD_CLONE: join(tmp, "no-world"), VOICES_LOG: join(tmp, "voices.jsonl"), TOWN_PUSH: "",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    await new Promise((ok, no) => {
      const t = setTimeout(() => no(new Error("server never listened")), 15_000);
      child.stdout.on("data", (d) => { if (String(d).includes("listening")) { clearTimeout(t); ok(); } });
      child.on("exit", (c) => no(new Error(`server exited early (${c})`)));
    });
    const auth = { authorization: `Bearer ${KEY}`, "content-type": "application/json" };

    // ── P1 · THE REST SKIN. The rehearsal's first receipt: this wrote a pen
    // commit and no row, because server.mjs calls the verb directly.
    const rest = await (await fetch(`${BASE}/profile/wright`, {
      method: "PATCH", headers: auth, body: JSON.stringify({ bio: "written through REST" }),
    })).json();
    assert.equal(rest.error, undefined, `REST PATCH bounced: ${JSON.stringify(rest)}`);
    assert.ok(rest.commit, "the pen commit still happens — the log is an addition, never a replacement");
    assert.ok(rest.logged?.seq, "AND the row is written: PATCH /profile/{handle} reaches the log");
    assert.equal(rest.logged.settles_at, SETTLES_AT);

    // ── P2 · THE HOUSEHOLD APEX. The rehearsal's second receipt, and the one
    // that mattered most: the apex is the LISTED way to perform these acts and
    // the flats are delisted, so this is the path most real edits take.
    const apex = await (await fetch(`${BASE}/household`, {
      method: "POST", headers: auth,
      body: JSON.stringify({ do: "profile", handle: "wright", bio: "written through the apex" }),
    })).json();
    assert.equal(apex.error, undefined, `apex do: bounced: ${JSON.stringify(apex)}`);
    assert.equal(apex.dispatched_to, "update_profile");
    const apexSeq = apex.logged?.seq ?? apex.result?.logged?.seq;
    assert.ok(apexSeq, `the apex path reaches the log too — got ${JSON.stringify(apex)}`);

    // ── P3 · THE FLAT TOOL. The one path that always worked; it must keep
    // working, and must not now log twice.
    const rpc = await (await fetch(`${BASE}/mcp`, {
      method: "POST",
      headers: { ...auth, accept: "application/json, text/event-stream" },
      body: JSON.stringify({
        jsonrpc: "2.0", id: 1, method: "tools/call",
        params: { name: "update_profile", arguments: { handle: "wright", bio: "written through the flat tool" } },
      }),
    })).json();
    const flat = JSON.parse(rpc.result.content[0].text);
    assert.equal(flat.error, undefined, `flat tool bounced: ${JSON.stringify(flat)}`);
    assert.ok(flat.logged?.seq, "the flat tool still logs — the seam moved, it did not go away");

    // ── P4 · EXACTLY ONE ROW EACH, and all of them `profile`.
    const rows = rowsIn(odbPath);
    assert.equal(rows.length, 3,
      `three edits through three skins is three rows — got ${rows.length}: ${JSON.stringify(rows.map((r) => [r.seq, r.act]))}`);
    assert.deepEqual(rows.map((r) => r.act), ["profile", "profile", "profile"]);
    assert.deepEqual(rows.map((r) => r.handle), ["wright", "wright", "wright"]);
    assert.deepEqual(rows.map((r) => r.cls), ["update", "update", "update"]);
    // the arguments ride VERBATIM, which is the drain's whole contract
    assert.deepEqual(rows.map((r) => r.payload.args.bio),
      ["written through REST", "written through the apex", "written through the flat tool"]);
    // and the seqs the callers were told are the seqs that exist
    assert.deepEqual([rest.logged.seq, apexSeq, flat.logged.seq], rows.map((r) => r.seq),
      "every skin told its caller the truth about which row it wrote");
  } finally {
    if (child && child.exitCode === null) {
      const gone = new Promise((ok) => child.on("exit", ok));
      child.kill();
      await gone; // Windows: the db stays locked until the child is truly down
    }
    rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    rmSync(clone, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// P5 · A BOUNCE LOGS NOTHING
// ═══════════════════════════════════════════════════════════════════════════

test("P5 · a bounce never leaves a row claiming an edit that did not happen", () => {
  const clone = townClone();
  const path = logHome();
  const o = openOauthDb(path);
  try {
    flagOn(() => {
      // not one of this key's residents — scope() throws before any pen work
      assert.throws(() => updateProfile({ handle: "limen", bio: "not mine to write" }, key, db, clone, o),
        (e) => e.code === 403);
      // and a door that reaches its own validation and refuses
      assert.throws(() => updateHome({ handle: "wright" }, key, db, clone, o),
        (e) => e.code === 422);
      assert.deepEqual(readTownJournal(o), [],
        "the throw leaves `impl` before the wrapper's log line is ever reached — there is no branch to get wrong");
    });
  } finally { o.close(); dropHomes(); rmSync(clone, { recursive: true, force: true, maxRetries: 5 }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// P6 · FLAG-OFF IS BYTE-IDENTICAL
// ═══════════════════════════════════════════════════════════════════════════

test("P6 · FLAG-OFF: no row, and the answer is the answer it always was", () => {
  const clone = townClone();
  const path = logHome();
  const o = openOauthDb(path);
  try {
    delete process.env.TOWN_SINGLE_LOG;
    const out = updateProfile({ handle: "wright", bio: "flag-off" }, key, db, clone, o);
    assert.equal(out.error, undefined);
    assert.ok(out.commit, "the pen commit is the whole behaviour flag-off");
    assert.equal("logged" in out, false,
      "no `logged` key at all — not a null one. A caller comparing the two flag states must see the same object shape it saw before wave 2 existed.");
    assert.deepEqual(readTownJournal(o), []);
  } finally { o.close(); dropHomes(); rmSync(clone, { recursive: true, force: true, maxRetries: 5 }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// P7 · THE DRAIN'S REPLAY WRITES NO ROW — the re-entrancy guard
// ═══════════════════════════════════════════════════════════════════════════

test("P7 · A WHOLE CROSSING REPLAYS THE ACT AND WRITES NO NEW ROW", async () => {
  const clone = townClone();
  const path = logHome();
  const o = openOauthDb(path);
  try {
    await flagOn(async () => {
      // one real edit, logged by the door
      updateProfile({ handle: "wright", bio: "the original act" }, key, db, clone, o);
      const before = readTownJournal(o);
      assert.equal(before.length, 1);

      // NOW RUN THE REAL CROSSING, through the real bridge, with the real log
      // handle in its hand — which is the only arrangement in which this can go
      // wrong. Before this commit the doors did not log, so a replay could not;
      // now that they do, a drain that let a log handle reach the door would
      // write a row for the row it is draining, and the town log would grow by
      // one per act per crossing, forever, each new row scheduling its own
      // successor.
      //
      // It cannot, and the reason is arity rather than vigilance:
      // replayPaperAct calls `door(args, asKey, db, clone)` with FOUR
      // arguments, so `odb` defaults to null and the wrapper returns before
      // its log line. The bridge HAS an odb the whole time — it just has no way
      // to hand it over.
      const r = await withRecordFrom(clone, () => runTownDrain(o, { db, clone, doors: TOWN_DOORS, date: "2026-08-25", lockHeld: () => true, log: () => {} }));
      assert.equal(r.ran, true);
      // "the crossing did replay the paper act" until #2302. It no longer does,
      // and that is the fix rather than a regression: the row was written by a
      // REAL door call against THIS clone, so its commit is already behind HEAD
      // and re-imposing its args could only overwrite whatever landed since.
      // What this test is actually about is untouched — the drain reached the
      // row, and the log did not grow by one.
      //
      // THE TEST'S OWN TITLE carries the same stale half ("REPLAYS THE ACT"),
      // and it is deliberately NOT renamed here: this hotfix is being judged by
      // a by-name suite comparison against a control at release/2026-w36.9 (the
      // #2040 protocol), and a rename would read in that diff as one test
      // vanishing and another appearing — noise in the one instrument the
      // review is using. The accurate half of the title, "AND WRITES NO NEW
      // ROW", is the half this test exists for. Rename it in the first ordinary
      // commit after the hotfix lands, not inside it.
      assert.equal(r.counts.update, 1, "the crossing read the paper act");
      assert.equal(r.updates[0].skipped, undefined);
      assert.equal(r.updates[0].already, true,
        "and recognised it as already applied — an act the door itself committed into this clone (#2302)");

      assert.deepEqual(readTownJournal(o).map((r2) => r2.seq), [before[0].seq],
        "STILL ONE ROW — the crossing settled the act and wrote nothing down");
      assert.equal(readTownJournal(o).length, 1,
        "a log that grows on drain is a log that never empties, and every crossing after this one would be bigger than the last");
    });
  } finally { o.close(); dropHomes(); rmSync(clone, { recursive: true, force: true, maxRetries: 5 }); }
});

test("P7b · …and the guard is structural: the replay call site passes four arguments", () => {
  const src = readFileSync(join(ROOT, "src", "town-updates.mjs"), "utf8");
  assert.match(src, /door\(row\.payload\?\.args \?\? \{\}, asKey, db, clone\)/,
    "a fifth argument here would silently turn every crossing into a log-doubling machine");
  // the doors the drain uses are the wrapped ones, so this is the arity that matters
  for (const spec of Object.values(PAPER_ACTS))
    assert.equal(typeof TOWN_DOORS[spec.tool], "function");
});

// ═══════════════════════════════════════════════════════════════════════════
// P8 · ONE SEAM — the property the whole repair is
// ═══════════════════════════════════════════════════════════════════════════

test("P8 · logPaperAct has exactly ONE caller in src/, and it is the door wrapper", () => {
  const files = readdirSync(join(ROOT, "src")).filter((f) => f.endsWith(".mjs"));
  const callers = [];
  for (const f of files) {
    const src = readFileSync(join(ROOT, "src", f), "utf8");
    // the definition itself is not a call
    const hits = (src.match(/logPaperAct\(/g) ?? []).length
      - (src.match(/export function logPaperAct\(/g) ?? []).length;
    if (hits > 0) callers.push([f, hits]);
  }
  assert.deepEqual(callers, [["town-updates.mjs", 1]],
    `the defect was two call sites' worth of remembering; one is the fix. Found: ${JSON.stringify(callers)}`);

  // and no skin reaches for it any more
  for (const f of ["mcp.mjs", "server.mjs", "household-apex.mjs"])
    assert.equal(/logPaperAct/.test(readFileSync(join(ROOT, "src", f), "utf8")), false,
      `${f} must not know how to log a paper act — that knowledge is what drifted`);
});

test("P8b · every paper act's door is a wrapped door", () => {
  // If a door were exported unwrapped, its skin would go back to logging
  // nothing and every test above that does not touch it would stay green.
  const doors = { "address-body": updateAddressBody, "address-fields": updateAddressFields,
    home: updateHome, profile: updateProfile, window: updateWindow };
  for (const [act, fn] of Object.entries(doors)) {
    assert.ok(PAPER_ACTS[act], `${act} is a paper act`);
    // paperDoor returns a NAMED function expression, so the name survives the
    // `export const` binding and is the one thing that distinguishes a wrapped
    // door from the raw implementation. Arity cannot: `odb = null` is a
    // defaulted parameter and does not count toward `.length`, so both are 4.
    assert.equal(fn.name, "paperDoorCall",
      `${act} must be exported THROUGH paperDoor — an unwrapped implementation has the same arity and logs nothing`);
  }

  // …and the two image doors are deliberately NOT wrapped: they are not paper
  // acts (PAPER_ACTS names five), so wrapping them would invent a class of row
  // no drain has a replay for.
  const { updateProfileAvatar, updateHomeImage } = doorsModule;
  assert.equal(updateProfileAvatar.name, "updateProfileAvatar");
  assert.equal(updateHomeImage.name, "updateHomeImage");
});

// ═══════════════════════════════════════════════════════════════════════════
// P8c · THE NEXT SKIN CANNOT MAKE THIS MISTAKE QUIETLY
// ═══════════════════════════════════════════════════════════════════════════

test("P8c · every caller of a paper door hands it the log", () => {
  // Moving the log into the door fixes the three skins that exist. It does NOT
  // stop a FOURTH from being written next month that calls
  // `updateProfile(fields, key, db, clone)` with four arguments, logs nothing,
  // and passes every other test in this file — which is precisely how the
  // original defect survived wave 2's review. So the call sites are checked
  // too: this is the class, not the instance.
  const DOORS = ["updateAddressBody", "updateAddressFields", "updateHome", "updateProfile", "updateWindow"];
  const files = readdirSync(join(ROOT, "src")).filter((f) => f.endsWith(".mjs") && f !== "edit.mjs");
  const short = [];

  for (const f of files) {
    const src = readFileSync(join(ROOT, "src", f), "utf8");
    for (const door of DOORS) {
      // every call of this door, with its argument list
      for (const m of src.matchAll(new RegExp(`\\b${door}\\((.*?)\\);`, "g"))) {
        const args = m[1].split(",").length;
        if (args < 5) short.push(`${f}: ${door}(${m[1]}) — ${args} arguments`);
      }
    }
  }
  assert.deepEqual(short, [],
    "a paper door called with four arguments writes no row and says nothing about it — the exact shape of the defect this commit repairs");

  // The ONE deliberate four-argument call is the drain's, and it lives behind
  // `door(...)` rather than a door's name — which is why the scan above cannot
  // see it and why P7 exists to cover it instead.
  assert.match(readFileSync(join(ROOT, "src", "town-updates.mjs"), "utf8"),
    /door\(row\.payload\?\.args \?\? \{\}, asKey, db, clone\)/);
});

// ═══════════════════════════════════════════════════════════════════════════
// P9 · A LOG THAT WILL NOT WRITE IS LOUD, AND THE EDIT STILL STANDS
// ═══════════════════════════════════════════════════════════════════════════

test("P9 · a failed log warns on stderr and does NOT fail the edit", () => {
  const clone = townClone();
  try {
    flagOn(() => {
      // a log handle that throws on use — a closed database, a locked file, a
      // table that will not create
      const broken = { prepare() { throw new Error("database is locked"); }, exec() { throw new Error("database is locked"); } };

      const said = [];
      const realError = console.error;
      console.error = (...a) => said.push(a.join(" "));
      let out;
      try { out = updateProfile({ handle: "wright", bio: "the log will fail" }, key, db, clone, broken); }
      finally { console.error = realError; }

      // THE EDIT LANDED. The pen commit is already in the town clone, so
      // throwing here would tell the caller a false thing about their edit in
      // order to tell them a true thing about the log.
      assert.equal(out.error, undefined);
      assert.ok(out.commit, "the pen commit stands");
      assert.equal("logged" in out, false, "and the answer does not claim a row that was never written");

      // …AND IT DOES NOT VANISH, which is what the old seam did behind a bare
      // `catch {}`. Flag-on, a log that will not write means the crossing never
      // settles this act and the hot tense is blind to it — silence there is a
      // town quietly losing edits.
      assert.equal(said.length, 1, "exactly one complaint");
      assert.match(said[0], /^\[town-log\] paper act "profile" for wright did NOT reach the log: database is locked$/,
        "it names the act, the resident and the cause, in the office's own instrumentation grammar");
    });
  } finally { rmSync(clone, { recursive: true, force: true, maxRetries: 5 }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// P10 · THE OTHER FOUR ACTS GO THROUGH THE SAME DOOR
// ═══════════════════════════════════════════════════════════════════════════

test("P10 · all five paper acts log, under their own act names", () => {
  const clone = townClone();
  const path = logHome();
  const o = openOauthDb(path);
  try {
    flagOn(() => {
      updateAddressBody({ handle: "wright", body: "a new address note" }, key, db, clone, o);
      updateAddressFields({ handle: "wright", note: "a directory line" }, key, db, clone, o);
      updateHome({ handle: "wright", body: "a home description" }, key, db, clone, o);
      updateProfile({ handle: "wright", bio: "a bio" }, key, db, clone, o);
      updateWindow({ handle: "wright", html: "<p>hung</p>" }, key, db, clone, o);

      assert.deepEqual(readTownJournal(o).map((r) => r.act),
        ["address-body", "address-fields", "home", "profile", "window"],
        "each door logs under ITS OWN act name — the drain routes on this, so a mislabelled row replays through the wrong door");
      // and each names the file the crossing will settle
      for (const r of readTownJournal(o))
        assert.equal(typeof PAPER_ACTS[r.act].file(r.handle), "string");
    });
  } finally { o.close(); dropHomes(); rmSync(clone, { recursive: true, force: true, maxRetries: 5 }); }
});
