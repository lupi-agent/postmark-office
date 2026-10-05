// harbor-gate.test.mjs — the arrival ladder's write gate (Keemin-ruled
// 2026-08-16): an unsettled household is read + ephemeral; durable acts are
// the settlement prize. Deactivation, not deletion — the flag test pins the
// reactivation switch as much as the gate.
//
//   node --test test/harbor-gate.test.mjs

import test from "node:test";
import { withRecordFrom } from "./registry-pool-stub.mjs";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { harborGated, HARBOR_ALLOWED, HARBOR_BOUNCE, harborWritesOpen } from "../src/harbor-gate.mjs";
import { SETTLING_ASHORE } from "../src/declare.mjs";
import { householdFor } from "../src/oauth.mjs";
import { indexStore } from "./helpers/office-under-test.mjs";
// The stamp test below writes its residents mid-test and asks householdFor's logic
// over exactly those rows, so it hands them through an explicit probe.
import { officeProbe } from "../src/index-probe.mjs";

const harborKey = { household: "newhuman", handles: new Set(["newcomer"]), harbor: true };
const settledKey = { household: "keeminlee", handles: new Set(["wright"]) };

// The doors below run in this process and read their town index from a store
// seeded from this fixture (POS-268, office-under-test.mjs).
const IX = await indexStore(null);
const IX_RESTORE = await IX.useInProcess();
test.after(async () => { await IX_RESTORE(); await IX.stop(); });

test("the gate: a harbor household is refused every durable verb, allowed the ephemeral + arrival ones", () => {
  for (const verb of ["send_letter", "world_leave_mark", "world_walk", "world_note", "world_stake",
    "world_unstake", "world_hold", "stake_vote", "upload_media",
    "update_address_body", "update_home", "update_profile", "update_window"])
    assert.ok(harborGated(harborKey, verb), `${verb} must gate`);
  for (const verb of HARBOR_ALLOWED)
    assert.ok(!harborGated(harborKey, verb), `${verb} must pass — the arrival lane and the quay voice stay open`);
});

test("the gate never touches settled households, visitors, or bare berths", () => {
  assert.ok(!harborGated(settledKey, "send_letter"));
  assert.ok(!harborGated({ visitor: true }, "send_letter"));
  assert.ok(!harborGated({ berth: true, slug: "x", household: null, handles: new Set() }, "send_letter"),
    "bare berths have their own honest bounces; the gate is the harbor tier's");
  assert.ok(!harborGated(null, "send_letter"));
});

test("REACTIVATION IS ONE ENV VAR: HARBOR_WRITES=1 opens every gated door", () => {
  const saved = process.env.HARBOR_WRITES;
  try {
    process.env.HARBOR_WRITES = "1";
    assert.ok(harborWritesOpen());
    assert.ok(!harborGated(harborKey, "send_letter"), "deactivation, not deletion");
  } finally {
    if (saved === undefined) delete process.env.HARBOR_WRITES; else process.env.HARBOR_WRITES = saved;
  }
});

// POS-70 row 38 (2026-09-24): the hint said settlement "arrives in boarded
// order through the Registrar", which stopped being true on 2026-09-21. It reads
// the one settlement clause now (declare.mjs § SETTLING_ASHORE).
test("the bounce names the whole truth: read, quay, the one settlement clause, no letter needed", () => {
  assert.equal(HARBOR_BOUNCE.code, 403);
  assert.match(HARBOR_BOUNCE.hint, /quay/);
  assert.ok(HARBOR_BOUNCE.hint.includes(SETTLING_ASHORE), "the hint reads the one settlement clause");
  assert.doesNotMatch(HARBOR_BOUNCE.hint, /write them a letter/, "harbor households cannot send letters — the hint must not ask for one");
});

test("householdFor stamps the tier from the residents index — and the stamp falls off at settlement", async () => {
  const dir = mkdtempSync(join(tmpdir(), "harborstamp-"));
  try {
    const clone = join(dir, "town");
    mkdirSync(join(clone, "tools"), { recursive: true });
    writeFileSync(join(clone, "tools", "github-ids.json"), JSON.stringify({
      "newcomer": { id: 555 },
      "wright": { id: 111 },
    }));
    const db = new DatabaseSync(":memory:");
    db.exec("CREATE TABLE residents (handle TEXT PRIMARY KEY, json TEXT)");
    db.prepare("INSERT INTO residents VALUES (?, ?)").run("wright", "{}");

    // the pins are the store's (POS-343), seeded from the same two documents
    await withRecordFrom(clone, async () => {
      const atHarbor = await householdFor(officeProbe(db), 555, "newhuman");
      assert.equal(atHarbor.harbor, true, "no handle in the index → the harbor stamp");
      const ashore = await householdFor(officeProbe(db), 111, "keeminlee");
      assert.equal(ashore.harbor, undefined, "a settled handle → no stamp, no gate");

      // settlement lands the newcomer ashore; the same lookup sheds the stamp
      db.prepare("INSERT INTO residents VALUES (?, ?)").run("newcomer", "{}");
      assert.equal((await householdFor(officeProbe(db), 555, "newhuman")).harbor, undefined);
    });
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
