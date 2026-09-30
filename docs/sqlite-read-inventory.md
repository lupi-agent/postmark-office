# The office's sqlite reads: an inventory (POS-268 / POS-270, step 1)

This lists every place the office opens or reads `office.db` (the read index of the
TOWN repo) and `world.db` (the index of the WORLD repo). For each one it names the
reader, the doors that consume it, and whether the Postgres store (the acts and
their projections, `world2/schema/`) already holds the answer. Taken on
`train/2026-w41 @ 60098fe`, 2026-09-27. `dynamic.db`, `roles.db` and `oauth.db`
are out of scope (O3b).

"The store answers" means a table in `world2/schema/001..026` already holds the
same facts at the same tense. "No" means a new table or projection would be
needed, and the brief says to stop there and report the shape.

## Premise: what the store holds

`world2/schema/` creates these tables: `acts`, `claims`, `marks`, `windows`,
`identities`, `registry`, `law_projection`, `stamp_projection`,
`escrow_projection`, `town_roll`, `projection_heads`, `settlements`,
`households`, `household_pins`, `registry_meta`, `events`, `event_rsvps`,
`household_harnesses`, `earpiece_wakes`, and two views, `docket` and
`standing_marks`.

The town-side projections are thin:

- `town_roll`: one row per handle, `data` = the ADDRESS.md frontmatter only
  (`world2/tools/roll-ingest.mjs:93`).
- `stamp_projection`: `balance` per handle and household. It has no
  `mint_count` or `staked`.
- `escrow_projection`: open stakes per mark.

Nothing in the store holds letters, threads, the bulletin, the ledger's lines,
mail state, quest progress or standing, the repo's history, regions, homes,
pots, or the funding rolls. Those exist only in `office.db`, which
`src/hydrate.mjs` builds from the town clone.

## office.db

**Built by** `src/hydrate.mjs` (tables in `src/schema.mjs`: `meta residents
letters threads bulletin ledger stamps mail_state quest_progress quest_standing
repo_log regions homes pots funding_roll funding_holo funding_keeping_mint
pot_receipts pot_escrow pot_stakers funding_invalid`).
**Rebuilt by** `deploy/office-tick.sh:111-112`, run by
`deploy/postmark-office-rehydrate.{service,timer}` at :07/:22/:37/:52.
**Opened by** `src/server.mjs` (`DB_PATH`, swapped in place on a stamp change,
`:207-300`). The handle is passed down as `db` to every reader below.
All reads are synchronous (`node:sqlite`).

### The readers (8 src files that run SQL on it)

| Reader | Tables | Consumers (doors) | Store answers? |
|---|---|---|---|
| `src/queries.mjs` `residentList` `residentPage` `townSummary` `resident` `windowRead` `officeHandles` | residents (+ letters for `resident`) | GET /residents, /residents/:h, /town; MCP list_residents, read_resident, read_town; `profiles.mjs`, `paper-fresh.mjs`; `server.mjs § townRoll` (the position doors) | **No.** `town_roll` has only ADDRESS frontmatter. The index's `residents.json` also carries the profile, window state, `last_active`, office flag and history-derived fields. |
| `queries.mjs` `letter` `letterAnswer` `letterList` `mailList` `mailCorrespondents` `outboxSettled` `search` | letters, residents, threads | GET /letters, /letters/:id, /mail/:h, /search; MCP list_letters, read_letter, list_mail, search_town; `household-apex.mjs` (the mail pane); `world.mjs` (search) | **No.** No letters table in the store. |
| `queries.mjs` `metricsMail` | ledger, letters, threads, residents | GET /metrics/mail; MCP read_metrics | **No.** |
| `queries.mjs` `doorstep` | residents, ledger | GET /doorstep/:h, MCP read_doorstep (via `doorstep-bundle.mjs`) | **No.** |
| `queries.mjs` `mailAwaiting` | mail_state, ledger | `household-apex.mjs` | **No.** |
| `queries.mjs` `bulletinList` `bulletinEntry` `bulletinTeaser` `psaFold` | bulletin | GET /bulletin, /bulletin/:slug; MCP read_bulletin | **No.** |
| `queries.mjs` `repoLog` | repo_log | GET /repo/log; MCP list_commits | **No.** It comes from `git log` on the town clone. |
| `queries.mjs` `regionList` `regionOne` `regionResidents` `home` | regions, homes | GET /regions, /regions/:id, /homes/:h; MCP list_regions, read_home | **No.** |
| `queries.mjs` `stampsRoster` `stampsFor` `stampsDetail` | stamps, funding_holo, funding_keeping_mint | GET /stamps, /stamps/:h; MCP read_stamps; `household-stamps.mjs` | **Partly.** `stamp_projection.balance` matches `stamps.balance`. `mint_count`, `staked` and the holo/keeping rows are not in the store. |
| `queries.mjs` `potBoard` `questBoardFor` `townQuestBoard` `standingFor` | pots, funding_roll, pot_receipts, pot_escrow, pot_stakers, funding_invalid, quest_progress, quest_standing | GET /quests/:h; MCP read_quests; `household-stamps.mjs`, `household-apex.mjs` | **No.** `escrow_projection` is per-MARK stakes, not per-pot. |
| `queries.mjs` `indexAsOf` | meta | `household-apex.mjs` (the as-of stamp) | **Partly.** `projection_heads['town']` is a town sha, but it is set by a different job on a different clock. |
| `src/server.mjs` `:871`, `:981` | residents | POST paths that check that an address is a resident (`/letters` etc.) | **No.** It could be answered from `town_roll` at the head, but only once the roll's freshness is ruled equal to the index's. |
| `src/write.mjs` `:130-173` | residents, letters | POST /letters (recipient and thread checks) | **No.** |
| `src/residency.mjs:100`, `src/declare.mjs:188` | residents | declare, the address checks | Same as server.mjs. |
| `src/mail-thread.mjs:106` | mail_state | the mail-thread read | **No.** |
| `src/oauth.mjs:130-170` | residents (from the index handle, not oauth.db) | OAuth's handle validation | **No.** |
| `src/declare-exec.mjs:50` | opens `OFFICE_DB` or `office.db`, read-only | the declare child process | **No** (it reads residents). |

Two more pass the handle along without running SQL on it:
`src/earpiece-mail.mjs` and `world2/tools/earpiece-deliver.mjs`.
`tools/town-drain-run.mjs`, `tools/backfill-home-shelf.mjs`, and the golden/equivalence tools
open it too.

### The rehydrate tick does more than rehydrate

`deploy/office-tick.sh` is the only thing the rehydrate timer runs. Besides
`hydrate.mjs` (`:111`), each tick also:

1. `git pull --ff-only` on the town clone (`:45`). The write pen and
   `declare-exec` read this clone.
2. `git fetch` on the world clone (`:46`). This is what brings a new
   `settlement/S<n>` tag in, and the fold and the refresher answer from it.
3. The stamp-mint catch-up and the welcome pass, with a commit and push to the
   town (`:79-86`).
4. The settlements row (`world2/tools/settlements-backfill.mjs`, `:104`).
5. `world-hydrate.mjs --ref blessed`, which writes world.db (`:127`).
6. `deploy/publish-windows.mjs`, the panes webroot (`:130`).

If the timer and service are deleted, 1–4 and 6 stop too. None of them are
reads of office.db.

## world.db

**Built by** `src/world-hydrate.mjs --ref blessed` (tables in
`src/world-store.mjs:30-106`: `meta nodes edges events edge_type_registry
geometry_versions lint_findings`), from the same tick (`office-tick.sh:127`).
**Located by** `WORLD_STORE_DB`, default `<office>/world.db`
(`world-serve.mjs:68 § storeDbPath`, `world-store.mjs:309 § DEFAULT_DB`).
**Opened** per call, read-only, in each reader (`server.mjs:364`).

### The readers

| Reader | Tables | Consumers | Store answers? |
|---|---|---|---|
| `src/world-apex.mjs § openStore` (`:1465`) + `entriesFrom`, `gatherActions`, the law block | meta, nodes (class marks, instances) | GET/MCP `/world/apex` (law, granted, action cards); `household-apex.mjs`, `household-media.mjs`, `world-hold.mjs`, `arena.mjs` | **Mostly.** `law_projection` (class, grant, threshold, skeleton, roster) + `marks` hold it. `world2/tools/apex-reads.mjs` is already ported over them, but there is no door. The engine part (`orient`, field of view) needs a world-shaped assembly, which that file builds. |
| `src/world-classes.mjs` `classRoster` `classDials` `classPredicates` `dialNode` `dialNumber` `markClass` | nodes, edges, meta | say (voices), walk-exec, town-stake, first-idea-sweep, world-hold, world.mjs, world2-serve, queries, mcp | **Mostly.** Class definitions and dials are `law_projection` kind `class`. `markClass` reads an instance's class from `marks.data`. |
| `world-classes.mjs` `ideasTank` `civicQuarter` `bountyBoard` `freeCellIn` `departurePace` | nodes, edges (containment, instances in a place) | MCP read_bounties, read_asks, and the ideas block (`mcp.mjs:708`), walk-exec (free cell), departure pace | **Partly.** Instances are in `marks` (+ `parent`). Containment is edges in world.db, and the store has no edge table. It would have to be derived from `marks.geometry`/`parent` at read time. |
| `src/world-frames.mjs:91` | nodes, meta | `server.mjs` (the frame law), `world-movement.mjs` | **Mostly** (class fields from `law_projection`). |
| `src/world-serve.mjs` `storeSnapshot` (`:119`) → `loadWorldGraph` | the whole graph | `/world/*` Stage-1 reads, which only run when `WORLD_STORE_READS` is set. It is unset on the box (request-path-inventory), so prod serves the fold. The health panel `worldStoreHealth` reads it too. | Only the health panel reads it on prod. |
| `src/world-graph.mjs` → `loadWorldGraph` | nodes, edges, meta | GET /world/graph (the window) | **No.** There is no edge table. |
| `src/world-lints.mjs` → `loadWorldGraph` | all | the standing lints (tools) | **No.** |
| `src/world.mjs:4314` | nodes | one read in world.mjs (the class layer of a fold answer) | **Mostly.** |
| `src/dynamic-entities.mjs:200`, `src/dynamic-store.mjs:388` | events (the walk ledger), nodes, meta | dynamic.db's rebuild and class read (O3b's file) | `events` = departures, which `acts` answers (`world-movement.mjs § readDepartureEvents`). Their class read is the same as world-classes. |
| `src/world-store.mjs` `geometry_versions` + `tools/vessel-parity.mjs`, `tools/hydrate-equivalence.mjs` | geometry_versions (the tense law) | tools only | **No.** The store has no mark geometry history. |
| `src/world-hydrate.mjs` | writes it; reads the old file's `lint_findings` for the delta | the tick | This is the builder. |
| `tools/arena-play.mjs`, `tools/world-gexf.mjs`, `tools/world-shadow.mjs` | nodes / graph | tools | — |

### The tense the store answers at

world.db is hydrated at the NEWEST BLESSING (`--ref blessed`, Keemin 2026-09-18,
postmark#2934, quoted at `office-tick.sh:113`). `law_projection` is written by
`deploy/world2-ingest.sh law` → `world2-refresh-clone.sh`, which resets to
`${W2_WORLD_BRANCH:-main}` (`:58`). So unless the box env sets that branch
(`/etc/postmark-world2-dev.env`, which is on the box and was not read), a
class read that moves from world.db to `law_projection` moves from blessed to
main. The "answer equals the old one" falsifier would go red whenever main is
ahead of the newest tag, which is the normal state between a crossing and its
blessing.

## Summary

- office.db: 8 src files read it and ~30 read functions sit on it. The store
  holds the answer for none of them in full. Only `stamps.balance`
  (`stamp_projection`) and the bare roll (`town_roll`) have partial twins.
- world.db: ~12 src files read it. The class layer (roster, dials, grants,
  frames, apex law) is in `law_projection` + `marks`, at a different tense.
  The graph, containment edges, the tense history and the lints have no
  store table.
- All store reads are async (`pg`). Every office.db reader is sync and takes
  `db` as an argument, so moving one changes its signature at every caller.
