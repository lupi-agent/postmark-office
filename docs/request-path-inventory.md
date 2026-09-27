# The read path's synchronous work: an inventory (POS-263, part 1)

This is every `execFileSync` / `spawnSync` / `execSync` / `node:sqlite` call that
a READ door reaches, with a measured cost for each. It was taken on
`train/2026-w40 @ f96e57f` on 2026-09-27. Line numbers are that commit's.

## How it was measured

- **A probe, not a grep.** A preload module (`node --import`) wrapped
  `child_process.execFileSync/spawnSync/execSync` and `node:sqlite`'s open,
  `exec`, `all`, `get`, `run` and `iterate`. Each call was timed and logged with
  the first `src/` frames of its caller. The office ran under it on this tree and
  one driver walked 46 read doors (35 GET, 11 MCP tool calls) in sequence, three
  passes. Each call was then assigned to the request whose window held it. A grep
  lists the call sites, but only a run shows which of them a request reaches, and
  how many times.
- **The data.** A private clone of the world at `bedd849e` holds 83 settlement tags
  and 44 draft refs, and one local pen branch 20 commits behind origin (the box
  shows the same state in its journal). The office's own `dynamic.db` and
  `world.db` were read off the box. The office index was hydrated from the pool's
  town clone. The box flags were set: `WORLD_MOVEMENT_V2`, `WORLD_PRESENCE`,
  `WORLD_APEX`, `WORLD_EMISSIONS`. `WORLD_STORE_READS` and `WORLD_STORE_SHADOW`
  are unset on the box, so `servedRead` is the fold.
- **Two clocks.** On Windows a git spawn costs 100–900 ms, so the local
  milliseconds are useful for COUNTS and ranking and useless as absolutes. Each
  command class was also timed on the box: a shell loop over the live world
  clone, 01:10–01:40Z, under the party's tail load. The box figures leave out
  Node's own spawn overhead, so they are lower bounds.
- **A second run with w39.13's ref memo applied** (614e869, world-branches half
  only; see "Premise" item 1) shows what is still left on the path in production
  today.

## Premise: what the brief assumed and the measurement did not bear out

1. **The w39.13 ref memo is not in this base.** 614e869 is on `origin/main` and
   `release/2026-w39.13` (running on the box). It is not in `train/2026-w40`.
   Its world-movement half does not even apply to w40's world-movement.mjs,
   which has moved 267 lines since.
2. **`town-bridge.mjs` is not on any read path.** Both of its sync calls
   (`townLockHeld` → `flock`, `isAncestorOfHead` → `git merge-base`) are reached
   only from the drain. Nothing outside the file imports either one, and the
   probe never saw them.
3. **`world-serve.mjs`'s own synchronous git has no production caller.**
   `publishedMainSha` (`world-serve.mjs:289`) is read only by tests. Its read-path
   cost arrives through `blessed()` in world-branches (`servedCanonSha`,
   `worldStoreHealth`). With the store flags off, `servedRead` returns the fold
   before anything else runs.
4. **The per-request walk-ledger read is real.** `world.mjs:357`
   `walkLedgerAtMain` runs `mainRef` (1–2 `rev-parse`) and then
   `git show refs/heads/main:WORLD/walk-ledger.md` (43 KB, frozen) 2–4 times per
   doorstep, walkers or keyed world read.
5. **The largest single git door is not world-branches.** It is
   `GET /world/settlements`, which runs `settlements.mjs:readSettlementTags`: one
   `rev-parse --show-toplevel`, one `git tag`, then `rev-parse --short` plus
   `git log -1` for EACH tag. That is 168 spawns per request, **567 ms per request
   on the box** (one `for-each-ref` answers the same question in 12 ms). The box
   logged 311 of these between 21:00 and 24:00Z on the Snug night. settlements.mjs
   is outside this lane.
6. **With the memo live, the office's remaining freeze is mostly JavaScript,
   not git.** At 01:07Z the live office sat at 100% CPU and `/release` timed out
   3 of 3 at 20 s. In 60 samples of its child processes (every 250 ms), a git
   child showed 4 times. The big remaining cost is `publishedState` (item 7),
   whose git show is brief and whose `JSON.parse` of a 1 MB file is not.
7. **`publishedState` re-reads and re-parses the whole world-state on every
   call, even when nobody needs it.** `world.mjs:145` `world()` calls
   `publishedState`, which runs `git show <blessed>:WORLD/world-state.json`
   (1,033,684 bytes) and `JSON.parse`s it. Only then does `world()` check its
   cache by sha, and on a hit it throws the parsed state away. Measured: **44
   times per `GET /world/present`**, 6 per doorstep, about 6.5 per `/world/apex`.
   Several comments in world.mjs and world-stance.mjs call this "one cached JSON
   read". It is not cached.

## The inventory

Reading the columns: **calls/req** is how many times one request reached the site
(base, and with the memo). **Local** is the mean per call on Windows. **Box** is
the per-call cost of the same command class on the box. Unless noted, every row
is `execFileSync("git", …)` through `world-branches.mjs:44` `git()`.

### world-branches.mjs (this lane's file) — all of the git on the read path except settlements

| # | Site (reader → git) | Reached from (calls/req base → memo) | Local ms | Box ms |
|---|---|---|---|---|
| 1 | `freshestMainRef` :262 → `refExists` ×2 (:264–265), `rev-parse` both mains (:268), `merge-base --is-ancestor` when they differ | via `blessed` on every world read: /world/present 32.7, mcp world (keyed) 16, /world/apex 10.7, doorstep 8, /household 8 → **0 with memo** (a stat stamp) | 290–330 | 2–3 each |
| 2 | `blessed` :318 → `rev-parse main` (:320) + `for-each-ref refs/tags/settlement/` (:324) | `publishedState`, `blessedRef` (engineDir, world2-serve, world-happened), `servedCanonSha`: /world/present 29.7, mcp world 7, apex 6, doorstep 5 → **0 with memo** | 270–360 | 2 + 6 |
| 3 | `readJsonAtRef` :385 → `git show <blessed>:WORLD/world-state.json`, then `JSON.parse` (1 MB) — from `publishedState` :675 | `world()` world.mjs:145, world-stance :561, doorstep-stakes :67, world2-guards :316, town-marks, world-journal, household-media: /world/present **44**, apex 6.5, mcp world 7, doorstep 6.3, read_doorstep 6, household 6 (**unchanged by the memo**) | 360–610 | 7 + parse ~8 (local parse 7.8) |
| 4 | `materializeAtRef` :365 → `rev-parse <ref>^{commit}` (:369); the extraction itself is cached by sha | `engineDir` world.mjs:113, `worldToolModule` dynamic-entities :120 (TTL), world2-serve :154: doorstep 2.5, /household 4, walkers 2, mcp world 3 | 380–635 | 3 |
| 5 | `mainRef` :135 → `refExists` ×1–2 | `walkLedgerAtMain` world.mjs:357, households.json reads world.mjs:2602/2816, world-stance :290: doorstep 2.2, /household 4, mcp world 3 | 360–570 | 3 |
| 6 | `readAtRef` :180 → `git show refs/heads/main:WORLD/walk-ledger.md` (43 KB, frozen) | `walkLedgerAtMain` world.mjs:357 ← departures world.mjs:405: doorstep 2, /household 4, mcp world 3, walkers 1 | 310–430 | 3 |
| 7 | `draftRefForHousehold` :141 → `refExists` ×2 + `rev-list --count` ×2 (:157–158) | a keyed read with a pen branch: `draftDeltaForKey` (/world/my-marks, world_my_marks), world.mjs:2263 notes (mcp world keyed) | 460–650 | 3 + 7 + 7 |
| 8 | `draftDeltaForKey` :725 → `rev-parse` base, `merge-base`, `diff --name-status`, `show` per changed mark, `rev-parse` draft | world2-guards :310 ← /world/my-marks, world_my_marks: 1 each per request, plus 1–2 `show` | 520–930 | 3 + 18 + 3 + 3/mark |
| 9 | `publishedSkeleton` :691 → `blessedRef` + `git show <blessed>:WORLD/skeleton.json` | `world()` on a cache miss only | — | 4 |
| 10 | `foldedStateAtRef` :612 → `rev-parse`, `tar -xf`, `node marks-fold.mjs` (~6 s on the live world) | world-forecast only; no read door in this run reached it | — | — |

### Outside this lane (named, not changed)

| Site | Reached from | Measured | Owner |
|---|---|---|---|
| `settlements.mjs:111` `readSettlementTags`: `rev-parse --show-toplevel`, `git tag`, then `rev-parse --short` + `log -1` per tag | `GET /world/settlements` (server.mjs:1411) | 168 spawns/req; local 49–80 s/req; **box 567 ms/req** (12 ms as one `for-each-ref`) | settlements.mjs |
| `queries.mjs:263` `residentList`: `SELECT handle, json FROM residents` (the whole roll) | every MCP `world`/`world_*` call (`rollFor`, mcp.mjs:549), /town, /residents | 1 per request, ~110 ms local | queries.mjs / mcp.mjs |
| `queries.mjs:1519` (the roll again) + about 10 small `get`s | every doorstep (doorstep-bundle.mjs:67) | ~106 ms + 6 ms each, local | queries.mjs |
| `world-movement.mjs` `storedDepartures`: re-reads the movements table per listener | `/world/say` `heardBy` (a WRITE door); 43% of the 09-26 profile | memo on main only; the w40 half does not apply | world-movement.mjs |
| world-classes.mjs, world-apex.mjs :1468, world-frames.mjs, dynamic-store.mjs, dynamic-entities.mjs — `DatabaseSync` opens + reads of world.db / dynamic.db | apex, present, walkers | ≤ 20 ms max per call, ≤ 1 ms typical, local | theirs |
| world-journal.mjs :1150/:1174 (`show filing-freeze.json`, `ls-tree WORLD/marks`) | `filedPathOfAt`, from my-marks and leave-mark previews | not reached as a separate site in this run | world-journal.mjs |
| world-happened.mjs :318/:325 (`git log --grep`, `git tag --contains`) | `latestSettlement` | not reached by a read door in this run | world-happened.mjs |
| mark-receipt.mjs :415, media.mjs :519, edit.mjs, write.mjs, the `*-exec.mjs` family, world-drain, town-drain, first-idea-sweep | write/act doors and the tick | not on a read path | theirs |

**An external caller: the site refresh's doorstep sweep.** On the box,
`postmark-site-refresh` (extract-town) reads every resident's doorstep one at a
time, each with a 30 s timeout, and when the bulk letters door is slow it falls
back to per-resident reads. On the Snug night that was 80+ timeouts at 00:2xZ
while the office was saturated, until its timer was stopped at 00:30Z (Keemin's
comment on POS-263). Each of those doorsteps pays rows 2–6 above. The refresh
is not this lane's to change. Its load is named here because it lands on the
same event loop.

## Per door: synchronous calls per request, base → memo

From the probe. Local milliseconds are for ranking only.

| Door | base calls/req | memo calls/req | box telemetry, 09-26 21–24Z |
|---|---|---|---|
| GET /world/settlements | 168 | 168 | 311 req, avg 1.66 s |
| GET /world/present | 197 | 54 | 1,041 req, avg 351 ms |
| MCP world (keyed resident) | 133 | 65 | 856 req (all world calls), avg 9.7 s |
| GET /doorstep/{h} | 104 | 66 | 748 req, avg 2.8 s, max 68 s |
| MCP read_doorstep / household doorstep | 98 | 63 | — |
| GET /world/apex | 96 | 52 | 229 req, avg 7.1 s |
| GET /household | 87 | 47 | — |
| GET /world/my-marks, world_my_marks | 26–28 | 11–13 | 125 req, avg 7.6 s |
| GET /world/walkers, world_walkers | 20–21 | 5–6 | 464 req, avg 392 ms |
| GET /residents/{h} | 11 | 9 | 1,236 req, avg 892 ms |
| GET /world, /world/state, /world/skeleton | 6 | 1 | — |
| GET /release, /, /me | 0 | 0 | — |

The box's figures are wall time. They include the wait for a blocked loop, which
is why a 0-call door like `/release` answered in 15–60 s on the Snug night.

## What part 2 takes, from this

Every git row above except settlements goes through one helper in
world-branches.mjs, and every answer it gives is a function of the refs, which
change only when a fetch, push, tag or settlement moves them. So one background
refresher owns the refs (one `for-each-ref`, async), the ancestry questions
between them (async, keyed by the two shas) and the hot blobs at the resolved shas
(world-state, skeleton, households at the blessing; the walk ledger at main).
The readers answer from that memory. A blob read at a sha that is not
warmed is kept by sha once read, because a sha's content never changes. Rows 1–7
leave the request path, and so does row 8's ref and ancestry half.

Left alone and reported: settlements.mjs (the largest single git door), the roll
reads in queries.mjs, and world-movement's departures (not this lane's file, and
the w39.13 half needs a merge).
