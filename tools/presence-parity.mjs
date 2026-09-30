#!/usr/bin/env node
// presence-parity.mjs — the box's own presence, answered both ways, diffed (POS-269).
//
//   node tools/presence-parity.mjs [--json] [--limit <n residents>]
//
// READ-ONLY. It opens dynamic.db read-only, reads the record, and writes nothing
// anywhere. Run it on the box with the office's environment, before the build
// that reads presence from the projection alone takes traffic:
//
//   sudo -n -u <office user> bash -c 'set -a; . /etc/postmark-office.env; cd /srv/postmark-office && node tools/presence-parity.mjs'
//
// For every standing resident it asks the three presence questions at the place
// they stand now, ONCE through the entities table (WORLD_POSITIONS unset, the
// read this lane retires) and ONCE through the position projection
// (WORLD_POSITIONS=1, the read that replaces it), at ONE frozen instant:
//
//   near      GET /world/present?x=&y=  (orient's and open-your-eyes' list too)
//   witness   the witness stamp's "who saw" at that point, the actor excluded
//   listeners the say's listeners at that point (earshot, capped)
//
// plus the everyone list. What a resident is told is compared; the store's words
// about itself (as_of, ledger_moved, disclosed) are not, and are the named
// difference. EXIT 0: every answer equal. EXIT 1: a difference — each is printed
// with the resident and the question, and the flip does not ship.

const argOf = (n, d = null) => { const i = process.argv.indexOf(n); return i !== -1 ? process.argv[i + 1] : d; };
const JSON_OUT = process.argv.includes("--json");
const LIMIT = Number(argOf("--limit", "0")) || Infinity;

// ONE INSTANT for both reads: a walker mid-leg would otherwise differ by the
// milliseconds between two calls, and that is not the difference being asked about.
const AT = Date.now();
Date.now = () => AT;

process.env.WORLD_PRESENCE = "1";
const world = await import("../src/world.mjs");

const told = (r) => (r && typeof r === "object" && !Array.isArray(r))
  ? { count: r.count ?? null, shown: r.shown ?? null, capped: r.capped ?? null, residents: r.residents ?? null, error: r.error ?? null }
  : r;
const asked = async (positions) => {
  const saved = process.env.WORLD_POSITIONS;
  if (positions) process.env.WORLD_POSITIONS = "1"; else delete process.env.WORLD_POSITIONS;
  try {
    const everyone = told(await world.worldPresent({}));
    return { everyone, at: async (h, x, y) => ({
      near: told(await world.worldPresent({ x, y })),
      witness: (await world.witnessStampAt(h, { x, y }))?.witnesses ?? null,
      listeners: await world.projectedNearby({ x, y }),
    }) };
  } finally { if (saved === undefined) delete process.env.WORLD_POSITIONS; else process.env.WORLD_POSITIONS = saved; }
};

// Who stands where, from the projection's own everyone list.
process.env.WORLD_POSITIONS = "1";
const roster = (await world.worldPresent({}))?.residents ?? [];
const differences = [];
let compared = 0;

const table = await asked(false);
const kept = await asked(true);
if (JSON.stringify(table.everyone) !== JSON.stringify(kept.everyone))
  differences.push({ question: "everyone", table: table.everyone, projection: kept.everyone });

for (const r of roster.slice(0, LIMIT)) {
  const x = r.at?.x ?? r.x, y = r.at?.y ?? r.y;
  if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
  delete process.env.WORLD_POSITIONS;
  const a = await table.at(r.handle, x, y);
  process.env.WORLD_POSITIONS = "1";
  const b = await kept.at(r.handle, x, y);
  compared += 1;
  for (const q of ["near", "witness", "listeners"])
    if (JSON.stringify(a[q]) !== JSON.stringify(b[q])) differences.push({ handle: r.handle, at: { x, y }, question: q, table: a[q], projection: b[q] });
}

const report = { at: new Date(AT).toISOString(), residents: roster.length, compared, differences: differences.length, first: differences.slice(0, 10) };
if (JSON_OUT) console.log(JSON.stringify(report, null, 2));
else {
  console.log(`presence parity at ${report.at}: ${compared} residents × 3 questions + everyone`);
  for (const d of differences.slice(0, 20))
    console.log(`  DIFFERS · ${d.question}${d.handle ? ` at ${d.handle} (${d.at.x}, ${d.at.y})` : ""}\n    table:      ${JSON.stringify(d.table).slice(0, 300)}\n    projection: ${JSON.stringify(d.projection).slice(0, 300)}`);
  console.log(differences.length ? `NOT EQUAL — ${differences.length} difference(s); the projection-only presence must not ship` : "EQUAL — every answer the same both ways");
}
process.exit(differences.length ? 1 : 0);
