// parcel-cap-skips-amend.test.mjs — the parcel-claim cap asks only of NEW ground.
//
// THE INSTANCE (Current the reader, 2026-09-14 ~15:40Z, GitHub #2614 + by letter;
// Linear POS-88): re-amending the household's own parcel
// `current-the-reader/the-keepers-flat` — same act, same ground, `amend: true`,
// new body and picture, no stamps — bounced at the door before the docket saw
// it: "403 your household already holds 4 parcels / parcel claiming is capped at
// 3 per household (… prior holdings stand)". The flat has stood since S45.
//
// THE CAUSE: leave-exec.mjs computed `amending` and `priorRec` above the parcel
// block and never consulted either inside it. `held` counted every parcel the
// household holds, the one being amended included, and `held >= cap` bounced.
// The law's own sentence in the same error string says prior holdings stand;
// the door was reading an amendment of a holding as a claim for new ground.
//
// THE RULE: the extent dial applies to every parcel act (every parcel is the
// town's square); the CAP applies only to a parcel the household does not yet
// hold. An amendment of a held parcel is not a claim.
//
// Drives the real executor in a bottle: a world clone on `main` with three
// parcels held by one solo household, the engine stubbed to the shapes the door
// reads (the same stub shape test/world-pool.test.mjs uses), the executor
// spawned exactly as world.mjs spawns it (WORLD_CLONE + one JSON argv).
//
// THE CAN-FAIL FLIP: drop the `!amending` guard around the cap in
// src/leave-exec.mjs → the first test reds (403 on the amend); the second stays
// green. Run receipt in the hotfix PR.
//
//   node --test test/parcel-cap-skips-amend.test.mjs

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const EXEC = join(ROOT, "src", "leave-exec.mjs");

const repo = mkdtempSync(join(tmpdir(), "postmark-parcel-cap-amend-"));
after(() => { try { rmSync(repo, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); } catch { /* litter */ } });

const git = (...args) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const put = (path, text) => {
  const full = join(repo, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, text);
};
const parcel = (by, slug, x, y) =>
  `---\nkind: parcel\nby: ${by}\ndate: 2026-08-01\nat: { x: ${x}, y: ${y} }\nextent: { w: 25, h: 25 }\n---\n\nthe ground ${slug} stands on\n`;

// ── the world in a bottle ────────────────────────────────────────────────────
put("WORLD/marks/let-there-be-light/mark.md",
  "---\nkind: sited\nby: the-town\ndate: 2026-08-01\nat: { x: 0, y: 0 }\nextent: { w: 1000, h: 1000 }\n---\n\nthe public frame\n");
// three parcels, held by one solo household (no households.json → solo grain,
// the same `credOf` fallback the door takes on a clone with no registry)
put("WORLD/marks/capped/plot-one/mark.md", parcel("capped", "plot-one", 100, 100));
put("WORLD/marks/capped/plot-two/mark.md", parcel("capped", "plot-two", 200, 300));
put("WORLD/marks/capped/plot-three/mark.md", parcel("capped", "plot-three", 300, 500));
// one resident, one parcel, a household far under the cap (POS-368)
put("WORLD/marks/single/the-one-plot/mark.md", parcel("single", "the-one-plot", 600, 100));
put("seeding/manifest.json", JSON.stringify({ homes: [] }));
// THE ENGINE, in miniature: exactly the names leave-exec.mjs imports from
// tools/marks-fold.mjs, faithful to the shapes it reads and nothing more.
put("tools/marks-fold.mjs", `
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
export const PARCEL_CLAIM_CAP = 3;
export const PARCEL_CAP_LAW_DATE = "2026-07-30";
export const PARCEL_EXTENT_M = 25;
export const COORDS_FIELD = "coords";
export const COORDS_RELATIVE = "relative";
export const worldToFile = (at) => at;
export const ringToFile = (pts) => pts;
export function marksContain() { return false; }
export function containmentParents() { return { parent: new Map() }; }
const num = (s) => Number(String(s).trim());
function parse(path) {
  const text = readFileSync(path, "utf8");
  const by = text.match(/^by:\\s*(.+)$/m)?.[1]?.trim();
  const kind = text.match(/^kind:\\s*(.+)$/m)?.[1]?.trim() ?? "sited";
  const at = text.match(/^at:\\s*\\{\\s*x:\\s*(-?[\\d.]+),\\s*y:\\s*(-?[\\d.]+)\\s*\\}/m);
  const extent = text.match(/^extent:\\s*\\{\\s*w:\\s*(-?[\\d.]+),\\s*h:\\s*(-?[\\d.]+)\\s*\\}/m);
  return { by, household: by, kind, body: text.split(/---\\r?\\n/).at(-1).trim(),
    at: at ? { x: num(at[1]), y: num(at[2]) } : null,
    extent: extent ? { w: num(extent[1]), h: num(extent[2]) } : null };
}
export function loadMarks(dir) {
  const out = [];
  function walk(at, parent = null) {
    if (!existsSync(at)) return;
    const entries = readdirSync(at);
    let here = parent;
    if (entries.includes("mark.md")) {
      const rec = parse(join(at, "mark.md"));
      rec.slug = basename(at); rec.id = rec.by + "/" + rec.slug; rec._dir = at; rec._parentMarkId = parent;
      out.push(rec); here = rec.id;
    }
    for (const entry of entries) {
      const next = join(at, entry);
      if (entry !== "mark.md" && statSync(next).isDirectory()) walk(next, here);
    }
  }
  walk(dir);
  return out;
}
`);
git("init", "-q", "-b", "main");
git("add", "-A");
git("-c", "user.name=fixture", "-c", "user.email=fixture@test.invalid", "commit", "-q", "-m", "published main: three parcels held");

/** Spawn the executor the way world.mjs does: one JSON argv, the clone by env. */
function leave(payload) {
  const r = spawnSync(process.execPath, [EXEC, JSON.stringify(payload)], {
    encoding: "utf8",
    env: { ...process.env, WORLD_CLONE: repo, TOWN_PUSH: "", WORLD_POOL_SLOT: "", WORLD_SHARED_CLONE: "",
      BOT_NAME: "fixture", BOT_EMAIL: "fixture@test.invalid" },
  });
  assert.equal(r.status, 0, `the executor tripped: ${r.stderr}`);
  const line = r.stdout.trim().split(/\r?\n/).filter(Boolean).at(-1);
  return JSON.parse(line);
}
const act = (slug, over = {}) => ({
  slug, kind: "parcel", at: { x: 200, y: 300 }, extent: { w: 25, h: 25 },
  body: "the same ground, re-said", by: "capped", household: "capped", date: "2026-09-15", ...over,
});

test("an amendment of a parcel the household already holds is NOT a claim: it goes forward at the cap", () => {
  const out = leave(act("plot-two", { amend: true }));
  assert.equal(out.error, undefined, `the door bounced the amendment: ${JSON.stringify(out.error)}`);
  assert.equal(out.id, "capped/plot-two", "the answer names the held parcel, amended in place");
  assert.ok(out.commit, "the sketchbook took the amendment");
  assert.match(git("show", "draft/capped:WORLD/marks/capped/plot-two/mark.md"), /re-said/, "the new body is on the household's draft branch");
});

test("a FOURTH parcel for the same household is still refused at the cap, with the law's own sentence", () => {
  const out = leave(act("plot-four", { at: { x: 400, y: 700 } }));
  assert.equal(out.error?.code, 403, `expected the cap's 403, got ${JSON.stringify(out)}`);
  assert.match(out.error.defect, /already holds 3 parcels/, "the count is the household's holdings, not the amendment");
  assert.match(out.error.hint, /capped at 3 per household/);
});

test("ONE PARCEL PER RESIDENT on this door too: a resident's second parcel is refused under the cap, with the law's sentence (POS-368)", async () => {
  const { ONE_PER_RESIDENT_SENTENCE } = await import("../src/parcel-law.mjs");
  const out = leave(act("a-second-plot", { by: "single", household: "single", at: { x: 800, y: 100 } }));
  assert.equal(out.error?.code, 409, `expected one-per-resident's 409, got ${JSON.stringify(out)}`);
  assert.equal(out.error.defect, ONE_PER_RESIDENT_SENTENCE);
  assert.ok(out.error.hint.includes("you hold single/the-one-plot"), out.error.hint);
  // CONTROL: amending the one they hold is a relocation, never a second claim
  const moved = leave(act("the-one-plot", { by: "single", household: "single", at: { x: 600, y: 100 }, amend: true }));
  assert.equal(moved.error, undefined, JSON.stringify(moved.error));
});
