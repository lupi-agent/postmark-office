#!/usr/bin/env node
// stamp-sandbox.mjs — every stamp event, scripted, on a throwaway town ledger
// and a throwaway store, on a synthetic clock (POS-366).
//
// ── WHY ─────────────────────────────────────────────────────────────────────
//
// Darko, 2026-10-04: stamps are irreversible, so each stamp event is driven on
// purpose in a throwaway environment, on a compressed clock, whatever its
// real-life cadence, and nothing that touches stamps reaches prod until this is
// green. The week plan's rule: "nothing that touches stamps reaches prod until
// the stamp sandbox has run every stamp event on a throwaway store and ledger
// and come back green on that PR's own head."
//
// ── WHAT IT RUNS ────────────────────────────────────────────────────────────
//
//   node tools/stamp-sandbox.mjs [--town <town checkout>] [--keep] [--json]
//                                [--report <file>]
//
// One command, from the office tree whose head is under test. The office code
// it drives is THIS tree's (src/*-exec.mjs, the watchers, the drain, the
// ceremony, the ingests); the town engines it drives are the town checkout's
// own (tools/stamp-mint.mjs, ballot, epoch-close, the ferry), exactly the pair
// the box runs. `--town` defaults to this tree's `town-clone/`.
//
//   1. THE SANDBOX. A temp directory holding a `git clone --local` of the town
//      checkout with its remotes REMOVED (nothing can push), a fresh ed25519
//      key, and a fresh Postgres from test/helpers/embedded-store.mjs (every
//      migration, every role, its own port and data directory; WORLD2_PG_URL
//      and PG* are never read, so no run can reach the dev or prod store).
//      Both are deleted at the end unless --keep.
//   2. THE COPY OF THE LEDGER. The real ledger's history comes along, re-signed
//      line by line under the throwaway key (the seals do not move: a seal is a
//      hash of the text, the key only signs it), and the town's public key is
//      replaced by the throwaway one. So the town's own verifier checks the
//      whole real history and every sandbox line with one key. Real residents'
//      outboxes are emptied so only the script's letters cross.
//   3. THE STORE, seeded the way prod's was: the registry rows from the town's
//      two files, the stamp projection and escrow at the setup commit, and the
//      town index (town_stamps) seeded in a child process from a snapshot.
//   4. THE SCRIPT (tools/stamp-sandbox-script.mjs): synthetic residents, a
//      synthetic clock, and every stamp event, each through the code path the
//      box runs, each with its expected outcome written in the script.
//   5. THE CHECKS, after every step:
//        · the ledger is append-only (the old bytes are a prefix of the new);
//        · the seal chain: every seal recomputed, every new line's signature
//          verified with the sandbox key;
//        · conservation: the accounts sum to zero and none but MINT is negative;
//        · the step's expected outcome: new lines by kind, balance and staked
//          deltas per resident, and NO change to any resident it did not name;
//        · the store agrees with the git fold: stamp_projection (balance),
//          escrow_projection (open mark positions), town_stamps (balance,
//          mint_count, staked — added up delta by delta, never refolded), and
//          the funding tables' pot escrow;
//        · after every crossing, the town's own full verifier
//          (tools/stamp-verify.mjs: chain, signatures, replay, conservation,
//          lawful), as the box's crossing chain runs it, and once at the end.
//   6. THE REPORT: green, or red with the event and check that failed. Exit 0
//      green, 1 red, 2 when the sandbox itself could not be built.
//
// ── THE COMPARISON: GIT MINT AND STORE MINT ─────────────────────────────────
//
// On the w42 train the store holds no mint of its own yet: every stamp line is
// decided by the town's git engine and the store carries projections of it.
// So "the store agrees" is, today, the projections against the git fold. When
// the store mint lands (POS-341) it plugs in as one more COMPARATOR below (a
// function that reads the store and the clone after a step and returns the
// differences, each named); the script and the checks do not change.
//
// Node 22+. Runs anywhere the office suite runs (the embedded-postgres
// devDependency). Prints no secrets; holds none.

import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createPublicKey, generateKeyPairSync, verify as edVerify } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const OFFICE = resolve(HERE, "..");
const LEDGER_REL = "WHITE_PAGES/stamp-ledger.md";
const SANDBOX_DB = "stamp_sandbox";
const BOT = { BOT_NAME: "stamp-sandbox", BOT_EMAIL: "sandbox@postmark.invalid" };

// ── small helpers ────────────────────────────────────────────────────────────

const git = (repo, ...args) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 }).trim();
const importFrom = (path) => import(pathToFileURL(path).href);

/** The sandbox's environment for every child: the store and key are the sandbox's, nothing pushes, no real store is reachable. */
function childEnv(sb, extra = {}) {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (/^(PG[A-Z]*|WORLD2_[A-Z_]*URL|STAMP_KEY|TOWN_CLONE|TOWN_PUSH)$/.test(k)) delete env[k];
  return {
    ...env, ...BOT,
    TOWN_CLONE: sb.town, STAMP_KEY: sb.keyPath, TOWN_PUSH: "0", TOWN_TZ: "America/New_York",
    WORLD2_PG: "1", WORLD2_PG_URL: sb.store.url("office_api", SANDBOX_DB),
    ...extra,
  };
}

/** The store's connection fields for a role, for a child that reads PG* (the town-index CLI). */
function pgEnv(sb, role) {
  const u = new URL(sb.store.url(role, SANDBOX_DB));
  return { PGHOST: u.hostname, PGPORT: u.port, PGUSER: decodeURIComponent(u.username), PGPASSWORD: decodeURIComponent(u.password), PGDATABASE: u.pathname.slice(1) };
}

// ── the ledger, re-signed under the sandbox key ──────────────────────────────

/**
 * Every signed line of `text` re-signed with `keyPem`, the seals unchanged.
 * Uses the town's own sealChain / signSeal (`engine` is the clone's
 * tools/stamp-mint.mjs). Lines that carried no signature stay unsigned, so
 * the verifier judges the copy exactly as it judges the original.
 */
export function resignLedger(text, keyPem, engine) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const entries = engine.parseStampLedger(text);
  const seals = engine.sealChain(entries.map((e) => e.canonical));
  let i = 0;
  const out = lines.map((raw) => {
    if (!raw.startsWith("- ")) return raw;
    const e = entries[i];
    const seal = seals[i++];
    return e.sig ? `${e.canonical} · sig: ${engine.signSeal(seal, keyPem)}` : raw;
  });
  if (i !== entries.length) throw new Error(`re-sign walked ${i} entries of ${entries.length}`);
  return out.join("\n");
}

// ── the checks ───────────────────────────────────────────────────────────────

/**
 * The seal chain over `nextText`, given that `prevText` was already checked:
 * the old bytes must be the new bytes' prefix (append-only), every seal is
 * recomputed, and every NEW line's signature must verify with `pubPem`.
 */
export function chainCheck(engine, prevText, nextText, pubPem) {
  const problems = [];
  const prev = prevText.replace(/\s*$/, "\n");
  if (!nextText.startsWith(prev.trimEnd())) problems.push("append-only: the ledger's earlier bytes changed");
  const before = engine.parseStampLedger(prevText).length;
  const entries = engine.parseStampLedger(nextText);
  const seals = engine.sealChain(entries.map((e) => e.canonical));
  const pub = createPublicKey(pubPem);
  for (let i = before; i < entries.length; i++) {
    const e = entries[i];
    if (!e.sig) { problems.push(`unsigned line ${i + 1}: ${e.canonical.slice(0, 120)}`); continue; }
    if (!edVerify(null, Buffer.from(seals[i], "utf8"), pub, Buffer.from(e.sig, "base64url")))
      problems.push(`bad signature at line ${i + 1}: ${e.canonical.slice(0, 120)}`);
  }
  return { problems, appended: entries.slice(before) };
}

/** Conservation: every account sums to zero against MINT, and nothing but MINT is negative. */
export function conservation(engine, entries) {
  const bal = engine.foldBalances(entries);
  const problems = [];
  let sum = 0;
  for (const [acct, n] of bal) {
    sum += n;
    if (n < 0 && acct !== "MINT") problems.push(`${acct} is negative (${n})`);
  }
  if (sum !== 0) problems.push(`the accounts sum to ${sum}, not 0`);
  return problems;
}

/** A resident's view of the ledger: balance, staked and minted per account. */
export function holdings(engine, entries) {
  return {
    bal: engine.foldBalances(entries),
    staked: engine.foldStaked(entries),
    minted: engine.foldMintCount(entries),
  };
}

const isSystem = (acct) => acct === "MINT" || acct === "BURN" || acct.startsWith("stake:");

/**
 * The step's expectation against what happened. `expect`:
 *   lines:  { <kind>: n }            new ledger lines by the town's classifyEntry kind (exact; unlisted kinds must be 0)
 *   bal:    { <handle>: delta }      liquid balance delta (exact)
 *   staked: { <handle>: delta }      open-stake delta (exact)
 *   sums:   [{ handles, bal }]       a group's summed balance delta, for laws that cap a household, not a handle
 *   touches:[handle]                 residents allowed to move without an exact figure (rare; named in the report)
 *   others: "may-move"               the real town's residents may move (the catch-up step only: the copied
 *                                    town's own owed mints and bundles, which the box's next tick would write)
 * Every resident not named anywhere must not move at all.
 */
export function judge(engine, expect, before, after, appended) {
  const problems = [];
  const kinds = {};
  for (const e of appended) { const k = engine.classifyEntry(e.canonical).kind; kinds[k] = (kinds[k] ?? 0) + 1; }
  const wantLines = expect.lines ?? {};
  for (const k of new Set([...Object.keys(kinds), ...Object.keys(wantLines)]))
    if (expect.others !== "may-move" && (kinds[k] ?? 0) !== (wantLines[k] ?? 0)) problems.push(`lines of kind ${k}: expected ${wantLines[k] ?? 0}, got ${kinds[k] ?? 0}`);

  const delta = (m, a) => (after[m].get(a) ?? 0) - (before[m].get(a) ?? 0);
  const named = new Set([
    ...Object.keys(expect.bal ?? {}), ...Object.keys(expect.staked ?? {}),
    ...(expect.sums ?? []).flatMap((s) => s.handles), ...(expect.touches ?? []),
  ]);
  for (const [h, want] of Object.entries(expect.bal ?? {}))
    if (delta("bal", h) !== want) problems.push(`${h}: balance moved ${delta("bal", h)}, expected ${want}`);
  for (const [h, want] of Object.entries(expect.staked ?? {}))
    if (delta("staked", h) !== want) problems.push(`${h}: staked moved ${delta("staked", h)}, expected ${want}`);
  for (const s of expect.sums ?? []) {
    const got = s.handles.reduce((t, h) => t + delta("bal", h), 0);
    if (got !== s.bal) problems.push(`${s.handles.join("+")}: balance moved ${got} together, expected ${s.bal}`);
  }
  // nobody else moves: a step that pays or debits a resident it did not name is red
  const accounts = new Set([...before.bal.keys(), ...after.bal.keys(), ...before.staked.keys(), ...after.staked.keys()]);
  for (const a of accounts) {
    if (isSystem(a) || named.has(a)) continue;
    if (expect.others === "may-move" && !a.startsWith("sbx-")) continue;
    if (expect.bal?.[a] === undefined && delta("bal", a) !== 0) problems.push(`${a} was not named and its balance moved ${delta("bal", a)}`);
    if (expect.staked?.[a] === undefined && delta("staked", a) !== 0) problems.push(`${a} was not named and its stake moved ${delta("staked", a)}`);
  }
  for (const h of Object.keys(expect.bal ?? {})) if (expect.staked?.[h] === undefined && delta("staked", h) !== 0)
    problems.push(`${h}: staked moved ${delta("staked", h)}, expected 0`);
  return { problems, kinds };
}

// ── the store: the comparators ───────────────────────────────────────────────
//
// Each reads the store and the clone after a step and returns the differences
// as sentences. POS-341's store mint adds itself here.

async function compareStampProjection(sb, { sha, entries }) {
  // the git side is the town's own fold, read here and not from the ingest's derivation
  const bal = sb.engine.foldBalances(entries);
  const rows = [...sb.engine.currentHouseholds(sb.town).keys()].map((handle) => ({ handle, balance: Number(bal.get(handle) ?? 0) }));
  const held = new Map((await sb.q("law_ingester", "SELECT handle, balance FROM stamp_projection WHERE town_sha = $1", [sha])).map((r) => [r.handle, Number(r.balance)]));
  const out = [];
  if (!held.size) out.push(`stamp_projection holds no rows at ${sha.slice(0, 9)}`);
  for (const r of rows) if (held.get(r.handle) !== r.balance) out.push(`stamp_projection ${r.handle}: store ${held.get(r.handle)}, git fold ${r.balance}`);
  return out;
}

async function compareEscrow(sb, { sha, entries }) {
  const pos = sb.engine.foldWorldMarkPositions(entries);
  const rows = await sb.q("law_ingester", "SELECT mark, holder, n FROM escrow_projection WHERE town_sha = $1", [sha]);
  const out = [];
  const held = new Map();
  for (const r of rows) {
    held.set(`${r.mark}|${r.holder}`, Number(r.n));
  }
  for (const [k, n] of pos) if (held.get(k) !== n) out.push(`escrow_projection ${k}: store ${held.get(k)}, git fold ${n}`);
  for (const [k, n] of held) if (!pos.has(k)) out.push(`escrow_projection ${k}: store ${n}, git fold has no open position`);
  return out;
}

async function compareTownStamps(sb, { entries }) {
  const h = holdings(sb.engine, entries);
  const rows = await sb.q("law_ingester", "SELECT handle, balance, mint_count, staked FROM town_stamps");
  const held = new Map(rows.map((r) => [r.handle, r]));
  const out = [];
  for (const [a, n] of h.bal) {
    if (isSystem(a)) continue;
    const r = held.get(a);
    const want = { balance: n, mint_count: h.minted.get(a) ?? 0, staked: h.staked.get(a) ?? 0 };
    if (!r) { if (n || want.mint_count || want.staked) out.push(`town_stamps has no row for ${a} (git: ${JSON.stringify(want)})`); continue; }
    for (const col of ["balance", "mint_count", "staked"])
      if (Number(r[col]) !== want[col]) out.push(`town_stamps ${a}.${col}: store ${r[col]}, git fold ${want[col]}`);
  }
  return out;
}

async function comparePotEscrow(sb, { entries }) {
  const pos = sb.engine.foldPotPositions(entries);
  const tables = await sb.q("law_ingester", "SELECT to_regclass('town_pot_escrow') AS t");
  if (!tables[0]?.t) return [];
  const rows = await sb.q("law_ingester", "SELECT pot, staked FROM town_pot_escrow");
  // the index keeps per-pot totals; compare those
  const want = new Map();
  for (const [k, n] of pos) { const pot = k.split("|")[0]; want.set(pot, (want.get(pot) ?? 0) + n); }
  const out = [];
  const held = new Map(rows.map((r) => [r.pot, Number(r.staked)]));
  for (const [pot, n] of want) if (pot.startsWith("sbx-") && held.get(pot) !== n) out.push(`town_pot_escrow ${pot}: store ${held.get(pot)}, git fold ${n}`);
  return out;
}

export const COMPARATORS = [
  ["stamp_projection", compareStampProjection],
  ["escrow_projection", compareEscrow],
  ["town_stamps", compareTownStamps],
  ["town_pot_escrow", comparePotEscrow],
];

// ── the sandbox ──────────────────────────────────────────────────────────────

/**
 * Build the throwaway town and store. Answers the sandbox object the script
 * drives (`sb`). `log` receives progress lines.
 */
export async function openSandbox({ townSource, log = () => {} } = {}) {
  const source = resolve(townSource ?? join(OFFICE, "town-clone"));
  if (!existsSync(join(source, LEDGER_REL))) throw new Error(`no ${LEDGER_REL} under ${source}: --town must be a town checkout`);
  const sourceSha = git(source, "rev-parse", "HEAD");
  const dir = mkdtempSync(join(tmpdir(), "stamp-sandbox-"));
  const sb = { dir, source, sourceSha, town: join(dir, "town"), keyPath: join(dir, "sandbox-key.pem"), steps: [], cleanups: [] };

  // the key: fresh, throwaway, never the box's
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  sb.keyPem = privateKey.export({ type: "pkcs8", format: "pem" });
  sb.pubPem = publicKey.export({ type: "spki", format: "pem" });
  writeFileSync(sb.keyPath, sb.keyPem);

  // the town: a local clone with no remote, on its own branch
  log(`cloning the town at ${sourceSha.slice(0, 9)} (${source})`);
  // LF as the box has it: a Windows machine's autocrlf must not rewrite the ledger's bytes
  execFileSync("git", ["-c", "core.autocrlf=false", "clone", "--local", "--quiet", "--no-checkout", "--config", "core.autocrlf=false", source, sb.town]);
  for (const r of git(sb.town, "remote").split("\n").filter(Boolean)) git(sb.town, "remote", "remove", r);
  git(sb.town, "checkout", "-q", "-B", "sandbox", sourceSha);
  git(sb.town, "config", "user.name", BOT.BOT_NAME);
  git(sb.town, "config", "user.email", BOT.BOT_EMAIL);
  if (git(sb.town, "remote")) throw new Error("the sandbox town still has a remote");

  sb.engine = await importFrom(join(sb.town, "tools", "stamp-mint.mjs"));
  return sb;
}

/** The setup commit: real outboxes emptied, the ledger re-signed, the sandbox public key in place. */
export function prepareTown(sb, { log = () => {} } = {}) {
  const wp = join(sb.town, "WHITE_PAGES");
  let held = 0;
  for (const room of readdirSync(wp, { withFileTypes: true })) {
    if (!room.isDirectory()) continue;
    const ob = join(wp, room.name, "outbox");
    if (!existsSync(ob)) continue;
    for (const f of readdirSync(ob, { withFileTypes: true })) {
      if (f.name === ".gitkeep") continue;
      rmSync(join(ob, f.name), { recursive: true, force: true });
      held++;
    }
  }
  const ledgerPath = join(sb.town, LEDGER_REL);
  const text = readFileSync(ledgerPath, "utf8");
  const copy = resignLedger(text, sb.keyPem, sb.engine);
  writeFileSync(ledgerPath, copy);
  writeFileSync(join(sb.town, "tools", "stamp-pubkey.pem"), sb.pubPem);
  const carried = carryRuledSignatures(sb.town, sb.engine.parseStampLedger(text), sb.engine.parseStampLedger(copy));
  git(sb.town, "add", "-A");
  git(sb.town, "commit", "-q", "-m", `sandbox: the ledger re-signed under a throwaway key; ${held} real outbox item(s) set aside`);
  log(`setup commit: ${held} real outbox item(s) set aside, ${sb.engine.parseStampLedger(text).length} ledger lines re-signed` +
    (carried.length ? `; ${carried.length} ruled exception(s) the town names by signature carried to the new signature (${carried.map((c) => `${c.file}:line ${c.line}`).join(", ")})` : ""));
  return { held, carried };
}

/**
 * THE TOWN NAMES SOME RULED EXCEPTIONS BY SIGNATURE (stamp-verify.mjs §
 * RULED_WELCOMES: three welcome lines the founder ruled stay out). A signature
 * is bound to the key, so the re-signed copy would turn exactly those lines red.
 * Each old signature that appears in a town tool is replaced, in the throwaway
 * clone only, by the new signature of the SAME line: the exception still names
 * that one line and nothing else.
 */
export function carryRuledSignatures(town, before, after) {
  const map = new Map();
  before.forEach((e, i) => { if (e.sig && after[i]?.sig && after[i].canonical === e.canonical) map.set(e.sig, { sig: after[i].sig, line: i + 1 }); });
  const carried = [];
  const dir = join(town, "tools");
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".mjs"))) {
    const p = join(dir, f);
    let src = readFileSync(p, "utf8");
    const found = [...new Set(src.match(/[A-Za-z0-9_-]{86}/g) ?? [])].filter((s) => map.has(s));
    if (!found.length) continue;
    for (const s of found) { src = src.split(s).join(map.get(s).sig); carried.push({ file: `tools/${f}`, line: map.get(s).line }); }
    writeFileSync(p, src);
  }
  return carried;
}

/** The store, seeded as prod's was. The town index seeds in a child from a snapshot; `sb.indexReady` resolves when it has. */
export async function openStore(sb, { log = () => {} } = {}) {
  const { startStore } = await importFrom(join(OFFICE, "test/helpers/embedded-store.mjs"));
  sb.store = await startStore({ db: SANDBOX_DB });
  sb.cleanups.push(() => sb.store.stop());
  const clients = new Map();
  sb.q = async (role, text, params = []) => {
    if (!clients.has(role)) clients.set(role, await sb.store.connect(role, SANDBOX_DB));
    return (await clients.get(role).query(text, params)).rows;
  };
  sb.client = async (role) => { if (!clients.has(role)) clients.set(role, await sb.store.connect(role, SANDBOX_DB)); return clients.get(role); };
  sb.cleanups.unshift(async () => { for (const c of clients.values()) await c.end().catch(() => {}); });

  // in-process office modules read process.env: point it at the sandbox, and nowhere else
  const env = childEnv(sb);
  for (const k of Object.keys(process.env)) if (/^(PG[A-Z]*|WORLD2_[A-Z_]*URL)$/.test(k)) delete process.env[k];
  Object.assign(process.env, {
    WORLD2_PG: env.WORLD2_PG, WORLD2_PG_URL: env.WORLD2_PG_URL, STAMP_KEY: sb.keyPath, TOWN_PUSH: "0",
    TOWN_CLONE: sb.town, TOWN_TZ: env.TOWN_TZ, ...BOT,
  });
  const u = new URL(process.env.WORLD2_PG_URL);
  if (u.hostname !== "127.0.0.1") throw new Error(`the sandbox store must be local, not ${u.hostname}`);

  // the registry, from the town's two files (the store is the record since POS-158)
  const { rowsFromRegistry } = await importFrom(join(OFFICE, "src/registry-rows.mjs"));
  const { insertRegistryRows } = await importFrom(join(OFFICE, "src/registry-store.mjs"));
  const readJson = (rel) => JSON.parse(readFileSync(join(sb.town, rel), "utf8"));
  const counts = await insertRegistryRows(rowsFromRegistry(readJson("tools/households.json"), readJson("tools/github-ids.json")));
  log(`store: registry seeded (${counts.households} households, ${counts.pins} pins)`);

  // the stamp projection at the setup commit
  sb.sha = git(sb.town, "rev-parse", "HEAD");
  await ingestStamps(sb);

  // the town index: the whole history once, in a child, from a snapshot (the box seeded it once too)
  const snap = join(sb.dir, "town-at-setup");
  execFileSync("git", ["-c", "core.autocrlf=false", "clone", "--local", "--quiet", "--config", "core.autocrlf=false", sb.town, snap]);
  const seedSha = sb.sha;
  sb.indexHead = seedSha;
  sb.indexReady = new Promise((ok, no) => {
    const t0 = Date.now();
    const child = spawn(process.execPath, [join(OFFICE, "world2/tools/town-index-ingest.mjs"), "--town-repo", snap, "--sha", seedSha, "--seed", "--json"],
      { cwd: OFFICE, env: { ...childEnv(sb), ...pgEnv(sb, "law_ingester") }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let out = "", err = "";
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { err += d; });
    child.on("exit", (code) => {
      if (code === 0) { log(`store: town index seeded in ${Math.round((Date.now() - t0) / 1000)} s`); ok(); }
      else no(new Error(`the town index seed exited ${code}: ${(err || out).trim().split("\n").slice(-3).join(" | ")}`));
    });
  });
  sb.indexReady.catch(() => {});
}

/** stamp-ingest's one transaction at the clone's HEAD: stamps, roll, escrow. */
export async function ingestStamps(sb) {
  const { deriveStamps, writeStamps } = await importFrom(join(OFFICE, "world2/tools/stamp-ingest.mjs"));
  const { deriveRoll } = await importFrom(join(OFFICE, "world2/tools/roll-ingest.mjs"));
  const { deriveEscrow } = await importFrom(join(OFFICE, "world2/tools/escrow-ingest.mjs"));
  const townSha = git(sb.town, "rev-parse", "HEAD");
  const [{ rows }, roll, escrow] = await Promise.all([deriveStamps({ townRepo: sb.town }), deriveRoll({ townRepo: sb.town }), deriveEscrow({ townRepo: sb.town })]);
  await writeStamps(await sb.client("law_ingester"), { townSha, rows, rollRows: roll.rows, escrowRows: escrow.rows });
  return townSha;
}

/** The town index's delta from its head to the clone's HEAD (the stamp folds added, never refolded). */
export async function ingestIndexDelta(sb) {
  await sb.indexReady;
  const { ingest } = await importFrom(join(OFFICE, "world2/tools/town-index-ingest.mjs"));
  const sha = git(sb.town, "rev-parse", "HEAD");
  if (sha === sb.indexHead) return;
  await ingest(await sb.client("law_ingester"), { townRepo: sb.town, sha });
  sb.indexHead = sha;
}

export async function closeSandbox(sb, { keep = false, log = () => {} } = {}) {
  for (const c of sb.cleanups) { try { await c(); } catch (e) { log(`cleanup: ${e.message}`); } }
  if (keep) { log(`kept: ${sb.dir}`); return; }
  try { rmSync(sb.dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); }
  catch (e) { log(`left ${sb.dir} behind (${e.code ?? e.message})`); }
}

// ── the run ──────────────────────────────────────────────────────────────────

const readLedger = (sb) => readFileSync(join(sb.town, LEDGER_REL), "utf8");

/** The town's own full verifier, as the box's crossing chain runs it. */
export function fullVerify(sb) {
  const r = spawnSync(process.execPath, [join(sb.town, "tools", "stamp-verify.mjs")], { cwd: sb.town, env: childEnv(sb), encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const text = `${r.stdout ?? ""}${r.stderr ?? ""}`.trim();
  return { ok: r.status === 0, line: text.split("\n").filter(Boolean).slice(-1)[0] ?? "", text };
}

/**
 * Run the script. Answers `{ green, steps: [{ id, event, title, ok, problems, notes, ms }], ... }`.
 * Stops at the first red step: what follows a red step would be judged against
 * a state the script did not intend.
 */
export async function runSandbox({ townSource, keep = false, log = () => {} } = {}) {
  const t0 = Date.now();
  const report = { green: false, office_head: null, town_source: null, town_sha: null, steps: [], verifies: 0 };
  try { report.office_head = git(OFFICE, "rev-parse", "HEAD"); } catch { /* an exported tree */ }
  let sb;
  try {
    sb = await openSandbox({ townSource, log });
    report.town_source = sb.source;
    report.town_sha = sb.sourceSha;
    report.sandbox = sb.dir;
    prepareTown(sb, { log });
    await openStore(sb, { log });

    // the whole real history, verified once under the sandbox key, before any event
    const v0 = fullVerify(sb);
    report.verifies++;
    report.history = v0.line;
    if (!v0.ok) throw Object.assign(new Error(`the re-signed history does not verify: ${v0.line}`), { setup: true });
    log(`history: ${v0.line}`);

    const { scenario } = await importFrom(join(HERE, "stamp-sandbox-script.mjs"));
    const ctx = await makeContext(sb, { log });
    const steps = scenario(ctx);
    report.events = [...new Set(steps.map((s) => s.event))];
    let prevText = readLedger(sb);
    let before = holdings(sb.engine, sb.engine.parseStampLedger(prevText));

    for (const step of steps) {
      const s0 = Date.now();
      const rec = { id: step.id, event: step.event, title: step.title, ok: false, problems: [], notes: [], findings: [] };
      report.steps.push(rec);
      log(`· ${step.id} [${step.event}] ${step.title}`);
      let result;
      try { result = await step.run(ctx); }
      catch (e) { rec.problems.push(`the step threw: ${String(e?.stack ?? e).split("\n").slice(0, 4).join(" | ")}`); }
      if (result?.notes) rec.notes.push(...result.notes);
      // a door's refusal is an answer, not a throw: name it, so a red step says why nothing landed
      for (const r of [result, ...(Array.isArray(result) ? result : [])])
        if (r?.error) rec.notes.push(`a door refused: ${r.error.code ?? ""} ${r.error.defect ?? JSON.stringify(r.error)}`.trim());

      const nextText = readLedger(sb);
      const entries = sb.engine.parseStampLedger(nextText);
      const chain = chainCheck(sb.engine, prevText, nextText, sb.pubPem);
      rec.problems.push(...chain.problems.map((p) => `seal chain: ${p}`));
      rec.problems.push(...conservation(sb.engine, entries).map((p) => `conservation: ${p}`));
      const after = holdings(sb.engine, entries);
      const expect = typeof step.expect === "function" ? step.expect(ctx, result) : (step.expect ?? {});
      const j = judge(sb.engine, expect, before, after, chain.appended);
      rec.problems.push(...j.problems.map((p) => `expected outcome: ${p}`));
      rec.lines = j.kinds;
      if (step.check) {
        try {
          // a check's "finding: …" is a defect the script has measured and named but does not gate on
          // (a ruling or another lane's fix is owed); it is reported on every run until it stops being true
          for (const p of (await step.check(ctx, result)) ?? []) {
            if (/^finding: /.test(p)) rec.findings.push(p.slice(9));
            else rec.problems.push(`${step.event}: ${p}`);
          }
        } catch (e) { rec.problems.push(`the step's own check threw: ${e.message}`); }
      }
      if (step.finding) rec.findings.push(step.finding);

      // the store, at the commit the step left
      if (git(sb.town, "status", "--porcelain")) { git(sb.town, "add", "-A"); git(sb.town, "commit", "-q", "-m", `sandbox: ${step.id} residue`); rec.notes.push("the step left uncommitted files; the sandbox committed them"); }
      const sha = git(sb.town, "rev-parse", "HEAD");
      try {
        await ingestStamps(sb);
        await ingestIndexDelta(sb);
        for (const [name, cmp] of COMPARATORS)
          rec.problems.push(...(await cmp(sb, { sha, entries })).map((p) => `store (${name}): ${p}`));
      } catch (e) { rec.problems.push(`store: ${String(e?.message ?? e).slice(0, 300)}`); }

      if (step.verify) {
        const v = fullVerify(sb);
        report.verifies++;
        rec.verify = v.line;
        if (!v.ok) rec.problems.push(`stamp-verify: ${v.line}`);
      }
      rec.ms = Date.now() - s0;
      rec.ok = rec.problems.length === 0;
      log(`  ${rec.ok ? "green" : "RED"} (${Math.round(rec.ms / 100) / 10} s)${rec.ok ? "" : "\n    " + rec.problems.join("\n    ")}`);
      prevText = nextText;
      before = after;
      if (!rec.ok) break;
    }

    if (report.steps.length && report.steps.every((s) => s.ok)) {
      const v = fullVerify(sb);
      report.verifies++;
      report.final_verify = v.line;
      report.green = v.ok;
      if (!v.ok) report.steps.push({ id: "final", event: "verify", title: "the town's full verifier over the finished ledger", ok: false, problems: [`stamp-verify: ${v.line}`], notes: [] });
    }
  } catch (e) {
    report.error = String(e?.message ?? e);
    report.setup_failed = Boolean(e?.setup) || !report.steps.length;
  } finally {
    if (sb) await closeSandbox(sb, { keep, log });
    report.ms = Date.now() - t0;
  }
  return report;
}

// ── the context the script drives ────────────────────────────────────────────

async function makeContext(sb, { log }) {
  const tail = (rel) => {
    const m = [...readFileSync(join(sb.town, rel), "utf8").matchAll(/^- (\d{4}-\d{2}-\d{2}) /gm)];
    return m.length ? m.map((x) => x[1]).sort().at(-1) : "1970-01-01";
  };
  const addDays = (date, n) => new Date(Date.parse(`${date}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
  const start = addDays([tail(LEDGER_REL), tail("WHITE_PAGES/mail-ledger.md")].sort().at(-1), 1);

  const ctx = {
    sb, log, town: sb.town, office: OFFICE, keyPath: sb.keyPath, engine: sb.engine,
    clock: { start, date: start, addDays },
    env: (extra) => childEnv(sb, extra),
    git: (...a) => git(sb.town, ...a),
    importOffice: (rel) => importFrom(join(OFFICE, rel)),
    importTown: (rel) => importFrom(join(sb.town, rel)),
    entries: () => sb.engine.parseStampLedger(readLedger(sb)),
    holdings: () => holdings(sb.engine, sb.engine.parseStampLedger(readLedger(sb))),

    /** Move the clock to an absolute date (never backwards). */
    setDate(date) { if (date < ctx.clock.date) throw new Error(`the clock never runs backwards (${ctx.clock.date} → ${date})`); ctx.clock.date = date; },
    nextDay() { ctx.clock.date = addDays(ctx.clock.date, 1); return ctx.clock.date; },

    /** Commit everything the step wrote, as the pen would. */
    commit(message) {
      if (!git(sb.town, "status", "--porcelain")) return null;
      git(sb.town, "add", "-A");
      git(sb.town, "commit", "-q", "-m", message);
      return git(sb.town, "rev-parse", "HEAD");
    },

    /** A town tool, as the box runs it (cwd the clone). Throws on a non-zero exit unless `allowFail`. */
    townTool(tool, args = [], { allowFail = false } = {}) {
      const r = spawnSync(process.execPath, [join(sb.town, "tools", tool), ...args], { cwd: sb.town, env: childEnv(sb), encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
      const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
      if (r.status !== 0 && !allowFail) throw new Error(`${tool} ${args.join(" ")} exited ${r.status}: ${out.trim().split("\n").slice(-4).join(" | ")}`);
      return { code: r.status, out };
    },

    /** An office deploy/ or tools/ script, as the box runs it. */
    officeTool(rel, args = [], { allowFail = false, extraEnv = {} } = {}) {
      const r = spawnSync(process.execPath, [join(OFFICE, rel), ...args], { cwd: OFFICE, env: childEnv(sb, extraEnv), encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
      const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
      if (r.status !== 0 && !allowFail) throw new Error(`${rel} exited ${r.status}: ${out.trim().split("\n").slice(-4).join(" | ")}`);
      return { code: r.status, out };
    },

    /** One office pen exec (src/<name>-exec.mjs), one JSON line back. */
    exec(name, payload) {
      const r = spawnSync(process.execPath, [join(OFFICE, "src", `${name}.mjs`), JSON.stringify(payload)], { cwd: OFFICE, env: childEnv(sb), encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
      const last = (r.stdout ?? "").trim().split("\n").filter(Boolean).at(-1);
      if (r.status !== 0 || !last) throw new Error(`${name} exited ${r.status}: ${(r.stderr || r.stdout || "").trim().split("\n").slice(-3).join(" | ")}`);
      return JSON.parse(last);
    },

    /** A letter in a resident's outbox, for the next crossing. */
    letter(from, to, { slug = null, pays = null, fields = {}, body = "A sandbox letter." } = {}) {
      ctx.letterSeq = (ctx.letterSeq ?? 0) + 1;
      const s = slug ?? `sandbox-${ctx.letterSeq}`;
      const id = `${from}-${ctx.clock.date}-to-${to}-${s}`;
      const fm = { id, from, to, date: ctx.clock.date, thread: "new", ...(pays != null ? { pays } : {}), ...fields };
      const dir = join(sb.town, "WHITE_PAGES", from, "outbox");
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, `${id}.md`), `---\n${Object.entries(fm).map(([k, v]) => `${k}: ${v}`).join("\n")}\n---\n\n${body}\n`);
      return id;
    },

    /**
     * One crossing, in the box's order (deploy/postmark-ferry.service): the
     * ferry delivers, the mint pass appends, the ballot pass applies mailed
     * stakes; then the keep tick's welcome pass (deploy/office-keep.sh).
     * Each writer's rows are committed as the box commits them. The full
     * verifier runs once, after the crossing (the step's `verify: true`).
     */
    crossing({ welcome = true } = {}) {
      const date = ctx.clock.date;
      const ferry = ctx.townTool("ferry.mjs", ["--no-git", "--date", date]);
      ctx.commit(`ferry: crossing ${date}`);
      const mint = ctx.townTool("stamp-mint.mjs", ["--append", "--key", sb.keyPath]);
      ctx.commit("mint: crossing pass");
      const ballot = ctx.townTool("ballot-pass.mjs", ["--key", sb.keyPath, "--date", date]);
      ctx.commit("ballot: crossing pass");
      let wel = null;
      if (welcome) {
        wel = ctx.officeTool("deploy/welcome-pass.mjs", ["--town", sb.town, "--key", sb.keyPath, "--date", date], { allowFail: true });
        ctx.commit("mint: tick catch-up pass");
      }
      return { ferry: ferry.out, mint: mint.out, ballot: ballot.out, welcome: wel?.out ?? null, welcomeCode: wel?.code ?? null };
    },
  };
  return ctx;
}

// ── the report ───────────────────────────────────────────────────────────────

export function renderReport(r) {
  const out = [];
  out.push(`# stamp sandbox: ${r.green ? "GREEN" : "RED"}`);
  out.push("");
  out.push(`office head ${r.office_head ?? "(unknown)"} · town ${r.town_sha ?? "(none)"} (${r.town_source ?? "?"}) · ${Math.round((r.ms ?? 0) / 1000)} s · ${r.verifies} full verifies`);
  if (r.history) out.push(`history under the sandbox key: ${r.history}`);
  if (r.error) out.push(`\nTHE SANDBOX ${r.setup_failed ? "COULD NOT BE BUILT" : "TRIPPED"}: ${r.error}`);
  out.push("");
  for (const s of r.steps) {
    out.push(`${s.ok ? "ok " : "RED"} ${s.id} [${s.event}] ${s.title}${s.ms != null ? ` (${Math.round(s.ms / 100) / 10} s)` : ""}`);
    if (s.lines && Object.keys(s.lines).length) out.push(`      lines: ${Object.entries(s.lines).map(([k, n]) => `${k} ${n}`).join(", ")}`);
    for (const n of s.notes ?? []) out.push(`      note: ${n}`);
    for (const f of s.findings ?? []) out.push(`      FINDING: ${f}`);
    for (const p of s.problems ?? []) out.push(`      ✗ ${p}`);
  }
  if (r.final_verify) out.push(`\nfinal: ${r.final_verify}`);
  if (r.events) out.push(`\nevents covered: ${r.events.join(", ")}`);
  const red = r.steps.find((s) => !s.ok);
  out.push("");
  out.push(r.green ? "GREEN: every stamp event ran on a throwaway store and ledger and matched its expected outcome."
    : red ? `RED at ${red.id} [${red.event}]: ${red.problems[0]}` : `RED: ${r.error ?? "no step ran"}`);
  return out.join("\n");
}

// ── CLI ──────────────────────────────────────────────────────────────────────

const USAGE = "usage: node tools/stamp-sandbox.mjs [--town <town checkout>] [--keep] [--json] [--report <file>]";

async function main(argv = process.argv.slice(2)) {
  if (argv.includes("--help") || argv.includes("-h")) { console.log(USAGE); return 0; }
  const arg = (n) => { const i = argv.indexOf(n); return i === -1 ? null : argv[i + 1]; };
  const known = new Set(["--town", "--keep", "--json", "--report"]);
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith("--")) continue;
    if (!known.has(argv[i])) { console.error(`unknown flag ${argv[i]}\n${USAGE}`); return 2; }
  }
  const town = arg("--town");
  if (town && !existsSync(join(town, LEDGER_REL))) { console.error(`no ${LEDGER_REL} under ${town}\n${USAGE}`); return 2; }
  const json = argv.includes("--json");
  const report = await runSandbox({
    townSource: town, keep: argv.includes("--keep"),
    log: json ? () => {} : (l) => console.log(l),
  });
  const text = renderReport(report);
  const reportPath = arg("--report");
  if (reportPath) writeFileSync(reportPath, (json ? JSON.stringify(report, null, 2) : text) + "\n");
  console.log(json ? JSON.stringify(report, null, 2) : `\n${text}`);
  return report.green ? 0 : report.setup_failed ? 2 : 1;
}

// The junction lesson: compare real paths (test/cli-guard.test.mjs spawns this through a junction).
const isMain = (() => {
  if (!process.argv[1]) return false;
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return pathToFileURL(process.argv[1]).href === import.meta.url; }
})();
if (isMain) main().then((code) => process.exit(code), (e) => { console.error(String(e?.stack ?? e)); process.exit(2); });
