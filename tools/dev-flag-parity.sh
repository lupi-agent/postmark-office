#!/bin/bash
# dev-flag-parity.sh: does the dev office run PROD's flags? Check before any load
# test on dev, because a dev-only flag measures the flag, not the code.
#
#   bash tools/dev-flag-parity.sh            # prints only the flags that differ
#
# Compares every WORLD_*, W2_*, WORLD2_* (except URLs and secrets), OFFICE_*
# (except OFFICE_KEYS) between /etc/postmark-office-dev.env and
# /etc/postmark-office.env. It prints VALUES for flags only; any key naming a
# URL, key, token, secret or password is compared as present/absent and never
# printed.
#
# Why this exists (2026-09-27): the first w41 dev run "collapsed at 20 agents".
# A profile put 91% of the thread in placeWordsFrom, because dev alone ran
# WORLD_STORE_SHADOW=1 (it skips the place-words cache on purpose and computes
# every read twice) and W2_FOLD=store. With prod's flags the same code held 80.
set -u
BOX="${BOX:-meepo-ec2}"
ssh "$BOX" 'sudo -n bash -s' <<'REMOTE'
secret='URL|KEY|KEYS|TOKEN|SECRET|PASS|PW'
keys=$( (cut -d= -f1 /etc/postmark-office-dev.env; cut -d= -f1 /etc/postmark-office.env) | grep -E '^(WORLD_|W2_|WORLD2_|OFFICE_)' | sort -u)
for k in $keys; do
  d=$(grep -E "^$k=" /etc/postmark-office-dev.env | cut -d= -f2-); p=$(grep -E "^$k=" /etc/postmark-office.env | cut -d= -f2-)
  if echo "$k" | grep -qE "$secret"; then d=${d:+set}; p=${p:+set}; fi
  [ "$d" != "$p" ] && printf "%-24s dev=%-24s prod=%s\n" "$k" "${d:-(unset)}" "${p:-(unset)}"
done
echo "(only differing flags are listed; secrets as set/unset)"
REMOTE
