#!/bin/bash
# load-watch.sh: while a load test runs against the DEV office, watch PROD too.
#
#   bash tools/load-watch.sh [minutes] [label] >> ../load-watch.txt
#
# Every 30 s: prod's and dev's GET /release time (the cheapest request each
# office answers, so its latency is the time spent waiting for the thread) and
# the box's CPU. Dev and prod share one box and one Postgres, so a dev test that
# starves prod is a finding, not a side effect. On 2026-09-27 this watch showed
# prod at ~1 ms through every dev run, and it caught dev's 20 s timeouts from
# the first minute of the shadow-mode run.
set -u
MIN="${1:-30}"; LABEL="${2:-}"; BOX="${BOX:-meepo-ec2}"
for _ in $(seq 1 $((MIN * 2))); do
  ssh -o ConnectTimeout=10 "$BOX" 'r=$(curl -s -m 20 -o /dev/null -w "%{time_total}" http://127.0.0.1:4380/release); d=$(curl -s -m 20 -o /dev/null -w "%{time_total}" http://127.0.0.1:4381/release); c=$(top -bn1 | awk "/^%Cpu/{print 100-\$8}"); echo "$(date -u +%H:%M:%SZ) prod ${r}s dev ${d}s cpu ${c}%"' | sed "s/\$/ ${LABEL}/"
  sleep 30
done
