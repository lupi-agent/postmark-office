#!/bin/sh
# settlement-auto.sh — the settlement's MECHANISM, box-side (Keemin-ruled
# 2026-08-17: settlements run like mail crossings — a timer on the box —
# while the Worldkeeper's heartbeats keep the JUDGMENT lane: blessing tags,
# holds, quarantine, refusal narratives, over whatever state this publishes).
#
# The shape mirrors the mechanical subset of the keeper's own chain
# (MEEPS/worldkeeper/memory/topics/the-settlement.md, steps 4-5-8):
#   fetch world main + every sketchbook to its exact remote tip · DRAIN the
#   journal into those sketchbooks and deliver them · derive the town stakes at
#   a pinned town read · run tools/settlement-sweep.mjs · run the world's HARM
#   GATE on the result (founder-ruled 2026-09-16: the crossing refuses only for
#   what it did to residents) · and only on no harm, push main (ff-only) plus
#   each rebased sketchbook under an explicit lease on the tip inspected · then
#   run the grammar suite as a CHECKER whose red is a warning, not a hold. No
#   lock is held: a door write landing mid-run makes a lease push FAIL SAFE
#   (exit 2 — rerun; the keeper's caught-race-restart, mechanized) instead of
#   making resident letters queue behind a long hold (the write-starvation
#   lesson, 2026-07-30).
#
#   A red suite publishes nothing and exits 1 loudly — a refusal is a
#   finding for the keeper's judgment, never a retry. NO TAGS from here:
#   settlement/S<N> blessing stays the Worldkeeper's pen, over the
#   already-public state (his S34/S36/S37 pattern).
#
# ── WHAT CHANGED 2026-08-27 (the drain night, founder-mandated) ──────────────
#
# Four defects, all four with receipts from the night of 08-26/27:
#
#   1. THE DRAIN HAD NO RUNNER. Since the 2026-08-24T19:39:13Z single-log
#      cutover every door write lands as a row in dynamic.db's journal, and
#      `office/src/world-drain.mjs` is what materializes those rows into the
#      `draft/<login>` sketchbooks this script then sweeps. Nothing called it.
#      A mark left at the door aged in the journal until a human ran the drain
#      by hand — Wright did, once, at 03:20Z on the 27th, and that is the only
#      time it had ever run. THE DRAIN IS NOW STEP ONE OF EVERY CROSSING, so a
#      door-written mark can never age past one crossing unattended.
#
#   2. THE RECEIPTS LIED BY OMISSION. The report said "N published" and the
#      sweep's commit said "N published, M unpublished". `left_drafted` (42
#      rows on the 26th), `quarantined` and `dropped` appeared on NEITHER — so
#      a starving crossing printed "0 published, 0 unpublished" and read as a
#      quiet day for two days. EVERY CHANNEL IS NAMED NOW, and the quiet pass
#      says what it surveyed rather than only that it found nothing.
#
#   3. A LOUD-EMPTY GUARD. A sweep that finds no candidates at all while
#      sketchbooks are holding escrow-backed deltas is not a quiet day, it is a
#      starving crossing, and it used to exit 0 green. The sweep now re-derives
#      that question by a different path and REFUSES with the reason.
#
#   4. ONE BAD MARK NO LONGER REFUSES THE WHOLE TOWN. On the 27th, ONE amend —
#      vermillion/the-pando-peak moved to at:(-95458,-95458), ~95km off-world —
#      turned eleven vessel/timetable tests red and refused EVERY household's
#      settlement, because the final suite gate is all-or-nothing. On suite red
#      the crossing now runs an ISOLATION PASS (tools/settlement-isolate.mjs):
#      it bisects the marks this crossing published, quarantines the offending
#      ones, SHOUTS the quarantine, and settles for everyone else. Only a red
#      it cannot attribute to a candidate still refuses the town.
#
# ── WHAT CHANGED 2026-09-08 (G1: the store becomes the only source) ──────────
#
# The fold's input used to arrive through two lossy hops. A door write landed in
# Postgres FIRST and was awaited (`src/world-journal.mjs:381-391`); the sqlite
# journal received a COPY afterwards; the drain emptied that copy into
# `draft/<login>` sketchbooks; and this script swept those branches. The five
# acts with no journal twin on 2026-09-06 are what a lossy hop looks like from
# outside: the fold could not see them because a copy failed, not because the
# store lacked them.
#
# SETTLEMENT_SOURCE=store removes both hops. The store is read directly, its
# marks are written down into LOCAL sketchbook branches in this disposable
# clone, and the sweep reads them exactly as it reads drained ones.
#
# THE FOLD IS NOT TOUCHED, AND EVERY GUARD ABOVE STAYS. The grammar that decides
# what publishes lives in the WORLD repo (`tools/settlement-sweep.mjs`,
# `tools/marks-fold.mjs`, `tools/settlement-isolate.mjs`) and is the world's law,
# not this box's. The store path hands that law the one input it already
# understands — local `refs/heads/draft/*` — so the loud-empty guard, the
# isolation pass, the race retry and the six-channel receipt all keep working on
# the same evidence they were written for.
#
# WHAT THE STORE PATH DROPS: the sketchbook fetch, the drain, the delivery push,
# and the end-of-run sketchbook lease pushes. WHAT IT KEEPS: the suite gate, the
# isolation pass, the retire step, the receipt, and main's own push lease with
# its cheap-salvage rebase — that lease is about WORLD MAIN and has nothing to do
# with sketchbooks, so it is untouched in both modes. The SKETCHBOOK leases go,
# and they go because there is nothing left to race: no store crossing pushes a
# draft branch, so no door write can invalidate one.
#
# ROLLBACK IS A FLIP, NOT A RESTORE. `SETTLEMENT_SOURCE=git` takes the original
# path, unchanged, for one crossing. It stays cheap only while the sketchbook
# branches are left standing on origin through the green week — deleting them
# with the swap would make the rollback a restore. They cost nothing; they are
# G2's line, not G1's.
#
# Env (unit): TOWN_CLONE, WORLD_CLONE (origin URL discovery only).
#   SETTLEMENT_SOURCE  `git` (THE DEFAULT) or `store`. A box that has not been
#                      told crosses exactly as it does today; the swap is armed by
#                      setting `store` in the unit's environment, deliberately, on
#                      the day it is ruled. It is a decision, not a default
#                      somebody discovers on the first tag that lands.
#   OFFICE_ROOT        the office checkout (default /srv/postmark-office)
#   SETTLEMENT_CLONE   the sweep's own clone (default $OFFICE_ROOT/settlement-clone)
#   SETTLEMENT_REPORT  the receipt path (default /srv/postmark-harbor/settlement-auto.json)
#   SETTLEMENT_HISTORY the rolling receipt log (default beside the receipt, .jsonl)
#   SETTLEMENT_DRAIN   0 disables the drain step (the seam a falsifier pins)
#   SETTLEMENT_REGISTRY 0 disables the household registry refresh — the crossing
#                      then folds on whatever WORLD/households.json world main
#                      already carries, which is the pre-2026-09-09 behaviour and
#                      the seam this lane's falsifier flips. It lands on the
#                      receipt as `ran: false` with its reason, never as silence.
#   SETTLEMENT_ISOLATE 0 disables the isolation pass — a red suite refuses the town, as before
#   SETTLEMENT_RACE_ATTEMPTS  how many times a LOST RACE re-runs the whole crossing (default 3)
#   SETTLEMENT_ATTEMPT set by the retry wrapper on each child; never set it by hand
# Cwd: $OFFICE_ROOT. Exit: 0 published/quiet · 1 refused · 2 race.

set -eu
OFFICE="${OFFICE_ROOT:-/srv/postmark-office}"
TOWN="${TOWN_CLONE:-$OFFICE/town-clone}"
SWEEP="${SETTLEMENT_CLONE:-$OFFICE/settlement-clone}"
OUT="${SETTLEMENT_REPORT:-/srv/postmark-harbor/settlement-auto.json}"
HISTORY="${SETTLEMENT_HISTORY:-${OUT%.json}-history.jsonl}"
STAMP="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT

# THE SOURCE, READ ON EXACTLY ONE LINE. Every later branch tests $SOURCE and
# never the environment again — a flag read twice is a flag that can disagree
# with itself halfway through a crossing, and this one decides where canon comes
# from. An unrecognised value REFUSES rather than defaulting: a typo silently
# taking the git path would publish a git fold under a receipt saying `store`,
# which is the one failure this whole lane is meant to make impossible.
# THE DEFAULT IS `git`, AND THAT IS THE SWAP'S SAFETY CATCH.
#
# It shipped as `:-store` for eight laps, which meant the first office tag to
# land on the box would have flipped the 05:45Z crossing to the store path BY
# DEFAULT — with the preconditions unsettled, or refusing loudly with no store
# credential, which is a dark crossing either way. Nobody would have decided
# that; they would have discovered it.
#
# **The swap is a decision, never a default somebody discovers.** So the arm is
# `SETTLEMENT_SOURCE=store`, set explicitly in the unit's environment on the day
# the swap is ruled, and a box that has not been told still crosses exactly as it
# does today.
SOURCE="${SETTLEMENT_SOURCE:-git}"
case "$SOURCE" in
  store|git) ;;
  *) echo "[settlement-auto] SETTLEMENT_SOURCE=\"$SOURCE\" is not \`store\` or \`git\` — refusing rather than guessing which record to publish" >&2; exit 1 ;;
esac

# ── A RERUN BY HAND IS A FLAGGED ACT, NEVER A LOOSER TIMER (postmark#2786) ────
#
# On 2026-09-14 window 188 closed at 05:45Z holding 29 locked claims its crossing
# refused to fold; the world test that refused it merged by 09:1x; two reruns at
# 13:21Z and 13:26Z then refused `clearing-did-not-run`, because the docket wait
# accepts only a window cleared at or after THIS crossing's own start and nothing
# would close until 17:45Z. A correct tree and an unfolded docket sat side by side
# for eight hours. Keemin's word that morning: *"we REALLY should not be
# constrained by OUR OWN rules from being able to quickly push fixes as needed."*
#
# So the operator gets a SECOND DOOR and the timer's guard is untouched. With
# this set, the docket read takes the newest CLOSED window that still holds a
# locked claim with no materialized mark — a fact about the store with no clock
# in it — and refuses `nothing-unfolded` when the world already carries
# everything. See the tool's header for why this cannot be reached by relaxing
# the wait instead.
#
# IT IS NEVER THE UNIT'S DEFAULT AND NEVER THE TIMER'S. `postmark-settlement.service`
# does not set it; `postmark-settlement-by-hand.service` does, carries no timer,
# and is started by a person — so the journal names the act by its own unit, and
# the receipt carries `by_hand: true` beside `source` so a by-hand publication can
# never be read back as a scheduled one.
BY_HAND="${SETTLEMENT_BY_HAND:-0}"
case "$BY_HAND" in
  0|1) ;;
  *) echo "[settlement-auto] SETTLEMENT_BY_HAND=\"$BY_HAND\" is not \`0\` or \`1\` — refusing rather than guessing whether this crossing is a person's act" >&2; exit 1 ;;
esac
# `if`, not `[ … ] && echo`: this script runs under `set -e`, where a one-liner
# whose test is false is a non-zero last command and takes the whole crossing
# down. Every scheduled crossing takes that branch.
if [ "$BY_HAND" = "1" ]; then
  echo "[settlement-auto] BY HAND — this crossing is an operator's act; the docket is the newest unfolded window, not a fresh close" >&2
fi

# ── A STORE CROSSING LEAVES THE CLONE AS IT FOUND IT ─────────────────────────
#
# The store path's sketchbooks are scratch by construction — this crossing makes
# them for the sweep to read and nothing else ever wants them. Leaving them is
# what armed the rollback ghost (repair 1 below): the next `SETTLEMENT_SOURCE=git`
# crossing would fold them.
#
# ON THE TRAP, so it runs on EVERY exit — published, quiet, refused, raced, or a
# crash between any two lines. A cleanup that only runs on the happy path is a
# cleanup for the case that did not need it: the crossing whose leftovers matter
# most is the one that failed, which is also the crossing after which somebody
# reaches for the rollback.
#
# The git path's net stays anyway. This makes it rare; it does not make it
# unnecessary, because a `kill -9` runs no trap.
store_sketchbook_cleanup() {
  [ "$SOURCE" = "store" ] || return 0
  [ -n "${SWEEP:-}" ] && [ -d "$SWEEP/.git" ] || return 0
  git -C "$SWEEP" for-each-ref --format='%(refname)' 'refs/heads/draft/*' 2>/dev/null |
    while read -r r; do [ -n "$r" ] && git -C "$SWEEP" update-ref -d "$r" 2>/dev/null || true; done
}
trap 'rm -rf "$WORK"; store_sketchbook_cleanup' EXIT

# One-time: a dedicated settlement clone — never the write pen's checkout.
if [ ! -d "$SWEEP/.git" ]; then
  ORIGIN="$(git -C "${WORLD_CLONE:-$OFFICE/world-clone}" remote get-url origin)"
  git clone -q "$ORIGIN" "$SWEEP"
  # The pen needs its name and its key (both bit the first run, separately):
  git -C "$SWEEP" config user.name  "the settlement sweep (box)"
  git -C "$SWEEP" config user.email "postmark-settlement@users.noreply.github.com"
  git -C "$SWEEP" config credential.helper "store --file $OFFICE/.git-credentials"
fi

# THE RECEIPT. Every channel the crossing has a word for, or the honest absence
# of one — composed by a node helper because a receipt assembled with printf is
# exactly how `left_drafted` came to be missing from it for three days.
report() { # status detail
  SETTLEMENT_STATUS="$1" SETTLEMENT_DETAIL="$2" \
  SETTLEMENT_AT="$STAMP" SETTLEMENT_TOWN_SHA="${TOWN_SHA:-}" \
  SETTLEMENT_WORLD_FROM="${WORLD_FROM:-}" SETTLEMENT_WORLD_TO="${WORLD_TO:-}" \
  SETTLEMENT_SWEEP_JSON="${SWEEP_JSON:-}" SETTLEMENT_DRAIN_JSON="${DRAIN_JSON:-}" \
  SETTLEMENT_RETIRE_JSON="${RETIRE_JSON:-}" \
  SETTLEMENT_ISOLATE_JSON="${ISOLATE_JSON:-}" SETTLEMENT_REFUSAL_JSON="${REFUSAL_JSON:-}" \
  SETTLEMENT_HARM_JSON="${HARM_JSON:-}" SETTLEMENT_SUITE_JSON="${SUITE_JSON:-}" \
  SETTLEMENT_SOURCE_MODE="$SOURCE" SETTLEMENT_STORE_JSON="${STORE_JSON:-}" \
  SETTLEMENT_STATE_LOG_JSON="${STATE_LOG_JSON:-}" SETTLEMENT_STATE_LOG_MODE="${STATE_LOG_MODE:-}" \
  SETTLEMENT_BY_HAND="$BY_HAND" \
  SETTLEMENT_GHOSTS="${GHOSTS:-}" SETTLEMENT_KEPT_UNDELIVERED="${KEPT_UNDELIVERED:-}" \
  SETTLEMENT_RESETS="${RESETS:-}" \
  SETTLEMENT_REGISTRY_JSON="${REGISTRY_JSON:-}" SETTLEMENT_REGISTRY_COMMIT="${REGISTRY_COMMIT:-}" \
    node "$OFFICE/deploy/settlement-receipt.mjs" > "$OUT" 2>/dev/null || true
  # THE HISTORY. One line per DECIDED crossing, appended, bounded. A single
  # receipt file answers "what did the last crossing do"; nothing on the box
  # could answer "has it published anything in three days", which is the shape
  # the 2026-08-26 starving crossing had while every individual receipt read
  # fine. The roll-call's settlement row reads this (tools/box-rollcall.mjs).
  #
  # `--attempt` is how the log knows a lost race inside the retry is not a
  # DECISION yet; settlement-history.mjs carries that rule and its reason.
  node "$OFFICE/deploy/settlement-history.mjs" \
    --receipt "$OUT" --history "$HISTORY" --attempt "${SETTLEMENT_ATTEMPT:-}" >/dev/null 2>&1 || true
}

# ── THE RACE RETRY (v1 #7, 2026-08-30) ───────────────────────────────────────
#
# Three sites in this script exit 2 for a lost race — a lease refused delivering
# the drain, main moved underneath the sweep, a sketchbook lease refused at the
# end — and the receipt each one writes says "rerun". Nothing reran. On
# 2026-08-30T17:54:23Z `draft/foundoutanyway` took a door write mid-sweep, the
# push was rejected `(stale info)`, the unit exited 2, and the crossing's whole
# 18 minutes of work sat unpublished until the next timer mark nine hours later.
# An instruction the receipt gives and nothing carries out is not a mechanism.
#
# A race is transient BY DEFINITION: it means someone else wrote while we looked.
# So the retry is the whole sweep from FRESH INPUTS — never a resume of a
# half-done run, because the inputs that lost the race are exactly the ones that
# must not be reused. Three attempts total; a race that survives all three is a
# real exit 2 whose message says so, and that one goes to the operator queue.
#
# It re-execs THIS script, so every attempt is a clean process with a clean temp
# dir and its own fetch. The retries stay inside the one unit invocation — same
# ExecStart, same systemd job, so nothing about the unit's serialization changes
# and a concurrent crossing is still impossible.
#
# The loop itself lives in deploy/settlement-retry.sh, and it lives there for one
# reason: a loop inlined here can only be exercised by a real lost race on a real
# box, which is to say never. As its own tiny script it is a falsifier's first
# argument (test/settlement-retry.test.mjs drives it with commands that exit 2,
# then 0, then 2 forever). What stays HERE is the part that needs this script's
# context — the receipt, and the escalation of a race that outlived its retries.
: "${SETTLEMENT_RACE_ATTEMPTS:=3}"
if [ -z "${SETTLEMENT_ATTEMPT:-}" ]; then
  sh "$OFFICE/deploy/settlement-retry.sh" "$SETTLEMENT_RACE_ATTEMPTS" sh "$0" "$@" && exit 0
  rc=$?
  # Only a RACE outlives the retries as a 2. Anything else — a refusal, a
  # machinery trip — passed straight through, because a rerun composes the same
  # answer and would burn the crossing's whole budget rediscovering one fact.
  [ "$rc" = "2" ] || exit "$rc"
  # THE LAST ATTEMPT'S RECEIPT IS AMENDED, NOT REPLACED. Calling report() here
  # would recompose the receipt from THIS process's variables — and the wrapper
  # never fetched anything, so town_sha and world_from would come out empty and
  # the crossing's own evidence would be overwritten by the summary of it. The
  # child wrote a full race receipt; the wrapper adds the one thing the child
  # could not know, which is that every attempt has now been spent.
  node -e 'const fs=require("node:fs");const p=process.argv[1];let r={};try{r=JSON.parse(fs.readFileSync(p,"utf8"))}catch{}r.status="race";r.detail=process.argv[2];fs.writeFileSync(p,JSON.stringify(r,null,1)+"\n")' \
    "$OUT" "raced on all $SETTLEMENT_RACE_ATTEMPTS attempts — a door write is landing on every pass, so this is contention and not a transient. The crossing published nothing; the next scheduled crossing will try again, and an operator wanting it sooner can run the unit by hand once the writes quiet down" \
    || true
  node "$OFFICE/deploy/settlement-history.mjs" --receipt "$OUT" --history "$HISTORY" --attempt "" >/dev/null 2>&1 || true
  echo "[settlement-auto] RACED OUT after $SETTLEMENT_RACE_ATTEMPTS attempts — publishing nothing" >&2
  node "$OFFICE/deploy/settlement-escalate.mjs" --class race --receipt "$OUT" >&2 || true
  exit 2
fi

# Immutable inputs: the town at a pinned sha.
#
# The FETCH and the pinned read happen in both modes, because `town_sha` is the
# crossing's identity in the receipt and, after G1, the key the store's
# `stamp_projection` is looked up by — `(town_sha, handle)`, `world2/schema/
# 001_tables.sql:136-143`.
#
# THE FROZEN SNAPSHOT IS NO LONGER GIT-MODE ONLY (2026-09-09). It had exactly one
# reader, `tools/world-stake.mjs`, which the store path replaces — so the
# checkout was skipped under `store`. The household registry refresh below is its
# SECOND reader and it runs in both modes, so the snapshot is taken in both.
#
# AND IT MUST BE THE SNAPSHOT, NEVER `$TOWN` ITSELF. This script only FETCHES the
# long-lived town clone; nothing here advances its working tree, so the files on
# disk there are whatever some other hand's last checkout left. Measured rather
# than feared: on 2026-09-09 that tree sat at `5fa468e9` while its own
# `origin/main` was `4c234d47`. A registry derived from those files and stamped
# with `$TOWN_SHA` would name a tree its values did not come from, which is the
# one failure a freshness stamp exists to make impossible. So the export reads
# `$WORK/town`, and `deploy/settlement-registry.mjs` REFUSES unless the stamp
# that comes back is this crossing's own sha.
git -C "$TOWN" fetch -q origin
TOWN_SHA="$(git -C "$TOWN" rev-parse origin/main)"
git clone -q --local --no-checkout "$TOWN" "$WORK/town"
git -C "$WORK/town" checkout -qf "$TOWN_SHA"

# World: main, and — in git mode only — every sketchbook at its exact remote tip
# with its lease recorded.
#
# THE REFSPEC IS NARROWED IN STORE MODE, AND THAT IS NOT AN OPTIMISATION. The
# sweep surveys local AND remote draft refs together (`settlement-sweep.mjs:325-
# 338`) and materializes any remote draft with no local twin into a local
# tracking branch (`:364-379`). This clone is long-lived and its origin is the
# world repo, so it already holds forty `refs/remotes/origin/draft/*` from the
# git era. A store crossing that merely stopped fetching them would still FOLD
# them — silently, under a receipt saying `source: store`. Narrowing the refspec
# stops new ones arriving; `src/store-writedown.mjs` deletes the ones already
# here, asserts none survived, and reports the counts. Both are needed: the
# refspec alone leaves the existing forty, and the deletion alone would be undone
# by the next fetch.
if [ "$SOURCE" = "git" ]; then
  git -C "$SWEEP" fetch -qp origin '+refs/heads/*:refs/remotes/origin/*'
else
  git -C "$SWEEP" fetch -qp origin '+refs/heads/main:refs/remotes/origin/main'
fi
WORLD_FROM="$(git -C "$SWEEP" rev-parse origin/main)"
git -C "$SWEEP" checkout -qf -B main origin/main
git -C "$SWEEP" clean -fdq  # a killed run leaves untracked debris; the clone is disposable

# ── THE HOUSEHOLD REGISTRY IS RE-DERIVED AT THE START OF EVERY CROSSING ──────
#                                                        (founder, 2026-09-09)
#
# `WORLD/households.json` is the World's ONLY knowledge of which handles form one
# household. It is an EXPORT of this office's resolver, and until this step it was
# written into the world BY HAND: the export tool's own header ruled that the
# refresh "belongs with pin churn, not on a timer" and is "the caller's act
# (founder hand or the keeper's crossing sweep)".
#
# Nobody was that caller after 2026-08-07. Thirty-three days later the committed
# file named 101 handles in 73 households while the town's own resolver named 157
# in 108, and every household that had joined in between was a stranger to the
# fold. The founder, reading the count: "How do we determine n households? How
# can that go stale? That seems very wrong."
#
# THREE READERS TAKE THIS FILE AS LIVE, AND THE THIRD FAILS SILENTLY:
#   · tools/marks-fold.mjs § parcel admissibility — the claim cap, sovereignty,
#     rivalry, consent. Takes `--households <file>`; the crossing passes none.
#   · tools/mark-lint.mjs § the consent gate — "your own household's ground".
#     Takes `--households <file>`; the crossing passes none.
#   · tools/settlement-sweep.mjs + tools/lane-wall.mjs — the AUTHORSHIP WALL.
#     Takes NO flag at all, and the sweep leaves a sketchbook it cannot bind
#     ALONE rather than refusing it. So a registry that does not know a household
#     produces a crossing that looks clean and verified nobody.
#
# A value nothing refreshes, read as live. SO THE CROSSING IS THE CALLER — here,
# at the top, in BOTH modes, BEFORE the fold reads it. Under `store` the same step
# runs and for the same reasons: the store's `identities`/`town_roll` do not yet
# feed the wall or the lint, so this file is still what both of them read.
#
# IT REFUSES RATHER THAN FOLD ON A REGISTRY IT CANNOT VOUCH FOR, exactly as the
# drain does. Folding under an unattributable registry is a WRONG publication —
# marks filed into the wrong households, a wall standing down — and it is silent.
# A refused crossing is a finding somebody reads. `SETTLEMENT_REGISTRY=0` is the
# deliberate bypass for an operator whose export is broken and who needs the town
# to cross anyway; it lands on the receipt as `ran: false` with its reason.
#
# THE COMMIT IS ITS OWN, AND THAT IS NOT A PREFERENCE. It would ride the sweep's
# `settlement: sweep …` commit if it could — that is where the crossing's other
# derived files land. It cannot: `settlement-sweep.mjs` REFUSES on a dirty
# checkout (its `clean-check` phase) and its commit stages an explicit path list
# this file is not on. A registry written into the clone and left uncommitted
# would refuse the crossing before the fold ever ran. Putting it on the sweep's
# list is a WORLD-repo change, and this office chain must not depend on a world
# change that has not landed — so the refresh commits itself, ahead of the fold,
# and world main carries the two commits in the order they actually happened.
REGISTRY_JSON=""
REGISTRY_COMMIT=""
REGISTRY_FLAG=""
REGISTRY_ARG=""
if [ "${SETTLEMENT_REGISTRY:-1}" = "1" ]; then
  mkdir -p "$WORK/registry/WORLD"
  # The export writes into a SCRATCH world, never straight into the sweep clone.
  # If it half-writes, or stamps a tree it did not read, the clone was never
  # touched and there is nothing to restore — and a restore of a generated file
  # is exactly the step a crashed crossing skips.
  if ! (cd "$OFFICE" && node "$OFFICE/tools/world-households-export.mjs" \
        --town "$WORK/town" --world "$WORK/registry") > "$WORK/registry.log" 2>&1; then
    REGISTRY_JSON="$WORK/registry.json"
    node -e 'const fs=require("node:fs");fs.writeFileSync(process.argv[1],JSON.stringify({refused:"the household export tripped",detail:process.argv[2]},null,1)+"\n")' \
      "$REGISTRY_JSON" "$(head -c 400 "$WORK/registry.log" | tr '\n"' ' .')" 2>/dev/null || REGISTRY_JSON=""
    report refused "the household registry could not be re-derived: $(head -c 200 "$WORK/registry.log" | tr '\n"' ' .')"
    echo "[settlement-auto] REGISTRY EXPORT TRIPPED — publishing nothing" >&2
    cat "$WORK/registry.log" >&2; exit 1
  fi
  REGISTRY_JSON="$WORK/registry.json"
  if ! node "$OFFICE/deploy/settlement-registry.mjs" \
        --fresh "$WORK/registry/WORLD/households.json" --world "$SWEEP" --town-sha "$TOWN_SHA" \
        > "$REGISTRY_JSON" 2>"$WORK/registry.err"; then
    report refused "the household registry refused: $(node -e 'const r=require(process.argv[1]);process.stdout.write(String(r.refused||"unknown")+" — "+String(r.detail||""))' "$REGISTRY_JSON" 2>/dev/null || head -c 200 "$WORK/registry.err" | tr '\n"' ' .')"
    echo "[settlement-auto] REGISTRY REFUSED — publishing nothing" >&2
    cat "$REGISTRY_JSON" >&2 2>/dev/null || true; cat "$WORK/registry.err" >&2; exit 1
  fi
  # A REFRESH THAT CHANGED NOTHING COMMITS NOTHING. The export stamps a new
  # `generated_at` on every run, so copying it in unconditionally would put a
  # commit on world main every twelve hours forever and turn every quiet crossing
  # into one that moved main. settlement-registry.mjs compares the SUBSTANCE and
  # writes the file only when the mapping actually moved; the receipt is where
  # "this crossing looked" is said on every crossing either way.
  if [ "$(node -e 'const r=require(process.argv[1]);process.stdout.write(String(r.changed===true))' "$REGISTRY_JSON")" = "true" ]; then
    node -e 'const r=require(process.argv[1]);process.stdout.write(r.commit_message)' "$REGISTRY_JSON" > "$WORK/registry.msg"
    git -C "$SWEEP" add -- WORLD/households.json
    git -C "$SWEEP" \
      -c user.name="the settlement sweep (box)" \
      -c user.email="postmark-settlement@users.noreply.github.com" \
      commit -q -F "$WORK/registry.msg"
    REGISTRY_COMMIT="$(git -C "$SWEEP" rev-parse HEAD)"
  fi
  echo "[settlement-auto] registry: $(node -e 'const r=require(process.argv[1]);process.stdout.write(String(r.summary||""))' "$REGISTRY_JSON")" >&2
  # WHAT THE WORLD IS TOLD. The sha this crossing VERIFIED the registry against,
  # never the stamp the file carries — those are different facts, and the world
  # must not compare them for equality. See deploy/settlement-registry.mjs.
  REGISTRY_FLAG="--registry-verified-at"
  REGISTRY_ARG="$TOWN_SHA"
else
  REGISTRY_JSON="$WORK/registry.json"
  node -e 'const fs=require("node:fs");fs.writeFileSync(process.argv[1],JSON.stringify({ran:false,bypass:true,reason:"SETTLEMENT_REGISTRY=0 — this crossing folded on whatever WORLD/households.json world main already carried"},null,1)+"\n")' \
    "$REGISTRY_JSON" 2>/dev/null || REGISTRY_JSON=""
  # ── THE BYPASS MUST ACTUALLY BYPASS ────────────────────────────────────────
  #
  # The first cut passed the verification unconditionally, so the documented
  # escape hatch refused the crossing on the very file it exists to tolerate. A
  # bypass that refuses is not a bypass. The world is told the registry was NOT
  # verified and why, it does not refuse, and the crossing is LOUD about it here
  # and on the receipt — because an unverified crossing that reads like an
  # ordinary one is the 2026-08-07 shape wearing this lane's own clothes.
  REGISTRY_FLAG="--registry-unverified"
  REGISTRY_ARG="SETTLEMENT_REGISTRY=0"
  echo "[settlement-auto] *** REGISTRY UNVERIFIED (bypass) *** SETTLEMENT_REGISTRY=0 — nothing checked WORLD/households.json against the town this crossing; the fold, the lint and the authorship wall read whatever world main already carries" >&2
fi

# THE BASE THE SWEEP IS MEASURED AGAINST. `main` may already be ahead of
# `origin/main` at this line, because the registry refresh commits before the
# fold. The quiet-pass test at the end of this script asks whether THE SWEEP
# published anything, which is a different question from whether main moved, and
# `deploy/settlement-history.mjs --recurring` reads that answer to decide whether
# the town has settled in three days. A registry refresh must never be able to
# answer it yes.
WORLD_BASE="$(git -C "$SWEEP" rev-parse main)"

: > "$WORK/tips"
if [ "$SOURCE" = "git" ]; then
  git -C "$SWEEP" for-each-ref --format='%(refname:short) %(objectname)' 'refs/remotes/origin/draft/*' > "$WORK/tips"
fi

# ── THE SKETCHBOOK SYNC IS FAST-FORWARD-AWARE (2026-08-27) ───────────────────
#
# This used to be `git branch -qf "$b" "$sha"` unconditionally: every local
# sketchbook was slammed back to its remote tip at the start of every run. That
# was safe while nothing ever WROTE to this clone. The drain writes to it, and
# the drain's one irreversible step — the journal truncate — happens INSIDE the
# drain, before this script can deliver what it wrote. So if a delivery ever
# fails, the drained commits live only as local refs here, and an unconditional
# reset on the next run would destroy the one copy of work whose journal rows
# are already gone. Undelivered work is now KEPT and retried instead:
#
#   local absent, or local is an ancestor of remote  → take remote (a fast-forward)
#   local is AHEAD of remote                          → KEEP local (undelivered drain)
#   diverged                                          → take remote, and shout
#
# The lease recorded in "$WORK/tips" is still the REMOTE tip in every case, so
# the compare-and-swap on the push below is unchanged: it still asks "has origin
# moved since I looked", which is the only question a lease should ask.
# ── THE ROLLBACK'S GHOST (repair 1, reviewer at f2274e47) ────────────────────
#
# THE DEFECT, and it points the dangerous way. The store path deletes every
# draft ref before it writes (`store-writedown.mjs § clearGitSketchbooks`). The
# git path deleted NOTHING: `$WORK/tips` is built only from
# `refs/remotes/origin/draft/*`, the sync loop below reconciles only the names it
# found there, and the sweep's `draftBranches` returns EVERY LOCAL draft ref. So
# the sketchbooks a store crossing left in this long-lived clone — minus the ones
# whose names collide with an origin branch and get reset — were folded by the
# next rollback crossing, carrying store renders under a receipt saying
# `source: git`. Sized by the reviewer against S63: 27 names collide and reset,
# **57 survive and are folded**.
#
# And the rollback is the hatch you reach for WHEN THE STORE PATH HAS ALREADY
# GONE WRONG, which is exactly the moment its leftovers are worst. The shape is
# new with G1: before it, a local-only sketchbook was delivered to origin
# immediately, so it never persisted.
#
# THE REPAIR IS NOT "DELETE EVERY TWIN-LESS LOCAL", and that matters. The git
# path deliberately KEEPS a twin-less local: a household drained for the first
# time whose delivery push failed has its only copy there, with its journal rows
# already truncated (`:339-345` pushes them, and says "it will be retried next
# crossing"). Deleting those would destroy the one copy of work the drain has
# already made irreversible — the exact defect the sync loop below exists to
# prevent, re-introduced by its own fix.
#
# So the two are told apart by the one fact that distinguishes them, which is the
# commit each write-down wrote:
#
#   subject begins `store write-down:`  → a store crossing's leftover, DELETE
#   tree equals main's tree             → carries nothing at all, DELETE
#   anything else                       → KEEP, and say why, and let the
#                                         delivery loop retry it
#
# The unrecognised case is KEPT, which is the conservative direction: a ref this
# cannot classify is treated as somebody's undelivered work, not as debris.
GHOSTS=0
KEPT_UNDELIVERED=0
RESETS=0
if [ "$SOURCE" = "git" ]; then
  MAIN_TREE="$(git -C "$SWEEP" rev-parse 'main^{tree}')"
  git -C "$SWEEP" for-each-ref --format='%(refname:short)' 'refs/heads/draft/*' | while read -r b; do
    [ -n "$b" ] || continue
    subject="$(git -C "$SWEEP" log -1 --format=%s "refs/heads/$b" 2>/dev/null || echo '')"
    if git -C "$SWEEP" rev-parse --verify -q "refs/remotes/origin/$b" >/dev/null; then
      # ── THE COLLIDING-NAME HOLE, CLOSED RATHER THAN DOCUMENTED ──────────────
      #
      # A store-written local whose name COLLIDES with an origin draft used to
      # skip this sweep entirely and fall through to the sync loop. That loop
      # asks only about ancestry, and if origin's draft were an ancestor of main
      # the store-written branch — built from main — would be AHEAD of it, get
      # classed "undelivered drain", be KEPT, and then be PUSHED by the lease
      # loop at the end. A store render into a git-era sketchbook, on origin.
      #
      # Unreachable today and measured rather than assumed: 0 of the 40 origin
      # drafts are ancestors of `main` at S63. It becomes reachable the first
      # time a fully merged draft is left standing on origin — a green-week
      # merge, or G2's cleanup.
      #
      # So a store-written local is RESET to its origin twin here, before the
      # sync loop can form an opinion about it. Resetting rather than deleting is
      # the whole point when a twin exists: origin's sketchbook is the git era's
      # own and must survive; only the store's scratch on top of it goes.
      case "$subject" in
        "store write-down:"*)
          twin="$(git -C "$SWEEP" rev-parse "refs/remotes/origin/$b")"
          if [ "$(git -C "$SWEEP" rev-parse "refs/heads/$b")" != "$twin" ]; then
            git -C "$SWEEP" branch -qf "$b" "$twin"
            echo "[settlement-auto] reset $b to its origin twin — a store crossing had written over a git-era sketchbook's name" >&2
            # ITS OWN COUNTER, not `ghosts`. A ghost is a leftover DELETED; this
            # is a store scratch RESET off a twin that survives, and origin's own
            # sketchbook lives on. Folding them together is exactly what the
            # receipt's own comment argues against one field up: two alarms in one
            # number hide whichever is smaller, and these have different repairs —
            # a ghost means store crossings are dying before their own cleanup, a
            # reset means a store crossing took a git-era sketchbook's name.
            echo x >> "$WORK/resets"
          fi ;;
      esac
      continue
    fi
    tree="$(git -C "$SWEEP" rev-parse "refs/heads/$b^{tree}" 2>/dev/null || echo '')"
    case "$subject" in
      "store write-down:"*)
        git -C "$SWEEP" update-ref -d "refs/heads/$b"
        echo "[settlement-auto] cleared $b — a store crossing's leftover sketchbook with no origin twin; a rollback must not fold it" >&2
        echo x >> "$WORK/ghosts" ;;
      *)
        if [ -n "$tree" ] && [ "$tree" = "$MAIN_TREE" ]; then
          git -C "$SWEEP" update-ref -d "refs/heads/$b"
          echo "[settlement-auto] cleared $b — a twin-less local sketchbook whose tree is main's; it carries nothing" >&2
          echo x >> "$WORK/ghosts"
        else
          echo "[settlement-auto] KEEPING $b — twin-less local this cannot attribute to a store crossing; treating it as an undelivered drain, which the delivery loop will retry" >&2
          echo x >> "$WORK/kept"
        fi ;;
    esac
  done
  # The loop above runs in a subshell (it is the right-hand side of a pipe), so
  # its variables do not survive it. The counts come back through $WORK, which is
  # the same reason the delivery loop below writes `tips.next` to a file.
  [ -f "$WORK/ghosts" ] && GHOSTS="$(wc -l < "$WORK/ghosts" | tr -d ' ')"
  [ -f "$WORK/kept" ] && KEPT_UNDELIVERED="$(wc -l < "$WORK/kept" | tr -d ' ')"
  [ -f "$WORK/resets" ] && RESETS="$(wc -l < "$WORK/resets" | tr -d ' ')"
fi

UNDELIVERED=0
while read -r ref sha; do
  b="${ref#origin/}"
  if ! git -C "$SWEEP" rev-parse --verify -q "refs/heads/$b" >/dev/null; then
    git -C "$SWEEP" branch -qf "$b" "$sha"
  elif git -C "$SWEEP" merge-base --is-ancestor "$b" "$sha"; then
    git -C "$SWEEP" branch -qf "$b" "$sha"
  elif git -C "$SWEEP" merge-base --is-ancestor "$sha" "$b"; then
    UNDELIVERED=$((UNDELIVERED + 1))
    echo "[settlement-auto] $b is AHEAD of origin — a previous drain's write-down was never delivered; keeping it and retrying the push" >&2
  else
    echo "[settlement-auto] $b DIVERGED from origin — reconciling that is the settlement's arithmetic, taking origin's tip" >&2
    git -C "$SWEEP" branch -qf "$b" "$sha"
  fi
done < "$WORK/tips"

# ── THE DRAIN ────────────────────────────────────────────────────────────────
#
# The journal empties into these sketchbooks, and then they are DELIVERED,
# before the sweep looks for candidates. Two properties are bought here:
#
#   · a door-written mark cannot age past one crossing unattended (defect 1);
#   · the truncate is backed by origin before the crossing can fail anywhere
#     else — the write-down is pushed IMMEDIATELY after the drain returns, not
#     at the end with everything else, so a red suite or a lost race costs a
#     retry and never a draft.
#
# `--commit-state` is required, not optional: the drain writes STATE/log windows
# and the public ledgers into the working tree, and the sweep refuses on a dirty
# checkout. Committing them here is also correct on its own terms — they are
# main's files and the clone stands on main at this point.
DRAIN_JSON=""
if [ "$SOURCE" = "git" ] && [ "${SETTLEMENT_DRAIN:-1}" = "1" ]; then
  DRAIN_JSON="$WORK/drain.json"
  if ! (cd "$OFFICE" && WORLD_SINGLE_LOG=1 node "$OFFICE/src/world-drain.mjs" \
        --world "$SWEEP" --commit-state) > "$DRAIN_JSON" 2>"$WORK/drain.err"; then
    report refused "drain tripped: $(head -c 200 "$WORK/drain.err" | tr '\n"' ' .')"
    echo "[settlement-auto] DRAIN TRIPPED — publishing nothing" >&2; cat "$WORK/drain.err" >&2; exit 1
  fi
  # A refusal is a JSON body, not a non-zero exit, for the two flag/clone cases.
  if node -e 'const r=require(process.argv[1]);if(r.refused){console.error(r.refused+": "+(r.detail||""));process.exit(1)}' "$DRAIN_JSON" 2>"$WORK/drain.refusal"; then
    echo "[settlement-auto] drained: $(node -e 'const r=require(process.argv[1]);process.stdout.write(String(r.drained||0)+" row(s) into "+String((r.households||[]).length)+" sketchbook(s)")' "$DRAIN_JSON")" >&2
  else
    report refused "drain refused: $(head -c 200 "$WORK/drain.refusal" | tr '\n"' ' .')"
    echo "[settlement-auto] DRAIN REFUSED — publishing nothing" >&2; cat "$WORK/drain.refusal" >&2; exit 1
  fi

  # DELIVER THE WRITE-DOWN NOW. Under the same lease the final push uses, so a
  # door write that landed mid-drain still fails safe. On success the recorded
  # lease advances to what we just put there — the sweep will rebase these same
  # branches and push them again at the end, and a lease naming the pre-drain
  # tip would refuse our own delivery.
  : > "$WORK/tips.next"
  DELIVERED=0
  while read -r ref sha; do
    b="${ref#origin/}"
    LOCAL="$(git -C "$SWEEP" rev-parse "refs/heads/$b")"
    if [ "$LOCAL" != "$sha" ]; then
      if git -C "$SWEEP" push -q --force-with-lease="refs/heads/$b:$sha" origin "$b"; then
        DELIVERED=$((DELIVERED + 1)); echo "$ref $LOCAL" >> "$WORK/tips.next"
      else
        report race "lease refused delivering the drain to $b (door write mid-run) — rerun"
        echo "[settlement-auto] LEASE REFUSED delivering $b — rerun" >&2; exit 2
      fi
    else
      echo "$ref $sha" >> "$WORK/tips.next"
    fi
  done < "$WORK/tips"
  # A household drained for the FIRST time has a local sketchbook and no origin
  # ref, so it is in neither list above and used to be pushed by nobody at all.
  git -C "$SWEEP" for-each-ref --format='%(refname:short) %(objectname)' 'refs/heads/draft/*' |
  while read -r b sha; do
    if ! grep -q "^origin/$b " "$WORK/tips"; then
      if git -C "$SWEEP" push -q origin "refs/heads/$b:refs/heads/$b"; then
        echo "[settlement-auto] new sketchbook delivered: $b" >&2
        echo "origin/$b $sha" >> "$WORK/tips.next"
      else
        echo "[settlement-auto] could not create $b on origin — it will be retried next crossing" >&2
      fi
    fi
  done
  mv "$WORK/tips.next" "$WORK/tips"
  # Written as `if` rather than `[ … ] && echo` so the block does not leave a
  # non-zero $? standing behind it. (`set -e` does not kill a false AND-OR list
  # mid-script — verified, not assumed — but the residue is a trap for whoever
  # appends the next line.)
  if [ "$DELIVERED" -gt 0 ]; then
    echo "[settlement-auto] delivered $DELIVERED drained sketchbook(s) to origin" >&2
  fi
  if [ "$UNDELIVERED" -gt 0 ]; then
    echo "[settlement-auto] $UNDELIVERED previously-undelivered sketchbook(s) went out with this crossing" >&2
  fi
fi

# ── THE STORE'S WRITE-DOWN, IN THE DRAIN'S PLACE (G1) ────────────────────────
#
# One read of the store answers BOTH of the fold's questions — which marks stand
# at this window, and what each is staked at — so the two arrive together from
# one entry point at one instant. That is the property the two-hop chain never
# had: the drain's sketchbooks were written at one moment and the stakes derived
# from a town read at another, and nothing anywhere said the two agreed.
#
# It refuses LOUDLY and publishes nothing. There is deliberately no fall-through
# to git: a receipt saying `source: store` over a git fold would be a worse lie
# than a refused crossing, and the rollback is an operator's deliberate act
# (`SETTLEMENT_SOURCE=git`), never something this script decides for itself at
# 06:00Z with nobody watching.
STORE_JSON=""
DOCKET_JSON=""
if [ "$SOURCE" = "store" ]; then
  # ── WAIT FOR THE CANDLE. THE ORDER INVERTS AT THE SWAP ──────────────────────
  #
  # In the git era the settlement and the candle were independent: the sweep
  # committed at :45:32 and the clearing locked window 177's docket at :45:44, so
  # the fold ran BEFORE the clearing and did not care — its input came from
  # sketchbooks the drain had already written.
  #
  # After G1 the fold's input IS the clearing's output. So this crossing waits
  # for the candle to lock the closing window's docket, and only then folds. A
  # crossing that folded first would fold the PREVIOUS window a second time and
  # look exactly like a quiet crossing: same marks, nothing new, green.
  #
  # It WAITS rather than INVOKES, deliberately. Invoking the clearing from here
  # would give the settlement a write pen on the candle and make one unit
  # responsible for both halves of a seam whose whole value is that they are
  # separate. A wait that times out is a loud finding; an invocation that fails
  # is a settlement holding a half-cleared window.
  #
  # `$STAMP` is this crossing's own start instant, which is what makes the
  # condition unambiguous — see the tool's header for why "the most recently
  # closed window" and "the open window has closed" are both wrong.
  #
  # `--by-hand` (postmark#2786) swaps the QUESTION, not the guard: the operator
  # asks which closed window is still unfolded, and the timer goes on asking which
  # window closed for this crossing. The flag is built here rather than inlined so
  # the scheduled crossing's command line is byte-for-byte what it was.
  DOCKET_JSON="$WORK/docket.json"
  BY_HAND_FLAG=""
  if [ "$BY_HAND" = "1" ]; then BY_HAND_FLAG="--by-hand"; fi
  if ! (cd "$OFFICE" && node "$OFFICE/world2/tools/await-clearing.mjs" \
        --since "$STAMP" --timeout-s "${SETTLEMENT_CLEARING_WAIT_S:-240}" $BY_HAND_FLAG) > "$DOCKET_JSON" 2>"$WORK/docket.err"; then
    # The DETAIL carries the tool's own reason word — `clearing-did-not-run` for
    # the timer, `nothing-unfolded` for the operator door — so the sentence is
    # written once, by the tool, and this line does not decide which refusal it
    # is looking at.
    report refused "this crossing has no docket to fold: $(node -e 'const r=require(process.argv[1]);process.stdout.write(String(r.refused||"unknown")+" — "+String(r.detail||""))' "$DOCKET_JSON" 2>/dev/null || head -c 200 "$WORK/docket.err" | tr '\n"' ' .')"
    echo "[settlement-auto] NO DOCKET — publishing nothing" >&2
    cat "$DOCKET_JSON" >&2 2>/dev/null || true; cat "$WORK/docket.err" >&2
    exit 1
  fi
  # `waited_s` is on the timer's docket and not on the by-hand one, because the
  # by-hand read waits for nothing — printing "waited 0s" for an act that never
  # waited is a number that describes the wrong thing.
  echo "[settlement-auto] docket: window $(node -e 'const d=require(process.argv[1]);process.stdout.write(String(d.window)+" locked at "+String(d.cleared_at)+(d.by_hand?" (TAKEN BY HAND — the newest unfolded window)":" (waited "+String(d.waited_s)+"s)"))' "$DOCKET_JSON")" >&2
  DOCKET_WINDOW="$(node -e 'const d=require(process.argv[1]);process.stdout.write(String(d.window))' "$DOCKET_JSON")"

  # ── THE ARCHIVE'S EVENT LOG, WRITTEN FROM THE STORE (POS-155) ──────────────
  #
  # WHAT IS ACTUALLY DARK, MEASURED 2026-09-22 on world `origin/main` at
  # `17fa4195`. `STATE/log` holds two families and only one of them is alive:
  #
  #   `<c>.journal.jsonl`  the DRAIN's act journal. Last written 2026-09-11
  #                        05:45:06Z (`4d491498`). The store path runs no drain,
  #                        so the swap already turned this off — ELEVEN DAYS
  #                        AGO. G1 is not the threat to it; G1 is what happened.
  #
  #   `<N>.jsonl`          `tools/crossing-save.mjs`'s entity/event snapshot,
  #                        still committed a couple of minutes after each ferry
  #                        crossing (205 at 12:02:36Z, 204 at 00:04:38Z)
  #                        (`17fa4195`, "crossing-save 205"). A different file
  #                        with a different grammar. This step does not touch it
  #                        and does not retire it — that is G2.
  #
  # So this step RE-LIGHTS the act journal rather than keeping it alive, and it
  # is the same bytes the drain wrote: `world2/tools/state-log-write.mjs` renders
  # through `src/state-log-from-store.mjs` and writes through the drain's own
  # `writeJournalWindow`, never a second serializer.
  #
  # ── WHY IT STANDS HERE, BEFORE THE FOLD ────────────────────────────────────
  #
  # Two reasons, and the second is the one that would bite.
  #
  #   1. It needs `$DOCKET_WINDOW` and nothing else. The clearing has already
  #      locked the window, so every act this window owns is in `acts` by this
  #      line; the fold's output is not an input to a photograph of what people
  #      did. Placing it after the fold would buy nothing and cost ordering.
  #
  #   2. `$WORLD_BASE` IS THE QUIET PASS'S BASELINE AND IT IS SET AT :463 —
  #      before the docket exists. It means "main after the NON-SWEEP commits,
  #      before the fold", which is what lets a crossing where the registry
  #      moved and nothing settled still report `quiet` (:1064-1068). A
  #      photograph is exactly such a commit, so it is taken here and
  #      `$WORLD_BASE` is advanced past it. Written after the fold instead, it
  #      would make `$WORLD_TO` differ from `$WORLD_BASE` on every crossing and
  #      a quiet town would report `published` with six zero channels — which is
  #      the answer `settlement-history.mjs --recurring` reads to decide whether
  #      this town has settled in three days. The starving crossing with better
  #      paperwork, again, from a new direction.
  #
  #      Both readers of `$WORLD_BASE` want it advanced: the harm gate's
  #      `--base` (:990) measures what THE SWEEP produced, and a STATE commit in
  #      the base is a STATE commit the gate correctly does not attribute to it.
  #
  # And the fold does not mind main moving under it: it reads AT `--world-sha
  # "$WORLD_FROM"` (`canon-register.mjs § canonRegisterAtSha`), which is the
  # repair :763-786 already carries for the registry refresh committing here.
  # This commit touches `STATE/log/` only — no `WORLD/marks`, nothing the fold
  # reads at all.
  #
  # ── THE WINDOW IS NOT THE CROSSING, AND THE TOOL KNOWS IT ──────────────────
  #
  # `$DOCKET_WINDOW` is the CANDLE window. `acts.crossing` is the FERRY clock.
  # Candle window 204 is [09-21 17:45Z, 09-22 05:45Z); ferry crossing 204 is
  # [09-22 00:00Z, 09-22 12:00Z). One window's acts land in TWO journal files
  # and neither is finished until the next settlement writes into it — which is
  # what `writeJournalWindow`'s merge-by-seq has always been for. The tool
  # resolves the window's own `opens_at`/`closes_at` from the `windows` row and
  # groups by each act's own crossing value; it never derives a boundary from a
  # clock. See `state-log-write.mjs § WINDOW_BOUNDARY`.
  #
  # ── THE DEFAULT IS `sqlite`, AND IT ONLY LOOKS ─────────────────────────────
  #
  # `STATE_LOG_SOURCE=sqlite` (THE DEFAULT) runs `--check`: it renders the
  # window from the register, compares against what is on disk, and writes the
  # verdict into the receipt. IT NEVER FAILS THE CROSSING. On prod today it will
  # report `absent` for every crossing, because nothing has written a
  # `.journal.jsonl` since 09-11 — that report IS the measurement, and how many
  # lines it would have written is the size of the hole.
  #
  # `STATE_LOG_SOURCE=store` runs `--write`: the files ride this crossing's own
  # push. The flip is Wright's, by hand, after three consecutive windows check
  # clean on prod — and a check cannot read clean until a write has happened, so
  # the honest order is: flip one window by hand, check the next three.
  #
  # `--last-drained` is the drain's last file (`182.2538`), so `MERGE_HAZARD`
  # refuses any crossing value the drain already photographed: the register's
  # seq is `acts.id`, a different numbering, and re-deriving a drain-era window
  # would merge a SECOND copy of every line rather than replacing them.
  STATE_LOG_JSON=""
  STATE_LOG_MODE="${STATE_LOG_SOURCE:-sqlite}"
  # THE KILL SWITCH IS A DOOR, SO IT COMES FIRST. `SETTLEMENT_STATE_LOG=0` is
  # what an operator reaches for at 06:00Z when this step is the thing going
  # wrong, and a mode check standing ahead of it would refuse the crossing on a
  # stale `STATE_LOG_SOURCE` the operator had just switched off. A guard the
  # off-switch cannot get past is a guard that blocks the fix.
  if [ "${SETTLEMENT_STATE_LOG:-1}" = "1" ]; then
    # AN UNRECOGNISED MODE REFUSES RATHER THAN DEFAULTING, the same rule
    # `SETTLEMENT_SOURCE` holds at :147 and for the same reason. A typo'd
    # `STATE_LOG_SOURCE=stor` falling back to `sqlite` would mean the default
    # was flipped, nobody was told, and the archive went on not being written —
    # which is precisely the silence this step exists to end.
    #
    # It refuses THROUGH THE RECEIPT and not with a bare `exit`. :147 exits bare
    # because it runs before `report` is defined; this line does not, and a
    # crossing that stops with nothing on the receipt is a state the roll-call
    # cannot see.
    case "$STATE_LOG_MODE" in
      store|sqlite) ;;
      *)
        report refused "STATE_LOG_SOURCE=\"$STATE_LOG_MODE\" is not \`store\` or \`sqlite\` — refusing rather than guessing whether to write the archive; SETTLEMENT_STATE_LOG=0 turns the step off"
        echo "[settlement-auto] STATE_LOG_SOURCE=\"$STATE_LOG_MODE\" is not \`store\` or \`sqlite\` — publishing nothing" >&2
        exit 1 ;;
    esac
    STATE_LOG_JSON="$WORK/state-log.json"
    if [ "$STATE_LOG_MODE" = "store" ]; then
      if (cd "$OFFICE" && node "$OFFICE/world2/tools/state-log-write.mjs" \
            --world "$SWEEP" --window "$DOCKET_WINDOW" --write \
            --last-drained "${STATE_LOG_LAST_DRAINED:-182.2538}" \
            --as-of-world "$WORLD_FROM") > "$STATE_LOG_JSON" 2>"$WORK/state-log.err"; then
        echo "[settlement-auto] photograph: $(node -e 'const r=require(process.argv[1]);const w=r.windows||[];process.stdout.write("window "+String(r.window)+" -> "+w.length+" journal file(s) ["+w.map((x)=>x.crossing).join(", ")+"], "+w.reduce((n,x)=>n+x.lines,0)+" line(s)"+(r.state_commit?" at "+String(r.state_commit).slice(0,9):" (unchanged: "+String(r.state_note||"")+")")+(w.some((x)=>(x.unnamed_households||[]).length)?"; UNNAMED HOUSEHOLD(S): "+[...new Set(w.flatMap((x)=>x.unnamed_households||[]))].join(", "):""))' "$STATE_LOG_JSON" 2>/dev/null || echo 'written')" >&2
        # THE BASELINE MOVES WITH IT, for the reason in the header. Read back
        # from git rather than from the tool's reported sha: `penCommit` returns
        # null when nothing changed, and a baseline set from a null would make
        # the quiet test compare against an empty string and call every crossing
        # published.
        WORLD_BASE="$(git -C "$SWEEP" rev-parse main)"
      else
        # A WRITE THAT FAILED IS A REFUSAL, not a warning. Under `store` this is
        # the archive's only pen, and a crossing that published while quietly
        # losing its own event log is the shape this lane exists to end.
        report refused "the photograph could not be written: $(node -e 'const r=require(process.argv[1]);process.stdout.write(String(r.refused||"unknown")+" — "+String(r.detail||""))' "$STATE_LOG_JSON" 2>/dev/null || head -c 200 "$WORK/state-log.err" | tr '\n"' ' .')"
        echo "[settlement-auto] PHOTOGRAPH REFUSED — publishing nothing" >&2
        cat "$STATE_LOG_JSON" >&2 2>/dev/null || true; cat "$WORK/state-log.err" >&2
        exit 1
      fi
    else
      # `--check` exits 1 on "not clean", which is a VERDICT and not a failure.
      # The `if` swallows it deliberately and the receipt carries the answer;
      # nothing on this arm may stop a crossing, including the tool being
      # unable to run at all — which is itself reported rather than hidden.
      if (cd "$OFFICE" && node "$OFFICE/world2/tools/state-log-write.mjs" \
            --world "$SWEEP" --window "$DOCKET_WINDOW" --check \
            --last-drained "${STATE_LOG_LAST_DRAINED:-182.2538}") > "$STATE_LOG_JSON" 2>"$WORK/state-log.err"; then
        echo "[settlement-auto] state-log check: $(node -e 'const r=require(process.argv[1]);const c=r.crossings||[];process.stdout.write("window "+String(r.window)+" CLEAN over "+c.length+" journal file(s) ["+c.map((x)=>x.crossing).join(", ")+"]")' "$STATE_LOG_JSON" 2>/dev/null || echo 'clean')" >&2
      else
        echo "[settlement-auto] state-log check: $(node -e 'const r=require(process.argv[1]);if(r.refused){process.stdout.write("REFUSED "+r.refused+" — "+String(r.detail||""));}else{const c=r.crossings||[];const cls={};for(const x of c)for(const[k,v]of Object.entries(x.classes||{}))cls[k]=(cls[k]||0)+v;const first=(c.find((x)=>!x.byte_equal)||{}).first_difference;process.stdout.write("window "+String(r.window)+" NOT CLEAN over "+c.length+" file(s): "+Object.entries(cls).map(([k,v])=>k+" "+v).join(", ")+(first?"; first: "+first:"")+"; would write "+c.reduce((n,x)=>n+(x.derived_lines||0),0)+" line(s)")}' "$STATE_LOG_JSON" 2>/dev/null || head -c 200 "$WORK/state-log.err" | tr '\n"' ' .')" >&2
        echo "[settlement-auto] (the check never fails a crossing; STATE_LOG_SOURCE=store is what writes)" >&2
      fi
    fi
  fi

  # ── THE ORDERING: THE FOLD READS AFTER THE CLEARING'S INGEST ────────────────
  #
  # Lane 2's stakes come from `escrow_projection`, written by `stamp-ingest.mjs`
  # inside the clearing's own transaction (`world2/tools/clearing-job.mjs:60`
  # shells to it as the census first step). So the store's escrow is as-of the
  # sha the CLEARING ingested, and this crossing must read after that, not beside
  # it. `$TOWN_SHA` is passed as the INPUT TO A CHECK, not as the sha folded at:
  # the store answers at its own ingested head, and `fold-input-cli.mjs` refuses
  # if that head is not in this town's history and NAMES the distance when it is
  # merely behind. An ingest that has stopped running is otherwise
  # indistinguishable from a quiet town.
  FOLD_INPUT="$WORK/fold-input.json"
  #
  # ── AND `--world-repo` IS THE CARRY'S ONE ARGUMENT (2026-09-12) ─────────────
  #
  # `$SWEEP` is the world clone. It is checked out at `$WORLD_FROM` two hundred
  # lines above — AND ITS HEAD MAY ALREADY HAVE MOVED PAST IT BY THIS LINE.
  #
  # AN EARLIER VERSION OF THIS COMMENT SAID THE TWO WERE EQUAL BY CONSTRUCTION,
  # AND THAT WAS WRONG, and the correction is left visible rather than swapped
  # out because the wrong sentence is the more tempting one to write. The registry
  # refresh at :386-395 COMMITS `WORLD/households.json` onto this clone whenever
  # the household mapping moved, before the fold runs — which is exactly what
  # :418-425 says two hundred lines below ("main may already be ahead of
  # origin/main at this line"). A register stamped `git rev-parse HEAD` would then
  # carry a sha one commit past `--world-sha`, the fold's equality check would
  # throw, and THE CROSSING WOULD PUBLISH NOTHING — intermittently, only on the
  # crossings that follow a household declaration.
  #
  # So the register is read AT `--world-sha` (`canon-register.mjs §
  # canonRegisterAtSha` materializes that commit's `WORLD/marks` and runs the
  # checkout's own loader over it). The equality is true by construction now, and
  # `foldDelta` keeps the check as the falsifier for the day something other than
  # the registry moves main before the fold. What is passed here is only the
  # clone that HOLDS the object; the sha decides what is read.
  #
  # WITH IT the fold carries every standing mark canon does not hold, beside its
  # own docket — the repair for a window cleared outside this script's timing
  # (2026-09-12: window 184 cleared by hand at 05:52Z, its two marks never folded
  # by the 17:45Z crossing, and nothing would ever have revisited them).
  if ! (cd "$OFFICE" && node "$OFFICE/world2/tools/fold-input-cli.mjs" \
        --world-sha "$WORLD_FROM" --town-clone "$TOWN" --town-sha "$TOWN_SHA" \
        --window "$DOCKET_WINDOW" --world-repo "$SWEEP") > "$FOLD_INPUT" 2>"$WORK/fold.err"; then
    report refused "the store could not answer this crossing: $(node -e 'const r=require(process.argv[1]);process.stdout.write(String(r.refused||"unknown")+" — "+String(r.detail||""))' "$FOLD_INPUT" 2>/dev/null || head -c 200 "$WORK/fold.err" | tr '\n"' ' .')"
    echo "[settlement-auto] STORE REFUSED — publishing nothing" >&2
    cat "$FOLD_INPUT" >&2 2>/dev/null || true; cat "$WORK/fold.err" >&2
    exit 1
  fi

  # The stakes come out of the same answer, in the shape the sweep already reads
  # (`settlement-sweep.mjs:232-243` accepts a bare array or `{stakes:[...]}`).
  node -e 'const fs=require("node:fs");const i=require(process.argv[1]);fs.writeFileSync(process.argv[2],JSON.stringify(i.stakes,null,1)+"\n")' \
    "$FOLD_INPUT" "$WORK/stakes.json"

  STORE_JSON="$WORK/store.json"
  if ! (cd "$OFFICE" && node "$OFFICE/src/store-writedown.mjs" \
        --input "$FOLD_INPUT" --world "$SWEEP") > "$STORE_JSON" 2>"$WORK/store.err"; then
    report refused "the store write-down refused: $(node -e 'const r=require(process.argv[1]);process.stdout.write(String(r.refused||"unknown")+" — "+String(r.detail||""))' "$STORE_JSON" 2>/dev/null || head -c 200 "$WORK/store.err" | tr '\n"' ' .')"
    echo "[settlement-auto] STORE WRITE-DOWN REFUSED — publishing nothing" >&2
    cat "$STORE_JSON" >&2 2>/dev/null || true; cat "$WORK/store.err" >&2
    exit 1
  fi
  echo "[settlement-auto] store: $(node -e 'const r=require(process.argv[1]);const a=r.as_of||{};const g=r.ingest||{};process.stdout.write(String(r.written||0)+" of "+String(r.marks||0)+" mark(s) written into "+String((r.households||[]).length)+" sketchbook(s) at window "+String(a.window)+" ("+String(r.unchanged_skipped||0)+" unchanged, not re-materialized)"+(function(c){return c&&c.checked?(c.count?"; CARRIED "+c.count+" canon-absent mark(s) from earlier window(s): "+c.slugs.join(", "):((c.skipped_no_household||[]).length?"; carried 0 of "+(c.count+(c.skipped_no_household||[]).length)+" canon-absent mark(s)":"; carried 0, canon complete at "+String(c.canon_sha||"?").slice(0,9)))+((c.skipped_no_household||[]).length?"; SKIPPED "+c.skipped_no_household.length+" canon-absent mark(s) with NO HOUSEHOLD (needs a person, not a crossing): "+c.skipped_no_household.join(", "):""):"; CARRY NOT CHECKED (no --world-repo)";})(((r.selection||{}).carried_absent)||null)+"; escrow ingested at town "+String(g.storeSha||"?").slice(0,9)+" ("+String(g.reason||"?")+(Number.isFinite(g.behind)?", behind "+g.behind:"")+"); cleared "+String((r.sketchbooks_cleared||{}).removed_remote||0)+" origin + "+String((r.sketchbooks_cleared||{}).removed_local||0)+" local git-era draft ref(s)")' "$STORE_JSON")" >&2
  # THE FRAMER'S ROWS, SHOUTED. A world-framed record carried into a nested
  # frozen filing is re-expressed in that filing's frame by the drain's one
  # framer (postmark#2865, the third bite, 2026-09-18: without it Berthillon's
  # image-only amend moved the shop 54 m under a green suite). Every such row is
  # named here with both numbers, so the keeper can check the carriage against
  # the fold's placement rather than discover it in the tier falsifier.
  if [ "$(node -e 'const r=require(process.argv[1]);process.stdout.write(String(((r.framed||[]).length) > 0))' "$STORE_JSON" 2>/dev/null)" = "true" ]; then
    echo "[settlement-auto] FRAMED $(node -e 'const r=require(process.argv[1]);const f=r.framed||[];process.stdout.write(f.length+" world-framed record(s) at nested filing(s): "+f.map((x)=>x.id+" "+JSON.stringify(x.from.at)+" -> "+JSON.stringify(x.to.at)).join("; "))' "$STORE_JSON")" >&2
  fi
  # THE INGEST DISTANCE, SHOUTED WHEN IT IS NOT ZERO. The crossing is lawful and
  # publishes: its escrow is honestly as-of the ingested sha. But an ingest that
  # quietly stopped is the starving-crossing shape one layer up, and a receipt
  # nobody reads until the round is twelve hours away.
  if [ "$(node -e 'const r=require(process.argv[1]);const g=r.ingest||{};process.stdout.write(String(Number(g.behind||0) > 0))' "$STORE_JSON" 2>/dev/null)" = "true" ]; then
    echo "[settlement-auto] ESCROW INGEST IS BEHIND THE TOWN by $(node -e 'const r=require(process.argv[1]);process.stdout.write(String((r.ingest||{}).behind))' "$STORE_JSON") commit(s) — this crossing's stakes are as-of the ingested sha, which is lawful; a distance that GROWS across crossings is an ingest that has stopped" >&2
  fi
  # A REHEARSAL SHOUTS. It is already on the receipt and in the history file; this
  # is the line the operator watching the run sees, and it is deliberately not
  # conditional on a quiet flag — the one time this matters is the time somebody
  # ran a rehearsal instrument against something they thought was a scratch.
  if [ "$(node -e 'const r=require(process.argv[1]);process.stdout.write(String(r.rehearsal===true))' "$STORE_JSON" 2>/dev/null)" = "true" ]; then
    echo "[settlement-auto] *** REHEARSAL *** this crossing folded from a rehearsal instrument, NOT from the register's entry point — nothing it publishes is canon" >&2
  fi
else
  # Stakes, derived at the pinned town read (k and law dials from the town's own files).
  (cd "$WORK/town" && node tools/world-stake.mjs --escrow --json) > "$WORK/stakes.json"
fi

# THE PRE-SWEEP REFS, recorded because they cannot be recovered afterwards: the
# sweep rebases every draft branch onto the main it just wrote, so once it has
# run there is no way to ask "what did the sketchbooks hold when this crossing
# started". The isolation pass below has to re-run the crossing to find out whose
# mark reddened the gate, and a re-run from the post-sweep refs would find no
# candidates and confidently report that nothing was wrong.
{
  printf '{"main":"%s","branches":{' "$(git -C "$SWEEP" rev-parse main)"
  git -C "$SWEEP" for-each-ref --format='%(refname:short) %(objectname)' 'refs/heads/draft/*' |
    awk 'NR>1{printf ","}{printf "\"%s\":\"%s\"", $1, $2}'
  printf '}}\n'
} > "$WORK/before.json"

# The sweep: publishes eligible drafts into local main, rebases local
# sketchbooks. It never pushes — publication is gated below.
SWEEP_JSON="$WORK/sweep.json"
# `--town-sha` is the OTHER HALF of the registry refresh, and it is what makes the
# refresh a construction rather than a habit (founder, 2026-09-09: "please make
# sure this incident cannot happen again by construction"). The step above
# re-derives the registry; this makes the world REFUSE to fold one derived from
# any town but the one this crossing pinned — including an unstamped one, which
# is the 2026-08-07 file exactly. Without it the refresh is a thing that usually
# runs, and "usually" is what thirty-three days of staleness looked like from
# inside.
#
# NOT passed to tools/settlement-isolate.mjs below, and that is sound rather than
# an omission: the isolation pass only runs after this sweep has SUCCEEDED, so
# the registry it would re-check has already been checked, on this same tree, by
# this same line.
# THE FLAG AND ITS VALUE ARE TWO QUOTED WORDS, and that is a repair rather than
# a style. They were one variable expanded UNQUOTED so the shell would split it
# into two arguments — which works only while the value contains no space, and
# the value is a REASON. The first bypass reason anybody writes as a sentence
# would have split into three arguments and handed the world a flag with a
# truncated reason and two stray words after it. Quoted, the reason may say
# whatever an operator needs it to say.
#
# Neither is ever empty: every path above sets both. A falsifier holds the
# crossing to that, because a chain that stops stating anything about the
# registry is the regression this whole construction exists to catch.
(cd "$SWEEP" && node tools/settlement-sweep.mjs --stakes "$WORK/stakes.json" "$REGISTRY_FLAG" "$REGISTRY_ARG" --json) > "$SWEEP_JSON" 2>"$WORK/sweep.err" || {
  # THE STARVING CROSSING has its own status, because "refused" is what a
  # crossing says when the record is wrong and this is what it says when the
  # crossing itself is broken — an operator must be able to tell them apart at
  # a glance in the receipt.
  if grep -q "SETTLEMENT-SWEEP-STARVING" "$WORK/sweep.err"; then
    report starving "$(grep -h "SETTLEMENT-SWEEP-STARVING" "$WORK/sweep.err" | head -c 400 | tr '\n"' ' .')"
    echo "[settlement-auto] STARVING CROSSING — the sweep found no candidates while sketchbooks hold escrow-backed marks" >&2
    cat "$WORK/sweep.err" >&2
    # A starving crossing is the 2026-08-26 shape — the one that "read as a quiet
    # day for two days" — so the third in a row gets the same escalation as a
    # third refusal. Asked here as well as below because this branch exits first
    # and the operator round is twelve hours away.
    if node "$OFFICE/deploy/settlement-history.mjs" --history "$HISTORY" --recurring 3 >/dev/null 2>&1; then
      echo "[settlement-auto] THIRD UNSETTLED CROSSING IN A ROW — escalating" >&2
      node "$OFFICE/deploy/settlement-escalate.mjs" --class recurring-refusal --receipt "$OUT" >&2 || true
    fi
    exit 1
  fi
  # ── WHOSE NIGHT IS THIS (v1 #4, 2026-08-30) ────────────────────────────────
  # The refusal used to reach the operator as {"cause": …, "phase":"unknown"} —
  # it named what tripped and never the one thing its reader needs at 3 AM: is
  # this mine to RERUN or mine to REPAIR. The classifier answers it by the one
  # fact that separates them — whether the file the lint REFUSED is in
  # origin/main's own tree (no rerun can ever clear it) or only in this
  # crossing's drained inputs (a repaired source reruns clean). It never
  # guesses: a lint message names the offending file AND the reference it is
  # held to, and the reference is in canon by construction, so a refusal whose
  # subject cannot be told from its reference comes back `unclassified` rather
  # than as advice that would send an operator to edit the wrong record.
  REFUSAL_JSON="$WORK/refusal.json"
  node "$OFFICE/deploy/settlement-classify.mjs" \
    --stderr "$WORK/sweep.err" --clone "$SWEEP" --ref origin/main > "$REFUSAL_JSON" 2>/dev/null \
    || REFUSAL_JSON=""
  report refused "sweep tripped: $(head -c 200 "$WORK/sweep.err" | tr '\n"' ' .')"
  echo "[settlement-auto] SWEEP TRIPPED" >&2; cat "$WORK/sweep.err" >&2
  if [ -n "$REFUSAL_JSON" ]; then
    echo "[settlement-auto] REFUSAL CLASS: $(node -e 'const r=require(process.argv[1]);process.stdout.write(r.class+" — "+r.next_step)' "$REFUSAL_JSON" 2>/dev/null || echo unclassified)" >&2
    # A canon-bad refusal is TERMINAL: nothing this box can do clears it, and the
    # next crossing composes the same red. That is the one case that must reach a
    # person rather than a log line nobody is watching at 02:39Z.
    if [ "$(node -e 'const r=require(process.argv[1]);process.stdout.write(String(r.class))' "$REFUSAL_JSON" 2>/dev/null)" = "canon-bad" ]; then
      node "$OFFICE/deploy/settlement-escalate.mjs" --class canon-bad --receipt "$OUT" >&2 || true
      RECURRING_ESCALATED=1
    fi
  fi
  # ── AND THE REFUSAL THAT SIMPLY KEEPS COMING BACK ─────────────────────────
  # A canon-bad refusal announces itself. The other terminal kind does not: from
  # 08-28 to 08-30 the same 2-error lint refusal returned every single crossing —
  # "every crossing since 08-28 re-drained them, dropped one, tripped on the
  # other" (postmark-world 7f866059) — and each one was individually rerunnable,
  # so nothing on the box ever called it terminal. Three in a row is terminal in
  # practice whatever the class says: what produces it is upstream of the rerun.
  #
  # It is asked HERE and not only on the operator round because the round runs at
  # 8:05 ET and the settlement crosses twice a day, so an evening refusal has no
  # round behind it until the next morning. The round's own skill file names this
  # gap and says the auto-issue is what covers it.
  if [ "${RECURRING_ESCALATED:-0}" != "1" ] \
     && node "$OFFICE/deploy/settlement-history.mjs" --history "$HISTORY" --recurring 3 >/dev/null 2>&1; then
    echo "[settlement-auto] THIRD UNSETTLED CROSSING IN A ROW — escalating" >&2
    node "$OFFICE/deploy/settlement-escalate.mjs" --class recurring-refusal --receipt "$OUT" >&2 || true
  fi
  exit 1
}

# The FULL grammar suite is the gate — the keeper's own final gate, verbatim.
#
# THE SUITE'S SCRATCH LIVES AND DIES WITH THIS RUN (founder-ruled 2026-09-01,
# the day the box filled). The world suite's older fixture helpers mkdtemp
# under the system TMPDIR and never remove what they made; this script runs
# that suite up to ten times per crossing (the isolate re-runs it per round).
# On 2026-09-01 /tmp held 9,207 fixture directories — 1,247 of them whole
# copies of WORLD/marks — 38G/38G used, 84% of inodes, and the office's
# rehydrate died on `mktemp: No space left on device`. $WORK is already
# trap-removed at EXIT, so pointing the suite's TMPDIR under it makes every
# run own its residue whether or not the tests ever learn to.
SUITE_TMP="$WORK/tmp"; mkdir -p "$SUITE_TMP"
ISOLATE_JSON=""
# ── THE HARM GATE (founder-ruled 2026-09-16) ─────────────────────────────────
#
#   "A failed settlement should be a crisis. Under that definition we face
#    crises almost every day. That's dangerous because that dilutes the urgency
#    of a real crisis."
#
# So the crossing REFUSES only for what it did to residents: a mark moved or
# lost with no act naming it, the sweep's word not matching the tree, a fold
# that ran stampless, two parcels on one ground. The world's own gate says
# which marks — `tools/harm-gate.mjs`, five data-shaped checks over the tree
# the sweep produced against $WORLD_BASE, reading $SWEEP_JSON as the declared
# acts; nothing in it compares today's world with August's, so nothing in it
# needs a hand list. A red names the marks, so the ISOLATION PASS that used to
# bisect a red suite has nothing left to attribute and is retired from this
# chain (its tool stays in the world for now; `isolated` stays null on the
# receipt). The grammar suite still runs — AFTER the push, as a checker, below.
#
# Until 2026-09-16 the suite WAS this gate, and the 17:45Z crossing that day
# refused on a test's ledger of an August path while every resident's mark
# stood exactly where it should. Two things exit 1 here: harm, named; and a
# gate that could not run — exit 2 from the tool (no report, no fold), or no
# tool at this world sha — which is never a pass.
HARM_JSON="$WORK/harm.json"
if [ ! -f "$SWEEP/tools/harm-gate.mjs" ]; then
  HARM_JSON=""
  report refused "the harm gate could not gate: world $(git -C "$SWEEP" rev-parse --short main 2>/dev/null) carries no tools/harm-gate.mjs — nothing measured, nothing published"
  echo "[settlement-auto] HARM GATE COULD NOT GATE (no tools/harm-gate.mjs at this world sha) — publishing nothing" >&2
  node "$OFFICE/deploy/settlement-escalate.mjs" --class harm --receipt "$OUT" >&2 || true
  exit 1
fi
if (cd "$SWEEP" && node tools/harm-gate.mjs --repo "$SWEEP" --sweep "$SWEEP_JSON" --base "$WORLD_BASE" --stakes "$WORK/stakes.json" --json) > "$HARM_JSON" 2>"$WORK/harm.err"; then
  echo "[settlement-auto] harm gate: NO HARM — $(node -e 'const r=require(process.argv[1]);process.stdout.write(r.checks.map(c=>c.name+(c.note?" ("+c.note+")":"")).join(" · "))' "$HARM_JSON" 2>/dev/null)" >&2
else
  HARM_RC=$?
  cat "$WORK/harm.err" >&2
  if [ "$HARM_RC" = "1" ] && [ -s "$HARM_JSON" ]; then
    report refused "HARM NAMED — $(node -e 'const r=require(process.argv[1]);process.stdout.write(r.checks.filter(c=>!c.ok).map(c=>c.name+": "+c.rows.slice(0,3).join("; ")+(c.count>3?" … and "+(c.count-3)+" more":"")).join(" | "))' "$HARM_JSON" 2>/dev/null || echo 'see the receipt')"
    echo "[settlement-auto] HARM NAMED — publishing nothing" >&2
  else
    HARM_JSON=""
    report refused "the harm gate could not gate: $(head -c 300 "$WORK/harm.err" | tr '\n"' ' .') — nothing measured, nothing published"
    echo "[settlement-auto] HARM GATE COULD NOT GATE — publishing nothing" >&2
  fi
  # A crisis reaches a person on the first occurrence (#2793's rule, kept).
  # `|| true`: a crossing is never failed by its own alarm; the refusal above is
  # already the finding.
  node "$OFFICE/deploy/settlement-escalate.mjs" --class harm --receipt "$OUT" >&2 || true
  exit 1
fi

# ── PUBLISHING MAIN, IN ONE PLACE ────────────────────────────────────────────
#
# A function, because there are now TWO crossings that push main and they are not
# the same crossing: the ordinary one, where the sweep published, and the one
# where the sweep published nothing and the household registry moved. Both need
# the cheap salvage and the race exit; a second copy of this block is how one of
# them quietly loses the salvage a year from now.
#
# THE CHEAP SALVAGE (founder, 2026-08-22, after S45 lost its push to a resident
# walking through doors mid-sweep: "can we just push whatever slightly stale
# version actually passed the settlement?"). The sweep's result is not stale
# about anything it WRITES — the usual racer is a door pen appending ledger
# lines, files the sweep never touches. So on a rejected push: fetch, and if
# every raced-in change touches only paths DISJOINT from the sweep's own
# writes, rebase the finished sweep onto the moved main and push once more.
# Any path overlap, any rebase conflict, any second rejection — the full
# rerun, exactly as before. The suite is deliberately NOT rerun on this path:
# that is the founder's ruling (the 28-minute sweep losing to a 5-second
# ledger line, twice, is the worse outcome), and the disjointness check is
# what makes it sound.
#
# `exit` inside a shell function exits the script, which is what the race branch
# means; and `WORLD_TO` assigned inside it is the script's own variable, which is
# what the salvage branch means. Both are POSIX and both are load-bearing.
publish_main() {
  git -C "$SWEEP" push -q origin main:main || {
    git -C "$SWEEP" fetch -q origin main
    MB="$(git -C "$SWEEP" merge-base main origin/main)"
    git -C "$SWEEP" diff --name-only "$MB" main | sort > "$WORK/swept-paths"
    git -C "$SWEEP" diff --name-only "$MB" origin/main | sort > "$WORK/raced-paths"
    if [ -s "$WORK/raced-paths" ] && [ -z "$(comm -12 "$WORK/swept-paths" "$WORK/raced-paths")" ] \
       && git -C "$SWEEP" rebase -q origin/main >/dev/null 2>&1 \
       && git -C "$SWEEP" push -q origin main:main; then
      echo "[settlement-auto] main raced by disjoint paths ($(tr '\n' ' ' < "$WORK/raced-paths")) — sweep rebased and pushed" >&2
      WORLD_TO="$(git -C "$SWEEP" rev-parse main)"   # the receipt names what actually landed
    else
      git -C "$SWEEP" rebase --abort >/dev/null 2>&1 || true
      report race "world main moved underneath the sweep — rerun"
      echo "[settlement-auto] RACE on main — rerun" >&2; exit 2
    fi
  }
}

WORLD_TO="$(git -C "$SWEEP" rev-parse main)"
# ── DID THE SWEEP PUBLISH ANYTHING — ASKED OF THE SWEEP, NOT OF MAIN ─────────
#
# This compared `main` against `origin/main`, and those were one question while
# the sweep was the only thing on this path that ever committed. The registry
# refresh commits before the fold, so on a crossing where a household joined and
# nothing settled, main is ahead of origin/main and the sweep published nothing.
#
# Comparing against `$WORLD_FROM` there would report `published` with six zero
# channels, and `deploy/settlement-history.mjs --recurring` reads exactly that
# word to answer "has this town settled in three days" — the 2026-08-26 starving
# crossing's own question. A registry refresh must never be able to answer it
# yes. So the test asks `$WORLD_BASE`: main AFTER the refresh and BEFORE the
# fold. A registry-only crossing stays `quiet`; it simply has something to push
# before it says so.
if [ "$WORLD_TO" = "$WORLD_BASE" ]; then
  if [ "$WORLD_BASE" != "$WORLD_FROM" ]; then
    publish_main
    WORLD_TO="$(git -C "$SWEEP" rev-parse main)"
    report quiet "nothing eligible; the household registry was refreshed and published; suite green at $WORLD_TO"
    echo "[settlement-auto] quiet pass, registry refreshed: $WORLD_FROM -> $WORLD_TO — $(node "$OFFICE/deploy/surveyed-reading.mjs" --echo --sweep "$SWEEP_JSON" --source "$SOURCE")"
    exit 0
  fi
  # THE QUIET PASS SAYS WHAT IT SURVEYED. "Nothing eligible" is a claim about
  # the record; without the survey beside it, it is indistinguishable from
  # "I looked at nothing", which is what the starving crossing actually was.
  #
  # AND IT SAYS WHOSE SKETCHBOOKS IT COUNTED (G1 lane 3, 2026-09-09). On the
  # store path `src/store-writedown.mjs` deletes every draft ref and then builds
  # one sketchbook per household before the sweep looks, so these counts are the
  # write-down's own output rather than a register of waiting work. The wording
  # lives in deploy/surveyed-reading.mjs, which the receipt's `surveyed_reading`
  # field also reads — the inline `node -e` that used to be here was the second
  # copy of a sentence, and two copies are how the operator's line and the
  # keeper's receipt drift apart. The git wording is unchanged to the byte.
  #
  # BOTH quiet exits read it, because this lane gave the quiet pass a second one:
  # a crossing where the sweep published nothing and the household registry did
  # move still pushes, and still reports `quiet`. Two exits, one sentence.
  report quiet "nothing eligible; suite green at $WORLD_FROM"
  echo "[settlement-auto] quiet pass — $(node "$OFFICE/deploy/surveyed-reading.mjs" --echo --sweep "$SWEEP_JSON" --source "$SOURCE")"
  exit 0
fi

# Publish: main strictly fast-forward; sketchbooks only under their leases.
publish_main
# THE SKETCHBOOK LEASES. In store mode `$WORK/tips` is empty by construction —
# nothing was fetched into it and nothing was delivered — so this loop is a
# no-op and no draft branch is pushed. That is stated here rather than left to
# be inferred from an empty file, because the emptiness is the whole safety
# argument and the next person to add a line inside this loop should know it
# runs for one mode only.
RACED=0
while read -r ref sha; do
  b="${ref#origin/}"
  git -C "$SWEEP" push -q --force-with-lease="refs/heads/$b:$sha" origin "$b" || {
    echo "[settlement-auto] lease refused on $b (door write mid-run) — rerun" >&2
    RACED=1
  }
done < "$WORK/tips"
[ "$RACED" = "1" ] && { report race "one or more sketchbook leases refused — rerun"; exit 2; }

# ── THE RETIRE STEP (G1 lane 1) ──────────────────────────────────────────────
#
# The store learns what the world let go. Until this step existed nothing in the
# live write path ever set `marks.status = 'retired'` — the column and its CHECK
# have been in 001_tables.sql since the first migration with no pen behind them,
# and the pre-cutover dump read 1,019 standing and 0 retired, ever. The store
# then held ground under neighbours the world had already released, and
# `standing-equality` reddened on the difference.
#
# AFTER THE PUSH, AND THAT PLACEMENT IS THE WHOLE CORRECTNESS ARGUMENT. Canon
# has not let a mark go until main is actually on origin. Retiring before the
# push would mean a raced or rejected push leaves the store having retired marks
# the world still carries — the same disagreement as today, pointing the other
# way, and harder to see because the receipt would claim it was handled. Placed
# here, a race exits above and the store is untouched.
#
# NOT FATAL TO A PUBLISHED CROSSING, and this is a deliberate asymmetry rather
# than a swallowed error. The world is already published at this line; refusing
# now would leave a receipt saying `refused` over a crossing that in fact landed
# canon, which is a worse lie than a named gap. So a refusal is LOUD — it shouts,
# it lands in the receipt as `ran: false` with its reason, and the keeper reads a
# crossing whose retirement is owed — but it does not retract a real publication.
# The step is idempotent, so the next crossing picks up what this one missed.
RETIRE_JSON=""
if [ "${SETTLEMENT_RETIRE:-1}" = "1" ] && [ -n "${WORLD2_CLEARING_URL:-}" ]; then
  RETIRE_JSON="$WORK/retire.json"
  if (cd "$OFFICE" && node "$OFFICE/world2/tools/retire-unpublished.mjs" \
        --sweep "$SWEEP_JSON") > "$RETIRE_JSON" 2>"$WORK/retire.err"; then
    echo "[settlement-auto] retired: $(node -e 'const r=require(process.argv[1]);process.stdout.write(String(r.count||0)+" mark(s) in the store"+((r.absent||[]).length?" ("+r.absent.length+" absent — the store never held them)":""))' "$RETIRE_JSON" 2>/dev/null || echo "?")" >&2
  else
    echo "[settlement-auto] RETIRE REFUSED — the world published but the store was not told; the next crossing retries" >&2
    cat "$WORK/retire.err" >&2
    node -e 'const fs=require("node:fs");fs.writeFileSync(process.argv[1],JSON.stringify({ran:false,reason:process.argv[2]},null,1)+"\n")' \
      "$RETIRE_JSON" "the retire step refused: $(head -c 200 "$WORK/retire.err" | tr '\n"' ' .')" 2>/dev/null || RETIRE_JSON=""
  fi
else
  # A named absence, not a silent one. `WORLD2_CLEARING_URL` unset is the state
  # of every box that has not been given the pen yet, and a crossing must be able
  # to say "I did not do this and here is why" rather than printing nothing.
  RETIRE_JSON="$WORK/retire.json"
  node -e 'const fs=require("node:fs");fs.writeFileSync(process.argv[1],JSON.stringify({ran:false,reason:process.argv[2]},null,1)+"\n")' \
    "$RETIRE_JSON" "$([ "${SETTLEMENT_RETIRE:-1}" = "1" ] && echo "WORLD2_CLEARING_URL is unset — the crossing holds no store pen" || echo "SETTLEMENT_RETIRE=0")" 2>/dev/null || RETIRE_JSON=""
fi

# ── THE GRAMMAR SUITE, AFTER THE PUSH, AS A CHECKER (founder-ruled 2026-09-16) ─
#
# Everything the harm gate does not ask — the tier falsifier's August ledger,
# the carve table, the region caution, the browser rigs, every hand list —
# still runs here, over the tree that just published. A red is a WARNING: it
# goes on the receipt (`suite.red`), it files an issue on the first occurrence
# (settlement-escalate.mjs `suite-warning`), and it holds nothing — the world is
# already on origin at this line, and the fix is a world pull request whose own
# CI runs the same suite. `test:candle` is still the runner (postmark#2790): the
# source pins stay on the pull request, where they always belonged.
SUITE_JSON="$WORK/suite.json"
if (cd "$SWEEP" && TMPDIR="$SUITE_TMP" TMP="$SUITE_TMP" TEMP="$SUITE_TMP" npm run test:candle --silent) > "$WORK/suite.log" 2>&1; then
  node -e 'const fs=require("node:fs");fs.writeFileSync(process.argv[1],JSON.stringify({ran:true,red:false,reds:[],reds_total:0,log:null},null,1)+"\n")' "$SUITE_JSON" 2>/dev/null || SUITE_JSON=""
  SUITE_WORD="suite green"
else
  cp "$WORK/suite.log" "$OFFICE/settlement-last-suite.log" 2>/dev/null || true
  node -e 'const fs=require("node:fs");const log=fs.readFileSync(process.argv[2],"utf8");const reds=log.split(/\r?\n/).filter((l)=>/^not ok\b/.test(l));fs.writeFileSync(process.argv[1],JSON.stringify({ran:true,red:true,reds:reds.slice(0,40),reds_total:reds.length,log:"settlement-last-suite.log"},null,1)+"\n")' "$SUITE_JSON" "$WORK/suite.log" 2>/dev/null || SUITE_JSON=""
  echo "[settlement-auto] SUITE WARNING — the town is published; the grammar suite went red after the push, and a person is told" >&2
  grep -E "^not ok" "$WORK/suite.log" >&2 || tail -40 "$WORK/suite.log" >&2
  SUITE_WORD="suite RED after the push — a warning, filed"
fi
report published "$(node -e 'const s=require(process.argv[1]);const n=(k)=>((s[k]||[]).length);process.stdout.write([n("published")+" published",n("unpublished")+" unpublished",n("left_drafted")+" left drafted",n("withdrawn")+" withdrawn",n("quarantined")+" quarantined",n("dropped")+" dropped"].join(", "))' "$SWEEP_JSON" 2>/dev/null || echo 'published')"
if [ -n "$SUITE_JSON" ] && [ "$(node -e 'const r=require(process.argv[1]);process.stdout.write(String(r.red===true))' "$SUITE_JSON" 2>/dev/null)" = "true" ]; then
  # after the receipt, so the issue quotes a receipt that says `published` with
  # `suite.red: true` — a warning over a crossing that landed, in its own words
  node "$OFFICE/deploy/settlement-escalate.mjs" --class suite-warning --receipt "$OUT" --suite-log "$WORK/suite.log" >&2 || true
fi
echo "[settlement-auto] published: $WORLD_FROM -> $WORLD_TO ($SUITE_WORD, leases held)"
exit 0
