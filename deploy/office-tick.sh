#!/bin/sh
# office-tick.sh — the rehydrate tick, snapshot-under-lock / derive-outside shape.
#
# The lock protects exactly one thing: nobody reads the clones' working trees
# while they move. Only the pulls mutate the trees, so the lock covers the
# pulls plus a frozen snapshot of the town clone (git clone --local: hardlinked
# objects, full history — hydrate shells `git log`, so a bare archive won't do)
# and is released in seconds. The heavy derivation (hydrate + publish-windows)
# runs against the frozen snapshot and can take as long as the town has grown
# without a single resident write bouncing on the lock.
#
# Before this shape (2026-07-30), the whole chain ran inside flock: the hold
# grew with the town's entire history (~2 min measured) against 30-second
# write-path waits — every letter ever sent made every future write a little
# more likely to bounce. Pulse:
# wright-2026-07-30-office-tick-lock-starves-write-paths.
#
# THE TICK NO LONGER RESTARTS THE OFFICE (2026-08-11). It ends by WRITING files
# — office.db, world.db, the panes — and the office picks them up itself: it
# watches both stores and swaps its read handle in place. The last step here is
# therefore a receipt, not an act: poll the local door until it answers with the
# sha we just hydrated. Restarting the service is now only ever a code deploy,
# by hand. Before this, the restart WAS the reload, and it killed every live MCP
# session four times an hour.
#
# Env (from /etc/postmark-office.env via the unit): TOWN_CLONE, WORLD_CLONE.
# Optional: OFFICE_DOOR (default http://127.0.0.1:4380 — the unit's --port).
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
      echo "[office-tick] mint catch-up OFF — the ledger arrived red (stamp-verify above names the line), so this tick appended nothing; the catch-up resumes on the first tick that finds it green" >&2
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
          echo "[office-tick] mint catch-up ROLLED BACK — the ledger is back to its arrival bytes and every path the pass created is gone; the rows re-derive on the next tick" >&2
        else
          echo "[office-tick] mint catch-up ROLL-BACK FAILED — the town clone may hold uncommitted rows; git -C $TOWN_CLONE status" >&2
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
    node tools/stamp-mint.mjs --append --key /srv/postmark-office/stamp-key.pem || exit 1
    node /srv/postmark-office/deploy/welcome-pass.mjs \
        --town "$TOWN_CLONE" --key /srv/postmark-office/stamp-key.pem \
      || echo "[office-tick] welcome pass had refusals (non-fatal) — the lines above name each one; the household keeps its claim and the next crossing asks again" >&2
    if ! cmp -s "$LEDGER" "$HOLD/ledger.arrived"; then
      node tools/stamp-verify.mjs || exit 1
    fi
    if ! git diff --quiet -- "$LEDGER"; then
      git add "$LEDGER" && git commit -qm "mint: tick catch-up pass" || exit 1
      armed=0
      git push -q || exit 1
    fi
    armed=0
  ) || echo "[office-tick] mint catch-up FAILED (non-fatal) — run stamp-verify in the town clone" >&2
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
  echo "[office-tick] settlements: $settled"
else
  echo "[office-tick] settlements row NOT written (non-fatal) — $settled — the next tick tries again; world2/tools/settlements-backfill.mjs --verify says where the table stands" >&2
fi

# ── outside the lock: derive from the frozen snapshot (however long) ─────────
node src/hydrate.mjs --town "$SNAP/town" --db office.db.new
mv -f office.db.new office.db
# world.db rides the same tick — AT THE NEWEST BLESSING, never main (Keemin,
# 2026-09-18, postmark#2934: "shouldn't the bless override the tick?" — yes).
# The crossing commits its candidate to main and this tick's fetch carries it
# in within fifteen minutes; the keeper's `settlement/S<n>` tag is his
# judgment on it, and a refused crossing is never tagged. `--ref blessed`
# resolves the newest tag peeled to its commit (src/world-branches.mjs §
# blessed — the same resolution the fold serves, so store and fold agree), and
# the store stamps `as_of_settlement` / `candidate_ahead` for the doors. The
# fetch above is what carries a fresh tag in (a plain fetch re-follows an
# annotated tag whose commit is already local — measured 2026-09-17). Never
# HEAD — the pen parks this clone on draft branches, and a draft-stamped store
# can never be eligible. Non-fatal like the mint: the tick's real job is never
# held hostage, and a stale-but-good world.db beats no world.db. Interim until
# the read flip (POS-104) takes standing from the clearing's lock.
( node src/world-hydrate.mjs --world "$WORLD_CLONE" --ref blessed --db world.db.new \
    && mv -f world.db.new world.db ) \
  || echo "[office-tick] world hydrate FAILED (non-fatal) — world.db stays at its last good build" >&2
node deploy/publish-windows.mjs --town "$SNAP/town" --out /var/www/postmark-panes/live

# ── the receipt: the door is serving what we just built ──────────────────────
# Non-fatal like the mint and the world hydrate above, and for the same reason:
# the tick's real work is on disk and correct by the time we get here. A door
# still answering the old sha is a FINDING an operator must see in the journal,
# not a cause to fail a tick that did its job. So this exits 0 either way and
# says loudly which way it went.
#
# The snapshot's HEAD is the exact string hydrate stamped as `as_of` (it runs
# `rev-parse HEAD` against this same frozen clone), so the comparison is a sha
# against itself — no tolerance, no "recent enough".
WANT="$(git -C "$SNAP/town" rev-parse HEAD)"
DOOR="${OFFICE_DOOR:-http://127.0.0.1:4380}"
DEADLINE=$(( $(date +%s) + 45 ))
GOT=""
while :; do
  GOT="$(curl -s -o /dev/null -D - "$DOOR/town" | tr -d '\r' | sed -n 's/^[Xx]-[Pp]ostmark-[Aa]s-[Oo]f: *//p')"
  if [ "$GOT" = "$WANT" ]; then break; fi
  if [ "$(date +%s)" -ge "$DEADLINE" ]; then break; fi
  sleep 2
done
if [ "$GOT" = "$WANT" ]; then
  echo "[office-tick] door is serving $WANT — hot reload confirmed"
else
  echo "[office-tick] STALE DOOR (non-fatal) — hydrated $WANT, but $DOOR/town still answers '${GOT:-<no as-of header>}' after 45s. The office has NOT picked up the new office.db: journalctl -u postmark-office -n 50. (A code deploy still restarts by hand: sudo systemctl restart postmark-office.)" >&2
fi
