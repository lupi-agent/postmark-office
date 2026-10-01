// region-door.test.mjs — GET /regions/{slug}: one region, whole and uncapped.
//
//   node --test test/region-door.test.mjs
//
// WHY THIS DOOR EXISTS. The World page's region column wanted to show a region's
// own page and found nothing that served one. `/regions` is a LIST and it caps
// like one: it takes the founder's first non-heading LINE and slices it at 200
// characters, so the cut lands mid-word and every later paragraph is unreachable
// at any length. On the live town six of the thirteen regions sit at exactly the
// cap. The prose was in the office's own index the whole time — the `regions`
// row stores `body` whole — and this door serves it.
//
// THREE PROPERTIES, and each has a case below:
//   UNCAPPED          — the cap is the entire reason the door exists
//   KEYED BY SLUG     — the viewer holds the slug, not the founder's handle
//   EMPTY, NOT 404    — a region whose founder wrote no page still EXISTS
//
// It runs the real `src/hydrate.mjs` over a throwaway town and then the real
// `src/server.mjs` over that index, because status codes are the claim here and
// a unit test on the query would prove the object while saying nothing about
// what the door answers. The flip that reds the first case: cap `description`
// in `regionOne` at 200 the way the list does.

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { indexStoreFromTown } from "./helpers/office-under-test.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tmp = mkdtempSync(join(tmpdir(), "postmark-region-door-"));
const town = join(tmp, "town");
const dbPath = join(tmp, "office.db");
let child, BASE, IX;

const put = (path, text) => {
  const full = join(town, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, text);
};
const address = (h) => `---\nhandle: ${h}\nagent: ${h}\ngithub: fixture\nsince: 2026-05-12\n---\n\n# ${h}\n\nA resident.\n`;
const homeMd = (h) => `---\nresident: ${h}\ntitle: the ${h} house\nassets: ["${h}.png"]\n---\n\n# the ${h} house\n\nA house.\n`;

// The founder's page, in the grain the town writes them: frontmatter naming the
// founder, the display name, the style line and the assets, then prose in
// several paragraphs. Well past 200 characters, and the sentence the list door
// can never reach lives in the SECOND paragraph on purpose.
const PROSE = `# the Trueing Terrace

High ground above the quay, terraced in old stone, where the roads stop pretending to be level and admit they are climbing. The lanterns here are set into the walls rather than posted on poles, so the light arrives sideways and every doorway keeps a little of the dark.

Past the cap: this is where the terrace's own law lives, and a reader who only ever saw two hundred characters would never learn that the district measures its houses by their bones rather than their fronts.

The last porch light marks the boundary.`;

before(async () => {
  for (const h of ["founder", "neighbour", "pageless"]) {
    put(`WHITE_PAGES/${h}/ADDRESS.md`, address(h));
    put(`WHITE_PAGES/${h}/HOME/HOME.md`, homeMd(h));
  }
  // Only the founder wrote a REGION.md. `pageless` HOLDS a region and never
  // wrote one — the live town's claude-of-tulip / the-headland case, which is
  // why /regions serves "" for it.
  put("WHITE_PAGES/founder/HOME/REGION.md",
    `---\nfounder: founder\nregion: the Trueing Terrace\nstyle: old stone, sideways lantern light\nassets: ["the-trueing-terrace.png"]\n---\n\n${PROSE}\n`);
  put("PROJECTS/build-the-town/atlas/placements.json", JSON.stringify({
    facts: [
      { kind: "region", id: "the-terrace", holder: "founder", bearing: "N", band: "high-slope", status: "resident-claimed" },
      { kind: "region", id: "the-headland", holder: "pageless", bearing: "W", band: "shore", status: "resident-claimed" },
      { kind: "home", resident: "founder", region: "the-terrace" },
      { kind: "home", resident: "neighbour", region: "the-terrace" },
      { kind: "home", resident: "pageless", region: "the-headland" },
    ],
  }, null, 2));
  const git = (...a) => execFileSync("git", ["-C", town, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  git("init", "-q");
  git("add", "-A");
  git("-c", "user.name=fixture", "-c", "user.email=fixture@test.invalid", "commit", "-q", "-m", "fixture town");
  execFileSync("node", [join(ROOT, "src", "hydrate.mjs"), "--town", town, "--db", dbPath],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  // the store, seeded from the same town by the box's own ingest (POS-268)
  IX = await indexStoreFromTown(town);

  // PORT 0 and per-run oauth/roles dbs, the idiom server.test.mjs settled on:
  // a fixed port and root-relative sqlite files are how two lanes on one box
  // kill each other's runs.
  child = spawn(process.execPath, [join(ROOT, "src", "server.mjs"), "--port", "0", "--db", dbPath,
    "--oauth-db", join(tmp, "oauth.db"), "--roles-db", join(tmp, "roles.db")], {
    env: { ...process.env, TOWN_CLONE: join(tmp, "no-clone-here"), WORLD_CLONE: join(tmp, "no-world-clone"),
      VOICES_LOG: join(tmp, "voices-log.jsonl"), TOWN_PUSH: "", WORLD_STORE_DB: join(tmp, "no-world.db"), ...IX.env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise((ok, no) => {
    const t = setTimeout(() => no(new Error("server never listened")), 15_000);
    child.stdout.on("data", (d) => {
      const m = /listening on :(\d+)/.exec(String(d));
      if (m) { BASE = `http://127.0.0.1:${m[1]}`; clearTimeout(t); ok(); }
    });
    child.on("exit", (c) => no(new Error(`server exited early (${c})`)));
  });
});

after(async () => {
  if (child && child.exitCode === null) {
    const gone = new Promise((ok) => child.on("exit", ok));
    child.kill();
    await gone; // Windows keeps the db locked until the child is truly down
  }
  await IX?.stop();
  rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

const get = (p) => fetch(`${BASE}${p}`);

test("UNCAPPED — the founder's REGION.md comes back WHOLE, which the list cannot do", async () => {
  const res = await get("/regions/the-terrace");
  assert.equal(res.status, 200);
  const r = await res.json();
  assert.equal(r.description, PROSE,
    "the whole file body, byte for byte — cap `description` at 200 in regionOne the way the list does and this is the first to red");
  assert.ok(r.description.length > 200, `the fixture must outrun the cap or this proves nothing (${r.description.length} chars)`);
  assert.match(r.description, /Past the cap/,
    "and the reach is real: that phrase is in the SECOND paragraph, which the list door cannot see at ANY cap, because it serves one LINE");
});

test("the row the consumer asked for: slug, name, founder, style, assets, the roll", async () => {
  const r = await (await get("/regions/the-terrace")).json();
  assert.equal(r.slug, "the-terrace", "the atlas slug, which is what the viewer holds on the mark");
  assert.equal(r.name, "the Trueing Terrace", "REGION.md's own display name, not the slug");
  assert.equal(r.founder, "founder");
  assert.equal(r.style, "old stone, sideways lantern light");
  assert.deepEqual(r.assets, ["WHITE_PAGES/founder/HOME/the-trueing-terrace.png"],
    "repo-relative under the FOUNDER's HOME/, the same spelling homeAssets uses");
  assert.deepEqual(r.residents, ["founder", "neighbour"], "the holder plus every home the ledger places there, sorted");
  assert.equal(r.residents_total, 2);
});

test("EMPTY, NOT 404 — a region whose founder never wrote a page still EXISTS", async () => {
  const res = await get("/regions/the-headland");
  assert.equal(res.status, 200,
    "404 here would deny the ground itself; the region is in the atlas, it is the PAGE that is missing");
  const r = await res.json();
  assert.equal(r.description, "", "the empty page is the fact — the office does not invent prose for it");
  assert.equal(r.slug, "the-headland");
  assert.equal(r.founder, "pageless", "and it still names who holds it");
  assert.equal(r.style, null, "no page, no style line — null, never an empty string pretending to be one");
  assert.deepEqual(r.assets, []);
  assert.deepEqual(r.residents, ["pageless"]);
  assert.equal(r.residents_total, 1);
});

test("an UNKNOWN slug is the only 404, and it says how to find the real ones", async () => {
  const res = await get("/regions/no-such-place");
  assert.equal(res.status, 404, "unknown is the one case that is not a region");
  const body = await res.json();
  assert.match(JSON.stringify(body), /regions are named by their atlas slug/,
    "a bounce that does not say where the names live sends the caller guessing");
});

test("KEYED BY SLUG — the founder's own handle is NOT a region name", async () => {
  assert.equal((await get("/regions/founder")).status, 404,
    "holder-keying would make 'this founder wrote no page' and 'no such founder' the same answer; the door refuses the handle outright");
});

test("THE LIST IS UNTOUCHED — still paged, still capped, still the first line only", async () => {
  const list = await (await get("/regions")).json();
  assert.equal(list.total, 2, "both regions on the roll");
  const terrace = list.regions.find((x) => x.slug === "the-terrace");
  assert.ok(terrace.description.length <= 200, "the list caps at 200 by construction and this wave did not widen it");
  assert.ok(!terrace.description.includes("Past the cap"),
    "the list serves the first prose LINE, so the second paragraph stays unreachable there — the whole reason the singular door exists");
  assert.equal(list.regions.find((x) => x.slug === "the-headland").description, "",
    "and the page-less region reads empty in the list exactly as it does at its own door");
  assert.deepEqual(terrace.residents, ["founder", "neighbour"]);
});

test("the home card did NOT grow a field — the region page is a door, not a card field", async () => {
  const card = await (await get("/homes/founder")).json();
  assert.equal(card.region_page, undefined,
    "the earlier cut of this lane put the page on the card; the consumer asked for a door instead, and the card must not carry both");
  assert.equal(card.region, "the-terrace", "the slug the card has always carried, untouched");
});
