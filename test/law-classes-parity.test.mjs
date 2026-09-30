// law-classes-parity.test.mjs — the class layer from the store equals the class
// layer from world.db, class by class and slot by slot (POS-270, 2026-09-27).
//
// THE FIXTURE IS ONE SHA, TWO SOURCES. The world checkout's newest
// `settlement/S<n>` tag is hydrated into a world.db the way the rehydrate unit
// does it (`world-hydrate.mjs --ref <sha>`), and the same sha's law is derived
// by the law pen's own `deriveLaw` and written through `writeLaw --blessed` into
// a REAL Postgres (PGlite; test/helpers/pglite-store.mjs) beside a settlements
// row naming that tag. Then every class the world.db roster knows is asked both
// ways — world-classes.mjs off the file, law-classes.mjs off the store's rows at
// the pin — and the answers must be byte-equal.
//
// It SKIPS, with the reason, when there is no world checkout, no settlement tag
// in it, or no PGlite. It never narrows what it compares to make a skip a pass.
//
// Run: WORLD_CLONE=<a world checkout with settlement tags> \
//      PGLITE_MODULE_DIR=<a dir with @electric-sql/pglite installed> \
//      node --test test/law-classes-parity.test.mjs

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { worldClone, NO_WORLD, OFFICE_ROOT } from "./fixture-paths.mjs";
import { loadPglite, storeFloor } from "./helpers/pglite-store.mjs";
import { materializeWorldAtSha } from "../src/world-store.mjs";
import { deriveLaw, writeLaw } from "../world2/tools/law-ingest.mjs";
import { classRoster, classDials, classPredicates, dialNode, resetClassRosterCache } from "../src/world-classes.mjs";
import { LAW_AT_BLESSING_SQL, lawSnapshotFromRows, rosterOf, dialsOf, predicatesOf, predicateNodeOf } from "../src/law-classes.mjs";

const pglite = await loadPglite();
const CLONE = worldClone();

/** The newest settlement tag in the checkout, peeled — or null with a reason. */
function newestBlessing(repo) {
  const lines = execFileSync("git", ["-C", repo, "for-each-ref", "--format=%(refname:short) %(*objectname) %(objectname)", "refs/tags/settlement/"], { encoding: "utf8" })
    .split("\n").filter(Boolean).map((l) => {
      const [tag, peeled, obj] = l.split(" ");
      return { tag, n: Number(/S(\d+)$/.exec(tag)?.[1]), sha: peeled || obj };
    }).filter((t) => Number.isFinite(t.n));
  lines.sort((a, b) => b.n - a.n);
  return lines[0] ?? null;
}

const why = NO_WORLD || pglite.reason || (() => {
  const b = newestBlessing(CLONE);
  return b ? null : `the world checkout at ${CLONE} carries no settlement/S<n> tag, so there is no blessing to hold the store to`;
})();

let dir, worldDb, db, snap, blessing;

before(async () => {
  if (why) return;
  blessing = newestBlessing(CLONE);
  dir = mkdtempSync(join(tmpdir(), "law-parity-"));
  worldDb = join(dir, "world.db");
  execFileSync(process.execPath, [join(OFFICE_ROOT, "src", "world-hydrate.mjs"),
    "--world", CLONE, "--ref", blessing.sha, "--db", worldDb, "--no-gexf", "--no-lints"],
  { stdio: "ignore", env: { ...process.env, WORLD_STORE_DB: worldDb } });
  resetClassRosterCache();

  const lawRepo = materializeWorldAtSha(CLONE, blessing.sha, ["WORLD", "tools", "LOGOS"], join(dir, "law"));
  const { rows } = await deriveLaw({ lawRepo });
  db = await storeFloor(pglite);
  await db.query("INSERT INTO settlements (number, tag_sha, published_at) VALUES ($1, $2, now())", [blessing.n, blessing.sha]);
  await writeLaw(db, { lawSha: blessing.sha, rows, identities: [], blessed: true });
  snap = lawSnapshotFromRows((await db.query(LAW_AT_BLESSING_SQL)).rows);
});

after(async () => {
  await db?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

test("the store pins the blessing the world.db was hydrated at", (t) => {
  if (why) return t.skip(why);
  assert.deepEqual(snap.pin, { settlement: blessing.n, sha: blessing.sha, newest: blessing.n });
  assert.equal(snap.disclosed, null);
});

test("the roster: the same class names, from both sources", (t) => {
  if (why) return t.skip(why);
  const file = classRoster({ worldDb });
  assert.equal(file.source, "store", `world.db did not answer the roster (${file.disclosed}) — the fixture is broken, not the port`);
  assert.deepEqual([...rosterOf(snap)].sort(), [...file.roster].sort());
});

test("every class's frontmatter dials, predicate children and predicate nodes are byte-equal", (t) => {
  if (why) return t.skip(why);
  const diffs = [];
  let slots = 0;
  // ⚑ KEY ORDER IS NOT CARRIED. jsonb stores an object's keys sorted (shorter
  // first, then bytewise), and world.db kept the record's own order: at S83 nine
  // classes' `dials` come back from Postgres with the same keys and values in a
  // different order. So a dials object is compared CANONICALLY (keys sorted,
  // recursively), and that is only sound because no door prints one whole: the
  // consumers of classDials are thingDials → world-hold (reads `carry_cap`,
  // `make_daily_cap`, `take_requires_welcome` by name) and departurePace (reads
  // `pace_km_per_crossing`). A future door that serialises a dials object would
  // change its bytes, not its meaning, and must name that when it lands.
  const canon = (v) => JSON.stringify(v, (_, x) => (x && typeof x === "object" && !Array.isArray(x)
    ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])) : x));
  for (const name of [...classRoster({ worldDb }).roster].sort()) {
    const a = canon(classDials(name, { worldDb })), b = canon(dialsOf(snap, name));
    if (a !== b) diffs.push(`${name} dials: world.db ${a} / store ${b}`);
    const pa = classPredicates(name, { worldDb }), pb = predicatesOf(snap, name);
    const sorted = (o) => JSON.stringify(Object.entries(o).sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0)));
    if (sorted(pa) !== sorted(pb)) diffs.push(`${name} predicates: world.db ${sorted(pa)} / store ${sorted(pb)}`);
    for (const slot of Object.keys(pa)) {
      slots++;
      const na = dialNode(name, slot, { worldDb }), nb = predicateNodeOf(snap, name, slot);
      if (na !== nb) diffs.push(`${name}/${slot} node: world.db ${na} / store ${nb}`);
    }
  }
  assert.ok(slots > 0, "no class carried a predicate child — the comparison below would be vacuous");
  assert.deepEqual(diffs, [], `${diffs.length} class answer(s) differ between world.db and the store`);
});

test("a blessing the law pen has not ingested yet is disclosed, and the pin stays on the last one it has", async (t) => {
  if (why) return t.skip(why);
  await db.query("INSERT INTO settlements (number, tag_sha, published_at) VALUES ($1, $2, now())", [blessing.n + 1, "f".repeat(40)]);
  const later = lawSnapshotFromRows((await db.query(LAW_AT_BLESSING_SQL)).rows);
  assert.deepEqual(later.pin, { settlement: blessing.n, sha: blessing.sha, newest: blessing.n + 1 });
  assert.match(later.disclosed, new RegExp(`S${blessing.n + 1} is blessed but its law is not ingested yet`));
  await db.query("DELETE FROM settlements WHERE number = $1", [blessing.n + 1]);
});
