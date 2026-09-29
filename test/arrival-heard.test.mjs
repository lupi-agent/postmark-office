// arrival-heard.test.mjs — "where did you hear about Postmark?" (POS-292).
//
// The gate, from the brief and Wright's rulings (2026-09-28):
//   H1-H4  the answer is normalised, and nothing about it can refuse a join
//   H5-H8  the real declare-exec, spawned against a real git clone with its
//          record-facing modules stubbed: an answer is kept (one INSERT, the
//          note in its params and nowhere else); a skip keeps nothing and the
//          join lands; a store that refuses the INSERT still lets the join land
//   H9     THE FALSIFIER: the note text appears in no file of the town clone,
//          no commit message, and not in the join's own answer
//   H10    the weekly counts come only through the store's suppressing function
//   H11    begin does not ask (ruling B); declare does, last and optional
//   H12    nothing in src/ but arrival-heard.mjs names the table, and nothing
//          selects from it (the store refuses that too: 030's proof)
//   H13    GET /ops/heard answers counts only, through the same function
//
// The store itself (RLS, grants, the fold of every cell under 3) is proved on
// a disposable Postgres: docs/2026-09-28/rail/pos-292/PROOF-030-embedded.txt.

import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";

import {
  HEARD, HEARD_LABELS, HEARD_KEYS, HEARD_NOTE_MAX, FEWER_THAN_3, HEARD_FIELD_NAMES,
  heardAnswer, recordHeard, heardReceipt, weeklyHeard, heardDoor,
} from "../src/arrival-heard.mjs";
import { DECLARE_SCHEMA, BEGIN_PROPERTIES } from "../src/declare.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const NOTE = "a zine left at the Porto café, zz-heard-marker-7f3a";

// ── the answer ──────────────────────────────────────────────────────────────

test("H1 · the ruled list, nine choices, each a label a person picks and a key the store keeps", () => {
  assert.equal(HEARD.length, 9);
  assert.deepEqual(HEARD_KEYS, ["youtube", "discord", "x", "reddit", "friend", "their-ai", "search", "commons", "other"]);
  // 030's CHECK is the same list; a key added here and not there would be refused by the store
  const sql = readFileSync(join(ROOT, "world2", "schema", "030_arrival_heard.sql"), "utf8");
  const check = /heard IN \(([^)]*)\)/.exec(sql)[1].split(",").map((s) => s.trim().replace(/'/g, ""));
  assert.deepEqual(check, HEARD_KEYS);
  assert.match(sql, new RegExp(`char_length\\(note\\) <= ${HEARD_NOTE_MAX}\\b`));
});

test("H2 · a label or a key, any case, is the same answer; the note rides along", () => {
  assert.deepEqual(heardAnswer({ heard: "YouTube" }), { heard: "youtube", note: null, truncated: false });
  assert.deepEqual(heardAnswer({ heard: "the commons / another agent community", heard_note: " Deva's " }), { heard: "commons", note: "Deva's", truncated: false });
  assert.deepEqual(heardAnswer({ heard: "their-ai" }), { heard: "their-ai", note: null, truncated: false });
  for (const label of HEARD_LABELS) assert.ok(heardAnswer({ heard: label })?.heard, label);
});

test("H3 · a skip is nothing; a note with no choice keeps nothing; an off-list choice keeps nothing — and none of them throws", () => {
  assert.equal(heardAnswer({}), null);
  assert.equal(heardAnswer({ heard: "  " }), null);
  assert.equal(heardAnswer({ heard_note: "hi" }).heard, undefined);
  assert.equal(heardAnswer({ heard: "tiktok" }).heard, undefined);
  assert.equal(heardAnswer({ heard: "tiktok" }).unrecognised, true);
  assert.match(heardReceipt(heardAnswer({ heard: "tiktok" }), null), /never blocks a join/);
});

test("H4 · a note over the cap is cut to it, by characters, and the receipt says so", () => {
  const long = "é".repeat(HEARD_NOTE_MAX + 20);
  const a = heardAnswer({ heard: "Other", heard_note: long });
  assert.equal([...a.note].length, HEARD_NOTE_MAX);
  assert.equal(a.truncated, true);
  assert.match(heardReceipt(a, { kept: true }), /cut to 280/);
});

test("H4b · recordHeard never throws: a refusing store and an unpointed office are answers, logged once", async () => {
  const logs = [];
  const log = (s) => logs.push(s);
  const a = heardAnswer({ heard: "Reddit" });
  assert.deepEqual(await recordHeard({ handle: "h", household: "x", answer: a, query: async () => { throw new Error("permission denied"); }, log }), { kept: false, why: "the store refused" });
  assert.deepEqual(await recordHeard({ handle: "h", household: "x", answer: a, query: async () => null, log }), { kept: false, why: "no record" });
  assert.equal(logs.length, 2);
  assert.deepEqual(await recordHeard({ handle: "h", household: "x", answer: null, query: async () => { throw new Error("never called"); } }), { kept: false });
});

// ── the exec, for real, with its record stubbed ─────────────────────────────

const homes = [];
test.after(() => { for (const d of homes) rmSync(d, { recursive: true, force: true }); });
const sh = (cwd, ...args) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();
const BOT = ["-c", "user.name=fixture", "-c", "user.email=fixture@test.invalid"];

const HOOKS = `
export async function resolve(specifier, context, next) {
  const stubs = JSON.parse(process.env.HEARD_STUBS ?? "{}");
  for (const [key, url] of Object.entries(stubs)) {
    const [parent, spec] = key.split("|");
    if (specifier === spec && context.parentURL && context.parentURL.endsWith(parent)) return { url, shortCircuit: true };
  }
  return next(specifier, context);
}
`;
const STUB_DECLARE = `
export const LANDING_GROUND = "the-landing";
export const readRegisters = async () => ({ registry: { households: {} }, pins: {} });
export const conformance = (args) => ({ handle: args.handle, household: "Newcomers", slug: "newcomers", ghId: 7, ghLogin: "newcomer-gh", card: args.card, note: args.note });
export const planDeclaration = (registry, pins, decl) => ({
  slug: decl.slug, date: "2026-09-28", settled: true, gangway: "open",
  registry: { households: { [decl.slug]: { declared_by: decl.handle } } },
  files: [
    { path: "WHITE_PAGES/" + decl.handle + "/ADDRESS.md", content: "---\\nhandle: " + decl.handle + "\\n---\\n\\n" + (decl.card ?? "") + "\\n" },
    { path: "HARBOR/berths/" + decl.handle + ".md", content: JSON.stringify(decl) + "\\n" },
  ],
});
`;
const STUB_RESIDENCY = `export const gangwayState = () => "open";\n`;
const STUB_CEREMONY = `
export const NO_DRAIN = async () => ({ ran: false });
export const collectingDrain = () => ({ drain: async () => ({ ran: true }), paths: [] });
export const mintHousehold = async () => ({});
export const joinHousehold = async () => ({ registry: { rendered: true } });
`;
// The store: every query appended to a file, so the test reads exactly what reached it.
const STUB_ACTS = `
import { appendFileSync } from "node:fs";
export async function actsQuery(text, params) {
  appendFileSync(process.env.HEARD_QUERIES, JSON.stringify({ text, params }) + "\\n");
  if (process.env.HEARD_STORE === "refuse") throw new Error("permission denied for table arrival_heard");
  if (process.env.HEARD_STORE === "none") return null;
  return [];
}
`;

function execTown() {
  const dir = mkdtempSync(join(tmpdir(), "heard-"));
  homes.push(dir);
  const origin = join(dir, "origin.git");
  const clone = join(dir, "clone");
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", origin]);
  execFileSync("git", ["clone", "-q", origin, clone], { stdio: "ignore" });
  sh(clone, "config", "core.autocrlf", "false");
  sh(clone, "checkout", "-q", "-B", "main");
  mkdirSync(join(clone, "WHITE_PAGES"), { recursive: true });
  writeFileSync(join(clone, "WHITE_PAGES", "README.md"), "# the white pages\n");
  sh(clone, "add", "-A"); sh(clone, ...BOT, "commit", "-qm", "fixture town"); sh(clone, "push", "-q", "-u", "origin", "main");
  const stubDir = join(dir, "stubs");
  mkdirSync(stubDir);
  const put = (name, text) => { writeFileSync(join(stubDir, name), text); return pathToFileURL(join(stubDir, name)).href; };
  const register = join(stubDir, "register.mjs");
  writeFileSync(register, `import { register } from "node:module"; register(${JSON.stringify(put("hooks.mjs", HOOKS))});\n`);
  const stubs = {
    "/src/declare-exec.mjs|./declare.mjs": put("declare.mjs", STUB_DECLARE),
    "/src/declare-exec.mjs|./residency.mjs": put("residency.mjs", STUB_RESIDENCY),
    "/src/declare-exec.mjs|./ceremony.mjs": put("ceremony.mjs", STUB_CEREMONY),
    "/src/arrival-heard.mjs|./world2-acts.mjs": put("world2-acts.mjs", STUB_ACTS),
  };
  const dbPath = join(dir, "office.db");
  new DatabaseSync(dbPath).close();
  return { dir, origin, clone, register, stubs, dbPath, queries: join(dir, "queries.jsonl") };
}

function declare(t, args, store = "ok") {
  const r = spawnSync(process.execPath, ["--import", pathToFileURL(t.register).href, join(ROOT, "src", "declare-exec.mjs"),
    JSON.stringify({ args: { handle: "newcomer", household: "Newcomers", card: "I am new here.", ...args }, key: { ghId: 7, ghLogin: "newcomer-gh" }, dbPath: t.dbPath })], {
    encoding: "utf8",
    env: { ...process.env, TOWN_CLONE: t.clone, TOWN_PUSH: "1", BOT_NAME: "fixture", BOT_EMAIL: "fixture@test.invalid",
      HEARD_STUBS: JSON.stringify(t.stubs), HEARD_QUERIES: t.queries, HEARD_STORE: store },
  });
  assert.equal(r.status, 0, `declare-exec answers rather than trips: ${r.stderr}`);
  return { out: JSON.parse(r.stdout.trim().split("\n").at(-1)), stdout: r.stdout, stderr: r.stderr };
}
const queriesOf = (t) => existsSync(t.queries) ? readFileSync(t.queries, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];

/** Every byte a reader of the town could see: the files, and every commit's message and patch. */
function everythingInTheTown(t) {
  const out = [];
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      if (name === ".git") continue;
      const abs = join(d, name);
      if (statSync(abs).isDirectory()) walk(abs); else out.push(relative(t.clone, abs) + "\n" + readFileSync(abs, "utf8"));
    }
  };
  walk(t.clone);
  out.push(execFileSync("git", ["--git-dir", t.origin, "log", "-p", "--all"], { encoding: "utf8" }));
  return out.join("\n");
}

test("H5 · a join WITH an answer keeps it: one INSERT into arrival_heard, the key and the note in its params, and the join landed", () => {
  const t = execTown();
  const { out } = declare(t, { heard: "Reddit", heard_note: NOTE });
  assert.equal(out.error, undefined, JSON.stringify(out));
  assert.match(out.commit ?? "", /^[0-9a-f]{40}$/);
  const q = queriesOf(t);
  assert.equal(q.length, 1);
  assert.match(q[0].text, /^INSERT INTO arrival_heard \(handle, household, heard, note, answered_at\)/);
  assert.match(q[0].text, /ON CONFLICT DO NOTHING$/, "no conflict target: a target needs SELECT, which no pen holds");
  assert.deepEqual(q[0].params.slice(0, 4), ["newcomer", "newcomers", "reddit", NOTE]);
  assert.match(out.heard_about, /kept privately/);
});

test("H6 · a join that SKIPS keeps nothing, and still lands", () => {
  const t = execTown();
  const { out } = declare(t, {});
  assert.equal(out.error, undefined, JSON.stringify(out));
  assert.match(out.commit ?? "", /^[0-9a-f]{40}$/);
  assert.equal(queriesOf(t).length, 0, "no answer, no store call");
  assert.equal("heard_about" in out, false);
});

test("H7 · a store that REFUSES the answer does not refuse the join", () => {
  const t = execTown();
  const { out, stderr } = declare(t, { heard: "YouTube" }, "refuse");
  assert.equal(out.error, undefined, JSON.stringify(out));
  assert.match(out.commit ?? "", /^[0-9a-f]{40}$/);
  assert.match(out.heard_about, /could not be kept/);
  assert.match(stderr, /\[arrival-heard\] newcomer: not kept/);
});

test("H8 · an off-list choice keeps nothing and the join lands", () => {
  const t = execTown();
  const { out } = declare(t, { heard: "a billboard", heard_note: NOTE });
  assert.equal(out.error, undefined, JSON.stringify(out));
  assert.equal(queriesOf(t).length, 0);
  assert.match(out.heard_about, /Not kept/);
});

test("H9 · THE FALSIFIER: the note reaches no file in the town, no commit, and not the join's own answer", () => {
  const t = execTown();
  const { out, stdout } = declare(t, { heard: "Other", heard_note: NOTE, note: "my public directory line" });
  assert.equal(out.error, undefined, JSON.stringify(out));
  const town = everythingInTheTown(t);
  assert.ok(town.includes("my public directory line"), "the instrument can see what a declaration DOES publish, or this proves nothing");
  assert.equal(town.includes("zz-heard-marker-7f3a"), false, "the note is in the town repo");
  assert.equal(/\bOther\b|"other"/.test(town), false, "the choice is in the town repo");
  assert.equal(stdout.includes("zz-heard-marker-7f3a"), false, "the note rides the join's answer");
  assert.ok(queriesOf(t)[0].params.includes(NOTE), "and it did reach the store");
});

// ── the counts ──────────────────────────────────────────────────────────────

test("H10 · the counts come ONLY through arrival_heard_weekly(), which never selects the note", async () => {
  const seen = [];
  const rows = await weeklyHeard({ since: "2026-09-01T00:00:00Z", query: async (text, params) => {
    seen.push({ text, params });
    return [{ week: "2026-09-21", heard: FEWER_THAN_3, n: "2" }, { week: "2026-09-21", heard: "youtube", n: "3" }];
  } });
  assert.deepEqual(rows, [{ week: "2026-09-21", heard: FEWER_THAN_3, n: 2 }, { week: "2026-09-21", heard: "youtube", n: 3 }]);
  assert.equal(seen.length, 1);
  assert.match(seen[0].text, /FROM arrival_heard_weekly\(\$1\)/);
  assert.doesNotMatch(seen[0].text, /\bnote\b|FROM arrival_heard\b(?!_)/);
  assert.equal(await weeklyHeard({ since: "x", query: async () => null }), null, "an unpointed office is null, never zeroes");
  // the function's own body folds the small cells and names no note
  const sql = readFileSync(join(ROOT, "world2", "schema", "030_arrival_heard.sql"), "utf8").split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
  const body = /CREATE OR REPLACE FUNCTION arrival_heard_weekly[\s\S]*?\$\$([\s\S]*?)\$\$/.exec(sql)[1];
  assert.match(body, /CASE WHEN n >= 3 THEN heard ELSE 'fewer-than-3' END/);
  assert.doesNotMatch(body, /\bnote\b/);
});

// ── the question, where it is asked ─────────────────────────────────────────

test("H11 · declare asks, last and optional; begin does not ask (ruling B: the parked answer is a follow-up)", async () => {
  const names = Object.keys(DECLARE_SCHEMA.properties);
  assert.deepEqual(names.slice(-2), HEARD_FIELD_NAMES);
  for (const f of HEARD_FIELD_NAMES) assert.equal(DECLARE_SCHEMA.required.includes(f), false, `${f} is optional`);
  assert.deepEqual(DECLARE_SCHEMA.properties.heard.enum, HEARD_LABELS);
  for (const f of HEARD_FIELD_NAMES) assert.equal(f in BEGIN_PROPERTIES, false, `begin does not ask ${f}`);
  assert.deepEqual(Object.keys(BEGIN_PROPERTIES), names.filter((n) => !HEARD_FIELD_NAMES.includes(n)));
});

test("H12 · nothing in src/ but arrival-heard.mjs names the table, and nothing reads it but through the counting function", () => {
  const src = join(ROOT, "src");
  const naming = readdirSync(src).filter((f) => f.endsWith(".mjs") && /\barrival_heard\b/.test(readFileSync(join(src, f), "utf8")));
  assert.deepEqual(naming, ["arrival-heard.mjs"]);
  const own = readFileSync(join(src, "arrival-heard.mjs"), "utf8");
  assert.doesNotMatch(own, /SELECT[^;`]*FROM arrival_heard\b(?!_)/, "a SELECT on the table itself");
  const exporter = readFileSync(join(ROOT, "world2", "tools", "snapshot-export.mjs"), "utf8");
  assert.doesNotMatch(exporter, /arrival_heard/);
});

test("H13 · GET /ops/heard's answer: counts and words, the fold said out loud, and no note anywhere", async () => {
  const body = await heardDoor({ weeks: 4, now: new Date("2026-09-30T00:00:00Z"), query: async () => [
    { week: "2026-09-28", heard: FEWER_THAN_3, n: 1 },
  ] });
  assert.deepEqual(body.weeks, [{ week: "2026-09-28", heard: FEWER_THAN_3, n: 1 }]);
  assert.equal(body.since, "2026-09-02T00:00:00.000Z");
  assert.equal(body.choices.reddit, "Reddit");
  assert.match(body.small_counts, /fewer than 3/);
  const unpointed = await heardDoor({ query: async () => null });
  assert.equal(unpointed.weeks, null);
  // weeks is clamped: never an unbounded read
  let asked = null;
  await heardDoor({ weeks: 9999, now: new Date("2026-09-30T00:00:00Z"), query: async (t, p) => { asked = p[0]; return []; } });
  assert.equal(asked, new Date(Date.parse("2026-09-30T00:00:00Z") - 52 * 7 * 864e5).toISOString());
});
