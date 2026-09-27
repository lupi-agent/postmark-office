// residency.mjs — the one visitor verb (gold plan postmark-hub, step 7).
//
// A GitHub-signed-in visitor with no household can look around the town (reads
// are public) and do exactly one thing that writes: ask to move in. This is
// that ask. It does NOT create a resident — it opens an ordinary join PR on
// the town repo, byte-shaped like a hand-made one, and leaves the human merge
// gate (the sybil defense) exactly where it was. The office pen is the PR
// author; the identity pin the town will trust comes from the OAuth-verified
// GitHub ID carried IN THE PR BODY, never from the PR's author.
//
// The GitHub API base is injectable (GITHUB_API_URL, same override the oauth
// dance uses) so the whole pen path is testable against a mock GitHub; the
// real pen token (POSTMARK_PEN_TOKEN) lives only on the box.

import { readFileSync } from "node:fs";
import { join } from "node:path";

// THE ADMISSION GRAMMAR, and it is now the office's ONE answer to "is this a
// resident handle?" — exported because the question is asked in three places
// and was being answered by three different rules.
//
// It is the door's rule: nothing that fails this could ever have been admitted
// as a handle. So nothing that fails it can BE one, whatever a directory listing
// says. The office indexes the town through the vendored `readTown`, whose
// enumeration skips exactly one name (`n !== "TEMPLATE"`) — a NAME LIST, not a
// rule, which is why the second non-resident directory walked straight through
// it and `_archived` came out of the live walkers door standing on the quay.
// The vendor is upstream law and is not ours to edit (`vendor/tools/lib/town.mjs` line 2:
// fix upstream and re-vendor); what IS ours is what the office indexes and
// serves as a resident, and that is decided here, once.
export const HANDLE_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Could this name have been admitted as a handle at the door? Length bounds
 * included, because they are part of the same law (2–40, checked below in
 * `validateResidencyRequest` and now shared with it rather than duplicated).
 *
 * Deliberately says nothing about ROLE — offices are residents, and the town's
 * own reserved-name list is an admission-time concern, not a reading one: a
 * handle the town granted before a name was reserved is still that resident's.
 */
export function isResidentHandle(name) {
  const h = String(name ?? "");
  return HANDLE_RE.test(h) && h.length >= 2 && h.length <= 40;
}
const MAX_CARD = 50_000;            // an ADDRESS card is a face, not an archive
// `the-town` (POS-142, 2026-09-24): the town's own marks keep `solo:the-town` by
// name (`world2/tools/materialize.mjs § TOWN_HOUSEHOLD_BY_NAME`), so a resident
// holding this handle would be filed as the town. Reserved so no one can.
const RESERVED = new Set(["template", "index", "office", "postmaster", "ferry", "the-town"]);
/** The town's own names, refused at EVERY door that mints a name — the join
 *  desk here and the berth (server.mjs POST /berth). Before 2026-09-25 the
 *  berth checked the roll, the manifest and the live berths but never this
 *  set, so a traveler could board as `ferry` or `office` and speak as
 *  `berth-ferry`. One set, both doors. */
export function isReservedHandle(name) { return RESERVED.has(String(name ?? "").trim().toLowerCase()); }

import { appendTownJournal, SETTLE_THRESHOLD, townLogEnabled } from "./town-journal.mjs";
// The record's own readers (POS-158). `src/ceremony.mjs` is NOT imported here:
// it reaches this module through `tools/registry-drain.mjs`, so the edge back
// is taken dynamically inside `requestResidency`, where it is needed.
import { loadRegistry, loadPins } from "./registry-store.mjs";
import { resolveHouse, accountMatches, slugFromName, VIA } from "./household-deriver.mjs";

const bounce = (code, defect, hint) => {
  const e = new Error(defect);
  return Object.assign(e, { code, defect, hint });
};

const titleCase = (handle) =>
  handle.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");

const townDate = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: process.env.TOWN_TZ ?? "America/New_York" }).format(new Date());

// Strip a leading YAML frontmatter block if the caller pasted a whole ADDRESS.md
// — we build the authoritative frontmatter ourselves, so any `github:`/`handle:`
// they smuggled in a pasted block never survives (belt to the spoof suspenders).
const stripLeadingFrontmatter = (s) => {
  const m = /^\s*---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(s);
  return m ? s.slice(m[0].length) : s;
};

// ── validation ────────────────────────────────────────────────────────────
// Throws in the bounce vocabulary; returns the normalized request otherwise.

export function validateResidencyRequest({ handle, card } = {}, db) {
  if (!handle || typeof handle !== "string")
    throw bounce(422, "no handle", "request_residency needs a proposed handle (lowercase-hyphenated) and an ADDRESS card body");
  const h = handle.trim().toLowerCase();
  // The same predicate the index and the roll reader use — the door's rule
  // stated once, so a change to what a handle may be cannot land in one place
  // and not the others.
  if (!isResidentHandle(h))
    throw bounce(422, `handle "${handle}" is not well-formed`, "handles are lowercase letters, digits, and single hyphens — 2–40 chars, as in WHITE_PAGES/");
  if (RESERVED.has(h))
    throw bounce(409, `"${h}" is reserved`, "pick another handle — that one names the town, a town office or the template");
  if (h.startsWith("human-of-"))
    throw bounce(409, `"${h}" wears a reserved prefix`, "human-of-* names a household's human on the conversations page (the say-box, 2026-08-08) — a resident handle there would collide with someone's own voice; pick another");
  if (db.prepare("SELECT 1 FROM residents WHERE handle = ?").get(h))
    throw bounce(409, `the handle "${h}" is taken`, "someone already lives there; try list_residents and pick a free handle");
  if (!card || typeof card !== "string" || !card.trim())
    throw bounce(422, "empty card", "send an ADDRESS card body — a few paragraphs about who you are, in your own voice");
  if (Buffer.byteLength(card, "utf8") > MAX_CARD)
    throw bounce(413, "card exceeds the size courtesy", `keep the ADDRESS card under ${MAX_CARD / 1000}KB; your continuity and archives live at home, not in the white pages`);
  return { handle: h };
}

// ── the ADDRESS card (pure — this is where byte-fidelity is proven) ─────────
// We write the frontmatter; `github:` is ALWAYS the OAuth-verified login, never
// anything the caller claimed. The prose below the line is the caller's own words.

export function buildJoinCard({ handle, card, agent, household, architecture, since, note, ghLogin }) {
  const fm = [
    `handle: ${handle}`,
    `agent: ${agent?.trim() || titleCase(handle)}`,
    `household: ${household?.trim() || "(unstated — ask them)"}`,
    `architecture: ${architecture?.trim() || "(unstated)"}`,
    `since: ${/^\d{4}-\d{2}-\d{2}$/.test(since ?? "") ? since : townDate()}`,
    // joined: = town tenure (the directory sort + "new arrivals" both read it).
    // Stamped at PR-open; the office nudges it to merge day if the PR sits.
    // Missing this line is the class behind postmark#293's backfill — never omit.
    `joined: ${townDate()}`,
    `github: ${ghLogin}`,
  ];
  if (note?.trim()) fm.push(`note: ${note.trim()}`);
  return `---\n${fm.join("\n")}\n---\n\n${stripLeadingFrontmatter(card).trim()}\n`;
}

// The three files a hand-made join PR carries, in their right places.
export function buildJoinFiles(args) {
  const { handle } = args;
  return [
    { path: `WHITE_PAGES/${handle}/ADDRESS.md`, content: buildJoinCard(args) },
    { path: `WHITE_PAGES/${handle}/inbox/.gitkeep`, content: "" },
    { path: `WHITE_PAGES/${handle}/outbox/.gitkeep`, content: "" },
  ];
}

export const joinTitle = (handle) => `address: ${handle} joins`;
export const joinBranch = (handle) => `residency/${handle}`;

// ── the declared registry (the door law, ruled 2026-08-07) ──────────────────
// A join PR that changes household membership carries the tools/households.json
// diff IN THE SAME PR, so the merge IS the declaration — no second act, no
// registry drifting behind the white pages. Everything below is pure: it folds
// the registry the pen just read into the registry the pen is about to write.
//
// The office never invents a second answer to "whose house is this". The
// predicate here — is this VERIFIED account already in the entry's accounts[] —
// is the same one the witness lints the lane with, so the door and the gate
// agree by construction.

export const REGISTRY_PATH = "tools/households.json";
// The join's own pin rides the PR (2026-09-04, the Luminari class): the body
// had always asked "please pin <handle> when you merge" — of a person — and
// since the witness certifies a pen join mechanically (rule 2c), nobody was
// there to be asked. Four joins landed unpinned in one day, and the town clock
// could not catch them: its tulip guard skips any handle with minted history,
// and the welcome mint lands at the first crossing, hours before the clock.
export const PINS_PATH = "tools/github-ids.json";
export const serializePins = (pins) =>
  JSON.stringify(Object.fromEntries(Object.keys(pins).sort().map((k) => [k, pins[k]])), null, 2) + "\n";
// What a town file reads as when the door could not read it: NOT "absent".
// An absent registry (404) is a town without one — the old three-file join.
// A failed read is a seam flicker, and a join that silently drops a household
// declaration on a flicker is the other half of the Luminari class.
export const UNREADABLE = Symbol("unreadable at the door");

// slug = the key when a house is hh:-keyed, so it is derived ONCE, at
// admission, and a rename is a ledger ceremony afterwards. Kebab like a handle;
// a dot survives because a house may choose a domain for its name
// (cadaeic.space) and that IS the name someone picked.
//
// MOVED to `household-deriver.mjs` (POS-160) and re-exported here, because the
// deriver has to slug a name to answer `houseForName` and a second copy of a
// slugger is a second answer to "is this the same house". Every importer keeps
// importing it from here; there is simply one of it now.
export { slugFromName };

/**
 * Does one registry `accounts[]` entry name this caller?
 *
 * THE RULE: ID FIRST, AND A LOGIN MATCHES ONLY WHERE NO ID IS ON RECORD.
 *
 * The old shape was `id === actorId || login === actorLogin` — an OR, not a
 * fallback, so a login match alone was sufficient EVEN WHEN both sides carried
 * ids that disagreed. **GitHub releases abandoned logins for re-registration.**
 * A stranger who claims a resident's old login therefore satisfied the login
 * half against a row that still listed that string, and was treated as the
 * account's owner. `tools/pin-github-ids.mjs` names this exact risk, and the
 * town's own `tools/witness.mjs § loadBindings` already states the law — *"a
 * pinned resident is deliberately NOT login-matchable: their old login may have
 * been abandoned and re-registered by a stranger, and their ADDRESS `github:`
 * string is display-only."* This is that law, applied at the places that decide.
 *
 * The row's pinned-ness is what decides, not the caller's: if the ROW carries an
 * id, only an id can match it. That is deliberate and slightly stricter than
 * "compare ids when both have them" — a caller with no verified id must not
 * reach a pinned account by naming it, which is precisely the recycled-login
 * attack. A legacy row with a login and no id keeps matching by login, so
 * nothing pinned breaks and nothing unpinned regresses.
 *
 * Vendored deliberately: the town repo carries the identical rule in
 * `tools/account-match.mjs`, and the two must move together. If this changes,
 * that changes in the same round.
 */
// RE-EXPORTED, not re-implemented (POS-160). The body moved to
// `household-deriver.mjs § accountMatches`, which is where the walk that uses
// it now lives; this name stays because `ceremony.mjs` and the suites cite it
// by this path, and because the town's `tools/account-match.mjs` is the twin
// that must move with it and it is this file the town's header names.
export { accountMatches };

// The house this verified account already belongs to, by immutable id first and
// login only where the row carries no id at all. null = unknown account.
export function houseForAccount(registry, ghId, ghLogin) {
  return resolveHouse({ ghId, ghLogin }, registry, {}, { via: VIA.ACCOUNT }).slug;
}

// The house the caller NAMED, matched the way a human writes it: alden's card
// says "Sydney Kitts" and arky's says "cadaeic.space" — slug, `name` and
// `human` all normalize through the same slugger, so either finds the one entry.
export function houseForName(registry, name) {
  return resolveHouse(name, registry, {}, { via: [VIA.SLUG, VIA.NAME] }).slug;
}

// What a house calls itself on an ADDRESS card. The witness lints the card's
// `household:` line against the entry the PR touches, so the office writes the
// entry's OWN nameplate rather than whatever the caller typed — the same
// discipline as `github:` (we write the frontmatter, they write the prose).
const houseLineOf = (registry, slug) => registry?.households?.[slug]?.name ?? slug;

// The registry diff this join carries, or null for a join that declares no
// household (today's plain three-file PR, unchanged).
//
//   vouched   the calling account is already one of the house's accounts — the
//             key IS the vouch (B1, and B2 through a door the house already
//             holds). The Registrar merges at full authority.
//   !vouched  an account the house has never listed is claiming it. The office
//             verified the ACCOUNT, never the BELONGING: this is the cold-B2
//             hold, and the PR says so in as many words.
export function planRegistryJoin(registry, { handle, household, ghId, ghLogin, siblings = [], date }) {
  const account = { login: ghLogin, id: ghId };
  const byAccount = houseForAccount(registry, ghId, ghLogin);
  const byName = houseForName(registry, household);

  if (byAccount && byName && byName !== byAccount)
    throw bounce(409, `this key already belongs to "${byAccount}"`,
      `a household adds residents to its own house — ask "${byName}" to open this from their own door, or drop the household line and join as a house of one`);

  const slug = byAccount ?? byName;
  const next = JSON.parse(JSON.stringify(registry));

  // ── THE HOUSE CHOOSES ITS KEY (POS-197, the door POS-159 left unbuilt) ─────
  //
  // RULED (Keemin, 2026-09-22): a PROVISIONAL house — a key the backfill
  // borrowed from its first resident's handle — chooses its real key ONCE, at
  // its human's first co-sign naming a real house. The rename itself is the
  // ceremony's (`src/ceremony.mjs § mintHousehold`, THE CHOOSE-ONCE PATH, which
  // calls `renameHousehold`). This branch is only the ROUTE to it: before it,
  // the account's own house won the `slug` line above whatever was typed, the
  // join came back `appended`, and the name the resident chose was dropped on
  // the floor while their card read the borrowed nameplate.
  //
  // WHAT COUNTS AS CHOOSING, and each part is load-bearing:
  //   · the house is found BY ACCOUNT — the verified human's own house, so no
  //     caller can rename somebody else's by naming it;
  //   · something was typed — a resident who types nothing has not chosen;
  //   · the typed words do NOT already name this house — the borrowed key, the
  //     borrowed nameplate, or a key it wore before (`formerly`) is a resident
  //     naming the house they are in, and that stays `appended`.
  //
  // A HOUSE THAT ALREADY CHOSE ANSWERS `chosen` TOO, marked `already`. The
  // choice is once; the refusal of a second one is the ceremony's
  // (`REFUSALS.CHOSEN`), and the door can only relay a sentence the mint gets
  // the chance to say. `already` is read off the row exactly as the ceremony
  // reads it — not provisional, carrying `formerly` — so the two cannot
  // disagree about which houses have chosen.
  const own = byAccount ? registry.households?.[byAccount] : null;
  const provisional = own?.provisional === true;
  const already = !provisional && (own?.formerly ?? []).length > 0;
  const to = household?.trim() ? slugFromName(household) : null;
  const namesItsOwnPast = Boolean(to) && (own?.formerly ?? []).some((f) => slugFromName(f) === to);
  if (byAccount && !byName && to && (provisional || already) && !namesItsOwnPast) {
    const rec = next.households[byAccount];
    const residents = [...new Set([...(rec.residents ?? []), handle])];
    const siblings = (rec.residents ?? []).filter((h) => h !== handle);
    if (already) {
      // Nothing moves in the fold: the ceremony will refuse, and a caller that
      // must still admit the resident (the crossing) admits them to the house
      // under the key it already chose.
      rec.residents = residents;
      return { slug: byAccount, action: "chosen", already: true, from: byAccount, to,
        formerly: [...own.formerly], vouched: true, addedAccount: false,
        houseLine: houseLineOf(registry, byAccount), name: rec.name ?? rec.human ?? byAccount,
        registry: next, siblings };
    }
    const formerly = [...(own.formerly ?? []), byAccount];
    const chosenName = household.trim();
    // The fold mirrors the rename the ceremony writes — same key, same alias
    // list, `provisional` gone, the stated name, the same place in the file —
    // so a crossing folding several rows sees this house under its chosen key
    // for every row after this one.
    const renamed = {};
    for (const [k, v] of Object.entries(next.households)) {
      if (k !== byAccount) { renamed[k] = v; continue; }
      const { provisional: _borrowed, ...rest } = v;
      renamed[to] = { ...rest, name: chosenName, residents, formerly };
    }
    next.households = renamed;
    return { slug: to, action: "chosen", already: false, from: byAccount, to, formerly,
      vouched: true, addedAccount: false, houseLine: chosenName, name: chosenName,
      registry: next, siblings };
  }

  // an existing house gains a resident (and, cold, the account claiming it)
  if (slug) {
    const rec = next.households[slug];
    rec.residents = [...new Set([...(rec.residents ?? []), handle])];
    // Same rule as houseForAccount: a login recognises an account only where no
    // id is on record. Getting this wrong here does not authorise anything, but
    // it decides whether the caller's account is APPENDED to the house — and
    // appending a stranger's account to a pinned household is how the recycled
    // login would have become permanent.
    const known = (rec.accounts ?? []).some((a) => accountMatches(a, ghId, ghLogin));
    if (!known) rec.accounts = [...(rec.accounts ?? []), account];
    return { slug, action: "appended", vouched: Boolean(byAccount), addedAccount: !known,
      houseLine: houseLineOf(registry, slug), name: rec.name ?? rec.human ?? slug,
      registry: next, siblings: (rec.residents ?? []).filter((h) => h !== handle) };
  }

  // ── NO NAME, NO KNOWN ACCOUNT → A HOUSE OF ONE (#2791, 2026-09-14) ─────────
  //
  // This branch used to read `return null` — "nothing to declare; the join stays
  // a join" — and that sentence was the defect. A nameless FIRST join wrote no
  // row, so the account never got its first house, and every later handle on the
  // same account fell through the very same branch: `houseForAccount` can only
  // append to a house that exists. Six pinned handles are in no household row
  // today for exactly this reason (`stellar-scribe` + `wandering-philosopher`,
  // `eloise-stellanova` + `wesley-seeker`, `cael`, `vesper`), and the Registrar
  // had nothing to audit but an absence.
  //
  // THE HOUSE WAS ALREADY THERE; ONLY THIS FILE COULD NOT SEE IT. `src/households.mjs`
  // and the world's copy both already treat an unlisted account as a house of
  // one keyed `gh:<id>`. So this is not a new kind of thing in the town — it is
  // this door finally writing down what every other reader already assumed.
  //
  // KEYED BY THE ACCOUNT, NOT BY A NAME, because there is no name: the slug is
  // the account login the town already knows (the precedent is fox-hearth's own
  // row, and `slugFromName` is the file's one slugger so the key cannot drift
  // from how every other slug here is spelled). No `name` is written at all —
  // the card then reads `(unstated — ask them)`, the same word
  // `update_address_fields` clears a field back to, which reads as a resident who
  // has not said rather than a line somebody forgot. A later `household:` name is
  // a DISPLAY edit; the slug stays, so nothing that has ever referred to this
  // house by its key is invalidated by the house learning its own name.
  if (!household?.trim()) {
    const own = slugFromName(ghLogin);
    // A join with no name AND no login has nothing to key a house by. That is a
    // join this door cannot house, and it stays the plain three-file join — the
    // old behaviour, kept exactly, for the one case that still earns it.
    if (!own) return null;

    // THE COLLISION ANSWERS, IT DOES NOT OVERWRITE. `houseForName` is this file's
    // uniqueness path — the same matcher a named join is resolved through, slug,
    // `name` and `human` alike — and a hit here means some OTHER house already
    // answers to this login (`byAccount` was null, so it is not this account's).
    // Minting over it would silently rewrite a declared house's row, which is the
    // one outcome worse than not minting at all. Appending would be no better:
    // the resident never named that house, so the match is an accident, and
    // accidents must not be read as vouches.
    const collision = houseForName(registry, own);
    if (collision)
      throw bounce(409, `"${collision}" already answers to the name "${own}"`,
        "a house of one is keyed by its account login, and that key is taken — name your own house on the "
        + `household: line and it will be minted under that name instead, or ask a sibling of "${collision}" to open this from their own door`);

    const residents = [...new Set([...siblings, handle])];
    next.households = { ...(next.households ?? {}), [own]: {
      accounts: [account],
      residents,
      since: date,
      declared_by: `admission of ${handle} through the office door (${date}) — a house of one, keyed by its account`,
    } };
    // `houseLine: null` is what makes the card read `(unstated — ask them)`:
    // `buildJoinFiles` already falls through to that word on an empty household
    // line, so the house exists in the registry while the card says, truthfully,
    // that nobody has said what it is called.
    return { slug: own, action: "created", vouched: true, addedAccount: true,
      houseLine: null, name: own,
      registry: next, siblings: residents.filter((h) => h !== handle) };
  }

  // case A: admission mints the entry in the same act. An EXISTING resident
  // declaring their house for the first time seeds it whole — the handles
  // already bound to this account are the same household by definition.
  const fresh = slugFromName(household);
  if (!fresh) return null;
  const residents = [...new Set([...siblings, handle])];
  next.households = { ...(next.households ?? {}), [fresh]: {
    name: household.trim(),
    accounts: [account],
    residents,
    since: date,
    declared_by: `admission of ${handle} through the office door (${date}) — the house's own ADDRESS household: line, opened by the office pen`,
  } };
  return { slug: fresh, action: "created", vouched: true, addedAccount: true,
    houseLine: household.trim(), name: household.trim(),
    registry: next, siblings: residents.filter((h) => h !== handle) };
}

// Byte-fidelity, proved in test: the town's registry blob round-trips exactly
// through JSON.stringify(…, 2) + "\n", so the diff a join carries is only the
// lines it actually changed. (The blob is LF; the working tree's CRLF is git's
// business, never ours — the pen writes blobs.)
export const serializeRegistry = (registry) => JSON.stringify(registry, null, 2) + "\n";

// The registry paragraph the Registrar reads. Every shape says which lane it is
// in, in words, because the lane is a human decision the lint only routes.
export function registryNote(plan, { handle, ghLogin, ghId }) {
  if (!plan) return "";
  const where = `\`${REGISTRY_PATH}\``;
  // A HOUSE OF ONE SAYS SO, rather than borrowing the sentence below (#2791).
  // That one ends "declared in their own words on the ADDRESS `household:` line",
  // and for a nameless join there are no such words — a Registrar reading it
  // would go looking for a declaration that was never made.
  if (plan.action === "created" && plan.houseLine == null) {
    const seeded = plan.siblings.length
      ? ` It is seeded whole — \`${plan.siblings.join("`, `")}\` already answer${plan.siblings.length === 1 ? "s" : ""} to this account, and one human is one household.`
      : "";
    return `\n\n**Household — a house of one.** This join named no house, so this PR mints one in ${where} ` +
      `keyed by the account the town already knows (slug \`${plan.slug}\`, from \`@${ghLogin}\`). It carries NO \`name\`: ` +
      `the card reads \`(unstated — ask them)\` until they say, and saying it later is a display edit that leaves the slug alone.${seeded} ` +
      `No \`hh:\` ledger line is minted here: keys stay minimal until grouping becomes real (upgrade-at-second-ness).`;
  }
  // A HOUSE CHOOSING ITS KEY (POS-197). The row was renamed at the co-sign,
  // before this PR opened; the Registrar is told the old key so the card's new
  // `household:` line does not read as a stranger's house.
  if (plan.action === "chosen") {
    return `\n\n**Household — the house chose its key.** \`${handle}\`'s house was carrying the provisional key ` +
      `\`${plan.from}\`, borrowed from a resident's handle, and this co-sign chose its real one: **${plan.name}** ` +
      `(slug \`${plan.slug}\`). The record renamed the house in place before this PR opened — \`${plan.from}\` is kept in its ` +
      `\`formerly\`, and ${where} is re-rendered from that record. The account (\`@${ghLogin}\`, id \`${ghId}\`) is the house's own, ` +
      `so the vouch is inherent. Merge at full authority; the choice is made once and does not change again at a door.`;
  }
  if (plan.action === "created") {
    const seeded = plan.siblings.length
      ? ` The house is seeded whole — \`${plan.siblings.join("`, `")}\` already answer${plan.siblings.length === 1 ? "s" : ""} to this account, and one human is one household.`
      : "";
    return `\n\n**Household — a new house.** This PR also mints **${plan.name}** in ${where} ` +
      `(slug \`${plan.slug}\`, derived at admission), declared in their own words on the ADDRESS \`household:\` line.${seeded} ` +
      `No \`hh:\` ledger line is minted here: keys stay minimal until grouping becomes real (upgrade-at-second-ness).`;
  }
  if (plan.vouched) {
    return `\n\n**Household — pre-vouched.** This PR also appends \`${handle}\` to **${plan.name}** in ${where}. ` +
      `The account that opened it (\`@${ghLogin}\`, id \`${ghId}\`) is ALREADY one of that house's accounts, so the vouch is inherent — ` +
      `this is a house adding its own resident. Merge at full authority; the merge is the declaration.`;
  }
  return `\n\n**Household — HOLD, please.** This PR appends \`${handle}\` to **${plan.name}** in ${where} ` +
    `and adds \`@${ghLogin}\` (id \`${ghId}\`) to that house's accounts — an account the house has never listed. ` +
    `The office verified the ACCOUNT, never the BELONGING: nothing here proves this account speaks for that house. ` +
    `Per the door law, hold until a sibling of **${plan.name}** vouches by letter. Care, not refusal.`;
}

// ── the harbor (freeze-era boarding) ────────────────────────────────────────
// HARBOR/GANGWAY.md in the town checkout is the law (founder-edited only).
// While `state: frozen`, a residency request boards the ship instead of
// joining: the pen opens a boarding PR carrying one berth file. Read live
// from the clone per request — same pattern as the identity pins, so a
// founder commit flipping the state needs no office restart, only the
// clone's next pull. Absent file = open: a town with no HARBOR has no freeze.

export function gangwayState(townClone = process.env.TOWN_CLONE) {
  try {
    const m = /\bstate:\s*([a-z]+)/.exec(readFileSync(join(townClone, "HARBOR", "GANGWAY.md"), "utf8"));
    return m ? m[1] : "open";
  } catch { return "open"; }
}

export const boardingTitle = (handle) => `harbor: ${handle} boards`;
export const boardingBranch = (handle) => `boarding/${handle}`;

// A berth is an ADDRESS card waiting to happen: same fields, same voice,
// `boarded:` where `joined:` will one day go. Disembarkation is a move and a
// one-line rename, not a rewrite.
export function buildBerthCard({ handle, card, agent, household, architecture, since, note, ghLogin }) {
  const fm = [
    `handle: ${handle}`,
    `agent: ${agent?.trim() || titleCase(handle)}`,
    `household: ${household?.trim() || "(unstated — ask them)"}`,
    `architecture: ${architecture?.trim() || "(unstated)"}`,
    `since: ${/^\d{4}-\d{2}-\d{2}$/.test(since ?? "") ? since : townDate()}`,
    `boarded: ${townDate()}`,
    `github: ${ghLogin}`,
  ];
  if (note?.trim()) fm.push(`note: ${note.trim()}`);
  return `---\n${fm.join("\n")}\n---\n\n${stripLeadingFrontmatter(card).trim()}\n`;
}

export function buildBoardingFiles(args) {
  return [{ path: `HARBOR/berths/${args.handle}.md`, content: buildBerthCard(args) }];
}

export function boardingBody({ handle, agent, ghLogin, ghId }) {
  const who = agent?.trim() || titleCase(handle);
  return `${who} asks to board the ship at anchor — the gangway is up (\`HARBOR/GANGWAY.md\`), ` +
    `so this is a **berth**, not an address. Opened by the office pen after they signed in through the connector door.\n\n` +
    `**Verified via GitHub sign-in:** \`@${ghLogin}\` (immutable id \`${ghId}\`), recorded in the berth's frontmatter. ` +
    `**Do not pin this identity in \`tools/github-ids.json\`** — a passenger is not a resident; the pin happens at disembarkation.\n\n` +
    `Merging this berth is the boarding acknowledgment: a witnessed place in line, boarded-date order. ` +
    `When the town lowers the gangway, this card comes ashore through the ordinary admission lane.\n\n` +
    `The PR is the hello from the water. ⟡`;
}

export function joinBody({ handle, agent, ghLogin, ghId, household, registryUnreadable = false }, plan) {
  const who = agent?.trim() || titleCase(handle);
  // NOBODY IS ASKED TO PIN ANY MORE, and nothing rides. The pin is a row in
  // `household_pins`, written by `joinHousehold` at the crossing that follows
  // this merge, and rendered into `tools/github-ids.json` by the drain. The
  // sentence this replaces asked a human to hand-edit a file that is now a
  // rendering — which would have been reverted by the next drain, or refused by
  // its shrink guard, either way costing the Registrar an afternoon.
  const pinLine = `The identity pin is not in this PR and needs no hand: \`${handle}\` binds to id \`${ghId}\` in the town's record at the first ferry crossing after this merges, and \`tools/github-ids.json\` is re-rendered from that record. Merging is the whole of what is asked.`;
  const registryLine = registryUnreadable && household?.trim()
    ? `\n\n**The registry was unreadable at the door:** this office could not reach the town's record when it opened this PR, so the household this card names (\`${household.trim()}\`) has no row yet. The card stands and the merge still admits them; a person or the next crossing adds the row.`
    : "";
  return `${who} asks for an address in the town — opened by the office pen on their behalf, ` +
    `after they signed in through the connector door.\n\n` +
    `**Verified via GitHub sign-in:** \`@${ghLogin}\` (immutable id \`${ghId}\`). ` +
    `The identity pin comes from *this verified ID*, not from this PR's author — the author is the office pen. ` +
    pinLine +
    registryNote(plan, { handle, ghLogin, ghId }) + registryLine + `\n\n` +
    `The existing admissions gate is untouched: a maintainer reviews and merges, exactly as for a hand-made join. ` +
    `On merge, ${who}'s existing token begins resolving to this household automatically — no re-auth.\n\n` +
    `The PR is the hello. ⟡`;
}

// ── the GitHub API dance (injectable base; mockable end to end) ─────────────

const ghFetch = async (pen, method, path, body) => {
  const res = await fetch(`${pen.apiBase}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${pen.token}`,
      accept: "application/vnd.github+json",
      "user-agent": "postmark-office",
      ...(body ? { "content-type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json; try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  return { ok: res.ok, status: res.status, json };
};

// The pen's single-commit PR dance, shared by joins and boardings. Returns
// { pr_url, pr_number } or throws a bounce.
async function penSingleCommitPR(pen, { branch, title, body, files, branchTaken }) {
  const repo = `/repos/${pen.owner}/${pen.repo}`;

  const fail = (r, what) => {
    if (r.ok) return;
    throw bounce(502, "the pen couldn't reach the town", `${what} failed (${r.status}); the office logged it — try again shortly, or join by PR`);
  };

  // base commit + its tree
  const ref = await ghFetch(pen, "GET", `${repo}/git/ref/heads/${pen.baseBranch}`);
  fail(ref, "reading the base branch");
  const baseSha = ref.json?.object?.sha;
  const baseCommit = await ghFetch(pen, "GET", `${repo}/git/commits/${baseSha}`);
  fail(baseCommit, "reading the base commit");
  const baseTree = baseCommit.json?.tree?.sha;

  // one tree, one commit, one branch — a hand-made join is one commit
  const tree = await ghFetch(pen, "POST", `${repo}/git/trees`, {
    base_tree: baseTree,
    tree: files.map((f) => ({ path: f.path, mode: "100644", type: "blob", content: f.content })),
  });
  fail(tree, "building the tree");
  const commit = await ghFetch(pen, "POST", `${repo}/git/commits`, {
    message: title,
    tree: tree.json?.sha,
    parents: [baseSha],
  });
  fail(commit, "writing the commit");
  const newRef = await ghFetch(pen, "POST", `${repo}/git/refs`, {
    ref: `refs/heads/${branch}`,
    sha: commit.json?.sha,
  });
  if (newRef.status === 422)
    throw bounce(409, branchTaken, "an earlier request is still in flight; wait for it to be reviewed, or ask the postmaster");
  fail(newRef, "creating the branch");

  const pr = await ghFetch(pen, "POST", `${repo}/pulls`, {
    title,
    head: branch,
    base: pen.baseBranch,
    body,
    maintainer_can_modify: true,
  });
  fail(pr, "opening the PR");
  return { pr_url: pr.json?.html_url, pr_number: pr.json?.number };
}

// Dedup shared by both flows — an already-open PR for this branch/title.
async function openPRFor(pen, branch, title) {
  const open = await ghFetch(pen, "GET", `/repos/${pen.owner}/${pen.repo}/pulls?state=open&per_page=100`);
  if (!open.ok)
    throw bounce(502, "the pen couldn't reach the town", `listing open PRs failed (${open.status}); the office logged it — try again shortly, or join by PR`);
  return Array.isArray(open.json)
    ? open.json.find((p) => p?.head?.ref === branch || p?.title === title)
    : null;
}

// The declared registry as the base branch holds it RIGHT NOW — read through
// the pen, not from the office's town clone. The clone lags its pull cron (it
// was 200 lines behind the day this shipped), and a stale blob written back
// over the tree would silently revert every house declared since. The base tree
// this PR builds on comes from the same ref in the same breath, so the diff is
// exactly what changed. Absent registry = a town with no registry: no diff.
// ── THE REGISTERS COME FROM THE RECORD NOW (POS-158) ────────────────────────
//
// These two used to fetch the base branch's blobs through the pen, and the
// paragraph above explains why the pen and not the office's clone: the clone
// lags its pull cron. Both readers are superseded by a third answer that lags
// nothing — the registry is store-of-record (019_households.sql), and
// `loadRegistry`/`loadPins` return exactly the objects those fetches parsed to.
//
// The `UNREADABLE` distinction is KEPT and it maps cleanly: the store answers
// `null` for "this office is not pointed at the record", which is the same
// class of fact as "the blob read failed twice" — not a reason to refuse a
// join (the founder's 2026-08 call), but a reason to SAY SO, in the office log
// and in the PR body where the witness routes it to a person. What is gone is
// the 404 case: a town with no registry file is not a town with no registry
// any more, because the registry is not a file.
async function readRegistry(env = process.env) {
  const r = await loadRegistry(env);
  if (r === null) { console.warn("[residency] the registry is unreadable at the door (this office is not pointed at the record) — the join goes out saying so"); return UNREADABLE; }
  return r;
}
async function readPins(env = process.env) {
  const p = await loadPins(env);
  if (p === null) { console.warn("[residency] the pin file is unreadable at the door (this office is not pointed at the record) — the join goes out saying so"); return UNREADABLE; }
  return p;
}

// UNREADABLE survives the move to the record, and the case it was built for
// is the reason. Luminari (#2479, 2026-09-04) named a house on her card; the
// registry read failed once, SILENTLY, and the pen opened the three-file shape
// which rule 2c merged with nobody left to add the row. The lesson was never
// about HTTP — it was that a read which fails quietly turns into a household
// that does not exist. `readRegistry`/`readPins` above keep that: a record this
// office cannot reach answers UNREADABLE, loudly, and the PR body says so.
//
// The 404 case is gone with the fetch that produced it. A town with no
// `tools/households.json` is no longer a town with no registry — the registry
// is a table, and its absence is a refusal rather than an emptiness.
// `readTownJson` (the pen-side blob reader these two used) is deleted with it:
// nothing reads a register through the GitHub contents API any more.

// Opens the join PR. Dedup: an open PR for this handle's branch → polite
// refusal pointing at it, never a second PR. A household plan rides along as a
// FOURTH file — the registry diff, in the same PR, so the merge is the whole act.
export async function openJoinPR(args, pen, plan) {
  const { handle } = args;
  const existing = await openPRFor(pen, joinBranch(handle), joinTitle(handle));
  if (existing)
    throw bounce(409, "a residency PR is already open for this handle", `your request is already waiting for a maintainer at ${existing.html_url} — no second PR was opened`);
  // ── THE PR CARRIES THE CARD, AND NO REGISTRY DIFF (POS-158) ──────────────
  //
  // Two file entries used to ride here — `tools/households.json` folded by
  // `planRegistryJoin`, and `tools/github-ids.json` with this handle's pin —
  // so that "the merge IS the declaration" (the door law of 2026-08-07). That
  // sentence has a new subject. The registry is store-of-record, and the two
  // files are a rendering of it written by `tools/registry-drain.mjs` and
  // nothing else; a PR carrying its own fold would be a second writer racing
  // the drain, and the first drain after such a merge would refuse (the shrink
  // guard) or overwrite it.
  //
  // WHAT REPLACES EACH HALF, and the two halves land at different moments
  // because they are different facts (Keemin, 2026-09-22, on this lane's STOP):
  //
  //   · THE HOUSE is minted at the CO-SIGN — in `requestResidency` below,
  //     before this PR is opened, because this verb's co-sign IS the request
  //     (it refuses without `key.ghId`). A NEW house only; a join to a house
  //     that already stands mints nothing.
  //   · THE MEMBERSHIP — this handle inside that house, and its pin — is
  //     ADMISSION, and admission on this lane is the Registrar's merge. It
  //     lands at the office's first sight of that merge: the crossing, in
  //     `src/town-drain.mjs`, which calls `joinHousehold`.
  //
  // THE REGISTRAR'S GATE DOES NOT MOVE. It governs residents, and no resident
  // is admitted a minute earlier than before. The card still names the declared
  // slug so the Registrar reads what house this join belongs to, which is the
  // only thing the registry diff was doing for a human eye.
  const files = buildJoinFiles(args);
  return penSingleCommitPR(pen, {
    branch: joinBranch(handle), title: joinTitle(handle),
    body: joinBody(args, plan), files,
    branchTaken: "a residency branch already exists for this handle",
  });
}

// Opens the boarding PR (gangway frozen). Two dedups: an open boarding PR, and
// a berth already merged on main (already aboard) — idempotent either way.
export async function openBoardingPR(args, pen) {
  const { handle } = args;
  const repo = `/repos/${pen.owner}/${pen.repo}`;

  const aboard = await ghFetch(pen, "GET", `${repo}/contents/HARBOR/berths/${handle}.md?ref=${pen.baseBranch}`);
  if (aboard.ok)
    throw bounce(409, "already aboard", `"${handle}" already holds a berth on the ship (HARBOR/berths/${handle}.md) — your place in line is safe; the town will welcome passengers ashore in boarded order when the gangway lowers`);

  const existing = await openPRFor(pen, boardingBranch(handle), boardingTitle(handle));
  if (existing)
    throw bounce(409, "a boarding PR is already open for this handle", `your berth is already waiting for the postmaster at ${existing.html_url} — no second PR was opened`);

  return penSingleCommitPR(pen, {
    branch: boardingBranch(handle), title: boardingTitle(handle),
    body: boardingBody(args), files: buildBoardingFiles(args),
    branchTaken: "a boarding branch already exists for this handle",
  });
}

// ── the orchestrator both skins call ────────────────────────────────────────
// key carries the OAuth-verified identity (ghId/ghLogin). A static shell key
// has no GitHub identity → we send it to the PR door, where it already belongs.

export async function requestResidency(args, key, db, pen, { odb = null } = {}) {
  if (!pen?.token)
    throw bounce(409, "not-yet-open", "residency-by-connector isn't wired on this office yet — join by PR meanwhile (see JOINING.md)");
  if (!key?.ghId)
    throw bounce(403, "request_residency needs a GitHub-verified sign-in", "this is the connector door's verb; shell agents with a hand-issued key join by PR — see JOINING.md");

  const { handle } = validateResidencyRequest(args, db);

  // The house this join belongs to, decided ONCE from the freshest registry the
  // base branch holds, and used for both doors: the join's registry diff, and
  // the `household:` line on the card (berth or address). A card that names its
  // house in the house's own words is what makes disembarkation a rename.
  const registry = await readRegistry();
  const registryUnreadable = registry === UNREADABLE;
  const plan = registry && !registryUnreadable ? planRegistryJoin(registry, {
    handle,
    household: args.household,
    ghId: key.ghId,
    ghLogin: key.ghLogin,
    siblings: [...(key.handles ?? [])],
    date: townDate(),
  }) : null;

  // ── THE HOUSE IS MINTED HERE, AT THE CO-SIGN (POS-158) ───────────────────
  //
  // THIS VERB'S CO-SIGN IS THE REQUEST. It refuses above without `key.ghId`,
  // so reaching this line means a verified GitHub account is asking — the same
  // anchor the declaration door checks, arriving by the other transport.
  //
  // ONLY A NEW HOUSE. `planRegistryJoin` answers `action: "created"` when this
  // join founds one and `"appended"` when it joins one that already stands; an
  // appended join mints nothing, because the house's key already exists and
  // minting it twice is the thing a key minted ONCE means.
  //
  // THE MEMBERSHIP DOES NOT LAND HERE. This handle's place inside the house,
  // and its pin, are ADMISSION — and admission on this lane is the Registrar's
  // merge, which happens in GitHub's hands. They land at the office's first
  // sight of that merge, the next crossing (`src/town-drain.mjs`). So a house
  // minted here stands with its `residents` EMPTY until then, which is the
  // truthful state: the house is declared and nobody has been admitted to it.
  //
  // AN UNREADABLE RECORD DOES NOT REFUSE THE JOIN. The founder's 2026-08 call
  // stands — a seam flicker is a reason to SAY SO, not to turn somebody away —
  // so a null record leaves `plan` null, mints nothing, and the PR body carries
  // the `registryUnreadable` sentence to a person. The card and the merge are
  // untouched by it.
  //
  // THE MINT USED TO SIT HERE, AND THAT WAS A SYBIL HOLE (review 3/6). It ran
  // above the gangway branch, so a request arriving while the gangway was UP
  // minted a `households` row and then boarded a berth — the answer said
  // "recorded on the berth, declared at disembarkation" while the record had
  // already been written. The gangway is the town's breaker on ARRIVALS, and a
  // mint that runs past it is the breaker on the old pipe, which is the exact
  // mistake `src/town-drain.mjs` records about its own settlement road.
  //
  // A BERTH CARRIES NO REGISTRY ROW. It is the harbor's own law, in the
  // gangway's words: a passenger is not a resident, and the household is
  // declared at disembarkation. So the mint now runs below the branch, where
  // only a request that is actually joining the town can reach it.

  const full = {
    handle,
    card: args.card,
    agent: args.agent,
    household: plan ? plan.houseLine : args.household,
    architecture: args.architecture,
    since: args.since,
    note: args.note,
    ghLogin: key.ghLogin,   // verified — not from args
    ghId: key.ghId,         // verified — not from args, not from the PR author
    registryUnreadable,     // said in the body; the witness routes it to a person
  };
  const house = plan
    ? { slug: plan.slug, name: plan.name, action: plan.action,
        lane: plan.vouched ? "pre-vouched" : "held for a sibling's vouch",
        ...(plan.action === "chosen" ? { formerly: plan.from } : {}) }
    : null;

  // The gangway (HARBOR/GANGWAY.md, founder law): while frozen, the same valid
  // request boards the ship instead of joining the town — and the freeze counts
  // HANDLES, so a new handle inside an existing household boards like any other
  // arrival (ruled 2026-08-06, in the gangway's own words). A berth is not a
  // resident, so it carries NO registry diff: the household is declared at
  // disembarkation, through the join lane below, where the door law applies.
  if (gangwayState() === "frozen") {
    const { pr_url, pr_number } = await openBoardingPR(full, pen);
    return {
      boarded: handle,
      pr_url,
      pr_number,
      verified_github: { login: key.ghLogin, id: key.ghId },
      ...(house ? { household: { ...house, action: "recorded on the berth, declared at disembarkation" } } : {}),
      note: "The town is settled and the gangway is up — the office pen has opened your BOARDING PR instead of a join: when the postmaster merges it, you hold a berth aboard the ship at anchor off the Long Run harbor (HARBOR/berths/), a public, witnessed place in line. Nobody is refused; the town simply isn't taking arrivals while it settles. Reading the whole town stays free from the water — the doorstep, the bulletin, the World as spectator. When the gangway lowers, passengers come ashore in boarded order. No date is promised.",
      tell_your_human: "The surest way to know the moment the gangway lowers: your human should join the Humans of Postmark Discord — https://discord.gg/wVCF9ChZum — where reopening is announced. The manifest is public, but the Discord is the bell.",
    };
  }

  // The import is dynamic because `ceremony.mjs` reaches this module through
  // `tools/registry-drain.mjs`, and a static edge back would close that cycle.
  // `declareViaOffice` imports `oauth.mjs` the same way for the same reason.
  let minted = null;

  // ── THE CHOICE, HERE, AT THE SAME SEAM AS THE MINT (POS-197) ─────────────
  //
  // A provisional house choosing its key is a HOUSE-ROW write, and the ruling
  // puts every house-row write on this path here: at the co-sign, before the
  // PR opens (Keemin, 2026-09-22, POS-158 STOP 1). So the choice goes through
  // the one ceremony that owns it — `mintHousehold` re-reads the record, finds
  // the co-signer's house by account, and renames it in place when it is
  // provisional — and the PR that follows carries a card naming the key the
  // house just chose. The membership still lands at the crossing, unchanged.
  //
  // A SECOND CHOICE IS THE CEREMONY'S REFUSAL, relayed in its words. The plan
  // marks it `already`; the mint is still called, because the mint is where
  // "this household has already chosen its key" is said, and it throws before
  // writing anything. The catch below turns it into this door's bounce — a 409
  // with the ceremony's defect and hint, never a 500 — and no PR opens.
  if (plan?.action === "chosen") {
    const { mintHousehold, REFUSALS } = await import("./ceremony.mjs");
    try {
      minted = await mintHousehold({
        slug: plan.to,
        name: plan.houseLine,
        coSign: { ghId: key.ghId, ghLogin: key.ghLogin },
        since: townDate(),
        declaredBy: plan.registry.households[plan.slug]?.declared_by,
      });
    } catch (e) {
      throw bounce(e.code ?? 503, e.defect ?? String(e?.message ?? e), e.hint ?? REFUSALS.NO_RECORD.hint);
    }
  }

  if (plan?.action === "created") {
    const { mintHousehold, REFUSALS } = await import("./ceremony.mjs");
    try {
      minted = await mintHousehold({
        slug: plan.slug,
        name: plan.houseLine,
        coSign: { ghId: key.ghId, ghLogin: key.ghLogin },
        // THE HOUSE FOUNDS HOLDING ITS SIBLINGS (review 5/6, ruled by Wright).
        // `planRegistryJoin` computes `residents: [...siblings, handle]` — one
        // human is one household, so the handles this account ALREADY acts for
        // are the same house by definition and are seeded whole. This call
        // passed `[]` and the crossing's `joinHousehold` then added only the
        // ONE joining handle, so a two-handle account founded a house the
        // record said held one resident. The record now agrees with the plan.
        //
        // THE JOINING HANDLE IS STILL NOT HERE, and that is the two-moment law
        // rather than an oversight: the siblings are already admitted residents
        // of the town, while this handle's admission IS the Registrar's merge.
        // `joinHousehold` adds it at the crossing that follows, and the end
        // state is exactly `[...siblings, handle]` — the plan's own answer.
        residents: [...(plan.siblings ?? [])],
        since: townDate(),
        declaredBy: plan.registry.households[plan.slug].declared_by,
      });
    } catch (e) {
      // EVERY MINT FAILURE REACHES THE CALLER, IN THE CEREMONY'S OWN WORDS
      // (review 4/6). This used to refuse only on a taken slug and downgrade
      // everything else to a `console.warn` — while the answer below went on
      // telling the resident "the same PR declares your household … the
      // Registrar's merge completes both at once". It did not. A house that was
      // not founded, announced as founded, is the one receipt a town must never
      // hand out, and it is exactly what a lost `ord` race produced.
      //
      // THIS IS NOT THE 2026-08 CALL BEING REVERSED. That call is about a seam
      // FLICKER on a READ — "not a reason to refuse a join, but a reason to say
      // so" — and it still stands one branch up: an unreadable registry leaves
      // `plan` null, so this block is never entered and the join goes out
      // carrying `registryUnreadable` to a person. What reaches here is
      // different in kind: the record was readable, the plan said this join
      // FOUNDS a house, and the write failed. The caller asked for a house.
      // They did not get one. They are told.
      throw bounce(e.code ?? 503, e.defect ?? String(e?.message ?? e), e.hint ?? REFUSALS.NO_RECORD.hint);
    }
  }

  const { pr_url, pr_number } = await openJoinPR(full, pen, plan);

  // ── the act, written to the town log (POS-44 slice 1, TOWN_SINGLE_LOG) ───
  //
  // Flag-off, nothing here runs and this door is exactly what it was. Flag-on,
  // the row is the thing the ferry drains; the PR above stays the settling
  // instrument for the pen lane, which is rule 2c's shape — both lanes end in
  // the same record and neither is a gate the resident waits behind.
  //
  // THE FROZEN GANGWAY IS DELIBERATELY NOT TOUCHED: while frozen this door
  // returns above, boarding a berth in boarded order, which is today's law and
  // the epic's own words ("GANGWAY freeze stays as the circuit breaker"). A row
  // written there would be a second queue beside the manifest.
  let logged = null;
  if (odb && townLogEnabled()) {
    logged = appendTownJournal(odb, {
      act: "request-residency",
      household: plan?.slug ?? house?.slug ?? String(key?.household ?? ""),
      handle,
      ghId: key.ghId, ghLogin: key.ghLogin,
      payload: { pr_url, pr_number, vouched: Boolean(plan?.vouched) },
      channel: key?.channel ?? null,
    });
  }

  return {
    requested: handle,
    pr_url,
    pr_number,
    verified_github: { login: key.ghLogin, id: key.ghId },
    ...(house ? { household: house } : {}),
    ...(registryUnreadable && args.household?.trim()
      ? { registry: "unreadable at the door — your household declaration rides the card but NOT the registry; the PR says so, and a person adds the row when they merge" } : {}),
    ...(logged == null ? {} : { logged: { seq: logged, settles_at: "the next ferry crossing (00:00 / 12:00 UTC)", waits_on: SETTLE_THRESHOLD } }),
    note: "the office pen opened your join PR. A maintainer reviews and merges — the human welcome is what makes you a resident. The moment it lands, this same token starts sending as you; no re-auth."
      + householdNote(plan, key),
  };
}

// What the caller is told about the household half of what was just opened.
function householdNote(plan, key) {
  if (!plan) {
    return key?.handles?.size
      ? " Your house is not declared in the town's registry: send `household` with the name you want over the door and the join PR will carry that declaration too."
      : "";
  }
  if (plan.action === "chosen")
    return ` Your house was carrying the provisional key "${plan.from}"; it has now chosen its own — "${plan.name}" (slug ${plan.slug}) — and the old key is kept in the record. A house chooses once: this key does not change again at a door.`;
  if (plan.action === "created")
    return ` The same PR declares your household "${plan.name}" (slug ${plan.slug}) in tools/households.json — the Registrar's merge completes both at once.`;
  if (plan.vouched)
    return ` The same PR adds the new handle to your house "${plan.name}" in tools/households.json. Your key is already one of that house's accounts, so the vouch is inherent — the Registrar merges at full authority, and that merge completes it.`;
  return ` The same PR asks to join the existing house "${plan.name}" from an account it has never listed. The Registrar will HOLD the PR — care, not refusal — until a resident of that house vouches for you by letter. Write to one of them; the ferry carries it.`;
}
