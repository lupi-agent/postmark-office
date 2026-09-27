#!/bin/sh
# office-keep.sh — the office's keeping tick: the clones, the ledger, the
# settlements row and the panes. Split out of office-tick.sh (POS-268,
# 2026-09-27) so the rehydrate unit holds only the two hydrates and can be
# retired on its own: nothing here reads or writes office.db or world.db.
#
# Snapshot-under-lock / derive-outside, the same shape office-tick.sh had since
# 2026-07-30: the lock covers only the pulls, the mint pass and a
# `git clone --local` snapshot (seconds); the panes publish runs against the
# frozen snapshot, so the hold never grows with the town's history (pulse
# wright-2026-07-30-office-tick-lock-starves-write-paths).
#
# Runs on postmark-office-keep.timer at :07/:22/:37/:52 — the clock the whole
# tick ran on before the split, so the pulls, the mint, the settlements row and
# the panes are exactly as fresh as they were. deploy/office-rehydrate.sh
# follows two minutes later and reads the clones this leaves.
#
# Env (from /etc/postmark-office.env via the unit): TOWN_CLONE, WORLD_CLONE.
# Cwd: /srv/postmark-office (the unit's WorkingDirectory).

set -eu

LOCK="${TOWN_LOCK:-/srv/postmark-office/town.lock}"
SNAP="$(mktemp -d /tmp/postmark-tick.XXXXXX)"
trap 'rm -rf "$SNAP"' EXIT

# ── under the lock: mutate + snapshot (seconds) ──────────────────────────────
# The world clone gets FETCH, never pull: its checkout is the write pen's
# (ensureDraftCheckout reseats it per-write), and a pen branch diverged from a
# Worldkeeper rewrite is a NORMAL between-writes state — a pull there killed
# the tick with "Not possible to fast-forward" the first time S5's rewrite met
# an unpushed pen commit. Reads only need origin refs freshened. The town
# clone keeps --ff-only pull loud on purpose: its main diverging IS a fault.
(
  flock -w 300 9
  git -C "$TOWN_CLONE" pull --ff-only -q
  git -C "$WORLD_CLONE" fetch --prune -q origin
  # mint-on-tick (2026-08-06): a MANUAL crossing delivers without minting (the
  # key is box custody), opening an owed-window that used to last until the
  # next automated crossing — and a settlement landing inside it refuses
  # (S18, 06:00Z, correctly). This closes any such window within one tick.
  # Idempotent (--append skips recorded lines; no-op is the normal case);
  # non-fatal — the tick's real job is never held hostage by the mint, and a
  # red ledger stays the keeper's gate's finding. Same key the crossing signs
  # with, same flock we are already holding.
  # welcome-on-tick (2026-09-17): the welcome bundle (founder-ruled 09-14) is
  # ✦5 to every household once, at its first resident. It is NOT derived from
  # the mail, so `--append` above does not and cannot write it — the town's own
  # registry row, its grammar note and its `--welcome` header all say "the
  # office writes the bundle at a crossing", and until this line nothing did.
  # Measured on the train tip: 6 households admitted after the 09-14 by-hand
  # pass held no bundle and no scheduled thing would ever have paid them.
  #
  # ORDER IS LOAD-BEARING, and it is the town's refusals that fix it: `--welcome`
  # declines onto an unsettled tail ("run --append first") and declines a date
  # before the ledger's last. So it runs AFTER the mint pass and BEFORE verify,
  # inside this same flock, with the same key — its rows are verified and pushed
  # by the commit already below rather than sitting unsealed until the next tick.
  #
  # It mints only households the town's own `--welcome-plan` names, and the
  # town's once-per-household law refuses a second bundle on its own.
  #
  # ⚑ ITS EXIT IS SWALLOWED ON PURPOSE, and the first draft of this line got it
  # wrong. Chained with `&&`, one refused bundle would have stopped `stamp-verify`
  # and the commit below — stranding the `--append` rows that DID land, unsealed
  # and unpushed, until a later tick. A refusal means one household waits one
  # crossing; it must never hold the mint pass hostage. Bad rows are still caught:
  # anything this writes goes through the verify on the next line.
  ( cd "$TOWN_CLONE" && \
    node tools/stamp-mint.mjs --append --key /srv/postmark-office/stamp-key.pem && \
    { node /srv/postmark-office/deploy/welcome-pass.mjs \
        --town "$TOWN_CLONE" --key /srv/postmark-office/stamp-key.pem \
      || echo "[office-keep] welcome pass had refusals (non-fatal) — the lines above name each one; the household keeps its claim and the next crossing asks again" >&2; } && \
    node tools/stamp-verify.mjs && \
    { git diff --quiet -- WHITE_PAGES/stamp-ledger.md || { \
        git add WHITE_PAGES/stamp-ledger.md && \
        git commit -qm "mint: tick catch-up pass" && git push -q; }; } \
  ) || echo "[office-keep] mint catch-up FAILED (non-fatal) — run stamp-verify in the town clone" >&2
  git clone --local --quiet "$TOWN_CLONE" "$SNAP/town"
) 9>>"$LOCK"

# ── settlements-on-tick (postmark#2897, Wright-ruled 2026-09-17) ─────────────
# The store's `settlements` row FOLLOWS the keeper's tag, and the world fetch
# under the lock above is what carries the tag in: measured 2026-09-17, a plain
# `git fetch --prune origin` re-follows an annotated tag whose commit is already
# local (S71 deleted locally, back as a `tag` object on the next plain fetch).
# So the office learns of a blessing within one tick of it, which is exactly
# the freshness 1.0's own tag read has had all along ("tags ride the tick's
# existing fetch", src/settlements.mjs). Outside the lock, because the tool
# reads refs and a Postgres, never the clone's working tree, and the lock's
# hold is what the write path waits on. Idempotent: a present row is skipped,
# a moved tag is REFUSED with its number and nothing partial lands. NON-FATAL
# like the mint and the world hydrate — the tick's real work never waits on
# the store — and its one receipt line lands in this journal either way.
if settled="$(node world2/tools/settlements-backfill.mjs --apply --prod --quiet --world-repo "$WORLD_CLONE" 2>&1)"; then
  echo "[office-keep] settlements: $settled"
else
  echo "[office-keep] settlements row NOT written (non-fatal) — $settled — the next tick tries again; world2/tools/settlements-backfill.mjs --verify says where the table stands" >&2
fi

# ── outside the lock: the panes, from the frozen snapshot ────────────────────
# publish-windows keeps its stage-and-swap: a failed publish leaves the live
# webroot untouched and fails the tick loudly.
node deploy/publish-windows.mjs --town "$SNAP/town" --out /var/www/postmark-panes/live
