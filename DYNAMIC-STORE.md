# The dynamic store

`dynamic.db` — the town's **third** database, and the first one that is not an
index. `office.db` indexes the town repo, `world.db` indexes the world repo, and
both may be deleted at any moment without losing a fact the town owns. This one
holds state no repo currently holds: where a resident is standing, what they are
riding, and what was said that is still hanging in the air.

Stage 2 of the world-graph plan
(`G:/Starstory/docs/2026-08-09/world-graph-apex-proposal.html`, §2.7 / §2.8),
behind one flag, off by default, and off is byte-identical to not having it.

## Run it

```
npm run dynamic:rebuild                 # re-derive entities from the ledger; recover attachments from STATE/
npm run dynamic:store                   # the flag's instrument panel (= GET /world/dynamic)
npm run crossing:save                   # crystallize the live layer into the world repo's STATE/
npm run crossing:replay-check           # THE FALSIFIER — rebuild from STATE/ alone and diff
npm run world:drain                     # POS-5: empty the journal into the record, then truncate (WORLD_SINGLE_LOG=1)
npm run threads:parity                  # the store's threads vs the shipped clusterVoices
node --test test/dynamic-presence.test.mjs
node --test test/dynamic-store.test.mjs
node --test test/dynamic-emissions.test.mjs
node --test test/crossing-save.test.mjs
node --test test/world-journal.test.mjs
node --test test/world-drain.test.mjs
node --test test/settle-at-save.test.mjs
```

## The files

| file | what |
|---|---|
| `src/dynamic-store.mjs` | the DDL, the flag, the **class-mark dial read** and its gates, the health surface |
| `src/dynamic-entities.mjs` | the walk-ledger derivation: events → governing departure → position, and the attachment writer |
| `src/dynamic-emissions.mjs` | recording an emission, presence as a query, threads as a query, the gated prune |
| `src/dynamic-presence.mjs` | who is near whom: `near`, `everyone`, and the section the doors hang off |
| `src/world-journal.mjs` | **the single log** (POS-5 slice 1): the journal's row schema, the anchor+offset witness stamp, the replay reader, and the §1c read door |
| `src/world-drain.mjs` | **the drain** (POS-5 slice 2): journal → sketchbooks + `STATE/log/<N>.journal.jsonl` → truncate, as one act; and the two public ledgers, materialized at the save |
| `tools/state-to-r2.mjs` | the cold archive — wired AT THE SAVE by the drain (§5), never on a timer of its own |
| `tools/crossing-save.mjs` | the save tick: `STATE/snapshot/<N>/entities.json` + `STATE/log/<N>.jsonl`, committed with the pen |
| `tools/crossing-replay-check.mjs` | rebuild from `STATE/` alone; EQUAL or the save does not save the world |
| `tools/thread-parity.mjs` | store threads vs `voices.mjs`'s shipped `clusterVoices`, as a partition |
| `tools/dynamic-rebuild.mjs` | the covenant, executable |
| `deploy/postmark-crossing-save.{service,timer}` | crossing-aligned, and **running on the box**: the world repo carries a `crossing-save <N>` commit a few minutes after each crossing (save 220 at 2026-09-30 00:04Z) |

## The covenant, which is narrower than the other two

**Every row is re-derivable OR crossing-save-recoverable.**

| | canon | how it comes back |
|---|---|---|
| `entities` | store-canon-durable | re-derived from the walk ledger, at any instant |
| `attachments` | store-canon-durable | recovered from the last `STATE/` save plus the logs after it |
| `emissions` | store-ephemeral (presence) | **not restorable, by design.** Presence fades; a restart is a thunderclap and the air clears. The occurrences are in `STATE/log/` forever |

Deleting this file is therefore not free the way deleting `world.db` is: it costs
every position and attachment since the last crossing-save, plus any speech not
yet crystallized. `npm run dynamic:rebuild` is the way back, and it says exactly
what it could and could not restore.

The schema is created once, never migrated automatically. A store stamped with a
schema version this office does not speak **refuses to open** — the one way state
nothing else holds could be lost silently.

## Emission presence is a query, never a delete

(Two different things wear the word *presence* in this file: an emission's
presence — whether it is still hanging in the air — and a resident's, further
down. They are unrelated, and both are queries.)

An emission row is not removed when its TTL expires. `presentEmissions(at)`
filters by `born_at`/`ttl_expires_at`; what expires is the **answer**, which is
what "presence fades" actually means. The row survives because the occurrence has
to reach a crossing log before it may be dropped.

`pruneEmissions` is the only deleter and it is gated on `meta.logged_through` —
the instant up to which a crossing-save has **committed** occurrences into the
world repo. An office whose save has never run prunes nothing at all and grows
instead, which is the correct failure: a box that cannot write the record keeps
the speech.

## Where the constants come from

> `dials:` is the one home for a constant. If a number appears anywhere else —
> in office code, in a tool, in a test — it must *edge* to the class rather than
> restate it. — `LOGOS/classes.md`

`soundClass()` is that edge. It reads `the-town/sound`'s `dials:` out of
`world.db` (the hydrator now carries the class fields — `class`, `version`,
`dials`, `extends`, `implements`, `affordances`, `mobility`, `anchor`, `exempt`
— into node props; before Stage 2 it dropped exactly the fields that make a class
mark law). `src/dynamic-store.mjs` contains no dial literal of its own: the
fallback is an **import** from `voices.mjs`, so the number still has one home
even when the store cannot be read.

The deriver's law governs the read — refuse or disclose, never quietly
substitute — and the disclosure is **per dial**:

| the store | what happens |
|---|---|
| readable, at published main | the class mark governs. `gate: PRESENT` |
| readable, **behind** main | the class mark **still** governs; the staleness is disclosed on every emission row and on the health surface |
| some dials declared | those govern; the rest fall back and are named in `disclosed` |
| absent, unreadable, `FAILED`, no class mark, no `dials:` | the office's own constants, `gate: ABSENT`, reason named |

The middle row is deliberately **not** Stage 1's rule, and the difference is
worth stating. `world-serve.mjs` demands an exact sha match because place words
have to equal the fold byte-for-byte. A dial has no fold to match: a `world.db`
one commit behind holds the real class mark at an older commit, and the
alternative is a strictly older copy of the same number with no commit attached
at all. Using the older law and naming its sha is the more truthful of the two.

`GET /world/dynamic` also reports **drift** — dials where the class mark and the
office's own constants disagree. That is the standing red-pen in `classes.md`
("two homes for one number") made visible at read time instead of at audit time.

## `WORLD_EMISSIONS=1` — the dual-write

With the flag on, `world/say` does what it always did **and** records an emission
instance conforming to the sound class.

- The **voices log is untouched.** It stays the ruled durable operator record; it
  is written first, and the emission is a second consumer of the same fact. The
  seam is one optional `onSpoke` listener in `voices.mjs`, fired last and
  wrapped: nothing hung off it can cost a resident their words. A corrupt or
  absent `dynamic.db` logs loudly to the operator's console and the town keeps
  talking.
- **The human lane.** `source` is the RESIDENT the human is stood with, because
  humans are not entities and do not walk; `props.spoken_by` carries
  `human-of-<household>`. Disclosure, never impersonation — and it is also what
  stops every human voice pointing at a source that does not exist (the spike
  found 823 voices with a dangling emitter for exactly this reason).
- **Every row records the law it was born under**: `class_version`, `radius_m`,
  `ttl_min`, and whether those came from the class mark or the fallback. A dial
  changed tomorrow does not retroactively re-govern what happened today.

With the flag off, `emissionFromVoice` returns on its first line. The store is
never opened, never stat'd, never created.

## Threads are a query, and the parity harness is the proof

Nothing stores a thread. `threadsFrom` runs **the office's own `clusterVoices`**
over rows read out of the store — world-serve's rule one layer down: the store
supplies the facts, the shipped derivation supplies the maths. A second
clustering implementation here would make the harness measure whether two
transcriptions of one algorithm agree, which is not a question anyone has.

What `tools/thread-parity.mjs` actually falsifies is whether an emission row
carries everything a voice carries — the exact position (not a rounded one), the
instant, the speaker, and the `aboard` flag the deck rule rides until Stage D
makes the deck structural. It compares a **partition of utterances**, so ordering
and naming cannot hide a disagreement, and it distinguishes the two ways it can
come back NOT EQUAL: rows that differ (a bug) from dials that differ (the two
sides were asked different questions, and it says so).

`--replay-from <voices-log>` seeds a scratch store from an existing log, so
parity can be measured **before** a single live emission is written. One thing a
replay cannot recover, worth knowing rather than discovering: the voices log
records the speaker, never the body they borrowed, so a replayed `human-of-…`
voice has itself as its source. Threads are unaffected; the rows say
`source_from_log`.

## `WORLD_PRESENCE=1` — residents revealed to each other

Until now a resident could learn who was near them in exactly two ways: read the
walk ledger and do the arithmetic, or shout into `world_say` and hope. This makes
it legible at the point of standing.

- `near(x, y, r)` — who is within r metres, nearest first, each with distance,
  bearing, distance band, standing/moving/aboard, and place words when a `place`
  function is injected.
- `everyone()` — the world-wide list. `world_walkers`' successor shape, and
  deliberately ONE list: "arrived" and "standing" are the same state, a person at
  rest, differing only in how the position was learned. That lesson is the
  walkers door's and is not re-learned here.
- `GET /world/present?x=&y=` — the standalone door; bare, it answers everyone.
  With the flag off it **404s** rather than returning an empty world, so a caller
  can tell "nobody about" from "not switched on".
- `world_orient` gains a `present` section; `world_open_your_eyes` gains
  `residents` grouped by the engine's own distance bands, plus a *Who is about*
  section appended to the telling. The engine's prose is left exactly as the
  engine rendered it — the office composes around the telling, as it already does
  for `standpoint` and `crossing`, rather than becoming a second author of the
  world's voice.

**The positions are derived at the instant asked, not read out of the rows.**
`entities.x`/`y` were computed at `entities_as_of`, which can be up to a crossing
ago; serving them would answer "who is near you" with a picture of this morning.
What the table actually supplies is the **governing departure** per resident —
store-canon, latest-wins already settled — and presence evaluates that record
now, through the world's own `positionAt`. Same derivation, fresher clock, which
is exactly why the save carries the departure beside the coordinates.

**And the departures are only half the world.** The other half is ground: a
resident who has never walked stands on their parcel, and the town's map has
always drawn them there. Presence read the walk half alone until issue #7 §1 —
twenty-one placed residents invisible, one of them from three metres away, on
their own porch. The union (walk records ∪ parcel households) now lives in
`src/positions.mjs`, and `world_walkers` and `present` both call it, so the two
doors cannot answer differently again. Each row says which half it came from in
`source` (`walk` | `parcel`); a resident holding both appears once, at the walk,
because the walk is their own latest statement about themselves.

Ground needs the fold, so the office hands one to every presence read. A read
that is handed none answers the walk half and **says so** — `disclosed` carries
`ground-not-read:`, which is the same refuse-or-disclose law the rest of this
layer runs on.

The one staleness this cannot fix: a resident who walked *after* the last refresh
is shown on their previous leg. It is bounded by the refresh cadence and it is
disclosed by name (`ledger_moved`), never smoothed. **The fix is operational:
`npm run dynamic:rebuild` belongs on the office tick** beside the world
rehydration. It is cheap, it refuses rather than empties when its input is
missing, and it is not installed by this branch.

A resident is described in the town's own words — the engine's 16-point rose and
its named distance bands — because a person and a hill are seen the same way and
should read the same way. `aboard` uses the same test the standpoint has always
used (a passenger's departure *is* the vessel's), which now has one home in
`dynamic-entities.mjs` with two readers. The vessel's own sailing line rides in
`meta.vessel_departure`: she is never an entity, but her record is an input to a
derivation whose output is the entities table, and aboard has to be evaluated at
the ask because it ends at the landing.

The two dials — 500 m, nearest 10 — are ✎ **proposals, not law**. Nothing has
ever answered this question before, so they have no receipts behind them. When
presence earns a class mark they move into its `dials:` and this layer edges to
them exactly as the sound class is edged to today.

**The disclosure** ships on both doors, flag-gated like the record sentence:
*presence is public and always has been — the walk ledger is public record and
the world map draws everyone on it — this only says it where you are standing.*
It reveals nothing new; saying it anyway is the cheap half of the habit that
makes the expensive disclosures believable.

## The crossing-save

The crossing **is** the save tick — the town's existing heartbeat, not a new
clock.

```
STATE/snapshot/<N>/entities.json   state AT THE BOUNDARY of crossing N
STATE/log/<N>.jsonl                events DURING crossing N
STATE/log/<N>.meta.json            the window that file actually covers
```

**`seq` on an `attachment` log line is null for the acts era.** Where the hold
edge is on `acts` (W2_PEN has hold and W2_GUARDS=1, POS-269), the save reads
holdings from the record, and a holding act has no sqlite rowid to carry, so
its line writes `"seq": null`. Earlier lines keep the rowid they were written
with. No reader keys on it: the replay check keys on actor, target and `at`,
and `attachmentsFromState` drops it (Wright-ruled 2026-09-30).

Snapshot-at-the-boundary is the only reading under which snapshot and log
compose: a snapshot of save-instant state would have the crossing's own events
applied twice on replay.

Two things ride in the snapshot that a naive save would drop — the law states
them as one sentence, *save the derivation's input alongside its output, and the
instant it was evaluated*: the governing **departure record** (position is
derived, so coordinates alone are a photograph of a moving thing) and
`evaluated_at`.

**Nothing in a committed file is measured against a moving target.** An earlier
draft carried a `world_store_fresh` boolean in the snapshot; it flipped the
instant the save's own commit advanced main, so every run rewrote its own output
to report a staleness that had not happened. The snapshot carries `as_of_world` —
a durable fact a reader can check — and freshness lives in the run's report. For
the same reason, freshness of the entity derivation is measured against the
**walk ledger's blob**, not against main's sha: a commit that touched `STATE/`, a
mark or a law is not movement.

**Closing the crossing behind it.** A save fires a little after the boundary, so
the log it last wrote for the outgoing crossing stops at the previous save
instant. Each run therefore also completes the crossing it just left when that
file is short or missing — one step back, derived from its sources, idempotent.
Without it the minutes between the last save and the boundary would reach no file
at all.

**What the log carries.** Speech goes in whole: the words, the speaker, the
place, the instant. That is the reading of "full-fidelity replay between any two
crossings" and of the reason the record exists — people often find out only later
what their agents were up to, and a record of bare timestamps could not tell
them. Keeping less than the words is a doctrine change for Keemin's pen, not a
flag on the tool.

**Not saved, deliberately and said out loud in the file itself:** vessels.
Derived mobility crystallizes with the timetable work; until then the Post
Office's position stays `f(timetable, clock)` and is **absent** from the snapshot
rather than frozen there at a stale coordinate.

Deterministic: same store, same instant, same bytes. A second run at the same
instant changes no file and commits nothing.

### `tools/crossing-replay-check.mjs`

Rebuild the live layer from `STATE/snapshot` + `STATE/log` **alone**, then diff
against `dynamic.db`. EQUAL, or the save does not save the world.

It may read the saved files and the town's physics; it may not read the store's
rows, `world.db`'s events, the ledger, or the marks. The store is opened at the
very end, for the diff only. Physics is imported rather than re-derived on
purpose: the question is whether the saved BYTES carry enough to reconstitute the
world, and that is falsified by a missing field, not a missing formula.

The tests prove it can fail as well as pass — strip the departure records out of
a snapshot and the mid-walk resident comes back frozen at the boundary; blank a
word out of a log line and the record stops matching what was said.

## The disclosure

Ruled, dial 6: *the town does not secretly log its residents; it openly remembers
them*, and the disclosure text updates **in the same commit as the crossing-save
writer**.

It ships on both doors — the `world_say` MCP tool description and the
`/world/conversations` payload the conversations page renders — and it is
**gated on the flag**, so the door never promises a public record that is not
being written. With `WORLD_EMISSIONS` off, the say description is byte-identical
to the one that shipped before Stage 2.

That gating is also a rollout rule: **turn the flag on together with the
crossing-save timer.** The flag is what makes the promise; the timer is what
keeps it.

## Rollout order (nothing here is installed)

```
1.  deploy with WORLD_EMISSIONS unset                    # nothing changes; prove it in the logs
2.  npm run hydrate:world -- --ref refs/heads/main       # the class fields need a hydration to reach the store
3.  npm run dynamic:store                                # sound_class.gate must read PRESENT, 0 disclosed fallbacks
4.  npm run threads:parity -- --replay-from voices-log.jsonl --db /tmp/parity.db
                                                         # must read EQUAL before any live emission exists
5.  npm run dynamic:rebuild                              # seed entities from the ledger
6.  install + enable postmark-crossing-save.timer        # AND set WORLD_EMISSIONS=1, together
7.  after the first crossing: npm run crossing:replay-check   # must read EQUAL
8.  watch GET /world/dynamic — emissions_present, logged_through, disclosed_fallbacks
9.  add `npm run dynamic:rebuild` to the office tick        # presence goes stale without it
10. WORLD_PRESENCE=1                                        # independent of the emissions flag
```

Step 6 is the one step that is deliberately not two steps. Steps 4 and 7 are not
formalities: they are the only two places the layer can be caught lying.

## Current receipts — world `2fcaff0`, office `c93e774`, 2026-08-10

- **Class-mark read, live**: `gate PRESENT — 4 dials from the-town/sound@1`,
  all four sourced `class-mark`, 0 disclosed fallbacks, 0 drift against the
  office's constants, store fresh.
- **Thread parity on the real party log** (823 voices, 2026-08-08, replayed into
  a scratch store): **EQUAL — 39 threads on both sides**, compared as a partition
  of utterances. The same 39 the Phase-A spike measured independently.
- **Stage 1 shadow after the hydrator change**: still **EMPTY DIFF** (318
  geometric marks, 0 disagreements on all three axes) — the class fields are
  additive props the serving projection never reads.
- **Suite**: 313 tests, 305 pass, 8 fail — the same 8 that fail on `main` for a
  missing local `town-clone/tools/stamp-mint.mjs`. +53 tests, 0 new failures.
- **Replay EQUAL on the live ledger**, not only on a fixture: a save at
  2026-08-09T18:00Z over crossing 117 folds 48 boundary entities plus 64 real
  departures and comes back EQUAL. Run with `--state` in scratch and
  `--no-commit`, so nothing was written into the world clone.
- **Both harnesses refuse rather than crash** when run bare with no store and no
  save: `GATE REFUSED dynamic-store` / `GATE REFUSED state-dir`, usage printed,
  exit 2.

## One bug the live run caught that the fixtures did not

The replay's fold applied **every** departure line in the log to the entity set,
including the vessel's. She belongs in the log — a sailing is a real event and
the record is full-fidelity — but she is not an entity, so the replay rebuilt a
town with one inhabitant more than the store held. Against fixtures it never
showed, because no fixture had the boat sailing mid-crossing; against 64 real
departures it showed immediately.

The fold now applies the same `NON_ENTITY_ACTORS` rule the derivation does, from
the same home, and folds her line into a recovered `vessel_departure` instead of
discarding it — which is where a later stage that crystallizes derived mobility
will read it from. The crossing-save fixture now sails the boat mid-crossing so
the case is covered by a test and not only by a memory.

## Not in scope, deliberately

No vessel crystallization (derived mobility lands with the timetable work), no
boarding verb (the `attachments` table and its writer ship; the door that calls
them does not), no resident-visible read served from `dynamic.db`, no site
change, and no deployment. The flag ships off, and `crossing:replay-check`
reading EQUAL is the gate anything here has to pass first.

## The single log, and what settles at the save (POS-5)

`WORLD_SINGLE_LOG=1` adds a fourth table — `journal` — and moves every world
mutation into it as one append-only row. Off, it is byte-identical to not having
it, which is a falsifier in `test/world-journal.test.mjs` rather than a promise.

| flag | what it turns on |
|---|---|
| `WORLD_EMISSIONS=1` | speech also becomes an emission row |
| `WORLD_MOVEMENT_V2=1` | Stage D's `movements` table, after the walk ledger's freeze |
| `WORLD_SINGLE_LOG=1` | the journal: marks, crossings and walks declare into one log and the **save** gives the record their lines |

**What the journal receives.** A mark (`class: mark`) — leave, amend, withdraw,
as later entries, supersession-by-latest. A crossing (`class: frame`) — §8's
storage ruling (b): a reparenting is a row, not a column on an entity. A walk
(`class: move`) — a walk moves you WITHIN a frame, so it is not a `frame` row.
Every row carries `the-witnessed-line`'s anchor and offset: where the actor
stood, relative to what, at that instant.

**What settles at the save, and why it used to not.** Every walk and every
crossing spent ONE GIT COMMIT on world main, per act. Ruled 2026-08-22: *"walks
+ enter-exit should settle at the save, not per-act to git main."* Under the flag
the act writes its ledger line into the journal — **verbatim**, so the save
appends exactly what the act's own pen formatted rather than re-deriving it — and
`materializeLedgers` gives `WORLD/walk-ledger.md` its lines once, in seq order,
idempotently. The record that results is byte-identical to what the per-act
commits would have written; `test/settle-at-save.test.mjs` runs the real pen down
both lanes and compares the file.

**The passage record settles nowhere, because it is derived** (2026-08-28,
issue #2152). `WORLD/enter-exit-ledger.md` stopped being a file anybody appends
to on 2026-08-26: it is regenerated whole at READ time from the frozen era plus
the journal's rows, and the copy committed in the world repo is the frozen era
exactly — that repo has no journal to read, and its own falsifier refuses a
longer file. Two office pens went on appending live-era passages into it anyway
(this drain's routing, and the crossing-save's emit); each append turned the
world's grammar suite red, which cost the settlement sweep its ability to
attribute a failure and refused the whole crossing. Both pens are gone: the
drain filters these ledger names out explicitly, and the crossing-save writes
only `STATE/`. The passages are not lost — they are in the journal, and the
`/world/enter-exit-ledger` door serves them.

**Where the drain puts things.** Marks go to `draft/<household>` sketchbooks
(proto-canon). EVERY row — mark rows included — is crystallized into
`STATE/log/<N>.journal.jsonl`, because the sketchbook holds a mark's final state
while the amend chain and the pinned witnesses are history, and dropping them
would evaporate a constitutional record every twelve hours. Then the journal
truncates, in one SQLite transaction with the cursor advance
(`the-atomic-drain`).

**The cold archive.** `tools/state-to-r2.mjs` is wired at the save and nowhere
else (§5's own condition). A failed upload is DISCLOSED and never blocks: the
record is git-truth and it is already written; R2 is a mirror, and a mirror that
is behind is a thing to retry, not a reason to refuse a settlement.
