#!/usr/bin/env node
// quests-post.mjs — the town's quests become its posts, once (POS-294).
//
//   node world2/tools/quests-post.mjs --hand <wright|keemin> --dry-run
//   node world2/tools/quests-post.mjs --hand <wright|keemin>
//        [--town-clone <dir>]   where quest-registry.json is read (default: TOWN_CLONE, else ./town-clone)
//        [--json]               machine-readable receipt on stdout
//
//   env: the office's own record env (WORLD2_PG, WORLD2_PG_URL), as the office
//        itself runs with it. It writes through the office's one pen.
//
//   EXIT: 0 done (or nothing to do) · 1 refused · 2 cannot run.
//
// ── WHY A POSTING ACT AND NOT A MIGRATION ───────────────────────────────────
//
// POS-288 made no rows: every event row is the projection of a resident's act,
// and events-rebuild folds the act log back into `posts`. A migration that
// INSERTed quest rows would be rows no act derives, which is the drift the
// rebuild exists to catch. So each quest is put up by the same `post` act the
// town door writes (events-store.mjs § postQuest): the pen's act, naming the
// hand that ran this (Wright's ruling, 2026-09-28).
//
// ── ONCE ────────────────────────────────────────────────────────────────────
//
// It posts every registry quest (the pots excluded, POS-291) that is not yet a
// post. A quest already posted, open or closed, is left alone, so a second run
// posts nothing and a closed quest is never put back up. --dry-run reads the
// record and the registry and writes nothing.

import { resolve } from "node:path";

import { seedQuestPosts } from "../../src/events-store.mjs";
import { readQuestRegistry } from "../../src/quests.mjs";

async function main() {
  const argv = process.argv.slice(2);
  const arg = (n) => { const i = argv.indexOf(`--${n}`); return i === -1 ? null : argv[i + 1]; };
  const hand = arg("hand");
  const dryRun = argv.includes("--dry-run");
  if (!hand) { console.error("quests-post: --hand <wright|keemin> is required — the act names whose hand put the quests up"); process.exit(2); }
  const townClone = resolve(arg("town-clone") ?? process.env.TOWN_CLONE ?? "town-clone");
  const registry = readQuestRegistry(townClone);
  if (!registry) { console.error(`quests-post: cannot read ${townClone}/quest-registry.json`); process.exit(2); }
  let out;
  try {
    out = await seedQuestPosts({ hand, registry, dryRun });
  } catch (e) {
    console.error(`quests-post: ${e?.defect ?? e?.message ?? e}${e?.hint ? ` — ${e.hint}` : ""}`);
    process.exit(e?.code === 503 ? 2 : 1);
  }
  if (argv.includes("--json")) console.log(JSON.stringify({ dry_run: dryRun, ...out }, null, 2));
  else {
    console.log(`${dryRun ? "DRY RUN · " : ""}by ${hand}'s hand · posted ${out.posted.length} · already posts ${out.already.length}${dryRun ? ` · would post ${out.would_post.length}` : ""}`);
    for (const p of out.posted) console.log(`  posted ${p.id} (act ${p.act_id})`);
    for (const id of out.would_post) console.log(`  would post ${id}`);
  }
  process.exit(0);
}

// Run as a script, never on import (the test imports nothing from here, but the rule is the rebuild's).
if (process.argv[1]?.replace(/\\/g, "/").endsWith("world2/tools/quests-post.mjs")) main();
