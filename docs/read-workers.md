# Read workers: every cache, and how a worker learns it moved (POS-266)

`src/read-workers.mjs` hands admitted GET reads to N worker threads. Each worker
runs `src/server.mjs` as a read-role office that never listens, so each holds a
fresh copy of every module-level cache. There are three ways a worker's copy
stays true:

- **STAMP.** The cache is keyed on something the worker reads for itself: a
  file's mtime, a ref file, a table's count, a sha. A write on the main thread
  changes that thing on disk or in the database, and the worker's next read sees
  the new stamp. Nothing is sent.
- **MESSAGE.** The cache is main-thread RAM that a write moves in place. The
  write announces what moved (`announce(kind, payload)`), and the worker applies
  it (`onAnnounce(kind, fn)`). An announcement and the reads handed over after
  it ride one port, in order, so the worker applies the write before it answers
  any later read.
- **MAIN ONLY.** The answer is main-thread RAM and no message keeps a copy. The
  read stays on the main thread (`MAIN_ONLY_READS`).

## MESSAGE

| Cache | Moved by | Kind |
|---|---|---|
| `world.mjs § positionProjection` (POS-264) | the walk door, `recordMoved` | `position`: the governing record, as `recordOfMovement` builds it |
| `server.mjs` `INDEX` (office.db) | the main thread's reload | `index`: the worker runs its own `reloadIndex` now instead of at its next poll |
| `server.mjs` world.db caches (the five in the STAMP table) | the main thread's reload | `world-store`: the worker runs its own `reloadWorldCaches` now |

The projection's other writers (the enter door's set-down, any pen outside the
office) do not call in on the main thread either. The main thread and every
worker rebuild after `PROJECTION_MAX_AGE_MS` (60 s).

## MAIN ONLY

| Read | RAM |
|---|---|
| `GET /world/conversations` | `voices.mjs`: the voices window. A worker's copy hydrates the log once and never re-reads it. Teaching the window to take a message is a change to voices.mjs, which belongs to O1. |
| `GET /world/apex?read=say` | the voices window again: the listen is kept home by its query (`read-workers.mjs § listensToVoices`), as the MCP `world { read: "say" }` is by `mcpWorkerTakes`. The apex's other reads go to workers. |
| `GET /world/dynamic` | `channel.mjs`: `acts_by_channel`, counted per act |
| `GET /household` | the standing read's `world_writes`, the bouncer's live budget |
| admission (every request) | `bouncer.mjs` buckets, `berthHits`, `claimHits`, `oauth.mjs regHits`. The main thread admits a read before a worker sees it, and a worker's handler skips the bucket checks. |
| `GET /release`, `GET /ops/loop-lag`, `GET /`, the OAuth dance, `/keys/claim` | answered above the dispatch point, always on the main thread. `/ops/loop-lag` therefore measures the main thread only, and only the main thread writes `telemetry/loop-lag-<port>.json` (a worker's calm minute would otherwise overwrite the thread the roll call watches). |

## STAMP

| Module | Cache | Stamp |
|---|---|---|
| `server.mjs` | `INDEX` (office.db) | the file's stamp, polled every `OFFICE_RELOAD_POLL_MS` by each thread, and re-read at once on the `index` message |
| `server.mjs` | world.db swap: `world-serve _snap`, `world-graph _cached`, `world-frames _classSnap`, `dynamic-store _classSnap`, `world.mjs _places` | world.db's stamp, same poll, each thread, and at once on the `world-store` message |
| `server.mjs` | `_roll` (town roll) | the index stamp |
| `world-branches.mjs` | `refMemo`, `packedCache` | ref files and packed-refs, re-stat per read |
| `world-branches.mjs` | `contentCache`, `viewCache`, `gitDirOf` | a full sha (immutable) or the path |
| `world-refresher.mjs` | `REFRESHERS` | one refresher per thread, 1 s tick plus a re-stat per read. A ref move is re-asked by N+1 refreshers, not one. |
| `oauth.mjs` | `loginIndexes` | residents count, total length, max rowid, per db handle |
| `households.mjs` | `cache` | mtimes of the stamp ledger, households.json, github-ids.json |
| `world2-fold.mjs` | `cache` | the store fingerprint |
| `world.mjs` | `_worlds` | ref + sha |
| `world.mjs` | `_grid` | the projection's epoch (so it follows the MESSAGE row) |
| `world.mjs` | `_grounds`, `_byIds`; `world-movement.mjs` `_services`, `_hasVehicle` | WeakMaps on a world object |
| `world-stance.mjs` | `TEACH_CACHE`, `PHOTO_CACHE` | path, then the file's size and mtime |
| `household-posts.mjs` | `backingCache` (the ideas' backing, POS-293) | the town clone's path, then the stamp ledger's mtime and size |
| `dynamic-entities.mjs` | `_toolModules` | repo + file, re-checked against `freshestMainRef` after a TTL |
| `world2-claims.mjs` | `householdKeys` | positive answers only, learned by each thread from the store |

## Unkept on either thread (same staleness on main as on a worker)

These are not moved by any write in this process, so a worker is exactly as
fresh as the main thread:

- `world.mjs _walkClock`, `_mods`, `_where`, `_geom`; `votes.mjs engineCache`;
  `town-mail.mjs engines`; `world2-serve.mjs _engine`; `enter-exit-ledger.mjs
  _header`: engine modules imported once per process.
- `household-deriver.mjs loaded / answers / viaRows`: its header says every
  registry writer clears it, and nothing in `src/` calls `__clearHouseCache`.
  The registry's writers are outside the office, so the fold is per process.
- `world-journal.mjs _frozen / _pathIndex`: the frozen era.
- Static tables: `mcp.mjs _flat*`, `world-apex.mjs` schemas, `queries.mjs
  _questTools`, `bouncer.mjs formatters`.

## Per-thread resources

- **Postgres.** `world2-acts.mjs` opens a pool of `max: 2` per thread for acts
  and one for stances, so three workers add up to 12 connections.
- **git.** Each worker's refresher asks its own questions when refs move.
- **Memory.** Each worker holds its own folded world, its own projection and
  its own engine imports.
