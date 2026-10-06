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
  postAtTown, amendAtTown, closeAtTown, advanceAtTown,
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
  // `posts` and `responses` since 028 (POS-288). `events` is keyed by id and
  // `rsvps` by "event handle" as before, holding rows in the 026 shape, so the
  // assertions below read the calendar exactly as they did: the stub keeps the
  // post-shaped row it was written and answers each view from it.
  const posts = new Map();
  const responses = new Map();
  const harnesses = new Map();   // household_harnesses, by handle
  const PC = ["id", "class", "title", "body", "author", "household", "place_mark", "place_x", "place_y",
    "starts", "ends", "state", "fields", "revised", "posted_act", "last_act"];
  const asJson = (v) => (typeof v === "string" ? JSON.parse(v) : v);
  const eventOf = (r) => ({ id: r.id, title: r.title, invitation: r.body, host: r.author, household: r.household,
    place_mark: r.place_mark, place_x: r.place_x, place_y: r.place_y, doors_open: r.fields.doors_open,
    starts: r.starts, ends: r.ends, revised: r.revised, cancelled: r.state === "cancelled",
    hosted_act: r.posted_act, last_act: r.last_act });
  const rsvpOf = (r) => ({ event: r.post, handle: r.handle, household: r.household,
    harness: r.fields.harness, budget: r.fields.budget, fell_back: r.fields.fell_back ?? null, act: r.act });
  // The two views the assertions read, derived on every look (never a second store).
  const events = { get: (id) => (posts.has(id) ? eventOf(posts.get(id)) : undefined), get size() { return posts.size; },
    values: () => [...posts.values()].map(eventOf)[Symbol.iterator](), has: (id) => posts.has(id) };
  const rsvps = { get: (k) => { const [e, h] = k.split(" "); const r = responses.get(`${e} ${h} rsvp`); return r ? rsvpOf(r) : undefined; },
    get size() { return responses.size; }, values: () => [...responses.values()].map(rsvpOf)[Symbol.iterator]() };
  const also = [
    [/^INSERT INTO posts/i, (q, p) => {
      if (posts.has(p[0])) throw new Error(`duplicate key value violates unique constraint "posts_pkey"`);
      const r = Object.fromEntries(PC.map((k, i) => [k, p[i]]));
      r.fields = asJson(r.fields);
      posts.set(p[0], r);
      return { rows: [], rowCount: 1 };
    }],
    [/^UPDATE posts SET/i, (q, p) => {
      const r = posts.get(p[0]);
      Object.assign(r, { title: p[1], body: p[2], place_mark: p[3], place_x: p[4], place_y: p[5],
        starts: p[6], ends: p[7], state: p[8], fields: asJson(p[9]), revised: p[10], last_act: p[11] });
      return { rows: [], rowCount: 1 };
    }],
    [/FROM posts WHERE id = \$1 AND class = \$2/i, (q, p) => {
      const r = posts.get(p[0]);
      const hit = r && r.class === p[1];
      return { rows: hit ? [{ ...r, fields: { ...r.fields } }] : [], rowCount: hit ? 1 : 0 };
    }],
    [/FROM posts WHERE id LIKE \$1/i, (q, p) => {
      const pre = String(p[0]).replace(/%$/, "");
      const rows = [...posts.values()].filter((r) => r.id.startsWith(pre)).map((r) => ({ id: r.id, state: r.state, ends: r.ends }));
      return { rows, rowCount: rows.length };
    }],
    [/FROM posts WHERE class = \$1 AND ends > \$2 ORDER BY starts, id/i, (q, p) => {
      const rows = [...posts.values()].filter((r) => r.class === p[0] && Date.parse(r.ends) > Date.parse(p[1]))
        .sort((a, b) => Date.parse(a.starts) - Date.parse(b.starts) || a.id.localeCompare(b.id)).map((r) => ({ ...r, fields: { ...r.fields } }));
      return { rows, rowCount: rows.length };
    }],
    [/^INSERT INTO responses/i, (q, p) => {
      if (/address/i.test(q)) throw new Error("responses has no address column (026: it lives on household_harnesses)");
      const [post, handle, household, kind, state, fields, act] = p;
      responses.set(`${post} ${handle} ${kind}`, { post, handle, household, kind, state, fields: asJson(fields), act });
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
    [/^SELECT \* FROM posts WHERE class = \$1 ORDER BY id$/i, (q, p) => {
      const rows = [...posts.values()].filter((r) => r.class === p[0]).sort((a, b) => a.id.localeCompare(b.id)).map((r) => ({ ...r, fields: { ...r.fields } }));
      return { rows, rowCount: rows.length };
    }],
    [/^SELECT \* FROM responses WHERE kind = \$1 ORDER BY post, handle$/i, (q, p) => {
      const rows = [...responses.values()].filter((r) => r.kind === p[0])
        .sort((a, b) => a.post.localeCompare(b.post) || a.handle.localeCompare(b.handle)).map((r) => ({ ...r, fields: { ...r.fields } }));
      return { rows, rowCount: rows.length };
    }],
    [/SELECT handle FROM responses WHERE post = \$1 AND kind = \$2/i, (q, p) => {
      const rows = [...responses.values()].filter((r) => r.post === p[0] && r.kind === p[1]).map((r) => ({ handle: r.handle })).sort((a, b) => a.handle.localeCompare(b.handle));
      return { rows, rowCount: rows.length };
    }],
    [/FROM responses WHERE post = ANY\(\$1\) AND kind = \$2/i, (q, p) => {
      const rows = [...responses.values()].filter((r) => p[0].includes(r.post) && r.kind === p[1]).map((r) => ({ post: r.post, handle: r.handle }));
      return { rows, rowCount: rows.length };
    }],
  ];
  return { events, rsvps, posts, responses, harnesses, also };
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
  // `post` since POS-288: the household's host writes the post machine's act.
  assert.equal(act.class, "event"); assert.equal(act.action, "post"); assert.equal(act.object, r.event.id);
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
  assert.deepEqual(pen.rows().map((a) => a.action), ["post", "amend"]);
  assert.deepEqual(Object.keys(JSON.parse(pen.rows()[1].payload)).sort(), ["changed", "ends", "post"], "the amend act carries only the field that changed");
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

test("falsifier · a webhook that echoes lands as webhook; one that does not lands on the guest list and says so", async () => {
  const { rsvps, harnesses } = setup();
  const { event } = await hostAtOffice(HOST(Date.now()), WRIGHT);
  const seen = [];
  const ok = await rsvpAtOffice({ event: event.id, harness: { kind: "webhook", url: "https://hooks.example.org/postmark" }, budget: 9 }, ERRANT, { fetchImpl: echoing(seen) });
  assert.equal(ok.harness.kind, "webhook"); assert.equal(ok.harness.url, "https://hooks.example.org/postmark");
  assert.equal(ok.budget, 9); assert.equal(ok.fell_back, undefined);
  assert.equal(seen.length, 1, "the url is challenged exactly once"); assert.match(seen[0].body.nonce, /^[0-9a-f]{32}$/);

  const no = await rsvpAtOffice({ event: event.id, harness: { kind: "webhook", url: "https://hooks.example.org/deaf" } }, WRIGHT, { fetchImpl: silent([]) });
  assert.equal(no.harness, null); assert.equal(no.fell_back, FELL_BACK_NO_ECHO);
  assert.match(no.receipt, /the webhook was not registered .* so you are on the guest list with no wakes/);
  assert.equal(no.budget, BUDGET_DEFAULT);
  // an unechoed URL is never registered: nothing a later wake could read
  assert.equal(harnesses.has("wright"), false);
  assert.equal(no.secret, undefined, "a webhook that did not echo is minted no secret");
  assert.equal(rsvps.get(`${event.id} wright`).harness, "mail");
});

test("rsvp · no harness is the guest list; letta is refused by name (removed 2026-09-27); a budget past the dial and a private url are refused by name", async () => {
  const { pen } = setup();
  const { event } = await hostAtOffice(HOST(Date.now()), WRIGHT);
  const m = await rsvpAtOffice({ event: event.id }, ERRANT);
  // mail is not offered (Keemin 2026-09-27): the receipt names no harness and
  // promises nothing but the guest list
  assert.equal(m.harness, null); assert.equal(m.budget, 6);
  assert.match(m.receipt, /you are on the guest list$/);
  assert.match(m.wakes_note, /^You are on the guest list\. Nothing is sent to you/);
  assert.equal(m.budget_note, undefined, "a guest-list RSVP carries no wake budget note");
  const n = pen.rows().length;
  await refusedWith(rsvpAtOffice({ event: event.id, harness: { kind: "letta", conversation: "conv-4f2a" } }, ERRANT), 422, /letta is not offered/);
  await refusedWith(rsvpAtOffice({ event: event.id, budget: 61 }, ERRANT), 422, /1 to 60/);
  await refusedWith(rsvpAtOffice({ event: event.id, harness: { kind: "webhook", url: "https://127.0.0.1/x" } }, ERRANT), 422, /private address/);
  await refusedWith(rsvpAtOffice({ event: event.id, harness: { kind: "webhook", url: "http://hooks.example.org/x" } }, ERRANT), 422, /https/);
  await refusedWith(rsvpAtOffice({ event: event.id, harness: { kind: "mail", url: "https://x.example" } }, ERRANT), 422, /does not take: url/);
  assert.equal(pen.rows().length, n);
});

test("the act carries no address: a webhook url never reaches `acts` (the table the notary exports)", async () => {
  const { pen } = setup();
  const { event } = await hostAtOffice(HOST(Date.now()), WRIGHT);
  await rsvpAtOffice({ event: event.id, harness: { kind: "webhook", url: "https://hooks.example.org/secret-path" } }, ERRANT, { fetchImpl: echoing([]) });
  await rsvpAtOffice({ event: event.id, harness: { kind: "webhook", url: "https://hooks.example.org/private-77" } }, WRIGHT, { fetchImpl: echoing([]) });
  const text = JSON.stringify(pen.rows());
  assert.doesNotMatch(text, /secret-path|private-77/);
});

test("the public read carries no harness, url, conversation or budget — only who RSVPed", async () => {
  setup();
  const now = Date.now();
  const { event } = await hostAtOffice(HOST(now), WRIGHT);
  await rsvpAtOffice({ event: event.id, harness: { kind: "webhook", url: "https://hooks.example.org/secret-path" }, budget: 7 }, ERRANT, { fetchImpl: echoing([]) });
  await rsvpAtOffice({ event: event.id, harness: { kind: "webhook", url: "https://hooks.example.org/private-77" } }, WRIGHT, { fetchImpl: echoing([]) });
  for (const read of [await calendarAtOffice({}, { now }), await calendarAtOffice({ event: event.id }, { now })]) {
    const text = JSON.stringify(read);
    assert.doesNotMatch(text, /secret-path|private-77|harness|budget|webhook/);
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

test("rotation · a different url is challenged again and re-mints, stamping rotated_at; mail stores nothing and leaves the row alone", async () => {
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
  assert.equal(mail.harness, null);
  assert.equal(harnesses.get("errant").secret, SECRET_B, "a mail RSVP touched the harness row");

  const m = await rsvpAtOffice({ event: event.id }, { household: "pica", handles: new Set(["pica"]) });
  assert.equal(m.harness, null);
  assert.equal(harnesses.has("pica"), false, "a mail RSVP stored a harness row");
});

test("the row policy · the harness row is read and written only inside a transaction that declared the resident's household", async () => {
  const { pen, harnesses } = setup();
  const { event } = await hostAtOffice(HOST(Date.now()), WRIGHT);
  await rsvpAtOffice({ event: event.id, harness: { kind: "webhook", url: "https://hooks.example.org/c-1" } }, ERRANT, { fetchImpl: echoing([]) });
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
  harnesses.set("pica", { handle: "pica", household: "solo:pica", kind: "webhook", address: "https://hooks.example.org/pica", secret: "p".repeat(64), registered_at: "x", rotated_at: null });
  const again = await rsvpAtOffice({ event: event.id, handle: "errant", harness: { kind: "webhook", url: "https://hooks.example.org/pica" } }, ERRANT, { fetchImpl: echoing([]) });
  assert.equal(again.harness.url, "https://hooks.example.org/pica");
  assert.equal(harnesses.get("pica").secret, "p".repeat(64), "errant's write reached pica's row");
  assert.equal(harnesses.get("errant").address, "https://hooks.example.org/pica");
});

test("the secret never enters a log line or an error: a failing write after the mint answers the pen's fixed sentence", async () => {
  const { pen } = setup({ failOn: (q) => /^INSERT INTO responses/i.test(q) });
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
  const { pen, posts, responses } = setup();
  const now = Date.now();
  const a = await hostAtOffice(HOST(now), WRIGHT);
  await hostAtOffice({ event: a.event.id, title: "The Snug Harbour, opened" }, WRIGHT);
  const b = await hostAtOffice({ ...HOST(now, { at: { x: 1, y: 2 } }), title: "Reading by the lamp" }, WRIGHT);
  await cancelAtOffice({ event: b.event.id }, WRIGHT);
  await rsvpAtOffice({ event: a.event.id, harness: { kind: "webhook", url: "https://hooks.example.org/c1" } }, ERRANT, { fetchImpl: echoing([]) });
  await rsvpAtOffice({ event: a.event.id, budget: 3 }, ERRANT);   // a second RSVP replaces the first
  const acts = await eventActs(pen);
  assert.equal(acts.length, 6);
  const stored = () => ({ posts: [...posts.values()], responses: [...responses.values()] });
  const ok = compareRebuild(stored(), acts);
  assert.deepEqual(ok.drift, []); assert.equal(ok.equal, true);
  assert.deepEqual(ok.counts, { acts: 6, posts: 2, responses: 1 });
  posts.get(a.event.id).title = "edited by hand";
  const bad = compareRebuild(stored(), acts);
  assert.equal(bad.equal, false);
  assert.match(bad.drift[0], /title: stored "edited by hand"/);
});

// The column lists, read from the migrations, so a column added there and not
// compared here reds rather than passing as "equal": 026 creates the tables,
// and 028 renames them (events → posts, event_rsvps → responses) and renames,
// adds and drops columns, each an ALTER this reads back in order.
function columnsOf(table) {
  const read = (f) => readFileSync(join(HERE, "..", "world2", "schema", f), "utf8").replace(/\r\n/g, "\n");
  const born = { posts: "events", responses: "event_rsvps" }[table] ?? table;
  const body = new RegExp(`CREATE TABLE IF NOT EXISTS ${born} \\(([\\s\\S]*?)\\n\\);`).exec(read("026_events.sql"))[1];
  let cols = body.split("\n").map((l) => l.trim()).filter((l) => /^[a-z_]+\s/.test(l) && !/^(CONSTRAINT|PRIMARY)\b/i.test(l)).map((l) => l.split(/\s+/)[0]);
  if (born === table) return cols;
  for (const m of read("028_posts.sql").matchAll(new RegExp(`ALTER TABLE ${table} (RENAME COLUMN (\\w+) TO (\\w+)|ADD COLUMN (\\w+)|DROP COLUMN (\\w+))`, "g"))) {
    if (m[2]) cols = cols.map((c) => (c === m[2] ? m[3] : c));
    else if (m[4]) cols.push(m[4]);
    else cols = cols.filter((c) => c !== m[5]);
  }
  return cols;
}

test("rebuild · restores and compares EVERY column of posts and responses — a hand edit to any one of them is caught", async () => {
  const { pen, posts, responses } = setup();
  const now = Date.now();
  const a = await hostAtOffice(HOST(now), WRIGHT);
  await rsvpAtOffice({ event: a.event.id, harness: { kind: "webhook", url: "https://hooks.example.org/z" } }, ERRANT, { fetchImpl: echoing([]) });
  const acts = await eventActs(pen);
  const evCols = columnsOf("posts"), rsCols = columnsOf("responses");
  assert.deepEqual([...evCols].sort(), ["author", "body", "class", "ends", "fields", "household", "id", "last_act", "place_mark",
    "place_x", "place_y", "posted_act", "revised", "starts", "state", "title"], `${evCols}`);
  assert.deepEqual([...rsCols].sort(), ["act", "fields", "handle", "household", "kind", "post", "state"], `${rsCols}`);
  assert.ok(!rsCols.includes("address"), "responses has an address column");
  const fresh = () => ({ posts: [...posts.values()].map((r) => ({ ...r, fields: { ...r.fields } })),
    responses: [...responses.values()].map((r) => ({ ...r, fields: { ...r.fields } })) });
  assert.equal(compareRebuild(fresh(), acts).equal, true);
  for (const [table, cols, key] of [["posts", evCols, "posts"], ["responses", rsCols, "responses"]]) {
    for (const c of cols) {
      const s = fresh();
      const r = s[key][0];
      r[c] = /^(starts|ends)$/.test(c) ? new Date(Date.parse(r[c]) + 12345).toISOString()
        : c === "fields" ? { ...r[c], edited: true }
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
  assert.ok(asked.some((q) => /FROM responses/.test(q)) && asked.some((q) => /FROM posts/.test(q)) && asked.some((q) => /FROM acts/.test(q)), asked.join(" | "));
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
  const { pen, posts, responses } = setup();
  const now = Date.now();
  const a = await hostAtOffice(HOST(now), WRIGHT, { now });
  await rsvpAtOffice({ event: a.event.id }, ERRANT, { now });
  await announceAtOffice({ event: a.event.id, text: "hello" }, WRIGHT, { now, env: noCap() });
  const acts = await eventActs(pen);
  const out = compareRebuild({ posts: [...posts.values()], responses: [...responses.values()] }, acts);
  assert.equal(out.equal, true, out.drift.join("; "));
  assert.deepEqual(out.counts, { acts: 3, posts: 1, responses: 1 });
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

// ── THE POST MACHINE AT THE TOWN DOOR (POS-288) ─────────────────────────────
//
// Keemin, 2026-09-27 (the Posts project, § The shape): one record with a life,
// every change an act, one door. The gate on POS-288: the calendar runs
// unchanged for residents on the general machine; an amend that changes one
// field changes only that field; the author hears every outcome.

const TOWN_EVENT = (now, extra = {}) => ({ class: "event", title: "Office Hours", body: "Come by with a question.",
  place: { at: { x: 120, y: 64 } }, doors_open: iso(now + 0.5 * H), starts: iso(now + 1 * H), ends: iso(now + 3 * H), ...extra });

test("post machine · town { do: \"post\", class: \"event\" } writes a `post` act and a posts row the calendar reads — with the post's names beside the calendar's", async () => {
  const { pen, posts } = setup();
  const now = Date.now();
  const r = await postAtTown(TOWN_EVENT(now), WRIGHT, { now });
  assert.equal(r.post.id, "wright/office-hours");
  assert.match(r.receipt, /^posted: wright\/office-hours \(an event\)/);
  assert.match(r.read, /town \{ read: "event", args: \{ post: "wright\/office-hours" \} \}/);
  const act = pen.rows()[0];
  assert.deepEqual([act.class, act.action, act.object], ["event", "post", "wright/office-hours"]);
  const p = JSON.parse(act.payload);
  assert.deepEqual(Object.keys(p).sort(), ["body", "class", "ends", "fields", "place", "post", "starts", "title"]);
  assert.deepEqual(p.fields, { doors_open: iso(now + 0.5 * H) }, "doors_open is the event class's own field");
  const row = posts.get("wright/office-hours");
  assert.equal(row.class, "event"); assert.equal(row.state, "announced"); assert.equal(row.author, "wright");
  const { event } = await calendarAtOffice({ post: "wright/office-hours" }, { now });
  assert.equal(event.phase, "announced");
  for (const [k, v] of [["class", "event"], ["author", "wright"], ["host", "wright"], ["body", "Come by with a question."],
    ["invitation", "Come by with a question."], ["state", "announced"], ["cancelled", false]]) assert.deepEqual(event[k], v, k);
  assert.deepEqual(event.fields, { doors_open: event.doors_open });
});

test("post machine · the gate: an amend that changes one field changes ONLY that field — in the act, and in the row", async () => {
  const { pen, posts } = setup();
  const now = Date.now();
  await postAtTown(TOWN_EVENT(now), WRIGHT, { now });
  const before = structuredClone(posts.get("wright/office-hours"));
  const r = await amendAtTown({ post: "wright/office-hours", ends: iso(now + 4 * H) }, WRIGHT, { now });
  assert.deepEqual(r.amended, ["ends"]);
  assert.deepEqual(JSON.parse(pen.rows()[1].payload), { post: "wright/office-hours", changed: ["ends"], ends: iso(now + 4 * H) });
  const after = posts.get("wright/office-hours");
  const moved = Object.keys(after).filter((k) => JSON.stringify(after[k]) !== JSON.stringify(before[k])).sort();
  assert.deepEqual(moved, ["ends", "last_act", "revised"], "only the sent field, the revision count and the act that made it");
  // Sending a field at the value it already holds changes nothing, and says so.
  await refusedWith(amendAtTown({ post: "wright/office-hours", title: "Office Hours" }, WRIGHT, { now }), 422, /nothing to amend/);
  assert.equal(pen.rows().length, 2);
});

test("post machine · D5: moving starts KEEPS doors_open; a kept doors_open after the new start is refused by name, at both doors, and nothing is written", async () => {
  const { pen } = setup();
  const now = Date.now();
  await postAtTown(TOWN_EVENT(now), WRIGHT, { now });                      // doors +0.5h, starts +1h
  const later = await amendAtTown({ post: "wright/office-hours", starts: iso(now + 2 * H) }, WRIGHT, { now });
  assert.deepEqual(later.amended, ["starts"], "the doors did not move with the start");
  assert.equal(later.post.doors_open, iso(now + 0.5 * H));
  const acts = pen.rows().length;
  await refusedWith(amendAtTown({ post: "wright/office-hours", starts: iso(now + 0.25 * H) }, WRIGHT, { now }), 422, /the doors would open after the new start/);
  await refusedWith(hostAtOffice({ event: "wright/office-hours", starts: iso(now + 0.25 * H) }, WRIGHT, { now }), 422, /the doors would open after the new start/);
  assert.equal(pen.rows().length, acts, "a refused amendment writes no act");
  const both = await amendAtTown({ post: "wright/office-hours", starts: iso(now + 0.25 * H), doors_open: iso(now + 0.1 * H) }, WRIGHT, { now });
  assert.deepEqual(both.amended, ["doors_open", "starts"]);
});

test("post machine · close: an event closes as cancelled — on the calendar as cancelled, its id not reused; a second close and an RSVP are refused", async () => {
  const { pen } = setup();
  const now = Date.now();
  await postAtTown(TOWN_EVENT(now), WRIGHT, { now });
  const c = await closeAtTown({ post: "wright/office-hours" }, WRIGHT, { now });
  assert.equal(c.state, "cancelled"); assert.equal(c.post.cancelled, true); assert.equal(c.post.state, "cancelled");
  assert.deepEqual(JSON.parse(pen.rows().at(-1).payload), { post: "wright/office-hours", state: "cancelled" });
  assert.equal(pen.rows().at(-1).action, "close");
  await refusedWith(closeAtTown({ post: "wright/office-hours" }, WRIGHT, { now }), 409, /already cancelled/);
  await refusedWith(cancelAtOffice({ event: "wright/office-hours" }, WRIGHT, { now }), 409, /already cancelled/);
  await refusedWith(rsvpAtOffice({ event: "wright/office-hours" }, ERRANT, { now }), 409, /was cancelled/);
  const again = await postAtTown(TOWN_EVENT(now), WRIGHT, { now });
  assert.equal(again.post.id, "wright/office-hours-2");
});

test("post machine · advance is refused by name for an event — its phases follow its clock — and writes nothing", async () => {
  const { pen } = setup();
  const now = Date.now();
  await postAtTown(TOWN_EVENT(now), WRIGHT, { now });
  await refusedWith(advanceAtTown({ post: "wright/office-hours", to: "live" }, WRIGHT), 422, /an event's phases follow its clock/);
  assert.equal(pen.rows().length, 1);
});

test("post machine · the class is judged: post needs one, another class is refused, and a mismatched class on amend or close is refused", async () => {
  const { pen } = setup();
  const now = Date.now();
  await refusedWith(postAtTown({ ...TOWN_EVENT(now), class: undefined }, WRIGHT, { now }), 422, /post needs a class/);
  await refusedWith(postAtTown({ ...TOWN_EVENT(now), class: "bounty" }, WRIGHT, { now }), 422, /answers class "event", "quest" or "bug", not "bounty"/);
  await postAtTown(TOWN_EVENT(now), WRIGHT, { now });
  await refusedWith(amendAtTown({ post: "wright/office-hours", class: "idea", title: "x" }, WRIGHT, { now }), 422, /not "idea"/);
  await refusedWith(closeAtTown({ post: "wright/office-hours", class: "idea" }, WRIGHT, { now }), 422, /not "idea"/);
  await refusedWith(amendAtTown({ post: "wright/office-hours", body: "a", invitation: "b" }, WRIGHT, { now }), 422, /same field/);
  await refusedWith(amendAtTown({ post: "wright/office-hours", title: "mine now" }, ERRANT, { now }), 403, /not yours to change/);
  assert.equal(pen.rows().length, 1);
});

test("post machine · town_post is routed by class: an event goes to the post machine, an idea goes where it went before, and each lane refuses the other's fields by name", async () => {
  setup();
  const { townPostEvent, ideaPrecheck } = await import("../src/town-post.mjs");
  const { TOOLS } = await import("../src/mcp.mjs");
  const tool = TOOLS.find((t) => t.name === "town_post");
  assert.equal(await townPostEvent({ class: "idea", slug: "x", body: "y" }, WRIGHT), null, "an idea is not the post machine's (POS-290)");
  const stray = await townPostEvent({ ...TOWN_EVENT(Date.now()), slug: "office-hours", stamps: 2 }, WRIGHT);
  assert.equal(stray.code, 422); assert.match(stray.defect, /^an event does not take: slug, stamps$/);
  assert.equal(ideaPrecheck({ class: "idea", slug: "x", body: "y" }, tool), null);
  assert.match(ideaPrecheck({ class: "idea", body: "y" }, tool).defect, /missing required argument "slug" for town_post/,
    "the idea lane still requires slug, in the flat validator's own words");
  assert.match(ideaPrecheck({ class: "idea", slug: "x", body: "y", starts: iso(Date.now()) }, tool).defect, /does not take: starts/);
  const ok = await townPostEvent(TOWN_EVENT(Date.now()), WRIGHT);
  assert.equal(ok.post.id, "wright/office-hours");
  const refused = await townPostEvent({ ...TOWN_EVENT(Date.now()), ends: "tomorrow" }, WRIGHT);
  assert.deepEqual([refused.error, refused.code, refused.field], ["bounce", 422, "ends"], "a rule's refusal comes back as the door's bounce");
});

test("post machine · the town door reads the event class: read: \"event\" dispatches read_calendar, and the flat tools are born delisted and charged as writes", async () => {
  const { TOWN_READS, TOWN_DISPATCHABLE, townDispatchToolFor } = await import("../src/town-apex.mjs");
  const { TOOLS, WRITE_TOOLS } = await import("../src/mcp.mjs");
  assert.equal(TOWN_READS.event.tool, "read_calendar");
  for (const act of ["amend", "close", "advance"]) {
    assert.ok(TOWN_DISPATCHABLE.includes(act), act);
    const flat = townDispatchToolFor(act);
    assert.equal(flat, `town_${act}`);
    assert.ok(TOOLS.some((t) => t.name === flat), `${flat} has a schema`);
    assert.ok(WRITE_TOOLS.has(flat), `${flat} is a credentialed act`);
  }
  const post = TOOLS.find((t) => t.name === "town_post").inputSchema;
  assert.deepEqual(post.properties.class.enum, ["idea", "event", "quest", "bug"]);
  assert.deepEqual(post.required, ["class"]);
});

test("post machine · ONE FOLD, TWO VOCABULARIES: a log of 026 acts and post-machine acts rebuilds to exactly the rows the pen wrote", async () => {
  const { pen, posts, responses } = setup();
  const now = Date.now();
  // 026-era history, as the old pen wrote it (whole-event payloads).
  const legacy = { event: "rei/the-old-one", title: "The old one", invitation: "From before.", place: { mark: null, x: 5, y: 6 },
    doors_open: iso(now + 1 * H), starts: iso(now + 1 * H), ends: iso(now + 2 * H) };
  pen.seedAct({ id: 1, at: iso(now), actor: "rei", action: "host", object: legacy.event, class: "event", payload: legacy, household: "rei" });
  pen.seedAct({ id: 2, at: iso(now), actor: "rei", action: "amend-event", object: legacy.event, class: "event",
    payload: { ...legacy, title: "The old one, moved", changed: ["title"] }, household: "rei" });
  pen.seedAct({ id: 3, at: iso(now), actor: "rei", action: "cancel-event", object: legacy.event, class: "event", payload: { event: legacy.event }, household: "rei" });
  // The projection those acts left behind, as 028 converted it.
  posts.set(legacy.event, { id: legacy.event, class: "event", title: "The old one, moved", body: "From before.", author: "rei", household: "rei",
    place_mark: null, place_x: 5, place_y: 6, starts: legacy.starts, ends: legacy.ends, state: "cancelled",
    fields: { doors_open: legacy.doors_open }, revised: 1, posted_act: 1, last_act: 3 });
  // Today's acts, through both doors.
  await postAtTown(TOWN_EVENT(now), WRIGHT, { now });
  await hostAtOffice({ event: "wright/office-hours", invitation: "Bring a question." }, WRIGHT, { now });
  await amendAtTown({ post: "wright/office-hours", place: { at: { x: 7, y: 8 } } }, WRIGHT, { now });
  await rsvpAtOffice({ event: "wright/office-hours" }, ERRANT, { now });
  const acts = await eventActs(pen);
  assert.deepEqual(acts.map((a) => a.action), ["host", "amend-event", "cancel-event", "post", "amend", "amend", "rsvp"]);
  const out = compareRebuild({ posts: [...posts.values()], responses: [...responses.values()] }, acts);
  assert.deepEqual(out.drift, []);
  assert.deepEqual(out.counts, { acts: 7, posts: 2, responses: 1 });
});

// POS-406 (found by amia-semper's refusal, 2026-10-05): a post's household is
// the spelling it was written under, for life (RULING 4). A housemate reaches it
// through the house's spelling set, never by matching that one string.
test("amend · a housemate may change a post written under the house's account spelling; a stranger still may not", async () => {
  const HARVEY = { slug: "house-of-harvey", ord: 0, name: "house-of-harvey", human: null,
    accounts: [{ login: "generalroam-boop", id: 273009068 }], residents: ["amia-semper", "scout"],
    since: "2026-08-29", member_of: null, declared_by: "t", formerly: null, provisional: null };
  const { posts } = setup({ households: [HARVEY] });
  const now = Date.now();
  const AMIA = { household: "generalroam-boop", handles: new Set(["amia-semper"]) };
  const SCOUT = { household: "generalroam-boop", handles: new Set(["scout"]) };
  const { event } = await hostAtOffice(HOST(now), AMIA);
  assert.equal(posts.get(event.id).household, "hh:house-of-harvey");
  posts.get(event.id).household = "gh:273009068";   // as the account-grain rows are stored
  const r = await hostAtOffice({ event: event.id, title: "Shrine Day" }, SCOUT);
  assert.deepEqual(r.amended, ["title"]);
  await refusedWith(hostAtOffice({ event: event.id, title: "mine now" }, ERRANT), 403, /not yours to change/);
});
