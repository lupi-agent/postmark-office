# office.db into the store: the shape (POS-268)

Plumb, 2026-09-29/30, lane `retire-sqlite-index`. **For Keemin's read before anything merges.** Nothing here touches the box.

## In one paragraph

office.db's 21 tables move into Postgres as `town_*` tables, one for one, with each row's JSON kept as text so every door's answer stays byte-equal. A new ingest (`world2/tools/town-index-ingest.mjs`, the `law_ingester` pen) keeps them current. It seeds once from a full derivation. After that it only applies the town commits since its head. When those commits include a crossing, it stops at the crossing's seal commit and records a **snapshot** there, then applies the rest as the **delta**. Readers move to the store one door at a time behind `TOWN_INDEX_READS=store`, each with an equality test against office.db. hydrate.mjs, the rehydrate unit and the swap path go only once every reader has moved.

## What I measured first (these change the brief's premise)

1. **The 16-minute rebuild is SQLite committing each row, not the derivation.** On office-3, at town `6f66d21e8` (213 residents, 10,730 letters, 47,891 history rows), hydrate.mjs took **10m45s**. The same file with one `BEGIN`/`COMMIT` took **16s**, and all 21 tables hashed identical. The derivations alone come to about 14s: `readTown` 2.1s, the full `git log` 0.9s, and **mail_state 10.0s** (the town's `mailState` runs once per resident over every letter). Every other fold is under 0.4s. (Proofs: `G:/Starstory/docs/2026-09-29/rail/retire-sqlite-index/proofs/`.)
2. **The town has no settlement tag.** The store's `settlements` table records the WORLD's `settlement/S<n>` tags. The town's fixed point is the **crossing**: every 00:0x and 12:0x UTC the Postmark Pen commits `ferry: N delivered`, `mint: crossing pass`, `quests: crossing leaderboard` and last `seal: re-seal at the crossing`. That regularity was measured over 09-26 to 09-30. The seal commit is the snapshot point.
3. **The town's projection pen is parked.** `law_ingester` already projects the town (`stamp-ingest.mjs` → `stamp_projection` + `town_roll`), but its unit has been parked since 08-31. The law pen was split off on 09-19; the stamp pen was not. This ingest gets its own mode and its own unit, so it wakes nothing that is parked.
4. **mail_state is the one expensive derivation, and it is O(residents × letters).** The town's `mailState({ handle, letters, ledgerEvents })` walks every letter and every ledger event once per resident: 213 × 10,730 is 10.0 s of the 14 s, and it grows with both. The ingest must never pay it whole on a delta. It recomputes only the handles a delta touched, and a restart recomputes none (the table below; measured 68–75 handles over a twelve-hour crossing, 2 over a 33-commit delta). A whole-town pass happens once, at the seed. Making `mailState` itself incremental is the town's code, not this lane's.
5. **The stamp folds are additive; the rest are not.** Folding the whole ledger gives the same answer as folding up to the crossing and then folding the lines since, for `foldBalances`, `foldMintCount` and `foldStaked` (checked on all 649, 215 and 83 accounts across the 09-29 00:03Z crossing). The ledger's lines up to the crossing were byte-equal to the file at the seal. `mailState` is not additive: it groups conversations over the whole record.

## The law as applied

Every table states three things: what writes the **snapshot** (at the crossing's seal), what writes the **delta** (commits since), and what a **reader** sees at the seam.

- **One live copy, not one copy per crossing.** A snapshot is the tables *as they stood at the seal*, plus a row in `town_index_snapshots` (the seal's sha, when it crossed, and each table's row count and content digest). The delta is then applied in place. A reader always reads one table: the newest snapshot plus the deltas since. There is no union at read time. Keeping a full copy per crossing would be about 90 MB twice a day for reads that only ever ask about "now". If a door ever needs the town *as of* a crossing, that is a new ruling and a new table.
- **The ingest writes only rows that changed.** Every twin carries a `digest` (the md5 of the row as written). A delta reads keys and digests, never the rows, and replaces only the rows whose digest moved. Append-only tables only append. The gate test counts writes.
- **A restart reads the snapshot, not history.** The office holds no index of its own: it reads the tables. The ingest reads its head from `projection_heads['town-index']` and applies only `head..HEAD`. The one full-history walk is the seed, run once at install, in one transaction.

| office.db table | Snapshot (at the seal) | Delta (commits since) | Reader at the seam |
|---|---|---|---|
| `repo_log` | rows up to the seal | **appends** `git log head..T` rows only | one table; the newest commit it holds is the head |
| `letters` | as at the seal | every letter re-derived from the tree `readTown` already read; only rows whose digest moved are replaced (a new outbox letter, the ferry's move to inbox, an edit). `delivered_at`: the store's value for that path wins, and only a path first added in the delta takes the delta's time (the oldest add, as hydrate's) | one table |
| `threads` | as at the seal | `buildThreads` over the letters; only threads whose row changed are written (a reply can merge two) | one table |
| `residents` | as at the seal | handles with a touched path under `WHITE_PAGES/<h>/` (ADDRESS, PROFILE, HOME, WINDOW, their mail) re-read; `last_active` = the newer of the stored value and the delta's newest non-inbox commit | one table; the roll memo keys on the head sha, not on a file stamp |
| `ledger` (mail) | lines up to the seal | **appends** the lines past the stored count; a changed prefix refuses and names the line (the ledger is append-only by town law) | one table |
| `mail_state` | as at the seal | recomputed **only for affected handles**: the parties of every letter and thread that moved (before and after), of every new ledger line, and any resident with no row yet. About 60 ms each, versus 10 s for the whole town | one table |
| `stamps` (+ `stamps_minted`) | the folds at the seal | **additive**: fold the new stamp-ledger lines and add them per account (measured additive above); the prefix is checked | one table |
| `pots`, `funding_*`, `pot_*` | as at the seal | re-folded whole each delta (65 ms), written where a digest moved | one table |
| `quest_progress` (+ `quest_day`) | as at the seal | re-folded each delta, written where a digest moved. It is a *today* fold, so its cost is bounded by one day's activity | one table; the day guard in `questBoardFor` is unchanged |
| `quest_standing` | as at the seal | re-folded each delta (its onboarding facts move with a resident's own pages, not only at crossings), written where a digest moved. Progress and standing together: 0.5–1.1 s | one table |
| `bulletin` | as at the seal | re-derived from the tree, written where a digest moved | one table |
| `regions`, `homes` | as at the seal | re-derived each delta (under 50 ms), written where a digest moved | one table |
| `meta` | `as_of`, counts, `quest_registry` at the seal | `as_of` = the applied sha | a moved door adds `x-postmark-town-index-as-of` (the store's head); `X-Postmark-As-Of` stays office.db's while unmoved doors read it |

**What it costs, measured on the real town** (seed at the 09-29 00:03Z seal, then the 12:03Z crossing, 151 commits, then 211 more): each delta took about 12 s on this machine, of which `readTown` was 3.2–3.6 s, mail_state for 68–75 handles 4.2–5.0 s, residents 1.4–2.2 s, and the rest under 1.2 s. A fifteen-minute delta touches a handful of handles, so the floor is `readTown`. After both deltas every one of the 21 tables equalled a full hydrate at the same sha. The seed from a cold clone took 159 s, almost all of it the derivation reading a checkout nothing had read yet.

**What is still whole-tree, and said so:** each delta calls the vendored `readTown` once to read the *current tree*. That reads today's state, not history, and nothing re-walks `git log`. Only the touched keys are then written. Making `readTown` path-scoped needs the town to export `readResident`/`readLetterFile` (the vendored reader is upstream law, marked do-not-edit). That is a town-side follow-up I'd propose, not build.

## The store side

- **Migration `033_town_index.sql`** (this lane's ordinals are 033–036): the 21 tables with office.db's columns and names under a `town_` prefix, JSON kept as `text` (a `jsonb` column reorders keys, and every door serialises these objects whole), and `town_index_snapshots`. Every twin but `town_repo_log` also carries `digest`; `town_repo_log` carries `n`, a file's place in its commit (sqlite answered those by rowid, and Postgres promises no order). Collation: every text comparison and `ORDER BY` a reader ports to the store uses `COLLATE "C"`, because SQLite sorts bytewise and Postgres' default collation does not.
- **Pen:** `law_ingester`, the repo-first projection pen, which already reads the town. It gets INSERT and DELETE on the `town_*` tables and no UPDATE, like every projection in the store: a changed row is replaced. These are index rows: every one can be rebuilt from the town repo by the seed. The rows go on 003's lawful list in the same commit. **Proposed for a ruling:** `office_api` is the other candidate (the keep tick already writes `settlements` as it). I chose the ingester because a projection of a repo is exactly its job under the three-pens law.
- **Readers:** `office_api` gets SELECT (read workers connect as it too).
- **Unit (files only, parked):** `deploy/town-index-ingest.sh` on `postmark-town-index.{service,timer}` at :05/:20/:35/:50, with its own FULL clone (`ingest-clones/town-index`: the shared `town` refresh clone is `--depth 1`, and a delta needs history; not the office's `TOWN_CLONE`, so it never takes the town lock). Each run ingests every seal since the head with `--snapshot`, then origin/main. With no head it exits 3 and writes nothing: the seed is a hand step at install.

## Moving the readers

Behind `TOWN_INDEX_READS=store` (unset means office.db, as today). Rolling back means unsetting it; office.db and the rehydrate stay until the last reader has moved and a clean week has passed. Every store read is async, so each moved reader changes its signature at its callers, and those callers are named in the commit. The order goes from least entangled to most:

1. **Moved (2026-09-30), at their own doors:**
   - `repoLog` (GET /repo/log, `list_commits`).
   - `regionList` and `regionOne` (GET /regions, GET /regions/{slug}, `list_regions`).
   - `bulletinList`, `bulletinTeaser` and `bulletinEntry` (GET /bulletin, GET /bulletin/{slug}, `read_bulletin`).
   - `home` (GET /homes/{h}, `read_home`). Its freshness ladder is dated by the store's head, never a caller's `asOf`.
   - `stampsRoster` and `stampsDetail` (GET /stamps, GET /stamps/{h}, `read_stamps`).

   Each reader's row shape is an exported function in queries.mjs that both twins call; only the SQL is written twice. Two clauses changed in the office.db readers, both named:
   - `repoLog` breaks a tie in commit time by sha. Tied commits (47 on the live index) came back in the query plan's order, which differed with and without a date filter.
   - The holo join orders by `, r.seq`. This is the order sqlite already gave.

   The doorstep, the house bundle and household-stamps still read office.db's bulletin teaser, psaFold and stampsDetail. They move with the doorstep.
2. **Moved (2026-09-30), pots and quests:** `potBoard`, `questBoardFor` (a resident's board and the town's), `standingFor` and `townQuestBoard`, at GET /quests/{h}, `read_quests`, and household { read: "stamps" | "quests" | "fund" }. The row reads are split from the shapes (`potBoardRows`/`potBoardOf`; `questBoardWith` over a source that answers progressRow, standing, pots and potIds). household-stamps reads through an index (`officeIndex` or the store's `storeIndex`) that the door picks once, and a household read that is switched runs inside one READ ONLY transaction. The store's quest board reads its own `quest_registry` and `quest_day`, never a caller's office.db meta. The doorstep's next steps still call office.db's board; they move with the doorstep.
3. **Moved (2026-09-30), letters and mail:** `letter`/`letterAnswer`, `letterList` (with `regionResidents` and `officeHandles`), `mailList`, `mailCorrespondents`, `mailAwaiting`, `search`, `metricsMail` and `outboxSettled`, at GET /letters, /letters/{id}, /mail/{h}, /search, /metrics/mail, the MCP `list_letters`, `read_letter`, `list_mail`, `search_town`, `read_metrics`, and household { read: "mail" (inbox, outbox, awaiting, correspondents, pending) | "letter" }. Each shape is an exported function (`mailListOf`, `letterListPage`, `correspondentsOf`, `mailAwaitingOf`, `searchPage`, `metricsMailOf`). `search` keeps sqlite's LIKE exactly: ASCII case folded, no escape character. One difference, named: when a region filter matches one region by id and another by name, the store's `regionResidents` takes the id match, where sqlite took whichever row came first. Both are deterministic. A switched door whose reader throws answers a 500 and never rejects unanswered. The doorstep and the house bundle still read office.db's mail and move with the doorstep.
4. **Moved (2026-09-30), residents and the doorstep:** `residentList`, `residentPage`, `resident`, `townSummary`, `officeHandles`, `windowRead`, `psaFold` and `doorstep` with every segment, plus the composed reads that call them: the doorstep bundle, the owner gate, the house and needs-you, household address/home/window/doorstep/house/needs-you/standing, and the MCP read_town, list_residents, read_resident and read_doorstep. The composed reads take an index (`ix`) that the door picks once: `officeIndex` or the store's `storeIndexPooled`, each read in its own short transaction. **The roster is read once per ingest:** the store keeps each resident's roll line keyed on its own head, because the cards are ~125 KB each. The sync readers of the roll (the position doors, the MCP roll) read the handles the office's reload poll last loaded, null until the first load. One office.db reader change, named: `officeHandles` orders by handle.
5. The out-of-process readers (`declare-exec`, `join-bind-exec`, `earpiece-mail`, `write.mjs`'s recipient checks) open office.db themselves; they move with the residents.

Each door's gate is equality: the store is seeded from the fixture's office.db, and both answers are compared as the bytes the door sends (`test/town-index-reads.test.mjs`). At the door, three offices share one office.db, with the switch off, on, and on with the store gone. They must answer byte-equal, the switched office must name the store's as-of, and the cut-off one must return a 503, never office.db's answer (`test/town-index-doors.test.mjs`).

**Retiring hydrate.mjs, the rehydrate unit and the swap path waits for the last reader.** Everything in groups 2–5 above still reads office.db, and so does every doorstep segment.

## Gates

- Snapshot plus delta equals the full derivation: seed at a crossing's seal, apply to a later sha, and every table equals `hydrate.mjs` at that later sha (on a fixture town, and on the real town at `6f66d21e8`).
- The delta touches only changed rows: a test counts INSERT, UPDATE and DELETE per table.
- A restart reads the snapshot: a second ingest with no new commits writes nothing and runs no full `git log`.
- Each moved door's answer is unchanged.

These run on a real Postgres (embedded, found via `EMBEDDED_PG_DIR`). Without it the tests SKIP and say so; they never pass silently.
