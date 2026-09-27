#!/bin/bash
# world2-rehearsal-copy.sh — THE STORE GETS A REHEARSAL COPY (POS-242 part 1).
#
#   world2-rehearsal-copy.sh [--target world2_rehearsal] [--source world2_dev]
#
# One command: a live pg_dump of prod's store, restored into a freshly created
# `world2_rehearsal` on the same cluster, owned by `rehearsal_runner` — a role
# that cannot connect to the source. It prints the row count of every table on
# both sides, read from ONE snapshot, and the copy's equality is the receipt.
#
# ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
# `world2_dev` IS prod's Postgres (office AGENTS.md). Until this script, the
# only rehearsal of a store change was by hand — a dump into a database with
# `scratch` in its name — and it happened once. Migrations 018-026 and window
# 212's hand fix were rehearsed only inside rolled-back transactions or on the
# dev sandbox, which holds none of prod's marks. The 09-26 slug collision is
# the kind of failure a copy of the real rows catches and a sandbox does not.
# `world2/tools/rehearse.mjs` is what runs on the copy.
#
# ── THE NAME GUARD ──────────────────────────────────────────────────────────
# The target is DROPPED and re-created on every run. So a target whose name
# lacks `rehearsal` is refused before anything connects, and so is a target
# equal to the source. There is no flag that turns this off.
#
# ── WHO OWNS THE COPY, AND WHY THE PENS ARE MEMBERS AND NOT GRANTEES ────────
# The office's own code must run on the copy unchanged except for its URL, and
# "unchanged" includes WHO it runs as: the claims trigger passes the clearing
# only when `current_user = 'clearing_job'` (002_grants.sql, 007_private_
# drafts.sql), so a copy the clearing reaches as any other role refuses every
# transition. The copy therefore keeps prod's ACL (restored from the dump, and
# every later migration's own GRANTs), and the runner reaches each pen by
# `SET ROLE` — the connection option `-c role=<pen>`.
#
# `rehearsal_runner` holds the pens WITH INHERIT FALSE, SET TRUE. That pair is
# the whole design:
#   · SET TRUE lets a session on the copy become a pen — ONLY the pens the
#     runner uses, each named with its step:
#       clearing_job  — the clearing itself (clearing-job.mjs; the claims
#                       trigger passes only this current_user)
#       law_ingester  — the clearing's first step, stamp-ingest.mjs (PG* +
#                       PGOPTIONS), which writes the stamp/roll/escrow projections
#     office_api, snapshot_reader, stance_reader and world2_owner are NOT granted:
#     no step of the runner runs as them. A later step that needs one adds it
#     here, with its step (Wright's ruling, 2026-09-26);
#   · INHERIT FALSE means none of their privileges count for rehearsal_runner
#     itself — including CONNECT on the source. `world2_dev`'s datacl grants
#     CONNECT to the owner and the four pens by name and to no PUBLIC, so a
#     rehearsal session cannot open the source at all. A tool that falls back
#     to a hard-coded `world2_dev` URL fails to CONNECT; it never writes prod.
#   · `world2_owner` is deliberately NOT among them. It owns the source, and a
#     role that can become the owner can `DROP DATABASE` from any database it
#     can reach. On the copy, rehearsal_runner IS the owner: it stands where
#     world2_owner stands on prod, and it applies migrations as itself — the
#     prod idiom (`SET ROLE world2_owner`, world2/tools/README.md § Applying a
#     migration) with the copy's own owner.
# No existing role's own rights change. PUBLIC's CONNECT and TEMP on the copy
# are revoked, so no pen can open the copy by its own login either: the only
# road in is rehearsal_runner's.
#
# ── THE WALL IS MEASURED ON EVERY RUN, BEFORE ANY WRITE TO A DATABASE ────────
# "INHERIT FALSE blocks CONNECT" is an argument; this script does not rest on
# it. After the role and its memberships exist and BEFORE the target is touched,
# it logs in as rehearsal_runner over 127.0.0.1/scram and tries to open the
# SOURCE three ways: plain, with `-c role=clearing_job`, with `-c role=office_api`
# — the question being whether the startup `role` option is applied before the
# CONNECT check. All three must be refused; the refusals are printed verbatim.
# If ANY connects: disconnect, revoke the memberships, stop (exit 1), write
# nothing. The URL / current_database() guards in the tools stay as a second
# layer — the wall is two layers, not one.
#
# TEARDOWN: deploy/world2-rehearsal-teardown.sh — drops the copy, revokes every
# membership, drops the role, removes the password file.
#
# ── ONE SNAPSHOT, SO EQUALITY MEANS SOMETHING ───────────────────────────────
# The office is live while this runs. Counting the source after the dump would
# report the town moving, not the copy's fidelity. So the source is counted
# inside a REPEATABLE READ transaction whose snapshot pg_dump is handed
# (`--snapshot`): both read the same instant, and any difference is a defect.
#
# Runs as meepo (or any user with `sudo -n -u postgres`). Everything that
# touches Postgres goes through `sudo -n -u postgres` over the local socket:
# no URL, no password on a command line, nothing sourced. The only secret this
# script makes is rehearsal_runner's password, minted on first run into
# $REHEARSAL_DIR/runner.pw (0600) and never printed.
#
# Exit: 0 the copy equals the source · 1 it does not (or a step failed) ·
# 2 refused before touching anything.

set -uo pipefail

# rehearsal_target_ok <target> <source> — the guard, as a function so the
# office suite can source this file and hold it (test/world2-rehearsal-guards).
rehearsal_target_ok() {
  local t="$1" s="$2"
  case "$t" in *rehearsal*) ;; *) echo "refused: target '$t' does not name 'rehearsal' — this script drops its target" >&2; return 1 ;; esac
  [ "$t" != "$s" ] || { echo "refused: target equals source ('$t')" >&2; return 1; }
  case "$t" in *world2_dev*) echo "refused: target '$t' names world2_dev, which is PROD" >&2; return 1 ;; esac
  case "$t" in *[!a-z0-9_]*) echo "refused: target '$t' is not a plain identifier" >&2; return 1 ;; esac
  case "$s" in *[!a-z0-9_]*|"") echo "refused: source '$s' is not a plain identifier" >&2; return 1 ;; esac
  return 0
}
# Sourced by the test: define, do nothing.
[ "${BASH_SOURCE[0]}" = "$0" ] || return 0

TARGET="world2_rehearsal"
SOURCE="world2_dev"
while [ $# -gt 0 ]; do
  case "$1" in
    --target) TARGET="${2:-}"; shift 2 ;;
    --source) SOURCE="${2:-}"; shift 2 ;;
    *) echo "usage: world2-rehearsal-copy.sh [--target <name containing 'rehearsal'>] [--source world2_dev]" >&2; exit 2 ;;
  esac
done

RUNNER="rehearsal_runner"
PENS="clearing_job law_ingester"   # each with its step — see § WHO OWNS THE COPY
REHEARSAL_DIR="${REHEARSAL_DIR:-/srv/world2-lab/rehearsal}"

rehearsal_target_ok "$TARGET" "$SOURCE" || exit 2

say() { printf '%s\n' "$*"; }
pgsu() { sudo -n -u postgres psql -XAtq -v ON_ERROR_STOP=1 "$@"; }
t0=$(date +%s)

mkdir -p "$REHEARSAL_DIR" && chmod 0700 "$REHEARSAL_DIR" || { echo "cannot make $REHEARSAL_DIR" >&2; exit 1; }

# ── the role ────────────────────────────────────────────────────────────────
PWF="$REHEARSAL_DIR/runner.pw"
if [ ! -s "$PWF" ]; then
  ( umask 077; openssl rand -hex 24 > "$PWF" ) || { echo "cannot mint $PWF" >&2; exit 1; }
fi
# The password reaches psql on stdin through printf (a builtin — no argv, no
# ps line). log_statement is 'none' on this cluster (measured 2026-09-26).
say "== role $RUNNER (LOGIN, NOINHERIT membership in: $PENS)"
{
  printf "DO \$\$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '%s') THEN CREATE ROLE %s LOGIN NOINHERIT NOCREATEDB NOCREATEROLE; END IF; END \$\$;\n" "$RUNNER" "$RUNNER"
  printf "ALTER ROLE %s PASSWORD '%s';\n" "$RUNNER" "$(cat "$PWF")"
  for p in $PENS; do printf "GRANT %s TO %s WITH INHERIT FALSE, SET TRUE;\n" "$p" "$RUNNER"; done
} | pgsu -d postgres >/dev/null || { echo "role setup failed" >&2; exit 1; }

# The proof, not the intent. First the catalog's answer…
revoke_pens() { for p in $PENS; do printf "REVOKE %s FROM %s;\n" "$p" "$RUNNER"; done | pgsu -d postgres >/dev/null 2>&1; }
if [ "$(pgsu -d postgres -c "SELECT has_database_privilege('$RUNNER', '$SOURCE', 'CONNECT')")" != "f" ]; then
  echo "!! the catalog says $RUNNER can CONNECT to $SOURCE — memberships revoked, nothing written" >&2; revoke_pens; exit 1
fi
if [ "$(pgsu -d postgres -c "SELECT count(*) FROM aclexplode((SELECT datacl FROM pg_database WHERE datname = '$SOURCE')) WHERE grantee = 0 AND privilege_type = 'CONNECT'")" != "0" ]; then
  say "   ⚑ PUBLIC holds CONNECT on $SOURCE — reported, not changed (a new role could reach it)"
fi
# …then the wall itself, MEASURED: three real logins to the source, each of
# which must be refused. `-c role=` is the question — whether the startup role
# is applied before the CONNECT check. The password rides PGPASSWORD (the
# environment of this one psql, never an argv); the refusal is printed whole.
say "== the wall: $RUNNER tries to open $SOURCE over 127.0.0.1 (each must be REFUSED)"
# A refusal only counts if the login itself worked — a wrong password is also a
# refusal, and would prove nothing about the wall. So the control first: the
# same login opens `postgres` (PUBLIC CONNECT there, by the cluster's default),
# and each refusal below must be Postgres saying CONNECT, not the password.
ctl="$(PGPASSWORD="$(cat "$PWF")" psql -XAtq -h 127.0.0.1 -p "${WORLD2_PGPORT:-5432}" -U "$RUNNER" -d postgres -c "SELECT current_user" 2>&1)"
[ "$ctl" = "$RUNNER" ] || { echo "!! control failed: $RUNNER cannot log in at all ($ctl) — the wall cannot be measured; memberships revoked, nothing written" >&2; revoke_pens; exit 1; }
say "   control: $RUNNER logs in to postgres over 127.0.0.1 (answered: $ctl)"
for opt in "" "-c role=clearing_job" "-c role=office_api"; do
  out="$(PGPASSWORD="$(cat "$PWF")" PGOPTIONS="$opt" psql -XAtq -h 127.0.0.1 -p "${WORLD2_PGPORT:-5432}" \
         -U "$RUNNER" -d "$SOURCE" -c "SELECT current_database()" 2>&1)"
  rc=$?
  if [ "$rc" -eq 0 ]; then
    echo "!! BREACH: $RUNNER CONNECTED to $SOURCE with options='${opt}' (it answered: $out) — disconnected, memberships revoked, nothing written" >&2
    revoke_pens; exit 1
  fi
  case "$out" in
    *"permission denied for database"*) ;;
    *) echo "!! options='${opt}': refused, but not by the CONNECT check ($out) — the wall is unmeasured; memberships revoked, nothing written" >&2; revoke_pens; exit 1 ;;
  esac
  say "   options='${opt}': REFUSED (psql exit $rc): $out"
done

# ── the target, fresh ───────────────────────────────────────────────────────
say "== target $TARGET (dropped and re-created)"
pgsu -d postgres -c "DROP DATABASE IF EXISTS $TARGET WITH (FORCE)" >/dev/null || exit 1
pgsu -d postgres -c "CREATE DATABASE $TARGET OWNER $RUNNER" >/dev/null || exit 1
pgsu -d postgres -c "REVOKE CONNECT, TEMPORARY ON DATABASE $TARGET FROM PUBLIC" >/dev/null || exit 1
pgsu -d postgres -c "GRANT CONNECT, TEMPORARY ON DATABASE $TARGET TO $RUNNER" >/dev/null || exit 1

# ── one snapshot: count the source, dump it ─────────────────────────────────
WORK="$(mktemp -d -t w2-rehearsal.XXXXXX)"; trap 'exec 3>&- 2>/dev/null; rm -rf "$WORK"' EXIT
mkfifo "$WORK/in"
sudo -n -u postgres psql -XAtq -d "$SOURCE" < "$WORK/in" > "$WORK/src.out" 2>"$WORK/src.err" &
HOLD=$!
exec 3>"$WORK/in"
echo "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SELECT 'snap|' || pg_export_snapshot();" >&3
snap=""
for _ in $(seq 1 100); do snap="$(sed -n 's/^snap|//p' "$WORK/src.out")"; [ -n "$snap" ] && break; sleep 0.1; done
[ -n "$snap" ] || { echo "could not export a snapshot from $SOURCE: $(cat "$WORK/src.err")" >&2; exit 1; }

TABLES="$(pgsu -d "$SOURCE" -c "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY 1")"
for t in $TABLES; do echo "SELECT 'n|$t|' || count(*) FROM public.\"$t\";" >&3; done

say "== pg_dump $SOURCE (snapshot $snap) | pg_restore --no-owner --role=$RUNNER -d $TARGET"
r0=$(date +%s)
sudo -n -u postgres pg_dump --format=custom --snapshot="$snap" --dbname "$SOURCE" 2>"$WORK/dump.err" \
  | sudo -n -u postgres pg_restore --no-owner --role="$RUNNER" --exit-on-error --dbname "$TARGET" 2>"$WORK/restore.err"
rcs=("${PIPESTATUS[@]}")
echo "COMMIT;" >&3; exec 3>&-; wait "$HOLD"
r1=$(date +%s)
if [ "${rcs[0]}" -ne 0 ] || [ "${rcs[1]}" -ne 0 ]; then
  say "!! pg_dump exit ${rcs[0]}, pg_restore exit ${rcs[1]}"; sed -n '1,20p' "$WORK/dump.err" "$WORK/restore.err"; exit 1
fi
say "   dumped and restored in $((r1 - r0))s"

# ── the receipt: every table, both sides ────────────────────────────────────
say "== row counts, source (at the dump's snapshot) vs copy"
printf '   %-28s %10s %10s  %s\n' table source copy verdict
bad=0; rows=0; n=0
for t in $TABLES; do
  a="$(sed -n "s/^n|$t|//p" "$WORK/src.out")"
  b="$(pgsu -d "$TARGET" -c "SELECT count(*) FROM public.\"$t\"" 2>/dev/null)"
  if [ -n "$a" ] && [ "$a" = "$b" ]; then v="equal"; else v="DIFFERENT"; bad=$((bad + 1)); fi
  printf '   %-28s %10s %10s  %s\n' "$t" "${a:-?}" "${b:-?}" "$v"
  rows=$((rows + ${b:-0})); n=$((n + 1))
done
owner="$(pgsu -d "$TARGET" -c "SELECT string_agg(DISTINCT tableowner, ',') FROM pg_tables WHERE schemaname = 'public'")"
say "   $n tables, $rows rows in the copy; every table owned by: $owner"

t1=$(date +%s)
if [ "$bad" -eq 0 ]; then
  say "== COPY EQUAL: $TARGET = $SOURCE at snapshot $snap, $n/$n tables ($((t1 - t0))s)"; exit 0
fi
say "== COPY NOT EQUAL: $bad table(s) differ"; exit 1
