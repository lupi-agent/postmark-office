// household-logins.mjs — the town's GitHub-login → hand projection, in ONE place.
//
// Ruling 9's lesson, again: never a second resolver. The base is the town's own
// `stamp-mint.mjs currentHouseholds()` — the from-genesis truth PLUS the stamp
// ledger's dated `registry:` re-keys — and the pins are the town's own
// `tools/github-ids.json`. Nothing here parses a ledger or invents a key; this
// file only PROJECTS what the town already decided, into the two shapes its
// readers need.
//
// It was extracted from tools/world-households-export.mjs on 2026-08-27, when
// the card rail became the third reader of the same twelve lines. Two copies of
// a projection is how a login means one household on one surface and another
// household on the next; the export tool now calls these functions, so there is
// exactly one derivation and a falsifier proves its output did not move.
//
// WHY currentHouseholds AND NOT householdKeys. The export tool's own note, kept
// because it is the trap: "currentHouseholds, not householdKeys: the base is
// from-genesis truth, and a household re-key rides the stamp ledger as a dated
// registry: line — reading the bare base made a ledger-only re-key invisible to
// the parcel cap (caught 2026-08-07, the cadaeic.space unification)." The two
// disagree today on three live handles, so this is not a hypothetical.
//
// ── WHAT A CONSUMER MAY AND MAY NOT CONCLUDE ────────────────────────────────
//
// A login here names a HOUSEHOLD, never a person. `hands` is every current
// resident handle sharing that household's key, and its LENGTH is the whole
// question a money surface must ask: one hand is an answer, several hands is a
// household and not a hand, zero hands is a pin the registry has outlived.
// A consumer that picks the first of several is guessing with somebody's deed.

import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * handle → household key, as a sorted plain object.
 * `currentMap` is `currentHouseholds(TOWN)`: Map<handle, { key, … }>.
 */
export function householdsOf(currentMap) {
  const households = {};
  for (const [handle, rec] of [...currentMap.entries()].sort((a, b) => a[0].localeCompare(b[0])))
    households[handle] = rec.key;
  return households;
}

/**
 * lowercased GitHub login → household key.
 *
 * Verbatim the derivation world-households-export.mjs has always used, so its
 * emission cannot move: pinned handles contribute their pin's login, and
 * login-keyed households bind their own name by construction.
 *
 * `ambiguous` is the one thing this adds, and it adds nothing to the map: it
 * names every login that TWO pins bind to DIFFERENT accounts. The pins file is
 * keyed by handle, so many handles sharing one login is the ordinary shape of a
 * household (six handles behind `darkelf381` today) — those all carry the same
 * id and resolve to the same key, which is not ambiguity. Two different ids
 * behind one login is a data fault, and last-wins would silently pick a winner.
 * The map keeps last-wins so the export's bytes do not move; a reader who is
 * about to spend somebody's mint chance asks `ambiguous` first.
 */
export function loginKeys(pins, households) {
  const logins = {};
  const seen = new Map();
  const ambiguous = new Set();
  for (const rec of Object.values(pins ?? {})) {
    if (!rec?.login || !rec?.id) continue;
    const login = String(rec.login).toLowerCase();
    const key = `gh:${rec.id}`;
    if (seen.has(login) && seen.get(login) !== key) ambiguous.add(login);
    seen.set(login, key);
    logins[login] = key;
  }
  for (const key of Object.values(households ?? {}))
    if (key.startsWith("login:")) logins[key.slice("login:".length).toLowerCase()] = key;
  return { logins, ambiguous };
}

// ── THE SECOND KEY: a household the authorship wall can read ────────────────
//
// WHAT THE WALL ACTUALLY DOES. `settlement-sweep.mjs:905-919` and
// `tools/lane-wall.mjs:87` both resolve a sketchbook's NAME through this file's
// `logins` map — `logins[branchName.slice("draft/".length).toLowerCase()]` — and
// the sweep then compares that against the mark author's own household
// (`households[record.by]`). It leaves a branch it cannot bind ALONE rather than
// refusing it: "unverifiable is the status quo, never a new refusal (registry
// lag must not strand the pen's own writes)".
//
// SO AN UNBINDABLE KEY IS A SILENT HOLE, NOT A LOUD ONE. Every mark in such a
// household publishes with its authorship unchecked, and every test stays green
// while it happens. That is the same defect `store-writedown.mjs` exists to keep
// a RENAME from causing, arriving instead from the registry's own side.
//
// AND THE MAP ONLY EVER HELD ONE SHAPE. `loginKeys` above binds exactly two
// things: a pin's GitHub login, and a `login:`-keyed household's own name. Every
// other household key the town can mint is invisible to the wall by
// construction. Measured against the live town, 2026-09-09:
//
//     gh:<id>   150 handles · 101 distinct keys · every one bound by its pin
//     hh:<house>  8 handles ·   7 distinct keys · NOT ONE OF THEM BOUND
//     solo:<handle>  the shape `stamp-mint.householdKeys()` mints for a
//                    WHITE_PAGES room with no ADDRESS github — zero today, and
//                    the code path that makes them is live
//
// `hh:` is today's instance of the class and `solo:` was yesterday's. The rule
// below closes the class rather than either instance: EVERY household key the
// registry holds that no login binds is bound here by the sketchbook name it
// will actually carry, so the wall can read it.
//
// WHY THE NAME COMES FROM THE SAME FUNCTION THE WRITE-DOWN USES. If this planted
// one spelling and `store-writedown.sketchbookNameFor` chose another, the map
// would bind a branch nobody opens while the branch that IS opened stays
// unbindable — a fix that reads as done and changes nothing. So there is one
// resolver, `sketchbookNameForKey`, and the write-down's refusing wrapper calls
// it. Two spellings cannot exist.
//
// WHAT THIS DELIBERATELY DOES NOT TOUCH. `loginKeys` itself does not move: its
// output is also the card rail's and the Stripe attribution map's
// (`tools/stripe-watch.mjs resolveHand`), where a new key is a new way for a
// typed string to become somebody's hand. The second keys are composed onto the
// EXPORTED map in `tools/world-households-export.mjs` and nowhere else, so the
// money surface reads exactly the map it read yesterday.

/** A legal git branch component — the sketchbook name has to be one. */
export const SKETCHBOOK_COMPONENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * THE ONE RESOLVER: household key → the sketchbook name the world repo speaks.
 *
 * Returns `{ name, reason, bound }`. `reason` is null when the name is good;
 * `"ambiguous"` when several logins bind the key (`bound` names them) and
 * picking one would bind the wall to a household a mark may not belong to;
 * `"unnameable"` when the key yields no legal branch component. It REPORTS
 * rather than throws so both callers can say it in their own words — the
 * write-down as a `FoldInputRefusal` that stops a crossing, the export as a
 * shouted line that leaves a key unplanted.
 *
 * The mapping is discovered, not invented — it reproduces the names the git era
 * already uses. `gh:293432145` → `aionsolare`, and origin carries
 * `draft/AionSolare`; the wall lowercases, so case does not matter to it. Every
 * other shape is named by the part after its colon: `solo:ev-attractor` →
 * `ev-attractor`, `hh:cadaeic.space` → `cadaeic.space`, and origin carries
 * `draft/ev-attractor` today.
 */
export function sketchbookNameForKey(householdKey, logins = {}) {
  const key = String(householdKey);
  const colon = key.indexOf(":");
  const prefix = colon === -1 ? null : key.slice(0, colon);
  const rest = colon === -1 ? key : key.slice(colon + 1);

  let name = rest;
  if (prefix === "gh") {
    const bound = Object.entries(logins ?? {}).filter(([, v]) => v === key).map(([login]) => login);
    if (bound.length === 1) name = bound[0];
    else if (bound.length > 1) return { name: null, reason: "ambiguous", bound };
    // No login binds this key. The git era has no sketchbook for it either, so
    // the numeric id is the only stable name left.
    else name = `gh-${rest}`;
  }

  if (!SKETCHBOOK_COMPONENT.test(name)) return { name, reason: "unnameable", bound: [] };
  return { name, reason: null, bound: [] };
}

/**
 * The second keys: `{ additions, collisions, unnameable }`.
 *
 * `additions` is lowercased sketchbook name → household key, for every DISTINCT
 * key in `households` that no entry of `logins` already binds. Merge it UNDER
 * the real logins, never over them.
 *
 * TWO REFUSALS RATHER THAN A WINNER, both the same principle as the write-down's
 * ambiguity refusal:
 *
 *  - a name an actual login already holds is left alone and reported. That login
 *    is a binding the town wrote down under review; overwriting it would move a
 *    household's marks under another household's wall.
 *  - a name TWO unbound keys both want is planted for neither. Binding it to
 *    either would tell the wall that one household's sketchbook belongs to the
 *    other, which is the exact silent mis-binding this whole mechanism exists to
 *    prevent.
 *
 * Zero of both today, over the live town — which is when a guard is cheap to
 * write and impossible to test later.
 *
 * IDEMPOTENT BY CONSTRUCTION: a key it has already planted is a key some entry
 * of `logins` now binds, so a second pass over the merged map adds nothing. A
 * falsifier holds it to that, because the export is re-run on pin churn and a
 * projection that grows every run is a projection nobody can diff.
 */
export function sketchbookKeys(households, logins) {
  const alreadyBound = new Set(Object.values(logins ?? {}));
  const keys = [...new Set(Object.values(households ?? {}))]
    .filter((key) => !alreadyBound.has(key)).sort((a, b) => a.localeCompare(b));

  const wants = new Map();
  const unnameable = [];
  for (const key of keys) {
    const { name, reason, bound } = sketchbookNameForKey(key, logins);
    if (reason) { unnameable.push({ key, name, reason, bound }); continue; }
    const at = name.toLowerCase();
    if (!wants.has(at)) wants.set(at, []);
    wants.get(at).push(key);
  }

  const additions = {};
  const collisions = [];
  for (const [name, wanted] of [...wants.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (Object.prototype.hasOwnProperty.call(logins ?? {}, name)) {
      collisions.push({ name, keys: wanted, holds: logins[name] });
      continue;
    }
    if (wanted.length > 1) { collisions.push({ name, keys: wanted, holds: null }); continue; }
    additions[name] = wanted[0];
  }
  return { additions, collisions, unnameable };
}

// ── ONE KEY PER DECLARED HOUSE (the Starling House, 2026-09-30) ─────────────
//
// `householdsOf` answers the stamp ledger's key for each handle, and the ledger
// spells one house several ways: a resident the office declared carries its
// sealed `hh:<house>` line, while residents who joined by PR under the same
// account carry their pin's `gh:<id>`. House of Many Doors was `hh:` for
// kinofire and `gh:334016343` for wayward-archivist, seasiren and wildcat, so
// the world's authorship wall read the Starling House (wayward-archivist's, in
// the `draft/house-of-many-doors` sketchbook) as another household's and left
// it drafted at every settlement. Eight of 134 declared houses were split.
//
// So the WORLD's copy keys every handle by the house the store declares it in
// (tools/households.json, printed from the store): `hh:<slug>`. Every spelling
// of that house resolves to it — each account's `gh:<id>`, the current key, and
// every `formerly` key. A handle no declared house lists keeps its ledger key.
// This composes onto the EXPORTED map only; `householdsOf` and `loginKeys` do not
// move, because the card rail and the Stripe attribution read them.

/**
 * `{ households, logins, names }`: the export's maps with every spelling of a
 * declared house resolved to its one key, and `names` — each declared house's
 * sketchbook name (its slug, and each former slug) bound to that key. A house's
 * own sketchbook must stay bindable even when a login already binds its key,
 * since the store writes its marks under the house's name.
 */
export function oneKeyPerHouse(households, logins, declared) {
  const byKey = new Map();
  const byHand = new Map();
  const names = {};
  for (const [slug, rec] of Object.entries(declared?.households ?? {})) {
    const key = `hh:${slug}`;
    byKey.set(key, key);
    names[slug.toLowerCase()] = key;
    for (const f of rec?.formerly ?? []) {
      if (!f) continue;
      byKey.set(`hh:${f}`, key);
      names[String(f).toLowerCase()] = key;
    }
    for (const a of rec?.accounts ?? []) if (a?.id != null) byKey.set(`gh:${a.id}`, key);
    for (const h of rec?.residents ?? []) byHand.set(h, key);
  }
  const canon = (k) => byKey.get(k) ?? k;
  const outHouseholds = {};
  for (const [handle, key] of Object.entries(households ?? {})) outHouseholds[handle] = byHand.get(handle) ?? canon(key);
  const outLogins = {};
  for (const [login, key] of Object.entries(logins ?? {})) outLogins[login] = canon(key);
  return { households: outHouseholds, logins: outLogins, names };
}

/** household key → its current resident handles, sorted. */
export function handsByKey(households) {
  const byKey = new Map();
  for (const [handle, key] of Object.entries(households ?? {})) {
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(handle);
  }
  for (const hands of byKey.values()) hands.sort();
  return byKey;
}

/**
 * THE MAP THE CARD RAIL ASKS: lowercased login → { key, hands, ambiguous }.
 *
 * Pure — no clock, no network, no filesystem. `hands` is [] for a pin whose
 * household holds no current handle and for an ambiguous login; in both cases
 * the length is not 1 and a consumer's single rule refuses it without a
 * special case.
 */
export function loginHands(currentMap, pins) {
  const households = householdsOf(currentMap);
  const { logins, ambiguous } = loginKeys(pins, households);
  const byKey = handsByKey(households);
  const out = new Map();
  for (const [login, key] of Object.entries(logins)) {
    if (ambiguous.has(login)) { out.set(login, { key: null, hands: [], ambiguous: true }); continue; }
    out.set(login, { key, hands: (byKey.get(key) ?? []).slice(), ambiguous: false });
  }
  return out;
}

/** The town's pins file, or {} — a clone without one is a clone with no pins. */
export function readPins(clone) {
  try { return JSON.parse(readFileSync(join(clone, "tools", "github-ids.json"), "utf8")); }
  catch { return {}; }
}

/**
 * The one line a CLI writes. `engine` is injected — the town's own stamp-mint
 * module — so a falsifier hands in a fixture engine rather than a real town.
 * An engine without `currentHouseholds` yields an EMPTY map, which is the
 * honest answer: no pins were read, so no login is a hand, and every typed
 * string falls through to whatever the caller's other rules say.
 */
export function townLoginHands(clone, engine) {
  if (typeof engine?.currentHouseholds !== "function") return new Map();
  return loginHands(engine.currentHouseholds(clone), readPins(clone));
}

/**
 * THE WORLD'S HOUSEHOLD MAPS, for a town clone: `{ households, logins, names }`,
 * exactly what tools/world-households-export.mjs publishes as
 * WORLD/households.json (its `households` is what the fold reads). The town's
 * own resolver (`engine.currentHouseholds`: the pins, the ADDRESS logins and the
 * ledger's dated `registry:` lines), the pins' logins, then one key per declared
 * house (tools/households.json). Moved here from the export on 2026-10-05
 * (POS-410) so a settlement snapshot derives the same map from its own register
 * rows; the export's emission does not move.
 */
export function worldHouseholdsAt(clone, engine) {
  const ledgerHouseholds = householdsOf(engine.currentHouseholds(clone));
  const { logins: ledgerLogins } = loginKeys(readPins(clone), ledgerHouseholds);
  const declared = (() => {
    try { return JSON.parse(readFileSync(join(clone, "tools", "households.json"), "utf8")); } catch { return null; }
  })();
  return oneKeyPerHouse(ledgerHouseholds, ledgerLogins, declared);
}
