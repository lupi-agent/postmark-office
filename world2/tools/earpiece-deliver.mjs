#!/usr/bin/env node
// earpiece-deliver.mjs — THE EARPIECE'S DELIVERER (POS-209, Earpiece C).
//
// A oneshot. The box's timer (deploy/postmark-earpiece.timer) runs it every
// minute; while no event's window is open it reads the calendar once, writes
// its stamp and exits 0. While one is open it wakes the residents who RSVPed,
// by the rules in src/earpiece.mjs, through the queries in
// src/earpiece-store.mjs. A mail wake is a letter from postmark-pen, one per
// event per crossing, written through the office's own send
// (src/earpiece-mail.mjs).
//
// A host's ANNOUNCEMENT (POS-227) is woken by this same run, window or no
// window: one wake per announcement per resident who was attending when it was
// said, never charged to the budget (earpiece.mjs § THE ANNOUNCEMENT). So a
// run is `idle` only when no window is open AND no announcement is owed.
//
// ── THE KILL FLAG ───────────────────────────────────────────────────────────
//
// `W2_EARPIECE=1` or it sends nothing. Unset, or anything else, and the run
// writes `status: "disabled"` on its stamp and exits 0 without opening a
// connection (the precedent is W2_FOLD in src/world-serve.mjs).
//
// ── WHAT IS LOGGED WHERE ────────────────────────────────────────────────────
//
// A wake that was attempted, and the one row that says a budget ran out, go in
// `earpiece_wakes` (026), the resident's own log behind household { read:
// "earpiece" }. What a RUN saw goes on the stamp file: `disabled`, `idle`, the
// events it found outside their window, the counts. Those are facts about the
// run, not about a resident, and a per-resident row every minute for every
// announced event would bury the log a resident reads.
//
// Usage: node world2/tools/earpiece-deliver.mjs --run [--state <file>] [--db <office.db>] [--oauth-db <oauth.db>]
// Env:   W2_EARPIECE=1 · WORLD2_PG_URL (the office's record) · WORLD_CLONE
//        (the world engine's containment law) · EARPIECE_STATE (the stamp file)
//        · TOWN_CLONE, TOWN_PUSH, TOWN_SINGLE_LOG (the pen's, as the office has them)
// Exit:  0 ran, idle or disabled · 1 the record could not be reached (the
//        stamp says so) · 2 usage.

import { writeFileSync, mkdirSync, realpathSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  earpieceEnabled, inWindow, placeOf, saysAt, walksAt, decideWake, buildEnvelope, postWake, letterFor, KILL_FLAG,
  crossingLabel, owedAnnouncement, decideAnnouncement, buildAnnouncementEnvelope, announcementLetterFor, KIND_ANNOUNCEMENT,
} from "../../src/earpiece.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");
export const STATE_DEFAULT = "/srv/postmark-earpiece/state.json";

// ── THE MAIL PORT ───────────────────────────────────────────────────────────
//
// The oneshot below hands `runEarpiece` postmark-pen's port
// (src/earpiece-mail.mjs § penMailPort), over the office's index and town
// clone. A caller that hands it NO port sends no mail: the wake is logged
// `failed` with this sentence and is not charged. The port is injected, so the
// rules and the log are proved without a clone.
export const MAIL_STOPPED = "no mail pen was handed to this run, so no letter was written";
export const mailStopped = async () => ({ ok: false, detail: MAIL_STOPPED });

const iso = (t) => new Date(t).toISOString();

/**
 * One run. Everything it touches is injected, so the suite drives it against a
 * store in memory and a listener on this machine.
 *
 *   store      { candidates(now), rsvps(ids), announced(now), tap(event, since, until), household(key, fn) }
 *   withinFn   the world engine's containment (world-verbs.mjs § pointWithinMark)
 *   earshotM   the say lane's earshot, for an event at a bare point
 */
export async function runEarpiece({ now = Date.now(), env = process.env, store, fetchImpl = globalThis.fetch,
  sendMail = mailStopped, sleep, withinFn = null, earshotM = null } = {}) {
  const at = iso(now);
  if (!earpieceEnabled(env)) return { at, status: "disabled", why: `${KILL_FLAG} is not 1 — nothing was read and nothing was sent` };

  const events = await store.candidates(now);
  const open = events.filter((e) => inWindow(e, now));
  const outside_window = events.filter((e) => !open.includes(e)).map((e) => e.id);
  const counts = { delivered: 0, failed: 0, fell_back: 0, "budget-exhausted": 0, coalescing: 0, "nothing-new": 0, "already-exhausted": 0,
    "before-the-crossing": 0, "this-crossing": 0 };
  const announcing = { delivered: 0, failed: 0, fell_back: 0, announced: 0, coalescing: 0, "at-the-crossing": 0 };
  const said = await store.announced(now);
  if (!open.length && !said.announcements.length) return { at, status: "idle", outside_window, counts };

  const byId = new Map(open.map((e) => [e.id, e]));
  const saidById = new Map(said.events.map((e) => [e.id, e]));
  const rsvps = await store.rsvps([...new Set([...open.map((e) => e.id), ...saidById.keys()])]);

  // The tap, read ONCE per event from its doors to now; each resident's
  // `since` is a filter over it.
  const taps = new Map();
  const refused = [];
  for (const e of open) {
    const t = await store.tap(e, e.doors_open ?? e.starts, at);
    const place = placeOf(e, t.markRow);
    if (place.mark && (!place.shape || typeof withinFn !== "function")) {
      refused.push({ event: e.id, why: !place.shape ? `the mark ${place.mark} has no geometry in the record` : "no containment law loaded from the world clone" });
      continue;
    }
    taps.set(e.id, { place, ...t });
  }
  const newsFor = (id) => (since) => {
    const t = taps.get(id);
    const said = saysAt(t.voiceActs, t.place, { since, until: at, compose: t.compose, withinFn, earshotM });
    return { said, ...walksAt(t.frameActs, t.place, { since, until: at }) };
  };

  // ONE HOUSEHOLD AT A TIME (earpiece-store.mjs § the header). A household's
  // list holds its tap RSVPs and the announcements its residents are owed.
  const houses = new Map();
  const add = (r, item) => {
    const key = r.household ?? `solo:${r.handle}`;
    houses.set(key, [...(houses.get(key) ?? []), item]);
  };
  for (const r of rsvps) if (taps.has(r.event)) add(r, { rsvp: r });
  const firstRsvp = new Map(said.firstRsvps.map((f) => [`${f.event} ${f.handle}`, f.act]));
  for (const a of said.announcements) {
    const event = saidById.get(a.event);
    for (const r of rsvps) {
      if (r.event !== a.event) continue;
      if (owedAnnouncement({ event, announcement: a, rsvp: r, firstRsvpAct: firstRsvp.get(`${r.event} ${r.handle}`) })) add(r, { rsvp: r, announcement: a });
    }
  }

  // PHASE 1 — each household's own rows, in its own transaction.
  const plans = [];
  for (const [key, list] of houses) {
    const got = await store.household(key, async (tx) => {
      const out = [];
      for (const { rsvp, announcement } of list) {
        const harness = rsvp.harness === "mail" ? null : await tx.harness(rsvp.handle);
        const history = await tx.wakes(rsvp.event, rsvp.handle);
        if (announcement) {
          out.push({ key, rsvp, announcement, event: saidById.get(rsvp.event),
            decision: decideAnnouncement({ announcement, rsvp, harness, history, now }) });
          continue;
        }
        const event = byId.get(rsvp.event);
        out.push({ key, rsvp, event, decision: decideWake({ event, rsvp, harness, history, now, news: newsFor(rsvp.event) }) });
      }
      return out;
    });
    plans.push(...got);
  }

  // PHASE 2 — every wake at once, with no transaction open. CONCURRENT ON
  // PURPOSE: a dead webhook costs four timeouts and 31 s of backoff, and one
  // resident after another, ten of them would outrun the unit's
  // TimeoutStartSec and be killed between sending and logging. Together, the
  // run is bounded by the slowest single harness (about 71 s).
  const deliver = async ({ key, rsvp, event, announcement, decision: d }) => {
    const base = { event: rsvp.event, handle: rsvp.handle, household: key, sent_at: at };
    if (announcement) return announce({ base, rsvp, event, announcement, d });
    if (d.act === "none") { counts[d.why === "budget-exhausted" ? "already-exhausted" : d.why] += 1; return null; }
    if (d.act === "exhausted") {
      counts["budget-exhausted"] += 1;
      return { ...base, harness: rsvp.harness, wake_n: Number(rsvp.budget), status: "budget-exhausted", budget_left: 0,
        detail: `the budget of ${rsvp.budget} is spent; nothing more is sent for this event` };
    }
    const envelope = buildEnvelope({ event, place: taps.get(rsvp.event).place, since: d.since, news: d.news,
      budget_left: d.budget_left, wake_n: d.wake_n, now });
    let status, detail;
    if (d.route.kind === "webhook") {
      const r = await postWake(d.route.url, d.route.secret, envelope, { fetchImpl, ...(sleep ? { sleep } : {}) });
      status = r.ok ? "delivered" : "failed";
      detail = r.detail;
    } else {
      const r = await Promise.resolve().then(() => sendMail({ to: rsvp.handle, ...letterFor(envelope) }))
        .catch((e) => ({ ok: false, detail: String(e?.message ?? e).slice(0, 200) }));
      status = r.ok ? (d.route.fell_back ? "fell_back" : "delivered") : "failed";
      const sent = r.ok ? `letter ${r.letter_id ?? "(no id)"} for the ${crossingLabel(now)} crossing` : null;
      detail = [d.route.fell_back ? `fell back to mail: ${d.route.fell_back}` : null, sent, r.detail ?? null].filter(Boolean).join(" — ") || null;
    }
    counts[status] += 1;
    return { ...base, harness: d.route.kind, wake_n: d.wake_n, status, detail,
      budget_left: status === "failed" ? d.budget_left + 1 : d.budget_left };
  };
  // An announcement's wake: its own envelope and letter, logged with its kind
  // and the act it carries, and never charged.
  const announce = async ({ base, rsvp, event, announcement, d }) => {
    if (d.act === "none") { announcing[d.why] += 1; return null; }
    const envelope = buildAnnouncementEnvelope({ event, place: placeOf(event), announcement, now });
    let status, detail;
    if (d.route.kind === "webhook") {
      const r = await postWake(d.route.url, d.route.secret, envelope, { fetchImpl, ...(sleep ? { sleep } : {}) });
      status = r.ok ? "delivered" : "failed";
      detail = r.detail;
    } else {
      const r = await Promise.resolve().then(() => sendMail({ to: rsvp.handle, ...announcementLetterFor(envelope) }))
        .catch((e) => ({ ok: false, detail: String(e?.message ?? e).slice(0, 200) }));
      status = r.ok ? (d.route.fell_back ? "fell_back" : "delivered") : "failed";
      const sent = r.ok ? `letter ${r.letter_id ?? "(no id)"} for the ${crossingLabel(now)} crossing` : null;
      detail = [d.route.fell_back ? `fell back to mail: ${d.route.fell_back}` : null, sent, r.detail ?? null].filter(Boolean).join(" — ") || null;
    }
    announcing[status] += 1;
    return { ...base, kind: KIND_ANNOUNCEMENT, announcement: announcement.act, harness: d.route.kind,
      wake_n: announcement.n, status, detail, budget_left: d.budget_left };
  };
  const rows = (await Promise.all(plans.map(deliver))).filter(Boolean);

  // PHASE 3 — each household's log lines, in its own transaction.
  for (const key of houses.keys()) {
    const mine = rows.filter((w) => w.household === key);
    if (mine.length) await store.household(key, async (tx) => { for (const w of mine) await tx.log(w); });
  }
  return { at, status: "ran", windows: open.map((e) => e.id), outside_window, ...(refused.length ? { refused } : {}), counts,
    announcements: announcing };
}

// ── the oneshot ─────────────────────────────────────────────────────────────

function writeState(path, body) {
  try { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, `${JSON.stringify(body, null, 2)}\n`); }
  catch (e) { console.error(`[earpiece] the stamp file refused a write (${String(e?.message ?? e).slice(0, 120)})`); }
}

async function main(argv) {
  if (!argv.includes("--run")) {
    console.error("usage: earpiece-deliver.mjs --run [--state <file>]   (the box's timer runs it every minute; W2_EARPIECE=1 or it sends nothing)");
    process.exit(2);
  }
  const i = argv.indexOf("--state");
  const state = i >= 0 ? argv[i + 1] : (process.env.EARPIECE_STATE ?? STATE_DEFAULT);
  if (!earpieceEnabled()) {
    const out = await runEarpiece({});
    writeState(state, out);
    console.log(JSON.stringify(out));
    process.exit(0);
  }
  const clone = process.env.WORLD_CLONE ?? join(ROOT, "world-clone");
  const verbs = await import(pathToFileURL(join(clone, "tools", "world-verbs.mjs"))).catch(() => null);
  const { EARSHOT_M } = await import("../../src/reach.mjs");
  const { pgStore } = await import("../../src/earpiece-store.mjs");
  // THE PEN's two databases, opened the way tools/town-drain-run.mjs opens
  // them: the office's index (the recipient check), and the town log only when
  // the office writes one (flag-on; the box is flag-off).
  const argOf = (n, d) => { const k = argv.indexOf(n); return k >= 0 ? argv[k + 1] : d; };
  const dbPath = resolve(argOf("--db", join(ROOT, "office.db")));
  const odbPath = resolve(argOf("--oauth-db", join(ROOT, "oauth.db")));
  const { DatabaseSync } = await import("node:sqlite");
  const { penMailPort } = await import("../../src/earpiece-mail.mjs");
  const { townLogEnabled } = await import("../../src/town-journal.mjs");
  const db = existsSync(dbPath) ? new DatabaseSync(dbPath) : null;
  const odb = townLogEnabled() && existsSync(odbPath) ? (await import("../../src/oauth.mjs")).openOauthDb(odbPath) : null;
  const townClone = process.env.TOWN_CLONE ?? join(ROOT, "town-clone");
  const sendMail = penMailPort({ db, clone: existsSync(townClone) ? townClone : null, odb });
  try {
    const out = await runEarpiece({ store: pgStore(), withinFn: verbs?.pointWithinMark ?? null, earshotM: EARSHOT_M, sendMail });
    writeState(state, out);
    console.log(JSON.stringify(out));
    process.exit(0);
  } catch (e) {
    // The record's own sentence, never the driver's message: a failing row
    // could carry a secret, and a stamp file is not a place for one.
    const out = { at: iso(Date.now()), status: "failed", why: "the office's record could not be reached mid-run — a wake sent before it failed may be missing from earpiece_wakes; the journal has this run" };
    writeState(state, out);
    console.error(`[earpiece] ${out.why}`);
    process.exit(1);
  }
}

// THE REALPATH COMPARE (await-clearing.mjs § isMain): a plain resolve() is
// defeated by a junction, and the cli-guard enters through one.
const isMain = (() => {
  try { return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return false; }
})();
if (isMain) main(process.argv.slice(2));
