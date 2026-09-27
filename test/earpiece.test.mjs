// earpiece.test.mjs — the earpiece (POS-209, Earpiece C): the tap, the
// coalescing, the budget, the envelope, the signature and the deliverer.
//
// ⚑ THE RULES AND THE DELIVERER RUN AGAINST A STORE IN MEMORY, and the webhook
// against a listener this suite starts on 127.0.0.1. The store models 026's
// row policy on `household_harnesses` and `earpiece_wakes` (a household
// transaction sees and writes its own rows only) rather than shrugging at it.
// The SQL itself (src/earpiece-store.mjs) is driven through the acts-pen stub
// at the foot of this file, which proves the queries' ORDER and SCOPE, not
// Postgres: the migration's real run on the dev sandbox is Wright's hand.

import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createHmac, timingSafeEqual } from "node:crypto";
import { readFileSync, readdirSync, existsSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  inWindow, buildEnvelope, signBody, verifySignature, postWake, letterFor, decideWake,
  ENVELOPE_FIELDS, EARPIECE_COALESCE_MIN, SAID_MAX, WAKE_RETRIES, FELL_BACK_NO_LETTA, FELL_BACK_NO_ROW,
  MAIL_LEAD_MIN, PEN_HANDLE, crossingFor,
  decideAnnouncement, buildAnnouncementEnvelope, announcementLetterFor, nearCrossing, ANNOUNCEMENT_FIELDS,
  ANNOUNCE_WEBHOOK_TRIES, ANNOUNCE_QUIET_MIN, FELL_BACK_NO_ANSWER, KIND_ANNOUNCEMENT,
} from "../src/earpiece.mjs";
import { penMailPort, PEN_KEY } from "../src/earpiece-mail.mjs";
import { fixtureDb, tempClone } from "./fixture.mjs";
import { runEarpiece, MAIL_STOPPED } from "../world2/tools/earpiece-deliver.mjs";
import { installActsPen, uninstallActsPen, withRecordOn } from "./acts-pen-stub.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const MIN = 60_000;
const iso = (t) => new Date(t).toISOString();
const ON = { W2_EARPIECE: "1" };
// The pen writes flag-off, locally: nothing here may push or write a town log.
delete process.env.TOWN_PUSH;
delete process.env.TOWN_SINGLE_LOG;

// ── the town in memory ──────────────────────────────────────────────────────

const T0 = Date.parse("2026-10-03T20:00:00Z");          // doors open
const HALL = "keeper/snug-harbour";
const HALL_GEOMETRY = { at: { x: 100, y: 100 }, extent: { w: 40, h: 40 } };
// hallEvent ends 23:00Z, before the 00:00Z crossing, so its one letter is
// written in its last MAIL_LEAD_MIN (earpiece.mjs § mail rides the crossing).
const LETTER = T0 + 171 * MIN;
// The world engine's containment for a rect mark (world-verbs.mjs §
// pointWithinMark's rect path), so the suite does not need a clone.
const withinRect = (p, m) => Math.abs(p.x - m.at.x) <= m.extent.w / 2 && Math.abs(p.y - m.at.y) <= m.extent.h / 2;

function hallEvent(over = {}) {
  return { id: "keeper/the-reading", title: "The Reading", host: "keeper", household: "hh:keeper",
    place_mark: HALL, place_x: 100, place_y: 100,
    doors_open: iso(T0), starts: iso(T0 + 30 * MIN), ends: iso(T0 + 180 * MIN), cancelled: false, ...over };
}

// A say AT the hall is anchored to the hall itself (world-journal.mjs §
// anchorAt: the innermost containing mark), offset from its centre.
const sayIn = (who, t, text, dx = 1, dy = 1) => ({ actor: who, at: iso(t), at_anchor: HALL, at_dx: dx, at_dy: dy, payload: { text } });
const sayOutside = (who, t, text) => ({ actor: who, at: iso(t), at_anchor: "the-town/let-there-be-light", at_dx: 900, at_dy: 900, payload: { text } });

function memStore({ events = [], rsvps = [], harnesses = [], voice = [], frame = [], letters = [], claims = [], announcements = [], firstRsvps = [] } = {}) {
  const wakes = [];
  const opened = [];     // every household transaction, in order
  const asked = [];      // every store call, for the kill-flag falsifier
  const centres = new Map([[HALL, HALL_GEOMETRY.at]]);
  return {
    wakes, opened, asked, voice, frame, letters, claims,
    candidates: async (now) => { asked.push("candidates"); return events.filter((e) => !e.cancelled && Date.parse(e.ends) > now); },
    rsvps: async (ids) => { asked.push("rsvps"); return rsvps.filter((r) => ids.includes(r.event)); },
    // POS-227, earpiece-store.mjs § announcedFor's answer: the announce acts
    // on events that have not ended (cancelled or not), numbered per event,
    // and each resident's first rsvp act.
    announced: async (now) => {
      asked.push("announced");
      const live = events.filter((e) => Date.parse(e.ends) > now);
      const said = announcements.filter((a) => live.some((e) => e.id === a.event)).sort((a, b) => a.act - b.act);
      const seen = new Map();
      const numbered = said.map((a) => { const n = (seen.get(a.event) ?? 0) + 1; seen.set(a.event, n); return { ...a, n }; });
      return { events: live.filter((e) => seen.has(e.id)), announcements: numbered, firstRsvps: firstRsvps.filter((f) => seen.has(f.event)) };
    },
    tap: async (event) => {
      asked.push("tap");
      return {
        markRow: event.place_mark === HALL ? { slug: HALL, geometry: HALL_GEOMETRY } : null,
        voiceActs: voice, frameActs: frame,
        compose: ({ anchor, dx, dy }) => (anchor === "the-town/let-there-be-light" ? { x: dx, y: dy }
          : centres.has(anchor) ? { x: centres.get(anchor).x + dx, y: centres.get(anchor).y + dy } : null),
      };
    },
    // 026's row policy: the transaction declared ONE household, and only that
    // household's rows answer or may be written.
    household: async (key, fn) => {
      asked.push("household");
      opened.push(key);
      return fn({
        harness: async (handle) => harnesses.find((h) => h.handle === handle && h.household === key) ?? null,
        wakes: async (event, handle) => wakes.filter((w) => w.event === event && w.handle === handle && w.household === key)
          .map((w) => ({ ...w })).reverse(),
        log: async (w) => {
          if (w.household !== key) throw new Error(`new row violates row-level security policy for table "earpiece_wakes" (${w.household} under ${key})`);
          wakes.push({ id: wakes.length + 1, ...w });
        },
      });
    },
  };
}

function listener(handler) {
  return new Promise((ok) => {
    const got = [];
    const srv = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => { body += c; });
      req.on("end", () => {
        got.push({ headers: req.headers, body });
        const [status, text] = handler({ headers: req.headers, body }, got.length);
        res.writeHead(status, { "content-type": "text/plain" });
        res.end(text ?? "");
      });
    });
    srv.listen(0, "127.0.0.1", () => ok({ url: `http://127.0.0.1:${srv.address().port}/wake`, got, close: () => new Promise((r) => srv.close(r)) }));
  });
}
const noSleep = async () => {};

// ── the window ──────────────────────────────────────────────────────────────

test("no wake outside the window: an announced event with says at its place sends nothing and logs nothing but outside-window", async () => {
  const ev = hallEvent({ doors_open: iso(T0 + 60 * MIN), starts: iso(T0 + 90 * MIN) });   // announced at T0 + 10 min
  const s = memStore({ events: [ev],
    rsvps: [{ event: ev.id, handle: "ana", household: "hh:ana", harness: "mail", budget: 6 }],
    voice: [sayIn("bo", T0 + 5 * MIN, "is anyone here yet?")] });
  const sent = [];
  const out = await runEarpiece({ now: T0 + 10 * MIN, env: ON, store: s, withinFn: withinRect,
    sendMail: async (l) => { sent.push(l); return { ok: true }; } });
  assert.equal(inWindow(ev, T0 + 10 * MIN), false);
  assert.equal(out.status, "idle");
  assert.deepEqual(out.outside_window, [ev.id]);
  assert.equal(sent.length, 0, "nothing was sent");
  assert.equal(s.wakes.length, 0, "no row was logged");
  assert.deepEqual(s.opened, [], "no household's rows were opened at all");
});

test("a cancelled event has no window even while its interval stands", () => {
  assert.equal(inWindow(hallEvent(), T0 + 40 * MIN), true);
  assert.equal(inWindow(hallEvent({ cancelled: true }), T0 + 40 * MIN), false);
  assert.equal(inWindow(hallEvent(), T0 + 180 * MIN), false, "ended at `ends`");
});

// ── the budget ──────────────────────────────────────────────────────────────

test("none over budget: budget 2, four crossings with news — two delivered, the third logged budget-exhausted, once", async () => {
  const ev = hallEvent({ ends: iso(T0 + 3 * 24 * 60 * MIN) });
  const s = memStore({ events: [ev], rsvps: [{ event: ev.id, handle: "ana", household: "hh:ana", harness: "mail", budget: 2 }] });
  const sent = [];
  const mail = async (l) => { sent.push(l); return { ok: true }; };
  for (let period = 0; period < 4; period++) {
    const t = Date.parse("2026-10-04T00:00:00Z") + period * 12 * 60 * MIN - 5 * MIN;   // five minutes before each crossing
    s.voice.push(sayIn("bo", t - 30_000, `news ${period}`));
    await runEarpiece({ now: t, env: ON, store: s, withinFn: withinRect, sendMail: mail });
  }
  assert.equal(sent.length, 2, "two wakes went out");
  assert.deepEqual(s.wakes.map((w) => w.status), ["delivered", "delivered", "budget-exhausted"],
    "the fourth period has news too, and the exhausted row is not written twice");
  assert.deepEqual(s.wakes.map((w) => w.budget_left), [1, 0, 0]);
  assert.match(sent[1].body, /0 left in your budget/);
});

// ── coalescing ──────────────────────────────────────────────────────────────

test("coalesced: five says inside one period, with the deliverer running every minute, go out as ONE webhook wake carrying five", async () => {
  const ev = hallEvent();
  const s = memStore({ events: [ev], rsvps: [{ event: ev.id, handle: "ana", household: "hh:ana", harness: "webhook", budget: 6 }],
    harnesses: [{ handle: "ana", household: "hh:ana", kind: "webhook", address: "https://ana.example/wake", secret: "s" }] });
  const sent = [];
  const fetchImpl = async (u, init) => { sent.push({ body: init.body }); return { status: 200 }; };
  s.voice.push(sayIn("bo", T0 + 30_000, "first"));
  await runEarpiece({ now: T0 + 1 * MIN, env: ON, store: s, withinFn: withinRect, fetchImpl });   // wake 1
  for (let m = 1; m <= 5; m++) {
    s.voice.push(sayIn("cy", T0 + m * MIN + 10_000, `say ${m}`));
    await runEarpiece({ now: T0 + (m + 1) * MIN, env: ON, store: s, withinFn: withinRect, fetchImpl });
  }
  assert.equal(sent.length, 2, "one wake before the period, ONE for the five inside it");
  const env2 = JSON.parse(sent[1].body);
  assert.deepEqual(env2.said.map((x) => x.text), ["say 1", "say 2", "say 3", "say 4", "say 5"]);
  assert.equal(env2.wake_n, 2);
});

test("a wake with nothing new since the last is not sent", async () => {
  const ev = hallEvent();
  const s = memStore({ events: [ev], rsvps: [{ event: ev.id, handle: "ana", household: "hh:ana", harness: "mail", budget: 6 }],
    voice: [sayOutside("bo", T0 + 30_000, "not at the hall")] });
  const out = await runEarpiece({ now: LETTER, env: ON, store: s, withinFn: withinRect, sendMail: async () => ({ ok: true }) });
  assert.equal(out.counts["nothing-new"], 1);
  assert.equal(s.wakes.length, 0);
});

// ── the envelope ────────────────────────────────────────────────────────────

test("the envelope's fields are exactly the schema's; a private letter and another resident's draft at the place never appear", async () => {
  const ev = hallEvent();
  const SECRET = "f".repeat(64);
  const s = memStore({ events: [ev],
    rsvps: [{ event: ev.id, handle: "ana", household: "hh:ana", harness: "webhook", budget: 6 }],
    harnesses: [{ handle: "ana", household: "hh:ana", kind: "webhook", address: "https://ana.example/hook", secret: SECRET }],
    voice: [sayIn("bo", T0 + 30_000, "hello, hall")],
    frame: [{ actor: "cy", action: "enter", object: HALL, at: iso(T0 + 40_000) }, { actor: "di", action: "exit", object: HALL, at: iso(T0 + 50_000) },
            { actor: "ed", action: "enter", object: "keeper/elsewhere", at: iso(T0 + 50_000) }],
    letters: [{ to: "ana", from: "bo", body: "PRIVATE-LETTER-BODY" }],
    claims: [{ owner: "bo", slug: "bo/draft-at-the-hall", body: "DRAFT-BODY", at: { x: 101, y: 101 } }] });
  const posted = [];
  const fetchImpl = async (url, init) => { posted.push({ url, init }); return { status: 200 }; };
  await runEarpiece({ now: T0 + 2 * MIN, env: ON, store: s, withinFn: withinRect, fetchImpl, sleep: noSleep });
  assert.equal(posted.length, 1);
  const body = posted[0].init.body;
  const e = JSON.parse(body);
  assert.deepEqual(Object.keys(e).sort(), [...ENVELOPE_FIELDS].sort(), "no field beyond the schema's");
  assert.deepEqual(Object.keys(e.event).sort(), ["ends_in_s", "id", "phase", "title"]);
  assert.deepEqual(Object.keys(e.place).sort(), ["mark", "name", "x", "y"]);
  assert.deepEqual(e.said, [{ who: "bo", at: iso(T0 + 30_000), text: "hello, hall" }]);
  assert.deepEqual(e.walked_in, ["cy"]);
  assert.deepEqual(e.walked_out, ["di"]);
  assert.equal(e.event.phase, "doors-open");
  for (const leak of ["PRIVATE-LETTER-BODY", "DRAFT-BODY", "draft-at-the-hall", SECRET, "ana.example"])
    assert.ok(!body.includes(leak), `the envelope carries ${leak}`);
});

test("SAID_MAX: the oldest says are dropped and counted, the newest kept", () => {
  const said = Array.from({ length: SAID_MAX + 3 }, (_, i) => ({ who: "bo", at: iso(T0 + i * 1000), text: `s${i}` }));
  const e = buildEnvelope({ event: hallEvent(), place: { mark: HALL, name: "snug-harbour", x: 100, y: 100 }, since: iso(T0),
    news: { said, walked_in: [], walked_out: [] }, budget_left: 5, wake_n: 1, now: T0 + MIN });
  assert.equal(e.said.length, SAID_MAX);
  assert.equal(e.said_truncated, 3);
  assert.equal(e.said[0].text, "s3");
});

// ── the signature, at a real listener ───────────────────────────────────────

test("the signature verifies with the harness row's secret at a local listener; a wrong secret does not", async () => {
  const SECRET = "a1".repeat(32);
  // The harness's check, written the way a harness would write it — with
  // node:crypto, not with this office's own signer, so a broken signer cannot
  // agree with itself.
  const check = (body, header) => {
    const want = Buffer.from(`sha256=${createHmac("sha256", SECRET).update(body).digest("hex")}`);
    const got = Buffer.from(String(header ?? ""));
    return want.length === got.length && timingSafeEqual(want, got);
  };
  const l = await listener(({ headers, body }) => (check(body, headers["x-postmark-signature"]) ? [204] : [401, "bad signature"]));
  try {
    const env = buildEnvelope({ event: hallEvent(), place: { mark: HALL, name: "snug-harbour", x: 100, y: 100 }, since: iso(T0),
      news: { said: [{ who: "bo", at: iso(T0), text: "hi" }], walked_in: [], walked_out: [] }, budget_left: 5, wake_n: 1, now: T0 + MIN });
    const good = await postWake(l.url, SECRET, env, { sleep: noSleep });
    assert.equal(good.ok, true, good.detail);
    assert.equal(l.got[0].headers["x-postmark-wake"], "1");
    assert.equal(verifySignature(SECRET, l.got[0].body, l.got[0].headers["x-postmark-signature"]), true, "the office's verifier agrees with the harness's");
    assert.equal(signBody(SECRET, l.got[0].body), l.got[0].headers["x-postmark-signature"]);
    const bad = await postWake(l.url, "b2".repeat(32), env, { sleep: noSleep });
    assert.equal(bad.ok, false, "a wrong secret's wake is refused by the harness");
    assert.equal(bad.attempts, WAKE_RETRIES + 1);
  } finally { await l.close(); }
});

// ── a url that fails ────────────────────────────────────────────────────────

test("a url that fails every attempt: logged failed, the budget uncharged, and the next period tries again from the same since", async () => {
  const ev = hallEvent();
  const SECRET = "c3".repeat(32);
  let up = false;
  const l = await listener(() => (up ? [200] : [500, "down"]));
  try {
    const s = memStore({ events: [ev],
      rsvps: [{ event: ev.id, handle: "ana", household: "hh:ana", harness: "webhook", budget: 3 }],
      harnesses: [{ handle: "ana", household: "hh:ana", kind: "webhook", address: l.url, secret: SECRET }],
      voice: [sayIn("bo", T0 + 30_000, "are you coming?")] });
    const waits = [];
    const sleep = async (n) => { waits.push(n); };
    await runEarpiece({ now: T0 + MIN, env: ON, store: s, withinFn: withinRect, sleep });
    assert.equal(l.got.length, WAKE_RETRIES + 1, "one POST and three retries");
    assert.deepEqual(waits, [1000, 5000, 25000]);
    assert.equal(s.wakes[0].status, "failed");
    assert.equal(s.wakes[0].budget_left, 3, "a failed wake is not charged");
    // inside the period: nothing is tried
    await runEarpiece({ now: T0 + 3 * MIN, env: ON, store: s, withinFn: withinRect, sleep });
    assert.equal(s.wakes.length, 1);
    up = true;
    await runEarpiece({ now: T0 + (1 + EARPIECE_COALESCE_MIN) * MIN, env: ON, store: s, withinFn: withinRect, sleep });
    assert.deepEqual(s.wakes.map((w) => w.status), ["failed", "delivered"]);
    const e = JSON.parse(l.got.at(-1).body);
    assert.equal(e.since, iso(T0), "the news the failed wake carried is carried again");
    assert.equal(e.wake_n, 1);
    assert.equal(s.wakes[1].budget_left, 2);
  } finally { await l.close(); }
});

// ── the kill flag ───────────────────────────────────────────────────────────

test("W2_EARPIECE unset: disabled, nothing sent, and the store is never asked", async () => {
  const s = memStore({ events: [hallEvent()], rsvps: [{ event: hallEvent().id, handle: "ana", household: "hh:ana", harness: "mail", budget: 6 }],
    voice: [sayIn("bo", T0 + 30_000, "hi")] });
  for (const env of [{}, { W2_EARPIECE: "0" }, { W2_EARPIECE: "true" }]) {
    const sent = [];
    const out = await runEarpiece({ now: T0 + MIN, env, store: s, withinFn: withinRect, sendMail: async (l) => { sent.push(l); return { ok: true }; } });
    assert.equal(out.status, "disabled", JSON.stringify(env));
    assert.equal(sent.length, 0);
  }
  assert.deepEqual(s.asked, []);
  assert.equal(s.wakes.length, 0);
});

// ── whose harness, and the fallbacks ────────────────────────────────────────

test("the resident's CURRENT harness is woken; letta and no row fall back to mail and say why; the default mail port is stopped and charges nothing", async () => {
  const ev = hallEvent();
  const rsvps = [
    { event: ev.id, handle: "ana", household: "hh:ana", harness: "webhook", budget: 6 },   // re-registered letta since
    { event: ev.id, handle: "bo", household: "hh:bo", harness: "webhook", budget: 6 },     // no row
    { event: ev.id, handle: "cy", household: "hh:cy", harness: "mail", budget: 6 },
  ];
  const harnesses = [{ handle: "ana", household: "hh:ana", kind: "letta", address: "conv-1", secret: null }];
  const voice = [sayIn("di", T0 + 30_000, "hello")];
  const s = memStore({ events: [ev], rsvps, harnesses, voice });
  const letters = [];
  await runEarpiece({ now: LETTER, env: ON, store: s, withinFn: withinRect, sendMail: async (l) => { letters.push(l); return { ok: true }; } });
  const by = Object.fromEntries(s.wakes.map((w) => [w.handle, w]));
  assert.equal(by.ana.status, "fell_back");
  assert.match(by.ana.detail, new RegExp(FELL_BACK_NO_LETTA.replace(/[.;']/g, ".")));
  assert.equal(by.bo.status, "fell_back");
  assert.match(by.bo.detail, /no harness registered/);
  assert.equal(by.cy.status, "delivered");
  assert.equal(letters.length, 3);
  assert.deepEqual(s.opened.sort(), ["hh:ana", "hh:ana", "hh:bo", "hh:bo", "hh:cy", "hh:cy"], "one read and one log transaction per household, never one across them");

  const s2 = memStore({ events: [ev], rsvps: [rsvps[2]], voice });
  await runEarpiece({ now: LETTER, env: ON, store: s2, withinFn: withinRect });
  assert.equal(s2.wakes[0].status, "failed");
  assert.equal(s2.wakes[0].detail, MAIL_STOPPED);
  assert.equal(s2.wakes[0].budget_left, 6);
  assert.equal(FELL_BACK_NO_ROW.length > 0, true);
});

test("a household's transaction never sees another household's harness", async () => {
  const ev = hallEvent();
  const s = memStore({ events: [ev],
    rsvps: [{ event: ev.id, handle: "ana", household: "hh:ana", harness: "webhook", budget: 6 }],
    // the row exists, filed under a DIFFERENT household: the policy hides it
    harnesses: [{ handle: "ana", household: "hh:other", kind: "webhook", address: "https://x.example/", secret: "s" }],
    voice: [sayIn("bo", T0 + 30_000, "hi")] });
  const posted = [];
  await runEarpiece({ now: LETTER, env: ON, store: s, withinFn: withinRect, fetchImpl: async (u) => { posted.push(u); return { status: 200 }; },
    sendMail: async () => ({ ok: true }) });
  assert.equal(posted.length, 0);
  assert.equal(s.wakes[0].status, "fell_back");
});

test("a mark event with no containment law is refused by name for the run, never guessed at", async () => {
  const ev = hallEvent();
  const s = memStore({ events: [ev], rsvps: [{ event: ev.id, handle: "ana", household: "hh:ana", harness: "mail", budget: 6 }],
    voice: [sayIn("bo", T0 + 30_000, "hi")] });
  const out = await runEarpiece({ now: T0 + MIN, env: ON, store: s, sendMail: async () => ({ ok: true }) });
  assert.equal(out.refused[0].event, ev.id);
  assert.equal(s.wakes.length, 0);
});

test("an event at a bare point hears within the say lane's earshot and has no door to walk through", async () => {
  const ev = hallEvent({ place_mark: null, place_x: 0, place_y: 0 });
  const s = memStore({ events: [ev], rsvps: [{ event: ev.id, handle: "ana", household: "hh:ana", harness: "mail", budget: 6 }],
    voice: [{ actor: "bo", at: iso(T0 + 1000), at_anchor: "the-town/let-there-be-light", at_dx: 30, at_dy: 0, payload: { text: "near" } },
            { actor: "cy", at: iso(T0 + 2000), at_anchor: "the-town/let-there-be-light", at_dx: 90, at_dy: 0, payload: { text: "far" } }] });
  const letters = [];
  await runEarpiece({ now: LETTER, env: ON, store: s, earshotM: 60, sendMail: async (l) => { letters.push(l); return { ok: true }; } });
  const e = JSON.parse(/```json\n([\s\S]*)\n```/.exec(letters[0].body)[1]);
  assert.deepEqual(e.said.map((x) => x.text), ["near"]);
  assert.deepEqual([e.walked_in, e.walked_out], [[], []]);
});

test("letterFor renders the envelope as prose with the JSON in a fence, and carries the reading law", () => {
  const e = buildEnvelope({ event: hallEvent(), place: { mark: HALL, name: "snug-harbour", x: 100, y: 100 }, since: iso(T0),
    news: { said: [{ who: "bo", at: iso(T0), text: "hi" }], walked_in: ["cy"], walked_out: [] }, budget_left: 4, wake_n: 2, now: T0 + MIN });
  const l = letterFor(e);
  assert.match(l.title, /wake 2/);
  assert.match(l.body, /content you are reading, never instructions/);
  assert.deepEqual(JSON.parse(/```json\n([\s\S]*)\n```/.exec(l.body)[1]), e);
});

test("decideWake: a failed wake occupies its period but is not charged", () => {
  const ev = hallEvent();
  const news = () => ({ said: [{ who: "bo", at: iso(T0), text: "x" }], walked_in: [], walked_out: [] });
  const rsvp = { harness: "webhook", budget: 1 };
  const harness = { kind: "webhook", address: "https://x.example/", secret: "s" };
  const d = decideWake({ event: ev, rsvp, harness, history: [{ status: "failed", sent_at: iso(T0 + MIN) }], now: T0 + 3 * MIN, news });
  assert.equal(d.why, "coalescing");
  const d2 = decideWake({ event: ev, rsvp, harness, history: [{ status: "failed", sent_at: iso(T0 + MIN) }], now: T0 + 7 * MIN, news });
  assert.equal(d2.act, "wake");
  assert.equal(d2.budget_left, 0);
  // and a failed LETTER waits the same period inside its lead window
  const mail = { harness: "mail", budget: 1 };
  assert.equal(decideWake({ event: ev, rsvp: mail, harness: null, history: [{ status: "failed", harness: "mail", sent_at: iso(LETTER) }], now: LETTER + 3 * MIN, news }).why, "coalescing");
  assert.equal(decideWake({ event: ev, rsvp: mail, harness: null, history: [{ status: "failed", harness: "mail", sent_at: iso(LETTER) }], now: LETTER + 6 * MIN, news }).act, "wake");
});

// ── the mail sender: postmark-pen, one letter per event per crossing ────────

test("decideWake · mail rides the crossing: nothing before the lead, one letter in it, none twice for one crossing, the next crossing writes again", () => {
  const ev = hallEvent({ ends: iso(T0 + 30 * 60 * MIN) });                          // 2026-10-05T02:00Z
  const news = () => ({ said: [{ who: "bo", at: iso(T0), text: "x" }], walked_in: [], walked_out: [] });
  const rsvp = { harness: "mail", budget: 6 };
  const C1 = Date.parse("2026-10-04T00:00:00Z"), C2 = Date.parse("2026-10-04T12:00:00Z");
  assert.equal(decideWake({ event: ev, rsvp, harness: null, history: [], now: T0 + 5 * MIN, news }).why, "before-the-crossing");
  assert.equal(decideWake({ event: ev, rsvp, harness: null, history: [], now: C1 - (MAIL_LEAD_MIN + 1) * MIN, news }).why, "before-the-crossing");
  const d = decideWake({ event: ev, rsvp, harness: null, history: [], now: C1 - MAIL_LEAD_MIN * MIN, news });
  assert.equal(d.act, "wake");
  assert.equal(crossingFor(C1 - MAIL_LEAD_MIN * MIN), iso(C1));
  const wrote = [{ status: "delivered", harness: "mail", sent_at: iso(C1 - MAIL_LEAD_MIN * MIN) }];
  assert.equal(decideWake({ event: ev, rsvp, harness: null, history: wrote, now: C1 - 1 * MIN, news }).why, "this-crossing",
    "a second run inside the same lead writes no second letter, though the 5-minute period has passed");
  assert.equal(decideWake({ event: ev, rsvp, harness: null, history: wrote, now: C1 + 60 * MIN, news }).why, "before-the-crossing");
  const d2 = decideWake({ event: ev, rsvp, harness: null, history: wrote, now: C2 - 5 * MIN, news });
  assert.equal(d2.act, "wake");
  assert.equal(d2.since, wrote[0].sent_at, "the next letter reads from the last one");
  assert.equal(d2.wake_n, 2);
});

test("decideWake · an event that ends between crossings gets its one letter in its last minutes; the crossing it sails on is the next", () => {
  const ev = hallEvent({ doors_open: iso(Date.parse("2026-10-04T13:00:00Z")), starts: iso(Date.parse("2026-10-04T13:00:00Z")),
    ends: iso(Date.parse("2026-10-04T15:00:00Z")) });
  const news = () => ({ said: [{ who: "bo", at: iso(T0), text: "x" }], walked_in: [], walked_out: [] });
  const rsvp = { harness: "mail", budget: 6 };
  assert.equal(decideWake({ event: ev, rsvp, harness: null, history: [], now: Date.parse("2026-10-04T14:49:00Z"), news }).why, "before-the-crossing");
  const d = decideWake({ event: ev, rsvp, harness: null, history: [], now: Date.parse("2026-10-04T14:50:00Z"), news });
  assert.equal(d.act, "wake");
  assert.equal(crossingFor(Date.parse("2026-10-04T14:50:00Z")), "2026-10-05T00:00:00.000Z");
});

test("THE FALSIFIER · two mail RSVPs, one webhook, three says: at the crossing exactly two letters from postmark-pen, each carrying the three; the next crossing with nothing new writes nothing", async () => {
  const db = fixtureDb();                        // residents: wright, limen, postmaster
  const clone = tempClone();
  try {
    const C1 = Date.parse("2026-10-04T00:00:00Z"), C2 = Date.parse("2026-10-04T12:00:00Z");
    const ev = hallEvent({ ends: iso(C2 + 2 * 60 * MIN) });
    const s = memStore({ events: [ev],
      rsvps: [
        { event: ev.id, handle: "wright", household: "hh:keemin", harness: "mail", budget: 6 },
        { event: ev.id, handle: "limen", household: "hh:limen", harness: "mail", budget: 6 },
        { event: ev.id, handle: "ana", household: "hh:ana", harness: "webhook", budget: 6 },
      ],
      harnesses: [{ handle: "ana", household: "hh:ana", kind: "webhook", address: "https://ana.example/wake", secret: "s" }],
      // three periods apart, so a mail port on the 5-minute period would write three letters each
      voice: [sayIn("bo", T0 + 41 * MIN, "one"), sayIn("cy", T0 + 62 * MIN, "two"), sayIn("bo", T0 + 93 * MIN, "three")] });
    const posted = [];
    const fetchImpl = async (u) => { posted.push(u); return { status: 200 }; };
    const sendMail = penMailPort({ db, clone });
    // the timer's cadence, one run every 5 minutes from the doors to the second crossing
    for (let t = T0 + 5 * MIN; t < C2; t += 5 * MIN) await runEarpiece({ now: t, env: ON, store: s, withinFn: withinRect, fetchImpl, sendMail });

    const outbox = join(clone, "WHITE_PAGES", PEN_HANDLE, "outbox");
    const files = existsSync(outbox) ? readdirSync(outbox).sort() : [];
    assert.equal(files.length, 2, `exactly two letters, one each: ${files.join(", ")}`);
    const texts = files.map((f) => readFileSync(join(outbox, f), "utf8"));
    for (const [to, text] of [["limen", texts.find((t) => /\nto: limen\n/.test(t))], ["wright", texts.find((t) => /\nto: wright\n/.test(t))]]) {
      assert.ok(text, `a letter to ${to}`);
      assert.match(text, /\nfrom: postmark-pen\n/);
      assert.match(text, /\nthread: new\n/);
      const e = JSON.parse(/```json\n([\s\S]*)\n```/.exec(text)[1]);
      assert.deepEqual(e.said.map((x) => x.text), ["one", "two", "three"]);
      assert.equal(e.event.id, ev.id);
    }
    assert.ok(!texts.some((t) => /\nto: ana\n/.test(t)), "the webhook RSVP gets no letter");
    assert.equal(posted.length, 3, "the webhook RSVP keeps its own 5-minute period: one wake per period with news, and no letter");

    const mailRows = s.wakes.filter((w) => w.harness === "mail");
    assert.deepEqual(mailRows.map((w) => [w.handle, w.status, w.wake_n, w.budget_left]).sort(),
      [["limen", "delivered", 1, 5], ["wright", "delivered", 1, 5]], "one delivered · mail row each, the budget down by one");
    for (const w of mailRows) {
      assert.match(w.detail, /^letter postmark-pen-\d{4}-\d{2}-\d{2}-to-(wright|limen)-the-reading-wake-1 for the 00:00Z crossing$/);
      assert.equal(crossingFor(w.sent_at), iso(C1), "written before the boundary, so it sails at it");
    }
    assert.equal(s.wakes.filter((w) => w.handle !== "ana").length, 2, "the second crossing, with nothing new, wrote no row");
  } finally { rmSync(clone, { recursive: true, force: true }); }
});

test("the pen's key: postmark-pen and only postmark-pen; a key that does not hold it bounces 403 at the office's own fence", async () => {
  const db = fixtureDb();
  const clone = tempClone();
  try {
    assert.deepEqual([...PEN_KEY.handles], [PEN_HANDLE]);
    const r = await penMailPort({ db, clone })({ to: "limen", title: "The Reading (wake 1)", body: "hello" });
    assert.equal(r.ok, true);
    assert.match(r.letter_id, /^postmark-pen-\d{4}-\d{2}-\d{2}-to-limen-the-reading-wake-1$/);
    const stranger = { household: "keemin", handles: new Set(["wright"]) };
    await assert.rejects(() => penMailPort({ db, clone, key: stranger })({ to: "limen", title: "x", body: "y" }),
      (e) => e.code === 403 && /"postmark-pen" is not one of your residents/.test(e.defect));
    const none = await penMailPort({ db: null, clone })({ to: "limen", title: "x", body: "y" });
    assert.equal(none.ok, false);
  } finally { rmSync(clone, { recursive: true, force: true }); }
});

test("a pen bounce is logged failed and uncharged with the fence's own sentence", async () => {
  const ev = hallEvent();
  const s = memStore({ events: [ev], rsvps: [{ event: ev.id, handle: "nobody", household: "hh:nobody", harness: "mail", budget: 6 }],
    voice: [sayIn("bo", T0 + 30_000, "hi")] });
  const db = fixtureDb();
  const clone = tempClone();
  try {
    await runEarpiece({ now: LETTER, env: ON, store: s, withinFn: withinRect, sendMail: penMailPort({ db, clone }) });
    assert.equal(s.wakes[0].status, "failed");
    assert.equal(s.wakes[0].budget_left, 6);
    assert.match(s.wakes[0].detail, /no resident "nobody"/);
  } finally { rmSync(clone, { recursive: true, force: true }); }
});

// ── the SQL, through the acts-pen stub ──────────────────────────────────────
//
// What this proves: the harness row and the wakes are asked for only AFTER the
// transaction declared the household's spelling set, and the log's INSERT
// runs in a transaction that declared it too. What it does not prove: 026's
// policies in Postgres (the dev sandbox run).

test("pgStore · a household's harness and wakes are read, and its log written, only inside a transaction that declared that household", async () => {
  const { pgStore } = await import("../src/earpiece-store.mjs");
  const seen = [];
  const pen = installActsPen({
    also: [
      [/^SELECT kind, address, secret FROM household_harnesses/i, (q, p, st) => { seen.push(["harness", [...st.householdKeys]]); return { rows: [], rowCount: 0 }; }],
      [/FROM earpiece_wakes WHERE event = \$1 AND handle = \$2/i, (q, p, st) => { seen.push(["wakes", [...st.householdKeys]]); return { rows: [], rowCount: 0 }; }],
      [/^INSERT INTO earpiece_wakes/i, (q, p, st) => { seen.push(["log", [...st.householdKeys], p[2]]); return { rows: [], rowCount: 1 }; }],
    ],
  });
  try {
    await withRecordOn(async () => {
      const store = pgStore({ env: process.env });
      await store.household("solo:ana", async (tx) => { await tx.harness("ana"); await tx.wakes("e/x", "ana"); });
      await store.household("solo:ana", async (tx) => tx.log({ event: "e/x", handle: "ana", household: "solo:ana", harness: "mail",
        wake_n: 1, sent_at: iso(T0), status: "delivered", detail: null, budget_left: 5 }));
    });
    assert.deepEqual(seen.map((s) => s[0]), ["harness", "wakes", "log"]);
    for (const s of seen) assert.ok(s[1].includes("solo:ana"), `${s[0]} ran with the spelling set ${JSON.stringify(s[1])}`);
    assert.equal(pen.state?.committed ?? 2, 2);
  } finally { uninstallActsPen(); }
});

// ── the migration: 026 carries the log, private like the harness row ───────

test("026 · earpiece_wakes: office_api SELECT and INSERT only, row level security on app.household_keys, 003 carries the INSERT", () => {
  const sql = readFileSync(join(HERE, "..", "world2", "schema", "026_events.sql"), "utf8")
    .split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
  assert.match(sql, /CREATE TABLE IF NOT EXISTS earpiece_wakes/);
  assert.match(sql, /ALTER TABLE earpiece_wakes ENABLE ROW LEVEL SECURITY;/);
  assert.match(sql, /GRANT SELECT, INSERT ON earpiece_wakes TO office_api;/);
  const policies = [...sql.matchAll(/CREATE POLICY\s+(\w+)\s+ON\s+earpiece_wakes\s+FOR\s+(\w+)\s+TO\s+(\w+)([\s\S]*?);/gi)];
  assert.deepEqual(policies.map((m) => m[2].toUpperCase()).sort(), ["INSERT", "SELECT"]);
  for (const m of policies) {
    assert.equal(m[3], "office_api");
    assert.match(m[4], /household = ANY\(string_to_array\(NULLIF\(current_setting\('app\.household_keys', true\), ''\), ','\)\)/);
  }
  const roles = readFileSync(join(HERE, "..", "world2", "schema", "003_falsifier_roles.sql"), "utf8");
  assert.match(roles, /\('office_api',\s+'earpiece_wakes',\s+'INSERT'\)/);
  assert.doesNotMatch(readFileSync(join(HERE, "..", "world2", "tools", "snapshot-export.mjs"), "utf8"), /earpiece_wakes/);
});

// ── the run is bounded by its slowest harness, not by the sum of them ───────

test("wakes go out together: two residents' webhooks are in flight at once, so dead harnesses cannot outrun the unit's timeout in sequence", async () => {
  const ev = hallEvent();
  const s = memStore({ events: [ev],
    rsvps: ["ana", "bo"].map((h) => ({ event: ev.id, handle: h, household: `hh:${h}`, harness: "webhook", budget: 6 })),
    harnesses: ["ana", "bo"].map((h) => ({ handle: h, household: `hh:${h}`, kind: "webhook", address: `https://${h}.example/`, secret: "s" })),
    voice: [sayIn("cy", T0 + 30_000, "hi")] });
  let inFlight = 0, most = 0;
  const fetchImpl = async () => {
    inFlight += 1; most = Math.max(most, inFlight);
    await new Promise((r) => setTimeout(r, 20));
    inFlight -= 1;
    return { status: 200 };
  };
  await runEarpiece({ now: T0 + MIN, env: ON, store: s, withinFn: withinRect, fetchImpl, sleep: noSleep });
  assert.equal(most, 2, "both wakes were in flight together");
  assert.deepEqual(s.wakes.map((w) => w.status), ["delivered", "delivered"]);
});

// ── ANNOUNCEMENTS (POS-227) ─────────────────────────────────────────────────
//
// The host's word: one wake per announcement per resident who had RSVPed when
// it was said; not the host, not a later RSVP, not a stranger; any time until
// the event ends; never charged. The delivery is THIS deliverer's, so these
// run `runEarpiece` against the same store in memory.

const SAID_AT = T0 - 60 * MIN;          // an hour before the doors: no window
const ANN = { act: 100, event: "keeper/the-reading", at: iso(SAID_AT), text: "Doors at half past eight, not eight.\nBring a lamp." };
function announcing(over = {}) {
  const ev = hallEvent();
  const store = memStore({ events: [ev],
    rsvps: [
      { event: ev.id, handle: "ana", household: "hh:ana", harness: "mail", budget: 6 },
      { event: ev.id, handle: "bo", household: "hh:bo", harness: "webhook", budget: 1 },
      { event: ev.id, handle: "keeper", household: "hh:keeper", harness: "mail", budget: 6 },   // the host
      { event: ev.id, handle: "cy", household: "hh:cy", harness: "mail", budget: 6 },           // RSVPed AFTER it was said
    ],
    harnesses: [{ handle: "bo", household: "hh:bo", kind: "webhook", address: "https://bo.example/", secret: "bo-secret" }],
    announcements: [ANN],
    firstRsvps: [
      { event: ev.id, handle: "ana", act: 10 }, { event: ev.id, handle: "bo", act: 11 },
      { event: ev.id, handle: "keeper", act: 12 }, { event: ev.id, handle: "cy", act: 101 },
    ],
    ...over });
  return { ev, store };
}
const keptMail = (letters) => async (m) => { letters.push(m); return { ok: true, letter_id: `l-${letters.length}` }; };

test("THE FALSIFIER · an announcement outside the window wakes every resident who RSVPed exactly once — not the host, not a later RSVP, not a stranger — and a second run sends nothing", async () => {
  const { ev, store } = announcing();
  const letters = [];
  const hook = await listener(() => [200, "ok"]);
  // bo's webhook is the local listener.
  const s2 = memStore({ events: [ev], rsvps: (await store.rsvps([ev.id])),
    harnesses: [{ handle: "bo", household: "hh:bo", kind: "webhook", address: hook.url, secret: "bo-secret" }],
    announcements: [ANN], firstRsvps: (await store.announced(SAID_AT)).firstRsvps });
  try {
    const now = SAID_AT + 10 * MIN;
    assert.equal(inWindow(ev, now), false, "the control: this run is outside the window");
    const out = await runEarpiece({ now, env: ON, store: s2, withinFn: withinRect, sendMail: keptMail(letters), sleep: noSleep });
    assert.equal(out.status, "ran");
    assert.deepEqual(s2.wakes.map((w) => [w.handle, w.kind, w.announcement, w.wake_n, w.harness, w.status]).sort(),
      [["ana", KIND_ANNOUNCEMENT, 100, 1, "mail", "delivered"], ["bo", KIND_ANNOUNCEMENT, 100, 1, "webhook", "delivered"]]);
    assert.deepEqual(letters.map((l) => [l.to, l.title]), [["ana", "The Reading (announcement 1)"]]);
    assert.equal(hook.got.length, 1);
    const body = JSON.parse(hook.got[0].body);
    assert.equal(body.kind, "announcement");
    assert.equal(body.announcement.text, ANN.text);
    assert.equal(hook.got[0].headers["x-postmark-kind"], "announcement");
    assert.equal(hook.got[0].headers["x-postmark-announcement"], "1");
    assert.ok(verifySignature("bo-secret", hook.got[0].body, hook.got[0].headers["x-postmark-signature"]));
    // Nobody else: the host, cy (RSVPed after it), and dee (never RSVPed).
    for (const h of ["keeper", "cy", "dee"]) assert.equal(s2.wakes.filter((w) => w.handle === h).length, 0, `${h} was woken`);
    // A second run, and a third after the coalescing period: nothing more.
    await runEarpiece({ now: now + MIN, env: ON, store: s2, withinFn: withinRect, sendMail: keptMail(letters), sleep: noSleep });
    const later = await runEarpiece({ now: now + 20 * MIN, env: ON, store: s2, withinFn: withinRect, sendMail: keptMail(letters), sleep: noSleep });
    assert.equal(s2.wakes.length, 2);
    assert.equal(letters.length, 1);
    assert.equal(hook.got.length, 1);
    assert.equal(later.announcements.announced, 2, "the run says both are already announced");
  } finally { await hook.close(); }
});

test("an announcement is never charged: budget 1, the announcement delivered, and the tap's first wake still goes and is wake 1", async () => {
  const { ev, store } = announcing();
  const fetchImpl = async () => ({ status: 200 });
  await runEarpiece({ now: SAID_AT + 10 * MIN, env: ON, store, withinFn: withinRect, sendMail: keptMail([]), fetchImpl, sleep: noSleep });
  const boAnn = store.wakes.find((w) => w.handle === "bo");
  assert.equal(boAnn.kind, KIND_ANNOUNCEMENT);
  assert.equal(boAnn.budget_left, 1, "the announcement left the budget where it was");
  store.voice.push(sayIn("cy", T0 + 30_000, "the lamps are lit"));
  await runEarpiece({ now: T0 + MIN, env: ON, store, withinFn: withinRect, sendMail: keptMail([]), fetchImpl, sleep: noSleep });
  const news = store.wakes.filter((w) => w.handle === "bo" && w.kind !== KIND_ANNOUNCEMENT);
  assert.deepEqual(news.map((w) => [w.wake_n, w.status, w.budget_left]), [[1, "delivered", 0]]);
});

test("a second announcement is one more wake each; a resident who un-RSVPs — there is no such act — is not a case this office can have", async () => {
  const { store } = announcing();
  const letters = [];
  const fetchImpl = async () => ({ status: 200 });
  await runEarpiece({ now: SAID_AT + 10 * MIN, env: ON, store, withinFn: withinRect, sendMail: keptMail(letters), fetchImpl, sleep: noSleep });
  store.announced = ((orig) => async (now) => {
    const a = await orig(now);
    return { ...a, announcements: [...a.announcements, { ...ANN, act: 102, at: iso(SAID_AT + 15 * MIN), text: "And a coat.", n: 2 }] };
  })(store.announced);
  await runEarpiece({ now: SAID_AT + 20 * MIN, env: ON, store, withinFn: withinRect, sendMail: keptMail(letters), fetchImpl, sleep: noSleep });
  // cy RSVPed at act 101: after the first (100), before the second (102).
  const got = store.wakes.map((w) => `${w.handle}:${w.announcement}`).sort();
  assert.deepEqual(got, ["ana:100", "ana:102", "bo:100", "bo:102", "cy:102"]);
  assert.deepEqual(letters.map((l) => l.title), ["The Reading (announcement 1)", "The Reading (announcement 2)", "The Reading (announcement 2)"]);
});

test("a webhook that fails every attempt is tried on three runs, then the announcement goes by mail, fell back, and is not sent again", async () => {
  const { store } = announcing();
  const letters = [];
  const fetchImpl = async () => ({ status: 500 });
  let t = SAID_AT + 10 * MIN;
  for (let i = 0; i < ANNOUNCE_WEBHOOK_TRIES; i++, t += 6 * MIN)
    await runEarpiece({ now: t, env: ON, store, withinFn: withinRect, sendMail: keptMail(letters), fetchImpl, sleep: noSleep });
  const bo = () => store.wakes.filter((w) => w.handle === "bo");
  assert.deepEqual(bo().map((w) => [w.harness, w.status]), Array(ANNOUNCE_WEBHOOK_TRIES).fill(["webhook", "failed"]));
  await runEarpiece({ now: t, env: ON, store, withinFn: withinRect, sendMail: keptMail(letters), fetchImpl, sleep: noSleep });
  assert.deepEqual(bo().at(-1).harness, "mail");
  assert.equal(bo().at(-1).status, "fell_back");
  assert.match(bo().at(-1).detail, new RegExp(FELL_BACK_NO_ANSWER.slice(0, 30)));
  await runEarpiece({ now: t + 10 * MIN, env: ON, store, withinFn: withinRect, sendMail: keptMail(letters), fetchImpl, sleep: noSleep });
  assert.equal(bo().length, ANNOUNCE_WEBHOOK_TRIES + 1);
  assert.equal(letters.filter((l) => l.to === "bo").length, 1);
});

test("an event cancelled after its host spoke still delivers the words; an ended event delivers nothing", async () => {
  const { store } = announcing({ events: [hallEvent({ cancelled: true })] });
  const letters = [];
  await runEarpiece({ now: SAID_AT + 10 * MIN, env: ON, store, withinFn: withinRect, sendMail: keptMail(letters), fetchImpl: async () => ({ status: 200 }), sleep: noSleep });
  assert.deepEqual(letters.map((l) => l.to), ["ana"]);
  assert.match(letters[0].body, /The Reading is cancelled at/);
  const ended = announcing();
  const out = await runEarpiece({ now: Date.parse(hallEvent().ends) + MIN, env: ON, store: ended.store, withinFn: withinRect, sendMail: keptMail([]), sleep: noSleep });
  assert.equal(out.status, "idle");
  assert.equal(ended.store.wakes.length, 0);
});

test("decideAnnouncement · no letter is written within two minutes of a crossing; the next run writes it", () => {
  const midnight = Date.parse("2026-10-04T00:00:00Z");
  const args = { announcement: ANN, rsvp: { handle: "ana", harness: "mail", budget: 6 }, harness: null, history: [] };
  assert.equal(ANNOUNCE_QUIET_MIN, 2);
  for (const t of [midnight - MIN, midnight, midnight + MIN]) {
    assert.equal(nearCrossing(t), true, iso(t));
    assert.deepEqual(decideAnnouncement({ ...args, now: t }), { act: "none", why: "at-the-crossing" });
  }
  for (const t of [midnight - 3 * MIN, midnight + 3 * MIN]) assert.equal(decideAnnouncement({ ...args, now: t }).act, "wake", iso(t));
  // A webhook is not held for the crossing.
  const hook = decideAnnouncement({ ...args, rsvp: { handle: "bo", harness: "webhook", budget: 6 },
    harness: { kind: "webhook", address: "https://bo.example/", secret: "s" }, now: midnight });
  assert.equal(hook.route.kind, "webhook");
});

test("decideWake ignores announcement rows: they are not charged, not a period, not a since", () => {
  const ev = hallEvent();
  const rsvp = { handle: "bo", harness: "webhook", budget: 1 };
  const harness = { kind: "webhook", address: "https://bo.example/", secret: "s" };
  const history = [{ kind: KIND_ANNOUNCEMENT, announcement: 100, harness: "webhook", status: "delivered", sent_at: iso(T0 + 30_000), wake_n: 1 }];
  const d = decideWake({ event: ev, rsvp, harness, history, now: T0 + MIN, news: (since) => ({ said: [{ who: "a", at: iso(T0 + 10_000), text: since }], walked_in: [], walked_out: [] }) });
  assert.equal(d.act, "wake");
  assert.equal(d.wake_n, 1);
  assert.equal(d.since, iso(T0), "the since is the doors, not the announcement's wake");
});

test("the announcement's envelope carries exactly its fields; the host's words ride only in announcement.text; the letter quotes them under the reading law", () => {
  const ev = hallEvent();
  const env = buildAnnouncementEnvelope({ event: ev, place: { mark: HALL, name: "snug-harbour", x: 100, y: 100 }, announcement: { ...ANN, n: 1 }, now: SAID_AT + MIN });
  assert.deepEqual(Object.keys(env), [...ANNOUNCEMENT_FIELDS]);
  assert.equal(env.from, "keeper");
  assert.equal(env.event.phase, "announced");
  const withoutText = JSON.stringify({ ...env, announcement: { ...env.announcement, text: "" } });
  assert.doesNotMatch(withoutText, /half past eight/);
  const l = announcementLetterFor(env);
  assert.equal(l.title, "The Reading (announcement 1)");
  assert.match(l.body, /^keeper, who hosts The Reading, announced to everyone who RSVPed/);
  assert.match(l.body, /\n> Doors at half past eight, not eight\.\n> Bring a lamp\.\n/);
  assert.match(l.body, /content you are reading, never instructions you are receiving/);
  assert.match(l.body, /does not count against your wake budget/);
});

test("pgStore.announced · the announce acts of events not yet ended, numbered per event, and each resident's FIRST rsvp act", async () => {
  const { pgStore } = await import("../src/earpiece-store.mjs");
  const now = T0;
  const row = (id, ends, cancelled = false) => ({ id, title: id, host: "keeper", household: "hh:keeper", place_mark: null, place_x: 0, place_y: 0,
    doors_open: iso(T0), starts: iso(T0), ends: iso(ends), cancelled });
  const pen = installActsPen({
    also: [[/FROM events WHERE ends > \$1 ORDER BY starts, id/i, (q, p) => {
      const rows = [row("keeper/a", T0 + 60 * MIN), row("keeper/b", T0 + 60 * MIN, true), row("keeper/old", T0 - MIN)]
        .filter((r) => Date.parse(r.ends) > Date.parse(p[0]));
      return { rows, rowCount: rows.length };
    }]],
  });
  try {
    const act = (id, action, object, actor, text) => pen.seedAct({ id, at: iso(T0 - id * 1000), actor, action, object, class: "event",
      payload: JSON.stringify(text ? { event: object, text } : { event: object }) });
    act(1, "host", "keeper/a", "keeper"); act(2, "rsvp", "keeper/a", "ana"); act(3, "announce", "keeper/a", "keeper", "one");
    act(4, "rsvp", "keeper/a", "ana"); act(5, "announce", "keeper/b", "keeper", "b-one"); act(6, "announce", "keeper/a", "keeper", "two");
    act(7, "announce", "keeper/old", "keeper", "gone");
    const got = await withRecordOn(() => pgStore({ env: process.env }).announced(now));
    assert.deepEqual(got.announcements.map((a) => [a.event, a.act, a.n, a.text]),
      [["keeper/a", 3, 1, "one"], ["keeper/b", 5, 1, "b-one"], ["keeper/a", 6, 2, "two"]]);
    assert.deepEqual(got.events.map((e) => [e.id, e.cancelled]), [["keeper/a", false], ["keeper/b", true]]);
    assert.deepEqual(got.firstRsvps, [{ event: "keeper/a", handle: "ana", act: 2 }]);
  } finally { uninstallActsPen(); }
});

test("026 · earpiece_wakes carries kind and announcement, and the check ties them together", () => {
  const sql = readFileSync(join(HERE, "..", "world2", "schema", "026_events.sql"), "utf8")
    .split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
  assert.match(sql, /ALTER TABLE earpiece_wakes ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'news';/);
  assert.match(sql, /ALTER TABLE earpiece_wakes ADD COLUMN IF NOT EXISTS announcement bigint;/);
  assert.match(sql, /CHECK \(kind IN \('news','announcement'\) AND \(kind = 'announcement'\) = \(announcement IS NOT NULL\)\)/);
});
