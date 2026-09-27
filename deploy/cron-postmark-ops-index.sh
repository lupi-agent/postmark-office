#!/bin/sh
# regenerate the postmark ops HUB (postmark-office/tools/ops-index.mjs) — the
# /ops/ landing page, one card per dashboard with a live headline, a sparkline
# and that dashboard's own freshness. 2026-08-11.
#
# Installed at /etc/cron.hourly/zz-postmark-ops-index. THE zz- PREFIX IS LOAD-
# BEARING: run-parts runs cron.hourly in alphabetical order, and this reads the
# five siblings' data.json twins, so it has to run after postmark-activity-report,
# postmark-economy-report, postmark-git-report, postmark-traffic-report and
# postmark-world-report.
# Out of order it is not wrong — every card reports the twin's OWN generated_at,
# so staleness still shows honestly — it is just an hour behind for no reason.
#
# Runs as meepo, matching the sibling reports, so the files it writes into
# /var/www/postmark-ops/ carry the same ownership the dashboards do.
exec /usr/sbin/runuser -u meepo -- /usr/bin/node /srv/postmark-office/tools/ops-index.mjs >> /var/log/postmark-ops-index.log 2>&1
