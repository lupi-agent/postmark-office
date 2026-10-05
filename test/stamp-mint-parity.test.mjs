// stamp-mint-parity.test.mjs — THE RULED GATE ON THE LIVE LEDGER (POS-341, Q3).
//
//   node --test test/stamp-mint-parity.test.mjs
//
// Darko's ruling, 2026-10-04: before the mint reads its key base from the store,
// base(store) = base(file) for every handle, and a full replay is green with the
// store's inputs injected. This file runs world2/tools/stamp-mint-parity.mjs §
// parityOf on the office's pinned town-clone, the live ledger and mail ledger
// and pins, after filling a real Postgres the way the box fills it:
//
//   household_pins   the registry rows the drain prints tools/github-ids.json
//                    from (seeded from that print, which is byte-equal by
//                    registry-drain --check)
//   town_rooms,      written by the town-index ingest's own writer
//   town_mail_lines  (src/mint-inputs.mjs § writeMintInputs), as law_ingester
//   stamp_lines      recorded by the pen's own writer (src/stamp-lines.mjs §
//                    syncStampLinesVia), as office_api, every signature checked
//
// Then it shows the gate can fail: one pin missing from the store reds the base,
// and one delivery's `pays` dropped reds the deliveries.

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { startStore } from "./helpers/embedded-store.mjs";
import { rowsFromRegistry } from "../src/registry-rows.mjs";
import { mintInputsVia, writeMintInputs } from "../src/mint-inputs.mjs";
import { stampLinesVia, syncStampLinesVia, verifyStampLinesVia } from "../src/stamp-lines.mjs";
import { parityOf } from "../world2/tools/stamp-mint-parity.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CLONE = join(ROOT, "town-clone");
const hasClone = existsSync(join(CLONE, "tools", "stamp-mint.mjs")) && existsSync(join(CLONE, "WHITE_PAGES", "stamp-ledger.md"));
const skip = hasClone ? false : "no town-clone beside the office: the gate runs on the pinned clone's live ledger";

let store, owner, ingester, office, engine, report;
before(async () => {
  if (skip) return;
  engine = await import(pathToFileURL(join(CLONE, "tools", "stamp-mint.mjs")).href);
  store = await startStore({ db: "stamp_mint_parity" });
  owner = await store.connect("world2_owner");
  ingester = await store.connect("law_ingester");
  office = await store.connect("office_api");

  // household_pins, from the drain's own print of them
  const rows = rowsFromRegistry(JSON.parse(readFileSync(join(CLONE, "tools", "households.json"), "utf8")),
    JSON.parse(readFileSync(join(CLONE, "tools", "github-ids.json"), "utf8")));
  for (const p of rows.pins)
    await owner.query(`INSERT INTO household_pins (handle, login, gh_id, pinned, renamed, note, retired, renamed_to) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [p.handle, p.login ?? "", p.gh_id, p.pinned ?? null, p.renamed ?? null, p.note ?? null, p.retired ?? null, p.renamed_to ?? null]);

  await ingester.query("BEGIN");
  await writeMintInputs(ingester, CLONE);
  await ingester.query("COMMIT");

  await office.query("BEGIN");
  await syncStampLinesVia(office, CLONE, { engine });
  await office.query("COMMIT");

  report = parityOf(engine, CLONE, { ...(await mintInputsVia(office)), entries: await stampLinesVia(office) });
});
after(async () => {
  for (const c of [owner, ingester, office]) if (c) await c.end().catch(() => {});
  if (store?.stop) await store.stop();
});

test("THE GATE: base(store) = base(file) for every handle, the deliveries equal (pays included), the ledger equal, the replay green on both", (t) => {
  if (skip) return t.skip(skip);
  console.log(`# parity: base ${report.base.handles} handles, ${report.base.differ} differ · deliveries ${report.deliveries.store} (${report.deliveries.with_pays} with pays) · ledger ${report.ledger.store} lines · replay store ${report.replay.store.mints} mints, owed ${report.replay.store.owed}+${report.replay.store.owed_settlements}`);
  assert.deepEqual(report.base.diffs, [], "every handle keys the same from the store as from the file");
  assert.equal(report.base.store, report.base.file);
  assert.equal(report.deliveries.first_difference, null, "the store's mail lines read to the file's deliveries");
  assert.ok(report.deliveries.with_pays > 0, "the deliveries that carry pays are compared, pays and all");
  assert.equal(report.ledger.first_difference, null, "stamp_lines is the file, line for line");
  assert.deepEqual(report.replay.store.problems, [], "the replay on the store's inputs is green");
  assert.deepEqual(report.replay.file.problems, [], "the replay on the file's inputs is green");
  assert.equal(report.replay.same_owed, true, "both sides owe the same mints and settlements");
  assert.equal(report.ok, true);
});

test("the store's chain verifies on its own and is its export byte for byte", async (t) => {
  if (skip) return t.skip(skip);
  const v = await verifyStampLinesVia(office, CLONE, { engine });
  assert.deepEqual(v.problems, []);
  assert.equal(v.held, v.exported);
});

test("the gate can fail: a pin missing from the store reds the base; a delivery's pays dropped reds the deliveries", async (t) => {
  if (skip) return t.skip(skip);
  const inputs = await mintInputsVia(office);
  const entries = await stampLinesVia(office);
  // Every room on the live roll is pinned, so the store loses one pin: that
  // room then keys by its ADDRESS login or as solo, which the file does not.
  const handle = Object.keys(inputs.pins).find((h) => inputs.rooms.has(h) && inputs.pins[h]?.id);
  const pins = { ...inputs.pins }; delete pins[handle];
  const r1 = parityOf(engine, CLONE, { ...inputs, pins, entries });
  assert.equal(r1.ok, false);
  assert.ok(r1.base.diffs.some((d) => d.handle === handle), `${handle} is named as differing`);

  const i = inputs.mailLines.findIndex((l) => / · pays: \d+/.test(l));
  assert.ok(i >= 0, "a delivery with pays in the live mail ledger");
  const mailLines = inputs.mailLines.slice(); mailLines[i] = mailLines[i].replace(/ · pays: \d+/, "");
  const r2 = parityOf(engine, CLONE, { ...inputs, mailLines, entries });
  assert.equal(r2.ok, false);
  assert.ok(r2.deliveries.first_difference, "the dropped pays is the first difference");
});
