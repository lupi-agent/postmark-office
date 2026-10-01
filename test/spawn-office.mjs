// spawn-office.mjs — wait for a spawned office to say "listening", and when it
// does not, SAY WHY.
//
// THE INSTRUMENT WAS DESTROYING ITS OWN EVIDENCE. The claim files each carried
// this wait inline:
//
//   const t = setTimeout(() => no(new Error("server never listened")), 10_000);
//   child.stdout.on("data", d => { if (d.includes("listening")) { clearTimeout(t); ok(); } });
//   child.on("exit", c => no(new Error(`server exited early (${c})`)));
//
// There is no `child.on("error")`. A spawn-LEVEL failure — EAGAIN or EMFILE on
// a box running eighty node processes, or ENOENT — emits `error` and never
// `exit`, so nothing rejected, the timer eventually fired, and the failure
// presented as "server never listened" with its actual cause detached and
// thrown away. The reviewer reproduced it verbatim: an uncaught ENOENT,
// followed 3001 ms later by a rejection blaming the boot.
//
// It was never boot time. Boots take p50 429 ms against a 10 s budget, and the
// office's stdout arrives as a single chunk. An occupied port is a different
// symptom again — an early exit carrying EADDRINUSE — which the exit handler
// already named but which nothing printed, because stderr was collected
// nowhere. So a whole night of "the suite flaked and I cannot tell you why"
// came from one missing listener and a discarded stream.
//
// THE RULE THIS ENCODES: a probe that reports a TIMEOUT for a failure it was
// handed the cause of is worse than no probe — it converts a nameable fault
// into a mystery and invites the reader to blame the slowest thing in sight.
// Every terminal state gets a listener, and every rejection carries the stream
// that explains it.

import { createServer } from "node:net";
import { once } from "node:events";

const tail = (s, n = 2000) => (s.length > n ? `…${s.slice(-n)}` : s);

/**
 * Resolve when `child` announces it is listening; reject NAMING the terminal
 * state it actually reached instead.
 *
 * Takes an already-spawned child rather than spawning one, so each suite keeps
 * its own argv and env verbatim — and so the failure path is drivable: a test
 * can hand this a child spawned from a binary that cannot start and read the
 * rejection. A rejection branch nothing can reach is a branch nobody has
 * checked, which is how the old wait stayed broken.
 */
export function awaitListening(child, { budgetMs = 30_000, ready = "listening" } = {}) {
  let out = "";
  let err = "";
  let settled = false;

  return new Promise((resolve, reject) => {
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(value);
    };
    const fail = (headline) => finish(reject, new Error(
      `${headline}\n--- stdout ---\n${tail(out) || "(nothing)"}\n--- stderr ---\n${tail(err) || "(nothing)"}`));

    // Generous on purpose: a backstop for a genuine hang, not a measurement of
    // boot time. Every fault we can name now rejects on its own listener long
    // before this fires, which is the point of the change.
    const timer = setTimeout(
      () => fail(`the office never said "${ready}" within ${budgetMs} ms`), budgetMs);

    child.stdout?.on("data", (d) => { out += d; if (out.includes(ready)) finish(resolve, child); });
    child.stderr?.on("data", (d) => { err += d; });

    // THE LISTENER THAT WAS MISSING. `error` fires when the process could not
    // be created at all; `exit` fires when it started and then stopped. Two
    // different faults, two different sentences, neither of them a timeout.
    child.on("error", (e) => fail(`the office could not be SPAWNED (${e.code ?? e.name ?? "no code"}): ${e.message}`));
    child.on("exit", (code, signal) => fail(
      `the office exited before it was ready (code ${code}${signal ? `, signal ${signal}` : ""})`));
  });
}

// ── the port, asked for ──────────────────────────────────────────────────────
//
// THE PORT IS ASKED FOR, NEVER CHOSEN (join-pr-at-the-cosign.test.mjs § the
// port). A fixed port is a lock on a door every pool tree on the box shares,
// and a pid-derived one is a smaller guess at the same door. An in-process
// server listens on 0 and reads its own port back; a SPAWNED office cannot,
// because `--port 0` would key every office's loop-lag state file on "0"
// (src/loop-lag.mjs § stateFileFor) and trade a port collision for a file one.
// So the test asks the OS for a free port, lets it go, and hands it to the
// office as `--port`. Between the probe and the child's bind is a small window
// someone else could take the port in; `bootOnFreePort` closes it the only way a
// test can — by noticing EADDRINUSE and asking once more, aloud.

/** A port the OS just said was free, on the interfaces an office binds (all). */
export function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.unref();
    probe.on("error", reject);
    probe.listen(0, () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

/**
 * Boot a spawned office on a port asked of the OS, and wait for it to listen.
 * `start(port)` spawns the child with that port and returns it (each suite keeps
 * its own argv and env). If the child dies with EADDRINUSE — the window between
 * the probe and its bind lost — it is started ONCE more on a fresh port, and the
 * retry is logged; a second loss rejects like any other failed boot.
 * Resolves `{ child, port }`.
 */
export async function bootOnFreePort(start, { probe = freePort, log = console.log, ...wait } = {}) {
  for (let attempt = 1; ; attempt++) {
    const port = await probe();
    const child = start(port);
    // Its own copy of stderr: `exit` can fire before the streams drain, so the
    // verdict waits for `close`, by which time every byte has arrived.
    let err = "";
    child.stderr?.on("data", (d) => { err += d; });
    try {
      await awaitListening(child, wait);
      return { child, port };
    } catch (e) {
      if (child.exitCode !== null || child.signalCode !== null) {
        await Promise.race([once(child, "close"), new Promise((ok) => setTimeout(ok, 2_000))]);
      }
      if (attempt === 1 && /EADDRINUSE/.test(err + e.message)) {
        log(`bootOnFreePort: port ${port} was taken between the probe and the bind (EADDRINUSE); retrying once on a fresh port`);
        continue;
      }
      // Until it resolves, the child is the helper's: a caller handed a
      // rejection never received it, so nothing else could stop it.
      if (child.exitCode === null && child.signalCode === null) child.kill();
      throw e;
    }
  }
}
