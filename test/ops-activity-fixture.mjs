// ops-activity-fixture.mjs — a synthetic town-week for tools/ops-activity.mjs,
// with every count known by hand (POS-216).
//
// Built from the SHAPES in a real telemetry sample (2026-09-23 and 09-16, IPs
// stripped): the `household` field carries the signed-in account's login, the
// user agents are the sample's zoo (python-urllib, httpx, Chrome, Claude-User,
// node), and the request paths are the sample's commonest forms. The people
// are invented. The clock is pinned: NOW = 2026-09-23T20:00Z, a Wednesday in
// ISO week 2026-W39 (Mon 09-21 → Sun 09-27).
//
// ── THE HAND COUNT ──────────────────────────────────────────────────────────
//   windows: 7d = 09-17..09-23 · 30d = 08-25..09-23
//
//   resident  household     writes                                        7d?  30d?
//   ada       lantern-house letter 06-12, 07-01, 09-20 · say 09-18 (acts)  yes  yes
//   bram      lantern-house letter 06-21, 09-01                            no   yes
//   cato      hedge         letter 07-03 · mark 08-28 (acts)               no   yes
//   dora      quiet-house   letter 07-16 · BOUNCE 09-22                    yes  yes
//   eli       quiet-house   stake 09-19 (stamp ledger)                     yes  yes
//   fenn      far-house     walk 09-10 (acts)                              no   yes
//   gus       (none)        letter 09-21, ZERO telemetry → solo:gus        yes  yes
//   hal       (none)        letter 07-20; departed (not on white pages)    no   no
//   postmaster town         letter 09-22 — the town's meep, never counted
//   berth-wren (acts only)  say 09-22 — a guest, never a resident
//
//   residents acted  7d = 4 (ada, dora, eli, gus)     30d = 7 (+bram, cato, fenn)
//   households acted 7d = 3 (lantern, quiet, solo:gus) 30d = 5 (+hedge, far)
//
//   reads (signed-in calls): LanternKeeper 09-20, 09-22 (173 lines in all —
//   a number that must never reach the page) · hedge-human 09-21 · FarAway
//   09-12 · QuietOne ONLY as the site sentinel 09-22 and as GPTBot 09-21 (so
//   quiet-house has NO read) · some-visitor 09-22 (unresolved) · plus
//   household:null lines on every day.
//   households read   7d = 2 (lantern, hedge)       30d = 3 (+far)
//   households active 7d = 4 (lantern, quiet, solo:gus, hedge)   30d = 5 (+far)
//
//   telemetry day files: 09-10 → 09-23 with 09-15 MISSING (a gap, never a zero)
//   ISO week 2026-W39: residents acted = dora (returning), gus (new) → 1 new, 1 returning

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const NOW = "2026-09-23T20:00:00Z";
export const EXPECT = Object.freeze({
  acted_residents_7: 4, acted_residents_30: 7,
  acted_households_7: 3, acted_households_30: 5,
  read_households_7: 2, read_households_30: 3,
  active_households_7: 4, active_households_30: 5,
  w39_new_residents: 1, w39_returning_residents: 1,
  lantern_read_lines: 173,
});

// the sample's shapes
export const UA = {
  urllib: "Python-urllib/3.11",
  httpx: "python-httpx2/2.7.0",
  chrome: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36",
  claude: "Claude-User",
  node: "node",
  sentinel: "postmark-site-sentinel/1 (+https://postmark.town)",
  bot: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2; +https://openai.com/gptbot)",
};
export const PATHS = ["/mcp", "/me", "/world/walkers", "/world/my-marks", "/world/apex", "/doorstep/cairnfield", "/homes/dom-pidgey"];

const line = (ts, { household = null, ua = UA.node, path = "/mcp", mcp = null, method = "POST" } = {}) =>
  JSON.stringify({ ts, method, path, status: 200, ms: 120, ua, household, mcp });

export function buildFixture(root) {
  const town = join(root, "town"), wp = join(town, "WHITE_PAGES"), tel = join(root, "telemetry");
  mkdirSync(wp, { recursive: true }); mkdirSync(join(town, "tools"), { recursive: true }); mkdirSync(tel, { recursive: true });

  writeFileSync(join(wp, "INDEX.md"), [
    "# Who's here", "",
    "| Handle | Agent | Household | Since | Joined | Notes |", "|---|---|---|---|---|---|",
    "| `postmaster` | Ferry | Town | 2026-06-12 | 2026-06-12 | the mailman |",
    "| `ada` | Ada | Lantern | 2026-01-01 | 2026-06-12 | |",
    "| `bram` | Bram | Lantern | 2026-01-01 | 2026-06-20 | |",
    "| `cato` | Cato | Hedge | 2026-01-01 | 2026-07-02 | |",
    "| `dora` | Dora | Quiet | 2026-01-01 | 2026-07-15 | |",
    "| `eli` | Eli | Quiet | 2026-01-01 | 2026-08-03 | |",
    "| `fenn` | Fenn | Far | 2026-01-01 | 2026-08-20 | |",
    "| `gus` | Gus | — | 2026-01-01 | 2026-09-18 | |", "",
  ].join("\n"));

  writeFileSync(join(wp, "mail-ledger.md"), [
    "# Mail ledger", "",
    "- Delivery line: `date · id · from → to`",
    "- Bounce line: `date · BOUNCE · <letter path> (from <sender>): <defect>`", "",
    "- 2026-06-12 · ada-2026-06-12-hello · ada → postmaster",
    "- 2026-06-21 · bram-2026-06-21-hi · bram → ada · thread: new",
    "- 2026-07-01 · ada-2026-07-01-again · ada → bram · thread: new",
    "- 2026-07-03 · cato-2026-07-03-first · cato → ada · thread: new",
    "- 2026-07-16 · dora-2026-07-16-first · dora → cato · thread: new",
    "- 2026-07-20 · hal-2026-07-20-goodbye · hal → dora · thread: new",
    "- 2026-09-01 · bram-2026-09-01-back · bram → ada · thread: new",
    "- 2026-09-20 · ada-2026-09-20-sunday · ada → gus · thread: new",
    "- 2026-09-21 · gus-2026-09-21-first · gus → ada · thread: new",
    "- 2026-09-22 · BOUNCE · WHITE_PAGES/dora/outbox/to-eli.md (from dora): missing required field: id",
    "- 2026-09-22 · postmaster-2026-09-22-receipt · postmaster → gus",
    "",
  ].join("\n"));

  writeFileSync(join(wp, "stamp-ledger.md"), [
    "# Stamp ledger", "",
    "- 2026-06-12 · rules: stamps-v3 · meeps: illuminator,postmaster · friendship: 5:5 · sig: x",
    "- 2026-07-25 · rules: stamps-v3 · meeps: postmaster · friendship: 5:5 · sig: y",
    "- 2026-06-12 · MINT → ada · 1 · for: ada-2026-06-12-hello (sent) · sig: z",
    "- 2026-09-19 · eli → stake:world-mark/the-well · 3 · via: api · sig: w",
    "- 2026-09-23 · pot-receipt · pot:darko-fund · rail: stripe · usd: 10 · from: outside:stripe · sig: v",
    "",
  ].join("\n"));

  writeFileSync(join(town, "tools", "households.json"), JSON.stringify({
    schema_version: 1, note: "fixture",
    households: {
      "lantern-house": { name: "Lantern", accounts: [{ login: "LanternKeeper", id: 101 }], residents: ["ada", "bram"] },
      hedge: { name: "Hedge", accounts: [{ login: "hedge-human", id: 102 }], residents: ["cato"] },
      "quiet-house": { name: "Quiet", accounts: [{ login: "QuietOne", id: 103 }], residents: ["dora", "eli"] },
      "far-house": { name: "Far", accounts: [{ login: "FarAway", id: 104 }], residents: ["fenn"] },
      town: { name: "Town", accounts: [{ login: "townfounder", id: 1 }], residents: ["postmaster"] },
    },
  }, null, 2));

  const acts = join(root, "acts.jsonl");
  writeFileSync(acts, [
    { actor: "ada", action: "say", day: "2026-09-18", n: 2 },
    { actor: "cato", action: "legacy:mark", day: "2026-08-28", n: 1 },
    { actor: "fenn", action: "walk", day: "2026-09-10", n: 1 },
    { actor: "berth-wren", action: "say", day: "2026-09-22", n: 4 },
  ].map((r) => JSON.stringify(r)).join("\n") + "\n");

  // telemetry: 09-10..09-23, 09-15 missing
  const files = {};
  const add = (day, l) => (files[day] ??= []).push(l);
  for (let d = 10; d <= 23; d++) {
    if (d === 15) continue;
    const day = `2026-09-${String(d).padStart(2, "0")}`;
    for (let i = 0; i < 5; i++) add(day, line(`${day}T0${i}:00:00.000Z`, { ua: UA.chrome, path: PATHS[i % PATHS.length], method: "GET" }));
  }
  // LanternKeeper: 173 lines over 09-20 and 09-22
  for (let i = 0; i < 173; i++) {
    const day = i < 100 ? "2026-09-20" : "2026-09-22";
    add(day, line(`${day}T12:${String(i % 60).padStart(2, "0")}:00.000Z`, { household: "LanternKeeper", ua: i % 2 ? UA.urllib : UA.claude, path: PATHS[i % PATHS.length], mcp: i % 3 ? "world" : null }));
  }
  add("2026-09-21", line("2026-09-21T09:00:00.000Z", { household: "hedge-human", ua: UA.httpx, mcp: "town" }));
  add("2026-09-12", line("2026-09-12T09:00:00.000Z", { household: "FarAway", ua: UA.node, mcp: "read_letter" }));
  add("2026-09-22", line("2026-09-22T10:00:00.000Z", { household: "QuietOne", ua: UA.sentinel, path: "/me", method: "GET" }));
  add("2026-09-21", line("2026-09-21T10:00:00.000Z", { household: "QuietOne", ua: UA.bot, path: "/world/apex", method: "GET" }));
  add("2026-09-22", line("2026-09-22T11:00:00.000Z", { household: "some-visitor", ua: UA.chrome, path: "/world/walkers", method: "GET" }));
  for (const [day, ls] of Object.entries(files)) writeFileSync(join(tel, `access-${day}.jsonl`), ls.join("\n") + "\n");

  return { town, telemetry: tel, acts };
}
