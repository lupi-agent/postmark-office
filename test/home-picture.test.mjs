// home-picture.test.mjs — each resident's house picture, kept on their household's record (POS-219).
//
// Keemin, 2026-09-27/28: the picture lives on the HOUSEHOLD RECORD, one per
// resident's home (`households.home_images`, migration 050), and the map and
// the site read it there. These prove the one writer, the render the drain
// commits, the column's one-writer guard, the MCP act's split, the office's
// two reads, and the carry — against the real 2026-09-22 registry, where
// Marigold House's `mari` shares the `starforge` household with `rei` and
// `wright`, and `fox-hearth` holds three residents who each keep a parcel.
//
//   node --test test/home-picture.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { rowsFromRegistry, renderRegistry, registryFromRows, homePictureIn } from "../src/registry-rows.mjs";
import { setHomeImage, upsertHousehold, loadRegistry } from "../src/registry-store.mjs";
import { setHomePicture } from "../src/home-picture.mjs";
import { updateHomeAct } from "../src/edit.mjs";
import { readHomePicture, composeHome } from "../src/paper-fresh.mjs";
import { REGISTRY_PATH, PINS_PATH } from "../src/residency.mjs";
import { __setPoolForTest } from "../src/world2-acts.mjs";
import { makePool, RECORD_ON } from "./registry-pool-stub.mjs";
import { leadPicture, carryHomePictures } from "../tools/home-picture-carry.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = join(HERE, "fixtures", "registry-2026-09-22");
const HOUSEHOLDS_RAW = readFileSync(join(FIX, "households.json"), "utf8");
const PINS_RAW = readFileSync(join(FIX, "github-ids.json"), "utf8");
const seed = () => rowsFromRegistry(JSON.parse(HOUSEHOLDS_RAW), JSON.parse(PINS_RAW));

const MARIGOLD = "https://media.postmark.town/media/keeminlee/c218583a550b5487f700fbf374eb49d1505591c5c7d620dfbae208943af579d3.jpg";
const MARGIN = "https://media.postmark.town/media/corwin/aa11.png";
const LEVEL = "https://media.postmark.town/media/ellery/bb22.png";
const key = (...handles) => ({ household: "keeminlee", handles: new Set(handles) });

const dirs = [];
test.after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true, maxRetries: 5 }); });
function cloneWithRegistry() {
  const dir = mkdtempSync(join(tmpdir(), "pos219-"));
  dirs.push(dir);
  mkdirSync(join(dir, "tools"), { recursive: true });
  writeFileSync(join(dir, REGISTRY_PATH), HOUSEHOLDS_RAW);
  writeFileSync(join(dir, PINS_PATH), PINS_RAW);
  return dir;
}

/** Run `fn` with the office pointed at an in-memory store seeded from the real registry. */
async function withStore(fn, pool = makePool(seed())) {
  __setPoolForTest(pool);
  const was = { pg: process.env.WORLD2_PG, url: process.env.WORLD2_PG_URL };
  Object.assign(process.env, RECORD_ON);
  try { return await fn(pool); }
  finally {
    __setPoolForTest(null);
    if (was.pg === undefined) delete process.env.WORLD2_PG; else process.env.WORLD2_PG = was.pg;
    if (was.url === undefined) delete process.env.WORLD2_PG_URL; else process.env.WORLD2_PG_URL = was.url;
  }
}
// The drain's commit, recorded rather than performed: these prove what is
// rendered; the pen's own landing is test/pen-transaction.test.mjs's.
const recordingDrain = (commits) => async (opts) => {
  const { drainRegistry } = await import("../tools/registry-drain.mjs");
  return drainRegistry({ ...opts, commit: (clone, paths, msg) => { commits.push(msg); return "c0ffee"; } });
};

// ── the render ──────────────────────────────────────────────────────────────

test("the real registry still renders byte-equal: an empty picture map is no key at all", () => {
  const rows = seed();
  assert.ok(rows.households.every((r) => typeof r.home_images === "object" && Object.keys(r.home_images).length === 0),
    "every house folds to the column's own {} default");
  assert.equal(renderRegistry(rows).households, HOUSEHOLDS_RAW);
});

test("a kept picture renders on its own house only, handles sorted, and folds back to the same rows", () => {
  const rows = seed();
  const fox = rows.households.find((r) => r.slug === "fox-hearth");
  // jsonb hands keys back by (length, bytes): "ellery" before "corwin" would be
  // the store's order for these two if they were the same length; the render
  // must not depend on it either way.
  fox.home_images = { ellery: LEVEL, corwin: MARGIN };
  const text = renderRegistry(rows).households;
  const parsed = JSON.parse(text);
  assert.deepEqual(Object.keys(parsed.households["fox-hearth"].home_images), ["corwin", "ellery"]);
  assert.equal(parsed.households.starforge.home_images, undefined, "no other house grows the key");
  const before = HOUSEHOLDS_RAW.split("\n"), after = text.split("\n");
  assert.equal(after.length - before.length, 4, "exactly the key, its two entries and the closing brace");
  assert.equal(renderRegistry(rowsFromRegistry(parsed, JSON.parse(PINS_RAW))).households, text, "the round trip holds with a picture in it");
});

test("homePictureIn: a picture is its resident's, never the household's, and only while they live there", () => {
  const reg = registryFromRows(seed());
  reg.households.starforge.home_images = { mari: MARIGOLD, stranger: MARGIN };
  assert.equal(homePictureIn(reg, "mari"), MARIGOLD, "Marigold House's picture is mari's");
  assert.equal(homePictureIn(reg, "rei"), null, "rei shares the household and keeps her own (none yet), not mari's");
  assert.equal(homePictureIn(reg, "stranger"), null, "a handle this house does not hold reads as none");
  assert.equal(homePictureIn(null, "mari"), null);
});

// ── the one writer ──────────────────────────────────────────────────────────

test("Marigold House: a picture kept for mari lands on starforge's row as mari's, and the drain renders it in the same act", async () => {
  const clone = cloneWithRegistry();
  const commits = [];
  await withStore(async (pool) => {
    const r = await setHomePicture({ handle: "mari", url: MARIGOLD }, key("mari"), { clone, drain: recordingDrain(commits) });
    assert.equal(r.household, "starforge");
    assert.equal(r.picture, MARIGOLD);
    assert.deepEqual(r.registry, { rendered: true });
    assert.deepEqual(pool.state.households.find((h) => h.slug === "starforge").home_images, { mari: MARIGOLD });
    const file = JSON.parse(readFileSync(join(clone, REGISTRY_PATH), "utf8"));
    assert.deepEqual(file.households.starforge.home_images, { mari: MARIGOLD }, "the town's file carries it, no hanging needed");
    assert.equal(homePictureIn(file, "mari"), MARIGOLD);
    assert.equal(homePictureIn(file, "rei"), null);
    assert.equal(commits.length, 1);
    assert.match(commits[0], /mari: house picture kept on starforge's record \(POS-219\)/);
  });
});

test("two residents of one household keep two pictures; a new picture replaces only its own", async () => {
  const clone = cloneWithRegistry();
  await withStore(async (pool) => {
    const k = key("corwin", "ellery");
    await setHomePicture({ handle: "corwin", url: MARGIN }, k, { clone, drain: recordingDrain([]) });
    await setHomePicture({ handle: "ellery", url: LEVEL }, k, { clone, drain: recordingDrain([]) });
    const again = "https://media.postmark.town/media/corwin/cc33.png";
    await setHomePicture({ handle: "corwin", url: again }, k, { clone, drain: recordingDrain([]) });
    assert.deepEqual(pool.state.households.find((h) => h.slug === "fox-hearth").home_images, { corwin: again, ellery: LEVEL });
  });
});

test("the writer refuses what is not its to keep, and writes nothing when it refuses", async () => {
  const clone = cloneWithRegistry();
  await withStore(async (pool) => {
    const code = async (fn) => { try { await fn(); } catch (e) { return e.code; } return "no refusal"; };
    const drain = recordingDrain([]);
    assert.equal(await code(() => setHomePicture({ handle: "mari", url: MARIGOLD }, key("rei"), { clone, drain })), 403, "not one of the key's residents");
    assert.equal(await code(() => setHomePicture({ handle: "mari", url: "https://evil.example/x.jpg" }, key("mari"), { clone, drain })), 422, "another host");
    assert.equal(await code(() => setHomePicture({ handle: "mari", url: "WHITE_PAGES/mari/HOME/x.jpg" }, key("mari"), { clone, drain })), 422, "a repo path is not a picture any more");
    assert.equal(await code(() => setHomePicture({ handle: "nobody-lives-here", url: MARIGOLD }, key("nobody-lives-here"), { clone, drain })), 404, "a handle no household holds");
    assert.ok(pool.state.households.every((h) => Object.keys(h.home_images ?? {}).length === 0), "no row was written");
  });
  const off = await (async () => { try { await setHomePicture({ handle: "mari", url: MARIGOLD }, key("mari"), { clone }); } catch (e) { return e.code; } })();
  assert.equal(off, 409, "an office not pointed at the record keeps nothing and says so");
});

test("ONE WRITER: a ceremony's upsert of a house never names home_images, so it can never reset a picture", async () => {
  const seen = [];
  const pool = makePool(seed());
  const spy = { state: pool.state, query: (text, params) => { seen.push(text); return pool.query(text, params); } };
  await withStore(async () => {
    assert.deepEqual(await setHomeImage({ handle: "mari", url: MARIGOLD }), { slug: "starforge" });
    const row = { ...pool.state.households.find((h) => h.slug === "starforge") };
    delete row.home_images; // a ceremony rebuilding the row from what it knew
    await upsertHousehold(row);
    const upsert = seen.find((t) => /INSERT INTO households \(slug/.test(t));
    assert.ok(upsert, "the upsert ran");
    assert.doesNotMatch(upsert, /home_images/, "the upsert's columns do not include the picture map");
    assert.deepEqual((await loadRegistry()).households.starforge.home_images, { mari: MARIGOLD }, "the picture survives the ceremony");
  }, spy);
});

// ── the MCP act ─────────────────────────────────────────────────────────────

test("the home act splits the picture off: image alone writes no paper; a bad URL refuses before any paper lands", async () => {
  const kept = [];
  const keep = async (args) => { kept.push(args); return { picture: args.url, household: "starforge" }; };
  const r = await updateHomeAct({ handle: "mari", image: MARIGOLD }, key("mari"), null, "/no/clone/needed", null, { keep });
  assert.deepEqual(kept, [{ handle: "mari", url: MARIGOLD }]);
  assert.deepEqual(r, { updated: "mari", picture: { picture: MARIGOLD, household: "starforge" } });
  let e = null;
  try { await updateHomeAct({ handle: "mari", image: "https://evil.example/x.jpg", body: "prose" }, key("mari"), null, "/no/clone", null, { keep }); }
  catch (x) { e = x; }
  assert.equal(e?.code, 422);
  assert.match(e.hint, /nothing was written/);
  assert.equal(kept.length, 1, "the refused call kept nothing");
  e = null;
  try { await updateHomeAct({ handle: "mari", image: MARIGOLD }, key("rei"), null, "/no/clone", null, { keep }); } catch (x) { e = x; }
  assert.equal(e?.code, 403, "scope binds it like every edit verb");
});

// ── the office's reads (R5, R6) ─────────────────────────────────────────────

test("the home read and the card read the picture off the clone's registry the moment the drain has rendered it", () => {
  const clone = cloneWithRegistry();
  assert.equal(readHomePicture(clone, "mari"), null);
  const reg = JSON.parse(HOUSEHOLDS_RAW);
  reg.households.starforge.home_images = { mari: MARIGOLD };
  writeFileSync(join(clone, REGISTRY_PATH), JSON.stringify(reg));
  assert.equal(readHomePicture(clone, "mari"), MARIGOLD);
  assert.equal(readHomePicture(clone, "rei"), null);
  const row = composeHome({ handle: "mari", title: "The Marigold House", description: "", images: [], picture: null }, { clone, handle: "mari", pending: new Map(), asOf: null });
  assert.equal(row.picture, MARIGOLD, "a hydrate that predates the upload is freshened from the clone");
});

// ── the carry ───────────────────────────────────────────────────────────────

function townWithHomes(homes) {
  const dir = mkdtempSync(join(tmpdir(), "pos219-carry-"));
  dirs.push(dir);
  for (const [handle, files] of Object.entries(homes)) {
    const home = join(dir, "WHITE_PAGES", handle, "HOME");
    mkdirSync(home, { recursive: true });
    for (const [name, text] of Object.entries(files)) writeFileSync(join(home, name), text);
  }
  return dir;
}

test("the carry takes the picture the house card wears today: the first declared image, else the first by name, never the region's", () => {
  const t = townWithHomes({
    a: { "HOME.md": "---\nassets: [\"b.png\"]\n---\n", "a.png": "x", "b.png": "x" },
    b: { "HOME.md": "---\ntitle: x\n---\n", "z.jpg": "x", "m.jpg": "x" },
    c: { "HOME.md": "---\nassets: [\"missing.png\"]\n---\n", "k.webp": "x" },
    d: { "HOME.md": "---\n---\n", "REGION.md": "---\nassets: [\"a-region.png\"]\n---\n", "a-region.png": "x", "house.png": "x" },
    e: { "HOME.md": "---\n---\n" },
  });
  assert.equal(leadPicture(t, "a"), "b.png");
  assert.equal(leadPicture(t, "b"), "m.jpg");
  assert.equal(leadPicture(t, "c"), "k.webp");
  assert.equal(leadPicture(t, "d"), "house.png");
  assert.equal(leadPicture(t, "e"), null);
});

test("the carry mints and keeps each house's picture through the same writer, and leaves a chosen picture alone", async () => {
  const t = townWithHomes({
    mari: { "HOME.md": "---\n---\n", "the-marigold-house.jpg": "bytes-of-marigold" },
    rei: { "HOME.md": "---\n---\n", "lanternstep.png": "bytes-of-lanternstep" },
    wright: { "HOME.md": "---\n---\n" },
  });
  const uploads = [], keeps = [];
  const r = await carryHomePictures({
    clone: t,
    householdFor: (h) => ({ household: "keeminlee", handles: new Set(["mari", "rei", "wright"]) }),
    upload: async (args, k, odb, deps) => { uploads.push({ by: args.by, bytes: String(deps.bytes) }); return { url: `https://media.postmark.town/media/keeminlee/${args.by}.jpg` }; },
    keep: async (args, k, deps) => { keeps.push(args); assert.equal(typeof deps.drain, "function", "one drain at the end, not one per house"); return { household: "starforge" }; },
    has: async (h) => h === "rei",
  });
  assert.deepEqual(uploads, [{ by: "mari", bytes: "bytes-of-marigold" }]);
  assert.deepEqual(keeps, [{ handle: "mari", url: "https://media.postmark.town/media/keeminlee/mari.jpg" }]);
  assert.deepEqual(r.skipped.chosen, ["rei"], "rei's own choice stands");
  assert.deepEqual(r.skipped.none, ["wright"]);
});
