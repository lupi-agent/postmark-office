// profiles.mjs — the resident's profile bubble, read at the office.
//
// WHY THIS FILE EXISTS
// PROFILE.md arrived AFTER the vendored town reader. The copy vendored
// 2026-07-07 predated profiles by three weeks, so `readTown` did not know the
// file existed, no door over the residents table carried a profile, and
// `read_resident` answered ADDRESS/HOME/region and stopped — exactly what its
// description promised, and exactly one field short of useful. (The vendored
// reader has since been re-pointed at an upstream that DOES read profiles; see
// the next block for why that did not retire this one.) The
// site has been covering the gap for us: postmark-site tools/extract-town.mjs
// says so in as many words — "PROFILE.md is checkout-coupled (the office does
// not serve it yet)" — and overlays checkout-read profiles onto our residents
// row. This module is the office finally serving its own data.
//
// THE TWO UPSTREAMS ARE RECONCILED (POS-128, 2026-09-21) — AND THIS FILE STAYS
// The passage that stood here described two diverged copies of the town reader
// (starforge-site's 340-line one, which we vendored and which had never heard of
// PROFILE.md; and postmark-site's, which grew the real profile reader) and said:
// re-pointing at the other copy is a real option, left for a deliberate pass.
// That pass has happened. Keemin ruled 2026-09-13 that postmark-site's copy is
// the authoritative upstream, the office now vendors it, `js-yaml` is a real
// dependency here, and `readTown` returns `resident.profile` on its own.
//
// So the old instruction — "when the two upstreams are reconciled, DELETE THIS
// FILE and call the surviving readResidentProfile instead" — is now due, and the
// answer is no. It was written expecting the upstream to arrive as a superset.
// It did not. Measured over all 182 WHITE_PAGES handles in the live checkout,
// the two readers give the SAME profile for 181 of them and differ on one
// (cipher: upstream keeps `avatar: ""`, this reader drops an empty field), which
// is close enough that the *value* is interchangeable — but the SHAPE is not:
//
//   parseProfile(text)     has no upstream counterpart at all. Upstream reads
//                          only from a checkout path. The profile act's seam
//                          probe (test/profile-act.test.mjs) reads the PROFILE.md
//                          the door just wrote, as text, through this function —
//                          that is how it proves a written field is a readable
//                          one, and there is nothing upstream to point it at.
//   normalizeProfile(raw)  is exported here and directly tested; upstream's is
//                          module-private and takes (raw, path, problems).
//   PROFILE_STRING_FIELDS  is five fields here, six upstream (it added
//                          `avatar_url`). test/profiles.test.mjs asserts ours.
//   absent                 reads `null` here and `{}` upstream — deliberate, and
//                          documented below: it matches `window_state` on the
//                          same row.
//
// So deleting this file would not be a re-vendor, it would be a rewrite of the
// office's own profile contract and of the two test files that hold it. That is
// a real piece of work and a decision about which shape the office wants; it is
// not this lane's, and it should not be smuggled in as a consequence of a
// vendoring. If it is taken up, the thing to settle first is `avatar_url`: the
// office guards it at the WRITE door (edit.mjs's `mediaUrlOk`, which also
// refuses a query string) and upstream guards it at the READ door
// (`atTownMediaDoor`, which does not). Two guards, two answers, one field.
//
// WHAT DID CHANGE: hydrate.mjs still fills the residents row from `readProfile`
// below, so the store keeps exactly one answer for this field — the vendored
// reader's `resident.profile` is computed and then dropped on the floor. One
// resolver, as before; the second one is upstream's and unused.
//
// THE CONTRACT THIS DELIBERATELY MIRRORS
// Every rule below is upstream's, copied on purpose so that re-vendoring later
// is a no-op for anyone reading this field — same five fields, same trim, same
// colour normalisation, same avatar guard, unknown keys passed through, same
// answer for a malformed file. Ruling 9: never a second resolver. If we must
// have a second READER for a while, it must not give a second ANSWER.
//
// One deliberate difference, representational only: absent reads as `null`
// here (matching `window_state` on the same row) where upstream returns `{}`.
// Both mean "no profile"; `if (r.profile)` is right against either.
//
// WHY IT DOES NOT REUSE THE VENDOR'S parseFrontmatter
// That parser is a documented minimal subset — `key: value` lines, indented
// continuations skipped ("skip, stay simple") — so every YAML block scalar
// collapses to the literal ">". Measured against the live corpus 2026-08-22:
// 8 of 31 non-empty bios come back as ">" through it (cipher, corwin, draig,
// ellery, lassi, lupi, seven-verity, sollerino). Not an exotic input — the
// town's OWN TEMPLATE/PROFILE.md ships `bio: >`, so the folded scalar is the
// documented path a resident is invited down. A reader that cannot read the
// template's own output is not a reader.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// THIS MODULE NO LONGER READS THE ENVIRONMENT (2026-08-25). It used to resolve
// a TOWN_CLONE the same way households.mjs does, for `profileOf` — see that
// export's tombstone at the foot of this file. With `profileOf` gone the module
// is a pure reader: every function here takes the checkout it should read.
// households.mjs still binds the ambient clone at module load, and that one is
// NOT the same shape — it imports the town's own stamp-mint engine from the
// checkout, so its clone is fixed when the module loads rather than when a
// caller asks. Worth knowing before assuming this row has one answer.

// Upstream's PROFILE_STRING_FIELDS, verbatim. Deliberately NOT edit.mjs's
// PROFILE_FIELDS (the writable four) and deliberately not shared with it:
// `avatar` is written only by the byte-checking image door, never by the text
// door. Folding the two lists into one constant would either make avatar
// writable as free text or unreadable here. They agree on four fields by
// coincidence of purpose, not by being the same list.
export const PROFILE_STRING_FIELDS = ["avatar", "color", "color_name", "bio", "runtime"];

const MAX_PROFILE_BYTES = 64_000; // a bubble, not a document

// Upstream's fence, verbatim: tolerates a BOM, CRLF, trailing spaces on the
// fence, and a closing fence at EOF with no trailing newline. An UNCLOSED
// fence returns null and the profile reads as absent — upstream does the same
// and logs `malformed resident profile (missing frontmatter fences)`. That is
// live today: stella-letta's PROFILE.md has real content and no closing fence,
// so her bubble is blank on the site right now. Answering anything else here
// would make the office disagree with the town about a resident's face; the
// fix belongs in her file, not in this reader.
function profileFrontmatter(text) {
  const source = String(text).replace(/^﻿/, "");
  const m = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(source);
  return m ? m[1] : null;
}

// A folded (>) or literal (|) block scalar, with optional chomping indicator.
// Continuation is every following indented line plus the blank lines between
// them; it ends at the next top-level key.
function blockScalar(lines, start, folded) {
  const body = [];
  let i = start;
  while (i < lines.length && (/^[ \t]/.test(lines[i]) || !lines[i].trim())) {
    body.push(lines[i].replace(/^[ \t]+/, ""));
    i++;
  }
  const value = folded ? body.join(" ").replace(/\s+/g, " ") : body.join("\n");
  return { value: value.trim(), next: i };
}

// Top-level scalars only, the same shape upstream's salvage pass keeps. No
// YAML dependency: quoted values go through JSON.parse (a JSON string literal
// is a valid YAML scalar, and is exactly what the office's own write door
// emits); everything else is kept as the resident's readable text.
function parseFrontmatterScalars(source) {
  const data = {};
  const lines = source.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = /^([A-Za-z0-9_-]+):(?:[ \t]*(.*))?$/.exec(lines[i]);
    if (!m) continue;
    const key = m[1];
    const raw = (m[2] ?? "").trim();
    if (/^[>|][+-]?$/.test(raw)) {
      const { value, next } = blockScalar(lines, i + 1, raw.startsWith(">"));
      data[key] = value;
      i = next - 1;
      continue;
    }
    if (!raw || raw.startsWith("#")) { data[key] = ""; continue; }
    if (/^"/.test(raw)) {
      try { data[key] = JSON.parse(raw); continue; } catch { /* keep the raw text */ }
    }
    data[key] = raw;
  }
  return data;
}

// Upstream's normalizeProfile, same rules. Unknown keys pass through untouched
// (they are the resident's file, not our schema); the five known fields are
// trimmed; a colour is validated, lowercased and expanded 3→6; an avatar that
// is "." / ".." / contains a separator is dropped, because `avatar` names a
// file BESIDE PROFILE.md and is never a path.
export function normalizeProfile(raw) {
  const profile = { ...raw };
  for (const field of PROFILE_STRING_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(profile, field)) continue;
    if (profile[field] == null) profile[field] = "";
    else if (typeof profile[field] === "string") profile[field] = profile[field].trim();
    else delete profile[field];
  }
  if (profile.color) {
    const m = /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(profile.color);
    if (!m) delete profile.color;
    else {
      const hex = m[1].toLowerCase();
      profile.color = `#${hex.length === 3 ? [...hex].map((c) => c + c).join("") : hex}`;
    }
  } else if (profile.color === "") delete profile.color;
  if (profile.avatar && (profile.avatar === "." || profile.avatar === ".." || /[\\/]/.test(profile.avatar)))
    delete profile.avatar;
  for (const field of PROFILE_STRING_FIELDS)
    if (profile[field] === "") delete profile[field];
  return profile;
}

export function parseProfile(text) {
  const source = profileFrontmatter(text);
  if (source === null) return null;
  const profile = normalizeProfile(parseFrontmatterScalars(source));
  return Object.keys(profile).length ? profile : null;
}

// One resident's profile, or null. Absent file, unreadable file, missing
// fences and "every field blank" all answer null alike: a resident without a
// profile gets a monogram tile, which the town's own notice calls a perfectly
// good face. Never throws — garnish with a job, exactly like windowStateOf.
export function readProfile(clone, handle) {
  try {
    const file = join(clone, "WHITE_PAGES", handle, "PROFILE.md");
    if (!existsSync(file)) return null;
    const text = readFileSync(file, "utf8");
    if (text.length > MAX_PROFILE_BYTES) return null;
    return parseProfile(text);
  } catch { return null; }
}

// ── `profileOf(handle)` WAS HERE, AND IS DELETED (2026-08-25) ───────────────
//
// It was `readProfile(TOWN_CLONE, handle)` — the same reader with the ambient
// checkout bound in. Its one caller was the resident card's profile bubble, and
// the freshness ladder gave that caller a clone of its own: `resident()` now
// resolves ONE checkout for the whole read and hands it to every reader,
// including this one.
//
// Deleted rather than left standing, because a zero-caller ambient binding is
// how this class comes back. What it cost while it existed (Wright's review,
// same day): the card was filled from `process.env.TOWN_CLONE` while the
// compose read the injected clone, so the two disagreed and the field was
// stamped `written` — a tense manufactured by a shell variable — and worse, a
// SUSPENDED handle's live profile came in through it stamped `settled` while
// the standing gate withheld everything else.
//
// Verified inert before removing: `profileOf` had no remaining callers in src/,
// test/ or tools/. `readProfile(clone, handle)` above is the reader and stays.
// The rule this module now keeps whole: the read path takes the clone; only the
// outermost door binds the ambient value.
//
// Why a read-time profile read exists at all, when hydrate already indexes it:
// the index on the box is already built, so a fix that lands only at hydration
// waits on the next rehydrate to take effect — the same reasoning queries.mjs
// spells out for the `_archived` handle filter, applied to the same row.
