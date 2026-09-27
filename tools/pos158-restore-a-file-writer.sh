#!/usr/bin/env bash
# pos158-restore-a-file-writer.sh — THE FLIP for `test/registry-no-file-writer.test.mjs`.
#
# It restores ONE real registry file writer to `src/declare.mjs` — the exact
# two file entries POS-158 deleted from `planDeclaration`'s file set — and then
# the no-file-writer suite must RED. If it stays green, that suite is watching
# nothing and the whole one-writer law is a comment.
#
#   bash tools/pos158-restore-a-file-writer.sh
#
# ── THE THREE RULES THIS FLIP OBEYS, AND WHY EACH ONE IS HERE ───────────────
#
# 1. IT ASSERTS ITS OWN MATCH COUNT AND EXITS 1 ON ZERO. A flip that patched
#    nothing runs green and reads exactly like a passing probe (HQ, 2026-09-20).
#    Every `sed` below is followed by a count, and a count that is not what this
#    script expects stops it before a single test is run.
# 2. THE RESTORE LIVES IN AN EXIT TRAP, so a failed assertion, a Ctrl-C or a
#    crashed test run still puts the tree back. A flip that leaves a writer
#    behind is worse than no flip.
# 3. IT NEVER USES `git checkout` TO RESTORE. The working tree may hold
#    uncommitted work — it does while this lane is open — and a checkout would
#    throw it away. The trap restores from a byte copy this script made.
#
# COMMIT BEFORE RUNNING THIS. It edits a tracked source file in place.

set -euo pipefail

cd "$(dirname "$0")/.."
TARGET="src/declare.mjs"
BACKUP="$(mktemp -t pos158-declare.XXXXXX)"

cp "$TARGET" "$BACKUP"
restore() {
  cp "$BACKUP" "$TARGET"
  rm -f "$BACKUP"
  echo "flip: ${TARGET} restored from the byte copy (no git checkout was used)"
}
trap restore EXIT INT TERM

# ── the patch ───────────────────────────────────────────────────────────────
#
# The anchor is the file set POS-158 left behind. Restoring the two entries
# under it puts back the writer verbatim, serializers and all.
ANCHOR='      ...(settles ? buildJoinFiles(card) : []),'

MATCHES=$(grep -c -F "$ANCHOR" "$TARGET" || true)
if [ "$MATCHES" -ne 1 ]; then
  echo "FLIP REFUSED: expected exactly 1 anchor line in ${TARGET}, found ${MATCHES}." >&2
  echo "  A flip that cannot find what it means to patch has patched nothing, and a" >&2
  echo "  run that patched nothing is green for the wrong reason. Fix the anchor." >&2
  exit 1
fi

python3 - "$TARGET" <<'PY'
import io, sys
p = sys.argv[1]
s = io.open(p, encoding="utf-8", newline="").read()
anchor = "      ...(settles ? buildJoinFiles(card) : []),\n"
assert s.count(anchor) == 1, "anchor count moved between the shell check and the patch"
restored = anchor + (
    "      { path: REGISTRY_PATH, content: serializeRegistry(next) },\n"
    "      { path: PINS_PATH, content: serializePins(nextPins) },\n"
)
s = s.replace(anchor, restored, 1)
# and the imports the restored writer needs, so this is a REAL writer and not a
# reference error that would red the suite for the wrong reason
old_import = '  slugFromName, houseForAccount, houseForName,\n} from "./residency.mjs";'
new_import = '  slugFromName, houseForAccount, houseForName, serializeRegistry, serializePins,\n} from "./residency.mjs";'
assert s.count(old_import) == 1, "import anchor count is not 1"
s = s.replace(old_import, new_import, 1)
io.open(p, "w", encoding="utf-8", newline="").write(s)
print("flip: restored 2 file entries and 2 serializer imports to", p)
PY

# The patch must be visible in the file, or the python step silently did nothing.
ADDED=$(grep -c -F 'content: serializeRegistry(next)' "$TARGET" || true)
if [ "$ADDED" -ne 1 ]; then
  echo "FLIP REFUSED: the writer is not in ${TARGET} after patching (found ${ADDED})." >&2
  exit 1
fi

node --check "$TARGET" || { echo "FLIP REFUSED: the patched file does not parse." >&2; exit 1; }

echo
echo "── the suite must now RED ───────────────────────────────────────────────"
set +e
node --test test/registry-no-file-writer.test.mjs
STATUS=$?
set -e

echo
if [ "$STATUS" -eq 0 ]; then
  echo "FLIP FAILED: a registry file writer is restored in ${TARGET} and"
  echo "test/registry-no-file-writer.test.mjs still passes. That suite is watching nothing."
  exit 1
fi

echo "FLIP PASSED: the suite redded with the writer restored (exit ${STATUS})."
echo "The one-writer law is watched by a probe that can fail."
