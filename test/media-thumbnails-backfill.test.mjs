// media-thumbnails-backfill.test.mjs — the one-time cut of small copies for
// originals that predate them (postmark#2940). Unit layer over the injectable
// core: the dry run lists every original lacking a copy and WHICH; apply mints
// exactly those (the lacking sizes of the lacking originals, nothing for a
// complete one, nothing for an svg); an original the host does not hold and
// one libvips cannot read are named, never fatal; the keys are the door's.
//
//   node --test test/media-thumbnails-backfill.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import sharp from "sharp";

process.env.R2_ACCOUNT_ID = "test-account";
process.env.R2_ACCESS_KEY_ID = "test-key";
process.env.R2_SECRET_ACCESS_KEY = "test-secret";

const { THUMB_SIZES, THUMB_FORMATS, thumbObjectKey, thumbUrlFor, mediaUrlFor, mintThumbnails, MEDIA_BASE, ensureMediaTable }
  = await import("../src/media.mjs");
const { backfillThumbnails, originalsFromRecord, originalsFromLedger } = await import("../tools/media-thumbnails-backfill.mjs");

const SHA = (n) => String(n).repeat(64).slice(0, 64);
const original = (household, n, ext) => ({
  household, sha: SHA(n), ext,
  url: mediaUrlFor(household, SHA(n), ext),
  urlFor: (size) => thumbUrlFor(household, SHA(n), ext, size),
});
const picture = () => sharp({ create: { width: 640, height: 400, channels: 3, background: "#336699" } }).jpeg().toBuffer();

// the host as a table: url → status (HEAD) and url → bytes (GET)
function host(objects) {
  const heads = [], gets = [];
  return {
    heads, gets,
    head: async (url) => { heads.push(url); return url in objects ? 200 : 404; },
    get: async (url) => { gets.push(url); return url in objects ? { status: 200, bytes: objects[url] } : { status: 404, bytes: null }; },
  };
}
const stubPut = () => { const calls = []; return { calls, put: async (...a) => { calls.push(a); } }; };

test("the dry run lists every original lacking a copy, and which — and touches nothing", async () => {
  const pic = await picture();
  const A = original("alfa", "a", "jpg");     // lacks both
  const B = original("bravo", "b", "png");    // has -96, lacks -256
  const C = original("charlie", "c", "webp"); // complete
  const D = original("delta", "d", "svg");    // none by design
  const h = host({
    [A.url]: pic, [B.url]: pic, [B.urlFor(96)]: pic, [C.url]: pic, [C.urlFor(96)]: pic, [C.urlFor(256)]: pic, [D.url]: Buffer.from("<svg/>"),
  });
  const { calls, put } = stubPut();
  const r = await backfillThumbnails({
    originals: [A, B, C, D, A /* listed twice: counted once */], head: h.head, get: h.get, put, mint: mintThumbnails,
    apply: false, sizes: THUMB_SIZES, keyFor: thumbObjectKey, formats: THUMB_FORMATS,
  });
  assert.deepEqual(r.lacking.map((o) => [o.id, o.lacks]), [
    [`alfa/${SHA("a")}.jpg`, [96, 256]],
    [`bravo/${SHA("b")}.png`, [256]],
  ]);
  assert.deepEqual(r.complete.map((o) => o.id), [`charlie/${SHA("c")}.webp`]);
  assert.deepEqual(r.svg.map((o) => o.id), [`delta/${SHA("d")}.svg`]);
  assert.equal(calls.length, 0, "a dry run puts nothing");
  assert.equal(h.gets.length, 0, "a dry run fetches no original");
  assert.equal(h.heads.length, 6, "two HEADs per raster original, none for the svg, none for the duplicate");
});

test("apply mints EXACTLY the lacking sizes of the lacking originals, at the door's keys, and never the original", async () => {
  const pic = await picture();
  const A = original("alfa", "a", "jpg");
  const B = original("bravo", "b", "png");
  const C = original("charlie", "c", "webp");
  const h = host({ [A.url]: pic, [B.url]: pic, [B.urlFor(96)]: pic, [C.url]: pic, [C.urlFor(96)]: pic, [C.urlFor(256)]: pic });
  const { calls, put } = stubPut();
  const r = await backfillThumbnails({
    originals: [A, B, C], head: h.head, get: h.get, put, mint: mintThumbnails,
    apply: true, sizes: THUMB_SIZES, keyFor: thumbObjectKey, formats: THUMB_FORMATS,
  });
  assert.deepEqual(calls.map((c) => c[0]), [
    `media/alfa/${SHA("a")}-96.jpg`, `media/alfa/${SHA("a")}-256.jpg`, `media/bravo/${SHA("b")}-256.png`,
  ], "three copies: A's two, B's missing one; nothing for C");
  assert.deepEqual(calls.map((c) => c[2]), ["image/jpeg", "image/jpeg", "image/png"]);
  const m96 = await sharp(calls[0][1]).metadata(), m256 = await sharp(calls[2][1]).metadata();
  assert.deepEqual([m96.width, m96.height], [96, 96]);
  assert.deepEqual([m256.width, m256.height, m256.format], [256, 286, "png"]);
  assert.deepEqual(r.minted.map((o) => [o.id, o.sizes]), [[`alfa/${SHA("a")}.jpg`, [96, 256]], [`bravo/${SHA("b")}.png`, [256]]]);
  assert.deepEqual(h.gets, [A.url, B.url], "the originals were read from the host, once each, and C's not at all");
  assert.ok(calls.every((c) => !/[0-9a-f]{64}\.[a-z]+$/.test(c[0])), "no PUT ever names an original");
});

test("an original the host does not hold, and one libvips cannot read, are NAMED and skipped — the run goes on", async () => {
  const pic = await picture();
  const gone = original("echo", "e", "jpg");
  const corrupt = original("foxtrot", "f", "jpg");
  const fine = original("golf", "g", "jpg");
  const h = host({ [corrupt.url]: Buffer.concat([pic.subarray(0, 300), Buffer.alloc(300, 0), pic.subarray(-2)]), [fine.url]: pic });
  const { calls, put } = stubPut();
  const r = await backfillThumbnails({
    originals: [gone, corrupt, fine], head: h.head, get: h.get, put, mint: mintThumbnails,
    apply: true, sizes: THUMB_SIZES, keyFor: thumbObjectKey, formats: THUMB_FORMATS,
  });
  assert.deepEqual(r.missing.map((o) => o.id), [`echo/${SHA("e")}.jpg`]);
  assert.deepEqual(r.unprocessable.map((o) => o.id), [`foxtrot/${SHA("f")}.jpg`]);
  assert.match(r.unprocessable[0].why, /jpeg|vips/i);
  assert.deepEqual(r.minted.map((o) => o.id), [`golf/${SHA("g")}.jpg`]);
  assert.equal(calls.length, 2, "golf's two copies, and nothing for the other two");
});

test("a host that answers neither 200 nor 404 to a HEAD is unknown, listed, and not minted", async () => {
  const pic = await picture();
  const A = original("alfa", "a", "jpg");
  const { calls, put } = stubPut();
  const r = await backfillThumbnails({
    originals: [A], head: async () => 503, get: async () => ({ status: 200, bytes: pic }), put, mint: mintThumbnails,
    apply: true, sizes: THUMB_SIZES, keyFor: thumbObjectKey, formats: THUMB_FORMATS,
  });
  assert.deepEqual(r.unknown.map((o) => [o.id, o.unsure.map((u) => u.status)]), [[`alfa/${SHA("a")}.jpg`, [503, 503]]]);
  assert.equal(r.lacking.length, 0);
  assert.equal(calls.length, 0);
});

test("--limit bounds the apply to the first N lacking, and a failed PUT is a named failure, not a crash", async () => {
  const pic = await picture();
  const A = original("alfa", "a", "jpg"), B = original("bravo", "b", "jpg"), C = original("charlie", "c", "jpg");
  const h = host({ [A.url]: pic, [B.url]: pic, [C.url]: pic });
  const calls = [];
  const put = async (k, ...rest) => { calls.push([k, ...rest]); if (k.startsWith("media/bravo/") && /-256\./.test(k)) throw new Error("storage answered 502"); };
  const r = await backfillThumbnails({
    originals: [A, B, C], head: h.head, get: h.get, put, mint: mintThumbnails,
    apply: true, sizes: THUMB_SIZES, limit: 2, keyFor: thumbObjectKey, formats: THUMB_FORMATS,
  });
  assert.deepEqual(r.lacking.map((o) => o.household), ["alfa", "bravo", "charlie"], "the listing is the whole set");
  assert.deepEqual(r.minted.map((o) => o.household), ["alfa"]);
  assert.deepEqual(r.failed.map((o) => [o.household, o.written]), [["bravo", [96]]], "what was written before the failure is on the receipt");
  assert.equal(calls.filter((c) => c[0].startsWith("media/charlie/")).length, 0, "the third never came up");
});

test("the record enumeration reads the door's grammar only; the ledger enumeration reads every row", async () => {
  const rec = { marks: [
    { id: "a/one", image: `${MEDIA_BASE}/media/AionSolare/${SHA(1)}.jpg` },
    { id: "a/two", image: `${MEDIA_BASE}/m/d849fa0eb84fc1399cb1.jpg` },          // an older grammar, not the door's
    { id: "a/three", image: "https://evil.example/media/x/" + SHA(3) + ".png" }, // not the host
    { id: "a/four" },
    { id: "a/five", image: `${MEDIA_BASE}/media/Ra-Valentine/${SHA(5)}.svg` },
  ] };
  const rows = originalsFromRecord(rec, { base: MEDIA_BASE, thumbUrlFor });
  assert.deepEqual(rows.map((r) => [r.household, r.ext, r.from]), [["AionSolare", "jpg", "a/one"], ["Ra-Valentine", "svg", "a/five"]]);
  assert.equal(rows[0].urlFor(96), `${MEDIA_BASE}/media/AionSolare/${SHA(1)}-96.jpg`);

  const odb = new DatabaseSync(":memory:");
  ensureMediaTable(odb);
  odb.prepare("INSERT INTO media (household, sha, ext, bytes, by_handle, created) VALUES (?, ?, ?, ?, ?, ?)").run("h", SHA(7), "webp", 10, "x", 2);
  odb.prepare("INSERT INTO media (household, sha, ext, bytes, by_handle, created) VALUES (?, ?, ?, ?, ?, ?)").run("h", SHA(6), "png", 10, "x", 1);
  const led = await originalsFromLedger(odb, { mediaUrlFor, thumbUrlFor });
  assert.deepEqual(led.map((r) => [r.sha[0], r.ext]), [["6", "png"], ["7", "webp"]], "oldest first");
  assert.equal(led[0].url, mediaUrlFor("h", SHA(6), "png"));
});
