// #2040: the drain signs its ledger appends now, so every fixture that settles
// a join needs a pen. These bridge/journal tests are not tests of the town's
// stamp engine itself; they need the REAL office signing path to run without
// depending on a developer's separate town checkout.
//
// So the fixture supplies two per-run things:
//   1. a throwaway ed25519 private key, and
//   2. the narrow stamp-engine surface town-drain calls: parseStampLedger +
//      sealChain, using the town engine's published seal grammar verbatim.
//
// The dedicated drain-signs suite is the place that intentionally exercises the
// town's real stamp-mint + stamp-verify as its oracle. Keeping that distinction
// here makes these tests portable without pretending a fixture engine proves
// the town's cryptographic implementation.
import { generateKeyPairSync } from "node:crypto";
import { mkdirSync, writeFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const { privateKey } = generateKeyPairSync("ed25519");
const dir = mkdtempSync(join(tmpdir(), "pm-drainpen-"));
const keyFile = join(dir, "stamp-key.pem");
writeFileSync(keyFile, privateKey.export({ type: "pkcs8", format: "pem" }));

const engineDir = join(dir, "engine");
const engineFile = join(engineDir, "stamp-mint.mjs");
mkdirSync(engineDir, { recursive: true });
writeFileSync(engineFile, `
import { createHash } from "node:crypto";

const sha256hex = (s) => createHash("sha256").update(s, "utf8").digest("hex");
const GENESIS_SEAL_SEED = "postmark-stamps-v1";

// Transcribed from the town engine, not paraphrased — the raw line is tested,
// never a trimmed copy, and the signature must run to the end of the line with
// no whitespace in it. A fixture that is MORE permissive than the law reads a
// malformed line as signed, which is the class the drain-signs suite exists for.
// test/drain-pen-fixture.test.mjs pins every one of those shapes.
export function parseStampLedger(text) {
  const out = [];
  for (const raw of text.replace(/\\r\\n/g, "\\n").split("\\n")) {
    if (!raw.startsWith("- ")) continue;
    const m = /^(.*) · sig: (\\S+)$/.exec(raw);
    if (m) out.push({ canonical: m[1], sig: m[2], raw });
    else out.push({ canonical: raw, sig: null, raw });
  }
  return out;
}

export function sealChain(canonicals) {
  let seal = sha256hex(GENESIS_SEAL_SEED);
  const seals = [];
  for (const canonical of canonicals) {
    seal = sha256hex(seal + canonical);
    seals.push(seal);
  }
  return seals;
}
`);

// ONE HOUSEHOLD, ONE MINT KEY (2026-10-04): the drain now also reads the
// town's current keys (`currentHouseholds`) and judges its planned lines with
// the town's tools/household-keys.mjs, both through this same directory. The
// fold below is the town's base registry (pins → gh:<id>, ADDRESS github →
// login:, else solo:) with the ledger's `registry:` lines folded over it. The
// one rule it leaves out, the pin made inert by an earlier sealed line, cannot
// change the folded answer: a pin is inert only where a sealed line exists, and
// that line is folded last either way. drain-pen-fixture.test.mjs reads both
// copies back against the town's own on the live town clone.
writeFileSync(engineFile, `
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
const REGISTRY_RE = /^- (\\d{4}-\\d{2}-\\d{2}) · registry: (\\S+) = (\\S+)$/;
export function registryRevisions(entries) {
  const out = [];
  for (const e of entries) { const m = REGISTRY_RE.exec(e.canonical); if (m) out.push({ date: m[1], handle: m[2], key: m[3] }); }
  return out;
}
export function currentHouseholds(repo) {
  const map = new Map();
  let pins = {};
  try { pins = JSON.parse(readFileSync(join(repo, "tools", "github-ids.json"), "utf8")); } catch {}
  for (const [h, rec] of Object.entries(pins)) if (rec && rec.id) map.set(h, { key: "gh:" + rec.id, provisional: false });
  const pages = join(repo, "WHITE_PAGES");
  if (existsSync(pages)) {
    const rooms = readdirSync(pages, { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name !== "TEMPLATE" && !e.name.startsWith("_")).map((e) => e.name).sort();
    for (const room of rooms) {
      if (map.has(room)) continue;
      const addr = join(pages, room, "ADDRESS.md");
      const m = existsSync(addr) ? /^github:\\s*(\\S+)/m.exec(readFileSync(addr, "utf8")) : null;
      map.set(room, m ? { key: "login:" + m[1].toLowerCase(), provisional: false } : { key: "solo:" + room, provisional: true });
    }
  }
  const ledger = join(pages, "stamp-ledger.md");
  const entries = existsSync(ledger) ? parseStampLedger(readFileSync(ledger, "utf8")) : [];
  for (const r of registryRevisions(entries)) map.set(r.handle, { key: r.key, provisional: false });
  return map;
}
// THE DATING RULE (#3429) asks who was active on the line's day: the ledger's
// lines, and the witnessed mail. These fixtures carry no mail ledger, so the
// town's parseDeliveries would read none either.
export function parseDeliveries(repo) { return []; }
`, { flag: "a" });
writeFileSync(join(engineDir, "household-keys.mjs"), `
// Transcribed from the town's tools/household-keys.mjs (town d95e81c1c).
import { currentHouseholds, parseStampLedger, registryRevisions } from "./stamp-mint.mjs";
export function rollWith(roll, extraLines = []) {
  const out = new Map(roll);
  for (const r of registryRevisions(parseStampLedger(extraLines.join("\\n") + "\\n"))) out.set(r.handle, { key: r.key, provisional: false });
  return out;
}
export function householdKeySplits({ roll, houses }) {
  const split = [];
  const houseOf = new Map();
  for (const [slug, rec] of Object.entries(houses)) {
    const keys = new Map();
    for (const h of rec?.residents ?? []) {
      houseOf.set(h, slug);
      const k = roll.get(h)?.key;
      if (!k) continue;
      keys.set(k, [...(keys.get(k) ?? []), h]);
    }
    const entry = { house: slug, keys: Object.fromEntries([...keys].sort(([a], [b]) => a.localeCompare(b))) };
    if (keys.size > 1) split.push(entry);
  }
  const byKey = new Map();
  for (const [h, v] of roll) {
    const slug = houseOf.get(h);
    if (!slug) continue;
    byKey.set(v.key, new Set([...(byKey.get(v.key) ?? []), slug]));
  }
  const shared = [...byKey].filter(([, s]) => s.size > 1).map(([key, s]) => ({ key, houses: [...s].sort() }));
  return { split, shared };
}
export function describe({ split, shared }) {
  return [
    ...split.map((s) => s.house + " mints under " + Object.keys(s.keys).length + " keys: " + Object.entries(s.keys).map(([k, hs]) => k + " (" + hs.join(", ") + ")").join(" · ")),
    ...shared.map((s) => "key " + s.key + " mints for two households: " + s.houses.join(", ")),
  ];
}
`);

process.env.STAMP_KEY = keyFile;
process.env.STAMP_ENGINE_DIR = engineDir;
