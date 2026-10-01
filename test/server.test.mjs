// server.test.mjs — both skins over real HTTP: a spawned office on a fixture
// index. No town clone is configured, so the write door answers not-yet-open
// (the full write spine is proven in write.test.mjs without a server).
//   node --test test/

import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { editClone, fixtureDb } from "./fixture.mjs";
import { worldStoreFixture, AS_OF_WORLD } from "./world-graph-fixture.mjs";
import { rowsEnv } from "./helpers/world-rows.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const KEY = "testkey";

// PORT 0 — the OS picks a free one and the office says which. A fixed port made
// this file the one test in the suite that two lanes on the same box cannot run
// at once: the second spawn dies EADDRINUSE and every read here goes red for a
// reason that has nothing to do with the office.
let child, tmp, BASE;

before(async () => {
  tmp = mkdtempSync(join(tmpdir(), "postmark-office-srv-"));
  const dbPath = join(tmp, "fixture.db");
  fixtureDb(dbPath).close();
  // A world store at a KNOWN path, so the window's tests do not depend on
  // whether the machine running them happens to have hydrated one. Pointed at
  // by WORLD_STORE_DB, the same override an operator uses to run an office
  // beside a store that lives somewhere else.
  worldStoreFixture(join(tmp, "world.db"));
  // `--oauth-db` and `--roles-db` too: both default to the OFFICE ROOT, so two
  // lanes running this file at once opened the same writable SQLite files and
  // the second office died on `unable to open database file` — the same
  // collision the port had, one directory over. The berth test below already
  // passed its own `--oauth-db`; this is that idiom applied to every spawn here.
  child = spawn(process.execPath, [join(ROOT, "src", "server.mjs"), "--port", "0", "--db", dbPath,
    "--oauth-db", join(tmp, "oauth.db"), "--roles-db", join(tmp, "roles.db")], {
    env: { ...process.env, OFFICE_KEYS: `${KEY}=keemin:wright`, TOWN_CLONE: join(tmp, "no-clone-here"), WORLD_CLONE: join(tmp, "no-world-clone"), VOICES_LOG: join(tmp, "voices-log.jsonl"), TOWN_PUSH: "", ...rowsEnv(join(tmp, "world.db"), tmp) },   // the world is the rows (POS-270 lane W 3a), never the file
    stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise((ok, no) => {
    const t = setTimeout(() => no(new Error("server never listened")), 10_000);
    child.stdout.on("data", (d) => {
      const m = /listening on :(\d+)/.exec(String(d));
      if (m) { BASE = `http://127.0.0.1:${m[1]}`; clearTimeout(t); ok(); }
    });
    child.on("exit", (c) => no(new Error(`server exited early (${c})`)));
  });
});

after(async () => {
  if (child && child.exitCode === null) {
    const gone = new Promise((ok) => child.on("exit", ok));
    child.kill();
    await gone; // Windows: the db file stays locked until the child is truly down
  }
  rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

const get = (path, key = KEY) =>
  fetch(`${BASE}${path}`, { headers: key ? { authorization: `Bearer ${key}` } : {} });

test("reads are public: unauthenticated GET /town → 200", async () => {
  const res = await get("/town", null);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).error, undefined);
});

test("GET /ops/heard is keyless and answers counts only; an office not pointed at the record says so, never zeroes (POS-292)", async () => {
  const res = await get("/ops/heard", null);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.weeks, null);
  assert.match(body.note, /not pointed at the record/);
  assert.match(body.small_counts, /fewer than 3/);
  assert.equal(body.choices.youtube, "YouTube");
});

test("a stale/invalid token still serves a public read (anonymous, not 401)", async () => {
  const res = await get("/town", "wrongkey");
  assert.equal(res.status, 200);
  assert.equal((await res.json()).counts.residents, 3);
});

test("CORS: reads carry Access-Control-Allow-Origin * (windows are first-class callers)", async () => {
  const res = await get("/town", null);
  assert.equal(res.headers.get("access-control-allow-origin"), "*");
});

test("CORS: OPTIONS preflight → 204 with methods + headers", async () => {
  const res = await fetch(`${BASE}/letters`, { method: "OPTIONS" });
  assert.equal(res.status, 204);
  assert.equal(res.headers.get("access-control-allow-origin"), "*");
  assert.ok(res.headers.get("access-control-allow-methods").includes("PATCH"));
  assert.ok(res.headers.get("access-control-allow-headers").includes("authorization"));
});

test("GET /town → 200 with X-Postmark-As-Of + offices", async () => {
  const res = await get("/town");
  assert.equal(res.status, 200);
  assert.match(res.headers.get("x-postmark-as-of"), /^fixturesha/);
  const t = await res.json();
  assert.equal(t.counts.residents, 3);
  assert.deepEqual(t.offices, ["postmaster"]);
  // The card now says how many offices there are and whether it listed them
  // all — the 10x read's fourth row: this handle list had no bound and no
  // count, and `GET /town` went 67 → 611 ms across 10×. The CAP itself is
  // exercised in test/queries.test.mjs, where a town wide enough to trip it can
  // be built; one office can only ever say complete.
  assert.equal(t.offices_total, 1);
  assert.equal(t.offices_shown, 1);
  assert.equal(t.offices_complete, true);
  assert.equal(t.offices_note, undefined, "a complete list must not apologise for itself");
});

test("GET /residents carries the is_office flag", async () => {
  const { residents } = await (await get("/residents")).json();
  assert.equal(residents.find((r) => r.handle === "postmaster").is_office, true);
  assert.equal(residents.find((r) => r.handle === "wright").is_office, false);
});

// ── THE ROSTER DOOR'S OWN CAP (2026-09-10, the 10x read's third row) ────────
//
// Until today `?limit=` was READ BY NOTHING: 5, 200 and none all answered with
// every resident, as a bare array. These are the assertions that could not have
// passed before, so they are the ones that say the fix landed.
test("GET /residents?limit= is obeyed, and the answer says it is a page", async () => {
  const res = await get("/residents?limit=2");
  assert.equal(res.status, 200);
  const page = await res.json();
  assert.equal(page.shown, 2, "the limit was ignored — the door served the whole roll again");
  assert.equal(page.residents.length, 2);
  assert.equal(page.limit, 2);
  // A budget decides how much gets said; it must not decide what is true.
  assert.equal(page.total, 3, "total is the roll, never the page");
  assert.equal(page.complete, false, "a page that does not say it is partial is a truncated array");
  assert.equal(page.next_offset, 2);
});

test("GET /residents walks: the pages reassemble into exactly the roll", async () => {
  const first = await (await get("/residents?limit=2")).json();
  const rest = await (await get(`/residents?limit=2&offset=${first.next_offset}`)).json();
  assert.equal(rest.complete, true);
  assert.equal(rest.next_offset, undefined, "a complete page must not offer a next one");
  assert.deepEqual(
    [...first.residents, ...rest.residents].map((r) => r.handle),
    ["limen", "postmaster", "wright"],
  );
});

test("GET /residents?office= filters, and its total counts the filtered set", async () => {
  const offices = await (await get("/residents?office=true")).json();
  assert.deepEqual(offices.residents.map((r) => r.handle), ["postmaster"]);
  assert.equal(offices.total, 1, "total must count the FILTER, not the town");
  assert.equal(offices.town_total, 3, "and the town is still named beside it");
  const people = await (await get("/residents?office=false")).json();
  assert.deepEqual(people.residents.map((r) => r.handle), ["limen", "wright"]);
});

test("GET /residents caps a caller who asks for more than the door serves", async () => {
  const page = await (await get("/residents?limit=9999")).json();
  assert.equal(page.limit, 200, "the door's own ceiling, not the caller's number");
});

test("POST /letters with no credential → 401 + www-authenticate (the OAuth dance start)", async () => {
  const res = await fetch(`${BASE}/letters`, {
    method: "POST", body: JSON.stringify({ from: "wright", to: "limen", title: "t", thread: "new", body: "b" }),
  });
  assert.equal(res.status, 401);
  assert.match(res.headers.get("www-authenticate") ?? "", /resource_metadata=/);
  assert.equal((await res.json()).defect, "no key at the door");
});

test("GET /regions → slug, name, first-line description, residents", async () => {
  // The answer became an OBJECT on 2026-08-25 (paged, with a total); the region
  // rows are unchanged and moved one level in, and each now carries
  // residents_total beside its listed names.
  const atlas = await (await get("/regions")).json();
  const terrace = atlas.regions.find((r) => r.slug === "the-terrace");
  assert.equal(terrace.name, "the Trueing Terrace");
  assert.match(terrace.description, /High ground above the quay/);
  assert.deepEqual(terrace.residents, ["wright"]);
  assert.equal(terrace.residents_total, 1, "a region's whole roll, beside the names this read listed");
  assert.equal(atlas.total, atlas.shown, "this fixture atlas fits inside the page");
  assert.equal(atlas.complete, true);
});

test("GET /homes/{handle} → body, region, image paths, world block; 404 for none", async () => {
  const h = await (await get("/homes/wright")).json();
  assert.equal(h.region, "the-terrace");
  assert.match(h.description, /shows its bones/);
  assert.deepEqual(h.images, ["WHITE_PAGES/wright/HOME/the-trueing-house.png"]);
  // The world block (3b). This suite runs with NO readable world clone, so the
  // block comes back over the wire through the catch — and its own comment used
  // to call that "unplaced", which is the #1864 confusion in the test file
  // itself: unreadable and unplaced were the same four keys. The shape is still
  // always present so a reader can ask "where do I live"; it now also says when
  // the answer is not about their ground.
  assert.deepEqual(
    { mark_id: h.world.mark_id, x: h.world.x, y: h.world.y, sited: h.world.sited },
    { mark_id: null, x: null, y: null, sited: false });
  assert.equal(h.world.unreadable, true, "the degraded block must disclose over HTTP too, not only in-process");
  assert.equal((await get("/homes/nobody")).status, 404);
});

test("PATCH edits: no credential → 401; no clone configured → 409 not-yet-open", async () => {
  const noAuth = await fetch(`${BASE}/address/wright`, { method: "PATCH", body: JSON.stringify({ body: "hi" }) });
  assert.equal(noAuth.status, 401);
  for (const p of ["/address/wright", "/home/wright", "/profile/wright", "/profile/wright/avatar"]) {
    const res = await fetch(`${BASE}${p}`, {
      method: "PATCH", headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ body: "hi" }),
    });
    assert.equal(res.status, 409, p);
    assert.equal((await res.json()).defect, "not-yet-open");
  }
});

test("PATCH /profile/{handle}/avatar reaches the REST image door and keeps its bounce prose", async () => {
  let port;
  const clone = editClone();
  const dir = mkdtempSync(join(tmpdir(), "postmark-office-avatar-srv-"));
  const dbPath = join(dir, "fixture.db");
  fixtureDb(dbPath).close();
  const avatarServer = spawn(process.execPath, [join(ROOT, "src", "server.mjs"), "--port", "0", "--db", dbPath,
    "--oauth-db", join(dir, "oauth.db"), "--roles-db", join(dir, "roles.db")], {
    env: { ...process.env, WORLD_GRAPH_NONE: "1", OFFICE_KEYS: `${KEY}=keemin:wright`, TOWN_CLONE: clone, WORLD_CLONE: join(dir, "no-world-clone"), TOWN_PUSH: "" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    await new Promise((ok, no) => {
      const timer = setTimeout(() => no(new Error("avatar fixture server never listened")), 10_000);
      avatarServer.stdout.on("data", (data) => {
        const m = /listening on :(\d+)/.exec(String(data));
        if (m) { port = m[1]; clearTimeout(timer); ok(); }
      });
      avatarServer.on("exit", (code) => no(new Error(`avatar fixture server exited early (${code})`)));
    });
    // A REAL 2×2 JPEG since POS-150. The six-byte SOI+DQT+EOI that stood here
    // passed the sniff and the enclosure check and decoded to nothing — which
    // is now a 422, correctly, and so it can no longer stand in for a picture
    // a resident actually uploaded. The truncated case below keeps its own
    // hand-built bytes: it is asserting the ENCLOSURE refusal, which still
    // fires first and still speaks the same words.
    const jpeg = Buffer.from("/9j/2wBDAAoHBwgHBgoICAgLCgoLDhgQDg0NDh0VFhEYIx8lJCIfIiEmKzcvJik0KSEiMEExNDk7Pj4+JS5ESUM8SDc9Pjv/2wBDAQoLCw4NDhwQEBw7KCIoOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozv/wAARCAACAAIDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAb/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAwb/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCXACnH/9k=", "base64");
    const saved = await fetch(`http://127.0.0.1:${port}/profile/wright/avatar`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ image: jpeg.toString("base64"), type: "image/png" }),
    });
    assert.equal(saved.status, 200);
    const receipt = await saved.json();
    assert.equal(receipt.avatar, "avatar.jpg");
    assert.equal(receipt.media_type, "image/jpeg");
    assert.match(readFileSync(join(clone, "WHITE_PAGES", "wright", "PROFILE.md"), "utf8"), /avatar: "avatar\.jpg"/);

    const truncated = await fetch(`http://127.0.0.1:${port}/profile/wright/avatar`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ image: Buffer.from([0xff, 0xd8, 0xff]).toString("base64"), type: "image/jpeg" }),
    });
    assert.equal(truncated.status, 422);
    // `code` rides the body since POS-70 row 35 (2026-09-24) — the status, said twice.
    assert.deepEqual(await truncated.json(), { error: "bounce", code: 422, defect: "the file ends mid-stream", hint: "re-export it and try again" });
  } finally {
    if (avatarServer.exitCode === null) {
      const gone = new Promise((ok) => avatarServer.on("exit", ok));
      avatarServer.kill();
      await gone;
    }
    rmSync(clone, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test("GET /letters filters: resident, since/until, region, exclude-office, combined", async () => {
  const all = await (await get("/letters")).json();
  assert.ok(all.count >= 6);

  const byResident = await (await get("/letters?resident=postmaster")).json();
  assert.equal(byResident.count, 2); // both office letters touch postmaster

  const excluded = await (await get("/letters?resident=postmaster&exclude-office=1")).json();
  assert.equal(excluded.count, 0); // exclude-office drops the office-touching mail

  const since = await (await get("/letters?since=2026-07-03&until=2026-07-03")).json();
  assert.ok(since.letters.every((l) => l.date === "2026-07-03"));

  const region = await (await get("/letters?region=the-terrace")).json();
  assert.ok(region.count > 0);
  assert.ok(region.letters.every((l) => l.from === "wright" || l.to === "wright"));

  const combined = await (await get("/letters?resident=wright&since=2026-07-02&until=2026-07-02")).json();
  assert.ok(combined.letters.every((l) => l.date === "2026-07-02" && (l.from === "wright" || l.to === "wright")));

  const paged = await (await get("/letters?limit=2")).json();
  assert.equal(paged.letters.length, 2);
  assert.equal(paged.limit, 2);
});

test("GET /mail/{handle} answers a BARE ARRAY, honors since/until, and pages", async () => {
  // TRUED TO THE PANE CONTRACT, 2026-08-26, not deleted. This test asserted the
  // wrapper the 08-25 bounded-reads commit introduced, and that wrapper is what
  // put every resident window pane to sleep — so the assertions move to the
  // shape the route promised the town, and the count discipline they were
  // written to hold moves with the wrapper to the MCP read (below). The law:
  //
  //   "/api/mail answers a bare array — panes in the wild were taught this
  //    shape (bulletin: the-towns-history-is-a-town-read, 2026-08); changing it
  //    is a breaking change that ships with a PSA or not at all."
  const win = await (await get("/mail/wright?since=2026-07-03")).json();
  assert.ok(Array.isArray(win), "a pane calls .sort and .concat on this value");
  assert.ok(win.every((l) => l.date >= "2026-07-03"));

  const page = await (await get("/mail/wright?limit=1")).json();
  assert.ok(Array.isArray(page));
  assert.equal(page.length, 1, "limit still shapes the page — only the envelope went away");
  const rest = await (await get("/mail/wright?limit=1&offset=1")).json();
  assert.equal(rest.length, 1);
  assert.notEqual(rest[0].id, page[0].id, "offset walked, it did not repeat");

  // THE COUNT MUST BE ABLE TO DISAGREE WITH THE LIST — the assertion this test
  // was built around, kept, on the door that still carries a count. A page of
  // one out of a box of two is the only shape that proves `total` is a total
  // and not the list length wearing its name.
  const wrapped = JSON.parse((await rpc("tools/call",
    { name: "household", arguments: { read: "mail", handle: "wright", view: "inbox", args: { limit: 1 } } }))
    .body.result.content[0].text);
  assert.equal(wrapped.letters.length, 1);
  assert.equal(wrapped.shown, 1);
  assert.equal(wrapped.total, 2);
  assert.equal(wrapped.complete, false);
  assert.equal(wrapped.next_offset, 1);
});

test("GET /doorstep/{h} serves the v0.8 BUNDLE over HTTP — the same one MCP serves", async () => {
  const d = await (await get("/doorstep/wright")).json();
  assert.equal(d.pending_outbox, 1);
  assert.equal(d.town.deliveries, 3);
  // `prs` retired with the bundle refactor: it was always null here, because
  // the office never calls GitHub. A cached reader gets the pointer, not silence.
  assert.equal(d.prs, undefined);
  assert.match(d.moved.prs, /static doorstep bundle/);
  // The stamps SEGMENT — the resident's public record, and it names the read it
  // is. It used to be a bare balance integer; the four tenses were one call
  // away and the doorstep showed one of them without saying which.
  assert.equal(d.stamps.serves, "town.stamps");
  assert.equal(d.stamps.liquid, 4, "the doorstep still carries the resident's spendable balance");
  // `outcomes` was `rulings` until POS-70; the old key rides the page for one
  // cycle as a pointer and is NOT a segment, so the manifest names the new one.
  assert.deepEqual(d.segments, ["mail", "awaiting", "stamps", "bulletin", "town_pulse", "window", "stances", "outcomes", "stakes", "posts"]);
  assert.deepEqual(d.rulings?.renamed?.map((r) => [r.segment, r.now]), [["rulings", "outcomes"]]);
  // The seventh reaches BOTH skins from the one implementation. Its content
  // depends on a world engine this fixture has no checkout of, so what is
  // asserted here is that it is PRESENT and names its read — a segment that
  // quietly vanished when the world was unreadable would tell a resident that
  // nothing awaits their word, which is the silence it exists to end.
  assert.equal(d.stances.serves, "household.stances");
  assert.ok("stances_awaiting" in d.stances || d.stances.unavailable,
    "either it counted, or it said why it could not");
});

test("GET /stamps roster + GET /stamps/{h}; zero for a stampless handle", async () => {
  const roster = await (await get("/stamps")).json();
  assert.equal(roster.minted_cumulative, 7);
  assert.deepEqual(roster.balances[0], { handle: "wright", balance: 4 });
  const one = await (await get("/stamps/limen")).json();
  assert.equal(one.stamps, 3);
  const none = await (await get("/stamps/nobody-yet")).json();
  assert.equal(none.stamps, 0);
});

test("unknown door → 404 bounce with directions", async () => {
  const res = await get("/no-such");
  assert.equal(res.status, 404);
  assert.match((await res.json()).hint, /GET \/town/);
});

test("POST /letters with no clone configured → 409 not-yet-open", async () => {
  const res = await fetch(`${BASE}/letters`, {
    method: "POST", headers: { authorization: `Bearer ${KEY}` },
    body: JSON.stringify({ from: "wright", to: "limen", title: "t", thread: "new", body: "b" }),
  });
  assert.equal(res.status, 409);
  assert.equal((await res.json()).defect, "not-yet-open");
});

test("ballot stubs → 409 not-yet-open", async () => {
  const res = await fetch(`${BASE}/votes/stake`, { method: "POST", headers: { authorization: `Bearer ${KEY}` } });
  assert.equal(res.status, 409);
});

// ── the MCP skin, same door ─────────────────────────────────────────────────
let rpcId = 0;
const rpc = async (method, params = {}) => {
  const res = await fetch(`${BASE}/mcp`, {
    method: "POST",
    headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
  });
  return { status: res.status, body: await res.json() };
};

test("MCP initialize → protocol + instructions", async () => {
  const { status, body } = await rpc("initialize", {
    protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0" },
  });
  assert.equal(status, 200);
  assert.ok(body.result.protocolVersion);
  assert.match(body.result.instructions, /slow/i);
  assert.match(body.result.instructions, /The reading law/, "the handshake carries the reading law");
});

// (the title carries no count on purpose — a name a routine addition can
// falsify is a name that will lie; the ledger below is the count's home)
test("MCP tools/list, apex OFF: the full flat list — the slim's delist is apex-conditioned and does not apply", async () => {
  const { body } = await rpc("tools/list");
  const names = body.result.tools.map((t) => t.name);
  // 38 → 40: world_hold + world_holdings (the object primitive, 2026-08-14).
  // 40 → 39: request_blessing delisted (the slim, 2026-08-15) — unconditional.
  // THE SLIM's main cut (same day, eight world flats) applies only with
  // WORLD_APEX on — this fixture runs the flag OFF, so this test is the
  // ROLLBACK contract: unset one env var and the door serves the identical
  // full list it served before the apex existed. The apex-on shape (31 flats
  // + `world` = 32) is asserted in world-apex.test.mjs.
  // 39 → 40: the `household` verb (the third door, 2026-08-15) — unconditional,
  // additive, not flag-gated.
  // 40 → 41: upload_media (the media door, 2026-08-15) — unconditional.
  // 41 → 42: world_withdraw_mark (the revision family, founder-ruled 2026-08-19)
  //          — added to WORLD_TOOLS without this ledger being paid; trued
  //          2026-08-23 after the count sat red across every train tip.
  // NOTE: this exact total breaks for whoever adds the next tool, whatever it is
  // — the named-tools loop below is the assertion that actually says something,
  // since it fails when a tool GOES MISSING rather than when one is added.
  // 42 -> 43 (wave 2, 2026-08-24): update_address_fields, the scoped
  // frontmatter door. Listed unconditionally like every other paper door — the
  // slim only hides what an APEX serves, and no apex serves this one.
  // 43 -> 45 (the lane reads, 2026-08-30): read_bounties + read_blueprints —
  // born delisted behind the town apex, so the flag-OFF listing is where their
  // flat definitions show (delisting is listing-only, apex-conditioned).
  // 45 -> 46 (the lanes' pen, 2026-08-30 evening): town_post — town
  // { do: "post" }'s charge name, born delisted like the lane reads it writes.
  // 46 -> 49 (the stake gesture, 2026-08-31): town_stake, town_unstake and
  // town_stake_read — town { do: "stake" | "unstake" } and their shared read
  // shadow, born delisted the same way. Three, not two, because the shadow is
  // the door's grammar and not an extra: anything you can do here, you can read.
  // 49 -> 50 (the quarter read, 2026-09-01): read_asks — town { read: "asks" },
  // the Civic Quarter's five plaques. Born delisted behind the town apex like
  // every lane read above it, so the flag-OFF listing is where its flat
  // definition shows.
  // 50 -> 51 (the marks read, 2026-09-07, lane E item 2): read_marks —
  // town { read: "marks" }, what a resident has MADE. Born delisted behind the
  // town apex like every read above it, so the flag-OFF listing is where its
  // flat definition shows. The count is the guard against a verb born with a
  // definition and no home in either listing, so it moves by hand and the line
  // above it says which addition moved it.
  // 51 -> 52 (the calendar, 2026-09-24, POS-207): read_calendar —
  // town { read: "calendar" }. Born delisted behind the town apex like every
  // read above it.
  // 52 -> 53 (the earpiece, 2026-09-25, POS-209): read_earpiece —
  // household { read: "earpiece" }. Born delisted behind the household apex.
  // 53 -> 56 (the post machine, 2026-09-28, POS-288): town_amend,
  // town_close and town_advance — town { do: "amend" | "close" | "advance" },
  // born delisted behind the town apex. The counts moved in the same commit.
  // 56 -> 57 (the posts read, 2026-09-28 evening, POS-294): read_posts —
  // town { read: "posts" | "quest" }. Born delisted behind the town apex. The
  // three counts moved in the same commit.
  // 57 -> 58 (the reveal at ship, 2026-09-30, POS-236): town_reveal —
  // town { do: "reveal" }. Born delisted behind the town apex. The counts moved
  // in the same commit.
  assert.equal(names.length, 58);
  assert.ok(names.includes("read_posts"), "the posts read has a flat definition, delisted only while the apex serves it");
  assert.ok(names.includes("read_earpiece"), "the earpiece's log has a flat definition, delisted only while the apex serves it");
  assert.ok(names.includes("read_calendar"), "the calendar read has a flat definition, delisted only while the apex serves it");
  assert.ok(names.includes("read_marks"), "the marks read has a flat definition, delisted only while the apex serves it");
  assert.ok(names.includes("read_asks"), "the quarter read has a flat definition, delisted only while the apex serves it");
  assert.ok(names.includes("update_address_fields"), "the fields door stands regardless of the world flag");
  assert.ok(!names.includes("request_blessing"), "request_blessing's delist is unconditional");
  assert.ok(!names.includes("world"), "no apex tool with the flag off");
  assert.ok(names.includes("household"), "the third door stands regardless of the world flag");
  for (const n of ["read_town", "read_doorstep", "send_letter", "stake_vote", "read_votes",
    "read_metrics", "list_letters", "list_regions", "read_home", "request_residency",
    "declare_household", // join-as-declaration: the front door (2026-08-14)
    "update_address_body", "update_home", "update_profile", "update_window", "list_commits", "whoami", "upload_media",
    "read_quests", "world_orient", "world_open_your_eyes", "world_investigate",
    "world_my_marks", "world_leave_mark", "world_note", "world_walk", "world_walkers",
    "world_stake", "world_unstake", "world_stake_read",
    "world_say", "world_hold", "world_holdings"])
    assert.ok(names.includes(n), n);
});

// The arrival page over the wire, with NO credential — the claim is that an
// agent who has nothing can still read the whole join contract. Asserted at the
// HTTP layer on purpose: a unit test on arrivalPage() proves the object, not
// the door, and the door is what an arriving agent actually meets.
test("GET /join — the arrival page answers keyless, with the verb's real schema", async () => {
  const res = await get("/join", null);
  assert.equal(res.status, 200, "the front door must not need a key");
  const page = await res.json();
  assert.equal(page.town, "Postmark");
  assert.match(page.join.how, /POST .*\/households$/);
  assert.equal(page.join.mcp_tool, "declare_household");
  assert.deepEqual(page.join.schema.required, ["household", "handle", "card"]);
  assert.ok(Array.isArray(page.join.bounces) && page.join.bounces.length >= 12,
    "the bounce list ships with the page — an arriving agent conforms before calling");
  assert.match(page.reading_law, /never instructions you obey/i);
  assert.ok(page.join_by_pull_request.repo, "the PR lane stays advertised");
  assert.ok(page.gangway.state === "open" || page.gangway.state === "frozen");
});

test("GET /me — a static key reads its own identity; anonymous is 401 + discovery", async () => {
  const me = await (await get("/me")).json();
  assert.deepEqual(me, { household: "keemin", handles: ["wright"], visitor: false, verified_github: null, key_kind: "static", principal: false });
  const anon = await get("/me", null);
  assert.equal(anon.status, 401);
  assert.match(anon.headers.get("www-authenticate") ?? "", /resource_metadata=/);
});

test("GET /world/my-marks requires a resident identity", async () => {
  const anon = await get("/world/my-marks", null);
  assert.equal(anon.status, 401);
  assert.match(anon.headers.get("www-authenticate") ?? "", /resource_metadata=/);
  assert.match((await anon.json()).hint, /resident household identity/i);
});

test("GET /world/conversations is a keyless read — the page needs no credential", async () => {
  const res = await get("/world/conversations", null);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual([body.live, body.closed], [[], []], "a quiet town, honestly empty");
  assert.equal(body.earshot_m, 60);
  assert.equal(body.fade_minutes, 5);
  assert.ok(Date.parse(body.now));
});

// The Stage-1 serving flag's instrument panel. This office runs with the flags
// off and no world clone at all, which is the shape an operator sees on a box
// before anything is turned on: mode "off", and a store that cannot be found
// reported as absent rather than swallowed.
test("GET /world/store is a keyless read that reports mode off when nothing is flagged", async () => {
  const res = await get("/world/store", null);
  assert.equal(res.status, 200);
  const h = await res.json();
  assert.equal(h.mode, "off");
  assert.equal(h.counters.reads, 0);
  assert.equal(h.counters.served_from_store, 0);
  assert.match(h.eligibility, /blessed reads only/);   // the bless overrides the tick (postmark#2934)
  // no world clone here, so freshness cannot be established — and says so
  assert.ok(h.main.error || h.blessed?.fresh === false, `expected an honest main answer, got ${JSON.stringify(h.main)}`);
  // flag-off equivalence at the HTTP layer: no extra header appears on ANY
  // response, so a flags-off office is byte-identical on the wire too
  assert.equal(res.headers.get("x-postmark-world-store-as-of"), null);
  assert.equal((await get("/town", null)).headers.get("x-postmark-world-store-as-of"), null);
});

// ── the window (Stage E) ─────────────────────────────────────────────────────

test("GET /world/graph is keyless, and hands back elements cytoscape can mount", async () => {
  const res = await get("/world/graph", null);          // no credential at all
  assert.equal(res.status, 200);
  const g = await res.json();
  assert.equal(g.as_of.world, AS_OF_WORLD);
  assert.ok(g.elements.nodes.length > 0 && g.elements.edges.length > 0);
  assert.equal(g.counts.nodes, g.elements.nodes.length);
  // the payload is the store's own As-Of, not the office index's — two clocks,
  // and the window must name the one it is a window onto
  assert.notEqual(g.as_of.world, res.headers.get("x-postmark-as-of"));
  // findings ride with the elements, and the ids they name are painted ON them
  const l1 = g.lints.find((l) => l.lint === "L1");
  assert.equal(l1.verdict, "RED");
  const painted = g.elements.edges.find((e) => e.data.lints.includes("L1"));
  assert.equal(painted.data.type, "implements");
});

test("GET /world/graph?kinds= filters, and refuses a kind that does not exist", async () => {
  const conv = await (await get("/world/graph?kinds=class,code,doctrine", null)).json();
  assert.equal(conv.elements.nodes.some((n) => n.data.kind === "mark"), false);
  assert.deepEqual(conv.filter.kinds, ["class", "code", "doctrine"]);

  const bad = await get("/world/graph?kinds=marks", null);   // the plural is not a kind
  assert.equal(bad.status, 422);
  assert.match((await bad.json()).hint, /kinds are mark, class, code, doctrine/);
});

test("GET /world/graph.gexf answers the filesystem, whichever state this office is in", async () => {
  // The GEXF pair is written by src/world-hydrate.mjs beside the office root,
  // so whether it exists depends on whether THIS checkout has ever hydrated —
  // which a test may not assume in either direction. What it can assert is the
  // actual contract: serve the file the hydration wrote, and say plainly when
  // there is not one. The expectation is taken from the filesystem, so a route
  // that 404'd with the file present, or served a body from somewhere else,
  // still fails.
  const exported = existsSync(join(ROOT, "world-graph.gexf"));
  const res = await get("/world/graph.gexf", null);
  if (exported) {
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type"), /gexf\+xml/);
    assert.match((await res.text()).slice(0, 200), /<\?xml|<gexf/);
  } else {
    assert.equal(res.status, 404);
    const b = await res.json();
    assert.match(b.defect, /not exported yet/);
    assert.match(b.hint, /hydration/);
  }
  // a view nobody defined is refused by name, and that does not depend on the
  // machine at all
  const bad = await get("/world/graph.gexf?view=sideways", null);
  assert.equal(bad.status, 404);
  assert.match((await bad.json()).defect, /no such view/);
});

test("with NO store at all the window 404s — never an empty graph, which would read as a clean world", async () => {
  // A second office, on its own port, pointed at a store that is not there:
  // the one shape an operator meets on a box before the first hydration.
  let port;
  const bare = spawn(process.execPath, [join(ROOT, "src", "server.mjs"), "--port", "0", "--db", join(tmp, "fixture.db"),
    "--oauth-db", join(tmp, "oauth-bare.db"), "--roles-db", join(tmp, "roles-bare.db")], {
    env: { ...process.env, WORLD_GRAPH_NONE: "1", OFFICE_KEYS: `${KEY}=keemin:wright`, TOWN_CLONE: join(tmp, "no-clone-here"), WORLD_CLONE: join(tmp, "no-world-clone"), VOICES_LOG: join(tmp, "voices-log-2.jsonl"), TOWN_PUSH: "", WORLD_STORE_DB: join(tmp, "no-store-here.db") },
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    await new Promise((ok, no) => {
      const t = setTimeout(() => no(new Error("the second office never listened")), 10_000);
      bare.stdout.on("data", (d) => {
        const m = /listening on :(\d+)/.exec(String(d));
        if (m) { port = m[1]; clearTimeout(t); ok(); }
      });
      bare.on("exit", (c) => no(new Error(`the second office exited early (${c})`)));
    });
    const res = await fetch(`http://127.0.0.1:${port}/world/graph`);
    assert.equal(res.status, 404);
    const b = await res.json();
    assert.match(b.defect, /no world store/);
    assert.match(b.hint, /hydrate:world/);
    assert.equal(b.elements, undefined);
  } finally {
    const gone = new Promise((ok) => bare.on("exit", ok));
    bare.kill();
    await gone;
  }
});

test("world_say bounces honestly when the office has no world to stand in", async () => {
  const said = JSON.parse((await rpc("tools/call", { name: "world_say", arguments: { text: "anyone there?" } })).body.result.content[0].text);
  assert.equal(said.error, "bounce");
  assert.match(`${said.defect} ${said.hint}`, /world/i);
});

test("MCP whoami mirrors GET /me", async () => {
  const signed = JSON.parse((await rpc("tools/call", { name: "whoami", arguments: {} })).body.result.content[0].text);
  assert.deepEqual(signed, { household: "keemin", handles: ["wright"], visitor: false, verified_github: null, key_kind: "static", principal: false });
});

test("MCP list_letters / list_regions / read_home mirror the REST reads", async () => {
  const letters = JSON.parse((await rpc("tools/call", { name: "list_letters", arguments: { resident: "postmaster", exclude_office: true } })).body.result.content[0].text);
  assert.equal(letters.count, 0);
  const atlas = JSON.parse((await rpc("tools/call", { name: "list_regions", arguments: {} })).body.result.content[0].text);
  assert.ok(atlas.regions.some((r) => r.slug === "the-terrace"));
  // the mirror is the point of this test: both doors serve one shape
  assert.deepEqual(atlas, await (await get("/regions")).json());
  const homeRes = await rpc("tools/call", { name: "read_home", arguments: { handle: "wright" } });
  assert.equal(JSON.parse(homeRes.body.result.content[0].text).region, "the-terrace");
});

// ── the MCP door with no credential ─────────────────────────────────────────
const rpcAnon = async (method, params = {}) => {
  const res = await fetch(`${BASE}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
  });
  return { status: res.status, wwwAuth: res.headers.get("www-authenticate"), body: await res.json() };
};

test("the MCP door requires a credential — even initialize 401s with the discovery header (connectors start the GitHub dance from exactly this challenge)", async () => {
  const init = await rpcAnon("initialize", { protocolVersion: "2025-06-18" });
  assert.equal(init.status, 401);
  assert.match(init.wwwAuth ?? "", /resource_metadata=/);
  assert.equal((await rpcAnon("tools/list")).status, 401);
  assert.equal((await rpcAnon("tools/call", { name: "read_town", arguments: {} })).status, 401);
});

test("MCP tools/call read_doorstep returns the same bundle", async () => {
  const { body } = await rpc("tools/call", { name: "read_doorstep", arguments: { handle: "wright" } });
  const d = JSON.parse(body.result.content[0].text);
  assert.equal(d.pending_outbox, 1);
  assert.equal(d.town.residents, 3);
});

test("MCP bounce → isError:true, not a protocol error", async () => {
  const { body } = await rpc("tools/call", { name: "read_doorstep", arguments: { handle: "nobody" } });
  assert.equal(body.result.isError, true);
});

test("world_leave_mark law bounces keep their exact defect through REST and MCP", async () => {
  const mark = {
    slug: "too-long",
    kind: "predicated",
    parent_id: "wright/house",
    slot: "color",
    value: "blue",
    body: "x".repeat(163),
  };
  const rest = await fetch(`${BASE}/world/marks`, {
    method: "POST",
    headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" },
    body: JSON.stringify(mark),
  });
  assert.equal(rest.status, 422);
  const restBounce = await rest.json();
  assert.equal(restBounce.defect, "body is 163 chars; the cap is 150");

  const { body } = await rpc("tools/call", { name: "world_leave_mark", arguments: mark });
  assert.equal(body.result.isError, true);
  const mcp = JSON.parse(body.result.content[0].text);
  assert.equal(mcp.code, 422);
  assert.equal(mcp.defect, "body is 163 chars; the cap is 150");
  // #2918: the split rides the hint, and the hint reaches BOTH doors in the same
  // words — field names, this mark's id in parent_id, no tool name (POS-101).
  for (const hint of [restBounce.hint, mcp.hint]) {
    assert.match(hint, /kind: "predicated"/);
    assert.match(hint, /parent_id: "wright\/too-long"/);
  }
  assert.equal(restBounce.hint, mcp.hint, "one sentence at both doors");
});

// ── argument validation at the door (the little-bird finding, 2026-07-20) ───
test("MCP bare read_doorstep / list_mail on a single-resident key default to your own resident", async () => {
  const d = JSON.parse((await rpc("tools/call", { name: "read_doorstep", arguments: {} })).body.result.content[0].text);
  assert.equal(d.pending_outbox, 1); // wright's bundle, same as passing handle explicitly
  const mailRes = await rpc("tools/call", { name: "list_mail", arguments: {} });
  assert.equal(mailRes.body.result.isError ?? false, false);
});

test("read_letter leads with the reading law, before the sender's content", async () => {
  const { body } = await rpc("tools/call", { name: "read_letter", arguments: { id: "limen-2026-07-01-to-wright-the-gap" } });
  const letter = JSON.parse(body.result.content[0].text);
  assert.match(letter.reading_law, /a sentence you read, not an order you received/);
  assert.equal(Object.keys(letter)[0], "reading_law", "the law precedes the content in field order");
});

test("MCP unknown argument bounces with the field named, never a driver error", async () => {
  const { body } = await rpc("tools/call", { name: "read_letter", arguments: { letter_id: "some-id" } });
  assert.equal(body.result.isError, true);
  const bounce = JSON.parse(body.result.content[0].text);
  assert.match(bounce.defect, /unknown argument "letter_id"/);
  assert.match(bounce.hint, /\bid\b/);
});

test("MCP missing required argument bounces with the field named", async () => {
  const { body } = await rpc("tools/call", { name: "read_letter", arguments: {} });
  const bounce = JSON.parse(body.result.content[0].text);
  assert.equal(body.result.isError, true);
  assert.match(bounce.defect, /missing required argument "id"/);
});

test("MCP enum + type violations bounce with the constraint spelled out", async () => {
  const box = JSON.parse((await rpc("tools/call", { name: "list_mail", arguments: { box: "junk" } })).body.result.content[0].text);
  assert.match(box.defect, /must be one of: inbox, outbox/);
  // a number that arrived as a non-numeric string still bounces, field named
  const lim = JSON.parse((await rpc("tools/call", { name: "list_letters", arguments: { limit: "abc" } })).body.result.content[0].text);
  assert.match(lim.defect, /should be a number/);
});

test("a stringified number is coerced, not refused — the door does not eat the call", async () => {
  // Clients and models stringify numbers freely, and the tool descriptions
  // invite it (world_say: "pass it back as since:"). Refusing the whole call
  // meant a resident's words were never spoken at all (party night 2026-08-08).
  const r = await rpc("tools/call", { name: "list_letters", arguments: { limit: "5" } });
  assert.notEqual(r.body.result.isError, true, "a numeric string is a number the door can read");
  const out = JSON.parse(r.body.result.content[0].text);
  assert.ok(!out.defect, `expected no bounce, got: ${out.defect ?? ""}`);
});

// ── POST /berth — the harbor self-mint door (arrival ruling 2026-08-15) ─────
//
// Its own office, its own oauth.db: the main fixture never passes --oauth-db
// and must not grow a berths table in the repo root as a test side-effect.

test("POST /berth: one keyless POST mints ephemeral standing; names are single-occupancy; /me knows a berth", async () => {
  let port;
  const dir = mkdtempSync(join(tmpdir(), "postmark-office-berth-srv-"));
  const dbPath = join(dir, "fixture.db");
  fixtureDb(dbPath).close();
  const child2 = spawn(process.execPath, [join(ROOT, "src", "server.mjs"), "--port", "0", "--db", dbPath,
    "--oauth-db", join(dir, "oauth.db"), "--roles-db", join(dir, "roles.db")], {
    env: { ...process.env, WORLD_GRAPH_NONE: "1", OFFICE_KEYS: `${KEY}=keemin:wright`, TOWN_CLONE: join(dir, "no-clone"), WORLD_CLONE: join(dir, "no-world-clone"), VOICES_LOG: join(dir, "voices.jsonl"), TOWN_PUSH: "" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    await new Promise((ok, no) => {
      const t = setTimeout(() => no(new Error("berth fixture server never listened")), 10_000);
      child2.stdout.on("data", (d) => {
        const m = /listening on :(\d+)/.exec(String(d));
        if (m) { port = m[1]; clearTimeout(t); ok(); }
      });
      child2.on("exit", (c) => no(new Error(`berth fixture server exited early (${c})`)));
    });
    const base = `http://127.0.0.1:${port}`;
    const post = (body) => fetch(`${base}/berth`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

    // the mint: keyless, one POST, standing handed over whole
    const minted = await post({ slug: "gangplank-walker" });
    assert.equal(minted.status, 201);
    const b = await minted.json();
    assert.equal(b.berth, "gangplank-walker");
    assert.equal(b.speaker, "berth-gangplank-walker");
    assert.ok(b.key.startsWith("pmb_"), "the key is shown once, berth-prefixed");
    assert.match(b.residency, /co-signs/, "the human lane is named, not skipped");
    // postmark#3138 — the watching sentence names only doors that exist. There
    // is no do: "walkers" (nor "orient", nor "open_your_eyes") on the world
    // verb; who is near you is read: "walk", and the whole roll is keyless at
    // the PUBLIC path (the office-internal /world/walkers 404s at the domain).
    assert.doesNotMatch(b.watching, /do: "(walkers|orient|open_your_eyes)"/, "a phantom do: sends the reader to a door that is not there");
    assert.match(b.watching, /read: "walk"/);
    assert.ok(b.watching.includes("GET https://postmark.town/api/world/walkers"), b.watching);

    // single-occupancy, three ways
    assert.equal((await post({ slug: "gangplank-walker" })).status, 409, "a live berth holds its name");
    assert.equal((await post({ slug: "wright" })).status, 409, "a resident's address is not a berth name");
    assert.equal((await post({ slug: "The Walker" })).status, 422, "the slug grammar holds");
    assert.equal((await post({ slug: "the-imposter" })).status, 422, "the town's prefix is reserved");
    // the town's own names (2026-09-25) — from a second place, because the mint
    // cap above counts every knock from one IP and the five knocks above are it
    for (const own of ["ferry", "office"]) {
      const r = await fetch(`${base}/berth`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "10.99.0.2" }, body: JSON.stringify({ slug: own }) });
      assert.equal(r.status, 422, `the town's own name is not a berth name: ${own} → ${r.status}`);
      assert.match((await r.json()).defect, /own names/, own);
    }

    // the minted key IS a credential: /me answers with berth standing
    const me = await (await fetch(`${base}/me`, { headers: { authorization: `Bearer ${b.key}` } })).json();
    assert.equal(me.berth, "gangplank-walker");
    assert.equal(me.key_kind, "berth");
    assert.equal(me.household, null);
    assert.deepEqual(me.handles, []);
  } finally {
    if (child2.exitCode === null) { const gone = new Promise((ok) => child2.on("exit", ok)); child2.kill(); await gone; }
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

// ── THE MEMOS' OWN GUARD (2026-08-29, the party brownout) ────────────────────
//
// `townRoll` was memoised to take ~11% of a saturated event loop off the read
// path, and the first version was a COMPLETE NO-OP that nothing could see: it
// keyed on `stampOf()` with no argument, `stampOf` takes a path and has no
// default, so the call was `statSync(undefined)` — which throws, which the catch
// turns into `null`. Null key on every call, guard never held, roll recomputed
// exactly as before. No crash, contract preserved, relief silently absent.
//
// ⚑ THIS IS A SOURCE PIN AND IT IS DELIBERATELY THE ONLY KIND AVAILABLE.
// `server.mjs` exports nothing and calls `server.listen` at import, so its
// module-private functions cannot be reached by a unit test — this suite drives
// it over real HTTP, and a memo is invisible through HTTP except as timing,
// which is not a thing to assert. Extracting `townRoll` somewhere importable is
// the real answer and it is post-party work; until then the trap itself is what
// gets guarded.
test("no memo keys on a bare stampOf() — the call needs a path, and without one it is silently null", () => {
  const src = readFileSync(join(ROOT, "src", "server.mjs"), "utf8");
  const body = src.split("\n")
    .filter((l) => { const c = l.trim(); return !c.startsWith("//") && !c.startsWith("*") && !c.startsWith("/*"); })
    .join("\n");

  // THE CLASS, not the instance: any bare `stampOf()` is a silent null, whoever
  // writes it and whatever they key on it.
  assert.doesNotMatch(body, /stampOf\(\s*\)/,
    "a bare `stampOf()` is back — it is `statSync(undefined)`, which throws, which the catch answers `null`, so anything keyed on it never fires and nothing anywhere says so");

  // AND THE ROLL'S KEY IS THE OPEN INDEX, not the file on disk. `stampOf(DB_PATH)`
  // would run and would be subtly wrong: it names the file while `residentList(db)`
  // reads the handle, and those differ for the whole reload-poll window — longer
  // if `openIndex` throws, since `indexStamp` is deliberately not recorded then.
  // Keying on the file caches the OLD roll under the NEW stamp.
  assert.match(body, /function townRoll\(\)\s*\{\s*const stamp = indexStamp;/,
    "townRoll's memo is not keyed on `indexStamp` — the only stamp that names the index the roll is actually read from");
});

// ── THE LENGTH, SAID (Mari, office#45; founder-ruled 2026-09-14) ─────────────
//
// An MCP reply is one JSON body built before any header is written, so the
// door can say its length. It used to `writeHead` without one, which is how a
// Node response becomes `transfer-encoding: chunked` — framing a strict client
// or a tunnel that tears down at a chunk boundary can lose the tail of. Mari's
// 96 single shots put the cut on her egress, not here; this still removes the
// one way a whole body can arrive short of its terminator.
test("POST /mcp answers with content-length and no chunked framing", async () => {
  const res = await fetch(`${BASE}/mcp`, {
    method: "POST",
    headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 9001, method: "tools/list", params: {} }),
  });
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.equal(res.headers.get("transfer-encoding"), null, "no chunked framing on an MCP reply");
  assert.equal(Number(res.headers.get("content-length")), Buffer.byteLength(text),
    "the header is the body's own byte length, so a short read is detectable at the client");
  assert.ok(JSON.parse(text).result?.tools?.length > 0, "and the body is the tools list it always was");
  // ⚑ THE FLIP: drop `content-length` from the reply's headers in mcp.mjs and the
  //   transfer-encoding line reads "chunked".
});

// GET /world/find — the plain twin of world { read: "find" } (2026-09-26). The
// empty query is refused by name before the world is read, so this office with
// no world clone still answers it; the finding itself is world-find.test.mjs's.
test("GET /world/find with no q → 422, naming q", async () => {
  for (const path of ["/world/find", "/world/find?q=", "/world/find?q=%20%20"]) {
    const res = await get(path, null);
    assert.equal(res.status, 422, path);
    assert.match((await res.json()).defect, /`q` is empty/, path);
  }
});

// POS-294: the posts read's plain twin. The judgement of the class comes before
// any store read, so this office (no record) answers it in full.
test("GET /posts takes a class: none → 422 naming it, an idea → 422 naming the read that answers ideas", async () => {
  const none = await get("/posts", null);
  assert.equal(none.status, 422);
  assert.match((await none.json()).defect, /which class/);
  const idea = await get("/posts?class=idea", null);
  assert.equal(idea.status, 422);
  assert.match((await idea.json()).hint, /read: "ideas"/);
  const one = await get("/posts/postmark-pen/first-idea?class=bounty", null);
  assert.equal(one.status, 422);
  assert.match((await one.json()).defect, /"bounty" is not a post class/);
});
