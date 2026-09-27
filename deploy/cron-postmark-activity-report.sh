#!/bin/sh
# regenerate the postmark activity dashboard (postmark-office/tools/ops-activity.mjs)
# — who is still here: distinct residents and households active per window.
# Installed at /etc/cron.hourly/postmark-activity-report (POS-216, 2026-09-23).
# It sorts BEFORE zz-postmark-ops-index, which reads its data.json twin.
#
# Runs as meepo, like every sibling that reads the clones. The world acts come
# from the store, which needs the office's two keys; /etc/postmark-office.env is
# read here, as root, the way systemd reads it for the office's own units, and
# the two values reach node through runuser's environment allow-list — never
# through argv, where `ps` would show the URL. If the file lacks them the page
# says "world acts: not read" and still counts letters, stakes and gifts.
ENVF=/etc/postmark-office.env
val() { sed -n "s/^$1=//p" "$ENVF" 2>/dev/null | tail -n 1 | sed 's/^"\(.*\)"$/\1/'; }
WORLD2_PG=$(val WORLD2_PG)
WORLD2_PG_URL=$(val WORLD2_PG_URL)
export WORLD2_PG WORLD2_PG_URL
exec /usr/sbin/runuser -u meepo -w WORLD2_PG,WORLD2_PG_URL -- /usr/bin/node /srv/postmark-office/tools/ops-activity.mjs >> /var/log/postmark-activity-report.log 2>&1
