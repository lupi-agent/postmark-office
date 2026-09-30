# office.db into the store: the shape (POS-268)

Plumb, 2026-09-29/30, lane `retire-sqlite-index`. **For Keemin's read before anything merges.** Nothing here touches the box.

## In one paragraph

office.db's 21 tables move into Postgres as `town_*` tables, one for one, with each row's JSON kept as text so every door's answer stays byte-equal. A new ingest (`world2/tools/town-index-ingest.mjs`, the `law_ingester` pen) keeps them current. It seeds once from a full derivation. After that it only applies the town commits since its head. When those commits include a crossing, it stops at the crossing's seal commit and records a **snapshot** there, then applies the rest as the **delta**. Readers move to the store one door at a time behind `TOWN_INDEX_READS=store`, each with an equality test against office.db. hydrate.mjs, the rehydrate unit and the swap path go only once every reader has moved.

## What I measured first (these change the brief's premise)

1. **The 16-minute rebuild is SQLite committing each row, not the derivation.** On office-3, at town `6f66d21e8` (213 residents, 10,730 letters, 47,891 history rows), hydrate.mjs took **10m45s**. The same file with one `BEGIN`/`COMMIT` took **16s**, and all 21 tables hashed identical. The derivations alone come to about 14s: `readTown` 2.1s, the full `git log` 0.9s, and **mail_state 10.0s** (the town's `mailState` runs once per resident over every letter). Every other fold is under 0.4s. (Proofs: `G:/Starstory/docs/2026-09-29/rail/retire-sqlite-index/proofs/`.)
2. **The town has no settlement tag.** The store's `settlements` table records the WORLD's `settlement/S<n>` tags. The town's fixed point is the **crossing**: every 00:0x and 12:0x UTC the Postmark Pen commits `ferry: N delivered`, `mint: crossing pass`, `quests: crossing leaderboard` and last `seal: re-seal at the crossing`. That regularity was measured over 09-26 to 09-30. The seal commit is the snapshot point.
3. **The town's projection pen is parked.** `law_ingester` already projects the town (`stamp-ingest.mjs` → `stamp_projection` + `town_roll`), but its unit has been parked since 08-31. The law pen was split off on 09-19; the stamp pen was not. This ingest gets its own mode and its own unit, so it wakes nothing that is parked.
4. **The stamp folds are additive; the rest are not.** Folding the whole ledger gives the same answer as folding up to the crossing and then folding the lines since, for `foldBalances`, `foldMintCount` and `foldStaked` (checked on all 649, 215 and 83 accounts across the 09-29 00:03Z crossing). The ledger's lines up to the crossing were byte-equal to the file at the seal. `mailState` is not additive: it groups conversations over the whole record.

## The law as applied

Every table states three things: what writes the **snapshot** (at the crossing's seal), what writes the **delta** (commits since), and what a **reader** sees at the seam.

- **One live copy, not one copy per crossing.** A snapshot is the tables *as they stood at the seal*, plus a row in `town_index_snapshots` (the seal's sha, when it crossed, and each table's row count and content digest). The delta is then applied in place. A reader always reads one table: the newest snapshot plus the deltas since. There is no union at read time. Keeping a full copy per crossing would be about 90 MB twice a day for reads that only ever ask about "now". If a door ever needs the town *as of* a crossing, that is a new ruling and a new table.
- **The ingest writes only rows that changed.** For keyed tables it compares a server-side `md5(json)` per key against the new derivation and writes only the rows that differ. Append-only tables only append. The gate test counts writes.
- **A restart reads the snapshot, not history.** The office holds no index of its own: it reads the tables. The ingest reads its head from `projection_heads['town-index']` and applies only `head..HEAD`. The one full-history walk is the seed, run once at install, in one transaction: about 16s.

| office.db table | Snapshot (at the seal) | Delta (commits since) | Reader at the seam |
|---|---|---|---|
| `repo_log` | rows up to the seal | **appends** `git log head..T` rows only | one table; the newest commit it holds is the head |
| `letters` | as at the seal | letters whose file a delta commit touched (a new outbox letter, the ferry's move to inbox, an edit), re-read and upserted if their md5 moved; `delivered_at` is set only if absent (the oldest add wins, as hydrate's does) | one table |
| `threads` | as at the seal | `buildThreads` over the letters; only threads whose row changed are written (a reply can merge two) | one table |
| `residents` | as at the seal | handles with a touched path under `WHITE_PAGES/<h>/` (ADDRESS, PROFILE, HOME, WINDOW, their mail) re-read; `last_active` = the newer of the stored value and the delta's newest non-inbox commit | one table; the roll memo keys on the head sha, not on a file stamp |
| `ledger` (mail) | lines up to the seal | **appends** the lines past the stored count; a changed prefix refuses and names the line (the ledger is append-only by town law) | one table |
| `mail_state` | as at the seal | recomputed **only for affected handles**: the parties of every thread that holds a touched letter, and of every new ledger line. About 47 ms each, versus 10 s for the whole town | one table |
| `stamps` (+ `stamps_minted`) | the folds at the seal | **additive**: fold the new stamp-ledger lines and add them per account (measured additive above); the prefix is checked | one table |
| `pots`, `funding_*`, `pot_*` | as at the seal | re-folded (46 ms) only when a delta commit touched `stamp-ledger.md` or a pot file; md5 diff | one table |
| `quest_progress` (+ `quest_day`) | as at the seal | re-folded (180 ms) when the town day rolls or a delta touched mail. It is a *today* fold, so its cost is bounded by one day's activity | one table; the day guard in `questBoardFor` is unchanged |
| `quest_standing` | as at the seal | re-folded (356 ms) at each crossing only, because its facts move at crossings; md5 diff | one table |
| `bulletin` | as at the seal | slugs whose `TOWN_BULLETIN/*.md` changed | one table |
| `regions`, `homes` | as at the seal | re-derived (under 50 ms) when `placements.json`, a `HOME/` or `REGION.md` changed; md5 diff | one table |
| `meta` | `as_of`, counts, `quest_registry` at the seal | `as_of` = the applied sha | the door's `X-Postmark-As-Of` names the store's head for a moved door |

**What is still whole-tree, and said so:** tonight's delta calls the vendored `readTown` once (2.1s) to read the *current tree*. That reads today's state, not history, and nothing re-walks `git log`. Only the touched keys are then written. Making `readTown` path-scoped needs the town to export `readResident`/`readLetterFile` (the vendored reader is upstream law, marked do-not-edit). That is a town-side follow-up I'd propose, not build.

## The store side

- **Migration `033_town_index.sql`** (this lane's ordinals are 033–036): the 21 tables with office.db's columns and names under a `town_` prefix, JSON kept as `text` (a `jsonb` column reorders keys, and every door serialises these objects whole), and `town_index_snapshots`. Collation: every `ORDER BY` a reader ports to the store uses `COLLATE "C"`, because SQLite sorts bytewise and Postgres' default collation does not.
- **Pen:** `law_ingester`, the repo-first projection pen, which already reads the town. It gets INSERT, UPDATE and DELETE on the `town_*` tables. These are index rows: every one can be rebuilt from the town repo by the seed. The rows go on 003's lawful list in the same commit. **Proposed for a ruling:** `office_api` is the other candidate (the keep tick already writes `settlements` as it). I chose the ingester because a projection of a repo is exactly its job under the three-pens law.
- **Readers:** `office_api` gets SELECT (read workers connect as it too).
- **Unit (files only):** `world2-ingest.sh town-index`, a third mode that uses its own refresh clone (`ingest-clones/town`, not the office's `TOWN_CLONE`, so it never takes the town lock), on `postmark-town-index.{service,timer}` at :05/:20/:35/:50. That is two minutes before the office's keep tick, which does not read these tables.

## Moving the readers

Behind `TOWN_INDEX_READS=store` (unset means office.db, as today). Rolling back means unsetting it; office.db and the rehydrate stay until the last reader has moved and a clean week has passed. Every store read is async, so each moved reader changes its signature at its callers, and those callers are named in the commit. The order goes from least entangled to most:

1. `repoLog` (GET /repo/log, `list_commits`), `regionList`/`regionOne` (GET /regions, `list_regions`), `home` (GET /homes/:h, `read_home`).
2. bulletin (`bulletinList`/`Entry`/`Teaser`, `psaFold`), then stamps (`stampsRoster`/`For`/`Detail`), pots and quests.
3. letters and mail (`letter`, `letterList`, `mailList`, `mailCorrespondents`, `mailAwaiting`, `search`, `metricsMail`).
4. residents and the doorstep last: `residentList` feeds the position doors' roll memo, and `doorstep` gathers six of the reads above.
5. The out-of-process readers (`declare-exec`, `join-bind-exec`, `earpiece-mail`, `write.mjs`'s recipient checks) open office.db themselves; they move with the residents.

Each door's gate is equality: the store is seeded from the fixture's office.db and both answers are compared deep-equal. Tonight's lane stops at a clean commit with whichever readers have moved, and says which remain.

## Gates

- Snapshot plus delta equals the full derivation: seed at a crossing's seal, apply to a later sha, and every table equals `hydrate.mjs` at that later sha (on a fixture town, and on the real town at `6f66d21e8`).
- The delta touches only changed rows: a test counts INSERT, UPDATE and DELETE per table.
- A restart reads the snapshot: a second ingest with no new commits writes nothing and runs no full `git log`.
- Each moved door's answer is unchanged.

These run on a real Postgres (embedded, found via `EMBEDDED_PG_DIR`). Without it the tests SKIP and say so; they never pass silently.
