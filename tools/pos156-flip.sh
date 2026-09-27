#!/usr/bin/env bash
# pos156-flip.sh — THE FLIP: is the probe's journal assertion load-bearing?
#
# The brief's flip is "restore the INSERT at world-journal.mjs:317 and assert the
# 'no journal row' falsifier reds". That flip has no subject in this PR, because
# the INSERT was never removed — finding 1's gate is shut (three STOPs).
#
# So the flip is run against what DID ship. `tools/g1-dev-proof.mjs` carries the
# "no journal row" assertion, and `test/g1-dev-proof.test.mjs` is the falsifier
# that watches it. Break the assertion — make the journal half always pass — and
# the falsifier must red. If it stays green, the assertion is decoration and the
# probe would have waved a still-writing office through on the one night it
# mattered.
#
# Run from the repo root. It patches ONE line, asserts the match count, runs the
# falsifier, and restores from an EXIT trap so a failure anywhere still leaves
# the tree clean.

set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET="$ROOT/tools/g1-dev-proof.mjs"
BACKUP="$(mktemp -t pos156-flip.XXXXXX)"

cp "$TARGET" "$BACKUP"
# THE RESTORE IS THE TRAP, not a line at the bottom: a `set -u` abort, a failing
# node, a Ctrl-C — all three must put the file back.
trap 'cp "$BACKUP" "$TARGET"; rm -f "$BACKUP"; echo "[flip] restored $TARGET"' EXIT

# ── the patch, with its match count asserted ────────────────────────────────
#
# A flip that patches nothing runs green. So: count the matches, refuse on zero
# or on anything but one, and only then write.
NEEDLE='  const journalOk = EXPECT_JOURNAL ? true : !jm.moved;'
COUNT=$(grep -c -F "$NEEDLE" "$TARGET")
if [ "$COUNT" != "1" ]; then
  echo "[flip] REFUSED — expected exactly 1 match for the journal assertion, found $COUNT"
  exit 1
fi
echo "[flip] match count: $COUNT (asserted)"

python - "$TARGET" <<'PY'
import io, sys
p = sys.argv[1]
s = io.open(p, encoding="utf-8", newline="").read()
old = "  const journalOk = EXPECT_JOURNAL ? true : !jm.moved;"
new = "  const journalOk = true; // FLIPPED: the journal half no longer asserts anything"
assert s.count(old) == 1
io.open(p, "w", encoding="utf-8", newline="").write(s.replace(old, new))
print("[flip] journal assertion disabled")
PY

# ── the falsifier must now RED ──────────────────────────────────────────────
echo "[flip] running test/g1-dev-proof.test.mjs against the broken assertion"
if node --test "$ROOT/test/g1-dev-proof.test.mjs" > /dev/null 2>&1; then
  echo "[flip] ✖ FAILED — the falsifier stayed GREEN with the journal assertion removed."
  echo "[flip]   The assertion is decoration: the probe would pass an office that still writes."
  exit 1
fi

echo "[flip] ✔ the falsifier REDS with the journal assertion removed — it is load-bearing"
exit 0
