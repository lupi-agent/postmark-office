#!/bin/bash
# world2-rehearsal-teardown.sh — everything world2-rehearsal-copy.sh made, removed.
#
#   world2-rehearsal-teardown.sh [--target world2_rehearsal]
#
# What the copy script grants, and therefore what this takes back — the whole
# list, so a reader can check the cluster against it by hand:
#
#   DATABASE world2_rehearsal                 (owned by rehearsal_runner)
#     → DROP DATABASE world2_rehearsal WITH (FORCE);
#   GRANT clearing_job TO rehearsal_runner WITH INHERIT FALSE, SET TRUE
#     → REVOKE clearing_job FROM rehearsal_runner;
#   GRANT law_ingester TO rehearsal_runner WITH INHERIT FALSE, SET TRUE
#     → REVOKE law_ingester FROM rehearsal_runner;
#   ROLE rehearsal_runner (LOGIN, NOINHERIT, NOCREATEDB, NOCREATEROLE)
#     → DROP ROLE rehearsal_runner;      (it owns nothing once the copy is gone)
#   FILE /srv/world2-lab/rehearsal/runner.pw   → removed
#
# The checkouts under /srv/world2-lab/rehearsal (tree/, town/, world/) and the
# kept receipts are left: they are files, not rights, and a receipt is evidence.
# `rm -rf /srv/world2-lab/rehearsal` removes them when nobody needs them.
#
# The target guard is the copy script's own (sourced, not copied), so a
# teardown can no more drop world2_dev than the copy can.

set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/world2-rehearsal-copy.sh"

TARGET="world2_rehearsal"
[ "${1:-}" = "--target" ] && TARGET="${2:-}"
rehearsal_target_ok "$TARGET" "world2_dev" || exit 2
REHEARSAL_DIR="${REHEARSAL_DIR:-/srv/world2-lab/rehearsal}"

pgsu() { sudo -n -u postgres psql -XAtq -v ON_ERROR_STOP=1 "$@"; }
pgsu -d postgres -c "DROP DATABASE IF EXISTS $TARGET WITH (FORCE)" || exit 1
if [ "$(pgsu -d postgres -c "SELECT count(*) FROM pg_roles WHERE rolname = 'rehearsal_runner'")" = "1" ]; then
  pgsu -d postgres <<'SQL' || exit 1
REVOKE clearing_job FROM rehearsal_runner;
REVOKE law_ingester FROM rehearsal_runner;
DROP ROLE rehearsal_runner;
SQL
fi
rm -f "$REHEARSAL_DIR/runner.pw"
echo "torn down: $TARGET dropped; rehearsal_runner's memberships revoked and the role dropped; runner.pw removed"
echo "left: $(pgsu -d postgres -c "SELECT count(*) FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.member WHERE r.rolname = 'rehearsal_runner'") memberships, $(pgsu -d postgres -c "SELECT count(*) FROM pg_roles WHERE rolname = 'rehearsal_runner'") role(s) named rehearsal_runner"
