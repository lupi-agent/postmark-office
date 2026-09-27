#!/bin/bash
# world2-marks-ingest.sh — the world repo's MARKS into the store, at each bless
# (POS-142, Keemin 2026-09-23: "the class fix goes — a marks ingest at every
# bless, then prod's fold flips to the store").
#
#   world2/tools/marks-ingest.mjs --world-repo <the office's world clone> --ref blessed
#
# ── THE BLESS IS THE TRIGGER; THE CLOCK ONLY NOTICES IT ─────────────────────
# The law pen (world2-ingest.sh law) ingests world MAIN on a clock. This pen
# ingests the newest `settlement/S<n>` tag — the keeper's judgment on a crossing
# — and nothing else: `--ref blessed` resolves it exactly as the fold serves it
# (src/world-branches.mjs § blessed), and a run whose head is already at that
# tag writes nothing and says so. So a fire between blessings is a no-op by
# construction, and the first fire after one ingests it. The tag reaches the
# office's clone on the office tick's fetch (office-tick.sh § settlements-on-
# tick, the same carry the `settlements` row follows), which is why the timer
# sits a few minutes after the tick's marks.
#
# ── WHICH CLONE, AND WHY IT IS SAFE TO READ WHILE THE TICK HOLDS ITS LOCK ───
# The ingest needs HISTORY — every row it writes names the commit that carried
# the file-side change — so it cannot use the depth-1 ingest clones the law pen
# refreshes. It reads the office's own world clone, and it reads it through
# throwaway `git clone --shared --no-checkout` copies: no checkout, no fetch, no
# worktree registration, nothing written into the clone. A tick that holds the
# lock and fetches is not disturbed; the worst a race costs is a run that
# resolves the previous tag and ingests it on the next fire.
#
# ── THE ROLE ────────────────────────────────────────────────────────────────
# An ingest INSERTs claims and writes marks (materialize.mjs, the one pen shape
# for marks), which 002_grants splits across office_api and clearing_job. The
# owner holds both, and is what backfill-register and replay-ingest connect as.
#
# Exit 0 ingested or nothing to ingest · 1 refused/failed (the receipt names
# why, in the state file) · 2 the lane could not run.

set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/world2-lib.sh"

STATE=ingest-marks.json
WORLD_REPO="${WORLD_CLONE:-$WORLD2_OFFICE/world-clone}"

if ! w2_pgenv world2_owner PG_WORLD2_OWNER_PASSWORD; then
  w2_state "$STATE" '"status":"cannot-run","detail":"PG_WORLD2_OWNER_PASSWORD unreadable"'
  exit 2
fi
if [ ! -d "$WORLD_REPO/.git" ]; then
  w2_state "$STATE" "$(printf '"status":"cannot-run","detail":%s' "$(printf 'no world clone at %s' "$WORLD_REPO" | w2_json_escape)")"
  exit 2
fi

OUT="$(cd "$WORLD2_OFFICE" && node world2/tools/marks-ingest.mjs --world-repo "$WORLD_REPO" --ref blessed 2>&1)"
RC=$?                           # captured BEFORE anything pipes it
echo "$OUT"

case "$RC" in
  0) STATUS=ok ;;
  1) STATUS=failed ;;
  *) STATUS=cannot-run ;;
esac
# The tool's last line is its machine receipt ({status, ref, adds, amends,
# retires, skipped, stops}); it is kept as a string so a crash's last line —
# which is not JSON — can never make the state file unreadable.
RECEIPT="$(printf '%s\n' "$OUT" | tail -n1)"
w2_state "$STATE" "$(printf '"status":"%s","exit":%d,"receipt":%s,"detail":%s' \
  "$STATUS" "$RC" "$(printf '%s' "$RECEIPT" | w2_json_escape)" "$(printf '%s' "$OUT" | w2_json_escape)")"

[ "$RC" -eq 0 ] && echo "[world2-marks-ingest] ok — $RECEIPT"
exit "$RC"
