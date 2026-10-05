// The conversations door over a store whose record outlived its anchors
// (postmark-office#351, POS-403).
//
// "One say whose anchor mark is not standing fails the whole read": on prod,
// act 2971 is anchored at vermillion/the-track-garage, withdrawn on 2026-09-02
// before the store was seeded, and 187 such says turned
// `GET /world2/conversations` into a 500 for every caller. A say whose
// witnessed line cannot be composed is still never placed at {0,0}; it is left
// out of the clustering and the answer says how many and which.
//
// The pool is dispatched on the SQL text the door sends, and it honours the
// door's own `status` filter, so a door that reads only standing marks sees
// only standing marks.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";

const env = { pg: process.env.WORLD2_PG, url: process.env.WORLD2_PG_URL };
before(() => {
  process.env.WORLD2_PG = "1";
  process.env.WORLD2_PG_URL = "postgres://conversations-door-test/none";
});
after(() => {
  if (env.pg == null) delete process.env.WORLD2_PG; else process.env.WORLD2_PG = env.pg;
  if (env.url == null) delete process.env.WORLD2_PG_URL; else process.env.WORLD2_PG_URL = env.url;
});

const { world2Serve } = await import("../src/world2-serve.mjs");

const mark = (slug, status, at) => ({ slug, status, geometry: { at, extent: { w: 20, h: 20 } }, data: {} });
const MARKS = [
  mark("the-town/the-quay", "standing", { x: 1390, y: 5665 }),
  mark("kinofire/the-old-shed", "retired", { x: -400, y: 900 }),
  // A say-class dial on a RETIRED mark: the dials are law, and law is what stands.
  { slug: "the-town/earshot_m", status: "retired", geometry: { at: { x: 0, y: 0 } },
    data: { slot: "earshot_m", value: "9999", _parent_is_law: "the-town/say" } },
];

const T0 = Date.parse("2026-09-01T12:00:00Z");
const say = (id, actor, anchor, minutes, text) => ({
  id, at: new Date(T0 + minutes * 60000), actor, action: "say",
  at_anchor: anchor, at_dx: 0, at_dy: 0, payload: { text, place: null },
});
const ACTS = [
  say(1, "wright", "the-town/the-quay", 0, "on the quay"),
  say(2, "kinofire", "kinofire/the-old-shed", 1, "in the shed, before it came down"),
  say(3, "little-m-of-garrison", "vermillion/the-track-garage", 2, "in a garage the store never held"),
];

const poolOf = (acts) => ({
  query: async (sql) => {
    if (/FROM acts/i.test(sql)) return { rows: acts };
    if (/FROM marks/i.test(sql)) {
      const standingOnly = /status\s*=\s*'standing'/i.test(sql);
      return { rows: MARKS.filter((m) => !standingOnly || m.status === "standing") };
    }
    return { rows: [] };
  },
});

const read = (acts = ACTS) =>
  world2Serve("/world2/conversations", new URLSearchParams("at=2026-09-01T13:00:00Z"), { p: poolOf(acts) });
const saidIn = (body) => [...body.live, ...body.closed].flatMap((c) => c.voices.map((v) => v.said ?? v.text));

test("FALSIFIER, #351: a say anchored at a mark the store does not hold never fails the read", async () => {
  const r = await read();
  assert.equal(r.code, 200, `the read answers, not ${r.code}: ${JSON.stringify(r.body).slice(0, 300)}`);
});

test("the unplaceable say is left out of the clustering, never placed at {0,0}, and the answer counts it", async () => {
  const { body } = await read();
  assert.equal(body.voices, 2, "two of the three says compose to a point");
  assert.ok(!saidIn(body).includes("in a garage the store never held"));
  assert.equal(body.unplaced_says.count, 1);
  assert.equal(body.unplaced_says.example.act_id, "3");
  assert.equal(body.unplaced_says.example.anchor, "vermillion/the-track-garage");
  assert.ok(body.disclosed.some((d) => /1 say\b.*could not be placed/.test(d)),
    `the disclosure names the count: ${JSON.stringify(body.disclosed)}`);
});

test("a say anchored at a RETIRED mark is placed where the store last recorded that mark", async () => {
  const { body } = await read();
  assert.ok(saidIn(body).includes("in the shed, before it came down"));
});

test("the say dials still read only what STANDS: a retired dial mark governs nothing", async () => {
  const { body } = await read();
  assert.notEqual(body.dials.earshot_m.value, 9999);
});

test("silence is the good case: a record whose every say composes carries no unplaced block", async () => {
  const { body } = await read(ACTS.slice(0, 2));
  assert.equal(body.unplaced_says, undefined);
  assert.ok(!body.disclosed.some((d) => /could not be placed/.test(d)));
});

test("an act no era explains still stops the read: only an unplaceable say is answered around", async () => {
  const r = await read([...ACTS, { id: 9, at: new Date(T0), actor: null, action: "say", payload: {} }]);
  assert.equal(r.code, 500);
  assert.match(r.body.hint, /match no known era/);
});
