// arena-archive.test.mjs — the arena's rows, archived once (Keemin, 2026-09-30:
// the arena is closed, to be reimplemented later; nothing is ported).
//
//   the copy       every arena-act row, every column, in seq order, and NOTHING
//                  else from the journal; the header's count and hash match
//   read-only      the journal is byte-for-byte what it was before the copy
//   refusals       an --out that exists, a dynamic.db that is not there, and
//                  a bare call, each by name, and each writes no file

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { openDynamic } from "../src/dynamic-store.mjs";
import { readArchive } from "../tools/arena-archive.mjs";

const dir = mkdtempSync(join(tmpdir(), "arena-archive-"));
after(() => { try { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* litter */ } });
const TOOL = join(import.meta.dirname, "..", "tools", "arena-archive.mjs");

function storeWithFights(path) {
  const db = openDynamic(path);
  const ins = db.prepare(`INSERT INTO journal (crossing, actor, action, object, at_anchor, at_dx, at_dy, witnesses, class, payload, effect, household, written_at)
                          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  ins.run(215.5, "darko", "enter", "wright/the-candle-vault", "wright/the-candle-vault", 0.5, -1.25, null, "arena-act", JSON.stringify({ initiative: 14 }), "darko joins the wheel", "hh:keemin", "2026-08-29T23:00:00.000Z");
  ins.run(215.5, "the-cake", "strike", "darko", null, null, null, "[\"rei\"]", "arena-act", JSON.stringify({ kind: "hostile", z: 1, a: 2 }), null, null, "2026-08-29T23:00:05.000Z");
  ins.run(215.6, "rei", "say", null, null, null, null, null, "voice", "{}", null, null, "2026-08-29T23:00:06.000Z");   // not the arena's
  ins.run(215.6, "rei", "loot", "wright/the-candle", null, null, null, null, "arena-act", null, null, "hh:rei", "2026-08-29T23:10:00.000Z");
  db.close();
  return path;
}

const dump = (path) => { const db = new DatabaseSync(path, { readOnly: true }); try { return JSON.stringify(db.prepare("SELECT * FROM journal ORDER BY seq").all()); } finally { db.close(); } };

test("THE COPY: every arena-act row, every column, in seq order — and nothing else from the journal; the store is untouched", () => {
  const src = storeWithFights(join(dir, "fights.db"));
  const before = dump(src);
  const out = join(dir, "arena.jsonl");
  const said = execFileSync(process.execPath, [TOOL, "--db", src, "--out", out, "--json"], { encoding: "utf8" });
  const { header, rows } = readArchive(readFileSync(out, "utf8"));
  assert.equal(JSON.parse(said).rows_sha256, header.rows_sha256);
  assert.equal(header.archive, "arena");
  assert.equal(header.rows, 3);
  assert.deepEqual(rows.map((r) => [r.seq, r.actor, r.action]), [[1, "darko", "enter"], [2, "the-cake", "strike"], [4, "rei", "loot"]]);
  assert.deepEqual(Object.keys(rows[0]), ["seq", "crossing", "actor", "action", "object", "at_anchor", "at_dx", "at_dy", "witnesses", "class", "payload", "effect", "household", "written_at"]);
  assert.equal(rows[1].payload, JSON.stringify({ kind: "hostile", z: 1, a: 2 }), "the JSON columns stay the text they were written as");
  assert.equal(rows[0].at_dy, -1.25);
  assert.equal(dump(src), before, "the archive must not write the journal");
});

test("THE HASH HOLDS THE FILE: a row edited after the fact fails the read-back", () => {
  const src = storeWithFights(join(dir, "fights-2.db"));
  const out = join(dir, "arena-2.jsonl");
  execFileSync(process.execPath, [TOOL, "--db", src, "--out", out], { encoding: "utf8" });
  const text = readFileSync(out, "utf8").replace("\"the-cake\"", "\"the-pie\"");
  assert.throws(() => readArchive(text), /do not hash/);
});

test("REFUSALS: an existing --out, an absent dynamic.db, a bare call — by name, and no file is written", () => {
  const src = storeWithFights(join(dir, "fights-3.db"));
  const taken = join(dir, "taken.jsonl");
  writeFileSync(taken, "already here\n");
  const r1 = spawnSync(process.execPath, [TOOL, "--db", src, "--out", taken], { encoding: "utf8" });
  assert.equal(r1.status, 3);
  assert.match(r1.stderr, /already exists — an archive is written once/);
  assert.equal(readFileSync(taken, "utf8"), "already here\n", "an existing file must never be overwritten");

  const none = join(dir, "never.jsonl");
  const r2 = spawnSync(process.execPath, [TOOL, "--db", join(dir, "no-such.db"), "--out", none], { encoding: "utf8" });
  assert.equal(r2.status, 3);
  assert.match(r2.stderr, /no dynamic store at .* nothing was ever fought here/);
  assert.equal(existsSync(none), false);

  const r3 = spawnSync(process.execPath, [TOOL], { encoding: "utf8" });
  assert.equal(r3.status, 2);
  assert.match(r3.stderr, /usage: arena-archive\.mjs/);
});
