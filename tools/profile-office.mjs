// profile-office.mjs: a CPU profile of a running office, read through the V8
// inspector, printed as the top self-time frames and the top src/ call chains.
//
// Born in the w40/w41 load tests (2026-09-26/27): every real finding about the
// office's thread came from this, not from guessing. The Snug night's 54% git and
// 43% movement reads, dev's 91% placeWordsFrom under shadow mode, and the 29%
// everyonePlaced + 23% worldEyes that decided the w40 ship were all profiles.
//
// ON THE BOX, next to the office you want to read:
//
//   P=$(systemctl show -p MainPID --value postmark-office-dev)   # or postmark-office
//   kill -USR1 $P                    # opens the inspector on 127.0.0.1:9229
//   node tools/profile-office.mjs [--seconds 20] [--port 9229] [--top 12]
//
// SIGUSR1 opens the inspector for the life of the process and costs nothing
// until something connects. Only ONE process can hold 9229: if prod already has
// it open, the dev process's inspector lands elsewhere (see its journal line
// "Debugger listening on ws://…"), so pass that port. The inspector binds to
// loopback only; never tunnel it off the box.
//
// Read it the way the load tests did: "idle" near 0% means the thread is
// saturated, and the chains say which request paths are paying.

const arg = (name, dflt) => {
  const i = process.argv.indexOf(name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
};
const PORT = Number(arg("--port", "9229"));
const SECONDS = Number(arg("--seconds", "20"));
const TOP = Number(arg("--top", "12"));

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const ws = new WebSocket(list[0].webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const call = (method, params = {}) => new Promise((res) => {
  const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params }));
});
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
};
await new Promise((r) => (ws.onopen = r));

await call("Profiler.enable");
await call("Profiler.setSamplingInterval", { interval: 1000 });
await call("Profiler.start");
await new Promise((r) => setTimeout(r, SECONDS * 1000));
const { profile } = await call("Profiler.stop");

const byId = new Map(profile.nodes.map((n) => [n.id, n]));
const parent = new Map();
for (const n of profile.nodes) for (const c of n.children || []) parent.set(c, n.id);
const frame = (n) => `${n.callFrame.functionName || "(anon)"} ${n.callFrame.url.split("/").slice(-2).join("/")}:${n.callFrame.lineNumber + 1}`;
const counts = new Map();
for (const s of profile.samples) counts.set(s, (counts.get(s) || 0) + 1);
const total = profile.samples.length;
const self = new Map();
const chains = new Map();
let idle = 0;
for (const [nid, c] of counts) {
  const n = byId.get(nid);
  if (n.callFrame.functionName === "(idle)") { idle += c; continue; }
  self.set(frame(n), (self.get(frame(n)) || 0) + c);
  const chain = [];
  let p = nid;
  while (p && chain.length < 5) {
    const pn = byId.get(p);
    if (pn.callFrame.url.includes("/src/")) chain.push(frame(pn));
    p = parent.get(p);
  }
  const k = chain.slice(0, 4).join(" <- ") || "(no src frame)";
  chains.set(k, (chains.get(k) || 0) + c);
}
const pct = (c) => (100 * c / total).toFixed(1).padStart(5);
console.log(`profile-office: ${SECONDS}s on :${PORT}, ${total} samples, idle ${(100 * idle / total).toFixed(1)}%`);
console.log("== top self time");
for (const [k, c] of [...self].sort((a, b) => b[1] - a[1]).slice(0, TOP)) console.log(`${pct(c)}%  ${k}`);
console.log("== top src chains");
for (const [k, c] of [...chains].sort((a, b) => b[1] - a[1]).slice(0, TOP)) console.log(`${pct(c)}%  ${k}`);
await call("Profiler.disable");
ws.close();
process.exit(0);
