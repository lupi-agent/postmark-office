// loop-lag.mjs — how long the office's one thread keeps a caller waiting (POS-267).
//
// WHY. On the Snug Harbour night (2026-09-26) the office answered 18-22 s late
// while its CPU sat in its own JS, and nothing on the box recorded it. The
// access telemetry does not see it either: a request's `ms` in
// telemetry/access-*.jsonl starts when its handler runs, so the time it waited
// for the thread before that is invisible there. The event loop's delay IS that
// wait, so this module measures it and nothing else.
//
// WHAT IT MEASURES. perf_hooks' monitorEventLoopDelay samples how late a 20 ms
// timer fires. Once a minute the histogram is read and reset into one row. The
// row judges on MAX, not p99, and that is deliberate: one 48 s synchronous read
// (measured on the dev office's /world/present, 2026-09-27) is ONE late sample
// among thousands of on-time ones, so its p99 reads as calm while every caller
// in that minute waited up to 48 s. `blocked_ms` is the sum of the lateness —
// roughly how much of the minute the thread could not answer anyone.
//
// WHERE IT GOES, AND WHO READS EACH FIELD.
//   GET /ops/loop-lag (the one mount line in server.mjs) serves `read()`:
//     - the operator during an event, and tools/party-replay.mjs, which prints
//       it beside its own client-side timings when the office serves it.
//   telemetry/loop-lag-<port>.json, rewritten every minute:
//     - `calm_at` is the heartbeat of the roll-call row "the office's thread"
//       (deploy/box-rollcall-manifest.json). It is the last minute whose max lag
//       stayed under LAG_ALARM_MS, so it goes stale exactly while the thread is
//       saturated, and also when the office stops writing at all.
//     - `worst_24h` and `minutes` are for the operator reading why that row
//       went red. `worst_24h` survives a restart (the rehydrate timer bounces
//       the office every fifteen minutes), `minutes` does not.
//   The file is named by port because the dev office (4381) keeps its own tree
//   and a read pool would run several processes against one telemetry folder.

import { monitorEventLoopDelay } from "node:perf_hooks";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { IN_READ_WORKER } from "./read-workers.mjs";

// A caller that arrives at the worst moment of a minute waits this long for the
// thread before its own handler even starts. Five seconds: a pre-party minute
// already carries 1.6-2 s synchronous reads (/world/settlements, measured in
// the office's own access telemetry on 2026-09-26 18:00-21:00Z), so two
// seconds would alarm on an ordinary afternoon.
export const LAG_ALARM_MS = 5000;
export const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;
const KEEP_MINUTES = 60;

const ms = (ns) => (Number.isFinite(ns) ? Math.round(ns / 1e6) : null);

/** The port this process serves, parsed the way server.mjs parses it. */
function portFromArgv(argv = process.argv) {
  const i = argv.indexOf("--port");
  return i >= 0 && argv[i + 1] ? argv[i + 1] : "4380";
}

export function stateFileFor(port) {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "telemetry", `loop-lag-${port}.json`);
}

/**
 * The instrument. `histogram` and `now` are injectable so a test can drive a
 * minute without waiting one; the office uses the defaults.
 */
export function createLoopLag({ file = null, now = Date.now, histogram = null, alarmMs = LAG_ALARM_MS } = {}) {
  const h = histogram ?? monitorEventLoopDelay({ resolution: 20 });
  if (!histogram) h.enable();
  const startedAt = now();
  const minutes = [];
  let calmAt = null;
  let worst = null;

  // What the last process knew. A restart drains the queue, so it does not
  // make the thread calm: calm_at carries until this process has a calm minute
  // of its own, and the day's worst carries until it is a day old.
  if (file) {
    try {
      const prev = JSON.parse(readFileSync(file, "utf8"));
      if (prev?.calm_at && Number.isFinite(Date.parse(prev.calm_at))) calmAt = prev.calm_at;
      if (prev?.worst_24h?.at && startedAt - Date.parse(prev.worst_24h.at) < DAY_MS) worst = prev.worst_24h;
    } catch { /* no file yet, or unreadable: start empty */ }
  }

  function tick() {
    const at = new Date(now()).toISOString();
    const count = Number(h.count ?? 0);
    const row = {
      at,
      samples: count,
      p50_ms: count ? ms(h.percentile(50)) : null,
      p99_ms: count ? ms(h.percentile(99)) : null,
      max_ms: count ? ms(h.max) : null,
      blocked_ms: count ? ms(h.mean * count) : null,
    };
    h.reset();
    row.over = row.max_ms !== null && row.max_ms >= alarmMs;
    if (!row.over && row.samples) calmAt = at;
    minutes.push(row);
    if (minutes.length > KEEP_MINUTES) minutes.shift();
    if (worst && Date.parse(at) - Date.parse(worst.at) >= DAY_MS) worst = null;
    if (row.max_ms !== null && (!worst || row.max_ms > worst.max_ms)) worst = { at, max_ms: row.max_ms, blocked_ms: row.blocked_ms };
    write();
    return row;
  }

  function read() {
    return {
      threshold_ms: alarmMs,
      judged_on: "max_ms per minute: how long the unluckiest caller in that minute waited for the thread before its handler ran",
      started_at: new Date(startedAt).toISOString(),
      calm_at: calmAt,
      last_minute: minutes.at(-1) ?? null,
      worst_24h: worst,
      minutes: [...minutes],
    };
  }

  function write() {
    if (!file) return;
    try {
      mkdirSync(dirname(file), { recursive: true });
      const tmp = `${file}.tmp`;
      writeFileSync(tmp, JSON.stringify(read(), null, 1) + "\n");
      renameSync(tmp, file);
    } catch { /* an instrument must never take down a door */ }
  }

  return { tick, read, write };
}

// The office's own instance: started at import, one row a minute, the timer
// unref'd so it never holds a test process or a shutdown open. The file is
// first written at the first minute, not at import: on the box the previous
// process's file (and its calm_at) stands until then, and a process that lives
// less than a minute (every suite that imports server.mjs) writes nothing.
//
// A READ WORKER (POS-266) keeps its own instance and writes NO file: it shares
// the writer's port and telemetry folder, so its file would be the writer's,
// and a worker's calm minute would overwrite the thread the roll call watches.
export const loopLag = createLoopLag({ file: IN_READ_WORKER ? null : stateFileFor(portFromArgv()) });
setInterval(() => loopLag.tick(), MINUTE_MS).unref();
