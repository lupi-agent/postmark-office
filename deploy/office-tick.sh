#!/bin/sh
# office-tick.sh — TRANSITIONAL. The tick was split on 2026-09-27 (POS-268):
#
#   deploy/office-keep.sh       the pulls, the mint and welcome pass, the
#                               settlements row, the panes
#                               (postmark-office-keep.timer, :07/:22/:37/:52)
#   deploy/office-rehydrate.sh  office.db + the world graph snapshot, and the door's receipt
#                               (postmark-office-rehydrate.timer, :09/:24/:39/:54)
#
# This file exists only for a box whose INSTALLED postmark-office-rehydrate
# unit still names it in ExecStart. A code deploy does not reinstall unit
# files, so without this wrapper the first deploy after the split would stop
# the pulls, the mint, the settlements row and the panes until someone copied
# the new units in. It runs both halves in the old order, so such a box behaves
# exactly as it did before the split.
#
# Delete it once the box runs the new units (DEPLOY.md § the tick split).
set -eu
HERE="$(dirname "$0")"
sh "$HERE/office-keep.sh"
sh "$HERE/office-rehydrate.sh"
