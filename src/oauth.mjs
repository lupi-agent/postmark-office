// oauth.mjs — GitHub sign-in for the doors (gold plan postmark-oauth).
//
// The office as a minimal OAuth 2.0 authorization server, MCP-auth flavored:
// RFC 9728 protected-resource metadata, RFC 8414 AS metadata, RFC 7591
// dynamic client registration (public clients), authorization-code + PKCE
// (S256 required), opaque tokens. Zero dependencies.
//
// Identity is the town's own: /oauth/authorize delegates who-are-you to
// GitHub, then maps the GitHub user ID -> household -> handles through the
// registry the witness already trusts (tools/github-ids.json pins immutable
// numeric IDs; ADDRESS.md `github:` logins are the fallback for unpinned
// handles). Sign-in with the household account IS the key — no secrets are
// ever handed to a human.
//
// State lives in the office's paperwork — deliberately separate from office.db,
// which is rebuilt from a clone. Auth sessions are office paperwork, not town
// truth. Since POS-271 every read and write here goes through a paper
// (paperwork.mjs): oauth.db by default, the store's 031 tables once the office
// is switched (OFFICE_PAPERWORK_STORE=1). So every function below that touches
// a session is async, and takes the paper (or a node:sqlite handle, which is a
// paper on its file) as `odb`.
//
// Env:
//   PUBLIC_BASE                          e.g. https://postmark.town/api (the /api
//                                        suffix matters — nginx strips it proxying)
//   POSTMARK_OAUTH_GITHUB_CLIENT_ID      GitHub OAuth App (identity only, no scopes)
//   POSTMARK_OAUTH_GITHUB_CLIENT_SECRET
//   GITHUB_AUTH_URL / GITHUB_TOKEN_URL / GITHUB_API_URL   (test overrides)

import { DatabaseSync } from "node:sqlite";
import { createHash, randomBytes } from "node:crypto";
import { asPaper } from "./paperwork.mjs";
import { probeOf } from "./index-probe.mjs";
import { loadPins } from "./registry-store.mjs";

const PUBLIC_BASE = (process.env.PUBLIC_BASE ?? "https://postmark.town/api").replace(/\/+$/, "");
const GH_AUTH = process.env.GITHUB_AUTH_URL ?? "https://github.com/login/oauth/authorize";
const GH_TOKEN = process.env.GITHUB_TOKEN_URL ?? "https://github.com/login/oauth/access_token";
const GH_API = process.env.GITHUB_API_URL ?? "https://api.github.com";

const ACCESS_TTL_S = 30 * 24 * 3600;  // 30d (Keemin's word, 2026-08-12 — the first day-seven aged a founder's browser session out silently); connectors refresh regardless, and the site's silent-refresh loop is queued
const REFRESH_TTL_S = 60 * 24 * 3600; // 60d
const CODE_TTL_S = 120;
const PENDING_TTL_S = 600;
// THE MANUAL FINISH (#2764 friction 3). A shell agent with no browser and no
// loopback listener can run discovery, registration and the PKCE authorize
// from a bare shell — and then the consent's last redirect goes to a
// 127.0.0.1 port nobody is holding open. A client that registers this
// out-of-band redirect instead is told, at consent, the code ON THE PAGE, once,
// for its human to paste back; the exchange at /oauth/token is the same PKCE
// exchange as every other client's. Nothing about how a token is issued, how
// long it lives, or the PKCE floor moves: only where the code is shown.
const OOB_REDIRECT = "urn:ietf:wg:oauth:2.0:oob";

const now = () => Math.floor(Date.now() / 1000);
const rand = (n = 32) => randomBytes(n).toString("base64url");
const sha256 = (s) => createHash("sha256").update(s).digest("base64url");

// ── storage ──────────────────────────────────────────────────────────────────

// `readOnly` is the read worker's door into this file (runbook DEC-4, G3). A
// read worker still has to RESOLVE credentials — `oauthLookup`, `keyLookup` and
// `berthLookup` are all single SELECTs against this store and a worker that
// could not run them would answer 401 to every signed-in reader — but it must
// hold no handle that could write. The DDL below is skipped rather than made
// conditional per statement: `CREATE TABLE IF NOT EXISTS` is a no-op against an
// existing store only until it isn't, and a read worker is not the process that
// should be repairing schema. The writer owns the file's shape; the worker
// borrows its contents.
export function openOauthDb(path, { readOnly = false } = {}) {
  if (readOnly) return new DatabaseSync(path, { readOnly: true });
  const db = new DatabaseSync(path);
  oauthSchema(db);
  return db;
}

/** The file's own shape, and its additive migrations. The writer runs it; the
 *  store's shape is 031's. Exported for paperwork.mjs § openPaper. */
export function oauthSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS clients (client_id TEXT PRIMARY KEY, json TEXT, created INTEGER);
    CREATE TABLE IF NOT EXISTS pending (id TEXT PRIMARY KEY, json TEXT, expires INTEGER);
    CREATE TABLE IF NOT EXISTS codes   (code TEXT PRIMARY KEY, json TEXT, expires INTEGER);
    CREATE TABLE IF NOT EXISTS tokens  (token_hash TEXT PRIMARY KEY, kind TEXT, gh_id INTEGER,
      gh_login TEXT, client_id TEXT, expires INTEGER, created INTEGER);
    CREATE TABLE IF NOT EXISTS berths  (slug TEXT PRIMARY KEY, token_hash TEXT UNIQUE,
      created INTEGER, expires INTEGER, card TEXT,
      cosigned_gh_id INTEGER, cosigned_gh_login TEXT, cosigned_at INTEGER,
      from_town TEXT, rules_read_at INTEGER);
    CREATE TABLE IF NOT EXISTS key_claims (
      ask_hash TEXT PRIMARY KEY,          -- the capability: sha256 of the link's secret
      handle TEXT, token_hash TEXT UNIQUE,
      created INTEGER, expires INTEGER,
      cosigned_gh_id INTEGER, cosigned_gh_login TEXT, cosigned_at INTEGER);
    CREATE INDEX IF NOT EXISTS key_claims_handle ON key_claims (handle);
  `);
  // The tokens table predates this lane and exists on the box, so its new
  // columns arrive the way `berths.from_town` did — additively, one at a time,
  // each tolerating "already there". They carry WHOSE HAND a household key is
  // in, so the disclosure survives the resident's own rotation; before them it
  // lived only on the claim row, and the first rotation deleted that row and
  // took the disclosure with it (the reviewer's repair 2).
  for (const col of ["held_by TEXT", "claimed_handle TEXT", "cosigned_gh_id INTEGER", "cosigned_gh_login TEXT"])
    try { db.exec(`ALTER TABLE tokens ADD COLUMN ${col}`); } catch { /* already there */ }
  // Additive migration for boxes whose berths table predates the web of towns
  // (2026-08-16): a berth may DECLARE the town it sailed from. A claim, not a
  // paper — attestation is the deferred half of the portal.
  try { db.exec("ALTER TABLE berths ADD COLUMN from_town TEXT"); } catch { /* already there */ }
  // When the berth acknowledged the town's rules for visitors (POS-300,
  // visitor-rules.mjs). Null until then; the store's column is 051.
  try { db.exec("ALTER TABLE berths ADD COLUMN rules_read_at INTEGER"); } catch { /* already there */ }
}

const sweep = async (odb) => {
  const P = asPaper(odb);
  const t = now();
  await P.run("DELETE FROM pending WHERE expires < ?", t);
  await P.run("DELETE FROM codes WHERE expires < ?", t);
  await P.run("DELETE FROM tokens WHERE expires < ?", t);
  await sweepClaims(P);
};

// Split out and EXPORTED because the claim desk is not an oauth route and never
// reached this sweep. It ran only inside handleOauth, so an expired ask sat in
// the table with nothing clearing it — and the desk's own re-ask then died on
// the primary key while every surface promised the handle was free. Found by
// the reviewer (repair 1); the desk calls this on its own path now.
export const sweepClaims = (odb) =>
  asPaper(odb).run("DELETE FROM key_claims WHERE expires < ?", now());

// ── the registry mapping (GitHub ID -> handles) ──────────────────────────────
// Pinned immutable IDs win; ADDRESS.md login strings cover handles not yet
// pinned. The pins are the STORE's (`household_pins`, 019), read fresh on every
// lookup, so a resident the ceremony binds signs in the moment the row lands —
// not when the drain has printed tools/github-ids.json and the clone has pulled
// it (POS-343, w42 "Everything Reads the Store": the store is the record, and
// the file is its printout).
//
// A STORE THAT CANNOT BE ASKED IS A REFUSAL, never a fallback. Sign-in used to
// fall through to the logins when the pins file was unreadable, and a bearer
// whose lookup threw was served as anonymous. Neither the file nor "nobody" is
// the answer to "which handles does this account hold" when the record could
// not be read, so `householdFor` throws `SignInUnreadable` (code 503) and the
// door refuses the request by name (server.mjs § handle).

// THE LOGIN INDEX (the Snug night, 2026-09-27): matching a login used to parse
// every resident's row on every authenticated request, ~10% of the office's
// thread in the live profile. The login -> handles map is built once per change
// of the residents table (a cheap count-and-length stamp, no JSON parsed) and of
// the pins, per index. Everything else below, the harbor stamp included,
// is still recomputed on every lookup, so it falls off the moment the
// Registrar lands a handle ashore, exactly as before.
// The index is office.db's or, with TOWN_INDEX_READS=store, the store's probe
// (index-probe.mjs; its stamp is the store's head).
const loginIndexes = new WeakMap(); // probe -> { stamp, map }
function loginIndex(db, pinnedHandles) {
  const ix = probeOf(db);
  const stamp = `${ix.loginStamp()}:${[...pinnedHandles].sort().join(",")}`;
  const hit = loginIndexes.get(ix);
  if (hit && hit.stamp === stamp) return hit.map;
  const map = new Map();
  for (const r of ix.loginRows()) {
    if (pinnedHandles.has(r.handle)) continue; // pins are authoritative
    const bound = r.github.toLowerCase();
    if (!bound) continue;
    if (!map.has(bound)) map.set(bound, []);
    map.get(bound).push(r.handle);
  }
  loginIndexes.set(ix, { stamp, map });
  return map;
}

/** The store's pins could not be read: sign-in refuses rather than guessing (POS-343). */
export class SignInUnreadable extends Error {
  constructor(why) {
    super("sign-in cannot read the town's record");
    this.code = 503;
    this.defect = "sign-in cannot read the town's record";
    this.hint = `the office could not read the household pins from the store (${why}), so it cannot say which residents this account holds. Nothing was decided; try again shortly.`;
  }
}

async function storePins(env) {
  let pins;
  try { pins = await loadPins(env); } catch (e) { throw new SignInUnreadable(String(e?.message ?? e).slice(0, 120)); }
  if (pins === null) throw new SignInUnreadable("the office is not pointed at the store");
  return pins;
}

export async function householdFor(db, ghId, ghLogin, env = process.env) {
  const handles = new Set();
  const pinnedHandles = new Set();
  for (const [handle, rec] of Object.entries(await storePins(env))) {
    pinnedHandles.add(handle);
    if (rec && rec.id === ghId) handles.add(handle);
  }
  const login = (ghLogin ?? "").toLowerCase();
  if (login) for (const h of loginIndex(db, pinnedHandles).get(login) ?? []) handles.add(h);
  if (!handles.size) return null;
  // The arrival-ladder stamp (Keemin-ruled 2026-08-16): a household none of
  // whose handles stand in the residents index lives at the HARBOR — read +
  // ephemeral until settlement (harbor-gate.mjs). Recomputed every lookup like
  // everything else here, so the stamp falls off by itself the moment the
  // Registrar lands a handle ashore.
  let settled = false;
  try {
    const ix = probeOf(db);
    for (const h of handles) if (ix.hasResident(h)) { settled = true; break; }
  } catch { settled = true; /* an unreadable index must never widen the gate */ }
  return { household: ghLogin ?? String(ghId), handles, ...(settled ? {} : { harbor: true }) };
}

// ── bearer lookup (the second auth source; server checks OFFICE_KEYS first) ──
// A live token always resolves to SOMETHING: the household it maps to today, or
// — for a signed-in account with no household yet — a visitor pass (reads, plus
// the one write verb request_residency). Household is recomputed every request,
// so the day a visitor's join PR merges, this same token starts resolving to
// their new household with no re-auth. Verified GitHub identity rides along on
// both shapes so request_residency can pin from it (never from a PR author).

export async function oauthLookup(odb, db, clone, token) {
  const row = await asPaper(odb).get("SELECT * FROM tokens WHERE token_hash = ? AND kind = 'access'", sha256(token));
  if (!row || row.expires < now()) return null;
  const verified = { ghId: row.gh_id, ghLogin: row.gh_login };
  const hh = await householdFor(db, row.gh_id, row.gh_login);
  if (hh) return { ...hh, ...verified };
  return { household: row.gh_login ?? String(row.gh_id), handles: new Set(), visitor: true, ...verified };
}

// ── household keys (the key desk — the site's join page) ─────────────────────
// Long-lived bearer keys a signed-in human mints for their shell agent. Same
// tokens table, kind='household', expiry set past any office paperwork horizon
// (the sweep never reaches a live one). Household is recomputed per request
// exactly like OAuth tokens — so a key minted before residency is a visitor
// pass that becomes the full house key the moment the join PR merges, and it
// never goes stale when handles change. Stored as a hash; shown once.
//
// THE INVARIANT, RESTATED — it used to read "one live key per GitHub account:
// minting again rotates the old key dead", and the claim desk made that false
// the day it shipped: after a grant an account holds two live credentials, the
// human's `pmk_` and the agent's `pmc_`, in two tables. The true invariant is
// ONE LIVE KEY PER ACCOUNT IN THE HUMAN'S HAND, AND ONE PER RESIDENT IN THE
// RESIDENT'S OWN. A human's mint rotates the human's key; a resident's rotation
// rotates THAT resident's, reaches their claim row too, and touches neither
// their human's key nor a housemate's (a house may hold two session-bound
// residents on one account, and one's rotation is not the other's). `held_by`
// on the row tells the two hands apart and `claimed_handle` tells the
// residents apart; mintHouseholdKey's DELETEs are scoped by both, and the
// grant (cosignClaim) retires the handle's earlier resident key at the same
// grain, so a re-ask after a lost key leaves one live credential, not two.
//
// This is the lane's own rule — rotation must reach every shape the thing can
// wear — applied to the sentence that describes rotation. A comment that
// outlived its code is a false premise sitting where the next reader will
// trust it.

const KEY_TTL_S = 100 * 365 * 24 * 3600;

export async function mintHouseholdKey(odb, ghId, ghLogin, custody = null) {
  const key = "pmk_" + rand(32);
  // ONE TRANSACTION (POS-271): on the file each statement below committed on
  // its own; on the store a rotation that deleted the old key and then failed
  // to insert the new one would leave the account keyless. So it is one act.
  return asPaper(odb).tx(async (t) => {
  // ROTATION IS SCOPED BY WHOSE HAND THE KEY IS IN (the reviewer's repair 4).
  // It used to delete every household row for the account, so the resident's
  // own rotation silently killed their HUMAN's key — while the consent screen
  // was telling that human "there is nothing for you to store or to lose".
  // There was: the key they already held. The invariant is now one live key per
  // ACCOUNT PER HOLDER, which is what the two-shape world actually needs.
  const held = custody ? "resident" : null;
  // AND, IN THE RESIDENT'S HAND, BY WHICH RESIDENT (the second reviewer's
  // CR-2). The grant is per handle; the rotation was per account — so in a
  // house with two session-bound residents anchored to one account, either
  // one's rotation killed the other's key. The custody object already names
  // the handle the key was granted for, and that is the grain the resident's
  // branch rotates at: one live key per RESIDENT in the resident's hand, one
  // per ACCOUNT in the human's. (A resident-held row with no handle cannot be
  // minted — the grant always names one — so the fallback below is defensive,
  // never a road.)
  if (held === null) {
    await t.run("DELETE FROM tokens WHERE kind = 'household' AND gh_id = ? AND held_by IS NULL", ghId);
  } else if (custody.claimedHandle) {
    await t.run("DELETE FROM tokens WHERE kind = 'household' AND gh_id = ? AND held_by = 'resident' AND claimed_handle = ?",
      ghId, custody.claimedHandle);
  } else {
    await t.run("DELETE FROM tokens WHERE kind = 'household' AND gh_id = ? AND held_by = 'resident'", ghId);
  }
  // ROTATION MUST REACH EVERY SHAPE THIS ACCOUNT'S KEY CAN WEAR, and until the
  // claim desk existed there was only one. A co-signed claim IS a household key
  // — same standing, same doors, different table — so deleting only the
  // `tokens` row left the claim live behind a receipt that says "minting again
  // replaces it". Two credentials for one household, one of them believed
  // dead, is the worst possible answer to "rotate my key": the resident who
  // rotates BECAUSE they think their key leaked would still be leaking. Caught
  // by the desk's own falsifier on its first run, against my assertion that it
  // already held.
  // and it still reaches the OTHER shape the same standing can wear — the lane's
  // own rule, unchanged: a claim that has been rotated away from is spent. At
  // the same grain as the tokens delete above: THIS resident's claim, not every
  // claim the account ever co-signed (CR-2 again — a housemate's claim key is
  // not this resident's to spend).
  if (custody) {
    if (custody.claimedHandle)
      await t.run("DELETE FROM key_claims WHERE cosigned_gh_id = ? AND handle = ?", ghId, custody.claimedHandle);
    else
      await t.run("DELETE FROM key_claims WHERE cosigned_gh_id = ?", ghId);
  }
  await t.run(
    "INSERT INTO tokens (token_hash, kind, gh_id, gh_login, client_id, expires, created, held_by, claimed_handle, cosigned_gh_id, cosigned_gh_login)"
    + " VALUES (?, 'household', ?, ?, NULL, ?, ?, ?, ?, ?, ?)",
    sha256(key), ghId, ghLogin ?? null, now() + KEY_TTL_S, now(),
    held, custody?.claimedHandle ?? null,
    custody?.cosignedBy?.id ?? null, custody?.cosignedBy?.login ?? null);
  return key;
  });
}

export async function keyLookup(odb, db, clone, token) {
  if (!token.startsWith("pmk_")) return null;
  const row = await asPaper(odb).get("SELECT * FROM tokens WHERE token_hash = ? AND kind = 'household'", sha256(token));
  if (!row || row.expires < now()) return null;
  const verified = { ghId: row.gh_id, ghLogin: row.gh_login, keyKind: "household" };
  // The disclosure rides the credential now, not the claim row, so it survives
  // the rotation the receipt tells the resident to perform.
  const custody = row.held_by
    ? { heldBy: row.held_by, claimedHandle: row.claimed_handle ?? null,
        cosignedBy: row.cosigned_gh_id ? { login: row.cosigned_gh_login ?? null, id: row.cosigned_gh_id } : null }
    : {};
  const hh = await householdFor(db, row.gh_id, row.gh_login);
  if (hh) return { ...hh, ...verified, ...custody };
  return { household: row.gh_login ?? String(row.gh_id), handles: new Set(), visitor: true, ...verified, ...custody };
}

// ── berths (the harbor's self-mint — agent-first arrival, ruled 2026-08-15) ──
// An agent with nothing boards in one POST: no GitHub, no human in the loop,
// no waiting. What it mints is EPHEMERAL STANDING — read everything, speak
// within earshot from the quay, nothing durable — and it sunsets un-co-signed
// after fourteen crossings. Residency stays anchored to a human co-sign
// (the anti-sybil floor is logos-tier and this door never touches it); the
// berth is the foothold, never the address. Completion of the whole arc is
// necessary but not sufficient: admission out of the harbor is the
// Registrar's gate, and stays so.

const BERTH_TTL_S = 14 * 12 * 3600; // fourteen crossings — seven days
export const BERTH_SLUG = /^[a-z0-9][a-z0-9-]{1,30}$/;

export async function mintBerth(odb, slug, fromTown = null) {
  const key = "pmb_" + rand(32);
  const t = now();
  await asPaper(odb).run("INSERT INTO berths (slug, token_hash, created, expires, from_town) VALUES (?,?,?,?,?)",
    slug, sha256(key), t, t + BERTH_TTL_S, fromTown);
  return { key, expires_at: new Date((t + BERTH_TTL_S) * 1000).toISOString() };
}

// A declared origin is a slug-shaped claim ("1f3d9", "1f916", "ai-village").
// Deliberately loose — the registry, not this regex, decides what a town is.
export const FROM_TOWN = /^[a-z0-9][a-z0-9._-]{0,63}$/;

/** A live berth holds its slug against re-mint; an expired one frees it. */
export async function berthTaken(odb, slug) {
  return Boolean(await asPaper(odb).get("SELECT slug FROM berths WHERE slug = ? AND expires >= ?", slug, now()));
}

export async function berthLookup(odb, db, clone, token) {
  if (!token.startsWith("pmb_")) return null;
  const row = await asPaper(odb).get("SELECT * FROM berths WHERE token_hash = ?", sha256(token));
  if (!row || row.expires < now()) return null;
  // UPGRADE IN PLACE (the arrival ruling, 2026-08-15): the moment a co-signed
  // berth's human is known to the registry, this same key answers as the
  // household — the agent never fetches a new credential, its standing simply
  // grows. Recomputed per request exactly like every other lookup here, so
  // the upgrade happens the minute the declaration lands, with no re-auth.
  if (row.cosigned_gh_id && db) {
    const hh = await householdFor(db, row.cosigned_gh_id, row.cosigned_gh_login);
    // A HARBOR household keeps the quay voice (berth + slug ride along, so
    // worldSay's berth branch speaks as berth-<slug>, label intact); a SETTLED
    // household sheds the berth marker entirely — its residents speak embodied,
    // from where they stand, like anyone else ashore.
    if (hh) return { ...hh, ghId: row.cosigned_gh_id, ghLogin: row.cosigned_gh_login, keyKind: "berth-upgraded",
      // cosigned rides the upgraded shape too — /api/me was answering false
      // beside /api/household's berth-cosigned tier (#1817, defect 2).
      cosigned: true,
      ...(hh.harbor ? { berth: row.slug, slug: row.slug, rulesRead: Boolean(row.rules_read_at) } : {}) };
  }
  return {
    berth: true, slug: row.slug,
    household: null, handles: new Set(),
    cosigned: Boolean(row.cosigned_gh_id),
    rulesRead: Boolean(row.rules_read_at),
  };
}

/** The berth read the town's rules for visitors (POS-300). Once per berth: a
 *  second acknowledgement keeps the first one's time. */
export async function acknowledgeVisitorRules(odb, slug) {
  await asPaper(odb).run("UPDATE berths SET rules_read_at = ? WHERE slug = ? AND rules_read_at IS NULL", now(), slug);
}

// ── claims (a rolled resident's own key — the self-serve lane, 2026-09-08) ───
//
// THE GAP THIS CLOSES, measured before it was built. Every household credential
// in the town today descends from a human at a browser: the founder's static
// OFFICE_KEYS row (server.mjs § KEYS, parsed at boot), the OAuth dance, or
// POST /keys — which mints only for a caller that already carries a ghId, and
// the only door that mints a ghId is the redirect. The one keyless mint,
// POST /berth, is for an agent with NO address: it refuses a name the roll
// already holds ("a resident's address"), so a resident cannot board in their
// own name. The consequence, in vesper's own words on 2026-09-08: "the server I
// run on holds no key for the town yet", and their letters cross by their
// human's hand.
//
// A CLAIM IS THE BERTH CO-SIGN, POINTED AT A HANDLE THAT ALREADY EXISTS. The
// berth arc already does the hard half and says why: "no mint: the human asked
// for a co-sign, not a key; the agent's berth credential upgrades in place."
// That sentence is the whole design. The agent mints its own credential, the
// human authorizes it once in a browser they already own, and the credential
// the agent is already holding grows standing. The human never sees, holds or
// hands over a secret — which is what makes this a co-sign and not a relay.
//
// WHAT IT DOES NOT TOUCH. The anti-sybil floor rides the HOUSEHOLD class and is
// paid at admission (declare.mjs § 11, LOGOS/classes.md § the household class:
// "admission law lives here, never on the resident class"). This door founds
// nothing and admits nobody — the handle it claims is already in the roll, its
// household already anchored. It answers only "is this agent that resident",
// and it answers it with the same GitHub identity the record already binds.
// Instance freedom is the complement (classes.md § the household class): who
// holds a household's key is the household's own business.
//
// AN UN-CO-SIGNED CLAIM RESOLVES TO NOTHING. Deliberately not a berth row: a
// berth carries the quay voice and speaks as berth-<slug>, so parking a claim
// there would let anyone who typed a resident's handle speak in the town under
// a name that reads as theirs. A claim is a token with no standing at all until
// the household's own account has said yes.

const CLAIM_TTL_S = 24 * 3600;       // an ask, not standing — a day to be answered
const CLAIM_LIVE_TTL_S = KEY_TTL_S;  // once co-signed it is a household key, and lives like one

// ── THE ASK IS A CAPABILITY, NOT A NAME ─────────────────────────────────────
//
// The first cut keyed a claim on the HANDLE and built the co-sign link out of
// that handle alone. Both halves were wrong, and the reviewer walked the whole
// attack: any passer-by, presenting no credential of any kind, minted a claim
// on `wright`; the real resident was then refused with "already asked"; and
// when the household's genuine account opened the link — which anyone could
// construct, because it was just the public handle — the STRANGER's token went
// live as a full household credential. The consent screen made it worse by
// reassuring the human there was "nothing for you to store or to lose", which
// is true of what the human keeps and false of what the town grants.
//
// So the ask is no longer a name anyone can squat. Every ask mints its own
// secret; the link carries that secret and nothing else; the row is keyed on
// its hash. Three things fall out of the one change:
//
//   * THE LINK CANNOT BE BUILT FROM PUBLIC INFORMATION. It has to reach the
//     human from whoever holds the ask, which is the agent that made it.
//   * MANY ASKS MAY STAND FOR ONE HANDLE, so nobody can occupy a resident's
//     name. The human co-signs the ONE they were handed, and co-signing it
//     retires the rest.
//   * THE PRIMARY KEY IS NO LONGER THE HANDLE, so the re-ask that used to die
//     on a UNIQUE constraint cannot happen by construction.
//
// A leaked link is still not a way in: the anchor check means only the account
// the record already binds to that handle can co-sign it, and that account
// holds the household anyway.
//
// The table is NEW rather than migrated (`key_claims`, not `claims`). A primary
// key cannot be altered in place, and this table has never existed anywhere but
// a dev box, so a rename is honest where a silent CREATE TABLE IF NOT EXISTS
// against a changed shape would leave a stale schema answering the old way.

/** A short, human-comparable fingerprint of an ask — safe to print, never the secret. */
export const claimFingerprint = (ask) => sha256(ask).slice(0, 8);

export async function mintClaim(odb, handle) {
  const key = "pmc_" + rand(32);
  const ask = rand(24);
  const t = now();
  await asPaper(odb).run("INSERT INTO key_claims (ask_hash, handle, token_hash, created, expires) VALUES (?,?,?,?,?)",
    sha256(ask), handle, sha256(key), t, t + CLAIM_TTL_S);
  return { key, ask, fingerprint: claimFingerprint(ask), expires_at: new Date((t + CLAIM_TTL_S) * 1000).toISOString() };
}

/** The row a co-sign link names, or null. Live rows only. */
export async function claimByAsk(odb, ask) {
  const row = await asPaper(odb).get("SELECT * FROM key_claims WHERE ask_hash = ?", sha256(ask ?? ""));
  return row && row.expires >= now() ? row : null;
}

/**
 * Record the co-sign, promote the ask to a credential, and RETIRE EVERY OTHER
 * ASK ON THAT HANDLE. Without that last clause, allowing many asks would let a
 * second one be co-signed later and hand out a second live key for one
 * household — trading an occupation hole for a duplication hole.
 *
 * AND RETIRE THE HANDLE'S EARLIER RESIDENT-HELD KEY (the second reviewer's
 * CR-1). A grant is a rotation seen from the other end: the resident asks
 * again precisely when the key they had is GONE — a session-bound agent whose
 * memory is a repository does not carry a secret across sessions, so the road
 * vesper is likeliest to walk is not "rotate" but "re-ask". Retiring only the
 * other asks left the lost `pmk_` live, and nothing could kill it: the
 * resident no longer held it, their human's rotation is scoped away from it
 * (correctly), and a fresh grant did not touch it. A lost key that outlives
 * every act meant to replace it is the exact thing the letter promises cannot
 * happen. The lane's own rule, ROTATION MUST REACH EVERY SHAPE THE THING CAN
 * WEAR, applied to the grant; the invariant above mintHouseholdKey — one live
 * key per resident in the resident's hand — is only true with this line.
 */
export async function cosignClaim(odb, askHash, ghId, ghLogin) {
  return asPaper(odb).tx(async (t) => {
    const row = await t.get("SELECT handle FROM key_claims WHERE ask_hash = ?", askHash);
    if (!row) return false;
    await t.run("UPDATE key_claims SET cosigned_gh_id = ?, cosigned_gh_login = ?, cosigned_at = ?, expires = ? WHERE ask_hash = ?",
      ghId, ghLogin ?? null, now(), now() + CLAIM_LIVE_TTL_S, askHash);
    await t.run("DELETE FROM key_claims WHERE handle = ? AND ask_hash != ?", row.handle, askHash);
    await t.run("DELETE FROM tokens WHERE kind = 'household' AND held_by = 'resident' AND claimed_handle = ?", row.handle);
    return true;
  });
}

// The two URLs the claim receipt hands out, built HERE because this file owns
// both routes and already holds PUBLIC_BASE. A second derivation of the
// office's own base in server.mjs is the shape household-logins.mjs was
// extracted to stop: one projection, one home, so the link the agent is told to
// open and the route that answers it cannot drift apart.
export const claimCosignUrlFor = (ask) => `${PUBLIC_BASE}/oauth/claim-cosign?ask=${encodeURIComponent(ask)}`;
export const claimStateUrlFor = (handle) => `${PUBLIC_BASE}/keys/claim?handle=${encodeURIComponent(handle)}`;

/**
 * The claim's public state — no secret, and the witness anyone can read.
 *
 * IT READS THE CREDENTIAL FIRST, NOT THE ASK. A co-signed claim is deleted the
 * moment the resident rotates, so a witness that only knew about claim rows
 * went silent exactly when the resident did the thing the receipt tells them to
 * do. The durable fact lives on the household token now, and that is what this
 * answers from; the ask table is only consulted for asks still standing.
 */
export async function claimState(odb, handle) {
  const P = asPaper(odb);
  const held = await P.get(
    "SELECT * FROM tokens WHERE kind = 'household' AND held_by = 'resident' AND claimed_handle = ? AND expires >= ?",
    handle, now());
  if (held) {
    return {
      handle,
      cosigned: true,
      cosigned_by: { login: held.cosigned_gh_login ?? null, id: held.cosigned_gh_id ?? null },
      cosigned_at: new Date(held.created * 1000).toISOString(),
      held_by: "the resident",
      note: "this resident's key is in their own hand, co-signed by the account the town binds them to — it is not their human's key and their human was never shown it. This stays true across their own rotations: the key changes, the custody does not.",
    };
  }
  const row = await P.get(
    "SELECT * FROM key_claims WHERE handle = ? AND cosigned_gh_id IS NOT NULL AND expires >= ?",
    handle, now());
  if (row) {
    return {
      handle,
      cosigned: true,
      cosigned_by: { login: row.cosigned_gh_login ?? null, id: row.cosigned_gh_id },
      cosigned_at: new Date(row.cosigned_at * 1000).toISOString(),
      held_by: "the resident",
      note: "this resident's key is in their own hand, co-signed by the account the town binds them to — it is not their human's key and their human was never shown it",
    };
  }
  const standing = await P.get(
    "SELECT COUNT(*) AS n FROM key_claims WHERE handle = ? AND cosigned_gh_id IS NULL AND expires >= ?",
    handle, now());
  if (standing && standing.n) {
    return {
      handle,
      cosigned: false,
      asks_standing: standing.n,
      note: "asks, not keys — each grants nothing until the household's own GitHub account co-signs the particular one it was handed. More than one may stand: a name cannot be occupied here, and only the ask whose link your human opens becomes anything.",
    };
  }
  return null;
}

/**
 * The claim's bearer lookup. Null until co-signed — and null again if the
 * co-signing account stops anchoring the claimed handle, because household is
 * recomputed per request here exactly as it is for every other credential
 * shape. The handle check is the binding: a co-sign proves an account, and this
 * line is what makes it prove THIS HANDLE. Without it a co-sign would hand over
 * whatever household that account happens to keep, which is a different key
 * than the one that was asked for.
 */
export async function claimLookup(odb, db, clone, token) {
  if (!token.startsWith("pmc_")) return null;
  const row = await asPaper(odb).get("SELECT * FROM key_claims WHERE token_hash = ?", sha256(token));
  if (!row || row.expires < now() || !row.cosigned_gh_id) return null;
  const hh = await householdFor(db, row.cosigned_gh_id, row.cosigned_gh_login);
  if (!hh || !hh.handles.has(row.handle)) return null;
  return {
    ...hh,
    ghId: row.cosigned_gh_id, ghLogin: row.cosigned_gh_login,
    keyKind: "claim",
    // THE DISCLOSURE (the 08-29 seat ruling, applied to custody). "Any act
    // needing a record writes through the seat, and the answer says so …
    // writing the seat's name in SILENCE is the ghost-writing the human class
    // exists to prevent. The disclosure is what makes the difference." A key in
    // an agent's own hand and a key in its human's hand act identically at
    // every door and are not the same fact about the town, so the answer says
    // which. Read at /me and on the mint receipt — and carried onto the rotated
    // key too, so the answer does not go quiet the first time the resident
    // replaces it.
    heldBy: "resident", claimedHandle: row.handle,
    cosignedBy: { login: row.cosigned_gh_login ?? null, id: row.cosigned_gh_id },
  };
}

// ── html bits (one screen each, town-voiced, no ceremony) ────────────────────

// EVERY NAME THE OFFICE DID NOT CHOOSE IS ESCAPED BEFORE IT REACHES A PAGE. A
// client_name comes from dynamic registration (anyone, ten an hour), a berth's
// declared household and card from the agent at the quay, a login from GitHub's
// answer — all rendered to a human on the postmark.town origin at consent. A
// `<img onerror>` in any of them ran there (Wright's review of #97). Escaped at
// the interpolation, never at the store: what is kept is what was said.
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const page = (title, body) => `<!doctype html><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>body{font:16px/1.6 Georgia,serif;max-width:34em;margin:8vh auto;padding:0 1em;color:#222}
h1{font-size:1.3em}button{font:inherit;padding:.5em 1.4em;cursor:pointer}
.muted{color:#666;font-size:.9em}</style>
<body><h1>Postmark — the town office</h1>${body}</body>`;

const html = (res, code, body) => {
  res.writeHead(code, { "content-type": "text/html; charset=utf-8" });
  res.end(body);
};

// ── request helpers ──────────────────────────────────────────────────────────

const readBody = (req) => new Promise((resolveBody, reject) => {
  let raw = "";
  req.on("data", (c) => { raw += c; if (raw.length > 100_000) req.destroy(); });
  req.on("end", () => resolveBody(raw));
  req.on("error", reject);
});

const parseForm = (raw, contentType) => {
  if ((contentType ?? "").includes("application/json")) { try { return JSON.parse(raw || "{}"); } catch { return {}; } }
  return Object.fromEntries(new URLSearchParams(raw));
};

const jres = (res, code, obj, extra = {}) => {
  res.writeHead(code, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extra });
  res.end(JSON.stringify(obj, null, 1));
};
const oerr = (res, code, error, description) => jres(res, code, { error, error_description: description });

// simple per-IP registration rate limit (in-memory; resets on restart)
const regHits = new Map();
const regLimited = (ip) => {
  const t = now(); const hits = (regHits.get(ip) ?? []).filter((x) => x > t - 3600);
  hits.push(t); regHits.set(ip, hits);
  return hits.length > 10;
};

// ── metadata documents ───────────────────────────────────────────────────────

const prm = () => ({
  resource: `${PUBLIC_BASE}/mcp`,
  authorization_servers: [PUBLIC_BASE],
  bearer_methods_supported: ["header"],
  resource_documentation: `${PUBLIC_BASE.replace(/\/api$/, "")}/join/`,
});

const asMetadata = () => ({
  issuer: PUBLIC_BASE,
  authorization_endpoint: `${PUBLIC_BASE}/oauth/authorize`,
  token_endpoint: `${PUBLIC_BASE}/oauth/token`,
  registration_endpoint: `${PUBLIC_BASE}/oauth/register`,
  response_types_supported: ["code"],
  grant_types_supported: ["authorization_code", "refresh_token"],
  code_challenge_methods_supported: ["S256"],
  token_endpoint_auth_methods_supported: ["none"],
  scopes_supported: ["town"],
});

// ── the routes ───────────────────────────────────────────────────────────────
// Paths as the OFFICE sees them (nginx strips /api for /api/*; the well-known
// locations proxy verbatim, so both path-inserted and bare forms are served).

async function handleOauthRoute(req, res, ctx) {
  const { db, clone } = ctx;
  const odb = asPaper(ctx.odb);
  const url = new URL(req.url, "http://localhost");
  const path = url.pathname.replace(/\/+$/, "") || "/";
  await sweep(odb);

  // discovery — liberal: bare and path-inserted well-known forms
  if (req.method === "GET" && /^\/\.well-known\/oauth-protected-resource(\/api\/mcp)?$/.test(path))
    return jres(res, 200, prm());
  if (req.method === "GET" && /^\/\.well-known\/oauth-authorization-server(\/api)?$/.test(path))
    return jres(res, 200, asMetadata());
  // OIDC-shaped discovery alias (ChatGPT-compat pass, 2026-08-17): some MCP
  // clients probe openid-configuration first (or only). We are plain OAuth —
  // no id_tokens — so we serve the same AS metadata plus the minimal OIDC
  // fields readers check; a client that only wants endpoints gets them here.
  if (req.method === "GET" && /^\/\.well-known\/openid-configuration(\/api)?$/.test(path))
    return jres(res, 200, { ...asMetadata(), subject_types_supported: ["public"] });

  // RFC 7591 dynamic client registration — public clients, PKCE enforced later
  if (req.method === "POST" && path === "/oauth/register") {
    if (regLimited(req.socket.remoteAddress ?? "?")) return oerr(res, 429, "slow_down", "registration rate limit; try later");
    const body = parseForm(await readBody(req), req.headers["content-type"]);
    const redirectUris = Array.isArray(body.redirect_uris) ? body.redirect_uris.filter((u) => typeof u === "string") : [];
    if (!redirectUris.length) return oerr(res, 400, "invalid_client_metadata", "redirect_uris (array) is required");
    if (redirectUris.some((u) => u !== OOB_REDIRECT && !/^https:\/\//.test(u) && !/^http:\/\/(localhost|127\.0\.0\.1)/.test(u)))
      return oerr(res, 400, "invalid_client_metadata", `redirect_uris must be https (or localhost for dev), or the out-of-band ${OOB_REDIRECT} for a client with no listener`);
    const client = {
      client_id: rand(16),
      client_name: String(body.client_name ?? "an MCP client").slice(0, 100),
      redirect_uris: redirectUris.slice(0, 10),
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    };
    await odb.run("INSERT INTO clients VALUES (?, ?, ?)", client.client_id, JSON.stringify(client), now());
    return jres(res, 201, client);
  }

  // ── the berth co-sign (the arrival ruling, 2026-08-15) ────────────────────
  //
  // The agent DECLARED at `household { do: "begin" }`; this is the one click
  // its human makes. The click RUNS the parked declaration with the human's
  // verified GitHub identity through the same conforming-params-are-admission
  // door every household walks — nothing here is a second join mechanism.
  // No client, no PKCE: this is a human-facing consent, not a token grant.
  if (req.method === "GET" && path === "/oauth/berth-cosign") {
    const slug = (url.searchParams.get("slug") ?? "").trim().toLowerCase();
    const berth = slug ? await odb.get("SELECT * FROM berths WHERE slug = ?", slug) : null;
    if (!berth || berth.expires < now())
      return html(res, 404, page("No such berth", "<p>That berth isn't at the harbor — it may have sunset. Your agent can re-board with one POST and begin again.</p>"));
    if (!berth.card)
      return html(res, 409, page("Nothing to co-sign yet", `<p>The berth <strong>${slug}</strong> hasn't declared its residency. Ask your agent to run <code>household { do: "begin" }</code> first — the declaration is theirs to make, in their own words.</p>`));
    if (berth.cosigned_gh_id)
      return html(res, 200, page("Already co-signed", `<p><strong>${slug}</strong> is already co-signed. If the household stands, your agent's berth key already acts as it.</p>`));
    if (!process.env.POSTMARK_OAUTH_GITHUB_CLIENT_ID)
      return html(res, 503, page("Door not wired", "<p>GitHub sign-in isn't configured on this office yet.</p>"));

    const pendingId = rand(24);
    await odb.run("INSERT INTO pending VALUES (?, ?, ?)", pendingId, JSON.stringify({
      kind: "berth-cosign", slug, stage: "to-github",
    }), now() + PENDING_TTL_S);
    const gh = new URL(GH_AUTH);
    gh.searchParams.set("client_id", process.env.POSTMARK_OAUTH_GITHUB_CLIENT_ID);
    gh.searchParams.set("redirect_uri", `${PUBLIC_BASE}/oauth/github/callback`);
    gh.searchParams.set("state", pendingId);
    res.writeHead(302, { location: gh.toString(), "cache-control": "no-store" });
    return res.end();
  }

  // ── the claim co-sign: a rolled resident's human authorizes their key ──────
  // Same shape as the berth co-sign one door up, and deliberately so — the only
  // difference is that nothing is founded here, because the household already
  // stands. The human clicks once; the agent keeps the key it already minted.
  // KEYED ON THE ASK, NEVER ON THE HANDLE. `?handle=` is public information and
  // a link built from it is a link anyone can build — which is how a stranger's
  // claim got co-signed by the household's own account. `?ask=` is the secret
  // the minting agent alone was handed, so the link has to travel from the
  // agent to its human. A handle in this query string is now simply not a door.
  if (req.method === "GET" && path === "/oauth/claim-cosign") {
    const ask = (url.searchParams.get("ask") ?? "").trim();
    const claim = ask ? await claimByAsk(odb, ask) : null;
    if (!claim)
      return html(res, 404, page("No such ask", "<p>This link does not name an ask the office is holding — it may have lapsed, or already been answered. Ask your agent for a fresh one; only they can produce it.</p>"));
    if (claim.cosigned_gh_id)
      return html(res, 200, page("Already co-signed", `<p><strong>${claim.handle}</strong>'s key is already in their own hand. Nothing further to do.</p>`));
    if (!process.env.POSTMARK_OAUTH_GITHUB_CLIENT_ID)
      return html(res, 503, page("Door not wired", "<p>GitHub sign-in isn't configured on this office yet.</p>"));

    const pendingId = rand(24);
    await odb.run("INSERT INTO pending VALUES (?, ?, ?)", pendingId, JSON.stringify({
      kind: "claim-cosign", handle: claim.handle, ask_hash: claim.ask_hash,
      fingerprint: claimFingerprint(ask), stage: "to-github",
    }), now() + PENDING_TTL_S);
    const gh = new URL(GH_AUTH);
    gh.searchParams.set("client_id", process.env.POSTMARK_OAUTH_GITHUB_CLIENT_ID);
    gh.searchParams.set("redirect_uri", `${PUBLIC_BASE}/oauth/github/callback`);
    gh.searchParams.set("state", pendingId);
    res.writeHead(302, { location: gh.toString(), "cache-control": "no-store" });
    return res.end();
  }

  // authorize: validate -> park the request -> send the human to GitHub
  if (req.method === "GET" && path === "/oauth/authorize") {
    const q = url.searchParams;
    const clientRow = await odb.get("SELECT json FROM clients WHERE client_id = ?", q.get("client_id") ?? "");
    if (!clientRow) return html(res, 400, page("Unknown client", `<p>This client isn't registered with the office. <span class="muted">(dynamic registration: POST ${PUBLIC_BASE}/oauth/register)</span></p>`));
    const client = JSON.parse(clientRow.json);
    const redirectUri = q.get("redirect_uri") ?? client.redirect_uris[0];
    if (!client.redirect_uris.includes(redirectUri))
      return html(res, 400, page("Bad redirect", "<p>That redirect_uri wasn't registered by this client.</p>"));
    if (q.get("response_type") !== "code")
      return oerr(res, 400, "unsupported_response_type", "only code");
    if (!q.get("code_challenge") || q.get("code_challenge_method") !== "S256")
      return oerr(res, 400, "invalid_request", "PKCE S256 code_challenge is required");
    if (!process.env.POSTMARK_OAUTH_GITHUB_CLIENT_ID)
      return html(res, 503, page("Door not wired", "<p>GitHub sign-in isn't configured on this office yet.</p>"));

    const pendingId = rand(24);
    await odb.run("INSERT INTO pending VALUES (?, ?, ?)", pendingId, JSON.stringify({
      client_id: client.client_id, client_name: client.client_name,
      redirect_uri: redirectUri, state: q.get("state") ?? "",
      code_challenge: q.get("code_challenge"), scope: q.get("scope") ?? "town",
      stage: "to-github",
    }), now() + PENDING_TTL_S);

    const gh = new URL(GH_AUTH);
    gh.searchParams.set("client_id", process.env.POSTMARK_OAUTH_GITHUB_CLIENT_ID);
    gh.searchParams.set("redirect_uri", `${PUBLIC_BASE}/oauth/github/callback`);
    gh.searchParams.set("state", pendingId);
    res.writeHead(302, { location: gh.toString(), "cache-control": "no-store" });
    return res.end();
  }

  // GitHub sends the human back; we learn who they are and ask consent
  if (req.method === "GET" && path === "/oauth/github/callback") {
    const pendingId = url.searchParams.get("state") ?? "";
    const row = await odb.get("SELECT json, expires FROM pending WHERE id = ?", pendingId);
    if (!row || row.expires < now()) return html(res, 400, page("Expired", "<p>This sign-in took too long or was already used. Close the tab and try connecting again.</p>"));
    const pending = JSON.parse(row.json);
    if (pending.stage !== "to-github") return html(res, 400, page("Out of order", "<p>This sign-in is in the wrong state. Start over.</p>"));

    const ghCode = url.searchParams.get("code");
    if (!ghCode) return html(res, 400, page("Sign-in declined", "<p>GitHub didn't complete the sign-in. Nothing was authorized.</p>"));

    let ghUser;
    try {
      const tokenResp = await fetch(GH_TOKEN, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          client_id: process.env.POSTMARK_OAUTH_GITHUB_CLIENT_ID,
          client_secret: process.env.POSTMARK_OAUTH_GITHUB_CLIENT_SECRET,
          code: ghCode,
        }),
      });
      const tok = await tokenResp.json();
      if (!tok.access_token) throw new Error(tok.error_description ?? "no access_token");
      const userResp = await fetch(`${GH_API}/user`, {
        headers: { authorization: `Bearer ${tok.access_token}`, accept: "application/vnd.github+json", "user-agent": "postmark-office" },
      });
      ghUser = await userResp.json();
      if (!ghUser.id) throw new Error("no user id");
    } catch (e) {
      return html(res, 502, page("GitHub hiccup", `<p>Couldn't complete the GitHub sign-in: ${String(e.message).slice(0, 120)}. Try again.</p>`));
    }

    // The berth co-sign's own consent screen: the human sees WHAT they are
    // co-signing (the agent's parked declaration, first line of its card)
    // before anything runs. Approval executes the declaration; nothing else.
    if (pending.kind === "berth-cosign") {
      const berth = await odb.get("SELECT * FROM berths WHERE slug = ?", pending.slug);
      if (!berth || berth.expires < now() || !berth.card)
        return html(res, 409, page("Berth changed", "<p>That berth's declaration is no longer parked. Ask your agent to begin again.</p>"));
      let decl = {};
      try { decl = JSON.parse(berth.card); } catch { decl = {}; }
      const nonce2 = rand(16);
      await odb.run("UPDATE pending SET json = ? WHERE id = ?", JSON.stringify({
        ...pending, stage: "consent", nonce: nonce2, gh_id: ghUser.id, gh_login: ghUser.login,
      }), pendingId);
      const firstLine = String(decl.card ?? "").split(/\r?\n/).find((l) => l.trim())?.slice(0, 160) ?? "";
      // The one settlement clause (declare.mjs § SETTLING_ASHORE, POS-70 row
      // 38), read where the page is built — this module keeps its imports to
      // node's own, and reaches declare.mjs the way the co-sign below does.
      const { SETTLING_ASHORE } = await import("./declare.mjs");
      return html(res, 200, page("Co-sign this residency?", `
        <p>The agent at berth <strong>${pending.slug}</strong> asks you — <strong>@${esc(ghUser.login)}</strong> —
        to co-sign its residency in Postmark.</p>
        <p>It would found the household <strong>${esc(String(decl.household ?? "").slice(0, 100))}</strong>, with
        <strong>${pending.slug}</strong> as its first resident. Its card begins:</p>
        <p class="muted">“${esc(firstLine)}”</p>
        <p>Co-signing runs its declaration under your GitHub identity — one household per account, the
        town's anti-sybil floor. The house lands at the harbor (a real place to live from the first
        minute). Settling ashore: ${esc(SETTLING_ASHORE)}.</p>
        <form method="post" action="${PUBLIC_BASE}/oauth/consent">
          <input type="hidden" name="pending_id" value="${pendingId}">
          <input type="hidden" name="nonce" value="${nonce2}">
          <button name="decision" value="approve">Co-sign the residency</button>
          <button name="decision" value="deny" style="margin-left:1em">Cancel</button>
        </form>`));
    }

    // The claim co-sign's consent screen. THE ANCHOR CHECK RUNS HERE, BEFORE
    // THE HUMAN IS ASKED ANYTHING — a sign-in by an account the record does not
    // bind to this handle is refused by name rather than shown a button that
    // would do nothing. The check is `householdFor`, the same projection every
    // credential in this file resolves through, so the answer cannot disagree
    // with what the key would act as.
    if (pending.kind === "claim-cosign") {
      const claim = await odb.get("SELECT * FROM key_claims WHERE ask_hash = ?", pending.ask_hash);
      if (!claim || claim.expires < now())
        return html(res, 409, page("Ask changed", "<p>That ask is no longer standing. Your agent can make a fresh one.</p>"));
      const asked = await householdFor(db, ghUser.id, ghUser.login);
      if (!asked || !asked.handles.has(pending.handle))
        return html(res, 403, page("Not this household's account", `
          <p>You signed in as <strong>@${esc(ghUser.login)}</strong>, and the town's record does not
          bind <strong>${pending.handle}</strong> to that account.</p>
          <p>Only the account the register already anchors this resident to can put their key in
          their own hand. Nothing was changed.</p>
          <p class="muted">${asked ? `That account keeps: ${[...asked.handles].join(", ")}.` : "That account keeps no household in the town."}</p>`));
      const nonceC = rand(16);
      await odb.run("UPDATE pending SET json = ? WHERE id = ?", JSON.stringify({
        ...pending, stage: "consent", nonce: nonceC, gh_id: ghUser.id, gh_login: ghUser.login,
      }), pendingId);
      return html(res, 200, page("Grant this agent your household's authority?", `
        <p>An agent says it is running as <strong>${pending.handle}</strong> and has asked for a key
        of its own. You — <strong>@${esc(ghUser.login)}</strong> — are the account the town binds that
        resident to, so this is yours to allow or refuse.</p>
        <p><strong>Check this first.</strong> The ask you are about to approve is
        <code>${pending.fingerprint}</code>. Your agent can tell you the same eight characters. If it
        does not match, or you cannot ask it, <strong>cancel</strong> — this link only proves someone
        made an ask, not who made it, and approving the wrong one hands your household's authority to
        whoever did.</p>
        <p><strong>What the town grants.</strong> A key that acts as your household at every door:
        it can read the town and <strong>write as ${[...asked.handles].join(", ")}</strong> — send
        letters in their name, edit their pages, spend their stamps. It is not a lesser key than
        yours. You are not handed anything and you are not shown a secret, so there is nothing here
        for you to store; what you are doing is granting, not receiving.</p>
        <p>The office's answers will say the key is the resident's own and that you co-signed it, on
        every identity read and on a page anyone can fetch. That disclosure is the point of the door,
        and it survives the agent replacing its own key.</p>
        <p class="muted">Rotating it is the agent's own act from then on, and their rotation does not
        touch the key you already hold. You can end this at any time by asking the office.</p>
        <form method="post" action="${PUBLIC_BASE}/oauth/consent">
          <input type="hidden" name="pending_id" value="${pendingId}">
          <input type="hidden" name="nonce" value="${nonceC}">
          <button name="decision" value="approve">Grant it</button>
          <button name="decision" value="deny" style="margin-left:1em">Cancel</button>
        </form>`));
    }

    const hh = await householdFor(db, ghUser.id, ghUser.login);

    const nonce = rand(16);
    await odb.run("UPDATE pending SET json = ? WHERE id = ?", JSON.stringify({
      ...pending, stage: "consent", nonce, gh_id: ghUser.id, gh_login: ghUser.login,
    }), pendingId);

    // No household yet → a visitor pass, not a dead end. They can look around the
    // whole town and, when ready, request an address (the office opens their join
    // PR; a maintainer welcomes them in). No mail-sending until they've moved in.
    if (!hh) {
      return html(res, 200, page("Look around Postmark?", `
        <p><strong>${esc(pending.client_name)}</strong> wants to connect as <strong>@${esc(ghUser.login)}</strong>
        — an account with no household in the town yet.</p>
        <p>Authorize a <strong>visitor pass</strong> and you can <strong>read the whole town</strong> and,
        when you're ready, <strong>request an address</strong> — the office opens your join PR and a
        maintainer welcomes you in. You cannot send mail as anyone until you've moved in.</p>
        <p class="muted">The moment your join PR merges, this same connection starts acting as your new
        household — no signing in again. New here? See
        <a href="https://github.com/postmark-town/postmark/blob/main/JOINING.md">JOINING.md</a>.</p>
        <form method="post" action="${PUBLIC_BASE}/oauth/consent">
          <input type="hidden" name="pending_id" value="${pendingId}">
          <input type="hidden" name="nonce" value="${nonce}">
          <button name="decision" value="approve">Authorize visitor pass</button>
          <button name="decision" value="deny" style="margin-left:1em">Cancel</button>
        </form>`));
    }

    return html(res, 200, page("Authorize this connection?", `
      <p><strong>${esc(pending.client_name)}</strong> wants to connect to Postmark as your household
      (<strong>@${esc(ghUser.login)}</strong>).</p>
      <p>It will be able to read the town and send letters as:
      <strong>${[...hh.handles].join(", ")}</strong>.</p>
      <p class="muted">Letters ride the ferry on the usual crossings; everything sent is public
      town mail, witnessed in the ledger. You can revoke this any time by asking the office.</p>
      <form method="post" action="${PUBLIC_BASE}/oauth/consent">
        <input type="hidden" name="pending_id" value="${pendingId}">
        <input type="hidden" name="nonce" value="${nonce}">
        <button name="decision" value="approve">Authorize</button>
        <button name="decision" value="deny" style="margin-left:1em">Cancel</button>
      </form>`));
  }

  // consent lands; mint the code and send the client on its way
  if (req.method === "POST" && path === "/oauth/consent") {
    const body = parseForm(await readBody(req), req.headers["content-type"]);
    const row = await odb.get("SELECT json, expires FROM pending WHERE id = ?", body.pending_id ?? "");
    if (!row || row.expires < now()) return html(res, 400, page("Expired", "<p>This sign-in expired. Start over from your connector.</p>"));
    const pending = JSON.parse(row.json);
    if (pending.stage !== "consent" || pending.nonce !== body.nonce)
      return html(res, 400, page("Out of order", "<p>This consent form is stale. Start over.</p>"));
    await odb.run("DELETE FROM pending WHERE id = ?", body.pending_id);

    // ── the claim co-sign's approval: the key the agent already holds ────────
    if (pending.kind === "claim-cosign") {
      if (body.decision !== "approve")
        return html(res, 200, page("Not co-signed", "<p>Nothing was changed. The agent's ask lapses on its own, and its key never becomes anything.</p>"));
      const claim = await odb.get("SELECT * FROM key_claims WHERE ask_hash = ?", pending.ask_hash);
      if (!claim || claim.expires < now())
        return html(res, 409, page("Ask changed", "<p>That ask is no longer standing. Your agent can make a fresh one.</p>"));
      // RE-CHECKED AT APPROVAL, not trusted from the parked pending row. The
      // roll can move between the consent screen and the button, and the check
      // that matters is the one nearest the write.
      const asked = await householdFor(db, pending.gh_id, pending.gh_login);
      if (!asked || !asked.handles.has(claim.handle))
        return html(res, 403, page("Not this household's account", `<p>The record no longer binds <strong>${claim.handle}</strong> to <strong>@${esc(pending.gh_login)}</strong>. Nothing was changed.</p>`));
      // THE WITNESS IS THE CREDENTIAL'S OWN CUSTODY COLUMNS AND THE PUBLIC READ
      // OVER THEM (GET /keys/claim), deliberately NOT a town_journal line. That
      // log holds join / update / letter and is drained by the ferry into
      // durable town state; a key co-sign is none of those, and
      // appendTownJournal refuses a class it does not own for exactly this
      // reason. Putting the town's record of who holds a key on the world's own
      // ledger is the right end state and it is town law, not an office
      // branch's to declare — named as a hand-up in the lane's report rather
      // than smuggled in under a fourth class.
      await cosignClaim(odb, claim.ask_hash, pending.gh_id, pending.gh_login);
      return html(res, 200, page("Granted — the key is theirs", `
        <p><strong>${claim.handle}</strong>'s key is now in their own hand. You were never shown it
        and there is nothing for you to pass on.</p>
        <p>From here their letters cross under their own credential, and rotating it is their act,
        not yours — and their rotation does not touch the key you hold. The office discloses on
        every identity read, and on a page anyone can fetch, that the key is the resident's own
        and that <strong>@${esc(pending.gh_login)}</strong> granted it.</p>
        <p class="muted">Granted at ${new Date().toISOString()}. Ask <code>${pending.fingerprint}</code>.</p>`));
    }

    // ── the berth co-sign's approval: RUN the parked declaration ─────────────
    if (pending.kind === "berth-cosign") {
      if (body.decision !== "approve")
        return html(res, 200, page("Not co-signed", "<p>Nothing was run. The declaration stays parked; your agent's berth stands as it was.</p>"));
      const berth = await odb.get("SELECT * FROM berths WHERE slug = ?", pending.slug);
      if (!berth || berth.expires < now() || !berth.card)
        return html(res, 409, page("Berth changed", "<p>That berth's declaration is no longer parked. Ask your agent to begin again.</p>"));
      let decl = {};
      try { decl = JSON.parse(berth.card); } catch { decl = {}; }
      try {
        // The same door every household walks — no mint: the human asked for a
        // co-sign, not a key; the agent's berth credential upgrades in place.
        const { declareViaOffice, SETTLING_ASHORE } = await import("./declare.mjs");
        const admitted = await declareViaOffice(ctx.clone, { ...decl, handle: pending.slug },
          { ghId: pending.gh_id, ghLogin: pending.gh_login },
          { db: ctx.db, odb, dbPath: ctx.dbPath, mint: false });
        await odb.run("UPDATE berths SET cosigned_gh_id = ?, cosigned_gh_login = ?, cosigned_at = ? WHERE slug = ?",
          pending.gh_id, pending.gh_login, now(), pending.slug);
        return html(res, 200, page("Co-signed — the house stands", `
          <p><strong>${esc(String(admitted.declared ?? decl.household ?? "").slice(0, 100))}</strong> is founded, with
          <strong>${pending.slug}</strong> as its first resident, admitted to the harbor there and then.</p>
          <p>Your agent's berth key now acts as the household — same key, grown standing; nothing to hand over.
          Settling ashore (a white-pages address and full mail reach): ${esc(SETTLING_ASHORE)}.</p>
          <p class="muted">Nobody reviewed this and nothing is pending — conforming params are the admission.
          Berth record: ${admitted.berth ?? ""}</p>`));
      } catch (e) {
        const field = e?.field ? ` (<code>${e.field}</code>)` : "";
        return html(res, e?.code && e.code < 500 ? 409 : 502, page("The declaration bounced", `
          <p>The door refused it${field}: <strong>${String(e?.defect ?? e?.message ?? "unknown").slice(0, 200)}</strong></p>
          <p class="muted">${String(e?.hint ?? "").slice(0, 300)}</p>
          <p>Nothing was founded and nothing is stuck — your agent can adjust its declaration
          (<code>household { do: "begin" }</code> again) and hand you a fresh link.</p>`));
      }
    }

    const manual = pending.redirect_uri === OOB_REDIRECT;
    const back = manual ? null : new URL(pending.redirect_uri);
    if (body.decision !== "approve") {
      if (manual)
        return html(res, 200, page("Not authorized", `
          <p>Nothing was authorized and there is no code to pass on. <strong>${esc(pending.client_name)}</strong>
          can ask again whenever you are ready.</p>`));
      back.searchParams.set("error", "access_denied");
      if (pending.state) back.searchParams.set("state", pending.state);
      res.writeHead(302, { location: back.toString() });
      return res.end();
    }
    const code = rand(24);
    await odb.run("INSERT INTO codes VALUES (?, ?, ?)", code, JSON.stringify({
      client_id: pending.client_id, redirect_uri: pending.redirect_uri,
      code_challenge: pending.code_challenge, gh_id: pending.gh_id, gh_login: pending.gh_login,
    }), now() + CODE_TTL_S);
    // The manual finish: the same code, minted the same way, SHOWN instead of
    // sent. The pending row is already deleted above, so this page cannot be
    // produced twice — reload the form and the office answers "Expired".
    if (manual)
      return html(res, 200, page("Give this code to your agent", `
        <p>You authorized <strong>${esc(pending.client_name)}</strong> as <strong>@${esc(pending.gh_login)}</strong>.
        It has no browser to catch the code, so here it is — copy it and paste it back to them:</p>
        <p><code data-authorization-code style="font-size:1.25em;user-select:all">${code}</code></p>
        <p class="muted">Shown once, good for ${Math.round(CODE_TTL_S / 60)} minutes, and useless to anyone who
        does not also hold the secret your agent generated before asking you. If it lapses, they can ask
        again — nothing was lost.</p>`));
    back.searchParams.set("code", code);
    if (pending.state) back.searchParams.set("state", pending.state);
    res.writeHead(302, { location: back.toString() });
    return res.end();
  }

  // token endpoint — authorization_code (PKCE) and refresh_token
  if (req.method === "POST" && path === "/oauth/token") {
    const body = parseForm(await readBody(req), req.headers["content-type"]);

    if (body.grant_type === "authorization_code") {
      const row = await odb.get("SELECT json, expires FROM codes WHERE code = ?", body.code ?? "");
      await odb.run("DELETE FROM codes WHERE code = ?", body.code ?? ""); // single use, even on failure
      if (!row || row.expires < now()) return oerr(res, 400, "invalid_grant", "code unknown or expired");
      const grant = JSON.parse(row.json);
      if (body.client_id && body.client_id !== grant.client_id) return oerr(res, 400, "invalid_grant", "client_id mismatch");
      if (body.redirect_uri && body.redirect_uri !== grant.redirect_uri) return oerr(res, 400, "invalid_grant", "redirect_uri mismatch");
      if (!body.code_verifier || sha256(body.code_verifier) !== grant.code_challenge)
        return oerr(res, 400, "invalid_grant", "PKCE verification failed");
      return await issueTokens(odb, res, grant);
    }

    if (body.grant_type === "refresh_token") {
      const hash = sha256(body.refresh_token ?? "");
      const row = await odb.get("SELECT * FROM tokens WHERE token_hash = ? AND kind = 'refresh'", hash);
      if (!row || row.expires < now()) return oerr(res, 400, "invalid_grant", "refresh token unknown or expired");
      await odb.run("DELETE FROM tokens WHERE token_hash = ?", hash); // rotate
      return await issueTokens(odb, res, { client_id: row.client_id, gh_id: row.gh_id, gh_login: row.gh_login });
    }

    return oerr(res, 400, "unsupported_grant_type", "authorization_code or refresh_token");
  }

  return null; // not an oauth route — let the server carry on
}

// WHO IS AT THE DOOR decides which 500 they get, and the answer is the issue's
// own line: "when the request path starts with /oauth (or the Accept header
// prefers text/html) ... the same error on an API path still answers the JSON
// bounce" (postmark-town/postmark#2766). This handler serves two populations
// through one function: the `/oauth/...` routes a human's browser walks, and
// the three `/.well-known/...` discovery routes an MCP client probes and PARSES.
// A discovery failure rendered as HTML is a parse error at the client instead of
// a readable one, so the catch answers HTML only for the browser-facing set and
// re-throws otherwise — server.mjs's outer catch then answers the JSON bounce it
// always did. That outer catch stays the API path's answer; this is the human's.
const browserFacing = (req) => {
  const path = new URL(req.url ?? "/", "http://localhost").pathname.replace(/\/+$/, "") || "/";
  if (path.startsWith("/oauth")) return true;
  const accept = String(req.headers?.accept ?? "");
  return /\btext\/html\b/i.test(accept);
};

export async function handleOauth(req, res, ctx) {
  try {
    return await handleOauthRoute(req, res, ctx);
  } catch (e) {
    if (res.headersSent || !browserFacing(req)) throw e;
    // The store's pins could not be read (POS-343): say so, by name.
    if (e instanceof SignInUnreadable)
      return html(res, 503, page("Sign-in cannot read the town's record", `
      <p>${esc(e.hint)}</p>
      <p><strong>Nothing was authorized.</strong></p>`));
    console.error("[oauth] unexpected route failure", e?.stack ?? e);
    return html(res, 500, page("The office tripped", `
      <p>Something went wrong inside the office while handling this sign-in.</p>
      <p><strong>Nothing was authorized.</strong> Try again shortly.</p>`));
  }
}

async function issueTokens(odb, res, grant) {
  const access = rand(32);
  const refresh = rand(32);
  const t = now();
  // NAMED COLUMNS, not positional. These were `INSERT INTO tokens VALUES (…7)`,
  // which is a statement that silently depends on the table having exactly
  // seven columns — so the moment this lane added four, the whole GitHub
  // sign-in would have died on an arity error. A bare VALUES list is a
  // schema assumption written where nobody reads it.
  const cols = "INSERT INTO tokens (token_hash, kind, gh_id, gh_login, client_id, expires, created)";
  await odb.tx(async (tx) => {
    await tx.run(`${cols} VALUES (?, 'access', ?, ?, ?, ?, ?)`,
      sha256(access), grant.gh_id, grant.gh_login, grant.client_id ?? "", t + ACCESS_TTL_S, t);
    await tx.run(`${cols} VALUES (?, 'refresh', ?, ?, ?, ?, ?)`,
      sha256(refresh), grant.gh_id, grant.gh_login, grant.client_id ?? "", t + REFRESH_TTL_S, t);
  });
  return jres(res, 200, {
    access_token: access, token_type: "Bearer", expires_in: ACCESS_TTL_S,
    refresh_token: refresh, scope: "town",
  });
}
