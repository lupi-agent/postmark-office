#!/usr/bin/env bash
# dev-office-carry.sh — carry a branch ref of postmark-office onto the DEV office
# by hand, step for step what .github/workflows/release-train.yml does for a
# release tag on prod (the office's dispatch lane deploys tags only; walking a
# train on dev.postmark.town's office is a hand-carry — auto-memory
# `dev-office-train-is-a-hand-carry`). Kept in the office repo (deploy/, moved from Wright-HQ/tools on 2026-09-27) so it is never
# lost with a session scratchpad again (the 09-01 one was).
#
#   bash deploy/dev-office-carry.sh origin/train/2026-w40
#
# What it does, in the workflow's order:
#   1. git archive <ref> from Wright's office clone → /tmp/wright-stage on the box
#   2. release.json into the stage {tag: <ref>, sha, target: dev, run: hand-carry}
#   3. deploy/remote-deploy.sh (from the clone's origin/main) → the box; preflight
#   4. rsync stage → /srv/postmark-office-dev: root files without --delete (the
#      root is shared with the box's own state: .env, clones), repo-owned dirs
#      with --delete (telemetry, .github, .omc excluded — the workflow's list)
#   5. remote-deploy.sh apply: stamp check, deps if the lockfile moved, restart,
#      the /release probe that only the new code passes, /town answers
set -euo pipefail

REF="${1:?ref required, e.g. origin/train/2026-w40}"
CLONE="${OFFICE_CLONE:-G:/Postmark/repo-clones/wright/office}"
BOX="${BOX:-meepo-ec2}"
ROOT="${DEV_ROOT:-/srv/postmark-office-dev}"
SERVICE="${DEV_SERVICE:-postmark-office-dev}"
PORT="${DEV_PORT:-4381}"
STAGE="/tmp/wright-stage"

cd "$CLONE"
git fetch -q origin
SHA="$(git rev-parse --short=7 "$REF")"
FULL="$(git rev-parse "$REF")"
TAG="${REF#origin/}"
echo "== carry $TAG @ $SHA ($FULL) -> $BOX:$ROOT ($SERVICE :$PORT) =="

# 1. the tree, from the ref, onto the box
git archive "$FULL" | ssh "$BOX" "rm -rf '$STAGE' && mkdir -p '$STAGE' && tar -x -C '$STAGE'"
echo "staged"

# 2. the receipt travels with the code
ssh "$BOX" "node -e '
  const { writeFileSync } = require(\"node:fs\");
  writeFileSync(\"$STAGE/release.json\", JSON.stringify({
    tag: \"$TAG\", sha: \"$SHA\", deployed_at: new Date().toISOString(), target: \"dev\",
    run: \"hand-carry by Wright \" + new Date().toISOString().slice(0, 10) + \" (G:/Wright-HQ/tools/dev-office-carry.sh)\"
  }, null, 2) + \"\\n\");
' && cat '$STAGE/release.json'"

# 3. the box-side script, from origin/main, and its preflight
REMOTE="/tmp/wright-remote-deploy.$$.sh"
git show origin/main:deploy/remote-deploy.sh | ssh "$BOX" "cat > '$REMOTE' && chmod +x '$REMOTE'"
ssh "$BOX" "'$REMOTE' preflight '$ROOT' '$SERVICE' '$PORT'"

# 4. the rsync, on the box, stage -> root (the workflow's two halves)
ssh "$BOX" "set -euo pipefail
  cd '$STAGE'
  echo '== root files (no --delete) =='
  rsync -a --exclude='/*/' '$STAGE/' '$ROOT/'
  echo '== repo-owned directories (--delete) =='
  find '$STAGE' -maxdepth 1 -mindepth 1 -type d -printf '%f\n' | grep -vx -e telemetry -e .github -e .omc | sort | while read -r d; do
    [ -n \"\$d\" ] || continue
    echo \"-- \$d/\"
    rsync -a --delete '$STAGE/'\"\$d\"'/' '$ROOT/'\"\$d\"'/'
  done"

# 5. apply: stamp, deps, restart, probe
ssh "$BOX" "'$REMOTE' apply '$ROOT' '$SERVICE' '$PORT' '$TAG' '$SHA'; rm -f '$REMOTE'"
echo "== carried $TAG @ $SHA to dev =="
