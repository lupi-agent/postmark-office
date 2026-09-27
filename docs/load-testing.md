# Load-testing the office

How the w40/w41 ship was load-tested (2026-09-26/27), written so the next test
at 200, 500 or 1,000 agents starts from what worked and from what fooled us.

The tools:

| Tool | Runs where | What it does |
|---|---|---|
| `tools/party-replay.mjs` | your machine, through a tunnel | the crowd: N agents saying things through MCP, M viewers polling the World page's reads, a probe on `GET /release` every 5 s (POS-267) |
| `tools/load-watch.sh` | your machine | prod's and dev's `/release` time and the box's CPU every 30 s, while the test runs |
| `tools/profile-office.mjs` | the box | a CPU profile of a live office through the V8 inspector |
| `tools/dev-flag-parity.sh` | your machine | the flags where dev differs from prod |
| `deploy/dev-office-carry.sh` | your machine | puts any branch or sha of this repo on the dev office, the way the release train puts a tag on prod |
| `world2/tools/rehearse.mjs` + `deploy/world2-rehearse.sh` | the box | a train's migrations and the next clearing, on a fresh copy of prod's store (POS-242) |

## The run, in order

1. **Put the code on dev.** `bash deploy/dev-office-carry.sh origin/train/2026-wNN`. Its `/release` must name the ref and sha before anything else counts.
2. **Match dev's flags to prod's, then check them.** `bash tools/dev-flag-parity.sh` must list nothing but the flag under test and `WORLD_CLONE`. **Run it again right before every run, not once per session.** On 09-27 a queued script had switched a flag back on between runs, and two results were confounded before the parity check caught it.
3. **Check dev's store holds the train's migrations.** Dev's store is a sandbox (`WORLD2_PG_URL` in `/etc/postmark-office-dev.env`), not prod's. Migrations do not reach it by themselves: probe any column or table a flag needs before trusting the flag. Apply one as `world2_owner`: `sudo -n -u postgres env PGOPTIONS="-c role=world2_owner" psql -v ON_ERROR_STOP=1 -d <sandbox> -f world2/schema/0NN_….sql`.
4. **Tunnel to dev's office port.** `ssh -N -L 14381:127.0.0.1:4381 meepo-ec2`. Never point the replay at `dev.postmark.town`: nginx makes every simulated client one address.
5. **Start the watch.** `bash tools/load-watch.sh 40 "[label]" >> load-watch.txt`.
6. **Run the crowd.** `node tools/party-replay.mjs --base http://127.0.0.1:14381 --steps 20:5,80:20 --step-s 900 --out run.json > run.txt`. Steps are `agents:viewers`, and each step holds for `--step-s` seconds. The report prints each route's p50, p95 and max, the probe, and the office's own loop lag, and it names the step where a collapse starts.
7. **Profile the thread under load.** A few minutes into a step, on the box: `kill -USR1 $(systemctl show -p MainPID --value postmark-office-dev)`, then `node tools/profile-office.mjs --seconds 20`. Idle near 0% means the thread is saturated, and the chains name the paths paying.
8. **Put dev back** to prod's flags when you are done, and say what you changed.

## What fooled us (read before trusting a number)

- **A local run without Postgres understates everything the store does.** Last night's local 80-agent run showed say at 2 ms. On dev, with real Postgres, say was 1.6 s at 20 agents and 38 s at 80.
- **Dev-only flags measure the flag.** `WORLD_STORE_SHADOW=1` computes every read twice and deliberately skips the place-words cache. On dev it looked like a collapse at 20 agents, and a profile put 91% of the thread in `placeWordsFrom`.
- **Berths are not residents.** The replay's agents are berths on the quay, so a berth's say skips the movement-derived standpoint a resident's say pays. Every result carries that caveat until the replay can mint resident keys on dev.
- **Dev and prod share one box.** They share 4 cores and one Postgres cluster (`max_connections` 100). The watch is how you know a dev test did not starve prod.
- **Read workers were only half of POS-266.** They take the viewers' GETs, while the agents' MCP calls (orient, look, say) stay on the main thread. Three workers each repeat the full resident placement on the same 4 cores. See the 09-27 results below before switching them on.

## Scaling to 200, 500 and 1,000 agents

- **Berth mints:** the office allows 5 per client address per hour (`server.mjs` § the berth mint's slow cap). The replay gives agent n the address `10.77.(1 + n/250).(1 + n%250)`, the same on every run, so re-running within the hour fails at the mint. Space runs an hour apart, add a run offset to the address scheme, or raise the cap on dev only (never prod). Each berth also persists for its 7-day sunset in dev's oauth store, so thousands will pile up.
- **The client:** one Node process holds every agent's MCP session and every viewer's poll. At 500+, split the crowd across several replay processes (different `--agents` ranges and address offsets), and watch your own machine's CPU: a saturated client reports its own slowness as the office's.
- **Postgres connections:** 100 across the cluster. Prod's office, dev's office, workers (2+2 each) and the timers all draw from it.
- **The box:** 4 cores and 16 GB. A 1,000-agent test on the shared box will hurt prod. Run it at prod's quietest hour with the watch running, or on a separate box restored from the nightly dump.
- **The acceptance line** (the office holds constant load, 09-27): no collapse, say p50 under 1 s, no loop-lag alarm over 30 minutes, prod unaffected.

## The 09-27 results (w41 @ 40086ec on dev, real Postgres, prod's flags)

| Agents | Probe p50 | Say p50 | Walkers p50 | Present p50 |
|---|---|---|---|---|
| 20 | 52 ms | 1.6 s | 649 ms | 421 ms |
| 80 | 501 ms | 38 s (106 timeouts) | 8.4 s | 3.8 s |

For comparison, w40 alone on dev (POS-267): say p50 47 s at 10 agents, and a collapse at 80. What remains, per the profile at 80 agents: `everyonePlaced`, recomputed per presence and walkers read (29%), and `worldEyes` line of sight (23%). The fixes are one shared placement per instant, MCP reads on the workers, and POS-277's per-settlement snapshots.

**Read workers, measured clean** (80 agents, prod's flags, `OFFICE_READ_WORKERS=3`, `W2_FOLD` confirmed off by the parity check): no collapse; say p50 17.8 s (38 s without workers), present 7.2 s (3.8 s), walkers 7.9 s (8.4 s). An earlier run reading "workers collapse at 80" had `W2_FOLD=store` switched on underneath it, which is why step 2 says to run the parity check before every run. The same accidental store-fold run, with workers off, gave say 38 s, walkers 12 s and present 5.8 s: the store fold costs reads about 50% and does not cause a collapse. w40 shipped with workers off. They come back in w41 once the agents' MCP reads move onto them and one shared placement per instant stops each worker repeating it.
