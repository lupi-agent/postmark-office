// payer-store.mjs — a real store holding a fixture town's payer registry
// (POS-346).
//
// The money watchers and the /fund door now resolve every payer from the store:
// the registry's households and pins, and the resident roll (town_residents).
// A suite that drives one of them end to end hands it a store that says what
// the fixture's files say. `seedFrom(repo)` folds the fixture's
// tools/households.json and tools/github-ids.json through the drain's own
// `rowsFromRegistry` (the store's rows are what those files are printed from),
// and lists its WHITE_PAGES rooms as the roll. `env` points a child process (or
// a `{ env }` argument) at the store as office_api, the pen the office reads
// with.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { startStore } from "./embedded-store.mjs";
import { rowsFromRegistry } from "../../src/registry-rows.mjs";

const readJson = (p, fallback) => { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return fallback; } };

/** The fixture's rooms, as the town index lists them: every WHITE_PAGES directory but TEMPLATE and `_`-shelves. */
export function roomsOf(repo) {
  const dir = join(repo, "WHITE_PAGES");
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name !== "TEMPLATE" && !e.name.startsWith("_")).map((e) => e.name);
}

export async function startPayerStore({ db = "payer_registry" } = {}) {
  const store = await startStore({ db });
  const owner = await store.connect("world2_owner");
  return {
    store,
    owner,
    env: { WORLD2_PG: "1", WORLD2_PG_URL: store.url("office_api") },
    /** Replace the store's registry and roll with what the fixture's files say. */
    async seedFrom(repo) {
      const rows = rowsFromRegistry(
        readJson(join(repo, "tools", "households.json"), { households: {} }),
        readJson(join(repo, "tools", "github-ids.json"), {}));
      await owner.query("BEGIN");
      try {
        await owner.query("DELETE FROM households; DELETE FROM household_pins; DELETE FROM registry_meta; DELETE FROM town_residents");
        for (const [k, v] of Object.entries(rows.meta ?? {}))
          await owner.query("INSERT INTO registry_meta (key, value) VALUES ($1, $2)", [k, JSON.stringify(v)]);
        for (const h of rows.households ?? [])
          await owner.query(
            `INSERT INTO households (slug, ord, name, human, accounts, residents, since, member_of, declared_by, formerly, provisional)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
            [h.slug, h.ord, h.name ?? null, h.human ?? null, JSON.stringify(h.accounts ?? []), h.residents ?? [],
              h.since ?? "2026-01-01", h.member_of ?? null, h.declared_by ?? "fixture", h.formerly ?? [], h.provisional === true]);
        for (const p of rows.pins ?? [])
          await owner.query(
            `INSERT INTO household_pins (handle, login, gh_id, pinned, renamed, note, retired, renamed_to)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [p.handle, p.login ?? "", p.gh_id, p.pinned ?? null, p.renamed ?? null, p.note ?? null, p.retired ?? null, p.renamed_to ?? null]);
        for (const h of roomsOf(repo))
          await owner.query("INSERT INTO town_residents (handle, json, digest) VALUES ($1, $2, $3)", [h, JSON.stringify({ handle: h }), "fixture"]);
        await owner.query("COMMIT");
      } catch (e) { await owner.query("ROLLBACK").catch(() => {}); throw e; }
    },
    async stop() { await owner.end().catch(() => {}); await store.stop(); },
  };
}
