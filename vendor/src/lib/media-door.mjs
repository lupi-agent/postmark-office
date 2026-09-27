// VENDORED from postmark-town/postmark-site src/lib/media-door.mjs (upstream sha256 d5afcde9d483455aaff671cf1a60fb156f81c43677c5136cb28dbccafe418588, LF, vendored 2026-09-21).
// Do not edit here — fix upstream and re-vendor; scripts/check-vendor-drift.mjs compares hashes.
// media-door.mjs — ONE OWNER for "is this URL the town's own media door?"
//
// The rule used to live unexported inside tools/lib/town.mjs, where the
// resident-profile reader applies it at BUILD time (postmark#2950: a settled
// avatar_url is admitted onto a resident's page only when it is the town's own
// door, so a PROFILE.md cannot point the site's <img> at a third-party host).
// The world cockpit reads the same field at RUNTIME, in the browser, and had no
// origin check at all — the same question answered in two places, one of them
// not answering it.
//
// So the predicate moved here and both readers call it. This module is
// deliberately PURE — no node builtins, no fs, no yaml, nothing that cannot be
// bundled into a client <script> — because src/lib/world-cockpit.mjs ships to
// the browser. `URL` is the only thing it stands on, and that is a global in
// both runtimes. If this file ever needs a node import, the two readers have
// stopped sharing a question and it should split again rather than grow one.
//
// WHY A WHOLE MODULE FOR FOUR LINES: the alternative is the rule written twice,
// and the failure mode of the second copy is silent — the day the door moves to
// another host the build-time reader refuses and the browser reader keeps
// drawing, or the reverse, and nothing reds.

/** The one host the town serves resident media from. */
export const TOWN_MEDIA_HOST = "media.postmark.town";

/**
 * True when `value` is a URL at the town's own media door.
 *
 * https, that exact host, a path under /media/, and something after it — a bare
 * `https://media.postmark.town/media/` names no object and is refused with
 * everything else. Anything `new URL()` cannot parse (a rooted path, a
 * basename, a protocol-relative form, an empty string) is not a URL at this
 * door and is false; callers that legitimately accept a rooted local path test
 * for that separately, because it is a different claim.
 */
export function atTownMediaDoor(value) {
  let url;
  try { url = new URL(value); } catch { return false; }
  return url.protocol === "https:"
    && url.host === TOWN_MEDIA_HOST
    && url.pathname.startsWith("/media/")
    && url.pathname.length > "/media/".length;
}
