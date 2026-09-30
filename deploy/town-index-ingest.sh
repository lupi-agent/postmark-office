#!/bin/bash
# town-index-ingest.sh — the town index's runner (POS-268): office.db's tables,
# kept in the store by world2/tools/town-index-ingest.mjs (the law_ingester pen).
#
# Each run: fetch the town, then for every crossing's seal between the index's
# head and origin/main, oldest first, check the seal out and ingest it with
# --snapshot (the law: a snapshot per clearing); then ingest origin/main itself as
# the delta. The tool never moves a checkout, so this script does, in a clone
# that belongs to this unit alone.
#
# ── ITS OWN CLONE, WITH HISTORY ──────────────────────────────────────────────
# $WORLD2_LAB/ingest-clones/town-index, a full clone. Not world2-refresh-clone's
# `town` clone: that one is `--depth 1`, and a delta is `git log head..sha`.
# Not the office's TOWN_CLONE either: this never takes the office's town lock.
#
# ── THE SEED IS A HAND STEP ──────────────────────────────────────────────────
# An index with no head exits 3 here and writes nothing. The seed (the one whole
# derivation) is run once by hand at install, as the runbook says:
#   node world2/tools/town-index-ingest.mjs --town-repo "$DIR" --sha "$(git -C "$DIR" rev-parse HEAD)" --seed
#
# Exit 0 ingested (or nothing new) · 1 the pen refused or failed (the reason is in
# $WORLD2_STATE_DIR/town-index.json) · 2 the lane could not run · 3 no head yet.

set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/world2-lib.sh"

STATE=town-index.json
TOOL="$WORLD2_OFFICE/world2/tools/town-index-ingest.mjs"
DIR="$WORLD2_LAB/ingest-clones/town-index"
URL="https://github.com/postmark-town/postmark.git"

if ! w2_pgenv law_ingester PG_LAW_INGESTER_PASSWORD; then
  w2_state "$STATE" '"status":"cannot-run","detail":"PG_LAW_INGESTER_PASSWORD unreadable"'
  exit 2
fi

if [ ! -d "$DIR/.git" ]; then
  mkdir -p "$(dirname "$DIR")"
  git clone --quiet "$URL" "$DIR" || { w2_state "$STATE" '"status":"cannot-run","detail":"first clone failed"'; exit 2; }
fi
git -C "$DIR" fetch --quiet origin main || { w2_state "$STATE" '"status":"cannot-run","detail":"fetch failed"'; exit 2; }
TARGET="$(git -C "$DIR" rev-parse origin/main)"

seals="$(cd "$WORLD2_OFFICE" && node "$TOOL" --town-repo "$DIR" --seals-to "$TARGET" 2>&1)"
rc=$?
if [ "$rc" -eq 3 ]; then
  echo "[town-index] no head yet — seed it by hand first (this script's header)" >&2
  w2_state "$STATE" '"status":"no-head","detail":"seed by hand first"'
  exit 3
elif [ "$rc" -ne 0 ]; then
  echo "[town-index] could not list the seals: $seals" >&2
  w2_state "$STATE" "\"status\":\"failed\",\"detail\":\"$(w2_json_escape "$seals")\""
  exit 1
fi

run() {                          # run <sha> [--snapshot]
  git -C "$DIR" checkout --quiet --detach "$1" && git -C "$DIR" clean -qfdx || return 2
  (cd "$WORLD2_OFFICE" && node "$TOOL" --town-repo "$DIR" --sha "$1" "${@:2}")
}

for seal in $seals; do
  if ! out="$(run "$seal" --snapshot 2>&1)"; then
    echo "[town-index] the crossing at $seal did not ingest: $out" >&2
    w2_state "$STATE" "\"status\":\"failed\",\"at_sha\":\"$seal\",\"detail\":\"$(w2_json_escape "$out")\""
    exit 1
  fi
  echo "[town-index] $out"
done

if ! out="$(run "$TARGET" 2>&1)"; then
  echo "[town-index] the delta to $TARGET did not ingest: $out" >&2
  w2_state "$STATE" "\"status\":\"failed\",\"at_sha\":\"$TARGET\",\"detail\":\"$(w2_json_escape "$out")\""
  exit 1
fi
echo "[town-index] $out"
w2_state "$STATE" "\"status\":\"ok\",\"sha\":\"$TARGET\",\"detail\":\"$(w2_json_escape "$out")\""
