// town-index-reads.test.mjs — each door moved to the store answers exactly what
// it answered from office.db (POS-268's gate for a moved reader).
//
//   EMBEDDED_PG_DIR=<dir with embedded-postgres> node --test test/town-index-reads.test.mjs
//
// The store is seeded from the SAME office.db the old reader reads
// (helpers/index-to-store.mjs), so the only thing that can differ is the
// reader. Each door is asked a spread of questions, and each answer is compared
// whole (deepEqual) to its office.db twin's.
//
// The fixture is test/fixture.mjs's town plus the history rows the ports had to
// get right: tied commit times (sqlite breaks the tie by sha), mixed-case paths
// and authors (sqlite's LIKE folds ASCII case), a `%` and a `_` in a path (the
// escape), a backslash in an author (that LIKE has no escape), and a commit with
// more than 100 files (the cap and files_total). Without a Postgres the file
// SKIPS and says so.

import test, { after, before } from "node:test";
import assert from "node:assert/strict";

import { fixtureDb } from "./fixture.mjs";
import { startStore } from "./helpers/embedded-store.mjs";
import { copyIndexToStore } from "./helpers/index-to-store.mjs";
import * as office from "../src/queries.mjs";
import * as store from "../src/town-index-store.mjs";

let s = null, skip = false, api, db;

before(async () => {
  s = await startStore();
  if (s.skip) { skip = s.skip; return; }
  db = fixtureDb();
  const log = db.prepare("INSERT INTO repo_log VALUES (?,?,?,?,?,?)");
  // two commits at the same second: sqlite orders the tie by sha
  log.run("b2sha", "2026-07-20T10:00:00.000Z", "Postmark Pen", "ferry: 2 delivered", "A", "WHITE_PAGES/limen/inbox/a.md");
  log.run("a1sha", "2026-07-20T10:00:00.000Z", "Postmark Pen", "mint: crossing pass", "M", "WHITE_PAGES/stamp-ledger.md");
  // case, and the characters LIKE treats specially
  log.run("d4sha", "2026-07-21T09:00:00.000Z", "Keemin\\Lee", "odd path", "A", "PROJECTS/Build_The-Town/100%.md");
  log.run("d4sha", "2026-07-21T09:00:00.000Z", "Keemin\\Lee", "odd path", "A", "PROJECTS/BuildXThe-Town/other.md");
  // a commit over the 100-file cap, files inserted out of name order
  for (let i = 0; i < 103; i++)
    log.run("e5sha", "2026-07-22T12:00:00.000Z", "Postmark Pen", "seal: re-seal at the crossing", "M", `WHITE_PAGES/w${String((i * 37) % 103).padStart(3, "0")}/window.html`);
  // an id that sorts differently bytewise ("B" < "a") than in an English
  // collation ("a" < "B"): without COLLATE "C" the store's page order moves
  db.prepare("INSERT INTO regions VALUES (?, ?, ?)").run("B-side", "the B Side", JSON.stringify({
    id: "B-side", name: "the B Side", holder: "wright", body: "# B\n\nThe far bank.", images: [], residents: ["wright"] }));
  db.prepare("INSERT INTO regions VALUES (?, ?, ?)").run("a-quay", "the Low Quay", JSON.stringify({
    id: "a-quay", name: "the Low Quay", holder: "limen", body: "", images: [],
    residents: Array.from({ length: 30 }, (_, i) => `r${i}`) }));
  // the bulletin: date-led slugs, a human-gated notice, an upper-case slug that
  // sorts first bytewise and not in an English collation, and a posting with no
  // frontmatter at all (README's shape)
  const b = db.prepare("INSERT INTO bulletin VALUES (?, ?)");
  b.run("2026-07-20-the-quay-floods", JSON.stringify({ slug: "2026-07-20-the-quay-floods", data: { title: "The quay floods", posted: "2026-07-20", kind: "announcement", teaser: "Spring tide." }, body: "# The quay floods\n\nMind the steps." }));
  b.run("2026-07-21-a-human-please", JSON.stringify({ slug: "2026-07-21-a-human-please", data: { title: "A human, please", human_gated: "true" }, body: "Ask your human to look." }));
  b.run("README", JSON.stringify({ slug: "README", data: {}, body: "# The board\n\nWhat goes here." }));
  b.run("a-note", JSON.stringify({ slug: "a-note", data: { title: "A note" }, body: "Before README in English, after it bytewise." }));
  const w = await s.connect("law_ingester");
  await copyIndexToStore(w, db);
  await w.end();
  api = await s.connect("office_api");   // the doors' own role
});

after(async () => {
  if (api) await api.end().catch(() => {});
  if (s?.stop) await s.stop();
});

// Compared as the bytes a door sends (JSON.stringify), which also holds the key
// ORDER equal. deepEqual would not do: node:sqlite hands back null-prototype
// rows, so a deepEqual fails on a difference no door can ever send.
const same = async (label, oldAnswer, newAnswer) => assert.equal(JSON.stringify(await newAnswer), JSON.stringify(oldAnswer), label);

test("repoLog: every filter, page and cap answers as office.db does", async (t) => {
  if (skip) return t.skip(skip);
  const asks = [
    {}, { limit: 1 }, { limit: 2, offset: 1 }, { limit: 200 }, { offset: 3 }, { offset: 99 },
    { path: "WHITE_PAGES/" }, { path: "white_pages/wright" }, { path: "PROJECTS/Build_The" }, { path: "projects/build_the-town/100%" },
    { path: "WHITE_PAGES/w0" }, { author: "postmark" }, { author: "KEEMIN" }, { author: "keemin\\lee" }, { author: "%" },
    { since: "2026-07-12" }, { until: "2026-07-05" }, { since: "2026-07-05T08:30:00.000Z", until: "2026-07-20" },
    { since: "2026-07-20", limit: 1, offset: 1 }, { limit: "x" }, { limit: -4, offset: -1 },
  ];
  for (const a of asks) await same(`repoLog ${JSON.stringify(a)}`, office.repoLog(db, a), store.repoLog(api, a));
});

test("regionList and regionOne answer as office.db does", async (t) => {
  if (skip) return t.skip(skip);
  for (const a of [{}, { limit: 1 }, { limit: 1, offset: 1 }, { offset: 5 }, { limit: 500 }])
    await same(`regionList ${JSON.stringify(a)}`, office.regionList(db, a), store.regionList(api, a));
  for (const slug of ["the-terrace", "the Trueing Terrace", "a-quay", "the Low Quay", "nowhere", ""])
    await same(`regionOne ${slug}`, office.regionOne(db, slug), store.regionOne(api, slug));
});

test("bulletinList, bulletinTeaser and bulletinEntry answer as office.db does", async (t) => {
  if (skip) return t.skip(skip);
  await same("bulletinList", office.bulletinList(db), store.bulletinList(api));
  for (const a of [{}, { limit: 1 }, { limit: 2, offset: 1 }, { offset: 3 }, { limit: 0 }, { limit: "x", offset: -2 }])
    await same(`bulletinTeaser ${JSON.stringify(a)}`, office.bulletinTeaser(db, a), store.bulletinTeaser(api, a));
  for (const slug of ["settling-in", "2026-07-21-a-human-please", "README", "nope"])
    await same(`bulletinEntry ${slug}`, office.bulletinEntry(db, slug), store.bulletinEntry(api, slug));
});

test("home answers as office.db does, its freshness dated by the store's own as-of", async (t) => {
  if (skip) return t.skip(skip);
  for (const h of ["wright", "limen", "postmaster", "nobody"])
    await same(`home ${h}`, office.home(db, h), store.home(api, h));
  // A caller's asOf is the OTHER index's clock: the store's reader dates its row
  // by its own head, so a stray asOf changes nothing it answers.
  await same("home wright, a caller's asOf ignored", office.home(db, "wright"), store.home(api, "wright", { asOf: "someothersha" }));
});

test("the store's as-of is the index's own", async (t) => {
  if (skip) return t.skip(skip);
  assert.equal(await store.townIndexAsOf(api), office.indexAsOf(db));
});

test("the switch is on only for the exact word", () => {
  assert.equal(store.townIndexReads({ TOWN_INDEX_READS: "store" }), true);
  for (const v of [undefined, "", "1", "true", "STORE", "office"]) assert.equal(store.townIndexReads({ TOWN_INDEX_READS: v }), false, String(v));
});
