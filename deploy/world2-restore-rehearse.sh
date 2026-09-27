#!/bin/bash
# world2-restore-rehearse.sh — A BACKUP WITHOUT A REHEARSED RESTORE IS A HOPE.
#
# Restores the newest shipped dump into a scratch database, checks the restored
# store against the live one, and drops the scratch. Prints a receipt: commands,
# duration, and the row counts that matched.
#
#   world2-restore-rehearse.sh [--from-remote] [--keep]
#
#     --from-remote   clone the off-box repo into a temp dir and restore from
#                     THAT, rather than from the box-local dump. This is the
#                     rehearsal that actually proves the off-box copy; the
#                     local one only proves pg_dump ran.
#     --keep          leave the scratch database in place for poking at.
#
# ── WHAT "MATCHING" MEANS HERE, AND WHERE IT CANNOT ─────────────────────────
# The comparison is per-table row counts between the restored scratch and the
# live store, plus the store's own equality falsifier where it can run.
#
# Row counts on a LIVE database are expected to drift while the rehearsal runs:
# the office is up, the candle is open, and a claim submitted between the dump
# and the count is a difference that means the town is alive, not that the
# backup is wrong. So the receipt reports drift per table with its direction,
# and only counts a table WRONG if the restored side has MORE rows than live —
# which cannot be explained by the clock and can only mean the dump and the
# live store disagree about history.
#
# The equality falsifier (falsifier-projection-equality.mjs) is run against the
# restored database when its pinned checkouts are available, because it is the
# one check that reads meaning rather than volume: it re-derives law and stamps
# from the checkout at projection_heads' own sha and asserts the restored rows
# equal that derivation. Its exit codes are the store's, not this script's:
# 0 equal · 1 drift (RED) · 2 could not run. A 2 is reported as NOT-RUN and
# never as a pass — "There is no exit code for 'checked nothing and found
# nothing'."

set -uo pipefail
# A FIXED /tmp NAME IS A UID TRAP (2026-09-04): the 08-29 run left /tmp/w2-restore.err owned by
# root; the timer now runs as meepo, and the first --from-remote rehearsal since failed with
# "Permission denied" on the redirect, which starved pg_restore of its stdin ("end of file") and
# read as a broken dump. mktemp, so a stale file from another user can never be the failure.
ERRF="$(mktemp -t w2-restore.XXXXXX)"; trap 'rm -f "$ERRF"' EXIT
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/world2-lib.sh"

SCRATCH="${W2_SCRATCH_DB:-world2_restore_test}"
FROM_REMOTE=false; KEEP=false
for a in "$@"; do
  case "$a" in --from-remote) FROM_REMOTE=true ;; --keep) KEEP=true ;; esac
done

DB="$(w2_db)"
OWNER_PW="$(w2_secret PG_WORLD2_OWNER_PASSWORD)"
[ -n "$OWNER_PW" ] || { echo "PG_WORLD2_OWNER_PASSWORD unreadable" >&2; exit 2; }
export PGPASSWORD="$OWNER_PW"
PGH="${WORLD2_PGHOST:-localhost}"; PGP="${WORLD2_PGPORT:-5432}"
psql_owner() { psql --host "$PGH" --port "$PGP" --username world2_owner "$@"; }

say() { printf '%s\n' "$*"; }
t0=$(date +%s)

# ── pick the dump ───────────────────────────────────────────────────────────
TMPCLONE=""
if [ "$FROM_REMOTE" = true ]; then
  TMPCLONE="$(mktemp -d /tmp/w2-restore-XXXXXX)"
  # The host key is PINNED to the lane's own known_hosts, verified against
  # GitHub's published SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU on
  # install. StrictHostKeyChecking=yes with the system known_hosts would pass
  # for meepo and fail for anyone else (it did, on the first rehearsal run as
  # root) — a lane whose security depends on which user happens to run it is
  # not pinned, it is lucky.
  export GIT_SSH_COMMAND="ssh -i $WORLD2_LAB/.ssh/w2-backups -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=$WORLD2_LAB/.ssh/known_hosts"
  say "== clone the OFF-BOX copy"
  say "   git clone --depth 1 git@github.com:wright-starforge/postmark-world2-backups.git $TMPCLONE"
  git clone -q --depth 1 git@github.com:wright-starforge/postmark-world2-backups.git "$TMPCLONE" || {
    echo "clone failed — the off-box copy could not be retrieved, which IS the finding" >&2; exit 1; }
  DUMP="$(ls -1t "$TMPCLONE"/dumps/*.dump 2>/dev/null | head -n1)"
  say "   remote tip: $(git -C "$TMPCLONE" rev-parse HEAD)"
else
  DUMP="$(ls -1t "$WORLD2_LAB"/private-dumps/world2-*.dump 2>/dev/null | head -n1)"
fi
[ -n "${DUMP:-}" ] && [ -f "$DUMP" ] || { echo "no dump found to rehearse" >&2; exit 2; }
say "== dump under test: $DUMP ($(numfmt --to=iec "$(stat -c %s "$DUMP")"))"

# ── the scratch database ────────────────────────────────────────────────────
say "== scratch: $SCRATCH"
psql_owner --dbname postgres -qc "DROP DATABASE IF EXISTS $SCRATCH" || exit 1
psql_owner --dbname postgres -qc "CREATE DATABASE $SCRATCH OWNER world2_owner" || exit 1

cleanup() {
  if [ "$KEEP" = false ]; then
    say "== drop scratch"
    psql_owner --dbname postgres -qc "DROP DATABASE IF EXISTS $SCRATCH" >/dev/null 2>&1
  else
    say "== scratch KEPT at $SCRATCH (--keep)"
  fi
  [ -n "$TMPCLONE" ] && rm -rf "$TMPCLONE"
}
trap cleanup EXIT

# ── restore ─────────────────────────────────────────────────────────────────
# --no-owner/--no-acl because the dump was taken that way; the roles exist on
# this cluster but a restore that depended on them would not be portable to the
# rescue box, which is the box this rehearsal is standing in for.
say "== pg_restore --clean --if-exists --no-owner --no-acl -d $SCRATCH <dump>"
r0=$(date +%s)
pg_restore --host "$PGH" --port "$PGP" --username world2_owner --dbname "$SCRATCH" \
  --no-owner --no-acl --exit-on-error "$DUMP" 2>"$ERRF"
rrc=$?
r1=$(date +%s)
if [ "$rrc" -ne 0 ]; then
  say "!! pg_restore exit $rrc"; sed -n '1,40p' "$ERRF"; exit 1
fi
say "   restored in $((r1 - r0))s"

# ── counts vs live ──────────────────────────────────────────────────────────
say "== row counts, restored vs live ($DB)"
TABLES=$(psql_owner --dbname "$SCRATCH" -tAc \
  "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")
bad=0; rows_total=0; drift_lines=""
printf '   %-26s %10s %10s  %s\n' table restored live verdict
for t in $TABLES; do
  a=$(psql_owner --dbname "$SCRATCH" -tAc "SELECT count(*) FROM \"$t\"" 2>/dev/null)
  b=$(psql_owner --dbname "$DB"      -tAc "SELECT count(*) FROM \"$t\"" 2>/dev/null)
  [ -n "$a" ] || a=0; [ -n "$b" ] || b=0
  rows_total=$((rows_total + a))
  if [ "$a" -eq "$b" ]; then v="match"
  elif [ "$a" -lt "$b" ]; then v="live +$((b - a)) (town moved since the dump — expected)"
  else v="RESTORED HAS MORE (+$((a - b))) — HISTORY DISAGREES"; bad=$((bad + 1)); fi
  printf '   %-26s %10s %10s  %s\n' "$t" "$a" "$b" "$v"
  [ "$a" -ne "$b" ] && drift_lines="$drift_lines$t:$a/$b "
done
say "   $rows_total rows restored across $(echo "$TABLES" | wc -w) tables"


# ── roles.db, restored and counted ──────────────────────────────────────────
# POS-185. The dump above is the world store; this is the office's registry of
# WHO PAID, which rides the same commit (world2-backup.sh § 1b) because a grant
# exists nowhere else — no repo holds it and no fold recomputes it.
#
# "Restoring" it is a file copy, not a pg_restore: it is a whole SQLite database
# in one file, so the rehearsal opens the shipped copy READ-ONLY and counts it
# against the live registry. That is the entire restore path, and the rehearsal
# proving it is therefore the rehearsal proving the restore.
#
# THE DRIFT RULE IS THE SAME ONE, and for the same reason: role_audit is
# append-only (src/roles.mjs § THE STATE AND THE RECEIPT), so the live side may
# legitimately have gained rows since the copy was taken — the town kept
# selling. The copy having MORE rows than live cannot be explained by the clock
# and means the two disagree about history, which is the finding.
say "== roles.db, shipped copy vs live registry"
ROLES_LIVE="${W2_ROLES_DB:-$WORLD2_OFFICE/roles.db}"
if [ "$FROM_REMOTE" = true ]; then ROLES_DIR="$TMPCLONE/roles"; else ROLES_DIR="$WORLD2_LAB/private-dumps"; fi
ROLES_COPY="$(ls -1t "$ROLES_DIR"/roles-*.db 2>/dev/null | head -n1)"
if [ -z "${ROLES_COPY:-}" ]; then
  # Absent is legal and is NOT a pass: it is reported in the operator's words so
  # a reader cannot mistake "nothing to check" for "checked and fine".
  say "   NOT-RUN: no roles-*.db in $ROLES_DIR — either no role has ever been granted on this box (OFFICE_ROLE_GATES is unset on every office today) or the lane has not shipped one yet"
else
  # One node, both files, read-only on each. A missing live registry counts as
  # zero rather than as an error: the copy having rows the live side lost is the
  # interesting direction, and it is exactly the direction the rule below flags.
  ROLES_COUNTS="$(node - "$ROLES_COPY" "$ROLES_LIVE" <<'NODE' 2>/dev/null
const { DatabaseSync } = require("node:sqlite");
const { existsSync } = require("node:fs");
const count = (p) => {
  if (!existsSync(p)) return -1;
  const db = new DatabaseSync(p, { readOnly: true });
  try { return db.prepare("SELECT count(*) AS c FROM role_audit").get().c; }
  finally { db.close(); }
};
const [copy, live] = process.argv.slice(2);
process.stdout.write(`${count(copy)} ${count(live)}`);
NODE
)"
  RA_COPY="${ROLES_COUNTS% *}"; RA_LIVE="${ROLES_COUNTS#* }"
  if [ -z "$ROLES_COUNTS" ] || [ "${RA_COPY:--1}" -lt 0 ]; then
    say "   !! the shipped roles copy could not be opened: $(basename "$ROLES_COPY")"
    bad=$((bad + 1))
  else
    printf '   %-26s %10s %10s  %s\n' table restored live verdict
    if [ "${RA_LIVE:--1}" -lt 0 ]; then v="live registry absent — nothing to compare against"
    elif [ "$RA_COPY" -eq "$RA_LIVE" ]; then v="match"
    elif [ "$RA_COPY" -lt "$RA_LIVE" ]; then v="live +$((RA_LIVE - RA_COPY)) (grants since the copy — expected)"
    else v="COPY HAS MORE (+$((RA_COPY - RA_LIVE))) — THE REGISTRY LOST ROWS IT ONCE HAD"; bad=$((bad + 1)); fi
    printf '   %-26s %10s %10s  %s\n' role_audit "$RA_COPY" "${RA_LIVE}" "$v"
    say "   copy under test: $(basename "$ROLES_COPY") (from $( [ "$FROM_REMOTE" = true ] && echo off-box || echo on-box ))"
    drift_lines="$drift_lines$( [ "$RA_COPY" -ne "${RA_LIVE:-0}" ] && echo "role_audit:$RA_COPY/$RA_LIVE " )"
  fi
fi

# ── the store's own check, on the restored store ────────────────────────────
say "== falsifier-projection-equality against the RESTORED database"
FRC=2
LAWDIR="$WORLD2_LAB/ingest-clones/world"; TOWNDIR="$WORLD2_LAB/ingest-clones/town"
if [ -d "$LAWDIR/.git" ] && [ -d "$TOWNDIR/.git" ]; then
  # It must run against the checkouts at the sha the RESTORED projection_heads
  # records, not at origin's tip — a falsifier that compared against a moving
  # target would be measuring the clock.
  LSHA=$(psql_owner --dbname "$SCRATCH" -tAc "SELECT sha FROM projection_heads WHERE repo='world-law'")
  TSHA=$(psql_owner --dbname "$SCRATCH" -tAc "SELECT sha FROM projection_heads WHERE repo='town'")
  say "   restored heads: world-law $LSHA / town $TSHA"
  if git -C "$LAWDIR" checkout -q "$LSHA" 2>/dev/null && git -C "$TOWNDIR" checkout -q "$TSHA" 2>/dev/null; then
    # falsifier-projection-equality.mjs:195 is `new pg.Client()` with no
    # argument, so it takes PG* and ignores any URL handed to it. Passing
    # WORLD2_PG_URL here made it connect as the OS user instead — "password
    # authentication failed for user root" — and the rehearsal reported
    # NOT-RUN, which is the design working: an unrunnable check reported itself
    # as unrun rather than as a pass. PGDATABASE is the SCRATCH, which is the
    # whole point — the falsifier must read the RESTORED store, not the live one.
    (cd "$WORLD2_OFFICE" && \
      PGHOST="$PGH" PGPORT="$PGP" PGUSER=world2_owner PGPASSWORD="$OWNER_PW" PGDATABASE="$SCRATCH" \
      node world2/tools/falsifier-projection-equality.mjs --law-repo "$LAWDIR" --town-repo "$TOWNDIR")
    FRC=$?
    git -C "$LAWDIR" checkout -q - 2>/dev/null; git -C "$TOWNDIR" checkout -q - 2>/dev/null
  else
    say "   NOT-RUN: the shallow checkouts do not contain the pinned shas"
  fi
else
  say "   NOT-RUN: no ingest checkouts on this box"
fi
case "$FRC" in
  0) say "   falsifier: EQUAL (exit 0)" ;;
  1) say "   falsifier: RED — drift (exit 1)"; bad=$((bad + 1)) ;;
  *) say "   falsifier: NOT-RUN (exit 2) — reported as not-run, never as a pass" ;;
esac

t1=$(date +%s)
say "== rehearsal finished in $((t1 - t0))s · $( [ "$bad" -eq 0 ] && echo PASS || echo "FAIL ($bad finding(s))" )"
w2_state restore-rehearsal.json "$(printf '"status":"%s","source":"%s","dump":"%s","seconds":%d,"restore_seconds":%d,"rows_restored":%d,"tables":%d,"roles_audit_copy":%s,"roles_audit_live":%s,"falsifier_exit":%d,"drift":"%s"' \
  "$([ "$bad" -eq 0 ] && echo pass || echo fail)" \
  "$([ "$FROM_REMOTE" = true ] && echo off-box || echo on-box)" \
  "$(basename "$DUMP")" "$((t1 - t0))" "$((r1 - r0))" "$rows_total" "$(echo "$TABLES" | wc -w)" \
  "${RA_COPY:-null}" "${RA_LIVE:-null}" "$FRC" "$drift_lines")"
[ "$bad" -eq 0 ] || exit 1
exit 0
