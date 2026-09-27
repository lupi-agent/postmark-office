// events.test.mjs — the calendar (POS-207) and the RSVP's harness (POS-208).
//
// ⚑ THROUGH A JS STUB OF THE STORE. `acts-pen-stub.mjs` is a pen, not a
// Postgres, and the `events` / `event_rsvps` tables below are a Map each. This
// proves the JS: which rows the door writes, which it refuses, what the read
// answers. It proves NOTHING about 026_events.sql itself (its CHECKs, its
// grants, a real ON CONFLICT) — that is the migration's real run on the dev
// sandbox, which is Wright's hand before the merge.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { installActsPen, uninstallActsPen } from "./acts-pen-stub.mjs";
import {
  hostAtOffice, cancelAtOffice, rsvpAtOffice, calendarAtOffice, eventActs, announceAtOffice,
} from "../src/events-store.mjs";
import { phaseAt, judgeInterval, EVENT_MAX_DAYS, FELL_BACK_NO_ECHO, BUDGET_DEFAULT, SECRET_NOTE, ANNOUNCE_TEXT_MAX } from "../src/events.mjs";
import { compareRebuild, dryRun, NEVER_TOUCHED_LINE } from "../world2/tools/events-rebuild.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const H = 3_600_000;
const iso = (t) => new Date(t).toISOString();

// ── the two tables, in memory ───────────────────────────────────────────────

// `set_config(..., true)` is TRANSACTION-local in Postgres, and the pen stub
// keeps the last value it was given across transactions. So the harness row's
// policy reads the spelling set declared in THIS transaction only: the keys
// set after the last BEGIN the stub was asked, or none.
function txKeys(st) {
  const begin = st.asked.findLastIndex((q) => /^BEGIN/i.test(q));
  const declared = st.asked.slice(begin + 1).some((q) => /set_config\('app\.household_keys'/i.test(q));
  return declared ? st.householdKeys : [];
}

function eventTables() {
  const events = new Map();
  const rsvps = new Map();
  const harnesses = new Map();   // household_harnesses, by handle
  const EV = ["id", "title", "invitation", "host", "household", "place_mark", "place_x", "place_y",
    "doors_open", "starts", "ends", "revised", "cancelled", "hosted_act", "last_act"];
  const also = [
    [/^INSERT INTO events/i, (q, p) => {
      if (events.has(p[0])) throw new Error(`duplicate key value violates unique constraint "events_pkey"`);
      events.set(p[0], Object.fromEntries(EV.map((k, i) => [k, p[i]])));
      return { rows: [], rowCount: 1 };
    }],
    [/^UPDATE events SET/i, (q, p) => {
      const r = events.get(p[0]);
      Object.assign(r, { title: p[1], invitation: p[2], place_mark: p[3], place_x: p[4], place_y: p[5],
        doors_open: p[6], starts: p[7], ends: p[8], revised: p[9], cancelled: p[10], last_act: p[11] });
      return { rows: [], rowCount: 1 };
    }],
    [/FROM events WHERE id = \$1/i, (q, p) => {
      const r = events.get(p[0]);
      return { rows: r ? [{ ...r }] : [], rowCount: r ? 1 : 0 };
    }],
    [/FROM events WHERE id LIKE \$1/i, (q, p) => {
      const pre = String(p[0]).replace(/%$/, "");
      const rows = [...events.values()].filter((r) => r.id.startsWith(pre)).map((r) => ({ id: r.id, cancelled: r.cancelled, ends: r.ends }));
      return { rows, rowCount: rows.length };
    }],
    [/FROM events WHERE ends > \$1 ORDER BY starts, id/i, (q, p) => {
      const rows = [...events.values()].filter((r) => Date.parse(r.ends) > Date.parse(p[0]))
        .sort((a, b) => Date.parse(a.starts) - Date.parse(b.starts) || a.id.localeCompare(b.id)).map((r) => ({ ...r }));
      return { rows, rowCount: rows.length };
    }],
    [/^INSERT INTO event_rsvps/i, (q, p) => {
      if (/\baddress\b/i.test(q)) throw new Error("event_rsvps has no address column (026: it lives on household_harnesses)");
      const [event, handle, household, harness, budget, fell_back, act] = p;
      rsvps.set(`${event} ${handle}`, { event, handle, household, harness, budget, fell_back, act });
      return { rows: [], rowCount: 1 };
    }],
    // THE HARNESS ROW, with 026's row policy modelled rather than shrugged at:
    // a transaction that declared no spelling set containing the row's
    // household reads nothing and may write nothing — the same answer Postgres
    // gives `office_api` under household_harnesses_read / _insert / _update.
    [/^SELECT kind, address FROM household_harnesses WHERE handle = \$1$/i, (q, p, st) => {
      const r = harnesses.get(p[0]);
      const visible = r && txKeys(st).includes(r.household);
      return { rows: visible ? [{ kind: r.kind, address: r.address }] : [], rowCount: visible ? 1 : 0 };
    }],
    [/^INSERT INTO household_harnesses/i, (q, p, st) => {
      const [handle, household, kind, address, secret, registered_at] = p;
      if (!txKeys(st).includes(household))
        throw new Error('new row violates row-level security policy for table "household_harnesses"');
      if ((kind === "webhook") !== (secret != null)) throw new Error('violates check constraint "household_harnesses_secret"');
      const prev = harnesses.get(handle);
      if (prev && !txKeys(st).includes(prev.household))
        throw new Error('new row violates row-level security policy (USING expression) for table "household_harnesses"');
      harnesses.set(handle, prev
        ? { ...prev, household, kind, address, secret, rotated_at: registered_at }
        : { handle, household, kind, address, secret, registered_at, rotated_at: null });
      return { rows: [], rowCount: 1 };
    }],
    [/^SELECT \* FROM events ORDER BY id$/i, () => {
      const rows = [...events.values()].sort((a, b) => a.id.localeCompare(b.id)).map((r) => ({ ...r }));
      return { rows, rowCount: rows.length };
    }],
    [/^SELECT \* FROM event_rsvps ORDER BY event, handle$/i, () => {
      const rows = [...rsvps.values()].sort((a, b) => a.event.localeCompare(b.event) || a.handle.localeCompare(b.handle)).map((r) => ({ ...r }));
      return { rows, rowCount: rows.length };
    }],
    [/SELECT handle FROM event_rsvps WHERE event = \$1/i, (q, p) => {
      const rows = [...rsvps.values()].filter((r) => r.event === p[0]).map((r) => ({ handle: r.handle })).sort((a, b) => a.handle.localeCompare(b.handle));
      return { rows, rowCount: rows.length };
    }],
    [/FROM event_rsvps WHERE event = ANY\(\$1\)/i, (q, p) => {
      const rows = [...rsvps.values()].filter((r) => p[0].includes(r.event)).map((r) => ({ event: r.event, handle: r.handle }));
      return { rows, rowCount: rows.length };
    }],
  ];
  return { events, rsvps, harnesses, also };
}

const MARKS = [
  { slug: "current-the-reader/the-snug-harbour", status: "standing", kind: "sited", geometry: { at: { x: -350, y: 4978 }, extent: { w: 30, h: 22 } } },
  { slug: "wright/an-old-porch", status: "retired", kind: "sited", geometry: { at: { x: 5, y: 5 }, extent: { w: 2, h: 2 } } },
  { slug: "wright/a-pin", status: "standing", kind: "sited", geometry: { at: { x: 9, y: 9 }, extent: { w: 0, h: 0 } } },
  { slug: "wright/a-naming", status: "standing", kind: "naming", geometry: null },
];

function setup(opts = {}) {
  const t = eventTables();
  const pen = installActsPen({ marks: MARKS, also: t.also, ...opts });
  return { ...t, pen };
}

const WRIGHT = { household: "starforge", handles: new Set(["wright"]) };
const ERRANT = { household: "errant", handles: new Set(["errant"]) };

const at = (now) => ({ starts: iso(now + 1 * H), ends: iso(now + 3 * H) });
const HOST = (now, place = { mark: "current-the-reader/the-snug-harbour" }) =>
  ({ title: "The Snug Harbour Grand Opening", invitation: "Come down to the water.", place, ...at(now) });

async function refusedWith(p, code, re) {
  await assert.rejects(p, (e) => { assert.equal(e.code, code, `${e.code} ${e.defect}`); if (re) assert.match(e.defect, re); return true; });
}

test.afterEach(() => uninstallActsPen());

// ── THE FALSIFIER (the brief, in order) ─────────────────────────────────────

test("falsifier · a host act with a standing mark answers the id and the absolute point; the calendar moves it coming → now → ended by the office's clock", async () => {
  const { pen } = setup();
  const now = Date.now();
  const r = await hostAtOffice(HOST(now), WRIGHT);
  assert.equal(r.event.id, "wright/the-snug-harbour-grand-opening");
  assert.deepEqual(r.event.place, { mark: "current-the-reader/the-snug-harbour", name: "the-snug-harbour", x: -350, y: 4978 });
  assert.equal(pen.rows().length, 1);
  const act = pen.rows()[0];
  assert.equal(act.class, "event"); assert.equal(act.action, "host"); assert.equal(act.object, r.event.id);
  assert.equal(act.at_anchor, "current-the-reader/the-snug-harbour", "the act's anchor is the mark (an anchor and an offset, never a bare x,y)");
  assert.deepEqual([act.at_dx, act.at_dy], [0, 0]);

  const before = await calendarAtOffice({}, { now });
  assert.equal(before.coming.length, 1); assert.equal(before.coming[0].phase, "announced");
  assert.equal(before.now.length + before.ended.length, 0);

  const inside = await calendarAtOffice({}, { now: now + 2 * H });
  assert.equal(inside.now.length, 1); assert.equal(inside.now[0].phase, "underway");
  assert.equal(inside.now[0].starts_in_s, -3600); assert.equal(inside.now[0].ends_in_s, 3600);

  const after = await calendarAtOffice({}, { now: now + 4 * H });
  assert.equal(after.ended.length, 1); assert.equal(after.ended[0].phase, "ended");
  assert.equal(after.total, 1);
});

for (const [name, drop] of [["no place", "place"], ["no end", "ends"]]) {
  test(`falsifier · ${name}: refused by name, nothing written`, async () => {
    const { pen, events } = setup();
    const f = HOST(Date.now()); delete f[drop];
    await refusedWith(hostAtOffice(f, WRIGHT), 422, drop === "place" ? /needs a place/ : /needs an end/);
    assert.equal(pen.rows().length, 0, "an act was written for a refused host");
    assert.equal(events.size, 0);
  });
}

test("falsifier · a draft mark as the place is refused — and in the words a mark that does not exist gets, so no draft is confirmed to exist", async () => {
  const { pen } = setup();
  // A draft is a claim, never a `marks` row: the store has no row for it.
  await refusedWith(hostAtOffice(HOST(Date.now(), { mark: "wright/my-private-draft" }), WRIGHT), 422, /^no standing mark "wright\/my-private-draft"$/);
  assert.equal(pen.rows().length, 0);
});

test("refusals · a retired mark, a mark with no extent, a naming mark with no where — each by name, nothing written", async () => {
  const { pen } = setup();
  await refusedWith(hostAtOffice(HOST(Date.now(), { mark: "wright/an-old-porch" }), WRIGHT), 422, /is retired/);
  await refusedWith(hostAtOffice(HOST(Date.now(), { mark: "wright/a-pin" }), WRIGHT), 422, /has no extent/);
  await refusedWith(hostAtOffice(HOST(Date.now(), { mark: "wright/a-naming" }), WRIGHT), 422, /has no extent/);
  assert.equal(pen.rows().length, 0);
});

test("refusals · the interval: end before start, doors after start, already ended, longer than the dial, a time with no zone", async () => {
  const { pen } = setup();
  const now = Date.now();
  const base = HOST(now);
  await refusedWith(hostAtOffice({ ...base, ends: iso(now + 0.5 * H) }, WRIGHT), 422, /ends after it starts/);
  await refusedWith(hostAtOffice({ ...base, doors_open: iso(now + 2 * H) }, WRIGHT), 422, /doors open before the start/);
  await refusedWith(hostAtOffice({ ...base, starts: iso(now - 3 * H), ends: iso(now - 1 * H) }, WRIGHT), 422, /already ended/);
  await refusedWith(hostAtOffice({ ...base, ends: iso(now + (EVENT_MAX_DAYS * 24 + 2) * H) }, WRIGHT), 422, new RegExp(`at most ${EVENT_MAX_DAYS} days`));
  await refusedWith(hostAtOffice({ ...base, starts: "2026-09-26T22:00" }, WRIGHT), 422, /not an instant/);
  assert.equal(pen.rows().length, 0);
});

test("a point place: the payload keeps the absolute point, the act anchors to the world with the point as its offset", async () => {
  const { pen } = setup();
  const r = await hostAtOffice(HOST(Date.now(), { at: { x: 120, y: 64 } }), WRIGHT);
  assert.deepEqual(r.event.place, { mark: null, name: null, x: 120, y: 64 });
  const act = pen.rows()[0];
  assert.equal(act.at_anchor, "the-town/let-there-be-light");
  assert.deepEqual([act.at_dx, act.at_dy], [120, 64]);
  assert.deepEqual(JSON.parse(act.payload).place, { mark: null, x: 120, y: 64 });
});

// ── phase, at fixed clocks ──────────────────────────────────────────────────

test("phase · announced, doors-open, underway, ended, at the instants that divide them", () => {
  const e = { doors_open: "2026-09-26T21:30:00.000Z", starts: "2026-09-26T22:00:00.000Z", ends: "2026-09-27T02:00:00.000Z" };
  const t = (s) => Date.parse(s);
  assert.equal(phaseAt(e, t("2026-09-26T21:29:59Z")), "announced");
  assert.equal(phaseAt(e, t("2026-09-26T21:30:00Z")), "doors-open");
  assert.equal(phaseAt(e, t("2026-09-26T22:00:00Z")), "underway");
  assert.equal(phaseAt(e, t("2026-09-27T02:00:00Z")), "ended");
  // doors_open defaults to starts: announced straight to underway
  const d = judgeInterval({ starts: e.starts, ends: e.ends }, t("2026-09-26T00:00:00Z"));
  assert.equal(d.doors_open, e.starts);
});

// ── amend, cancel ───────────────────────────────────────────────────────────

test("amend · host with event: changes only what was sent, counts the revision, keeps every revision in the act log", async () => {
  const { pen } = setup();
  const now = Date.now();
  const { event } = await hostAtOffice(HOST(now), WRIGHT);
  const r = await hostAtOffice({ event: event.id, ends: iso(now + 4 * H) }, WRIGHT);
  assert.deepEqual(r.amended, ["ends"]);
  assert.equal(r.event.revised, 1);
  assert.equal(r.event.title, "The Snug Harbour Grand Opening");
  assert.deepEqual(pen.rows().map((a) => a.action), ["host", "amend-event"]);
  // someone else's event is not theirs to change
  await refusedWith(hostAtOffice({ event: event.id, title: "mine now" }, ERRANT), 403, /not yours to change/);
  assert.equal(pen.rows().length, 2);
});

test("cancel · stays on the calendar marked cancelled; its id is not reused — the same title mints -2", async () => {
  setup();
  const now = Date.now();
  const { event } = await hostAtOffice(HOST(now), WRIGHT);
  const c = await cancelAtOffice({ event: event.id }, WRIGHT);
  assert.equal(c.event.cancelled, true);
  const cal = await calendarAtOffice({}, { now });
  assert.equal(cal.coming[0].cancelled, true);
  const again = await hostAtOffice(HOST(now), WRIGHT);
  assert.equal(again.event.id, `${event.id}-2`);
  await refusedWith(rsvpAtOffice({ event: event.id }, ERRANT), 409, /was cancelled/);
});

test("a second host of a STANDING event's title is refused and pointed at the amendment", async () => {
  const { pen } = setup();
  const now = Date.now();
  await hostAtOffice(HOST(now), WRIGHT);
  await refusedWith(hostAtOffice(HOST(now), WRIGHT), 409, /already host/);
  assert.equal(pen.rows().length, 1);
});

// ── the RSVP (POS-208) ──────────────────────────────────────────────────────

const echoing = (seen) => async (url, init) => { seen.push({ url, body: JSON.parse(init.body) }); return { status: 200, text: async () => JSON.parse(init.body).nonce }; };
const silent = (seen) => async (url, init) => { seen.push({ url, body: JSON.parse(init.body) }); return { status: 200, text: async () => "ok" }; };

test("falsifier · a webhook that echoes lands as webhook; one that does not lands as mail and says so; both show the budget", async () => {
  const { rsvps, harnesses } = setup();
  const { event } = await hostAtOffice(HOST(Date.now()), WRIGHT);
  const seen = [];
  const ok = await rsvpAtOffice({ event: event.id, harness: { kind: "webhook", url: "https://hooks.example.org/postmark" }, budget: 9 }, ERRANT, { fetchImpl: echoing(seen) });
  assert.equal(ok.harness.kind, "webhook"); assert.equal(ok.harness.url, "https://hooks.example.org/postmark");
  assert.equal(ok.budget, 9); assert.equal(ok.fell_back, undefined);
  assert.equal(seen.length, 1, "the url is challenged exactly once"); assert.match(seen[0].body.nonce, /^[0-9a-f]{32}$/);

  const no = await rsvpAtOffice({ event: event.id, harness: { kind: "webhook", url: "https://hooks.example.org/deaf" } }, WRIGHT, { fetchImpl: silent([]) });
  assert.equal(no.harness.kind, "mail"); assert.equal(no.fell_back, FELL_BACK_NO_ECHO);
  assert.equal(no.budget, BUDGET_DEFAULT);
  // an unechoed URL is never registered: nothing a later wake could read
  assert.equal(harnesses.has("wright"), false);
  assert.equal(no.secret, undefined, "a webhook that did not echo is minted no secret");
  assert.equal(rsvps.get(`${event.id} wright`).harness, "mail");
});

test("rsvp · mail needs nothing; letta names its conversation; a budget past the dial and a private url are refused by name", async () => {
  const { pen } = setup();
  const { event } = await hostAtOffice(HOST(Date.now()), WRIGHT);
  const m = await rsvpAtOffice({ event: event.id }, ERRANT);
  assert.equal(m.harness.kind, "mail"); assert.equal(m.budget, 6);
  const l = await rsvpAtOffice({ event: event.id, harness: { kind: "letta", conversation: "conv-4f2a" } }, ERRANT);
  assert.deepEqual(l.harness, { kind: "letta", conversation: "conv-4f2a" });
  const n = pen.rows().length;
  await refusedWith(rsvpAtOffice({ event: event.id, budget: 61 }, ERRANT), 422, /1 to 60/);
  await refusedWith(rsvpAtOffice({ event: event.id, harness: { kind: "webhook", url: "https://127.0.0.1/x" } }, ERRANT), 422, /private address/);
  await refusedWith(rsvpAtOffice({ event: event.id, harness: { kind: "webhook", url: "http://hooks.example.org/x" } }, ERRANT), 422, /https/);
  await refusedWith(rsvpAtOffice({ event: event.id, harness: { kind: "mail", url: "https://x.example" } }, ERRANT), 422, /does not take: url/);
  assert.equal(pen.rows().length, n);
});

test("the act carries no address: a webhook url and a letta conversation never reach `acts` (the table the notary exports)", async () => {
  const { pen } = setup();
  const { event } = await hostAtOffice(HOST(Date.now()), WRIGHT);
  await rsvpAtOffice({ event: event.id, harness: { kind: "webhook", url: "https://hooks.example.org/secret-path" } }, ERRANT, { fetchImpl: echoing([]) });
  await rsvpAtOffice({ event: event.id, harness: { kind: "letta", conversation: "conv-private-77" } }, WRIGHT);
  const text = JSON.stringify(pen.rows());
  assert.doesNotMatch(text, /secret-path|conv-private-77/);
});

test("the public read carries no harness, url, conversation or budget — only who RSVPed", async () => {
  setup();
  const now = Date.now();
  const { event } = await hostAtOffice(HOST(now), WRIGHT);
  await rsvpAtOffice({ event: event.id, harness: { kind: "webhook", url: "https://hooks.example.org/secret-path" }, budget: 7 }, ERRANT, { fetchImpl: echoing([]) });
  await rsvpAtOffice({ event: event.id, harness: { kind: "letta", conversation: "conv-private-77" } }, WRIGHT);
  for (const read of [await calendarAtOffice({}, { now }), await calendarAtOffice({ event: event.id }, { now })]) {
    const text = JSON.stringify(read);
    assert.doesNotMatch(text, /secret-path|conv-private-77|harness|budget|webhook|letta/);
  }
  const one = await calendarAtOffice({ event: event.id }, { now });
  assert.deepEqual(one.event.rsvps, { total: 2, residents: ["errant", "wright"] });
});

test("the acting resident · handle names which of your residents acts; one resident is the default; several are asked for by name; another house's is refused", async () => {
  const { pen } = setup();
  const { event } = await hostAtOffice(HOST(Date.now()), WRIGHT);
  const TWO = { household: "errant", handles: new Set(["errant", "pica"]) };
  const n = pen.rows().length;
  await refusedWith(rsvpAtOffice({ event: event.id }, TWO), 422, /which of your residents/);
  await refusedWith(rsvpAtOffice({ event: event.id, handle: "wright" }, TWO), 403, /not one of your residents/);
  assert.equal(pen.rows().length, n, "a refused rsvp wrote nothing");
  const r = await rsvpAtOffice({ event: event.id, handle: "pica" }, TWO);
  assert.equal(r.handle, "pica");
  assert.equal(pen.rows().at(-1).actor, "pica");
  const { APEX_ONLY_FIELDS, householdApex } = await import("../src/household-apex.mjs");
  for (const a of ["host", "cancel-event", "rsvp"]) assert.ok(APEX_ONLY_FIELDS[a].properties.handle, `${a} declares handle`);
  // AT THE DOOR, not only at the store: household { do: "rsvp" } with a key
  // holding two residents and no handle is refused by name, and writes nothing.
  const door = await householdApex({ do: "rsvp", args: { event: event.id } }, TWO, {});
  assert.equal(door.code, 422); assert.equal(door.defect, "which of your residents?");
  const named = await householdApex({ do: "rsvp", args: { event: event.id, handle: "errant" } }, TWO, {});
  assert.equal(named.result?.handle, "errant", JSON.stringify(named).slice(0, 300));
  assert.equal(pen.rows().at(-1).actor, "errant");
});

// ── the harness row (POS-208, ruled 2026-09-25) ─────────────────────────────

const SECRET_A = "a".repeat(64);
const SECRET_B = "b".repeat(64);
const secrets = (...list) => () => list.shift();

test("falsifier · a webhook that echoes: the secret rides the receipt once, the harness row holds it, the act holds neither address nor secret; the same url again is not challenged and shows no secret", async () => {
  const { pen, harnesses, rsvps } = setup();
  const now = Date.now();
  const a = await hostAtOffice(HOST(now), WRIGHT);
  const b = await hostAtOffice({ ...HOST(now), title: "Reading by the lamp" }, WRIGHT);
  const URL_ = "https://hooks.example.org/errant-path";
  const seen = [];
  const mint = secrets(SECRET_A, SECRET_B);
  const first = await rsvpAtOffice({ event: a.event.id, harness: { kind: "webhook", url: URL_ } }, ERRANT, { fetchImpl: echoing(seen), mintSecret: mint });
  assert.equal(first.secret, SECRET_A);
  assert.equal(first.secret_note, SECRET_NOTE);
  assert.match(first.secret_note, /^shown once; not shown again/);
  assert.equal(seen.length, 1);
  const row = harnesses.get("errant");
  assert.deepEqual({ kind: row.kind, address: row.address, secret: row.secret, household: row.household, rotated_at: row.rotated_at },
    { kind: "webhook", address: URL_, secret: SECRET_A, household: "solo:errant", rotated_at: null });
  const rsvpAct = pen.rows().at(-1);
  assert.equal(rsvpAct.action, "rsvp");
  assert.deepEqual(JSON.parse(rsvpAct.payload), { event: a.event.id, harness: "webhook", budget: BUDGET_DEFAULT });
  assert.doesNotMatch(JSON.stringify(pen.rows()), new RegExp(`errant-path|${SECRET_A}`), "an act carries the url or the secret");
  assert.doesNotMatch(JSON.stringify([...rsvps.values()]), new RegExp(`errant-path|${SECRET_A}`), "event_rsvps carries the url or the secret");

  const again = await rsvpAtOffice({ event: b.event.id, harness: { kind: "webhook", url: URL_ } }, ERRANT, { fetchImpl: echoing(seen), mintSecret: mint });
  assert.equal(seen.length, 1, "the same url for the same resident was challenged a second time");
  assert.equal(again.secret, undefined, "a reused registration showed its secret again");
  assert.match(again.harness_note, /not challenged again/);
  assert.equal(again.harness.kind, "webhook");
  assert.equal(harnesses.get("errant").secret, SECRET_A, "the reuse re-minted");
  assert.doesNotMatch(JSON.stringify(again), new RegExp(SECRET_A));
});

test("rotation · a different url is challenged again and re-mints, stamping rotated_at; letta stores its conversation with no secret; mail stores nothing and leaves the row alone", async () => {
  const { harnesses } = setup();
  const now = Date.now();
  const { event } = await hostAtOffice(HOST(now), WRIGHT);
  const seen = [];
  const mint = secrets(SECRET_A, SECRET_B);
  await rsvpAtOffice({ event: event.id, harness: { kind: "webhook", url: "https://hooks.example.org/one" } }, ERRANT, { fetchImpl: echoing(seen), mintSecret: mint, now });
  const moved = await rsvpAtOffice({ event: event.id, harness: { kind: "webhook", url: "https://hooks.example.org/two" } }, ERRANT, { fetchImpl: echoing(seen), mintSecret: mint, now: now + 1000 });
  assert.equal(seen.length, 2); assert.equal(seen[1].url, "https://hooks.example.org/two");
  assert.equal(moved.secret, SECRET_B);
  const r = harnesses.get("errant");
  assert.equal(r.address, "https://hooks.example.org/two"); assert.equal(r.secret, SECRET_B);
  assert.equal(r.rotated_at, new Date(now + 1000).toISOString());

  // a different url that does NOT echo falls back to mail and leaves the registration as it was
  const deaf = await rsvpAtOffice({ event: event.id, harness: { kind: "webhook", url: "https://hooks.example.org/deaf" } }, ERRANT, { fetchImpl: silent([]), mintSecret: mint });
  assert.equal(deaf.fell_back, FELL_BACK_NO_ECHO); assert.equal(deaf.secret, undefined);
  assert.equal(harnesses.get("errant").address, "https://hooks.example.org/two");

  const mail = await rsvpAtOffice({ event: event.id }, ERRANT);
  assert.equal(mail.harness.kind, "mail");
  assert.equal(harnesses.get("errant").secret, SECRET_B, "a mail RSVP touched the harness row");

  const l = await rsvpAtOffice({ event: event.id, harness: { kind: "letta", conversation: "conv-4f2a" } }, WRIGHT);
  assert.equal(l.secret, undefined);
  assert.deepEqual((({ kind, address, secret }) => ({ kind, address, secret }))(harnesses.get("wright")), { kind: "letta", address: "conv-4f2a", secret: null });
  const m = await rsvpAtOffice({ event: event.id }, { household: "pica", handles: new Set(["pica"]) });
  assert.equal(m.harness.kind, "mail");
  assert.equal(harnesses.has("pica"), false, "a mail RSVP stored a harness row");
});

test("the row policy · the harness row is read and written only inside a transaction that declared the resident's household", async () => {
  const { pen, harnesses } = setup();
  const { event } = await hostAtOffice(HOST(Date.now()), WRIGHT);
  await rsvpAtOffice({ event: event.id, harness: { kind: "letta", conversation: "c-1" } }, ERRANT);
  // every query that named the table ran after solo:errant was declared
  const asked = pen.asked();
  const touches = asked.map((q, i) => [q, i]).filter(([q]) => /household_harnesses/.test(q));
  assert.equal(touches.length, 2, "one read and one upsert");
  for (const [q, i] of touches) {
    const begin = asked.slice(0, i).findLastIndex((x) => /^BEGIN/.test(x));
    const declared = asked.slice(begin + 1, i).some((x) => /set_config\('app\.household_keys'/.test(x));
    assert.ok(declared, `a harness query ran in a transaction that declared no spelling set: ${q.slice(0, 80)}`);
  }
  assert.deepEqual(pen.state.householdKeys, ["solo:errant"]);
  // another household's row is invisible to this one: seed one and read as errant
  harnesses.set("pica", { handle: "pica", household: "solo:pica", kind: "letta", address: "c-pica", secret: null, registered_at: "x", rotated_at: null });
  const again = await rsvpAtOffice({ event: event.id, handle: "errant", harness: { kind: "letta", conversation: "c-pica" } }, ERRANT);
  assert.equal(again.harness.conversation, "c-pica");
  assert.equal(harnesses.get("pica").address, "c-pica", "errant's write reached pica's row");
  assert.equal(harnesses.get("errant").address, "c-pica");
});

test("the secret never enters a log line or an error: a failing write after the mint answers the pen's fixed sentence", async () => {
  const { pen } = setup({ failOn: (q) => /^INSERT INTO event_rsvps/i.test(q) });
  const { event } = await hostAtOffice(HOST(Date.now()), WRIGHT);
  const lines = [];
  const keep = { log: console.log, error: console.error, warn: console.warn, info: console.info };
  for (const k of Object.keys(keep)) console[k] = (...a) => { lines.push(a.map(String).join(" ")); };
  let err;
  try {
    await rsvpAtOffice({ event: event.id, harness: { kind: "webhook", url: "https://hooks.example.org/x" } }, ERRANT, { fetchImpl: echoing([]), mintSecret: () => SECRET_A })
      .catch((e) => { err = e; });
    await rsvpAtOffice({ event: event.id, harness: { kind: "webhook", url: "https://hooks.example.org/y" } }, WRIGHT, { fetchImpl: echoing([]), mintSecret: () => SECRET_B }).catch((e) => e);
  } finally { Object.assign(console, keep); }
  assert.equal(err?.code, 503);
  assert.match(err.defect, /nothing was written, and nothing was lost/);
  const text = JSON.stringify({ defect: err.defect, hint: err.hint, message: err.message, stack: err.stack, keys: Object.entries(err) }) + lines.join("\n");
  assert.doesNotMatch(text, new RegExp(`${SECRET_A}|${SECRET_B}`));
  assert.ok(pen.state.rolledBack >= 1, "the failing write was not rolled back");
});

// ── the rebuild ─────────────────────────────────────────────────────────────

test("rebuild · the tables equal what the act log alone derives — and a hand-edited row is caught", async () => {
  const { pen, events, rsvps } = setup();
  const now = Date.now();
  const a = await hostAtOffice(HOST(now), WRIGHT);
  await hostAtOffice({ event: a.event.id, title: "The Snug Harbour, opened" }, WRIGHT);
  const b = await hostAtOffice({ ...HOST(now, { at: { x: 1, y: 2 } }), title: "Reading by the lamp" }, WRIGHT);
  await cancelAtOffice({ event: b.event.id }, WRIGHT);
  await rsvpAtOffice({ event: a.event.id, harness: { kind: "letta", conversation: "c1" } }, ERRANT);
  await rsvpAtOffice({ event: a.event.id, budget: 3 }, ERRANT);   // a second RSVP replaces the first
  const acts = await eventActs(pen);
  assert.equal(acts.length, 6);
  const stored = () => ({ events: [...events.values()], rsvps: [...rsvps.values()] });
  const ok = compareRebuild(stored(), acts);
  assert.deepEqual(ok.drift, []); assert.equal(ok.equal, true);
  assert.deepEqual(ok.counts, { acts: 6, events: 2, event_rsvps: 1 });
  events.get(a.event.id).title = "edited by hand";
  const bad = compareRebuild(stored(), acts);
  assert.equal(bad.equal, false);
  assert.match(bad.drift[0], /title: stored "edited by hand"/);
});

// 026's own column lists, read from the migration, so a column added there and
// not compared here reds rather than passing as "equal".
function columnsOf(table) {
  const sql = readFileSync(join(HERE, "..", "world2", "schema", "026_events.sql"), "utf8").replace(/\r\n/g, "\n");
  const body = new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\(([\\s\\S]*?)\\n\\);`).exec(sql)[1];
  return body.split("\n").map((l) => l.trim()).filter((l) => /^[a-z_]+\s/.test(l) && !/^(CONSTRAINT|PRIMARY)\b/i.test(l)).map((l) => l.split(/\s+/)[0]);
}

test("rebuild · restores and compares EVERY column of events and event_rsvps — a hand edit to any one of them is caught", async () => {
  const { pen, events, rsvps } = setup();
  const now = Date.now();
  const a = await hostAtOffice(HOST(now), WRIGHT);
  await rsvpAtOffice({ event: a.event.id, harness: { kind: "webhook", url: "https://hooks.example.org/z" } }, ERRANT, { fetchImpl: echoing([]) });
  const acts = await eventActs(pen);
  const evCols = columnsOf("events"), rsCols = columnsOf("event_rsvps");
  assert.ok(evCols.length >= 15 && rsCols.length >= 7, `${evCols} / ${rsCols}`);
  assert.ok(!rsCols.includes("address"), "event_rsvps still has an address column");
  const fresh = () => ({ events: [...events.values()].map((r) => ({ ...r })), rsvps: [...rsvps.values()].map((r) => ({ ...r })) });
  assert.equal(compareRebuild(fresh(), acts).equal, true);
  for (const [table, cols, key] of [["events", evCols, "events"], ["event_rsvps", rsCols, "rsvps"]]) {
    for (const c of cols) {
      const s = fresh();
      const r = s[key][0];
      r[c] = /^(doors_open|starts|ends)$/.test(c) ? new Date(Date.parse(r[c]) + 12345).toISOString()
        : typeof r[c] === "number" ? r[c] + 7 : typeof r[c] === "boolean" ? !r[c] : `${r[c]}-edited`;
      const out = compareRebuild(s, acts);
      assert.equal(out.equal, false, `${table}.${c} was edited and the rebuild called it equal`);
    }
  }
});

test("rebuild · the dry run asks the store for the event acts and the two tables, and never for household_harnesses; its receipt says so", async () => {
  const { pen } = setup();
  const now = Date.now();
  const a = await hostAtOffice(HOST(now), WRIGHT);
  await rsvpAtOffice({ event: a.event.id, harness: { kind: "webhook", url: "https://hooks.example.org/q" } }, ERRANT, { fetchImpl: echoing([]) });
  const before = pen.asked().length;
  const out = await dryRun(pen);
  const asked = pen.asked().slice(before);
  assert.equal(out.equal, true, out.drift.join("; "));
  assert.deepEqual(out.never_touched, ["household_harnesses"]);
  assert.match(NEVER_TOUCHED_LINE, /never read or touched: household_harnesses/);
  assert.ok(asked.some((q) => /FROM event_rsvps/.test(q)) && asked.some((q) => /FROM events/.test(q)) && asked.some((q) => /FROM acts/.test(q)), asked.join(" | "));
  assert.deepEqual(asked.filter((q) => /household_harnesses/i.test(q)), []);
});

// ── the doors ───────────────────────────────────────────────────────────────

test("the household door dispatches host/cancel-event/rsvp and refuses in its own grammar; the town door lists calendar", async () => {
  const { HOUSEHOLD_DISPATCHABLE, APEX_ONLY_FIELDS } = await import("../src/household-apex.mjs");
  const { TOWN_READS } = await import("../src/town-apex.mjs");
  for (const a of ["host", "cancel-event", "rsvp"]) {
    assert.ok(HOUSEHOLD_DISPATCHABLE.includes(a), a);
    assert.ok(APEX_ONLY_FIELDS[a], `${a} declares its fields`);
  }
  assert.equal(TOWN_READS.calendar.tool, "read_calendar");
  const { judgeActFields } = await import("../src/one-contract.mjs");
  const j = judgeActFields({ tool: "host", declared: APEX_ONLY_FIELDS.host.properties, fields: { title: "x", zz_probe: 1 } });
  assert.equal(j.bounce.defect, "host does not take: zz_probe");
});

test("an office pointed at no record refuses the act with the pen's sentence, and the read with its own", async () => {
  uninstallActsPen();
  const off = { WORLD2_PG: undefined, WORLD2_PG_URL: undefined };
  await refusedWith(hostAtOffice(HOST(Date.now()), WRIGHT, { env: off }), 503, /nothing was written, and nothing was lost/);
  await refusedWith(calendarAtOffice({}, { env: off }), 503, /record cannot be read/);
});

// ── announce (POS-227) ──────────────────────────────────────────────────────
//
// Keemin 2026-09-26: the host's word reaches everyone attending; UNCAPPED, a
// dial ANNOUNCE_MAX for later; text ≤ 1000 characters. The delivery is the
// earpiece's (test/earpiece.test.mjs § announcements); these are the act and
// the read.

// Read at the call, not at import: the pen stub points process.env at the record.
const noCap = () => ({ ...process.env, ANNOUNCE_MAX: undefined });

test("announce · the host's word is an act of class event, action announce, object the event; the calendar read carries it oldest first, and no harness detail", async () => {
  const { pen } = setup();
  const now = Date.now();
  const { event } = await hostAtOffice(HOST(now), WRIGHT, { now });
  const URL_ = "https://hooks.example.org/errant-announce";
  await rsvpAtOffice({ event: event.id, harness: { kind: "webhook", url: URL_ } }, ERRANT, { fetchImpl: echoing([]), mintSecret: () => SECRET_A, now });
  const first = await announceAtOffice({ event: event.id, text: "Doors at half past nine, not ten." }, WRIGHT, { now: now + 1000, env: noCap() });
  const second = await announceAtOffice({ event: event.id, text: "  Bring a lamp.  " }, WRIGHT, { now: now + 2000, env: noCap() });
  assert.deepEqual(first.announcement, { n: 1, at: iso(now + 1000), text: "Doors at half past nine, not ten." });
  assert.equal(second.announcement.n, 2);
  assert.equal(second.announcement.text, "Bring a lamp.", "the text is trimmed");
  assert.match(first.receipt, /wakes the 1 resident who RSVPed, each once, outside their wake budget/);
  const act = pen.rows().find((r) => r.action === "announce");
  assert.deepEqual({ class: act.class, action: act.action, object: act.object, actor: act.actor },
    { class: "event", action: "announce", object: event.id, actor: "wright" });
  assert.deepEqual(JSON.parse(act.payload), { event: event.id, text: "Doors at half past nine, not ten." });

  const one = await calendarAtOffice({ event: event.id }, { now: now + 3000 });
  assert.deepEqual(one.event.announcements, [
    { at: iso(now + 1000), text: "Doors at half past nine, not ten." },
    { at: iso(now + 2000), text: "Bring a lamp." },
  ]);
  const all = await calendarAtOffice({}, { now: now + 3000 });
  assert.deepEqual(all.coming[0].announcements, one.event.announcements);
  // THE PUBLIC READ: the words, and nothing of how anyone is woken.
  const text = JSON.stringify([one, all]);
  assert.doesNotMatch(text, new RegExp(`errant-announce|${SECRET_A}|webhook|budget`), "the public read carries a harness detail");
  // Another event's read carries none of them.
  const other = await hostAtOffice({ ...HOST(now), title: "Reading by the lamp" }, WRIGHT, { now });
  assert.deepEqual((await calendarAtOffice({ event: other.event.id }, { now })).event.announcements, []);
});

test("announce · only the host: another resident, and the host's own household-mate, are refused by name, and nothing is written", async () => {
  const { pen } = setup();
  const now = Date.now();
  const { event } = await hostAtOffice(HOST(now), WRIGHT, { now });
  await rsvpAtOffice({ event: event.id }, ERRANT, { now });
  const n = pen.rows().length;
  await refusedWith(announceAtOffice({ event: event.id, text: "hello all" }, ERRANT, { now, env: noCap() }), 403, /only the host announces on/);
  const MATES = { household: "starforge", handles: new Set(["wright", "pica"]) };
  await refusedWith(announceAtOffice({ event: event.id, handle: "pica", text: "hello all" }, MATES, { now, env: noCap() }), 403, /only the host announces on/);
  await refusedWith(announceAtOffice({ event: "wright/no-such-thing", text: "hello" }, WRIGHT, { now, env: noCap() }), 404, /no event/);
  await refusedWith(announceAtOffice({ event: event.id }, WRIGHT, { now, env: noCap() }), 422, /needs text/);
  assert.equal(pen.rows().length, n, "a refused announcement wrote an act");
  const ok = await announceAtOffice({ event: event.id, handle: "wright", text: "hello all" }, MATES, { now, env: noCap() });
  assert.equal(ok.handle, "wright");
});

test(`announce · ${ANNOUNCE_TEXT_MAX} characters is taken, ${ANNOUNCE_TEXT_MAX + 1} is refused by name`, async () => {
  const { pen } = setup();
  const now = Date.now();
  const { event } = await hostAtOffice(HOST(now), WRIGHT, { now });
  assert.equal(ANNOUNCE_TEXT_MAX, 1000, "the ruling's number");
  const n = pen.rows().length;
  await refusedWith(announceAtOffice({ event: event.id, text: "x".repeat(1001) }, WRIGHT, { now, env: noCap() }), 422, /at most 1000 characters/);
  assert.equal(pen.rows().length, n);
  const ok = await announceAtOffice({ event: event.id, text: "x".repeat(1000) }, WRIGHT, { now, env: noCap() });
  assert.equal(ok.announcement.text.length, 1000);
});

test("announce · from the event's creation until it ends: taken before the doors open, refused after the end and on a cancelled event", async () => {
  const { pen } = setup();
  const now = Date.now();
  const a = await hostAtOffice(HOST(now), WRIGHT, { now });
  const early = await announceAtOffice({ event: a.event.id, text: "see you soon" }, WRIGHT, { now: now + 1000, env: noCap() });
  assert.equal(phaseAt(a.event, now + 1000), "announced");
  assert.equal(early.announcement.n, 1);
  await refusedWith(announceAtOffice({ event: a.event.id, text: "that was lovely" }, WRIGHT, { now: now + 3 * H, env: noCap() }), 409, /has ended/);
  const b = await hostAtOffice({ ...HOST(now), title: "Reading by the lamp" }, WRIGHT, { now });
  await cancelAtOffice({ event: b.event.id }, WRIGHT, { now });
  const n = pen.rows().length;
  await refusedWith(announceAtOffice({ event: b.event.id, text: "still on?" }, WRIGHT, { now, env: noCap() }), 409, /was cancelled/);
  assert.equal(pen.rows().length, n);
});

test("announce · uncapped by default — twelve on one event are all taken; with ANNOUNCE_MAX=2 the third is refused by name", async () => {
  const { pen } = setup();
  const now = Date.now();
  const a = await hostAtOffice(HOST(now), WRIGHT, { now });
  for (let i = 1; i <= 12; i++) {
    const r = await announceAtOffice({ event: a.event.id, text: `note ${i}` }, WRIGHT, { now, env: noCap() });
    assert.equal(r.announcement.n, i);
  }
  const b = await hostAtOffice({ ...HOST(now), title: "Reading by the lamp" }, WRIGHT, { now });
  const CAP2 = { ...noCap(), ANNOUNCE_MAX: "2" };
  await announceAtOffice({ event: b.event.id, text: "one" }, WRIGHT, { now, env: CAP2 });
  await announceAtOffice({ event: b.event.id, text: "two" }, WRIGHT, { now, env: CAP2 });
  const n = pen.rows().length;
  await refusedWith(announceAtOffice({ event: b.event.id, text: "three" }, WRIGHT, { now, env: CAP2 }), 409, /already carries 2 announcements, the most this office allows/);
  assert.equal(pen.rows().length, n, "the refused third wrote an act");
  // The dial counts per event: the first event's twelve do not count here, and
  // the second's two do not stop the first.
  await announceAtOffice({ event: a.event.id, text: "thirteen" }, WRIGHT, { now, env: noCap() });
});

test("announce · the rebuild still equals the tables: an announcement changes no row", async () => {
  const { pen, events, rsvps } = setup();
  const now = Date.now();
  const a = await hostAtOffice(HOST(now), WRIGHT, { now });
  await rsvpAtOffice({ event: a.event.id }, ERRANT, { now });
  await announceAtOffice({ event: a.event.id, text: "hello" }, WRIGHT, { now, env: noCap() });
  const acts = await eventActs(pen);
  const out = compareRebuild({ events: [...events.values()], rsvps: [...rsvps.values()] }, acts);
  assert.equal(out.equal, true, out.drift.join("; "));
  assert.deepEqual(out.counts, { acts: 3, events: 1, event_rsvps: 1 });
});

test("the household door dispatches announce", async () => {
  setup();
  const now = Date.now();
  const { event } = await hostAtOffice(HOST(now), WRIGHT, { now });
  const { householdApex, HOUSEHOLD_DISPATCHABLE, APEX_ONLY_FIELDS } = await import("../src/household-apex.mjs");
  assert.ok(HOUSEHOLD_DISPATCHABLE.includes("announce"));
  assert.deepEqual(APEX_ONLY_FIELDS.announce.required, ["event", "text"]);
  const r = await householdApex({ do: "announce", args: { event: event.id, text: "hello at the door" } }, WRIGHT, {});
  assert.equal(r.result?.announcement?.text, "hello at the door", JSON.stringify(r).slice(0, 300));
  const no = await householdApex({ do: "announce", args: { event: event.id, text: "me too" } }, ERRANT, {});
  assert.equal(no.code, 403);
});

// ── the sample the site lane reads ──────────────────────────────────────────

test("test/fixtures/calendar.sample.json has the live read's keys, at the top and on every event", async () => {
  setup();
  const now = Date.now();
  await hostAtOffice(HOST(now), WRIGHT);
  const live = await calendarAtOffice({}, { now });
  const sample = JSON.parse(readFileSync(join(HERE, "fixtures", "calendar.sample.json"), "utf8"));
  const keys = (o) => Object.keys(o).sort();
  assert.deepEqual(keys(sample), keys(live));
  const liveEvent = live.coming[0];
  for (const e of [...sample.now, ...sample.coming, ...sample.ended]) {
    assert.deepEqual(keys(e), keys(liveEvent), `sample event ${e.id}`);
    assert.deepEqual(keys(e.place), keys(liveEvent.place));
    assert.deepEqual(keys(e.rsvps), keys(liveEvent.rsvps));
    assert.equal(e.phase, phaseAt(e, Date.parse(sample.as_of)), `sample event ${e.id}'s phase is not the office's`);
  }
});
