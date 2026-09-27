#!/bin/bash
# world2-backup.sh — the store's durability lane. Two copies, two clocks.
#
# ════════════════════════════════════════════════════════════════════════════
#  WHAT IS BACKED UP WHERE, AND THE RPO OF EACH — say the number, not "nightly"
# ════════════════════════════════════════════════════════════════════════════
#
#  OFF-BOX (git, private)          pg_dump --format=custom, pushed to
#                                  wright-starforge/postmark-world2-backups.
#                                  RPO ≤ 24h. THIS IS THE ONE THAT SURVIVES
#                                  LOSING THE BOX, and it is the one the
#                                  restore rehearsal exercises.
#
#  THE NOTARY, ELSEWHERE ON PURPOSE  Until 2026-09-03 this lane also shipped a
#                                  git bundle of the notary checkout, because
#                                  the notary had no remote of its own. It has
#                                  one now — wright-starforge/postmark-world2-notary,
#                                  pushed by world2-notary.sh over its own key —
#                                  and the bundle is GONE from this lane rather
#                                  than kept as redundancy. See § 3 below for
#                                  why keeping it would have been the wrong kind
#                                  of spare.
#
#  OFF-BOX (git, private)          roles.db, copied with VACUUM INTO, in the
#                                  SAME commit as the dump. RPO <= 24h. It is
#                                  here because it is the one office file with
#                                  authored state and no other copy anywhere:
#                                  src/roles.mjs:71-82, "losing roles.db loses
#                                  who paid". See § 1b for the mechanic, and
#                                  why it is never a cp.
#
#  ON-BOX (spool)                  pg_basebackup + archived WAL.
#                                  RPO ≈ one WAL segment. Survives a bad
#                                  migration, a bad clearing, a dropped table
#                                  — anything that loses DATA without losing
#                                  the DISK. Does not survive losing the box.
#
# ── WHY THOSE ARE TWO LANES AND NOT ONE, WHICH IS A CORRECTION ──────────────
# The obvious reading of "nightly pg_dump plus WAL, shipped" is one restore
# path. It is not one path, and pairing them that way would produce a receipt
# that reads fine and a restore that cannot be performed:
#
#   YOU CANNOT REPLAY WAL ONTO A pg_dump RESTORE.
#
# A pg_dump is a LOGICAL export — SQL statements against a fresh database with
# fresh block layout and fresh LSNs. Archived WAL is a PHYSICAL redo journal
# keyed to the block layout of the cluster it came from. Point-in-time recovery
# takes a `pg_basebackup` (a physical copy) plus WAL; a dump takes neither and
# needs neither, because it is already internally consistent as of the moment
# it began.
#
# So archived WAL with no base backup is decorative — a growing spool of files
# nothing can consume. That is why pg_basebackup is in this script: it is what
# makes the WAL a restore path instead of a habit.
#
# ── THE OFF-BOX DESTINATION, DISCLOSED ──────────────────────────────────────
# github.com/wright-starforge/postmark-world2-backups — PRIVATE, created
# 2026-08-29 for this lane, with keeminlee invited as admin so the ownership
# transfer is one click rather than a migration.
#
# It is not a new account. What existed on the box and was considered first:
#
#   · R2 (postmark-media) — REJECTED. tools/state-to-r2.mjs § its own header:
#     "Serves from the SAME bucket the media door uses (public via
#      media.postmark.town…)". A dump carries `draft`-status claims — a
#     resident's unfinished private sentence — and the one thing Phase 5.6
#     exists to prevent is those reaching a public surface. Measured on the box:
#     the office's R2 credential is scoped to that one bucket and cannot make
#     another (ListBuckets 403, HEAD other-bucket 403), and the vaulted
#     Cloudflare API token that could is expired (verify → 401).
#   · keeminlee/postmark-office-private-archive — REJECTED. It holds retired
#     office CODE branches, not data, and the box's pen credential cannot see
#     it (Repository not found as postmark-pen).
#
# The box's credential for this is an SSH DEPLOY KEY generated on the box, write
# scope, ONE repository. Not a personal access token: the tokens available were
# account-wide, and a backup lane that can delete a repo is a backup lane that
# can delete the backups.
#
# ── WHY THE WAL DOES NOT RIDE OFF-BOX TONIGHT ───────────────────────────────
# Measured, not assumed. pg_stat_wal over 10.3 hours on 2026-08-29:
#
#     stats_reset 2026-08-28 14:51:13+00 · 309,881 records · 70 MB
#
# ≈163 MB/day raw (and that was a heavy build day — seed, backfill and replay
# all landed inside that window, so steady state is lower). The archive_command
# gzips each segment, and the measured ratio is recorded in the state file each
# night. Even at a 10x ratio that is gigabytes a year of binary blobs into a git
# history that never forgets, which is a repository that dies of it.
#
# So WAL is local-only and its off-box lane is a NAMED GAP with a number
# attached, not an oversight: give the box a private object-storage bucket and
# shipping the spool is a dozen lines. Until then the honest sentence is the one
# at the top — losing the box costs up to 24 hours, and the dump is what comes
# back.

set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/world2-lib.sh"

DUMPS="$WORLD2_LAB/private-dumps"          # outside every checkout and webroot
BASEBACKUPS="$WORLD2_LAB/basebackups"
WAL="${W2_WAL_ARCHIVE:-/srv/world2-wal}"
REPO="$WORLD2_LAB/backup-repo"
KEEP_DUMPS="${W2_KEEP_DUMPS:-14}"          # in the working tree; history keeps all
KEEP_BASE="${W2_KEEP_BASE:-3}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DB="$(w2_db)"

# The host key is PINNED to the lane's own known_hosts, verified against
# GitHub's published SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU on
# install. StrictHostKeyChecking=yes with the system known_hosts would pass
# for meepo and fail for anyone else (it did, on the first rehearsal run as
# root) — a lane whose security depends on which user happens to run it is
# not pinned, it is lucky.
export GIT_SSH_COMMAND="ssh -i $WORLD2_LAB/.ssh/w2-backups -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=$WORLD2_LAB/.ssh/known_hosts"

mkdir -p "$DUMPS" "$BASEBACKUPS"
chmod 700 "$DUMPS" "$BASEBACKUPS"

fail() {                                    # one exit path, one state file
  echo "[world2-backup] $1" >&2
  w2_state backup.json "\"status\":\"failed\",\"stage\":\"$2\",\"detail\":$(printf '%s' "$1" | w2_json_escape)"
  exit 1
}

# ── 1 · the logical dump ────────────────────────────────────────────────────
# Owner role, and no --table / no WHERE. world2/tools/README.md § The hand-run:
# "A full dump carries draft rows by nature; no --table or WHERE is wanted, and
#  narrowing to `claims` alone would produce a file that cannot be restored into
#  anything." The owner is also the one credential 007's row policy does not
# apply to, so it is the only one that can dump a draft at all.
OWNER_PW="$(w2_secret PG_WORLD2_OWNER_PASSWORD)"
[ -n "$OWNER_PW" ] || fail "PG_WORLD2_OWNER_PASSWORD unreadable from $WORLD2_ENV_FILE" dump
DUMP="$DUMPS/world2-$STAMP.dump"
PGPASSWORD="$OWNER_PW" pg_dump --host "${WORLD2_PGHOST:-localhost}" --port "${WORLD2_PGPORT:-5432}" \
  --username world2_owner --dbname "$DB" --format=custom --no-owner --no-acl --file "$DUMP" 2>/tmp/w2-dump.err
rc=$?
[ "$rc" -eq 0 ] || fail "pg_dump exit $rc — $(cat /tmp/w2-dump.err)" dump
chmod 600 "$DUMP"
DUMP_BYTES=$(stat -c %s "$DUMP")

# A dump that cannot be listed is a file, not a backup. pg_restore --list reads
# the archive's own table of contents, so a truncated or corrupt file fails here
# rather than on the night it is needed.
TOC_ENTRIES=$(pg_restore --list "$DUMP" 2>/dev/null | grep -c '^[0-9]')
[ "${TOC_ENTRIES:-0}" -gt 0 ] || fail "pg_restore --list found no entries in $DUMP — the dump is not readable" dump

# ── 1b · roles.db, the one file that holds WHO PAID ─────────────────────────
# POS-185, 2026-09-21. src/roles.mjs:71-82 states this gap in its own voice and
# then declines to close it, correctly:
#
#   "roles.db is its own file beside oauth.db and dynamic.db, and *.db is
#    gitignored, so it lives on the box and nowhere else. It is NOT the same
#    durability class as its neighbours … office.db and world.db are pure
#    indexes, deleted and rebuilt whole from a clone; oauth.db is auth paperwork
#    whose loss only forces everyone to sign in again; dynamic.db carries an
#    explicit covenant that every row re-derives or recovers from a
#    crossing-save. This file carries NO such covenant, because a grant exists
#    nowhere else in the world — no repo holds it, no fold recomputes it.
#    LOSING roles.db LOSES WHO PAID. … a backup discipline for this one file is
#    an operations decision that is not this module's to make, only to state."
#
# This is operations making it. The file rides in THIS lane's commit instead of
# a unit of its own: it wants the same nightly clock, the same private repo and
# the same deploy key, and a second lane for one small file would be a second
# thing to watch and a second thing to forget. No new credential, no new unit,
# no new roll-call row — the row this lane already has now covers this file too.
#
# ── NEVER `cp`, AND THAT IS THE WHOLE MECHANIC ──────────────────────────────
# A SQLite file copied with cp/rsync while a writer is mid-transaction is TORN:
# it has the size and the magic bytes of a database and restores as nothing,
# which is the exact failure class this script is written against — a backup
# that exists and cannot be used. `VACUUM INTO` takes a read transaction and
# emits a self-consistent database, so the copy is sound no matter what the
# office is doing at 08:10.
#
# It runs through node's built-in `node:sqlite` RATHER THAN THE sqlite3 CLI, so
# the box needs no new package: the office already imports DatabaseSync to serve
# the gate (src/roles.mjs:141, src/server.mjs:36), so the runtime that reads
# roles.db in anger is the runtime that copies it. A lane whose correctness
# depended on a CLI nobody installed would be a lane that works until the day
# the box is rebuilt.
#
# THE HANDLE IS READ-ONLY, and that is deliberate rather than tidy: VACUUM INTO
# writes to the TARGET, never the source, so read-only is sufficient — measured,
# not assumed. A backup lane holding a pen over who paid could corrupt the one
# thing it exists to preserve, and this lane already declines that trade once
# (§ 3, the notary's key it does not hold).
#
# ABSENT IS NOT FAILED. OFFICE_ROLE_GATES is unset on every office today
# (src/server.mjs:170), so a box that has never granted a role has no roles.db
# at all. That is reported as `absent` and does not redden the unit — but an
# UNREADABLE or UNCOPYABLE roles.db does, because that is a file that exists and
# cannot be preserved, which is the state worth waking somebody for.
ROLES_SRC="${W2_ROLES_DB:-$WORLD2_OFFICE/roles.db}"
ROLES_COPY="$DUMPS/roles-$STAMP.db"
ROLES_ERR="$(mktemp -t w2-roles.XXXXXX)"
ROLES_BYTES=0; ROLES_AUDIT=0; ROLES_GRANTS=0; ROLES_STATUS=absent
if [ -f "$ROLES_SRC" ]; then
  ROLES_JSON="$(node - "$ROLES_SRC" "$ROLES_COPY" 2>"$ROLES_ERR" <<'NODE'
const { DatabaseSync } = require("node:sqlite");
const { rmSync, statSync } = require("node:fs");
const [src, dst] = process.argv.slice(2);
rmSync(dst, { force: true });          // VACUUM INTO refuses a target that exists
const db = new DatabaseSync(src, { readOnly: true });
db.prepare("VACUUM INTO ?").run(dst);
const n = (t) => db.prepare(`SELECT count(*) AS c FROM ${t}`).get().c;
// role_audit is APPEND-ONLY and `roles` is not: a revoke deletes the state row
// and ADDS a receipt row (src/roles.mjs § THE STATE AND THE RECEIPT). So the
// audit count is the one that only ever grows, which makes it the number a
// reader can compare between two nights without knowing the town's history.
const out = { audit_rows: n("role_audit"), grant_rows: n("roles"), bytes: statSync(dst).size };
db.close();
process.stdout.write(JSON.stringify(out));
NODE
)" || fail "roles.db VACUUM INTO failed — $(cat "$ROLES_ERR")" roles
  ROLES_AUDIT=$(printf '%s' "$ROLES_JSON" | sed -n 's/.*"audit_rows":\([0-9]*\).*/\1/p')
  ROLES_GRANTS=$(printf '%s' "$ROLES_JSON" | sed -n 's/.*"grant_rows":\([0-9]*\).*/\1/p')
  ROLES_BYTES=$(printf '%s' "$ROLES_JSON" | sed -n 's/.*"bytes":\([0-9]*\).*/\1/p')
  [ -n "$ROLES_AUDIT" ] && [ -n "$ROLES_BYTES" ] || fail "roles.db copy returned no counts: $ROLES_JSON" roles
  chmod 600 "$ROLES_COPY"
  ROLES_STATUS=copied
fi
rm -f "$ROLES_ERR"

# ── 2 · the physical base backup, so the WAL means something ────────────────
BASE="$BASEBACKUPS/base-$STAMP"
if PGPASSWORD="$OWNER_PW" pg_basebackup --host "${WORLD2_PGHOST:-localhost}" --port "${WORLD2_PGPORT:-5432}" \
     --username world2_owner --pgdata "$BASE" --format=tar --gzip --wal-method=none \
     --checkpoint=fast --no-password 2>/tmp/w2-base.err; then
  BASE_BYTES=$(du -sb "$BASE" | cut -f1)
  BASE_OK=true
else
  # Non-fatal on purpose: the off-box dump is the copy that survives the box,
  # and it already succeeded above. A failed base backup costs the PITR lane,
  # not the disaster lane — but it is reported, and it reddens the unit.
  echo "[world2-backup] pg_basebackup FAILED — $(cat /tmp/w2-base.err)" >&2
  BASE_BYTES=0; BASE_OK=false
fi

# ── 3 · the notary, which now has somewhere of its own to go ────────────────
# This section used to build a git bundle of /srv/world2-lab/notary and ship it
# inside this lane's repository, because the notary had no remote. DEC-7 closed
# that on 2026-09-03: the notary pushes to wright-starforge/postmark-world2-notary
# over its own deploy key, in world2-notary.sh.
#
# THE BUNDLE IS NOT KEPT AS A SPARE, and that is the decision worth reading
# rather than the code that is gone. DEC-7's stated reason:
#
#   "If the certification ships inside the same bundle as the backup, one
#    compromised lane loses both halves of the check."
#
# A second copy of the certifications living in the backup repo does not lose
# anything — but it makes this repo a place where a dump and a certification of
# that dump sit side by side, which is the one arrangement that lets a forged
# pair look self-consistent to whoever reaches for it. The check has to come
# from somewhere the backup lane cannot write. So it does, and it does not also
# come from here.
#
# WHAT THIS LANE STILL SAYS ABOUT THE NOTARY, and the credential rule that
# shapes it: it reads the notary checkout's OWN record of its last push —
# refs/remotes/origin/main, a local ref — and reports whether the certifications
# are off-box. It does NOT ls-remote the notary's repository, because that would
# require w2-notary, and a backup lane holding the notary's key is exactly the
# "one compromised lane loses both halves" this whole split exists to prevent.
# The honest sentence is therefore "as of its last push", not "right now", and
# the notary's own unit is the one that reddens when a push fails.
NOTARY_OFFBOX=unknown
NOTARY_LOCAL=""
NOTARY_PUSHED=""
if [ -d "$WORLD2_LAB/notary/.git" ]; then
  NOTARY_LOCAL="$(git -C "$WORLD2_LAB/notary" rev-parse --short HEAD 2>/dev/null)"
  NOTARY_PUSHED="$(git -C "$WORLD2_LAB/notary" rev-parse --short refs/remotes/origin/main 2>/dev/null)"
  if [ -z "$NOTARY_PUSHED" ]; then NOTARY_OFFBOX=no-remote
  elif [ "$NOTARY_LOCAL" = "$NOTARY_PUSHED" ]; then NOTARY_OFFBOX=current
  else NOTARY_OFFBOX=behind
  fi
fi

# ── 4 · off-box ─────────────────────────────────────────────────────────────
[ -d "$REPO/.git" ] || fail "no backup checkout at $REPO — see DEPLOY.md § The world2 backup lane" ship
git -C "$REPO" fetch -q origin main   || fail "backup repo fetch failed (deploy key? network?)" ship
git -C "$REPO" reset -q --hard origin/main
mkdir -p "$REPO/dumps"
cp "$DUMP" "$REPO/dumps/"
# roles.db rides in the SAME commit as the dump it is filed beside, so a clone
# on the one night anybody clones it carries who paid as well as what happened.
# Its own directory: a reader who finds this repo must not have to tell a 3 MB
# Postgres archive from a 24 KB SQLite file by reading the extension.
if [ "$ROLES_STATUS" = copied ]; then
  mkdir -p "$REPO/roles"
  cp "$ROLES_COPY" "$REPO/roles/"
fi

# The bundles this lane shipped before 2026-09-03 stay in the repo's history and
# in its tree, untouched. They are a closed record, not a stale copy pretending
# to be current, and a marker beside them says so — written once, after the
# reset so it lands in the tree this run commits, because a reader who finds
# notary/ in a clone three months from now must not have to date the filenames
# to learn which repo is live.
if [ -d "$REPO/notary" ] && [ ! -f "$REPO/notary/RETIRED.md" ]; then
  cat > "$REPO/notary/RETIRED.md" <<'RETIRED'
# These bundles are a closed record (frozen 2026-09-03)

Until 2026-09-03 the World 2.0 notary had no git remote, so `world2-backup.sh`
shipped its checkout here as a git bundle. That stopgap ended with DEC-7.

**The live certifications are at `wright-starforge/postmark-world2-notary`** —
a separate private repository, written by `world2-notary.sh` over a deploy key
scoped to that repo alone. It is separate ON PURPOSE: a certification stored
beside the backup it certifies cannot be the thing that catches the backup.

The bundles beside this file are whole repositories in one file each and still
open with `git clone <bundle> notary`, but they stopped at 2026-09-03 and
nothing adds to them. Verify against the notary repository, not against these.
RETIRED
fi

# Working-tree retention. History keeps every dump forever — that is the point
# of a git destination — but the tree stays small so a clone is quick when it
# matters, which is the one night anybody clones it.
ls -1 "$REPO/dumps"  2>/dev/null | sort | head -n -"$KEEP_DUMPS" | while read -r f; do git -C "$REPO" rm -q --cached "dumps/$f" >/dev/null 2>&1; rm -f "$REPO/dumps/$f"; done
ls -1 "$REPO/roles"  2>/dev/null | sort | head -n -"$KEEP_DUMPS" | while read -r f; do git -C "$REPO" rm -q --cached "roles/$f" >/dev/null 2>&1; rm -f "$REPO/roles/$f"; done
# NO retention pass over $REPO/notary any more, and its absence is deliberate:
# nothing adds to that directory now, so a count-based prune would only ever
# delete from a closed record — and RETIRED.md sorts before every bundle
# filename, so the first thing it would eat is the note explaining the rest.

WAL_BYTES=$(du -sb "$WAL" 2>/dev/null | cut -f1); WAL_BYTES=${WAL_BYTES:-0}
WAL_FILES=$(find "$WAL" -type f 2>/dev/null | wc -l)

cat > "$REPO/LATEST.json" <<JSON
{
  "at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "database": "$DB",
  "dump": "dumps/$(basename "$DUMP")",
  "dump_bytes": $DUMP_BYTES,
  "dump_toc_entries": $TOC_ENTRIES,
  "notary": {
    "repo": "github.com/wright-starforge/postmark-world2-notary (private, separate by DEC-7)",
    "offbox": "$NOTARY_OFFBOX",
    "checkout_head": "$NOTARY_LOCAL",
    "last_pushed": "$NOTARY_PUSHED",
    "read": "the notary checkout's own refs/remotes/origin/main — as of its last push, not a live probe; this lane holds no credential for that repo on purpose"
  },
  "on_box_only": {
    "basebackup_ok": $BASE_OK,
    "basebackup_bytes": $BASE_BYTES,
    "wal_archive_bytes": $WAL_BYTES,
    "wal_archive_files": $WAL_FILES
  },
  "roles_db": {
    "status": "$ROLES_STATUS",
    "source": "$ROLES_SRC",
    "file": $([ "$ROLES_STATUS" = copied ] && printf '"roles/%s"' "$(basename "$ROLES_COPY")" || echo null),
    "roles_db_bytes": $ROLES_BYTES,
    "role_audit_rows": $ROLES_AUDIT,
    "grant_rows": $ROLES_GRANTS,
    "how": "VACUUM INTO through node:sqlite from a READ-ONLY handle — never cp, which tears a live SQLite file",
    "why": "src/roles.mjs:71-82 — a grant exists nowhere else in the world, no repo holds it and no fold recomputes it; losing roles.db loses who paid",
    "read": "role_audit is append-only, so its count only ever grows; grant_rows is live standing and falls on a revoke",
    "absent_is_legal": "OFFICE_ROLE_GATES is unset on every office today (src/server.mjs:170), so a box that has never granted a role has no file to copy"
  },
  "restore": "pg_restore --clean --if-exists --no-owner --no-acl -d <db> dumps/<file>",
  "restore_roles": "cp roles/<file> /srv/postmark-office/roles.db (the office opens it at boot; it is a whole database, not a delta)"
}
JSON

git -C "$REPO" add -A
if git -C "$REPO" diff --cached --quiet; then
  echo "[world2-backup] nothing changed — not committing"
else
  git -C "$REPO" commit -q -m "world2 $DB backup $STAMP ($(numfmt --to=iec "$DUMP_BYTES"), $TOC_ENTRIES toc entries)" \
    || fail "commit failed" ship
fi
git -C "$REPO" push -q origin HEAD:main || fail "push failed — the dump is on the box and NOWHERE ELSE" ship
REMOTE_TIP=$(git -C "$REPO" ls-remote origin refs/heads/main | cut -f1)

# ── 5 · local retention ─────────────────────────────────────────────────────
ls -1t "$DUMPS"/world2-*.dump 2>/dev/null | tail -n +$((KEEP_DUMPS + 1)) | xargs -r rm -f
ls -1t "$DUMPS"/roles-*.db 2>/dev/null | tail -n +$((KEEP_DUMPS + 1)) | xargs -r rm -f
# The notary bundles this lane stopped making on 2026-09-03. A count-based rule
# would keep the newest fourteen of them on the disk forever, which is the
# residue class exactly — a cache with no ceiling, left behind by a lane that
# closed. Every one of them is in the backup repo's history already, so they are
# swept whole rather than trimmed to a number nothing will ever refresh.
ls -1 "$DUMPS"/notary-*.bundle 2>/dev/null | xargs -r rm -f
# Base backups, and the WAL that predates the OLDEST one kept. Pruning WAL past
# the oldest surviving base backup would leave a base backup that cannot be
# rolled forward — a backup that exists and cannot be used, which is the shape
# this whole file is written against.
ls -1dt "$BASEBACKUPS"/base-* 2>/dev/null | tail -n +$((KEEP_BASE + 1)) | xargs -r rm -rf
# WAL retention is BY AGE, with a full day of margin over the oldest base
# backup — deliberately, after getting it wrong the other way on the first run.
#
# The tempting rule is "delete WAL older than the oldest base backup we kept",
# and it is wrong: pg_basebackup runs with --wal-method=none, so restoring one
# needs the WAL written from its START LSN to its end, and a directory's mtime
# is its END. On a database this size the backup finishes inside one segment
# and the difference never shows; on a database big enough for the backup to
# span a segment boundary, that rule silently deletes the one segment its own
# base backup cannot start without. A backup that deletes its own prerequisite
# is the exact failure this file exists to not have.
#
# Base backups are nightly and KEEP_BASE of them are kept, so KEEP_BASE+1 days
# of WAL always covers the oldest one with a day to spare, and the rule needs
# no knowledge of LSNs to be obviously correct.
[ -d "$WAL" ] && find "$WAL" -type f -mtime +$((KEEP_BASE + 1)) -delete 2>/dev/null
WAL_BYTES_AFTER=$(du -sb "$WAL" 2>/dev/null | cut -f1); WAL_BYTES_AFTER=${WAL_BYTES_AFTER:-0}
WAL_FILES=$(find "$WAL" -type f 2>/dev/null | wc -l)   # recounted AFTER the prune

# The receipt gains the roles numbers rather than a receipt of its own, because
# the roll-call row that reads this file is the row that now covers roles.db:
# one lane, one heartbeat, one thing to watch. `roles_status` is the field that
# distinguishes the two silences a reader must never confuse — `absent` (no role
# was ever granted on this box) from a copy that FAILED, which exits 1 above and
# never reaches this line at all.
w2_state backup.json "$(printf '"status":"%s","database":"%s","dump_bytes":%d,"toc_entries":%d,"basebackup_ok":%s,"basebackup_bytes":%d,"wal_bytes":%d,"wal_files":%d,"roles_status":"%s","roles_db_bytes":%d,"role_audit_rows":%d,"grant_rows":%d,"remote_tip":"%s","destination":"github.com/wright-starforge/postmark-world2-backups (private)"' \
  "$([ "$BASE_OK" = true ] && echo shipped || echo shipped-no-basebackup)" \
  "$DB" "$DUMP_BYTES" "$TOC_ENTRIES" "$BASE_OK" "$BASE_BYTES" "$WAL_BYTES_AFTER" "$WAL_FILES" \
  "$ROLES_STATUS" "$ROLES_BYTES" "$ROLES_AUDIT" "$ROLES_GRANTS" "$REMOTE_TIP")"

echo "[world2-backup] $DB → $(numfmt --to=iec "$DUMP_BYTES") dump, $TOC_ENTRIES toc entries; remote main = $REMOTE_TIP"
echo "[world2-backup] on-box: basebackup=$BASE_OK ($(numfmt --to=iec "$BASE_BYTES")), wal $WAL_FILES files $(numfmt --to=iec "$WAL_BYTES_AFTER")"
echo "[world2-backup] roles.db: $ROLES_STATUS — $ROLES_AUDIT audit rows, $ROLES_GRANTS live grants, $(numfmt --to=iec "$ROLES_BYTES")"
[ "$BASE_OK" = true ] || exit 1
exit 0
