// pen-transaction.test.mjs — WHOLE OR NOTHING (POS-296).
//
//   node --test test/pen-transaction.test.mjs
//
// The law under test, as the brief put it: "a write that answers 'failed' must
// leave nothing behind in the town clone". Every falsifier below takes a
// snapshot of the WHOLE working tree (every file, tracked or not, by content)
// plus HEAD before a write, forces the write to fail after it has touched the
// clone, and asserts the snapshot is unchanged.
//
// Two ways to fail after the write, both real:
//   · the push cannot land — the clone's push URL points nowhere, so the pen's
//     three attempts all lose; fetch still works, exactly as when a race is
//     lost three times;
//   · the engine refuses after appending — a stub town tool writes its line
//     and then exits with the town's own FATAL, the shape of the 2026-09-28
//     dirty clone (the verify refused a ledger the catch-up had already grown).

import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import {
  appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";

import { penCommit, penTransaction, enqueueLetter, NOT_LANDED } from "../src/write.mjs";
import { withRecordFrom } from "./registry-pool-stub.mjs";
import {
  updateAddressBody, updateAddressFields, updateHome, updateProfile, updateWindow,
  updateProfileAvatar, updateHomeImage,
} from "../src/edit.mjs";
import { indexStore } from "./helpers/office-under-test.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sh = (cwd, ...args) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();
const BOT = ["-c", "user.name=fixture", "-c", "user.email=fixture@test.invalid"];

// ── the fixture: a bare origin and one clone of it, on main ─────────────────
const homes = [];
function town(files = {}) {
  const dir = mkdtempSync(join(tmpdir(), "pen-tx-"));
  homes.push(dir);
  const origin = join(dir, "origin.git");
  const clone = join(dir, "clone");
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", origin]);
  execFileSync("git", ["clone", "-q", origin, clone], { stdio: "ignore" });
  // The box's git: no line-ending conversion. Under a system autocrlf a restore
  // checks a file out as CRLF, and "exactly as it was" would then be judging
  // this machine's config rather than the pen.
  sh(clone, "config", "core.autocrlf", "false");
  sh(clone, "checkout", "-q", "-B", "main");
  const seed = {
    "WHITE_PAGES/stamp-ledger.md": "# the stamp ledger\n\n- 2026-09-01 · seed row\n",
    "WHITE_PAGES/wright/ADDRESS.md": "---\nhandle: wright\ngithub: wright-starforge\nsince: 2026-01-01\nagent: Wright\n---\n\n# wright\n",
    "WHITE_PAGES/wright/PROFILE.md": "---\nbio: a keeper of the pen\n---\n",
    "WHITE_PAGES/wright/HOME/HOME.md": "---\ntitle: the fig house\n---\n\nA house with a fig tree.\n",
    "WHITE_PAGES/limen/ADDRESS.md": "---\nhandle: limen\ngithub: limen\nsince: 2026-01-01\n---\n\n# limen\n",
    // The household registry (POS-219): the home image door keeps its picture
    // on the household's record, and the drain renders these two files.
    "tools/households.json": `${JSON.stringify({ schema_version: 1, households: { keemin: { residents: ["wright"] } } }, null, 2)}\n`,
    "tools/github-ids.json": "{}\n",
    ...files,
  };
  for (const [rel, text] of Object.entries(seed)) {
    mkdirSync(dirname(join(clone, rel)), { recursive: true });
    writeFileSync(join(clone, rel), text);
  }
  sh(clone, "add", "-A");
  sh(clone, ...BOT, "commit", "-qm", "fixture town");
  sh(clone, "push", "-q", "-u", "origin", "main");
  return { dir, origin, clone };
}
const breakPush = (t) => sh(t.clone, "remote", "set-url", "--push", "origin", join(t.dir, "nowhere.git"));
const mendPush = (t) => sh(t.clone, "remote", "set-url", "--push", "origin", t.origin);

/** Everything a reader of the clone could see: HEAD, and every file's bytes. */
function snapshot(clone) {
  const files = {};
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      if (d === clone && name === ".git") continue;
      const abs = join(d, name);
      if (statSync(abs).isDirectory()) { files[relative(clone, abs).replace(/\\/g, "/") + "/"] = "dir"; walk(abs); }
      else files[relative(clone, abs).replace(/\\/g, "/")] = createHash("sha256").update(readFileSync(abs)).digest("hex");
    }
  };
  walk(clone);
  return { head: sh(clone, "rev-parse", "HEAD"), status: sh(clone, "status", "--porcelain", "--untracked-files=all"), files };
}

const withPush = async (fn) => {
  const was = process.env.TOWN_PUSH;
  process.env.TOWN_PUSH = "1";
  try { return await fn(); } finally { if (was === undefined) delete process.env.TOWN_PUSH; else process.env.TOWN_PUSH = was; }
};
const withoutPush = async (fn) => {
  const was = process.env.TOWN_PUSH;
  delete process.env.TOWN_PUSH;
  try { return await fn(); } finally { if (was !== undefined) process.env.TOWN_PUSH = was; }
};
const caught = async (fn) => { try { await fn(); } catch (e) { return e; } assert.fail("the write was expected to fail"); };

test.after(() => { for (const d of homes) rmSync(d, { recursive: true, force: true, maxRetries: 5 }); });

// ═══════════════════════════════════════════════════════════════════════════
// penCommit — whole or nothing over its own paths
// ═══════════════════════════════════════════════════════════════════════════
// The doors below run in this process and read their town index from a store
// seeded from this fixture (POS-268, office-under-test.mjs).
const IX = await indexStore((await import("./fixture.mjs")).fixtureDb()); // the fixture town holds wright and limen, as mailDb() does
const IX_RESTORE = await IX.useInProcess();
test.after(async () => { await IX_RESTORE(); await IX.stop(); });

test("P1 · A PUSH THAT CANNOT LAND leaves HEAD at the recorded sha and the tree exactly as it was", async () => {
  const t = town();
  const before = snapshot(t.clone);
  breakPush(t);
  await withPush(async () => {
    appendFileSync(join(t.clone, "WHITE_PAGES", "stamp-ledger.md"), "- 2026-09-28 · a row the town never took\n");
    writeFileSync(join(t.clone, "WHITE_PAGES", "wright", "new-file.md"), "created by the write\n");
    const e = await caught(() => penCommit(t.clone, [
      join(t.clone, "WHITE_PAGES", "stamp-ledger.md"),
      join(t.clone, "WHITE_PAGES", "wright", "new-file.md"),
    ], "a row"));
    assert.equal(e.pen, NOT_LANDED, "the not-landed marker the drain holds on");
    assert.equal(e.code, 503);
    assert.match(e.hint, /nothing was recorded and nothing is left behind/);
  });
  assert.deepEqual(snapshot(t.clone), before, "tracked and untracked, the clone is as it was");
  assert.equal(sh(t.clone, "rev-list", "--count", "origin/main..HEAD"), "0", "no local-only commit for the next write to carry");
});

test("P2 · A PUSH THAT LANDS is untouched by the restore (the sha on origin is the one returned)", async () => {
  const t = town();
  await withPush(async () => {
    appendFileSync(join(t.clone, "WHITE_PAGES", "stamp-ledger.md"), "- 2026-09-28 · a row that lands\n");
    const c = penCommit(t.clone, [join(t.clone, "WHITE_PAGES", "stamp-ledger.md")], "a row");
    assert.equal(sh(t.clone, "ls-remote", "origin", "refs/heads/main").split("\t")[0], c);
  });
  assert.equal(sh(t.clone, "status", "--porcelain"), "");
});

// ═══════════════════════════════════════════════════════════════════════════
// penTransaction — whatever fn wrote, put back
// ═══════════════════════════════════════════════════════════════════════════
test("P3 · A THROW AFTER THE WRITE puts back tracked and created paths, and leaves dirt it did not make", async () => {
  const t = town();
  // dirt that was there before the act: an untracked stray and a modified card
  writeFileSync(join(t.clone, "stray.txt"), "not the act's\n");
  appendFileSync(join(t.clone, "WHITE_PAGES", "limen", "ADDRESS.md"), "a hand's edit in progress\n");
  const before = snapshot(t.clone);
  await withoutPush(async () => {
    const e = await caught(() => penTransaction(t.clone, () => {
      appendFileSync(join(t.clone, "WHITE_PAGES", "stamp-ledger.md"), "- appended, then refused\n");
      mkdirSync(join(t.clone, "WHITE_PAGES", "newcomer"), { recursive: true });
      writeFileSync(join(t.clone, "WHITE_PAGES", "newcomer", "ADDRESS.md"), "a berth card\n");
      throw new Error("the verify refused");
    }));
    assert.match(e.message, /the verify refused/, "the throw is rethrown, unchanged");
  });
  assert.deepEqual(snapshot(t.clone), before);
});

test("P4 · AN { error } ANSWER is a failure too: the append is taken back and the answer returned as it was", async () => {
  const t = town();
  const before = snapshot(t.clone);
  const out = await withoutPush(() => penTransaction(t.clone, () => {
    appendFileSync(join(t.clone, "WHITE_PAGES", "stamp-ledger.md"), "- appended, then refused\n");
    return { error: { code: 409, defect: "the ledger is catching up" } };
  }));
  assert.deepEqual(out, { error: { code: 409, defect: "the ledger is catching up" } });
  assert.deepEqual(snapshot(t.clone), before);
});

test("P5 · A LOCAL COMMIT then a throw (no push): HEAD returns to the recorded sha", async () => {
  const t = town();
  const before = snapshot(t.clone);
  await withoutPush(async () => {
    await caught(() => penTransaction(t.clone, async () => {
      appendFileSync(join(t.clone, "WHITE_PAGES", "stamp-ledger.md"), "- committed, then the read-back tripped\n");
      penCommit(t.clone, [join(t.clone, "WHITE_PAGES", "stamp-ledger.md")], "a row");
      throw new Error("the read-back tripped");
    }));
  });
  assert.deepEqual(snapshot(t.clone), before);
});

test("P6 · A PULL THAT MOVED HEAD is not undone: only the act's own writes go", async () => {
  const t = town();
  // the town moves on while this clone is behind
  const other = join(t.dir, "other");
  execFileSync("git", ["clone", "-q", t.origin, other], { stdio: "ignore" });
  appendFileSync(join(other, "WHITE_PAGES", "stamp-ledger.md"), "- somebody else's row\n");
  sh(other, "add", "-A"); sh(other, ...BOT, "commit", "-qm", "traffic"); sh(other, "push", "-q", "origin", "main");
  await withPush(async () => {
    await caught(() => penTransaction(t.clone, () => {
      sh(t.clone, "pull", "--rebase", "-q");
      appendFileSync(join(t.clone, "WHITE_PAGES", "stamp-ledger.md"), "- mine, refused\n");
      throw new Error("refused");
    }));
  });
  assert.equal(sh(t.clone, "rev-parse", "HEAD"), sh(other, "rev-parse", "HEAD"), "the pulled town stays");
  assert.equal(sh(t.clone, "status", "--porcelain", "--untracked-files=all"), "");
});

// ═══════════════════════════════════════════════════════════════════════════
// The letter pen
// ═══════════════════════════════════════════════════════════════════════════
function mailDb() {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE residents (handle TEXT PRIMARY KEY); CREATE TABLE letters (id TEXT PRIMARY KEY);");
  db.prepare("INSERT INTO residents VALUES (?), (?)").run("wright", "limen");
  return db;
}
const key = { household: "keemin", handles: new Set(["wright"]), ghId: "42", ghLogin: "keeminlee" };

test("P7 · A LETTER WHOSE PUSH CANNOT LAND leaves no file, and the re-send is not bounced 409 by it", async () => {
  const t = town();
  const db = mailDb();
  const before = snapshot(t.clone);
  breakPush(t);
  const letter = { from: "wright", to: "limen", title: "a fine hat", body: "limen —\n\nA hat." };
  await withPush(async () => {
    const e = await caught(() => enqueueLetter(letter, key, db, t.clone));
    assert.equal(e.pen, NOT_LANDED);
  });
  assert.deepEqual(snapshot(t.clone), before, "no letter file, no empty outbox, no commit");
  mendPush(t);
  const r = await withPush(() => enqueueLetter(letter, key, db, t.clone));
  assert.equal(sh(t.clone, "ls-remote", "origin", "refs/heads/main").split("\t")[0], r.commit, "the re-send lands");
});

// ═══════════════════════════════════════════════════════════════════════════
// The office's own doors (edit.mjs): each one, forced to fail after its write
// ═══════════════════════════════════════════════════════════════════════════
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEElEQVR42mMQKHAAIgYIBQAUTgMBVe7jVwAAAABJRU5ErkJggg==", "base64").toString("base64");
const DOORS = [
  ["address body", () => updateAddressBody],
  ["address fields", () => updateAddressFields],
  ["home", () => updateHome],
  ["profile", () => updateProfile],
  ["profile with a display name (two files, one commit)", () => updateProfile],
  ["window", () => updateWindow],
  ["profile avatar", () => updateProfileAvatar],
  // POS-219: the home image door writes no page; its clone write is the
  // registry file the drain renders after the store keeps the picture. So it
  // runs with the record on (the pool stub) and a stub mint (no bucket), and
  // the push that cannot land is the drain's.
  ["home image", () => (args, k, db, clone) => withRecordFrom(clone, () =>
    updateHomeImage(args, k, db, clone, null, { upload: async () => ({ url: "https://media.postmark.town/media/keemin/0f3c.png" }) }))],
];
const DOOR_ARGS = {
  "address body": { handle: "wright", body: "A new card body." },
  "address fields": { handle: "wright", fields: { note: "gone fishing" } },
  "home": { handle: "wright", body: "The fig tree bore fruit." },
  "profile": { handle: "wright", bio: "a keeper of the pen, and of the flip" },
  "profile with a display name (two files, one commit)": { handle: "wright", bio: "renamed", display_name: "Wright of Starforge" },
  "window": { handle: "wright", html: "<!doctype html><title>w</title><p>a pane</p>\n" },
  "profile avatar": { handle: "wright", image: PNG, type: "image/png" },
  "home image": { handle: "wright", image: PNG, name: "fig.png" },
};
const noDb = new DatabaseSync(":memory:");

for (const [name, door] of DOORS) {
  test(`P8 · THE ${name.toUpperCase()} DOOR, its push unable to land, leaves the clone exactly as it was`, async () => {
    const t = town();
    const before = snapshot(t.clone);
    breakPush(t);
    await withPush(async () => {
      const e = await caught(() => door()(DOOR_ARGS[name], key, noDb, t.clone));
      assert.equal(e.pen, NOT_LANDED, `${name}: ${e.message}`);
      assert.equal(e.code, 503);
    });
    assert.deepEqual(snapshot(t.clone), before);
  });
}

test("P9 · THE PROFILE WITH A DISPLAY NAME lands both files in ONE commit, and the card's answer names it", async () => {
  const t = town();
  const r = await withPush(() => updateProfile(DOOR_ARGS["profile with a display name (two files, one commit)"], key, noDb, t.clone));
  assert.equal(sh(t.clone, "rev-list", "--count", "HEAD~1..HEAD"), "1");
  assert.equal(sh(t.clone, "rev-parse", "HEAD~1"), sh(t.clone, "rev-parse", "origin/main~1"));
  const files = sh(t.clone, "show", "--name-only", "--format=", "HEAD").split("\n").sort();
  assert.deepEqual(files, ["WHITE_PAGES/wright/ADDRESS.md", "WHITE_PAGES/wright/PROFILE.md"]);
  assert.equal(r.commit, sh(t.clone, "rev-parse", "HEAD"));
  assert.equal(r.named.commit, r.commit, "the card's sha is the one commit, so the drain's resume check sees it");
  assert.match(readFileSync(join(t.clone, "WHITE_PAGES", "wright", "ADDRESS.md"), "utf8"), /agent: Wright of Starforge/);
});

test("P9b · A DISPLAY NAME WITH AN UNCHANGED PROFILE still lands the card, on its own commit, and says unchanged", async () => {
  const t = town();
  // the door's own rendering of this bio first, so the second call's profile is byte-for-byte unchanged
  await withPush(() => updateProfile({ handle: "wright", bio: "a keeper of the pen" }, key, noDb, t.clone));
  const r = await withPush(() => updateProfile({ handle: "wright", bio: "a keeper of the pen", display_name: "Wright II" }, key, noDb, t.clone));
  assert.equal(r.unchanged, true);
  assert.equal(r.named.commit, sh(t.clone, "rev-parse", "HEAD"));
  assert.deepEqual(sh(t.clone, "show", "--name-only", "--format=", "HEAD").split("\n"), ["WHITE_PAGES/wright/ADDRESS.md"]);
});

// ═══════════════════════════════════════════════════════════════════════════
// The execs, spawned as the office spawns them, against stub town tools
// ═══════════════════════════════════════════════════════════════════════════
//
// The stubs keep the shape of the real CLIs (argv in, FATAL on stderr, exit 1)
// and of the real module exports, and do one thing each: append a line, then
// either succeed or refuse. `refuse-me` anywhere in the request is the refusal.
const STUB_MINT = `
import { appendFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
export const parseStampLedger = (text) => text.split("\\n").filter((l) => l.startsWith("- ")).map((raw) => ({ raw }));
export const foldBalances = () => new Map();
export const potStakeLine = (o) => "- " + o.date + " · keeping stake " + o.handle + " -> pot/" + o.pot + " · " + o.n;
export function appendSigned(clone, lines) { appendFileSync(join(clone, "WHITE_PAGES", "stamp-ledger.md"), lines.join("\\n") + "\\n"); }
const isMain = process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (isMain) {
  const argv = process.argv.slice(2);
  const repo = argv[argv.indexOf("--repo") + 1];
  const ledger = join(repo, "WHITE_PAGES", "stamp-ledger.md");
  if (argv.includes("--append")) appendFileSync(ledger, "- 2026-09-28 · catch-up row\\n");
  if (argv.includes("--gift")) {
    appendFileSync(ledger, "- 2026-09-28 · gift " + argv[argv.indexOf("--gift") + 1] + "\\n");
    if (argv.includes("refuse-me")) { console.error("FATAL: no WHITE_PAGES room for refuse-me"); process.exit(1); }
  }
}
`;
const STUB_CLOSE = `
import { appendFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const argv = process.argv.slice(2);
const repo = argv[argv.indexOf("--repo") + 1];
const pot = argv[argv.indexOf("--pot") + 1];
appendFileSync(join(repo, "WHITE_PAGES", "stamp-ledger.md"), "- 2026-09-28 · receipt " + pot + "\\n");
writeFileSync(join(repo, "WHITE_PAGES", "pot-" + pot + ".json"), "{}\\n");
if (pot === "refuse-me") { console.error("FATAL: past pot refuse-me's posted target"); process.exit(1); }
`;
const STUB_BALLOT = `
import { appendFileSync } from "node:fs";
import { join } from "node:path";
export function clipApply(clone, p) {
  appendFileSync(join(clone, "WHITE_PAGES", "stamp-ledger.md"), "- 2026-09-28 · stake " + p.handle + " -> " + p.topic + "\\n");
  if (p.topic === "refuse-me") throw Object.assign(new Error("refused"), { code: 409, defect: "that ballot is closed", hint: "" });
  return { requested: p.n, applied: p.n };
}
export const ballotState = () => ({ balances: new Map([["wright", 10]]), lawAt: () => ({ meeps: new Set() }) });
`;
const STUB_WORLD_STAKE = `
import { appendFileSync } from "node:fs";
import { join } from "node:path";
const apply = (clone, p) => {
  appendFileSync(join(clone, "WHITE_PAGES", "stamp-ledger.md"), "- 2026-09-28 · world stake " + p.handle + " -> " + p.mark + "\\n");
  if (p.mark === "refuse-me") throw Object.assign(new Error("refused"), { code: 422, defect: "no such mark", hint: "" });
  return { requested: p.n, applied: p.n };
};
export const worldStakeApply = apply;
export const worldUnstakeApply = apply;
`;
const POT = JSON.stringify({ pot: "roof", status: "open", epoch_cadence: "crossing", received_usd: 0,
  beneficiary: "the-town", target_usd_per_epoch: 100 });

function execTown() {
  const t = town({
    "tools/stamp-mint.mjs": STUB_MINT,
    "tools/epoch-close.mjs": STUB_CLOSE,
    "tools/ballot.mjs": STUB_BALLOT,
    "tools/world-stake.mjs": STUB_WORLD_STAKE,
    "WHITE_PAGES/pot-roof.json": POT + "\n",
  });
  const keyPath = join(t.dir, "stamp-key.pem");
  writeFileSync(keyPath, "not a real key — the stubs never read it\n");
  return { ...t, keyPath };
}
function runExec(t, exec, payload, { push = true } = {}) {
  const r = spawnSync(process.execPath, [join(ROOT, "src", exec), JSON.stringify(payload)], {
    encoding: "utf8",
    env: { ...process.env, ...IX.env, TOWN_CLONE: t.clone, STAMP_KEY: t.keyPath, TOWN_PUSH: push ? "1" : "", BOT_NAME: "fixture", BOT_EMAIL: "fixture@test.invalid" },
  });
  assert.equal(r.status, 0, `${exec} answers rather than trips: ${r.stderr}`);
  return JSON.parse(r.stdout.trim().split("\n").at(-1));
}

const EXECS = [
  ["gift-exec.mjs", { handle: "limen", amount: 3, slug: "a-hat", by: "wright", date: "2026-09-28" }, { handle: "refuse-me" }],
  ["fund-exec.mjs", { pot: "roof", usd: 5, from: "wright", ref: "tx-1", date: "2026-09-28" }, { pot: "refuse-me" }],
  ["stake-exec.mjs", { handle: "wright", topic: "the-quay", candidate: "limen", n: 2, via: "api", date: "2026-09-28" }, { topic: "refuse-me" }],
  ["world-stake-exec.mjs", { verb: "stake", handle: "wright", mark: "wright/a-mark", n: 2, date: "2026-09-28" }, { mark: "refuse-me" }],
  ["pot-stake-exec.mjs", { handle: "wright", pot: "roof", n: 2, via: "api", date: "2026-09-28" }, null],
];

for (const [exec, payload, refusing] of EXECS) {
  test(`P10 · ${exec}: A PUSH THAT CANNOT LAND is an answer (503), and the clone is exactly as it was`, () => {
    const t = execTown();
    const before = snapshot(t.clone);
    breakPush(t);
    const out = runExec(t, exec, payload);
    assert.equal(out.error?.code, 503, JSON.stringify(out));
    assert.equal(out.error.defect, "the town did not take this write");
    assert.deepEqual(snapshot(t.clone), before);
  });
  if (refusing) {
    test(`P11 · ${exec}: THE ENGINE REFUSES AFTER APPENDING, and the append is taken back`, () => {
      const t = execTown();
      const before = snapshot(t.clone);
      const out = runExec(t, exec, { ...payload, ...refusing });
      assert.ok(out.error, `a refusal: ${JSON.stringify(out)}`);
      assert.deepEqual(snapshot(t.clone), before);
    });
  }
  test(`P12 · ${exec}: the ordinary write still lands, once`, () => {
    const t = execTown();
    const out = runExec(t, exec, payload);
    assert.equal(out.error, undefined, JSON.stringify(out));
    assert.equal(sh(t.clone, "ls-remote", "origin", "refs/heads/main").split("\t")[0], out.commit);
    assert.equal(sh(t.clone, "status", "--porcelain", "--untracked-files=all"), "");
  });
}

test("P13 · THE FUND DOOR'S WORDS are for a payer: the payment is untouched, verify the same transaction again", () => {
  const t = execTown();
  breakPush(t);
  const out = runExec(t, "fund-exec.mjs", EXECS[1][1]);
  assert.match(out.error.hint, /your payment itself is untouched; verify the same transaction again and it is recorded once/);
});

// ═══════════════════════════════════════════════════════════════════════════
// The two execs whose writes sit behind the record: declare and settle-join
// ═══════════════════════════════════════════════════════════════════════════
//
// Both read the registry from the store before they write, and this suite has
// no store. So their record-facing modules are replaced for the one spawned
// exec by a resolve hook (node:module register) — the exec itself, its
// penTransaction and the real penCommit run unchanged. The stubs write what
// the real modules write into the clone (a berth card, the two registry files)
// and then either refuse or let the pen try to land.
const HOOKS = `
export async function resolve(specifier, context, next) {
  const stubs = JSON.parse(process.env.PEN_TX_STUBS ?? "{}");
  const parent = process.env.PEN_TX_PARENT ?? "";
  if (context.parentURL && context.parentURL.endsWith(parent) && stubs[specifier])
    return { url: stubs[specifier], shortCircuit: true };
  return next(specifier, context);
}
`;
const REGISTER = (hooksUrl) => `import { register } from "node:module"; register(${JSON.stringify(hooksUrl)});\n`;
const writeUrl = new URL("../src/write.mjs", import.meta.url).href;
const STUB_DECLARE = `
export const LANDING_GROUND = "the-landing";
export const readRegisters = async () => ({ registry: { households: {} }, pins: {} });
export const conformance = (args) => ({ handle: args.handle, household: "Newcomers", slug: "newcomers", ghId: 7, ghLogin: "newcomer-gh" });
export const planDeclaration = (registry, pins, decl) => ({
  slug: decl.slug, date: "2026-09-28", settled: false, gangway: "open",
  registry: { households: { [decl.slug]: { declared_by: decl.handle } } },
  files: [
    { path: "WHITE_PAGES/" + decl.handle + "/ADDRESS.md", content: "---\\nhandle: " + decl.handle + "\\n---\\n" },
    { path: "tools/households.json", content: JSON.stringify({ households: { [decl.slug]: {} } }) + "\\n" },
  ],
});
`;
const STUB_RESIDENCY = `export const gangwayState = () => "open";\n`;
const STUB_CEREMONY = `
export const NO_DRAIN = async () => ({ ran: false });
export const collectingDrain = () => ({ drain: async () => ({ ran: true }), paths: [] });
export const mintHousehold = async () => ({});
export async function joinHousehold({ handle }) {
  if (handle === "refuse-me") throw Object.assign(new Error("refused"), { code: 409, defect: "that handle was taken inside the lock" });
  return { registry: { rendered: true } };
}
`;
const STUB_SETTLE = `
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { penCommit } from ${JSON.stringify(writeUrl)};
export async function settleUnderLock({ handle, clone }) {
  const files = ["tools/households.json", "tools/github-ids.json"].map((rel) => join(clone, rel));
  writeFileSync(files[0], JSON.stringify({ households: { newcomers: { residents: [handle] } } }) + "\\n");
  writeFileSync(files[1], JSON.stringify({ [handle]: { id: 7 } }) + "\\n");
  if (handle === "refuse-me") throw Object.assign(new Error("refused"), { code: 422, defect: "the vouch did not hold" });
  return { settled: true, handle, commit: penCommit(clone, files, "registry: rendered from the store") };
}
`;

function stubbedTown() {
  const t = execTown();
  const stubDir = join(t.dir, "stubs");
  mkdirSync(stubDir);
  const put = (name, text) => { writeFileSync(join(stubDir, name), text); return pathToFileURL(join(stubDir, name)).href; };
  const hooks = put("hooks.mjs", HOOKS);
  const register = join(stubDir, "register.mjs");
  writeFileSync(register, REGISTER(hooks));
  const stubs = {
    "declare-exec.mjs": { "./declare.mjs": put("declare.mjs", STUB_DECLARE), "./residency.mjs": put("residency.mjs", STUB_RESIDENCY), "./ceremony.mjs": put("ceremony.mjs", STUB_CEREMONY) },
    "settle-join-exec.mjs": { "./settle-join.mjs": put("settle-join.mjs", STUB_SETTLE) },
  };
  const dbPath = join(t.dir, "office.db");
  new DatabaseSync(dbPath).close();
  return { ...t, register, stubs, dbPath };
}
function runStubbed(t, exec, payload) {
  const r = spawnSync(process.execPath, ["--import", pathToFileURL(t.register).href, join(ROOT, "src", exec), JSON.stringify(payload)], {
    encoding: "utf8",
    env: { ...process.env, ...IX.env, TOWN_CLONE: t.clone, TOWN_PUSH: "1", BOT_NAME: "fixture", BOT_EMAIL: "fixture@test.invalid",
      PEN_TX_STUBS: JSON.stringify(t.stubs[exec]), PEN_TX_PARENT: `/src/${exec}` },
  });
  assert.equal(r.status, 0, `${exec} answers rather than trips: ${r.stderr}`);
  return JSON.parse(r.stdout.trim().split("\n").at(-1));
}
const RECORD_EXECS = [
  ["declare-exec.mjs", (t, handle) => ({ args: { handle }, key: {}, dbPath: t.dbPath })],
  ["settle-join-exec.mjs", (t, handle) => ({ handle, ghId: 7, ghLogin: "newcomer-gh", pr: 1 })],
];
const REGISTRY_SEED = { "tools/households.json": "{\"households\":{}}\n", "tools/github-ids.json": "{}\n" };

for (const [exec, payloadFor] of RECORD_EXECS) {
  test(`P14 · ${exec}: REFUSED INSIDE THE LOCK after writing its files, and the files are taken back`, () => {
    const t = stubbedTown();
    for (const [rel, text] of Object.entries(REGISTRY_SEED)) writeFileSync(join(t.clone, rel), text);
    sh(t.clone, "add", "-A"); sh(t.clone, ...BOT, "commit", "-qm", "registry seed"); sh(t.clone, "push", "-q");
    const before = snapshot(t.clone);
    const out = runStubbed(t, exec, payloadFor(t, "refuse-me"));
    // the stub's own refusal, AFTER its writes — not a refusal from before them
    assert.match(out.error?.defect ?? "", /taken inside the lock|the vouch did not hold/, JSON.stringify(out));
    assert.deepEqual(snapshot(t.clone), before);
  });
  test(`P15 · ${exec}: A PUSH THAT CANNOT LAND is an answer (503), and the clone is exactly as it was`, () => {
    const t = stubbedTown();
    for (const [rel, text] of Object.entries(REGISTRY_SEED)) writeFileSync(join(t.clone, rel), text);
    sh(t.clone, "add", "-A"); sh(t.clone, ...BOT, "commit", "-qm", "registry seed"); sh(t.clone, "push", "-q");
    const before = snapshot(t.clone);
    breakPush(t);
    const out = runStubbed(t, exec, payloadFor(t, "newcomer"));
    assert.equal(out.error?.code, 503, JSON.stringify(out));
    assert.equal(out.error.defect, "the town did not take this write", "the pen's 503, not an unreachable record's");
    assert.deepEqual(snapshot(t.clone), before);
  });
}
