// human-actor.test.mjs — the human actor kind's falsifiers.
//
// THIS FLIPS A DELIBERATE RED. The human class was ruled 2026-08-17 with one
// grant and no door behind it, and world-apex.mjs's own comment named the exact
// growth point: "kinds grow HERE, nowhere else." Lint L6's actor-kind red was
// the town asking. These assert the answer.

import test from "node:test";
import { worldClone } from "./fixture-paths.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { resolveHumanActor, HUMAN_AMBIENT_GRANTS, HUMAN_RESIDUE, ONE_GRANT_FENCE, COMPANIONED } from "../src/human-actor.mjs";
import { RESOLVED_ACTOR_KINDS, APEX_TOOL } from "../src/world-apex.mjs";
import { validateArgs } from "../src/mcp.mjs";
import { humanHandFor } from "../src/households.mjs";
import { walkViaOffice } from "../src/world.mjs";

const key = (...handles) => ({ handles: new Set(handles) });

test("the door now resolves the kind the law minted", () => {
  // world-apex.mjs's own comment: "An action the law mints `for:` a kind not
  // named here is law with no room behind it: L6's actor-kind red. 'human'
  // joins when the actor seam lands; kinds grow HERE, nowhere else."
  assert.ok(RESOLVED_ACTOR_KINDS.includes("human"), "human is resolvable");
  assert.ok(RESOLVED_ACTOR_KINDS.includes("resident"), "and the default is untouched");
  assert.ok(RESOLVED_ACTOR_KINDS.includes("berth"));
});

test("absent as: changes nothing, anywhere", () => {
  // The flag-off falsifier. "Absent means resident: the default that was always
  // the intent." A seam that altered the ordinary call would be a migration
  // nobody asked for.
  assert.equal(resolveHumanActor({ action: "say", key: key("wright") }), null);
  assert.equal(resolveHumanActor({ action: "walk", key: key("wright") }), null);
  assert.equal(resolveHumanActor({ action: "say", as: "", key: key("wright") }), null);
  assert.equal(resolveHumanActor({ action: "say", as: "resident", key: key("wright") }), null,
    "naming the default explicitly is still the default");
});

test("a human's say resolves to the human's own handler, with the companion named", () => {
  // THE CLASS MARK, verbatim (WORLD/marks/…/entity/human):
  //   "The household's human, standing beside their resident. One action for
  //    now — a voice: to speak here is to speak with them."
  const a = resolveHumanActor({ action: "say", as: "human", beside: "wright", key: key("wright", "rei") });
  assert.equal(a.error, undefined, "it resolves");
  assert.equal(a.kind, "human");
  assert.equal(a.route, "worldSayHuman", "routed to the handler that owns the hand");
  assert.equal(a.with, "wright", "and the companion rides as the handler's own word");
  assert.equal(a.residue, HUMAN_RESIDUE);
  assert.equal(a.residue, "the-town/say", "the residue is the mark's, not classes.md's stale prose");
  // AMENDED 2026-08-26. This line used to pin a PREFIX of the class mark's
  // body — a third copy of a sentence that already exists on the record and in
  // the seam, and the one that broke first when the mark was amended. The
  // verbatim property has its own test below, which reads the mark and compares
  // the WHOLE body; a prefix regex here was the weaker of the two and guarded
  // nothing the stronger one did not. What this test is actually about is the
  // STANDING, so that is what it now pins.
  assert.equal(a.standing, "companioned",
    "an ambient say is heard from a resident's standing — the human speaks beside one of their household's");
});

test("the companion may be omitted — the house's own awake housemate answers", () => {
  // The handler's law since 2026-08-08: "a house's human belongs where the
  // house is awake." Requiring beside: here would override that with the
  // caller's guess.
  const a = resolveHumanActor({ action: "say", as: "human", key: key("wright", "rei") });
  assert.equal(a.error, undefined);
  assert.equal(a.with, undefined, "no companion is forced on the handler");
});

test("a companion outside the household bounces, naming the law", () => {
  // "the human speaks beside one of their household's residents, from that
  // resident's standing" — standing borrowed from a stranger is impersonation.
  const b = resolveHumanActor({ action: "say", as: "human", beside: "stranger", key: key("wright") });
  assert.equal(b.error, "bounce");
  assert.equal(b.code, 403);
  assert.match(b.defect, /not a resident of your household/);
  // THE LITERAL SENTENCE, not the constant. Asserting against COMPANIONED made
  // this tautological: mutating the constant moved the hint and the expectation
  // together, and the probe stayed green. Its own can-fail flip caught that.
  assert.ok(b.hint.includes("the human speaks beside one of their household's residents, from that resident's standing"),
    "the refusal quotes the companioned-standing law verbatim");
  assert.equal(COMPANIONED, "the human speaks beside one of their household's residents, from that resident's standing",
    "and the constant is that sentence, not a summary of it");
  assert.equal(b.law, "LOGOS/classes.md § The human class");
});

test("every verb but say bounces for a human at a door with NO standpoint, and the bounce IS the ambient fence", () => {
  // AMENDED 2026-08-26, and the replacement is STRICTER than what it replaced.
  //
  // The original asserted that a human may do exactly one thing, full stop. That
  // stopped being the law when the parcel class began granting `walk` and `say`
  // to the household's own human (LOGOS/classes.md § The three channels). The
  // lazy repairs are deleting this test or loosening it to "say is granted";
  // the honest one asserts the property the change actually establishes —
  // THE FENCE IS NOW A FUNCTION OF WHERE YOU STAND, and a door that gathered no
  // standpoint may only answer for the ambient half.
  //
  // So this now pins TWO things where it pinned one: the ambient set is still
  // exactly say, AND the refusal must disclose that a ground may grant more.
  // A future hand that quietly re-hardcodes the full fence here fails on the
  // second clause even if it gets the first right.
  //
  // classes.md § The human class, still verbatim: "The one-grant fence IS the
  // scope fence: everything further waits for the humans-as-residents design,
  // and arrives — if it arrives — as law here first." The parcel grant IS that
  // arrival, and it arrived as law first — which is why this sentence survives
  // the amendment rather than being repealed by it.
  assert.deepEqual(HUMAN_AMBIENT_GRANTS, ["say"]);
  assert.equal(ONE_GRANT_FENCE,
    "everything further waits for the humans-as-residents design, and arrives — if it arrives — as law here first",
    "the constant is classes.md's sentence, not a paraphrase of it");
  for (const verb of ["walk", "leave-mark", "stake", "give", "take", "note-to-self", "unstake"]) {
    const b = resolveHumanActor({ action: verb, as: "human", beside: "wright", key: key("wright") });
    assert.equal(b.error, "bounce", `${verb} must bounce at a standpoint-less door`);
    assert.equal(b.code, 403);
    assert.match(b.defect, /one ambient grant, and it is say/);
    assert.ok(b.hint.includes("everything further waits for the humans-as-residents design, and arrives — if it arrives — as law here first"),
      `${verb}'s refusal must quote the fence's own sentence verbatim`);
    assert.match(b.hint, /A GROUND may grant a human more than that where it reaches them/,
      `${verb}'s refusal must not present the ambient half as the whole law`);
  }
});

test("the calculus fence does NOT bounce a verb the record grants at a standpoint", () => {
  // The other half, and the one the old test made impossible to write. Under
  // `fence: "calculus"` the apex has already resolved the three channels
  // against the record, so a second list here would be a second answer — and
  // the one that is wrong more often, because it cannot see the ground.
  //
  // Without this leg, "the fence moved" would be indistinguishable from "the
  // fence was deleted": every assertion above passes in a world where the
  // calculus branch refuses everything too.
  const a = resolveHumanActor({ action: "walk", as: "human", key: key("wright"), fence: "calculus", channel: "ground" });
  assert.equal(a?.error, undefined, "the calculus owns this decision; the seam must not pre-empt it");
  assert.equal(a.kind, "human");
  assert.equal(a.standing, "embodied",
    "a GROUND-granted act is taken from the human's own feet — there is no companion to borrow standing from");
  assert.equal(a.route, null, "and it does not route to the companioned say handler");
});

test("an ambient-granted say is still COMPANIONED, whichever fence asked", () => {
  // The discriminating pair for the line above: same verb, same human,
  // different channel, different standing. If `standing` were inferred from the
  // action name rather than from the channel, these two would collapse into one
  // act — which is exactly the distinction § The three channels draws.
  const a = resolveHumanActor({ action: "say", as: "human", key: key("wright"), fence: "calculus", channel: "ambient" });
  assert.equal(a.standing, "companioned");
  assert.equal(a.route, "worldSayHuman");
});

test("an unknown actor kind bounces rather than falling through to resident", () => {
  // Falling through would let a caller name any kind and quietly act as
  // themselves — the door would be answering a question nobody asked it.
  const b = resolveHumanActor({ action: "say", as: "ghost", key: key("wright") });
  assert.equal(b.error, "bounce");
  assert.equal(b.code, 422);
  assert.match(b.defect, /not an actor kind this door resolves/);
});

/**
 * A source file with its comments removed — line comments AND block comments.
 *
 * String literals are not modelled and do not need to be: nothing in the file
 * under probe puts a comment opener inside a string, and a stripper that parsed
 * JavaScript to answer a grep would be a second parser to keep right. The
 * falsifier for that risk is in the test below — a banned token planted in real
 * code must still red, which is what catches a stripper that has begun eating
 * too much.
 */
function codeOnly(text) {
  return String(text)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
}

test("the seam routes and never re-derives the hand", () => {
  // worldSayHuman has owned the speaker label ("human-of-<slug>", NEVER the
  // GitHub login), the companion choice and the record since 2026-08-08.
  // A second derivation here would be a second answer to a settled question.
  // CODE ONLY. The header legitimately QUOTES the handler's label while
  // explaining why this file does not build one — a comment that documents the
  // boundary is the opposite of crossing it, and the first version of this
  // probe could not tell the two apart.
  // THE STRIPPER READS BLOCK COMMENTS TOO (2026-09-05). It dropped `//` lines
  // and nothing else, so the day a JSDoc paragraph in that file explained the
  // boundary — "DISPLAY ONLY: the record's hand (`human-of-<household>`) and
  // every id keyed…" — this probe went red on exactly the prose the note above
  // calls legitimate. Its contract is CODE ONLY and it was reading two thirds of
  // the file's comments as code; widening it is the probe doing what it already
  // says it does, not a loosened assertion.
  const BANNED = /human-of-|githubLogin|householdOf\(/;
  const raw = readFileSync(new URL("../src/human-actor.mjs", import.meta.url), "utf8");
  const src = codeOnly(raw);
  assert.equal(BANNED.test(src), false,
    "the seam must not compute the speaker label itself");

  // AND THE WIDENING CAN STILL FAIL. A stripper that swallowed too much would
  // green this probe forever and nobody would notice, so the same banned token
  // is planted in a real statement and must be found. Two shapes, because the
  // block-comment rule is the one that just changed: bare code, and code on the
  // line right after a closing `*/`.
  for (const planted of [
    'const x = "human-of-" + h;',
    '/** doc */\nconst y = githubLogin(h);',
    'const z = 1; /* trailing */ const w = householdOf(h);',
  ]) {
    assert.equal(BANNED.test(codeOnly(planted)), true,
      `the stripper ate real code: ${JSON.stringify(planted)}`);
  }
  // …and the comment forms it is meant to drop really are dropped, or the arm
  // above would be passing for the wrong reason.
  for (const dropped of [
    "// human-of-<household>, in a line comment",
    "/** DISPLAY ONLY: the record's hand (`human-of-<household>`) */",
    "/*\n * githubLogin is named here to explain why this file does not call it\n */",
  ]) {
    assert.equal(BANNED.test(codeOnly(dropped)), false,
      `the stripper left a comment behind: ${JSON.stringify(dropped)}`);
  }
  const apex = readFileSync(new URL("../src/world-apex.mjs", import.meta.url), "utf8");
  // AMENDED 2026-08-26: the apex re-resolves the actor once the match is known,
  // because WHICH STANDING an act is taken from depends on the channel that
  // granted it and the channel is not known before the match. So the routing
  // reads `acting`, not `actor`, and the ordinary path now carries the embodied
  // flag. Both clauses still pin the same property the original did — the seam
  // ROUTES and never re-derives the hand.
  // AMENDED 2026-08-28: the routing grew a body (the ternary became an if) when
  // the orient-handle fix landed — worldSayHuman refuses any handle it is
  // handed ("one voice at a time"), so the envelope's handle now leaves the
  // fields at the routing boundary and survives only as `with:`. The pin
  // follows the shape; the property pinned is unchanged: routing reads
  // `acting`, and the human's door is chosen there and nowhere else.
  assert.match(apex, /if \(acting\?\.route === "worldSayHuman"/,
    "the apex routes a companioned say to the human's own handler");
  assert.match(apex, /const \{ handle: orientingHandle, \.\.\.humanFields \} = fields;/,
    "the orient handle leaves the fields before the human's door — one voice at a time is the handler's fence, honoured by not testing it");
  // AMENDED 2026-08-27: THE FLAG BECAME THE HAND, and the amendment is the
  // whole of the own-hand fix. `as_human: true` could not be honoured even by a
  // willing handler — it says an act was a human's without saying WHICH human,
  // so there is nothing to write down — and `git grep as_human src/` returned
  // exactly one hit, the dispatch itself. Every embodied act reached a door that
  // knew only the resident's name and wrote it. The dispatch now carries the
  // human's own label, so the far end has something true to record.
  // AMENDED 2026-08-29 (the seat ruling), and only in shape: the dispatch broke
  // across lines and grew `__seated_ground` beside the hand, so the one-line
  // regex stopped matching. The property pinned is untouched — the ordinary
  // path carries the HAND. The seat rides beside it rather than instead of it,
  // and the second clause below pins that, because a seat with no hand would be
  // the own-hand defect wearing this ruling's clothes: the record would name
  // the resident and nothing would say a human was involved.
  assert.match(apex, /handler\.run\(\s*hand \? \{ \.\.\.fields, as_human: hand/,
    "the ordinary path carries the human's HAND, not a flag no handler can record");
  assert.match(apex, /__seated_ground: seatedAt/,
    "the seating ground rides the dispatch — it is what lifts the walk door's 501, and a handler that had to derive it would be a second calculus");
  // AMENDED AGAIN 2026-08-29, and only in shape: `const hand` became a hoisted
  // `let`, because the CROSSING now needs the hand too — a human stepping into
  // a wheel-keeping ground must be the name the wheel counts, and that block
  // sits after the dispatch try the hand used to be scoped to. The property
  // pinned is untouched: the hand is DERIVED ONCE, by humanHandFor, off
  // `acting.standing`, and never spelled a second way here.
  assert.match(apex, /hand = acting\?\.standing === "embodied" \? humanHandFor\(/,
    "the hand is the one derivation, read — not a second spelling of the label invented here");
  assert.match(apex, /let hand = null;/,
    "and it is declared where both the dispatch and the crossing can see it, rather than derived twice");
  // AMENDED 2026-09-05: the closing `\)` came off this pattern. It pinned the
  // call's ENTIRE argument list, so the day `wheelOnCrossing` grew a sixth
  // parameter (`ctx`) the probe went red — not because the hand had stopped
  // riding, but because something else had started to. That is a control
  // asserting a spelling where it means a relation: the property is THE HAND IS
  // PASSED, IN THE HAND'S POSITION, and a call that also carries a context is
  // still that property. `\b` keeps it honest — it still reds if the argument is
  // dropped, renamed, or moved, and the falsifier below runs both.
  assert.match(apex, /wheelOnCrossing\(action, args, key, spineIds, hand\b/,
    "so the wheel counts whoever actually crossed — the hand where there is one");

  const WHEEL_HAND = /wheelOnCrossing\(action, args, key, spineIds, hand\b/;
  assert.equal(WHEEL_HAND.test("await wheelOnCrossing(action, args, key, spineIds, hand, ctx);"), true,
    "a call that grew another argument still carries the hand");
  assert.equal(WHEEL_HAND.test("await wheelOnCrossing(action, args, key, spineIds);"), false,
    "…and a call that dropped the hand is still caught");
  assert.equal(WHEEL_HAND.test("await wheelOnCrossing(action, args, key, spineIds, handler);"), false,
    "…and so is one that passes something merely named like it");
});

// ── THE OWN HAND, at the two doors that answer for it ───────────────────────

test("the hand an embodied act is recorded under is the human's own label", () => {
  // `human-of-<slug>` is RESERVED town-wide so it can never collide with a
  // resident's voice: residency.mjs and declare.mjs both refuse a handle wearing
  // it. That reservation is what makes it safe to write into an act row.
  const hand = humanHandFor(["wright", "rei"]);
  assert.match(hand, /^human-of-/, "the label the town reserves for a household's human");
  assert.ok(!/^wright$|^rei$/.test(hand), "and never one of the residents' own names");
  assert.equal(humanHandFor([]), null,
    "no handles is null, never a guessed default — the same refusal humanTokenUrl makes");
});

test("an embodied WALK is refused rather than recorded under the resident's hand", async () => {
  // THE VIOLATION THIS REPLACES: `walkViaOffice` writes `actor: who` into
  // dynamic.db/movements, and `who` is checked against the KEY's residents — so
  // an embodied human's step landed on the record as their resident's, with
  // nothing anywhere saying a human moved. That is the one thing the human class
  // exists to prevent (it `implements: the-town/the-own-hand`).
  //
  // The fix is a refusal and not a re-hand, because the other row is not
  // writable either: a walk is a body moving through the world's geometry, and
  // LOGOS/classes.md § The human class says the design that would give a human
  // such a body has not arrived — "everything further waits for the
  // humans-as-residents design, and arrives — if it arrives — as law here
  // first."
  //
  // THE CLONE PATH IS DELIBERATE NONSENSE. The refusal must land before any pen
  // or clone is touched — a walk that bounced only after reading the world could
  // still have written something on the way. If this guard were removed, this
  // call would fail on the missing clone instead, with a different code: the
  // probe distinguishes "refused by law" from "fell over".
  await assert.rejects(
    () => walkViaOffice("/nonexistent-clone-on-purpose",
      { as_human: "human-of-pando-house", to_x: 1, to_y: 2 }, key("wright", "rei")),
    (e) => {
      assert.equal(e.code, 501, "the office's own gap, answered as one");
      assert.match(e.defect, /cannot record a walk under a human's own hand/);
      assert.match(e.hint, /human class exists to prevent exactly that/,
        "the refusal names WHY the resident's row is not an option");
      assert.match(e.law, /everything further waits for the humans-as-residents design/,
        "and quotes the law sentence that leaves the other row unwritable");
      assert.match(e.hint, /act as your resident to move, or as your human to be heard/,
        "a refusal says what IS still open, not only what is closed");
      return true;
    });
});

test("an ordinary resident's walk is untouched by the human guard", async () => {
  // The discriminating leg. Without it, "embodied walks are refused" is
  // indistinguishable from "this door stopped walking anybody" — and every
  // assertion above would still pass. A walk with no `as_human` must get past
  // the guard entirely and fail for its own reasons (here: the nonsense clone).
  await assert.rejects(
    () => walkViaOffice("/nonexistent-clone-on-purpose", { to_x: 1, to_y: 2 }, key("wright")),
    (e) => {
      assert.notEqual(e.code, 501, "a resident's walk never meets the human refusal");
      assert.equal(/cannot record a walk under a human's own hand/.test(String(e.defect ?? "")), false);
      return true;
    });
});

test("the class mark's own body is quoted verbatim, from the world record", () => {
  // A paraphrase of a law sentence is the drift class the quote law kills.
  const roots = [worldClone()].filter(Boolean);
  const rel = "WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-node/entity/human/mark.md";
  let text = null;
  for (const root of roots) {
    if (!root) continue;
    try { text = readFileSync(join(root, rel), "utf8"); break; } catch { /* next */ }
  }
  if (text == null) { console.log("      ↳ no world checkout on this box — the verbatim check did not run"); return; }
  const a = resolveHumanActor({ action: "say", as: "human", key: key("wright") });
  const prose = text.slice(text.indexOf("---", 3) + 3).trim();
  assert.ok(prose.includes(a.says), `the door paraphrases the class mark:\n  door:   ${a.says}\n  record: ${prose}`);
  // and the residue comes from the mark's own actions entry, not from prose
  assert.match(text, /"residue":\s*"the-town\/say"/,
    "the mark's actions entry names the residue this seam carries");
});

// ── THE ROSTER'S SHAPE IS THE SITE'S CONTRACT ───────────────────────────────

test("the allowed human row carries the contract's own field names", async () => {
  // THE CONTRACT, verbatim from the consumer that declared it (site
  // src/lib/world-cockpit.mjs § actorsFor, branch bday-pin — unmerged, and named
  // as unmerged because a contract you cannot point at is a rumour):
  //
  //     answer.actors = [
  //       { kind: "resident", handle, label, allowed: true },
  //       { kind: "human", id, label, allowed: false, reason: "…the door's own
  //         words…", token_url?: "…" }
  //     ]
  //
  // plus `because` — "Why it is allowed, in the words of the law that allowed
  // it" — which the office shipped without on 2026-08-27 and which this asserts.
  const { actorRoster } = await import("../src/human-actor.mjs");
  const [resident, human] = actorRoster({
    residents: ["rei"],
    humanGrants: ["walk", "say"],
    humanHandle: "keeminlee",
    seats: [{ ground: "rei/the-lanternstep-house-parcel", from: "the-town/parcel" }],
  });

  assert.equal(resident.kind, "resident");
  assert.equal(resident.handle, "rei");
  assert.equal(resident.label, "rei");
  assert.equal(resident.allowed, true);

  assert.equal(human.kind, "human");
  assert.equal(human.allowed, true, "ground granted, so the face is lit");
  assert.equal(human.id, "keeminlee");
  // THE LABEL IS THE VERIFIED GITHUB LOGIN, and it already was — `key.household`
  // is `ghLogin ?? String(ghId)` (office oauth.mjs), which is exactly what the
  // site's own bridge derives from `me.verified_github.login` and calls "the only
  // durable name the site has for the person rather than for one of their
  // residents". This pins that the two stay the same name.
  assert.equal(human.label, "keeminlee");
  assert.equal(human.reason, null, "an allowed face carries no refusal");
  assert.equal(typeof human.token_url, "string");

  // `because` — present, non-empty, and NAMING the ground that seated them
  // rather than asserting that something did.
  assert.equal(typeof human.because, "string");
  assert.ok(human.because.includes("rei/the-lanternstep-house-parcel"),
    "the sentence names WHICH ground lit the face");
  assert.ok(human.because.includes("the-town/parcel"),
    "and which class granted it — the half that tells a parcel from a portal");
  assert.ok(/walk/.test(human.because) && /say/.test(human.because),
    "and what it granted, so the face says what it is for");
});

test("a human with no ground under them gets a refusal and NO because", async () => {
  // The discriminating leg, and it pins the contract's own asymmetry: `because`
  // explains an allowance and `reason` explains a refusal. A row carrying both
  // would be answering a question nobody asked, and a row carrying neither is
  // the silent face this whole fix exists to end.
  const { actorRoster } = await import("../src/human-actor.mjs");
  const human = actorRoster({ residents: ["rei"], humanGrants: [], humanHandle: "keeminlee" })
    .find((f) => f.kind === "human");
  assert.equal(human.allowed, false);
  assert.equal(human.because, null, "nothing seated them, so nothing is claimed to have");
  assert.match(human.reason, /embodied only where a ground's class grants it/);
  assert.equal(human.stance, "companioned-human");
  // ALWAYS PRESENT, even unlit — "An absent option teaches nothing."
  assert.equal(human.kind, "human");
});

test("an unnamed seat produces no sentence rather than an empty one", async () => {
  // The failure direction that matters: if the grounds cannot be read, the door
  // says nothing rather than writing prose around a blank. A `because` reading
  // "  seats your household's human" would be the door inventing the one thing
  // it asks the site not to invent.
  const { actorRoster } = await import("../src/human-actor.mjs");
  const human = actorRoster({ residents: ["rei"], humanGrants: ["say"], humanHandle: "keeminlee", seats: [] })
    .find((f) => f.kind === "human");
  assert.equal(human.allowed, true, "the grant still stands — this is about the sentence, not the permission");
  assert.equal(human.because, null);
});

test("the door's whitelist passes the seam's own words through", () => {
  // Found live on the dungeon stage, 2026-08-28: apexDo had read `as:` since
  // 08-23 ("Absent `as:` returns null and nothing below changes"), but
  // APEX_TOOL's inputSchema is the CLOSED whitelist the door validates against
  // — "an unknown TOP-LEVEL parameter is refused by name" — and neither `as`
  // nor `beside` was in it. Every embodied act bounced as an unknown argument
  // before resolveHumanActor could see the word: the human class shipped
  // behind a door that refused to pass its own word through.
  const props = APEX_TOOL.inputSchema.properties;
  assert.ok(props.as, "the whitelist names `as:` — the seam's word reaches the seam");
  assert.ok(props.beside, "and `beside:` — the companion's word rides with it");
  const v = validateArgs(APEX_TOOL, { do: "walk", handle: "rei", as: "human", beside: "rei", args: { x: 1, y: 2 } });
  assert.equal(v?.error, undefined, `an embodied act's envelope validates clean, got: ${JSON.stringify(v)}`);
});

test("THE CREDENTIAL IS NOT THE NAME: POSTMARK_HUMAN_NAMES maps a login's shown label, display only", async () => {
  const { actorRoster } = await import("../src/human-actor.mjs");
  const prev = process.env.POSTMARK_HUMAN_NAMES;
  process.env.POSTMARK_HUMAN_NAMES = "keeminlee=DARKO, other=Someone Else";
  try {
    const r = actorRoster({ residents: ["rei"], humanGrants: [{ action: "strike" }], humanHandle: "keeminlee", seats: [] });
    const h = r.find((x) => x.kind === "human");
    assert.equal(h.label, "DARKO", "the shown name is the town name");
    assert.equal(h.id, "keeminlee", "the id stays the credential — renaming a record orphans its readers");
    assert.equal(h.handle, "keeminlee", "the handle stays the credential");
    // CAN-FAIL control: an unmapped login shows as itself
    const r2 = actorRoster({ residents: [], humanGrants: [], humanHandle: "somebody", seats: [] });
    assert.equal(r2.find((x) => x.kind === "human").label, "somebody");
  } finally {
    if (prev == null) delete process.env.POSTMARK_HUMAN_NAMES; else process.env.POSTMARK_HUMAN_NAMES = prev;
  }
});
