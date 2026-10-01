// spawn-office-wait.test.mjs — the wait must name the fault it was handed.
//
// WHY THIS EXISTS. Every claim suite spawns an office and waits for it to say
// "listening". The wait had no `child.on("error")` and kept no stderr, so a
// spawn-level failure (EAGAIN / EMFILE on a loaded box, or ENOENT) emitted
// `error`, nothing rejected, and the timer eventually blamed the boot: "server
// never listened". The cause was in hand and thrown away. A night of suite
// failures read as mysterious flakes because of it.
//
// The fix is three lines. This file is the reason the three lines cannot come
// back out: it drives the failure path directly, which the old wait's
// rejection branch never was — a branch nothing can reach is a branch nobody
// has checked.
//
//   node --test test/spawn-office-wait.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { awaitListening, bootOnFreePort, freePort } from "./spawn-office.mjs";

const rejection = async (promise) => {
  try { await promise; return null; } catch (e) { return e; }
};

test("A BINARY THAT CANNOT START IS NAMED, not reported as a timeout", async () => {
  // The exact fault the reviewer reproduced. It must reject at once on its own
  // listener, and the message must carry the code — not the budget's sentence.
  const started = Date.now();
  const child = spawn("definitely-not-a-real-binary-4f2a91", ["--nope"], { stdio: ["ignore", "pipe", "pipe"] });
  const err = await rejection(awaitListening(child, { budgetMs: 30_000 }));

  assert.ok(err, "it must reject rather than hang");
  assert.match(err.message, /could not be SPAWNED/, "the headline says the process was never created");
  assert.match(err.message, /ENOENT/, "and it carries the cause it was handed");
  assert.ok(!/never said/.test(err.message),
    "and it must NOT blame the boot — that sentence is what hid this fault all night");
  assert.ok(Date.now() - started < 20_000,
    "it rejects on the error listener, not by waiting out the budget");
});

test("A PROCESS THAT STARTS AND EXITS IS A DIFFERENT SENTENCE, and carries its stderr", async () => {
  // The port-collision shape, and any early crash: the process exists, so
  // `exit` fires and `error` never does. Two faults, two sentences.
  const child = spawn(process.execPath,
    ["-e", "process.stderr.write('EADDRINUSE: something already holds this port'); process.exit(7)"],
    { stdio: ["ignore", "pipe", "pipe"] });
  const err = await rejection(awaitListening(child, { budgetMs: 30_000 }));

  assert.ok(err, "it must reject");
  assert.match(err.message, /exited before it was ready \(code 7\)/, "the exit code is in the sentence");
  assert.match(err.message, /EADDRINUSE/, "and the stderr that explains it is carried, not discarded");
  assert.ok(!/could not be SPAWNED/.test(err.message), "a process that ran is not a process that failed to spawn");
});

test("THE TIMEOUT SENTENCE IS STILL REACHABLE — it is a backstop, not the default answer", async () => {
  // A process that starts, says nothing, and does not exit is the one case the
  // budget is genuinely for. It must still be reported, and must still hand
  // back whatever the process did manage to say.
  const child = spawn(process.execPath,
    ["-e", "process.stdout.write('booting, one moment'); setTimeout(() => {}, 60000)"],
    { stdio: ["ignore", "pipe", "pipe"] });
  try {
    const err = await rejection(awaitListening(child, { budgetMs: 1200 }));
    assert.ok(err, "a silent process still fails");
    assert.match(err.message, /never said "listening" within 1200 ms/);
    assert.match(err.message, /booting, one moment/, "and the output it did produce comes back with it");
  } finally {
    child.kill();
  }
});

test("A HEALTHY OFFICE RESOLVES, and the exit that follows the kill does not reject afterwards", async () => {
  // The settled guard: `exit` fires on every child eventually, including the
  // ones that worked. Without it a passing suite would reject during teardown.
  const child = spawn(process.execPath,
    ["-e", "process.stdout.write('listening on 1\\n'); setTimeout(() => {}, 60000)"],
    { stdio: ["ignore", "pipe", "pipe"] });
  const resolved = await awaitListening(child, { budgetMs: 30_000 });
  assert.equal(resolved, child, "it hands back the child it was given");

  const gone = new Promise((ok) => child.on("exit", ok));
  child.kill();
  await gone; // an unhandled rejection here would fail the run
});

// ── bootOnFreePort: the window between the probe and the bind ────────────────
//
// The retry is a branch only a lost race reaches, so these tests lose the race
// on purpose: a server in this process holds a port, and the probe is made to
// offer exactly that port. A child that is a bare listener stands in for the
// office — the subject is the helper, not the office's boot.

const listenerChild = (port) => spawn(process.execPath,
  ["-e", "require('node:http').createServer().listen(Number(process.argv.at(-1)), () => console.log('listening'))", String(port)],
  { stdio: ["ignore", "pipe", "pipe"] });

const holdAPort = async () => {
  const held = createServer();
  await new Promise((ok) => held.listen(0, ok));
  return held;
};

test("freePort hands back a port this process can then bind", async () => {
  const port = await freePort();
  assert.ok(Number.isInteger(port) && port > 0);
  const s = createServer();
  await new Promise((ok, no) => { s.on("error", no); s.listen(port, ok); });
  await new Promise((ok) => s.close(ok));
});

test("A PORT TAKEN BETWEEN THE PROBE AND THE BIND is asked for once more, aloud", async () => {
  const held = await holdAPort();
  const taken = held.address().port;
  const offers = [taken];
  const said = [];
  const { child, port } = await bootOnFreePort(listenerChild, {
    probe: async () => offers.shift() ?? freePort(), log: (l) => said.push(l), budgetMs: 15_000 });
  try {
    assert.notEqual(port, taken, "the second boot is on a fresh port, not the one that was taken");
    assert.equal(said.length, 1, "the retry is said exactly once");
    assert.match(said[0], new RegExp(`port ${taken} was taken .*EADDRINUSE.*retrying once`));
  } finally {
    child.kill();
    await new Promise((ok) => held.close(ok));
  }
});

test("A SECOND LOSS IS A FAILED BOOT — the helper retries once, not forever", async () => {
  const held = await holdAPort();
  const taken = held.address().port;
  const said = [];
  const err = await rejection(bootOnFreePort(listenerChild, {
    probe: async () => taken, log: (l) => said.push(l), budgetMs: 15_000 }));
  await new Promise((ok) => held.close(ok));
  assert.ok(err, "it must reject");
  assert.match(err.message, /exited before it was ready/, "the rejection is the wait's own sentence");
  assert.equal(said.length, 1, "one retry was said, and only one was made");
});
