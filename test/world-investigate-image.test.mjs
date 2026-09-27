// world-investigate-image.test.mjs — world_investigate's opt-in `with_image`.
//
// Each test below QUOTES the constraint it asserts, verbatim, in its name. A
// brief is lossy; the sentence is the law, so the sentence travels with the
// check that enforces it.
//
// The world here is a REAL git fixture clone (the door reads published state
// out of git, so a plain directory would not do), built from the town's own
// world-state.json with two extra marks planted: one carrying a media image,
// one carrying an off-media url that could never be written through leave_mark.
// The second is the SSRF falsifier — a hostile url arriving the only way it
// realistically could, already sitting on a mark.
//
//   node --test test/world-investigate-image.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { NO_WORLD, worldClone } from "./fixture-paths.mjs";

const SOURCE_WORLD = worldClone();
// The fixture clone is COPIED out of a real world checkout, so with none at
// hand there is nothing to copy and every case below is a skip with its
// reason, never a red about a directory on somebody else's PC.
const SKIP = !SOURCE_WORLD && NO_WORLD;
const MEDIA_URL = "https://media.postmark.town/media/fixture/aaaabbbbccccdddd.jpg";
const OFF_MEDIA_URL = "https://evil.example.test/steal.png";

// A 1×1 PNG. Used as the media host's answer for a url that ENDS IN .jpg, so the
// mimeType assertion below can only pass if the bytes were sniffed.
const PNG_1x1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64");

// ── the fixture clone ────────────────────────────────────────────────────────

const repo = mkdtempSync(join(tmpdir(), "pm-world-fixture-"));
const git = (...args) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" });

if (SOURCE_WORLD) {
mkdirSync(join(repo, "WORLD"), { recursive: true });
cpSync(join(SOURCE_WORLD, "WORLD", "skeleton.json"), join(repo, "WORLD", "skeleton.json"));
// The door materialises the ENGINE out of the clone at main (world.mjs
// engineDir), so the fixture has to carry the real one — the verbs under test
// are the town's own, never a stand-in.
cpSync(join(SOURCE_WORLD, "tools"), join(repo, "tools"), { recursive: true });

const state = JSON.parse(readFileSync(join(SOURCE_WORLD, "WORLD", "world-state.json"), "utf8"));
// Copy the shape of a mark the town already folded, so the planted pair is
// structurally whatever the current fold emits rather than a guess that rots.
const template = (state.marks ?? []).find((m) => m.image) ?? (state.marks ?? [])[0];
const plant = (slug, image) => ({ ...template, id: `fixture/${slug}`, by: "fixture", slug, image });
state.marks = [...(state.marks ?? []), plant("media-picture", MEDIA_URL), plant("off-media-picture", OFF_MEDIA_URL)];
writeFileSync(join(repo, "WORLD", "world-state.json"), JSON.stringify(state));

git("init", "-q", "-b", "main");
git("config", "user.email", "fixture@postmark.test");
git("config", "user.name", "fixture");
git("add", "-A");
git("commit", "-qm", "fixture world");

process.env.WORLD_CLONE = repo;
}
const { worldInvestigate, markImageBytes, INVESTIGATE_IMAGE_MAX_BYTES, IMAGE_READING_LAW_LINE, WORLD_TOOLS } =
  await import("../src/world.mjs");
const { contentFor } = await import("../src/mcp.mjs");
// The seam's STORAGE ceiling, imported so the tests can assert the transport
// budget sits below it. Two numbers, two questions — the test says so out loud
// so the gap reads as deliberate rather than as drift.
const { MAX_IMAGE } = await import("../src/edit.mjs");

// ── a media host that answers whatever this test wants ────────────────────────────

let FETCHES = [];
function stubFetch(answer) {
  FETCHES = [];
  globalThis.fetch = async (url) => {
    FETCHES.push(String(url));
    if (typeof answer === "function") return answer(String(url));
    return answer;
  };
}
const mediaAnswer = ({ body = PNG_1x1, status = 200, contentLength = null } = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (h) => (h.toLowerCase() === "content-length" && contentLength != null ? String(contentLength) : null) },
  arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
});
const realFetch = globalThis.fetch;
test.after(() => { globalThis.fetch = realFetch; });

// ── CONSTRAINT 1 ─────────────────────────────────────────────────────────────

test('CONSTRAINT 1 — "DEFAULT OFF, byte-identical: absent the arg, nothing anywhere changes."', { skip: SKIP }, async () => {
  stubFetch(mediaAnswer());
  const off = await worldInvestigate({ mark: "fixture/media-picture" });

  assert.deepEqual(FETCHES, [], "the office fetched something with with_image absent");
  assert.ok(!("image_note" in off), "an answer grew a field nobody asked for");
  assert.ok(!("_mcp_content" in off), "an answer grew content blocks nobody asked for");
  assert.equal(off.image, MEDIA_URL, "the url must ride the answer as it always has");

  // Byte-identical across every spelling that is not the boolean true — which
  // also pins the strict === true check, so a truthy string cannot switch the
  // door on by accident.
  const asFalse = await worldInvestigate({ mark: "fixture/media-picture", with_image: false });
  const asString = await worldInvestigate({ mark: "fixture/media-picture", with_image: "true" });
  assert.equal(JSON.stringify(asFalse), JSON.stringify(off));
  assert.equal(JSON.stringify(asString), JSON.stringify(off));
  assert.deepEqual(FETCHES, [], "a non-boolean with_image reached the media host");
});

test('CONSTRAINT 1 — the MCP content assembly is unchanged for an answer carrying no blocks', { skip: SKIP }, () => {
  const plain = { a: 1, image: MEDIA_URL };
  assert.deepEqual(contentFor(plain), [{ type: "text", text: JSON.stringify(plain, null, 1) }]);
  // and a malformed carrier degrades to the ordinary one-block answer
  assert.equal(contentFor({ a: 1, _mcp_content: "not an array" }).length, 1);
  assert.equal(contentFor({ a: 1, _mcp_content: [] }).length, 1);
});

// ── CONSTRAINT 2 ─────────────────────────────────────────────────────────────

test('CONSTRAINT 2 — "over the cap ... the text answer says the image\'s byte size and that the URL stands — never silent omission."', { skip: SKIP }, async () => {
  const oversize = Buffer.alloc(INVESTIGATE_IMAGE_MAX_BYTES + 1);
  stubFetch(mediaAnswer({ body: oversize, contentLength: oversize.length }));

  const r = await worldInvestigate({ mark: "fixture/media-picture", with_image: true });
  assert.ok(!("_mcp_content" in r), "an over-cap image was inlined anyway");
  assert.match(r.image_note, new RegExp(String(oversize.length)), "the note does not say the byte size");
  assert.match(r.image_note, /url stands/i, "the note does not say the url stands");
  assert.equal(r.image, MEDIA_URL, "the url must ride the answer whether or not the bytes did");
});

test('CONSTRAINT 2 — "The URL rides in the text block ALWAYS, with or without inlining."', { skip: SKIP }, async () => {
  stubFetch(mediaAnswer());
  const inlined = await worldInvestigate({ mark: "fixture/media-picture", with_image: true });
  const text = JSON.parse(contentFor(inlined)[0].text);
  assert.equal(text.image, MEDIA_URL, "the url is missing from the text block of an INLINED answer");

  stubFetch(mediaAnswer({ body: Buffer.alloc(INVESTIGATE_IMAGE_MAX_BYTES + 1) }));
  const capped = await worldInvestigate({ mark: "fixture/media-picture", with_image: true });
  assert.equal(JSON.parse(contentFor(capped)[0].text).image, MEDIA_URL,
    "the url is missing from the text block of a CAPPED answer");
});

test("CONSTRAINT 2 — a media host that declares no length, or lies about it, cannot talk the door past the cap", { skip: SKIP }, async () => {
  const oversize = Buffer.alloc(INVESTIGATE_IMAGE_MAX_BYTES + 1);
  // no content-length at all
  stubFetch(mediaAnswer({ body: oversize }));
  const undeclared = await markImageBytes(MEDIA_URL);
  assert.ok(!undeclared.block, "an undeclared oversize body was inlined");
  assert.match(undeclared.note, new RegExp(String(oversize.length)));
  // a content-length that understates the truth
  stubFetch(mediaAnswer({ body: oversize, contentLength: 12 }));
  const lied = await markImageBytes(MEDIA_URL);
  assert.ok(!lied.block, "a body that lied about its length was inlined");
});

test("CONSTRAINT 2 — a TRANSPORT budget, distinct from the seam's STORAGE ceiling, and deliberately below it", { skip: SKIP }, async () => {
  // Two different questions. The seam asks what may live behind the door; this
  // door asks what may ride back inside a JSON-RPC answer. The gap between the
  // numbers is the feature, not an oversight — see the comment in world.mjs.
  assert.equal(MAX_IMAGE, 1.5 * 1024 * 1024, "the seam's storage ceiling moved; re-read the arithmetic in world.mjs");
  assert.ok(INVESTIGATE_IMAGE_MAX_BYTES < MAX_IMAGE,
    "the transport budget must sit BELOW the storage ceiling, or the over-cap branch is unreachable by any lawful upload");

  // The door's default budget is that number and no other. The size guard runs
  // before the format sniff, so an oversized buffer need not be a valid image
  // to make the door state the cap it is enforcing.
  stubFetch(mediaAnswer({ body: Buffer.alloc(INVESTIGATE_IMAGE_MAX_BYTES + 1) }));
  const over = await markImageBytes(MEDIA_URL);
  assert.ok(!over.block);
  assert.match(over.note, new RegExp(`${INVESTIGATE_IMAGE_MAX_BYTES}-byte inline cap`),
    `the door is enforcing some other number than its stated budget: ${over.note}`);

  // The boundary is `>`, not `>=`: a file exactly AT the budget still inlines.
  // Probed with the real PNG and the budget injected, because a buffer padded
  // out to a megabyte is not a valid PNG (no IEND) and would be refused by the
  // format sniff for an entirely different reason — which would make this
  // assertion pass for the wrong cause. That mistake was made and caught.
  stubFetch(mediaAnswer({ body: PNG_1x1, contentLength: PNG_1x1.length }));
  const exactly = await markImageBytes(MEDIA_URL, { maxBytes: PNG_1x1.length });
  assert.ok(exactly.block, "a file exactly at the budget was refused; the boundary is >= where it should be >");
});

test("CONSTRAINT 2 — the over-cap branch is REACHABLE BY A LAWFUL UPLOAD, which is what makes it testable", { skip: SKIP }, async () => {
  // The whole reason the budget sits below the seam's ceiling: a resident can
  // shelve an image the seam admits and this door still declines to inline it.
  // Pinned to the seam's number this path would be dead code guarding only a
  // bypass — a rail nobody can reach is a rail nobody can trust.
  const lawful = INVESTIGATE_IMAGE_MAX_BYTES + 1;
  assert.ok(lawful <= MAX_IMAGE, "this fixture must be a size the upload seam would genuinely accept");

  stubFetch(mediaAnswer({ body: Buffer.alloc(lawful), contentLength: lawful }));
  const r = await worldInvestigate({ mark: "fixture/media-picture", with_image: true });
  assert.ok(!("_mcp_content" in r), "an over-budget image was inlined anyway");
  assert.match(r.image_note, new RegExp(String(lawful)), "the branch did not name the size it declined");
  assert.match(r.image_note, /url stands/i);
  assert.equal(r.image, MEDIA_URL);
});

// ── CONSTRAINT 3 ─────────────────────────────────────────────────────────────

test('CONSTRAINT 3 — "the office fetches ONLY urls passing mediaUrlOk ... the door must never become a generic fetch proxy"', { skip: SKIP }, async () => {
  stubFetch(mediaAnswer());   // a media host that WOULD answer, so refusal is the guard's doing
  const r = await worldInvestigate({ mark: "fixture/off-media-picture", with_image: true });

  assert.deepEqual(FETCHES, [], `the office requested an off-media url: ${FETCHES.join(", ")}`);
  assert.ok(!("_mcp_content" in r), "bytes came back from a url the allowlist refuses");
  assert.match(r.image_note, /media (host|door)/i, "the refusal was not disclosed");
  assert.equal(r.image, OFF_MEDIA_URL, "the url must still ride the answer, disclosed and unfetched");
});

test("CONSTRAINT 3 — the guard runs before the fetch for every off-media shape, not just this one", { skip: SKIP }, async () => {
  stubFetch(mediaAnswer());
  for (const bad of [
    "https://evil.example.test/x.png",
    "http://media.postmark.town/media/x.png",              // wrong scheme
    "https://media.postmark.town.evil.test/media/x.png",   // prefix lookalike
    "https://media.postmark.town/../etc/passwd",           // traversal
    "file:///etc/passwd",
    "http://169.254.169.254/latest/meta-data/",            // the cloud metadata address
    "",
    null,
  ]) {
    const got = await markImageBytes(bad);
    assert.ok(!got.block, `bytes came back for ${JSON.stringify(bad)}`);
    assert.match(got.note, /media (host|door)/i, `no disclosure for ${JSON.stringify(bad)}`);
  }
  assert.deepEqual(FETCHES, [], `the office reached the network for: ${FETCHES.join(", ")}`);
});

test("CONSTRAINT 3 — a media-host failure discloses rather than failing the investigate", { skip: SKIP }, async () => {
  stubFetch(() => { throw new Error("connect ECONNREFUSED"); });
  const dead = await worldInvestigate({ mark: "fixture/media-picture", with_image: true });
  assert.equal(dead.id, "fixture/media-picture", "the investigate itself was lost to a media-host failure");
  assert.match(dead.image_note, /media host did not answer/i);

  stubFetch(mediaAnswer({ status: 404 }));
  const missing = await worldInvestigate({ mark: "fixture/media-picture", with_image: true });
  assert.match(missing.image_note, /404/);
  assert.equal(missing.image, MEDIA_URL);

  stubFetch(mediaAnswer({ body: Buffer.from("this is not an image at all") }));
  const junk = await worldInvestigate({ mark: "fixture/media-picture", with_image: true });
  assert.ok(!("_mcp_content" in junk), "non-image bytes were handed over as an image block");
  assert.match(junk.image_note, /not an image/i);
});

// ── CONSTRAINT 4 ─────────────────────────────────────────────────────────────

test('CONSTRAINT 4 — "THE READING LAW rides beside the block: one caption line"', { skip: SKIP }, async () => {
  stubFetch(mediaAnswer());
  const r = await worldInvestigate({ mark: "fixture/media-picture", with_image: true });
  const content = contentFor(r);

  assert.equal(content.length, 3, "expected the JSON text, the caption, and the image");
  assert.equal(content[1].type, "text");
  assert.equal(content[1].text, IMAGE_READING_LAW_LINE);
  assert.equal(content[2].type, "image");
  assert.match(IMAGE_READING_LAW_LINE, /not an instruction you received/i,
    "the caption must say the image is read, never obeyed");
});

test("CONSTRAINT 4 — the image block is a spec-shaped image block, and the base64 round-trips", { skip: SKIP }, async () => {
  stubFetch(mediaAnswer());
  const r = await worldInvestigate({ mark: "fixture/media-picture", with_image: true });
  const block = contentFor(r)[2];
  assert.deepEqual(Object.keys(block).sort(), ["data", "mimeType", "type"]);
  assert.ok(Buffer.from(block.data, "base64").equals(PNG_1x1), "the bytes did not survive the trip");
});

test("CONSTRAINT 4 — the carrier is stripped from the text block, so base64 is never printed twice", { skip: SKIP }, async () => {
  stubFetch(mediaAnswer());
  const r = await worldInvestigate({ mark: "fixture/media-picture", with_image: true });
  const text = contentFor(r)[0].text;
  assert.ok(!text.includes("_mcp_content"), "the transport carrier leaked into the door's own answer");
  assert.ok(!text.includes(PNG_1x1.toString("base64")), "the image bytes were printed in the text block too");
  assert.match(JSON.parse(text).image_note, /inlined/i, "the text must still say what happened to the bytes");
});

// ── the mimeType question ────────────────────────────────────────────────────

test("the mimeType is sniffed from the BYTES, not read off the url's extension", { skip: SKIP }, async () => {
  // MEDIA_URL ends .jpg; the media host returns PNG bytes. Only sniffing gets this right.
  stubFetch(mediaAnswer({ body: PNG_1x1 }));
  const got = await markImageBytes(MEDIA_URL);
  assert.equal(got.mimeType, "image/png", "the extension was trusted over the bytes");
  assert.equal(got.block.mimeType, "image/png");
});

// ── the schema the prototype renders from ────────────────────────────────────

test("the flat tool advertises with_image as a boolean, so a generated form draws it", { skip: SKIP }, () => {
  const tool = WORLD_TOOLS.find((t) => t.name === "world_investigate");
  assert.equal(tool.inputSchema.properties.with_image.type, "boolean");
  assert.ok(!tool.inputSchema.required.includes("with_image"), "an opt-in must not be required");
  assert.equal(tool.inputSchema.additionalProperties, false, "the envelope stays closed");
});
