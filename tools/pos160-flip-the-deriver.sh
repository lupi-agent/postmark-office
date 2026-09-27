#!/usr/bin/env bash
# pos160-flip-the-deriver.sh — POINT `householdKeyFor` BACK AT `identities`
# AND WATCH THE FALSIFIERS GO RED.
#
# A falsifier nobody has ever seen fail is a decoration. This is POS-160's
# can-fail probe: it puts the store's resolver back on the read it had before
# this lane — a single `SELECT household FROM identities WHERE handle = $1` —
# and asserts that the suites which claim the deriver answers actually notice.
#
# ── IT ASSERTS ITS OWN MATCH COUNT ──────────────────────────────────────────
#
# A flip that patches nothing runs green and proves the opposite of what it
# claims (the 2026-09-20 lesson). So every substitution is counted, the count is
# checked against what this script expects to find, and a zero exits 1 BEFORE
# any test runs. If the source moved under it, this says so instead of lying.
#
# ── THE RESTORE IS AN EXIT TRAP, AND IT IS NOT A GIT CHECKOUT ───────────────
#
# The file is copied aside and copied back, by this script, on every exit path
# including a Ctrl-C and a failing assertion. `git checkout` is not the restore:
# it would take whatever else is uncommitted in the tree with it.
#
#   bash tools/pos160-flip-the-deriver.sh
#
# Exit 0 = the flip patched what it expected AND the falsifiers went red, which
# is the receipt. Exit 1 = either the patch missed, or the suites passed with
# the deriver removed, which means they are not reading it.

set -uo pipefail
cd "$(dirname "$0")/.."

TARGET="src/world2-claims.mjs"
BACKUP="$(mktemp -t pos160-flip.XXXXXX)"
cp "$TARGET" "$BACKUP"
restore() { cp "$BACKUP" "$TARGET"; rm -f "$BACKUP"; }
trap restore EXIT INT TERM

echo "── POS-160 FLIP · the store's resolver goes back to \`identities\` ──"

# The patch, in node so the count is exact and the file's encoding survives.
node - "$TARGET" <<'PATCH' || exit 1
import { readFileSync, writeFileSync } from "node:fs";
const file = process.argv[2];
let s = readFileSync(file, "utf8");

const WAS = `  const { slug } = await houseOfVia(p, handle);
  if (!slug) return \`solo:\${handle}\`;
  const key = \`hh:\${slug}\`;
  householdKeys.set(handle, key);
  return key;`;

const NOW = `  const { rows } = await p.query("SELECT household FROM identities WHERE handle = $1", [handle]);
  const key = rows[0]?.household ?? null;
  if (key) householdKeys.set(handle, key);
  return key ?? \`solo:\${handle}\`;`;

const n = s.split(WAS).length - 1;
console.log(`   patch: ${n} site(s) matched (expected exactly 1)`);
if (n !== 1) {
  console.error("   FLIP REFUSED — the resolver's body is not where this script left it.");
  console.error("   Nothing was written. Re-read src/world2-claims.mjs § householdKeyFor.");
  process.exit(1);
}
writeFileSync(file, s.split(WAS).join(NOW));
console.log("   patched: householdKeyFor reads `identities` again");
PATCH

echo
echo "── the falsifiers, which MUST now go red ────────────────────────────"

RED=0
run() {
  local name="$1"; shift
  local out; out="$(mktemp -t pos160-flip-out.XXXXXX)"
  node --test "$@" > "$out" 2>&1
  local code=$?
  local fails; fails="$(grep -E '^# fail |^ℹ fail ' "$out" | grep -oE '[0-9]+$' | head -1)"
  if [ "$code" -ne 0 ]; then
    echo "   RED   ${name}  (${fails:-?} failing)"
    grep -E '^✖ ' "$out" | head -4 | sed 's/^/           /'
    RED=$((RED + 1))
  else
    echo "   GREEN ${name}  <- THE FALSIFIER DID NOT NOTICE"
  fi
  rm -f "$out"
}

run "world2-claims-household (four spellings, one key)" test/world2-claims-household.test.mjs

echo
if [ "$RED" -ge 1 ]; then
  echo "FLIP OK — ${RED} suite(s) went red with the deriver removed."
  echo "          The four-spellings claim is read by a test that can fail."
  exit 0
fi
echo "FLIP FAILED — every suite passed WITHOUT the deriver."
echo "              Nothing is holding the claim these tests are written about."
exit 1
