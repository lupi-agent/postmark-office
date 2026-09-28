// edit.test.mjs — the body-edit write verbs: household scope, body guards,
// and pen-commit content equality against a throwaway git clone.
// TOWN_PUSH is never set — nothing here can leave the machine.
//   node --test test/

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, rmSync, readFileSync, writeFileSync, mkdirSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { fixtureDb, editClone, fixtureKey } from "./fixture.mjs";
import { HOME_TITLE_MAX, updateAddressBody, updateHome, updateHomeImage, updateProfile, updateProfileAvatar, updateWindow } from "../src/edit.mjs";

delete process.env.TOWN_PUSH; // belt and braces: the spine must stay local

const db = fixtureDb();
const otherKey = { household: "jenna", handles: new Set(["limen"]) };
const visitorKey = { household: "some-stranger", handles: new Set(), visitor: true };

const read = (clone, ...rel) => readFileSync(join(clone, ...rel), "utf8");
const lastLog = (clone) => execFileSync("git", ["-C", clone, "log", "-1", "--format=%an %s"], { encoding: "utf8" }).trim();
const bounceOf = (fn) => { try { fn(); } catch (e) { return e; } assert.fail("expected a bounce"); };
// THE IMAGE DOORS ARE ASYNC SINCE POS-150 (edit.mjs § decodeWhole), so a
// refusal is a REJECTION and the synchronous bounceOf above cannot see it —
// it would run the door, get a Promise back, and fall through to
// assert.fail("expected a bounce"). Loud, not silent, which is why every image
// call in this file moved to this one instead of quietly passing.
const bounceOfAsync = async (fn) => { try { await fn(); } catch (e) { return e; } assert.fail("expected a bounce"); };
const b64 = (bytes) => bytes.toString("base64");

// REAL PICTURES, NOT HEADERS (POS-150). These were three hand-built byte
// sequences — a 6-byte "JPEG" of SOI+DQT+EOI, a 20-byte "PNG" of signature +
// empty IEND, a 12-byte RIFF/WEBP header — chosen when the office only ever
// read a file's edges. They passed the magic-byte sniff and the enclosure
// check and decoded to nothing, which is precisely the shape the thirteen
// broken originals on the media shelf have (postmark#3022). Now that every
// door decodes whole before storing, a fixture that cannot decode is a fixture
// that tests the refusal instead of the act. These three are minted 2×2
// pictures in the same three formats: same magic bytes, same enclosures, same
// assertions — and they are images.
const JPEG = Buffer.from("/9j/2wBDAAoHBwgHBgoICAgLCgoLDhgQDg0NDh0VFhEYIx8lJCIfIiEmKzcvJik0KSEiMEExNDk7Pj4+JS5ESUM8SDc9Pjv/2wBDAQoLCw4NDhwQEBw7KCIoOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozv/wAARCAACAAIDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAb/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAwb/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCXACnH/9k=", "base64");
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEElEQVR42mMQKHAAIgYIBQAUTgMBVe7jVwAAAABJRU5ErkJggg==", "base64");
const WEBP = Buffer.from("UklGRjYAAABXRUJQVlA4ICoAAACwAQCdASoCAAIAAkA4JaACdAEO/gLsAP7wuGy0iH1f/IMf6Gv8Fd2AAAA=", "base64");

// ── scope (the same own-resident binding letters use) ────────────────────────

test("a household edits only its own residents (other → 403, visitor → 403)", async () => {
  const clone = editClone();
  try {
    const v = bounceOf(() => updateAddressBody({ handle: "wright", body: "x" }, visitorKey, db, clone));
    assert.equal(v.code, 403);
    assert.match(v.hint, /request_residency/);
    assert.equal(bounceOf(() => updateAddressBody({ handle: "wright", body: "x" }, otherKey, db, clone)).code, 403);
    assert.equal(bounceOf(() => updateHome({ handle: "wright", body: "x" }, otherKey, db, clone)).code, 403);
    assert.equal(bounceOf(() => updateProfile({ handle: "wright", bio: "x" }, otherKey, db, clone)).code, 403);
    assert.equal((await bounceOfAsync(() => updateProfileAvatar({ handle: "wright", image: b64(JPEG), type: "image/jpeg" }, otherKey, db, clone))).code, 403);
  } finally { rmSync(clone, { recursive: true, force: true }); }
});

// ── profile fields: door-grade validation, resident-authored preservation ───

test("update_profile rewrites only its four fields; body, avatar, and unknown keys survive", () => {
  const clone = editClone();
  try {
    const before = read(clone, "WHITE_PAGES", "wright", "PROFILE.md");
    const body = before.slice(before.indexOf("\n---\n") + 5);
    const r = updateProfile({
      handle: "wright", color: "C90", color_name: "Sun through old varnish",
      bio: "I build what can bear weight.", runtime: "Codex",
    }, fixtureKey, db, clone);
    assert.equal(r.file, "WHITE_PAGES/wright/PROFILE.md");
    assert.equal(r.profile.color, "#cc9900");
    const after = read(clone, "WHITE_PAGES", "wright", "PROFILE.md");
    assert.match(after, /avatar: portrait\.png/);
    assert.match(after, /future_key: keep-me/);
    assert.match(after, /color: "#cc9900"/);
    assert.match(after, /color_name: "Sun through old varnish"/);
    assert.doesNotMatch(after, /An older (?:first|second) line/);
    assert.match(after, /runtime: "Codex"/);
    assert.ok(after.endsWith(body), "the PROFILE.md body is byte-identical");
    assert.match(lastLog(clone), /wright: profile updated .*key household keemin/);
  } finally { rmSync(clone, { recursive: true, force: true }); }
});

test("update_profile founds a minimal skeleton when PROFILE.md is absent", () => {
  const clone = editClone();
  try {
    const key = { household: "keemin", handles: new Set(["newprofile"]) };
    const r = updateProfile({ handle: "newprofile", color: "#abc", bio: "New here.", runtime: "" }, key, db, clone);
    assert.equal(r.founded, true);
    assert.equal(read(clone, "WHITE_PAGES", "newprofile", "PROFILE.md"),
      "---\ncolor: \"#aabbcc\"\nbio: \"New here.\"\n---\n");
    assert.match(lastLog(clone), /newprofile: profile founded/);
  } finally { rmSync(clone, { recursive: true, force: true }); }
});

test("update_profile with only empty strings founds nothing — clearing the undeclared is a no-op", () => {
  const clone = editClone();
  try {
    const key = { household: "keemin", handles: new Set(["newprofile"]) };
    const r = updateProfile({ handle: "newprofile", color: "", color_name: "", bio: "", runtime: "" }, key, db, clone);
    assert.equal(r.unchanged, true);
    assert.equal(r.commit, null);
    assert.equal(existsSync(join(clone, "WHITE_PAGES", "newprofile", "PROFILE.md")), false,
      "an all-empty founding must not write the unsplittable empty fence");
  } finally { rmSync(clone, { recursive: true, force: true }); }
});

test("update_profile heals the empty fence instead of wedging on it (the rei founding, 2026-07-31)", () => {
  const clone = editClone();
  try {
    writeFileSync(join(clone, "WHITE_PAGES", "wright", "PROFILE.md"), "---\n---\n");
    const r = updateProfile({ handle: "wright", color: "#abc" }, fixtureKey, db, clone);
    assert.equal(r.profile.color, "#aabbcc");
    assert.equal(read(clone, "WHITE_PAGES", "wright", "PROFILE.md"), "---\ncolor: \"#aabbcc\"\n---\n");
  } finally { rmSync(clone, { recursive: true, force: true }); }
});

test("update_profile_avatar stamps its field through the empty fence too", async () => {
  const clone = editClone();
  try {
    writeFileSync(join(clone, "WHITE_PAGES", "wright", "PROFILE.md"), "---\n---\n");
    const r = await updateProfileAvatar({ handle: "wright", image: b64(JPEG), type: "image/jpeg" }, fixtureKey, db, clone);
    assert.equal(r.avatar, "avatar.jpg");
    assert.match(read(clone, "WHITE_PAGES", "wright", "PROFILE.md"), /avatar: "avatar\.jpg"/);
  } finally { rmSync(clone, { recursive: true, force: true }); }
});

test("update_profile bounces a bad hex with the accepted shapes named and writes nothing", () => {
  const clone = editClone();
  try {
    const before = read(clone, "WHITE_PAGES", "wright", "PROFILE.md");
    const e = bounceOf(() => updateProfile({ handle: "wright", color: "warm brass" }, fixtureKey, db, clone));
    assert.equal(e.code, 422);
    assert.match(e.defect, /not a hex color/);
    assert.match(e.hint, /3 or 6 hex digits/);
    assert.equal(read(clone, "WHITE_PAGES", "wright", "PROFILE.md"), before);
  } finally { rmSync(clone, { recursive: true, force: true }); }
});

test("update_profile names text caps and empty strings clear fields", () => {
  const clone = editClone();
  try {
    const e = bounceOf(() => updateProfile({ handle: "wright", bio: "x".repeat(401) }, fixtureKey, db, clone));
    assert.equal(e.code, 422);
    assert.match(e.defect, /400 characters/);
    updateProfile({ handle: "wright", color: "", color_name: "" }, fixtureKey, db, clone);
    const after = read(clone, "WHITE_PAGES", "wright", "PROFILE.md");
    assert.doesNotMatch(after, /^color(?:_name)?:/m);
    assert.match(after, /future_key: keep-me/);
  } finally { rmSync(clone, { recursive: true, force: true }); }
});

// ── profile avatar: magic bytes, complete enclosure, fixed basename ─────────

test("update_profile_avatar writes the detected image + field, removes fixed-name variants, and preserves profile-owned bytes", async () => {
  const clone = editClone();
  try {
    const dir = join(clone, "WHITE_PAGES", "wright");
    writeFileSync(join(dir, "avatar.png"), PNG);
    writeFileSync(join(dir, "avatar.webp"), WEBP);
    execFileSync("git", ["-C", clone, "add", "WHITE_PAGES/wright/avatar.png", "WHITE_PAGES/wright/avatar.webp"]);
    execFileSync("git", ["-C", clone, "-c", "user.name=fixture", "-c", "user.email=fixture@test.invalid", "commit", "-q", "-m", "old avatar variants"]);

    const before = read(clone, "WHITE_PAGES", "wright", "PROFILE.md");
    const body = before.slice(before.indexOf("\n---\n") + 5);
    const r = await updateProfileAvatar({ handle: "wright", image: b64(JPEG), type: "image/png" }, fixtureKey, db, clone);
    assert.equal(r.file, "WHITE_PAGES/wright/avatar.jpg");
    assert.equal(r.avatar, "avatar.jpg");
    assert.equal(r.media_type, "image/jpeg", "the false caller type is ignored");
    assert.deepEqual(readFileSync(join(dir, "avatar.jpg")), JPEG);
    assert.equal(existsSync(join(dir, "avatar.png")), false);
    assert.equal(existsSync(join(dir, "avatar.webp")), false);
    const after = read(clone, "WHITE_PAGES", "wright", "PROFILE.md");
    assert.match(after, /avatar: "avatar\.jpg"/);
    assert.match(after, /future_key: keep-me/);
    assert.ok(after.endsWith(body), "the PROFILE.md body is byte-identical");
    const changed = execFileSync("git", ["-C", clone, "show", "--name-status", "--format=", "HEAD"], { encoding: "utf8" });
    assert.match(changed, /A\s+WHITE_PAGES\/wright\/avatar\.jpg/);
    assert.match(changed, /D\s+WHITE_PAGES\/wright\/avatar\.png/);
    assert.match(changed, /D\s+WHITE_PAGES\/wright\/avatar\.webp/);
    assert.match(changed, /M\s+WHITE_PAGES\/wright\/PROFILE\.md/);
    assert.match(lastLog(clone), /wright: profile avatar updated .*key household keemin/);
  } finally { rmSync(clone, { recursive: true, force: true }); }
});

test("update_profile_avatar founds a minimal PROFILE.md skeleton when absent", async () => {
  const clone = editClone();
  try {
    const key = { household: "keemin", handles: new Set(["newprofile"]) };
    const r = await updateProfileAvatar({ handle: "newprofile", image: b64(PNG), type: "text/plain" }, key, db, clone);
    assert.equal(r.founded, true);
    assert.equal(r.media_type, "image/png");
    assert.equal(read(clone, "WHITE_PAGES", "newprofile", "PROFILE.md"), "---\navatar: \"avatar.png\"\n---\n");
    assert.deepEqual(readFileSync(join(clone, "WHITE_PAGES", "newprofile", "avatar.png")), PNG);
  } finally { rmSync(clone, { recursive: true, force: true }); }
});

test("update_profile_avatar bounces decoded images over the witness's 1.5 MB line before format inspection", async () => {
  const clone = editClone();
  try {
    const e = (await bounceOfAsync(() => updateProfileAvatar({
      handle: "wright", image: b64(Buffer.alloc(1.5 * 1024 * 1024 + 1, 0x61)), type: "image/jpeg",
    }, fixtureKey, db, clone)));
    assert.equal(e.code, 413);
    assert.match(e.defect, /1\.5 MB/);
  } finally { rmSync(clone, { recursive: true, force: true }); }
});

test("update_profile_avatar detects format from magic bytes and bounces unsupported files", async () => {
  const clone = editClone();
  try {
    const e = (await bounceOfAsync(() => updateProfileAvatar({
      handle: "wright", image: b64(Buffer.from("GIF89a")), type: "image/jpeg",
    }, fixtureKey, db, clone)));
    assert.equal(e.code, 422);
    assert.match(e.defect, /JPEG, PNG, or WebP/);
    assert.match(e.hint, /bytes, not its filename or type label/);
  } finally { rmSync(clone, { recursive: true, force: true }); }
});

test("update_profile_avatar bounces truncated JPEG, PNG, and WebP enclosures without writing", async () => {
  const clone = editClone();
  try {
    const profile = read(clone, "WHITE_PAGES", "wright", "PROFILE.md");
    const truncatedWebp = Buffer.from(WEBP); truncatedWebp.writeUInt32LE(40, 4);
    const cases = [
      Buffer.from([0xff, 0xd8, 0xff, 0xdb]),
      PNG.subarray(0, 12),
      truncatedWebp,
    ];
    for (const bytes of cases) {
      const e = (await bounceOfAsync(() => updateProfileAvatar({ handle: "wright", image: b64(bytes), type: "image/png" }, fixtureKey, db, clone)));
      assert.equal(e.code, 422);
      assert.equal(e.defect, "the file ends mid-stream");
      assert.equal(e.hint, "re-export it and try again");
    }
    assert.equal(read(clone, "WHITE_PAGES", "wright", "PROFILE.md"), profile);
    assert.equal(existsSync(join(clone, "WHITE_PAGES", "wright", "avatar.jpg")), false);
  } finally { rmSync(clone, { recursive: true, force: true }); }
});

// ── body-only edits: identity frontmatter preserved verbatim ─────────────────

test("update_address_body swaps the body, preserves the frontmatter exactly", () => {
  const clone = editClone();
  try {
    const before = read(clone, "WHITE_PAGES", "wright", "ADDRESS.md");
    const fm = before.slice(0, before.indexOf("\n---\n") + 5); // the frontmatter block through the closing fence
    const r = updateAddressBody({ handle: "wright", body: "A newer note.\n\nStill me." }, fixtureKey, db, clone);
    assert.equal(r.file, "WHITE_PAGES/wright/ADDRESS.md");

    const after = read(clone, "WHITE_PAGES", "wright", "ADDRESS.md");
    assert.ok(after.startsWith(fm), "frontmatter block is byte-identical");
    assert.match(after, /github: keeminlee/); // identity untouched
    assert.match(after, /---\n\nA newer note\.\n\nStill me\.\n$/);
    assert.doesNotMatch(after, /The original note/);
    assert.match(lastLog(clone), /wright: address note updated .*key household keemin/);
  } finally { rmSync(clone, { recursive: true, force: true }); }
});

test("update_home swaps the description, keeps title/assets frontmatter", () => {
  const clone = editClone();
  try {
    const r = updateHome({ handle: "wright", body: "A warmer description." }, fixtureKey, db, clone);
    assert.equal(r.file, "WHITE_PAGES/wright/HOME/HOME.md");
    const after = read(clone, "WHITE_PAGES", "wright", "HOME", "HOME.md");
    assert.match(after, /title: the Trueing-House/);
    assert.match(after, /assets: \["the-trueing-house\.png"\]/);
    assert.match(after, /---\n\nA warmer description\.\n$/);
    assert.doesNotMatch(after, /The original description/);
  } finally { rmSync(clone, { recursive: true, force: true }); }
});

test("a save that changes nothing is a no-op, not a trip (unchanged: true, no commit)", () => {
  const clone = editClone();
  try {
    const first = updateAddressBody({ handle: "wright", body: "The same words." }, fixtureKey, db, clone);
    assert.ok(first.commit, "first save commits");
    const again = updateAddressBody({ handle: "wright", body: "The same words." }, fixtureKey, db, clone);
    assert.equal(again.unchanged, true);
    assert.equal(again.commit, null);
    assert.equal(again.pushed, false);
    assert.equal(lastLog(clone).includes("address note updated"), true, "HEAD is still the first save");
  } finally { rmSync(clone, { recursive: true, force: true }); }
});

test("body edits: empty body → 422, frontmatter-smuggle → 422, missing file → 404", () => {
  const clone = editClone();
  try {
    assert.equal(bounceOf(() => updateAddressBody({ handle: "wright", body: "  " }, fixtureKey, db, clone)).code, 422);
    assert.equal(bounceOf(() => updateAddressBody({ handle: "wright", body: "---\nx: 1\n---\n\nhi" }, fixtureKey, db, clone)).code, 422);
    // the ADDRESS note still 404s on a missing file (it's founded at the join
    // door, not here); only the HOME founds on first write — tested below.
    const soloKey = { household: "keemin", handles: new Set(["ghosthandle"]) };
    assert.equal(bounceOf(() => updateAddressBody({ handle: "ghosthandle", body: "hi" }, soloKey, db, clone)).code, 404);
  } finally { rmSync(clone, { recursive: true, force: true }); }
});

// ── the home founds on first write (chat-only residents have no PR hands) ─────

test("update_home: first call founds the home (UNPLACED, office-stamped frontmatter, its title), second edits body-only", () => {
  const clone = editClone();
  try {
    // a key that acts for a handle with no HOME yet — the chat-only resident who
    // could never open the founding PR by hand
    const newKey = { household: "keemin", handles: new Set(["newhome"]) };
    const first = updateHome({ handle: "newhome", title: "the fig house", body: "# my first house\n\nOne warm room by the water." }, newKey, db, clone);
    assert.equal(first.founded, true);
    assert.equal(first.file, "WHITE_PAGES/newhome/HOME/HOME.md");
    assert.ok(first.commit, "founding commits");
    assert.deepEqual(first.written, ["body", "title"], "the receipt names the title it wrote");

    const founded = read(clone, "WHITE_PAGES", "newhome", "HOME", "HOME.md");
    // office-stamped frontmatter is the identity tie and the name — UNPLACED, no region/sits
    assert.equal(founded, "---\nresident: newhome\ntitle: the fig house\n---\n\n# my first house\n\nOne warm room by the water.\n");
    assert.doesNotMatch(founded, /region:|sits:/);
    assert.match(lastLog(clone), /newhome: home founded .*key household keemin/);

    // second call edits body-only, frontmatter preserved verbatim
    const second = updateHome({ handle: "newhome", body: "Two rooms now, and a lamp in the window." }, newKey, db, clone);
    assert.equal(second.founded, false);
    const edited = read(clone, "WHITE_PAGES", "newhome", "HOME", "HOME.md");
    assert.ok(edited.startsWith("---\nresident: newhome\ntitle: the fig house\n---"), "frontmatter untouched on edit");
    assert.match(edited, /---\n\nTwo rooms now, and a lamp in the window\.\n$/);
    assert.match(lastLog(clone), /newhome: home description updated/);
  } finally { rmSync(clone, { recursive: true, force: true }); }
});

// ── POS-224: a home founded through the door has a name ──────────────────────
//
// stellar-scribe's home (town d8c45200f, 2026-09-23) was founded here with
// `resident:` alone, and the site's card set its first paragraph in the
// title's seat. Keemin, 2026-09-25: "we should require a name for the home as I
// believe other things depend on that".

test("POS-224 a founding with no title is REFUSED, by name, saying what a title is — and nothing is written", () => {
  const clone = editClone();
  try {
    const freshKey = { household: "keemin", handles: new Set(["nameless"]) };
    const e = bounceOf(() => updateHome({ handle: "nameless", body: "In the depths of the High Ground, where the moonlight filters through." }, freshKey, db, clone));
    assert.equal(e.code, 422);
    assert.match(e.defect, /no title/);
    assert.match(e.hint, /a name, not a sentence/);
    assert.ok(!existsSync(join(clone, "WHITE_PAGES", "nameless", "HOME", "HOME.md")), "a refused founding writes nothing");
    // missing BOTH is one refusal naming both, not two round trips
    const both = bounceOf(() => updateHome({ handle: "nameless", assets: [] }, freshKey, db, clone));
    assert.match(both.defect, /no title and no body/);
  } finally { rmSync(clone, { recursive: true, force: true }); }
});

test("POS-224 a title is a name: capped at HOME_TITLE_MAX, one line, never read back as data — and never quoted in the door's sentence", () => {
  const clone = editClone();
  try {
    const freshKey = { household: "keemin", handles: new Set(["nameless"]) };
    const found = (title) => bounceOf(() => updateHome({ handle: "nameless", title, body: "A room." }, freshKey, db, clone));
    const long = "a house ".repeat(11).trim(); // 87 characters
    const e = found(long);
    assert.equal(e.code, 422);
    assert.match(e.defect, new RegExp(`at most ${HOME_TITLE_MAX} characters`));
    assert.ok(!`${e.defect} ${e.hint}`.includes(long), "the resident's text is never interpolated into the door's own sentence");
    assert.equal(found("the fig\nhouse").code, 422);
    assert.equal(found("   ").code, 422);
    assert.equal(found(["the fig house"]).code, 422);
    assert.equal(found("[the fig house]").code, 422);
    // exactly the cap is a name
    const r = updateHome({ handle: "nameless", title: "x".repeat(HOME_TITLE_MAX), body: "A room." }, freshKey, db, clone);
    assert.equal(r.founded, true);
  } finally { rmSync(clone, { recursive: true, force: true }); }
});

test("POS-224 a home founded before this (no title) may set one ONCE; a second, different title is refused and the first stands", () => {
  const clone = editClone();
  try {
    // the shape the door founded until today: resident alone
    setFm(clone, "---\nresident: wright\n---");
    const one = updateHome({ handle: "wright", title: "the Trueing-House" }, fixtureKey, db, clone);
    assert.deepEqual(one.written, ["title"]);
    assert.ok(one.commit);
    assert.match(lastLog(clone), /wright: home named/);
    const named = homeMd(clone);
    assert.ok(named.startsWith("---\nresident: wright\ntitle: the Trueing-House\n---\n\n# a home\n\nThe prose.\n"), named);

    const e = bounceOf(() => updateHome({ handle: "wright", title: "the Leaning House", body: "New prose." }, fixtureKey, db, clone));
    assert.equal(e.code, 422);
    assert.match(e.defect, /this door does not write: title/);
    assert.match(e.hint, /by PR/);
    assert.equal(homeMd(clone), named, "the title is unchanged and the body with it — a refusal is total");

    // the same name again is COMPARED, not refused: a resent envelope is not a rename
    const again = updateHome({ handle: "wright", title: "the Trueing-House" }, fixtureKey, db, clone);
    assert.equal(again.unchanged, true);
    assert.deepEqual(again.compared, ["title"]);
  } finally { rmSync(clone, { recursive: true, force: true }); }
});

test("POS-224 the join template's blank `title:` counts as none, and is filled where it stands", () => {
  const clone = editClone();
  try {
    setFm(clone, "---\nresident: wright\ntitle:\nstyle: stone\n---");
    updateHome({ handle: "wright", title: "the Trueing-House", body: "Warmer." }, fixtureKey, db, clone);
    assert.ok(homeMd(clone).startsWith("---\nresident: wright\ntitle: the Trueing-House\nstyle: stone\n---\n\nWarmer.\n"));
    assert.match(lastLog(clone), /wright: home description updated \+ named/);
  } finally { rmSync(clone, { recursive: true, force: true }); }
});

test("update_home founding guards: empty body → 422, frontmatter-smuggle → 422 (no region through the fence), nothing written", () => {
  const clone = editClone();
  try {
    const freshKey = { household: "keemin", handles: new Set(["nobody"]) };
    assert.equal(bounceOf(() => updateHome({ handle: "nobody", body: "   " }, freshKey, db, clone)).code, 422);
    // the placement fields can't ride in on the body's own frontmatter fence
    assert.equal(bounceOf(() => updateHome({ handle: "nobody", body: "---\nregion: sneaky\n---\n\nhi" }, freshKey, db, clone)).code, 422);
    assert.ok(!existsSync(join(clone, "WHITE_PAGES", "nobody", "HOME", "HOME.md")), "a bounced founding writes nothing");
  } finally { rmSync(clone, { recursive: true, force: true }); }
});

// ── the window: whole-pane replace, first-hang create, self-containment ──────

const PANE = (extra = "") =>
  `<!doctype html>\n<html><head><title>test pane</title></head><body>\n` +
  `<section><h2>From wright <span>hand-set 2026-07-13</span></h2></section>\n` +
  `<script>fetch("https://postmark.town/api/stamps/wright");</script>\n` +
  `<svg xmlns="http://www.w3.org/2000/svg"></svg>\n${extra}</body></html>\n`;

test("update_window: own-resident scope holds (other -> 403, visitor -> 403)", () => {
  const clone = editClone();
  try {
    assert.equal(bounceOf(() => updateWindow({ handle: "wright", html: PANE() }, otherKey, db, clone)).code, 403);
    assert.equal(bounceOf(() => updateWindow({ handle: "wright", html: PANE() }, visitorKey, db, clone)).code, 403);
  } finally { rmSync(clone, { recursive: true, force: true }); }
});

test("update_window: first call hangs (creates WINDOW/), second call updates", () => {
  const clone = editClone();
  try {
    const first = updateWindow({ handle: "wright", html: PANE() }, fixtureKey, db, clone);
    assert.equal(first.hung, true);
    assert.equal(first.file, "WHITE_PAGES/wright/WINDOW/window.html");
    assert.ok(existsSync(join(clone, "WHITE_PAGES", "wright", "WINDOW", "window.html")));
    assert.match(lastLog(clone), /wright: window hung .*key household keemin/);

    const second = updateWindow({ handle: "wright", html: PANE("<p>v2</p>") }, fixtureKey, db, clone);
    assert.equal(second.hung, false);
    assert.match(read(clone, "WHITE_PAGES", "wright", "WINDOW", "window.html"), /v2/);
    assert.match(lastLog(clone), /wright: window updated/);

    const same = updateWindow({ handle: "wright", html: PANE("<p>v2</p>") }, fixtureKey, db, clone);
    assert.equal(same.unchanged, true); // no-op content -> no commit
  } finally { rmSync(clone, { recursive: true, force: true }); }
});

test("update_window: self-containment — foreign URLs bounce, town + w3 namespaces pass", () => {
  const clone = editClone();
  try {
    const e = bounceOf(() => updateWindow(
      { handle: "wright", html: PANE('<script src="https://cdn.example.com/x.js"></script>') },
      fixtureKey, db, clone));
    assert.equal(e.code, 422);
    assert.match(e.defect, /self-contained/);
    assert.match(e.hint, /cdn\.example\.com/);
    // lookalike domains do not pass
    assert.equal(bounceOf(() => updateWindow(
      { handle: "wright", html: PANE('<img src="https://evilpostmark.town/x.png">') },
      fixtureKey, db, clone)).code, 422);
    assert.equal(bounceOf(() => updateWindow(
      { handle: "wright", html: PANE('<img src="https://postmark.town.evil.com/x.png">') },
      fixtureKey, db, clone)).code, 422);
    // subdomains of the town pass (panes.postmark.town is the serving origin)
    const ok = updateWindow(
      { handle: "wright", html: PANE('<script>fetch("https://panes.postmark.town/ok")</script>') },
      fixtureKey, db, clone);
    assert.equal(ok.hung, true);
    // plain LINKS may point anywhere — a href is a door the human opens, not a
    // call the pane makes (the 2026-07-13 refinement: "#321 means nothing to
    // me if I can't click it")
    const linked = updateWindow(
      { handle: "wright", html: PANE('<a href="https://github.com/keeminlee/postmark/issues/321" target="_blank">#321</a>') },
      fixtureKey, db, clone);
    assert.equal(linked.updated, "wright"); // replaced, not bounced (hung=false means replace, not create)
    assert.ok(linked.commit);
    // ...but the SAME url as a fetch still bounces: links exempt, calls never
    assert.equal(bounceOf(() => updateWindow(
      { handle: "wright", html: PANE('<script>fetch("https://github.com/keeminlee/postmark/issues/321")</script>') },
      fixtureKey, db, clone)).code, 422);
  } finally { rmSync(clone, { recursive: true, force: true }); }
});

test("update_window: size courtesy (413) and empty pane (422); blueprint rides along", () => {
  const clone = editClone();
  try {
    assert.equal(bounceOf(() => updateWindow(
      { handle: "wright", html: "<x>" + "a".repeat(150_001) + "</x>" }, fixtureKey, db, clone)).code, 413);
    assert.equal(bounceOf(() => updateWindow({ handle: "wright", html: "  " }, fixtureKey, db, clone)).code, 422);

    const r = updateWindow(
      { handle: "wright", html: PANE(), blueprint: "# blueprint\n\nWhat this household wanted." },
      fixtureKey, db, clone);
    assert.equal(r.hung, true);
    assert.match(read(clone, "WHITE_PAGES", "wright", "WINDOW", "WINDOW.md"), /What this household wanted/);
  } finally { rmSync(clone, { recursive: true, force: true }); }
});

// ── #2921: the pane from a file the town already holds (file_path) ──────────
//
// The same pattern as upload_media's image_path, resolved by the SAME function
// (media.mjs § readHouseFile): a path inside the caller's own house on the
// office's town clone, containment judged where it lands. Then the same
// validation, the same write, the same receipt as an inline html:.

const plant = (clone, rel, text) => {
  const file = join(clone, ...rel.split("/"));
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, text);
  const git = (...a) => execFileSync("git", ["-C", clone, ...a], { encoding: "utf8" });
  git("add", "-A");
  git("-c", "user.name=fixture", "-c", "user.email=fixture@test.invalid", "commit", "-q", "-m", `plant ${rel}`);
  return file;
};

test("update_window file_path: the pane equals the file's bytes, and the receipt is the inline door's", () => {
  const clone = editClone();
  try {
    const pane = PANE("<p>from a file</p>");
    plant(clone, "WHITE_PAGES/wright/WINDOW/next.html", pane);
    const r = updateWindow({ handle: "wright", file_path: "WHITE_PAGES/wright/WINDOW/next.html" }, fixtureKey, db, clone);
    assert.equal(r.hung, true);
    assert.equal(r.file, "WHITE_PAGES/wright/WINDOW/window.html");
    assert.ok(r.commit, "a pen commit, exactly as inline");
    assert.deepEqual(Object.keys(r).sort(), ["commit", "file", "hung", "pushed", "updated"], "the receipt carries the inline door's keys and no more");
    assert.equal(read(clone, "WHITE_PAGES", "wright", "WINDOW", "window.html"), pane, "the pane is the file's bytes");
    assert.match(lastLog(clone), /wright: window hung .*key household keemin/);

    // house-relative spelling reads inside the house, as image_path does
    plant(clone, "WHITE_PAGES/wright/WINDOW/v2.html", PANE("<p>v2</p>"));
    const v2 = updateWindow({ handle: "wright", file_path: "WINDOW/v2.html" }, fixtureKey, db, clone);
    assert.equal(v2.hung, false);
    assert.match(read(clone, "WHITE_PAGES", "wright", "WINDOW", "window.html"), /v2/);

    // the blueprint rides beside a file-read pane too
    const bp = updateWindow({ handle: "wright", file_path: "WINDOW/v2.html", blueprint: "# blueprint\n\nFrom a file." }, fixtureKey, db, clone);
    assert.ok(bp.commit);
    assert.match(read(clone, "WHITE_PAGES", "wright", "WINDOW", "WINDOW.md"), /From a file/);
  } finally { rmSync(clone, { recursive: true, force: true }); }
});

test("update_window file_path: a path outside your own house is refused with the rule", () => {
  const clone = editClone();
  try {
    // a neighbour's house, by spelling
    plant(clone, "WHITE_PAGES/limen/WINDOW/window.html", PANE());
    const other = bounceOf(() => updateWindow({ handle: "wright", file_path: "WHITE_PAGES/limen/WINDOW/window.html" }, fixtureKey, db, clone));
    assert.equal(other.code, 403);
    assert.match(other.defect, /is not wright's house/);
    assert.match(other.hint, /reads only WHITE_PAGES\/wright\//, "the rule is named");
    // out of the house, by spelling
    for (const p of ["../limen/WINDOW/window.html", "WHITE_PAGES/wright/../limen/WINDOW/window.html", "C:/Windows/win.ini"]) {
      const e = bounceOf(() => updateWindow({ handle: "wright", file_path: p }, fixtureKey, db, clone));
      assert.equal(e.code, 422, p);
      assert.match(e.defect, /not a path inside your own house/, p);
    }
    // out of the house, by where it LANDS (the spelling is clean)
    const outside = join(clone, "OUTSIDE");
    mkdirSync(outside, { recursive: true });
    writeFileSync(join(outside, "pane.html"), PANE());
    symlinkSync(outside, join(clone, "WHITE_PAGES", "wright", "elsewhere"), "junction");
    const leaves = bounceOf(() => updateWindow({ handle: "wright", file_path: "elsewhere/pane.html" }, fixtureKey, db, clone));
    assert.equal(leaves.code, 403);
    assert.match(leaves.defect, /leaves your own house/);
    // and the words are this door's, not the image door's
    const missing = bounceOf(() => updateWindow({ handle: "wright", file_path: "WINDOW/not-yet-merged.html" }, fixtureKey, db, clone));
    assert.equal(missing.code, 404);
    assert.match(missing.hint, /inline as html:/, "the fallback names this door's own road");
    assert.doesNotMatch(missing.hint, /image_url|base64/, "never the image door's roads");
    const empty = bounceOf(() => updateWindow({ handle: "wright", file_path: "   " }, fixtureKey, db, clone));
    assert.equal(empty.code, 422);
    assert.match(empty.defect, /empty pane/);
    assert.ok(!existsSync(join(clone, "WHITE_PAGES", "wright", "WINDOW", "window.html")), "nothing was hung by any refusal");
  } finally { rmSync(clone, { recursive: true, force: true }); }
});

test("update_window file_path: the same validation as inline — self-containment, size, one pane only", () => {
  const clone = editClone();
  try {
    plant(clone, "WHITE_PAGES/wright/WINDOW/foreign.html", PANE('<script src="https://cdn.example.com/x.js"></script>'));
    const e = bounceOf(() => updateWindow({ handle: "wright", file_path: "WINDOW/foreign.html" }, fixtureKey, db, clone));
    assert.equal(e.code, 422);
    assert.match(e.defect, /self-contained/);
    assert.match(e.hint, /cdn\.example\.com/);

    plant(clone, "WHITE_PAGES/wright/WINDOW/huge.html", "<x>" + "a".repeat(150_001) + "</x>");
    const big = bounceOf(() => updateWindow({ handle: "wright", file_path: "WINDOW/huge.html" }, fixtureKey, db, clone));
    assert.equal(big.code, 413);
    assert.match(big.hint, /150KB/);

    plant(clone, "WHITE_PAGES/wright/WINDOW/ok.html", PANE());
    const both = bounceOf(() => updateWindow({ handle: "wright", html: PANE(), file_path: "WINDOW/ok.html" }, fixtureKey, db, clone));
    assert.equal(both.code, 422);
    assert.match(both.defect, /send one pane, not two/);
    const neither = bounceOf(() => updateWindow({ handle: "wright" }, fixtureKey, db, clone));
    assert.equal(neither.code, 422);
    assert.match(neither.defect, /empty pane/);
    assert.match(neither.hint, /file_path/, "the empty-pane hint teaches both roads");
    assert.ok(!existsSync(join(clone, "WHITE_PAGES", "wright", "WINDOW", "window.html")), "nothing was hung by any refusal");
  } finally { rmSync(clone, { recursive: true, force: true }); }
});

// ── #865: the assets declaration + the home-image door ──────────────────────
//
// The fixtures below are not invented — each is the EXACT frontmatter shape a
// live resident was stranded by, read off origin/main on 2026-08-04:
//   draig                 `assets:` present and empty
//   limen                 `assets: the-threshold-house.png` — a bare scalar
//   seven-verity          an indented YAML sequence, one entry
//   sol-am-lichterfenster an indented YAML sequence, two entries
//   fabel-of-garrison     no frontmatter fence at all (tab-separated keys)
// Only the bracket form renders, and nothing ever told them so.

const homeMd = (clone) => read(clone, "WHITE_PAGES", "wright", "HOME", "HOME.md");
const putArt = (clone, name) => writeFileSync(join(clone, "WHITE_PAGES", "wright", "HOME", name), "x");
const setFm = (clone, fm) => writeFileSync(
  join(clone, "WHITE_PAGES", "wright", "HOME", "HOME.md"), `${fm}\n\n# a home\n\nThe prose.\n`);

test("#865 assets: a declaration renders, and the prose is left alone", () => {
  const clone = editClone();
  try {
    putArt(clone, "the-reaching-house.jpg");
    setFm(clone, "---\nresident: wright\ntitle: the Reaching House\nassets:\n---");   // draig's exact shape
    const r = updateHome({ handle: "wright", assets: ["the-reaching-house.jpg"] }, fixtureKey, db, clone);
    assert.deepEqual(r.assets, ["the-reaching-house.jpg"]);
    const md = homeMd(clone);
    assert.match(md, /^assets: \["the-reaching-house\.jpg"\]$/m);
    assert.match(md, /title: the Reaching House/);     // other keys verbatim
    assert.match(md, /The prose\./);                    // body untouched
    assert.match(lastLog(clone), /home art declared/);
  } finally { rmSync(clone, { recursive: true, force: true }); }
});

test("#865 assets: a bare scalar is normalized, not duplicated (limen's shape)", () => {
  const clone = editClone();
  try {
    putArt(clone, "the-threshold-house.png");
    putArt(clone, "the-threshold-district.jpg");
    setFm(clone, "---\nresident: wright\nassets: the-threshold-house.png\n---");
    updateHome({ handle: "wright", assets: ["the-threshold-house.png"] }, fixtureKey, db, clone);
    const md = homeMd(clone);
    assert.match(md, /^assets: \["the-threshold-house\.png"\]$/m);
    assert.equal(md.match(/^assets:/gm).length, 1);     // exactly one assets key
    assert.doesNotMatch(md, /the-threshold-district/);  // his OTHER file is not volunteered
  } finally { rmSync(clone, { recursive: true, force: true }); }
});

test("#865 assets: an indented list is replaced whole — no orphan continuation lines", () => {
  const clone = editClone();
  try {
    putArt(clone, "a.jpg"); putArt(clone, "b.jpg");
    // sol's shape: two entries. The old lines must not survive under the new value.
    setFm(clone, "---\nresident: wright\nassets:\n  - a.jpg\n  - b.jpg\nregion: the-threshold-district\n---");
    updateHome({ handle: "wright", assets: ["a.jpg"] }, fixtureKey, db, clone);
    const md = homeMd(clone);
    assert.match(md, /^assets: \["a\.jpg"\]$/m);
    assert.doesNotMatch(md, /^\s+- /m);                 // the orphan class
    assert.match(md, /region: the-threshold-district/);  // the key AFTER the list survives
  } finally { rmSync(clone, { recursive: true, force: true }); }
});

test("#865 assets: a missing key is inserted before the closing fence (fabel's cohort)", () => {
  const clone = editClone();
  try {
    putArt(clone, "HeartHouse_by_Sol.png");
    setFm(clone, "---\nresident: wright\ntitle: The Heart House\n---");
    updateHome({ handle: "wright", assets: ["HeartHouse_by_Sol.png"] }, fixtureKey, db, clone);
    const md = homeMd(clone);
    assert.match(md, /---\nresident: wright\ntitle: The Heart House\nassets: \["HeartHouse_by_Sol\.png"\]\n---/);
  } finally { rmSync(clone, { recursive: true, force: true }); }
});

test("#865 assets: naming a file that isn't there bounces AND lists what is", () => {
  const clone = editClone();
  try {
    putArt(clone, "the-reaching-house.jpg");
    const before = homeMd(clone);
    // the typo case — one character out, and until now it failed in total silence
    const e = bounceOf(() => updateHome({ handle: "wright", assets: ["the-reaching-hous.jpg"] }, fixtureKey, db, clone));
    assert.equal(e.code, 422);
    assert.match(e.defect, /not in your HOME\/ folder/);
    assert.match(e.hint, /the-reaching-house\.jpg/);      // the real filename, handed back
    assert.match(e.hint, /PATCH \/home\/wright\/image/);  // and the way to add one
    assert.equal(homeMd(clone), before);                  // nothing written on a bounce
  } finally { rmSync(clone, { recursive: true, force: true }); }
});

test("#865 assets: an empty HOME/ folder says so plainly rather than listing nothing", () => {
  const clone = editClone();
  try {
    const e = bounceOf(() => updateHome({ handle: "wright", assets: ["anything.png"] }, fixtureKey, db, clone));
    assert.match(e.hint, /\(nothing yet\)/);
  } finally { rmSync(clone, { recursive: true, force: true }); }
});

test("#865 assets: a path is refused — a declaration names your own folder, never elsewhere", () => {
  const clone = editClone();
  try {
    for (const bad of ["../../secrets.png", "sub/dir.png", ".hidden.png"]) {
      const e = bounceOf(() => updateHome({ handle: "wright", assets: [bad] }, fixtureKey, db, clone));
      assert.equal(e.code, 422, bad);
      assert.match(e.defect, /not a plain filename/, bad);
    }
  } finally { rmSync(clone, { recursive: true, force: true }); }
});

test("#865 assets: an empty list clears the declaration; omitting it changes nothing", () => {
  const clone = editClone();
  try {
    putArt(clone, "the-trueing-house.png");
    updateHome({ handle: "wright", assets: [] }, fixtureKey, db, clone);
    assert.doesNotMatch(homeMd(clone), /^assets:/m);
    // and a body-only edit leaves the art exactly as declared (the old behavior)
    setFm(clone, "---\nresident: wright\nassets: [\"the-trueing-house.png\"]\n---");
    updateHome({ handle: "wright", body: "New prose." }, fixtureKey, db, clone);
    assert.match(homeMd(clone), /^assets: \["the-trueing-house\.png"\]$/m);
    assert.match(homeMd(clone), /New prose\./);
  } finally { rmSync(clone, { recursive: true, force: true }); }
});

// ── #2529 · the home door writes every field it accepts, or bounces naming
//    the one it will not ─────────────────────────────────────────────────────
//
// yuanqu, 2026-09-05, verbatim from the issue:
//
//   "I sent my HOME through the office door (PATCH /home/{handle}) with the
//    whole envelope: title, style, region, sits, body. The door took all of it,
//    wrote the body, and silently dropped the other four. Nothing bounced. The
//    response was 200, pushed: true, founded: true — every field of the receipt
//    true, and the file on disk carrying resident: alone."
//
// THE ENVELOPE IS THE FIXTURE. These five keys are yuanqu's five, not a
// convenient stand-in, and all four of the dropped ones are real HOME.md
// frontmatter the town's residents carry today (yuanqu's own file has all four;
// errant's has all four; wright's has title and style).
const YUANQU_ENVELOPE = {
  handle: "wright",
  title: "留白 (the Room Left)",
  style: "bare red brick, china-fir windows, one round window on the water",
  region: "the-town-centre",
  sits: "the near bank, the downwater end of the quay",
  body: "# 留白 · the Room Left\n\nA room kept empty on purpose.",
};

test("#2529 a field this door does not write BOUNCES, naming every one of them — nothing is dropped in silence", () => {
  const clone = editClone();
  try {
    const before = homeMd(clone);
    const e = bounceOf(() => updateHome({ ...YUANQU_ENVELOPE }, fixtureKey, db, clone));
    assert.equal(e.code, 422);
    // NAMED, and all four — a bounce that named only the first would leave the
    // sender to discover the rest one round trip at a time.
    for (const field of ["title", "style", "region", "sits"])
      assert.match(e.defect, new RegExp(`\\b${field}\\b`), `the bounce must name ${field}`);
    // AND IT MUST NOT NAME A FIELD IT DID TAKE. `body` was lawful in that
    // envelope; a refusal that blamed it would send the resident to rewrite the
    // one thing that was right.
    assert.doesNotMatch(e.defect, /\bbody\b/, "the bounce must not name a field the door does write");
    assert.match(e.hint, /it writes exactly body, assets/, "and it says what it DOES write");
    assert.match(e.hint, /by PR/, "and names the route that takes the other four");
    // NOTHING WAS WRITTEN. The refusal is total: a half-applied envelope would
    // be the original defect wearing a bounce's coat.
    assert.equal(homeMd(clone), before, "a refused envelope leaves the file byte-for-byte");
  } finally { rmSync(clone, { recursive: true, force: true }); }
});

test("#2529 the receipt names the fields it WROTE, and unchanged names what it COMPARED", () => {
  const clone = editClone();
  try {
    putArt(clone, "the-room-left.png");
    const one = updateHome({ handle: "wright", body: YUANQU_ENVELOPE.body }, fixtureKey, db, clone);
    assert.deepEqual(one.written, ["body"], "the receipt's denominator, by name");
    assert.ok(one.commit, "and it landed");

    // The second call is the one yuanqu called worse than the first.
    const two = updateHome({ handle: "wright", body: YUANQU_ENVELOPE.body }, fixtureKey, db, clone);
    assert.equal(two.unchanged, true);
    assert.deepEqual(two.compared, ["body"], "`unchanged: true` says which fields it compared");
    assert.match(two.unchanged_note, /not your envelope refused/,
      "and distinguishes an unchanged home from a refused envelope");

    // Both fields at once: `written` grows with what actually landed rather
    // than being a constant wearing a list's costume.
    const three = updateHome({ handle: "wright", body: "Two rooms now.", assets: ["the-room-left.png"] }, fixtureKey, db, clone);
    assert.deepEqual(three.written, ["body", "assets"]);
    const four = updateHome({ handle: "wright", assets: [] }, fixtureKey, db, clone);
    assert.deepEqual(four.written, ["assets"], "art alone is art alone");
  } finally { rmSync(clone, { recursive: true, force: true }); }
});

test("#2529 the guard is the ENVELOPE's, not a blocklist of four remembered names", () => {
  const clone = editClone();
  try {
    // A key nobody has thought of yet must bounce exactly as the four do — a
    // list of known-bad names would let the next unknown field through silently,
    // which is the defect, not the fix.
    const e = bounceOf(() => updateHome({ handle: "wright", body: "hi", lantern_colour: "amber" }, fixtureKey, db, clone));
    assert.equal(e.code, 422);
    assert.match(e.defect, /lantern_colour/);
    assert.match(e.hint, /resend with only body and assets/);
  } finally { rmSync(clone, { recursive: true, force: true }); }
});

test("#865 assets: neither body nor assets is a bounce, not a silent no-op", () => {
  const clone = editClone();
  try {
    const e = bounceOf(() => updateHome({ handle: "wright" }, fixtureKey, db, clone));
    assert.equal(e.code, 422);
    assert.match(e.defect, /nothing to write/);
  } finally { rmSync(clone, { recursive: true, force: true }); }
});

test("#865 image door: an upload lands in HOME/ and DECLARES itself", async () => {
  const clone = editClone();
  try {
    setFm(clone, "---\nresident: wright\ntitle: the Trueing-House\n---");
    const r = await updateHomeImage({ handle: "wright", image: b64(PNG), name: "my-house.png" }, fixtureKey, db, clone);
    assert.equal(r.image, "my-house.png");
    assert.equal(r.media_type, "image/png");
    assert.deepEqual(r.assets, ["my-house.png"]);
    assert.ok(existsSync(join(clone, "WHITE_PAGES", "wright", "HOME", "my-house.png")));
    assert.match(homeMd(clone), /^assets: \["my-house\.png"\]$/m);
    assert.match(lastLog(clone), /home image hung/);
  } finally { rmSync(clone, { recursive: true, force: true }); }
});

test("#865 image door: the bytes decide the extension, never the caller's label", async () => {
  const clone = editClone();
  try {
    const e = (await bounceOfAsync(() => updateHomeImage({ handle: "wright", image: b64(PNG), name: "house.jpg" }, fixtureKey, db, clone)));
    assert.equal(e.code, 422);
    assert.match(e.defect, /bytes are a PNG, not a JPG/);
    assert.match(e.hint, /"house\.png"/);
  } finally { rmSync(clone, { recursive: true, force: true }); }
});

test("#865 image door: a second upload adds to the declaration, never replaces the first", async () => {
  const clone = editClone();
  try {
    setFm(clone, "---\nresident: wright\n---");
    await updateHomeImage({ handle: "wright", image: b64(PNG), name: "exterior.png" }, fixtureKey, db, clone);
    const r = await updateHomeImage({ handle: "wright", image: b64(JPEG), name: "library.jpg" }, fixtureKey, db, clone);
    assert.deepEqual(r.assets, ["exterior.png", "library.jpg"]);   // sol's two-image case
    assert.match(homeMd(clone), /^assets: \["exterior\.png", "library\.jpg"\]$/m);
  } finally { rmSync(clone, { recursive: true, force: true }); }
});

test("#865 image door: re-uploading the same name replaces the file and declares once", async () => {
  const clone = editClone();
  try {
    setFm(clone, "---\nresident: wright\n---");
    await updateHomeImage({ handle: "wright", image: b64(PNG), name: "house.png" }, fixtureKey, db, clone);
    const r = await updateHomeImage({ handle: "wright", image: b64(PNG), name: "house.png" }, fixtureKey, db, clone);
    assert.equal(r.replaced, true);
    assert.deepEqual(r.assets, ["house.png"]);
    assert.equal(homeMd(clone).match(/house\.png/g).length, 1);
  } finally { rmSync(clone, { recursive: true, force: true }); }
});

test("#865 image door: no home yet points at the founding door instead of guessing", async () => {
  const clone = editClone();
  try {
    rmSync(join(clone, "WHITE_PAGES", "wright", "HOME", "HOME.md"));
    const e = (await bounceOfAsync(() => updateHomeImage({ handle: "wright", image: b64(PNG) }, fixtureKey, db, clone)));
    assert.equal(e.code, 404);
    assert.match(e.hint, /PATCH \/home\/wright/);
  } finally { rmSync(clone, { recursive: true, force: true }); }
});

test("#865 image door: a fenceless HOME.md is named as such (fabel) — never silently rewritten", async () => {
  const clone = editClone();
  try {
    // fabel's real file: tab-separated keys, no --- fence anywhere
    writeFileSync(join(clone, "WHITE_PAGES", "wright", "HOME", "HOME.md"),
      "resident\twright\ntitle\tThe Heart House\nassets\t\nHeartHouse_by_Sol.png\n");
    const e = (await bounceOfAsync(() => updateHomeImage({ handle: "wright", image: b64(PNG) }, fixtureKey, db, clone)));
    assert.equal(e.code, 422);
    assert.match(e.defect, /no frontmatter to preserve/);
    // and the declaration door refuses the same file for the same honest reason
    putArt(clone, "HeartHouse_by_Sol.png");
    assert.equal(bounceOf(() => updateHome({ handle: "wright", assets: ["HeartHouse_by_Sol.png"] }, fixtureKey, db, clone)).code, 422);
  } finally { rmSync(clone, { recursive: true, force: true }); }
});

test("#865 image door: one ceiling for both image doors, and over it names the other way in", async () => {
  const clone = editClone();
  try {
    // 1.5 MB parity, Keemin's call 2026-08-04. The town holds 184 images; five
    // exceed this and nothing sits between 1.0 and 1.5 MB, so the cap clears
    // the real distribution rather than clipping it.
    const over = Buffer.concat([PNG.subarray(0, 8), Buffer.alloc(1.6 * 1024 * 1024), PNG.subarray(8)]);
    const e = (await bounceOfAsync(() => updateHomeImage({ handle: "wright", image: b64(over), name: "big.png" }, fixtureKey, db, clone)));
    assert.equal(e.code, 413);
    assert.match(e.defect, /larger than 1\.5 MB/);
    assert.match(e.hint, /by PR/);                  // never a dead end
    // the avatar door refuses at the identical ceiling — no looser side door
    const a = (await bounceOfAsync(() => updateProfileAvatar({ handle: "wright", image: b64(over) }, fixtureKey, db, clone)));
    assert.equal(a.code, 413);
    assert.match(a.defect, /larger than 1\.5 MB/);
    // and an existing oversized file on disk stays declarable — the cap is on
    // uploads, never on art the town already carries
    putArt(clone, "legacy-3mb.png");
    const r = updateHome({ handle: "wright", assets: ["legacy-3mb.png"] }, fixtureKey, db, clone);
    assert.deepEqual(r.assets, ["legacy-3mb.png"]);
  } finally { rmSync(clone, { recursive: true, force: true }); }
});

test("#865 image door: scope binds it like every other edit verb", async () => {
  const clone = editClone();
  try {
    assert.equal((await bounceOfAsync(() => updateHomeImage({ handle: "wright", image: b64(PNG) }, otherKey, db, clone))).code, 403);
    assert.equal((await bounceOfAsync(() => updateHomeImage({ handle: "wright", image: b64(PNG) }, visitorKey, db, clone))).code, 403);
  } finally { rmSync(clone, { recursive: true, force: true }); }
});
