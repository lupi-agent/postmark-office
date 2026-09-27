#!/usr/bin/env bash
# postmark-dev-freshen.sh — the dev channel stands back on the SANDBOX SEED.
#
# RE-AIMED 2026-08-26 (founder-ruled): the dev instance's default state is no
# longer origin/main but the declared snapshot — the sandbox/seed tag PAIR
# (first pair: S47's certified town 830a6996 / world 52c281b8). Advance the
# default by retagging sandbox/seed in both repos. Cadence dropped 10min ->
# nightly so a day's rehearsal is never yanked mid-act; on-demand forget is
# ./sandbox-reset.sh (which also rebuilds the derived DBs and restarts).
#
# The dev office commits acts into its LOCAL clones only (TOWN_PUSH=0; the push
# URL is DISABLED by design). Those local acts are rehearsal, not record. This
# script wipes them and stands both clones back on origin/main, under the dev
# office's own town lock so it never races a pen mid-write. Runs from
# postmark-dev-freshen.timer every 10 minutes.
#
# The world-clone ALSO refreshes draft/* remote-tracking refs (pruned), because
# the signed-in draft-overlay lens reads them — main-only fetching left dev's
# draft lens frozen at clone time (found 2026-08-22, the sketchbook-clean pass).
# Remote-tracking refs only; no local branches, no working-tree change.
#
# Repo copy of record: postmark-office deploy/postmark-dev-freshen.sh
#
# FAILS LOUD (2026-09-22, POS-192). The `set -euo pipefail` above never reached
# the work: everything below runs in the `bash -c` child that flock starts, and
# a child shell does not inherit -e. So when 1,918 root-owned files under
# world-clone and town-clone refused `git reset` (Permission denied), the loop
# carried on, the echo printed "stood back", and the unit exited 0 for as long
# as nobody looked. The child now sets its own `-euo pipefail`: the first failed
# git ends it with git's own exit code, flock returns that code, and exec makes
# it this script's — so the unit reads failed, the roll-call's freshen row sees
# Result=exit-code, and the success line prints only after every step succeeded.
# `switch ... || true` stays tolerated on purpose: the reset after it is the
# stand-back, and it is the step that must not fail silently.
#
# POSTMARK_DEV_ROOT and POSTMARK_DEV_FLOCK exist for test/box-rollcall.test.mjs
# only; the unit sets neither, so the box runs the defaults below.
set -euo pipefail
DEV="${POSTMARK_DEV_ROOT:-/srv/postmark-office-dev}"
FLOCK="${POSTMARK_DEV_FLOCK:-/usr/bin/flock}"
exec "$FLOCK" -x -w 120 "$DEV/town.lock" bash -c '
  set -euo pipefail
  dev=$1
  for c in "$dev/world-clone" "$dev/town-clone"; do
    git -C "$c" fetch -q --tags --force origin
    git -C "$c" switch -q main 2>/dev/null || true
    git -C "$c" reset -q --hard refs/tags/sandbox/seed
  done
  git -C "$dev/world-clone" fetch -q --prune origin "+refs/heads/draft/*:refs/remotes/origin/draft/*"
  echo "dev clones stood back on sandbox/seed (+ world draft/* refs)"
' freshen "$DEV"
