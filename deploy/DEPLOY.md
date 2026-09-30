# Deploying the office to the atelier box (EC2, nginx/Ubuntu)

The same box that serves `starforge-atelier.online` and already pulls the town
repo ~every 30 min for the site extractor. The office rides that rhythm.

> **Live-truth note (2026-07-19):** the box's `/srv/postmark-office` is a plain
> file copy, NOT the git clone step 1 below describes — a code deploy is
> `scp src/<changed>.mjs meepo-ec2:/srv/postmark-office/src/` +
> `sudo systemctl restart postmark-office`, then probe a route whose response
> only the new code produces (a restart alone proves nothing). Discovered
> mid-deploy shipping POST /keys; this note is the backport.

## The weekly train (Keemin-directed 2026-08-23)

Feature branches merge into `train/2026-wNN`; the DEV office runs the train
branch (deploy dev src from the train tip). ~Weekly the train PRs into `main`;
the founder's Approve is the merge word; the merge cuts `release/2026-wNN[.n]`
(`.github/workflows/release-train.yml`). PROD deploys go FROM THE TAG — since
POS-60 the same workflow carries them (§ below); before that they were
hand-carried by the procedure in the live-truth note above, which remains the
break-glass. Never from main tip or a feature branch. Branches are
`train/*`, tags are `release/*` — the namespaces never collide. The record
repos (world, town) are train-exempt: their main is live by nature; world
ENGINE changes reach prod through the site's world pin riding the site train.

## The auto-deploy (POS-60, 2026-08-26)

`.github/workflows/release-train.yml` no longer only cuts the tag — it deploys
it, in the same run. **Nothing about the procedure changed; only the hand did.**
The workflow does the three steps the live-truth note above prescribes, in that
order, and goes red if any of them cannot be proven:

| the hand-carry | the workflow |
|---|---|
| `scp src/<changed>.mjs` from the tag | `git archive <tag>` → rsync onto the box |
| `sudo systemctl restart postmark-office` | the same, over ssh, with `sudo -n` |
| "probe a route whose response only the new code produces" | polls `GET /release` until it names this run's tag and sha |

**Prod code still only moves when the founder approves a train PR.** The
workflow deploys the tag that approval cuts. A main push whose subject carries
no train name cuts no tag and deploys nothing.

### The adoption gate — merging this changes nothing

Until the repo variable `OFFICE_AUTODEPLOY` is `on`, an automatic trigger cuts
the tag exactly as it always did **and stops**. Today's behaviour, unchanged;
the hand-carry stays the way code reaches the box.

```sh
gh variable set OFFICE_AUTODEPLOY --body on  -R postmark-town/postmark-office   # adopt
gh variable set OFFICE_AUTODEPLOY --body off -R postmark-town/postmark-office   # back to hand-carry
```

The gate exists because of an awkward, specific fact: **`workflow_dispatch` does
not appear in the Actions tab until the file is on the default branch**, so this
cannot be rehearsed before it is merged. Without the gate, the first thing the
machinery ever did in anger would be deploying prod, unrehearsed, the moment a
train landed. With it, the order is:

1. merge — nothing changes, the tag cuts as before;
2. dispatch against **dev**, walk the sandbox;
3. dispatch against **prod** with the standing tag — a redeploy of what is
   already running, so a failure costs a restart, not a release;
4. then set `OFFICE_AUTODEPLOY=on`, and train merges carry themselves.

`workflow_dispatch` is never gated — it is a human deliberately asking.

### The receipt: `GET /release`

The office now serves its own deploy stamp. The workflow writes `release.json`
into the tree it ships, and `src/release.mjs` reads it **once, at boot** — so an
answer carrying this run's tag can only come from a process that started after
this run's copy landed. That is what makes the probe a proof of restart rather
than a proof of file-copy, and it is pinned by `test/release-door.test.mjs`.

```sh
curl -s https://postmark.town/api/release
```

An office placed by hand has no stamp and answers `deployed: false`. That is
legal and silent — it boots exactly as it always did — but it never reads green
to a probe.

### What the deploy does NOT touch

The office root is a shared directory, unlike the site's webroot. Root-level
files sync **without `--delete`**; only the tag's own top-level directories get
a `--delete` sync. Since the tag has no such directories, everything the box
keeps under `/srv/postmark-office` that the repo does not know about is out of
reach by construction: `town-clone/`, `world-clone/`, `world-clone-pool/`,
`settlement-clone/`, `shadow-clone/`, `draft-locks/`, `node_modules/`, and the
root-level `town.lock`, `office.db`, `oauth.db`, `dynamic.db`,
`.git-credentials`, `git-metrics-token`, `stamp-key.pem`.

Three directories are excluded by name:

- **`telemetry/`** — the trap. It is tracked (`telemetry/github/*.json`) *and*
  box-written (`access-*.jsonl`, plus fresh gh snapshots the hourly cron writes
  and commits back later). Deploying it from a tag would delete the live access
  logs and roll the snapshots back to whenever the train was cut. The box is the
  writer here; the repo is the archive.
- **`.github/`** — CI config; nothing on the box reads it.
- **`.omc/`** — the orchestration layer's per-operator session state, untracked
  and gitignored since 2026-09-21 (Keemin, ROLLOVER 25). The exclusion is the
  second net, not the fix: the first net is that the tag no longer carries the
  directory, so `git archive` never puts it in `stage/` and this list never sees
  it. **The box's own copy is not deleted by this.** A directory absent from
  `dirs.txt` gets no `--delete` sync, and root-level files sync without
  `--delete` — so whatever `/srv/postmark-office/.omc/` holds on dev and prod
  stays until somebody removes it by hand.

**Nothing is installed into `/etc`.** `deploy/*.service`, `deploy/*.timer` and
the nginx confs land in `/srv/postmark-office/deploy/` as ordinary files and go
no further. Installing a unit or a vhost stays a hand step, deliberately: the
live copies on the box have drifted from the repo copies before, so read the
live file and backport it before ever installing over it.

### Dependencies

`npm ci --omit=dev` runs only when `package-lock.json`'s hash differs from the
marker left by the last install. With no marker and an existing `node_modules`,
the deploy **adopts** rather than reinstalls — this box has served the town for
months, its install is correct by demonstration, and the first auto-deploy is
the wrong moment to tear it down. If it is in fact wrong, the probe fails loudly.

**`sharp` is a native dependency** (postmark#2940, the media door's small
copies): the lockfile pins a prebuilt `@img/sharp-linux-x64` + libvips for the
box, so `npm ci` needs no compiler — but it does need the network to fetch
that binary, and a lockfile change is what triggers the reinstall above. The
office loads it lazily: a box whose binary failed to land still opens the
door and logs `no small copies` on each upload instead of refusing it.
The one-time backfill for originals that predate the copies is
`tools/media-thumbnails-backfill.mjs` (dry by default; `--apply` with the R2
env), run by hand after the ship.

### Rehearsing, and the redeploy lane

- **`workflow_dispatch` → target `dev`** deploys a tag to `/srv/postmark-office-dev`
  (unit `postmark-office-dev`, port 4381). `dev` is the default on the dispatch
  form on purpose. Note dev is behind Cloudflare Access, so only the loopback
  probe can run there — a runner gets a 403 either way.
- **`workflow_dispatch` → target `prod`**, blank tag, redeploys the newest
  `release/*` tag. This is the "put it back" button.
- **Pushing a `release/*` tag by hand** also deploys. The train's own tag push
  cannot re-trigger a workflow (it is made with `GITHUB_TOKEN`), which is
  precisely why the deploy job chains onto the tag-cutting job inside one run
  rather than living in a separate tag-triggered file that would never fire.

### Repo secrets it needs

`EC2_HOST`, `EC2_USER`, `EC2_SSH_KEY` — the same three names the site repo
already holds. Set them on `postmark-town/postmark-office`. The deploy user must own
`/srv/postmark-office` outright and hold passwordless sudo for `systemctl` on
the office units; the workflow's preflight checks both **before** copying a
single byte, and says which `chown` to run if the tree is not writable. A
permissions bounce is fixed by `chown`, never by escalating the copy to sudo.

### Rollback

`sudo systemctl stop postmark-office` (as below), or redeploy the previous tag
by `workflow_dispatch` with `target: prod` and that tag's name.

## One-time setup

```sh
# 1. code + clones (as the deploy user, e.g. under /srv)
sudo mkdir -p /srv/postmark-office && sudo chown $USER /srv/postmark-office
git clone https://github.com/postmark-town/postmark-office.git /srv/postmark-office
git clone https://github.com/keeminlee/postmark.git /srv/postmark-office/town-clone

# 2. secrets — NEVER in either repo
sudo tee /etc/postmark-office.env >/dev/null <<'EOF'
OFFICE_KEYS=<key>=<household>:<handle>[,<handle>];<key2>=...
TOWN_CLONE=/srv/postmark-office/town-clone
TOWN_PUSH=1
BOT_NAME=postmark-office[bot]
BOT_EMAIL=<bot-account-noreply-email>
EOF
sudo chmod 600 /etc/postmark-office.env

# 2b. pen credentials + identity on the town clone (the pen = the machine
#     GitHub account, e.g. postmark-pen: classic PAT, public_repo scope only,
#     write access to keeminlee/postmark and NOTHING else; token custody =
#     this box + the principal's password manager, never either repo)
git -C /srv/postmark-office/town-clone config credential.helper \
  "store --file /srv/postmark-office/.git-credentials"
printf 'https://postmark-pen:<TOKEN>@github.com\n' > /srv/postmark-office/.git-credentials
chmod 600 /srv/postmark-office/.git-credentials
git -C /srv/postmark-office/town-clone config user.name  "Postmark Pen"
git -C /srv/postmark-office/town-clone config user.email "<pen-noreply-email>"

# 3. units (office + the keeping tick + rehydrate + the ferry at the published crossings)
sudo cp deploy/postmark-office.service deploy/postmark-office-keep.{service,timer} \
        deploy/postmark-office-rehydrate.{service,timer} \
        deploy/postmark-ferry.{service,timer} /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now postmark-office postmark-office-keep.timer postmark-office-rehydrate.timer postmark-ferry.timer

# 4. nginx — two surfaces, one snippet:
#    - install deploy/nginx-api.conf as /etc/nginx/snippets/postmark-api.conf
#    - include it from BOTH server{} stanzas: the starforge-atelier.online one
#      (legacy, kept serving) and deploy/nginx-postmark-town.conf (canonical
#      domain since 2026-07-08; install as sites-available/postmark-town,
#      symlink into sites-enabled, cert via certonly --webroot as in its header)
#    - the snippet names zones, a cache and two maps that live in http{}, so
#      the conf.d files go in first or `nginx -t` refuses it. The first four are
#      the box's live files, byte for byte, as they stood 2026-09-27 01:05Z
#      (POS-267); the fifth is the /api/ timing log, which is not on the box yet.
#      The keyless zone's source is still deploy/nginx-rate-limit.conf.snippet
#      (its http{} half), as installed 2026-08-14.
sudo cp deploy/nginx-worldcache.conf /etc/nginx/conf.d/postmark-worldcache.conf
sudo cp deploy/nginx-present-grid.conf /etc/nginx/conf.d/postmark-present-grid.conf
sudo cp deploy/nginx-present-zone.conf /etc/nginx/conf.d/postmark-present-zone.conf
sudo cp deploy/nginx-api.conf /etc/nginx/snippets/postmark-api.conf
sudo cp deploy/nginx-api-timing.conf /etc/nginx/conf.d/postmark-api-timing.conf
sudo nginx -t && sudo systemctl reload nginx

# 5. the panes origin (household windows — postmark-windows Phase 0)
#    isolated origin: pane scripts run on panes.postmark.town, never on the
#    OAuth-holding postmark.town (see deploy/nginx-postmark-panes.conf header).
sudo mkdir -p /var/www/postmark-panes && sudo chown meepo:meepo /var/www/postmark-panes
sudo cp deploy/nginx-postmark-panes.conf /etc/nginx/sites-available/postmark-panes
sudo ln -s /etc/nginx/sites-available/postmark-panes /etc/nginx/sites-enabled/
sudo certbot certonly --webroot -w /var/www/certbot -d panes.postmark.town
sudo nginx -t && sudo systemctl reload nginx
node deploy/publish-windows.mjs --town "$TOWN_CLONE" --out /var/www/postmark-panes/live
# (the keeping tick republishes on every pull — deploy/office-keep.sh)

# 6. the harbor's own domain (1f4ee.town — 📮 U+1F4EE, "1 ferry 4 everyone")
#    NO new webroot: this vhost is a second door onto the SAME site tree, with
#    `location = /` serving the built /harbor/index.html at the root. DNS (A
#    records, apex + www → the box) must resolve BEFORE certbot, and the port-80
#    stanza must be live to answer the acme challenge — so install, reload, then
#    cert, then reload again.
sudo cp deploy/nginx-1f4ee-town.conf /etc/nginx/sites-available/1f4ee-town
sudo ln -s /etc/nginx/sites-available/1f4ee-town /etc/nginx/sites-enabled/
# first reload will fail nginx -t on the missing cert; if so, comment the two 443
# stanzas, reload, run certbot, uncomment, reload.
sudo certbot certonly --webroot -w /var/www/certbot -d 1f4ee.town -d www.1f4ee.town
sudo nginx -t && sudo systemctl reload nginx
# re-install nginx-postmark-town.conf in the same pass — it now 301s /harbor/ here
```

## Domains

`https://postmark.town` is the canonical public base (Porkbun, registered
2026-07-08; A records apex + www → the box). `PUBLIC_BASE=https://postmark.town/api`
— the `/api` suffix matters: nginx strips it when proxying, and oauth.mjs builds
endpoint URLs from it. `starforge-atelier.online/api` keeps serving as a legacy
alias (bearer tokens don't care about origin), but OAuth discovery on both
domains now advertises postmark.town endpoints, and the GitHub OAuth App's
single callback URL points at `https://postmark.town/api/oauth/github/callback`.
Root `/` on postmark.town 302s (not 301 — it becomes the site-hub) to the atlas.

`https://1f4ee.town` is the HARBOR's own domain (registered 2026-08-16; A records
apex + www → the same box). Same webroot, no second build: the vhost serves the
built `/harbor/index.html` at its root and mirrors the rest of the site as a
safety net for the page's root-relative refs, noindexed so it never competes with
postmark.town in search. `postmark.town/harbor/` 301s here permanently; the
snapshot at `postmark.town/harbor/data/harbor-snapshot.json` deliberately does
NOT move, because it is a published data address with readers of its own.

## Smoke (from anywhere)

```sh
curl -s -H "Authorization: Bearer <key>" https://postmark.town/api/town
```

## Notes

- **The tick split (POS-268, 2026-09-27).** `postmark-office-keep.timer`
  (:07/:22/:37/:52, `deploy/office-keep.sh`) pulls the town clone, fetches the
  world's tags, runs the mint catch-up and welcome pass, writes the settlements
  row and publishes the panes. `postmark-office-rehydrate.timer`
  (:09/:24/:39/:54, `deploy/office-rehydrate.sh`) only rebuilds `office.db` and
  `world.db` from those clones. A box still running the pre-split rehydrate
  unit runs both halves through the transitional `deploy/office-tick.sh`. To
  adopt: step 3's copy, `daemon-reload`, `enable --now
  postmark-office-keep.timer`, restart the rehydrate timer, then delete
  `office-tick.sh`.
- **The town index (POS-268, 2026-09-30), PARKED.** office.db's tables have
  twins in the store (`world2/schema/033_town_index.sql`), kept by
  `postmark-town-index.timer` (:05/:20/:35/:50, `deploy/town-index-ingest.sh`,
  the `law_ingester` pen): a snapshot at each crossing's seal, then only the
  commits since. Nothing reads them until `TOWN_INDEX_READS=store`; the shape
  and what is left are in `docs/town-index-store.md`. To adopt, in order: apply
  033 as `world2_owner`; copy the script to `/srv/world2-lab/ops/`; run the seed
  by hand (the script's header has the line); install and enable the timer.
- The rehydrate timer rebuilds the index every 15 min. It **builds `office.db.new` and renames it
  over `office.db`, and stops there** — the office watches both stores and swaps
  its read handle in place (2026-08-11). **A restart is now for code deploys
  only; data flows by hot-reload.** The tick's last step is a receipt, not an
  act: it polls `127.0.0.1:4380/town` until `X-Postmark-As-Of` equals the sha it
  just hydrated, and prints a loud stale-door warning (non-fatal) if 45 s pass
  without it. The operator's receipt is the same fact from the other side —
  `systemctl show postmark-office -p ActiveEnterTimestamp` frozen at the last
  code deploy while `curl -sI .../api/town | grep -i as-of` keeps advancing. If
  that timestamp moves on the quarter-hour, something is still restarting the
  service and the reload is not doing its job.
- `X-Postmark-As-Of` on every response tells you exactly how fresh the index is.
- **Incremental-hydration trip-wire.** The full rebuild-from-clone is deliberate:
  it exercises the constitution ("DB rebuildable from a clone") on every tick,
  so the rebuild path can't rot. Measured 2026-07-08: ~2.5 s at 31 residents /
  427 letters — leave it alone. If a full rebuild ever exceeds **~30 s**, add
  incremental hydration (`git diff --name-only <as_of>..HEAD` → re-parse only
  touched residents/letters, upsert) on the fast tick and demote the full
  rebuild to a nightly constitution check — never remove it entirely.
- Rollback: `systemctl stop postmark-office` — the site and the PR door are
  untouched by anything the office does.

### The world write pool (tier 1, 2026-08-05)

The two draft-branch write lanes — `world_leave_mark` and `world_note`, which
write `draft/<household>` — no longer share the world clone's one working tree.
They lease from a pool of `git worktree`s of that same clone, so two households
write at once. Nothing in this directory changes; the tick and the ferry keep
their exclusive `flock` on `town.lock` and the pooled writes take a SHARED one,
which excludes them exactly as before. The other four write lanes (walk, ballot
stake, gift, world stake) append shared files on main and keep the old global
exclusive lane, unchanged.

What appears on the box:

- `world-clone-pool/wt-0 … wt-N` beside the world clone — created lazily on
  first use, then permanent. They share the object store, so each costs its
  checkout (~7 MB), not the history. Deleting them while the office is stopped
  is safe; `git -C world-clone worktree prune` afterwards.
- `draft-locks/<household>.lock` beside `town.lock` — the per-household
  exclusive lock, held only for the length of one write.
- One extra log term: `[town-lock] leave-exec.mjs total=… lease=…ms slot=wt-2`.
  `lease` is how long that write waited for a free worktree; a `lease` that is
  routinely large means the pool is too small for the traffic, and nothing else
  does.

Env (all optional): `WORLD_POOL_SIZE` (default 4 — size it to concurrent
writers, not to households), `WORLD_POOL_DIR`, `WORLD_POOL_LOCK_DIR`.
**`WORLD_POOL=0` is the rollback**: the draft lanes go back to the single shared
checkout under the exclusive lock, with no other behaviour change. Set it in
`/etc/postmark-office.env` and restart — no code revert, no worktree cleanup
needed (an idle worktree still parked on a branch is not in the way).

First boot after this ships, the office moves the shared clone off whatever
household branch the old pen left it on and back to `main`, once, and says so:
`[world-pool] shared clone moved off draft/<x> → main`. That clone stands on
main from then on, which is what the read path always wanted from it.

## The site sentinel (loud notice when the town is down or stale, 2026-08-25)

`tools/site-sentinel.mjs`, every 10 min via `postmark-site-sentinel.timer`.
Built the day the site's half-hourly "Sync Postmark atlas" failed on every run
for a day beside a green "Deploy" and nobody was told, in answer to the
founder's question: *"how can we LOUDLY BE NOTIFIED when something is down on
the site?"*

It watches **outcomes, not pipelines** — the doors answer, the served build
stamp is current, the office's index is current, the deployed Ferry's Daily is
the town's current one — because an outcome probe catches causes nobody
predicted. The workflow conclusions are read too, as a second opinion: a red
pipeline beside green outcomes is a finding, and a green pipeline beside a red
outcome is a lie.

It records nothing and repairs nothing. No pen, no clone, no `town.lock` —
same posture as `postmark-harbor-watch` and `postmark-usdc-watch`.

**Install (all of it is Wright's hand; nothing here is installed):**

```sh
sudo cp deploy/postmark-site-sentinel.{service,timer} /etc/systemd/system/
sudo mkdir -p /srv/postmark-sentinel && sudo chown meepo /srv/postmark-sentinel

# the alert channel — NEVER in either repo
sudo tee /etc/postmark-sentinel.env >/dev/null <<'EOF'
SENTINEL_DISCORD_WEBHOOK=https://discord.com/api/webhooks/<id>/<token>
EOF
sudo chmod 600 /etc/postmark-sentinel.env

sudo systemctl daemon-reload
sudo systemctl enable --now postmark-site-sentinel.timer

# see the board once before the timer owns it
sudo -u meepo systemctl start postmark-site-sentinel
journalctl -u postmark-site-sentinel -n 30 --no-pager
cat /srv/postmark-sentinel/status.json | head -40
```

- **The webhook is one URL the founder creates** in whichever Discord channel
  should ring. Without it the watch still runs every probe and still writes the
  board — it says so on stderr and on the board itself (`alerting.configured:
  false`). That visible degradation is deliberate: a sentinel that falls silent
  is indistinguishable from a healthy town.
- **GitHub auth is optional.** Both repos are public, so it works keyless
  inside the anonymous 60-per-hour budget; it spends at most **2 REST calls per
  tick** (12/hour) because every SHA comes from `git ls-remote` (git wire
  protocol, no REST budget) and all workflow conclusions come from one combined
  `/actions/runs` read. The unit points `SENTINEL_GITHUB_TOKEN_FILE` at the
  box's existing read-only `/srv/postmark-office/git-metrics-token`, which
  simply raises the ceiling. *(Measured 2026-08-25: a conditional request
  answering `304 Not Modified` still spends one of the 60 — ETags buy bandwidth
  here, not budget.)*
- **Publishing the board off-box needs an nginx block**, which is written out —
  reviewable, not installed — in `deploy/nginx-sentinel.conf.snippet`. The
  sentinel does not need it; the alert reaches Discord over an outbound POST
  either way. It only makes `/ops/sentinel.json` readable so the operator round
  can poll it the way it already polls the harbor snapshot.
- **Alerting is edge-triggered:** once on OK→bad, one reminder every 12h while
  it stays bad, once more on recovery. Never one ping per tick — a channel that
  pings every ten minutes is a channel the reader mutes, and a muted channel
  reproduces the original silence exactly.
- **Depends on `/build.json`**, which the site repo emits at build time
  (`postmark-site/tools/build-stamp.mjs`). Until that ships, the two
  site-freshness probes report `UNKNOWN` — never green — and say where the fix
  lives.
- **Known gap, named not papered over:** the sentinel cannot see its own death.
  If this box is down or the timer is masked, nothing here alarms. That needs an
  off-box heartbeat and is deliberately out of scope.

## The operator dashboards (`/ops/`, hub generated since 2026-08-11)

Seven static surfaces under `/ops/`, all written to `/var/www/postmark-ops/`
(outside the site webroot, so a site rsync never clobbers them) and served by
the aliases in `nginx-postmark-town.conf`:

| path | written by | cron |
|---|---|---|
| `/ops/` | `tools/ops-index.mjs` | `/etc/cron.hourly/zz-postmark-ops-index` |
| `/ops/traffic/` | `tools/traffic-report.mjs` | `/etc/cron.hourly/postmark-traffic-report` |
| `/ops/git/` | `tools/git-report.mjs` | `/etc/cron.hourly/postmark-git-report` |
| `/ops/economy/` | `tools/economy-report.mjs` | `/etc/cron.hourly/postmark-economy-report` |
| `/ops/world/` | `tools/world-report.mjs` | `/etc/cron.hourly/postmark-world-report` |
| `/ops/activity/` | `tools/ops-activity.mjs` | `/etc/cron.hourly/postmark-activity-report` |
| `/ops/awareness/` | `tools/ops-awareness.mjs` | `/etc/cron.hourly/postmark-awareness-report` |

`/ops/desk/` is the exception: it is site-built (astro) and keeps its own more
specific nginx location.

**The hub reads its siblings.** Each card's number, sparkline and freshness chip
come from that dashboard's own `data.json` twin, so the hub must run last —
hence the `zz-` prefix (run-parts is alphabetical). Every card reports the
twin's own `generated_at`, so a hub that runs out of order is an hour behind but
never dishonest. `/var/www/postmark-ops/data.json` is the freshness roll-up: one
file to poll instead of five.

**Installing the hub the first time** (2026-08-11 change; do these together):

1. `install -m 755 deploy/cron-postmark-ops-index.sh /etc/cron.hourly/zz-postmark-ops-index`
2. Re-install `nginx-postmark-town.conf` — it now carries `location = /ops/`
   pointing at the box file. **Read the live copy first and backport anything it
   has that this one doesn't**; the box copy has drifted before.
3. Stop shipping the site's own `ops/index.html`. The astro page at
   `postmark-site/town/pages/ops/index.astro` is now shadowed by the exact-match
   location and should be retired in that repo — until it is, it sits in the
   site webroot unreachable, which is a trap for the next person.
4. `nginx -t && systemctl reload nginx`, then run the generator once by hand so
   `/ops/` is not a 404 until the top of the hour.

**Running a generator off the box.** All five take env overrides for their
sources and output, so a dev machine can build the real page against sample or
cloned data before anything ships: `TRAFFIC_ARCHIVE`, `TRAFFIC_GITHUB`,
`OFFICE_TELEMETRY`, `NGINX_LOG_DIR`, `TRAFFIC_REPORT_OUT`; `TOWN_CLONE`,
`GIT_REPORT_OUT`, `GIT_REPORT_NO_FETCH=1` (render from the PR cache, no GitHub
token); `WORLD_CLONE`, `WORLD_REF`, `ECONOMY_REPORT_OUT`, `OUT_DIR`; `OPS_ROOT`;
`ACTIVITY_OUT`, `ACTIVITY_ACTS_FILE`, `ACTIVITY_NOW` (or `--town`, `--telemetry`,
`--acts`, `--out`, `--now`); `AWARENESS_OUT`, `AWARENESS_BY_HAND`,
`AWARENESS_ACTIVITY`, `AWARENESS_NOW`, `AWARENESS_OFFLINE=1` (or `--out`,
`--by-hand`, `--activity`, `--now`, `--offline`).

**Installing `/ops/activity/`** (POS-216): `install -m 755
deploy/cron-postmark-activity-report.sh /etc/cron.hourly/postmark-activity-report`,
then run it once by hand. It reads the store's `acts` with the office's own two
keys from `/etc/postmark-office.env`; without them the page says the world acts
were not read and counts the ledgers alone.

**Installing `/ops/awareness/`** (POS-282), all three together:

1. `install -m 755 deploy/cron-postmark-awareness-report.sh /etc/cron.hourly/postmark-awareness-report`
   (it sorts after `postmark-activity-report`, whose twin it reads for new
   households, and before `zz-postmark-ops-index`).
2. Add the `location /ops/awareness/` block from `nginx-postmark-town.conf` to
   the live config (read the live copy first, as above), then
   `nginx -t && systemctl reload nginx`.
3. Run it once by hand so the page is not a 404 until the top of the hour.

It reads no key. Bluesky's followers, YouTube's subscribers and channel views,
and the Discord invite's member count come from public pages; Reddit and X come
from `deploy/awareness-by-hand.json`, one entry per ISO week, which the page
labels "entered by hand, <date>". Its history is `history.jsonl` in the page's
own directory, one line per week: the current week's line is rewritten each
hour, so a week keeps its last reading. Deleting that file loses the history.

## Branch previews (`/preview/<slug>/`, 2026-07-20)

Branch builds of the town site, served noindexed at
`https://postmark.town/preview/<slug>/` for reveal-bundle QA on real URLs
(not localhost). Run from a machine with the site clone:

```sh
node tools/preview-deploy.mjs <branch>
```

It builds the branch from a throwaway git worktree (main checkout untouched)
with `PREVIEW_BASE=/preview/<slug>/` → the town config's `build.assetsPrefix`
(NOT Astro `base`, which breaks the town's static build on 6.4.0 — see the
config's own comment), then ships `dist` to `/var/www/postmark-preview/<slug>/`
via tar → scp → sudo stage-and-swap. nginx serves that tree under `/preview/`
with `X-Robots-Tag: noindex, nofollow` (`nginx-postmark-town.conf`). The tool
fails loud if the branch lacks the `PREVIEW_BASE` config plumbing.

Caveat: hand-written root-relative refs (`/data`, `/media`, nav hrefs) resolve
to prod on a preview — the bundled CSS/JS (what drives the render) get the
prefix; publicDir images come from prod. Fine for reveal QA.

**Cleanup is by hand** (no auto-GC yet):
`ssh meepo-ec2 sudo rm -rf /var/www/postmark-preview/<slug>`

## The ferry on the box (consolidation, decided 2026-07-08)

The box is the ferry's operational home — one machine, one pen, one lock, for
every machine write to the town. The ferry **code** stays in the town repo
(`tools/ferry.mjs` — resident-auditable town law; ledger-derived dedupe;
TOWN_TZ-aware dating); the box only executes it at the published crossings
(00:00/12:00 UTC). Crash recovery for the persistent clone lives in the unit
(reset + WHITE_PAGES-scoped clean under the shared flock — a crashed run's
letters return to their outboxes and re-sweep idempotently).

**Load-bearing law (ships with P4's TOWN-RULES amendment):** the box runs
repo-shipped code with the pen's write authority, so `tools/` and
`.github/` changes are NEVER witness-certifiable — human merge only. The
pen's token deliberately lacks the `workflow` scope, so it cannot alter the
town clock even if compromised.

### Cutover checklist (run once, supervised)

1. Pre-flight: parity audit PASSED 2026-07-08 (twin carries folder letters,
   id-safe delivery, never-overwrite guard; ledger parse = 100% of real
   entries; TOWN_TZ fix landed `6a4fc9c`).
2. Pause the PC Scheduled Tasks (`CommonsFerry`, `CommonsFerryAM`) — never
   two live ferries.
3. One supervised crossing on the box: `systemctl start postmark-ferry`;
   verify ledger line, pen-authored commit, delivery on disk, no bounce
   regressions.
4. Retire the PC tasks (disable, don't delete — break-glass); mark
   `G:/Starstory/tools/commons-ferry.mjs` break-glass in its header;
   `G:/Starstory/data/commons.sqlite` is dead state (ledger is the dedupe).
5. Re-declare to Loam: retire `CommonsFerry`/`CommonsFerryAM` from the
   windows-scheduler allow-list; declare the box ferry (evidence contract =
   ledger commits / `WHITE_PAGES/mail-ledger.md` fresh lines).
6. The Actions town-clock ferry job stays exactly as-is: gated,
   manual-dispatch break-glass.

## The one-hand rule (2026-08-20, after the stranded-crossings incident)

**meepo is the only hand that touches `/srv/postmark-office`. Root never
writes there — not a file, and NEVER git.** The 08-19 ship night updated
the world clone with `sudo git pull`; the root-owned objects it fetched
sat harmless until the first external push to world main made the clone
fetch again, which it no longer could ("insufficient permission") — so
crossings committed locally, pushed nothing, and the site (reading the
office's own ledger) looked perfect while durability forked. A resident's
letter found it before we did.

- A deploy scp that bounces on permissions is fixed by `chown`, never by
  escalating the deploy to sudo.
- Root's system crons that touch the clones drop privileges:
  `runuser -u meepo -- …` (the pattern economy/git/ops-index always had;
  world-report joined 2026-08-20).
- `ubuntu` is the AMI's break-glass admin login only. It owns nothing of
  Postmark's and runs nothing; day-to-day entry is the meepo door.

---

# The funding machine — staged adoption

Founder-driven restructure, 2026-08-25. His concern in its own shape: *"every
solution you implement here is one that I need to learn… every system is more
weight, more possibility of drift, more possibility of migration later."*

So this is not a system that arrives. It is **Stage A**, which is one command,
and **Stage B**, which is the same rules with the typing removed, sitting inert
until Stage A is tedious enough to be worth replacing.

## THE ANTI-WEIGHT CONTRACT

Every piece below is **additive** and **severable**:

- turning any piece off is one command, and the town then behaves **exactly as
  it does today** — not approximately, not after a cleanup;
- nothing a piece wrote is stranded by turning it off. Ledger rows a watcher
  wrote are ordinary pot-receipts, indistinguishable from hand-pasted ones,
  because they were written by the same recorder;
- no piece owes a migration to any later piece. The wallet registry's journal is
  already the shape the future door act appends; the intake map is already the
  shape a second address slots into;
- every piece is described in **half a page** — what it is, where it lives, the
  off switch, what returns to manual. If a piece stops fitting in half a page,
  that is a defect in the piece.

Nothing here is installed by merging. Merging Stage A gives you a command you
may run. Merging Stage B gives you files on disk that do nothing.

---

## STAGE A · `funding-report` — the default, and possibly the end of it

**What it is.** One read-only command that prints the town's whole funding
state: every payment it can see, the pot and hand each one resolves to *by the
same rules Stage B would use*, the anomaly queue with what resolves each row,
and — for every unwitnessed payment — the exact one-line command that records
it.

**Where it lives.** `tools/funding-report.mjs` in the office repo. It writes
nothing, stores nothing, installs nothing. Reading Stripe live needs
`STRIPE_KEY` in the environment (see Stage B's env file — one file serves both);
without it the report says the card rail was **not read**, which is a different
answer from "no card payments".

```sh
cd /srv/postmark-office
sudo -u meepo env $(grep -h . /etc/postmark-office.env /etc/postmark-stripe-watch.env | xargs) \
  node tools/funding-report.mjs --out /srv/postmark-office-reports/funding.md
```

Then paste one printed line per payment. Each is
`flock … node …/src/fund-exec.mjs '<payload>'` — the office's own recorder, the
town's own `epoch-close --receipt`, which enforces ref-uniqueness and the pot
cap itself. **Re-running one is safe**: the ledger refuses a ref it already
holds.

**The off switch.** Do not run it. There is no residue.

**What returns to manual.** Nothing — Stage A *is* the manual path, with the
matching done for you.

**The one thing to know.** Stage A has no timer, so it has no grace window. A
payment that arrived minutes ago is listed like any other, marked recent. Check
the typed handle on a recent row before pasting.

**A wrong or unattributed payer can be corrected until the pot closes.** A
receipt recorded as `outside:stripe`, or to the wrong hand, is re-attributed by
a founder-signed `pot-correction` line, written by the town's own verb (and by
nothing else: no door, no watcher):

```sh
node <town-clone>/tools/epoch-close.mjs --correct-hand --ref <ref>   --from <old-payer> --to <new-payer> --reason <token> --by <who>   --date YYYY-MM-DD --key FILE
```

The pot's epoch close pays holo to whoever each receipt names at that moment,
and writes one holo line per receipt, which spends that ref's one mint chance.
**After the close, attribution is final.** So before running a close, list the
pot's `outside:stripe` receipts and correct the ones whose giver is known. Five
were corrected this way between 2026-08-27 and 2026-09-19.

---

## STAGE B · the pieces, each inert until adopted

### `stripe-watch` — the card rail on a clock

**What it is.** Stage A's card-rail resolution, run every 15 minutes, recording
what it resolves after a one-crossing (12h) grace window. Same rules, same
recorder, no paste.

**Where it lives.** `tools/stripe-watch.mjs`; unit
`deploy/postmark-stripe-watch.{service,timer}`; credential
`/etc/postmark-stripe-watch.env` (mode 600, `STRIPE_KEY` = a **restricted
read-only** Stripe key, Checkout Sessions = Read and nothing else); state and
the operator intake journal under `/srv/postmark-stripe/`.

**Adopt.** `sudo systemctl enable --now postmark-stripe-watch.timer`

**Off switch.** `sudo systemctl disable --now postmark-stripe-watch.timer`

**What returns to manual.** Stage A: read the report, paste a line per card
payment. Receipts already written stay valid and were written by the same
recorder your paste would have used. The journal under `/srv/postmark-stripe/`
becomes inert; Stage A stops needing it the moment `STRIPE_KEY` is present,
because it reads Stripe live.

**Know before adopting.** It WRITES (unlike `usdc-watch` and `harbor-watch`), so
it needs the pen from `/etc/postmark-office.env` and takes `town.lock`. A refund
after the grace window stands — the ledger has no row kind that unwitnesses a
dollar.

**The grace window is the cheap fix, not the only one.** While a session is
held, the intake journal (and the service's journal line, `HOLD … typed: …`)
shows the payer it is about to resolve to. After the window, a wrong payer is
fixed by the `pot-correction` in Stage A above, which holds until the pot closes.
A typed GitHub username pinned to two residents of one household resolves to
`outside:stripe` today: a known gap (the same one-human-household split
Household Primary Key closed for the join bundle, 2026-09-29).

### `usdc-watch` auto-witness + the wallet registry

**What it is.** `usdc-watch` already sees arrivals and reports them. Adopting
this lets it *record* the narrow case where the office can prove both halves: an
arrival from a **registered** address at an address that names **one** pot.
Everything else stays a report.

**Where it lives.** `tools/usdc-watch.mjs`; the registry at
`/srv/postmark-wallets/registrations.jsonl` (mode 600, owner `meepo`), read by
`src/wallet-registry.mjs`.

**The registry is OFFICE-SIDE and never the town repo** — founder-ruled
2026-08-25 ("what if I don't want wallet information in the town repo?"). It is
an append-only journal, one act per line:

```json
{"at":"2026-08-26T01:00:00Z","act":"register","handle":"jetto-of-starforge","chain":"base","address":"0x…","by":"operator-pen"}
{"at":"2026-08-27T00:00:00Z","act":"revoke","address":"0x…","by":"operator-pen"}
```

Later acts win; a revoke is an append, never an edit. It is a journal rather
than an object **so the follow-up owes no migration**: the authenticated
`household do: "register-wallet"` door act appends the identical line.

*The honest consequence, stated because the founder ruled with it in front of
him:* a **claimed** payment already publishes wallet↔handle — the receipt's ref is
`usdc:base:<txhash>`, the ledger is public, and the chain shows the from-address.
So this protects only **registered-but-unclaimed** wallets, and it moves
hand-binding verification from public replay to office-side. Accepted trade.

**Adopt.** Create the file (`sudo -u meepo mkdir -p /srv/postmark-wallets`, then
append one `register` line per wallet) and enable the usdc timer if it is not
already running. With no file, the registry is empty and the watch witnesses
nothing — which is today's behaviour.

**Off switch.** Rename the registry aside (`registrations.jsonl` →
`registrations.jsonl.off`) — the registry reads empty, and every arrival goes
back to being reported and not recorded. Or disable the timer to stop reading
the chain at all.

**What returns to manual.** The patron pastes their hash at `/fund/` as they do
today, or you paste the line Stage A prints.

### `deploy/intake-addresses.json` — which address means which pot

**What it is.** A map from a USDC intake address to the pot it funds. **It ships
empty of pots on purpose**: the town has one intake address serving two open
pots, so no arrival can name a pot and every one stays ambiguous. This is the
mechanism waiting for a second address, not dead code.

**Where it lives.** In the office repo, read by `tools/usdc-watch.mjs`.

**Adopt.** Mint a per-pot intake address and add one row per pot. From that
moment the chain itself names the pot.

**Off switch.** Remove the rows. Every arrival returns to pot-ambiguous.

**Never** map the shared address to a pot to make the queue go away — that makes
the office decide where a stranger's money went.

### The sink rule — unclaimed money after 7 days

**What it is.** An unclaimed arrival from an **unregistered** address, older
than 7 days, witnessed as an outside gift to the `darko-fund` pot. **Implemented
and OFF.**

**Where it lives.** `tools/usdc-watch.mjs`; the flag is `USDC_SINK_UNCLAIMED=1`
in the usdc unit's environment.

**Adopt.** Set the flag on the unit. Every report already lists what the rule
*would* take, so the decision is made on real numbers rather than in the
abstract.

**Off switch.** Unset the flag. Nothing it already witnessed is affected — those
are ordinary receipts.

**What returns to manual.** Unclaimed money stays in the operator queue until
the patron claims it or you decide by hand.

## The World 2.0 box lanes (2026-08-29)

Four timers that make the Postgres world store operationally real, installed on
the founder's ruling of 2026-08-29 — *prod Postgres on the box, with shipped
backups, no managed service.* They run against **dev** today; the prod move is
one line, named below.

| unit | what it runs | when |
|---|---|---|
| `postmark-world2-clearing.timer` | `world2-clearing.sh` → `clearing-job.mjs` | 05:45 / 17:45 UTC |
| `postmark-world2-ingest.timer` | `world2-ingest.sh` → `law-ingest.mjs` + `stamp-ingest.mjs` | **PARKED** since 2026-08-31 — the stamp pen's unit now (below) |
| `postmark-world2-law-ingest.timer` | `world2-ingest.sh law` → `law-ingest.mjs` only | every 15 min, :04/:19/:34/:49 |
| `postmark-world2-notary.timer` | `world2-notary.sh` → `snapshot-export.mjs` + `falsifier-canon-locks.mjs` (postmark#2594, nightly — the section below) | 07:20 UTC (office#83, from 03:20) |
| `postmark-world2-backup.timer` | `world2-backup.sh` → `pg_dump` + ship, `pg_basebackup`, **and `roles.db`** (POS-185) | 08:10 UTC (office#83, from 04:10) |

All five carry rows in `deploy/box-rollcall-manifest.json`. `world2-restore-rehearse.sh`
is a hand-run, deliberately: it drops and recreates a database, and nothing that
does that belongs on a clock.

**The backup lane also carries `roles.db` since POS-185 (2026-09-21)**, and it is
the only file in that commit that is not the world store. It is there because
`src/roles.mjs:71-82` says so in its own voice and then declines to act on it,
correctly — the module states the gap, operations decides the discipline:

> `roles.db` … lives on the box and nowhere else. It is NOT the same durability
> class as its neighbours: `office.db` and `world.db` are pure indexes, deleted
> and rebuilt whole from a clone; `oauth.db` is auth paperwork whose loss only
> forces everyone to sign in again; `dynamic.db` carries an explicit covenant
> that every row re-derives or recovers from a crossing-save. This file carries
> NO such covenant, because a grant exists nowhere else in the world — no repo
> holds it, no fold recomputes it. **Losing `roles.db` loses who paid.**

Three things about how it rides, each of which is the answer to a question the
next reader will have:

- **It is copied with `VACUUM INTO`, never `cp`.** A SQLite file copied while a
  writer is mid-transaction is torn — it has the size and the magic bytes of a
  database and restores as nothing. `VACUUM INTO` takes a read transaction and
  emits a self-consistent database whatever the office is doing at 08:10.
- **Through node's `node:sqlite`, not the `sqlite3` CLI**, so the box gains no
  new package: the office already imports `DatabaseSync` to serve the gate
  (`src/roles.mjs:141`, `src/server.mjs:36`). The handle is opened **read-only**
  — `VACUUM INTO` writes only to the target — so the backup lane never holds a
  pen over who paid.
- **No new unit, no new credential, no new roll-call row.** Same timer, same
  private repo, same deploy key, and the `postmark-world2-backup.timer` row's
  receipt now carries `roles_status`, `roles_db_bytes` and `role_audit_rows`.
  `roles_status: absent` is legal and does not redden: `OFFICE_ROLE_GATES` is
  unset on every office today (`src/server.mjs:170`), so a box that has never
  granted a role has no file to copy. A file that exists and *cannot* be copied
  exits 1.

**Restoring it is a file copy**, which is the whole restore path:

```
cp roles/<newest>.db /srv/postmark-office/roles.db   # the office opens it at boot
```

`world2-restore-rehearse.sh` counts the shipped copy's `role_audit` against the
live registry on every rehearsal, under the same drift rule as the Postgres
tables: the live side may have gained rows (the town kept selling), but the copy
holding MORE rows than live cannot be explained by the clock and is the finding.
Prefer `--from-remote`, which reads the copy out of the off-box clone rather than
the box's own disk — the local one only proves the copier ran.

### The law pen keeps its own clock (2026-09-19, postmark#2893)

**What happened.** `postmark-world2-ingest` ran two pens — `law-ingest` (the
rulebook → `law_projection` + `identities`) and `stamp-ingest` (the ledger →
`stamp_projection`). On 2026-08-31 the founder parked the timer, for a reason
about the world's **outcomes**: a re-lift from git *"would launder v1's record
into v2's and destroy the writer comparison the shadow era exists to make."*
Neither pen writes an outcome — they copy repo-first inputs the store may not
author — but the park took the whole unit, and `law-ingest.mjs` is the **only**
writer of `law_projection` anywhere in the office.

So the rulebook copy stopped. `a23a8d17` (2026-09-05), one hand-run to
`1688a5af` on 09-17, then frozen again: **37 commits behind world main** by
2026-09-19, measured on prod's `/world2/status`.

**Why nothing went red.** The designed alarm is the clearing refusing on a
**null** world-law pin. The final pass of 09-05 wrote a *valid* pin, and a frozen
valid pin is never null, so for fourteen days the guard had nothing to fire on.
That is the shape worth carrying away: **a guard against absence does not watch
for staleness.**

**The ruling** (Keemin, 2026-09-19): *"split for now is good."* The law pen gets
its own unit and timer. The parked unit and its files are **untouched**, and
`stamp-ingest` stays parked with them.

**The split is a mode argument, not a second copy of the pen.**
`world2-ingest.sh` takes `law` | `stamps` | `both`, and no argument is `both` —
today's behaviour, unchanged. Each mode writes **its own state file**
(`ingest-law.json`, `ingest-stamps.json`, `ingest.json`), which is not tidiness:
a roll-call heartbeat has to be able to say which thing it measured, and one
shared path would let the law row go green on a run that was not the law pen's,
race two units on the same `mv -f`, and overwrite the parked rail's last receipt
every fifteen minutes. A pen that did not run gets **no line** in the state,
rather than a zero-exit line that reads like a receipt.

**Install — the script goes FIRST, and the order is not a suggestion.** A box
whose `/srv/world2-lab/ops` copy predates the mode argument ignores `law` and
runs **both** pens, which re-runs the one the founder parked. Hand-carry after
Sunday's tag:

    scp deploy/world2-ingest.sh meepo-ec2:/srv/world2-lab/ops/
    ssh meepo-ec2 'chmod +x /srv/world2-lab/ops/world2-ingest.sh'
    ssh meepo-ec2 'bash /srv/world2-lab/ops/world2-ingest.sh nonsense; echo "expect 2, got $?"'
    scp deploy/postmark-world2-law-ingest.{service,timer} meepo-ec2:/tmp/
    ssh meepo-ec2 'sudo install -m0644 -o root -g root /tmp/postmark-world2-law-ingest.* /etc/systemd/system/'
    ssh meepo-ec2 'sudo install -d -m0755 /etc/systemd/system/postmark-world2-law-ingest.service.d && \
                   sudo install -m0644 -o root -g root /srv/postmark-office/deploy/postmark-world2-office-tree.conf \
                     /etc/systemd/system/postmark-world2-law-ingest.service.d/office-tree.conf'
    ssh meepo-ec2 'sudo systemctl daemon-reload && sudo systemctl enable --now postmark-world2-law-ingest.timer'
    ssh meepo-ec2 'sh /srv/postmark-office/deploy/box-rollcall.sh'

The third line is the whole carry check: an old copy takes an unknown argument
and runs both pens silently, and a new one refuses with exit 2. The
`world2-ops-scripts` roll-call row already watches that directory as bytes, so a
drift between the shipped script and the box's copy reddens on its own.

⚑ **THE INSTALL-DAY PREDICTION, and it is the acceptance proof** — the same
shape `box-rollcall.sh` already carries for the settlement shadow. The manifest
row for this timer reaches the box with the **tag**; the unit reaches it by the
**hand-carry above**. Between those two moments the roll-call is expected to
exit 1 with exactly one new alarm:

    ALARM-missing  postmark-world2-law-ingest.timer  … NOT ON THE BOX

That is the manifest and the box telling the truth about each other, and it
clears the moment the carry lands. If it is still red after the carry, the unit
did not install or `daemon-reload` was not run — read
`systemctl cat postmark-world2-law-ingest.service` before touching anything
else. Shipping the row as `parked` to keep the board quiet would be the worse
trade: a parked row is a DECISION in this file's grammar, and this one is a
two-day gap.

**Do NOT enable `postmark-world2-ingest.timer`** to get the law pen back. It
carries the identical `:04/:19/:34/:49` marks, so adopting it now would run the
law pen twice and the parked stamp pen once. Its row says so.

### Finishing a refused crossing by hand (2026-09-14, postmark#2786)

**The recovery is one unit, and it is not the settlement's own.** When a crossing
refuses and the cause is repaired before the next one is due, start:

```sh
sudo systemctl start postmark-settlement-by-hand.service
journalctl -u postmark-settlement-by-hand.service -n 200 --no-pager
```

It publishes **the newest closed window that still holds a locked claim with no
materialized mark** — the notary's own read — and its receipt says
`by_hand: true` beside `source`. If the world already carries everything it
refuses `nothing-unfolded` and names where the town is. It never touches the
open window.

**Do not rerun `postmark-settlement.service` to recover.** That unit is the
timer's, and the timer's docket wait accepts only a window cleared **at or after
that crossing's own start** — correctly, because a crossing that folded an older
window would publish nothing and read as a quiet day, which is the 2026-08-26
starving shape. A rerun before the next close therefore refuses
`clearing-did-not-run` no matter how correct the tree is.

**And the old sweep-then-candle pairing does not answer this.** It was: start the
settlement (it waits 240s), start the clearing while it waits. The clearing
closes only *the open window whose `closes_at` has passed*, so mid-window it
answers `nothing-due` and the sweep times out anyway. Measured on 2026-09-14:
window 188 closed at 05:45Z holding 29 locked claims its crossing refused on a
world test; the test merged by 09:1x; reruns at 13:21Z and 13:26Z refused, the
candle said nothing was due because window 189 did not close until 17:45Z, and
29 residents' marks stayed locked-but-unpublished for a day.

Install it with the other units; it carries **no timer**, deliberately — a rerun
by hand is an act, not a second clock, and the journal names it by its own unit
so a by-hand publication is never read back as a scheduled one.

### The canon check is NIGHTLY, not at the candle — and why (2026-09-08, postmark#2594)

Keemin first ruled *refusal at the candle*, and the lane's reviewer measured it
impossible the same evening. **The crossing's settlement pushes its mark files to
origin three to four minutes AFTER the candle clears the window** — seven
consecutive crossings timed from both units' journals, never once before, and on
2026-09-07 the push landed 1h56m late. Today's 17:45 crossing would have refused
all three of the marks it locked.

The lane's own first table said the opposite ("twelve seconds before"), and it was
wrong because it read **commit** timestamps, which are local authoring times,
while the candle fetches **origin**. That is the freshness-stamps-name-their-own-
source rule turned on the lane's own measurement.

So the ruling moved: the canon-absent check is **withdrawn from the lock step**
and lives on the **nightly read**, `world2/tools/falsifier-canon-locks.mjs`, which
runs on the **notary rail** (`world2-notary.sh`, 03:20 UTC) as `snapshot_reader`.
At 03:20 the 17:45 push is nine hours old, so the read asks about a world that has
finished moving. It refreshes the world clone itself, appends one line per run —
clean or not — to `/srv/world2-lab/state/canon-locks.jsonl`, and **its RED does
not fail the notary**: the certification is the notary's job, and this finding is
about the register. The alarm is the roll-call's outcome rule on the
`postmark-world2-notary.timer` row (`alarm_on_nonempty` on its lists, and
`alarm_on_false` on `escrow_checked` — a read that could not run is never a
clean town). The escrow list holds only **judgeable** zeros: a commons mark
locked at a window whose town sha the escrow projection never held — every
window before 181, migration 014's first ingest — is **unjudgeable**, written
on the line as `escrow_unjudgeable` with the oldest projected sha beside it,
and printed by the row's `report_counts` as a count, never an alarm
(postmark#2935; before it, 227 such marks alarmed every morning for eight
nights while the true unbacked count was zero).

At the G1 swap the class becomes structurally impossible — the fold writes what
the candle locked — and the read stays as the detector.

### What DOES gate at the candle: the escrow presence rule (2026-09-08)

`clearing-job.mjs` step 5.5. The clearing's only escrow step was an
**affordability** test — `if (total === 0) continue` — so a claim staking zero was
never looked at. The 1.0 sweep holds the **presence** rule ("commons needs escrow
> 0", `settlement-sweep.mjs:1146-1152`) and G1 deletes the sketchbook path it
lives on, so the rule would simply stop being enforced. A commons-class claim with
zero escrow at the window's own pinned `town_sha` is now refused
`escrow-absent: <slug> @ <sha>`, which the receipt maps to `unbacked`.

This one races nothing: it reads the **town** projection and the store, never a
git push. The class is computed prospectively by the port's own `computeStanding`
over the standing rows plus the candidates, because `data.tier` is not written
until step 7. Own ground is exempt without a clause, because the class rule
answers `home` for it.

**Until migration 014 lands** (lane 2's `escrow_projection`), `escrowPresenceAt`
answers null, every commons claim is reported UNCHECKED on the crossing and on the
window's `receipts.escrow_presence`, and the nightly read carries the same class.
Null is never read as zero — that would refuse the whole town on a missing
migration.

The REVIEW door (`review-rule.mjs`) re-runs the same presence rule at ruling time
and treats a failure as a **blocker on the run**, which is that file's own
established shape for a fact that changed while a claim was held.

### Which branch the ingest lane reads (2026-09-05)

`world2-refresh-clone.sh world` defaults to **`main`**. That default is the whole
of the lane's branch policy — measured on the box on 2026-09-05, nothing else
sets it:

    /etc/postmark-world2-dev.env   carries no W2_WORLD_BRANCH
    the ingest unit                carries no inline Environment=
    the ingest unit                has no drop-ins

The default was `world-2` until this change, and `world-2` is the retired tree:
on 2026-09-05 `main` stood at `a23a8d1` and `world-2` at `cba817d`. Because the
refresh does `fetch --depth 1 origin "$BRANCH"` then `reset --hard FETCH_HEAD`,
the old default did not merely name the wrong branch — the next automatic run
would have pulled the persisted checkout back off the law and gone on reporting a
sha for it. `test/world2-refresh-clone-branch.test.mjs` holds the default and
executes the shipped dispatch to prove it.

`W2_WORLD_BRANCH` still wins, and should: reading the retired tree by hand (a
bisect, a comparison) is a legitimate call.

**The box's copy of the script is stale until it is carried.** The ops directory
is a plain file copy of this repo's `deploy/`, exactly like `/srv/postmark-office`,
so the fix reaches the box only by copying it — one line, run by the conductor
after this lands:

    scp deploy/world2-refresh-clone.sh meepo-ec2:/srv/world2-lab/ops/

and, if a copy is not wanted yet, the in-place edit that makes the same change:

    ssh meepo-ec2 "sudo -n sed -i 's/W2_WORLD_BRANCH:-world-2/W2_WORLD_BRANCH:-main/' /srv/world2-lab/ops/world2-refresh-clone.sh"

Neither is run by this change. Verify either with:

    ssh meepo-ec2 'grep -n W2_WORLD_BRANCH /srv/world2-lab/ops/world2-refresh-clone.sh'

**The branch fix has since been carried.** Verified read-only on the box
2026-09-19: `/srv/world2-lab/ops/world2-refresh-clone.sh:58` reads
`BRANCH="${W2_WORLD_BRANCH:-main}"`. The "carry the script first" warning below
was written while it was not, and it is no longer the blocker it was — but the
ORDER it teaches is still the rule, for a second reason, and the law pen's
section above is where that reason now lives.

**The ingest timer is `disabled`/`inactive` on the box** (unchanged since
2026-09-05, re-verified 2026-09-19 18:44Z), so the table above no longer gives it
a cadence at all. Its last run was a one-shot by hand on **2026-09-17 23:43Z** —
`state/ingest.json` at `23:43:09Z`, exit 0 on both pens, law `1688a5af`, town
`276f1d20` — not the 09-05 pass this paragraph used to name. Enabling the timer
before the branch fix was carried was the sequence that reset the checkout off
the law; today the reason not to enable it is the one in the law-pen section:
it would run the law pen a second time on the same marks, and re-adopt the
stamp pen the founder parked.

### Where things live

> **`world2_dev` is PROD.** Every `WORLD2_*_URL` on this box names the one
> live store, database `world2_dev`, whatever the file is called (`lab.env`
> included). "lab" in a path here means the scripts' folder, never a second
> database. Rehearse a store write on a restored copy (`world2_rehearsal`,
> POS-242), never here. The rename is POS-242 part 0.

    /srv/world2-lab/ops/            the scripts (a plain file copy from this repo,
                                    the same shape as /srv/postmark-office).
                                    NOTHING DEPLOYS THIS — see the one-tree
                                    section below; the roll-call's
                                    `world2-ops-scripts` row is what says so.
    /srv/world2-lab/office/         RETIRED 2026-09-10. A second office checkout
                                    the release workflow never deployed; the
                                    lanes read /srv/postmark-office now. If a
                                    tree is still sitting here it is residue,
                                    never a fallback.
    /srv/world2-lab/state/          one JSON per lane — the roll-call heartbeats
    /srv/world2-lab/private-dumps/  pg_dump output, 0700, outside every checkout
    /srv/world2-lab/basebackups/    pg_basebackup output, 0700
    /srv/world2-lab/backup-repo/    the off-box dump repo's checkout
    /srv/world2-lab/notary/         the notary checkout, pushed to its OWN repo
    /srv/world2-lab/ingest-clones/  persistent world/town checkouts, reset per run
    /srv/world2-lab/.ssh/           two deploy keys + a pinned known_hosts:
                                    w2-backups -> postmark-world2-backups
                                    w2-notary  -> postmark-world2-notary
                                    NEITHER key can read the other's repo, and
                                    that is DEC-7 rather than tidiness (below)
    /srv/world2-wal/                the WAL archive spool, 2770 postgres:meepo

### Install

    scp deploy/world2-*.sh meepo-ec2:/srv/world2-lab/ops/
    ssh meepo-ec2 'chmod +x /srv/world2-lab/ops/*.sh'
    scp deploy/postmark-world2-*.{service,timer} meepo-ec2:/tmp/
    ssh meepo-ec2 'sudo install -m0644 -o root -g root /tmp/postmark-world2-* /etc/systemd/system/ && sudo systemctl daemon-reload'
    ssh meepo-ec2 'for u in clearing law-ingest notary backup; do sudo systemctl enable --now postmark-world2-$u.timer; done'
    ssh meepo-ec2 'sh /srv/postmark-office/deploy/box-rollcall.sh'

> **`ingest` left this loop on 2026-09-19** and the omission is the point.
> `postmark-world2-ingest.timer` is PARKED at the founder's word of 2026-08-31
> (`deploy/box-rollcall-manifest.json`, that row); a re-install block that
> enables it would recommit a ruling by muscle memory. `law-ingest` takes its
> place — the law half, split out on postmark#2893, section below. The parked
> unit's files still ship, so `scp`ing them is right; enabling it is not.

### ONE TREE PER BOX — the office-tree drop-in (2026-09-10)

**What happened.** The 05:45Z scheduled crossing published **green** under
`release/2026-w37.9` and `escrow_projection` held **zero** rows after that same
timer's clearing. The candle runs `clearing-job.mjs` out of `/srv/world2-lab/office`
— a *second* office checkout at `7926461` (2026-09-05, schema ≤ 012, no escrow
ingest) that the release workflow never deploys. All four world2 lanes shared it
through one line in `world2-lib.sh`. Every heartbeat on the board read fresh,
because the lanes *did* run: on time, to completion, on three-day-old code.

The notary's `ALARM-outcome` was the same cause from the other side.
`world2/tools/falsifier-canon-locks.mjs` **does not exist at `7926461`** — it
landed 2026-09-08 in `59ff9b9` — so under the lab tree the nightly canon read
could not run and `/srv/world2-lab/state/canon-locks.jsonl` stayed empty. The row
was reporting the register and the fault was the tree.

**The fix, in two halves that say the same thing.** `deploy/world2-lib.sh` now
defaults `WORLD2_OFFICE` to `/srv/postmark-office`, and
`deploy/postmark-world2-office-tree.conf` is a drop-in that sets it on the units.
The redundancy is deliberate: the lib reaches the box as a hand file copy, so a
box whose copy is old still carries the old default, and the drop-in is the half
`systemctl cat` shows and the roll-call reads.

Install the drop-in on all four units:

```sh
scp deploy/postmark-world2-office-tree.conf meepo-ec2:/tmp/office-tree.conf
ssh meepo-ec2 'for u in clearing notary backup ingest; do
  sudo install -d -m0755 /etc/systemd/system/postmark-world2-$u.service.d
  sudo install -m0644 -o root -g root /tmp/office-tree.conf \
    /etc/systemd/system/postmark-world2-$u.service.d/office-tree.conf
done && sudo systemctl daemon-reload'
```

`daemon-reload` is **not a restart**. All four are `Type=oneshot` driven by
timers; the next fire reads the new environment. Do not restart them — for the
clearing that runs a crossing off-cadence.

**Verify by key name only.** The obvious check is the wrong one:

> Never run `systemctl show postmark-settlement.service -p Environment`. That
> unit reads `WORLD2_CLEARING_URL` — password inside — from
> `/etc/postmark-world2-clearing.env`, and `show` prints the merged environment.
>
> **The clearing credential is ONE file (office #26, 2026-09-12).**
> `/etc/postmark-world2-clearing.env` (root:root 0600, one line:
> `WORLD2_CLEARING_URL=postgres://clearing_job:…@localhost:5432/world2_dev`) is
> read by `postmark-world2-clearing.service` AND `postmark-settlement.service`
> through `EnvironmentFile=`. There is no `PG_CLEARING_JOB_PASSWORD` in
> `/etc/postmark-world2-dev.env` any more and no `clearing-url.conf` drop-in.
> To rotate: `ALTER ROLE clearing_job PASSWORD '…'` as world2_owner, rewrite
> that one file by a script that never prints it, `systemctl daemon-reload`,
> confirm no drop-in still carries the URL —
> `ls /etc/systemd/system/postmark-settlement.service.d/*.conf` must list no
> `clearing-url.conf` (a drop-in is ordered after the unit file and would win
> silently) — then `systemctl start postmark-world2-clearing.service` off-cadence and read
> `/srv/world2-lab/state/clearing.json` — `nothing-due` or `cleared` proves the
> login; `cannot-run` names what is wrong. The 09-11 rotation reached the
> settlement's drop-in and not the candle's env file, and the 05:45Z candle
> reported "nothing due" over three FATALs — two copies of one secret. `world2-lib.sh`'s own header
> says the journal is readable by group `adm`.

The world2 units carry no secret in `Environment=` (theirs arrive by
`EnvironmentFile=`), so `systemctl show postmark-world2-clearing.service -p Environment`
is safe *on those four*. The habit that is safe everywhere is the grep:

```sh
ssh meepo-ec2 'grep -c "^Environment=WORLD2_OFFICE=/srv/postmark-office$" \
  /etc/systemd/system/postmark-world2-clearing.service.d/office-tree.conf'
```

Receipt: `1`. The real acceptance is a receipt that exists only if the pin took —
`escrow_rows > 0` on the first window the deployed candle closes.

**The half the drop-in does not fix.** `ExecStart` is
`/srv/world2-lab/ops/world2-<lane>.sh`, and that directory is a hand file copy of
this repo's `deploy/` that no deploy updates (§ *Where things live*). The
roll-call's `world2-ops-scripts` tree row compares it byte-for-byte against the
release and reddens on drift; carrying it is still a person's act, with the `scp`
at the top of this section.

**The roll-call now reads trees.** `deploy/box-rollcall-manifest.json` § `trees`
carries one row per unit that execs out of a checkout, comparing the tree the
unit *will run* to `/srv/postmark-office/release.json`. Verdict `ALARM-tree`, and
the roll-call exits nonzero on it like any other alarm. A live unit that names a
tree and has no row comes back `ALARM-tree` from the reverse check, the same
discipline `ALARM-unmanifested` keeps over units.

The scripts are `bash`, not `sh` — the same reason `/srv/world2-lab/launch.sh`
is. Strip CR after any copy from a Windows checkout and check it stuck; a unit
file with a trailing `\r` in `ExecStart` fails in a way that reads like a
missing file.

### The one Postgres change, and the restart it cost

`archive_mode` is postmaster-level, so turning it on cost one restart
(2026-08-29 ~01:53Z, four idle pool connections from the :4382 lab office, which
reconnected; `/srv/postmark-office-dev` holds no Postgres and was unaffected).
`wal_level` was already `replica` and was **not** raised. The appended block
lives at the end of `/etc/postgresql/16/main/postgresql.conf` under a
`world2 ops lane` header, with a dated `.bak-world2-ops-*` beside it.

Two role attributes were granted to `world2_owner`, which already owns the
database: `REPLICATION` (so `pg_basebackup` can connect over TCP as the lane's
own user rather than needing a sudo hop to `postgres`) and `CREATEDB` (so the
restore rehearsal can make its scratch target). `pg_hba.conf` needed no edit —
it already carried `host replication all 127.0.0.1/32 scram-sha-256`.

### Reading a red

The roll-call's `state_file` heartbeat answers **did the lane run**; the
service's exit code answers **did it succeed**. Read both. A fresh stamp beside
an `ALARM-failed` is a lane that ran and refused, and the state file names which
guard fired. That combination is normal and informative, not contradictory.

### The prod rename

`EnvironmentFile=` in each `.service`, **plus the one shared clearing file.**
Point the env line at a prod credential file whose `WORLD2_DB` says `world2`;
every script reads the database name from there (`world2-lib.sh` § `w2_db`), and
the units, the manifest rows and the state paths all follow. The exception since
2026-09-12 (office #26) is `/etc/postmark-world2-clearing.env`, whose
`WORLD2_CLEARING_URL` names the database inline — rewrite `/world2_dev` to
`/world2` there in the same act. The candle checks the two against each other
and refuses (`cannot-run`, "the prod rename needs both files") when they
disagree, so forgetting the second edit cannot clear windows in the wrong store. The units are named
`postmark-world2-*` rather than `postmark-world2-dev-*` for exactly this reason —
the unit is the mechanism, the env file is which store it points at. The
`postmark-` prefix is not decoration either: `tools/box-rollcall.mjs` globs
`list-unit-files postmark*`, so a unit named otherwise would be invisible to the
roll-call and could never be held to the manifest law.

### The notary's push target, and why it is a second repository (DEC-7, 2026-09-03)

`world2-notary.sh` pushes after every certification — branch and both tag
namespaces (`notary/*`, `notary-history/*`) — to
**`wright-starforge/postmark-world2-notary`**, private, `keeminlee` admin.

It is a *separate* repository from `postmark-world2-backups`, and the separation
is the whole point rather than an organisational preference. DEC-7's own words:
*"If the certification ships inside the same bundle as the backup, one
compromised lane loses both halves of the check."* A certification stored beside
the backup it certifies cannot be the thing that catches that backup.

The separation is enforced by two scoped deploy keys, and **neither can reach the
other's repository** — measured on the box the night the remote landed:

    key=w2-notary    repo=postmark-world2-notary     exit=0
    key=w2-notary    repo=postmark-world2-backups    exit=128  Repository not found.
    key=w2-backups   repo=postmark-world2-backups    exit=0
    key=w2-backups   repo=postmark-world2-notary     exit=128  Repository not found.

**Do not give one process both keys.** The moment a single lane holds both, a
compromise of it loses both halves again and the second repository is decoration.
That is why `world2-backup.sh` reports the notary's off-box state by reading the
notary checkout's own `refs/remotes/origin/main` — a local ref, no credential —
rather than asking GitHub.

A push that does not land is its own red, even behind a green certification: the
lane exits 1 and says *the certification is on the box it certifies and nowhere
else*. `state/notary.json` carries `push` and `remote_tip`.

**Verifying the copy, and the one trap.** A stranger clones and runs
`snapshot-export.mjs --verify <clone> --spot-check 200`, or the database-free
half: recompute each archive's sha256 and compare it to `CERTIFICATION.json`.
The trap is line endings — git converts LF to CRLF at checkout wherever
`core.autocrlf` is true, which is the Windows default, and a converted archive
fails its certified sha. Every non-empty file goes red at once and the empty ones
pass, which is the tell. The repository now carries a `.gitattributes` with
`* -text` so a plain `git clone` is byte-faithful anywhere; the note in that file
records the measurement.

### One thing this lane still owes

1. **The WAL does not ride off-box.** Measured at ~163 MB/day raw (2026-08-29,
   a heavy build day), which no git history survives. The dump ships; the WAL and
   the base backups stay on the box. Giving the box a private object-storage
   bucket turns that into about a dozen lines — see `world2-backup.sh` § *the
   off-box destination* for what was tried and why each was refused.
