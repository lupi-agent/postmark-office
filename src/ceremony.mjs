// ceremony.mjs — THE JOIN CEREMONY: the key is minted at the human's co-sign.
//
// RULED (Keemin, 2026-09-22, POS-158): the household's key is the DECLARED
// SLUG, minted ONCE at the human's co-sign — the verified GitHub account — on
// every path into town. `name` is the free display field from then on and the
// slug is never derived from it again. A join that cannot name its house does
// not complete, and the refusal says why.
//
// AMENDED, same day, on this lane's STOP report: the house and the membership
// are TWO ROWS minted at TWO MOMENTS, and conflating them is what made the
// join-PR path look impossible.
//
//   · THE HOUSE (slug, name, the co-signing account -> `households`) is minted
//     at the CO-SIGN, at the door, on every path. `mintHousehold` below.
//   · THE MEMBERSHIP (a handle inside a house, and that handle's identity pin
//     -> `household_pins` + the house's `residents`) is ADMISSION, so it lands
//     at admission: at the same moment on the door paths, and at the office's
//     first observation of the Registrar's merge — the crossing — on the
//     join-PR path. `joinHousehold` below.
//
// That split is why the Registrar's gate does not move. The gate governs
// RESIDENTS, not houses: path (i) (`declare_household`) has founded houses at
// the door with nobody in the loop since 2026-08-14. Minting a house row when
// `request_residency` is called changes nothing about who gets admitted — it
// only stops the house's key from being invented twice, once at the ask and
// once at the merge.
//
// "BEFORE ANY API KEY" IS NOT LAW THIS WEEK. The brief carried a clause putting
// the mint before the key desk; measured, that path's key is issued at
// `src/server.mjs:1721` BEFORE the house is even named, and the ruling retired
// the clause rather than bending the desk. The key desk is untouched by this
// file.
//
// ── WHAT THIS FILE OWES ITS CALLERS ─────────────────────────────────────────
//
// ONE SENTENCE PER REFUSAL, EXPORTED. `REFUSALS` below is the whole vocabulary,
// and POS-188 (the move-in form) copies these strings VERBATIM rather than
// writing its own. A refusal a resident meets at two doors in two wordings is
// two laws wearing one name. The falsifiers assert the SAME STRING OBJECT
// reaches every path, not merely an equal one.
//
// NULL IS NOT EMPTY, and this file is where that rule stops being advice.
// `loadRegistry` answers `null` for "the office is not pointed at the record"
// (src/registry-store.mjs § NULL IS NOT EMPTY). A mint that read null as "no
// households exist" would find every slug free and mint duplicates over live
// rows. So every read below branches on null and REFUSES — `REFUSALS.NO_RECORD`
// — and refusing is not a degradation: a ceremony that cannot see the roll
// cannot tell whether it is founding a house or overwriting one.

import { loadRegistryRows, insertHousehold, upsertHousehold, upsertPin, renameHousehold } from "./registry-store.mjs";
import { registryFromRows, pinsFromRows } from "./registry-rows.mjs";
import { houseForAccount } from "./residency.mjs";
import { drainRegistry } from "../tools/registry-drain.mjs";
import { adoptAtCeremony } from "./solo-adoption.mjs";

// ── THE ALPHABET ────────────────────────────────────────────────────────────
//
// The handle's own, exactly: `src/residency.mjs § HANDLE_RE`, 2–40 characters.
// It is restated here rather than imported so this file reads as its own law,
// and asserted equal to the handle's in test so the two cannot drift.
//
// ENFORCED AT THE MINT, NOT IN THE SCHEMA. 019's header says why: three live
// slugs fail this check and a CHECK constraint would make the seed of today's
// own town refuse. Grandfathering is therefore BY CONSTRUCTION — this function
// runs only on a slug somebody is choosing NOW, and no standing row is ever
// re-validated. `victor-b.-rose-e.` is refused as a new slug and renders
// unchanged as an existing one, and both halves are falsified.
//
// THE COUNT IN THE RULING IS OFF BY ONE, and it is worth writing down rather
// than quietly fixing: the ruling grandfathers "the two path-hostile slugs".
// Measured over the 118 live rows, THREE fail `SLUG_RE` at 2–40 —
// `cadaeic.space` and `victor-b.-rose-e.` on the dot (path-hostile), and
// `the-ashcroft-orleans-household-elijah-and-mackenzie` at 51 characters, which
// is a LENGTH failure and not a path-hostile one. No allow-list is needed for
// any of the three, because none of them is ever re-validated.
export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const SLUG_MIN = 2;
export const SLUG_MAX = 40;

export function slugIsWellFormed(slug) {
  const s = String(slug ?? "");
  return SLUG_RE.test(s) && s.length >= SLUG_MIN && s.length <= SLUG_MAX;
}

// ── THE REFUSALS ────────────────────────────────────────────────────────────
//
// Frozen, and exported as objects rather than bare strings so a caller can pass
// the WHOLE refusal through to its own bounce shape without re-typing a word of
// it, and so a falsifier can assert identity (`===`) rather than equality.
export const REFUSALS = Object.freeze({
  NO_HOUSE: Object.freeze({
    code: 422,
    field: "household",
    defect: "a join names the house it is joining",
    hint: "name your household — your human's name, or the name your house goes by. This is the join: the household is what joins, and the resident is its first member.",
  }),
  BAD_SLUG: Object.freeze({
    code: 422,
    field: "household",
    defect: "a household's name must make a key of 2–40 characters: lowercase letters, digits and single hyphens",
    hint: "the key is made from the name you give: letters are lowercased, and spaces, dots and other punctuation become single hyphens. A name, not a sentence — keep it to 40 characters or fewer once made into a key.",
  }),
  TAKEN: Object.freeze({
    code: 409,
    field: "household",
    defect: "that household already stands in the town",
    hint: "a household key is minted once and never changes at a door. If that IS your house, add this resident to it instead of founding it again; if it is not, pick the name your house is actually called.",
  }),
  NO_RECORD: Object.freeze({
    code: 503,
    field: null,
    defect: "this office cannot read the town's roll, so it will not mint a household",
    hint: "the registry is store-of-record and this office is not pointed at it. Nothing was founded and nothing is lost — try again shortly. A mint that could not see the roll could not tell a new house from one that already stands.",
  }),
  NO_SUCH_HOUSE: Object.freeze({
    code: 404,
    field: "household",
    defect: "no such household stands in the town",
    hint: "a resident joins a house that already exists. Found the house first — that is the same ceremony, one step earlier.",
  }),
  // POS-159. The choose-once path lets a PROVISIONAL house state its key, and
  // "once" is the whole of the ruling: after the choice the key is immutable
  // like everyone else's. This is the sentence the second attempt meets.
  CHOSEN: Object.freeze({
    code: 409,
    field: "household",
    defect: "this household has already chosen its key",
    hint: "a house that was carrying a provisional key chooses its real one once, at its human's first co-sign, and the old key is kept in the record. It does not change again at a door — if the one on record is wrong, that is a person's correction and not a second declaration.",
  }),
});

/** Throw a refusal in the office's own `{ code, field, defect, hint }` bounce shape. */
export function refuse(refusal, detail = null) {
  const e = new Error(refusal.defect);
  return Object.assign(e, {
    code: refusal.code,
    field: refusal.field,
    defect: refusal.defect,
    hint: refusal.hint,
    refusal,                                    // the frozen object itself, for a caller that relays it
    ...(detail ? { detail } : {}),
  });
}

// ── THE DRAIN SEAM ──────────────────────────────────────────────────────────
//
// Both ceremonies end by draining, so the town's two files never lag the table
// by a crossing. `drain` is INJECTED for the same reason `declareHousehold`
// injects its `commit`: the decision — which rows moved, and did the files
// follow — is what a falsifier needs to see, and the real `drainRegistry`
// would want a clone, a pen and a remote to prove a branch that has nothing to
// do with any of them.
//
// ONE COMMIT, NOT TWO. `drainRegistry` takes its own injected `commit`, so a
// caller already inside a pen ceremony (declare-exec, holding the town flock
// and about to commit a berth and an address card) hands it a COLLECTOR that
// records the paths and returns null, then commits everything itself in one
// act. `src/write.mjs § penCommit` stages a list and makes a single commit, so
// that is free — see `collectingDrain` below, which is the shape every
// in-ceremony caller uses.
const defaultDrain = (opts) => drainRegistry(opts);

/**
 * A drain that does nothing, for the first half of a two-row ceremony.
 *
 * A declaration mints the HOUSE and then the MEMBERSHIP, in that order, in one
 * act. Between the two calls the record holds a house whose first resident has
 * no pin — a credential that resolves to nobody, which is the broken covenant
 * `src/declare-exec.mjs` names. Rendering that half-state into the town's files
 * would publish it. So the house's mint drains NOTHING and the membership's
 * drain, one line later, renders both rows at once.
 *
 * This is not an optimisation. The two-drain version would be idempotent and
 * still wrong: there would be a commit in the town's history showing a house
 * with an unpinned resident, and the town's own witness reads that history.
 */
export const NO_DRAIN = async () => ({ ran: false, skipped: "deferred to the next row of this same ceremony", commit: null, changed: [] });

/**
 * A drain that WRITES the files but commits nothing, handing back the paths.
 *
 * The caller is mid-ceremony and holds the pen: it will stage these paths
 * alongside its own and make one commit over all of them. `drainRegistry`
 * returns `commit: null` here, which is its ordinary "nothing to commit"
 * answer, so nothing downstream has to learn a new shape.
 */
export function collectingDrain({ clone, env } = {}) {
  const paths = [];
  const drain = (opts = {}) => drainRegistry({
    clone, env, ...opts,
    commit: (_clone, ps) => { paths.push(...ps); return null; },
  });
  return { drain, paths };
}

// ── A REFUSED DRAIN IS NEVER SILENT (POS-158, review 6/6) ─────────────
//
// `drainRegistry` answers `{ ran: false, refused }` rather than shrink the
// registry, and both ceremonies used to drop that answer on the floor. The row
// had landed in the record and the town's two files had NOT been re-rendered —
// a state only a person can clear (`registry-drain --ingest-missing`) — and
// nothing anywhere said so. The door answered as if everything had landed.
//
// So the outcome rides back to the caller and is logged once. It is not a
// refusal of the ceremony: the house IS founded, the record IS the record, and
// the files are a rendering that is one crossing behind. Telling a resident
// their house failed would be as untrue as saying nothing.
const drainOutcome = (drained) => (drained?.refused
  ? { rendered: false, refused: drained.refused }
  : { rendered: true });

const logRefusedDrain = (where, drained) => {
  if (!drained?.refused) return;
  console.error(`[ceremony] ${where}: the town's files were NOT re-rendered — ${drained.refused}`);
};

// ── THE ADOPTION (POS-212) ──────────────────────────────────────────────────
//
// RULED (Keemin, 2026-09-23): a resident who placed marks as `solo:<handle>`
// before their house had a key has those marks ADOPTED by the house when the
// key is minted — "solo: adoption at the ceremony". `src/solo-adoption.mjs`
// holds the plan and the one statement; this is where the ceremony calls it,
// after the registry holds the row, so the house's spelling set already names
// the resident whose `solo:` marks it adopts.
//
// EVERY PATH CALLS IT: the mint, the choose-once rename, and the membership.
// A declaration runs the mint and then the membership, so it asks twice; the
// second ask finds the first one's claims pending and files nothing (the plan's
// PENDING arm), which is the idempotence a crossing that re-sees a merged join
// PR already relies on.
//
// IT LANDS AT THE NEXT CROSSING, and the reason is the store's grants, not a
// choice: the ceremony's pen is `office_api`, which holds INSERT on `acts` and
// `claims` and nothing on `marks`. So the ceremony files the door's own amend —
// a pending claim superseding each mark, with the act that names the adoption —
// and the clearing's `materializeClaims` re-grains each row by its owner.
//
// A FAILED ADOPTION IS NEVER A FAILED CEREMONY, for the reason a refused drain
// is not (§ A REFUSED DRAIN IS NEVER SILENT): the house IS founded and the
// resident IS admitted. The outcome rides back, and a failure is logged once;
// the batch (`world2/tools/adopt-solo.mjs`) adopts anything a ceremony missed.
export const NO_ADOPT = async () => ({ filed: 0, skipped: "not asked" });

async function adoptionOutcome(where, adopt, args) {
  try {
    return await adopt(args);
  } catch (err) {
    const why = String(err?.message ?? err);
    console.error(`[ceremony] ${where}: the house's solo: marks were NOT adopted — ${why}`);
    return { filed: 0, failed: why };
  }
}

// ── THE HOUSE ───────────────────────────────────────────────────────────────

/**
 * Mint a household — the house row, at the co-sign, once.
 *
 * `slug`    the DECLARED key. Validated against the alphabet, refused if taken.
 *           Never derived from `name` here: the caller decides what the house
 *           is keyed by, and after this call nothing derives it again.
 * `name`    the free display field. May be absent — a house of one that has not
 *           said what it is called renders no `name` key at all, and the card
 *           reads "(unstated — ask them)".
 * `coSign`  `{ ghId, ghLogin }` — the VERIFIED GitHub account. Required: the
 *           household grain is the town's anti-sybil floor, and a house minted
 *           without one has no floor under it.
 * `residents` the handles this house is seeded with. A declaration seeds its
 *           first resident; a founder seeding an existing account's siblings
 *           passes them all.
 * `formerly` the alias list (migration 020). NO DOOR PASSES THIS — it defaults
 *           to `[]`, and a non-empty value only ever reaches here from a
 *           founder ceremony calling this function directly.
 *
 * Returns `{ slug, row, drained }`. Throws a `refuse(...)` bounce otherwise.
 */
export async function mintHousehold({
  slug,
  name = null,
  human = null,
  coSign,
  residents = [],
  since,
  memberOf = null,
  declaredBy,
  formerly = [],
  env = process.env,
  drain = defaultDrain,
  drainOptions = {},
  adopt = adoptAtCeremony,
} = {}) {
  if (!coSign?.ghId)
    throw refuse(REFUSALS.NO_HOUSE, "a house is minted against a verified GitHub account and this call carried none");

  const key = String(slug ?? "").trim().toLowerCase();
  if (!key) throw refuse(REFUSALS.NO_HOUSE);
  if (!slugIsWellFormed(key)) throw refuse(REFUSALS.BAD_SLUG, key);

  // THE ROLL, READ FROM THE RECORD. `null` is refused rather than defaulted —
  // see § NULL IS NOT EMPTY in the header. This is also the uniqueness check
  // and it is the one that decides: a caller's earlier look was courtesy.
  //
  // THE ROWS, NOT THE OBJECT. `loadRegistry` folds the rows into the file's
  // shape and drops `ord` on the way, and `ord` is exactly what a mint has to
  // choose. Reading the rows also costs one query fewer than reading the
  // registry and the pins separately, since both fold from the same read.
  const rows = await loadRegistryRows(env);
  if (rows === null) throw refuse(REFUSALS.NO_RECORD);
  const registry = registryFromRows(rows);

  // ── THE CHOOSE-ONCE PATH (POS-159) ────────────────────────────────────────
  //
  // RULED (Keemin, 2026-09-22): a house the backfill found in the roll and the
  // registry did not hold carries a PROVISIONAL key, taken from its first
  // resident's handle (`tools/registry-backfill.mjs`). At its human's FIRST
  // co-sign — a declaration through this ceremony naming a real slug — it
  // chooses its key ONCE. After that the key is immutable like everyone else's.
  //
  // SO THE SAME CALL MEANS TWO DIFFERENT THINGS depending on one column, and
  // this is where the fork lives. For an account with no house, or with a house
  // that chose its own key at a declaration, nothing below changes: a taken
  // slug is `TAKEN` and a free one is a new house. For an account whose house
  // is provisional, a free lawful slug RENAMES that house rather than founding
  // a second one — which is the whole point. Minting here would leave the
  // resident in two households, one of which nobody can find, and no pen in
  // this store holds DELETE to clean it up afterwards.
  //
  // THE ACCOUNT IS THE DECIDER, not the slug. `houseForAccount` matches on the
  // immutable GitHub id (login only where a row carries no id at all —
  // `src/residency.mjs § accountMatches`), so the house that renames is the
  // house this verified human already co-signs for, and no caller can rename
  // somebody else's by naming it. An account that stands in nobody's house
  // falls straight through to the ordinary mint.
  const standing = houseForAccount(registry, coSign.ghId, coSign.ghLogin);
  const standingRow = standing ? rows.households.find((r) => r.slug === standing) ?? null : null;

  if (standingRow?.provisional === true) {
    // THE SLUG MUST STILL BE FREE. A provisional house choosing a key somebody
    // else holds is the same collision as any other, and it gets the same
    // sentence — the ruling gives a house one choice, not a claim on the roll.
    // Choosing the key it ALREADY carries is not a collision: that is a house
    // saying "this borrowed name is the one, keep it", and the answer is to
    // stop calling it borrowed rather than to refuse.
    const confirmingItsOwn = key === standing;
    if (!confirmingItsOwn && registry.households?.[key]) throw refuse(REFUSALS.TAKEN, key);

    // THE OLD KEY IS KEPT, NOT DROPPED (migration 020's whole reason). Every
    // reference the town has made to this house so far used the provisional
    // key, and `formerly` is the one place an old key lives. A house
    // confirming its own key appends nothing: it never had a different one.
    const wasFormerly = standingRow.formerly ?? [];
    const renamed = await renameHousehold({
      from: standing,
      to: key,
      formerly: confirmingItsOwn ? [...wasFormerly] : [...wasFormerly, standing],
      provisional: false,
      // A declaration that states a name states it; one that does not leaves
      // the borrowed nameplate standing rather than clearing it.
      name: name?.trim() || standingRow.name || null,
    }, env);
    // `null` = the record went out of reach between the read and the write, or
    // the row moved under us. Neither is a thing to paper over: the house did
    // not choose, and the ceremony says so in its own words.
    if (renamed === null) throw refuse(REFUSALS.NO_RECORD);

    const row = {
      ...standingRow,
      slug: key,
      ord: renamed.ord,
      name: name?.trim() || standingRow.name || null,
      formerly: confirmingItsOwn ? [...wasFormerly] : [...wasFormerly, standing],
      provisional: false,
    };
    const drained = await drain({ env, ...drainOptions });
    logRefusedDrain(`mintHousehold(${standing} -> ${key})`, drained);
    const adopted = await adoptionOutcome(`mintHousehold(${standing} -> ${key})`, adopt, { slug: key, env });
    return { slug: key, row, chose: { from: standing, confirmed: confirmingItsOwn }, drained, registry: drainOutcome(drained), adopted };
  }

  // ONCE, AND THE MARKER IS THE RECORD'S OWN. A house that came through the
  // path above is no longer provisional and carries its provisional key in
  // `formerly`, so that pair IS "this house has chosen" — read off the row
  // rather than remembered in a second table.
  //
  // NAMED NARROWLY ON PURPOSE. The obvious wider rule — "an account already in
  // a house does not found another" — is NOT the rule here, and must not
  // become it by accident: a founder seeding an existing account's siblings
  // does exactly that, and `test/join-ceremony.test.mjs`'s gapped-ord falsifier
  // mints a second house for an account it has just joined to a first. This
  // clause fires only where a key was already chosen once.
  //
  // THE ONE OVERLAP, STATED RATHER THAN HIDDEN: a founder ceremony that wrote
  // `formerly` by hand (020's other named writer, a rename when one is ruled)
  // puts a house in the same shape, and its account would meet this refusal
  // too. 0/118 live rows carry `formerly` — measured twice, a day apart — so
  // nothing standing is affected, and the day a founder rename exists it wants
  // this conversation rather than this silence.
  if (standingRow && (standingRow.formerly ?? []).length)
    throw refuse(REFUSALS.CHOSEN, `${standing} already chose its key over \`${(standingRow.formerly ?? []).join("`, `")}\``);

  if (registry.households?.[key]) throw refuse(REFUSALS.TAKEN, key);

  // `ord` IS THE DATABASE'S TO ASSIGN, not this function's (review 4/6). It
  // used to be computed here — first from the row count, then from the highest
  // ord — and both versions held a number across a gap with no transaction in
  // it, so two mints landing together chose the same place and one lost the
  // unique index. `insertHousehold` computes it INSIDE the insert; see
  // `src/registry-store.mjs` § A NEW HOUSE TAKES ITS PLACE FROM THE DATABASE
  // for what that does and does not close.
  const row = {
    slug: key,
    name: name?.trim() || null,
    human: human?.trim() || null,
    accounts: [{ login: coSign.ghLogin, id: coSign.ghId }],
    residents: [...new Set(residents.filter(Boolean))],
    since,
    member_of: memberOf,
    declared_by: declaredBy,
    formerly: [...formerly],
    // A house minted HERE is a house somebody just named, so its key is chosen
    // by construction. `provisional` is written true in exactly one place and
    // this is not it (`tools/registry-backfill.mjs`, migration 021's header).
    provisional: false,
  };

  // THE INSERT ANSWERS WITH THE PLACE IT CHOSE, so a caller can say where the
  // house landed rather than guess. `null` means the record went out of reach
  // between the read above and this write, which is not a thing to paper over:
  // the house was not founded, and the ceremony says so in its own words.
  const written = await insertHousehold(row, env);
  if (written === null) throw refuse(REFUSALS.NO_RECORD);
  const drained = await drain({ env, ...drainOptions });
  logRefusedDrain(`mintHousehold(${key})`, drained);
  const adopted = await adoptionOutcome(`mintHousehold(${key})`, adopt, { slug: key, env });
  return { slug: key, row: written, drained, registry: drainOutcome(drained), adopted };
}

// ── THE MEMBERSHIP ──────────────────────────────────────────────────────────

/**
 * Add a handle to a house that already stands — the pin, and the residency.
 *
 * This is ADMISSION, and it lands where each path admits: at the door on the
 * door paths, and at the crossing (the office's first sight of the Registrar's
 * merge) on the join-PR path.
 *
 * TWO ROWS, ONE ACT. The pin (`household_pins`) is the identity; the house's
 * `residents` array is the belonging. Writing one without the other is the
 * broken covenant `src/declare-exec.mjs` names — a credential that resolves to
 * nobody, or a resident the record cannot account for — so both upserts happen
 * here or the call throws before either.
 *
 * IDEMPOTENT BY CONSTRUCTION. A crossing may see a row whose PR already merged
 * and whose handle the house already lists; re-adding a handle to a `Set` and
 * re-upserting an identical pin both change nothing, and the drain then commits
 * nothing because the rendered bytes are unchanged. That is the same
 * idempotence `planTownDrain` already relies on between the door and the drain.
 */
export async function joinHousehold({
  slug,
  handle,
  coSign,
  pinnedOn = null,
  env = process.env,
  drain = defaultDrain,
  drainOptions = {},
  adopt = adoptAtCeremony,
} = {}) {
  const key = String(slug ?? "").trim().toLowerCase();
  if (!key) throw refuse(REFUSALS.NO_HOUSE);

  const h = String(handle ?? "").trim().toLowerCase();
  if (!h) throw refuse(REFUSALS.NO_HOUSE, "a membership names the resident joining");

  // ONE READ, AND IT IS THE ROWS. Both objects below fold from the same read,
  // so asking for the registry and the pins separately would query the store
  // twice for one answer — and, worse, would hand back a registry with no
  // `ord` on it, which is the one column this function must not guess.
  const rows = await loadRegistryRows(env);
  if (rows === null) throw refuse(REFUSALS.NO_RECORD);
  const registry = registryFromRows(rows);
  const pins = pinsFromRows(rows);

  const rec = registry.households?.[key];
  if (!rec) throw refuse(REFUSALS.NO_SUCH_HOUSE, key);

  // `ord` IS READ OFF THE ROW, never recomputed. It is the file's standing
  // declaration order and this house already holds its place; deriving a fresh
  // one would move the house and rewrite every row after it — 118 lines of diff
  // for one resident joining.
  //
  // THE FIRST DRAFT TOOK `Object.keys(...).indexOf(key)`, which is the house's
  // POSITION in the folded object and equals its `ord` only while the sequence
  // is contiguous from zero. `--ingest-missing` can adopt a row at a position
  // that leaves a gap, and from that moment the two numbers part company — and
  // the wrong one would silently move somebody's house. The row carries the
  // answer; nothing else needs to.
  const standingRow = rows.households.find((r) => r.slug === key);
  const ord = Number(standingRow.ord);

  const residents = [...new Set([...(rec.residents ?? []), h])];

  // THE ACCOUNT IS APPENDED ONLY WHEN THE HOUSE HAS NEVER LISTED IT, and the
  // rule is `src/residency.mjs § accountMatches`'s: id first, and a login
  // matches only where no id is on record. Getting this wrong authorises
  // nothing, but appending a stranger's account to a pinned household is how a
  // recycled GitHub login would have become permanent.
  const accounts = [...(rec.accounts ?? [])];
  if (coSign?.ghId != null && !accounts.some((a) => accountIs(a, coSign.ghId, coSign.ghLogin)))
    accounts.push({ login: coSign.ghLogin, id: coSign.ghId });

  await upsertHousehold({
    slug: key,
    ord,
    name: rec.name ?? null,
    human: rec.human ?? null,
    accounts,
    residents,
    since: rec.since,
    member_of: rec.member_of ?? null,
    declared_by: rec.declared_by,
    formerly: rec.formerly ?? [],
    // READ OFF THE ROW, NOT OFF THE FOLDED REGISTRY. `registryFromRows` renders
    // `provisional: false` as NO KEY AT ALL (021, the same rule `formerly` and
    // a NULL `name` already take), so `rec.provisional` is `undefined` for
    // every house that ever declared — and `undefined` reaching a
    // `boolean NOT NULL` column is a failed write inside a ceremony that has
    // already told a resident they were admitted. The row carries the answer;
    // the rendering deliberately does not.
    //
    // AND A RESIDENT JOINING DOES NOT CHOOSE A KEY. A provisional house gaining
    // a member stays provisional: the choice is the HUMAN's co-sign at the
    // mint, not an admission.
    provisional: standingRow.provisional === true,
  }, env);

  // THE PIN IS NEVER RE-BOUND HERE. A handle the pin file already names has an
  // identity on record, and re-binding one is a human ceremony (the join PR
  // body has always asked a person in that case, and the town's witness routes
  // it to one). So an existing pin is left exactly as it stands.
  let pinned = false;
  if (coSign?.ghId != null && !pins[h]) {
    await upsertPin({
      handle: h,
      login: coSign.ghLogin,
      gh_id: coSign.ghId,
      pinned: pinnedOn,
      renamed: null, note: null, retired: null, renamed_to: null,
    }, env);
    pinned = true;
  }

  const drained = await drain({ env, ...drainOptions });
  logRefusedDrain(`joinHousehold(${key}/${h})`, drained);
  const adopted = await adoptionOutcome(`joinHousehold(${key}/${h})`, adopt, { slug: key, actor: h, env });
  return { slug: key, handle: h, residents, pinned, drained, registry: drainOutcome(drained), adopted };
}

// The account matcher, in this file's own words for the same reason the
// alphabet is: id first, login only where no id is on record. Asserted equal to
// `residency.mjs § accountMatches`'s behaviour in test.
function accountIs(account, ghId, ghLogin) {
  if (account?.id != null || ghId != null) {
    if (account?.id == null || ghId == null) return false;
    return String(account.id) === String(ghId);
  }
  const want = ghLogin ? String(ghLogin).toLowerCase() : null;
  return Boolean(want && account?.login && String(account.login).toLowerCase() === want);
}
