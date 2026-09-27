// say-push.mjs — THE WAITERS: a listen that waits for the next voice, and a
// stream of the same room deltas for the page (POS-265, the second half).
//
// The Snug night, measured (docs/2026-09-27/rail/pos-265): forty agents
// lingering at a minute each re-bought the room forty times a minute, and a
// voice still reached them up to a minute late. The delta (voices.mjs § THE
// DELTA) made each call small. This makes the calls few: a caller who passes
// `since` and `wait` is answered the moment a new voice lands in its earshot,
// or with an empty answer at the deadline — never more than WAIT_MAX_S later.
//
// ── ONE ROOM PER VOICE, NEVER ONE PER CONNECTION ────────────────────────────
//
// A waiter is an ear (where it stood when it began waiting), a cursor and a
// way to answer. When a voice lands, this module builds ONE snapshot of the
// room at that instant (voices.mjs § THE ROOM, ONCE PER INSTANT: every audible
// voice with the point it is heard from, and the record's clusters) and hands
// it to every waiter. Each ear then does its own arithmetic — is any of those
// points within my earshot, newer than my cursor — which is a distance test,
// not a derivation. Who is here BY POSITION is read once for all the ears that
// woke, from the kept positions (POS-264), through `nearbyMany`. Voices that
// land in the same turn share one fan-out.
//
// So fifty waiters cost one room per voice. `voices.room.stats` counts it, and
// the falsifier (test/say-push.test.mjs) holds the count.
//
// ── WHAT A WAITER IS NOT ────────────────────────────────────────────────────
//
// It does not re-derive where it stands while it waits: the ear is fixed when
// the wait (or the stream) opens. A 25-second wait cannot outwalk it; a stream
// that has walked should reopen, and every event carries `where` so the page
// can see the ear it is listening from.
//
// It lives in the process that holds the voices log. A wait is a listen, but
// it is woken by a say, so it must be served where the say lands — a reader
// on another thread would wait for a voice it can never hear.

export const WAIT_MAX_S = 25;
export const STREAM_BEAT_MS = 15_000;
// A handle may hold a few open ears (a client retrying, the page and an agent
// at once), not a crowd of them; and the office holds a bounded number in all.
export const WAITERS_PER_HANDLE = 4;
export const WAITERS_MAX = 2000;

const bounce = (defect, hint) => ({ error: "bounce", defect, hint });

/**
 * `voices` is a `createVoices()` store (its `room`). `nearbyMany(ears, t)`
 * answers who is within earshot of each ear BY POSITION, from one read, as an
 * array of handle lists (a null entry: presence is not deriving, the same null
 * `nearby` answers) — or null when it cannot, and then each woken ear asks
 * `nearby` itself, which the stats count.
 */
export function createSayPush({
  voices,
  nearbyMany = null,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  defer = (fn) => setImmediate(fn),
} = {}) {
  const room = voices.room;
  const waiters = new Set();
  const stats = { fanouts: 0, woken: 0, timed_out: 0 };
  let pending = null;

  room.onLanded(() => {
    if (pending || waiters.size === 0) return;
    pending = new Promise((resolve) => defer(() => fanout().catch((e) => {
      console.error(`[say-push] a fan-out tripped (${String(e?.message ?? e).slice(0, 160)}) — the waiters answer at their deadline`);
    }).finally(resolve)));
  });

  async function fanout() {
    pending = null; // a voice landing while this runs schedules the next one
    if (waiters.size === 0) return;
    const t = room.now();
    const snap = await room.snapshot(t);
    stats.fanouts += 1;
    const due = [...waiters].filter((w) => room.heard(w.here, snap, w.since).length > 0);
    if (due.length === 0) return;
    let lists = null;
    if (nearbyMany) {
      try { lists = await nearbyMany(due.map((w) => ({ at: w.here.at, aboard: Boolean(w.here.aboard) })), t); }
      catch { lists = null; }
    }
    for (const [i, w] of due.entries()) {
      if (!waiters.has(w)) continue; // answered or gone while the room was being read
      const r = await room.reply(w.handle, w.here, t, w.since, { snap, ...(Array.isArray(lists) ? { presentIn: lists[i] ?? null } : {}) });
      stats.woken += 1;
      w.deliver(r);
    }
  }

  function admit(handle) {
    if (waiters.size >= WAITERS_MAX)
      return bounce("the office is holding as many open ears as it keeps",
        `call again without wait: (a plain listen), or in a moment — the office holds at most ${WAITERS_MAX} waiting listens at once`);
    let mine = 0;
    for (const w of waiters) if (w.handle === handle) mine += 1;
    if (mine >= WAITERS_PER_HANDLE)
      return bounce(`${handle} already has ${mine} open ears`,
        `a resident may hold ${WAITERS_PER_HANDLE} waiting listens or streams at once — close one, or listen without wait:`);
    return null;
  }

  const whereOf = (here) => ({ place: here.place, x: Math.round(here.at.x), y: Math.round(here.at.y), ...(here.aboard ? { aboard: true } : {}) });

  /**
   * THE LONG-POLL. `since` is required (a wait answers "what is new", and the
   * first call buys the room); `waitMs` is the caller's, already held to
   * WAIT_MAX_S by `waitMsOf`. Answers the say's
   * own delta the moment a new voice lands in earshot, or an empty answer at
   * the deadline with the cursor unmoved.
   */
  async function wait(handle, { standAs = handle, since, waitMs } = {}) {
    const t0 = room.now();
    const here = await room.standing(standAs);
    if (here.bounce) return here.bounce;
    const refused = admit(handle);
    if (refused) return refused;
    room.listened(handle, here, t0);
    return new Promise((resolve) => {
      let timer = null;
      const w = {
        handle, here, since,
        deliver(r) {
          if (!waiters.delete(w)) return;
          clearTimer(timer);
          resolve({ ...r, waited_ms: room.now() - t0 });
        },
      };
      // Registered BEFORE the arrival check, so a voice landing while the
      // check reads the room is not lost between the two.
      waiters.add(w);
      timer = setTimer(() => {
        if (!waiters.delete(w)) return;
        stats.timed_out += 1;
        resolve({
          where: whereOf(here), voices: [], spoke: false, latest: since,
          waited_ms: room.now() - t0,
          note: `nothing new within earshot in ${Math.round(waitMs / 1000)}s — call again with the same since (your cursor has not moved). The room's lists ride with the next voice, or on a call without wait:`,
        });
      }, waitMs);
      // THE ARRIVAL CHECK costs a room only when the log holds a voice newer
      // than the cursor — otherwise there is nothing this ear could have missed.
      if (room.latestAt() > since) {
        (async () => {
          const t = room.now();
          const snap = await room.snapshot(t);
          if (waiters.has(w) && room.heard(here, snap, since).length > 0)
            w.deliver(await room.reply(handle, here, t, since, { snap }));
        })().catch(() => { /* the deadline still answers */ });
      }
    });
  }

  /**
   * THE STREAM, for the page. `send(reply)` is called with the room as a
   * say-read answers it (the full room without `since`, the delta with it),
   * then with each delta as voices land in earshot; the cursor advances with
   * each. Returns `{ close, beat }` or a bounce. `beat` keeps the ear counted
   * as present (listening is presence) without reading anything.
   */
  async function stream(handle, { standAs = handle, since = null } = {}, send) {
    const t = room.now();
    const here = await room.standing(standAs);
    if (here.bounce) return here.bounce;
    const refused = admit(handle);
    if (refused) return refused;
    room.listened(handle, here, t);
    const w = {
      handle, here, since,
      deliver(r) {
        if (!waiters.has(w)) return;
        if (Number.isFinite(r?.latest)) w.since = r.latest;
        send(r);
      },
    };
    // The first event is sent BEFORE the ear joins the fan-out, so a voice
    // landing while it is read cannot overtake it and move the cursor back; a
    // voice that landed in that gap is caught by the same arrival check the
    // wait makes.
    const first = await room.reply(handle, here, t, since, {});
    if (Number.isFinite(first?.latest)) w.since = first.latest;
    send(first);
    waiters.add(w);
    if (room.latestAt() > w.since) {
      const t1 = room.now();
      const snap = await room.snapshot(t1);
      if (waiters.has(w) && room.heard(here, snap, w.since).length > 0)
        w.deliver(await room.reply(handle, here, t1, w.since, { snap }));
    }
    return {
      close: () => { waiters.delete(w); },
      beat: () => room.listened(handle, here, room.now()),
    };
  }

  return {
    wait, stream,
    settled: () => pending ?? Promise.resolve(),
    stats,
    get open() { return waiters.size; },
  };
}

/**
 * Parse a caller's `wait` (seconds). Absent → null. Refused, never trimmed:
 * a wait past the cap would be answered sooner than asked, silently.
 */
export function waitMsOf(args = {}) {
  if (args.wait == null) return { waitMs: null };
  const s = Number(args.wait);
  if (!Number.isFinite(s) || s <= 0 || s > WAIT_MAX_S)
    return { bounce: bounce(`wait must be a number of seconds above 0 and at most ${WAIT_MAX_S}`,
      `wait: holds a listen open until a new voice lands in earshot, for up to ${WAIT_MAX_S} seconds — pass since: with it, and call again when it answers`) };
  if (String(args.text ?? "").trim())
    return { bounce: bounce("a wait is a listen", "speak without wait:, then wait on your next call with the reply's `latest` as since:") };
  if (!Number.isFinite(Number(args.since)) || args.since == null)
    return { bounce: bounce("wait needs since", "a wait answers what is NEW since your cursor — pass the `latest` stamp from your previous reply as since: (your first call, without wait, buys the room)") };
  return { waitMs: Math.round(s * 1000) };
}

/**
 * Serve one stream as Server-Sent Events. `open(send)` is `stream(...)` bound
 * to the caller; it answers `{ close, beat }` or a bounce, which is written as
 * the ordinary JSON refusal before any event. Each event is `event: room` with
 * the reply as its data; a comment line every STREAM_BEAT_MS keeps proxies
 * from closing an idle room and keeps the ear counted as present.
 */
export async function serveSayStream(req, res, open, { beatMs = STREAM_BEAT_MS, onBounce } = {}) {
  let started = false;
  const send = (r) => {
    if (!started) {
      started = true;
      res.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no",
      });
    }
    res.write(`event: room\ndata: ${JSON.stringify(r)}\n\n`);
  };
  const opened = await open(send);
  if (opened?.error) return onBounce(opened);
  const beat = setInterval(() => { opened.beat(); res.write(": beat\n\n"); }, beatMs);
  const end = () => { clearInterval(beat); opened.close(); };
  req.on("close", end);
  res.on("error", end);
}
