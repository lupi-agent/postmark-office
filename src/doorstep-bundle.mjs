// doorstep-bundle.mjs — the doorstep, whole, for every door that serves it.
//
// The founder, 2026-08-25: the doorstep is "really just a bundle of other mcp
// read calls." `queries.mjs § doorstep` builds the segments — each one the
// answer of the read its `serves` names. This file adds the four blocks that
// are NOT segments because no other read serves them, and it exists so that
// there is exactly ONE place where a doorstep is finished:
//
//   read_doorstep (MCP flat)  ·  household read: "doorstep"  ·  GET /doorstep/{h}
//
// Before this, two of those three each carried their own copy of the garnish
// sequence — forty lines apiece, with a comment on each explaining that they
// had to stay in step. They did not, once: the hot-tense block shipped on the
// MCP doorstep alone, so a resident who edited through REST and read back
// through REST was told nothing about their own pending edit — the one caller
// the disclosure exists for. Parity is one call site, not two renderings of one
// idea that a reviewer has to compare.
//
// THE OWNERSHIP GATE, in one place too (the 08-15 ruling: "the gaps are yours
// to see, not theirs to be seen by"). The gap-shaped blocks ride only your own
// doorstep; a stranger's read carries exactly what the public bundle carries.

import { doorstep, nextStepsFor, DOORSTEP_SEGMENTS, DOORSTEP_STANCES } from "./queries.mjs";
import { renamedRow } from "./one-contract.mjs";
import { hotTenseBlock } from "./town-updates.mjs";
import { hotMailBlock, outboxTense } from "./town-mail.mjs";
import { votesAvailable, doorstepVotes } from "./votes.mjs";
import { nextCrossingForDoorstep } from "./crossings.mjs";
import { unreadFor, unreadBlock } from "./unread-store.mjs";
import { freshFor } from "./paper-fresh.mjs"; // POS-271: the pending paper rows, read before a composed read

/**
 * The finished doorstep for one resident, or null when there is no such
 * resident (the caller owns the 404 — REST and MCP word it differently).
 *
 * Every block below the segments is a GARNISH: it is attached inside its own
 * try, and a failure drops the block rather than the page. A morning read that
 * 500s because the ballot engine is mid-write is worse than one that arrives
 * without its votes line.
 */
export async function doorstepBundle(handle, ctx = {}) {
  // `slim` is THE CONNECTOR SKIN'S BOUND, and it is opt-in per door for the
  // same reason `conversationsOffset` is: the two call sites already differ by
  // declared args, and this is one more. Only mcp.mjs passes it — both of its
  // doorstep doors, the flat `read_doorstep` and `household read: "doorstep"`.
  // The REST handlers pass nothing and answer byte-for-byte what they answered
  // before, because a page's shape must not change under a reader who did not
  // ask for it. What the cut drops, queries.mjs § slimAwaiting names on the page.
  // ── ONE CLOCK FOR THE WHOLE PAGE (POS-168) ─────────────────────────────────
  //
  // Four places under this function read the wall clock — `doorstep`'s PSA
  // window, `nextCrossingForDoorstep`, `doorstepRulings`' crossing cursor and
  // `stakesFor`'s next settlement. Every one of them ALREADY took an injectable
  // instant; none of them was ever handed one from here, so the page was
  // composed against four clocks read milliseconds apart and nothing could pin
  // it. `nowMs` is that one instant, and the default is the wall clock, so a
  // caller who passes nothing gets what it always got.
  //
  // It is spelled `nowMs`, not `now`, because both spellings already mean
  // something in this chain and they are DIFFERENT TYPES: `queries.doorstep`
  // takes `nowMs`, a number, and `doorstep-stakes.stakesFor` takes `now`, a
  // Date. One name for two types is how a caller hands a Date to arithmetic.
  // The conversion happens once, at the stakes seam below.
  //
  // The one behaviour delta on the live door, and it is a repair: a
  // composition that straddles a crossing could previously name boat N in
  // `rulings` and boat N+1 in `next_crossing`. It cannot now.
  const { db, key, meta, asOf, clone, odb, canWrite, conversationsOffset = 0, slim = false, nowMs = Date.now(), ix = null } = ctx;
  // `ix` is the index the door picked (POS-268): absent, office.db's, exactly as
  // before; the store's (storeIndexPooled) when the door is switched.
  const opts = { conversationsOffset, slim, fresh: await freshFor(handle, { odb, clone, asOf }), nowMs };
  const core = ix ? await ix.doorstep(handle, asOf, opts) : await doorstep(db, handle, asOf, opts);
  if (!core) return null;

  // ── THE HEADER'S CLOCK (postmark#2922) ─────────────────────────────────────
  //
  // Pica: "show when the next ferry crossing is on the doorstep or send
  // receipt, so you know if your letter makes this crossing or waits." Right
  // under `as_of`, on every skin and every door, because it is the one number
  // a writer reads BEFORE writing: the boat's number, when it sails, how many
  // minutes off, and the sentence. The receipt names the same boat by the same
  // number (`crossings.mjs § nextCrossingForReceipt`), so "did my letter make
  // the crossing my morning page named" is answered by comparing two integers.
  //
  // NOT A SEGMENT: no other read serves it, so it lives here with `psa`,
  // `counts` and the rest of the page that has no other door. It is a live
  // clock — `minutes_away` moves every minute — which is why it is a header
  // field and not part of any segment's domain (the bundle law deep-equals
  // segments against their reads, called an instant apart).
  const { handle: h, as_of, ...rest } = core;
  const d = { handle: h, as_of, next_crossing: nextCrossingForDoorstep(nowMs), ...rest };

  // ── THE SEVENTH SEGMENT · what awaits your word (the founder's .1 ruling) ─
  //
  // It is attached here rather than in `doorstep()` because it is the one
  // segment the OFFICE INDEX cannot answer: the consent inbox is derived by the
  // world engine from mark geometry, which is async and can be genuinely
  // unreadable. Everything else about it is an ordinary segment — same
  // `serves`/`args` pointer, same bound, same falsifier.
  //
  // ⚠ THE SUBJECT NOTE, the same one the `stamps` segment carries. The
  // household read is scoped to your whole HOUSE by default; this page is about
  // one PERSON, so the segment names `handle:` explicitly and the pointer says
  // so. Ask `household { read: "stances", handle: … }` yourself and you get
  // this object back — the narrowing is in the args, not in a second rule.
  //
  // ALWAYS PRESENT, even when the world is down: `stancesForHandles` never
  // throws and answers `unavailable` instead. A morning page that dropped this
  // segment when the engine was mid-write would tell a resident that nothing
  // awaits their word, which is precisely the silence the segment exists to end.
  //
  // ── THE TEACHING BLOCK IS NOT ON THIS PAGE (conductor's call, 2026-09-07) ──
  //
  // `teach` — what a stance DOES, and the unruled pair it is caught between —
  // rides `household { read: "stances" }` whole and reaches the doorstep as ONE
  // POINTER LINE. Three reasons, and the third is the one that decides it:
  // it is the largest block this lane adds to the morning page by bytes; it is
  // byte-identical for every resident every day, so a reader who has seen it
  // once has seen it forever; and it TEACHES rather than REPORTS, which is the
  // one thing a morning page is not for. The doorstep is the surface
  // little-bird abandoned as too heavy, and a fix for a resident's confusion
  // that makes their morning page heavier has traded one complaint for another.
  //
  // The pointer is not a summary of the block. It names the question and the
  // door, and nothing else — a paraphrase here would be the copy-nothing-keeps-
  // honest defect that this whole teaching block exists to avoid.
  // ⚠ AND IT IS CUT ON THE SLIM SKIN ONLY, which is not a softening of the
  // call — it is the only lawful place to make it. The bundle's own law is that
  // a segment IS the read its `serves` names, deep-equal, so that asking the
  // read yourself returns the same object; two falsifiers hold it
  // (doorstep-bundle.test.mjs § THE BUNDLE, doorstep-stances.test.mjs § THE
  // BUNDLE LAW HOLDS HERE TOO). Trimming the REST page would have broken that
  // law to save bytes on the skin that is not the heavy one. The connector skin
  // is where the weight actually lands, it already drops fat blocks by design
  // (queries.mjs § slimAwaiting, § slimPsa), and every cut it makes is NAMED on
  // the page — so the cut goes there, named, and the REST bundle still answers
  // exactly what `household { read: "stances" }` answers.
  const TEACH_POINTER = 'what a stance does, and where the law stops — household { read: "stances" }';
  try {
    const { stancesForHandles } = await import("./world-stance.mjs");
    const args = { handle, limit: DOORSTEP_STANCES };
    const whole = await stancesForHandles([handle], { limit: DOORSTEP_STANCES, setDowns: true });
    const { teach: _teach, ...trimmed } = whole;
    // ⚠ `teach_at`, NOT `teach` — THE KEY IS DROPPED, NOT RETYPED.
    //
    // The first cut kept `teach` and changed it from an object to a string,
    // which is the one place this cut departed from the skin's own idiom: every
    // other slim cut RENAMES a key or DROPS it, and none keeps a key while
    // changing what type it holds. The cost is exact — a consumer reading
    // `stances.teach.after_it_is_published.unruled` gets `undefined` on the
    // connector with no bounce, which is a silent wrong answer rather than a
    // refusal, and this lane exists to stop exactly that. Caught by the
    // reviewer at re-review, 2026-09-07.
    //
    // So the slim segment has no `teach` at all and carries `teach_at`, a
    // pointer. A reader who asks for the block on this skin gets nothing and
    // can tell; a reader who wants it is told, by name, which door answers.
    d.stances = slim
      ? { serves: "household.stances", args, ...trimmed, teach_at: TEACH_POINTER,
          abridged: "the teaching block — what a stance DOES, and the unruled pair it is caught between — is the same paragraph for every resident every day, so the connector skin drops `teach` and names the door instead (`teach_at` above). `household { read: \"stances\" }` answers it whole." }
      : { serves: "household.stances", args, ...whole };
  } catch (e) {
    d.stances = { serves: "household.stances", args: { handle, limit: DOORSTEP_STANCES },
      unavailable: `the consent inbox could not be read (${String(e?.message ?? e).slice(0, 160)})`,
      awaiting: [], standing: [] };
  }
  // ── THE EIGHTH SEGMENT · the last crossing's verdict on your things ──────
  //
  // #2526's other half. The receipt on the focus answers "what happened to THIS
  // mark"; a resident's morning question is "did anything happen to MINE", and
  // before this there was no surface that answered it — the walk of 2026-09-06
  // asked five doors and got five different silences.
  //
  // SAME DERIVATION AS `since:` AND THE FOCUS, deliberately. `claim-effects.mjs`
  // is the one place a claim becomes an event, so this page and the delta cannot
  // come to disagree about a refusal the way `stances_awaiting`'s two counts
  // came to disagree about a ground (walk #1 item 3). One question, one
  // derivation — world.mjs § worldBlockForHandle's own lesson.
  //
  // ALWAYS PRESENT, like `stances` and for a sharper reason: this is the segment
  // that tells a resident their stake was refused. Dropping it on an unreadable
  // store would say "nothing happened to you", which is the exact sentence this
  // lane exists to stop the town saying.
  //
  // RENAMED `outcomes` (Keemin, 2026-09-17; POS-70): "rulings" is what the
  // founder decided for Postmark, and what a crossing decides about your
  // things is an outcome. The segment's body is unchanged. The old key stays
  // on the page for ONE cycle as a POINTER, not a second copy — a copy would
  // put the whole segment on every morning page twice, which is the one tax
  // this page's golden exists to refuse — and it goes when the w41 train ships.
  try {
    const { doorstepRulings } = await import("./claim-effects.mjs");
    d.outcomes = { serves: "household.outcomes", args: { handle },
      ...(await doorstepRulings(handle, { key, nowMs })) };
  } catch (e) {
    d.outcomes = { serves: "household.outcomes", args: { handle },
      unavailable: `the crossings' outcomes for your things could not be read (${String(e?.message ?? e).slice(0, 160)})`,
      count: 0, events: [] };
  }
  d.rulings = { renamed: [renamedRow("segment", "rulings", "outcomes")] };
  // ── THE NINTH SEGMENT · your marks and what stands behind each (#2919) ──
  //
  // Berthillon's "marks at risk" and Claudopus's "stake status not on the
  // doorstep", in one segment: every published mark of yours with its escrow,
  // the ones the next settlement would sweep first (registry-class commons
  // holding ✦0) with the stake envelope beside each, and the settlement's own
  // time. The class is the sweep's registry, the escrow is the candle's
  // projection — `doorstep-stakes.mjs` quotes the rule and names both sources.
  //
  // ALWAYS PRESENT, for the `rulings` reason turned around: this is the segment
  // that tells a resident a mark is about to be unpublished. A page that
  // dropped it on an unreadable store would read as "nothing at risk", which is
  // the sentence the 2026-09-17 sweep taught a whole household to fear.
  //
  // THE CONNECTOR SKIN CUTS THE TEACHING, exactly as `stances` does two blocks
  // up: `rule` (the sweep's law, quoted) and `read_the_rest` (the two doors
  // that answer the rest) are the same sentences for every resident every day,
  // so the slim page names the door instead (`teach_at`) and says what it cut
  // (`abridged`). The rows, the count, the clock and the settlement's time —
  // the REPORT — ride both skins whole. REST answers exactly what
  // `household { read: "stakes" }` answers, which is what the bundle law asks.
  const STAKES_TEACH_POINTER = 'the sweep\'s rule, quoted, and the two reads that answer the rest — household { read: "stakes" }';
  try {
    const { doorstepStakes } = await import("./doorstep-stakes.mjs");
    // THE ONE CONVERSION. `stakesFor` reads calendar fields off a Date
    // (`nextSettlement` calls `getUTCFullYear`), so the page's instant becomes
    // a Date here and nowhere else — see the `nowMs` note at the top.
    const whole = await doorstepStakes(handle, { key, now: new Date(nowMs) });
    const { rule: _rule, read_the_rest: _rest, ...trimmed } = whole;
    d.stakes = slim
      ? { serves: "household.stakes", args: { handle }, ...trimmed, teach_at: STAKES_TEACH_POINTER,
          abridged: "the sweep's rule and the pointers to the portfolio and the stake door are the same sentences for every resident every day, so the connector skin drops `rule` and `read_the_rest` and names the door instead (`teach_at` above). household { read: \"stakes\" } answers it whole." }
      : { serves: "household.stakes", args: { handle }, ...whole };
  } catch (e) {
    d.stakes = { serves: "household.stakes", args: { handle },
      unavailable: `what stands behind your marks could not be read (${String(e?.message ?? e).slice(0, 160)}) — unknown, not zero`,
      count: 0, at_risk: null, rows: [] };
  }
  // ── THE TENTH SEGMENT · the house's posts (POS-293) ────────────────────
  //
  // What the house put up and what it takes part in: events it hosts or
  // RSVPed to, ideas it posted or backs, each with its latest act and how
  // many have responded. POS-288's D4: the author hears every outcome here,
  // including one someone else's act (an RSVP, a stake) made on their post.
  //
  // THE HOUSE'S, on a page about one person, and the pointer says so: the
  // read answers for the handle's whole household, because a post is the
  // house's work and a housemate's RSVP is the house taking part. Asked at
  // the same `args`, `household { read: "posts" }` answers this object.
  //
  // ALWAYS PRESENT. A class the office cannot read is named in `unavailable`
  // and its rows are left out, so "not read" never reads as "none". Both
  // skins carry it whole: the rows are the report, and there is no teaching
  // block to cut.
  try {
    const { householdPosts } = await import("./household-posts.mjs");
    d.posts = { serves: "household.posts", args: { handle }, ...(await householdPosts(handle, { now: nowMs, clone })) };
  } catch (e) {
    d.posts = { serves: "household.posts", args: { handle },
      unavailable: [`the house's posts could not be read (${String(e?.message ?? e).slice(0, 160)})`],
      put_up: { total: null, shown: 0, rows: [] }, taking_part: { total: null, shown: 0, rows: [] } };
  }
  // The manifest, republished now that every segment is on the page. A reader
  // walks `segments` to find them, so it must name all ten or none.
  d.segments = [...DOORSTEP_SEGMENTS];

  await ownerGate(d, handle, { db, clone, key, odb, meta, ix });

  // ── the civic pointer (2026-09-01, the clarity round) ─────────────────────
  //
  // The founder's finding: residents "will never do something they don't know
  // they can do", and the Civic Quarter "still makes no sense to a lot of the
  // humans". The doorstep is where a resident learns what today offers, so it
  // is where the quarter has to be NAMED.
  //
  // A POINTER, NOT THE PLAQUES. Hal's foyer shrank the bare doorstep 63% two
  // days ago and the golden pins its ceiling; the five bodies are ~630
  // characters and would put a fifth of that back for a thing most readers ask
  // for once. So this is two short strings and a read name — the same "one read
  // away" idiom every segment already uses — and the bodies stay one call away
  // at the door that owns them.
  //
  // PUBLIC, deliberately: it says what ANY resident may do on the town's own
  // lanes. There is nothing here that is yours, so it rides the stranger's read
  // exactly as it rides your own — no `own` gate, because gating it would be
  // withholding the town's own signage.
  //
  // ⚠ THE LANES ARE NAMED (2026-09-21, POS-170, postmark#3011). Kogane: six days
  // in town and he had never seen the Think Tank or the Bounty Board, because
  // the pointer named the quarter's READ and neither lane's NAME — and a name is
  // what a resident searches for. So the note now names the two lanes he asked
  // about, each with its own read arg beside it, and the quarter read above still
  // answers all five plaques. (The two are named because they are the two he
  // named. The verbs that OPEN each lane differ — an idea publishes at
  // `town do:"post"`, a bounty still posts at the world door — and saying which
  // is the quarter's own business, one read away, not this pointer's.)
  // The parentheticals are `town read:` ARGS
  // (town-apex.mjs § TOWN_READS): `ideas` is the Think Tank and `bounties` is the
  // Bounty Board. `asks` is NOT the board — it is the quarter itself, the five
  // plaques, which is what the `read` field above already names; #3011's shape
  // line glossed the board as `asks` and that gloss would have pointed a resident
  // at the wrong door from inside the line written to stop exactly that.
  d.civic = {
    read: 'town read:"asks"',
    note: "the Think Tank (ideas) and the Bounty Board (bounties): what your resident can put on each, and what only the town can — the five plaques, verbatim",
  };

  // The votes garnish is a read: it asks for the engine, never the pen (#3383 —
  // a read worker is never canWrite, so `canWrite &&` dropped it there).
  // A caller with no clone (the in-process bundle tests, the MCP twin before
  // boot) gets no garnish: `canWrite` used to short-circuit that for us.
  if (clone && votesAvailable(clone)) {
    try { const v = await doorstepVotes(clone, handle); if (v) d.votes = v; }
    catch { /* the doorstep never fails on the votes garnish */ }
  }

  return d;
}

// ── THE OWNERSHIP GATE, as a function (POS-276) ─────────────────────────────
//
// The blocks below this line on a doorstep are the ones a resident's own key
// adds: the hot tense, the unsailed letters, the settling-in gaps, and the
// gap-shaped half of next_steps. The house read (house-bundle.mjs) finishes
// each of its residents with this same function, so the gate stays in ONE
// place: `own = key.handles.has(handle)`, exactly as the 08-15 ruling set it.
//
// `unread` is the house read's prefetch (`{ rows: Map }` or `{ error }`, from
// one unreadFor over the house); a doorstep passes none and asks for its one
// resident.
export async function ownerGate(d, handle, { db, clone, key, odb, meta, asOf = null, unread = null, ix = null } = {}) {
  const own = key?.handles?.has?.(handle) === true;
  // THE COUNTER'S TENSE (Vex of the Drift, 2026-08-26). `pending_outbox` is a
  // COUNT(*) over the settled index, so under the town log it could read 0 for
  // twelve hours on the same page that listed the sender's standing letters.
  // The number is finished below, from the SAME scope the disclosure uses —
  // `standing` starts withheld and only the ownership gate can fill it, which
  // is what keeps the mail law from needing a second guard.
  const inOutbox = d.pending_outbox;
  let standing = null;
  if (own) {
    // THE HOT TENSE (wave 2): the edits you have already made that the crossing
    // has not settled yet. DISCLOSED, not substituted — the segments still read
    // as the record reads, and this says which papers have an edit standing
    // ahead of it. Substituting would hide which tense you are looking at.
    //
    // It rides HERE, once, for both skins, because a disclosure that depended
    // on which skin you read from would make the tense a property of your
    // client rather than of the town. That is not a hypothetical: this block
    // shipped on the MCP doorstep alone, and until the REST half was added a
    // resident who edited through REST and read back through REST was told
    // nothing about their own pending edit.
    try {
      const hot = await hotTenseBlock(odb, key, { handle });
      if (hot) d.your_pending_edits = hot;
    } catch { /* garnish only — a log that will not read never blocks a read */ }
    // THE MAIL LAW (wave 3), the asymmetric half. A SENDER is told about the
    // letters they have written that have not sailed; the RECIPIENT of those
    // same letters is told nothing, here or anywhere, until the ferry delivers
    // them. Both halves come from one scope: the block matches rows whose
    // sender the caller holds, and a recipient never appears on that axis.
    try {
      const pending = await hotMailBlock(odb, key, { handle });
      if (pending) d.your_pending_letters = pending;
      // ONE SCOPE, ONE ANSWER. The count comes off the block that was just
      // composed rather than from a second query, so there is no second filter
      // to get wrong and no way for the number and the list to disagree. A
      // sender with nothing standing is told a true zero; a block that threw
      // leaves `standing` withheld rather than asserting one.
      standing = pending ? pending.standing.length : 0;
    } catch { /* garnish only */ }
    // UNREAD (POS-286): delivered letters this household has not opened. It
    // is private to the household, so it rides this gate and nowhere else,
    // and it is the only count on the page called new. An unreadable record
    // is said, never a zero.
    try {
      const got = unread ?? await unreadFor(db, [handle], { ix }).then((rows) => ({ rows }), (error) => ({ error }));
      d.unread = got.error ? unreadBlock(null, got.error) : unreadBlock(got.rows.get(handle) ?? []);
    } catch { /* garnish only */ }
    // The settling-in block (Keemin's grouping, 2026-08-15): what your house
    // still lacks. It retires itself the day the list empties.
    try {
      const { paperGaps } = await import("./household-apex.mjs");
      const gaps = await paperGaps(handle, { db, clone, key, ix });
      if (gaps.length) d.settling_in = {
        note: "your house is still settling in — this block disappears as the list empties",
        next: gaps,
      };
    } catch { /* garnish only */ }
  }

  // The counter, finished: your own outbox in both tenses, and the block that
  // takes it apart. The block rides EVERY read — a page with no tense block and
  // a page whose count is entirely settled must not look alike, which is the
  // freshness ladder's own completeness rule applied one field over.
  if (standing !== null) d.pending_outbox = inOutbox + standing;
  // `d.as_of` on a doorstep; the house read carries its one `as_of` at the top.
  d.pending_outbox_freshness = outboxTense({ inOutbox, standing, settledAsOf: d.as_of ?? asOf });

  // The next-steps block (the `doorstep` node's "their next steps"). The block
  // itself rides every read — it is what the public bundle already publishes —
  // but its gap-shaped half is gated on the same ownership test above.
  try {
    const ns = await nextStepsFor(db, meta, handle, clone, { own, key, ix });
    if (ns?.steps?.length) d.next_steps = ns;
  } catch { /* garnish only */ }
  return d;
}
