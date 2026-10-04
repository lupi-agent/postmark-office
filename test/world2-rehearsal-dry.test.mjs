// world2-rehearsal-dry.test.mjs — THE RUNNER CROSSES WHAT IT CLEARED, DRY (POS-242 item 2).
//
//   node --test test/world2-rehearsal-dry.test.mjs
//
// The rehearsal runner used to stop at the clearing and print a list of reasons
// it could not go further. Now it runs the TREE's own settlement-auto.sh under
// SETTLEMENT_DRY=1 against the copy and reads that crossing's receipt. What is
// held here:
//
//   · the environment the runner hands the crossing — built from nothing, the
//     office's pen on the copy's URL, prod's modes, its own clone and receipt;
//   · runDryLeg driving a REAL settlement-auto.sh (the bottle's fixture office,
//     test/helpers/settlement-bottle.mjs) to a dry receipt with nothing on origin;
//   · the three ways it must refuse to call something a rehearsal: no script, a
//     script that predates the dry leg, a receipt that does not say dry — and a
//     stale receipt from the last run is never read as this one's.
//
// The CLI's own path (the copy, the pen check) needs a Postgres that is a copy
// of prod's, so it runs on the box; its parts are these.

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dryLegEnv, runDryLeg } from "../world2/tools/rehearse.mjs";
import { SH_OK, GIT_ENV, scratch, bottle, originRefs } from "./helpers/settlement-bottle.mjs";

const skip = !SH_OK && "no POSIX sh";
const URL_ = "postgres://rehearsal_runner:s3cret@127.0.0.1:5432/world2_rehearsal";

test("the crossing's environment: built from nothing, the office's pen on the copy, prod's modes, its own clone and receipt", () => {
  const env = dryLegEnv({ tree: "/r/tree", url: URL_, townRepo: "/r/town", worldRepo: "/r/world", dryDir: "/r/dry", path: "/usr/bin", home: "/home/meepo" });
  assert.deepEqual(Object.keys(env).sort(), [
    "HOME", "OFFICE_ROOT", "PATH", "SETTLEMENT_CLONE", "SETTLEMENT_DRY", "SETTLEMENT_REPORT", "SETTLEMENT_SOURCE",
    "STATE_LOG_SOURCE", "TOWN_CLONE", "WORLD2_PG", "WORLD2_PG_URL", "WORLD_CLONE",
  ], "nothing inherited: no TOWN_PUSH, no token, no other WORLD2_*");
  assert.equal(env.SETTLEMENT_DRY, "1");
  assert.equal(env.SETTLEMENT_SOURCE, "store");
  assert.equal(env.STATE_LOG_SOURCE, "store", "the box's own mode (read 2026-10-01)");
  const u = new URL(env.WORLD2_PG_URL);
  assert.equal(u.searchParams.get("options"), "-c role=office_api", "the crossing reads as the office's pen");
  assert.equal(u.pathname, "/world2_rehearsal");
  assert.equal(u.password, "s3cret");
  assert.equal(env.OFFICE_ROOT, "/r/tree", "the tree's crossing, not the runner's");
  assert.match(env.SETTLEMENT_CLONE.replace(/\\/g, "/"), /^\/r\/dry\//);
  assert.match(env.SETTLEMENT_REPORT.replace(/\\/g, "/"), /^\/r\/dry\/settlement-dry\.json$/);
});

/** The bottle's office as the tree, the bottle's clones as the runner's town and world. */
function inBottle(b, extra = {}) {
  const dryDir = join(b.root, "dry");
  const env = { ...dryLegEnv({ tree: b.office, url: URL_, townRepo: b.townClone, worldRepo: b.worldClone, dryDir }), ...GIT_ENV, ...extra };
  return { dryDir, env };
}

test("runDryLeg crosses the tree's REAL settlement-auto.sh dry: a published receipt, every withheld write named, nothing on origin", { skip }, () => {
  const b = bottle();
  const before = originRefs(b.origin);
  const { env } = inBottle(b, { STUB_LOG: join(b.root, "stubs.log"), STORE_WRITES: join(b.root, "store.log"), ESCALATIONS: join(b.root, "esc.log") });
  const d = runDryLeg({ tree: b.office, env });
  assert.equal(d.ran, true);
  assert.equal(d.ok, true, JSON.stringify(d.tail));
  assert.equal(d.status, "published");
  assert.match(d.detail, /^DRY RUN, nothing written — 1 published/);
  assert.ok(d.withheld.some((l) => l.startsWith("world main's push: ")), JSON.stringify(d.withheld));
  assert.ok(d.withheld.includes("escalation: suite-warning"));
  assert.deepEqual(d.retired, { ran: false, dry_run: true, would_retire: ["alpha/old"], reason: "dry run — the store was not written" });
  assert.equal(originRefs(b.origin), before, "every ref on origin, tags included, is as it was");
  assert.ok(existsSync(d.receipt_path));
  assert.equal(existsSync(join(b.root, "store.log")), false);
  assert.equal(existsSync(join(b.root, "esc.log")), false);
});

test("a harm refusal comes back as a rehearsal that did not cross: ok false, status refused", { skip }, () => {
  const b = bottle({ harm: true });
  const { env } = inBottle(b);
  const d = runDryLeg({ tree: b.office, env });
  assert.equal(d.ran, true);
  assert.equal(d.ok, false);
  assert.equal(d.status, "refused");
  assert.match(d.detail, /HARM NAMED/);
  assert.ok(d.withheld.includes("escalation: harm"));
});

function fakeTree(script) {
  const tree = mkdtempSync(join(scratch, "fake-tree-"));
  if (script !== null) {
    mkdirSync(join(tree, "deploy"), { recursive: true });
    writeFileSync(join(tree, "deploy", "settlement-auto.sh"), script);
  }
  return tree;
}
const fakeEnv = (tree) => dryLegEnv({ tree, url: URL_, townRepo: "/nowhere", worldRepo: "/nowhere", dryDir: join(tree, "dry") });

test("no script, or one that predates the dry leg, is NOT a rehearsal — and nothing runs", () => {
  const none = fakeTree(null);
  assert.deepEqual(runDryLeg({ tree: none, env: fakeEnv(none) }), { ran: false, ok: false, reason: "the tree carries no deploy/settlement-auto.sh" });
  const old = fakeTree("#!/bin/sh\necho would publish\n");
  let spawned = false;
  const d = runDryLeg({ tree: old, env: fakeEnv(old), spawn: () => { spawned = true; return { status: 0 }; } });
  assert.equal(d.ran, false);
  assert.match(d.reason, /predates the dry leg/);
  assert.equal(spawned, false, "a script that cannot withhold is never started");
});

test("a receipt that does not say dry: true fails the rehearsal, whatever its status", { skip }, () => {
  const tree = fakeTree(`#!/bin/sh\n# SETTLEMENT_DRY ignored here\nprintf '{"status":"published","dry":false}' > "$SETTLEMENT_REPORT"\n`);
  const d = runDryLeg({ tree, env: fakeEnv(tree) });
  assert.equal(d.ran, true);
  assert.equal(d.ok, false);
  assert.match(d.reason, /does not say dry: true/);
});

test("the last rehearsal's receipt is never read as this one's", { skip }, () => {
  const tree = fakeTree("#!/bin/sh\n# SETTLEMENT_DRY\nexit 1\n");
  const env = fakeEnv(tree);
  mkdirSync(join(tree, "dry"), { recursive: true });
  writeFileSync(env.SETTLEMENT_REPORT, JSON.stringify({ status: "published", dry: true, withheld: [] }));
  const d = runDryLeg({ tree, env });
  assert.equal(d.ok, false);
  assert.equal(d.reason, "the crossing wrote no receipt");
});
