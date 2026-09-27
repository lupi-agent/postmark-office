#!/usr/bin/env bash
# pos156-flip-the-insert.sh — G1's falsifier proof.
#
# Puts the general journal INSERT back into `appendJournal` and requires
# `test/g1-the-journal-write-goes.test.mjs` to RED. A deletion whose falsifier
# stays green under the undeletion is not measuring the deletion.
#
# It reds in TWO places by design, which is why the suite is a falsifier rather
# than a sentinel: the behavioural test sees a journal row appear behind a door
# that should write only the record, and the source pin sees a second
# `INSERT INTO journal` in a file that should carry exactly one.
#
# THE RESTORE LIVES IN AN EXIT TRAP, and it is never a git checkout: the tree
# carries this lane's own work and a checkout would take it with the flip.
set -uo pipefail
TREE="/g/Postmark/pool/office-4"
TARGET="$TREE/src/world-journal.mjs"
BACKUP="$(mktemp)"
cd "$TREE" || exit 2

cp "$TARGET" "$BACKUP"
restore() { cp "$BACKUP" "$TARGET"; rm -f "$BACKUP"; }
trap restore EXIT

# THE PATCH ASSERTS ITS MATCH COUNT. A flip that patches nothing runs green.
NEEDLE='  const row = normalizeRow(entry);'
COUNT=$(grep -c -F "$NEEDLE" "$TARGET")
echo "flip: match count for the normalize line = $COUNT (want exactly 3 — appendJournal, appendArenaRow, appendActFlipped)"
if [ "$COUNT" != "3" ]; then
  echo "FLIP REFUSED — the needle matched $COUNT times; a flip that patches nothing runs green"
  exit 1
fi

# Put the INSERT back, in `appendJournal` ONLY. `perl -0777` so the anchor can
# span lines: the first `normalizeRow` line after the function's own signature
# is the one inside `appendJournal`, and anchoring on the signature is what
# keeps the patch off the other two.
BEFORE=$(grep -c -F 'INSERT INTO journal' "$TARGET")
echo "flip: journal INSERTs before = $BEFORE (want exactly 1 — the arena's)"
[ "$BEFORE" = "1" ] || { echo "FLIP REFUSED — the tree does not hold the deletion this flip is proving"; exit 1; }

perl -0777 -pi -e 's/(export async function appendJournal\(db, entry = \{\}\) \{\n  const row = normalizeRow\(entry\);\n)/$1\n  \/\/ FLIPPED BY tools\/pos156-flip-the-insert.sh — the deletion, undone.\n  db.prepare(\n    `INSERT INTO journal (\$\{ROW_COLUMNS\}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(\n    row.crossing, row.actor, row.action, row.object,\n    row.at_anchor, row.at_dx, row.at_dy,\n    row.witnesses, row.class, row.payload, row.effect,\n    row.household, row.written_at);\n/s' "$TARGET"

AFTER=$(grep -c -F 'INSERT INTO journal' "$TARGET")
echo "flip: journal INSERTs after = $AFTER (want exactly 2)"
if [ "$AFTER" != "2" ]; then
  echo "FLIP REFUSED — the patch did not land ($AFTER INSERTs); nothing was proven"
  exit 1
fi
node --check "$TARGET" || { echo "FLIP REFUSED — the patched file does not parse"; exit 1; }

export WORLD_CLONE="$TREE/world-clone"
node --test "$TREE/test/g1-the-journal-write-goes.test.mjs" > "$TREE/.pos156-flip.out" 2>&1
RC=$?
echo "flip: the falsifier exited $RC (want non-zero)"
grep -E "^(✔|✖)" "$TREE/.pos156-flip.out" | sed 's/^/  /'
# node --test prints every failure twice (inline, then in the summary block),
# so the count comes from the tally line rather than from counting marks.
REDS=$(grep -E "^ℹ fail" "$TREE/.pos156-flip.out" | head -1 | grep -oE "[0-9]+")
rm -f "$TREE/.pos156-flip.out"

if [ "$RC" -eq 0 ]; then
  echo "FLIP GREEN — the falsifier did not notice the journal INSERT coming back. It is not measuring the deletion."
  exit 1
fi
echo "flip: $REDS test(s) red — the behavioural half and the source pin both fired"
echo "FLIP RED as required — G1's falsifier fires when the deletion is undone."
exit 0
