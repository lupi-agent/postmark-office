// g1-dev-proof.test.mjs — THE PROBE CAN FAIL, AND IT FAILS FOR THE RIGHT HALF.
//
// `tools/g1-dev-proof.mjs` is run by hand against the dev office, so nothing in
// the suite exercises it on the way past. A hand-run script with no test is the
// "a flip that patches nothing runs green" class: it would be discovered to be
// a no-op on the one night it was relied on.
//
// So a STUB OFFICE speaks the six routes the probe reads and writes, and each
// case moves exactly ONE thing:
//
//   · everything right, the journal frozen          → exit 0
//   · everything right, the journal ADVANCING       → exit 1 (the sqlite half)
//   · the journal frozen, a READER that lost the act→ exit 1 (the read-back half)
//   · the journal advancing, --expect-journal       → exit 0 (the pre-G1 run)
//
// The third case is the one that matters most: a probe that only ever watched
// the journal counter would pass an office whose doors had stopped reaching any
// reader at all, which is the failure this lane is about.
//
// POS-199 — EACH ACT IS READ BACK THROUGH THE READER THAT CAN SEE IT. The first
// dev run reddened the mark and say classes on green writes because the probe
// asked the wrong doors: `/world2/investigate` never shows a draft (007), and
// `/world2/say` reads emissions, never a live `say` act. The stub keeps BOTH of
// those doors, answering the way the real ones do (blind to a draft, blind to a
// fresh say), so a probe pointed back at either reddens here and not on dev.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const PROBE = join(HERE, "..", "tools", "g1-dev-proof.mjs");

/**
 * A stub office. `opts.journalPerWrite` is how far `journal_head` moves on each
 * write — 0 is the world after G1. `opts.blindReader` makes the store-backed
 * reads answer 200 with nothing of the act in them, which is the failure mode a
 * counter-only probe would sail past. `blindMarks` / `blindSay` blind ONE
 * reader, so a red can be pinned to the class and the door that lost it.
 * `draftWithheld` files the draft past the page bound, by id only, the way
 * `markPage` does for a household with more drafts than one page holds.
 */
function stubOffice({ journalPerWrite = 0, blindReader = false, blindMarks = false, blindSay = false, draftWithheld = false } = {}) {
  let head = 100, journal = 100, movements = 50;
  const spoken = [];
  const marks = [];
  const walkers = [];
  const hits = new Map();

  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    const send = (code, body) => {
      res.writeHead(code, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    const wrote = () => { head += journalPerWrite; journal += journalPerWrite; };
    hits.set(url.pathname, (hits.get(url.pathname) ?? 0) + 1);

    if (url.pathname === "/me") return send(200, { handles: ["probe"], households: { probe: "probe" } });
    if (url.pathname === "/world/orient") return send(200, { you: { x: 10, y: 20 } });
    if (url.pathname === "/world/dynamic") return send(200, { db: { journal, journal_head: head, movements } });

    if (url.pathname === "/world/marks" && req.method === "POST") {
      let raw = ""; req.on("data", (c) => { raw += c; });
      return req.on("end", () => { const b = JSON.parse(raw || "{}"); marks.push(b.slug); wrote(); send(200, { id: `probe/${b.slug}` }); });
    }
    if (url.pathname === "/world/walks" && req.method === "POST") {
      return req.on("data", () => {}).on("end", () => {
        walkers.push("probe"); wrote();
        send(200, { position: { x: 10, y: 20 }, movement: { record: "acts (Postgres)" }, log: "acts", seq: null });
      });
    }
    if (url.pathname === "/world/say" && req.method === "POST") {
      let raw = ""; req.on("data", (c) => { raw += c; });
      return req.on("end", () => { const b = JSON.parse(raw || "{}"); spoken.push(b.text); wrote(); send(200, { spoke: true }); });
    }

    // THE TWO WRONG DOORS, answering as the real ones do. `/world2/investigate`
    // never shows a draft (007's law) and `/world2/say` answers emissions only,
    // so neither ever carries what this probe writes.
    if (url.pathname === "/world2/investigate") return send(200, { mark: null });
    if (url.pathname === "/world2/say") return send(200, { total_in_the_air: 0, emissions: [] });

    // THE DRAFT'S LAWFUL READER: keyed, the household's own, `drafts[].id`.
    if (url.pathname === "/world2/my-marks") {
      if (!/^Bearer\s+\S/.test(req.headers.authorization ?? "")) return send(401, { error: "bounce", defect: "no key at the door" });
      const ids = blindReader || blindMarks ? [] : marks.map((s) => `probe/${s}`);
      const other = { id: "probe/an-older-draft", by: "probe" };
      return send(200, draftWithheld
        ? { household: "probe", drafts: [other], withheld: { drafts: ids }, complete: ids.length === 0 }
        : { household: "probe", drafts: [other, ...ids.map((id) => ({ id, by: "probe" }))], complete: true });
    }
    if (url.pathname === "/world2/walks") return send(200, blindReader ? { records: [] } : { records: walkers.map((h) => ({ handle: h })) });
    // THE SAY'S ACT READER: every voice, in a thread, as `{ handle, said }`.
    if (url.pathname === "/world2/conversations") {
      const voices = blindReader || blindSay ? [] : spoken.map((t) => ({ handle: "probe", said: t }));
      return send(200, { live: [{ id: "t1-probe", voices }], closed: [{ id: "t0-other", voices: [{ handle: "other", said: "an older line" }] }] });
    }
    if (url.pathname === "/world2/apex") return send(200, { at: { x: 10, y: 20 } });

    return send(404, { error: "no such door" });
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve({ server, hits, base: `http://127.0.0.1:${server.address().port}` }));
  });
}

/** Run the probe and hand back its exit code and its whole output. */
function runProbe(base, extra = []) {
  return new Promise((resolve) => {
    execFile(process.execPath, [PROBE, "--base", base, "--key-env", "G1_PROBE_KEY", ...extra],
      { env: { ...process.env, G1_PROBE_KEY: "test-key" }, encoding: "utf8" },
      (err, stdout, stderr) => resolve({ code: err ? (err.code ?? 1) : 0, out: `${stdout}${stderr}` }));
  });
}

const READERS = "readers: mark: /world2/my-marks, walk: /world2/walks, say: /world2/conversations";

test("GREEN ×3: the doors round-trip and the journal does not move", async () => {
  const { server, base } = await stubOffice({ journalPerWrite: 0 });
  try {
    const r = await runProbe(base);
    assert.equal(r.code, 0, `expected exit 0, got ${r.code}:\n${r.out}`);
    assert.match(r.out, /GREEN/);
    assert.match(r.out, /nothing was written to the sqlite journal/);
    assert.match(r.out, /the whole run moved journal_head by 0/);
    // EVERY CLASS, BY ITS READER — three PASS lines, not a green total.
    assert.match(r.out, /PASS mark \(draft\) via \/world2\/my-marks — \/world2\/my-marks holds the draft probe\/g1-dev-proof-/);
    assert.match(r.out, /PASS walk \(stand here\) via \/world2\/walks/);
    assert.match(r.out, /PASS say via \/world2\/conversations — \/world2\/conversations carries probe's line back/);
    assert.ok(r.out.includes(READERS), `the verdict line names each class's reader:\n${r.out}`);
  } finally { server.close(); }
});

test("POS-199: a draft INVISIBLE to /world2/investigate is a GREEN mark class — that door is never asked", async () => {
  // The stub's investigate door answers `{ mark: null }` for every draft, as
  // 007 makes the real one. The first dev run reddened exactly here.
  const { server, base, hits } = await stubOffice({ journalPerWrite: 0 });
  try {
    const r = await runProbe(base);
    assert.equal(r.code, 0, `expected exit 0, got ${r.code}:\n${r.out}`);
    assert.match(r.out, /PASS mark \(draft\) via \/world2\/my-marks/);
    assert.equal(hits.get("/world2/investigate") ?? 0, 0, "the draft read-back no longer asks /world2/investigate");
    assert.equal(hits.get("/world2/say") ?? 0, 0, "the say read-back no longer asks /world2/say");
    assert.equal(hits.get("/world2/my-marks"), 1, "the draft is read back through /world2/my-marks, once");
    assert.equal(hits.get("/world2/conversations"), 1, "the say is read back through /world2/conversations, once");
  } finally { server.close(); }
});

test("POS-199: a draft past the page bound, named only in withheld.drafts, is still found", async () => {
  const { server, base } = await stubOffice({ journalPerWrite: 0, draftWithheld: true });
  try {
    const r = await runProbe(base);
    assert.equal(r.code, 0, `expected exit 0, got ${r.code}:\n${r.out}`);
    assert.match(r.out, /PASS mark \(draft\) via \/world2\/my-marks/);
  } finally { server.close(); }
});

test("RED, the door named: a draft written but absent from /world2/my-marks", async () => {
  const { server, base } = await stubOffice({ journalPerWrite: 0, blindMarks: true });
  try {
    const r = await runProbe(base);
    assert.equal(r.code, 1, `expected exit 1, got ${r.code}:\n${r.out}`);
    assert.match(r.out, /FAIL mark \(draft\) via \/world2\/my-marks — the door took the draft and \/world2\/my-marks does not list probe\/g1-dev-proof-\d+ among the key's drafts/);
    // ONE class, not the run: the other two still read green.
    assert.match(r.out, /PASS walk \(stand here\)/);
    assert.match(r.out, /PASS say via/);
    assert.match(r.out, /RED — 1 class failed/);
    assert.ok(r.out.includes(READERS), `the red verdict line names each class's reader:\n${r.out}`);
  } finally { server.close(); }
});

test("RED, the door named: a say written but absent from /world2/conversations", async () => {
  const { server, base } = await stubOffice({ journalPerWrite: 0, blindSay: true });
  try {
    const r = await runProbe(base);
    assert.equal(r.code, 1, `expected exit 1, got ${r.code}:\n${r.out}`);
    assert.match(r.out, /FAIL say via \/world2\/conversations — the door took the say and \/world2\/conversations does not carry probe's line back/);
    assert.match(r.out, /PASS mark \(draft\)/);
    assert.match(r.out, /PASS walk \(stand here\)/);
    assert.match(r.out, /RED — 1 class failed/);
  } finally { server.close(); }
});

test("RED on the SQLITE half: every read-back is right and the journal still advances", async () => {
  const { server, base } = await stubOffice({ journalPerWrite: 1 });
  try {
    const r = await runProbe(base);
    assert.equal(r.code, 1, `expected exit 1, got ${r.code}:\n${r.out}`);
    assert.match(r.out, /RED/);
    // The failure names the half. A run that reddened without saying the
    // journal moved would send a reader looking at the doors.
    assert.match(r.out, /journal_head \+1/);
    assert.match(r.out, /the whole run moved journal_head by 3/);
  } finally { server.close(); }
});

test("RED on the READ-BACK half: the journal is frozen and no reader holds the act", async () => {
  const { server, base } = await stubOffice({ journalPerWrite: 0, blindReader: true });
  try {
    const r = await runProbe(base);
    assert.equal(r.code, 1, `expected exit 1, got ${r.code}:\n${r.out}`);
    assert.match(r.out, /RED/);
    // THE WHOLE POINT. The counter is perfect and the run is still red,
    // because the act reached nobody.
    assert.match(r.out, /the whole run moved journal_head by 0/);
    assert.match(r.out, /did not reach the reader|does not carry the line back/);
  } finally { server.close(); }
});

test("--expect-journal is the PRE-G1 run: an advancing journal is green, and the line says which expectation was held", async () => {
  const { server, base } = await stubOffice({ journalPerWrite: 1 });
  try {
    const r = await runProbe(base, ["--expect-journal"]);
    assert.equal(r.code, 0, `expected exit 0, got ${r.code}:\n${r.out}`);
    assert.match(r.out, /expectation: PRE-G1/);
    assert.match(r.out, /pre-G1 expectation: the journal still grew, as declared/);
  } finally { server.close(); }
});

test("a missing --base exits 2, never 0 — a probe that never ran may not read as a pass", async () => {
  const r = await new Promise((resolve) => {
    execFile(process.execPath, [PROBE], { encoding: "utf8" },
      (err, stdout, stderr) => resolve({ code: err ? (err.code ?? 1) : 0, out: `${stdout}${stderr}` }));
  });
  assert.equal(r.code, 2);
});
