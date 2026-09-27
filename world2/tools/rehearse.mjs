#!/usr/bin/env node
// rehearse.mjs — A TRAIN'S STORE CHANGES, RUN FIRST ON A COPY (POS-242 part 2).
//
//   node world2/tools/rehearse.mjs --tree <office checkout at the train ref> \
//        --db world2_rehearsal --password-file <runner.pw> \
//        --town-repo <town checkout> [--world-repo <world checkout>] \
//        [--arm <sql file>] [--no-clear] [--json <receipt.json>]
//   (or --url postgres://rehearsal_runner:…@host:port/<db> in place of --db/--password-file)
//
// Against the copy `deploy/world2-rehearsal-copy.sh` makes, it
//   (a) applies every `world2/schema/*.sql` in the TREE that the copy has not
//       got — decided by `migrations-landed.mjs`, because this store has no
//       migrations table — as the copy's owner, each with its result;
//   (b) runs the NEXT window's clearing with the tree's own `clearing-job.mjs`,
//       as `clearing_job`, its stamp-ingest first step as `law_ingester`;
//   (c) prints ONE receipt: migrations applied, cleared / locked / refused with
//       the refusal reasons, and the settlement's dry leg — see § THE DRY LEG.
//
// ── WHY --tree AND NOT "THIS CHECKOUT" ──────────────────────────────────────
// The runner and the code under test are different things. The runner is this
// file; the train is whatever ref is checked out at --tree, and its migrations
// and its clearing are the ones that run. So a train that does not carry this
// file can still be rehearsed, and the receipt names the tree's sha, not ours.
//
// ── IT REFUSES world2_dev, TWICE ────────────────────────────────────────────
// Before connecting: a URL or database name that names `world2_dev`, or does
// not name `rehearsal`, is refused (`rehearsalTargetRefusal`). After
// connecting: `current_database()` is asked, and so is whether this login can
// CONNECT to `world2_dev` at all — the copy's design is that it cannot
// (deploy/world2-rehearsal-copy.sh § WHO OWNS THE COPY), and a runner that can
// reach prod refuses to run rather than trusting every tool it spawns to read
// the URL it was handed. Children get an environment built from nothing: PATH,
// HOME, and the connection this runner chose. No inherited WORLD2_*, PG* or
// DATABASE_URL reaches them.
//
// ── THE PENS ────────────────────────────────────────────────────────────────
// Each child connects as rehearsal_runner with `-c role=<pen>` — in the URL's
// `options` for the tools that take a URL, in PGOPTIONS for the ones that take
// PG*. `current_user` is then the pen, so the claims trigger's
// `current_user = 'clearing_job'` passes exactly as on prod and every grant and
// row policy is the copy's (= prod's) own.
//
// ── THE DRY LEG ─────────────────────────────────────────────────────────────
// Not run. `deploy/settlement-auto.sh` is one script from the registry refresh
// to the push, and the parts that are the fold cannot be reached without it:
// see `SETTLEMENT_COUPLING` below, which the receipt prints in full.
//
// EXIT: 0 every missing migration landed and the clearing ran · 1 a migration
// failed or the clearing did not run (the receipt says which and why) · 2 refused.

import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, readdirSync, writeFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { LANDED, landedIn, schemaOrder } from "./migrations-landed.mjs";

const PROD = "world2_dev";

/** Why this URL or database name must not be rehearsed on, or null when it may. */
export function rehearsalTargetRefusal(target) {
  if (typeof target !== "string" || !target) return "no target named";
  if (target.includes(PROD)) return `it names ${PROD}, which is PROD — the rehearsal never touches it`;
  let db = target;
  if (/^postgres(ql)?:\/\//.test(target)) {
    let u;
    try { u = new URL(target); } catch { return "not a parseable URL"; }
    db = decodeURIComponent(u.pathname.replace(/^\//, "")) || u.searchParams.get("dbname") || "";
    if (!db) return "the URL names no database";
  }
  if (!/^[a-z0-9_]+$/.test(db)) return "the database name is not a plain identifier";
  if (!db.includes("rehearsal")) return `the database '${db}' does not name 'rehearsal'`;
  return null;
}

/** The runner's URL with a pen set at connection start. */
export function asPen(url, pen) {
  const u = new URL(url);
  u.searchParams.set("options", `-c role=${pen}`);
  return u.toString();
}

// The failure words a clearing leaves, reduced to the reason a receipt names.
export function clearingRefusal(output) {
  const m = /CLEARING FAILED window \d+: (.*?)(?: — nothing moved|$)/m.exec(output);
  // A clearing that CRASHED (its first step threw before its own catch) leaves a
  // stack, not a CLEARING FAILED line; the first `…Error…:` line is the reason,
  // never the trailing `Node.js v22` banner.
  const lines = output.split("\n").map((l) => l.trim()).filter(Boolean);
  const msg = m ? m[1] : (lines.find((l) => /^[A-Za-z]*Error\b.*?:/.test(l)) ?? lines.pop() ?? "no output");
  const constraint = /violates (?:unique|exclusion|check|foreign key) constraint "([^"]+)"/.exec(msg)?.[1] ?? null;
  return { reason: constraint ?? msg, detail: msg.slice(0, 400) };
}

// ── THE COUPLING, WRITTEN DOWN (brief POS-242 part 2c) ──────────────────────
// What stands between the clearing and a dry run of the fold, read from
// deploy/settlement-auto.sh at the w40 train (11eddfc).
export const SETTLEMENT_COUPLING = [
  "ONE SCRIPT, NO DRY FLAG: settlement-auto.sh runs registry refresh -> docket -> photograph -> fold input -> write-down -> sweep -> harm gate -> push main (publish_main, unconditional after the gate) -> retire -> suite -> escalate; there is no switch that stops it before the push.",
  "PUBLISH IS A GIT PUSH TO GITHUB: publish_main pushes the sweep clone's main to origin (postmark-town/postmark-world); the only way to switch it off from outside is to hand the script a sweep clone whose origin is a local bare repo — a redirect of the script's own clone, not a mode it has.",
  "THE REGISTRY STEP COMMITS INTO THE SWEEP CLONE before the fold (WORLD/households.json), and the sweep refuses a dirty checkout, so the fold cannot run without that commit landing in some clone.",
  "ESCALATE FILES GITHUB ISSUES: deploy/settlement-escalate.mjs reads a token from /srv/postmark-office/.git-credentials by default (SETTLEMENT_ESCALATE_CRED overrides) on a race or a red suite.",
  "THE FOLD'S READ IS TIED TO A FRESH CLEAR: await-clearing.mjs waits for a window cleared at or after the crossing's start (or --by-hand / --rehearse), fold-input-cli.mjs reads the store at WORLD2_PG_URL, and store-writedown.mjs writes sketchbook refs into the sweep clone — all three separable, but only by re-composing the script's order by hand, which is a second copy of the crossing that would drift from the first.",
  "THE SUITE AND THE HARM GATE ARE THE WORLD'S (tools/harm-gate.mjs, npm run test:candle in the sweep clone): a dry leg needs a world checkout with its own node_modules — a second install per rehearsal.",
];

// ── the CLI tail ────────────────────────────────────────────────────────────
const isMain = process.argv[1]
  && realpathSync(process.argv[1]).replace(/\\/g, "/").endsWith("/rehearse.mjs");

if (isMain) {
  const arg = (n) => { const i = process.argv.indexOf(n); return i === -1 ? null : process.argv[i + 1]; };
  const has = (n) => process.argv.includes(n);
  const usage = "usage: rehearse.mjs --tree <office checkout> (--db <name> --password-file <f> | --url <postgres url>) --town-repo <checkout> [--world-repo <checkout>] [--arm <sql>] [--no-clear] [--json <out>]";

  const tree = arg("--tree");
  let url = arg("--url");
  const db = arg("--db");
  if (!tree || !(url || (db && arg("--password-file"))) || (!has("--no-clear") && !arg("--town-repo"))) { console.error(usage); process.exit(2); }

  const pre = rehearsalTargetRefusal(url ?? db);
  if (pre) { console.error(`REFUSED: ${pre}`); process.exit(2); }
  if (!url) {
    const pw = readFileSync(arg("--password-file"), "utf8").trim();
    url = `postgres://rehearsal_runner:${encodeURIComponent(pw)}@${process.env.WORLD2_PGHOST ?? "127.0.0.1"}:${process.env.WORLD2_PGPORT ?? "5432"}/${db}`;
  }
  const u = new URL(url);
  const dbName = decodeURIComponent(u.pathname.slice(1));
  // The environment every child gets. Built from nothing.
  const baseEnv = {
    PATH: process.env.PATH, HOME: process.env.HOME ?? "/tmp",
    PGHOST: u.hostname, PGPORT: u.port || "5432", PGUSER: decodeURIComponent(u.username),
    PGPASSWORD: decodeURIComponent(u.password), PGDATABASE: dbName,
  };

  const receipt = { at: new Date().toISOString(), tree: null, db: dbName, runner: null, migrations: [], clearing: null,
    settlement: { rehearsed: false, coupling: SETTLEMENT_COUPLING }, verdict: null };
  const lines = [];
  const say = (s) => { lines.push(s); console.log(s); };
  let exit = 0;

  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  const q = (text, args = []) => client.query(text, args);
  try {
    receipt.tree = execFileSync("git", ["-C", tree, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    const { rows: [who] } = await q(
      `SELECT current_database() AS db, current_user AS me,
              (SELECT CASE WHEN EXISTS (SELECT 1 FROM pg_database WHERE datname = $1)
                           THEN has_database_privilege(current_user, $1, 'CONNECT') END) AS reaches_prod`, [PROD]);
    receipt.runner = who;
    if (rehearsalTargetRefusal(who.db)) { console.error(`REFUSED after connecting: ${rehearsalTargetRefusal(who.db)}`); process.exit(2); }
    if (who.reaches_prod) {
      console.error(`REFUSED: ${who.me} can CONNECT to ${PROD} — the rehearsal runs only as a login that cannot reach prod`);
      process.exit(2);
    }
    say(`REHEARSAL — tree ${receipt.tree.slice(0, 12)} on ${who.db} as ${who.me} (CONNECT on ${PROD}: ${who.reaches_prod ?? "no such database"})`);

    // (a) migrations
    const schemaDir = join(tree, "world2/schema");
    const names = schemaOrder(readdirSync(schemaDir));
    const before = await landedIn(q, names);
    say("migrations:");
    let failed = null;
    for (const m of before) {
      if (m.state === "unknown") { failed = m; receipt.migrations.push({ ...m, result: "no-probe" }); say(`  ${m.file}  NO PROBE — ${m.detail}`); break; }
      if (m.state !== "missing") { receipt.migrations.push({ ...m, result: m.state === "landed" ? "already" : "skipped" }); continue; }
      const t0 = Date.now();
      const r = spawnSync("psql", ["-X", "-q", "-v", "ON_ERROR_STOP=1", "-f", join(schemaDir, m.file)],
        { env: baseEnv, encoding: "utf8", timeout: 300_000 });
      const { rows: [again] } = await q(`SELECT (${LANDED[m.file].probe}) AS landed`);
      const entry = { file: m.file, state: again.landed ? "landed" : "missing", result: r.status === 0 && again.landed ? "applied" : "FAILED",
        exit: r.status, ms: Date.now() - t0, notices: (r.stderr || "").trim().split("\n").filter(Boolean).slice(-6) };
      receipt.migrations.push(entry);
      say(`  ${m.file}  ${entry.result} (psql exit ${r.status}, probe ${again.landed ? "landed" : "NOT landed"}, ${entry.ms} ms)${entry.result === "FAILED" ? ` — ${entry.notices.join(" | ")}` : ""}`);
      if (entry.result === "FAILED") { failed = entry; break; }
    }
    const already = receipt.migrations.filter((m) => m.result === "already").map((m) => m.file.slice(0, 3));
    const skipped = receipt.migrations.filter((m) => m.result === "skipped").map((m) => m.file.slice(0, 3));
    say(`  already on the copy: ${already.join(" ") || "none"}; not applied by design: ${skipped.join(" ") || "none"}`);

    // The falsifier's door: a state put onto the copy after the migrations and
    // before the clearing, as the copy's owner. Named on the receipt, always.
    let armFailed = false;
    if (!failed && arg("--arm")) {
      const r = spawnSync("psql", ["-X", "-q", "-v", "ON_ERROR_STOP=1", "-f", arg("--arm")], { env: baseEnv, encoding: "utf8", timeout: 120_000 });
      const said = (r.stderr || "").trim().split("\n").filter(Boolean);
      receipt.armed = { file: arg("--arm"), exit: r.status, said: said.slice(-4) };
      armFailed = r.status !== 0;
      say(`armed: ${arg("--arm")} (psql exit ${r.status}) ${said.map((l) => l.replace(/^psql:[^:]*:\d+: /, "")).join(" | ")}`);
    }

    if (failed) {
      receipt.verdict = "migration-failed";
      exit = 1;
    } else if (armFailed) {
      receipt.verdict = "arm-failed";
      exit = 1;
    } else if (has("--no-clear")) {
      receipt.verdict = "migrations-landed";
    } else {
      // (b) the next window's clearing
      const { rows: [win] } = await q("SELECT id, opens_at, closes_at FROM windows WHERE status = 'open' ORDER BY id LIMIT 1");
      if (!win) {
        receipt.clearing = { ran: false, reason: "no open window on the copy" };
        receipt.verdict = "clearing-did-not-run"; exit = 1;
        say("clearing: DID NOT RUN — no open window on the copy");
      } else {
        const { rows: [{ n: pending }] } = await q("SELECT count(*)::int AS n FROM claims WHERE window_id = $1 AND status = 'pending'", [win.id]);
        const ahead = new Date(win.closes_at) > new Date();
        const args = [join(tree, "world2/tools/clearing-job.mjs"), "--window", String(win.id), "--town-repo", arg("--town-repo")];
        if (arg("--world-repo")) args.push("--world-repo", arg("--world-repo"));
        const env = { ...baseEnv, PGOPTIONS: "-c role=law_ingester", WORLD2_CLEARING_URL: asPen(url, "clearing_job") };
        const t0 = Date.now();
        const r = spawnSync(process.execPath, args, { cwd: tree, env, encoding: "utf8", timeout: 600_000 });
        const out = `${r.stdout ?? ""}\n${r.stderr ?? ""}`;
        const base = { window: win.id, closes_at: win.closes_at, ahead_of_close: ahead, pending, ms: Date.now() - t0, exit: r.status };
        if (r.status === 0) {
          const { rows } = await q(
            "SELECT status, count(*)::int AS n FROM claims WHERE window_id = $1 GROUP BY status ORDER BY status", [win.id]);
          const { rows: refused } = await q(
            "SELECT coalesce(slug, id::text) AS slug, refusal_check FROM claims WHERE window_id = $1 AND status IN ('refused', 'held_review') ORDER BY slug", [win.id]);
          const { rows: [w] } = await q("SELECT receipts FROM windows WHERE id = $1", [win.id]);
          const count = Object.fromEntries(rows.map((x) => [x.status, x.n]));
          receipt.clearing = { ran: true, ...base, six_count: w.receipts?.six_count ?? null, statuses: count, refused,
            flags: out.split("\n").filter((l) => l.includes("⚑")).map((l) => l.trim()),
            line: out.split("\n").find((l) => l.startsWith("CLEARED")) ?? null };
          receipt.verdict = "cleared";
          const sc = w.receipts?.six_count ?? {};
          say(`clearing: window ${win.id} CLEARED${ahead ? ` ahead of its close (${new Date(win.closes_at).toISOString()}) — the docket as the copy holds it` : ""}: locked ${sc.locked ?? 0} · refused ${sc.refused ?? 0} · held_review ${sc.held_review ?? 0} · retracted ${sc.retracted_before_close ?? 0} (of ${pending} pending)`);
          for (const x of refused) say(`  refused: ${x.slug} — ${x.refusal_check}`);
          for (const f of receipt.clearing.flags) say(`  ${f}`);
        } else {
          const why = clearingRefusal(out);
          receipt.clearing = { ran: false, ...base, refused: "clearing-did-not-run", reason: why.reason, detail: why.detail };
          receipt.verdict = "clearing-did-not-run"; exit = 1;
          say(`clearing: window ${win.id} — clearing-did-not-run / ${why.reason}`);
          say(`  ${why.detail}`);
        }
      }
    }

    say("settlement dry leg: NOT REHEARSED — it does not separate from publish; the coupling:");
    for (const c of SETTLEMENT_COUPLING) say(`  · ${c}`);
    say(`published-or-would-refuse: not rehearsed (see coupling) · verdict: ${receipt.verdict}`);
  } finally {
    await client.end();
  }
  if (arg("--json")) writeFileSync(arg("--json"), `${JSON.stringify(receipt, null, 1)}\n`);
  process.exit(exit);
}
