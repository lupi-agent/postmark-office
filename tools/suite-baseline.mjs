#!/usr/bin/env node
// suite-baseline.mjs — one suite result per train tip, recorded once, read by every lane.
//
// THE INSTANCE (POS-193, Keemin 2026-09-22: "the classic gigantic suite run"):
// the office suite is ~16 min wall-clock, and every lane ran it two or three
// times — the tip's baseline, the branch, the flip. The baseline is a fact
// about the TIP, not the lane: on 09-22 four lanes measured the same 8 reds on
// the same tip, independently. So the tip's result is taken ONCE and kept where
// every machine can read it, and a lane compares its own reds against it by name.
//
// THE RECEIPT'S HOME is a GitHub commit comment on the tip it describes (JSON in
// one fenced block, headed `suite-baseline`). Cross-machine, no repo churn, and
// no file that changes the tip it describes — a receipt committed to the branch
// would be a receipt for the commit BEFORE it.
//
// A RECEIPT FOR ANOTHER TIP IS A MISS, NEVER A MATCH. `--read` asks for exactly
// the sha named and keeps only a receipt whose own `tip` is that sha; it never
// walks to a parent or a child. `--compare` refuses when the receipt's tip is
// not the merge-base the lane names. A stale receipt is worse than none: it
// reads as a baseline and describes code the lane does not have.
//
// USAGE
//   node tools/suite-baseline.mjs [--tip <sha>] [--out <file>] [--no-post] [--again]
//       take: refuse on a dirty tree, HEAD != tip, or an unprovisioned tree
//       (exit 2); run `npm test`'s own command once with the junit reporter;
//       print the receipt and post it on the tip. If a receipt already exists
//       for the tip it is printed and the suite is NOT run (--again overrides).
//   node tools/suite-baseline.mjs --read <sha>
//       print the newest receipt on that sha; exit 1 when there is none.
//   node tools/suite-baseline.mjs --compare <mine> --base <merge-base> [--receipt <file>]
//       <mine> is a receipt JSON (take --no-post --out) or a junit file. Prints
//       `same`, or `new: [...]` / `gone: [...]`; exit 0 only on `same`.
//   --repo <owner/name> (default postmark-town/postmark-office)
//
// EXIT: 0 done / same · 1 differs / no receipt / post failed · 2 refused.

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const HEADING = "suite-baseline";
const DEFAULT_REPO = "postmark-town/postmark-office";
const SHA40 = /^[0-9a-f]{40}$/;

class Refusal extends Error {}
const refuse = (sentence) => { throw new Refusal(sentence); };

// ── the junit reporter's output ─────────────────────────────────────────────
//
// node's junit reporter nests a test that has subtests (and every `describe`)
// as a <testsuite>, and writes the leaves as <testcase file="…">. A red is a
// LEAF with a failure: a parent that failed only because a child did carries
// no failure element of its own, so the runner's `fail` count can exceed the
// number of names. The counts are kept as the runner printed them and the
// names are the leaves; the compare is by name.
//
// Attribute values may carry a raw `>` (the reporter escapes only `"`, `<`,
// `&`), so tags are matched attribute by attribute, never with `[^>]*`.

const ENTITIES = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };
const decode = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => {
  if (e[0] === "#") return String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
  return ENTITIES[e] ?? m;
});
const attrsOf = (s) => {
  const out = {};
  for (const m of s.matchAll(/([\w:-]+)="([^"]*)"/g)) out[m[1]] = decode(m[2]);
  return out;
};

const TOKEN = /<(\/?)(testsuite|testcase|failure)\b((?:\s+[\w:-]+="[^"]*")*)\s*(\/?)>|<!--\s*(\w+)\s+([\d.]+)\s*-->/g;

/** Parse node's junit output. `root` is the tree the paths are named from. */
export function parseJunit(xml, root = process.cwd()) {
  const totals = {};
  const reds = new Set();
  const suites = [];
  let open = null; // the <testcase> whose children we are inside

  const finish = (tc) => {
    if (!tc.failed) return;
    const file = tc.file ? relative(root, tc.file).split("\\").join("/") : "";
    // A file that fails to LOAD is reported as one top-level testcase named
    // for the file itself; its name is the file, not "file > file".
    const loadFailure = !tc.chain.length && tc.file && resolve(root, tc.name) === resolve(tc.file);
    const parts = loadFailure ? [file] : [file, ...tc.chain, tc.name].filter(Boolean);
    reds.add(parts.join(" > "));
  };

  for (const m of xml.matchAll(TOKEN)) {
    const [, close, tag, attrText, selfClose, counter, value] = m;
    if (counter) { totals[counter] = Number(value); continue; }
    if (tag === "testsuite") {
      if (close) suites.pop(); else if (!selfClose) suites.push(attrsOf(attrText).name ?? "");
    } else if (tag === "testcase") {
      if (close) { if (open) finish(open); open = null; continue; }
      const a = attrsOf(attrText);
      const tc = { name: a.name ?? "", file: a.file, chain: [...suites], failed: a.failure !== undefined };
      if (selfClose) finish(tc); else open = tc;
    } else if (tag === "failure" && !close && open) {
      open.failed = true;
    }
  }
  if (totals.tests === undefined) refuse("the reporter's output has no summary counts — a truncated run is not a receipt");
  return { totals, reds: [...reds].sort() };
}

/** Diff a lane's red set against the receipt's, by name. */
export function compareReds(mine, base) {
  const b = new Set(base);
  const m = new Set(mine);
  return { new: [...m].filter((n) => !b.has(n)).sort(), gone: [...b].filter((n) => !m.has(n)).sort() };
}

export function receiptBody(receipt) {
  return `${HEADING}\n\n\`\`\`json\n${JSON.stringify(receipt, null, 2)}\n\`\`\`\n`;
}

/**
 * The newest receipt among one sha's comments whose own `tip` is that sha.
 * A comment that is not a receipt, or a receipt naming another tip, is not
 * this sha's receipt — it is skipped, never used as a stand-in.
 */
export function pickReceipt(comments, sha) {
  const found = [];
  for (const c of comments) {
    const body = String(c.body ?? "");
    if (!body.trimStart().startsWith(HEADING)) continue;
    const block = body.match(/```json\s*\n([\s\S]*?)\n```/);
    if (!block) continue;
    let receipt;
    try { receipt = JSON.parse(block[1]); } catch { continue; }
    if (receipt?.tip !== sha) continue;
    found.push({ receipt, url: c.html_url, at: String(c.created_at ?? "") });
  }
  found.sort((x, y) => (x.at < y.at ? 1 : x.at > y.at ? -1 : 0));
  return found[0] ?? null;
}

// ── git, gh ─────────────────────────────────────────────────────────────────

const git = (args, cwd) => {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : null;
};

/** A sha as the full forty hex characters, from git when it can, else as given. */
function fullSha(sha, cwd) {
  // Asked of git AS GIVEN: `HEAD` lowercased is a ref only a case-insensitive disk finds.
  const given = String(sha).trim();
  const resolved = git(["rev-parse", "--verify", "--quiet", `${given}^{commit}`], cwd);
  if (resolved) return resolved;
  const s = given.toLowerCase();
  if (SHA40.test(s)) return s;
  refuse(`cannot resolve ${sha} to a full sha here — name all forty characters`);
}

// `gh` is found on PATH (a test puts a stub there). On Windows a stub is a
// `.cmd`, which only a shell runs, so the command line is built and quoted here.
function gh(args) {
  const r = process.platform === "win32"
    ? spawnSync(["gh", ...args].map((a) => (/[\s"&|<>^]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a)).join(" "), { shell: true, encoding: "utf8" })
    : spawnSync("gh", args, { encoding: "utf8" });
  return { ok: r.status === 0, stdout: r.stdout ?? "", stderr: (r.stderr ?? "") + (r.error ? String(r.error) : "") };
}

function readComments(repo, sha) {
  const r = gh(["api", `repos/${repo}/commits/${sha}/comments?per_page=100`, "--paginate", "--slurp"]);
  if (!r.ok) refuse(`gh could not read the comments on ${sha}: ${r.stderr.trim().split("\n")[0]}`);
  return JSON.parse(r.stdout || "[]").flat();
}

// ── take ────────────────────────────────────────────────────────────────────

/** Refuse (one sentence) unless this tree can produce a receipt worth reading. */
export async function assertProvisioned(root) {
  if (!existsSync(join(root, "node_modules", ".package-lock.json"))) {
    refuse("the tree is not provisioned: no node_modules — run `npm ci` first");
  }
  // The suites' OWN resolver, so the tool sees exactly the checkouts they see.
  const helper = join(root, "test", "fixture-paths.mjs");
  if (!existsSync(helper)) refuse(`the tree is not provisioned: no ${relative(root, helper)} — is this an office tree?`);
  const paths = await import(pathToFileURL(helper).href);
  const town = paths.townClone();
  if (!town) refuse(`the tree is not provisioned: ${paths.NO_TOWN}`);
  if (!existsSync(join(town, "quest-registry.json"))) refuse(`the tree is not provisioned: the town clone at ${town} has no quest-registry.json`);
  const world = paths.worldClone();
  if (!world) refuse(`the tree is not provisioned: ${paths.NO_WORLD}`);
  if (!existsSync(join(world, "WORLD", "world-state.json"))) refuse(`the tree is not provisioned: the world clone at ${world} has no WORLD/world-state.json`);
}

/** `scripts.test` as argv, with the junit reporter added before the patterns. */
export function suiteArgv(script, junitFile) {
  const tokens = [...script.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map((m) => m[1] ?? m[2] ?? m[3]);
  if (tokens[0] !== "node" || !tokens.includes("--test")) refuse(`scripts.test is not a \`node --test\` command: ${script}`);
  const args = tokens.slice(1);
  const at = args.findIndex((t) => !t.startsWith("-"));
  const reporters = [
    "--test-reporter=junit", `--test-reporter-destination=${junitFile}`,
    "--test-reporter=spec", "--test-reporter-destination=stderr",
  ];
  args.splice(at < 0 ? args.length : at, 0, ...reporters);
  return args;
}

async function take(opts) {
  const root = git(["rev-parse", "--show-toplevel"], process.cwd());
  if (!root) refuse("not inside a git checkout");
  const head = git(["rev-parse", "HEAD"], root);
  const tip = fullSha(opts.tip ?? "HEAD", root);
  if (head !== tip) refuse(`HEAD is ${head}, not the tip ${tip} — a receipt describes the commit it ran on`);
  const dirty = git(["status", "--porcelain"], root);
  if (dirty === null) refuse("git status failed");
  if (dirty) {
    const lines = dirty.split("\n");
    refuse(`the tree is dirty (${lines.length} path${lines.length === 1 ? "" : "s"}, first: ${lines[0].trim()}) — a receipt taken here describes a commit nobody has`);
  }
  await assertProvisioned(root);

  if (opts.post && !opts.again) {
    const existing = pickReceipt(readComments(opts.repo, tip), tip);
    if (existing) {
      process.stderr.write(`a receipt exists for ${tip}: ${existing.url} — read it; the suite was not run (--again to re-take)\n`);
      process.stdout.write(`${JSON.stringify(existing.receipt, null, 2)}\n`);
      return 0;
    }
  }

  const script = JSON.parse(readFileSync(join(root, "package.json"), "utf8"))?.scripts?.test;
  if (!script) refuse("package.json has no scripts.test");
  const scratch = mkdtempSync(join(tmpdir(), "suite-baseline-"));
  try {
    const junitFile = join(scratch, "junit.xml");
    const started = Date.now();
    // A receipt is a TOP-LEVEL run. Taken from inside another node:test process
    // (this tool's own suite does), the inherited NODE_TEST_CONTEXT makes the
    // child skip every file as a "recursive" run and report nothing.
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    const run = spawnSync(process.execPath, suiteArgv(script, junitFile), { cwd: root, env, stdio: ["ignore", "inherit", "inherit"] });
    const wall_s = Math.round((Date.now() - started) / 1000);
    if (run.status === null || !existsSync(junitFile)) refuse(`the suite did not finish (${run.signal ?? run.error ?? "no reporter output"}) — no receipt`);
    const { totals, reds } = parseJunit(readFileSync(junitFile, "utf8"), root);
    const receipt = {
      tip, taken_at: new Date().toISOString(), wall_s, node: process.version,
      tests: totals.tests, pass: totals.pass, fail: totals.fail,
      cancelled: totals.cancelled ?? 0, skipped: totals.skipped ?? 0, todo: totals.todo ?? 0,
      reds,
    };
    if (opts.out) writeFileSync(opts.out, `${JSON.stringify(receipt, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
    if (!opts.post) return 0;
    const bodyFile = join(scratch, "body.json");
    writeFileSync(bodyFile, JSON.stringify({ body: receiptBody(receipt) }));
    const r = gh(["api", "-X", "POST", `repos/${opts.repo}/commits/${tip}/comments`, "--input", bodyFile]);
    if (!r.ok) {
      process.stderr.write(`the receipt was taken but NOT posted: ${r.stderr.trim().split("\n")[0]}\n`);
      return 1;
    }
    process.stderr.write(`receipt posted: ${JSON.parse(r.stdout).html_url}\n`);
    return 0;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

// ── read, compare ───────────────────────────────────────────────────────────

function read(opts) {
  const sha = fullSha(opts.read, process.cwd());
  const found = pickReceipt(readComments(opts.repo, sha), sha);
  if (!found) {
    process.stderr.write(`no receipt for ${sha} — a receipt for any other sha is not one for this tip\n`);
    return 1;
  }
  process.stderr.write(`receipt: ${found.url}\n`);
  process.stdout.write(`${JSON.stringify(found.receipt, null, 2)}\n`);
  return 0;
}

function loadMine(file) {
  const text = readFileSync(file, "utf8");
  if (text.trimStart().startsWith("<")) return parseJunit(text, git(["rev-parse", "--show-toplevel"], process.cwd()) ?? process.cwd()).reds;
  const reds = JSON.parse(text).reds;
  if (!Array.isArray(reds)) refuse(`${file} is neither a junit file nor a receipt with a reds list`);
  return reds;
}

function compare(opts) {
  if (!opts.base) refuse("--compare needs --base <the merge-base your branch left from>");
  const base = fullSha(opts.base, process.cwd());
  let receipt;
  if (opts.receipt) {
    receipt = JSON.parse(readFileSync(opts.receipt, "utf8"));
  } else {
    const found = pickReceipt(readComments(opts.repo, base), base);
    if (!found) refuse(`no receipt for ${base} — take one there, or run the suite yourself`);
    receipt = found.receipt;
  }
  if (receipt.tip !== base) refuse(`the receipt is for ${receipt.tip}, and your merge-base is ${base} — a receipt for another tip is a miss, not a match`);
  const d = compareReds(loadMine(opts.compare), receipt.reds ?? []);
  if (!d.new.length && !d.gone.length) { process.stdout.write("same\n"); return 0; }
  if (d.new.length) process.stdout.write(`new: ${JSON.stringify(d.new)}\n`);
  if (d.gone.length) process.stdout.write(`gone: ${JSON.stringify(d.gone)}\n`);
  return 1;
}

// ── cli ─────────────────────────────────────────────────────────────────────

export function parseArgs(argv) {
  const opts = { repo: DEFAULT_REPO, post: true, again: false };
  const valued = { "--tip": "tip", "--out": "out", "--read": "read", "--compare": "compare", "--base": "base", "--receipt": "receipt", "--repo": "repo" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--no-post") opts.post = false;
    else if (a === "--again") opts.again = true;
    else if (valued[a]) {
      if (argv[i + 1] === undefined) refuse(`${a} needs a value`);
      opts[valued[a]] = argv[++i];
    } else refuse(`unknown argument ${a}`);
  }
  return opts;
}

export async function main(argv) {
  try {
    const opts = parseArgs(argv);
    if (opts.read) return read(opts);
    if (opts.compare) return compare(opts);
    return await take(opts);
  } catch (e) {
    if (e instanceof Refusal) { process.stderr.write(`suite-baseline: refused — ${e.message}\n`); return 2; }
    throw e;
  }
}

// ENTRY GUARD, the roster's realpath shape (test/cli-guard.test.mjs): compare
// real paths, so an entry through a junction or symlink still runs the tool —
// the href form is false under cli-guard's junction and the tool exits 0 with
// nothing said (fix-forward 2026-09-23, after #170).
const isMain = (() => {
  if (!process.argv[1]) return false;
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return pathToFileURL(process.argv[1]).href === import.meta.url; }
})();
if (isMain) {
  process.exitCode = await main(process.argv.slice(2));
}
