// town-index-ingest.test.mjs — the town index in the store (POS-268), held to
// office.db on a real Postgres.
//
//   EMBEDDED_PG_DIR=<dir with embedded-postgres> node --test test/town-index-ingest.test.mjs
//
// THE LAW UNDER TEST (Keemin 2026-09-27, POS-277): a snapshot per clearing, and
// only the delta computed live. Its falsifier is the one POS-277 names: the
// snapshot plus the delta equals the full derivation. So a throwaway town is
// SEEDED at its first commit, carried across a crossing (ingested at the seal
// with --snapshot), then carried to a later commit as a plain delta, and every
// table in the store must then equal what src/hydrate.mjs writes into office.db
// at that same commit.
//
// The town's own tools (stamp-mint, mail-state, quest-progress and what they
// read) are copied from the office's pinned town-clone, and the stamp ledger is
// that clone's ledger CUT at a line: a prefix of an append-only ledger never
// changes, so the fixture cannot decay with the next crossing. Without the clone
// or without a Postgres the file SKIPS and says which.

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

import { startStore } from "./helpers/embedded-store.mjs";
import { ingest, readHead, SEAL_SUBJECT } from "../world2/tools/town-index-ingest.mjs";
import { TOWN_TABLES } from "../src/town-index.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CLONE = join(ROOT, "town-clone");
const hasClone = existsSync(join(CLONE, "tools", "stamp-mint.mjs")) && existsSync(join(CLONE, "WHITE_PAGES", "stamp-ledger.md"));

const tmp = mkdtempSync(join(tmpdir(), "town-index-ingest-"));
const town = join(tmp, "town");
let store = null, skip = hasClone ? false : "no town-clone with tools/stamp-mint.mjs beside the office: the fixture copies the town's own tools from it";
let c;

const put = (p, text) => { mkdirSync(dirname(join(town, p)), { recursive: true }); writeFileSync(join(town, p), text); };
const git = (...a) => execFileSync("git", ["-C", town, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const commit = (msg) => { git("add", "-A"); git("-c", "user.name=Postmark Pen", "-c", "user.email=pen@test.invalid", "commit", "-q", "--allow-empty", "-m", msg); return git("rev-parse", "HEAD").trim(); };
const address = (h) => `---\nhandle: ${h}\nagent: ${h}\ngithub: fixture\nsince: 2026-05-12\n---\n\n# ${h}\n`;
const home = (h) => `---\nresident: ${h}\ntitle: the ${h} house\n---\n\n# the ${h} house\n`;
const letter = (id, from, to, date, thread = null) =>
  `---\nid: ${id}\nfrom: ${from}\nto: ${to}\ndate: ${date}\n${thread ? `thread: ${thread}\n` : ""}---\n\n# ${id}\n\nA sentence.\n`;
const LEDGER_HEAD = "# Mail ledger\n\nAppend-only record of every delivery **and every bounce**.\n\n";
const stampLines = hasClone ? readFileSync(join(CLONE, "WHITE_PAGES", "stamp-ledger.md"), "utf8").split("\n") : [];
const stampLedgerTo = (n) => stampLines.slice(0, n).join("\n") + "\n";

const sha = {};
before(async () => {
  if (skip) return;
  store = await startStore();
  if (store.skip) { skip = store.skip; return; }
  c = await store.connect("law_ingester");

  cpSync(join(CLONE, "tools"), join(town, "tools"), { recursive: true });
  cpSync(join(CLONE, "quest-registry.json"), join(town, "quest-registry.json"));
  for (const h of ["ada", "bex", "cyd"]) { put(`WHITE_PAGES/${h}/ADDRESS.md`, address(h)); put(`WHITE_PAGES/${h}/HOME/HOME.md`, home(h)); }
  put("WHITE_PAGES/_archived/README.md", "a shelf, not a resident\n");
  put("PROJECTS/build-the-town/atlas/placements.json", JSON.stringify({ facts: [
    { kind: "region", id: "the-quay", holder: "ada", bearing: "S", band: "shore", status: "resident-claimed" },
    { kind: "home", resident: "ada", region: "the-quay" }, { kind: "home", resident: "bex", region: "the-quay" },
  ] }, null, 2));
  put("TOWN_BULLETIN/welcome.md", "---\ntitle: welcome\n---\n\nHello.\n");
  put("WHITE_PAGES/ada/inbox/bex-2026-09-01-to-ada-first.md", letter("bex-2026-09-01-to-ada-first", "bex", "ada", "2026-09-01"));
  put("WHITE_PAGES/mail-ledger.md", LEDGER_HEAD + "- 2026-09-01 · bex-2026-09-01-to-ada-first · bex → ada · thread: new\n");
  put("WHITE_PAGES/stamp-ledger.md", stampLedgerTo(60));
  put("PROJECTS/the-town-seal/seal.json", "{\"seal\":\"founding\"}\n");
  git("init", "-q");
  git("config", "core.autocrlf", "false");
  sha.seed = commit("the town at its seed");

  // between crossings: a reply goes into ada's outbox, the bulletin grows
  put("WHITE_PAGES/ada/outbox/ada-2026-09-02-to-bex-reply.md", letter("ada-2026-09-02-to-bex-reply", "ada", "bex", "2026-09-02", "bex-2026-09-01-to-ada-first"));
  put("TOWN_BULLETIN/notice.md", "---\ntitle: notice\n---\n\nThe quay floods at spring tide.\n");
  commit("ada -> bex: reply (via postmark-office)");

  // the crossing: the ferry moves the reply to bex's inbox and writes the
  // ledger; the mint appends; the seal closes it
  mkdirSync(join(town, "WHITE_PAGES/bex/inbox"), { recursive: true });
  renameSync(join(town, "WHITE_PAGES/ada/outbox/ada-2026-09-02-to-bex-reply.md"), join(town, "WHITE_PAGES/bex/inbox/ada-2026-09-02-to-bex-reply.md"));
  put("WHITE_PAGES/mail-ledger.md", LEDGER_HEAD + "- 2026-09-01 · bex-2026-09-01-to-ada-first · bex → ada · thread: new\n" +
    "- 2026-09-02 · ada-2026-09-02-to-bex-reply · ada → bex · thread: bex-2026-09-01-to-ada-first\n");
  commit("ferry: 1 delivered, 0 bounced (2026-09-02)");
  put("WHITE_PAGES/stamp-ledger.md", stampLedgerTo(90));
  commit("mint: crossing pass");
  put("PROJECTS/the-town-seal/seal.json", "{\"seal\":\"after the crossing\"}\n");
  sha.seal = commit(SEAL_SUBJECT);

  // after the crossing: a new resident arrives with no mail, a home is edited
  put("WHITE_PAGES/dee/ADDRESS.md", address("dee"));
  put("WHITE_PAGES/bex/HOME/HOME.md", home("bex").replace("the bex house", "the bex boathouse"));
  sha.after = commit("dee: joined; bex: home retitled");
});

after(async () => {
  if (c) await c.end().catch(() => {});
  if (store?.stop) await store.stop();
  rmSync(tmp, { recursive: true, force: true });
});

const at = (s) => git("checkout", "-q", "--detach", s);
const writesOf = (out) => Object.fromEntries(Object.entries(out.tally).filter(([, t]) => t.inserted || t.deleted));

/** Every table: the store's rows (without `digest`) against office.db's, as sorted multisets. */
async function assertEqualToHydrate(label) {
  const dbPath = join(tmp, `office-${label}.db`);
  execFileSync(process.execPath, [join(ROOT, "src", "hydrate.mjs"), "--town", town, "--db", dbPath], { stdio: "ignore" });
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    for (const [name, { cols }] of Object.entries(TOWN_TABLES)) {
      const norm = (rows) => rows.map((r) => JSON.stringify(cols.map((k) => r[k] ?? null))).sort();
      const office = norm(db.prepare(`SELECT ${cols.join(", ")} FROM ${name}`).all());
      const stored = norm((await c.query(`SELECT ${cols.join(", ")} FROM town_${name}`)).rows);
      assert.deepEqual(stored, office, `${label}: town_${name} differs from office.db's ${name}`);
    }
  } finally { db.close(); }
}

test("seed, then the crossing as a snapshot, then a delta: every table equals hydrate.mjs at the same commit", async (t) => {
  if (skip) return t.skip(skip);
  at(sha.seed);
  await ingest(c, { townRepo: town, sha: sha.seed, seed: true });
  await assertEqualToHydrate("seed");

  at(sha.seal);
  const crossing = await ingest(c, { townRepo: town, sha: sha.seal, snapshot: true });
  assert.ok(crossing.tally.stamps.inserted > 0, "the mint pass's lines were folded in (added to the seed's fold, not refolded)");
  await assertEqualToHydrate("crossing");

  at(sha.after);
  await ingest(c, { townRepo: town, sha: sha.after });
  await assertEqualToHydrate("after");

  const snaps = (await c.query("SELECT sha, kind FROM town_index_snapshots ORDER BY ingested_at")).rows;
  assert.deepEqual(snaps.map((r) => [r.kind, r.sha]), [["seed", sha.seed], ["crossing", sha.seal]], "the seed and the crossing's seal are recorded; a plain delta is not a snapshot");
  assert.equal(await readHead(c), sha.after);
});

test("a delta writes only what moved: one bulletin edit writes the bulletin row, the head's meta and its history rows, nothing else", async (t) => {
  if (skip) return t.skip(skip);
  at(sha.after);
  put("TOWN_BULLETIN/notice.md", "---\ntitle: notice\n---\n\nThe quay floods at every tide now.\n");
  const edit = commit("bulletin: the notice, corrected");
  const out = await ingest(c, { townRepo: town, sha: edit });
  assert.deepEqual(writesOf(out), {
    repo_log: { inserted: 1, deleted: 0 },    // one commit x one file: the delta's history, not the town's
    bulletin: { inserted: 1, deleted: 1 },    // the one row, replaced
    meta: { inserted: 1, deleted: 1 },        // as_of
  });
  await assertEqualToHydrate("edit");
});

test("a restart reads the snapshot: a second ingest at the head writes nothing", async (t) => {
  if (skip) return t.skip(skip);
  const head = await readHead(c);
  at(head);
  const out = await ingest(c, { townRepo: town, sha: head });
  assert.deepEqual(writesOf(out), {}, "nothing to write");
});

test("the ingest refuses what it cannot apply, and writes nothing", async (t) => {
  if (skip) return t.skip(skip);
  const head = await readHead(c);
  const count = async () => (await c.query("SELECT count(*)::int n FROM town_repo_log")).rows[0].n;
  const before = await count();

  // a crossing's snapshot at a commit that is not a seal
  at(head);
  put("TOWN_BULLETIN/welcome.md", "---\ntitle: welcome\n---\n\nHello again.\n");
  const notSeal = commit("bulletin: welcome, warmer");
  await assert.rejects(ingest(c, { townRepo: town, sha: notSeal, snapshot: true }), /is not a crossing's seal/);
  assert.equal(await readHead(c), head, "the head did not move");
  assert.equal(await count(), before, "the rollback took the history rows with it");

  // a ledger whose past changed: the FIRST line's date, which a last-line
  // check would never see (the grammar reads `thread: new` as no thread, so a
  // dropped `thread: new` would be no change at all)
  put("WHITE_PAGES/mail-ledger.md", LEDGER_HEAD + "- 2026-08-31 · bex-2026-09-01-to-ada-first · bex → ada · thread: new\n" +
    "- 2026-09-02 · ada-2026-09-02-to-bex-reply · ada → bex · thread: bex-2026-09-01-to-ada-first\n");
  const rewritten = commit("mail ledger: a line edited in place");
  await assert.rejects(ingest(c, { townRepo: town, sha: rewritten }), /append-only by town law/);
  assert.equal(await readHead(c), head);

  // a seed over a head
  await assert.rejects(ingest(c, { townRepo: town, sha: rewritten, seed: true }), /already has a head/);
});
