// household-deriver.mjs — ONE DERIVER ANSWERS "WHICH HOUSE" (POS-160).
//
// The key is the household's SLUG, minted once (POS-158). From the w40 ship
// every NEW line that names a house names `hh:<slug>`; earlier lines keep their
// spellings, because history is not rewritten. `formerly` is the one alias
// mechanism, and THIS FILE is the one place it is read.
//
// ── WHY ONE, AND WHY HERE ───────────────────────────────────────────────────
//
// Three implementations answered "which house" before this file existed, each
// with its own idea of what an answer is:
//
//   the STORE's    `world2-claims.mjs § householdKeyFor` — a lookup in
//                  `identities`, whose `household` column is a projection of
//                  the WORLD repo's copy of the town's pins. Four hops from
//                  the fact, and it answered in whatever spelling that copy
//                  happened to carry (measured 2026-09-22: `gh:<id>` ×173,
//                  `hh:<slug>` ×17).
//   the LEDGER's   the town's `stamp-mint.mjs § householdKeys()` over the pins
//                  plus ADDRESS logins, folded forward by the ledger's dated
//                  `registry:` lines. That one is the ECONOMY's answer and it
//                  is date-shaped on purpose — it stays where it is.
//   the REGISTRY's `residency.mjs § houseForAccount / houseForName`, walking
//                  the registry's own rows.
//
// The first and the third asked the SAME question — which house does this
// account/handle/key belong to, right now — and answered it from two different
// places in two different spellings. That is the drift the ruling kills. This
// file is the third one's walk, generalised over every spelling the first one
// could be handed, and both now call it.
//
// THE LEDGER'S RESOLVER IS NOT FOLDED IN, and that is deliberate. "Which house
// does this handle belong to" has no date; "which key did this handle's mail
// mint under on 2026-07-13" does, and only the sealed ledger can answer it.
// Two questions, two resolvers, one of them here.
//
// ── IT REFUSES RATHER THAN GUESSES ──────────────────────────────────────────
//
// `{ slug: null, via: "unknown" }` is a first-class answer. A caller that
// wanted `solo:<handle>` builds it from the refusal; nothing in here invents a
// house for a handle the registry has never heard of, because a fabricated
// household is worse than an absent one — it files a stranger inside somebody's
// walls, and the parcel cap, the consent gate and the draft row policy all read
// this answer as if it were a fact.

import { loadRegistryRows, registryRowsVia } from "./registry-store.mjs";
import { registryFromRows, pinsFromRows } from "./registry-rows.mjs";

/** The key spelling this town writes from the w40 ship onward. */
export const keyOfSlug = (slug) => (slug ? `hh:${slug}` : null);

/** A house's slug, as `slugFromName` in residency.mjs mints one. Kept in step
 *  with that function deliberately: a dot survives because a house may choose a
 *  domain for its name (cadaeic.space) and that IS the name someone picked. */
export function slugFromName(name) {
  return String(name ?? "").trim().toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9.]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Does one registry `accounts[]` entry name this caller?
 *
 * THE RULE: ID FIRST, AND A LOGIN MATCHES ONLY WHERE NO ID IS ON RECORD.
 *
 * GitHub releases abandoned logins for re-registration, so a stranger who
 * claims a resident's old login must not reach the account that string still
 * names. The ROW's pinned-ness decides, not the caller's: a row carrying an id
 * is matchable by id alone. A legacy row with a login and no id keeps matching
 * by login, so nothing pinned breaks and nothing unpinned regresses.
 *
 * Vendored from `residency.mjs § accountMatches`, which vendored it from the
 * town's `tools/account-match.mjs`. `residency.mjs` now re-exports THIS one, so
 * the office holds a single copy again and the town's is the only twin left.
 */
export function accountMatches(account, actorId, actorLogin) {
  if (!account) return false;
  if (account.id != null) {
    return actorId != null && Number(account.id) === Number(actorId);
  }
  const want = actorLogin ? String(actorLogin).toLowerCase() : null;
  return Boolean(want && account.login && String(account.login).toLowerCase() === want);
}

// Every way a caller can spell the thing it is holding. `via` rides out with
// the answer so a caller (and a reviewer reading a receipt) can see WHICH of
// these the answer came through, rather than trusting that it came at all.
const VIA = Object.freeze({
  SLUG: "slug",          // the slug itself, or `hh:<slug>`
  FORMERLY: "formerly",  // a former or provisional slug, through the alias list
  ACCOUNT: "account",    // `gh:<id>`, or an (id, login) pair, through accounts[]
  RESIDENT: "resident",  // a handle the house lists
  PIN: "pin",            // a handle, through its pin's id, through accounts[]
  NAME: "name",          // the house's name or human, as a person writes it
  UNKNOWN: "unknown",
});
export { VIA };

const NO = Object.freeze({ slug: null, via: VIA.UNKNOWN });
const hit = (slug, via) => Object.freeze({ slug, via });

/** `{ slug -> rec }` from whatever shape the caller had. */
const housesOf = (registry) => registry?.households ?? registry ?? {};

// `formerly` is an ARRAY of past keys. POS-158 writes them as the house wore
// them, which may be a bare slug or a full `hh:` key depending on when the
// rename happened, so both spellings are accepted on the way in. One list, one
// reader, and the reader is tolerant of its own history — the same courtesy
// this whole lane extends to every other line that was written before today.
const formerlyHas = (rec, want) =>
  (rec?.formerly ?? []).some((f) => {
    const s = String(f ?? "").replace(/^hh:/, "");
    return s && s === want;
  });

/**
 * THE ONE DERIVER, pure.
 *
 * @param x        a slug, `hh:<slug>`, `gh:<id>`, a login, a handle, a former
 *                 or provisional slug — or an object carrying any of them
 *                 (`{ handle, ghId, ghLogin, household, key, handles }`).
 * @param registry `loadRegistry()`'s object, or the file's — `{ households }`.
 * @param pins     `loadPins()`'s object — `{ handle: { login, id, … } }`.
 * @param opts     `via` narrows the walk to the named paths. The DEFAULT is
 *                 every path but `name`, because "which house is this key" and
 *                 "which house did this person mean" are different questions
 *                 and only the second one is allowed to be fuzzy.
 *
 * @returns `{ slug, via }`, or `{ slug: null, via: "unknown" }`. Never a guess.
 *
 * ORDER IS THE POINT. Exact identity first (the slug, an account id), then the
 * house's own records (residents, pins), then the alias list, then — only if
 * asked — the name. A `formerly` entry must never outrank a LIVE slug: two
 * houses may legitimately name the same string, one as its key and one as its
 * past, and the live one is the one that exists.
 *
 * NARROWING IS NOT A CONVENIENCE, it is how two callers share one walk without
 * inheriting each other's answers. `houseForName` asks `[SLUG, NAME]` and NOT
 * `RESIDENT`, because a resident handle is not a house's name and a door that
 * refuses a taken name must not refuse somebody's handle. `houseForAccount`
 * asks `[ACCOUNT]` alone, because the account is the whole question it is
 * deciding a co-sign on. Both are exactly what those two functions did before
 * they delegated, and the suites that pin their behaviour still pass unchanged.
 */
export function resolveHouse(x, registry, pins = {}, opts = {}) {
  const houses = housesOf(registry);
  if (!houses || !Object.keys(houses).length) return NO;
  const allowed = opts.via
    ? new Set(Array.isArray(opts.via) ? opts.via : [opts.via])
    : null;
  const may = (path) => (allowed ? allowed.has(path) : path !== VIA.NAME);

  // ── normalise whatever we were handed into the four things we can ask with
  const o = (x && typeof x === "object") ? x : null;
  const raw = o
    ? (o.household ?? o.key ?? o.handle ?? (o.handles ?? [])[0] ?? null)
    : x;
  const s = raw == null ? "" : String(raw).trim();
  const ghId = o?.ghId ?? o?.gh_id ?? (/^gh:(\d+)$/.exec(s)?.[1] ?? null);
  // `login:<name>` is a key the ECONOMY mints for a handle with an ADDRESS
  // github line and no pin, and it names an account exactly as `gh:<id>` does.
  // So it enters through the account walk, under `accountMatches`' rule — which
  // means it reaches a house only where that house's row carries NO id for the
  // login, and a house that pinned the account is no longer reachable by the
  // string alone. That is STRICTER than the nameplate overlay this replaced,
  // deliberately, and it binds nothing differently today: measured 2026-09-22
  // against the live roll, 0 of 190 handles wear a `login:` key at all.
  // A BARE STRING IS TRIED AS A LOGIN TOO. The brief's list of spellings names
  // one — "a login" — and nothing in a bare string says whether it is a handle,
  // a slug or a login, so all three are asked and `accountMatches` decides
  // which may answer. That guard is what makes this safe: a login reaches a
  // house only where the house's own row carries NO id for it, so a handle can
  // never walk into a PINNED account's house by resembling its login string.
  // (Measured 2026-09-22 on the live registry: every one of the 118 houses
  // pins every account it lists, so this path binds nothing today and exists
  // for the legacy rows the town has not retired.)
  const ghLogin = o?.ghLogin ?? o?.gh_login ?? o?.login
    ?? (/^login:(.+)$/.exec(s)?.[1] ?? (s && !s.includes(":") ? s : null));
  // `hh:` strips to a slug; `solo:` and `login:` are keys that name no house of
  // their own, so nothing walks them as a slug — `login:` has already been read
  // for its account above, and `solo:` says "this handle is its own house",
  // which is the absence this function returns rather than an answer.
  // THIS DID NOT MOVE WHEN `houseKeysOf` ADMITTED `solo:` INTO THE SET. The two
  // functions answer different questions — "which house IS this" decides a
  // write, a cap fold and a consent gate; "which rows may this house read" is
  // Ruling 4's read-side question — so `solo:letta-resident` is in letta's set
  // and still resolves to nothing here, deliberately. See § `solo:` WAS REFUSED
  // HERE below, and FALSIFIER 1b, which pins both halves.
  const bare = s.startsWith("hh:") ? s.slice(3) : s;
  const isNonHouseKey = /^(solo|login):/.test(s);
  const wanted = isNonHouseKey ? "" : bare;

  // ── THE ORDER DEPENDS ON WHAT THE CALLER IS HOLDING ────────────────────────
  //
  // A PREFIXED key says what it is: `hh:<slug>` is a house, `gh:<id>` is an
  // account. A BARE string does not, and on the live registry that ambiguity is
  // not hypothetical — THREE handles are also some house's slug (measured
  // 2026-09-22 on the town's own 118 houses):
  //
  //   mari             a resident of `starforge`, and the slug of the house
  //                    whose resident is `ev-attractor`
  //   moth             a resident of `the-rookery`, and the slug of the house
  //                    whose resident is `threshold`
  //   elias-returning  a resident of the house of the same name — harmless,
  //                    because both roads reach the same door
  //
  // Slug-first would therefore file mari's and moth's drafts, stakes and acts
  // inside a stranger's walls, silently. So a bare string is read the way every
  // caller of `householdKeyFor` has always meant it and the way `identities` is
  // keyed: AS A HANDLE FIRST. A caller holding a slug loses nothing — the
  // handle roads simply miss, and the slug road is right behind them — and a
  // caller holding a key was never ambiguous to begin with.
  const prefixed = s.startsWith("hh:");
  const order = prefixed
    ? [VIA.SLUG, VIA.FORMERLY, VIA.ACCOUNT, VIA.RESIDENT, VIA.PIN, VIA.NAME]
    : (ghId != null || o)
      ? [VIA.ACCOUNT, VIA.RESIDENT, VIA.PIN, VIA.SLUG, VIA.FORMERLY, VIA.NAME]
      : [VIA.RESIDENT, VIA.PIN, VIA.SLUG, VIA.ACCOUNT, VIA.FORMERLY, VIA.NAME];

  const road = {
    // the slug itself — the one answer that needs no walk
    [VIA.SLUG]: () =>
      (wanted && Object.hasOwn(houses, wanted)) ? hit(wanted, VIA.SLUG) : null,

    // an account, by id first and login only where the row carries no id
    [VIA.ACCOUNT]: () => {
      if (ghId == null && ghLogin == null) return null;
      for (const [slug, rec] of Object.entries(houses)) {
        for (const a of rec?.accounts ?? []) {
          if (accountMatches(a, ghId, ghLogin)) return hit(slug, VIA.ACCOUNT);
        }
      }
      return null;
    },

    // a handle the house lists as one of its residents
    [VIA.RESIDENT]: () => {
      if (!wanted) return null;
      for (const [slug, rec] of Object.entries(houses)) {
        if ((rec?.residents ?? []).includes(wanted)) return hit(slug, VIA.RESIDENT);
      }
      return null;
    },

    // a handle, through its pin's immutable id, through accounts[]
    // Only the ID — never the pin's login. A pin's `login` string is
    // display-only by the town's own law (`tools/witness.mjs § loadBindings`),
    // and reaching a house through it would re-open the recycled-login hole
    // that `accountMatches` exists to close.
    [VIA.PIN]: () => {
      const pin = wanted && pins ? pins[wanted] : null;
      if (pin?.id == null) return null;
      for (const [slug, rec] of Object.entries(houses)) {
        for (const a of rec?.accounts ?? []) {
          if (a?.id != null && Number(a.id) === Number(pin.id)) return hit(slug, VIA.PIN);
        }
      }
      return null;
    },

    // a former or provisional slug, through the one alias mechanism
    [VIA.FORMERLY]: () => {
      if (!wanted) return null;
      for (const [slug, rec] of Object.entries(houses)) {
        if (formerlyHas(rec, wanted)) return hit(slug, VIA.FORMERLY);
      }
      return null;
    },

    // the name a person writes, only when the caller asked for that question
    [VIA.NAME]: () => {
      const want = slugFromName(raw);
      if (!want) return null;
      for (const [slug, rec] of Object.entries(houses)) {
        if (slug.toLowerCase() === want) return hit(slug, VIA.NAME);
        if (rec?.name && slugFromName(rec.name) === want) return hit(slug, VIA.NAME);
        if (rec?.human && slugFromName(rec.human) === want) return hit(slug, VIA.NAME);
      }
      return null;
    },
  };

  for (const path of order) {
    if (!may(path)) continue;
    const answer = road[path]();
    if (answer) return answer;
  }

  return NO;
}

// ═══════════════════════════════════════════════════════════════════════════
// THE SPELLING SET — every name one house has ever answered to (RULING 4)
// ═══════════════════════════════════════════════════════════════════════════
//
// ── WHY A SET AND NOT A REWRITE ─────────────────────────────────────────────
//
// `022_household_respell.sql` was going to re-spell `claims` and `marks` so a
// session keyed `hh:<slug>` could see drafts written under `gh:<id>`. THE STORE
// REFUSES IT, and by three separate laws, each measured on the dev sandbox
// 2026-09-22 (Wright's hand, a real Postgres):
//
//   `acts_append_only`     002_grants.sql — "an act is never edited"
//   `claims_update_guard`  007_private_drafts.sql — EVERY lawful transition
//                          requires `NEW.household IS NOT DISTINCT FROM
//                          OLD.household`. "A claim's household never changes."
//   `marks_id_is_fixed`    the same rule one table over
//
// The store's own law is that a row's household spelling is FIXED FOR ITS LIFE,
// and this file's header already said it from the other side: "earlier lines
// keep their spellings — history is not rewritten." So the defect 022 named is
// real and its fix was on the wrong side of the wall. THE FIX IS ON THE READ
// SIDE: a house declares every spelling it has ever carried, and the policy and
// every household filter compare against the set.
//
// ── WHICH SPELLINGS ARE ADMITTED, AND WHICH ARE NOT ─────────────────────────
//
// MEASURED on `test/fixtures/registry-2026-09-22/` — the town's own two files,
// byte-exact, 118 households / 190 pins:
//
//   `hh:<slug>`     118 — one per house. THE FIRST ENTRY, always.
//   `gh:<id>`       121 — every account the registry lists carries an id
//                         (0 of 121 are login-only), and three houses hold two.
//   `hh:<formerly>`   0 — POS-158 shipped the column and no door has reached
//                         it yet. Admitted anyway, because the moment one does
//                         a renamed house's old rows are exactly this problem.
//   `solo:<held>`   304 — every handle (190) and every account login (121)
//                         THIS house holds and nobody else's, less the 7 that
//                         are both at once. The follow-up below. 543 keys in
//                         all, over the town's 118 houses.
//
// ── `solo:` WAS REFUSED HERE, AND THE REFUSAL WAS WRONG ─────────────────────
//
// The first cut of this block excluded `solo:<handle>` on the rule "NAMES NO
// HOUSE", which is what `resolveHouse` still answers and what 022's own map
// said. IT WAS TRUE WHEN THE ROW WAS WRITTEN AND IT IS FALSE NOW, and the
// difference is POS-159's backfill: since that measurement every resident on
// the roll stands in exactly one house (188 of 188 by account), and the
// registry's own invariant is that a handle belongs to AT MOST ONE house. So a
// `solo:` spelling of a handle THE HOUSE ITSELF HOLDS is not a fabricated
// household — it is a historical spelling of that house, exactly as `gh:<id>`
// is, and the house is the only reader that can be handed it.
//
// MEASURED ON THE DEV SANDBOX 2026-09-22 21:11, after migration 024, a real
// Postgres: the store holds 10 draft claims under `solo:kadakatzenberg`. With
// `app.household_keys = 'hh:the-familiar-house'` alone their author sees 0 of
// them; with `solo:kadakatzenberg` in the set they see all 10; a stranger sees
// 0. That is RED 1, and this block is its fix.
//
// THE MEASURED ROW IS A LOGIN, NOT A HANDLE, and that is why two classes of
// string are admitted rather than one. `kadakatzenberg` is the GitHub login of
// `the-familiar-house`'s one account; its resident handle is
// `sophia-familiaris`. `world2-claims.mjs § THE ONE RESOLVER` writes
// `claims.household` from the ACTING KEY, and for a human-credentialed act
// that key is the human's GitHub login — so the `solo:` rows in the store are
// spelled with handles AND with logins, verbatim, case and all
// (`materialize.mjs`'s own header names three: `solo:devadavisson`,
// `solo:kristinashoultz-wq`, `solo:FluffUPando`). A set admitting only the
// handle spelling would leave the measured 10 drafts exactly where they are.
//
// SO: `solo:<x>` is admitted for every `x` this house holds —
//
//   its `residents[]` handles;
//   every handle whose PIN id is one of this house's account ids (the same
//     id-only road `VIA.PIN` walks, and for the same recycled-login reason);
//   every `accounts[].login` the house lists;
//   the `login` each of those handles' pins wears.
//
// MEASURED on the fixture: 190 distinct handles and 121 distinct logins are
// held this way (7 strings are both, for one house), giving 304 `solo:` keys,
// and NOT ONE of them is held by two houses — so every `solo:` key in the town
// belongs to exactly one house's set. `FALSIFIER 1g` asserts that census
// rather than trusting this paragraph, and it is the whole safety argument:
// the reason a bare `mari` is refused below is that a set has no order to
// disambiguate it, and `solo:mari` needs none — measured, it names starforge's
// resident and nothing else, while the house whose SLUG is `mari` carries
// `solo:ev-attractor` and no `solo:mari` at all.
//
// THE ONE COST, STATED RATHER THAN BURIED. The refusal this replaces named a
// real consequence: a `solo:` draft becomes readable by the author's HOUSEMATES
// and not only by the author, because 007's grain is the household and not the
// person. That is not a side effect of the set — it is what the household grain
// already means for every `hh:`-spelled draft in the store, and a `solo:` row
// written by a resident who now stands in a house is that house's row. The
// alternative on offer is the measured one: the author sees none of their own
// ten drafts. Ruling 4 takes the housemate over the locked drawer; if Keemin's
// word before Sunday's deploy prefers the drawer, the fix is a per-person carve
// on 007 and not a narrower set, because the same argument would then apply to
// every `gh:`-spelled draft this set already admits.
//
// TWO THINGS THIS DELIBERATELY DOES NOT DO:
//
//   IT DOES NOT MOVE `resolveHouse`. A `solo:` key still answers `unknown`
//   there, so nothing that asks "which house IS this" — the write side, the
//   parcel-cap fold, a consent gate — changes its answer. The set is the READ
//   side's question ("which rows may this house see") and Ruling 4 is a read-
//   side ruling. One consequence is worth stating plainly rather than leaving
//   for a reader to trip over: `houseKeysOf('hh:letta')` now contains
//   `solo:wren-winter` while `houseKeysOf('solo:wren-winter')` is still `[]`.
//   That asymmetry is the ruling's shape, not an oversight, and FALSIFIER 1b
//   pins both halves of it.
//
//   IT DOES NOT LOWERCASE A LOGIN. 39 of the 121 live logins carry uppercase
//   and the pen wrote them verbatim, so the verbatim spelling is the one that
//   matches a row. A case-folded variant would be a second key admitted on a
//   guess about what some past writer did, and `= ANY(set)` cannot tell a
//   reader which of the two matched.
//
// AND TWO CLASSES STILL REFUSED, each for a reason a future reader will want:
//
//   BARE STRINGS     a bare slug, a bare handle, a bare login, a bare former
//                    slug. `resolveHouse` can read these safely ONLY BECAUSE IT
//                    IS ORDERED — a bare string is tried as a HANDLE first,
//                    precisely because three live handles are also some house's
//                    slug (`mari`, `moth`, `elias-returning`, measured
//                    2026-09-22). A SET HAS NO ORDER. `household = ANY(set)`
//                    matches on membership alone, so a bare `mari` in the set
//                    of ev-attractor's house would match a row that meant
//                    starforge's resident — a cross-household read, silently.
//                    Every admitted spelling is PREFIXED, which is 022's own
//                    rank-0 sentence: "a prefixed key says what it is; no
//                    ambiguity."
//
//   `login:<name>`   an ACCOUNT spelling whose match rule is conditional —
//                    `accountMatches` lets a login reach a house only where
//                    that house's row carries NO id for it. A set cannot carry
//                    a condition. Measured: 0 of 190 handles wear a `login:`
//                    key and every one of the 118 houses pins every account it
//                    lists, so this binds nothing today and is refused on the
//                    rule rather than on the count.

/** A comma is the separator `024_household_spellings.sql` splits on. */
const COMMA = ",";

/** Refuse a key that would split into two on the way into the policy. */
const assertNoComma = (k) => {
  if (String(k).includes(COMMA))
    throw new Error(
      `household-deriver: the key ${JSON.stringify(k)} carries a comma, and the session key is comma-joined ` +
      `(024_household_spellings.sql § string_to_array) — it would split into two keys, one of which may be ` +
      `another house's. Refusing rather than declaring it.`);
  return k;
};

/**
 * EVERY `solo:` STRING THIS ONE HOUSE HOLDS — the handles it keeps and the
 * logins those handles' credentials wear. PURE, and ordered: residents as the
 * registry lists them, then the accounts' logins, then anything the pins add.
 *
 * THE PIN ROAD IS ID-ONLY, matching `VIA.PIN`'s own rule. A pin's `login` is
 * display-only by the town's law (`tools/witness.mjs § loadBindings`), so a
 * handle reaches this house through its pin's IMMUTABLE ID and never through
 * the string — otherwise a recycled GitHub login would walk a stranger's handle
 * into this house's spelling set, which is the recycled-login hole
 * `accountMatches` exists to close, re-opened one door over.
 *
 * A login is taken VERBATIM. See § IT DOES NOT LOWERCASE A LOGIN above.
 */
function soloHeldBy(rec, pins) {
  const out = [];
  const seen = new Set();
  const put = (s) => {
    const v = String(s ?? "").trim();
    if (v && !seen.has(v)) { seen.add(v); out.push(v); }
  };

  const ids = new Set((rec?.accounts ?? [])
    .map((a) => a?.id).filter((x) => x != null).map(Number));

  const handles = [];
  for (const h of rec?.residents ?? []) { const v = String(h ?? "").trim(); if (v) handles.push(v); }
  for (const [handle, pin] of Object.entries(pins ?? {}))
    if (pin?.id != null && ids.has(Number(pin.id))) handles.push(String(handle).trim());

  for (const h of handles) put(h);
  for (const a of rec?.accounts ?? []) put(a?.login);
  for (const h of handles) put(pins?.[h]?.login);

  return out;
}

/**
 * EVERY SPELLING ONE HOUSE HAS EVER CARRIED, the house being whichever one `x`
 * resolves to. PURE.
 *
 * @returns `[]` when `x` names no house — the same refusal `resolveHouse`
 *          gives, not an empty house.
 *
 * ORDER IS PART OF THE ANSWER: the live `hh:<slug>` first, so a caller that
 * wants the ONE CURRENT spelling can read `[0]` and a receipt naming the set
 * names the house before its history.
 *
 * IT THROWS ON A COMMA. The session key crosses into Postgres as one string and
 * `024` splits it with `string_to_array(…, ',')`, so a key carrying a comma
 * would silently become two keys — one of which could be some other house's.
 * `slugFromName` cannot mint one (`[^a-z0-9.]+` collapses to `-`) and `gh:` is
 * digits, so this cannot fire today; it is here because the day it could, the
 * failure is a cross-household read that nothing else would say a word about.
 */
export function houseKeysOf(x, registry, pins = {}, opts = {}) {
  const { slug } = resolveHouse(x, registry, pins, opts);
  if (!slug) return [];
  const rec = housesOf(registry)[slug] ?? {};
  const out = [];
  const add = (k) => {
    if (!k || out.includes(k)) return;
    out.push(assertNoComma(k));
  };

  add(keyOfSlug(slug));                                     // the live key, first
  for (const f of rec.formerly ?? []) {                     // then the alias list
    const s = String(f ?? "").replace(/^hh:/, "").trim();
    if (s) add(`hh:${s}`);
  }
  for (const a of rec.accounts ?? [])                       // then every account
    if (a?.id != null) add(`gh:${a.id}`);
  for (const held of soloHeldBy(rec, pins))                 // then its own `solo:` past
    add(`solo:${held}`);

  return out;
}

/**
 * THE SET A SESSION DECLARES for the key it is acting under. PURE.
 *
 * `key` ALWAYS COMES FIRST AND IS ALWAYS PRESENT, whatever the registry says,
 * and that is the whole safety of this function:
 *
 *   a `solo:<handle>` key names no house, so `houseKeysOf` answers `[]` — and a
 *   session declaring `[]` would see NONE of its own drafts, which is a
 *   REGRESSION on today rather than the fix. The key itself in the set means
 *   this can only ever ADD spellings to what a session can already read.
 *
 * So: no answer from the registry leaves a resident worse off than the string
 * equality did, and a known house gains its history.
 */
export function sessionKeysFor(key, registry, pins = {}) {
  if (key == null || key === "") return [];
  assertNoComma(key);
  const keys = houseKeysOf(key, registry, pins);
  return [key, ...keys.filter((k) => k !== key)];
}

// ── the loaded half ─────────────────────────────────────────────────────────
//
// One registry read per request, and one answer per (request, x). The registry
// is three tables and a fold; `householdKeyFor` is called once per journal row
// and twice per guarded write, so an unmemoised deriver would put the whole
// registry through `registryFromRows` on every line of a crossing.
//
// THE CACHE IS EXPLICITLY DISPOSABLE. `__clearHouseCache()` is the seam a test
// and a long-lived process both need: the office's own drain writes rows and
// then reads them back in the same process, and a cache that outlived the write
// would answer with the town from before the ceremony. Every writer in
// `registry-store.mjs` clears it; so does `withRecordFrom` in the suites.

let loaded = null;       // { registry, pins } — the module pool's fold, once
let answers = new Map(); // `${via}|${x}` -> { slug, via }
let viaRows = new WeakMap();    // queryable -> { registry, pins }
let viaAnswers = new WeakMap(); // queryable -> Map<memo, { slug, via }>

/** Drop the memo. Called by every registry writer and by the test harness. */
export function __clearHouseCache() {
  loaded = null;
  answers = new Map();
  viaRows = new WeakMap();
  viaAnswers = new WeakMap();
}

/** The registry and pins, folded once per process until something writes. */
export async function houseRows(env = process.env) {
  if (loaded) return loaded;
  const rows = await loadRegistryRows(env);
  if (rows === null) return null;          // the office is not pointed at the record
  loaded = { registry: registryFromRows(rows), pins: pinsFromRows(rows) };
  return loaded;
}

/**
 * "Which house is this?" — the one question, asked of the record.
 *
 * `{ slug: null, via: "unknown" }` when the record has never heard of `x`, and
 * the SAME answer when the office is not pointed at the record at all. Those
 * two are genuinely the same fact for every caller here — "I cannot name a
 * house for this" — and the callers that must tell them apart (the drain, the
 * seed) read `loadRegistry()` directly and get `null` for the second.
 */
export async function houseOf(x, env = process.env, opts = {}) {
  const rows = await houseRows(env);
  if (!rows) return NO;
  const memo = `${opts.via ? [].concat(opts.via).join("+") : "*"}|${typeof x === "object" ? JSON.stringify(x) : String(x)}`;
  const was = answers.get(memo);
  if (was) return was;
  const out = resolveHouse(x, rows.registry, rows.pins, opts);
  answers.set(memo, out);
  return out;
}

/** The house's KEY, as the ship writes one: `hh:<slug>`, or null. */
export async function houseKeyOf(x, env = process.env) {
  return keyOfSlug((await houseOf(x, env)).slug);
}

// ── the queryable half ──────────────────────────────────────────────────────
//
// The store's resolver (`world2-claims.mjs § householdKeyFor`) is handed a
// client or a pool and must answer from THAT one — see `registryRowsVia`'s
// header for why reaching past it would be the two-queue disease renamed.
//
// The memo is keyed on the queryable itself, in a WeakMap, so a pool that lives
// for the life of the process is folded once and a per-request client is
// collected with its request. `__clearHouseCache()` drops these too, because a
// suite that writes a row and reads it back through the same stub pool must see
// the row it wrote.

/** The registry and pins as THIS queryable holds them, folded once. */
export async function houseRowsVia(q) {
  const was = viaRows.get(q);
  if (was) return was;
  const rows = await registryRowsVia(q);
  const out = { registry: registryFromRows(rows), pins: pinsFromRows(rows) };
  viaRows.set(q, out);
  return out;
}

/** "Which house is this?", asked of the store the caller is already holding. */
export async function houseOfVia(q, x, opts = {}) {
  const rows = await houseRowsVia(q);
  let memos = viaAnswers.get(q);
  if (!memos) { memos = new Map(); viaAnswers.set(q, memos); }
  const memo = `${opts.via ? [].concat(opts.via).join("+") : "*"}|${typeof x === "object" ? JSON.stringify(x) : String(x)}`;
  const hitMemo = memos.get(memo);
  if (hitMemo) return hitMemo;
  const out = resolveHouse(x, rows.registry, rows.pins, opts);
  memos.set(memo, out);
  return out;
}

/** The house's KEY from the caller's store: `hh:<slug>`, or null. */
export async function houseKeyOfVia(q, x) {
  return keyOfSlug((await houseOfVia(q, x)).slug);
}

/** Every spelling this house has carried, from the caller's own store. */
export async function houseKeysOfVia(q, x) {
  const rows = await houseRowsVia(q);
  return houseKeysOf(x, rows.registry, rows.pins);
}

/**
 * THE SESSION'S SPELLING SET, from the caller's own store — what
 * `app.household_keys` is set to, and what `= ANY(…)` compares against.
 *
 * IT DOES NOT SWALLOW A REGISTRY FAILURE, deliberately. Every call site
 * (`withHousehold`, `officeWrite`, the guards' `scoped`) has ALREADY resolved
 * its household key through this same deriver against this same store, so a
 * registry this cannot read is a registry the caller could not read either — a
 * throw here adds no failure the door did not already have. Catching it would
 * silently narrow the set back to one spelling, and a guard reading narrow is
 * `guard-reads.mjs § THE RLS CONTRACT`'s own worst case: it PERMITS wrongly,
 * with nothing anywhere saying the answer was partial.
 */
export async function sessionKeysVia(q, key) {
  if (key == null || key === "") return [];
  const rows = await houseRowsVia(q);
  return sessionKeysFor(key, rows.registry, rows.pins);
}

/** The same set, from the module pool's fold. */
export async function sessionKeysOf(key, env = process.env) {
  if (key == null || key === "") return [];
  const rows = await houseRows(env);
  if (!rows) return [key];
  return sessionKeysFor(key, rows.registry, rows.pins);
}

/** The session key as `024`'s policy parses it: comma-joined, or null. */
export const sessionKeyString = (keys) => (keys?.length ? keys.join(COMMA) : null);
