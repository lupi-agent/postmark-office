#!/bin/sh
# regenerate the postmark awareness tally (postmark-office/tools/ops-awareness.mjs)
# — one weekly reading across the channels: followers and views, new households,
# new members of the Discord. Installed at /etc/cron.hourly/postmark-awareness-report
# (POS-282, 2026-09-28). It sorts AFTER postmark-activity-report, whose data.json
# twin it reads for the households, and BEFORE zz-postmark-ops-index, which reads
# its own twin.
#
# Runs as meepo, like every sibling. It reads no key: Bluesky, YouTube and the
# Discord invite are public pages, and Reddit and X come from the hand-kept
# deploy/awareness-by-hand.json in the office checkout.
exec /usr/sbin/runuser -u meepo -- /usr/bin/node /srv/postmark-office/tools/ops-awareness.mjs >> /var/log/postmark-awareness-report.log 2>&1
