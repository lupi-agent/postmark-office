#!/usr/bin/env bash
# tools/pos198-flip-the-instant.sh — bend the ONE thing POS-198 built and prove the falsifiers see it.
#
# THE BEND: `src/world.mjs § walkEntry` stops carrying `writtenAt`. That is the
# office exactly as it stood before this lane — the door still reads its clock
# once and still stamps `movements.at` from it, but the act no longer receives
# that string, so `world-journal.mjs § normalizeRow` falls back to its own clock
# and `acts.at` drifts again. It is the STOP, returned.
#
# The restore is an EXIT TRAP over a byte copy. Never a git checkout: this tree
# holds uncommitted work and a checkout would take it with the flip.
set -uo pipefail
cd "$(dirname "$0")/.."

TARGET="src/world.mjs"
BACKUP="$(mktemp -t pos198-world.XXXXXX)"
cp "$TARGET" "$BACKUP"
restore() { cp "$BACKUP" "$TARGET"; rm -f "$BACKUP"; echo "flip: restored $TARGET from the byte copy"; }
trap restore EXIT

NEEDLE='    writtenAt: writtenAt ?? undefined,'

# ── the match count, asserted BEFORE the patch ──────────────────────────────
# A flip that patches nothing runs green and proves nothing. This one counts its
# site, says the number, and exits 1 on zero.
COUNT=$(grep -c -F "$NEEDLE" "$TARGET")
echo "flip: match count for walkEntry's instant = $COUNT (want exactly 1)"
if [ "$COUNT" -ne 1 ]; then
  echo "FLIP REFUSED — the line this flip bends is not where it was; the bend would be a no-op."
  exit 1
fi

python -c "
import io
p = 'src/world.mjs'
needle = b'    writtenAt: writtenAt ?? undefined,\n'
alt    = b'    writtenAt: writtenAt ?? undefined,\r\n'
b = io.open(p, 'rb').read()
n = needle if needle in b else alt
assert b.count(n) == 1, 'the patch found %d sites, not 1' % b.count(n)
io.open(p, 'wb').write(b.replace(n, b''))
print('flip: applied, walkEntry no longer carries the declared instant')
" || { echo "FLIP REFUSED — the patch did not apply."; exit 1; }

export WORLD_CLONE="${WORLD_CLONE:-$PWD/world-clone}"

# ── the falsifiers, which must RED ──────────────────────────────────────────
node --test test/pos-198-the-walk-act-carries-its-instant.test.mjs > /tmp/pos198-flip-one-clock.log 2>&1
ONE_CLOCK=$?
node --test test/departures-written-from-the-store.test.mjs > /tmp/pos198-flip-equality.log 2>&1
EQUALITY=$?

echo "flip: the one-clock falsifier exited $ONE_CLOCK (want non-zero)"
echo "flip: POS-196's equality suite exited $EQUALITY (want non-zero)"
grep -E "^ℹ (tests|pass|fail)" /tmp/pos198-flip-one-clock.log | sed 's/^/  one-clock  /'
grep -E "^ℹ (tests|pass|fail)" /tmp/pos198-flip-equality.log | sed 's/^/  equality   /'
echo "flip: the reds, by name —"
grep -E "^✖ " /tmp/pos198-flip-one-clock.log /tmp/pos198-flip-equality.log | sed 's/^/  /'

if [ "$ONE_CLOCK" -ne 0 ] && [ "$EQUALITY" -ne 0 ]; then
  echo "FLIP RED as required — the act stopped carrying the departure's instant and both falsifiers fired."
  exit 0
fi
echo "FLIP GREEN — a falsifier did not fire on the bend it exists to catch."
exit 1
