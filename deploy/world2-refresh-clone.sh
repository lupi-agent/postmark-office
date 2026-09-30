#!/bin/bash
# world2-refresh-clone.sh — put a repo checkout at origin's tip, cheaply.
#
#   world2-refresh-clone.sh world|town|world-blessed
#
# `world-blessed` (POS-270, 2026-09-27) puts the world checkout at the NEWEST
# BLESSING instead of main: the highest-numbered `settlement/S<n>` tag on
# origin, peeled to its commit — the same tag `src/world-branches.mjs § blessed`
# serves the fold from and world.db was hydrated at. The office's class reads
# answer from law_projection at that sha ("the bless overrides the tick",
# Keemin 2026-09-18, postmark#2934), so the law pen ingests it too. Its own
# directory, so the main checkout never moves off main.
#
# ── THE MEASUREMENT THAT SHAPED THIS ────────────────────────────────────────
# world2/tools/README.md § Running them shows the pens' intended call:
#
#     # a fresh shallow clone per run, discarded after — the stateless contract
#     git clone --depth 1 --branch world-2 …/postmark-world.git /tmp/law
#     node world2/tools/law-ingest.mjs --law-repo /tmp/law --sha "$(…)"
#     rm -rf /tmp/law
#
# That is exactly right for a hand-run and exactly wrong for a 15-minute poll.
# Measured on the box, 2026-08-29:
#
#     world-2 clone  1.55s   19 MB
#     town clone     7.02s  306 MB
#
# At 96 runs a day that is ~31 GB of clone traffic and ~31 GB written to a disk
# with 11 GB free. The poll would have filled the box inside a week if the
# discard ever missed once.
#
# So the checkout PERSISTS and is re-derived from origin on every run:
# fetch --depth 1, hard reset to FETCH_HEAD, clean -fdx. What the stateless
# contract is protecting — that no run can inherit state from the last one, and
# that the sha a pen reports is origin's and not a local edit's — is preserved
# exactly, because reset+clean leaves nothing of the previous run behind. What
# is given up is only the re-download of bytes that did not change.
#
# The clean is not optional and it is not decoration: without it a file a pen
# wrote into the checkout would survive into the next run's derivation, and the
# sha would then describe a tree that is not the tree that was read.
#
# ── WHERE THE LAW LIVES, AND WHY THIS DEFAULT MOVED (2026-09-05) ────────────
# The world default was `world-2` from this file's first line, and `world-2` is
# where the law lived when it was written. It does not any more: the law moved
# to `main`, which today stands at a23a8d1 while `world-2` stands at cba817d —
# two different trees under one poll. The 09-05 re-ingest was run by hand as
# `W2_WORLD_BRANCH=main`, so the persisted checkout is on main's sha and its
# FETCH_HEAD names `branch 'main'`; nothing on the box pins the variable
# (`/etc/postmark-world2-dev.env` carries no W2_WORLD_BRANCH, the unit carries
# no inline Environment= and no drop-in), so the DEFAULT is the whole of the
# lane's branch policy. Leaving it at `world-2` meant the next automatic run
# would reset --hard the checkout back off the law, quietly, and the pens would
# go on reporting a sha — the wrong one. A default that disagrees with where
# the law lives is not a stale comment; it is the poll's actual behaviour.
#
# The env var still wins, unchanged, and that is deliberate: reading an OLD
# branch is a legitimate hand-run (a bisect, a comparison against the retired
# tree), and this line is a default, not a lock.

set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/world2-lib.sh"

case "${1:-}" in
  world) URL="https://github.com/postmark-town/postmark-world.git"; BRANCH="${W2_WORLD_BRANCH:-main}" ;;
  town)  URL="https://github.com/postmark-town/postmark.git";   BRANCH="${W2_TOWN_BRANCH:-main}" ;;
  world-blessed)
    URL="https://github.com/postmark-town/postmark-world.git"
    # The newest blessing by NUMBER, never by date: S10 sorts before S9 as text.
    # A peeled line (`^{}`) and its tag line name the same S<n>, so the sort -u
    # leaves one number per tag. No tag at all is a refusal, not a fall back to
    # main — a blessed read that is secretly main is the thing this mode exists
    # to prevent.
    N="$(git ls-remote --tags "$URL" 'refs/tags/settlement/S*' 2>/dev/null \
      | sed -n 's#^[0-9a-f]*[[:space:]]*refs/tags/settlement/S\([0-9][0-9]*\)\(^{}\)\{0,1\}$#\1#p' \
      | sort -un | tail -n1)"
    if [ -z "$N" ]; then echo "no settlement/S<n> tag on $URL — nothing is blessed" >&2; exit 2; fi
    BRANCH="settlement/S$N" ;;   # a tag NAME: clone --branch and fetch both take it, and reset peels it
  *) echo "usage: world2-refresh-clone.sh world|town|world-blessed" >&2; exit 2 ;;
esac

DIR="$WORLD2_LAB/ingest-clones/$1"
mkdir -p "$(dirname "$DIR")"

if [ ! -d "$DIR/.git" ]; then
  echo "[refresh-clone] first clone of $1 ($URL @ $BRANCH)"
  rm -rf "$DIR"
  git clone --quiet --depth 1 --branch "$BRANCH" "$URL" "$DIR" || exit 2
else
  git -C "$DIR" fetch --quiet --depth 1 origin "$BRANCH" || exit 2
  git -C "$DIR" reset --quiet --hard FETCH_HEAD || exit 2
  # -x reaches ignored files too, which is the point: an ignored artifact left
  # by a pen is still a file the next derivation would see.
  git -C "$DIR" clean -qfdx || exit 2
fi

git -C "$DIR" rev-parse HEAD
