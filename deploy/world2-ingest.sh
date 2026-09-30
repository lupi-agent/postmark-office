#!/bin/bash
# world2-ingest.sh — the two projection pens on a poll.
#
#   law-ingest    world-law repo -> law_projection + identities
#   stamp-ingest  town repo      -> stamp_projection
#
# ── WHY A POLL AT ALL, AND WHAT A DEAD ONE COSTS ────────────────────────────
# world2/tools/README.md is explicit that on-merge is the shape and the poll is
# the fallback, and equally explicit about the blast radius, verbatim:
#
#   "A dead webhook degrades only the door's advisory sufficiency read — never
#    a clearing."
#
# That sentence is what makes 15 minutes an acceptable number rather than a
# guess. The doors read these projections to tell a resident whether they have
# the stamps for a stake BEFORE they commit to one; fifteen minutes of
# staleness there is a slightly-behind answer to an advisory question. The
# authoritative read happens at the candle, where the clearing does the town
# ingest itself and REFUSES on a null law pin. Nothing this timer can do wrong
# reaches an outcome.
#
# ── ONE UNIT, TWO PENS — AND WHY THAT STOPPED BEING TRUE (2026-09-19) ───────
# This file used to argue that the two pens belong on one unit: shared cadence,
# shared blast radius, and splitting them would be "structure bought before the
# pain (keep-simple)". The pain arrived, and it was not the one that paragraph
# was watching for.
#
# On 2026-08-31 the founder parked `postmark-world2-ingest.timer` — for a reason
# about the world's OUTCOMES (acts, claims, marks): a re-lift from git "would
# launder v1's record into v2's and destroy the writer comparison the shadow era
# exists to make". Neither pen here writes an outcome. They copy the rulebook and
# the ledger, repo-first inputs the store may not author. But the park took the
# whole unit, and `law-ingest` is the ONLY writer of `law_projection` anywhere in
# the office, so the law copy simply stopped: `a23a8d17` (2026-09-05) until one
# hand-run on 2026-09-17 set it to `1688a5af`, then frozen again — 37 commits
# behind world main by 2026-09-19 (postmark#2893).
#
# The designed alarm could not fire either. The paragraph below still says a dead
# law pen "shows up as the clearing refusing" on a NULL pin — true, and the final
# pass of 09-05 wrote a VALID pin. A frozen non-null pin is never null, so the
# guard that was supposed to be the louder alarm never made a sound. That is the
# real cost of one unit: the town could not park one pen without parking both,
# and the one it did not mean to park was the one with no second watcher.
#
# RULED (Keemin, 2026-09-19): "split for now is good." The law pen gets its own
# unit and its own clock — `postmark-world2-law-ingest.{service,timer}`, `law`
# mode, the same :04/:19/:34/:49 marks. The parked unit and its files are
# UNTOUCHED, and `stamp-ingest` stays parked with it.
#
# There is still only ONE copy of each pen, and this is still the only script
# that runs them. The mode argument is the whole of the split.
#
# The law pen is the one with teeth, and not because of this timer: a null
# world-law pin is the guard that STOPS a clearing. That guard is real and it is
# not a freshness check — see above for the case it cannot see.

set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/world2-lib.sh"

# ── MODE ────────────────────────────────────────────────────────────────────
# No argument is today's behaviour, byte-for-byte: both pens, `ingest.json`.
#
# EACH MODE WRITES ITS OWN STATE FILE, and that is not tidiness. A heartbeat is
# an instrument, and it has to be able to say which thing it measured: if the
# law unit and the (parked, one day maybe resumed) both-pens unit wrote one
# path, the law row's heartbeat would go green on a run that was not its own,
# two units would race on the same `mv -f`, and every law tick would overwrite
# the parked rail's last receipt — the 2026-09-17 hand-run evidence that its
# stamp pen exited 0. A pen that did not run gets NO LINE in the state, rather
# than a zero-exit line that reads like a receipt.
#
# Nothing in this repo reads any of these files today (`grep -rn ingest.json`:
# this script and one DEPLOY.md sentence). The law file's first reader is the
# roll-call row this change adds.
case "${1:-both}" in
  law)    MODE=law;    RUN_LAW=1; RUN_STAMPS=0; RUN_BLESSED=1; STATE=ingest-law.json ;;
  stamps) MODE=stamps; RUN_LAW=0; RUN_STAMPS=1; RUN_BLESSED=0; STATE=ingest-stamps.json ;;
  both)   MODE=both;   RUN_LAW=1; RUN_STAMPS=1; RUN_BLESSED=0; STATE=ingest.json ;;
  *)      echo "usage: world2-ingest.sh [law|stamps|both]   (no argument = both)" >&2; exit 2 ;;
esac

# Both pens are `new pg.Client()` with no argument — PG*, not a URL
# (world2-lib.sh § two connection shapes). Both connect as the same role, so
# this guard is every mode's, not the law mode's.
if ! w2_pgenv law_ingester PG_LAW_INGESTER_PASSWORD; then
  w2_state "$STATE" "\"mode\":\"$MODE\",\"status\":\"cannot-run\",\"detail\":\"PG_LAW_INGESTER_PASSWORD unreadable\""
  exit 2
fi

run_pen() {                     # run_pen <world|town|world-blessed> <tool> <repo-flag> [extra flag]
  local which="$1" tool="$2" flag="$3" extra="${4:-}" dir="$WORLD2_LAB/ingest-clones/$1" sha out rc
  sha="$("$HERE/world2-refresh-clone.sh" "$which" 2>&1 | tail -n1)"
  if [ "${#sha}" -ne 40 ]; then
    echo "[world2-ingest] $which: checkout refresh failed — $sha" >&2
    PEN_RC=2; PEN_SHA=""; PEN_OUT="checkout refresh failed: $sha"
    return
  fi
  out="$(cd "$WORLD2_OFFICE" && node "world2/tools/$tool" "$flag" "$dir" --sha "$sha" ${extra:+"$extra"} 2>&1)"
  rc=$?                         # captured BEFORE anything pipes it
  echo "$out"
  PEN_RC=$rc; PEN_SHA=$sha; PEN_OUT=$out
}

# A pen that does not run in this mode contributes exit 0 and no line, so the
# STATUS ladder and the unit's exit code keep exactly the shape they had.
LAW_RC=0;  LAW_SHA="";  LAW_LINE="";  LAW_OUT=""
BLESSED_RC=0; BLESSED_SHA=""; BLESSED_LINE=""; BLESSED_OUT=""
TOWN_RC=0; TOWN_SHA=""; TOWN_LINE=""; TOWN_OUT=""

if [ "$RUN_LAW" -eq 1 ]; then
  run_pen world law-ingest.mjs --law-repo
  LAW_RC=$PEN_RC; LAW_SHA=$PEN_SHA; LAW_OUT=$PEN_OUT
  LAW_LINE="$(printf ',"law":{"exit":%d,"sha":"%s"}' "$LAW_RC" "$LAW_SHA")"
  [ "$LAW_RC" -ne 0 ] && echo "[world2-ingest] LAW INGEST FAILED (exit $LAW_RC)" >&2
fi

# ── THE BLESSED LAW (POS-270, 2026-09-27) ────────────────────────────────────
# The law mode ALSO ingests the rulebook at the newest blessing. The office's
# class reads ask law_projection at the newest settlements.tag_sha — "the bless
# overrides the tick" (Keemin, 2026-09-18, postmark#2934) — and main runs ahead
# of the tag between a crossing and its blessing. `--blessed` writes only that
# sha's law_projection rows: identities and projection_heads['world-law'] stay
# the main run's, so the clearing's pin never moves backwards. After the main
# run, so a failure here can never hold the clearing's rulebook hostage.
if [ "$RUN_BLESSED" -eq 1 ]; then
  run_pen world-blessed law-ingest.mjs --law-repo --blessed
  BLESSED_RC=$PEN_RC; BLESSED_SHA=$PEN_SHA; BLESSED_OUT=$PEN_OUT
  BLESSED_LINE="$(printf ',"law_blessed":{"exit":%d,"sha":"%s"}' "$BLESSED_RC" "$BLESSED_SHA")"
  [ "$BLESSED_RC" -ne 0 ] && echo "[world2-ingest] BLESSED LAW INGEST FAILED (exit $BLESSED_RC) — the office's class reads stay at the last blessed sha that was ingested" >&2
fi

if [ "$RUN_STAMPS" -eq 1 ]; then
  run_pen town stamp-ingest.mjs --town-repo
  TOWN_RC=$PEN_RC; TOWN_SHA=$PEN_SHA; TOWN_OUT=$PEN_OUT
  TOWN_LINE="$(printf ',"stamp":{"exit":%d,"sha":"%s"}' "$TOWN_RC" "$TOWN_SHA")"
  [ "$TOWN_RC" -ne 0 ] && echo "[world2-ingest] STAMP INGEST FAILED (exit $TOWN_RC)" >&2
fi

if   [ "$LAW_RC" -ne 0 ] && [ "$TOWN_RC" -ne 0 ]; then STATUS=both-failed
elif [ "$LAW_RC" -ne 0 ];                        then STATUS=law-failed
elif [ "$TOWN_RC" -ne 0 ];                       then STATUS=stamp-failed
elif [ "$BLESSED_RC" -ne 0 ];                    then STATUS=law-blessed-failed
else                                                  STATUS=ok
fi

DETAIL=""
if [ "$RUN_LAW" -eq 1 ]; then DETAIL="$(printf 'law: %s' "$LAW_OUT")"; fi
if [ "$RUN_BLESSED" -eq 1 ]; then DETAIL="$(printf '%s\nlaw_blessed: %s' "$DETAIL" "$BLESSED_OUT")"; fi
if [ "$RUN_STAMPS" -eq 1 ]; then
  if [ -n "$DETAIL" ]; then DETAIL="$(printf '%s\nstamp: %s' "$DETAIL" "$TOWN_OUT")"
  else                      DETAIL="$(printf 'stamp: %s' "$TOWN_OUT")"; fi
fi

w2_state "$STATE" "$(printf '"mode":"%s","status":"%s"%s%s,"detail":%s' \
  "$MODE" "$STATUS" "$LAW_LINE$BLESSED_LINE" "$TOWN_LINE" \
  "$(printf '%s' "$DETAIL" | w2_json_escape)")"

if [ "$LAW_RC" -ne 0 ] || [ "$TOWN_RC" -ne 0 ] || [ "$BLESSED_RC" -ne 0 ]; then exit 1; fi
case "$MODE" in
  law)    echo "[world2-ingest] ok — law $LAW_SHA / blessed $BLESSED_SHA" ;;
  stamps) echo "[world2-ingest] ok — town $TOWN_SHA" ;;
  both)   echo "[world2-ingest] ok — law $LAW_SHA / town $TOWN_SHA" ;;
esac
exit 0
