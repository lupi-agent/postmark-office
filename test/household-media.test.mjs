// household-media.test.mjs — the media read (household { read: "media" }, tenant 5).
//
//   node --test test/household-media.test.mjs
//
// What these hold to account is the ONE claim the tenant makes that could quietly
// stop being true: that the read and the write agree. The ledger table, the URL
// grammar and the quota arithmetic have exactly one home each (media.mjs § the
// media door's own arithmetic, in one home), and every falsifier below compares the
// read's answer against what uploadMedia ITSELF returned rather than against a
// number typed here — so a fork shows up as a disagreement, which is the only
// symptom a fork ever has.
//
// Env is pinned BEFORE the dynamic imports: media.mjs reads its dials at module
// load, and world.mjs resolves WORLD_CLONE at load too — the first embedded scan
// is what pulls it in, so the temp world repo must be named before then.

import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

process.env.R2_ACCOUNT_ID = "test-account";
process.env.R2_ACCESS_KEY_ID = "test-key";
process.env.R2_SECRET_ACCESS_KEY = "test-secret";
process.env.MEDIA_QUOTA_BYTES = "400"; // per resident — small, so the ceiling arithmetic is visible

// THE REAL world clone, found BEFORE the temp one is named below. The law
// falsifiers read the planted marks off the record's own working tree, and the
// office's WORLD_CLONE is about to be pointed at a throwaway repo for the
// embedded-scan tests — so the two paths are resolved separately, on purpose.
// A worktree sits outside the office clone, so the usual `../postmark-world`
// sibling does not resolve from here; the candidates cover both layouts, and
// the law tests skip OUT LOUD on a box that has neither.
const REPO_ROOT = fileURLToPath(new URL("../", import.meta.url));
const WORLD_REPO = [
  process.env.WORLD_MARKS_REPO,
  process.env.WORLD_CLONE,
  join(REPO_ROOT, "..", "postmark-world"),
  join(REPO_ROOT, "..", "postmark", "postmark-world"),
].filter(Boolean).find((d) => existsSync(join(d, "WORLD", "marks"))) ?? "";

const WORLD = mkdtempSync(join(tmpdir(), "pm-media-world-")).replace(/\\/g, "/");
process.env.WORLD_CLONE = WORLD;

const { mediaUrlOk, mediaLedgerRows, mediaQuota, uploadMedia } = await import("../src/media.mjs");
const { BYTE_ACCOUNTING_LAW, EMBED_SURFACES, HOUSEHOLD_GRAIN_LAW, MEDIA_LAW, mediaRead } = await import("../src/household-media.mjs");
const { householdApex } = await import("../src/household-apex.mjs");

// ── fixtures ─────────────────────────────────────────────────────────────────

// a real, whole 1×1 transparent PNG (70 bytes) — passes magic bytes + IEND
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
// distinct, whole SVGs — this is the one door that takes them (2026-08-20),
// and the comment is what makes each one different bytes, hence a different sha.
// POS-150: each carries a size. An SVG with no width/height/viewBox passes the
// office's own looksLikeSVG gate and libvips refuses it ("bad dimensions"), so a
// dimensionless fixture now tests the refusal rather than the door.
const svg = (tag) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4" viewBox="0 0 4 4"><!--${tag}--><rect width="4" height="4"/></svg>`).toString("base64");

const key = (over = {}) => ({ household: "testers", handles: new Set(["tester"]), ...over });
const odb = () => new DatabaseSync(":memory:");
const put = async () => {};
// POS-150: the base64 door closed, so this helper walks the bytes in the way a
// resident's would — down the URL lane, fetch and DNS injected so the test
// still runs offline. Its signature is unchanged, and so is every call site.
const FIXTURE_URL = "https://fixture.example.com/bytes";
const serving = (b64) => {
  const buf = Buffer.from(b64, "base64");
  return {
    fetchImpl: async () => ({
      status: 200, ok: true,
      headers: new Headers({ "content-length": String(buf.length) }),
      body: { getReader: () => { let sent = false; return {
        read: async () => (sent ? { done: true } : (sent = true, { done: false, value: new Uint8Array(buf) })),
        cancel: async () => {},
      }; } },
    }),
    lookup: async () => [{ address: "93.184.216.34", family: 4 }],
  };
};
const upload = (image, k, db) => uploadMedia({ image_url: FIXTURE_URL }, k, db, { put, ...serving(image) });

const git = (args, cwd = WORLD) =>
  execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

// THE TEMP WORLD IS A REPO BEFORE ANY TEST CAN SHELL GIT AT IT, and this order
// is not fussiness. `git -C <dir>` in a directory that is not a repository WALKS
// UP until it finds one; on a box where the user's home directory is itself a
// git repo — this one — a probe like `rev-parse --git-dir` succeeds against that
// ancestor, and the `add -A` behind it then stages the entire home directory.
// (It did, here, for 120 seconds, before the lock stopped it.) So: init
// unconditionally, then PROVE the toplevel is this directory and refuse to run
// at all if it is not. A test that can reach outside its own temp dir is not a
// test, whatever it asserts.
mkdirSync(join(WORLD, "WORLD"), { recursive: true });
execFileSync("git", ["-C", WORLD, "init", "-b", "main"], { stdio: "ignore" });
{
  const norm = (p) => realpathSync(p).split("\\").join("/").toLowerCase().replace(/\/+$/, "");
  const top = norm(git(["rev-parse", "--show-toplevel"]).trim());
  if (top !== norm(WORLD)) {
    throw new Error(`refusing to run: git in ${WORLD} resolves to the repo at ${top}`);
  }
}

/** A world clone whose published main carries exactly these marks. */
function publishMarks(marks) {
  writeFileSync(join(WORLD, "WORLD", "world-state.json"), JSON.stringify({ marks }));
  git(["add", "-A"]);
  git(["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-m", "marks", "--allow-empty"]);
}

/** A town clone holding one resident's window pane. */
function townWithWindow(handle, html) {
  const dir = mkdtempSync(join(tmpdir(), "pm-media-town-"));
  mkdirSync(join(dir, "WHITE_PAGES", handle, "WINDOW"), { recursive: true });
  writeFileSync(join(dir, "WHITE_PAGES", handle, "WINDOW", "window.html"), html);
  return dir;
}

// ── the gate · your books, and nobody else's ─────────────────────────────────


test("own household only: no household bounces, a berth bounces in the write door's own words", async () => {
  const nobody = await mediaRead({ handles: new Set() }, { odb: odb() });
  assert.equal(nobody.error, "bounce");
  assert.equal(nobody.code, 403);
  assert.match(nobody.defect, /media is your household's own/);

  // uploadMedia's refusal, quoted: "a berth holds no media" — the read must
  // refuse the same caller for the same stated reason, or a berth learns the
  // rule twice, differently.
  const berth = await mediaRead({ berth: true, slug: "wanderer" }, { odb: odb() });
  assert.equal(berth.code, 403);
  assert.equal(berth.defect, "a berth holds no media");
  const written = readFileSync(new URL("../src/media.mjs", import.meta.url), "utf8");
  assert.ok(written.includes('"a berth holds no media"'),
    "the write door is where that sentence comes from — if it moves, this read is quoting a ghost");
});

test("one household's media never shows another's files", async () => {
  const db = odb();
  const mine = await upload(PNG, key(), db);
  const theirs = await upload(svg("theirs"), key({ household: "others", handles: new Set(["other"]) }), db);

  const r = await mediaRead(key(), { odb: db, embedded: async () => ({ hits: new Set(), unreadable: [] }) });
  assert.deepEqual(r.uploads.map((u) => u.url), [mine.url]);
  assert.equal(r.household, "testers");
  assert.ok(!r.uploads.some((u) => u.url === theirs.url), "the other household's file is not in this answer");
});

test("there is no household argument to get wrong — the apex answers the CALLER's media", async () => {
  const db = odb();
  await upload(PNG, key(), db);
  await upload(svg("theirs"), key({ household: "others", handles: new Set(["other"]) }), db);
  // A caller naming someone else's house gets their own media, because the read
  // takes the household from the KEY and there is no parameter that says
  // otherwise. This is the gate being absent by construction, not passing.
  const r = await householdApex({ read: "media", household: "others", handle: "other" }, key(), { odb: db });
  assert.equal(r.household, "testers");
  assert.equal(r.count, 1);
});

// ── nothing uploaded is nothing uploaded ────────────────────────────────────

test("empty is empty: an honest list and a real quota, never a bounce", async () => {
  const r = await mediaRead(key(), { odb: odb() });
  assert.equal(r.error, undefined, "an empty list is an answer, not a refusal");
  assert.equal(r.read, "media");
  assert.equal(r.count, 0);
  assert.deepEqual(r.uploads, []);
  assert.equal(r.quota.used, 0);
  assert.equal(r.quota.ceiling, 400);
  assert.equal(r.quota.remaining, 400, "the whole wall is still ahead of you");
});

// ── the quota is the upload door's, not a second copy ────────────────────────

test("the quota block matches the numbers uploadMedia itself answered with", async () => {
  const db = odb();
  const first = await upload(PNG, key(), db);
  const second = await upload(svg("second"), key(), db);
  // A NEIGHBOUR'S BYTES IN THE SAME LEDGER, and they must not count against this
  // wall. Without this row the read and the write agree even when both are
  // wrong the same way — a fold over the whole table equals a fold over one
  // household when only one household has ever uploaded, and the falsifier that
  // only compares the two answers would sit there green through it.
  await upload(svg("neighbour"), key({ household: "others", handles: new Set(["other"]) }), db);

  const r = await mediaRead(key(), { odb: db, embedded: async () => ({ hits: new Set(), unreadable: [] }) });
  assert.equal(r.quota.used, second.quota.used, "used is the same fold the write charges against");
  assert.equal(r.quota.ceiling, second.quota.ceiling, "and the same ceiling");
  assert.equal(r.quota.used, first.bytes + second.bytes, "which is simply the bytes behind the door");
  assert.equal(r.quota.remaining, r.quota.ceiling - r.quota.used);
  assert.equal(r.quota.per_resident, 400);
});

test("the ceiling is sized per resident the KEY holds — the write's own grain", async () => {
  const db = odb();
  const three = key({ handles: new Set(["tester", "second", "third"]) });
  const answer = await uploadMedia({ image_url: FIXTURE_URL, by: "tester" }, three, db, { put, ...serving(PNG) });
  const r = await mediaRead(three, { odb: db, embedded: async () => ({ hits: new Set(), unreadable: [] }) });
  assert.equal(r.quota.ceiling, 1200, "three residents, three shares of 400");
  assert.equal(r.quota.ceiling, answer.quota.ceiling, "and exactly what the upload charged against");
  // The same ledger read through a one-resident key quotes the smaller wall:
  // the ceiling follows the credential, not the bytes.
  const one = await mediaRead(key(), { odb: db, embedded: async () => ({ hits: new Set(), unreadable: [] }) });
  assert.equal(one.quota.ceiling, 400);
  assert.equal(one.quota.used, r.quota.used, "the same bytes, both times");
});

// ── the URL is minted once, and passes the mark door's own allowlist ─────────

test("every row's url is the upload's url, and passes mediaUrlOk", async () => {
  const db = odb();
  const png = await upload(PNG, key(), db);
  const one = await upload(svg("one"), key(), db);

  const rows = (await mediaLedgerRows(db, "testers"));
  const byUrl = new Map(rows.map((r) => [r.url, r]));
  for (const answered of [png, one]) {
    assert.ok(byUrl.has(answered.url), `the read answers the same URL the upload did: ${answered.url}`);
    assert.ok(mediaUrlOk(answered.url), "and the mark door would accept it");
  }
  for (const row of rows) {
    assert.ok(mediaUrlOk(row.url), `${row.url} must pass the allowlist the mark door enforces`);
    assert.match(row.url, /^https:\/\/media\.postmark\.town\/media\/testers\/[0-9a-f]{64}\.(png|svg|jpg|webp)$/);
  }
});

test("media_type is the type the upload answered with, and the concrete one", async () => {
  const db = odb();
  const png = await upload(PNG, key(), db);
  const row = (await mediaLedgerRows(db, "testers")).find((r) => r.url === png.url);
  assert.equal(row.ext, "png");
  assert.equal(row.media_type, png.type, "the read and the write name the same type");
  assert.equal(row.media_type, "image/png", "and that type is image/png — pinned, so a shared table cannot drift both sides at once");
  assert.equal(row.bytes, 70);
  assert.equal(row.by, "tester");
  assert.match(row.uploaded_at, /^\d{4}-\d{2}-\d{2}T/);
});

test("newest first", async () => {
  const db = odb();
  const a = await upload(svg("a"), key(), db);
  await new Promise((r) => setTimeout(r, 3));
  const b = await upload(svg("b"), key(), db);
  await new Promise((r) => setTimeout(r, 3));
  const c = await upload(svg("c"), key(), db);
  assert.deepEqual((await mediaLedgerRows(db, "testers")).map((r) => r.url), [c.url, b.url, a.url]);
});

// ── the embedded hint ────────────────────────────────────────────────────────

test("embedded: true where the URL hangs on one of your own published marks", async () => {
  const db = odb();
  const hung = await upload(svg("hung"), key(), db);
  const loose = await upload(svg("loose"), key(), db);
  const stranger = await upload(svg("stranger"), key(), db);

  publishMarks([
    { id: "tester/the-lit-house", by: "tester", body: "a house", image: hung.url },
    // A STRANGER'S mark carrying our URL must not count: the question is whether
    // YOUR file hangs on YOUR surfaces, and `by` is what decides whose mark it is.
    { id: "someone/borrowed", by: "someone", body: "borrowed", image: stranger.url },
  ]);

  const r = await mediaRead(key(), { odb: db });
  const at = (url) => r.uploads.find((u) => u.url === url);
  assert.deepEqual(r.embedded_check.unreadable, undefined, "the world clone opened");
  assert.equal(at(hung.url).embedded, true);
  assert.equal(at(loose.url).embedded, false, "nothing points at it, and the scan could look everywhere");
  assert.equal(at(stranger.url).embedded, false, "someone else's mark is not one of your surfaces");
  assert.deepEqual(r.embedded_check.surfaces, [...EMBED_SURFACES]);
  assert.ok(r.embedded_check.not_covered.some((s) => /draft marks/.test(s)),
    "and the answer names the surface it does NOT cover, so false is never a silent lie");
});

test("embedded: true where the URL hangs in your window", async () => {
  const db = odb();
  const inPane = await upload(svg("pane"), key(), db);
  publishMarks([]);
  const clone = townWithWindow("tester", `<p>look</p><img src="${inPane.url}">`);
  const r = await mediaRead(key(), { odb: db, clone });
  assert.equal(r.uploads.find((u) => u.url === inPane.url).embedded, true);
});

test("a surface that will not open answers null — unknown, never false", async () => {
  const db = odb();
  const one = await upload(svg("unknowable"), key(), db);
  const r = await mediaRead(key(), {
    odb: db,
    embedded: async () => ({ hits: new Set(), unreadable: ["published marks — no main ref"] }),
  });
  // THE DISCLOSURE GUARD (`the-town/the-disclosure`): refuse or disclose absent
  // inputs, never quietly substitute. A false here would tell a resident their
  // picture is hanging nowhere when the truth is that the office could not look.
  assert.equal(r.uploads.find((u) => u.url === one.url).embedded, null);
  assert.deepEqual(r.embedded_check.unreadable, ["published marks — no main ref"]);
  assert.match(r.embedded_check.note, /unknown, never false/);
});

test("an unreadable surface does not un-find what a readable one already found", async () => {
  const db = odb();
  const found = await upload(svg("found"), key(), db);
  const r = await mediaRead(key(), {
    odb: db,
    embedded: async () => ({ hits: new Set([found.url]), unreadable: ["window (tester) — EACCES"] }),
  });
  assert.equal(r.uploads.find((u) => u.url === found.url).embedded, true);
});

// ── the door is reachable, and says so ───────────────────────────────────────

test("the household apex routes read: \"media\" and names it among the readable", async () => {
  const db = odb();
  const r = await householdApex({ read: "media" }, key(), { odb: db });
  assert.equal(r.read, "media");
  assert.equal(r.household, "testers");

  const nope = await householdApex({ read: "bookshelves" }, key(), { odb: db });
  assert.equal(nope.code, 422);
  const { HOUSEHOLD_TOOL, HOUSEHOLD_READS } = await import("../src/household-apex.mjs");
  // ⚑ ASSERTED AGAINST THE CONSTANT, not against a copy of its prose
  // (2026-09-07). This read `/media \(your uploads/`, which pinned the exact
  // wording of `HOUSEHOLD_READS.media` into a second file — so enriching that
  // blurb turned this leg red without anything being wrong. Both surfaces are
  // built from the constant now, and the two assertions below say the intent:
  // the bounce names the read a caller guessed past, and the schema advertises
  // it. A blurb may be improved without breaking a falsifier that never cared
  // about its words.
  assert.ok(nope.hint.includes(`media (${HOUSEHOLD_READS.media})`),
    "a caller who guesses wrong must be told the read exists, with its own blurb");
  assert.ok(HOUSEHOLD_TOOL.inputSchema.properties.read.description.includes(`media (${HOUSEHOLD_READS.media})`),
    "and the tool's own schema must advertise it, or no agent will ever find it");
});

test("no ledger, no media — and it says which of the two silences this is", async () => {
  const none = await mediaRead(key(), { odb: null });
  assert.equal(none.code, 409);
  assert.match(none.defect, /media ledger is not open/);
});

// ── the law this tenant quotes is the law the RECORD carries ────────────────
//
// It used to quote media.mjs's file header, because no planted class fitted the
// media door and this file flagged that rather than inventing one. The founder
// planted it: logos/the-media with the-byte-accounting and the-household-grain
// (world main 674c359c). So the quotes now come from the store by read, and
// these falsifiers go to the MARK FILES in the world clone — the record itself,
// not a copy of it and not the store's cache of it.

/**
 * The three planted marks, read straight off the world repo's working tree —
 * keyed by the id the RECORD gives them, never by the door's constants.
 *
 * An earlier version keyed this map with MEDIA_LAW and its siblings, and the
 * flip that renamed one of those constants stayed green: both sides of the
 * comparison moved together, so the test proved only that a string equals
 * itself. The id here is rebuilt the way the world builds one — `<by>/<slug>`,
 * with `by` read out of the mark's own frontmatter and the slug being the
 * directory it stands in — so the door's constants have something independent
 * to be wrong against.
 */
function plantedBodies() {
  const base = join(WORLD_REPO, "WORLD", "marks", "let-there-be-light", "logos", "the-media");
  const read = (...seg) => {
    const dir = join(base, ...seg);
    const text = readFileSync(join(dir, "mark.md"), "utf8");
    const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(text);
    assert.ok(m, "a mark file must have frontmatter and a body");
    const by = /^by:\s*(.+)$/m.exec(m[1])?.[1]?.trim();
    assert.ok(by, "a mark must name its author");
    const slug = seg.length ? seg[seg.length - 1] : "the-media";
    return [`${by}/${slug}`, m[2].trim()];
  };
  return Object.fromEntries([read(), read("the-byte-accounting"), read("the-household-grain")]);
}

const haveWorldRepo = existsSync(join(WORLD_REPO, "WORLD", "marks", "let-there-be-light", "logos", "the-media", "mark.md"));

test("the three marks the door names are the three marks the record holds", { skip: haveWorldRepo ? false : "no world clone on this box" }, () => {
  const bodies = plantedBodies();
  // The ids come from the record; the door's constants must MATCH them. If a
  // mark is renamed or retired, or a constant is mistyped, these disagree.
  assert.deepEqual([BYTE_ACCOUNTING_LAW, HOUSEHOLD_GRAIN_LAW, MEDIA_LAW].sort(), Object.keys(bodies).sort(),
    "the marks the door names are not the marks standing in the record");
  for (const [mark, body] of Object.entries(bodies)) {
    assert.ok(body.length > 20, `${mark} must carry a real sentence`);
  }
  // And the one this whole door stands on says what the door is FOR.
  assert.match(bodies[MEDIA_LAW], /a mark carries the URL, never the bytes/);
});

test("no law sentence is hand-typed in the office — the door quotes, it does not restate",
  { skip: haveWorldRepo ? false : "no world clone on this box" }, () => {
    const bodies = plantedBodies();
    // THE NO-THIRD-COPY RULE. The record holds the sentence; the door reads it;
    // this test compares the two. A copy pasted into office source would make
    // the door's answer survive a change to the record — which is the whole
    // failure mode quoting exists to prevent, and it looks correct on its own
    // page right up until the law moves.
    for (const file of ["../src/household-media.mjs", "../src/media.mjs", "../src/household-apex.mjs"]) {
      const src = readFileSync(new URL(file, import.meta.url), "utf8");
      const code = src.split(/\n(?=import )/).slice(1).join("\n");
      for (const [mark, body] of Object.entries(bodies)) {
        assert.equal(code.includes(body), false,
          `${file} hand-types ${mark}'s sentence in CODE — quote it through lawOf instead`);
      }
    }
  });

test("media.mjs's header is TRUED to the marks where it paraphrases them", async () => {
  // Point 3 of the rename ruling: a comment may quote law, but a sentence that
  // now DIFFERS from the planted mark is drift wearing a comment's clothes. The
  // header read "byte-accounting is machinery, not record" before the marks
  // landed; the record's word is "never".
  const header = readFileSync(new URL("../src/media.mjs", import.meta.url), "utf8").split("\nimport ")[0];
  assert.equal(/machinery, not record/.test(header), false,
    "the pre-planting wording must not survive beside the mark that overrules it");
  assert.match(header, /machinery, NEVER record/,
    "and the header must carry the record's own word");
});

test("the door quotes by READ, and says so honestly when the store cannot answer", async () => {
  const db = odb();
  await upload(PNG, key(), db);
  const r = await mediaRead(key(), { odb: db, embedded: async () => ({ hits: new Set(), unreadable: [] }) });
  // Every quote block names its mark whether or not the store could resolve it.
  for (const block of [r.law, r.quota.law]) {
    assert.ok(block.mark, "a quote always names the mark it came from");
    assert.equal(typeof block.mark, "string");
    // Resolved or not — but never a substituted sentence.
    if (block.says === undefined) {
      assert.ok(block.unresolved, "an unresolvable mark says so rather than going quiet");
    } else {
      assert.ok(block.says.length > 0);
    }
  }
  assert.equal(r.law.mark, MEDIA_LAW);
  assert.equal(r.quota.law.mark, BYTE_ACCOUNTING_LAW);
});

test("the own-household gate cites the mark that makes it law", async () => {
  const nobody = await mediaRead({ handles: new Set() }, { odb: odb() });
  assert.equal(nobody.code, 403);
  assert.equal(nobody.law.mark, HOUSEHOLD_GRAIN_LAW,
    "the refusal must name the-household-grain — the gate is the record's, not this door's preference");
  const berth = await mediaRead({ berth: true, slug: "wanderer" }, { odb: odb() });
  assert.equal(berth.law.mark, HOUSEHOLD_GRAIN_LAW);
});

test("the retired word is gone from the tenant and from what a resident reads", async () => {
  const { HOUSEHOLD_TOOL } = await import("../src/household-apex.mjs");
  const tenant = readFileSync(new URL("../src/household-media.mjs", import.meta.url), "utf8");
  assert.equal(/shelf/i.test(tenant), false, "the tenant carries no trace of the retired word");
  const write = readFileSync(new URL("../src/media.mjs", import.meta.url), "utf8");
  assert.equal(/shelf/i.test(write), false, "nor does the door it is paired with");
  // The read word itself, at the two places a caller meets it.
  assert.match(HOUSEHOLD_TOOL.inputSchema.properties.read.description, /\bmedia\b/);
  assert.equal(/\bshelf\b/i.test(HOUSEHOLD_TOOL.inputSchema.properties.read.description), false);
});

// ── lawOf itself: what it will and will not quote ───────────────────────────

test("lawOf quotes only the town's own constitutional predicated marks", async () => {
  // The gate is the whole safety of quoting: a door that will read any node
  // with a `slot` would happily present a RESIDENT'S sentence as town law.
  // Without a store to read, the flip that removes the gate is invisible — so
  // this builds one, four rows deep, and asks for each.
  const { lawOf } = await import("../src/world-apex.mjs");
  const store = new DatabaseSync(":memory:");
  store.exec("CREATE TABLE nodes (id TEXT PRIMARY KEY, kind TEXT, subkind TEXT, tier TEXT, by TEXT, props TEXT)");
  const row = (id, by, tier, props) =>
    store.prepare("INSERT INTO nodes (id, kind, tier, by, props) VALUES (?, 'mark', ?, ?, ?)")
      .run(id, tier, by, JSON.stringify(props));

  row("the-town/the-media", "the-town", "constitution", { slot: "media", value: "v", body: "the law itself" });
  row("wright/my-opinion", "wright", "constitution", { slot: "media", value: "v", body: "a resident's sentence" });
  row("the-town/a-draft", "the-town", "market", { slot: "media", value: "v", body: "not settled law" });
  row("the-town/no-slot", "the-town", "constitution", { body: "a body with no slot is not a predicated rule" });

  assert.equal(lawOf(store, "the-town/the-media").text, "the law itself");
  assert.equal(lawOf(store, "wright/my-opinion"), null, "a resident's sentence is never quoted as law");
  assert.equal(lawOf(store, "the-town/a-draft"), null, "only the constitution tier is law");
  assert.equal(lawOf(store, "the-town/no-slot"), null, "a mark with no slot is not a predicated rule");
  assert.equal(lawOf(store, "the-town/absent"), null, "an id the store does not hold answers null, never a throw");
  assert.equal(lawOf(null, "the-town/the-media"), null, "and no store answers null too");
  store.close();
});

test("the door's quote block carries what lawOf actually read", async () => {
  // quoteLaw is the seam between the store and the answer, so it is worth one
  // direct look: a resolved mark rides `says` and `from`; anything else says
  // `unresolved` and still names the mark it wanted.
  const { quoteLaw } = await import("../src/household-media.mjs");
  const store = new DatabaseSync(":memory:");
  store.exec("CREATE TABLE nodes (id TEXT PRIMARY KEY, kind TEXT, subkind TEXT, tier TEXT, by TEXT, props TEXT)");
  store.prepare("INSERT INTO nodes (id, kind, tier, by, props) VALUES (?, 'mark', 'constitution', 'the-town', ?)")
    .run(MEDIA_LAW, JSON.stringify({ slot: "media", value: "v", body: "quoted, not restated" }));

  const got = quoteLaw(store, MEDIA_LAW);
  assert.equal(got.mark, MEDIA_LAW);
  assert.equal(got.says, "quoted, not restated");
  assert.equal(got.from, MEDIA_LAW);
  assert.equal(got.unresolved, undefined);

  const missing = quoteLaw(store, "the-town/never-planted");
  assert.equal(missing.mark, "the-town/never-planted");
  assert.equal(missing.says, undefined, "an unread mark must not be given a sentence");
  assert.ok(missing.unresolved, "and must say that it could not be read");
  store.close();
});

// ── the uploads bound (2026-08-25) ──────────────────────────────────────────

test("the uploads list is bounded, and `count` is the whole ledger — not the page", async () => {
  // The quota bounds BYTES, never ROWS: a household of thumbnails can hold
  // hundreds of files well inside 20 MB, and this read listed every one of them
  // on every call. `count` was already here and already correct, which is
  // exactly why it said nothing — it was also the list length, so it could
  // never disagree with the list. The bound is what turns it into information.
  //
  // Rows are seeded straight into the ledger rather than uploaded, because the
  // fixture's ceiling is 400 bytes per resident on purpose and thirty real
  // uploads cannot fit under it. The read reads the table either way.
  const db = odb();
  const { ensureMediaTable } = await import("../src/media.mjs");
  ensureMediaTable(db);
  const ins = db.prepare("INSERT INTO media (household, sha, ext, bytes, by_handle, created) VALUES (?, ?, ?, ?, ?, ?)");
  for (let i = 0; i < 30; i++) {
    ins.run("testers", String(i).padStart(64, "a"), "png", 10, "tester", `2026-08-${String((i % 28) + 1).padStart(2, "0")}T00:00:00.000Z`);
  }
  const none = async () => ({ hits: new Set(), unreadable: [] });

  const page = await mediaRead(key(), { odb: db, embedded: none });
  assert.equal(page.uploads.length, 25, "the page");
  assert.equal(page.count, 30, "the whole ledger");
  assert.notEqual(page.count, page.uploads.length,
    "THE FALSIFIER: a count that cannot disagree with its own list is the list length wearing a total's name");
  assert.equal(page.shown, 25);
  assert.equal(page.complete, false);
  assert.equal(page.next_offset, 25);
  assert.match(page.more_note, /measured in BYTES/, "the quota counts every file, listed or not");

  const rest = await mediaRead(key(), { odb: db, embedded: none, offset: 25 });
  assert.equal(rest.uploads.length, 5);
  assert.equal(rest.complete, true);
  assert.equal(rest.next_offset, undefined);
  assert.equal(rest.count, 30, "the total does not shrink as you walk");

  // the pages tile the ledger: no file served twice, none missed
  const seen = [...page.uploads, ...rest.uploads].map((u) => u.url);
  assert.equal(new Set(seen).size, 30);

  // AND THE QUOTA IS COMPUTED OVER THE WHOLE LEDGER, not the page. A budget
  // decides how much gets said; it must not decide what is true — and a quota
  // that only counted the rows this read happened to render would tell a
  // household it had room it does not have.
  assert.equal(page.quota.used, 300, "30 files x 10 bytes, all of them");
  assert.equal(page.quota.used, rest.quota.used, "and the same on any page");
});

test("a ledger that fits inside the bound reports itself complete", async () => {
  const r = await mediaRead(key(), { odb: odb(), embedded: async () => ({ hits: new Set(), unreadable: [] }) });
  assert.equal(r.count, 0);
  assert.equal(r.complete, true);
  assert.equal(r.more_note, undefined, "an empty shelf and a cut one must not look alike");
});
