// human-actor.mjs — the human actor kind, resolved.
//
// IMPLEMENTATION OF STANDING LAW, not new design. The human class was ruled at
// the act-as-human sitting (2026-08-17) and has stood in the record ever since
// with one grant and no room behind it — the lint board's red, which "under the
// TDD-board method is not a defect but the town asking." This is the answer.
//
// THE CLASS MARK, verbatim (world main, WORLD/marks/…/postmark-node/entity/human):
//
//   The household's human, standing beside their resident. One action for now —
//   a voice: to speak here is to speak with them.
//
//   actions: [{"action": "say", "for": "human", "residue": "the-town/say"}]
//   implements: ["the-town/the-own-hand"]
//
// THREE THINGS THE LAW FIXES, and this file may not loosen any of them:
//
//   1. ONE GRANT. `say`, and nothing else. classes.md § The human class: "The
//      one-grant fence IS the scope fence: everything further waits for the
//      humans-as-residents design, and arrives — if it arrives — as law here
//      first." So the bounce is not a limitation of this implementation; the
//      bounce IS the fence, and it quotes the sentence that draws it.
//   2. COMPANIONED STANDING. "the human's standing is companioned: the human
//      speaks beside one of their household's residents, from that resident's
//      standing (the party-night earshot rule made law)." A human has no
//      position of their own — they are heard where their companion stands.
//      So when `beside:` names one it must be a resident of the SAME household
//      (standing borrowed from a stranger is not companioned standing, it is
//      impersonation); omitted, the handler picks the housemate the house is
//      awake at, which is the same law choosing rather than the caller.
//   3. THE OWN HAND. The class implements `the-town/the-own-hand`, so the act
//      lands under the HUMAN's own id — never the companion's. The companion
//      lends standing, not authorship. A record that wrote the resident's name
//      on a human's words would be the one thing this class exists to prevent.
//
// WHAT THIS FILE DOES NOT DO, and it is most of the work: it does not derive
// the human's speaker label, choose their companion, or write the record.
// world.mjs's worldSayHuman has done all three since 2026-08-08 — the speaker
// is `human-of-<household slug>`, "NEVER the GitHub login (the office does not
// name people)", and the companion defaults through aboard-then-present-then-
// placed because "a house's human belongs where the house is awake". That IS
// the companioned standing law, already implemented and already live on the
// flat door. Forking any of it here would be a second answer to a settled
// question.
//
// So this seam is exactly two things the flat door cannot do for itself: the
// ONE-GRANT FENCE, and the routing decision that sends `as: "human"` to the
// human's own handler instead of the resident's.

const bounce = (code, defect, hint, extra = {}) => ({ error: "bounce", code, defect, hint, ...extra });

// ── AMENDED 2026-08-26 · THE FENCE STOPPED BEING A LIST ─────────────────────
//
// Everything above is still true and none of it loosens. What changed is WHERE
// the fence is read from.
//
// This file held `["say"]` as a literal, and that was correct for exactly as
// long as the human class was the only class that granted a human anything.
// LOGOS/classes.md § The three channels ended that: the PARCEL class now grants
// `walk` and `say` to the human of the household whose ground it is. So "what
// may a human do" is no longer a property of the human — it is a property of
// the human AND WHERE THEY ARE STANDING, and a hardcoded list cannot express
// that. Keeping it would have made this file the second copy of a law the
// record already carries, which is the drift `world-classes.mjs` exists to end:
//
//   "A door implementation is correct precisely insofar as it READS the class
//    tree, and wrong wherever it hardcodes." (§ The apex is the class tree's
//    shadow)
//
// So the fence moved to the permission calculus, which reads the record. What
// stays here is what the calculus cannot do: the ROUTING (a human's say goes to
// the human's own handler) and the COMPANIONED STANDING check, both of which
// are about WHO is acting rather than about what is granted.
//
// The list below survives under a truer name. It is the AMBIENT set — what a
// human may do anywhere, standing on nobody's ground in particular — and it is
// still exactly one, because the ambient half of the fence did not move.
export const HUMAN_AMBIENT_GRANTS = Object.freeze(["say"]);
/** @deprecated the ambient half only — a human's full set depends on standpoint. */
export const HUMAN_GRANTS = HUMAN_AMBIENT_GRANTS;
export const HUMAN_RESIDUE = "the-town/say";
// classes.md § The human class, verbatim — the sentence the fence is drawn with.
export const ONE_GRANT_FENCE =
  "everything further waits for the humans-as-residents design, and arrives — if it arrives — as law here first";
export const COMPANIONED =
  "the human speaks beside one of their household's residents, from that resident's standing";

/**
 * Resolve the actor for a call, or bounce.
 *
 * Returns null when nothing changes — `as:` absent is the default that was
 * always the intent ("Absent means resident"), and this seam must be invisible
 * to every call that does not ask for it.
 */
export function resolveHumanActor({ action, as: kind, beside, key, fence = "ambient", channel = null }) {
  const asked = String(kind ?? "").trim();
  if (!asked) return null;                       // the default: resident
  if (asked === "resident") return null;         // named explicitly, same thing

  if (asked !== "human") {
    return bounce(422, `"${asked}" is not an actor kind this door resolves`,
      "the kinds it resolves: resident (the default), berth, human — an action the law mints for a kind the door cannot resolve is law with no room behind it");
  }

  // ── the fence, and WHO IS HOLDING IT ──────────────────────────────────────
  //
  // `fence: "ambient"` is the flat-door caller: no standpoint was gathered, so
  // the only grants that can be checked are the ambient ones, and that is said
  // plainly rather than presented as the whole law.
  //
  // `fence: "calculus"` is the apex: it has already resolved the three channels
  // at this standpoint and refused anything the record does not grant, so a
  // second list here would be a second answer — and the one that is wrong more
  // often, because it cannot see where the caller is standing.
  if (fence === "ambient" && !HUMAN_AMBIENT_GRANTS.includes(action)) {
    return bounce(403, `a human may not "${action}" from here — the human class carries one ambient grant, and it is say`,
      `The human class grants say and nothing else world-wide, deliberately: ${ONE_GRANT_FENCE}. A GROUND may grant a human more than that where it reaches them (LOGOS/classes.md § The three channels), but this door gathered no standpoint, so it can only answer for what a human carries everywhere. Ask through the apex, which reads the ground you are standing on.`,
      { ambient_grants: HUMAN_AMBIENT_GRANTS, law: "LOGOS/classes.md § The human class · § The three channels" });
  }

  // ── companioned standing ──────────────────────────────────────────────────
  // `beside:` is the apex's word for the flat door's `with:`, and it is
  // OPTIONAL for the same reason it is optional there: when it is omitted the
  // handler chooses the housemate the house is actually awake at. Named, it
  // must be one of this key's own residents — standing borrowed from someone
  // else's resident is not companioned standing, it is impersonation, and the
  // handler's own check would say so in a less useful place.
  const companion = beside == null ? null : String(beside).trim();
  if (companion && !key?.handles?.has(companion)) {
    return bounce(403, `"${companion}" is not a resident of your household`,
      `${COMPANIONED} — standing borrowed from someone else's resident is not companioned standing. This key acts for: ${[...(key?.handles ?? [])].join(", ") || "nobody"}.`,
      { law: "LOGOS/classes.md § The human class" });
  }

  // ── EMBODIED OR COMPANIONED, and the difference is the whole feature ──────
  //
  // A companioned act is heard from a RESIDENT's standing — the human speaks
  // beside one of their household's, and `worldSayHuman` has owned that since
  // 2026-08-08. An EMBODIED act is taken from the human's own feet on their own
  // household's ground, and it has no companion at all: there is nobody to
  // borrow standing from, because the ground granted it directly.
  //
  // Which one an act is, is decided by WHICH CHANNEL GRANTED IT, not by the
  // verb — the same `say` is companioned when the human class grants it
  // ambiently and embodied when the parcel grants it at your own gate. That is
  // why `channel` is a parameter and not something inferred from the action
  // name: inferring it would make the two acts one act again.
  const embodied = String(channel ?? "") === "ground";
  if (embodied) {
    return {
      kind: "human",
      standing: "embodied",
      route: null,                     // the act's own handler, with the human as actor
      residue: null,
      says: "The household's human, on their own household's ground, at a resident's pace.",
      note: "This act is taken from the human's OWN feet, not beside a resident: the ground granted it to the household's human directly, so there is no companion to borrow standing from. It stops at the fence — LOGOS/classes.md § The three channels, 'Embodiment stands on the ground that grants it.'",
    };
  }

  return {
    kind: "human",
    standing: "companioned",
    // The handler owns the hand and the standpoint; this names neither.
    route: "worldSayHuman",
    ...(companion ? { with: companion } : {}),
    residue: HUMAN_RESIDUE,
    // ⚠ A HARDCODED COPY OF A MARK BODY, and it drifted the day the mark was
    // amended — caught by this file's own verbatim test running against a
    // world checkout that had not moved yet. The body below is the human
    // class mark's, current as of world `proto/birthday`. It is a copy, and a
    // copy is a paraphrase waiting to drift: LOGOS/classes.md § Class-nodes,
    // "the door QUOTES it rather than keeping a copy that drifts."
    // The apex already does the right thing for blurbs (`entriesFrom` reads the
    // residue class's own body out of the store). This constant should follow
    // it; that is a small lane of its own and is named here rather than
    // silently left, because a stale copy that reads as law is worse than an
    // honest note beside it.
    // DRIFTED, AND RE-QUOTED 2026-09-05. The copy below said "on their OWN
    // household's ground … at A RESIDENT'S pace" and the record says neither.
    // World `43d083ed` — "the walk pace stops being written three times: the
    // two dead copies become pointers at the one live declaration" — moved the
    // pace to the dial it names, and this copy did not follow. That is the drift
    // the note above predicted, arriving; it is re-quoted verbatim from the class
    // mark rather than re-worded, and test/human-actor.test.mjs asserts the
    // record CONTAINS this string, so the next divergence reds instead of
    // shipping. The lane that makes the door read the store rather than hold a
    // copy is still the right answer and is still not this change.
    says: "The household's human: a voice anywhere, beside their resident — and on their household's ground, feet of their own, at the-town/resident's pace.",
    note: `${COMPANIONED}. The words land under the human's own hand; the resident lends the standing they are heard from.`,
  };
}

// ── the ACT-AS roster (2026-08-27) ──────────────────────────────────────────
//
// THE FOUNDER'S RULING: "abilities live at the CLASS level ('Act As' a class),
// and 'Human' is one of the Act-As options — this is the bridge for
// parcel-embodied humans."
//
// The roster is what a caller may act AS from where they are standing. It is a
// DERIVED, not a table: the residents come from the key, and the human entry's
// standing comes from the same channel test `resolveHumanActor` uses, so the
// roster and the door can never disagree about whether the human has feet here.
//
// ⚑ WHY THE HUMAN ENTRY IS ALWAYS PRESENT AND SOMETIMES UNAVAILABLE, rather
// than being absent when it cannot act. An absent option teaches nothing: a
// player who never sees "Human" does not learn that embodiment exists, let
// alone that it is fenced to their own parcel. A greyed one with a reason on it
// is the door explaining itself, which is the same courtesy the out-of-turn
// refusal pays.

/** Where an embodied human's token image is looked for. A DIRECTORY, so the
 *  operator configures a place and never a per-person path — one setting for a
 *  household of any size. */
export const HUMAN_TOKEN_DIR = () => process.env.POSTMARK_HUMAN_TOKENS ?? "/atelier/postmark/birthday";

/**
 * A human's SHOWN name. The credential is not the name — the MCP door has said
 * so in prose since it opened ("the founder goes by DARKO in town; the
 * keeminlee GitHub account is his credential, not his name"), and this makes
 * that sentence real where labels are composed. POSTMARK_HUMAN_NAMES holds
 * comma-separated login=Name pairs; a login with no pair shows as itself.
 * DISPLAY ONLY: the record's hand (`human-of-<household>`) and every id keyed
 * on the login are untouched — renaming a record orphans its readers.
 */
export const humanDisplayName = (login) => {
  if (!login) return login;
  for (const pair of String(process.env.POSTMARK_HUMAN_NAMES ?? "").split(",")) {
    const i = pair.indexOf("=");
    if (i > 0 && pair.slice(0, i).trim() === login) return pair.slice(i + 1).trim() || login;
  }
  return login;
};

/**
 * The token image for an embodied human, as a URL the site can draw.
 *
 * A SLOT, deliberately left empty of any particular person's picture. The
 * founder's own token is staged locally and is not this office's to hold; what
 * the office owes is a place for one and a rule for finding it. `token` on the
 * human's own record wins outright (an explicit path is never second-guessed);
 * otherwise it is `<dir>/<handle>-token.png` by convention.
 *
 * Returns null when there is no handle to name a file after — never a guessed
 * default, because a token that silently resolves to somebody else's face is
 * worse than no token at all.
 */
export function humanTokenUrl(handle, { token = null, dir = null } = {}) {
  const explicit = token == null ? null : String(token).trim();
  if (explicit) return explicit;
  const who = String(handle ?? "").trim();
  if (!who) return null;
  const base = String(dir ?? HUMAN_TOKEN_DIR()).replace(/\/+$/, "");
  return `${base}/${who}-token.png`;
}

/**
 * WHY A LIT FACE IS LIT, in the door's own words — the contract's `because`.
 *
 * The site declared it as "Why it is allowed, in the words of the law that
 * allowed it — so a face that lights up says which ruling lit it rather than
 * merely being bright." That is a sentence only the door can write, because only
 * the door knows WHICH GROUND answered: the site's own bridge could name a
 * portal or a parcel and nothing else, and said so.
 *
 * Null when nothing seats the human, and that is the contract's shape rather
 * than an omission: `because` explains an allowance, `reason` explains a
 * refusal, and a row carrying both would be answering a question nobody asked.
 * Null too when the seats are unreadable — an unnamed ground is not a reason,
 * and inventing prose for one would be the door doing what it asks the site not
 * to.
 */
const seatedBecause = (seats = [], grants = []) => {
  const rows = seats.map((s) => (typeof s === "string" ? { ground: s } : s)).filter((s) => s?.ground);
  if (!rows.length) return null;
  const where = [...new Map(rows.map((s) => [s.ground, s])).values()]
    .map((s) => (s.from ? `${s.ground} (${s.from})` : s.ground));
  return `${where.join(" and ")} seats your household's human — that ground's class grants them ${grants.join(", ") || "nothing"} where you stand, and nowhere else`;
};

/**
 * The ACT-AS roster at this standpoint.
 *
 * `residents` — the handles this key acts for.
 * `humanGrants` — the actions the calculus admitted for `for: human` HERE. Its
 *   emptiness is the whole difference between "your human can play in this
 *   room" and "your human is a voice through your resident": the record decides
 *   it, and this function only reports what the record decided.
 * `humanHandle` / `humanToken` — the household's human, if the office knows one.
 */
// ⚠ THE FIELD NAMES ARE THE SITE'S, NOT MINE — `kind`/`allowed`, not
// `as`/`available`. The site declared this roster's shape on 2026-08-26 ("when
// `actors` is present this function returns it untouched and the site stops
// deriving"), so the door adopting those names is what makes the bar stop
// guessing. My first version invented its own two spellings, which would have
// been returned untouched and rendered as a row of faces with no labels and no
// permission — silently, because `actorsFor` does not validate what it passes
// through.
//
// ⚠ WHERE THAT CONSUMER ACTUALLY LIVES, corrected 2026-08-27. This comment said
// the site "built its ACT-AS bar to it", in the past tense, which reads as an
// integration already standing. IT IS NOT MERGED: the consumer is
// `src/lib/world-cockpit.mjs` on the SITE'S `bday-pin` BRANCH — absent from the
// site's `main` and from `origin/main`, verified rather than assumed — and the
// integration lands the night of 2026-08-27.
//
// The correction is worth its lines because the false half is the load-bearing
// half. A contract on an unmerged branch and a contract in production fail
// differently and are debugged differently: this door can be perfectly right
// about the shape and still show a reader nothing, because the page that reads
// it has not shipped. A comment that hides which of those two worlds you are in
// sends the next reader looking for a rendering bug in a page that does not
// exist yet.
export function actorRoster({ residents = [], humanGrants = [], humanHandle = null, humanToken = null, tokenDir = null, acting = null, seats = [] } = {}) {
  const roster = [...residents].filter(Boolean).map((h) => ({
    kind: "resident",
    handle: h,
    label: h,
    allowed: true,
    reason: null,
    selected: acting != null && h === acting,
    says: "your resident, acting from their own standing",
  }));
  const embodied = humanGrants.length > 0;
  roster.push({
    kind: "human",
    id: humanHandle ?? null,
    handle: humanHandle ?? null,
    label: humanHandle ? humanDisplayName(humanHandle) : "Human",
    // ALWAYS PRESENT, SOMETIMES NOT ALLOWED. An absent option teaches nothing:
    // a player who never sees "Human" cannot learn that embodiment exists, let
    // alone that it is fenced to ground that grants it.
    allowed: embodied,
    reason: embodied ? null
      : `A human is embodied only where a ground's class grants it, and this ground does not. ${ONE_GRANT_FENCE}.`,
    // ── `because` — THE CONTRACT'S FIELD, TRUED 2026-08-27 ──────────────────
    //
    // The site declared `because` on 2026-08-26 and this roster shipped without
    // it on 08-27, which drifted at the worst possible moment: the day the door
    // began answering `actors` was the day the site's own bridge stopped being
    // walked, so `because` stopped existing and the human's face fell through to
    // the stand-in "where ground allows". The one row whose words were most
    // worth reading went quiet BY SUCCEEDING (site world-cockpit.mjs
    // § humanWords, bday-pin).
    //
    // `says` is kept beside it and is not the same field. `says` is what this
    // face IS, in every case; `because` is why THIS ground lit it, and only when
    // it did. The site reads `because` first and falls back to `says`, so the
    // two together mean the sentence shows whichever half of the contract a
    // given reader was built against.
    because: embodied ? seatedBecause(seats, humanGrants) : null,
    // The site's own word for the embodied case, so the bar can style the two
    // apart without re-deriving the rule.
    stance: embodied ? "embodied-human" : "companioned-human",
    token_url: humanTokenUrl(humanHandle, { token: humanToken, dir: tokenDir }),
    grants: embodied ? [...humanGrants] : [...HUMAN_AMBIENT_GRANTS],
    says: embodied
      ? "your household's human, on ground that grants them feet — they act here, and only here"
      : "your household's human, speaking beside one of your residents",
  });
  return roster;
}
