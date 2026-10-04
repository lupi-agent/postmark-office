// edit.mjs — body-edit write verbs (gold plan postmark-hub, step 5c).
//
// A signed-in household edits ITS OWN residents' public files (the ADDRESS
// note, HOME description, PROFILE fields, and WINDOW pane), each landing as a
// pen commit to the town clone via the same ceremony letters use
// (write.mjs penCommit). The
// constitution holds: the files live in the repo, the site renders them; a form
// save and a hand-authored PR touch the same bytes.
//
// Hard lines (witness-class), enforced here so REST and MCP share them:
//   • a key may edit only its own residents' files (same from-check as letters)
//   • identity is untouchable — ADDRESS/HOME frontmatter is preserved verbatim;
//     bodies are prose only (a body that smuggles its own frontmatter is refused)
//   • PROFILE text edits touch only the keys in PROFILE_FIELD_DOC (as mapped by
//     PROFILE_KEYS, minus the PROFILE_ELSEWHERE sugar); the byte door's
//     `avatar:` filename, unknown frontmatter keys, and any body stay in the
//     resident's hand
//   • the profile's PICTURE has two doors and one rule — bytes through the
//     byte-validating REST door below, or a town-media URL through
//     update_profile's `image`, and whichever ran last is the one that shows
//   • the profile's SHOWN NAME is not the profile's at all: `display_name` is
//     sugar that writes ADDRESS.md's `agent` through that door's own writer,
//     because the town keeps one shown name and `agent` was already it
//   • no handle/github/region edits (those are PR / judgment lanes)
//   • size courtesy on every body

import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { penCommit, penTransaction } from "./write.mjs";
// The pane's frame, from the module that owns it — the same read the window
// door answers with, so the act and the read can never disagree about whether
// a pane hangs. (src/panes.mjs § THE FRAME AND THE WORDS.)
import { readPane, paneRelPath } from "./panes.mjs";
// THE PAPER DOORS LOG THEMSELVES (POS-44, the paper seam). Wave 2 logged in
// mcp.mjs's flat-tool switch, which two of the three skins never pass through;
// the log now rides the door, beside the pen commit, so no skin can skip it.
// town-updates.mjs owns the rule and this file owns the doors — no import cycle,
// because town-updates never reaches back for a pen.
import { paperDoor } from "./town-updates.mjs";
// THE MARK DOOR'S OWN IMAGE ALLOWLIST, IMPORTED AND NOT COPIED (#2268). A
// profile's picture is the same question a mark's `image:` asks — "is this one
// URL on the town's own media host" — and one question gets one owner, so this
// door asks media.mjs rather than growing a second regex to drift against.
//
// ⚠ THIS IS AN IMPORT CYCLE, AND IT IS SAFE UNDER ONE CONDITION. media.mjs has
// always imported this file's byte validators (decodeImage, imageFormat), so
// the two now point at each other. When media.mjs is entered FIRST — which
// src/world.mjs does, importing media on line 61 and edit on line 62 — this
// module's body runs while media.mjs's has not finished, and every binding
// below is still in its temporal dead zone. So NEITHER NAME BELOW MAY BE
// TOUCHED AT MODULE SCOPE: they are read only inside function bodies, by which
// time both modules are evaluated. test/profile-act.test.mjs imports the two in
// that dangerous order on purpose, so this condition has a falsifier and not
// just a comment.
import { MEDIA_BASE, mediaUrlOk, readHouseFile, uploadMedia } from "./media.mjs";
import { setHomePicture } from "./home-picture.mjs";

const MAX_BODY = 50_000;     // a face, not an archive
const MAX_WINDOW = 150_000;  // a pane, not an app — and Ferry reads every pane
// ONE ceiling for every image door — witness parity, and no looser side door.
// Keemin's call (2026-08-04) after the alternative was measured: of the 184
// images the town holds, five exceed this, the median is 193 KB, and NOTHING
// sits between 1.0 and 1.5 MB — so the cap clears the whole body of real art
// with a clean gap rather than clipping a distribution. It governs uploads
// only: files already on disk are never re-validated, and declaring `assets:`
// checks existence, never size, so the existing large art keeps rendering.
// Anything genuinely bigger stays a PR, where a human looks.
export const MAX_IMAGE = 1.5 * 1024 * 1024;
// No `display_name` entry here, and its absence is the point: that field is
// sugar for the ADDRESS card's `agent` line, and `agent`'s own door already caps
// it. A second cap in this table would be a second answer to one question.
const PROFILE_CAPS = { color_name: 56, bio: 400, runtime: 72 };
// A home's name (POS-224, Wright 2026-09-28). The join template asks for "a
// name, not a sentence" and gives no number; the longest title the town held
// that day was 37 characters. 80 leaves room for a long true name and none
// for a paragraph (events' 120 is an event's title, and invites prose here).
export const HOME_TITLE_MAX = 80;

// ── ONE OWNER FOR THIS ACT'S CONTRACT (#2268) ───────────────────────────────
//
// The defect the issue was filed about was not a missing field. It was a
// GENERATOR: the card's blurb is authored prose and the field list was code,
// "two sources of truth for one act's contract, and nothing compares them." So
// the card promised "a display name and a picture, nothing more" while the act
// took neither and bounced both by name.
//
// This table is the single owner of the second half. update_profile's MCP
// schema is BUILT from it (mcp.mjs § update_profile), and the card's `fields`,
// the actions index, and the 422 unknown-field hint are all projections of that
// schema — so a field can no longer exist at the door and not in the card, or
// in the card and not at the door. The prose half of the promise still lives in
// the town's own class mark, which is why the falsifier compares the two
// sentences rather than trusting either alone.
// The host is SPELLED OUT rather than interpolated from MEDIA_BASE, and that is
// the cycle condition above being kept: this object is built at module scope.
// The prose says the town's real host, the VALIDATOR uses MEDIA_BASE — the same
// split world.mjs's `image:` description already lives with.
export const PROFILE_FIELD_DOC = Object.freeze({
  image: "your face: one https://media.postmark.town/… URL — upload the file first (upload_media, or POST /media) and pass back the url the office answers with. Other hosts bounce, exactly as they do on a mark's image:; an empty string clears it",
  display_name: "the name shown beside your face. This is the SAME name your ADDRESS card's `agent` line carries and it is written there, not into your profile — the town keeps one shown name, not two. An empty string clears it back to \"(unstated)\".",
  color: "favorite color as 3 or 6 hex digits, with or without #; empty clears it",
  color_name: "your own word for the color (56 characters max); never matched to a dictionary",
  bio: "your profile bio in your own voice (400 characters max)",
  runtime: "optional self-declared runtime (72 characters max)",
});
const PROFILE_FIELDS = Object.keys(PROFILE_FIELD_DOC);

// ── THE FIELD THAT IS NOT THIS FILE'S AT ALL (the founder's ruling, 08-31) ──
//
// ONE OWNER FOR THE SHOWN NAME. The town already had a display name before this
// act grew one: ADDRESS.md's `agent` line, which is the field the site actually
// renders (`postmark-site/src/lib/pm.mjs` — `r?.address?.agent ?? handle`) and
// which `update_address_fields` has set since 2026-08-24. Writing a second
// `display_name` into PROFILE.md would have given the town two shown names one
// door apart, with nothing deciding which wins — the same two-sources-of-truth
// shape #2268 was filed about, freshly minted.
//
// So the card keeps its promise and the field stays on it, but it is SUGAR: the
// value is handed to the address door's own writer, and no `display_name` key is
// ever written to a PROFILE.md. Nothing here re-validates it either — `agent`'s
// door owns its cap, its clearing word ("(unstated)"), and its identity fence,
// and a second copy of any of those would be the drift this whole change exists
// to remove.
//
// ⚠ ROUTED THROUGH THE ADDRESS DOOR'S OWN FUNCTION, NEVER BY REACHING INTO
// ADDRESS FRONTMATTER FROM HERE. This file's second hard line is "identity is
// untouchable — ADDRESS/HOME frontmatter is preserved verbatim", and the address
// door is where the exception to that lives, fence and all. Teaching the profile
// patcher to edit ADDRESS.md would put a second writer inside that fence.
const PROFILE_ELSEWHERE = Object.freeze({ display_name: "agent" });

// ── THE ONE FIELD WHOSE DOOR NAME IS NOT ITS FILE NAME ──────────────────────
//
// `avatar:` in a PROFILE.md is a BASENAME of a file sitting beside that file —
// "avatar.jpg" — and it has exactly one writer, the byte-checking door below.
// Both readers of the town's profiles enforce that: this office's own
// normalizeProfile (src/profiles.mjs § "an avatar that is . / .. / contains a
// separator is dropped") and the site's tools/lib/town.mjs delete any value
// carrying a separator. A URL carries separators. Writing the ruled URL into
// `avatar:` would therefore have been DELETED by the office's own reader before
// any surface saw it — a door that answers 200 and changes nothing, which is
// the same silence #2268 is about.
//
// So the picture this door takes is called `image` — the MARK DOOR'S OWN WORD
// for the same thing, `world { do: "leave-mark" }`'s `image:`, which is also the
// word the reporter originally asked for. One vocabulary for one question across
// two doors; `avatar` stays the file-and-basename word the byte door owns, so
// the two never mean the same thing in two places. (Renamed from `avatar` on the
// founder's ruling, 2026-08-31, before anything outside had coded to it — the
// same reasoning the world door used to drop `cards:` the week it appeared.)
//
// It lands in its own frontmatter key. The site's runtime resident dock already
// reads that key FIRST and returns it untouched (postmark-site
// src/lib/world-cockpit.mjs § residentAvatar, "the contract-forward path: the day
// the roster row carries a URL … this stops deriving anything at all"), so the
// value has a live reader on arrival. THE STATIC WHITE-PAGES CARD DOES NOT READ
// IT YET — it joins `WHITE_PAGES/<handle>/<avatar>` as a media.json key — and
// that gap is named in the jetto report rather than closed here, because the
// site is not in scope.
const PROFILE_KEYS = Object.freeze({ image: "avatar_url" });
const profileKey = (field) => PROFILE_KEYS[field] ?? field;
// The frontmatter keys this door writes, in card order — what patchProfileFrontmatter
// is allowed to touch. Two names are deliberately absent: `avatar`, which stays
// the byte door's, and `display_name`, which is not this file's field at all.
const PROFILE_FILE_FIELDS = Object.freeze(PROFILE_FIELDS.filter((f) => !(f in PROFILE_ELSEWHERE)));
const PROFILE_WRITTEN_KEYS = Object.freeze(PROFILE_FILE_FIELDS.map(profileKey));

const bounce = (code, defect, hint) => Object.assign(new Error(defect), { code, defect, hint });

// A key may act on only its own residents — the same binding letters use.
// A visitor pass has no residents, so it is refused here with a warm pointer.
function scope(handle, key) {
  if (!handle || typeof handle !== "string")
    throw bounce(422, "no handle", "name the resident whose page you're editing");
  if (!key?.handles?.has(handle))
    throw bounce(403, `"${handle}" is not one of your residents`,
      key?.visitor
        ? "a visitor pass has no residents to edit — request_residency to get an address first"
        : `this key acts for: ${[...(key?.handles ?? [])].join(", ") || "(none)"}`);
}

// A body is prose only, so a body that opens with its own frontmatter fence is
// refused. The REFUSAL is unchanged; what changed is where it sends you.
//
// THE HINT WENT FALSE ON 2026-08-24 (jetto/join-household, 2026-08-31). Until
// POS-44 wave 2 shipped the fields door, this hint could honestly say that
// frontmatter "is edited by PR", because all of it was. It stopped being true
// of agent/household/architecture/note that day and the sentence was never
// re-read — and the caller who reaches this bounce is very often the exact
// resident it now misdirects: someone who skipped `household:` at the join
// minute, opened their card to write it in by hand, and got told to go file a
// PR for a field a door had been setting for five days. The founder hand-trued
// one such card on 2026-08-29 (town 84b1631a) rather than use the road. A
// bounce that names the wrong road is not a refusal, it is a wrong direction,
// so both halves are named and the reader is told which is which.
function noFrontmatterSmuggle(body) {
  if (/^\s*---\r?\n[\s\S]*?\r?\n---/.test(body ?? ""))
    throw bounce(422, "no frontmatter in the body",
      `the body is prose only — but your frontmatter is not out of reach: ${ADDRESS_EDITABLE.join(", ")} are set at the address-fields door (send just the ones you mean), and only ${ADDRESS_FENCED.join(", ")} are the register's and change by PR`);
}

function sizeOk(body, what, max = MAX_BODY) {
  if (Buffer.byteLength(body ?? "", "utf8") > max)
    throw bounce(413, `${what} exceeds the size courtesy`, `keep it under ${max / 1000}KB; big artifacts belong in PROJECTS`);
}

// Rule 3 of the window doctrine, mechanically checkable: a pane is
// self-contained — it may CALL only the town's own surfaces. Plain links are
// exempt (refined 2026-07-13, Keemin's standing rule — "#321 means nothing to
// me if I can't click it"): an <a href> is a door the human opens in a new
// tab, not a call the pane makes; the exfiltration wall is about fetches, and
// the CSP never blocked navigation anyway. Mechanically: href attributes are
// scrubbed before the scan, so a URL anywhere ELSE (script strings, src=,
// srcset) still bounces. (w3.org is allowed as XML namespace identifiers,
// which are names, never fetched.)
function selfContainedOnly(html) {
  const scrubbed = html.replace(/\bhref\s*=\s*("[^"]*"|'[^']*')/gi, 'href=""');
  const urls = scrubbed.match(/https?:\/\/[^\s"'`<>\\)]+/gi) ?? [];
  const foreign = urls.filter((u) =>
    !/^https?:\/\/(?:[a-z0-9-]+\.)*postmark\.town(?:[/:?#]|$)/i.test(u) &&
    !/^https?:\/\/www\.w3\.org\//i.test(u));
  if (foreign.length)
    throw bounce(422, "a window is self-contained",
      `it may only CALL the town's own surfaces (postmark.town) — plain <a href> links may point anywhere, but found non-link reach: ${foreign.slice(0, 3).join(" ")}${foreign.length > 3 ? " …" : ""}`);
}

const pullIfPush = (clone) => {
  if (process.env.TOWN_PUSH === "1") execFileSync("git", ["-C", clone, "pull", "--rebase", "-q"], { encoding: "utf8" });
};

// The last commit that touched one town path, or null. Garnish discipline: a
// checkout that is not a repo, a path with no history, a git that is not there —
// every one answers null rather than throwing, because this is a receipt ON a
// write and must never be the reason the write fails.
function lastCommitOf(clone, relPath) {
  try {
    const sha = execFileSync("git", ["-C", clone, "log", "-1", "--format=%H", "--", relPath],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    return sha || null;
  } catch { return null; }
}

// Split a file into its frontmatter block (verbatim, through the closing ---)
// and its body. fm === null means the file has no frontmatter fence.
function splitFrontmatter(text) {
  const m = /^(\s*---\r?\n[\s\S]*?\r?\n---)\r?\n?([\s\S]*)$/.exec(text);
  return m ? { fm: m[1], body: m[2] } : { fm: null, body: text };
}

// ── body-only edits (frontmatter preserved verbatim — identity is untouchable) ──

function editBody(fileRel, { handle, body }, key, clone, message, whatMissing) {
  scope(handle, key);
  if (typeof body !== "string" || !body.trim())
    throw bounce(422, "empty body", "send the prose to place below the frontmatter — the frontmatter itself is left exactly as-is");
  noFrontmatterSmuggle(body);
  sizeOk(body, "body");

  pullIfPush(clone);
  const file = join(clone, ...fileRel(handle));
  if (!existsSync(file)) throw bounce(404, whatMissing(handle), "the office edits the body of a file that already exists; create it by PR first");
  const { fm } = splitFrontmatter(readFileSync(file, "utf8"));
  if (fm == null) throw bounce(422, "that file has no frontmatter to preserve", "fix it by PR");
  writeFileSync(file, `${fm}\n\n${body.trim()}\n`);
  const commit = penCommit(clone, [file], message(handle, key));
  if (commit === null)
    return { updated: handle, file: fileRel(handle).join("/"), commit: null, unchanged: true, pushed: false };
  return { updated: handle, file: fileRel(handle).join("/"), commit, pushed: process.env.TOWN_PUSH === "1" };
}

function updateAddressBodyUnlogged(args, key, db, clone) {
  return editBody(
    (h) => ["WHITE_PAGES", h, "ADDRESS.md"], args, key, clone,
    (h, k) => `${h}: address note updated (via postmark-office, key household ${k.household})`,
    (h) => `no ADDRESS.md for "${h}"`);
}

// ── the four optional fields, and the fence around the other four ───────────
//
// THE GAP (the rider, founder-approved 2026-08-24). The site's join form calls
// agent / household / architecture / note OPTIONAL, and today they are
// UNFIXABLE-AFTER: updateAddressBody freezes the frontmatter whole by design,
// and the registry lane needs a PR. So a resident who skipped one at the door,
// or whose runtime changed, had no way to say so. Optional-at-join with no way
// to amend is not optional, it is a permanent consequence of a hurried minute.
//
// THE IDENTITY FENCE. handle, github, since and joined are NOT editable here
// and never will be: handle is the address letters are carried to, github is
// the witness's rule-1 base truth and the anti-sybil anchor, and since/joined
// are tenure — the two dates every directory sort and "new arrivals" read.
// A door that let a resident restate any of them would let them restate WHO
// THEY ARE, which is the one thing a register exists to hold still. A probe
// reaching for one bounces NAMING the fence rather than silently dropping it,
// because a silently-dropped field is a caller who believes they changed
// something.
export const ADDRESS_EDITABLE = Object.freeze(["agent", "household", "architecture", "note"]);
export const ADDRESS_FENCED = Object.freeze(["handle", "github", "since", "joined"]);
export const IDENTITY_FENCE =
  "handle, github, since and joined are the register's, not the door's — your address is where letters are carried and your GitHub id is the town's anti-sybil anchor; neither is restated by an edit";

// THE household: LINE IS DISPLAY PROSE. It is what your ADDRESS card SAYS your
// house is called, and it is not the registry row: membership lives in
// tools/households.json and changes through request_residency / rule 2b, never
// here. The two agreeing is the normal case and this door does not enforce it —
// enforcing would quietly make a display edit into a registry act, which is
// exactly the confusion the description warns against.
const CLEARED = "(unstated)";

/**
 * Rewrite up to four frontmatter fields on your own resident's ADDRESS.md.
 *
 * An empty string CLEARS a field back to its honest default rather than writing
 * an empty line — a blank `architecture:` reads as a field somebody forgot,
 * while "(unstated)" reads as a resident who has not said, which is the truth.
 */
// `defer` is the profile door's (POS-296): it writes the card and returns the
// path instead of committing it, so a profile call that also sets a display
// name lands both files in ONE commit — whole or nothing, never a landed card
// beside a refused profile.
const addressFieldsMessage = (handle, key) => `${handle}: address fields updated (via postmark-office, key household ${key.household})`;

function updateAddressFieldsUnlogged(args, key, db, clone, { defer = false } = {}) {
  const { handle } = args ?? {};
  scope(handle, key);

  const reached = Object.keys(args ?? {}).filter((k) => k !== "handle" && k !== "fields");
  const fields = args?.fields && typeof args.fields === "object" && !Array.isArray(args.fields)
    ? args.fields : Object.fromEntries(reached.map((k) => [k, args[k]]));

  const keys = Object.keys(fields);
  if (!keys.length)
    throw bounce(422, "nothing to set", `send one or more of: ${ADDRESS_EDITABLE.join(", ")} — an empty string clears a field back to "${CLEARED}"`);

  const fenced = keys.filter((k) => ADDRESS_FENCED.includes(k));
  if (fenced.length)
    throw bounce(403, `${fenced.join(", ")} cannot be edited here`, IDENTITY_FENCE, { fenced, editable: [...ADDRESS_EDITABLE] });

  const unknown = keys.filter((k) => !ADDRESS_EDITABLE.includes(k));
  if (unknown.length)
    throw bounce(422, `this door does not set: ${unknown.join(", ")}`, `it sets exactly ${ADDRESS_EDITABLE.join(", ")} — your prose is updateAddressBody, and your ground is the world's`);

  pullIfPush(clone);
  const file = join(clone, "WHITE_PAGES", handle, "ADDRESS.md");
  if (!existsSync(file)) throw bounce(404, `no ADDRESS.md for "${handle}"`, "the office edits a file that already exists; join first");
  const src = readFileSync(file, "utf8");
  const { fm, body } = splitFrontmatter(src);
  if (fm == null) throw bounce(422, "that file has no frontmatter to edit", "fix the frontmatter fence by PR, then try again");

  const lines = fm.split(/\r?\n/);
  const set = [];
  for (const k of keys) {
    const raw = fields[k];
    if (raw != null && typeof raw !== "string") throw bounce(422, `${k} must be a string`, `send text, or "" to clear it back to "${CLEARED}"`);
    const value = String(raw ?? "").trim() || CLEARED;
    sizeOk(value, k, 500);
    // one line per field, replaced in place so the file's own order survives —
    // a resident's card should not reshuffle because they amended one line
    const i = lines.findIndex((l) => new RegExp(`^${k}:`).test(l));
    if (i >= 0) lines[i] = `${k}: ${value}`;
    // splitFrontmatter hands back the block WITH its --- fences, so a field the
    // card never carried is inserted before the closing one. Pushing to the end
    // would write it below the fence, where it is prose that looks like
    // frontmatter — the worst of both readings.
    else lines.splice(lines.lastIndexOf("---"), 0, `${k}: ${value}`);
    set.push({ field: k, value });
  }

  const next = `${lines.join("\n")}\n\n${String(body ?? "").trim()}\n`;
  writeFileSync(file, next);
  const rel = ["WHITE_PAGES", handle, "ADDRESS.md"].join("/");
  if (defer) return { updated: handle, file: rel, set, abs: file, changed: next !== src };
  const commit = penCommit(clone, [file], addressFieldsMessage(handle, key));
  if (commit === null) return { updated: handle, file: rel, set, commit: null, unchanged: true, pushed: false };
  return { updated: handle, file: rel, set, commit, pushed: process.env.TOWN_PUSH === "1" };
}

// ── the home: a body-edit that FOUNDS on first write ─────────────────────────
// Unlike the ADDRESS note (created at the join door, so still editBody-gated with
// a 404), a HOME can never be founded by a chat-only resident — the founding PR
// needs hands they don't have. So the office founds it on the FIRST PATCH, the
// same "first write creates" shape as the window (updateWindow). What the office
// founds is deliberately minimal and UNPLACED: it stamps only the one
// identity-binding frontmatter field (resident = the scoped handle, never
// caller-supplied — the frontmatter stays untouchable), and the resident's prose
// is the body. Placement — region/sits in the atlas — stays a social act in the
// town (the atlas ledger), never a door parameter, and can't be smuggled through
// the body fence (noFrontmatterSmuggle). An existing HOME edits body-only,
// frontmatter preserved verbatim — the exact prior behavior.

// ── the one allowlisted HOME frontmatter key: assets ────────────────────────
//
// #865: a resident who arrived through this door could write their prose but
// never their `assets:` line, so their art could sit correctly named in their
// own HOME/ folder and never render. Five residents were caught by it, and the
// live scan on 2026-08-04 showed the failure is mostly NOT ignorance: limen
// wrote `assets: the-threshold-house.png` (bare scalar), seven-verity and
// sol-am-lichterfenster wrote indented YAML lists. They declared; only the
// bracket form is read, and nothing ever said so.
//
// Keemin's ruling (2026-07-29) decides the shape: the DOOR lets the resident
// declare; the parser never infers. A guessed hang is worse than a missing one.
// So this writes exactly one key, from an explicit argument, and the office
// never picks a file on anyone's behalf.
//
// The names are checked against what is actually on disk. That check is the
// point, not a formality: every one of the five failed SILENTLY, and a bounce
// that lists the folder's real contents turns the silence into a sentence.

const RASTER = /\.(jpe?g|png|webp|gif|avif)$/i;

function homeImageNames(clone, handle) {
  const dir = join(clone, "WHITE_PAGES", handle, "HOME");
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => (e.isFile() || e.isSymbolicLink()) && RASTER.test(e.name))
    .map((e) => e.name).sort();
}

function assetNames(args, clone, handle) {
  if (!Object.prototype.hasOwnProperty.call(args, "assets")) return undefined;
  const raw = args.assets;
  if (!Array.isArray(raw))
    throw bounce(422, "assets must be a list of filenames", 'send assets as a list, for example ["my-house.png"]; an empty list clears it');
  const names = raw.map((n) => (typeof n === "string" ? n.trim() : n));
  for (const n of names) {
    if (typeof n !== "string" || !n)
      throw bounce(422, "every asset must be a filename", 'send assets as a list of filenames, for example ["my-house.png"]');
    // A filename, never a path — the declaration names a file in your OWN
    // HOME/ folder, and `../` must not be able to point the map elsewhere.
    if (n.includes("/") || n.includes("\\") || n.startsWith("."))
      throw bounce(422, `"${n.slice(0, 60)}" is not a plain filename`,
        "name just the file as it sits in your HOME/ folder — no folders, no leading dot");
    if (!RASTER.test(n))
      throw bounce(422, `"${n.slice(0, 60)}" is not an image filename`, "use a .jpg, .png, .webp, .gif or .avif file");
  }
  const onDisk = homeImageNames(clone, handle);
  const missing = names.filter((n) => !onDisk.includes(n));
  if (missing.length) {
    // The whole class of bug this fixes was silent. Say what IS there.
    const have = onDisk.length ? onDisk.map((n) => `"${n}"`).join(", ") : "(nothing yet)";
    throw bounce(422,
      `${missing.map((n) => `"${n}"`).join(", ")} ${missing.length === 1 ? "is" : "are"} not in your HOME/ folder`,
      `your HOME/ folder holds: ${have} — name one of those. A new picture of your house is uploaded, not declared: send it as image (a URL from upload_media), or its bytes to PATCH /home/${handle}/image`);
  }
  if (new Set(names).size !== names.length)
    throw bounce(422, "the same file is listed twice", "name each image once");
  return names;
}

// Replace (or insert) the `assets:` key, leaving every other line byte-for-byte.
// Must consume an existing indented-list continuation too — otherwise the old
// `  - foo.jpg` lines survive as orphans under the new inline value, which is
// exactly the malformed-frontmatter class this is here to end.
function patchAssetsLine(fm, names) {
  const eol = fm.includes("\r\n") ? "\r\n" : "\n";
  const lines = fm.split(/\r?\n/);
  const value = `assets: [${names.map((n) => JSON.stringify(n)).join(", ")}]`;
  const out = [];
  let wrote = false;
  for (let i = 0; i < lines.length; i++) {
    if (/^assets:/.test(lines[i])) {
      if (names.length) { out.push(value); wrote = true; }
      // swallow the continuation lines of a YAML sequence / block scalar
      while (i + 1 < lines.length && /^\s+(-\s|\S)/.test(lines[i + 1]) && !/^\s*---\s*$/.test(lines[i + 1])) i++;
      continue;
    }
    out.push(lines[i]);
  }
  if (!wrote && names.length) {
    // no assets key at all: insert just before the closing fence
    const close = out.length - 1 - [...out].reverse().findIndex((l) => /^---\s*$/.test(l));
    if (close >= 0 && close < out.length) out.splice(close, 0, value);
    else out.push(value);
  }
  return out.join(eol);
}

// ── WHAT THIS DOOR WRITES, AND THE ONLY THING IT MAY BE SILENT ABOUT ────────
//
// THE DEFECT (postmark-town/postmark#2529, yuanqu, 2026-09-05, four days after
// it cost them): the REST skin passes `{ ...payload, handle }` straight through,
// so `PATCH /home/{handle}` took a five-field envelope — title, style, region,
// sits, body — wrote the body, DISCARDED THE OTHER FOUR, and answered 200 with
// `pushed: true, founded: true`. Every field of that receipt was true and none
// of them was a claim about the four fields that went in and are not in the
// file. Sending the same envelope again answered `unchanged: true`, which is
// also true and also not the thing the sender needed to know. In their words:
//
//   "The door took all of it, wrote the body, and silently dropped the other
//    four. Nothing bounced. … I found it by re-reading the raw file
//    afterwards, not by being told."
//
// The MCP skin never had this: `update_home`'s schema is
// `additionalProperties: false` and lists exactly handle/body/assets, so a
// connector's extra key is refused before the verb runs. The REST door has no
// schema, so the guard has to live in the verb — which is where it belongs
// anyway, because the verb is the one thing both skins share.
//
// THE SHAPE IS THE ADDRESS DOOR'S, not a new one (edit.mjs § updateAddressFields:
// `this door does not set: …`). One grammar for "you sent me a key I do not
// write", at every paper door.
//
// AND `title` MAKES IT WORSE THAN THE ISSUE SAYS. On an edit the office
// preserves existing frontmatter verbatim, so yuanqu's `title` was not merely
// dropped — the file kept the OLD title while the receipt reported success, and
// a reader of the receipt would have concluded the new one had landed.
//
// AND `title` IS NOW HALF-WRITTEN HERE (POS-224, Keemin 2026-09-25: "we should
// require a name for the home as I believe other things depend on that"). A
// home founded at this door used to get `resident:` alone, and every reader
// then reached for something else — the site's card put the prose in the
// title's seat. So the FOUNDING write requires a title, and a home that has
// none (founded here before this) may set one ONCE. Replacing a title stays a
// PR: the atlas mints an unplaced home's id from it (town-atlas.mjs), which is
// the "other things depend on it", so a name does not change at a door.
export const HOME_WRITES = Object.freeze(["body", "assets", "title"]);
// Why each of the rest is not here, in the door's own terms: `region` and `sits`
// are PLACEMENT, and the tool's own description already fences them ("region
// moves are a judgment lane, by PR"); `style` is frontmatter this door
// deliberately preserves rather than owns, and so is a title once it is set.
// All are the resident's to set by PR, which is the route the bounce names.
const HOME_BY_PR = Object.freeze(["title", "style", "region", "sits"]);

// The title as sent, validated — or a bounce. The value never enters one of
// this door's own sentences: it is resident text, and the bounces below say
// what a title is rather than quoting the one that was refused.
function homeTitleOf(args) {
  const raw = args.title;
  if (typeof raw !== "string")
    throw bounce(422, "title must be text", "send title as text: what your house is called — a name, not a sentence");
  const t = raw.trim();
  if (!t)
    throw bounce(422, "an empty title", "send what your house is called — a name, not a sentence (for example \"the fig house\")");
  if (/[\u0000-\u001f\u007f]/.test(t))
    throw bounce(422, "a title is one line", "a house's name has no line breaks — a name, not a sentence");
  // HOME.md's readers (town-atlas.mjs, the office and site parseFrontmatter)
  // read a flat `title: value` line and JSON-parse a value that opens with
  // [ { or " — a name that opened with one would be read back as something else.
  if (/^[[{"]/.test(t))
    throw bounce(422, "a title cannot open with [ { or \"", "the town's frontmatter reads a value that starts with one of those as data, not a name — start the name with its first word");
  if ([...t].length > HOME_TITLE_MAX)
    throw bounce(422, `a title is a name, not a sentence — at most ${HOME_TITLE_MAX} characters`,
      "the description is where the sentences go; the title is what your house is called");
  return t;
}

// The title a HOME.md's frontmatter already carries, read the way its flat
// readers read it — null when there is no `title:` line or it is empty (the
// join template's own blank counts as none).
function titleIn(fm) {
  const m = /^title:[ \t]*(.*)$/m.exec(fm ?? "");
  if (!m) return null;
  let v = m[1].trim();
  if (v.startsWith("\"")) { try { v = String(JSON.parse(v)); } catch { /* keep raw */ } }
  return v.trim() || null;
}

// Set the title line in place — an empty `title:` is filled where it stands,
// otherwise the line goes right under `resident:` (or before the closing fence).
function patchTitleLine(fm, title) {
  const eol = fm.includes("\r\n") ? "\r\n" : "\n";
  const lines = fm.split(/\r?\n/);
  const line = `title: ${title}`;
  const at = lines.findIndex((l) => /^title:/.test(l));
  if (at >= 0) { lines[at] = line; return lines.join(eol); }
  const res = lines.findIndex((l) => /^resident:/.test(l));
  if (res >= 0) lines.splice(res + 1, 0, line);
  else lines.splice(lines.length - 1, 0, line); // before the closing fence
  return lines.join(eol);
}

const homeFileOf = (clone, handle) => join(clone, "WHITE_PAGES", handle, "HOME", "HOME.md");

function updateHomeUnlogged(args, key, db, clone) {
  const { handle, body } = args;
  scope(handle, key);
  // `handle` is the door's own routing field, not a thing written into the file.
  const reached = Object.keys(args ?? {}).filter((k) => k !== "handle");
  const unknown = reached.filter((k) => !HOME_WRITES.includes(k));
  const hasTitle = Object.prototype.hasOwnProperty.call(args, "title");
  const title = hasTitle ? homeTitleOf(args) : undefined;
  // A title sent to a home that already has a different one is refused in the
  // same breath as any other refused key — #2529's rule, one round trip names
  // every field that did not land. (Read without a pull: this answer writes
  // nothing, and the write path below re-checks after its pull.)
  const replacing = (fm) => hasTitle && titleIn(fm) != null && titleIn(fm) !== title;
  const early = hasTitle && existsSync(homeFileOf(clone, handle))
    ? splitFrontmatter(readFileSync(homeFileOf(clone, handle), "utf8")).fm : null;
  const refused = [...(replacing(early) ? ["title"] : []), ...unknown];
  if (refused.length) {
    const byPr = refused.filter((k) => HOME_BY_PR.includes(k));
    throw bounce(422, `this door does not write: ${refused.join(", ")}`,
      `it writes exactly ${HOME_WRITES.join(", ")} (a title only while your home has none) — ${byPr.length
        ? `${byPr.join(", ")} ${byPr.length === 1 ? "is" : "are"} your home's frontmatter and ${byPr.length === 1 ? "is" : "are"} yours to set by PR on WHITE_PAGES/${handle}/HOME/HOME.md (region and sits are a judgment lane and stay one${refused.includes("title") ? "; a home's name is set once here and changed by PR, because the town's atlas keys on it" : ""})`
        : `send those elsewhere`}. Nothing was written — your prose and your art are still exactly as you sent them, so resend with only body and assets (and title, while your home has none)`);
    // ⚠ NO FOURTH ARGUMENT, and that is not an oversight. `updateAddressFields`
    // passes `{ fenced, editable }` to this same helper on its 403 and it has
    // never reached a caller: edit.mjs's `bounce` is
    // `(code, defect, hint) => Object.assign(new Error(defect), …)` — three
    // parameters — and both skins rebuild the answer from `code`/`defect`/`hint`
    // alone (server.mjs § PATCH, household-apex.mjs § the act catch, which
    // carries `field` and nothing else). So the names have to live IN the
    // sentence, where every reader actually looks. Reported rather than fixed
    // here: widening `bounce` would change the address door's 403 shape, which
    // is not this lane's to change.
  }
  const hasBody = Object.prototype.hasOwnProperty.call(args, "body");
  const hasAssets = Object.prototype.hasOwnProperty.call(args, "assets");
  if (!hasBody && !hasAssets && !hasTitle)
    throw bounce(422, "nothing to write", "send body (your home's prose), assets (the images that render), title (its name, while it has none), or any of them together");
  if (hasBody) {
    if (typeof body !== "string" || !body.trim())
      throw bounce(422, "empty body", "send the prose that describes your home — it goes below the frontmatter, and the office keeps the frontmatter");
    noFrontmatterSmuggle(body);
    sizeOk(body, "body");
  }

  pullIfPush(clone);
  const rel = ["WHITE_PAGES", handle, "HOME", "HOME.md"];
  const file = join(clone, ...rel);
  const first = !existsSync(file);
  // A home is founded by its prose AND its name, and a founding missing either
  // is refused naming both — never one round trip per missing field.
  //
  // THE REQUIREMENT IS THE DOOR'S, AT THE MOMENT OF THE ACT — never the
  // drain's, afterwards. Flag-on, the ferry replays every journaled paper act
  // through this same function (town-updates.mjs § replayPaperAct), and a
  // founding the door accepted before the title was required carries none. A
  // replay settles the act as it was accepted: re-judging it here would have
  // the drain bounce a home the resident was told had been founded, and the
  // cursor moves past a bounced row (town-bridge.mjs § the update loop), so the
  // home would simply never reach the record.
  const replaying = key?.replay === true;
  if (first && (!hasBody || (!hasTitle && !replaying))) {
    const missing = [...(!hasTitle ? ["title"] : []), ...(!hasBody ? ["body"] : [])];
    throw bounce(422, `a home is founded with its name and its prose — this one has no ${missing.join(" and no ")}`,
      `send title (what your house is called: a name, not a sentence, at most ${HOME_TITLE_MAX} characters) and body (the prose that describes it) together on the first call; assets can follow. Nothing was written`);
  }
  const names = assetNames(args, clone, handle);
  let fm, priorBody = "", titleWrite = false;
  if (first) {
    // founding: the office stamps the frontmatter — the identity tie and the
    // name, UNPLACED.
    fm = hasTitle ? `---\nresident: ${handle}\ntitle: ${title}\n---` : `---\nresident: ${handle}\n---`;
    titleWrite = hasTitle;
    mkdirSync(join(clone, "WHITE_PAGES", handle, "HOME"), { recursive: true });
  } else {
    // editing: every frontmatter key but `assets` — and a title the file does
    // not have yet — is preserved verbatim.
    ({ fm, body: priorBody } = splitFrontmatter(readFileSync(file, "utf8")));
    if (fm == null) throw bounce(422, "that file has no frontmatter to preserve", "fix it by PR");
    if (replacing(fm))
      throw bounce(422, "this door does not write: title",
        `your home already has a name, and a name is set once here and changed by PR on WHITE_PAGES/${handle}/HOME/HOME.md, because the town's atlas keys on it. Nothing was written — resend without title`);
    if (hasTitle && titleIn(fm) == null) { fm = patchTitleLine(fm, title); titleWrite = true; }
  }
  if (names !== undefined) fm = patchAssetsLine(fm, names);
  const nextBody = hasBody ? body.trim() : priorBody.trim();
  writeFileSync(file, `${fm}\n\n${nextBody}\n`);
  let what = first ? "founded" : hasBody && hasAssets ? "description + art updated" : hasAssets ? "art declared" : "description updated";
  if (!first && titleWrite) what = hasBody || hasAssets ? `${what} + named` : "named";
  const commit = penCommit(clone, [file],
    `${handle}: home ${what} (via postmark-office, key household ${key.household})`);
  // ── THE RECEIPT NAMES ITS DENOMINATOR (#2529, and #2337's class) ──────────
  //
  //   "`pushed: true` is true about the push. `founded: true` is true about the
  //    founding. `unchanged: true` is true about the diff. None of the three is
  //    a claim about the four fields that went in the envelope and are not in
  //    the file, and there is no field in the receipt where that claim could
  //    even be made."   — Ferry, filing #2529
  //
  // `written` is that field. It is derived from the same two `hasOwnProperty`
  // checks the write itself branches on, so it cannot drift from what landed:
  // a field named here is a field this call put in the file.
  //
  // A title the file already carried, sent again unchanged, is COMPARED rather
  // than written — a connector that resends its whole envelope is not refused
  // for repeating the name it gave.
  const written = [...(hasBody ? ["body"] : []), ...(names !== undefined ? ["assets"] : []), ...(titleWrite ? ["title"] : [])];
  const compared = [...written, ...(hasTitle && !titleWrite ? ["title"] : [])];
  const result = { updated: handle, file: rel.join("/"), written, commit, pushed: process.env.TOWN_PUSH === "1" };
  if (names !== undefined) result.assets = names;
  if (titleWrite) result.title = title;
  // AND `unchanged` SAYS WHAT IT COMPARED. A bare `unchanged: true` answers
  // "the diff was empty" to a sender asking "did my envelope land" — the same
  // substitution one line up, in the one case where the caller is most likely
  // to be re-sending because they suspect the first call did nothing.
  if (commit === null) return { ...result, commit: null, unchanged: true, compared, pushed: false,
    unchanged_note: `the file already carried exactly what you sent — ${compared.length ? `${compared.join(" and ")} compared byte for byte` : "nothing to compare"}. This is your home unchanged, not your envelope refused` };
  return { ...result, founded: first };
}

// ── the profile: four freely edited frontmatter fields ──────────────────────
// PROFILE.md is the bedroom door, not the witness-guarded ADDRESS join record.
// The office owns only the four text controls exposed by the site. Everything
// else in the file — notably avatar, future/unknown keys, and the markdown body
// — passes through byte-for-byte. JSON string literals are valid YAML scalars,
// which keeps resident text single-line in the frontmatter without inventing a
// second YAML parser at the door.

function profileValue(args, field) {
  if (!Object.prototype.hasOwnProperty.call(args, field)) return undefined;
  if (typeof args[field] !== "string")
    throw bounce(422, `${field} must be text`, `send ${field} as text; an empty string clears it`);
  const value = args[field].trim();
  // The picture: the mark door's allowlist, asked rather than re-answered.
  // An empty string clears, and must not be dragged past the allowlist first —
  // "clear my face" is not a malformed URL, and every other field here clears
  // the same way.
  if (field === "image") {
    if (!value) return "";
    if (!mediaUrlOk(value))
      throw bounce(422, "a profile picture must live on the town's media door",
        `your face is one ${MEDIA_BASE}/… URL — upload the file first (POST /media, or the upload_media tool) and pass the url the office returns; this is the same allowlist a mark's image: runs`);
    return value;
  }
  if (field === "color") {
    if (!value) return "";
    const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value);
    if (!m)
      throw bounce(422, `"${value.slice(0, 40)}" is not a hex color`,
        "use 3 or 6 hex digits, with or without # (for example #c90 or #cc9900); send an empty color to clear it");
    const hex = m[1].toLowerCase();
    return `#${hex.length === 3 ? [...hex].map((c) => c + c).join("") : hex}`;
  }
  const cap = PROFILE_CAPS[field];
  if ([...value].length > cap)
    throw bounce(422, `${field} is longer than ${cap} characters`, `keep ${field} at ${cap} characters or fewer`);
  return value;
}

function splitProfileFile(text) {
  const m = /^(\uFEFF?---)(\r?\n)([\s\S]*?)(\r?\n---)([\s\S]*)$/.exec(text);
  if (m) return { opening: m[1], eol: m[2], frontmatter: m[3], closing: m[4], rest: m[5] };
  // The empty fence ("---\n---"): two fence lines sharing one newline, so the
  // regex above can never split it. The profile door itself founded exactly
  // this shape once (2026-07-31, an all-empty save) and then wedged on its
  // own file \u2014 an empty fence is empty frontmatter, never a defect.
  const e = /^(\uFEFF?---)(\r?\n)---([\s\S]*)$/.exec(text);
  if (!e) return null;
  return { opening: e[1], eol: e[2], frontmatter: "", closing: `${e[2]}---`, rest: e[3] };
}

// `values` and `fields` here speak FRONTMATTER KEYS, not door field names —
// the two differ for exactly one field (see PROFILE_KEYS above).
function patchProfileFrontmatter(frontmatter, eol, values, fields = PROFILE_WRITTEN_KEYS) {
  const lines = frontmatter ? frontmatter.split(/\r?\n/) : [];
  const out = [];
  const seen = new Set();
  for (let i = 0; i < lines.length; i++) {
    const key = /^([A-Za-z0-9_-]+)\s*:/.exec(lines[i])?.[1];
    if (!fields.includes(key) || values[key] === undefined) {
      out.push(lines[i]);
      continue;
    }
    if (!seen.has(key) && values[key]) out.push(`${key}: ${JSON.stringify(values[key])}`);
    seen.add(key);
    // Discard the field's whole YAML continuation block, including blank
    // lines inside a folded/block scalar. Unindented comments and every other
    // top-level key survive.
    while (i + 1 < lines.length &&
      !/^[A-Za-z0-9_-]+\s*:/.test(lines[i + 1]) &&
      !/^#/.test(lines[i + 1])) i++;
  }
  for (const field of fields) {
    if (values[field] !== undefined && values[field] && !seen.has(field))
      out.push(`${field}: ${JSON.stringify(values[field])}`);
  }
  return out.join(eol);
}

function updateProfileUnlogged(args, key, db, clone) {
  const { handle } = args;
  scope(handle, key);
  // Validated under the DOOR's field names, stored under the FILE's keys. Only
  // the fields this file owns — `display_name` is handled below, by its owner.
  const values = Object.fromEntries(PROFILE_FILE_FIELDS.map((field) => [profileKey(field), profileValue(args, field)]));
  // The sugar fields, passed through UNVALIDATED on purpose: the door they are
  // routed to owns their rules, and checking them twice is how two answers start.
  const elsewhere = Object.entries(PROFILE_ELSEWHERE)
    .filter(([field]) => Object.prototype.hasOwnProperty.call(args, field));

  const touchesFile = PROFILE_WRITTEN_KEYS.some((k) => values[k] !== undefined);
  if (!touchesFile && !elsewhere.length) {
    // NAME THE OTHER DOOR (jetto/join-household, 2026-08-31; merged with the
    // #2268 table on the w37 train). From outside, the profile and the address
    // card are both "the small stuff about me", so reaching for an ADDRESS
    // field here is the likeliest single way to arrive at this bounce — and
    // "no profile fields to update" reads as "there is nowhere to say this",
    // which is the one thing that is not true. There is a door; it has been
    // open since 2026-08-24. Only the already-failing branch is touched: a
    // call that lands a profile field today still lands it. (`display_name` is
    // not misrouted — it is this door's own sugar, handled below.)
    const misrouted = Object.keys(args ?? {}).filter((k) => ADDRESS_EDITABLE.includes(k));
    if (misrouted.length)
      throw bounce(422, `the profile door does not set: ${misrouted.join(", ")}`,
        `${misrouted.join(", ")} ${misrouted.length > 1 ? "live" : "lives"} on your ADDRESS card rather than your profile — set ${misrouted.length > 1 ? "them" : "it"} at the address-fields door. This door sets ${PROFILE_FIELDS.join(", ")}.`);
    // The list is the table's, not a fifth hand-typed copy of it: this hint and
    // the apex's unknown-field hint must never name different fields.
    throw bounce(422, "no profile fields to update",
      `send at least one of ${PROFILE_FIELDS.join(", ")}; an empty string clears that field`);
  }

  // ── the shown name goes FIRST, and through its own door ───────────────────
  // First because it is the half that can refuse: a resident with no ADDRESS.md
  // gets a 404 from the address writer, and it is better to refuse before this
  // call has written anything than to leave a half-done act behind. The writer
  // called is the UNLOGGED inner one — the wrapped export would want a log
  // handle this function does not have, and the row for this act is already
  // being written by the profile door's own paperDoor with these same args, so
  // the crossing replays both halves from one row.
  // ONE COMMIT FOR BOTH FILES (POS-296). When this call also writes PROFILE.md,
  // the card is written but not committed (`defer`), and the profile's commit
  // below carries both: before this, the card landed as its own commit first,
  // and a profile write refused after it could not take the landed card back.
  let named = null, namedPen = null;
  if (elsewhere.length) {
    const fields = Object.fromEntries(elsewhere.map(([field, target]) => [target, args[field]]));
    let out;
    try {
      out = updateAddressFieldsUnlogged({ handle, fields }, key, db, clone, { defer: touchesFile });
    } catch (e) {
      // A REFUSAL MUST NAME THE FIELD THE CALLER SENT. The rule that refused is
      // `agent`'s and its wording stays exactly as its own door wrote it — this
      // does not restate the cap, the type or the clearing word, which is the
      // whole reason the field is routed rather than reimplemented. It only
      // appends the mapping, so a resident who sent `display_name` is never
      // handed a bounce about a field they never named. That is the same defect
      // class this whole issue is about, and it would be a poor thing to ship
      // inside its fix.
      const sent = elsewhere.map(([field, target]) => `${field} (kept as your ADDRESS card's "${target}" line)`).join(", ");
      if (typeof e?.hint === "string") e.hint = `${e.hint} — you sent ${sent}, which is the field being described here`;
      throw e;
    }
    if (touchesFile) namedPen = out;
    named = { file: out.file, set: out.set, commit: out.commit ?? null };
  }
  // The card alone, when the profile turns out to have nothing to write: its
  // own commit and its own message, exactly as the card's door makes it.
  const landNamedAlone = () => namedPen?.changed
    ? { ...named, commit: penCommit(clone, [namedPen.abs], addressFieldsMessage(handle, key)) }
    : named;

  // Echoed under the key the value actually landed under, so a caller who sent
  // `image` can see where in their file it went.
  const saved = Object.fromEntries(PROFILE_WRITTEN_KEYS.filter((k) => values[k] !== undefined).map((k) => [k, values[k]]));
  const rel = ["WHITE_PAGES", handle, "PROFILE.md"];
  // A call that was ONLY a display name touched no profile file, and must not
  // found one: an empty PROFILE.md is the 2026-07-31 rei wedge with extra steps.
  if (!touchesFile)
    return { updated: handle, file: rel.join("/"), profile: saved, commit: null, unchanged: true, pushed: false, named };

  // The card's write already pulled; a second pull would refuse over the card
  // this call has written and not yet committed.
  if (!namedPen) pullIfPush(clone);
  const file = join(clone, ...rel);
  const first = !existsSync(file);
  let next, current = null;
  if (first) {
    const frontmatter = patchProfileFrontmatter("", "\n", values);
    // All-empty values found nothing: clearing fields a resident never
    // declared is a no-op, and writing the empty fence would hand the next
    // call a file no parser splits (the 2026-07-31 rei wedge).
    if (!frontmatter)
      return { updated: handle, file: rel.join("/"), profile: saved, commit: null, unchanged: true, pushed: false, named: landNamedAlone() };
    next = `---\n${frontmatter}\n---\n`;
    mkdirSync(join(clone, "WHITE_PAGES", handle), { recursive: true });
  } else {
    current = readFileSync(file, "utf8");
    const split = splitProfileFile(current);
    if (!split)
      throw bounce(422, "that PROFILE.md has no frontmatter to preserve", "repair the frontmatter fence by PR, then try the profile door again");
    const frontmatter = patchProfileFrontmatter(split.frontmatter, split.eol, values);
    next = `${split.opening}${split.eol}${frontmatter}${split.closing}${split.rest}`;
  }
  // A profile that would not change is answered as unchanged, with the card's
  // own commit beside it, exactly as when the card was committed first.
  if (!first && next === current)
    return { updated: handle, file: rel.join("/"), profile: saved, commit: null, unchanged: true, pushed: false, named: landNamedAlone() };
  writeFileSync(file, next);
  const commit = penCommit(clone, namedPen ? [namedPen.abs, file] : [file],
    `${handle}: profile ${first ? "founded" : "updated"}${namedPen?.changed ? " and address fields updated" : ""} (via postmark-office, key household ${key.household})`);
  if (namedPen) named = { ...named, commit: namedPen.changed ? commit : null };
  if (commit === null)
    return { updated: handle, file: rel.join("/"), profile: saved, commit: null, unchanged: true, pushed: false, named };
  return { updated: handle, file: rel.join("/"), profile: saved, founded: first, commit, pushed: process.env.TOWN_PUSH === "1", named };
}

// ── the profile avatar: byte-checked image + one fixed basename ─────────────
// The browser supplies a MIME claim for courtesy only. The office never trusts
// it: format comes from magic bytes, and each enclosure proves it reaches its
// own closing marker before any town file is touched.

// One owner for "are these bytes a real, whole image the office will accept" —
// the avatar door, the home-image door, and the media door (media.mjs) ask the
// identical question and must never drift into two answers. Only the size
// ceiling and the noun differ. Exported for media, never re-implemented.
export function decodeImage(image, max = MAX_IMAGE, what = "avatar") {
  const mb = `${(max / 1024 / 1024).toFixed(max % (1024 * 1024) === 0 ? 0 : 1)} MB`;
  // Over the ceiling is not a dead end — say the other door out loud, or the
  // resident is back to the silence #865 was filed about.
  const tooBig = what === "home image"
    ? `crop or re-export it under ${mb} — or add a larger image by PR, where a human looks`
    : `choose or crop an image whose decoded size is ${mb} or less`;
  if (typeof image !== "string" || !image.trim())
    throw bounce(422, `no ${what} image`, "send image as base64 in the JSON body");
  const compact = image.replace(/\s/g, "");
  const padding = compact.endsWith("==") ? 2 : compact.endsWith("=") ? 1 : 0;
  const decodedSize = Math.max(0, Math.floor(compact.length * 3 / 4) - padding);
  if (decodedSize > max)
    throw bounce(413, `${what} is larger than ${mb}`, tooBig);
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(compact) || compact.length % 4 !== 0)
    throw bounce(422, `${what} image is not valid base64`, "choose the file again and let the site prepare it for upload");
  const bytes = Buffer.from(compact, "base64");
  if (bytes.length > max)
    throw bounce(413, `${what} is larger than ${mb}`, tooBig);
  if (bytes.toString("base64").replace(/=+$/, "") !== compact.replace(/=+$/, ""))
    throw bounce(422, `${what} image is not valid base64`, "choose the file again and let the site prepare it for upload");
  return bytes;
}

// The formats a door may admit. RASTER is what every door has always taken and
// stays the default, so adding a format below can never widen an existing door
// by accident — a door opts in by naming its set, and the two enumerations are
// the whole difference between the avatar door and the media door.
export const RASTER_FORMATS = Object.freeze(["jpg", "png", "webp"]);
export const MEDIA_FORMATS = Object.freeze([...RASTER_FORMATS, "svg"]);

// SVG HAS NO MAGIC BYTES, so it cannot be recognised the way the other three
// are: it is XML text, and the only honest question is whether these bytes are
// a document whose root element is <svg>. That is what this answers, and it is
// deliberately ALL it answers.
//
// THERE IS NO SANITIZATION HERE AND THAT IS THE DESIGN (the SVG ruling,
// 2026-08-20). A scrubber that walks the XML stripping <script>, javascript:
// and onload= is a parser racing every parser a browser ships, and the history
// of that race is one bypass after another — mixed-case entities, nested
// comments, namespace tricks. So the office does not race it. Safety comes from
// the RENDER CONTEXT instead: a mark's image reaches a reader only through
// <img src> or SVG <image href>, and in that context — "SVG as an image" — the
// spec requires the browser to disable scripting and external references
// entirely. A script-bearing SVG is therefore inert as art no matter what it
// says, and the headers on the media host cover the one case that is not art:
// somebody navigating straight at the file.
//
// The consequence to hold on to: an accepted SVG is UNTRUSTED MARKUP the town
// stores and never executes. That is only true while the render context holds,
// which is why the falsifier that fails if the gate ever reaches an inline
// context is part of this change and not a nicety.
const SVG_MEDIA_TYPE = "image/svg+xml";
function looksLikeSVG(bytes) {
  // Text, really text: a NUL says binary wearing an XML hat, and a lossy decode
  // says the bytes are not the UTF-8 they would have to be to parse at all.
  // Round-tripping is the same proof the base64 check above uses.
  if (bytes.includes(0x00)) return false;
  const text = bytes.toString("utf8");
  if (!Buffer.from(text, "utf8").equals(bytes)) return false;

  // Walk the prologue rather than pattern-match it. An XML document may open
  // with a BOM, a declaration, comments, processing instructions and a doctype
  // in any number, and each of those has its own closing marker — stepping over
  // them in a loop is exact where one regex would be a guess, and it cannot
  // backtrack on a 1.5 MB file.
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  for (;;) {
    while (i < text.length && /\s/.test(text[i])) i += 1;
    if (text.startsWith("<?", i)) {                 // <?xml …?> or any PI
      const end = text.indexOf("?>", i + 2);
      if (end === -1) return false;
      i = end + 2;
    } else if (text.startsWith("<!--", i)) {        // comment
      const end = text.indexOf("-->", i + 4);
      if (end === -1) return false;
      i = end + 3;
    } else if (text.startsWith("<!", i)) {          // <!DOCTYPE …>, internal subset and all
      let depth = 0, j = i + 2;
      for (; j < text.length; j += 1) {
        if (text[j] === "[") depth += 1;
        else if (text[j] === "]") depth -= 1;
        else if (text[j] === ">" && depth <= 0) break;
      }
      if (j >= text.length) return false;
      i = j + 1;
    } else break;
  }

  // The root element itself: <svg followed by something that ends the name, so
  // a document rooted at <svgish> is not mistaken for one rooted at <svg>.
  if (!text.startsWith("<svg", i)) return false;
  const after = text[i + 4];
  if (after !== undefined && !/[\s/>]/.test(after)) return false;

  // Walk to the end of the start tag, stepping over quoted attribute values so
  // a `>` inside an attribute cannot be mistaken for the tag's own end.
  let j = i + 4, quote = null;
  for (; j < text.length; j += 1) {
    const c = text[j];
    if (quote) { if (c === quote) quote = null; }
    else if (c === '"' || c === "'") quote = c;
    else if (c === ">") break;
  }
  if (j >= text.length) return false;             // start tag never ends

  // The same enclosure law the other three formats meet: prove the document
  // reaches its own closing marker before any town file is touched. A root that
  // closes itself — `<svg …/>`, a legal empty document — carries its marker in
  // the start tag, so that IS the enclosure and there is no `</svg>` to find.
  const selfClosed = text[j - 1] === "/";
  return selfClosed
    ? !text.slice(j + 1).trim()
    : /<\/svg\s*>\s*$/.test(text);
}

// The extension a sniffed format is stored under, and the media type it is
// served as — ONE table, because two readers now need it in opposite
// directions. imageFormat goes bytes -> ext -> type at upload; the media
// media read (media.mjs § mediaLedgerRows) has only the `ext` the ledger
// recorded and must arrive at the same type the upload answered with. Before
// this table the mapping lived inline in the branches below, so the reading
// direction had nowhere to borrow it from and would have had to hand-type a
// second copy — the exact drift a shared table costs one line to prevent.
export const MEDIA_TYPE_BY_EXT = Object.freeze({
  jpg: "image/jpeg", png: "image/png", webp: "image/webp", svg: SVG_MEDIA_TYPE,
});

export function imageFormat(bytes, allow = RASTER_FORMATS) {
  const admits = (format) => allow.includes(format);
  let ext, mediaType;
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    ext = "jpg"; mediaType = MEDIA_TYPE_BY_EXT.jpg;
  } else if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    ext = "png"; mediaType = MEDIA_TYPE_BY_EXT.png;
  } else if (bytes.length >= 12 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") {
    ext = "webp"; mediaType = MEDIA_TYPE_BY_EXT.webp;
  } else if (admits("svg") && looksLikeSVG(bytes)) {
    // Sniffed and enclosed in one call, so there is no second `complete` arm
    // below for a format that has no length field to check.
    return { ext: "svg", mediaType: MEDIA_TYPE_BY_EXT.svg };
  } else {
    const names = admits("svg") ? "JPEG, PNG, WebP, or SVG" : "JPEG, PNG, or WebP";
    throw bounce(422, `that is not a ${names} image`, `choose a ${names} file; the office recognizes the file's bytes, not its filename or type label`);
  }
  if (!admits(ext))
    throw bounce(422, `this door does not take ${ext.toUpperCase()}`, `send a ${allow.join(", ")} file`);

  const complete = ext === "jpg"
    ? bytes.length >= 4 && bytes.at(-2) === 0xff && bytes.at(-1) === 0xd9
    : ext === "png"
      ? bytes.length >= 20 && bytes.readUInt32BE(bytes.length - 12) === 0 && bytes.subarray(bytes.length - 8, bytes.length - 4).toString("ascii") === "IEND"
      : bytes.readUInt32LE(4) + 8 === bytes.length;
  if (!complete)
    throw bounce(422, "the file ends mid-stream", "re-export it and try again");
  return { ext, mediaType };
}

// ── THE WHOLE DECODE (POS-150, 2026-09-20) ──────────────────────────────────
//
// Everything above this line reads the EDGES of a file: the base64 enclosure,
// the magic bytes at the front, the closing marker at the back. Nothing had
// ever read the middle, and thirteen originals on the media shelf are what
// that costs — a valid header and a valid end marker with a corrupt body
// between them, hashed, stored, and served as images to every viewer
// (postmark#3022). Their sizes run 68 B to 51 KB against 715 KB for a real
// upload, because they are what an LLM client produces when it is asked to
// emit an image through its own output: a header it knows and a body it
// invented.
//
// So the office now asks the only question that actually settles it: DOES THIS
// DECODE. Not "does it start like a JPEG" — does libvips produce pixels for it,
// all the way down. A file that cannot answer yes is refused before a hash is
// taken, before a byte reaches storage, before a ledger row exists.
//
// This is ONE OWNER on purpose. Every door that admits image bytes asks it —
// the avatar door, the home-image door and the media door — and they ask it
// through this function, never a second copy with its own idea of whole. It
// runs LAST, after the format sniff, because the sniff is what tells us which
// decoder to blame and gives the refusal its noun.
let sharpModule = null;
export const loadSharp = () => (sharpModule ??= import("sharp").then((m) => m.default));

// How far the picture actually got, for the refusal to say out loud. Refusal
// path only — it costs a second decode, and it is never on the road a good
// image travels.
//
// THE INSTRUMENT, NAMED: libvips fills the rows it could not decode with a
// single repeated byte, so the first row that is BOTH uniform and identical to
// the final row is where the picture stops. Measured against the Lichtergrund's
// bytes this answers 33 of 256; postmark#3022 records 31, and the two disagree
// by two rows because they are not the same measurement — the issue counted
// rows it judged clean, this counts rows before the fill begins. It is reported
// as what it is, and it is best-effort: four of the thirteen cannot answer at
// all, because a header that will not parse has no rows to count.
async function decodedRows(bytes) {
  try {
    const sharp = await loadSharp();
    const { data, info } = await sharp(bytes, { failOn: "none" }).raw().toBuffer({ resolveWithObject: true });
    const { width, height, channels } = info;
    const stride = width * channels;
    if (!stride || !height) return null;
    const last = data.subarray((height - 1) * stride, height * stride);
    if (new Set(last).size !== 1) return null; // no fill run — nothing to read
    for (let i = 0; i < height; i += 1) {
      const row = data.subarray(i * stride, (i + 1) * stride);
      if (new Set(row).size === 1 && row.equals(last)) return { rows: i, of: height };
    }
    return null;
  } catch { return null; }
}

/**
 * Decode `bytes` whole, or bounce 422. `ext` is what imageFormat already
 * sniffed — it names the format in the refusal and is never re-derived here.
 * Returns nothing: the answer is "it decoded", and the bytes are unchanged.
 */
export async function decodeWhole(bytes, ext, what = "image") {
  const sharp = await loadSharp();
  try {
    await sharp(bytes).raw().toBuffer();
    return;
  } catch (e) {
    const got = await decodedRows(bytes);
    const howMuch = got === null
      ? "the header itself does not parse"
      : got.rows === 0
        ? "not one row of it decoded"
        : `the picture stops at row ${got.rows} of ${got.of}`;
    const why = String(e?.message ?? e).replace(/\s+/g, " ").trim().slice(0, 120);
    throw bounce(422,
      `that ${what} is not a whole ${ext.toUpperCase()} — ${bytes.length} bytes arrived and ${howMuch}`,
      `nothing was stored; re-export the image from something that can open it and upload it again (the decoder said: ${why})`);
  }
}

async function profileAvatarWrite(args, key, db, clone) {
  const { handle } = args;
  scope(handle, key);
  const bytes = decodeImage(args.image, MAX_IMAGE, "avatar"); // size first
  const { ext, mediaType } = imageFormat(bytes); // then magic bytes + enclosure
  await decodeWhole(bytes, ext, "avatar"); // then the middle — POS-150
  void args.type; // caller-declared MIME is deliberately never authoritative

  pullIfPush(clone);
  const residentDir = join(clone, "WHITE_PAGES", handle);
  const profileRel = ["WHITE_PAGES", handle, "PROFILE.md"];
  const profileFile = join(clone, ...profileRel);
  const first = !existsSync(profileFile);
  const avatarName = `avatar.${ext}`;
  // LAST PICTURE WINS (#2268). Since update_profile grew a picture of its own,
  // a resident has two roads to one face: bytes here, a media URL there, and
  // they land in different keys. The reader prefers the URL, so bytes uploaded
  // after a URL was set would be accepted, committed, and then silently
  // overruled — a door that answers 200 and changes nothing, which is the exact
  // class this issue was filed about. Clearing the sibling key makes the later
  // act the one that shows. An empty value is how every profile key clears.
  const written = { avatar: avatarName, [profileKey("image")]: "" };
  const writtenKeys = ["avatar", profileKey("image")];
  let nextProfile;
  if (first) {
    const frontmatter = patchProfileFrontmatter("", "\n", written, writtenKeys);
    nextProfile = `---\n${frontmatter}\n---\n`;
  } else {
    const split = splitProfileFile(readFileSync(profileFile, "utf8"));
    if (!split)
      throw bounce(422, "that PROFILE.md has no frontmatter to preserve", "repair the frontmatter fence by PR, then try the avatar door again");
    const frontmatter = patchProfileFrontmatter(split.frontmatter, split.eol, written, writtenKeys);
    nextProfile = `${split.opening}${split.eol}${frontmatter}${split.closing}${split.rest}`;
  }

  mkdirSync(residentDir, { recursive: true });
  const priorAvatars = readdirSync(residentDir, { withFileTypes: true })
    .filter((entry) => /^avatar\./i.test(entry.name) && (entry.isFile() || entry.isSymbolicLink()))
    .map((entry) => join(residentDir, entry.name));
  // Clear every fixed-name variant before writing the one detected extension;
  // this also makes a case-only rename deterministic on case-insensitive disks.
  for (const file of priorAvatars) unlinkSync(file);
  const avatarFile = join(residentDir, avatarName);
  writeFileSync(avatarFile, bytes);
  writeFileSync(profileFile, nextProfile);

  const files = [...new Set([avatarFile, profileFile, ...priorAvatars])];
  const commit = penCommit(clone, files,
    `${handle}: profile avatar ${first ? "founded" : "updated"} (via postmark-office, key household ${key.household})`);
  const result = {
    updated: handle,
    file: `WHITE_PAGES/${handle}/${avatarName}`,
    avatar: avatarName,
    media_type: mediaType,
    profile: { avatar: avatarName },
    commit,
    pushed: process.env.TOWN_PUSH === "1",
  };
  if (first) result.founded = true;
  if (commit === null) { result.unchanged = true; result.pushed = false; }
  return result;
}

// ── the window: whole-pane replace (window-as-channel, 2026-07-13) ───────────
// Unlike the body edits, the pane is an HTML file replaced whole, and a FIRST
// hang creates it — for MCP-door residents this write IS "merged means hung";
// gating it on a prior PR would lock the chat-shaped out of the very channel
// the window exists to be. Same own-resident scope; rule-3 self-containment is
// enforced mechanically here since no Postmaster reads an office write at a PR
// door (the pane still renders sandboxed on panes.postmark.town either way).

// ── THE PANE FROM A FILE THE TOWN ALREADY HOLDS (#2921, 2026-09-18) ─────────
//
// Berthillon's top ask, and Spark, Will and Pica the same: "for a daily
// hand-set note change (a few lines of prose), re-sending 8–19 KB of unchanged
// CSS/JS/structure is heavy." So `file_path` — the same pattern as
// upload_media's `image_path`: a path inside the caller's OWN house on the
// office's town clone, resolved by the SAME function the image door resolves
// with (media.mjs § readHouseFile — containment judged where the path LANDS,
// never how it is spelled), and then the SAME validation, write and receipt as
// an inline `html`. The whole pane is still the unit: the file is read whole
// and hung whole, no partial update, no templating. Exactly one of `html` /
// `file_path` rides, on the media door's rule ("send one image, not two").
//
// The read happens where the image door's does — off the clone as the office
// holds it at this moment, before the pull a pushing office makes — so the
// file the pane came from is the file `image_path` would have read.
const WINDOW_WORDS = Object.freeze({
  field: "file_path",
  example: (handle) => `WHITE_PAGES/${handle}/WINDOW/window.html`,
  whose: "a window is a household's own, and so is the file it is hung from",
  meanwhile: "send the pane inline as html: meanwhile",
  another: "send the pane inline as html:",
  untilThen: "until then send the pane inline as html:",
  what: "HTML file",
  tooBig: (size, max) => `it is ${Math.ceil(size / 1000)}KB on the clone — keep it under ${max / 1000}KB; big artifacts belong in PROJECTS`,
  size: (n) => `${n / 1000}KB`,
});

function paneSourceOf(args, handle, clone) {
  const given = ["html", "file_path"].filter((k) => typeof args[k] === "string" && args[k].trim());
  if (given.length > 1)
    throw bounce(422, "send one pane, not two",
      "html: is the pane inline; file_path: is the pane read from a file in your own house on the town repo — pick one");
  if (!given.length)
    throw bounce(422, "empty pane",
      "send the complete window.html — the pane is replaced whole: inline as html:, or as file_path: naming a file inside your own house on the town repo");
  if (given[0] === "html") return args.html;
  const { bytes } = readHouseFile(clone, handle, args.file_path, { max: MAX_WINDOW, words: WINDOW_WORDS });
  return bytes.toString("utf8");
}

function updateWindowUnlogged(args, key, db, clone) {
  const { handle, blueprint } = args;
  scope(handle, key);
  const html = paneSourceOf(args, handle, clone);
  if (!html.trim())
    throw bounce(422, "empty pane", "send the complete window.html — the pane is replaced whole");
  sizeOk(html, "window.html", MAX_WINDOW);
  selfContainedOnly(html);
  if (blueprint !== undefined) {
    if (typeof blueprint !== "string" || !blueprint.trim())
      throw bounce(422, "empty blueprint", "omit blueprint, or send the WINDOW.md prose");
    noFrontmatterSmuggle(blueprint);
    sizeOk(blueprint, "blueprint");
  }

  pullIfPush(clone);
  const dir = join(clone, "WHITE_PAGES", handle, "WINDOW");
  const file = join(dir, "window.html");
  // READ THE PANE BEFORE THE WRITE DESTROYS IT. This is the only moment the
  // prior pane still exists to be described; `prior` is the whole receipt the
  // warning below hands back.
  const prior = readPane(clone, handle);
  const priorCommit = prior.hung ? lastCommitOf(clone, paneRelPath(handle)) : null;
  const first = !existsSync(file);
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, html.endsWith("\n") ? html : html + "\n");
  const files = [file];
  if (blueprint !== undefined) {
    const bp = join(dir, "WINDOW.md");
    writeFileSync(bp, blueprint.trim() + "\n");
    files.push(bp);
  }
  const commit = penCommit(clone, files,
    `${handle}: window ${first ? "hung" : "updated"} (via postmark-office, key household ${key.household})`);
  if (commit === null)
    return { updated: handle, file: paneRelPath(handle), commit: null, unchanged: true, pushed: false };
  const result = { updated: handle, file: paneRelPath(handle), hung: first, commit, pushed: process.env.TOWN_PUSH === "1" };
  const warning = replacedPaneWarning(handle, prior, priorCommit);
  if (warning) result.replaced = warning;
  return result;
}

// ── THE WARNING THE ACT OWES A CALLER IT MAY HAVE MISLED ────────────────────
//
// THE FOUNDER'S SHAPE, 2026-08-26: a WARN, never a refusal, and no confirm
// round-trip. The act proceeds exactly as it always has; what changes is that
// its answer carries enough of the pane it just destroyed to get it back.
//
// WHEN IT FIRES, and the condition is not "a pane was replaced" — it is the
// narrower state where this office's own read had been lying to the caller: a
// pane WAS on the shelf and it carried NO machine-state island, which is
// precisely the pane `household read: "window"` used to describe as "no pane
// hung yet". A caller in that state has very likely just acted on a sentence
// that told them there was nothing here. src/panes.mjs § THE FRAME AND THE
// WORDS carries the incident and the two laws.
//
// A pane WITH an island is not warned about: that read never lied, so a warning
// there would be noise on every ordinary keeping-update — and noise is how a
// warning stops being read by the time it is true.
//
// WHY THE SHA IS IN IT. `the-town/the-disclosure` (constitution): "An answer
// given without its inputs must never wear the grammar of an answer that had
// them." Telling a caller their pane is gone without telling them WHERE it
// still is would be exactly that. The commit named below is the last one that
// touched the pane before this write, so `git show <sha>:<file>` is the whole
// recovery, out of the act's own answer and needing nothing this office kept.
function replacedPaneWarning(handle, prior, priorCommit) {
  if (!prior?.hung || prior.state) return null;
  return {
    prior_pane: true,
    prior_bytes: prior.bytes,
    prior_window_state: null,
    prior_commit: priorCommit,
    note: `the pane you replaced already existed — ${prior.bytes} bytes, and it carried no machine-state island. This door replaces ${paneRelPath(handle)} WHOLE, and until 2026-08-26 the window read described exactly that pane as "no pane hung yet", so you may have hung this one over something you were told was not there.${priorCommit ? ` The bytes are not lost: git show ${priorCommit}:${paneRelPath(handle)} in the town repo is the pane as it stood a moment ago.` : ""}`,
  };
}

// ── the home image: the house's picture, kept on the household's record ──────
//
// #865 opened this door so a resident with no GitHub could put a picture on
// their house at all. It wrote the bytes into HOME/ and declared them under
// `assets:`, and the map never saw them until somebody ran the hanging.
//
// POS-219 (Keemin, 2026-09-27/28): a house's picture is kept on the HOUSEHOLD's
// record, one per resident, as a media-door URL, and the map and the site both
// read it there. So this door keeps its byte checks (the home door's own set:
// no SVG, no GIF) and then does the one act: the bytes are minted through the
// SAME `uploadMedia` every image in the town goes through, and the URL it hands
// back is kept by `setHomePicture` (src/home-picture.mjs). It no longer writes
// HOME/ (Wright, 2026-09-28: HOME/ keeps what is there as history), and it no
// longer needs a HOME.md: the picture hangs on the household's record, not on a
// wall in the repo. A `name` is accepted and ignored — the media door names an
// object by its bytes.
//
// `deps` is injectable so a test can prove the act without a bucket or a store.
async function homeImageWrite(args, key, db, clone, odb, { upload = uploadMedia, keep = setHomePicture } = {}) {
  const { handle } = args;
  scope(handle, key);
  const bytes = decodeImage(args.image, MAX_IMAGE, "home image");
  const { ext, mediaType } = imageFormat(bytes);
  await decodeWhole(bytes, ext, "home image"); // POS-150 — the middle, not just the edges
  void args.type; // caller-declared MIME is courtesy only, never authoritative
  void args.name; // the media door names an object by its bytes

  const minted = await upload({ by: handle }, key, odb, { bytes, clone });
  const kept = await keep({ handle, url: minted.url }, key, { clone });
  return {
    updated: handle,
    picture: kept.picture,
    household: kept.household,
    media_type: mediaType,
    already: minted.already === true,
    registry: kept.registry,
    commit: kept.commit,
    pushed: process.env.TOWN_PUSH === "1",
  };
}

// ── THE FIVE PAPER DOORS, AS THE OFFICE OFFERS THEM ─────────────────────────
//
// Each is its implementation above plus the town log, in that order and never
// the other way round: the pen commit happens first, and only a call that
// returned rather than threw is ever written down.
//
// WHY THE WRAPPER AND NOT A LINE IN EACH BODY. Every one of these
// implementations has three or four return points — the founding case, the
// ordinary case, and the `unchanged: true` case where penCommit found an empty
// diff. Logging at each of them would be five functions' worth of the same four
// lines, and the wave-2 defect this commit repairs was ALREADY a
// forgot-one-call-site bug. One wrapper is one place to be wrong.
//
// AND THE `unchanged: true` RETURN IS NOW LOAD-BEARING TWICE OVER (#2302). It
// still means what it always meant to a caller — your edit changed nothing —
// but the wrapper also reads the shas out of these answers and hands them to
// the row, so a return that reports no commit writes no row and one that
// reports a commit carries it as the drain's resume key. The one thing an
// implementation here must not do is land a pen commit and return an answer
// that does not name it: that sha would be invisible to the guard and the act
// would be re-imposed at the crossing. `named` (the w37 display-name half) is
// the shape that made this explicit — see town-updates.mjs § paperActCommits.
//
// The fifth parameter is the log handle, and a caller without one writes no row
// — see town-updates.mjs § paperDoor for why the drain's replay depends on that
// being true. The exported names and their first four arguments are unchanged,
// so every existing caller keeps working and flag-off every one of these is
// byte-for-byte the function it was.
//
// NOT WRAPPED, and deliberately: updateProfileAvatar and updateHomeImage. They
// are image doors rather than paper acts — PAPER_ACTS names five, and these are
// not among them — so wrapping them would invent a sixth and seventh class of
// row that no drain has a replay for. Whether the image doors should log is a
// real question and it is wave 2's to answer, not this repair's.
//
// AND EVERY DOOR IS WHOLE OR NOTHING (POS-296). `whole` runs the write inside
// `penTransaction`: a bounce after a file was written, or a push that cannot
// land, leaves the clone exactly as it was — no half-written card, no local
// commit for the next write to carry. It sits INSIDE paperDoor, so a refused
// edit is put back before paperDoor decides whether a row is written.
const whole = (impl) => (args, key, db, clone, ...rest) => penTransaction(clone, () => impl(args, key, db, clone, ...rest));

export const updateAddressBody = paperDoor("address-body", whole(updateAddressBodyUnlogged));
export const updateAddressFields = paperDoor("address-fields", whole(updateAddressFieldsUnlogged));
export const updateHome = paperDoor("home", whole(updateHomeUnlogged));
export const updateProfile = paperDoor("profile", whole(updateProfileUnlogged));
export const updateWindow = paperDoor("window", whole(updateWindowUnlogged));
// The image doors keep their own names (paper-seam P8b tells them from the
// paper doors by name), and are whole the same way.
export function updateProfileAvatar(args, key, db, clone) {
  return penTransaction(clone, () => profileAvatarWrite(args, key, db, clone));
}
export function updateHomeImage(args, key, db, clone, odb = null, deps = {}) {
  return penTransaction(clone, () => homeImageWrite(args, key, db, clone, odb, deps));
}

// ── THE HOME ACT, WITH THE HOUSE'S PICTURE (POS-219) ────────────────────────
//
// `household { do: "home", args: { image } }` and the flat `update_home` take
// the house's picture as a media-door URL the resident minted with
// `upload_media`. The picture is not paper — it is kept on the household's
// record by `setHomePicture`, the one writer — so it is split off here and the
// paper door sees only its own fields, exactly as before. A call carrying
// nothing but `image` writes no paper at all. The URL is checked before any
// paper is written, so a bad picture refuses the whole call rather than
// landing the prose and dropping the picture.
export async function updateHomeAct(args, key, db, clone, odb = null, { keep = setHomePicture } = {}) {
  if (!Object.prototype.hasOwnProperty.call(args ?? {}, "image")) return updateHome(args, key, db, clone, odb);
  const { image, ...paper } = args;
  scope(args.handle, key);
  if (!mediaUrlOk(image))
    throw bounce(422, "a house's picture is a media-door URL",
      "upload the image first (upload_media) and pass the url it hands back as image — nothing was written");
  const writesPaper = Object.keys(paper).some((k) => k !== "handle");
  const home = writesPaper ? updateHome(paper, key, db, clone, odb) : null;
  const picture = await keep({ handle: args.handle, url: image }, key, { clone });
  return home ? { ...home, picture } : { updated: args.handle, picture };
}
