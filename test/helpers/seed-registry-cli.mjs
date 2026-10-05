// seed-registry-cli.mjs — re-state a store's registry from a fixture town's printouts, as a child process.
//
// NOT A TEST FILE. `registryStoreForTowns().seedFromSync(town)` runs this so a
// synchronous harness (a suite whose crossing is one spawnSync) can re-state
// the store without turning every caller async. Writes as the store's owner.
//
//   node test/helpers/seed-registry-cli.mjs <town>     (REG_OWNER_URL in env)

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { rowsFromRegistry } from "../../src/registry-rows.mjs";

const town = process.argv[2];
const read = (p) => (existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null);
const doc = read(join(town, "tools", "households.json")) ?? { schema_version: 1, households: {} };
const houses = {};
for (const [slug, rec] of Object.entries(doc.households ?? {}))
  houses[slug] = { since: "2026-01-01", declared_by: (rec?.residents ?? [])[0] ?? slug, ...rec };
const rows = rowsFromRegistry({ ...doc, households: houses }, read(join(town, "tools", "github-ids.json")) ?? {});
const { default: pg } = await import("pg");
const c = new pg.Client({ connectionString: process.env.REG_OWNER_URL });
await c.connect();
const json = new Set(["accounts", "home_images"]);
const insert = async (table, row) => {
  const cols = Object.keys(row);
  await c.query(`INSERT INTO ${table} (${cols.join(", ")}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")})`,
    cols.map((k) => (json.has(k) ? JSON.stringify(row[k]) : row[k])));
};
try {
  await c.query("BEGIN");
  await c.query("TRUNCATE household_pins, households, registry_meta");
  for (const [key, value] of Object.entries(rows.meta)) await c.query("INSERT INTO registry_meta (key, value) VALUES ($1, $2)", [key, JSON.stringify(value)]);
  for (const r of rows.households) await insert("households", r);
  for (const r of rows.pins) await insert("household_pins", r);
  await c.query("COMMIT");
} finally { await c.end(); }
