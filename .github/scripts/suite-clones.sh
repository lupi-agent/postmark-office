#!/usr/bin/env bash
# suite-clones.sh — fetch the town and world checkouts the office suite reads,
# at the shas test/clone-pins.json names (POS-417). Workflow machinery for
# .github/workflows/suite.yml.
#
#   bash .github/scripts/suite-clones.sh            # → ./town-clone, ./world-clone
#   bash .github/scripts/suite-clones.sh --check    # assert both sit at their pins, fetch nothing
#
# A PIN IS EVERY REF A TEST CAN READ, NOT ONLY HEAD. Office pool trees pinned
# HEAD and still disagreed: one held settlement tags to S75, another to S85, and
# a tag-reading test was red in one tree only. So here HEAD is detached at the
# pin, `origin/main` is set to the pin (the office reads `mainRef()`, which
# falls back to origin/main in a clone with no local main), and every tag that
# is not an ancestor of the pin is deleted: the clone is the repo as it stood.
# Other branches are not fetched at all.
set -euo pipefail

PINS=test/clone-pins.json
pin() { node -e 'const p=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write(p[process.argv[2]][process.argv[3]])' "$PINS" "$1" "$2"; }

check() {
  local dir=$1 sha=$2
  [ -d "$dir/.git" ] || { echo "::error::$dir is not a checkout"; return 1; }
  local head main
  head=$(git -C "$dir" rev-parse HEAD)
  main=$(git -C "$dir" rev-parse refs/remotes/origin/main)
  [ "$head" = "$sha" ] || { echo "::error::$dir HEAD is $head, the pin is $sha"; return 1; }
  [ "$main" = "$sha" ] || { echo "::error::$dir origin/main is $main, the pin is $sha"; return 1; }
  local newer
  newer=$(git -C "$dir" tag --no-merged "$sha" | head -3)
  [ -z "$newer" ] || { echo "::error::$dir holds tags newer than its pin: $newer"; return 1; }
  echo "$dir at $sha · $(git -C "$dir" tag | wc -l) tags · $(git -C "$dir" rev-list --count HEAD) commits"
}

fetch() {
  local dir=$1 url=$2 sha=$3
  # never over a checkout someone keeps: a pool tree's clones are not this script's
  [ ! -e "$dir" ] || { echo "::error::$dir already exists; this fetches only into an empty place"; return 1; }
  git init -q "$dir"
  git -C "$dir" remote add origin "$url"
  git -C "$dir" fetch -q --tags origin "+refs/heads/main:refs/remotes/origin/main"
  if ! git -C "$dir" cat-file -e "$sha^{commit}" 2>/dev/null; then
    # a pin off main's history (a hotfix branch, say) is fetched by its sha
    git -C "$dir" fetch -q origin "$sha"
  fi
  git -C "$dir" -c advice.detachedHead=false checkout -q --detach "$sha"
  git -C "$dir" update-ref refs/remotes/origin/main "$sha"
  git -C "$dir" tag --no-merged "$sha" | xargs -r git -C "$dir" tag -d > /dev/null
}

if [ "${1:-}" = "--check" ]; then
  check town-clone "$(pin town sha)"
  check world-clone "$(pin world sha)"
  exit 0
fi

fetch town-clone "$(pin town repo)" "$(pin town sha)"
fetch world-clone "$(pin world repo)" "$(pin world sha)"
check town-clone "$(pin town sha)"
check world-clone "$(pin world sha)"
