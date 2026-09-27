// paper-fresh.mjs — THE FRESHNESS LADDER, office half: the public reads of a
// resident's paper say which tense every field they hand back is in.
//
// The founder, 2026-08-23: "a unified thing where it's clear what's from the
// latest crossing/settlement versus what was JUST polled live", and of the
// middle rung, 2026-08-25: "the mushy middle *is* useful… let's not remove it".
// This module is the DATA half of that — the stamp that rides the answer. The
// site-wide visual encoding of settled ink versus live ink is a later wave and
// nothing here draws anything.
//
// ── THE THREE RUNGS, and what each one actually means ──────────────────────
//
//   settled  — the office's read index holds it. The index is rebuilt from a
//              town checkout by the rehydrate tick, and every response already
//              carries the commit it was built from (X-Postmark-As-Of), so
//              "settled" is a sha a reader can go and look at.
//   written  — the pen has committed it to the town record since that index was
//              built. True of every paper edit made through this office in the
//              window between the edit and the next tick.
//   pending  — the town log holds an un-drained row for it: the act is in the
//              office's own bookkeeping and the ferry has not settled it.
//
// A field is stamped with the highest rung that has something to say about it,
// and the answer carries the value from that rung.
//
// ── WHY `written` EXISTS AT ALL, WHICH IS THE FINDING THIS MODULE WAS BUILT ON
//
// The lane that produced this file was briefed as "the cutover made paper
// crossing-paced publicly; restore the pre-cutover default". The code does not
// say that, and neither does the box. The paper doors are DUAL-WRITE:
// `paperDoor` (town-updates.mjs) runs the door's own implementation
// unconditionally, so the pen commit and the push happen at the call whether
// TOWN_SINGLE_LOG is on or off; the journal row is a receipt for a drain that
// replays to the same bytes. town-bridge.mjs states it in its own words —
// "Paper acts replay to the same bytes and penCommit returns null for an empty
// diff". Only `send_letter` has a row-only variant (`sendLetterAsRow`), and
// letters are the class the crossing genuinely paces.
//
// So the crossing has never been what paces paper publicly, before the cutover
// or after it. What paces it is the REHYDRATE TICK — the office's read index.
// Nominally every fifteen minutes (deploy/postmark-office-rehydrate.timer,
// `*:07,22,37,52`); measured on the live box on 2026-08-25 at three hours and
// eighteen minutes behind the town tip. That gap is the whole latency a
// resident actually feels, and `written` is the rung that closes it: the office
// re-reads the file the pen wrote, from the same checkout the pen wrote it into,
// with the same parser the hydration uses.
//
// A compose built on the journal alone would have been byte-identical to the
// settled read on the live box today and for the whole flag-off era — a
// mechanism that can neither fail nor help. The journal half is still here and
// still correct, because it is what lights up on the day paper goes row-only;
// it is simply not what makes a resident's edit visible in minutes today.
//
// ── ONE READER, NEVER A SECOND RENDERER ────────────────────────────────────
//
// The VALUE always comes from the checkout, parsed by the same readers the
// hydration uses (vendor/tools/lib/town.mjs's `parseFrontmatter`, profiles.mjs,
// panes.mjs). It is never re-derived from a journal row's arguments. That is
// town-updates.mjs's own rule, kept: "There is no second renderer of an ADDRESS
// card here, so there is nothing that can drift from what the pen writes."
//
// The journal supplies the TENSE, not the text. Today a pending row and a
// written file always coincide, because the door writes both in one call — so
// the two rungs carry the same bytes and differ only in what the office admits
// about them. They would diverge the day a paper door becomes row-only, and on
// that day this module needs no new reader: the row is already the thing that
// says "not settled yet", and the checkout is already the thing that says what
// it says.
//
// ── THE STANDING GATE, and the law it appears to cross ─────────────────────
//
// A suspended handle gets NO overlay: their reads answer from the settled index
// and are stamped `settled`, truthfully, with the sha.
//
// standing.mjs opens with "READS ARE NEVER SUSPENDED", and this is not that.
// What is withheld is not a read — the record itself stays wholly readable, at
// the same sha, through this door and through the town repo, and a suspended
// resident keeps every page and every letter and above all the reason. What is
// withheld is the office's own COURTESY of publishing a claim ahead of the
// record. Under the dual-write shape there is nothing to withhold and the gate
// is a no-op; under a row-only paper door the overlay would be the sole
// publisher of a claim the audit has not seen, which is precisely what
// quarantine exists to hold. The gate is placed now, while it costs nothing,
// rather than remembered later, when it would be the whole point.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { parseFrontmatter } from "../vendor/tools/lib/town.mjs";
import { readProfile } from "./profiles.mjs";
import { readWindowState } from "./panes.mjs";
import { pendingPaperRows, PAPER_ACTS, SETTLES_AT } from "./town-updates.mjs";
import { standingOf, isSuspended } from "./standing.mjs";

/** The rungs, in order. Exported because the site's encoding names them. */
export const TENSE = Object.freeze({ settled: "settled", written: "written", pending: "pending" });
export const TENSES = Object.freeze(["settled", "written", "pending"]);
const rank = (t) => TENSES.indexOf(t);

/** What the three words mean, said once, in the answer that uses them. */
export const LADDER_NOTE =
  "settled = the record as the office last indexed it (settled_as_of); "
  + "written = the pen has committed it to the record since that index; "
  + "pending = an act in the town log the ferry has not settled yet";

// ── the live readers: one per paper file, each the hydration's own ──────────

/** ADDRESS.md as the checkout currently holds it: `{ data, body }` or null. */
export function readAddress(clone, handle) {
  try {
    const file = join(clone, "WHITE_PAGES", handle, "ADDRESS.md");
    if (!existsSync(file)) return null;
    return parseFrontmatter(readFileSync(file, "utf8"));
  } catch { return null; }
}

// The image set the atlas hydration derives, re-derived here from the same
// declared `assets:` line and by the same rule: the door lets the resident
// declare and the parser never infers (#865, Keemin 2026-07-29).
const IMAGE_RE = /\.(png|jpe?g|webp|gif|avif|svg)$/i;

/** HOME/HOME.md as the checkout currently holds it: `{ data, body, images }`. */
export function readHomeFile(clone, handle) {
  try {
    const file = join(clone, "WHITE_PAGES", handle, "HOME", "HOME.md");
    if (!existsSync(file)) return null;
    const { data, body } = parseFrontmatter(readFileSync(file, "utf8"));
    const declared = Array.isArray(data?.assets) ? data.assets : [];
    return { data, body, images: declared.map((a) => `WHITE_PAGES/${handle}/HOME/${a}`) };
  } catch { return null; }
}

/** The files under HOME/ that ARE images, for the card's `homeImages`. */
export function readHomeImages(clone, handle) {
  try {
    const dir = join(clone, "WHITE_PAGES", handle, "HOME");
    if (!existsSync(dir)) return [];
    return readdirSync(dir).filter((f) => IMAGE_RE.test(f))
      .map((f) => `WHITE_PAGES/${handle}/HOME/${f}`).sort();
  } catch { return []; }
}

// ── the ladder for one handle ───────────────────────────────────────────────

// Two values are "the same" when they serialize the same. Both sides come from
// the same parser walking the same file shape, so key order is stable and a
// string compare is a content compare — not a clever one, an honest one.
const same = (a, b) => {
  try { return JSON.stringify(a ?? null) === JSON.stringify(b ?? null); }
  catch { return false; }
};

/**
 * The context every composer needs, built once per read.
 *
 * GARNISH DISCIPLINE THROUGHOUT. No configured clone, an unreadable checkout, a
 * missing standing ledger, a town log that is not there: every one of them
 * answers "no overlay" and the read falls back to the settled index. This must
 * never be the reason a public read 500s — a freshness stamp is worth less than
 * the answer it decorates.
 */
export function freshnessFor(handle, { odb = null, clone = null, asOf = null } = {}) {
  const ctx = { handle, clone: null, asOf: asOf ?? null, suspended: false, pending: new Map() };
  if (!handle) return ctx;

  if (clone) {
    try { if (existsSync(join(clone, "WHITE_PAGES"))) ctx.clone = clone; }
    catch { /* garnish only */ }
  }

  // The gate, read live from the clone per call — the road standing.mjs takes
  // for exactly the reason it names: a Registrar commit lifting a quarantine
  // needs a pull, not an office restart.
  if (ctx.clone) {
    try { ctx.suspended = isSuspended(standingOf(handle, ctx.clone)); }
    catch { /* absent ledger is the ordinary case: nobody has ever been suspended */ }
  }
  if (ctx.suspended) { ctx.clone = null; return ctx; }

  // Newest-last, so a resident who edited twice is described by the second row.
  try {
    for (const row of pendingPaperRows(odb, handle)) ctx.pending.set(row.act, row);
  } catch { /* garnish only */ }

  return ctx;
}

/**
 * One field's stamp: which rung answered it, and the receipt for that rung.
 *
 * `act` is the paper act that would move this field, so a stamp names not only
 * what tense a reader is looking at but which door put it there.
 */
function stampFor(ctx, act, fresher) {
  const row = ctx.pending.get(act);
  if (row) {
    return { tense: TENSE.pending, act, seq: row.seq, written_at: row.writtenAt,
      file: PAPER_ACTS[act]?.file(ctx.handle) ?? null };
  }
  if (fresher) {
    return { tense: TENSE.written, act, file: PAPER_ACTS[act]?.file(ctx.handle) ?? null };
  }
  return { tense: TENSE.settled, act };
}

/**
 * The block that rides every composed read.
 *
 * COMPLETE, NOT INFERRED. Every composable field of the surface is listed with
 * its tense, including the settled ones — a block that named only the fresh
 * fields would make "settled" something a reader deduces from an absence, and
 * an absence is exactly what a stale field looks like. It is at most six rows.
 */
function freshnessBlock(ctx, fields) {
  const top = Object.values(fields).reduce(
    (hi, s) => (rank(s.tense) > rank(hi) ? s.tense : hi), TENSE.settled);
  const out = {
    tense: top,
    settled_as_of: ctx.asOf,
    fields,
    note: LADDER_NOTE,
  };
  if (top === TENSE.pending) out.settles_at = SETTLES_AT;
  return out;
}

// ── the composers: one per public paper surface ─────────────────────────────

/** The card's composable fields and the act that moves each — one source. */
const CARD_FIELD_ACTS = Object.freeze([
  ["address.body", "address-body"],
  ["address.data", "address-fields"],
  ["home", "home"],
  ["profile", "profile"],
  ["window_state", "window"],
]);

/**
 * The resident card, composed. Mutates and returns the card it was handed —
 * the same shape `resident()` already uses for the household and profile
 * garnishes it applies three lines above the call to this.
 *
 * COMPARE FIRST, THEN OVERLAY. Every `fresher` verdict below is taken against
 * the card as the INDEX handed it over, and only then is the field replaced.
 * Written the other way round — overlay, then compare — every comparison reads
 * the value it just wrote and every field is eternally `settled`: a stamp that
 * cannot say the one word it exists to say.
 */
export function composeResidentCard(card, ctx) {
  if (!card) return card;
  const fields = {};

  if (!ctx.clone) {
    // No overlay is possible, so every field is at the settled rung and the
    // block says so rather than being dropped. A read with no freshness block
    // and a read whose fields are all settled must not look alike: the first is
    // an office that cannot tell, the second is an office that checked.
    for (const [name, act] of CARD_FIELD_ACTS) fields[name] = stampFor(ctx, act, false);
    card.freshness = freshnessBlock(ctx, fields);
    return card;
  }

  const address = readAddress(ctx.clone, ctx.handle);
  const bodyFresher = address ? !same(address.body, card.address?.body) : false;
  const dataFresher = address ? !same(address.data, card.address?.data) : false;
  if (bodyFresher || dataFresher) {
    card.address = {
      ...(card.address ?? {}),
      ...(dataFresher ? { data: address.data } : {}),
      ...(bodyFresher ? { body: address.body } : {}),
    };
  }
  fields["address.body"] = stampFor(ctx, "address-body", bodyFresher);
  fields["address.data"] = stampFor(ctx, "address-fields", dataFresher);

  const home = readHomeFile(ctx.clone, ctx.handle);
  const images = readHomeImages(ctx.clone, ctx.handle);
  const homeFresher = home ? !same(home.body, card.home?.body) || !same(home.data, card.home?.data) : false;
  const imagesFresher = !same(images, (card.homeImages ?? []).slice().sort());
  if (homeFresher) card.home = { data: home.data, body: home.body };
  if (imagesFresher) card.homeImages = images;
  fields["home"] = stampFor(ctx, "home", homeFresher || imagesFresher);

  const profile = readProfile(ctx.clone, ctx.handle);
  const profileFresher = !same(profile, card.profile ?? null);
  if (profileFresher) card.profile = profile;
  fields["profile"] = stampFor(ctx, "profile", profileFresher);

  const state = readWindowState(ctx.clone, ctx.handle);
  const stateFresher = !same(state, card.window_state ?? null);
  if (stateFresher) card.window_state = state;
  fields["window_state"] = stampFor(ctx, "window", stateFresher);

  card.freshness = freshnessBlock(ctx, fields);
  return card;
}

/** The homes-table read, composed. */
export function composeHome(row, ctx) {
  if (!row) return row;
  let fresher = false;
  if (ctx.clone) {
    const home = readHomeFile(ctx.clone, ctx.handle);
    if (home) {
      const title = home.data?.title ?? ctx.handle;
      const description = home.body ?? "";
      const images = home.images;
      fresher = !same(title, row.title) || !same(description, row.description) || !same(images, row.images);
      if (fresher) { row.title = title; row.description = description; row.images = images; }
    }
  }
  row.freshness = freshnessBlock(ctx, { home: stampFor(ctx, "home", fresher) });
  return row;
}

/**
 * The window read, composed.
 *
 * THE FOUNDER'S RULING, 2026-08-25, and it is why there is no special case
 * here: a window's whole safety story is the door's validation on the way in
 * (self-contained, size-bounded, no key) and the iframe sandbox at render. The
 * crossing adds no regulatory value to a pane, so a pane is not held for one.
 * The only reason this composer exists at all is to say which tense the state
 * it hands back is in, exactly like the other two.
 */
export function composeWindow(answer, ctx) {
  if (!answer) return answer;
  let fresher = false;
  if (ctx.clone) {
    const state = readWindowState(ctx.clone, ctx.handle);
    fresher = !same(state, answer.window ?? null);
    if (fresher) answer.window = state;
  }
  answer.freshness = freshnessBlock(ctx, { window: stampFor(ctx, "window", fresher) });
  return answer;
}
