// media.mjs — the media door: one image in, one permanent URL out.
//
// THE LAW THIS SERVES IS PLANTED, not stated here. logos/the-media stands on
// world main (674c359c) with two children, and the household read quotes all
// three off the record (household-media.mjs § the three marks). What follows
// is this file's own working notes, trued to those marks rather than competing
// with them — a comment may quote law, and must not out-vote it.
//
//   the-media            "The record stays prose: bytes live behind one door —
//                         content-addressed, household-grained, append-only; a
//                         mark carries the URL, never the bytes."
//   the-byte-accounting  "Byte-accounting is machinery, never record: quotas
//                         and sizes live office-side, and the record never
//                         learns a file's weight."
//   the-household-grain  "Media is a household's own: the quota walls by
//                         resident count, the uploading hand rides every row,
//                         and no other house writes on your wall."
//
// The lane a mark's `image:` field drinks from (the media ruling, 2026-08-15):
// a resident uploads bytes HERE, gets back a https://media.postmark.town/…
// URL, and hangs THAT on a mark. The mark record carries a pointer, never
// bytes — the world's repo stays prose, and the domain allowlist on the mark
// door means the only images the told world ever shows are ones that came
// through this door's byte validation. Two doors, one handler: POST /media
// (REST) and the upload_media tool (MCP) both land in uploadMedia below.
//
// Storage is Cloudflare R2, written with a zero-dependency SigV4 PUT — the
// office carries no SDK for one verb. Keys are content-addressed
// (media/<household>/<sha256>.<ext>), so the same bytes upload once and a
// re-send is answered with the same URL instead of a second object. Nothing
// here deletes: media is append-only in v1, and the quota is the wall. Beside
// each raster original the door puts two small copies at derivable names
// (`-96`, `-256` — § the small copies, below); they are the town's, not the
// household's, and the wall does not see them.
//
// The quota grain is the HOUSEHOLD — the credential grain, same as the
// anti-sybil floor — sized per resident it holds (20 MB each by default), so
// a one-resident household gets 20 MB and a three-resident founder household
// gets 60. The ledger lives in the office's own paperwork (odb — oauth.db, or
// the store's office_media once the office is switched: paperwork.mjs, POS-271),
// not the town repo: byte-accounting is machinery, NEVER record. (It read "not record"
// until the marks were planted; "never" is the record's word and this line is
// trued to it — the drift a header keeps when law arrives after the code.)
//
// Berths are excluded by design: a berth's residue is ephemeral (emissions
// only), and a durable object on a public URL is the opposite of ephemeral.
// Cosigned-and-upgraded berth keys carry a household and pass like any
// resident.
//
// Env (box: /etc/postmark-office.env): R2_ACCOUNT_ID, R2_ACCESS_KEY_ID,
// R2_SECRET_ACCESS_KEY, R2_BUCKET (default postmark-media), MEDIA_BASE
// (default https://media.postmark.town), MEDIA_QUOTA_BYTES (default 20 MB,
// per resident). Unconfigured ⇒ the door answers not-yet-open, honestly —
// the office deploys ahead of the credentials without lying about it.

import { createHash, createHmac } from "node:crypto";
import { lookup as dnsLookup } from "node:dns/promises";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join, resolve as resolvePath, sep } from "node:path";
import { decodeWhole, imageFormat, loadSharp, MAX_IMAGE, MEDIA_FORMATS, MEDIA_TYPE_BY_EXT } from "./edit.mjs";
import { asPaper } from "./paperwork.mjs";

const bounce = (code, defect, hint) => Object.assign(new Error(defect), { code, defect, hint });

const BUCKET = process.env.R2_BUCKET ?? "postmark-media";
export const MEDIA_BASE = (process.env.MEDIA_BASE ?? "https://media.postmark.town").replace(/\/+$/, "");
const QUOTA_PER_RESIDENT = Number(process.env.MEDIA_QUOTA_BYTES ?? 20 * 1024 * 1024);

export const mediaConfigured = () =>
  !!(process.env.R2_ACCOUNT_ID && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY);

// The allowlist the mark door enforces: a mark's image is one absolute URL on
// the town's own media host, path made of the unreserved characters this door
// itself mints. Anything else — other hosts, query strings, fragments, data:
// — is not an image the town serves, and bounces at the door rather than
// linting three surfaces later.
export const mediaUrlOk = (u) =>
  typeof u === "string" && new RegExp(`^${MEDIA_BASE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/[A-Za-z0-9][A-Za-z0-9/._-]*$`).test(u.trim());

const fmtMB = (n) => `${(n / 1024 / 1024).toFixed(n % (1024 * 1024) === 0 ? 0 : 1)} MB`;
const sha256hex = (data) => createHash("sha256").update(data).digest("hex");
const hmac = (key, data) => createHmac("sha256", key).update(data).digest();

// The FILE's table, created on first use. A paper runs it on its file only
// (paperwork.mjs § exec); the store's table is 032's.
export function ensureMediaTable(odb) {
  asPaper(odb).exec(`
    CREATE TABLE IF NOT EXISTS media (
      household TEXT NOT NULL, sha TEXT NOT NULL, ext TEXT NOT NULL,
      bytes INTEGER NOT NULL, by_handle TEXT NOT NULL, created INTEGER NOT NULL,
      PRIMARY KEY (household, sha))`);
}

// ── the media door's own arithmetic, in one home ────────────────────────────
//
// Everything below was inline in uploadMedia until media grew a READ
// (household { read: "media" }, 2026-08-23) and a second caller needed the same
// numbers. A read that recomputed the key grammar, the quota ceiling or the URL
// shape would be a second copy of law that already exists here — and the first
// divergence would be invisible, because both copies would look right on their
// own page. So the write calls these too: there is exactly one place where a
// media URL is minted and exactly one place where the wall is measured.

/** The object key a household's bytes are stored under — content-addressed, and
 *  the ONLY grammar r2Put's un-encoded canonical URI is safe for. */
export const mediaObjectKey = (household, sha, ext) => `media/${household}/${sha}.${ext}`;

/** The permanent URL those bytes answer at. Passes mediaUrlOk by construction —
 *  test/household-media.test.mjs holds that to account rather than assuming it. */
export const mediaUrlFor = (household, sha, ext) => `${MEDIA_BASE}/${mediaObjectKey(household, sha, ext)}`;

// ── THE SMALL COPIES BESIDE THE ORIGINAL (postmark#2940, Keemin 2026-09-18) ──
//
// "Isn't the rasterization just generally a good practice from a common sense
// standpoint considering images are rendered really small the majority of the
// time?" Yes. The map draws a home card at ~120 px and a face at ~50 px from
// whatever the resident uploaded — median 1.1 megapixels, 363 MB decoded for
// the town's 83 raster home pictures if every one is in view — so the door
// mints two small copies at upload and puts them beside the original, at names
// the viewer can DERIVE from the original's url without asking anyone:
//
//   media/<household>/<sha>-96.<ext>    a 96×96 square, centre-cropped the way
//                                       walkerFrameSVG's circle clips a face
//   media/<household>/<sha>-256.<ext>   256×286, the home card's own shape —
//                                       HOME_CARD in spectator/viewer.mjs is
//                                       52 wide by 44+14 tall, and the card
//                                       hangs its picture `xMidYMid slice`
//
// The mipmap every VTT mints. Same format as the original (a jpg stays a jpg),
// EXIF-oriented the way a browser shows the original, camera metadata not
// carried. THE ORIGINAL IS UNTOUCHED — same bytes, same name, same url; the
// copies are the TOWN'S derivative, not the household's upload, so they are
// never a ledger row and never count against the wall (the-byte-accounting:
// the quota is byte-accounting of what a household PUT, and nobody put these).
// An SVG mints none: a vector is already every size. A copy the door could
// not mint (a decoder the box lacks, a file libvips will not read) is logged
// and skipped — the viewer falls back to the original when a copy is not
// there — and NEVER refuses the upload: the resident's picture is the act, the
// copies are housekeeping. Existing originals get theirs from
// tools/media-thumbnails-backfill.mjs, by the operator's hand.
export const THUMB_VARIANTS = Object.freeze({
  96: Object.freeze({ w: 96, h: 96 }),
  256: Object.freeze({ w: 256, h: 286 }),
});
export const THUMB_SIZES = Object.freeze(Object.keys(THUMB_VARIANTS).map(Number));
/** The formats a copy is minted for — the rasters. `svg` is a MEDIA_FORMAT and
 *  deliberately not here. SPELLED HERE, not aliased from edit.mjs's
 *  RASTER_FORMATS: edit.mjs imports this file too, and when the server enters
 *  the cycle through edit.mjs that binding is still uninitialised while this
 *  module evaluates — an alias at load time threw at the office's front door
 *  (every server-spawning suite red, 2026-09-18) where the direct importers
 *  never saw it. test/media-thumbnails.test.mjs holds the two lists equal. */
export const THUMB_FORMATS = Object.freeze(["jpg", "png", "webp"]);
export const THUMB_QUALITY = 84; // the site's own dial (postmark-site tools/lib/images.mjs)
export const thumbObjectKey = (household, sha, ext, size) => `media/${household}/${sha}-${size}.${ext}`;
export const thumbUrlFor = (household, sha, ext, size) => `${MEDIA_BASE}/${thumbObjectKey(household, sha, ext, size)}`;

// sharp is loaded on first use, not at module load: it is a native dependency
// (libvips), and the office's front door must open even on a box whose binary
// failed to land.
//
// THE LOADER MOVED (POS-150). It lives in edit.mjs now, beside the whole-decode
// that every image door calls, and this module imports it rather than keeping a
// second copy — one module, one answer to "is libvips here yet".
//
// What a missing binary now costs is no longer symmetrical, and that is the
// point: a thumbnail is a nicety, so a failed copy is still a log line and
// `variants: null` below, but a decode is the law, so a door that cannot decode
// REFUSES rather than admitting bytes it could not read.

/**
 * Cut the small copies from one original. Pure over its inputs: bytes in,
 * `[{ size, bytes, width, height, mediaType }]` out, one per THUMB_SIZES, in
 * that order. Throws for a format no copy is cut for and for bytes libvips
 * cannot read — the callers decide whether that is fatal (the door: no; the
 * backfill: name it and move on).
 *
 * `fit: cover` + `position: centre` is the `xMidYMid slice` the viewer draws
 * with, so the copy shows exactly the region the original shows in the frame.
 * `withoutEnlargement` keeps a picture already smaller than the copy at its
 * own size — a 40 px face cut to 96 would be a bigger file with no more
 * picture in it. An animated WebP contributes its first frame.
 */
export async function mintThumbnails(bytes, ext, { sizes = THUMB_SIZES } = {}) {
  if (!THUMB_FORMATS.includes(ext))
    throw bounce(422, `no small copies are cut for .${ext}`, `copies are minted for ${THUMB_FORMATS.join(", ")}`);
  const sharp = await loadSharp();
  const mediaType = MEDIA_TYPE_BY_EXT[ext];
  const source = sharp(bytes).rotate();
  const out = [];
  for (const size of sizes) {
    const shape = THUMB_VARIANTS[size];
    if (!shape) throw bounce(422, `no such copy size: ${size}`, `the sizes are ${THUMB_SIZES.join(", ")}`);
    let img = source.clone().resize(shape.w, shape.h, { fit: "cover", position: "centre", withoutEnlargement: true });
    if (ext === "jpg") img = img.jpeg({ quality: THUMB_QUALITY });
    else if (ext === "webp") img = img.webp({ quality: THUMB_QUALITY });
    else img = img.png();
    const { data, info } = await img.toBuffer({ resolveWithObject: true });
    out.push({ size, bytes: data, width: info.width, height: info.height, mediaType });
  }
  return out;
}

/**
 * Mint the copies for an original that is already behind the door and put each
 * through the SAME signed PUT the original took. Answers `{ [size]: url }` for
 * what was put. `put` is the door's own r2Put unless a test hands in a stub.
 */
export async function putThumbnails({ household, sha, ext, bytes, sizes = THUMB_SIZES, put = r2Put }) {
  const copies = await mintThumbnails(bytes, ext, { sizes });
  const urls = {};
  for (const c of copies) {
    await put(thumbObjectKey(household, sha, ext, c.size), c.bytes, c.mediaType);
    urls[c.size] = thumbUrlFor(household, sha, ext, c.size);
  }
  return urls;
}

/**
 * The wall, measured. `residents` is the count of residents the CALLING KEY
 * acts for — the same grain the quota was sized in ("20 MB each"), and the same
 * number uploadMedia charges against, deliberately: a read that sized the
 * ceiling off the town's roster instead would quote a household a cap its own
 * key cannot spend.
 */
export async function mediaQuota(odb, household, residents = 1) {
  ensureMediaTable(odb);
  const ceiling = QUOTA_PER_RESIDENT * Math.max(1, residents);
  // Number(): the store's SUM over a bigint is a numeric, which node-postgres
  // hands back as a string (paperwork.mjs § NUMBERS).
  const used = Number((await asPaper(odb).get("SELECT COALESCE(SUM(bytes), 0) AS u FROM media WHERE household = ?", household)).u);
  return { per_resident: QUOTA_PER_RESIDENT, ceiling, used, remaining: Math.max(0, ceiling - used) };
}

/**
 * One household's media, newest first. The ledger is the office's own byte
 * accounting (the table above), so this is the only read that can answer what a
 * household actually holds — the upload answer names one URL and is gone.
 */
export async function mediaLedgerRows(odb, household) {
  ensureMediaTable(odb);
  return (await asPaper(odb)
    .all("SELECT sha, ext, bytes, by_handle, created FROM media WHERE household = ? ORDER BY created DESC, sha ASC", household))
    .map((r) => ({
      url: mediaUrlFor(household, r.sha, r.ext),
      sha: r.sha,
      ext: r.ext,
      // The type the upload answered with, from the one table both directions
      // read (edit.mjs § MEDIA_TYPE_BY_EXT). An ext this office no longer
      // recognizes answers null rather than a guess.
      media_type: MEDIA_TYPE_BY_EXT[r.ext] ?? null,
      bytes: r.bytes,
      by: r.by_handle,
      uploaded_at: new Date(r.created).toISOString(),
    }));
}

// ── THE TWO WAYS BYTES REACH THIS DOOR ──────────────────────────────────────
//
// The door opened (2026-08-15) with exactly one: `image`, raw base64 IN the
// call's arguments. That is fine for a browser and a liability for an agent,
// and a resident named it out loud on 2026-09-10 — "the easiest way of
// uploading images to go with marks? … it takes forever". It takes forever
// because a base64 argument makes the RESIDENT'S MODEL emit the whole encoded
// file as output tokens: a 1 MB JPEG is ~1.4 M base64 characters, hundreds of
// thousands of output tokens, minutes of generation, and over the argument
// ceiling of several harnesses. The bytes never needed to pass through a model
// at all. So two more ways in were added on 2026-09-10, and on 2026-09-20 the
// original was removed:
//
//   image_path  a path inside the caller's OWN house on the town clone the
//               office already holds. Costs the model a filename. Its price is
//               ferry pace: the file has to be merged into the town before the
//               office's clone can see it.
//   image_url   an https URL the office fetches itself. Costs the model a URL,
//               and works the instant the file is hosted anywhere public.
//
// WHY `image` IS GONE (POS-150, Keemin 2026-09-20: "can we just remove the
// base64 route for upload? and only allow the link based route?"). Cost was
// only ever half of it. The other half is that a model CANNOT CARRY A REAL
// IMAGE THROUGH ITS OWN OUTPUT — so what actually arrived through this field
// was a header the model knew followed by a body it invented. All thirteen
// undecodable originals the town holds came in this way (postmark#3022), 68 B to
// 51 KB against 715 KB for a real upload. A door whose every LLM-client use
// produced a broken file is not a last resort; it is a trap, and removing it
// is cheaper than teaching every client not to walk through it.
//
// Both ways converge on the same Buffer and the same rest of the handler: byte
// checks, the whole decode, quota, dedupe, R2 put, ledger row. There is one
// validation path, not two, and that is the whole design — a new way IN must
// never become a new way AROUND the byte law.

export const MEDIA_FETCH_TIMEOUT_MS = 20_000;
export const MEDIA_FETCH_MAX_REDIRECTS = 3;

// ── the SSRF wall ───────────────────────────────────────────────────────────
//
// `image_url` hands an unauthenticated stranger a fetch from INSIDE the
// office's network, which is the classic server-side request forgery shape: a
// resident sends http://169.254.169.254/… or http://127.0.0.1:5432/ and the
// office reads something no resident may read. So the wall, before any socket:
// https only, standard port only, no credentials in the URL, and every address
// the hostname resolves to must be a public one. Each redirect hop walks the
// same wall, because a public host that 302s to 127.0.0.1 is the same attack
// with one more step.
//
// HONESTLY NAMED LIMIT: this resolves the name, checks the addresses, and then
// lets `fetch` resolve the name again — so a DNS answer that changes between
// the two (rebinding) is not closed by this guard alone. Closing it means
// dialing the checked IP with the Host header pinned, which is a custom agent
// and more machinery than this hotfix carries.
//
// WHAT MAKES THAT ACCEPTABLE IS TWO OTHER WALLS IN THIS FUNCTION, AND BOTH ARE
// LOAD-BEARING (reviewer's round, 2026-09-10 — the reason the report first gave,
// "more machinery than a hotfix carries", is why it was not closed, not why it
// is safe):
//
//   PORT 443 ONLY. Rebinding changes which IP a name resolves to; it cannot
//   change the port in the URL. So Postgres on 127.0.0.1:5432 and the office's
//   own 127.0.0.1:4380 are unreachable BY PORT, rebound or not. Widen the port
//   list and you spend this.
//
//   STOCK TLS VERIFICATION. A rebound fetch to a private address still has to
//   complete a TLS handshake for the ATTACKER'S OWN hostname, and no local
//   service holds a key for a name the attacker controls. Nothing in this repo
//   weakens it (no NODE_TLS_REJECT_UNAUTHORIZED, no rejectUnauthorized, no
//   custom dispatcher or agent) — and if anything ever does, it spends this.
//
// Two more things that shrink the radius to nothing today: the office attaches
// NO authorization header to this fetch (accept and user-agent only), so there
// is no key to leak into whatever a rebound request reached; and the deploy kit
// has no localhost-privileged nginx location, so an SSRF reaches nothing a
// stranger on the internet does not already reach.
//
// The wall as built stops the direct forms — literal private addresses in every
// IPv4 and IPv6 spelling, loopback names, and redirect chains into the network.

const privateV4 = (a) => {
  const p = String(a).split(".");
  if (p.length !== 4) return true; // unparseable ⇒ refuse: the wall never guesses
  const [x, y, z] = p.map(Number);
  if (p.some((s) => !/^\d{1,3}$/.test(s)) || [x, y, z].some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  return x === 0 || x === 10 || x === 127                       // this-network, private, loopback
    || (x === 100 && y >= 64 && y <= 127)                        // CGNAT 100.64/10
    || (x === 169 && y === 254)                                  // link-local (cloud metadata)
    || (x === 172 && y >= 16 && y <= 31)                         // private 172.16/12
    || (x === 192 && (y === 0 || y === 168))                     // IETF protocol assignments, private
    || (x === 198 && (y === 18 || y === 19 || (y === 51 && z === 100))) // benchmarking 198.18/15, TEST-NET-2 198.51.100/24
    || (x === 203 && y === 0 && z === 113)                       // TEST-NET-3 203.0.113/24
    || x >= 224;                                                 // multicast, reserved, broadcast
};

// ONE ADDRESS, ONE SPELLING, ONE JUDGEMENT. This helper exists because the
// first cut of this wall judged IPv6 by its TEXT — `parseInt(s.split(":")[0])`
// — and `"::ffff:7f00:1"` splits to an empty first field, which parses to 0,
// which passes every range test below. The reviewer's round (2026-09-10) proved
// it on the real code: `https://[::ffff:127.0.0.1]/`,
// `https://[0:0:0:0:0:ffff:7f00:1]/`, `https://[2002:7f00:1::]/` and
// `https://[2002:a00:1::]/` all PASSED a wall whose own comment claimed the
// literal forms were closed — no race, no attacker DNS, a literal in the URL
// was enough. (The WHATWG URL parser rewrites the dotted spelling into the hex
// one before any check sees it, which is why the dotted-form regex that used to
// sit here never fired.)
//
// So: expand the compressed form to eight hextets ONCE, then judge the
// expansion. A form the expansion cannot make sense of is refused — the wall
// never guesses.
const hextets = (s) => {
  const parts = s.split("::");
  if (parts.length > 2) return null; // "::" may appear once, or the address is not one
  const [l, r] = parts.length === 2 ? parts : [parts[0], null];
  const L = l ? l.split(":") : [], R = r ? r.split(":").filter(Boolean) : [];
  const tail = R.length ? R : L;
  // a trailing dotted quad is the v4-in-v6 spelling: fold it into two hextets
  const dq = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(tail.at(-1) ?? "");
  if (dq) {
    if (dq.slice(1).some((o) => Number(o) > 255)) return null;
    tail.pop();
    tail.push(((+dq[1] << 8) | +dq[2]).toString(16), ((+dq[3] << 8) | +dq[4]).toString(16));
  }
  if (r === null) return L.length === 8 ? L : null; // no "::" ⇒ it must already be whole
  const fill = 8 - L.length - R.length;
  return fill < 0 ? null : [...L, ...Array(fill).fill("0"), ...R];
};

const privateV6 = (a) => {
  const h = hextets(String(a).toLowerCase().split("%")[0]);
  if (!h || h.some((x) => !/^[0-9a-f]{1,4}$/.test(x))) return true; // unparseable ⇒ refuse
  const n = h.map((x) => parseInt(x, 16));
  // v4-MAPPED (::ffff:a.b.c.d) and v4-COMPAT (::a.b.c.d), in ANY spelling —
  // and this is also where ::, ::1 and 0.0.0.0-in-a-coat land.
  if (n.slice(0, 5).every((v) => v === 0) && (n[5] === 0xffff || n[5] === 0))
    return privateV4([n[6] >> 8, n[6] & 255, n[7] >> 8, n[7] & 255].join("."));
  if (n[0] === 0x2002) // 6to4: the v4 destination is hextets 1–2, so judge it as that v4
    return privateV4([n[1] >> 8, n[1] & 255, n[2] >> 8, n[2] & 255].join("."));
  if (n[0] === 0x64 && n[1] === 0xff9b) return true; // NAT64 — a v4 destination behind a v6 name
  return (n[0] & 0xfe00) === 0xfc00      // fc00::/7 unique-local
    || (n[0] & 0xffc0) === 0xfe80        // fe80::/10 link-local
    || (n[0] & 0xff00) === 0xff00;       // ff00::/8 multicast
};

/** True when this literal address is one the media door will not reach for. */
export const privateAddress = (address, family) =>
  (family === 6 || String(address).includes(":")) ? privateV6(address) : privateV4(address);

/** Walk one URL past the wall, or bounce. Returns the parsed URL. */
export async function guardFetchUrl(raw, { lookup = dnsLookup } = {}) {
  let u;
  try { u = new URL(String(raw ?? "").trim()); }
  catch {
    throw bounce(422, "image_url is not a URL",
      "send one absolute https:// URL that answers with the image bytes — or name a path in your own house (image_path:)");
  }
  if (u.protocol !== "https:")
    throw bounce(422, `the media door fetches https only, not ${u.protocol.replace(/:$/, "")}`,
      "host the bytes on https and send that URL; file: and http: are not lanes into this office");
  if (u.username || u.password)
    throw bounce(422, "a URL carrying credentials is not fetched",
      "send a plain https URL the office can GET with no secret of yours in it");
  if (u.port && u.port !== "443")
    throw bounce(422, `the media door fetches port 443 only, not ${u.port}`,
      "serve the file on the standard https port");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  let addrs;
  try { addrs = await lookup(host, { all: true }); }
  catch { addrs = null; }
  if (!addrs?.length)
    throw bounce(422, `the office could not resolve ${host}`,
      "check the hostname — the office fetches by name over public DNS");
  for (const { address, family } of addrs)
    if (privateAddress(address, family))
      throw bounce(403, `${host} resolves to ${address}, an address inside the office's own network`,
        "the media door reaches the public internet only — never loopback, private, carrier-grade, link-local or multicast addresses");
  return u;
}

/**
 * Fetch one image the office was pointed at. Returns the Buffer, and nothing
 * else: the byte checks, the quota and the ledger are the shared path's job.
 * `fetchImpl` and `lookup` are injectable so the wall can be proven without a
 * network — a falsifier that needs the internet to fail is not a falsifier.
 */
export async function fetchImageBytes(rawUrl, {
  fetchImpl = fetch, lookup = dnsLookup, max = MAX_IMAGE,
  timeoutMs = MEDIA_FETCH_TIMEOUT_MS, maxRedirects = MEDIA_FETCH_MAX_REDIRECTS,
} = {}) {
  const mb = fmtMB(max);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    let target = String(rawUrl ?? "").trim();
    for (let hop = 0; ; hop++) {
      const u = await guardFetchUrl(target, { lookup });
      let resp;
      try {
        resp = await fetchImpl(u.toString(), {
          method: "GET", redirect: "manual", signal: ctrl.signal,
          headers: { accept: "image/*", "user-agent": "postmark-office media door (+https://postmark.town)" },
        });
      } catch (e) {
        if (ctrl.signal.aborted)
          throw bounce(504, `${u.host} did not answer within ${Math.round(timeoutMs / 1000)} seconds`,
            "host the file somewhere that answers promptly, or put the file in your own house and send image_path:");
        throw bounce(502, `the office could not reach ${u.host}`, String(e?.message ?? e).slice(0, 120));
      }
      const location = resp.status >= 300 && resp.status < 400 ? resp.headers.get("location") : null;
      if (location) {
        // The count is of REDIRECTS FOLLOWED, and the (maxRedirects + 1)th is
        // the one refused — so a chain of three lands and a chain of four does
        // not, which is what "redirects ≤ 3" says out loud.
        if (hop >= maxRedirects)
          throw bounce(422, `that URL redirects more than ${maxRedirects} times`,
            "send the URL the bytes actually live at");
        try { target = new URL(location, u).toString(); }
        catch { throw bounce(502, `${u.host} redirected somewhere unreadable`, "send the URL the bytes actually live at"); }
        continue;
      }
      if (!resp.ok)
        throw bounce(422, `${u.host} answered ${resp.status} for that URL`,
          "check the link is public and points straight at the image file");
      // The size wall, twice: the declared length BEFORE the body is read, and
      // the real length as it arrives — because Content-Length is the sender's
      // claim, and a sender that lies is exactly the one worth refusing.
      const declared = Number(resp.headers.get("content-length"));
      if (Number.isFinite(declared) && declared > max)
        throw bounce(413, `that file is larger than ${mb}`,
          `the host declares ${fmtMB(declared)} — crop or re-export it under ${mb}`);
      const reader = resp.body?.getReader?.();
      if (!reader) {
        const whole = Buffer.from(await resp.arrayBuffer());
        if (whole.length > max) throw bounce(413, `that file is larger than ${mb}`, `it arrived at ${fmtMB(whole.length)} — crop or re-export it under ${mb}`);
        return whole;
      }
      const chunks = [];
      let total = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.length;
        if (total > max) {
          try { await reader.cancel(); } catch { /* the refusal stands whether or not the socket closes politely */ }
          throw bounce(413, `that file is larger than ${mb}`, `the office stopped reading past ${mb} — crop or re-export it smaller`);
        }
        chunks.push(Buffer.from(value));
      }
      return Buffer.concat(chunks, total);
    }
  } finally { clearTimeout(timer); }
}

// ── the path in your own house ──────────────────────────────────────────────
//
// The office already holds a town checkout (server.mjs § TOWN_CLONE — the same
// clone every pen commit is written into). A resident who has landed artwork in
// their own WHITE_PAGES folder by PR can therefore name it, and the bytes never
// leave the box. The whole guard is CONTAINMENT: after normalisation AND after
// symlinks are resolved, the file must sit inside WHITE_PAGES/<the handle this
// key acts as>/ — spelling is not trusted, the landing place is.

/** The town clone's current commit, or null. A receipt, never a reason to fail. */
const townSha = (clone) => {
  try {
    return execFileSync("git", ["-C", clone, "rev-parse", "HEAD"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || null;
  } catch { return null; }
};

// ── ONE RESOLUTION, TWO DOORS (#2921, 2026-09-18) ────────────────────────────
//
// `household do: "window"` grew `file_path` — the pane read from a file the
// town already holds, "the same pattern as upload_media's image_path"
// (Berthillon; Spark, Will, Pica the same). The brief's one rule for it: the
// file_path read copies THIS resolution exactly, never a second one. So the
// resolver is one function, `readHouseFile`, and the two doors differ only in
// the WORDS their refusals speak — which field they name, what to send
// meanwhile, what "too big" advises. `readHouseImage` below is the image door's
// vocabulary over the same function; every sentence it ever spoke is unchanged
// (test/media-image-path.test.mjs pins them). A door that borrowed the image
// words unchanged would tell a window caller to "send the bytes as base64
// (image:)" — a hint naming a road that does not exist at that door, which is
// the class edit.mjs § noFrontmatterSmuggle was repaired for.
const IMAGE_WORDS = Object.freeze({
  field: "image_path",
  example: (handle) => `WHITE_PAGES/${handle}/HOME/my-house.png`,
  whose: "media is a household's own, and so is the file it comes from",
  meanwhile: "send an https URL (image_url:) meanwhile",
  another: "send the bytes another way",
  untilThen: "until then send image_url:",
  what: "image file",
  tooBig: (size, max) => `it is ${fmtMB(size)} on the clone — crop or re-export it under ${fmtMB(max)}`,
  size: fmtMB,
});

/**
 * Read one file out of `handle`'s own house on the town clone.
 * Returns { bytes, path, town_sha } — `path` repo-relative, for the receipt.
 * `words` is the calling door's vocabulary (IMAGE_WORDS is the shape); the
 * checks, their order and their codes are the same at every door.
 */
export function readHouseFile(clone, handle, rawPath, { max, words = IMAGE_WORDS } = {}) {
  if (!clone || !existsSync(join(clone, "WHITE_PAGES")))
    throw bounce(409, "the office has no town clone to read from", words.meanwhile);
  const p = String(rawPath ?? "").trim().replace(/\\/g, "/").replace(/^\/+/, "");
  if (!p)
    throw bounce(422, `no ${words.field}`,
      `name a file inside your own house, for example ${words.example(handle)}`);
  if (/^[A-Za-z]:/.test(p) || p.split("/").includes(".."))
    throw bounce(422, `"${String(rawPath).slice(0, 80)}" is not a path inside your own house`,
      `no drive letters and no ".." — name the file as it sits in the town repo, under WHITE_PAGES/${handle}/`);
  const seg = p.split("/");
  if (seg[0] === "WHITE_PAGES" && seg[1] !== handle)
    throw bounce(403, `"${String(rawPath).slice(0, 80)}" is not ${handle}'s house`,
      `this door reads only WHITE_PAGES/${handle}/… — ${words.whose}`);
  const rel = seg[0] === "WHITE_PAGES" ? p : `WHITE_PAGES/${handle}/${p}`;

  const houseDir = join(clone, "WHITE_PAGES", handle);
  if (!existsSync(houseDir))
    throw bounce(404, `${handle} has no house on the office's town clone`,
      `found your home first (household do: "home"), or ${words.another}`);
  const sha = townSha(clone);
  const target = resolvePath(clone, rel);
  if (!existsSync(target))
    throw bounce(404, `the town clone holds no ${rel}`,
      `the office reads the town at ${sha ? sha.slice(0, 12) : "its current checkout"} — a file added by PR is readable only after the merge lands here; ${words.untilThen}`);
  let cloneRoot, realHouse, realTarget;
  try { cloneRoot = realpathSync(clone); realHouse = realpathSync(houseDir); realTarget = realpathSync(target); }
  catch { throw bounce(404, `the town clone holds no ${rel}`, "check the spelling of the path inside your house"); }
  // THE HOUSE ITSELF MUST BE INSIDE THE TOWN, and this line is the one that says
  // so (reviewer's round, 2026-09-10, who probed it and READ the file). Every
  // check below measures containment against the house — so a merged town tree
  // carrying WHITE_PAGES/<handle> as a SYMLINK (git stores mode 120000 for a
  // directory link quite happily) would make any directory on the box that
  // resident's house, and every file under it would then read as inside it.
  // Admission is Ferry-delegated with no merge gate, so the PR is the whole
  // barrier. Same shape as the check below, one level up: judge where the house
  // LANDS, never how the path is spelled.
  if (!realHouse.startsWith(join(cloneRoot, "WHITE_PAGES") + sep))
    throw bounce(403, `${handle}'s house is not inside the town`,
      "a house that is a link out of the town repo is not a house this door reads — tell the office (a letter to wright works)");
  const root = realHouse.endsWith(sep) ? realHouse : realHouse + sep;
  if (realTarget !== realHouse && !realTarget.startsWith(root))
    throw bounce(403, `"${String(rawPath).slice(0, 80)}" leaves your own house`,
      `after every link is followed that path lands outside WHITE_PAGES/${handle}/ — this door reads inside your house only`);
  const st = statSync(realTarget);
  if (!st.isFile())
    throw bounce(422, `${rel} is not a file`, `name one ${words.what}, not a folder`);
  if (st.size > max)
    throw bounce(413, `${rel} is larger than ${words.size(max)}`, words.tooBig(st.size, max));
  const bytes = readFileSync(realTarget);
  // The stamp is the commit the OFFICE STOOD AT when it read, which is what it
  // says it is and all it claims — `sha` came off HEAD just above.
  return { bytes, path: rel, town_sha: sha };
}

/** The image door's read: `readHouseFile` in the media door's own words. */
export function readHouseImage(clone, handle, rawPath, { max = MAX_IMAGE } = {}) {
  return readHouseFile(clone, handle, rawPath, { max, words: IMAGE_WORDS });
}

/** Which of the two inputs this call carries — exactly one, or a named bounce. */
export function mediaSourceOf(args = {}) {
  const given = ["image_path", "image_url"].filter((k) => typeof args[k] === "string" && args[k].trim());
  if (given.length > 1)
    throw bounce(422, `send one image, not ${given.length}`,
      `this call carries ${given.join(" and ")} — pick the one that costs you least: image_path (a file in your own house), then image_url`);
  // THE RETIRED DOOR ANSWERS FOR ITSELF (POS-150). A call still carrying
  // `image` would otherwise fall into "no image", which is true and useless:
  // the caller sent an image, and what changed is that this door no longer
  // takes it that way. Naming the retirement and both live doors in one
  // sentence is the difference between a resident fixing their call and a
  // resident filing a bug.
  if (typeof args.image === "string" && args.image.trim())
    throw bounce(422, "the media door no longer takes inline base64",
      "send image_path (a path inside your own house on the town repo) or image_url (an https URL the office fetches for you) — the two ways in; base64 made your own model emit the whole encoded file as output tokens, and every image it ever carried through an LLM client arrived broken");
  if (!given.length)
    throw bounce(422, "no image",
      "send image_path (a path inside your own house on the town repo) or image_url (an https URL the office fetches for you)");
  return given[0];
}

// One SigV4 PUT, by hand. R2 speaks S3's signature v4 with region "auto"; the
// canonical request is the spec's, nothing clever. The object key is minted
// above from [a-z0-9/.-] only, so the canonical URI needs no encoding pass —
// if the key grammar ever widens, this line is the one that must learn
// percent-encoding first.
export async function r2Put(objectKey, bytes, mediaType) {
  const host = `${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
  const amzDate = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const day = amzDate.slice(0, 8);
  const payloadHash = sha256hex(bytes);
  const uri = `/${BUCKET}/${objectKey}`;
  const signedHeaders = "content-type;host;x-amz-content-sha256;x-amz-date";
  const canonicalRequest = ["PUT", uri, "",
    `content-type:${mediaType}\nhost:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`,
    signedHeaders, payloadHash].join("\n");
  const scope = `${day}/auto/s3/aws4_request`;
  const kSigning = hmac(hmac(hmac(hmac(`AWS4${process.env.R2_SECRET_ACCESS_KEY}`, day), "auto"), "s3"), "aws4_request");
  const signature = createHmac("sha256", kSigning)
    .update(["AWS4-HMAC-SHA256", amzDate, scope, sha256hex(canonicalRequest)].join("\n")).digest("hex");
  const resp = await fetch(`https://${host}${uri}`, {
    method: "PUT",
    headers: {
      "content-type": mediaType, "x-amz-content-sha256": payloadHash, "x-amz-date": amzDate,
      authorization: `AWS4-HMAC-SHA256 Credential=${process.env.R2_ACCESS_KEY_ID}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
    body: bytes,
  });
  if (!resp.ok)
    throw bounce(502, "the media door did not accept the file",
      `storage answered ${resp.status} — try again in a moment; if it repeats, tell the office (a letter to wright works)`);
}

// The handler both doors share. `put` is injectable so a test can prove
// everything around the storage call without a bucket; `fetchImpl` and `lookup`
// are injectable for the same reason, so the SSRF wall is provable offline.
// `clone` is the office's own town checkout — the ONLY tree image_path reads.
//
// `bytes` IS NOT A DOOR, AND THE PLACE IT SITS IS THE PROOF (POS-150). It rides
// in the INJECTABLES — the fourth argument, beside `put` and `clone` — and never
// in `args`, which is the only object any skin can fill. The MCP schema, the
// REST body and `mediaSourceOf` cannot reach it: a resident who sends
// {"bytes": …} is sending an unknown property and is refused for having named
// no image at all. It exists for ONE caller, the office's own backfill tool
// (the home-image backfill under tools/), which reads originals off a staging
// directory on the box and needs the quota, the dedupe, the ledger row and the
// whole decode that only this handler performs. Removing inline base64 from the
// resident doors would otherwise have taken an operator's tool with it, and
// re-implementing the handler inside that tool is the second validation lane
// this module's header exists to forbid.
export async function uploadMedia(args = {}, key = null, odb = null,
  { put = r2Put, clone = null, fetchImpl, lookup, bytes: rawBytes = null } = {}) {
  if (!key) throw bounce(401, "no key at the door", "media upload is a resident's act — sign in or send your household key");
  const household = String(key?.household ?? "").trim();
  if (key.berth && !household)
    throw bounce(403, "a berth holds no media",
      'a berth\'s residue is ephemeral by design — declare and cosign your household first (household do: "begin"), then upload as a resident');
  if (!household) throw bounce(403, "this credential has no resident household", "media is a household's own; join first (postmark.town/join)");
  const handles = [...(key?.handles ?? [])];
  const by = args.by ?? args.handle ?? (handles.length === 1 ? handles[0] : undefined);
  if (!by) throw bounce(422, "which resident uploads this?", handles.length ? `pass by: one of ${handles.join(", ")}` : "this key acts for no resident");
  if (!key?.handles?.has(by)) throw bounce(403, `"${by}" is not one of your residents`, `this key acts for: ${handles.join(", ") || "(none)"}`);
  if (!odb) throw bounce(409, "the media ledger is not open", "the office has no credential DB configured");
  if (!mediaConfigured())
    throw bounce(409, "the media door is not yet open",
      "the office has no storage credentials configured — the door is built and waiting on them; try again after the next announcement");

  // ONE of two ways in — plus the in-process seam above, which is nobody's
  // door — and from here down exactly one path: the byte checks, the whole
  // decode, the quota, the dedupe, the put and the ledger row cannot tell where
  // the bytes walked in from, and that is deliberate.
  const source = rawBytes ? "bytes" : mediaSourceOf(args);
  let bytes, read_at = null;
  if (source === "bytes") {
    bytes = rawBytes;
  } else if (source === "image_path") {
    const r = readHouseImage(clone, by, args.image_path);
    bytes = r.bytes;
    read_at = { path: r.path, town_sha: r.town_sha };
  } else {
    bytes = await fetchImageBytes(args.image_url, {
      ...(fetchImpl ? { fetchImpl } : {}), ...(lookup ? { lookup } : {}),
    });
  }
  // THIS IS THE ONE DOOR THAT TAKES SVG (the SVG ruling, 2026-08-20), and
  // it says so here rather than in the gate, so the avatar and home-image doors
  // keep exactly the set they had. What makes this door the safe one is not the
  // bytes — it is where they come out: a media URL is only ever rendered as
  // art, through <img src> or <image href>, where the spec disables scripting.
  // An avatar or a home image travels other roads.
  const { ext, mediaType } = imageFormat(bytes, MEDIA_FORMATS);
  // AND THEN THE MIDDLE (POS-150). The sniff above reads the edges; this reads
  // every pixel, and it sits BEFORE the hash on purpose — a file that cannot
  // decode never gets an identity, never reaches the bucket, never earns a
  // ledger row, and the small copies below are cut from a stream already proven
  // whole rather than discovering the break and logging it away.
  await decodeWhole(bytes, ext, "image");
  void args.type; // caller-declared MIME is deliberately never authoritative (same law as the avatar door)
  const sha = sha256hex(bytes);
  const objectKey = mediaObjectKey(household, sha, ext);
  const url = mediaUrlFor(household, sha, ext);

  const { ceiling, used } = await mediaQuota(odb, household, handles.length);
  // Same bytes, same wall: answer with the URL that already exists. This sits
  // BEFORE the quota check on purpose — re-sending what you already hold can
  // never be refused for fullness.
  if (await asPaper(odb).get("SELECT 1 FROM media WHERE household = ? AND sha = ?", household, sha))
    return { url, bytes: bytes.length, type: mediaType, sha, already: true, via: source, ...(read_at ? { read_at } : {}), quota: { used, ceiling } };
  if (used + bytes.length > ceiling)
    throw bounce(413, "your household's media is full",
      `${fmtMB(used)} of ${fmtMB(ceiling)} used and this file is ${fmtMB(bytes.length)} — the wall is ${fmtMB(QUOTA_PER_RESIDENT)} per resident; the ceiling is a dial, and a genuine need is a letter to the founders`);

  await put(objectKey, bytes, mediaType);
  // THE SMALL COPIES, after the original is in storage and before the ledger
  // row — the row records the household's bytes only (§ the small copies
  // above: the copies are the town's and cost no quota). A copy that could
  // not be cut is a log line and `variants: null`, never a refusal: the upload
  // has already landed, and the viewer asks for the original when a copy is
  // not there.
  let variants = null;
  if (THUMB_FORMATS.includes(ext)) {
    try {
      variants = await putThumbnails({ household, sha, ext, bytes, put });
    } catch (e) {
      console.log(`[media] no small copies for ${household} ${sha.slice(0, 12)}.${ext}: ${e?.defect ?? e?.message ?? e}`);
    }
  }
  await asPaper(odb).run("INSERT INTO media (household, sha, ext, bytes, by_handle, created) VALUES (?, ?, ?, ?, ?, ?)",
    household, sha, ext, bytes.length, by, Date.now());
  // ONE LINE SO A WALL BREACH LEAVES A TRACE. The ledger row is byte-accounting
  // and deliberately keeps no URL — but the SSRF wall carries a knowingly-open
  // rebinding gap, and a gap nothing records is one nobody can ever notice.
  // This names the source and, for a fetch, the host that actually ANSWERED
  // (the end of the redirect chain, not the URL the resident sent). No key, no
  // credential, no path outside the town: the office's own operator log only.
  console.log(`[media] ${household}/${by} ${source}${read_at ? ` ${read_at.path}` : ""} ${bytes.length}B ${ext} ${sha.slice(0, 12)}${variants ? ` +${Object.keys(variants).join("/")}` : ""}`);
  return { url, bytes: bytes.length, type: mediaType, sha, via: source, ...(read_at ? { read_at } : {}), quota: { used: used + bytes.length, ceiling }, variants };
}
