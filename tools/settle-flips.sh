#!/usr/bin/env bash
# settle-flips.sh — the settlement flips: put an older settlement law back and
# prove the falsifiers that claim the current one actually go red.
#
# Named for the FEATURE, not for the row that introduced it (the office's own
# precedent: tools/arena-flips.mjs, tools/birthday-flips.mjs). A flip named for
# a ticket is an orphan the week that ticket closes — nobody remembers what it
# guards, and nobody dares delete it. Its companion is
# tools/settle-anchored-berths.mjs, and a second settlement law that ever wants
# a flip belongs in THIS file as another case rather than a new one beside it.
#
# CASE 1 — SETTLE-AT-THE-DOOR (the law Keemin ruled 2026-09-21).
#
# THE CLAIM UNDER TEST IS THAT THE PROBES CAN FAIL. A suite that goes green
# against both the old law and the new one has not measured the change; it has
# measured that the process exits 0. So this puts the OLD behaviour back — the
# door writes no white-pages file and queues the settlement for a crossing —
# and asserts the new probes go RED.
#
# THE PATCH ASSERTS ITS OWN MATCH COUNT AND EXITS 1 ON ZERO. A flip that patches
# nothing runs green and reads exactly like a flip that proved something.
#
# THE RESTORE IS AN EXIT TRAP, so an interrupted run still puts the tree back,
# and it restores from a SAVED COPY rather than `git checkout` — the tree may
# hold work that is not committed, and a checkout would take it with the flip.
#
#   bash tools/settle-flips.sh
#
# Exit 0 = the flip reddened the falsifiers (the probes are real).
# Exit 1 = the patch matched nothing, or the suite stayed GREEN under the old
#          law, which means the probes do not measure what they claim.

set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

TARGET="src/declare.mjs"
SAVE="$(mktemp -t settle-flips-save.XXXXXX)"
OUT="$(mktemp -t settle-flips-out.XXXXXX)"

cp "$TARGET" "$SAVE"
restore() { cp "$SAVE" "$TARGET"; rm -f "$SAVE"; echo "[flip] restored $TARGET"; }
trap restore EXIT INT TERM

# ── the flip: settle nobody at the door, exactly as before POS-178 ───────────
python - "$TARGET" <<'PY'
import io, sys
p = sys.argv[1]
s = io.open(p, encoding="utf-8", newline="").read()
old = "  const settles = anchored && gangwayOpen;"
n = s.count(old)
print(f"[flip] matches for the settle decision: {n}")
if n != 1:
    sys.exit(1)
s = s.replace(old, "  const settles = false; // FLIPPED: the pre-POS-178 law — the crossing settles, never the door")
io.open(p, "w", encoding="utf-8", newline="").write(s)
print("[flip] patched")
PY
if [ $? -ne 0 ]; then
  echo "[flip] REFUSED: the patch matched nothing — the flip would have proved nothing" >&2
  exit 1
fi

node --check "$TARGET" || { echo "[flip] patched file does not parse" >&2; exit 1; }

# ── the falsifiers, which must now be RED ────────────────────────────────────
export WORLD_CLONE="${WORLD_CLONE:-$PWD/world-clone}"
export TOWN_CLONE="${TOWN_CLONE:-$PWD/town-clone}"

node --test --test-timeout=180000 test/declare.test.mjs > "$OUT" 2>&1
STATUS=$?

FAILED=$(grep -c "^# fail [1-9]\|^ℹ fail [1-9]" "$OUT")
echo "[flip] suite exit=$STATUS"
grep -E "^ℹ (pass|fail)" "$OUT" || true
echo "[flip] falsifiers that went red under the old law:"
grep "^✖" "$OUT" | sort -u | head -20

rm -f "$OUT"

if [ "$STATUS" -eq 0 ]; then
  echo "[flip] FAILED: the suite stayed GREEN with the door settling nobody." >&2
  echo "[flip] The probes do not measure the change they claim to measure." >&2
  exit 1
fi

echo "[flip] OK — restoring the new law is the only way this suite goes green."
exit 0
