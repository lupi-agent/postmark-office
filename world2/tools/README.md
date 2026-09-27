# `world2/tools` — the repo↔DB pens

Two of them are the `law_ingester` pen; the third is the standing guard that
holds their output to the repo; the fourth runs once, at the beginning. The last
runs the other way — it is the only one that reads the DB and writes the repo.

| file | what it is |
|---|---|
| `law-ingest.mjs` | the world-law repo → `law_projection` + `identities` |
| `stamp-ingest.mjs` | the town repo → `stamp_projection` |
| `falsifier-projection-equality.mjs` | re-derives from the checkout at `projection_heads.sha` and asserts equality |
| `seed-import.mjs` | the frozen sandbox settlement → `windows` + `claims` + `marks` (+ legacy `acts`) |
| `snapshot-export.mjs` | the DB → notary certifications, event archives and mark bodies in git (`snapshot_exporter`) |
| `standing.mjs` | 1.0's standing walk over `marks` rows — the library `clearing-job.mjs` step 7 recomputes with |
| `falsifier-standing-equality.mjs` | the port vs 1.0's own fold, slug by slug — and, since 2026-08-29, honest about the two states not being the same one: divergences the store-only ground explains are ATTRIBUTED with their cause named, not red |
| `falsifier-candle-tiling.mjs` | the candle's tiling invariant against the write paths that can break it — the same statement on either side of 011, on a throwaway database |
| `live-reads.mjs` | 1.0's movement/presence/sound/containment reads, ported to `acts` rows — what the LIVE doors serve |
| `falsifier-live-equality.mjs` | those ports vs 1.0's own imported functions, on identical inputs |
| `falsifier-pen-flip.mjs` | the FLIPPED pen's two laws (ruled 2026-08-29): reverse parity — every journal_seq-NULL act on a flipped lane has its reverse-mirror journal twin (iterates ACTS, the direction acts-parity is blind in) — and `--prove-refusal`, which points the pen at an unreachable Postgres on a throwaway sqlite and proves the refusal fires with the ruled sentence AND writes nothing anywhere (the R2 ordering, demonstrated not asserted). Lanes via `--lanes`; a vacuous green says so out loud. |
| `roll-ingest.mjs` | the town repo → `town_roll` (the roster the read tier asks; derives only — `stamp-ingest.mjs` writes it, one town head) |
| `materialize.mjs` | how a claim becomes a mark, and how standing is re-walked after — the clearing job's steps 6 and 7, shared with the REVIEW lane |
| `review-rule.mjs` | the operator's ruling on a `held_review` contest (census D2, "a mind rules") |
| `falsifier-review-closure.mjs` | a ruled claim ends in exactly one lawful state, with a receipt naming who ruled |
| `canon-register.mjs` | does canon carry this slug, and at which state — ONE predicate, two backends (`git` today, `fold` after G1), asked by the nightly read and by the review door's naming line so they cannot disagree. NOT asked at the candle: the lock-time refusal was ruled and WITHDRAWN the same day (2026-09-08), because the crossing's settlement pushes its mark files to origin three to four minutes AFTER the candle clears — seven crossings measured, never once before — so no checkout the candle can hold carries the marks its own crossing is locking (the header carries the table). There is no grace: `graceVerdict` / `GRACE_CROSSINGS` were dropped unpushed, dead by construction once every settlement is "late". It reads the WORLD CHECKOUT's own head, deliberately not `projection_heads['world-law']`: that pin is frozen by the 2026-08-31 parking ruling, and on 2026-09-08 twenty-six of the twenty-seven standing marks absent from it were on world main. |
| `canon-locks.mjs` | which STANDING MARKS the world carries no file for, with the claim that locked each (it walks `marks`, not `claims` — `claims.slug` is NULL on every seed-imported claim) — the judgement, pure, so it is testable without a store. A RETIRED mark is not a finding: that is the retire path's lane, already recorded. |
| `falsifier-canon-locks.mjs` | the standing read for postmark#2594 — the instrument that would have found the three on the day. Runs NIGHTLY on the notary rail — `world2-notary.sh`, 07:20 UTC (office#83; was 03:20), after the morning crossing has published — never on the clearing, whose checkout cannot yet carry the marks the crossing just locked (`test/box-rollcall.test.mjs` holds the clearing row free of this alarm). Its lists are `alarm_on_nonempty` on the `postmark-world2-notary.timer` row of the roll-call, and `escrow_checked:false` is that row's `alarm_on_false` — a read that could not run is never a clean town. `escrow_unbacked` lists only JUDGEABLE zeros: a commons mark locked at a window whose town sha the escrow projection holds no rows for (every window before 181, migration 014's first ingest) is UNJUDGEABLE — counted on the line as `escrow_unjudgeable`, the row's `report_counts`, printed and never alarmed; unavailable, never ✦0 (postmark#2935: 227 such marks read ESCROW-ABSENT every morning for eight nights while the true unbacked count was zero). Its RED does not fail the notary. |
| `conversations.mjs` | 1.0's thread derivation over voice `acts` — what `/world/conversations` becomes when the voices log dies |
| `falsifier-conversations-equality.mjs` | that port vs `voices.mjs` itself, on identical inputs, era by era |
| `falsifier-acts-lane-closure.mjs` | every WRITE lane reaches `acts`, checked from each lane's own pen — and a census that reds when a new act appears that nobody has ruled on. STANDING INVOCATION CARRIES `--since 2026-08-29T00:20Z` (the fix's lab deploy): exactly ONE act was lost before the lanes closed — wright's say at 2026-08-28T16:18:38.744Z, the lab's first witnessed act, which lives in voices-log.jsonl and never reached `acts`. The exclusion is dated at the deploy so it excuses only the pre-fix era and nothing after; the loss itself is recorded here, in the merge commit (87f4fe65), and in the epic — a red nobody can act on is a falsifier nobody reads (the discarded-draft lesson), but a loss nobody wrote down is worse. THE MIRROR EXPIRY IS PER LANE (DEC-2, ruled 2026-08-29): this tool and `falsifier-acts-parity.mjs` red past a lane's own backstop in `LANE_MIRROR` (`src/world2-acts.mjs`) and NAME the lanes, and the arena is exempt by P-143's ruling. A lane's obligation ends by removing its row — its read ports landed, its deletion ruled — never by moving a date. |

The law these implement is quoted verbatim in each file's header, from the gold
plan (`G:/Starstory/PULSE/gold-plans/postmark-world-2/postmark-world-2.md` §3, §4)
and the census ruling (`census.md`, decision 1 and the seams amendment). Read the
headers; this page is the operating surface, not the law.

## The pens, and the one they are not

`law_ingester` is **mechanical**. It has no judgment and no schedule
(gold §3): it fires on a law merge, parses, stamps every row with the commit sha,
and stops. The REVIEW lane — "a mind clears it" — lives entirely in the GitHub PR
flow, where a grant widening is visible in a diff. Nothing in this directory
decides anything.

Postgres agrees, and this is worth knowing before you reach for an `UPDATE`:

```
law_projection    DELETE, INSERT, SELECT      -- no UPDATE
stamp_projection  DELETE, INSERT, SELECT      -- no UPDATE
identities        DELETE, INSERT, SELECT, UPDATE
projection_heads  DELETE, INSERT, SELECT, UPDATE
everything else   SELECT
```

A projection is **replaced, never edited**, and the role cannot do otherwise. The
ingesters are written the same way — one transaction, DELETE for the sha then
INSERT — so the grant and the code say one thing.

## The stateless contract

Both ingesters take a checkout **as an argument** and treat it as read-only. They
do not create, fetch, rebase, clean, or write one, and the only git either runs is
`rev-parse HEAD` to check the caller's `--sha`. There is no state between runs:
every run is a full re-derivation of one sha.

This is gold §2's ruling, and its point is negative — it makes the month's whole
clone-pathology class (wedged rebases, ownership poisonings, stash and upstream
traps, ff-only freezes) *unrepresentable*, because there is no long-lived clone on
the box to wedge. The caller supplies a fresh shallow clone and throws it away.

A run whose `--sha` does not match the checkout's HEAD is **refused**, not
corrected. Every row carries `law_sha` and every candle window pins one; a
projection stamped with a sha it was not derived from would make the determinism
property ("every window's outcome is reproducible from `(claims, law_sha,
town_sha)`") a lie that nothing downstream could detect.

## Reuse, not re-implementation

Every parse is the source repo's own proven reader, imported live out of the
checkout being ingested — so the projection is derived by the same code the lint,
the fold, and the hydrator use, at the sha being ingested.

| what | reader | from |
|---|---|---|
| the marks register | `loadMarks` / `parseRecord` | world `tools/marks-fold.mjs` |
| threshold entry law | `termsAt` | world `tools/enter-exit.mjs` |
| what a class grants | `actionEntriesOf` | office `src/world-store.mjs` |
| the stamp ledger | `parseStampLedger` | town `tools/stamp-mint.mjs` |
| balances | `foldBalances` | town `tools/stamp-mint.mjs` |
| household keys | `currentHouseholds` | town `tools/stamp-mint.mjs` |

No balance math and no frontmatter parsing is written here. The town owns the
money grammar (a rule the world repo already states about itself in
`marks-fold.mjs` § load stakes); this obeys it from the office's side.

One predicate is **vendored** rather than imported, with its source file, line
range, and blob sha named at the definition: `isClassDeclaration`, which the world
keeps private inside its lint CLI. It is four lines.

## Running them

Requires the office's own `node_modules` (`pg`, and `graphology` by way of
`src/world-store.mjs`), so run from an office checkout.

```sh
export PGHOST=localhost PGDATABASE=world2_dev PGUSER=law_ingester
export PGPASSWORD=…            # /etc/postmark-world2-dev.env, PG_LAW_INGESTER_PASSWORD

# a fresh shallow clone per run, discarded after — the stateless contract
git clone --depth 1 --branch world-2 https://github.com/keeminlee/postmark-world.git /tmp/law
node world2/tools/law-ingest.mjs --law-repo /tmp/law --sha "$(git -C /tmp/law rev-parse HEAD)"
rm -rf /tmp/law

node world2/tools/stamp-ingest.mjs --town-repo /tmp/town --sha "$(git -C /tmp/town rev-parse HEAD)"
```

`--dry-run` derives and prints the census without opening a connection.
`--json` makes the summary machine-readable.

**When the stamp ingester runs** (census seams amendment): on town merge, *and*
again as `clearing_job`'s first step at window close, then pin. Re-running a sha
is a no-op by construction, which is what makes both callers safe. A dead webhook
degrades only the door's advisory sufficiency read — never a clearing.

### The falsifier

```sh
node world2/tools/falsifier-projection-equality.mjs --law-repo /tmp/law --town-repo /tmp/town
```

Each checkout must be **at the sha `projection_heads` records** for its repo.
Exit codes: `0` equal · `1` drift (RED) · `2` cannot run.

There is no exit code for "checked nothing and found nothing". A falsifier that
could not compare must not report green — so a missing checkout, a mismatched
sha, or an un-ingested head all exit 2, loudly. It catches anything that moved a
row without the pen; it does not catch the derivation itself being wrong, because
it calls the same `deriveLaw` / `deriveStamps` the ingester calls. That is
deliberate and stated in the file: two derivations would make a green mean only
"both parsers agree", which is the weaker claim.

## The red-proof carries the run

A falsifier nobody has watched fail is not a falsifier. This is the recipe, and
it is the one that was actually run on `world2_dev` on 2026-08-28.

Because the ingester role holds no `UPDATE` on the projections, an in-place
hand-edit has to come from the owner — which is exactly the scenario the guard
exists for.

```sh
# 1 · green
node world2/tools/falsifier-projection-equality.mjs --law-repo /tmp/law --town-repo /tmp/town   # exit 0

# 2 · three kinds of drift, by hand
PGUSER=world2_owner psql -c "UPDATE law_projection
    SET data = jsonb_set(data, '{dials,pace_km_per_crossing}', '99999'::jsonb)
  WHERE law_sha='<sha>' AND kind='class' AND key='resident';"
psql -c "DELETE FROM law_projection WHERE law_sha='<sha>' AND kind='roster' AND key='wright';"
psql -c "INSERT INTO law_projection (law_sha,kind,path,key,data)
         VALUES ('<sha>','class','WORLD/marks/forged/mark.md','not-a-real-class','{}'::jsonb);"
PGUSER=world2_owner psql -c "UPDATE stamp_projection SET balance = balance + 1000
  WHERE town_sha='<tsha>' AND handle='wright';"

# 3 · red, naming each row
node world2/tools/falsifier-projection-equality.mjs --law-repo /tmp/law --town-repo /tmp/town   # exit 1

# 4 · repair is just running the pen again (idempotent; no repair path exists)
node world2/tools/law-ingest.mjs   --law-repo /tmp/law  --sha "$(git -C /tmp/law  rev-parse HEAD)"
node world2/tools/stamp-ingest.mjs --town-repo /tmp/town --sha "$(git -C /tmp/town rev-parse HEAD)"

# 5 · green again
node world2/tools/falsifier-projection-equality.mjs --law-repo /tmp/law --town-repo /tmp/town   # exit 0
```

What step 3 printed:

```
RED · world-law @ c701988f… — 3 drift finding(s)
  - law_projection DIFFERS at class/resident · field data · first divergence at char 926
    repo says: …ials":{"pace_km_per_crossing":60},"extends":"entity",…
    DB says:   …ials":{"pace_km_per_crossing":99999},"extends":"entity",…
  - law_projection MISSING in DB: roster/wright
  - law_projection EXTRA in DB (repo derives no such row): class/not-a-real-class
RED · town @ e671691a… — 1 drift finding(s)
  - stamp_projection DIFFERS at wright · field balance · first divergence at char 0
    repo says: 397
    DB says:   1397
```

Two more receipts from the same session, both worth keeping:

- The falsifier's **first** run against the live DB went red on 129 class rows,
  and it was a false alarm — `JSON.stringify` drops `undefined`-valued keys, so
  the derived row carried keys the stored row could not. Fixed at the derivation
  (`jsonSafe`), not in the comparator, because the deriver should return what the
  database will hold. A guard whose first firing is a false positive is a guard
  people turn off.
- `stamp_projection`'s balances were checked against the town's **own** report
  (`node tools/stamp-mint.mjs --balances`): `little-bird 454`, `limen 417`,
  `wright 397`, agreeing exactly.

## Row census on dev, 2026-08-28

> **Superseded as a description of the live database.** These are the numbers from
> the ingester lane's own run, kept because the red-proof above is written against
> them. `world2_dev` was rebuilt when 004 landed, and `projection_heads` now points
> at the FROZEN sandbox shas, not these — see § The seed → Row census for what the
> database currently holds.

World-law `c701988f9ff937661297a8acc87a48925ba3b37f`, town
`e671691a5bb7f24cecc0fe26cd51d6ffe5cd34a3`:

```
law_projection   257   class 129 · roster 102 · skeleton 8 · grant 16 · threshold 2
identities       102
stamp_projection 136   (134 holding stamps, from 8,017 ledger entries / 277 accounts)
```

The 16 grants are the whole of what the law affords: twelve on `resident`
(say, walk, enter, exit, leave-mark, withdraw, stake, unstake, give, drop, take,
note-to-self), `household/join`, `household/declare-stance-on`, `human/say`,
`berth/say`.

## What each `kind` is keyed by

| kind | key | data |
|---|---|---|
| `class` | the class name | the whole mark record the world's loader built |
| `grant` | `<class>/<action>` | `{ class, action, for, from }` — the door's own entry |
| `threshold` | the mark id | `termsAt(mark)`, verbatim |
| `skeleton` | the top-level JSON key | that key's value |
| `roster` | the handle | `{ household, login? }` |

`data` is the parser's own output, not a normal form invented here — with one
unavoidable edit: a mark record's `_dir` is an absolute path on whichever machine
parsed it, so it is dropped from `data` and its repo-relative form becomes the
`path` column, which is that column's whole job.

`identities` carries no `law_sha` — it is the **current** roster, not a per-sha
projection — so each law ingest replaces it whole inside the same transaction.
`law_projection` rows for older shas are kept on purpose: a candle window pins a
sha and must still be able to read the law as of that pin.

## Merge rulings (Wright, 2026-08-28 — the ingester jetto's 12 teed decisions)

The build's 12 decisions were reviewed at merge; three were substantive, ruled as follows, the rest accepted as clerical:

1. **`threshold` = the enter-exit entry law** (marks carrying `entry:`, data = `termsAt` output) — KEPT. The candle's 05:45Z/17:45Z times are `windows`' concern, not law rows. Caveat stands and is real: `tools/enter-exit.mjs` self-describes as pre-LOGOS; when the entry law is planted in LOGOS, the parser (and these rows) follow it — the projection tracks the reader that ships at the ingested sha, which is the design.
2. **`stamp_projection.balance` = LIQUID** (staked stamps excluded) — KEPT. Escrow sufficiency is exactly the liquid question; `foldStaked` gets a column the day a clearing computation actually wants assets (keep-simple: no speculative column).
3. **`identities` replaced whole per ingest (current roster, no sha column)** — KEPT for dev, with the named consequence (ingesting an older law sha rewinds identities). If replay-parity (phase 5) needs roster-as-of, that phase adds the sha column; not before.

Also noted at merge: `pg` resolved to `^8.16.3` (both lanes had added it); the falsifier's shared-derivation caveat (green = DB matches repo, not parser-verified) is accepted and stated in-file.

## The seed

`seed-import.mjs` runs **once**, before any pen has written anything, and turns the
frozen sandbox settlement into World 2.0's opening state. Gold §4 phase 2: *"seed
from the most recent settlement as if it were the only settlement."* Every mark
standing in the frozen register locks in ONE genesis window; no prior windows are
invented and no clearing is replayed. Replaying the real history is phase 5's job
and a different tool.

### The frozen sandbox, discovered

The dev channel's seed is a tag **pair**, both named `sandbox/seed`, both annotated,
each tag's message naming the other half:

| half | repo | tag → commit |
|---|---|---|
| world | `keeminlee/postmark-world` | `sandbox/seed` → `52c281b8312d0a1d36eb81d03fbd1a36840a4eb1` |
| town | `postmark-town/postmark` | `sandbox/seed` → `830a69963d8e4801ad4ed8bb80da38e79fd3fdbf` |

The world half is also `settlement/S47` — the same commit, `settlement: sweep 0
published, 0 unpublished`, committed `2026-08-26T05:45:16Z`. The tag message says
what it is: *"S47's certified pair (world half) — the dev instance resets here by
default. Retag to advance."*

### Which pen, and why the owner

`claims`, `marks` and `windows` belong to `office_api` and `clearing_job`. The seed
holds none of those pens: it connects as **`world2_owner`** because seeding is a
MIGRATION-class act — the schema's initial state, in the same class as the
`registry` INSERT that ships inside `001_tables.sql`. It runs once, before any pen
writes, and **nothing in the running town may ever call it**. That is the whole
justification for the owner connection and the only one.

### Running it

The stateless contract is the siblings': the CALLER supplies the checkout, already
at the tag; this tool never creates, fetches, checks out, rebases or cleans one, and
the only git it runs is `rev-parse`. A `--tag`/`--sha` that disagrees with HEAD is
refused, not corrected.

```sh
git clone --depth 1 --branch sandbox/seed https://github.com/keeminlee/postmark-world.git /tmp/frozen

export PGHOST=localhost PGDATABASE=world2_dev PGUSER=world2_owner
export PGPASSWORD=…            # /etc/postmark-world2-dev.env, PG_WORLD2_OWNER_PASSWORD

node world2/tools/seed-import.mjs \
  --world-repo /tmp/frozen --tag sandbox/seed \
  --town-sha 830a69963d8e4801ad4ed8bb80da38e79fd3fdbf \
  --with-acts
rm -rf /tmp/frozen
```

`--dry-run` derives and prints the census without opening a connection. `--json`
makes it machine-readable. `--strict` exits 1 if anything the checkout holds could
not be carried (see below) — for a caller that wants the gap to be a build failure.
`--upgrade` is the one sanctioned second run; it has its own section below, and its
own limit.

The whole import is **one transaction**: either the genesis state exists or none of
it does.

### The genesis window is discovered, not declared

Every field is a fact the checkout already states. The id is the highest
`STATE/log/<N>.jsonl` (*"the crossing NUMBER is the window id — the town's clock
survives"*), `opens_at` is that file's `.meta.json` `covers_from`, and `closes_at`
is the settlement commit's own date. A meta file that disagrees with its own
filename about the clock is refused. `status` is `closed`, because this window is
over — it produced the register being seeded. Opening window N+1 is `clearing_job`'s
act, not the seed's.

### What is carried (after 004)

The first cut of this seed carried 409 of the register's 960 records and said so
loudly. `004_marks_data.sql` — the ruling from those findings — gave `marks` and
`claims` a `data jsonb` and a `parent uuid`, made `geometry`/`bbox` nullable, and
put the law in a CHECK:

```sql
CONSTRAINT sited_marks_have_a_where
  CHECK (kind NOT IN ('sited','parcel') OR (geometry IS NOT NULL AND bbox IS NOT NULL))
```

*What stands IN the world has a where; what continues a parent does not.* With that,
the seed carries **every non-class record**: 831 of 960, the other 129 being class
marks, which are law and `law_ingester`'s pen.

Choices worth knowing, each stated at its line in the file:

- **ids are deterministic.** `uuid5(slug)` under a frozen namespace, not
  `gen_random_uuid()` — so two honest runs of the same tag are comparable row for
  row, which is what a snapshot diff and a replay-parity run need. It is also what
  makes a schema rebuild produce an *identical* world rather than a merely
  equivalent one.
- **one vocabulary.** The 1.0 `kind` rides verbatim into BOTH `claims.class` and
  `marks.kind` (`parcels_do_not_overlap`'s `WHERE` reads the latter), so the
  clearing job's future claim→mark mapping is the identity.
- **`data` is the record's remainder, not a second schema.** Everything a column
  does not hold — `date`, `tier`, `pre`, `derived_from`, `image`, `slot`, `value`,
  29 fields in all — plus the loader's own bookkeeping (`_fileAt`, `_origin`,
  `_stray`, `_parentMarkId`), exactly as law-ingest's `recordData` keeps it. One
  field is dropped on purpose: `_dir`, an absolute path on whichever machine
  parsed it, and the only field that differs between two honest checkouts.
- **`parent` is the CONTINUATION edge, never containment.** A predicated or naming
  mark is its parent continued, so it carries one. A sited or parcel mark does not:
  its containment is geometry, and since the freeze its directory is history —
  `WORLD/filing-freeze.json`: *"A mark's directory is its historical filing: it
  carries no claim, and it never moves again."* Reading `_parentMarkId` into
  `parent` for a placed mark would re-assert the edge the freeze retired. The
  tree's word is still readable, in `data._parentMarkId`.
- **a parent that does not resolve STOPS the seed.** A predicated mark with a
  missing parent is not a mark with an unknown parent; it is a record the register
  cannot explain, and a silent NULL would put a broken continuation into the world.
- **`points:` rings ride in `geometry`.** A ring is part of the claim
  (`marksContain` is coverage-honest when one is present), so dropping it would
  silently widen 21 marks — the five inland waters among them — to their bounding
  box. `bbox` stays the analytic rect, because that is what the constraint and the
  spatial index read.
- **`household` is the KEY, from `households.json`** — the same file `identities`
  is projected from. A handle the roster does not name gets NULL, not an invention.
- **legacy `acts` are translated shallowly, on purpose.** `action = 'legacy:<type>'`,
  `class = 'legacy'`, original event whole in `payload`, and `at_anchor/at_dx/at_dy`
  left NULL — a legacy event carries a raw world x,y, which is exactly the
  photograph the witnessed-line ruling refused; writing it into the anchor columns
  would forge a witnessed line nobody witnessed. A log line the seed cannot read
  stops the seed; it is never skipped.

### The one edge the schema cannot express

76 records are predicated on a **class mark** — every one of them `the-town`,
`tier: constitution`, standing inside `the-town/the-keeping-works`: the law's own
slot and engine records (`the-town/exposure-engine` on `the-town/exposure`, and so
on). A class mark's row lives in `law_projection`, so it has no `marks.id` and
`marks.parent`'s foreign key cannot point at it.

The column is NULL, and the edge is kept verbatim in `data._parent_is_law`, counted
in the run's census and listed in `windows.receipts`. It is a NULL that says why.

**This wants a ruling** and it is not the seed's to make: either `marks.parent`
grows a sibling that can name a law row, or these 76 are themselves law and belong
with the class marks in `law_projection` rather than in `marks` at all.

### Reseeding is refused — and the upgrade is a different word

Re-running is not a no-op the way the projection pens' re-runs are. Those write
`projection` tables and replace them whole; these are `source` tables, and `acts`
carries an append-only trigger. A DELETE here would be one pen performing another's
act. So a second run stops and names what is already there, and `--force-reseed`
exists only to print why there is no force.

`--upgrade` is the opposite operation and has its own flag. It overwrites no value:
it fills the columns 004 added (NULL until then) and inserts the de-sited marks the
pre-004 schema had no row shape for. Its guards are what keep that claim honest —
the genesis window must exist and its `law_sha` must match this checkout; every mark
already present must pass `verifySeed` over the pre-004 columns before a single row
is touched; and no row may already carry `data`.

**It cannot finish, and finding that out is worth more than the flag.**
`002_grants.sql`'s `claims_update_guard` refuses an UPDATE on a locked claim from
every role but `clearing_job`, and the seed connects as `world2_owner`. That guard
is right — a locked claim is the record of what was submitted and cleared — so the
upgrade refuses **before touching anything** rather than dying half-way, borrowing
another pen's role, or disabling a trigger:

```
--upgrade cannot finish: 409 locked claim(s) need data, and 002_grants.sql's
claims_update_guard refuses an UPDATE on a locked claim from every role but clearing_job
(current_user is 'world2_owner'). …
THE PATH IS THE REBUILD, and on dev it costs nothing: drop and re-apply
  world2/schema/001_tables.sql, 002_grants.sql, 003_falsifier_roles.sql, 004_marks_data.sql
then run the seed ONCE, without --upgrade.
```

Which is what was done, and why it costs nothing: every row is derived from a frozen
tag and the ids are deterministic, so a rebuilt world is identical to an upgraded one
*row for row*. `--upgrade` remains the right path for `marks` alone, and for any
future migration adding a column to a table whose rows the filling pen may still
touch.

### `--verify`, and the proof it can fail

```sh
node world2/tools/seed-import.mjs --world-repo /tmp/frozen --tag sandbox/seed \
  --town-sha 830a6996… --verify          # 0 equal · 1 drift · 2 cannot run
```

Same exit-code discipline as the projection falsifier, for the same reason: there is
no code for "checked nothing and found nothing", so an empty table or a missing
window is a finding, never a pass. It compares the window's pins, the locked-claim
count, and per-slug substance across **every** column the seed writes — `data` and
`parent` included — plus two claims-side checks, because a backfill that filled
`marks` and forgot `claims` must not read as green.

`--can-fail-proof` mangles inside a transaction on the verifier's own connection and
rolls back. Seven mangles, one per shape of drift a seed can suffer:

```
RED   after mangle: body of aion-solare/aelyria — 1 finding(s)
RED   after mangle: DELETE aion-solare/old-fig — 2 finding(s)
RED   after mangle: INSERT forged/not-a-real-mark — 2 finding(s)
RED   after mangle: data of aion-solare/aelyria set to NULL (the pre-upgrade shape) — 1 finding(s)
RED   after mangle: data of aion-solare/aelyria given a forged key — 1 finding(s)
RED   after mangle: parent of aion-solare/amber-window set to NULL (the continuation edge cut) — 2 finding(s)
  marks DIFFERS at aion-solare/amber-window · field parent
      repo says: 97d0fb4e-e229-52c4-8067-0674d7002ebd
      DB says:   null
  claims: 1 row(s) disagree with their mark about parent
RED   after mangle: a claim in the genesis window carrying no data (the un-upgraded shape) — 2 finding(s)
GREEN after rollback — the mangles left no trace

can-fail PROVEN: every mangle turned the verifier red, and rollback restored green.
```

The two claims-side findings are provoked from the side the owner can reach — an
INSERT, and a mangle of `marks.parent` — because `claims_update_guard` refuses the
obvious `UPDATE claims`. A check that cannot be made to fire is a check nobody
should trust; working around the guard to fire it would be worse than not proving it.

**The verifier's first live run went red on all 409 marks, and it was a false
alarm.** `jsonb` stores a value, not a document: it sorts object keys, so
`{"w":4,"h":6}` comes back `{"h":6,"w":4}`. Fixed in the COMPARATOR
(`canonicalJson`), not at the derivation — law-ingest's `jsonSafe` fixed a deriver
returning something the database could not hold; this deriver is right, and what was
wrong was a comparator asking about a serialisation when the question is about a
value. The same `jsonSafe` round-trip is applied to `data` here, and for the same
reason: `_explicitParent` is `undefined` on every mark that authored no parent, and
without it the census would report the storage round-trip as data loss.

### Row census on dev, 2026-08-28

World `52c281b8` (`sandbox/seed` = `settlement/S47`), town `830a6996`, after the
schema rebuild and one clean seed:

```
windows      1   id 150, closed, 2026-08-26T00:00Z → 05:45:16Z, law_sha + town_sha pinned
claims     831   all locked in window 150
marks      831   sited 343 · predicated 415 · parcel 66 · naming 7
                 409 placed · 422 de-sited (NULL geometry) · 346 carry a parent edge
                 76 carry data._parent_is_law (parent is a class mark)
acts     2,400   legacy — emission 1,603 · departure 754 · attachment 43, crossings 118–149

law_projection   257   class 129 · roster 102 · skeleton 8 · grant 16 · threshold 2  @ 52c281b8
identities       102                                                                @ 52c281b8
stamp_projection 134   (132 holding)                                                 @ 830a6996
```

`--verify` green; `--can-fail-proof` green; the projection-equality falsifier green
at both frozen shas. The register holds 960 records; 831 are rows and the 129 class
marks are law.

**`law_projection` now has rows at the seed's own sha.** It could not before:
`law-ingest.mjs` imported `tools/enter-exit.mjs` from the checkout, and at
`52c281b8` that reader was still called `tools/thresholds.mjs` (renamed at world
`e14a0bd7`, after the frozen tag). The two-name fallback landed on `world-2` at
`7516bf4d`, and the general lesson is worth keeping: *"reuse the readers, imported
from the checkout being ingested" is only sha-portable as far back as the reader's
current NAME goes.*

**`parcels_do_not_overlap` did NOT fire, and the constraint is armed.** All 66
frozen parcels are 25×25 and no two share so much as an edge. That the seed passed
is only evidence because the constraint was then shown to refuse:

```
BEGIN;
INSERT INTO marks (…) SELECT …, 'probe/overlapping-parcel', 'parcel', …, geometry, bbox, …
  FROM marks WHERE kind='parcel' ORDER BY slug LIMIT 1;
ERROR:  conflicting key value violates exclusion constraint "parcels_do_not_overlap"
DETAIL:  Key (bbox)=((4050,5051),(4025,5026)) conflicts with existing key (bbox)=((4050,5051),(4025,5026)).
ROLLBACK;
```

The same INSERT with `kind='sited'` is accepted — the constraint is parcel-scoped,
as written. **1.0 canon does not violate 2.0's overlap rule.**

### One thing phase 3 should look at

`standing_marks` now returns 831 rows, not 409, and 422 of them have NULL
`geometry`/`bbox`. The view was written as "the world-state.json successor" when
every mark in `marks` was placed. It is not wrong — a predicated mark IS standing —
but a consumer that expects a `where` on every row will now meet a NULL, and the
view has no filter to say which it meant. Flagged rather than changed: the view is
`001_tables.sql`'s, and what it should return is a phase-3 read-path question.

## Merge ruling — the 76 class-parented marks (Wright, 2026-08-28, seed2 pass)

A predicated mark whose parent is a CLASS mark (76 rows, all the-town tier-constitution
slot/engine records in the Keeping Works) keeps `parent NULL` with the edge verbatim in
`data._parent_is_law` — RULED as the durable shape, not a stopgap: a law-parent is a
different KIND of edge than a marks-parent, and folding both into one FK would be false
uniformity. If a consumer ever needs it as a queryable column, that is a 005-class
migration (`parent_law_key text`), teed then, not built now (keep-simple).

## The ledger backfill

`ledger-backfill.mjs` closes the A/B pass's two unmigrated-history findings. The
seed read `STATE/log/*.jsonl` completely — 2400 for 2400, all 33 crossings
bucketing row-for-row — but the journal is only the LIVE era. The town's earlier
record sits in two frozen files beside it, and the seeder read neither:

| file | rows | finding |
|---|---|---|
| `WORLD/enter-exit-ledger-frozen.md` (`WORLD/threshold-ledger.md` before the 2026-08-28 rename) | 155 crossings, each with its `word <welcomed\|neutral\|opposed>` | AB-P2 |
| `WORLD/walk-ledger.md` | 317 departures, 304 of them older than the journal's first row | AB-P3 |

Migration-class, like the seed: `--world-repo <checkout>` plus `WORLD2_PG_URL`
under the owner role, one transaction, `--dry-run` to get the receipt without the
write. It reuses the checkout's own `parseEnterExitLedger` and `parseWalkLedger` —
no second regex, which matters most for the enter/exit grammar, because it has an
era seam inside it (`at <n>` before 2026-08-26, `ferry <n>` after) that the
checkout's reader already handles on both sides.

**The consent word rides every crossing row.** The ledger's own header says why it
is stamped there: *"the MARK's side of the handshake … stamped as it stood at the
crossing (the walk ledger's `pace` precedent) so amending a law never re-derives a
crossing already made."* That is gold §3 rule 2's per-act determinism, already
practised by the 1.0 record, and until this pass none of it was in Postgres.

**Both ledger names are read; both files present is a refusal.** The
`sandbox/seed` tag predates the phase-0 rename and carries `threshold-ledger.md`;
world main carries `enter-exit-ledger-frozen.md`. Two files claiming to be one
archive is the twin phase 0 just killed, so the pen stops rather than guessing.

**`payload._ledger` is load-bearing, not decoration.** Before this pass, "a
`legacy:%` act" and "a row of the world journal" were the same set, and
`ab-compare.mjs`'s AB-P1 compared them by counting. The backfill adds a second
legacy source — 304 departures at crossings the journal has no rows for, and 155
crossings inside the journal's own era — so the unscoped count would report the
journal as mis-bucketed by exactly the number of rows the fix correctly added: a
false finding manufactured by a fix. The source stamp is what lets AB-P1 ask for
the journal's rows and AB-P2/AB-P3 ask for these. It is also what makes the
pre-journal boundary stable: it is computed from journal-sourced rows only, so it
does not move when this pen's own rows land behind it.

**The 13 overlapping departures are checked, not assumed.** The A/B report counts
304 of 317 as pre-journal. Trusting that arithmetic would be the wrong shape of
confidence, so each of the other 13 is verified present in `acts` on `(at, actor)`
before anything is written. A departure that is in neither record stops the run —
that is the seam class this backfill exists to close, and importing half of it
would certify a history with a hole in it.

There is no repair path and no `--force`. `acts` is append-only for every pen
including the owner (`002_grants.sql` `acts_append_only`), so a second run is
refused by naming the rows already there; if they are wrong the answer is
seed-import's — rebuild the schema and re-run both pens.

### What the backfill changed in `ab-compare.mjs`, and why

The probe is the judge, so editing it while making its findings go green deserves
its reasons in the open. Three changes, each forced by the data model rather than
by the wanted outcome, and all three still fail under `--self-test` (now 5/5
injected faults, up from 3/3 — AB-P2 and AB-P3 joined the list, because a check
that has never been green has never proved it can go red for the right reason).

**AB-P1 now scopes to journal-sourced acts.** It compared "rows of the world
journal" with "acts matching `legacy:%`" by counting, which was exact while those
were the same set. The backfill makes them different sets. Unscoped, the fix
itself would have reported the journal as mis-bucketed by the number of rows it
correctly added.

**AB-P2 now compares the frozen era to the frozen era.** My first edit widened it
to count `enter`/`exit` alongside `legacy:enter`/`legacy:exit`, and 30 live acts
from an office test run promptly made it print `-30 crossings have no act`. The
nonsense reading was the smaller half of the problem: that shape also let a LIVE
enter act mask a MISSING frozen crossing and keep the check green. It now compares
2.0's `legacy:enter`/`legacy:exit` against the door's own `frozen_acts`, and
reports the live lab acts beside it as the named delta they are.

**AB-P3 now asserts the claim instead of a proxy for it.** It asked "do any
walk-ledger rows predate `min(at)`?" — the right question while the answer was
304, and a question that CANNOT FAIL the moment one early row lands, because that
row moves `min(at)` behind all the others. A probe that goes green on 1 row of a
317-row import is not a probe. It now asserts that every departure in the frozen
ledger has an act, matched on `(at, actor)` — and counts multiplicity rather than
testing membership, because the ledger genuinely repeats one row
(`rook-of-garrison` at `2026-08-08T18:00:00.000Z`, written twice byte for byte)
and a Set would let a dropped copy hide.

### The closure falsifier's pairing key

`falsifier-acts-claims-closure.mjs` matched an act to its claim on
`data->>'_journal_seq'` alone, and went red on a database with nothing wrong with
it: `wright/lab-cairn` and `alpha/x` both carried `_journal_seq = 1`, so one act
was told it had two docket rows.

`journal_seq` is not an identity, and `001_tables.sql` says so in the column's own
comment — *"the journal truncates at each drain, so `(journal_seq, at)` pairs a row
only within its window"*. It is weaker even than that: a fresh sqlite journal
restarts the counter at 1 inside a window that is already open, so two unrelated
acts collide with no drain involved at all.

The act's `object` is the missing half — the `<by>/<slug>` identity the claim also
carries at `geometry->>'slug'`. Pairing on `(journal_seq, slug)` names *this act's*
claim rather than some claim with this number, and it is the truer statement of the
law being asserted: the question was never "does a row with this sequence number
exist", it is "did THIS submission reach the docket". A `--self-test` flag was added
alongside, ab-compare's idiom, so the check proves it can still go red.

> **Lab note.** `npm test` with `lab.env` sourced points the acts mirror at
> `world2_dev`, so a suite run writes its fixture acts (lucien, alta, sable at the
> town square) into the lab database. `acts` is append-only for every pen
> including the owner, so they cannot be removed and are not meant to be — the
> sanctioned reset is seed-import's own, rebuild the schema and re-seed. They are
> named on `KNOWN_LAB_ACT_ACTIONS` instead. Run the suite without `lab.env` unless
> you mean to write to the lab.

## The departure backfill — the four-day hole (POS-154)

`backfill-departures.mjs` is the ledger backfill's sibling one era later.
`acts` holds no departure between `2026-08-27T09:57:00.374Z` and
`2026-08-31T03:35:20.069Z`: the walk lane's pen was `dynamic.db/movements`
throughout, the journal those walks also reached was truncated by
`world-drain.mjs` before the journal era was seeded, and the acts mirror did not
begin carrying this pen until 08-31. One pen's rows exist in exactly one place,
and this tool is the only road from it.

Three counts, three questions — say which bound you asked:

```
440   at >= 09:57:00.374Z AND at <= 03:35:20.069Z   both bounds INCLUSIVE
439   at >  09:57:00.374Z AND at <  03:35:20.069Z   the OPEN gap
438   the rows `acts` actually lacks
```

The two that fall away are one event each, already filed: `fabel-of-garrison`
movement seq 773 **is** act 2918, the last `legacy:departure`; `little-bird`
seq 1212 **is** act 2941, the first `walk`, stamped 908 ms later by the mirror.
`movements.at` is when the resident declared and `acts.at` is when the mirror
wrote — different quantities wearing the same name, measured +908 / +413 / +407
/ +365 ms apart on four paired walks.

A derived row is `world.mjs § walkEntry`'s shape, field for field. Three columns
a movement row cannot carry land NULL and the file says so at length: the
witness stamp (`anchorAt` over the marks **as they stood**), the earshot list
(`presentNear`, not reconstructible), and the caller's resolved household. NULL
is this table's own shape for a walk act — `walk-exec.mjs:131` writes it on every
walk that pen files — and no departure reader selects any of the three.

**The apply is gated, and the gate reads the reader.** `governingDepartures`
takes the last row in `DEPARTURE_ORDER_SQL` order, which inside the non-ledger
era WAS the highest `acts.id`; `acts.id` is `GENERATED ALWAYS AS IDENTITY` and
the window's own ids are long spent on the 729 other acts that did land there.
So a backfilled row can only be appended, above every walk September filed — and
41 of the 52 actors in the gap hold a departure later than a row the plan
appends. A plain apply would have moved all 41 back to where they stood on
08-29, on the public doors, with nothing in the read path able to see it (the old
`assertDepartureOrder` passed: the rows ARE id-ascending).

**Ruled 2026-09-21 (Wright): "a departure's order is its INSTANT, never its
insertion id."** The clause as shipped, in `live-reads.mjs § the instant key`:

```sql
ORDER BY ((payload->>'_ledger') IS NULL),
         (CASE WHEN payload->>'_ledger' IS NULL THEN acts.at END),
         acts.id
```

The same `at, id` the runbook's D6 replay already uses for the holding rows
(POS-153/162). Measured a no-op twice over, in two eras: § the append order above
got "0 of 73" for era-then-id against by-instant on `world2_dev` before the walk
era existed, and POS-154 got zero instant inversions among 2,397 non-ledger
departure acts, all 2,397 holding position, zero governing departures moved. The
`CASE` keeps the ledger era on `acts.id` alone because that is the era whose own
comment says its file order is not its instants (the 08-08 sailing).

So the gate is now OPEN — it asks the clause rather than a flag, and stays in the
tool as the standing falsifier: revert the clause and the apply refuses again.
With the fill in, 0 residents move back, 8 move forward onto a newer leg, and 3
gain a first one. `PASSAGE_ORDER_SQL` deliberately does NOT take the instant key:
the ruling was about walks, passages were not measured, and that read keeps the
clause it has always carried.

Idempotence is `payload._backfill` + `payload._backfill_seq` — the underscore
per 017 — plus a one-sided, one-to-one instant pairing for the rows the mirror
already wrote. One-sided because the mirror writes after the declaration; 2,000
ms because 341 same-actor pairs in the store sit closer together than that and
the closest is 462 ms; one-to-one because a tolerance alone cannot separate them.
A contended act is a CONFLICT a person reads, never a duplicate filed in silence.

## The derived fields, and why the FOLD answers them

`tier` and `household` are not fields on a record. They are what the **fold** says
about a record once it has resolved the world, and `marks-fold.mjs:1031` publishes
both (`tier: markStanding(mk, byId)`, `declared_household: mk._cred`).

The first pass at the tier fix imported `markStanding` and called it on the raw
loader records. Closer, still wrong: it fixed 322 of 328 rows and the A/B probe
kept six red. `markStanding` reads three fields the loader never writes and the
fold does — `_cred` (the household grain), `_sovereign` (a sited mark wholly inside
its own household's parcel, where the walk STOPS), and `_containedBy` (the fold's
containment answer, preferred over the directory edge since the 2026-08-25 filing
freeze). Measured on the frozen checkout:

| stamped on the raw records | of the 6 residual rows, fixed |
|---|---|
| `_containedBy` alone | 0 |
| `_cred` alone | 2 |
| the fold | 6 — and it reproduces `world-state.json`'s `tier` **and** `declared_household` on 960 of 960 marks exactly |

So `seed-import.mjs` asks the fold (`foldOracle`) rather than re-deriving its
preamble, which would be the "second copy of this walk" `mark-standing.mjs`'s own
header forbids, one level up. The fold is an **oracle** here, not the record
source: `loadMarks` still supplies the rows, and the fold answers two questions
about them. It folds a **clone**, because `fold()` stamps its scratch fields onto
the records in place and `recordData` copies every non-column key into `data` —
folding the seed's own records would plant `_cred`/`_sovereign`/`_containedBy` in
831 stored rows. A test holds that.

## The household spelling (Wright's ruling, 2026-08-28)

**A roster owner keeps the household KEY (`gh:<id>`); a non-roster owner is
`solo:<handle>`, never NULL.** That is 1.0's spelling — the fold's
`declared_household` — and `identities` is the projection of the same file the fold
reads, so the register and the docket now give one answer.

The seed wrote NULL for every handle `households.json` does not name, reasoning
that inventing a key would be a fabrication. Right instinct, wrong fact:
`solo:<handle>` is not invented, it is the town's own answer, written in the fold
beside the comment that explains it — *"a handle in no declared household is its
own household; registry lag never blocks a new resident, it only leaves them
ungrouped until the town knows them."* NULL threw that answer away on 358 of 831
marks and left one column carrying three spellings of one fact.

Three surfaces were changed, and one deliberately was not:

- `seed-import.mjs` — derives it from the fold, so a future reseed is right from birth.
- `repair-household-2026-08-28.mjs` — trues the already-seeded `marks` rows in place.
- `src/world2-claims.mjs` — the live docket pen resolves through `identities`
  instead of writing the journal's bare handle. Only positive answers are cached:
  a household key is not a fact that gets taken away, but a MISS is the registry-lag
  case, and caching it would keep writing `solo:` for a resident the town had
  already learned.
- **`src/world2-acts.mjs` was NOT changed.** `acts.household` carries the same bare
  handle, and it should: that file is a *mirror*, and `falsifier-acts-parity.mjs`
  compares `household` between the sqlite journal row and its acts twin. Resolving
  the key there would turn a standing falsifier red for a cosmetic alignment. The
  acts-side spelling is a cutover question, to be settled when the journal dies and
  the mirror becomes the door's one write.

### Known residual: `claims.household`

The 358 NULLs in `claims.household` are **not** repaired, and this is the
substrate refusing correctly rather than a job left undone. `claims_update_guard`
(`002_grants.sql`) permits exactly one UPDATE from any role but `clearing_job` — a
pending claim going to retracted, fields untouched — and every seeded claim is
`locked`. Disabling the trigger, or `SET ROLE clearing_job`, would be one pen
performing another's act, which is the disease this migration exists to end.

The residual is honest and bounded: the shadow-era claims are the **seed's
synthetic submission record** — nobody submitted them; the seed wrote them so each
locked mark had the claim it would have had. The next full reseed writes them with
the corrected spelling from birth. Live claims written from now on are correct at
submit.

## The notary

`snapshot-export.mjs` is pen 4, and it is the only one in this directory that
runs the other way: it **reads the database and writes the repo, and holds no
credential that could write the database**. Gold §3 rule 2 names it —
*"`snapshot_exporter` (reads DB, writes notary certifications + event archives
into git — never writes the DB)"* — and §2 says what it is for:

> Certification → the repo, as NOTARY (the anti-bucket role): periodic certified
> snapshots binding (event-log cursor, content sha, law sha), signed and tagged.
> Anyone can clone and verify what was certified when; **the office cannot
> rewrite history without the repo catching it**.

It writes three surfaces in one commit, and **two of them are not the same kind
of thing**:

| surface | kind | what a second run does to it |
|---|---|---|
| `archives/acts/<window>.jsonl` | **archive** — one line per act, whole row, fixed field order | nothing. Ever. A regeneration that differs is a REFUSAL, named line by line |
| `WORLD2/marks/<slug>/mark.md` | **render** of DB-source (census decision 1) | rewrites it whole, including deleting files no row derives |
| `CERTIFICATION.json` | the binding | rewritten when its substance moves |

The asymmetry is the design: an archive is an **input**, a render is an
**output**. Gold §2's durability obligation is the archive's law — *"each closed
window exported append-only into `archives/` — machine-written but single-pen,
**frozen-on-write, an input never re-derived-into**"* — and it is the reason this
pen refuses rather than repairs when a closed window's export changes underneath
it. Each rendered `mark.md` says which kind it is in its own frontmatter, so a
reader who found it by cloning does not have to know this page exists.

### Which acts belong to which window

By the **crossing**, not by the clock: window N archives every act whose crossing
falls in `(previous closed window, N]`, and the genesis window — having no
previous — has no lower bound, so the legacy backfill rides with it.

Not by `at BETWEEN opens_at AND closes_at`, and the seeded genesis window is why:
its `opens_at` is the log meta's `covers_from` (`2026-08-26T00:00Z`), a fact about
a file rather than a crossing boundary, and every legacy act (crossings 118–149)
falls before it. A time bound would have archived an empty genesis window and
called it complete. The crossing IS the town's clock; the timestamps are evidence.

Acts beyond the highest **closed** window are not archived by anyone yet. They are
counted and named in the summary — a durability lane that silently held rows back
would be a backup with a hole in it.

### Running it

Same stateless contract as the ingesters, and for the same negative reason: the
CALLER supplies the checkout. This pen never clones, fetches, creates, checks out,
rebases, cleans or pushes one, and keeps no state between runs. It does commit and
tag **in** the caller's checkout — that is the pen's whole job.

```sh
export WORLD2_PG_URL="postgres://snapshot_reader:…@localhost:5432/world2_dev"
#                    /etc/postmark-world2-dev.env, PG_SNAPSHOT_READER_PASSWORD

git clone <the notary repo> /tmp/notary
node world2/tools/snapshot-export.mjs --target /tmp/notary
node world2/tools/snapshot-export.mjs --verify /tmp/notary --spot-check 200
```

`--dry-run` derives and prints without writing. `--json` makes the summary
machine-readable. `--allow-detached` is the only way past the detached-HEAD
refusal, and it exists because a tag can legitimately be the whole deliverable —
not because a detached push is ever safe.

Exit codes are the siblings': **0** green · **1** RED (drift, or the append-only
refusal) · **2** cannot run. There is no code for "checked nothing and found
nothing": no closed window, no `CERTIFICATION.json`, an unreadable target, or a
credential that could write the database all exit 2, loudly.

### The tag, and what "idempotent" means

One annotated tag per certification, `notary/<window-cursor>-<acts-cursor>`, whose
message **is** the certification body. The tag is written once and never moved.

Two honest runs of the same database differ by `exported_at` and by nothing else,
so that is the one field every comparison leaves out — otherwise "already
certified" could never be true and the notary would sign a new certification each
time it merely looked.

But **"already certified" is a claim about the target's FILES, not about the tag**.
A tag proves this state was certified once; only the files prove the checkout still
holds it. So a run against a tagged target still re-derives everything, and if the
checkout has lost or changed any of it, the pen rewrites it and commits
`notary: restore the state <tag> certifies` — leaving the tag alone. A tag whose
message certifies something *else* about the same cursors is the loudest finding
this pen can make, and it stops the run.

### What the certification binds

```json
{
  "acts_cursor": 2402, "window_cursor": 151, "marks_count": 832,
  "marks_content_sha": "sha256:…", "archives": [ { "window": 150, "lines": 2400, "sha256": "…" } ],
  "archives_sha": "sha256:…", "law_sha": "52c281b8…", "town_sha": "830a6996…",
  "exported_at": "2026-08-28T16:50:32.530Z"
}
```

`law_sha` and `town_sha` are the **latest closed window's own pins**, not a fresh
read — the certification says what the law was when the state it certifies was
cleared.

`archives` and `archives_sha` go beyond gold §2's list of three, on purpose: the
acts cursor alone binds the log's *length*. It would notice an act appended and
miss an act **rewritten**, and "the office cannot rewrite history without the repo
catching it" is the sentence this pen exists to make true.

The digest recipe is stated so a stranger with a clone can recompute it without
this code:

```
for each file, sorted by path:   sha256(bytes) + "  " + path + "\n"
digest = "sha256:" + sha256(those lines, concatenated)
```

### The red-proof carries the run

A falsifier nobody has watched fail is not a falsifier. These were run on
`world2_dev` on 2026-08-28, against a scratch local repo.

**Re-run against a real remote, 2026-09-03** (E1/DEC-7 gave the notary its own
push target). A clone pulled from `wright-starforge/postmark-world2-notary` onto
a machine that is not the box, checked against `CERTIFICATION.json` with **no
database consulted** — every archive's sha, the `archives_sha` over all of them,
and `marks_content_sha` over 873 mark bodies: **18 of 18 green.** The can-fail
flip: one byte changed inside `archives/acts/164.jsonl` in that clone turned it
red naming the file and its two shas, and restoring the byte turned it green
again. The same clone under `--verify --spot-check 200` reported the same 19
findings as the box's own checkout, finding for finding — the copy adds none and
hides none — with **0 disagreements across 919 archived lines read back against
`acts`**.

One trap belongs beside that green. Git converts LF to CRLF at checkout wherever
`core.autocrlf` is true, the Windows default, and a converted archive fails its
certified sha. The first clone went red on **every non-empty file and green on
every empty one**, which is the tell, and it looks exactly like catastrophic
drift. The repository carries a `.gitattributes` (`* -text`) so a plain clone is
byte-faithful anywhere.

**The append-only refusal**, which is the pen's whole reason to exist. Edit one
line of a closed window's archive and run the exporter again:

```
RED · the append-only archive lane refuses this run
  - archives/acts/150.jsonl is an ARCHIVE and already exists, and re-deriving it does not reproduce it.
    line 1200 differs at char 67
      on disk: …ssing":143,"actor":"hand-of-the-office","action":"legacy:emission",…
      derived: …ssing":143,"actor":"neth","action":"legacy:emission",…
    An archive is frozen on write (gold §2). This is drift and a FINDING — the notary will not overwrite it.
    Either the file was edited, or the office rewrote history in a window it had already closed. Both want a human.
```

The file's sha256 was identical before and after that run: a refusal that had
already written would be a refusal in name only.

**`--verify`**, six shapes of drift, each named, and green again after restore:

```
RED  archive archives/acts/150.jsonl does not match what the database derives — first divergence at line 97
RED  archive archives/acts/150.jsonl does not match the sha CERTIFICATION.json certifies for window 150
     (certified 1649bd71…, on disk 07f344ec…). This is the check a clone can run without a database.
RED  archive archives/acts/150.jsonl line 97 (acts.id 97) disagrees with its row · first divergence at char 80
       archived: …"actor":"forged-hand",…
       acts row: …"actor":"vermillion",…
RED  mark render DIFFERS: WORLD2/marks/aion-solare/aelyria/mark.md · first divergence at char 906
RED  archives/acts/999.jsonl is on disk but no CLOSED window derives it
RED  CERTIFICATION.json DIFFERS at marks_count · on disk 1 · DB derives 832
GREEN after restore — the mangles left no trace
```

And the credential guard, proven by holding the wrong pen:

```
CANNOT RUN · refusing to run as 'law_ingester', which holds write grants.
```

**Two findings came out of writing those proofs, and both are worth more than the
proof they cost.**

- **The first `--verify` red-proof was not a proof.** It mangled line 97 of a
  2,400-line archive and went red, which looked conclusive. Line 97 is one of the
  25 lines the sampler picks; line 98 is not, and the certification comparison is
  DB-derived-against-certified — it never opens an archive. An edit one line lower
  would have passed. `--verify` now compares every archive **whole**, against the
  DB derivation *and* against the sha the certification records; the spot-check
  stayed, because a moved digest cannot name the act, the field and both
  spellings, and that naming is what a human acts on. *A sampler is not a
  detector.*
- **`--target` used to accept a directory that was not a repo.** `git -C
  <not-a-repo>` does not fail; it **walks up** until it finds one — the walk this
  town has already watched reach a home directory and stage it. The pen now
  requires the target to be the repository *root* it resolves to. Found by a unit
  test that handed it a bare temp directory and got a toplevel back.

A third was smaller but the same shape: a run against a tagged target used to
answer "nothing new to certify" *before looking at the files*, so deleting an
archive from a certified checkout reported green and left the hole. That is where
the repair path above came from.

### The tests

`test/world2-snapshot-export.test.mjs`, 26 of them, no database — everything this
pen *decides* is pure with respect to Postgres, and the rows are shaped the way
`pg` hands them over (bigint and numeric as TEXT, timestamptz as `Date`, jsonb as
objects), because a test fed prettier inputs than the driver gives would prove
something about a different program. Each asserts a quoted sentence of law.

Three flips were run to prove they can fail: making the append-only check
overwrite silently reds exactly the two archive tests; rendering every string bare
reds the `data` test; dropping the repository-root guard reds the target test.

One of them, `pre: "true"`, is worth naming. `data` holds the STRING `"true"`, and
a frontmatter line spelling it bare would hand the next reader a boolean the
database never held — as `date: 2026-07-23` bare would hand them a YAML date
instead of the text a mark's frontmatter carried. The render quotes anything YAML
would read back as another type, and the test is what found it.

### Run census on dev, 2026-08-28

Against `world2_dev` (windows 150 and 151 closed), into a scratch local repo:

```
CERTIFIED · notary/151-2402
  archives/acts/150.jsonl   2,400 acts (the legacy backfill, crossings 118–149.92)
  archives/acts/151.jsonl       0 acts (a window that closed holding none)
  2 acts held back — crossing 155, their window has not closed
  WORLD2/marks/**/mark.md     832 files
  marks_content_sha  sha256:f346a162202344ece2ddc38a8baa4ad6ed472d6afad3cb010f935792f483f899
  archives_sha       sha256:e8c30c2ae51839d321db36559fcf441f61dbedc3696eb86d490474405cbda7f8
  law 52c281b8… · town 830a6996…   (window 151's own pins)
```

`--verify` green · second run idempotent, working tree untouched · the repair path
proven by deleting an archive and a mark from the certified target and watching
both come back with the tag unmoved.

### One thing phase 3 should look at

The render is a render of the DB row, not a reconstruction of the 1.0 `mark.md` a
human typed: `data` is emitted as itself, key-sorted, because it is *"the record's
remainder, not a second schema"* (the seed's ruling, kept). That is right for
fork-and-**read**. Whether anything should be able to fork-and-**parse** these back
into the 1.0 frontmatter shape is a read-path question, and it belongs to whoever
owns the viewer — not to the notary, which would otherwise be inventing a schema
for someone else's file.

## Merge rulings (Wright, 2026-08-28 — the notary's 10 teed decisions)

All ten KEPT as shipped. Named ones: (1) the certification's `archives`/`archives_sha` beyond gold §2's three fields — kept, the cursor binds length and §2's whole point is catching a rewrite; (2) acts-to-window by CROSSING, half-open, genesis unbounded below — kept, and seconded after review: it is the same clock the seed derived windows from, and a time bound would have called an empty genesis complete; (8) the notary's own commit identity — kept, a machine pen with one hand. The seed lane's git-date-format finding fixed at the deriver same merge (commitDate pins the format via Date, not the git version).

## Merge rulings (Wright, 2026-08-28 — the backfill lane's 11 teed decisions)

1/2/3 KEPT (acts mirror stays journal-spelled while the journal lives; locked claims' NULLs stand — the guard refusing its own operator is the law working; candle-proof's "darko" household stays as the honest receipt of the bug it records). 4 TEED TO KEEMIN: whether darko gets a households.json line (he appears as solo:darko while wright/rei fold to gh:67605380 — a roster call, 1.0 says the same). 5–8 ACCEPTED (the judge's three edits each reproved by self-test; the closure falsifier's (journal_seq, slug) identity fix was in-scope and right). 9: the ~43 leaked fixture acts are ACCEPTED as-is today; the sanctioned clean is the rebuild-and-reseed already planned as phase 5's first step (uuid5 determinism + all seeder fixes make it true from birth, closing decision 2's claims residual in the same stroke). 10/11 noted as standing items (POSIX-only path in settle-at-save.test; standardize the tools on WORLD2_PG_URL).

## The replay-parity gate

`replay-ingest.mjs` is phase 5 — the cutover gate. Gold `postmark-world-2.md` §4:
*"World 2.0 must ingest the settlements/events that happened on prod in the
meantime and reach the same output state."*

It is INGEST-AND-REACH, not re-adjudicate. Per settlement S(k) it derives the
era's acts and its claim set from the two checkouts, ingests both, runs the
**real** `clearing-job.mjs` on the window, and holds the standing register
against 1.0's at S(k) with `seed-import.mjs`'s own `compareMarks`.

```sh
git clone https://github.com/keeminlee/postmark-world.git ~/world-full   # FULL history

export PGHOST=localhost PGDATABASE=world2_dev PGUSER=world2_owner PGPASSWORD=…
export WORLD2_CLEARING_URL=postgres://clearing_job:…@localhost/world2_dev
export WORLD2_INGEST_URL=postgres://law_ingester:…@localhost/world2_dev

node world2/tools/replay-ingest.mjs \
  --world-repo ~/world-full --from-tag settlement/S47 --to-tag settlement/S50 \
  --town-repo ~/frozen-town
```

`--dry-run` derives and prints every era without opening a connection.
`--continue` verifies an already-replayed store instead of refusing it (only the
store's TIP is re-checkable — once S(k+1) has run, S(k)'s register has moved on
by design). `--can-fail-proof` mangles the replayed register inside a rolled-back
transaction and requires the gate to go red for each shape of drift.

### Where the eras come from, and the two receipts that can fail

The boundaries are facts of the record, not a hand-typed list: every
`settlement/*` tag between `--from-tag` and `--to-tag`, in commit-date order. The
window id is `genesisWindow`'s rule (the highest integer `STATE/log/<N>.jsonl`),
`closes_at` is the settlement commit's date, and `opens_at` is whatever the
store's open window already carries — 005's trigger owns it.

**The era's acts are a MULTISET DIFFERENCE, not the new files.** 1.0 appends to a
crossing's log *after* the settlement that precedes it: S48's tag sits on
`crossing-save 151`, whose commit puts 34 rows into `150.jsonl`, a file that was
already there at S47. Multiset for AB-P3's reason — the record genuinely repeats
a row, and a Set would let a dropped copy hide.

### An era is one PUBLISH, not one tag (F-5, 2026-09-04)

The Worldkeeper mints a `settlement/S<n>` tag when his **judgment** lands; the box
publishes at every crossing and on demand between them, committing a
`settlement: sweep N published, …` each time with its own six-count. Those were
the same thing through S50 and have not been since — **seven publishes sit between
the S50 and S51 tags**. Pairing tags derived six sweeps' worth of claims against
the seventh's receipt and filed every retirement at the last window instead of the
one it happened at.

`erasBetween` now walks `--first-parent` and takes every commit whose subject is a
sweep. Tags remain the range's ends, the seed's floor, the parity oracle's
checkpoints, and the name an era wears when it has one. Measured over S47 → S55:

| | eras | receipt agrees | disagrees | uncheckable |
|---|---|---|---|---|
| tag model | 8 | 2 | 5 | 1 |
| publish model | 20 | 14 | 6 | 0 |

**A publish is not a window either, and that is the finding this lane leaves open.**
Five sweeps landed inside window 163 on 2026-09-01; windows 154, 156–158 and 166
closed with no sweep behind them. A *crossing* closes a window; a sweep publishes
into whichever one is open. `windowFindings` names every such departure and the
run refuses — the store clears exactly one candle at a time, and its own guard
would refuse anyway, but only after earlier eras had committed into an
append-only table.

**And the receipt gaps are not a boundary artifact.** `plantedByHand` counts how
many of an era's additions were put in the register by a commit that is not a
sweep, and `amendedByHand` does the same for its amends. Ninety-two additions and
eleven amends across S47 → S55 under the window model — one commit plants
twenty-two, another fifty. The founder's hand on `main`: no door saw them, no
sweep counted them. That is the exact mirror of DEC-15 case (b), which ruled his
removals; **his additions and amends are DEC-17**, below.

**The claim set comes from the settlement's own outcome** — the register diff at
S(k-1) vs S(k), read by `deriveSeed` at each tag, so a claim and the mark it
materializes are one record wearing two table names. Added → a claim; changed →
a claim carrying `supersedes`; **removed → a RETIREMENT** (DEC-15, ruled
2026-09-04). Where the hand behind the addition or the change is the FOUNDER's
own commit on `main`, the claim goes in `locked` and the mark materialises
directly (DEC-17, ruled 2026-09-04 — below).

That last one stopped the replay until 2026-09-04, and the refusal was right for
as long as it lasted: "the refusal exists so that the first one is seen." It was
seen on the first full-range dry run (S47 → S55), and DEC-15 is the ruling —
a standing mark that leaves the register is the revision family's **terminal
supersession** (founder-ruled 2026-08-19: *"the record leaves canon, its whole
life stays in the log"*), which the store already spells
(`marks.status IN ('standing','retired')`) and the door already performs
(`withdrawMarkViaOffice`). The replay marks the row `retired` at the era's
window, and the log keeps the whole life either way:

| case | what happened | what the replay writes |
|---|---|---|
| **(a)** withdrawn in the log | a resident's own `withdraw` act names the slug | nothing extra — that act **is** the retirement, already replayed |
| **(b)** the founder's hand | a commit on world `main` deleted the record; no door, no act | one `withdraw` by `the-town`, carrying `payload.retired_by = <sha>` and the commit's subject |

The old refusal's stated reason was **wrong on the record**, and the correction
matters: the six-count *does* have a transition for a standing mark leaving —
`(\d+) withdrawn`, which `sixCountOf` has always parsed. S55's receipt reads
`1 withdrawn`, and that one is `vermillion/the-track-garage`, whose `withdraw`
act sits in the era's log. Only case (b) — a hand on `main`, which passes no door
and enters no sweep — is genuinely uncounted, which is why the `published` check
is untouched.

**The refusal did not go away; it moved and got narrower.** A departure of any
*other* shape is UNRULED and its era cannot be written. Derivation classifies
every departure and `--dry-run` exits 1 naming them all, so one run shows the
founder the whole class instead of stopping at its first member.

### A mark may change hands — RE-IDENTIFICATION (DEC-16, ruled 2026-09-04)

The first unruled departure was not a departure. `the-town/the-lit-name` at S52:
world `17103dc37` *modified* the file rather than deleting it — `by:` changed,
and since a mark's id is `by` + leaf the slug refolded while the record stayed in
canon. The register reads one removal plus one addition for one record changing
hands.

DEC-16 rules it a **re-identification**: the same row keeps its `id`, `slug` and
`owner` move together, `data.formerly` keeps the old slug (a list — a mark may
change hands twice), and one `transfer` act by `the-town` names the commit. The
rejected alternative, retire-and-claim, costs the mark its escrow and its whole
history under the old identity, and orphans every by-id reference.

Three consequences worth stating outright:

- **The addition half is NOT a claim.** Left in the claim set it would derive a
  claim whose id is `uuid5(new slug)` and materialize a second row under the slug
  the transferred row is about to take. **1.0's own receipt confirms this**: S52's
  six-count says `4 published`, the replay derived 5 before DEC-16 and derives
  exactly 4 after it. A probe that could have failed, and did not.
- **An amend in the same era supersedes the OLD id.** A mark that changed hands
  *and* was edited carries one amend claim under the new slug whose `supersedes`
  is the standing row's locking claim — `was.id`, not a re-derivation from the
  new name, which no claim in the store carries.
- **`household` moves with the owner.** It is a substance column and nothing else
  would move it: the clearing job's step 7 recomputes `tier` and only `tier`.

**The tell is path identity OR a rename (M-8, ruled 2026-09-04 as plumbing under
DEC-16).** "Is the file still at its old path under a new id?" is the whole tell
for the Lit Name, whose file never moved, and not the whole tell for the record.
`61c5fdfbc` — *"the cake, the vault, and the cellar door pass from the-town to
wright"* — moves each file into the new owner's directory and changes its `by:`
in one commit. Git calls that a rename (R098, R098, R096); path identity cannot
see it, so three records changing hands read as three retirements plus three
additions and lost their ids. `renamesBetween` asks the whole `WORLD/marks` tree
once per era — a pathspec naming only the old path finds nothing, because a
rename is detected by comparing the two sides of a diff and the new path is
outside it. **The leaf must match**: a mark's id is `by` + leaf, so a move that
keeps the leaf changes only the owner half of the identity, and a move that
renames the leaf falls through to the retirement branch where an unruled shape
belongs. The removal is the gate — a rename that does not move the slug (world
`319aa3c`, `…/the-three-asks/<leaf>/` → `…/the-asks/<leaf>/` with `by:` unchanged)
never reaches the map at all. 1.0 has never had a **sweep** rename a mark file,
zero across the whole history, and the tell does not ask whose hand it was —
DEC-16 never has.

### A reference follows the ROW, not the NAME (ruled 2026-09-04)

> A claim's `parent` resolves through the STANDING row for the parent's slug,
> never through `uuid5(name)` — the same law DEC-16 already gives `supersedes`.

The rename half surfaced the case that made this reachable: a transferred mark's
**predicated children**. DEC-16's seam table says `marks.parent` "follows for
free … this is what the fixed id buys", which is true of the **store** — the
child's row still points at the parent's kept id — and false of the **oracle**,
which re-derives a child's parent from the parent's **slug** at every checkout.
`the-town/the-unlit-cake` keeps `a6cfdfdb…`; its child `the-town/the-lit-name`
derives its parent as `c4549660…`, a number no row carries, and
`marks.parent uuid REFERENCES marks(id)` (004) is not deferrable — so before this
rule the era was refused rather than written wrong.

**The reconciliation is in `eraClaims`, and it cannot be in `deriveSeed`.**
`deriveSeed` takes a checkout and no connection; it is shared with
`seed-import.mjs`, which runs before any store exists; and it **is** the parity
oracle — an oracle that consulted the store about this column could never
disagree with the store about it, which is the one thing an oracle is for. So the
resolution happens where the era's transfers are known and the claim is built.

The map is `Map(derived id → the id the row keeps)`, **owned by the caller and
threaded across eras**, because a transfer's consequences outlive its own era: a
child added under `wright/the-unlit-cake` three eras later still derives
`uuid5("wright/the-unlit-cake")`. It **chains** on insert, so a mark that changes
hands twice points at the original id and not at an intermediate name that no row
carries either. The dry run prints every claim it moved, with both numbers.

`012_reidentification.sql` is the schema half. It does not "make `slug` mutable"
— `UPDATE marks SET slug` was always legal — it enforces the half with teeth: a
trigger refusing any change to `marks.id`, because "every reference by id follows
for free" is true only while nothing renumbers the row. `--can-fail-proof` hands a
re-identified mark its old name back and requires the gate to go red at both
names.

**What DEC-16 does not carry: escrow.** The town's stake ledger keys every
position by the string `<mark slug>|<handle>`, in the *town* repo, outside this
store. A transfer cannot rewrite it, and the founder has already met this seam
and answered it by hand — the transferring commit's own words: *"Stake handled
first so no record orphans: wright's 1✦ unstaked … restake on
wright/the-lit-name owed after the next crossing refolds the id."* Unstake
before, restake after, is the current ceremony and the only answer with a
precedent.

### The founder's hand PLANTING is an ADMISSION (DEC-17, ruled 2026-09-04)

DEC-15 ruled the hand's removals. DEC-17 rules the other two faces, and it is
one act with three of them — `6b235216d` retires `the-town/pledges`, amends
`the-town/the-bounty-board` and `wright/furnish-ferrys-waiting-room`, and adds.
The ruling, verbatim:

> A founder's hand on main is an ADMISSION in every face — an added mark
> materialises directly (a claim LOCKED at that window by the founder's hand
> naming the commit, the mark standing), an amended mark supersedes directly
> (the same locked shape, `supersedes` the standing one), a removed mark retires
> (DEC-15). The clearing job never re-judges canon.

What it changes:

- **The hand is asked of EVERY era**, in `eraClaims`, not only of one whose
  six-count disagrees. That used to be a diagnosis of a number and is now a fact
  about a mark. It is not an optimisation that was undone for tidiness: windows
  157 and 158 held **no sweep**, so their receipt is never checked, the diagnosis
  never ran, and thirteen marks the founder planted derived as pending resident
  claims with nothing in the run naming them.
- **The claim goes in `locked`**, `decided_at` = the commit's own time (not
  `now()`; that claim was decided when the commit landed), with
  `data.locked_by = "founder"` and `data.founder_commit = { sha, subject, at }`.
  `claims.ruling` is deliberately **not** the home: 009's own comment says it is
  "a fact about a contest a mind was asked to settle, not a field every claim
  has", and an admission is not a contest.
- **The mark materialises in the era's transaction**, through
  `materialize.mjs`'s `materializeClaims` — the same function the clearing job
  and the review lane call, never a third way of turning a claim into a mark. It
  runs **last**, after the transfers and the retirements, because `marks.slug` is
  unique and a name this era freed must be free before it is taken.
- **The clearing job sees nothing to re-judge.** It selects `status = 'pending'`
  and nothing else, so a locked claim is invisible to it. The dry run prints the
  count per era rather than asserting it: *"of the N slug(s) the hand touched, 0
  would reach the clearing job as a resident's pending claim"*.
- **The receipt is unchanged.** 1.0 never counted hand plantings, so the
  `published` check still disagrees on exactly the eras it disagreed on before,
  and for exactly the reason the accounting line names.

`--can-fail-proof` gains DEC-17's own break: delete the mark an admitted claim
materialised (the register a still-pending claim would have left) and require the
gate to go red. It also *attempts* the ruling's literal words — flipping that
claim back to `pending` — in its own rolled-back transaction, and reports what
the store answers: `002_grants.sql`'s `claims_update_guard` exempts only
`clearing_job` and this pen connects as `world2_owner`, so an admission cannot be
un-locked from here at all.

The parity gate compares **standing rows only** (`standingOnly`): 1.0's register
is a set of files and a removed file leaves no row, while 2.0 keeps the row and
flips `status` — the same register said two ways. Both refusals survive the
narrowing: a retired row the register still carries reads MISSING in DB, and a
standing row the register lacks reads EXTRA in DB. `--can-fail-proof` un-retires
one retired mark and requires the gate to go red for it.

**`marks.data` carries three keys 1.0's file cannot** — `formerly` (DEC-16) and
`locked_by` / `founder_commit` (DEC-17) — so `dataFindings` names them
(`REPLAY_ONLY_DATA_KEYS`) instead of reporting a hundred rows of known provenance
as "a `data` that differs beyond tier", which is the line that means *the
materializer lost part of the record*. They are named and counted in
`provenance`, never silently filtered; everything else in `data` is still
compared, and `data.tier` stays **gated** on an admitted row like any other.

Two receipts hold the derivation to the town's own record, and one of them
already earned its keep:

| receipt | what it asks |
|---|---|
| the six-count | the era's claim count = the settlement commit's own `sweep N published` |
| the door | every `leave-mark` act in the era names a mark the claim set carries |

The six-count caught a phantom claim on the first run.
`berthillon/le-petit-berthillon` changes between S48 and S49 in exactly one
field — the FOLD's `tier`, `market → home`, because `berthillon/chez-antoine`
(someone else's new parcel) gives the standing walk sovereign ground to stop at.
Not a byte of its own record moved. Counting it would have submitted a claim that
resident never made, and put the era at 15 against the town's receipt of 14. So
`authoredSubstance` drops the two fields the fold answers (`tier`, `household`)
and the amend detector reads the authored record only. The parity check still
compares both — which is what turns the case from a miscount into finding 4 below.

At S50 the door receipt reads 4/4: the office journal's four `leave-mark` acts at
crossing 153 name `rook-of-garrison/vanguards-watchtower`,
`little-m-of-garrison/little-ms-race-track`, `neth/little-free-library` and
`berthillon/cone-peche-de-vigne-2026-08-27` — four of the five marks the
settlement published, derived independently from the register diff and agreeing.
The fifth, `fabel-of-garrison/garrison-bridge`, has no act because its window was
never hand-drained into the world repo.

### The 2026-08-28 run: what the gate found

First pass, against the clearing job as it stood: **S48 green, S49 and S50 red**,
with four gaps in 2.0's write path that only real canon could surface. The lab's
probe claims had exercised none of them.

1. **A claim had nowhere to name its mark.** `claims` carried no `slug`, so
   `clearing-job.mjs` read the identity out of `geometry->>'slug'`. Two
   consequences, both live: 14 materialized marks carried their own slug inside
   their geometry, and a DE-SITED claim — no geometry at all — locked and
   produced nothing. `callan-reeves/stance-on-the-high-ground` locked in window
   152 and never became a mark, with no refusal and nothing to notice. 44% of
   1.0's register is predicated or naming. → `006_claim_identity.sql`.
2. **An amend was refused as a duplicate.** S49 published 14 claims, four of them
   amendments of standing marks, and every one came back
   `duplicate: a standing mark already carries this slug` — verbatim. 1.0
   publishes amendments; a 2.0 that refuses them cannot reach 1.0's state.
   `supersedes` was already the column for it (001, "#1697/#1862 class"); the
   clearing job only ever read it *within* the window. → step 1 now exempts a
   claim that supersedes the standing mark of that slug, step 4 exempts a parcel
   from overlapping its own standing ground, and step 6 rewrites the mark it
   continues rather than inserting a second row.
3. **A mark that came through the candle was poorer than one the seed
   imported.** Materialization wrote only the pre-004 columns, so 19 replayed
   marks had NULL `data` — the whole frontmatter remainder — and NULL `parent`.
   → step 6 carries both, and orders parents before children (`marks.parent` is a
   non-deferrable self-FK, and a cycle would roll back the window).
4. **Standing goes stale, and that one is not fixed.** `data.tier` is not a field
   of the record — it is what the fold says after resolving the whole world, and
   1.0 recomputes it for all 960 records at every settlement. 2.0 writes it once,
   at materialization, and never revisits it. One mark in this range,
   `berthillon/le-petit-berthillon`, is `market` in the store and `home` in 1.0.
   Anti-rebake rule 3 already has the answer — *derived is a VIEW* — and a
   derived value is living in a source column. **NEEDS A RULING.**

Also found and not a 2.0 gap: **`settlement/S48` is not on a settlement commit.**
It tags `crossing-save 151`. The sweep that closed that window published nothing
and therefore committed nothing, so the ceremony tagged whatever HEAD was. That
era has no six-count to check itself against, and the report says `UNCHECKABLE`
rather than reporting a pass.

Second pass, after 006 and the three clearing-job fixes, from a re-floored store:

```
GREEN  settlement/S48 (window 151)  34 acts, 0 claims
GREEN  settlement/S49 (window 152)  10 acts, 14 claims
GREEN  settlement/S50 (window 153)  22 acts, 5 claims
       ⚑ 1 mark carries a stale standing (finding 4, unruled)
```

Zero refusals. Windows tile 150→154 with a law sha pinned per era. 846 marks,
2,925 acts, 850 claims. `--can-fail-proof` green at S50 (five mangles, five
reds, restored). Seed `--verify` and `--can-fail-proof` green *at the floor*,
the roles falsifier green, projection equality green at both heads.

Third pass, after the standing recompute landed (§ The standing recompute), from
a re-floored store — the same range, with the stale-standing check GATED instead
of noted:

```
GREEN  settlement/S48 (window 151)  34 acts, 0 claims    standing: 831 recomputed, 0 moved
GREEN  settlement/S49 (window 152)  10 acts, 14 claims   standing: 841 recomputed, 1 moved
                                                           berthillon/le-petit-berthillon market→home
GREEN  settlement/S50 (window 153)  22 acts, 5 claims    standing: 846 recomputed, 0 moved
```

No flags. The one mark that carried a stale standing now moves in the window its
neighbour's parcel landed in, which is the whole of the ruling.

`falsifier-acts-claims-closure.mjs` reports GREEN over 0 mark acts and its
`--self-test` says `THE CHECK IS ASLEEP` — correctly. Every act the replay
carries rides `class = 'legacy'` (seed-import's own convention), so the four
`legacy:leave-mark` rows are outside the closure check's population. Nothing is
wrong with the store; the closure guard simply has nothing to guard until the
door writes live acts again. The door receipt above is what covers those four in
the meantime.

### The seed now lights the candle

`writeSeed` opens window N+1 in the same transaction, at the genesis window's
close, 12 hours wide. 005_candle_tiling repaired the 58.9-hour hole *by hand*
("window 151 was hand-bootstrapped open at 08-28 16:40Z"); the hole was the
SEED's, and a hand-bootstrapped window is a state with no receipt. `--verify`
reds if the successor is missing, closed, or does not open where its predecessor
closed.

### The candle tiles on UPDATE too (011)

005's trigger fired `BEFORE INSERT` only. The A/B re-verification lane read the
live definition on 2026-08-29 and named the gap: *"a hole can no longer be
inserted, but it can still be updated into existence — and 005's own repair of
window 151 was an `UPDATE windows SET opens_at = …`"*. It could not prove it,
because firing a trigger needs a write and that lane was SELECT-only.

`011_candle_tiling_update.sql` recreates the trigger `BEFORE INSERT OR UPDATE`
and checks **both edges**: a window must open where its predecessor closed *and*
close where its successor opens. The second half is unreachable on INSERT (ids
ascend, so there is no successor yet) and load-bearing on UPDATE — guarding
`opens_at` alone would close the path 005 used and leave its mirror image open.
It is inert on every write path the repo has today, which is the point: it costs
nothing until someone reaches for the edit that would have been silent.
`replay-ingest.mjs:990` already told the reader `opens_at` was safe because
"005's trigger owns it"; that sentence is true now.

Repairs that RESTORE tiling are still welcome — the check is on the resulting
state, not on the act of updating — so 005's own fix would pass unchanged.

`falsifier-candle-tiling.mjs` is the write-capable proof the read-only lane could
not run, and the flip is the whole design: **phase A applies 005 alone and the
hole-making UPDATE must SUCCEED; phase B applies 011 and the identical statement
must be REFUSED.** A phase-A refusal exits 2, not 0 — a fixture that never had
the defect proves nothing about the fix. It runs on a throwaway database only and
refuses any name without `scratch` in it.

```sh
WORLD2_SCRATCH_URL=postgres://world2_owner:…@127.0.0.1:5432/world2_scratch_x \
  node world2/tools/falsifier-candle-tiling.mjs
```

### Applying a migration to a live store — 014, 015, 016

There is no migrations table in this store. Every `world2/schema/*.sql` past the
floor is hand-applied, and this is the whole of the operator's contract for the
three that have been applied that way.

**As `world2_owner`, by `SET ROLE` — no URL, no password, nothing sourced:**

```sh
sudo -n -u postgres psql -v ON_ERROR_STOP=1 -d world2_dev \
  -c "SET ROLE world2_owner;" -f world2/schema/016_marks_bbox_gist.sql
```

Applied as `postgres` instead, the object's owner diverges from the table's and
**nothing fails** — the swap runbook found that the hard way with 014's table,
and the divergence is silent and permanent.

**014 is not idempotent; 015 and 016 are.** 014 run twice raises
`relation "escrow_projection" already exists` inside its own `BEGIN`, so nothing
partial lands, but the operator needs a pre-check. 015 and 016 use
`CREATE INDEX IF NOT EXISTS` and print a `NOTICE`.

**015 and 016 may be applied in either order, before or after the code, and a
crossing with NEITHER applied is correct and slow — never wrong.** Measured on a
10× store: with 016 the crossing takes 8.1 s, without it 25.8 s, and the outcome
sha is byte-identical either way. `gistContainment` checks `pg_indexes` for the
index by name and returns null when it is absent, and the walk falls back to the
scan it has always used. So there is no deploy-order trap in either direction,
and no window in which the store answers differently.

**Prove 016 landed by the RECEIPT, not by `pg_indexes`.** An index that exists
and is not *chosen* has bought nothing. Read a cleared window:

```sql
SELECT jsonb_pretty(receipts->'standing'->'containment') FROM windows WHERE id = <a cleared window>;
```

Both readings, taken off real cleared windows on a throwaway 10× clone — the
first with 016 applied, the second with the index dropped between crossings:

```
{ "indexed": true, "covered": 4092, "loose": 48, "loose_marks": [ "vermillion/space-program-clearing", … ] }
{ "indexed": false }
```

`"indexed": false` on a cleared window is a crossing that paid the old price.
`loose` is the count of rows whose `bbox` does not bound what `marksContain`
reads — they are correct and they are scanned, so a `loose` that climbs is a
slower walk, never a wrong one.

**Both `CREATE INDEX`es are NOT `CONCURRENTLY`** — they cannot be, inside a
transaction block — so each takes a SHARE lock on `marks` and blocks writes to it
for the build. Measured under 0.5 s at 10×, but **the crossing must not be
mid-flight**: apply between candle runs, not during one.

### Re-flooring

The replay leaves the store past the floor, and `acts` is append-only for every
pen, so there is no undo — only `--continue`, or a rebuild. `--help` prints the
sequence; it is the seed's own sanctioned reset plus the two projections and the
ledger backfill:

```sh
psql -c "DROP VIEW IF EXISTS docket, standing_marks CASCADE;
         DROP TABLE IF EXISTS acts, claims, marks, windows, law_projection,
              stamp_projection, projection_heads, identities, registry CASCADE;
         DROP FUNCTION IF EXISTS forbid_mutation() CASCADE;
         DROP FUNCTION IF EXISTS claims_update_guard() CASCADE;
         DROP FUNCTION IF EXISTS windows_tile() CASCADE;"
for f in 001_tables 002_grants 004_marks_data 005_candle_tiling 006_claim_identity; do
  psql -f world2/schema/$f.sql; done
git clone --depth 1 --branch sandbox/seed https://github.com/keeminlee/postmark-world.git ~/frozen-world
node world2/tools/seed-import.mjs --world-repo ~/frozen-world --tag sandbox/seed \
  --town-sha 830a69963d8e4801ad4ed8bb80da38e79fd3fdbf --with-acts
WORLD2_PG_URL=…owner… node world2/tools/ledger-backfill.mjs --world-repo ~/frozen-world
PGUSER=law_ingester PGPASSWORD=… node world2/tools/law-ingest.mjs \
  --law-repo ~/frozen-world --sha 52c281b8312d0a1d36eb81d03fbd1a36840a4eb1
WORLD2_PG_URL=…ingester… node world2/tools/stamp-ingest.mjs \
  --town-repo ~/frozen-town --sha 830a69963d8e4801ad4ed8bb80da38e79fd3fdbf
```

DROP the objects, not the schema: `DROP SCHEMA public CASCADE` takes the schema's
ACLs with it and the four roles come back with no USAGE. The floor that comes out
is `831 marks · 2,859 acts · 831 claims · windows 150 closed + 151 open`, and
because the ids are `uuid5` of the slug it is identical to the previous floor row
for row — this is also merge-ruling 9's "sanctioned clean", so the lab's ~43
leaked fixture acts and `wright/candle-proof` are gone.

### Teed to Keemin

1. **`006_claim_identity.sql` is law-tier DDL and is NOT merged** (anti-rebake
   rule 4: schema DDL goes through REVIEW like a grant change). It was applied to
   `world2_dev` because that is where the gate had to run. Recommendation: take
   it — the alternative is a mark's identity living inside its geometry forever,
   and 44% of the register having no way to materialize at all.
2. **Finding 4, the stale standing, needs a ruling.** Recommendation: `tier`
   becomes a VIEW over the fold's inputs rather than a stored key, per
   anti-rebake rule 3. That is a phase-3 change and it is the last thing between
   this range and a fully green gate. **RULED and BUILT — recompute-at-close, not
   a view; see § The standing recompute.**
3. **The town half of every replayed window pins the FROZEN sha**
   (`830a6996`). No settlement receipt in this range names a town commit, so
   there was nothing to discover; no claim in these three eras carries a stake,
   so the pinned stamp read is not load-bearing for the outcome. If settlements
   should pin their town half, that is a 1.0 ceremony change.

## Merge rulings (Wright, 2026-08-28 eve — the replay lane's 4 teed decisions)

1. **006_claim_identity.sql TAKEN** — a mark's identity living inside its geometry forever, and 44% of the register unmaterializable, decides it; law-tier review rides the world-2 branch review like every DDL before it.
2. **Finding 4 (stale standing) RULED: recompute-at-close, not a live view.** The lawful cadence is 1.0's own: "derived weight moves at the next Settlement" (ECONOMY-DIALS read_side note) — tier is recomputed for ALL standing marks inside the clearing transaction, which is settlement-equivalent staleness, zero new class. The standing walk ports as a spatial query over the store (the gold's own words: "the milo overlay-blind case becomes a real spatial query"); the replay gate is its judge (recompute vs the fold at every tag). Built as the next slice.
3. Untagged-sweep replay: teed to Keemin (recommend: run the extended range as the cutover-eve rehearsal, since prod keeps moving and the range must be re-run then regardless).
4. Settlement-pins-town-sha: a 1.0 ceremony change — PARKED per the frozen-1.0 discipline; becomes real the first time a replayed claim carries a stake.

Also accepted with thanks: the seed lighting its own candle (the 58.9h hole was the seed's, now unrepresentable), the fractional-journal widening, compareMarks extraction, and the phantom-claim receipt (le-petit-berthillon) — the single best proof in the report that the harness reads the AUTHORED record and not its own reflection.

## The standing recompute

`standing.mjs` is 1.0's standing walk over `marks` rows, and `clearing-job.mjs`
step 7 runs it over EVERY standing mark as the window's last act, inside the
window's own transaction. That is ruling 2 above, built:

> tier is recomputed for ALL standing marks inside the clearing transaction,
> which is settlement-equivalent staleness, zero new class.

`falsifier-standing-equality.mjs` is the guard, and the replay gate is the judge.

### Why a recompute and not a view

Both were on the table and the ruling took the cadence over the shape. A view
would make `tier` fresh at every read; the town's own law does not ask for that.
*"Derived weight moves at the next Settlement"* — so a standing that moves at the
candle's close is not stale, it is ON TIME, and it costs no new class, no new
read path, and no change to any consumer that already reads `data.tier`.

What it does cost is stated plainly: `data.tier` remains a derived value living
in a source column, which is what anti-rebake rule 3 dislikes. The recompute
makes that column TRUE at every window boundary rather than true once; the rule's
own remedy stays available later and nothing here forecloses it.

### Why a PORT, and what holds it honest

`mark-standing.mjs` forbids exactly what this file is: *"One definition, five
consumers … a second copy of this walk is a future drift; import it."* The
clearing job cannot import it — it holds no world checkout, by the same
stateless-contract reasoning that keeps the ingesters clone-free — so what stands
in for the import is a falsifier that runs BOTH over the same state:

```sh
export WORLD2_PG_URL="postgres://snapshot_reader:…@localhost:5432/world2_dev"
git -C ~/world-full worktree add --detach /tmp/w-s50 settlement/S50
node world2/tools/falsifier-standing-equality.mjs --world-repo /tmp/w-s50 --idempotence
```

The oracle is the FOLD, not `markStanding` alone — the same distinction that cost
the seed lane six rows (§ The derived fields, and why the FOLD answers them). It
asks two questions and reds on either:

| | |
|---|---|
| THE WALK | does the port over `marks` rows say what the fold says over the checkout? |
| THE STORE | does the `data.tier` actually stored equal **what the walk says**? (finding 4 itself) |

### Corrected 2026-08-29 — the two states were not the same state

This falsifier ran RED live on `berthillon/le-petit-berthillon` ("fold says:
market · port says: home"), and that red was carried upward as evidence that the
clearing job's recompute re-introduces the repaired tier defect. **It does not.**
The port was right and the oracle was old.

`berthillon/chez-antoine` is a 25×25 parcel held by `solo:berthillon` standing
exactly under the shop, so the shop is `_sovereign`, the walk stops there,
holder === house, and the verdict is `home` — the sovereignty law working. It is
2.0-born: present in the store, absent from the frozen tag *and* from world
`main`, because a mark born in 2.0 has no file for a checkout to hold.

The rule that failed is this section's own — *"a falsifier that runs BOTH over
the same state"*. It was not. The store held 17 marks the checkout did not, and
the file already knew that; it excused them **by membership**. Standing is
**relational** — one store-only parcel re-answers every mark inside it — so a
slug in *both* sets can have its verdict changed by a mark in only one. Two of
nineteen findings, one cause. Three changes close it:

- **The attribution rule.** A WALK divergence is attributable to state the oracle
  cannot see if re-walking *without* the store-only marks makes the port agree
  with the fold. Attributed divergences print with their cause named and do not
  red. Anything surviving the removal is a real port defect and stays RED — it
  cannot launder one, because the removal only withdraws rows the checkout
  provably lacks.
- **THE STORE is asked against THE WALK**, which is what the table above always
  said it was for and not what the code did (it compared to the fold, so every
  attributable walk divergence was double-reported as a second, independent-
  looking finding). Store-vs-walk has no checkout in it and cannot go stale.
- **The store-only marks get a frontier in time.** The latest admission among
  marks the register *does* hold; a store-only mark admitted after it was born
  after the state the checkout describes and is a receipt, not a finding. One
  admitted at or before it — or carrying **no locking claim at all** — is RED.
  `locked_window` was tried first and is wrong: window 152 straddles
  `settlement/S47`, so 4 marks the register holds and 10 it does not share one
  window number.

Proven on a restored scratch copy of `world2_dev`: green with all 17 born-after
marks and the one attribution disclosed, and `--can-fail-proof` still red on all
five mangles — the forged mark now caught by the sharper *no locking claim* limb.

Exit codes are the siblings': **0** green · **1** RED · **2** cannot run. An
empty `marks`, a checkout with no register, or a comparison with zero slugs in
common all exit 2 — there is no code for "checked nothing and found nothing".

Three things beyond the walk are carried, because the port has to reconstruct
what the FOLD stamps and the loader does not (`_cred`, `_sovereign`,
`_containedBy`). The row→record mapping is tabulated in `standing.mjs`'s header;
one line of it is the port's sharpest edge and worth repeating here: **2.0's
`household` COLUMN is 1.0's `_cred`, not 1.0's `household`.** A port that read it
as the handle would compare a key against a handle and answer `market` for every
same-household mark in the town.

### The premises that are facts, not law

Three things this port stands on are true of today's register rather than true by
law, so each is a tripwire (`admissionNotes`) rather than a comment. All three
are silent on the current store, and the falsifier and the window receipts print
them when they are not:

- **The 76 class-parented marks.** Their parent is law and has no `marks` row, so
  the walk cannot climb it — and never has to, because every one of them is
  `the-town` + `tier: constitution` and the constitution shortcut answers first.
  The note fires on any class-parented mark the shortcut does not catch.
- **1.0's parcel claim cap** (3 per household, forward from 2026-07-30) is
  enforced by 1.0's fold and NOT by 2.0's candle, so `_sovereign` here reads every
  standing parcel as admitted. Exact today, and checked: the five households
  holding more than three hold them all dated `2026-07-24`, prior estate, never
  gated. The note fires the day a household's post-law parcels pass the cap.
- **One parcel per HANDLE.** Same shape; no handle in the register holds two.

### The constitution shortcut reads the column the recompute writes

`markStanding`'s town exception reads `mark.tier`, which in 2.0 is `data.tier` —
the column this recompute writes, because `seed-import.mjs` overwrites the
authored word with the fold's answer. That is a FIXPOINT and not a loop, in three
lines: a `the-town` mark that authored `tier: constitution` makes the shortcut
fire, stores `constitution`, and fires again; one that did not cannot have
reached the shortcut, so the stored value is the walk's own verdict and the walk
gives it again; a non-town mark never reaches the shortcut at all.

`--idempotence` asserts it instead of leaving it on paper, and a unit test does
the same. **The durable fix is teed, not taken**: preserve the authored word
under its own key at seed and materialization time, so the shortcut never reads a
derived column. That is a seed change, and it is not this slice's to make.

### The red-proof carries the run

Run on `world2_dev` 2026-08-28, from a re-floored store replayed S48→S50.

Before the recompute landed, against the same store, the gate's newly-gated check
went red naming the mark and both values — which is the finding 4 receipt:

```
✗ marks DIFFERS at berthillon/le-petit-berthillon · field data.tier
      repo says: home
      DB says:   market
```

After — the three-way agreement, asked of the three surfaces separately:

```
berthillon/le-petit-berthillon    1.0 fold: home   · ported walk: home   · stored: home
berthillon/chez-antoine           1.0 fold: home   · ported walk: home   · stored: home
berthillon/pistache-cone-for-julian  1.0 fold: market · ported walk: market · stored: market
```

`--can-fail-proof`, five mangles inside a rolled-back transaction:

```
RED after mangle: data.tier of aion-solare/old-fig set to market (the stale-standing shape) — 1
RED after mangle: aion-solare/the-returning-house-parcel retired (the ground leaves) — 15
RED after mangle: household of aion-solare/old-fig changed (the grain moves) — 1
RED after mangle: geometry of aion-solare/old-fig moved 5 km away — 1
RED after mangle: a forged mark inserted — 1
GREEN after rollback — the mangles left no trace
can-fail PROVEN
```

**Two findings came out of writing the proofs, and both outlive them.**

- **A mangle that changes no row is not a mangle.** The first `--can-fail-proof`
  reported one check SILENT. It had not missed anything: the victim was the first
  row standing at `home`, which was a PREDICATED mark with no geometry, so the
  "moved 5 km away" `UPDATE` matched zero rows. A proof lying in the safe
  direction is the worst kind, so the harness now checks `rowCount` for every
  mangle and reports `INERT` — the fix is the harness's, not each mangle's to
  remember.
- **A test that could not fail.** The unit test for "the directory edge is the
  LAST thing the walk believes" filed a guest's mark under the holder's parcel
  and asserted `market` — which is the answer *both* orderings give, because
  without a consent word the parcel confers nothing either way. The flip pass
  found it (reordering the up-chain left the suite green). The stray filing now
  carries a WELCOMED word, so believing the path and believing the ground give
  different answers.

The unit suite is 26 tests in `test/world2-standing.test.mjs`, each asserting a
quoted sentence; five flips were run to prove they fail — `_cred` read as the
handle (4 red), the constitution shortcut removed (2), the directory edge read
first (1), the welcomed conferral dropped (1), sovereignty keyed on the handle
(1) and dropped entirely (1).

### Two receipts worth keeping from the run

- **Window 151 recomputed 831 marks and moved 0.** The floor's tiers — written by
  the seed from 1.0's own fold — and the ported walk agree on every one of the
  831 seeded rows. That is the port's whole-register agreement, free, as a
  by-product of the first clearing.
- **`seed-import.mjs --verify` is a FLOOR check, not a tip check.** It is red at
  S50 (35 findings) and was red at S50 before this slice (34) — the store has
  legitimately moved past the frozen tag: 15 new marks, four amends. The recompute
  adds exactly one line, `le-petit-berthillon · field data.tier market → home`,
  and that line is the fix working. Run the seed verify at the floor.

### What it costs

`computeStanding` over 846 marks takes ~1.7 s, inside a transaction that closes a
12-hour candle. `placementParent` is the cost and it is O(n²) in the register;
the recompute passes it a candidate list ordered smallest-area-first so the
search stops at the first container rather than scanning the town
(`rankCandidates`). The 1.0-verbatim exhaustive path is kept beside it and a unit
test asserts the two agree mark for mark, including the equal-area tie-break that
depends on the sort being stable.

## Merge rulings (Wright, 2026-08-28 night — the standing lane's 4 teed decisions)

1. Authored-tier-under-its-own-key: ACCEPTED AS RECOMMENDED — taken when the seed is next touched; the fixpoint holds and the falsifier watches it meanwhile.
2. Ranked search KEPT — it bounds the growth, and the unit test asserting agreement with the 1.0-verbatim exhaustive path (equal-area tie-break included) is what makes a second path through law code tolerable.
3. Vendored geometry ACCEPTED (blob-pinned, warning-on-move, and the fold comparison over the whole register is the real guard).
4. Seed --verify red-past-the-floor: correctly documented as the store having lawfully moved, not a regression.

The lane's own best lines, kept for the record: the port agreed with the fold on all 846 slugs FIRST RUN, nothing tuned to green; "a mangle that changes no row is not a mangle" (INERT detection); and the flip pass catching a test both orderings satisfied.
## Private durability — the pg_dump lane (Phase 5.6)

The notary's promise stops at the private compose space, deliberately. Gold §4
Phase 5.6, verbatim: *"drafts are deliberately EXCLUDED from the
notary/archives (private things don't ride the public bucket), so they get a
private durability lane (pg_dump) instead."*

A draft is what an UNSTAKED `leave-mark` leaves behind (Keemin's ruling,
2026-08-28: staking is what submits, so composing needs no new word). It stops
being one the moment a stake puts it forward.

**This is the ONE store surface the public repo cannot back up.** Everything
else in World 2.0 survives because someone can clone the town: acts ride
`archives/acts/<window>.jsonl`, marks ride `WORLD2/marks/**`, and both are
frozen or re-derivable from a checkout. A `draft`-status claim rides neither,
because riding either would put a resident's unfinished private sentence in a
public git repo permanently — which is exactly the 1.0 defect (P-108) that
Phase 5.6 exists to close. So the tradeoff is named rather than papered over:
**private and repo-durable are not both available, and privacy wins.** A draft
lost to a dead disk is a draft; a draft in a public archive is a broken promise.

Two independent reasons a draft cannot reach the repo, so this is not a rule
anyone has to remember:

1. `snapshot-export.mjs` selects from `acts`, `marks` and `windows` — never from
   `claims`. There is nothing for it to find. And an unstaked declaration is not
   mirrored into `acts` at all (`world-journal.mjs` § the deferral): the draft
   carries its own act on `data._deferred_act` until a stake releases it, so the
   mark's BODY never reaches the exported log while it is private.
2. Its credential is `snapshot_reader`, and 007's row policy makes a draft row
   unreturnable to it. `falsifier-draft-privacy.mjs --self-test` proves that
   half by opening the hole and watching the check go red.

### The hand-run

Owner role (it is the one credential not subject to the policy, so it is the one
that can dump a draft at all — see 007 § *why not `FORCE ROW LEVEL SECURITY`*).
A full dump carries draft rows by nature; no `--table` or `WHERE` is wanted, and
narrowing to `claims` alone would produce a file that cannot be restored into
anything.

```bash
# on the box, as a user who can read the credential file
set -a; . /etc/postmark-world2-dev.env; set +a
PGPASSWORD="$PG_WORLD2_OWNER_PASSWORD" pg_dump \
  --host localhost --username world2_owner --dbname world2_dev \
  --format=custom --no-owner --no-acl \
  --file "/srv/world2-lab/private-dumps/world2-$(date -u +%Y%m%dT%H%M%SZ).dump"
```

Lands in `/srv/world2-lab/private-dumps/` — **outside any git checkout and
outside any webroot**, which is the whole point of naming the path here rather
than leaving it to the runner. A dump inside `office/` would be committed by the
next pen that ran `git add -A`, and this file is precisely the thing that must
never be committed. Restore with `pg_restore --clean --if-exists -d <db>`.

~~**No timer, by manifest law**~~ — **SUPERSEDED 2026-08-29.** Both states are
left standing here rather than one overwriting the other, because the sentence
below was right when it was written and a reader needs to see what changed and
on whose word:

> **No timer, by manifest law** — nothing here schedules itself, and this is a
> hand-run before anything that could lose the store (a migration touching
> `claims`, a box move, a Postgres upgrade). When drafts are load-bearing enough
> that a hand-run is not enough, that is a ruling to bring to Keemin with the
> instance that made it true, not a cron to add quietly.

The ruling arrived on 2026-08-29: **prod Postgres lives on the box, with shipped
backups and no managed service.** That is the instance. A store that is about to
be the production world cannot have its only durability lane be a person
remembering — so the timer exists now, and it was added the way that paragraph
demanded rather than in spite of it: **with its manifest row**
(`postmark-world2-backup.timer` in `deploy/box-rollcall-manifest.json`), which is
what "by manifest law" was protecting in the first place.

What the hand-run section above still governs is the SHAPE of the dump — owner
role, full database, no `--table`, landing outside every checkout and webroot.
The timer runs exactly that command. Three things it adds, none of which change
the shape:

- the dump is **shipped off-box** (`deploy/world2-backup.sh` § the off-box
  destination, which discloses where and records what was refused and why);
- a `pg_basebackup` rides along, because **WAL cannot be replayed onto a
  `pg_dump` restore** — a logical dump and a physical redo journal are not a
  restore path in company, and archived WAL with no base backup is a spool
  nothing can consume;
- a **rehearsed restore** (`deploy/world2-restore-rehearse.sh`) exists and is
  expected to be run, because until a dump has been restored it is a file that
  has never been asked to be a backup.

The hand-run is still the right move before a migration that touches `claims`.
It is no longer the only thing standing between this store and a dead disk.

## Merge rulings (Wright, 2026-08-28 night — the drafts lane's teed decisions)

The slice's own foundational call — **a draft is not an act** — ACCEPTED as the load-bearing insight: a body in the append-only public archive would be beyond any row policy forever, so composing writes no journal/acts row and SUBMIT is the act. (1) Grammar KEPT as shipped: draft:true composes; submit ships flat (world_submit_mark + POST /world/submit) with the apex DISPATCH row waiting on the law grant — planted at cutover, law-tier. (2) "draft" terminology KEPT — the 1.0 collision self-retires at cutover. (3) No FORCE RLS — accepted as argued. (4) Shadow-era honesty note carried to the tracker verbatim: privacy is complete only BEFORE submit until phase 6 kills the 1.0 path. (5) claims.slug drive-by accepted (006's intent). (6) v0 bounds accepted — and the stamps-leak insight (a public escrow line behind an unreadable mark would leak on the ledger side) is RECORDED AS LAW here: escrow executes at the submit boundary, never before.
FOLLOW-UP SLICE (honoring Keemin's stake-is-submit ruling exactly): `do:"stake"` aimed at one's own draft PROMOTES it in the same motion (going public is what staking means), then writes the escrow line — the leak ordering preserved. Small; rides the next office pass.

## Merge rulings (Wright, 2026-08-28 night — the drafts REBUILD to stake-is-submit)

THE DEFERRAL: KEPT, recommended to Keemin as the necessary extension of his ruling (an unstaked leave-mark's mirror would have put private bodies in the notary's public archive forever; the 1.0 journal row lands immediately, the Postgres act rides the draft in data._deferred_act and releases at the stake, dated at the putting-forward — "the world witnessed the putting-forward, not the thinking"). His veto stands open; the revert is one predicate. Also ruled: (2) the docket's meaning change (unstaked = draft = not on the docket) is THE FIX, and A/B/replay surfaces asserting docket counts read this section as the notice; (3) the withdraw-of-a-draft fact+name mirror leak stays a NAMED gap (body never leaks) until the office can know a target is a draft synchronously; (4) putting-forward dating accepted (also avoids inserting into notary-frozen windows); (5) the stamps:0-on-commons ambiguity resolved as save-the-draft-refuse-the-promotion, quoting the law — better than discarding an author's work over a number. The three-lawful-departures rewrite of the parity falsifier, with its exit-2-rather-than-unearned-green stance, is accepted as the new mirror contract.

## The LIVE read tier

`live-reads.mjs` is 1.0's movement, presence, sound and containment derivations
ported to `acts` rows, and `falsifier-live-equality.mjs` is the guard. It closes
the A/B gaps list's remaining "data present, no door" block — P-092 walkers,
P-093 present, P-098 dynamic, P-036 occupancy — and it is the last hard
prerequisite for cutover, because every apex read shadow still answers from
sqlite.

| door | question | 1.0's equivalent |
|---|---|---|
| `/world2/walks[?since=][&last=]` | every departure the record holds, in the ledger's grammar | `WORLD/walk-ledger.md` (the site's one still-baked record) |
| `/world2/positions[?at=]` | every walker's derived position at one instant | `walk.mjs positionsAt` |
| `/world2/present[?at=][&x=&y=&radius=&limit=]` | every PLACED resident: a walk, else ground, else the porch | `GET /world/present` · `world_walkers` |
| `/world2/say?at=&x=&y=[&radius=&mode=]` | what is still in the air, and what reaches this point | `presentEmissions` |
| `/world2/occupancy[?handle=]` | the containment stack, and who is inside each mark | `world_occupancy` |

Keyless, like the rest of this tier and like 1.0's own: `world_walkers` is in
mcp.mjs's PUBLIC set and `GET /world/present` is served without a key.

### The order, and the 44-handle trap under it

"latest wins" means latest **APPENDED**, not latest by instant —
world-movement.mjs states the reason and it is law here too: *"File order and
instant order disagree in the real ledger (the 08-08 sailing filed every
passenger at 18:00:00.000Z and those lines were appended after walks stamped
18:16), so re-sorting here would silently re-decide which leg governs a
resident."*

In `acts` the rows' append order is **not** the record's: the backfill inserted
the 304 pre-journal ledger departures AFTER the 786 journal ones, because
`journalBegins` needs the journal there first. Measured on `world2_dev`:

```
plain `id` order            44 of 73 handles get a DIFFERENT governing departure
era-then-id vs by-instant    0 of 73
journal era, id vs instant   0 of 72   (786 of 786 rows monotone in `at`)
```

So `DEPARTURE_ORDER_SQL` is `ORDER BY ((payload->>'_ledger') IS NULL), acts.id`
— era first, row id inside each era, which restores each era's own file order.
`departureRecords` **asserts** it was applied rather than trusting the caller,
because the trap is silent: an unordered read returns rows, in an order, with no
symptom.

`acts.id` is qualified on purpose. Postgres resolves a bare `ORDER BY id`
against the OUTPUT column list first, so a caller selecting `id::text` sorts the
ids as TEXT — "1019" before "102". That is what this falsifier's own first run
did, and the order guard is what caught it.

### `/world2/walks` takes a window (POS-84, 2026-09-16)

The door answered the whole record and only the whole record — 2,498 rows /
1.17 MB on 2026-09-16, growing by ~100 a day — so its one live consumer, the
world viewer's Lately pane, read a file frozen 2026-08-10 instead. `?since=<ISO>`
cuts to the departures at or after an instant; `?last=<n>` keeps the last n
rows. Neither given, the answer is byte-for-byte what it was, including `count`
and `eras`.

Three properties the window holds and a reader should not have to re-derive:

- **It filters, it never re-sorts.** The order stays the record's own append
  order, so `last` is the most recently **appended** n. Measured on prod
  2026-09-16 that differs from the n latest instants in exactly one place, the
  08-08 sailing documented above. The answer carries a `window.note` saying so.
- **The cut is on the rendered rows, not in SQL.** `departureRecords` refuses a
  row it cannot read rather than skipping it, and censuses the eras over
  everything; a `WHERE` clause would make both depend on who asked, and a fifth
  pen's act sitting outside the window would quietly stop bouncing.
- **`count` and `eras` are always about the rows returned**, and `window.count_all`
  says how big the record is behind them.

### The four eras of a movement act

| era | how identified | payload | the mapping's source |
|---|---|---|---|
| `ledger` | `payload._ledger` | the checkout reader's own output, whole | ledger-backfill § the shape of a backfilled row |
| `journal` | `payload.payload.from` | the jsonl row; fields one level down | `storedDepartures`' converter, quoted at its line |
| `journal-line` | `payload.payload.lines` | a live-pen act crystallized into a crossing log | walk-exec / crossing-exec § SETTLE AT THE SAVE |
| `live` | `payload.lines` | the live pen's own act, mirrored straight in | the same, post-cutover |

**The fourth era was found by the falsifier, not by reading.** The first cut knew
three and refused three `legacy:enter`/`legacy:exit` rows the replay had ingested
from crossings 151–153 — vermillion entering Pando Peak. Those rows are the live
pen's line inside the journal's envelope. The refusal NAMED them rather than
dropping them, which is the whole argument for refusing: an era nobody knew about
announced itself. A payload no era explains still stops the read.

### The equalities

Every oracle is 1.0's OWN function, imported live — never a re-expression.

```sh
export WORLD2_PG_URL="postgres://snapshot_reader:…@localhost:5432/world2_dev"
# THE PIN IS DERIVED, NOT TYPED. A tag written into a recipe is a fixture that
# decays at the next crossing, and this recipe's own S50 pin is what hid #2894
# for nineteen days: S50 still carries `WORLD/threshold-ledger.md`, so the run
# that was supposed to prove the pen worked was the one checkout where its
# filename bug could not appear. Resolve the current settlement instead.
TAG=$(git -C ~/world-full tag --list 'settlement/S*' | sort -V | tail -1)
git -C ~/world-full worktree add --detach ~/live-lane/w-now "$TAG"
node world2/tools/falsifier-live-equality.mjs --world-repo ~/live-lane/w-now --can-fail-proof
```

Run against `world2_dev` on 2026-08-28, at `settlement/S50` — kept below as the
historical reading, because it is the last one taken before the pen went blind.
On 2026-09-17 the derived pin resolves to `settlement/S71` (2026-09-17T05:46Z),
which carries `WORLD/enter-exit-ledger.md` and not the retired name, and is
therefore the first checkout in the recipe's history where E6occupancy is
exercised as residents' checkouts actually stand. (Run it at the FLOOR and E5b
reds on marks the replay legitimately moved.)

```
world 0c1aa924 · 1090 departures (ledger 304 · journal 786 · live 0) · 158 passages
              · 1630 emissions · 847 marks · 102 identities
  E1  ledger parse   compared  304   the checkout's parseWalkLedger
  E2  ledger order   compared   50   the checkout's currentDeparture, file order
  E2b merged order   compared   73   the office's recordsAcrossEras merge
  E3  journal seam   compared  786   the office's storedDepartures over an in-memory movements table
  E4  arithmetic     compared  365   the checkout's positionAt / publicWalkers
  E5  the union      compared  123   the checkout's where-is publicResidents
  E5b shim vs fold   compared   68   the checkout's own fold
  E6  presence       compared  129   the office's presentEmissions over an in-memory emissions table
  E6  occupancy      compared   12   the checkout's occupancyAt over the frozen ledger
GREEN · the port and 1.0's own functions agree on every row compared
```

Exit **0** green · **1** RED · **2** cannot run. There is no code for "checked
nothing and found nothing": every equality reports its own `compared`, and any
equality that compared zero rows exits 2.

Two scoping decisions are worth knowing, because both started as false findings:

- **E2 scopes the oracle to the rows the store holds.** `acts` carries 304 of the
  ledger's 317; the other 13 sit at or after the journal's first row and the
  backfill deliberately left them to the journal (`partitionWalks`). Comparing
  1.0's answer over the whole ledger against the port's over the 304 reported 8
  handles as disagreeing when 1.0's answer for them simply lives in the other
  era. The seam receipt stayed: a ledger row in NEITHER era is a finding.
- **E6 compares the frozen era to the frozen era** — ab-compare's AB-P2 lesson
  verbatim. Rows from later eras are reported beside it as the named delta they
  are. The store carrying more record than the frozen tag is the store being
  right.
- **E6 follows the ledger's rename, and says when it did** (#2894, 2026-09-17).
  The frozen acts name `WORLD/threshold-ledger.md` in `payload._ledger`; that
  file was deleted from world main on **2026-08-28** by `2a9042d4b` ("the passage
  record keeps one file, and the retired twin is deleted", #2152) and its record
  is `WORLD/enter-exit-ledger.md` — byte-identical at `settlement/S50`, where
  both still stand. A frozen record keeps the vocabulary of the day it was
  frozen, so the reader maps the retired spelling forward through
  `world2/tools/ledger-names.mjs` and reports `ledger_followed_rename` when it
  does; where the named file exists it is read untouched and that field is null.
  Note that the founder's ENTEREXIT ruling (2026-08-29, world `3ef755913`) is
  the WORD and not the removal: that commit is not an ancestor of world main, and
  #2894's body misattributes the deletion to it.

### The can-fail proof

The falsifier holds a read-only credential by design, so the breaks are done to
the INPUTS, in memory; the store is never touched.

```
RED    departures read in plain `id` order (the era seam ignored) — 44 finding(s)
RED    the journal era dropped (a port that reads only the frozen ledger) — 1
RED    marks.household read as the handle (the _cred edge) — 68
RED    the TTL predicate widened (every emission stays in the air forever) — 1
INERT  an `opposed` crossing counted as an entry — the break altered no input
RED    the vendored arithmetic drifted (positionAt fed a wrong pace) — 1
RED    an unreadable act skipped instead of refused — 1
can-fail PROVEN
```

The 44 is the measured number, arrived at independently.

**The first pass of this proof was not a proof.** Four breaks read SILENT, and
none of them was: each fed the same broken input to BOTH sides of an equality,
which of course agreed. Every break is now aimed at the ONE equality whose oracle
it cannot reach. And INERT is not SILENT — the standing lane's finding, applied
to inputs rather than rows: a break that altered none of its own inputs proves
nothing, and reading it as "the falsifier missed it" would be a proof lying in
the safe direction. There is no `opposed` crossing in the 158-row record; the
unit suite exercises that predicate instead.

### The A/B against the lab's 1.0 door, and what it found

`GET /world/present` on the lab office (:4382) against `/world2/present` on a
scratch office (:4391), same instant:

```
1.0: 132   2.0: 122
only in 1.0: 12    only in 2.0: quill-stem, dylan-android-husband
1.0 sources: quay 66 · parcel 66          (its dynamic.db was reset; it sees NO walks)
2.0 sources: walk 72 · parcel 24 · quay 26
```

**It found a real port gap, and it is fixed.** `the-post-office` — the vessel —
was in the resident list. She declares departures in `acts` like anyone else, and
nothing in the store says she is not a resident; 1.0 knows, and deletes her
before the union is built: *"she is a mark that moves, not a resident."*
`NON_ENTITY_ACTORS` is her exclusion, ported, dropped from BOTH the roster and
the departures (1.0's own belt-and-braces). She stays in `/world2/positions`,
which is `positionsAt`'s answer over the record and has no such exclusion in 1.0
either — two doors, two questions.

Everything else in that diff is an INPUT difference, checked rather than assumed:

- the 12 only-in-1.0 are **in the town's roll and not in `identities`** — 0 of 12
  have a row. See § unruled, below.
- `quill-stem` has 2 departures in `acts` and no roster row: 2.0 places it from a
  walk record the lab's 1.0 cannot see at all.
- `dylan-android-husband` is in `identities` (`gh:312413958`) with no walk and no
  parcel: the roll puts it on the porch, and 1.0's roll does not name it.

**What could NOT be compared end to end, and why.** The lab's `dynamic.db` was
reset, so 1.0 there answers from ground and the roll alone — its walk half is
empty and its emission table is empty. There is therefore no state on which 1.0
and 2.0 hold the same movement record, and no end-to-end presence comparison is
available on this box. The equalities above are the real receipt: they feed 1.0's
own functions and the port IDENTICAL inputs, which is the comparison the missing
one would only have approximated.

### What is NOT here, said out loud

1. **The carrier-frame overlay (Stage D).** A resident aboard a moving mark reads
   at the place their own walk record put them, not at the carrier's position.
   The fold needs `world-frames.mjs foldFrames`, the vessel timetable and the
   `movements` table, and none of the three has a 2.0 surface. `aboard` is
   ABSENT from these answers rather than always false — a field that is always
   false is a lie with a schema.
2. **The staleness vocabulary** (`standing`, `era`, `ledger_moved`, `as_of`).
   All facts about the sqlite `entities` table and its refresh cadence. 2.0
   derives at the instant asked, so there is nothing crystallized to be stale
   against and the words have nothing to describe.
3. **The live sound lane.** `world.mjs` calls `appendJournal` for leave-mark,
   amend and withdraw only — the say path writes no journal row, so it is not
   mirrored, so `acts` has received nothing said since the seed. Emission
   presence here is the crossing-save's crystallized record. This is a WRITE-path
   gap and it is named on the answer, because a read tier that returned silence
   would be indistinguishable from a quiet town.

All three ride the answers as `DISCLOSURES`, never as silence.

### Unruled, and teed rather than guessed

1. **The earshot radius.** Two readings, and they diverge once the sound class's
   `radius_m` moves — which it has (`class_version` runs 1 → 2 across the seeded
   rows). PER-ACT reads each emission's own stamped `props.radius_m`, which is
   gold §3 rule 2's per-act determinism and the reason `recordEmission` stamps it
   at all: *"a dial changed tomorrow does not retroactively re-govern what
   happened today."* CURRENT reads one dial for the whole answer, which is what
   `voices.mjs heardBy` does today (`distM(point, ear) <= earshotM`). Neither is
   obviously wrong. The door defaults to PER-ACT, `?mode=current&radius=` selects
   the other, and every answer says which rule it applied and that the seam is
   unruled. **Recommendation: per-act.** A historical emission heard at a radius
   it was never spoken under is a re-derived past, which is the thing the whole
   per-act stamping discipline exists to prevent — and the live ear can keep the
   current dial because it is answering about now.
2. **Which roster the read tier asks.** 1.0's doors take the TOWN's roll
   (`ctx.roll` — the door #1864's report came through); 2.0 has `identities`, the
   world repo's `households.json` projected. The two overlap and neither contains
   the other: 12 handles in 1.0's roll have no `identities` row, and at least one
   `identities` handle is not in 1.0's roll. **Recommendation: the town's roll**,
   because #1864's whole lesson is that a roster narrower than the town makes
   residents unaskable-about — but it needs a 2.0 surface for the town roll
   first, which this lane does not have and did not invent.
3. **1.0's `mark.household` has no 2.0 column.** It is a handle; 2.0's
   `marks.household` is the RESOLVED key (1.0's `_cred`), and the seed dropped
   the authored field because a column held its name. The port reads `owner` in
   its place, which is exact on 977 of 977 marks at `c701988f` and is a fact
   about today's register rather than a law. `admissionNotes` fires the day the
   two can differ; the fix would be a 005-class column.

### The vendor tripwire fired, and was re-checked

`tools/enter-exit.mjs` is `c3817c10` at world-2 HEAD (where it was vendored) and
`8a202b05` at `settlement/S50`. The falsifier said so. The diff is 30 lines and
**all of it is prose** — the `LEDGER_HEADER` constant's own explanation. The
grammar (`ENTER_EXIT_RE`) and `occupancyAt` are byte-identical. That is the
tripwire working: it says "re-check", not "you are wrong".

## The write-path guards

`guard-reads.mjs` is DESIGN-pen-flip.md § 2 R3's remaining rows — the three door
guards that still validate against a 1.0 pen:

| 1.0 read | who needs it | 2.0 source |
|---|---|---|
| `liveMarks` / `liveChildrenOf` | leave-mark slug collision, the parcel cap, withdraw's stranding check, declare-stance-on's candidates | `claims` where status ∈ (draft, pending) |
| `draftsForKey` (journal half) | the signed-in draft overlay | `claims` + the withdraw acts |
| `liveHolder` / `readAttachments` | give/drop/take's holder check | `acts`, folded across two eras |

It is `live-reads.mjs`'s twin in shape and differs from it in one way worth
knowing: **the LIVE tier reads and this one PERMITS.** A read tier that drops a
row answers with a number nobody can check; a guard that drops a row lets a
duplicate slug or a fourth parcel through, and the receipt for that arrives at
the next settlement. So every refusal here is strict by default and says what the
skip would have cost.

Pure over rows and a pg client — nothing from `src/` is imported. Where a
predicate is small and exact it is VENDORED with its blob sha (`liveHolder`,
`holdingsOf`, `liveMarks`' record shaper); where it is a whole module's judgment
(`pathFor`, canon's filing) it is REFUSED and taken as an injected parameter, so
the office hands over its own function rather than this file growing a twin. The
falsifier injects 1.0's real ones, which is what keeps `path` on trial rather
than exempt.

### The equalities

```sh
. ~/guards-env.sh
export WORLD2_PG_URL="$W2_READER_URL"       # world2_dev, read-only — G5's store
export W2_GUARDS_URL="postgres://office_api:…@localhost/world2_guards_lane"
export W2_GUARDS_OWNER_URL="postgres://world2_owner:…@localhost/world2_guards_lane"
node world2/tools/falsifier-guard-equality.mjs --world-repo ~/world-full --prove-can-fail
```

Run 2026-08-28, scratch `world2_guards_lane` + `world2_dev` + `~/world-full`:

```
scratch 10 declarations across 2 households · holdings: oracle 43 rows
        (recovered from crossing 155) · port 43 (legacy 43 · live 0)
  · G1_a  compared    4  the live layer, against 1.0's own liveMarks
  · G2_a  compared    4  the three seams (stamps↔stake, put_forward↔status, name↔key)
  · G3_a  compared    4  the children, against 1.0's own liveChildrenOf
  · G4_a  compared    5  the overlay, against 1.0's own replayDrafts
  · G1_b  compared    2      … and the same four for the second household
  · G2_b  compared    2
  · G3_b  compared    2
  · G4_b  compared    2
  · G5    compared   75  the holder fold, against 1.0's own recovery chain
  · G6    compared    2  the RLS refusal, and what office_api cannot see
GREEN · the port and 1.0's own functions agree on every row compared
```

Exit **0** green · **1** RED · **2** cannot run. Every equality reports its own
`compared`; any that compared zero exits 2.

**G1–G4's population is WRITTEN, not found.** On `world2_dev` the two stores hold
different questions — its 851 locked claims are canon (rows in `marks`) and the
lab office's journal holds one row — so comparing them would repeat the live
lane's E2 mistake. Instead ten declarations go through 1.0's own `appendJournal`,
the one function that feeds both pens, into a temp sqlite and the scratch
database. Neither side is arranged; each is what its own pen made of one call.
The script exercises an unstaked leave-mark, a staked one, an amend of a live
draft, a predicated child, a parcel, a withdrawal of a draft, a withdrawal of a
PUBLISHED mark, and a second household holding the same slug.

**G5's oracle is 1.0's recovery covenant, run.** `dynamic-rebuild.mjs` says
attachments are "store-canon-durable — no ledger holds them, so the crossing-save
is their only way back", so the oracle is that way back taken:
`attachmentsFromState` over the world checkout's STATE → `declareAttachment` into
a throwaway sqlite → `readAttachments`. It is not the lab's `attachments` table,
and that is measured rather than preferred — see § What the holdings coverage
actually is.

### The can-fail proof

```
RED    LIVE_STATUSES widened to include 'locked' (canon counted as the live layer) — 1
RED    claims.household read as the bare handle (the resolved-key edge) — 4
RED    parent_id read as absent (the stranding check answers empty) — 1
RED    the deleted arm dropped (a published mark's withdrawal goes unseen) — 1
RED    attachments read in acts.id order (latest-wins handed the seed's insert order) — 70
RED    the live era's entity read as acts.actor (every give handed back to the giver) — 4
RED    the RLS assertion removed (a household-scoped read on an undeclared connection) — 1
can-fail PROVEN
```

The first break read **INERT** on its first pass, and the fix belonged to the
POPULATION rather than to the break: the scratch store held a published mark with
no locked claim behind it, which is not a store this town ever produces. Planting
the claim made the break real. That is the standing lane's finding applied one
lane over — an INERT break proves nothing, and reading it as "the falsifier
missed it" would be a proof lying in the safe direction.

The sixth break's rows are **synthesized**, and it says so: nothing has been
given, dropped or taken since the mirror shipped, so `acts` holds no live-era
holding row to bend. The alternative was leaving that era's sharpest trap
untested until the first give, which is the wrong side of the record to discover
it on. The unit suite (`test/world2-guard-reads.test.mjs`, 17 tests) covers the
same mapping directly.

### In CI — the run that has no prod (POS-107)

**Ruled (Keemin, 2026-09-17, D-A of `DESIGN-standing-flip.md` § 6): "local
postgres is fine to CI."** The scratch database this falsifier needs would be
`CREATE DATABASE` on prod's own server, and that write was refused on 09-17
(postmark#2892 § 1). So `.github/workflows/guard-falsifier.yml` runs it on every
pull request (and on dispatch) against a `postgres:16` service that lives for
one job: the five roles, both databases floored from `world2/schema/` (every
`NNN_*.sql` in name order as `world2_owner`, 003 skipped — it is a falsifier
query, not a migration), a shallow read-only checkout of `keeminlee/postmark-world`
at `main` for `--world-repo`, the run with `--json`. ~2 minutes, most of it
`npm ci`. The floor loop lives in `.github/scripts/guard-falsifier-floor.sh`
and the receipt printer in `guard-falsifier-report.mjs`; both are workflow
machinery, listed by no unit.

**The roles are created nowhere else.** No file in this repo `CREATE ROLE`s
anything — the migrations GRANT to names the box made by hand. The workflow's
list (`world2_owner`, `office_api`, `clearing_job`, `law_ingester`,
`snapshot_reader`, `stance_reader`) is derived from the grantees and is now the
only written record of them.

**`stance_reader` is the sixth name and NOT a sixth pen** (023_stance_reader.sql,
2026-09-22, RULING 2). It holds `SELECT` on `claims` and writes nothing, so the
three-pens law is untouched and 003's first query cannot see it — which is why
003 grew a SECOND query, *who may see a draft*, enumerating the policy carve
instead of a grant. It is in the workflow's list because 023 GRANTs to it and
023 refuses by name when the role is absent, so a floor run without it fails the
migration rather than skipping it quietly. Its credential reaches the office as
`WORLD2_STANCE_URL` and is read in exactly one place
(`src/world2-acts.mjs § stanceQuery`), by exactly one reader —
`worldForStances`, the stance candidate list.

**`world2_dev` is SEEDED, and G5 is the reason.** G1–G4 and G6 write their own
population and are the same equality on any machine. G5 reads a real store —
`acts` against 1.0's recovery over the checkout's `STATE/` — and a floored,
empty `world2_dev` reds it on every holder (measured 2026-09-18: *"1.0's
recovery yields 109 attachment rows, the port yields 0"*, 38 findings, exit 1).
So the job runs the genesis pen first, `seed-import.mjs --with-acts` at the
checkout's own sha (the pen that wrote prod's `legacy:attachment` rows on
2026-08-28; ~3 s at main). G5's verdict in CI is therefore **the port's
legacy-era parse of the seed's rows against 1.0's recovery over the same
STATE** — a real equality, and not a verdict about prod's `acts`. That one
still needs prod's store; box 1 of #2892 records what CI can and cannot say.

**Exit 2 cannot read green.** Every non-zero exit fails its step, and the step
after the run reads the receipt a second time: `unchecked` must be empty and
every equality must have compared something.

**The workflow proves it can go red — twice, on purpose.** Two steps are
expected to FAIL (`continue-on-error`) and the step after each asserts that
they did, and how:

- a `claims` row planted in the scratch store that 1.0's journal never wrote
  (`guards-alfa/the-planted-shed`) → exit **1**, and the slug must appear in the
  log (G1 and G4 name it);
- `--world-repo` with no `STATE/` → exit **2**, and the step must fail on it.

An exit 2 in the first proof would not satisfy it: a run that could not run is
not a run that found the divergence, so the code is captured and asserted, not
just the outcome.

**`--prove-can-fail` is the tool's proof, not the workflow's, and it is GREEN
when it holds.** It breaks the port in memory seven ways and exits 0 when every
break is noticed, 1 only when one goes silent. The job runs it as its own step
on a fresh scratch and asserts every break read RED — none SILENT, INERT or
THREW. Each run after the first gets a fresh scratch (`--fresh`): the falsifier
plants its population through the live pen, and a rerun over the first run's
rows reads green today but would be measuring leftovers.

**What CI does not do.** Nothing reaches prod or the box; the only token is the
default `GITHUB_TOKEN`, used to read a public repo. 003 is not run as a gate: on
any fresh floor it prints 014's two `escrow_projection` rows, the same red prod
carries (Wright's, named on #2897). The rest of the office suite is not in CI
(a separate decision; the office still has no suite workflow).

### What the falsifier found

**1 · `acts.household` and `claims.household` spell one fact two ways.**

```
acts.household     'darko'  ×12 — every live-written act; NULL on all 2925 seeded ones
claims.household   'gh:67605380', 'solo:the-town', … — the RESOLVED KEY
```

The docket pen was corrected to the key on 2026-08-28 ("a roster owner keeps the
household KEY; a non-roster owner is `solo:<handle>`, never NULL") and the acts
mirror was not — `mirrorAct` writes `row.household` verbatim, and that is
`resolvedWorldHousehold(key)`, the office key's NAME.

The draft overlay reads **both tables**, so this is not cosmetic: a read that
filtered `claims` by the key and `acts` by the same string would return every
added and modified mark and NONE of the deleted ones, silently, for every
household in town. `pgDraftsForKey` scopes the withdraw acts through
`identities` — the projection that DEFINES the mapping, and the one
`householdKeyFor` reads to write the claim — so the two cannot come apart the way
the columns have. `admissionNotes` fires while they disagree and goes quiet when
the acts mirror adopts the same ruling.

**2 · The deleted arm has no `claims` source at all.**

`replayDrafts` produces three statuses and `claims` can answer two.
`submitClaimFromJournal`'s withdraw arm deletes a draft or retracts a pending
claim, and rules on the third case itself: "rowCount 0 is lawful: withdrawing a
PUBLISHED 1.0 mark has no pending claim to retract". Lawful for the docket and
fatal for the overlay, which draws the mark the household is proposing to remove.
It is not lost — the withdraw act mirrors — so the arm's source is `acts`, scoped
to withdrawals whose mark still STANDS in `marks`. That scope is the mark's own
life rather than the log's, which is self-limiting and needs no cursor: `acts` is
append-only and would otherwise keep showing a mark deleted three settlements
ago.

**3 · The docket pen discards the bare slug.**

`const { slug: _s, … } = payload` — the column holds the full id and the bare
slug is thrown away. 1.0's live mark carries both, and the collision guard speaks
the bare one back: `you already have a mark "${clean.slug}"`. Derived here from
the id with 1.0's own `idPartsOf` rule, which is unambiguous for the reason
`world-journal.mjs` states: the office's slug grammar is `^[a-z0-9][a-z0-9-]*$`,
so an id is exactly two segments.

**4 · A household-scoped guard read outside `withHousehold` PERMITS.**

007's row policy is written for exporters — "a public read compares against NULL,
which is never equal to anything, and sees none" — and that is exactly right for
the notary and lethal for a guard. A slug-collision check on an undeclared
connection sees the household's pending claims, none of its drafts, finds no
collision, and permits a duplicate, with every policy working as written and
nothing saying the answer was partial.

`assertHouseholdDeclared` refuses instead: one round trip, asking
`current_setting('app.household', true)` — the policy's own question — and
throwing when it does not match. Refuse, not degrade, applied to a read. G6 is
what proves it fires.

**5 · jsonb does not preserve key order.** `{w,h}` goes in and `{h,w}` comes
back; the values are identical. Readers that read fields are unaffected; a reader
comparing two marks by `JSON.stringify` would see every mark as changed. The
falsifier canonicalizes key order and compares everything else exactly.

### What the holdings coverage actually is

Measured 2026-08-28, because the brief asked for it honestly rather than
assumed:

```
43   legacy:attachment acts on world2_dev
43   attachment events in the world repo's STATE/log at settlement/S47
     (= sandbox/seed, what the seed read) AND at settlement/S50
43   attachments in STATE/snapshot/150's boundary — the whole table, saved
 0   rows in /srv/world2-lab/office/dynamic.db  attachments
 0   rows in /srv/postmark-office-dev/dynamic.db  attachments
 0   give / drop / take acts
```

**The gap is on the sqlite side, not this one.** `acts` holds the complete
holdings record; the 1.0 stores on this box hold none of it. So the usual
disclosure inverts — there is no live 1.0 holder state to disagree with, which is
why G5's oracle is the recovery covenant rather than a table. An equality against
those tables would have compared 43 rows to nothing and called the port wrong,
or compared nothing to nothing and called it green.

### Unruled, and teed rather than guessed

- **`held_review` is not in `LIVE_STATUSES`.** It has no 1.0 counterpart: in 1.0
  a colliding declaration sits in the journal until the settlement adjudicates
  it, so it IS live. Including it is safer for the slug-collision guard and wrong
  for the parcel cap. Zero rows today, so the choice is free; `admissionNotes`
  fires the day it is not.
- **The cross-household live read is structurally narrower than 1.0's**, by
  exactly the other households' drafts. 1.0's `worldForStances` deliberately
  surfaces another household's sketch when it overlaps ground you hold — "the ONE
  place a sketch becomes visible to somebody who did not write it", which
  the-late-welcome asks for. Under 007 that is not narrowable for `office_api`,
  it is unrepresentable. Two laws collide and which gives way is a ruling.

  **RULED, 2026-09-22 (Wright, G1 overnight RULING 2; POS-195).** Neither gives
  way. A THIRD credential is cut — `stance_reader`, `world2/schema/023` — holding
  SELECT on `claims` through a policy carve that admits drafts to that role
  alone, used by exactly one reader through `WORLD2_STANCE_URL`. 007 stays
  general for `office_api` and every other role; the-late-welcome stays true.
  What moved is the RECORD the fact is read from, not the boundary: the
  derivation's output carries a candidate's existence, standing and weight, and
  `claims.body` is not in its column list — so a draft's text is never fetched.
  Two falsifiers hold that (this file's own § the stance carve, and
  `test/stance-candidates-read-the-store.test.mjs § THE SENTINEL`).

  ⚠ **It is a behaviour change, and the ruling's own wording understates it.**
  The 1.0 read did NOT carry only existence/standing/weight: tier 2 published a
  120-character body excerpt as `says` and tier 3 carried the body WHOLE. Those
  are now omitted for an unpublished candidate. Reversible in one word — add
  `body` to the column list — and the sentinel test reds when you do.
- **`path` is null unless injected.** 2.0 has no mark tree, and a guessed filing
  is worse than a missing one: gate A refuses a mark filed at the wrong place at
  the next lint, so a plausible guess would turn an absent field into a refused
  settlement.
## The town's roll (Keemin's ruling, 2026-08-29)

`live-reads.mjs`'s `DISCLOSURES.roll_source` teed a seam and refused to guess at
it: *"Which roster the 2.0 read tier should ask is unruled."* `/world2/present`
asked `identities` — the world repo's `households.json`, 102 handles — while
1.0's own doors ask the TOWN's roll (`townRoll()` → `residentList`, 132).

Ruled: **the town's roll**, for issue #1864's reason, which `positionRoster`
already carries verbatim — *"28 of 103 residents were not answered wrongly, they
were never asked about."* A narrower roster produces no red. Twelve people were
simply not in the question.

| file | what it is |
|---|---|
| `roll-ingest.mjs` | the town repo → `town_roll` rows. Derives; does not write. |
| `010_town_roll.sql` | the table, its grants, its `registry` row |

### The roll has one definition, and it is two steps

Both imported live, neither restated:

1. `readTown` (`vendor/tools/lib/town.mjs`) enumerates it — *"residents (skip TEMPLATE —
   it's the blank form, not a resident)"*.
2. `isResidentHandle` (`src/residency.mjs`) admits it, and that file says why
   step 1 is not enough alone: *"The vendor's enumeration skips exactly one name
   (`n !== "TEMPLATE"`) — a NAME LIST, not a rule, which is why the second
   non-resident directory walked straight through it and `_archived` came out of
   the live walkers door standing on the quay."*

Those are the same two steps `residentList` applies to the office's own index.
At town `830a6996`: 140 WHITE_PAGES entries → 133 directories → **132 handles**,
and 132 is exactly what the lab's 1.0 door answered with on 2026-08-28.

The office's readers are imported from THIS checkout rather than from the town
one, and that is the right half of the reuse rule: the town owns its frontmatter
(`vendor/tools/lib/town.mjs` is that reader, vendored under a do-not-edit-here notice),
while who counts as a resident AT THE DOOR is the office's own law.

### One pen, one head

`roll-ingest.mjs` holds no credential. `stamp-ingest.mjs` writes both town
projections inside its one transaction, because `projection_heads['town']` is
ONE ROW: a head standing at a sha with stamps and no roll could not say what
roster its clearing computed against, and the determinism property ("outcomes
reproducible from `(claims, law_sha, town_sha)`") would quietly stop covering
half the town's facts. `writeStamps` REFUSES a call with no roll rather than
writing half a head.

`data` is the resident's ADDRESS.md frontmatter as the town's reader returned it
— *"the parser's own output, not a normal form invented here"*, kept from
`law_projection`. `{}` for a resident with no card: the roll is a list of PEOPLE,
and a missing card is a missing card, never a missing person.

### What changed at the door

`/world2/present` joins `town_roll` through `projection_heads` (the PINNED head,
not `max(town_sha)`), so the roster the answer used is the roster a window
pinning that sha was cleared against. `identities` is still read and still does
its own job — the household KEY a resident's ground is grouped by. Two rosters,
two questions: the roll says who to ask about, the identities say whose ground
counts as yours.

```
before   1.0: 132   2.0: 122
after    1.0: 132   2.0: 133   (all 132 roll handles placed; the 133rd is
                                quill-stem, who has walks in `acts` and no
                                WHITE_PAGES directory at the pinned sha)
```

### The invariant, and its live red

**identities is a subset of town_roll** — every world identity is a town
resident. One line in `falsifier-projection-equality.mjs`, and it went RED on the
live store the first time it ran: `dylan-android-husband` sat in `identities` and
in no WHITE_PAGES directory. The store's law projection was at `0c1aa924`, which
predates Keemin's strip of that alias at world main `559301d4`; re-ingesting law
at main turns it green (101 identities, 0 outside the roll). A can-fail proof on
real data, for free — and the reverse is NOT symmetrical: the town is the wider
list by design, and a resident with no world household is simply someone not yet
grouped.

### The red-proof carries the run

```
node world2/tools/falsifier-projection-equality.mjs --law-repo ... --town-repo ...
GREEN . town @ 830a6996 - {"roll_derived":132,"roll_db":132,"identities_outside_the_roll":0}

# three kinds of drift, by hand - DELETE and INSERT are the pen's own grants,
# the UPDATE has to come from the owner (there is no UPDATE on a projection)
DELETE FROM town_roll WHERE town_sha='<t>' AND handle='wright';
INSERT INTO town_roll (town_sha,handle,data) VALUES ('<t>','not-a-resident','{}');
UPDATE town_roll SET data = jsonb_set(data,'{joined}','"1999-01-01"') WHERE handle='rei';

RED . town @ 830a6996 - 3 drift finding(s)
  - town_roll DIFFERS at rei . field data . first divergence at char 334
    repo says: ..."joined":"2026-06-12",...
    DB says:   ..."joined":"1999-01-01",...
  - town_roll MISSING in DB: wright
  - town_roll EXTRA in DB (repo derives no such row): not-a-resident

# repair is running the pen again; green again.
```

And `E5c` in `falsifier-live-equality.mjs`, which asks what the union cannot ask
itself: that the roster the ANSWER used is the roster that was ruled, that 1.0's
own `publicResidents` and the port agree over it, and — as a receipt, never a
gate — that the gap closed.

```
  . E5c  compared 133  findings 0
         roll 132 (identities 101) . present 133 (was 121) . gained 12: andromeda,
         bellamy-spark, caelan-rhys, elias-returning, jack-astra, kept-elsewhere, ...

can-fail break 8: "the roll read as `identities` (the pre-ruling roster)" - RED, 2 findings
```

The break is aimed at E5c and E5 cannot see it, which is the point: E5 compares
the port and 1.0 over whatever roster BOTH are handed, and a narrowed roster is
handed to both.

## The REVIEW lane's verb

`claims.status` has carried `held_review` since 001 and `clearing-job.mjs` step 5
puts claims into it (census D2: *"neither locks; both held for REVIEW (a mind
rules)"*). Nothing took them out. **A state a system can enter and never leave is
not a lifecycle stage, it is a hole with a name** — a contested parcel would have
sat on a closed window's docket forever wearing a status that promised a decision
nobody could record.

| file | what it is |
|---|---|
| `review-rule.mjs` | the operator's ruling: grant · refuse · hold |
| `materialize.mjs` | steps 6 and 7 EXTRACTED, so the candle and the ruling share one |
| `falsifier-review-closure.mjs` | a ruled claim ends in one lawful state, with a receipt naming who ruled |
| `009_review_ruling.sql` | `claims.ruling jsonb` |

```sh
export WORLD2_CLEARING_URL=postgres://clearing_job:...@localhost/world2_dev
export WORLD2_OFFICE_URL=postgres://office_api:...@localhost/world2_dev

node world2/tools/review-rule.mjs --claim <uuid> --rule grant \
  --by wright --because "<one sentence>"        # --dry-run rolls back
node world2/tools/review-rule.mjs --claim <uuid> --journal-only   # the repair
```

### Why an operator tool and not a door

Three reasons, and the first is the substrate refusing. **The pen**:
transitioning a claim is `clearing_job`'s grant and `claims_update_guard` exempts
exactly that role, so an `office_api` endpoint could not do this if it wanted to
— and giving the door the clearing pen so that it could would hand the candle's
whole authority to the widest surface. **It is not a resident verb**: there is no
grant in `law_projection` for settling someone else's contest and there should
not be. **The precedent is in this file**: *"The REVIEW lane — 'a mind clears it'
— lives entirely in the GitHub PR flow … Nothing in this directory decides
anything."* That is about LAW review; this is the CLAIMS half of the same lane,
and every judgement arrives on the command line (`--by`, `--rule`, `--because`).
The tool computes none of it, and refuses to run without all three.

### Why it materializes rather than re-dockets

The cheaper design is to put the winner back to `pending` and let the next candle
lock it. It is wrong, and Decision 2's last sentence is why: a claim's escrow was
judged at ITS window's `town_sha`, so re-pending would have the candle re-judge
it at a different one — able to REFUSE a claim a mind had already granted, which
is stake-weight overturning the mind.

What a ruling does not get to do is rule on a world that has moved. Steps 1 and 4
are re-asked at ruling time and a failure **refuses the run**, not the claim:

```
RULING REFUSED: the world moved while this claim was held, so the ruling is REFUSED
rather than applied:
  - this parcel now overlaps standing parcel "adam-rhys/hollow-edge" - the ground was
    taken while the claim was held; contesting a STANDING mark is a different question
    from the one that was held
Nothing was written. Re-decide the contest against the world as it now stands.
```

The mark locks into the OPEN window, not the held one: the held window is closed
and its acts may already be in the notary's frozen archive. That is the drafts
lane's own ruling one lane over — *"putting-forward dating accepted (also avoids
inserting into notary-frozen windows)"*.

### The extraction, and the receipt that survives a close

`materialize.mjs` is the candle's steps 6 and 7, moved rather than copied — one
`materializeClaims`, one `recomputeStanding`, two callers. A mark that arrives by
a ruling and one that arrives by the candle are the same row by construction, and
the standing recompute is not optional in a ruling: granted ground moves a
neighbour's tier exactly as a clearing's does.

The ruling lands on three surfaces — `claims.ruling` (the receipt on the thing
ruled), `windows.receipts.review_rulings` (the window's own account), and an
`acts` row (the public deed). `clearing-job.mjs` now CARRIES `review_rulings`
forward when it closes a window, because that `UPDATE` replaces `receipts` whole
and would otherwise erase a decision the town made inside it. **Proved by flip**:
remove the carry-forward line, close a window holding a ruling, and R6 goes red
naming both claims.

### The one seam this lane does not close

`clearing_job` holds no INSERT on `acts` (that is `office_api`'s), and
`003_falsifier_roles.sql` exists to red when a fourth writer appears — so
granting it one is law-tier and **teed, not taken**. The run is therefore
ORDERED, not atomic: the ruling transaction commits, then the act is written on a
second connection. The order is chosen so the failure is recoverable — `acts` is
append-only, so an act for a ruling that then rolled back could never be removed,
while a ruling whose act did not land is fully recorded in `claims.ruling` and
`windows.receipts` and can have its act written afterwards (`--journal-only`).

**Recommendation: grant `clearing_job` INSERT on `acts`** and make the ruling one
transaction. It is the same pen already writing `marks` and `windows` inside that
transaction; the alternative is a two-phase write on the one lane whose whole
subject is a decision somebody has to be able to audit.

### The census cannot see this lane

`falsifier-acts-lane-closure.mjs` has two censuses and BOTH are anchored on the
sqlite journal — one over the apex's dispatchable verbs, one over the classes the
journal holds. A `review` act is written by no 1.0 pen and reaches no journal: it
is the first act in this store **born in `acts`**. Neither census is blind by
accident; they are blind by construction, which is why the closure falsifier is
its own file.

### The red-proof carries the run

Run end to end on a scratch copy of `world2_dev`, 2026-08-29:

```
asleep before any ruling (exit 2)   - "2 claim(s) sit in 'held_review' unruled"
RULED grant . wright/contested-meadow . by wright
  11111111 wright/contested-meadow: held_review -> locked
  22222222 rei/same-meadow:         held_review -> refused
  materialized 1 mark(s); standing recomputed over 849, 1 moved (null->home); act 2939
closure GREEN . and still GREEN after the window's own close
FLIP: carry-forward removed -> R6 RED, naming both claims
refusals proven: a claim that is not held . a ruling with no --by . the ground taken
hold, then refuse: closure GREEN with "2 pairings record an EARLIER ruling - history, not drift"
--self-test: healthy shape green, 12 injected faults each firing the check it was aimed at
```

**Two live reds were the check being wrong, and both were the pairing key** —
`falsifier-acts-claims-closure.mjs`'s *"journal_seq is not an identity"*, twice
more. An act covers its whole CONTEST rather than one subject claim; and it pairs
on `(claim, ruling.at)`, because a contest may lawfully be ruled twice (a `hold`
and then a decision) and `acts` is append-only precisely because history
accumulates.

## Conversations, served from acts (D4's read port)

`/world/conversations` is the page the town reads itself back from, and 1.0
serves it out of `voices-log.jsonl` — a box-local file, never git, backed up by
nothing. It was the last read in the live tier still answering from a 1.0 pen,
and that file dies at cutover.

| file | what it is |
|---|---|
| `conversations.mjs` | 1.0's thread derivation over voice acts; the say dials read from `marks` |
| `falsifier-conversations-equality.mjs` | the port vs `voices.mjs` itself, on identical inputs |

`/world2/conversations[?at=][&closed=][&voices=]` is the door.

### The record was already there, and it was measured before anything was built

Every voice is also an emission (`emissionFromVoice`, *"the second consumer of a
voice"*), every emission is crystallized into a crossing log, and the seed
carried 1,630 of them into `acts`. Since 2026-08-28 the LIVE lane reaches `acts`
directly too (`world-journal.mjs` § THE LANE HOOK). Against the prod office's own
voices log:

```
1,630 emission acts . 1,630 log lines inside the acts era . 0 missing . 0 extra .
0 field-drift rows.   823 log lines predate the era; 238 postdate it.
```

### The two eras, and the frontier between them

| era | how identified | where the point comes from |
|---|---|---|
| `crystallized` | `legacy:emission`/`emission` with `payload.payload.class === 'sound'` | `payload.payload.x/y`, the raw point the crossing log froze |
| `live` | `action === 'say'` | the WITNESSED LINE composed back: `at_anchor` + `at_dx/at_dy` |

The eras disagree about position ON PURPOSE: the crystallized one stores a bare
x,y because that is the photograph the crossing log took, and the live one stores
an anchor and an offset because the witnessed-line ruling says a bare world x,y
is *"a photograph of a moving thing"*. A live say whose anchor does not resolve
is REFUSED, never placed at `{0,0}` — `composeAnchor`'s own refusal, carried up,
and the Origin is a real place somebody could be standing.

An act no era explains refuses the whole read, by name. That is the live lane's
rule and it earned itself twice there.

### The dials come from the store

*"every standing number of speech reads off this node's dials"* — `the-town/say`
says so in its own record. In 2.0 those dials are `marks` rows: the say class's
PREDICATE CHILDREN, each carrying `data.slot` and `data.value` under
`data._parent_is_law = 'the-town/say'`. So this door asks Postgres and needs no
1.0 store at all, which is what makes it cutover-ready.

⚑ **And the honest limit**: all seven recorded values currently EQUAL
`voices.mjs`'s fallback constants (60 · 5 · 30 · 20 · 15 · 15 · 500), so a bug in
the dial SOURCE would be invisible in every comparison until one of them moves.
C4 says so rather than reporting a green it did not earn.

### The equalities

`voices.mjs` is VENDORED rather than imported (`clusterVoices`, `threadOf`,
`chains`), because its module init reads the 1.0 sqlite world store at import
time — putting a 1.0 store read in the boot path of a Postgres-only door is the
coupling this whole tier exists to end. The falsifier imports the original and
holds the copy to it.

```sh
WORLD2_PG_URL=postgres://snapshot_reader:...@localhost/world2_dev \
  node world2/tools/falsifier-conversations-equality.mjs \
    --voices-log /srv/postmark-office/voices-log.jsonl --can-fail-proof
```

```
1631 voice act(s) -> 1631 voices (crystallized 1630 . live 1) . 2707 in 1.0's log
  . C1  compared 1631  findings 0
        crystallized 2026-08-10T04:20Z -> 2026-08-27T05:18Z (1630) . live 2026-08-28T18:00Z (1)
        . log before 823 . 6 between the eras (spoken, not yet crystallized) . after 247
  . C2  compared 1631  findings 0     the vendored clusterVoices vs voices.mjs's own
  . C3  compared   43  findings 0     1.0's whole conversations() vs the port's, thread for thread
  . C4  compared    7  findings 0     the dials (see the limit above)
GREEN
```

C3 runs 1.0's REAL render: `threadOf` is module-private in `voices.mjs`, so the
only way to reach it is through `conversations()`, which reads a log — so the
acts-derived voices are written to a temp log in the log's own format and 1.0's
own reader is pointed at it. Identical inputs, two whole pipelines.

### The one loss, allowed by name

```js
LOST_TO_THE_PRE_FIX_ERA = [{ at: "2026-08-28T16:18:38.744Z", handle: "wright", receipt: ... }]
```

One row, keyed `(at, handle)`, with its receipt — not a widened window, not a
tolerance. It PRINTS whether or not it fires, so a second loss cannot hide behind
the first one's excuse, and can-fail break 7 (*"a SECOND lost voice, not the
allowed one"*) is what proves that. It reads UNEXERCISED today and that is
correct: 16:18:38 sits in the frontier between the eras, which no era covers.

### Two findings came out of the proofs, and both outlive them

- **The eras are scoped SEPARATELY, and the first cut did not do that.** It took
  `[min(acts), max(acts)]` as one contiguous stretch — true while `acts` held
  only the crystallized record, and false the moment a live say landed, because
  that range swallows the un-crystallized frontier. The run that found it
  reported five prod voices as missing when every one was simply not crystallized
  yet: a false finding manufactured by the check's own scoping (AB-P1's shape).
- **Era scoping is blind at the edges, and that is stated rather than tuned
  away.** The first can-fail break dropped the LAST voice and read SILENT — not
  the check missing a loss, but the boundary moving with it. C1 covers the
  record's INTERIOR; the FRONTIER belongs to `falsifier-acts-lane-closure.mjs`,
  which compares each lane's own pen against `acts` from a standing `--since` and
  therefore has a boundary no loss can move.

```
can-fail proof:
  RED    a voice missing from the middle of `acts` (the say lane silently open again)
  RED    a voice's text bent in the act
  INERT  the vendored chain rule loses the deck exception - the record holds no aboard
         pair beyond earshot within one lull, so the break proves nothing here
  RED    the record clustered on the EAR's clock (fadeMs, not the lull) - 32 findings
  RED    the earshot widened to the whole town - 32 findings
  RED    an unreadable voice act skipped instead of refused
  RED    a SECOND lost voice, not the allowed one
  can-fail PROVEN
```

### What is NOT here, said out loud

1. **No listeners and no presence.** 1.0's `hear` answers who is within earshot
   right now from a RAM map that is empty after every restart. That is a fact
   about a running office, not about the record.
2. **No look-back bound.** 1.0 clusters the last 2,000 voices it holds in memory
   (`MEMORY_MAX_VOICES`); this clusters every voice the store holds. The bound is
   a property of a process, not of the record, so there is nothing to reproduce —
   and it is a REAL divergence that bites the day the record passes 2,000. Named
   on the answer rather than matched.

## The apex, served from the store (B2 · P-089)

The A/B report's largest gap: *"`GET /world/apex` — the whole orientation
answer, and with it every A2 read shadow (P-016…P-034) | P-089 | `law_projection`
+ a spine/reach query. The door's grammar is the contract the viewer speaks."*
Twelve `/world2/*` doors existed and `/world2/apex` was not one of them.

```
GET /world2/apex?x=<m>&y=<m>[&crossing=<n>][&law_sha=<sha>][&roster=roll]
```

Keyless, like 1.0's `GET /world/apex?x=&y=`, and ADDITIVE — the 1.0 apex is
untouched, so rollback is not routing to this one.

`apex-reads.mjs` is the derivation half and `src/world2-serve.mjs § world2Apex`
owns the queries and the render, the same split the live lane uses. Three
sources, and each says what it could not do:

| half | source | what stands in for the import |
|---|---|---|
| `actions` · `granted` · `not_yours` · `actors` | `law_projection` at ONE pinned `law_sha` | the grant law is **imported**, not ported — `world-grants.mjs` is already pure ("rows in, entries out"), so `resolveForActor` / `entriesOfClass` / `classOfInstance` are the same functions 1.0 runs |
| `within` · `nearby` · `departures` | `marks` + `kind='skeleton'` rows | the world ENGINE's own `orient` / `openYourEyes` / `stopDepartures`, run over a world **assembled** from rows — gold §Phase 3 read literally: "the engine's verbs/geometry/adjudication port as pure functions over queries" |
| `present` | `acts` | `live-reads.mjs`, already on trial at `/world2/present`, in the apex's `near()` render |

**The law pin.** `windows.law_sha` is written AT THE CLEARING, so the OPEN window
carries NULL (world2_dev 2026-09-03: window 168 open unpinned, 167 closed pinned
`cba817d7`). `lawShaFor` resolves asked → open window → **last closed window** →
`projection_heads`, and the answer names the rung it used. Last-closed before
head is deliberate: the head is whatever the ingester last pushed and may be law
no window has cleared against.

**`?roster=`.** 1.0's apex `present` reads a two-term union — `world.mjs §
worldOrient` calls `presentNear` with no `roll:`, so `near()` takes its
`roll = []` default — while `GET /world/present` gets the town roll. The default
here REPRODUCES 1.0 (the GO is equality); `?roster=roll` serves the 2026-08-29
ruling's wider one. At the quay that is 1 resident against 49.

### The equalities

```sh
export WORLD2_PG_URL="postgres://snapshot_reader:…@localhost:5432/world2_dev"
export WORLD2_PG=1 WORLD_APEX=1 WORLD_PRESENCE=1 WORLD_EMISSIONS=1 WORLD_MOVEMENT_V2=1
export WORLD_CLONE=/srv/world2-lab/world-frozen
export WORLD_STORE_DB=/srv/world2-lab/office/world.db LEDGER_FREEZE=1
node world2/tools/falsifier-apex-equality.mjs --world-repo /srv/world2-lab/world-frozen --prove-can-fail
```

Run 2026-09-03 against `world2_dev` + the frozen lab office, 14 standpoints
derived from the store (a berth, the vessel, the Origin, the commons, a
minting ground, a mark inside a parcel, a parcel centre, open ground, six spread
parcels):

```
  ·  A1   compared    14  granted, per standpoint
  ·  A2   compared   168  the whole card set, field by field
  ·  A2b  compared    14  the card ORDER
  ·  A3   compared    53  the containment spine
  AMBER A4/A4b       182  the field of view — AD-1
  ·  A5   compared   168  terms, built by 1.0's own buildTerms from BOTH laws
  ·  A6   compared     5  the rendered resident, over shared handles
  ·  A6b  compared    14  the presence bound
  ·  A7   compared    14  the top-level KEY SET
GREEN · every equality holds (100 acknowledged divergences; --strict makes them red)
```

Exit **0** green · **1** RED · **2** cannot run. Every equality reports its own
`compared`; any that compared zero exits 2. `--strict` promotes every
acknowledged divergence to RED and the same run then exits 1 — which is what
keeps the acknowledgements from becoming a blindfold.

**`records`, and A8 (postmark#2896, 2026-09-17).** A7 on prod found the door
answering twelve top-level keys to 1.0's thirteen at all fourteen standpoints,
and the missing one was `records` — "the full mark record for everything
`within` and `nearby` just named, plus the town's ground". The door now
composes it the way `world.mjs § markRecords` does (the named ids, then the
region rings and the water by the engine's own readers, then the mover's
class), each record in the FOLD'S PUBLISHED SHAPE — `apex-reads.mjs §
records` vendors the fold's key set from `marks-fold.mjs § the published mark`
with the blob named. Seven of the fold's fields are on no row and are ABSENT,
never zero: the escrow figures (`stamps` `weight` `weight_parts`
`ledger_weight`) and the walk's receipts (`sovereign` `placementParent` `kept`);
the answer's `disclosed` names them. **A8** compares the id set and then every
record field by field under `records[<id>].<field>`, so those seven are
acknowledged by name (AD-5, AD-6) and amber, and any other field going wrong
is red — a `parent` read off the directory instead of the authored line (the
first cut's shape, 365 of 365 records), a `tier` the store has not recomputed
(#2895's ten), a `declared_household` the clearing wrote from a stale roster.
A8's break in the can-fail proof is a record inside a right block going wrong,
not the block going missing — that is A7's, and would prove A7 twice.

**The sample is DERIVED, never typed in.** A hardcoded coordinate list rots the
first time a mark relocates and would keep reporting greens for a class it had
stopped testing. Each standpoint is a requirement with a finder, and a
requirement that finds nothing REFUSES.

**The human lane does not exist at this law, and the run says so.** The only
`for: "human"` grant at `cba817d7` sits on the `human` class itself — an ACTOR
class, not a ground — so no standpoint in this world hands a human feet. S5
stands in for what that standpoint was chosen to test (the ground channel) and
the absence is printed.

### The can-fail proof

Nine breaks, each a plausible defect of this port, applied in memory. The proof
runs with acknowledgements SUSPENDED and against a per-equality baseline
SIGNATURE — not a count. Both were defects in the proof itself: A4's break came
back MISSED because its divergences are acknowledged, then came back falsely
caught because dropping a mark happened to emit the same NUMBER of diff paths.

```
caught  A1     0 ->  14  a class the projection admits that the store's gate refuses
caught  A2     0 ->   1  a blurb quoted from the wrong residue
caught  A2b    0 ->  12  the ground/ambient precedence resolving the other way
caught  A3     0 ->   2  a lost `points:` ring, so the spine falls back to the bbox
caught  A4    11 ->  11  a mark dropped from the field of view (caught by signature)
caught  A5     0 ->  60  the residue pointer moved, so `means` quotes the wrong class
caught  A6     0 ->   2  a resident rendered at the wrong bearing
caught  A6b    0 ->   1  the presence bound moved
caught  A7     0 ->   9  a top-level key going quietly missing
```

### The acknowledged divergences

Declared as DATA so the report prints them, `--strict` promotes them, and a
reader sees the whole list without reading the comparator. Each names the 1.0
line that produces it.

- **AD-1 · `nearby` membership and order.** `world-engine.mjs § lodScore` ranks
  by angular size MODULATED BY STAMPS; `stamp_projection` holds per-HANDLE
  balances, not per-mark escrow, so the port emits `weight: 0`. Closes with
  parity **P-006**'s escrow view (RULED, unbuilt).
- **AD-2 · `present.residents[].standing` / `.aboard`.** The FRAME half, which
  `live-reads.mjs` refuses rather than approximates. Absent, never `false`.
- **AD-3 · `law.hydrated_at` / `as_of_world` / `source`.** 1.0 names the bake;
  there is no bake here, so the block names the law PIN. The one field where
  equality would be the defect.
- **AD-4 · `present` aggregates.** The two stores hold different amounts of one
  record (1774 departure acts over 80 handles in `acts` against 317 over 50 in
  the frozen clone, PG a strict superset). A6 compares the render over shared
  handles and prints its scope.

Two exclusions are computed rather than acknowledged, so A6 can still fail:
handles whose governing departure differs between the records, and handles the
1.0 PRESENCE BAKE has not caught up to — `dynamic-presence.mjs:99` reads the
crystallized `entities` table, "refreshed on a tick", not the ledger. 80 of 80
on this pair, printed every run.

### What this lane found

1. **`ambient` is stored as a STRING in `law_projection` and as a BOOLEAN in the
   sqlite store.** `marks-fold`'s `parseRecord` has no boolean case, so
   `ambient: true` arrives as `"true"`; `world-hydrate.mjs:457` NORMALISES
   (`(m.ambient === true || m.ambient === "true") ? true : null`) and
   `law-ingest.mjs` stores `recordData(m)` raw. Any consumer carrying 1.0's
   `json_type(props,'$.ambient') = 'true'` test to the projection reads every
   ambient class as non-ambient — twelve resident grants at every standpoint
   became zero on this door's first run. **The fix belongs in the ingester**
   (normalise once, at the pen); this door reads the hydrator's own two
   spellings meanwhile. `falsifier-projection-equality.mjs` cannot see this by
   design — falsifier and ingester share the deriver.
2. **`stopDepartures` needed no port at all**, only the call: the timetable
   rides on a mark and marks are in the store. A7 (the key-set equality) is what
   found it missing — twelve keys against eleven at the vessel. No value
   comparison could have.
