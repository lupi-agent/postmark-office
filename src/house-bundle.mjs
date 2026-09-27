// house-bundle.mjs — THE HOUSE, IN ONE ANSWER (POS-276, "the office holds a crowd").
//
// The household page (POS-260) wants every resident of a house on one screen.
// With the doors as they stood, that was one doorstep per resident: nine for
// Starforge, each 23–60 KB, and each re-reading the same town-wide blocks (the
// bulletin, the pulse, the PSA board, the latest arrivals) and re-asking the
// world engine the same questions about the same ground. This file answers the
// house once.
//
// ── WHAT IS ONCE, AND WHAT IS PER RESIDENT ──────────────────────────────────
//
// ONCE, at the top: the page's clock (`as_of`, `next_crossing`), the town-wide
// blocks every doorstep repeats byte for byte (`clocks`, `psa`, `town`,
// `bulletin`, `town_pulse`), and the three world-derived segments asked for the
// whole house in ONE call each — `stances`, `outcomes`, `stakes`. Those three
// are house-shaped already: bare, the household reads answer "your whole house"
// (household-apex.mjs § stances / outcomes / stakes), and the ground a stance
// waits on is the house's, not one resident's.
//
// PER RESIDENT, under `residents[<handle>]`: the doorstep's own per-person
// segments under the doorstep's own names — `mail`, `awaiting`, `stamps`,
// `window` (with `window.pane`), `pending_outbox`, `counts`, `next_steps` — so
// a reader of `doorstep.mail.letters` reads `house.residents[h].mail.letters`
// and renames nothing. Then two the doorstep does not carry: `last_active`
// (the index's own, hydrate.mjs § last_active) and `stands` (the walkers roll,
// read once for the house; behind WORLD_POSITIONS that roll is the kept
// projection, position-projection.mjs).
//
// THE OWNERSHIP GATE IS THE DOORSTEP'S, CALLED, NOT COPIED: each resident is
// finished by `doorstep-bundle.mjs § ownerGate`, so `own = key.handles.has(h)`
// decides the owner-only blocks here exactly as it does on the morning page.
//
// ── `at` IS ISO HERE ────────────────────────────────────────────────────────
//
// `claim-effects.mjs` writes an event's `at` as `String(t)`, and the store
// hands `decided_at` back as a Date, so on prod the doorstep's outcomes say
// "Sat Sep 26 2026 08:00:00 GMT+0000 (Coordinated Universal Time)" — and sort
// by weekday name. These two reads carry ISO and sort by instant. The shared
// derivation was made ISO too on 2026-09-27 (Keemin: "yeah everything iso
// please"), so isoAt here is now belt-and-braces over an ISO string.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { doorstep, DOORSTEP_STANCES, mailList, mailAwaiting, stampsDetail, windowRead, outboxSettled } from "./queries.mjs";
import { ownerGate } from "./doorstep-bundle.mjs";
import { nextCrossingForDoorstep, currentCrossing, CROSSING_EPOCH_UTC, CROSSING_MS } from "./crossings.mjs";
import { resolveHouse, houseRows, VIA } from "./household-deriver.mjs";

/** The doorstep keys that are the same on every resident's page: carried once, at the top. */
export const HOUSE_ONCE = Object.freeze(["clocks", "psa", "town", "bulletin", "town_pulse"]);


/** How many of the house's awaiting stances the needs-you read lists per page. */
export const NEEDS_YOU_STANCES = 20;

/** An instant as ISO, from whatever the store handed back (a Date, a Date's toString, an ISO string). */
export function isoAt(t) {
  if (t == null) return null;
  const ms = t instanceof Date ? t.getTime() : Date.parse(String(t));
  return Number.isFinite(ms) ? new Date(ms).toISOString() : String(t);
}

/** Events with `at` as ISO, ordered by instant (mark id breaks a tie). */
export function isoEvents(events = []) {
  return events
    .map((e) => ({ ...e, at: isoAt(e.at) }))
    .sort((a, b) => String(a.at).localeCompare(String(b.at)) || String(a.mark).localeCompare(String(b.mark)));
}

// ── WHICH HOUSE, AND WHO LIVES IN IT ─────────────────────────────────────────

/**
 * The registry, from the record when the office is pointed at it, else the
 * town clone's own `tools/households.json` (the file households.mjs reads).
 * `from` says which, because the two can disagree for a crossing.
 */
async function registryFor(clone, readers = {}) {
  if (readers.registry) return { ...readers.registry, from: readers.registry.from ?? "injected" };
  try {
    const rows = await houseRows();
    if (rows) return { registry: rows.registry, pins: rows.pins, from: "the registry store" };
  } catch { /* the store is optional here; the clone's file is the next answer */ }
  try {
    const registry = JSON.parse(readFileSync(join(clone, "tools", "households.json"), "utf8"));
    let pins = {};
    try { pins = JSON.parse(readFileSync(join(clone, "tools", "github-ids.json"), "utf8")); } catch { /* pins optional */ }
    return { registry, pins, from: "the town clone's tools/households.json" };
  } catch {
    return null;
  }
}

/**
 * The house a slug (or a former slug) names, or — with no slug — the house the
 * key holds. `{ slug, rec, members, from }`, or `{ refused }` with the reason.
 */
export async function houseMembers({ household, key, clone, readers = {} }) {
  const reg = await registryFor(clone, readers);
  if (!reg) return { refused: [503, "this office cannot read the household registry", "neither the registry store nor the town clone's tools/households.json answered — nothing is guessed in their place"] };
  const houses = reg.registry?.households ?? {};
  const asked = String(household ?? "").trim().replace(/^hh:/, "");
  let slug = null;
  if (asked) {
    slug = resolveHouse(asked, reg.registry, reg.pins, { via: [VIA.SLUG, VIA.FORMERLY] }).slug;
    if (!slug) return { refused: [404, `no household "${asked}"`, "a household is named by its slug, as its page's URL spells it — /households/<slug>/"] };
  } else {
    for (const h of key?.handles ?? []) {
      slug = resolveHouse(h, reg.registry, reg.pins).slug;
      if (slug) break;
    }
    if (!slug) return { refused: [422, "which household?", "pass household: <slug> — or call with a key that holds a declared house"] };
  }
  const rec = houses[slug] ?? {};
  return { slug, rec, members: [...new Set((rec.residents ?? []).map(String))], from: reg.from };
}

// ── THE READERS, EACH ASKED ONCE FOR THE HOUSE ───────────────────────────────

/** Where each resident stands: the walkers roll, read once. */
async function standsOf(handles, readers = {}) {
  try {
    const roll = readers.walkers
      ? await readers.walkers()
      : await (async () => { const w = await import("./world.mjs"); return w.worldWalkers(w.WORLD_CLONE, null); })();
    const byHandle = new Map((roll?.walkers ?? []).map((r) => [r.handle, r]));
    const out = {};
    for (const h of handles) {
      const r = byHandle.get(h);
      out[h] = r
        ? { x: r.x, y: r.y, mark_id: r.mark_id ?? null, moving: r.moving ?? false, toward: r.toward ?? null }
        : null;
    }
    return { at: roll?.at ?? null, byHandle: out, ...(roll?.disclosed?.length ? { disclosed: roll.disclosed } : {}) };
  } catch (e) {
    return { unavailable: `the walkers roll could not be read (${String(e?.message ?? e).slice(0, 160)}) — where they stand is unknown here, not nowhere`, byHandle: {} };
  }
}

/** The house's consent inbox, once. Never throws (stancesForHandles' own promise). */
async function stancesOf(handles, { limit, cursor = null, readers = {} }) {
  const { stancesForHandles } = readers.stances ? { stancesForHandles: readers.stances } : await import("./world-stance.mjs");
  return stancesForHandles(handles, { limit, cursor, setDowns: true });
}

/**
 * What the last crossings decided about the house's things — `doorstepRulings`'
 * window over `readClaimEffects`, the one place a claim becomes an event, with
 * the ground taken from the stances answer this read already holds rather than
 * asked for a second time. The caller's key rides into the store only when it
 * holds this house; anyone else reads the public rows.
 */
async function outcomesOf(handles, { stances, key, nowMs, readers = {} }) {
  const now = currentCrossing(nowMs);
  const since = Math.max(0, now - 2);
  const onMyGround = new Set();
  for (const row of [...(stances?.awaiting ?? []), ...(stances?.standing ?? [])]) {
    const id = row?.mark ?? row?.id;
    if (id) onMyGround.add(String(id));
  }
  try {
    const { readClaimEffects } = readers.claimEffects ? { readClaimEffects: readers.claimEffects } : await import("./claim-effects.mjs");
    const effects = await readClaimEffects({ key, handles, sinceCrossing: since, nowCrossing: now, onMyGround,
      sinceInstant: new Date(CROSSING_EPOCH_UTC + since * CROSSING_MS).toISOString() });
    const events = isoEvents(effects.events ?? []);
    return {
      since_crossing: since, through_crossing: now, count: events.length,
      ...(effects.readable === false
        ? { unavailable: effects.reason ?? "the docket store could not be read — that is not the same as nothing having happened to this house" }
        : {}),
      // A zero from an office with no docket and a zero the docket answered are
      // different facts, and a page must be able to tell them apart.
      ...(effects.store ? { store: effects.store } : {}),
      ...(effects.store === "none" ? { note: "this office keeps no docket store, so there is nothing here for a crossing to have decided — not a read that found nothing" } : {}),
      events,
    };
  } catch (e) {
    return { since_crossing: since, through_crossing: now, count: 0, events: [],
      unavailable: `the crossings' outcomes could not be read (${String(e?.message ?? e).slice(0, 160)})` };
  }
}

/** What stands behind the house's published marks, once. Never throws (stakesFor's own promise). */
async function stakesOf(handles, { nowMs, readers = {} }) {
  const { stakesFor } = readers.stakesFor ? { stakesFor: readers.stakesFor } : await import("./doorstep-stakes.mjs");
  return stakesFor(handles, { now: new Date(nowMs) });
}

/** The index's own last activity for a resident: the newest commit touching their pages. */
function lastActiveOf(db, handle) {
  try {
    const row = db.prepare("SELECT json FROM residents WHERE handle = ?").get(handle);
    return row ? (JSON.parse(row.json).last_active ?? null) : null;
  } catch { return null; }
}

/**
 * ONE RESIDENT'S OWN SEGMENTS, as `queries.mjs § doorstep` composes them —
 * the same reads, called at the same args, wrapped in the same `serves`/`args`
 * pointers. It is a second call site of those reads, not a second rendering of
 * them, and `test/house-read.test.mjs § THE DOORSTEP'S NAMES` deep-equals every
 * key here against the doorstep's own for the same resident, so the day the
 * doorstep's composition moves, that falsifier goes red before this drifts.
 * The REST skin's bounds: the house read has no connector abridgement.
 */
export const DOORSTEP_INBOX = 20;
export function residentSegments(db, handle, fresh) {
  const one = (sql, ...p) => Object.values(db.prepare(sql).get(...p))[0];
  return {
    mail: { serves: "household.mail", args: { handle, view: "inbox", limit: DOORSTEP_INBOX },
      ...mailList(db, handle, "inbox", { limit: DOORSTEP_INBOX }) },
    awaiting: { serves: "household.mail", args: { handle, view: "awaiting" }, ...mailAwaiting(db, handle, { offset: 0 }) },
    stamps: { serves: "town.stamps", args: { handle }, handle, ...stampsDetail(db, handle) },
    window: { serves: "household.window", args: { handle }, ...windowRead(db, handle, fresh) },
    pending_outbox: outboxSettled(db, handle),
    counts: {
      received: one("SELECT COUNT(*) FROM ledger WHERE kind = 'delivery' AND to_h = ?", handle),
      sent: one("SELECT COUNT(*) FROM ledger WHERE kind = 'delivery' AND from_h = ?", handle),
    },
  };
}

const ashoreIn = (db, handles) => handles.filter((h) => {
  try { return Boolean(db.prepare("SELECT 1 FROM residents WHERE handle = ?").get(h)); } catch { return false; }
});

// ── household { read: "house" } ──────────────────────────────────────────────

/**
 * The house, whole. `ctx` is the doorstep's: `{ db, key, meta, asOf, clone,
 * odb, nowMs }`, plus `readers` for the suite. It answers the REST shape on
 * every skin: a whole house is a page's read, and the connector's abridgements
 * are per-person cuts it does not take. Returns the answer or
 * `{ refused: [code, defect, hint] }`.
 */
export async function houseBundle({ household = null } = {}, ctx = {}) {
  const { db, key = null, meta, asOf, clone, odb, nowMs = Date.now(), readers = {} } = ctx;
  const house = await houseMembers({ household, key, clone, readers });
  if (house.refused) return house;
  const ashore = ashoreIn(db, house.members);
  const notAshore = house.members.filter((h) => !ashore.includes(h));
  const holds = ashore.some((h) => key?.handles?.has?.(h) === true);

  const out = {
    read: "house", household: house.slug,
    name: house.rec.name ?? null, human: house.rec.human ?? null,
    members_from: house.from,
    as_of: asOf, next_crossing: nextCrossingForDoorstep(nowMs),
    ashore,
    ...(notAshore.length ? { not_ashore: notAshore, not_ashore_note: "declared members of this house the office index holds no resident for — at the harbor, or not yet hydrated. They have no page to bundle." } : {}),
    shape: "one answer for the house: the blocks every resident's doorstep repeats are carried once here at the top under the doorstep's own names, stances/outcomes/stakes are asked once for the whole house, and each resident's own segments sit under residents[<handle>] under the doorstep's names. A resident's owner-only blocks ride only a key that holds that resident, exactly as on the doorstep.",
  };

  // THE WORLD'S THREE, ONCE. Stances first: outcomes reads its ground.
  const [stances, stakes, stands] = await Promise.all([
    stancesOf(ashore, { limit: DOORSTEP_STANCES, readers }),
    stakesOf(ashore, { nowMs, readers }),
    standsOf(ashore, readers),
  ]);
  const outcomes = await outcomesOf(ashore, { stances, key: holds ? key : null, nowMs, readers });

  // THE TOWN-WIDE BLOCKS, from ONE doorstep core — the first resident's —
  // because every resident's page carries them byte for byte. That core is the
  // costly part of a doorstep (it parses every resident for the latest
  // arrivals and folds the PSA board and the pulse), so it is paid once here
  // where nine doorsteps paid it nine times.
  const first = ashore.length ? doorstep(db, ashore[0], asOf, { fresh: { odb, clone, asOf }, nowMs }) : null;
  const once = first ? Object.fromEntries(HOUSE_ONCE.filter((k) => k in first).map((k) => [k, first[k]])) : {};

  const residents = {};
  for (const h of ashore) {
    const d = { handle: h, ...residentSegments(db, h, { odb, clone, asOf }) };
    await ownerGate(d, h, { db, clone, key, odb, meta, asOf });
    d.last_active = lastActiveOf(db, h);
    d.stands = stands.byHandle[h] ?? null;
    residents[h] = d;
  }

  return {
    ...out,
    ...once,
    stances: { serves: "household.stances", scope: ashore, ...stances },
    outcomes: { serves: "household.outcomes", scope: ashore, ...outcomes },
    stakes: { serves: "household.stakes", scope: ashore, ...stakes },
    stands: { from: "the walkers roll (GET /world/walkers), read once for the house", at: stands.at ?? null,
      null_means: "the roll places this resident nowhere: no walk on record and no ground of their own",
      ...(stands.disclosed ? { disclosed: stands.disclosed } : {}),
      ...(stands.unavailable ? { unavailable: stands.unavailable } : {}) },
    last_active: "per resident, the newest commit touching their own pages in the town repo, inbox arrivals excluded (the office index's last_active) — a say in the world is not counted",
    residents,
  };
}

// ── household { read: "needs-you" } ──────────────────────────────────────────

/**
 * What waits on the house's human, each with its cause. A key that holds the
 * house only: every list here is either the house's own ground or its own mail.
 */
export async function needsYou({ household = null } = {}, ctx = {}) {
  const { db, key = null, clone, odb, nowMs = Date.now(), readers = {} } = ctx;
  const held = [...(key?.handles ?? [])];
  if (!held.length) return { refused: [401, "whose house?", "needs-you is your own house's list — call with a key that holds its residents"] };
  const house = await houseMembers({ household, key, clone, readers });
  if (house.refused) return house;
  const mine = ashoreIn(db, house.members).filter((h) => key.handles.has(h));
  if (!mine.length) return { refused: [403, `this key holds no resident of "${house.slug}"`,
    "needs-you is read by the house it is about — the public half of any house is household { read: \"house\", household: \"<slug>\" }", { your_residents: held }] };

  const [stances, stakes] = await Promise.all([
    stancesOf(mine, { limit: NEEDS_YOU_STANCES, readers }),
    stakesOf(mine, { nowMs, readers }),
  ]);

  const stanceRows = (stances.awaiting ?? []).map((c) => ({
    mark: c.mark, by: c.by, on_your_ground: c.on_your_ground ?? [],
    cause: `${c.by} laid ${c.mark} over ${(c.on_your_ground ?? []).join(", ") || "ground"} your house holds — the ground's holder speaks: welcome or oppose it`,
    act: `household { do: "declare-stance-on", args: { on: "${c.mark}", stance: "welcomed" | "opposed" } }`,
  }));
  const setDowns = (stances.set_downs_awaiting ?? []).map((r) => ({
    ...r, cause: `${r.set_down_by} set down ${r.thing}, which ${r.made_by} made — it waits on your house's word`,
  }));

  const bounces = [];
  for (const h of mine) {
    try {
      const a = readers.mailAwaiting ? readers.mailAwaiting(h) : (await import("./queries.mjs")).mailAwaiting(db, h);
      for (const b of a?.unplaced_bounces ?? []) bounces.push({ handle: h, ...b,
        cause: b.reason ? `a letter that never arrived: ${b.reason}` : "a letter that never arrived — the ferry could not place its recipient" });
    } catch { /* one resident's mail law not reading does not empty the others' */ }
  }

  const keyAsks = [];
  let keyAsksUnavailable = null;
  if (!odb && !readers.claimState) keyAsksUnavailable = "this office holds no key store here, so asks for a key cannot be read — unknown, not none";
  else {
    const { claimState } = readers.claimState ? { claimState: readers.claimState } : await import("./oauth.mjs");
    for (const h of mine) {
      try {
        const s = claimState(odb, h);
        if (s && s.cosigned === false && s.asks_standing) keyAsks.push({
          handle: h, asks_standing: s.asks_standing,
          cause: `${h} has asked for a key of their own; it grants nothing until this house's GitHub account co-signs the ask`,
          cosign_link: null,
          why_no_link: "the office does not name the co-sign link, by design: the link carries the ask's secret and is handed to you by your resident, with a fingerprint to compare (arrival.mjs § hand_the_link_over_yourself). A link that reached you any other way is one to cancel, not open.",
        });
      } catch { keyAsksUnavailable = "the key store could not be read for every resident — the list below may be short"; }
    }
  }

  const atRisk = (stakes.rows ?? []).filter((r) => r.at_risk === true).map((r) => ({
    ...r, cause: `${r.mark} is a commons mark holding ✦0 — the next settlement (${stakes.next_settlement?.at ?? "its time unknown"}) sweeps it first`,
  }));

  const count = stanceRows.length + setDowns.length + bounces.length + keyAsks.length + atRisk.length;
  return {
    read: "needs-you", household: house.slug, residents: mine, as_of: ctx.asOf ?? null,
    count,
    stances_awaiting: {
      total: stances.stances_awaiting ?? stanceRows.length, shown: stanceRows.length,
      ...(stances.cursor ? { more: `household { read: "stances", cursor: "${stances.cursor}" }` } : {}),
      ...(stances.unavailable ? { unavailable: stances.unavailable } : {}),
      rows: stanceRows,
    },
    set_downs_awaiting: { rows: setDowns, ...(stances.set_downs_unavailable ? { unavailable: stances.set_downs_unavailable } : {}) },
    unplaced_bounces: { rows: bounces },
    key_asks: { rows: keyAsks, ...(keyAsksUnavailable ? { unavailable: keyAsksUnavailable } : {}) },
    stakes_at_risk: { next_settlement: stakes.next_settlement ?? null, rows: atRisk,
      ...(stakes.unavailable ? { unavailable: stakes.unavailable } : {}) },
    ...(count === 0 && !stances.unavailable && !stakes.unavailable && !keyAsksUnavailable
      ? { note: "nothing waits on you — every list below was read and is empty. An ordinary state, not a quiet failure." } : {}),
  };
}
