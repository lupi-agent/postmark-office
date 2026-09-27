#!/bin/sh
# office-rehydrate.sh — rebuild the office's two read indexes, office.db (the
# town) and world.db (the world at the newest blessing), and confirm the door
# picked the new office.db up. Nothing else: the pulls, the mint, the
# settlements row and the panes moved to deploy/office-keep.sh (POS-268,
# 2026-09-27), so this unit is exactly the part the sqlite retirement deletes.
#
# It MOVES nothing. It reads the clones office-keep.sh freshened two minutes
# earlier, taking the town lock only for the seconds a `git clone --local`
# snapshot needs (hydrate shells `git log`, so a bare archive won't do), and
# derives outside it however long the town's history makes that.
#
# THE TICK DOES NOT RESTART THE OFFICE (2026-08-11). It writes files and the
# office swaps its read handle in place; the last step is a receipt, not an act.
#
# Env (from /etc/postmark-office.env via the unit): TOWN_CLONE, WORLD_CLONE.
# Optional: OFFICE_DOOR (default http://127.0.0.1:4380 — the unit's --port).
# Cwd: /srv/postmark-office (the unit's WorkingDirectory).

set -eu

LOCK="${TOWN_LOCK:-/srv/postmark-office/town.lock}"
SNAP="$(mktemp -d /tmp/postmark-rehydrate.XXXXXX)"
trap 'rm -rf "$SNAP"' EXIT

# ── under the lock: the snapshot only (seconds) ──────────────────────────────
(
  flock -w 300 9
  git clone --local --quiet "$TOWN_CLONE" "$SNAP/town"
) 9>>"$LOCK"

# ── outside the lock: derive from the frozen snapshot (however long) ─────────
node src/hydrate.mjs --town "$SNAP/town" --db office.db.new
mv -f office.db.new office.db
# world.db rides the same unit — AT THE NEWEST BLESSING, never main (Keemin,
# 2026-09-18, postmark#2934: "shouldn't the bless override the tick?" — yes).
# The crossing commits its candidate to main and office-keep.sh's fetch carries it
# in within fifteen minutes; the keeper's `settlement/S<n>` tag is his
# judgment on it, and a refused crossing is never tagged. `--ref blessed`
# resolves the newest tag peeled to its commit (src/world-branches.mjs §
# blessed — the same resolution the fold serves, so store and fold agree), and
# the store stamps `as_of_settlement` / `candidate_ahead` for the doors. The
# fetch in office-keep.sh is what carries a fresh tag in (a plain fetch re-follows an
# annotated tag whose commit is already local — measured 2026-09-17). Never
# HEAD — the pen parks this clone on draft branches, and a draft-stamped store
# can never be eligible. Non-fatal: the office.db rebuild is never
# held hostage, and a stale-but-good world.db beats no world.db. Interim until
# the read flip (POS-104) takes standing from the clearing's lock.
( node src/world-hydrate.mjs --world "$WORLD_CLONE" --ref blessed --db world.db.new \
    && mv -f world.db.new world.db ) \
  || echo "[office-rehydrate] world hydrate FAILED (non-fatal) — world.db stays at its last good build" >&2

# ── the receipt: the door is serving what we just built ──────────────────────
# Non-fatal like the world hydrate above, and for the same reason:
# the tick's real work is on disk and correct by the time we get here. A door
# still answering the old sha is a FINDING an operator must see in the journal,
# not a cause to fail a tick that did its job. So this exits 0 either way and
# says loudly which way it went.
#
# The snapshot's HEAD is the exact string hydrate stamped as `as_of` (it runs
# `rev-parse HEAD` against this same frozen clone), so the comparison is a sha
# against itself — no tolerance, no "recent enough".
WANT="$(git -C "$SNAP/town" rev-parse HEAD)"
DOOR="${OFFICE_DOOR:-http://127.0.0.1:4380}"
DEADLINE=$(( $(date +%s) + 45 ))
GOT=""
while :; do
  GOT="$(curl -s -o /dev/null -D - "$DOOR/town" | tr -d '\r' | sed -n 's/^[Xx]-[Pp]ostmark-[Aa]s-[Oo]f: *//p')"
  if [ "$GOT" = "$WANT" ]; then break; fi
  if [ "$(date +%s)" -ge "$DEADLINE" ]; then break; fi
  sleep 2
done
if [ "$GOT" = "$WANT" ]; then
  echo "[office-rehydrate] door is serving $WANT — hot reload confirmed"
else
  echo "[office-rehydrate] STALE DOOR (non-fatal) — hydrated $WANT, but $DOOR/town still answers '${GOT:-<no as-of header>}' after 45s. The office has NOT picked up the new office.db: journalctl -u postmark-office -n 50. (A code deploy still restarts by hand: sudo systemctl restart postmark-office.)" >&2
fi
