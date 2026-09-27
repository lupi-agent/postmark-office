// suite-baseline.test.mjs — POS-193: the tip's suite result is taken once and read by name.
//
// Every arm here can fail, and the brief's flip proves the tip arm does: with
// `--compare` patched to treat sha A as matching sha B, "a receipt for another
// tip is a miss" reds. `gh` is a STUB on PATH in every arm — never the real
// repo; the one real receipt is the lane's own, taken by hand on the tip.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { compareReds, parseJunit, pickReceipt, receiptBody, suiteArgv } from "../tools/suite-baseline.mjs";

const OFFICE = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TOOL = join(OFFICE, "tools", "suite-baseline.mjs");
const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);

// Real node junit output (v25), trimmed of stack text: a describe with one red
// and one green, a top-level red, a skip, a todo, and a green in a second file.
// ROOT is its own git checkout: a lane's junit is named from the checkout it
// sits in, and the temp dir may itself sit inside some other repo.
const ROOT = mkdtempSync(join(tmpdir(), "pos193-junit-root-"));
spawnSync("git", ["init", "-q"], { cwd: ROOT });
const F = (name) => join(ROOT, "test", name).replace(/&/g, "&amp;");
const JUNIT_TWO_REDS = `<?xml version="1.0" encoding="utf-8"?>
<testsuites>
	<testsuite name="outer" time="0.002" disabled="0" errors="0" tests="2" failures="1" skipped="0" hostname="h">
		<testcase name="inner ok" time="0.0004" classname="test" file="${F("a.test.mjs")}"/>
		<testcase name="inner &lt;bad&gt; &amp; wrong" time="0.001" classname="test" file="${F("a.test.mjs")}" failure="expected a > b">
			<failure type="testCodeFailure" message="expected a > b">
Error [ERR_TEST_FAILURE]: expected a > b
    at TestContext.&lt;anonymous> (file:///x/a.test.mjs:3:86)
			</failure>
		</testcase>
	</testsuite>
	<testcase name="top bad" time="0.00008" classname="test" file="${F("a.test.mjs")}" failure="x">
		<failure type="testCodeFailure" message="x">
[Error [ERR_TEST_FAILURE]: x] { code: 'ERR_TEST_FAILURE' }
		</failure>
	</testcase>
	<testcase name="skipped one" time="0.00007" classname="test" file="${F("a.test.mjs")}">
		<skipped type="skipped" message="why"/>
	</testcase>
	<testcase name="todo one" time="0.00008" classname="test" file="${F("a.test.mjs")}">
		<skipped type="todo" message="true"/>
	</testcase>
	<testcase name="b ok" time="0.0006" classname="test" file="${F("b.test.mjs")}"/>
	<!-- tests 6 -->
	<!-- suites 1 -->
	<!-- pass 2 -->
	<!-- fail 2 -->
	<!-- cancelled 0 -->
	<!-- skipped 1 -->
	<!-- todo 1 -->
	<!-- duration_ms 93.9686 -->
</testsuites>`;

// ── the parse ───────────────────────────────────────────────────────────────

test("the junit parse over two failures yields exactly those two names, and the runner's counts", () => {
  const { totals, reds } = parseJunit(JUNIT_TWO_REDS, ROOT);
  assert.deepEqual(reds, ["test/a.test.mjs > outer > inner <bad> & wrong", "test/a.test.mjs > top bad"]);
  assert.equal(totals.tests, 6);
  assert.equal(totals.pass, 2);
  assert.equal(totals.fail, 2);
  assert.equal(totals.skipped, 1);
  assert.equal(totals.todo, 1);
});

test("a file that fails to load is named by the file alone", () => {
  const xml = `<testsuites>
	<testcase name="test\\c.test.mjs" time="0.05" classname="test" file="${F("c.test.mjs")}" failure="test failed">
		<failure type="testCodeFailure" message="test failed">[Error: test failed]</failure>
	</testcase>
	<!-- tests 1 -->
</testsuites>`;
  assert.deepEqual(parseJunit(xml, ROOT).reds, ["test/c.test.mjs"]);
});

test("a truncated reporter file (no summary counts) is refused, not read as zero reds", () => {
  assert.throws(() => parseJunit(JUNIT_TWO_REDS.split("<!-- tests")[0], ROOT), /no summary counts/);
});

test("the take runs scripts.test's own command, with the junit reporter before the patterns", () => {
  const argv = suiteArgv('node --test --test-concurrency=8 --test-timeout=180000 "test/*.test.mjs"', "J.xml");
  assert.deepEqual(argv, [
    "--test", "--test-concurrency=8", "--test-timeout=180000",
    "--test-reporter=junit", "--test-reporter-destination=J.xml",
    "--test-reporter=spec", "--test-reporter-destination=stderr",
    "test/*.test.mjs",
  ]);
  assert.throws(() => suiteArgv("vitest run", "J.xml"), /not a `node --test` command/);
});

test("compareReds diffs by name", () => {
  assert.deepEqual(compareReds(["x", "y"], ["y", "x"]), { new: [], gone: [] });
  assert.deepEqual(compareReds(["x", "y", "z"], ["x", "y"]), { new: ["z"], gone: [] });
  assert.deepEqual(compareReds(["x"], ["x", "y"]), { new: [], gone: ["y"] });
});

test("pickReceipt keeps the newest receipt whose own tip is the sha, and nothing else", () => {
  const r = (tip, extra = {}) => ({ tip, reds: [], ...extra });
  const comments = [
    { body: receiptBody(r(SHA_A, { n: 1 })), html_url: "u1", created_at: "2026-09-22T01:00:00Z" },
    { body: receiptBody(r(SHA_A, { n: 2 })), html_url: "u2", created_at: "2026-09-22T02:00:00Z" },
    { body: receiptBody(r(SHA_B, { n: 3 })), html_url: "u3", created_at: "2026-09-22T03:00:00Z" },
    { body: "looks good to me", html_url: "u4", created_at: "2026-09-22T04:00:00Z" },
  ];
  const got = pickReceipt(comments, SHA_A);
  assert.equal(got.url, "u2");
  assert.equal(got.receipt.n, 2);
  assert.equal(pickReceipt(comments.slice(2), SHA_A), null, "a receipt naming another tip is never a stand-in");
});

// ── the cli, against fixtures and a gh stub ─────────────────────────────────

const made = [ROOT];
const scratch = () => { const d = mkdtempSync(join(tmpdir(), "pos193-suite-baseline-")); made.push(d); return d; };

const envWith = (extra) => {
  const env = { ...process.env };
  delete env.WORLD_CLONE;
  delete env.TOWN_CLONE;
  for (const [k, v] of Object.entries(extra)) {
    if (/^path$/i.test(k)) {
      for (const key of Object.keys(env)) if (/^path$/i.test(key)) delete env[key];
    }
    env[k] = v;
  }
  return env;
};

const run = (args, { cwd, env = {} } = {}) => {
  const r = spawnSync(process.execPath, [TOOL, ...args], { cwd, env: envWith(env), encoding: "utf8" });
  return { code: r.status, out: r.stdout, err: r.stderr };
};

/** A `gh` on PATH that logs its calls and answers from files. */
function ghStub(dir, comments = [[]]) {
  const bin = join(dir, "bin");
  mkdirSync(bin, { recursive: true });
  const log = join(dir, "gh-calls.jsonl");
  const commentsFile = join(dir, "gh-comments.json");
  writeFileSync(commentsFile, JSON.stringify(comments));
  writeFileSync(join(bin, "gh-stub.mjs"), `
import { appendFileSync, readFileSync } from "node:fs";
const args = process.argv.slice(2);
const entry = { args };
const i = args.indexOf("--input");
if (i >= 0) entry.input = JSON.parse(readFileSync(args[i + 1], "utf8"));
appendFileSync(${JSON.stringify(log)}, JSON.stringify(entry) + "\\n");
if (args.includes("POST")) process.stdout.write(JSON.stringify({ html_url: "https://stub/commit-comment/1" }));
else process.stdout.write(readFileSync(${JSON.stringify(commentsFile)}, "utf8"));
`);
  writeFileSync(join(bin, "gh.cmd"), `@node "%~dp0gh-stub.mjs" %*\r\n`);
  writeFileSync(join(bin, "gh"), `#!/bin/sh\nexec node "$(dirname "$0")/gh-stub.mjs" "$@"\n`);
  chmodSync(join(bin, "gh"), 0o755);
  const calls = () => (existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
  return { PATH: bin + delimiter + (process.env.PATH ?? process.env.Path ?? ""), calls };
}

const g = (cwd, ...args) => {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(r.status, 0, `git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
};

/**
 * A committed office-shaped tree: the suites' own fixture resolver, a tiny
 * suite with one red, and (unless `omit` names it) each provisioning piece.
 * It sits in its own parent so the world's `../postmark-world` rung is empty.
 */
function fixtureTree({ omit = [] } = {}) {
  const tree = join(scratch(), "office");
  mkdirSync(join(tree, "test"), { recursive: true });
  copyFileSync(join(OFFICE, "test", "fixture-paths.mjs"), join(tree, "test", "fixture-paths.mjs"));
  writeFileSync(join(tree, "test", "tiny.test.mjs"),
    `import { test } from "node:test";\ntest("good", () => {});\ntest("bad", () => { throw new Error("red on purpose"); });\n`);
  writeFileSync(join(tree, "package.json"), JSON.stringify({ scripts: { test: 'node --test "test/*.test.mjs"' } }));
  writeFileSync(join(tree, ".gitignore"), "node_modules/\ntown-clone/\nworld-clone/\n");
  if (!omit.includes("node_modules")) { mkdirSync(join(tree, "node_modules")); writeFileSync(join(tree, "node_modules", ".package-lock.json"), "{}"); }
  if (!omit.includes("town")) { mkdirSync(join(tree, "town-clone")); writeFileSync(join(tree, "town-clone", "quest-registry.json"), "{}"); }
  if (!omit.includes("world")) { mkdirSync(join(tree, "world-clone", "WORLD"), { recursive: true }); writeFileSync(join(tree, "world-clone", "WORLD", "world-state.json"), "{}"); }
  g(tree, "init", "-q");
  g(tree, "add", "-A");
  g(tree, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "fixture");
  return { tree, head: g(tree, "rev-parse", "HEAD") };
}

const receiptFile = (dir, tip, reds) => {
  const f = join(dir, `receipt-${tip.slice(0, 6)}.json`);
  writeFileSync(f, JSON.stringify({ tip, reds }));
  return f;
};

test("--compare: the same red set exits 0 and prints same", () => {
  const dir = scratch();
  const base = receiptFile(dir, SHA_A, ["t > a", "t > b"]);
  const mine = join(dir, "mine.json");
  writeFileSync(mine, JSON.stringify({ tip: "c".repeat(40), reds: ["t > b", "t > a"] }));
  const r = run(["--compare", mine, "--base", SHA_A, "--receipt", base], { cwd: dir });
  assert.equal(r.code, 0, r.err);
  assert.equal(r.out.trim(), "same");
});

test("--compare: one extra red exits 1 and names it", () => {
  const dir = scratch();
  const base = receiptFile(dir, SHA_A, ["t > a"]);
  const mine = join(dir, "mine.json");
  writeFileSync(mine, JSON.stringify({ reds: ["t > a", "t > new one"] }));
  const r = run(["--compare", mine, "--base", SHA_A, "--receipt", base], { cwd: dir });
  assert.equal(r.code, 1, r.err);
  assert.equal(r.out.trim(), 'new: ["t > new one"]');
});

test("--compare: one missing red exits 1 and names it", () => {
  const dir = scratch();
  const base = receiptFile(dir, SHA_A, ["t > a", "t > fixed now"]);
  const mine = join(dir, "mine.json");
  writeFileSync(mine, JSON.stringify({ reds: ["t > a"] }));
  const r = run(["--compare", mine, "--base", SHA_A, "--receipt", base], { cwd: dir });
  assert.equal(r.code, 1, r.err);
  assert.equal(r.out.trim(), 'gone: ["t > fixed now"]');
});

test("--compare reads a lane's junit file as well as a receipt", () => {
  const dir = scratch();
  const base = receiptFile(dir, SHA_A, ["test/a.test.mjs > outer > inner <bad> & wrong", "test/a.test.mjs > top bad"]);
  // The junit names paths from the checkout the compare runs in; this fixture
  // was written for ROOT, so the compare runs where ROOT's names resolve.
  const mine = join(dir, "mine.xml");
  writeFileSync(mine, JUNIT_TWO_REDS);
  const r = run(["--compare", mine, "--base", SHA_A, "--receipt", base], { cwd: ROOT });
  assert.equal(r.code, 0, r.err + r.out);
  assert.equal(r.out.trim(), "same");
});

test("--compare: a receipt for sha A read against merge-base B is refused, both shas named", () => {
  const dir = scratch();
  const base = receiptFile(dir, SHA_A, ["t > a"]);
  const mine = join(dir, "mine.json");
  writeFileSync(mine, JSON.stringify({ reds: ["t > a"] }));
  const r = run(["--compare", mine, "--base", SHA_B, "--receipt", base], { cwd: dir });
  assert.equal(r.code, 2, `a receipt for another tip must be a miss, not a match — got exit ${r.code}: ${r.out}`);
  assert.match(r.err, new RegExp(SHA_A));
  assert.match(r.err, new RegExp(SHA_B));
});

test("--compare with no --base is refused", () => {
  const dir = scratch();
  const mine = receiptFile(dir, SHA_A, []);
  const r = run(["--compare", mine], { cwd: dir });
  assert.equal(r.code, 2);
  assert.match(r.err, /--base/);
});

test("take refuses a dirty tree", () => {
  const { tree } = fixtureTree();
  writeFileSync(join(tree, "test", "tiny.test.mjs"), "// modified\n");
  const stub = ghStub(dirname(tree));
  const r = run(["--no-post"], { cwd: tree, env: { PATH: stub.PATH } });
  assert.equal(r.code, 2, r.out);
  assert.match(r.err, /dirty/);
  assert.match(r.err, /tiny\.test\.mjs/);
});

test("take refuses when HEAD is not the tip named", () => {
  const { tree } = fixtureTree();
  const first = g(tree, "rev-parse", "HEAD");
  g(tree, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "moved");
  const r = run(["--tip", first, "--no-post"], { cwd: tree });
  assert.equal(r.code, 2, r.out);
  assert.match(r.err, new RegExp(`not the tip ${first}`));
});

for (const [missing, says] of [["node_modules", /no node_modules/], ["town", /no town clone/], ["world", /no world clone/]]) {
  test(`take refuses an unprovisioned tree: no ${missing}`, () => {
    const { tree } = fixtureTree({ omit: [missing] });
    const r = run(["--no-post"], { cwd: tree });
    assert.equal(r.code, 2, r.out);
    assert.match(r.err, says);
  });
}

test("take refuses a clone env var that points nowhere, naming the variable", () => {
  const { tree } = fixtureTree();
  const r = run(["--no-post"], { cwd: tree, env: { WORLD_CLONE: join(tree, "no-such-world") } });
  assert.equal(r.code, 2, r.out);
  assert.match(r.err, /WORLD_CLONE is set to/);
});

test("take runs the suite once, writes the receipt, and posts it on the tip", () => {
  const { tree, head } = fixtureTree();
  const stub = ghStub(dirname(tree));
  const out = join(dirname(tree), "receipt.json");
  const r = run(["--out", out], { cwd: tree, env: { PATH: stub.PATH } });
  assert.equal(r.code, 0, r.err);
  const receipt = JSON.parse(readFileSync(out, "utf8"));
  assert.equal(receipt.tip, head);
  assert.deepEqual(receipt.reds, ["test/tiny.test.mjs > bad"]);
  assert.equal(receipt.tests, 2);
  assert.equal(receipt.pass, 1);
  assert.equal(receipt.fail, 1);
  assert.equal(typeof receipt.wall_s, "number");
  const calls = stub.calls();
  assert.equal(calls.length, 2, "one read for an existing receipt, one post");
  assert.ok(calls[0].args.includes(`repos/postmark-town/postmark-office/commits/${head}/comments?per_page=100`));
  const post = calls[1];
  assert.ok(post.args.includes(`repos/postmark-town/postmark-office/commits/${head}/comments`));
  assert.ok(post.input.body.startsWith("suite-baseline\n\n```json\n"));
  assert.deepEqual(pickReceipt([{ body: post.input.body, created_at: "t" }], head).receipt, receipt);
  assert.match(r.err, /receipt posted: https:\/\/stub\/commit-comment\/1/);
});

test("take does not re-run the suite when the tip already has a receipt", () => {
  const { tree, head } = fixtureTree();
  const stored = { tip: head, reds: ["stored"], wall_s: 963 };
  const stub = ghStub(dirname(tree), [[{ body: receiptBody(stored), html_url: "https://stub/c/9", created_at: "t" }]]);
  const r = run([], { cwd: tree, env: { PATH: stub.PATH } });
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(JSON.parse(r.out), stored);
  assert.match(r.err, /a receipt exists/);
  assert.equal(stub.calls().filter((c) => c.args.includes("POST")).length, 0);
});

test("--read prints the tip's newest receipt and asks for that sha alone", () => {
  const dir = scratch();
  const stub = ghStub(dir, [[
    { body: receiptBody({ tip: SHA_A, reds: ["old"] }), html_url: "u-old", created_at: "2026-09-22T01:00:00Z" },
    { body: receiptBody({ tip: SHA_A, reds: ["new"] }), html_url: "u-new", created_at: "2026-09-22T02:00:00Z" },
  ]]);
  const r = run(["--read", SHA_A], { cwd: dir, env: { PATH: stub.PATH } });
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(JSON.parse(r.out).reds, ["new"]);
  assert.match(r.err, /u-new/);
  const calls = stub.calls();
  assert.equal(calls.length, 1);
  assert.ok(calls[0].args.includes(`repos/postmark-town/postmark-office/commits/${SHA_A}/comments?per_page=100`));
});

test("--read of a sha with no receipt of its own is a miss (exit 1), never a neighbour's", () => {
  const dir = scratch();
  const stub = ghStub(dir, [[{ body: receiptBody({ tip: SHA_B, reds: [] }), html_url: "u-b", created_at: "t" }]]);
  const r = run(["--read", SHA_A], { cwd: dir, env: { PATH: stub.PATH } });
  assert.equal(r.code, 1, r.out);
  assert.equal(r.out, "");
  assert.match(r.err, /no receipt for a{40}/);
});

test.after(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true });
});
