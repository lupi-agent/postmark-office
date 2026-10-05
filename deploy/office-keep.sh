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
  # settle-on-tick (Keemin, 2026-09-29; overturns #3231's "no timer"): every
  # join merged since the last tick is bound here — the pen's residency/* and
  # hand-written single-address joins — BEFORE the mint catch-up and the
  # welcome pass below. A handle bound first is paid its bundle under its
  # GitHub id; one bound after is paid under its card username, and binding it
  # then puts two welcome lines in one house (Wildcat, 2026-09-28). Inside this
  # flock, so the pass calls settle-join's critical section directly. NON-FATAL
  # like the mint: a join that cannot settle now is logged and asked again.
  node /srv/postmark-office/deploy/settle-pass.mjs \
      --town "$TOWN_CLONE" --cursor /srv/postmark-office/settle-pass.cursor \
    || echo "[office-keep] settle pass FAILED (non-fatal) — the lines above name why; the next tick asks again from the same cursor" >&2
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
  # anything this writes goes through the verify below it.
  #
  # ⚑ WHOLE OR NOTHING (POS-295, 2026-09-28). On 09-28 the verify failed on an
  # OLDER committed line (red since 13:59Z), the `&&` chain skipped the commit,
  # and nothing restored the file: Corey's appended welcome sat uncommitted in
  # the town clone from 18:37Z to 23:31Z, and every office write that pulls it
  # refused. Two rules now, both below:
  #   · CHECK BEFORE WRITING. A ledger that arrives red appends nothing, and the
  #     journal says the catch-up is off and why. A green arrival is the only
  #     state a new row is signed onto.
  #   · A FAILED CHECK AFTER WRITING PUTS THE CLONE BACK: the ledger's arrival
  #     bytes and no path the pass created, from an EXIT trap, so a tick killed
  #     mid-pass restores too (TERM/INT/HUP become exits so the trap runs; only
  #     SIGKILL escapes it). Discarding is safe because every row this pass
  #     writes is re-derivable: `--append` recomputes from the mail and the
  #     welcome plan re-reads the ledger, so the household waits one tick.
  # A pass that changed nothing skips the second verify: the arrival check
  # already read these exact bytes, so the quiet tick costs one verify, as before.
  # The trap disarms the moment the commit lands; a push that then fails leaves
  # a local commit, exactly as it did before this block.
  ( cd "$TOWN_CLONE" || exit 1
    LEDGER=WHITE_PAGES/stamp-ledger.md
    if ! node tools/stamp-verify.mjs; then
      echo "[office-keep] mint catch-up OFF — the ledger arrived red (stamp-verify above names the line), so this tick appended nothing; the catch-up resumes on the first tick that finds it green" >&2
      exit 0
    fi
    # The arrival copy lives in a directory THIS subshell owns: a stopped unit
    # signals the whole tick, and the outer shell must not be able to take the
    # copy away before this trap has put it back.
    HOLD="$(mktemp -d /tmp/postmark-tick-hold.XXXXXX)" || exit 1
    armed=0
    restore() {
      if [ "$armed" = 1 ]; then
        armed=0
        if cp "$HOLD/ledger.arrived" "$LEDGER" && git reset -q -- "$LEDGER"; then
          git ls-files --others --exclude-standard | grep -vxF -f "$HOLD/untracked.arrived" |
            while IFS= read -r made; do rm -f -- "$made"; done
          echo "[office-keep] mint catch-up ROLLED BACK — the ledger is back to its arrival bytes and every path the pass created is gone; the rows re-derive on the next tick" >&2
        else
          echo "[office-keep] mint catch-up ROLL-BACK FAILED — the town clone may hold uncommitted rows; git -C $TOWN_CLONE status" >&2
        fi
      fi
      rm -rf "$HOLD"
    }
    trap restore EXIT
    trap 'exit 143' TERM
    trap 'exit 130' INT
    trap 'exit 129' HUP
    cp "$LEDGER" "$HOLD/ledger.arrived" || exit 1
    git ls-files --others --exclude-standard > "$HOLD/untracked.arrived" || exit 1
    armed=1
    # POS-341: the mint decides from the store and commits its own lines in its
    # store transaction (world2/tools/stamp-mint-run.mjs). Those lines are in
    # HEAD now, so the arrival copy moves up to them: a roll-back below puts back
    # only what the welcome pass wrote.
    node /srv/postmark-office/world2/tools/stamp-mint-run.mjs --append --key /srv/postmark-office/stamp-key.pem \
        --clone "$TOWN_CLONE" --message "mint: tick catch-up pass" || exit 1
    cp "$LEDGER" "$HOLD/ledger.arrived" || exit 1
    node /srv/postmark-office/deploy/welcome-pass.mjs \
        --town "$TOWN_CLONE" --key /srv/postmark-office/stamp-key.pem \
      || echo "[office-keep] welcome pass had refusals (non-fatal) — the lines above name each one; the household keeps its claim and the next crossing asks again" >&2
    if ! cmp -s "$LEDGER" "$HOLD/ledger.arrived"; then
      node tools/stamp-verify.mjs || exit 1
    fi
    if ! git diff --quiet -- "$LEDGER"; then
      git add "$LEDGER" && git commit -qm "welcome: tick pass" || exit 1
      armed=0
      git push -q || exit 1
      # the welcome lines went to git from this shell: the store reads them now
      node /srv/postmark-office/world2/tools/stamp-lines.mjs --sync --clone "$TOWN_CLONE" || exit 1
    fi
    armed=0
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
# The same run then records which settlement carried each newly published mark
# (049, `mark_carried`) and adds a `carried:` line; a refusal there exits 1 with
# the settlement rows already committed, so the failure line names both tables.
if settled="$(node world2/tools/settlements-backfill.mjs --apply --prod --quiet --world-repo "$WORLD_CLONE" 2>&1)"; then
  echo "[office-keep] settlements: $settled"
else
  echo "[office-keep] settlements or carried rows NOT written (non-fatal) — $settled — the next tick tries again; world2/tools/settlements-backfill.mjs --verify and mark-carried-backfill.mjs --verify say where the tables stand" >&2
fi

# ── the positions snapshot, once per clearing (POS-302, 053) ─────────────────
# The newest closed window's snapshot of each resident's governing departure,
# written if that window has none, so the office's positions rebuild replays
# only the acts since. NON-FATAL and outside the clearing (Wright 2026-10-02): a
# failed snapshot never blocks a clearing or this tick, and the office reads the
# whole record until one exists. Same connection as the settlements rows above.
if snapped="$(node world2/tools/position-snapshot.mjs --apply --prod --quiet --world-repo "$WORLD_CLONE" 2>&1)"; then
  echo "[office-keep] $snapped"
else
  echo "[office-keep] positions snapshot NOT written (non-fatal) — $snapped — the next tick tries again; world2/tools/position-snapshot.mjs --verify says where it stands" >&2
fi

# ── one household, one mint key: the alarm's log line (Darko, 2026-10-04) ────
# The town's own predicate (tools/household-keys.mjs) over the frozen snapshot:
# every declared household mints under ONE key and no key spans two houses.
# One JSON line per tick, appended to the log the roll-call reads (the
# postmark-office-rehydrate.timer row's outcome block: alarm_on_nonempty
# split_households / shared_keys, alarm_on_false checked). NON-FATAL: a split
# is the alarm's to raise, never this tick's to stop on. A run that produced no
# JSON (the tool absent or crashed) still writes a line, `checked: false`, so
# "did not run" never reads like "found nothing".
HK_LOG="${HOUSEHOLD_KEYS_LOG:-/srv/postmark-harbor/household-keys.jsonl}"
hk_out="$(node "$SNAP/town/tools/household-keys.mjs" --json --repo "$SNAP/town" 2>&1)" || true
if node -e '
  const text = process.argv[1] ?? "";
  let j = null;
  try { j = JSON.parse(text.trim().split("\n").pop()); } catch {}
  const line = j && Array.isArray(j.split_households)
    ? { ...j, checked: true }
    : { at: new Date().toISOString(), checked: false, split_households: [], shared_keys: [], error: text.slice(0, 400) };
  process.stdout.write(JSON.stringify(line) + "\n");
' "$hk_out" >> "$HK_LOG"; then
  echo "[office-keep] household keys: $(printf '%s' "$hk_out" | tail -n 1 | cut -c1-300)"
else
  echo "[office-keep] household keys line NOT written to $HK_LOG (non-fatal) — the roll-call will read the log as stale" >&2
fi

# ── outside the lock: the panes, from the frozen snapshot ────────────────────
# publish-windows keeps its stage-and-swap: a failed publish leaves the live
# webroot untouched and fails the tick loudly.
node deploy/publish-windows.mjs --town "$SNAP/town" --out /var/www/postmark-panes/live
