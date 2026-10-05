# The pen flip — what "2.0 is the pen" actually requires

*Written 2026-08-28 by the writes lane (`postgres-world/writes`), after closing the
mirror gaps. Design record, not a build record: nothing in §7 is implemented, and
§6 says why there is no safe subset to have implemented.*

The gold plan is `G:/Starstory/PULSE/gold-plans/postmark-world-2/postmark-world-2.md`.
Its §-numbers are cited throughout; every quotation is verbatim.

---

## 0 · Where the write path stands tonight

After this lane's stage 1, every act-class write in the office reaches Postgres
`acts`. The three lanes that bypassed `appendJournal` (say, walk under
`WORLD_MOVEMENT_V2`, give/drop/take) now mirror through `mirrorLaneAct`, and the
two lanes that called `appendJournal` from a subprocess that killed itself before
the INSERT (enter/exit, flag-off walk) now drain the queue first.

**That is the SHADOW era complete, and the shadow era is not the flip.** Today:

```
door validates  → against 1.0's stores (git canon, dynamic.db, the ledgers)
door writes     → 1.0's pen  (journal / voices log / attachments / movements)
door mirrors    → Postgres, fire-and-forget, best-effort, never blocking
door answers    → success, whether or not the mirror landed
```

Postgres is a *witness*. The flip makes it the *record*, and almost nothing above
survives that change unaltered.

---

## 1 · What the flip is, stated as the smallest true sentence

> "**LIVE** — … Written synchronously by the office API, validated at write time
> by constraints. (Strictly better for residents: today you learn twelve hours
> late that your mark quarantined; tomorrow the office API refuses while you
> stand there, with the reason.)" — gold §1

The flip is that parenthesis. Everything else in this document is what has to be
true before the office can honour it.

The shim's own header already names the destination:

> "At cutover the journal INSERT dies, this file's mirror becomes the door's ONE
> awaited write, and `acts.journal_seq` is dropped." — `src/world2-acts.mjs`

---

## 2 · The five requirements

### R1 · One act, one transaction

A `leave-mark` produces **two** Postgres rows today — an `acts` row
(`mirrorAct`) and a `claims` row (`submitClaimFromJournal`) — written by two
independent serialized queues holding two independent pools. Nothing joins them.
A crash, a restart, or a pool error between them leaves an act with no claim, or
a claim whose act never arrived.

**This is the two-pens disease, reproduced inside Postgres.** It is survivable in
the shadow era only because sqlite is still the truth and the parity falsifier
reds afterwards. It is not survivable when Postgres *is* the truth.

A second instance, already documented and deliberate:

> "THE MIRROR RUNS OUTSIDE THE TRANSACTION, deliberately: `mirrorAct` holds its
> own pool and its own serial queue, and awaiting it from inside a client this
> function is holding is a deadlock waiting for the pool to be busy."
> — `src/world2-claims.mjs` § `promoteDraftOnStake`

That reasoning is correct for today's structure and becomes an atomicity hole at
the flip: a promotion that commits and then fails to mirror leaves a **pending
claim with no deed behind it**, on the public docket, with nothing to reconcile
it against once sqlite is gone.

*The flip requires:* one `officeWrite(fn)` helper owning a single client and a
single BEGIN/COMMIT; `mirrorAct` and `submitClaimFromJournal` collapse into one
function taking that client. `withHousehold` (`world2-claims.mjs`) is already the
right shape and should be generalised rather than duplicated — it is the one
place that has already thought about `SET LOCAL` on a pool.

### R2 · The write must be able to refuse — which means it must come FIRST

Today a failed mirror is a `console.error` and a 200. At the flip it must be a
bounce with the reason.

**And this is the requirement that makes a partial flip impossible.**
`appendJournal` is synchronous: by the time the mirror fires, the sqlite row is
already committed. A door that "awaited the mirror and bounced on failure" would
leave 1.0's pen holding a row the resident was told did not happen — worse than
either store alone. To refuse, the Postgres write has to happen **before** the
sqlite write. Reordering the write is not a step toward the flip; it *is* the
flip. §6 turns on this.

### R3 · The reads move first, and they are the actual gate

A pen flip without a read flip produces an office that writes to Postgres and
validates against sqlite — a split brain with a switch on it. Every door guard
below reads a 1.0 pen today:

| read | source today | who needs it |
|---|---|---|
| `liveMarks` / `liveChildrenOf` | `journal` | leave-mark slug collision, parcel cap, withdraw's stranding check |
| `draftsForKey` | `journal` + git sketchbook | the signed-in draft overlay |
| occupancy | enter-exit ledger + `frame` rows | enter/exit adjudication |
| positions | `movements` + walk ledger | every standpoint, every witness stamp |
| `voices.hear` / `conversations` | `voices-log.jsonl` | the say door and postmark.town/conversations |
| `liveHolder` / `readAttachments` | `attachments` | give/drop/take's holder check |

The sibling lane `postgres-world/live` has ported **movement, presence, sound and
containment** reads to `acts` (`world2/tools/live-reads.mjs`), with an equality
falsifier against 1.0's own functions. That covers rows 4 and part of 5.

**Not yet ported: the mark door guards (row 1–2) and the conversation record
(row 5's page half) and the holder check (row 6).** Those are the write path's
own validation inputs, so they gate the write flip specifically.

### R4 · The say lane's real home

Speech has **three records** after stage 1: `voices-log.jsonl` (the ruled durable
operator record, and the conversations page's source), `emissions` (behind
`WORLD_EMISSIONS`), and now `acts`. Three homes for one fact is the condition
rule 1 exists to end.

At the flip `acts` is the record. The other two need rulings — D4 and D5 in §5.

The load-bearing detail: the conversations page does not read rows, it reads the
**whole log** and clusters it (`clusterVoices`, earshot + shared-deck chaining
across a `closeMs` lull). Porting that to a Postgres query is real work and it
belongs to the LIVE read tier, not to this lane. Until it lands, the voices log
must keep being written even after `acts` becomes authoritative.

### R5 · What becomes of the journal, and of dynamic.db

Rule 6 is unambiguous about cutover:

> "**Cutover means deletion.** When a lane moves, its git machinery is removed in
> the same change." — gold §3 rule 6

But the dev pen flip is **phase 3**, not phase 6, and the greenlight is explicit
that "PROD CUTOVER IS A SEPARATE GATE". On dev the journal's fate is a live
decision (D3), and it is the one place this design argues for keeping a shim.

The drain is the second half: it truncates the journal *and* writes 1.0 git
artifacts (`STATE/log/<N>.journal.jsonl`, the walk ledger, the household
sketchbooks). With no journal it has nothing to read and nothing to write. Its
outputs are what the notary (`snapshot-export.mjs`) replaces.

---

## 3 · Write ordering, as it would actually be

```
1  door validates            ← Postgres reads (R3), law_projection for the law
2  BEGIN                     ← one client, one transaction (R1)
3    INSERT acts             ← the deed
4    INSERT/UPDATE claims    ← if it is a candle act, same transaction
5    SET LOCAL app.household ← before any draft-scoped row (007's policy)
6  COMMIT
7  best-effort: sqlite       ← the REVERSE mirror, if D3 says keep it
8  answer, or bounce at 6
```

Step 7 is deliberately after the commit and deliberately allowed to fail: it is a
rollback convenience, not a record. If it were inside the transaction it would be
a second pen with a vote.

---

## 4 · Failure modes

| # | failure | today | after the flip | mitigation |
|---|---|---|---|---|
| F1 | Postgres unreachable | acts stop, town runs | **the town stops** | D2 — a named bounce, not a 500 |
| F2 | crash between acts and claims | parity falsifier reds later | orphan claim / orphan act, unreconcilable | R1's single transaction |
| F3 | `promoteDraftOnStake` commits, mirror fails | act arrives late or not at all | pending claim, no deed | R1 — inline the mirror in the same client |
| F4 | two acts commit out of `id` order relative to `at` | harmless (sqlite `seq` is truth) | replay by `id` is wrong | D6 — order by `(at, id)`, and say so in the DDL |
| F5 | rollback after the flip | n/a | Postgres holds acts sqlite never saw | D3's reverse mirror is what makes rollback real |
| F6 | a new lane ships unmirrored | the say gap | a lane silently outside the record | already closed: `falsifier-acts-lane-closure.mjs` checks 0 and 0b |

F1 deserves its own sentence, because it is the flip's real cost. Today a
Postgres outage is invisible to residents. After the flip it is a town-wide
outage. That is not a defect — it is what "validated at write time" *means* — but
it should be chosen knowingly rather than discovered.

---

## 5 · The founder's decisions

> **RULED 2026-08-29 (Keemin, in the sitting that ordered the cutover drive):
> D1 per lane · D2 refuse · D3 yes, reverse mirror with the death date — all
> three as recommended. Prod Postgres ruled the same night: ON THE BOX with
> shipped backups and a rehearsed restore (no managed service now).**
> Implementation began the same hour: `src/world2-pen.mjs` (officeWrite /
> penWrite / shadowWrite — R1's one transaction, both eras), `appendActFlipped`
> + per-lane `W2_PEN` routing in world-journal.mjs, lane one flipped at the
> stance door, `falsifier-pen-flip.mjs` (reverse parity + the refusal-ordering
> proof). D4–D9 stand as recommended pending their own build moments.

Each carries a recommendation and the one-line reason.

**D1 · Does the pen flip per lane, or all at once?**
→ **Per lane**, each gated on that lane's reads being Postgres-served and
A/B-green (R3).
*Reason:* the reads are the work; a whole-door flip strands every un-ported read
against a store that stopped being written.

**D2 · When Postgres is unreachable, does the town refuse or degrade?**
→ **Refuse**, with a named bounce ("the office's record cannot be reached —
nothing was written, and nothing was lost").
*Reason:* write-time validation is the whole promise of gold §1, and a degrade
path is a second pen wearing a fallback's coat.

**D3 · After the dev flip, does the sqlite journal keep being written?**
→ **Yes, as a reverse mirror, carrying the existing `MIRROR_EXPIRES` and dying at
phase 5's replay-parity pass.**
*Reason:* it is what makes the flip a flag instead of a one-way door.
⚠ *This is the recommendation most in tension with the anti-rebake rules,* and it
is teed rather than assumed for that reason: rule 6 forbids parallel runs without
"a named end date", and rule 5 forbids immortal twins. The recommendation
supplies both (the expiry, and the phase-5 gate), but it is still a shim being
argued for by someone who has just spent a night removing shims.

> **REFINED 2026-08-29 evening — DEC-2, ruled.** "the existing `MIRROR_EXPIRES`"
> above was ONE constant for the whole store, and it contradicted P-143's
> standing ruling that *"the 09-30 reverse-mirror expiry does NOT apply to an
> unflipped lane"* — the arena would have reded on 2026-10-01 alongside the six
> lanes the date is for. The founder ruled the cutover runbook's DEC-2: **make
> the expiry per lane** — *"a lane in `FLIP_REFUSED` by ruling is exempt; a lane
> refused by unreadiness is not. Do not simply move the date."* D3 is otherwise
> unchanged, and what it promises is now stricter rather than looser: a lane's
> reverse mirror dies when THAT lane's read ports land and its deletion is ruled
> (rule 6) — recorded by removing its row from `LANE_MIRROR`
> (`src/world2-acts.mjs`) — and the date each governed lane carries is a
> backstop that reds if it has not. Moving a date buys one lane nothing and the
> store nothing, which is the point: *"moving a shim's death date is the
> mechanism by which shims become furniture (rule 5)."*

**D4 · What happens to `voices-log.jsonl` and the conversations page?**
→ **The log stays the READ source until the conversation read is ported to
`acts`; `acts` is authoritative for the record from the flip.** Delete the log at
the read flip, not the pen flip.
*Reason:* the page reads the whole log and clusters it; that port is LIVE-read-tier
work and blocking the write flip on it would be the wrong dependency.

**D5 · Do `emissions` become a VIEW over `acts`?**
→ **Yes, sequenced after the say lane flips.**
*Reason:* rule 3 — "Derived is a VIEW". An emission is an act plus the sound
class's dials; keeping a table is keeping a second pen for a derivation.

**D6 · Does replay order `acts` by `id`, or by `(at, id)`?**
→ **`(at, id)`.**
*Reason:* `id` is commit order and `at` is when it happened; concurrency makes
them differ, and this is far cheaper to fix before the notary freezes archives
whose order is then implied.

**D7 · Does a walk keep writing `dynamic.db/movements` after the flip?**
→ **No — it rides D3's reverse mirror and dies with it.**
*Reason:* the LIVE lane has already ported positions to `acts`, so `movements` is
derivable, and rule 3 makes derivable-and-written the thing we are removing.

**D8 · Does `note-to-self` ever get a Postgres home?**
→ **Yes, but as a private table under an RLS policy in 007's shape — never in
`acts`.**
*Reason:* `acts` exports to public git through the notary, and a note is
household-private by the door's own law. A private table would give notes the
same structural privacy Phase 5.6 gave drafts, which is strictly better than
today's note-on-a-branch-in-a-public-repo. **Built (POS-392):
`063_resident_notes.sql` and `src/note-store.mjs`; the store is the note's only
home.**

**D9 · Does stake/unstake escrow move to Postgres?**
→ **No, not in this plan.**
*Reason:* gold §5 puts the town's ledgers explicitly out of scope. The
cross-system contract already exists — the clearing pins `town_sha` and reads
escrow as-of that pin.

---

## 6 · Why nothing here is implemented behind `W2_PEN=postgres`

The brief authorised implementing "ONLY what is safe behind an env flag … where
the design is unambiguous", and instructed reporting honest uncertainty over
guessing. **The honest answer is that there is no safe subset, and the reason is
structural rather than a matter of nerve.**

R2 is the whole of it. To refuse at the door, the Postgres write must precede the
sqlite write. Today it cannot: `appendJournal` is synchronous and has already
committed the sqlite row before the mirror is even queued. So a flag that
"awaited the mirror and bounced on failure" would produce the one state worse
than either store alone — 1.0's pen holding a row the resident was told did not
happen — and a flag that awaited without bouncing changes nothing but latency.

Reordering the write to fix that is not a step toward the flip; it is the flip,
and it lands on top of three unruled decisions (D1, D2, D3) and one unfinished
dependency (R3's mark-guard and holder reads). Building it tonight would mean
guessing all four.

**What this lane delivered toward the flip instead**, all of it useful whichever
way D1–D3 go:

- Every lane reaches `acts`, so the flip's input is complete rather than
  three-lanes short. A flip performed on tonight's pre-fix code would have made
  Postgres authoritative over a record missing every say, walk and holding.
- `settleShadowPens()` — the "awaited write" primitive the flip needs at every
  door, built and proven, and already load-bearing for the subprocess pens.
- `falsifier-acts-lane-closure.mjs` checks 0/0b — the guard that makes a *future*
  unmirrored lane impossible to add quietly, which is what stops this gap
  reopening between now and phase 6.
- R1's atomicity hole, found and named with its two instances (§2 R1). It is a
  real defect **today**, not only after the flip, and it is the first thing the
  flip work should fix.

---

## 7 · Recommended order of work

1. **R1's transaction unification.** A correctness fix in its own right; the flip
   cannot be built on two queues.
2. **D1/D2/D3 ruled** by Keemin — they set the shape of everything after.
3. **R3's remaining reads** ported by the LIVE lane: mark door guards
   (`liveMarks`), the holder check, the conversation record.
4. **Per-lane flip**, easiest lane first. `declare-stance-on` is the natural
   first candidate — it already refuses when the log is off (it throws a 501
   rather than falling back to a git lane), so it is the one door that has never
   had a second pen to disagree with.
5. **A/B (phase 4), then replay-parity (phase 5).** D3's shim dies at 5.
