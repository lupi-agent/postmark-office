// household-apex.test.mjs — the third door: the standing (tier-shaped, the
// arrival checklist as living data), the begin bridge, the envelope, and the
// self-retiring gaps. The cosign's GitHub half is proven at the HTTP layer in
// server.test.mjs to the extent a fixture can (state machine, honest refusals);
// the click itself is a field act.
//
//   node --test test/household-apex.test.mjs

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openOauthDb, mintBerth } from "../src/oauth.mjs";
import { householdApex, householdStanding, paperGaps, householdDispatchToolFor, cosignUrlFor } from "../src/household-apex.mjs";
import { fixtureDb } from "./fixture.mjs";
import { DatabaseSync } from "node:sqlite";
import { REFUSALS } from "../src/ceremony.mjs";

const dir = mkdtempSync(join(tmpdir(), "postmark-household-"));
const odb = openOauthDb(join(dir, "oauth.db"));
const dbPath = join(dir, "fixture.db");
fixtureDb(dbPath).close();
const db = new DatabaseSync(dbPath, { readOnly: true });
after(() => {
  db.close();
  odb.close();
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

// ── the standing, tier by tier ───────────────────────────────────────────────

test("anonymous: the standing answers how to board — the checklist starts before any key exists", async () => {
  const s = await householdStanding(null, {});
  assert.equal(s.tier, "anonymous");
  assert.ok(s.next.some((n) => n.includes("/berth")), "the berth door is the named first move");
});

test("visitor: the standing points at declare", async () => {
  const s = await householdStanding({ household: "gh-login", handles: new Set(), visitor: true, ghLogin: "someone" }, { db });
  assert.equal(s.tier, "visitor");
  assert.ok(s.next.some((n) => n.includes("declare")));
});

test("berth tiers: bare → begin; declared → the one link; the checklist moves with the state", async () => {
  mintBerth(odb, "tier-walker");
  const key = { berth: true, slug: "tier-walker", household: null, handles: new Set() };
  const bare = await householdStanding(key, { odb });
  assert.equal(bare.tier, "berth");
  assert.ok(bare.next.some((n) => n.includes('do: "begin"')));

  odb.prepare("UPDATE berths SET card = ? WHERE slug = 'tier-walker'").run(JSON.stringify({ household: "The Walkers", card: "I walk." }));
  const declared = await householdStanding(key, { odb });
  assert.equal(declared.tier, "berth-declared");
  assert.ok(declared.next.some((n) => n.includes(cosignUrlFor("tier-walker"))), "the co-sign link IS the next step");
  assert.equal(declared.declaration.household, "The Walkers");

  odb.prepare("UPDATE berths SET cosigned_gh_id = 42, cosigned_gh_login = 'their-human' WHERE slug = 'tier-walker'").run();
  assert.equal((await householdStanding(key, { odb })).tier, "berth-cosigned");
});

test("resident: papers per handle, gaps named with the do: that fixes each", async () => {
  const key = { household: "keemin", handles: new Set(["wright"]) };
  const s = await householdStanding(key, { db, clone: null });
  assert.equal(s.tier, "resident");
  assert.equal(s.papers.wright.settled, true);
  // no clone in this fixture → the window cannot be found → the gap is named
  assert.ok(s.next.some((n) => n.includes('do: "window"')), "a missing window is a named gap");
});

test("paperGaps retire as the papers land — the self-emptying checklist", async () => {
  const clone = join(dir, "clone");
  mkdirSync(join(clone, "WHITE_PAGES", "wright", "WINDOW"), { recursive: true });
  const before = await paperGaps("wright", { db, clone });
  writeFileSync(join(clone, "WHITE_PAGES", "wright", "WINDOW", "window.html"), "<html/>");
  const after2 = await paperGaps("wright", { db, clone });
  assert.ok(after2.length < before.length, "hanging the window must retire its gap");
  assert.ok(!after2.some((g) => g.includes("window")), "the window gap is gone by name");
});

// ── begin · the berth's bridge ───────────────────────────────────────────────

test("begin: parks the declaration and hands back the one link", async () => {
  mintBerth(odb, "bridge-walker");
  const key = { berth: true, slug: "bridge-walker", household: null, handles: new Set() };
  const r = await householdApex({ do: "begin", args: { household: "The Bridge", card: "I cross carefully." } }, key, { odb });
  assert.ok(!r.error, JSON.stringify(r).slice(0, 300));
  assert.equal(r.result.handle, "bridge-walker");
  assert.equal(r.result.cosign_url, cosignUrlFor("bridge-walker"));
  assert.match(r.result.hand_to_your_human, /co-sign/i);
  const row = odb.prepare("SELECT card FROM berths WHERE slug = 'bridge-walker'").get();
  assert.equal(JSON.parse(row.card).household, "The Bridge");
});

test("begin: refuses the wrong tiers by name", async () => {
  const asResident = await householdApex({ do: "begin", args: { household: "X", card: "y" } },
    { household: "keemin", handles: new Set(["wright"]) }, { odb, db });
  assert.equal(asResident.code, 409);
  const asNobody = await householdApex({ do: "begin", args: { household: "X", card: "y" } }, null, { odb });
  assert.equal(asNobody.code, 403);
});

test("begin: a declaration without its parts bounces naming the part", async () => {
  mintBerth(odb, "half-ready");
  const key = { berth: true, slug: "half-ready", household: null, handles: new Set() };
  const noHouse = await householdApex({ do: "begin", args: { card: "words" } }, key, { odb });
  // THE CEREMONY'S OWN SENTENCE, NOT THIS DOOR'S (POS-158). This used to read
  // `/names the household/` — a wording that belonged to this door alone, while
  // the declaration door said something else and POS-188's form was about to
  // say a third thing. One vocabulary lives in `src/ceremony.mjs § REFUSALS`,
  // and the assertion is IDENTITY rather than a regex: two doors that happen to
  // spell the same sentence are two laws one edit apart.
  assert.equal(noHouse.defect, REFUSALS.NO_HOUSE.defect);
  assert.equal(noHouse.refusal, REFUSALS.NO_HOUSE, "the same frozen object, not an equal-looking one");
  assert.equal(noHouse.code, 422);
  const noCard = await householdApex({ do: "begin", args: { household: "H" } }, key, { odb });
  assert.match(noCard.defect, /carries your card/);
});

// ── the verb's grammar ───────────────────────────────────────────────────────

test("do: and read: never ride together; an unknown act names the real ones", async () => {
  const both = await householdApex({ do: "begin", read: "standing" }, null, {});
  assert.match(both.defect, /one call does one thing/);
  const unknown = await householdApex({ do: "conjure" }, null, {});
  assert.match(unknown.hint, /begin, declare, add-resident/);
});

test("the envelope: unknown fields bounce by name against the target's schema", async () => {
  const key = { household: "keemin", handles: new Set(["wright"]) };
  const r = await householdApex({ do: "window", args: { nonsense: 1 } }, key,
    { db, clone: null, schemas: { update_window: { handle: {}, html: {}, blueprint: {} } } });
  assert.equal(r.code, 422);
  assert.match(r.defect, /does not take: nonsense/);
  assert.ok(r.allowed.includes("html"));
});

test("read: address and home answer from the index; a berth's is honest about settling", async () => {
  const key = { household: "keemin", handles: new Set(["wright"]) };
  const addr = await householdApex({ read: "address" }, key, { db });
  assert.equal(addr.of, "wright");
  const home = await householdApex({ read: "home" }, key, { db });
  assert.equal(home.home.region, "the-terrace");
  const missing = await householdApex({ read: "address", handle: "nobody-here" }, key, { db });
  assert.equal(missing.code, 404);
  assert.match(missing.hint, /settling/);
});

test("the charge map: a household act resolves to the flat verb it is charged as", () => {
  assert.equal(householdDispatchToolFor("begin"), "household_begin");
  assert.equal(householdDispatchToolFor("window"), "update_window");
  assert.equal(householdDispatchToolFor("declare"), "declare_household");
  assert.equal(householdDispatchToolFor("conjure"), null);
});

// ── THE READ BRANCH VALIDATES (founder-ruled 2026-09-11: "yes on parity shape") ──
//
// Measured live on dev 2026-09-11 before this landed:
//   household { read: "mail", args: { handle, bogus: 1 } }  →  200, bogus dropped
// The ACT branch of this same door has validated against the flat tools' own
// schemas since 2026-08-17 ("update_home does not take: bogus_field_xyz",
// measured the same afternoon); the read branch never did.
//
// CAN-FAIL FLIP for this block: delete the `validateReadArgs` call in
// household-apex.mjs § the read branch and every refusal below reddens by
// ANSWERING — a 200 with the field silently dropped, the live defect's shape.

const STRICT = (extra = {}) => ({ db, strictFields: true, ...extra });

test("PARITY · an unknown arg on a household read bounces BY NAME, with the accepted list", async () => {
  const key = { household: "keemin", handles: new Set(["wright"]) };
  const r = await householdApex({ read: "mail", args: { bogus: 1 } }, key, STRICT());
  assert.equal(r.error, "bounce");
  assert.equal(r.code, 422);
  assert.equal(r.defect, 'unknown argument "bogus" for household { read: "mail" }');
  assert.equal(r.hint, "this read takes: view, since, until, limit, offset, hide_bounces_older_than_days");
  assert.ok(r.accepted.includes("view"), "and the names ride as data too, not only as prose");
});

test("PARITY · a read that takes nothing says so — and `handle` is never the unknown one", async () => {
  const key = { household: "keemin", handles: new Set(["wright"]) };
  const none = await householdApex({ read: "standing", args: { bogus: 1 } }, key, STRICT());
  assert.equal(none.defect, 'unknown argument "bogus" for household { read: "standing" }');
  assert.equal(none.hint, "this read takes no arguments");
  // `handle` is this door's standpoint field, exempt at every read exactly as
  // the ACT branch exempts it. A door that refused it here would refuse the
  // one field its own schema tells every multi-resident household to pass.
  const withHandle = await householdApex({ read: "standing", args: { handle: "wright" } }, key, STRICT());
  assert.ok(!withHandle.error, JSON.stringify(withHandle).slice(0, 200));
});

test("PARITY · the door's OWN vocabulary is what is accepted — `view`, not the flat tool's `box`", async () => {
  // Why HOUSEHOLD_READ_FIELDS is declared and not borrowed from `list_mail`:
  // that schema says `box`, this door says `view`, and the door's description
  // teaches `view`. Borrowing would refuse the only spelling it advertises.
  const key = { household: "keemin", handles: new Set(["wright"]) };
  const good = await householdApex({ read: "mail", args: { view: "inbox", limit: 2 } }, key, STRICT());
  assert.ok(!good.error, JSON.stringify(good).slice(0, 200));
  assert.equal(good.box, "inbox");
  const borrowed = await householdApex({ read: "mail", args: { box: "inbox" } }, key, STRICT());
  assert.equal(borrowed.defect, 'unknown argument "box" for household { read: "mail" }',
    "the flat tool's spelling is not this door's, and a door that took both would have two names for one idea");
});

test("PARITY · documented arguments answer exactly as before", async () => {
  const key = { household: "keemin", handles: new Set(["wright"]) };
  const addr = await householdApex({ read: "address" }, key, STRICT());
  assert.equal(addr.of, "wright", "the bare read is untouched");
  const named = await householdApex({ read: "address", args: { handle: "wright" } }, key, STRICT());
  assert.equal(named.of, "wright");
});

test("PARITY · the ACT branch's own validation is unchanged — one door, two branches, one grammar", async () => {
  // The act branch's bounce sentence is older and differently shaped
  // (`update_window does not take: nonsense`). It is deliberately NOT restrung
  // here: frozen consumers read it, and this lane's ruling was about the reads.
  const key = { household: "keemin", handles: new Set(["wright"]) };
  const r = await householdApex({ do: "window", args: { nonsense: 1 } }, key,
    STRICT({ clone: null, schemas: { update_window: { handle: {}, html: {}, blueprint: {} } } }));
  assert.equal(r.code, 422);
  assert.match(r.defect, /does not take: nonsense/);
  assert.ok(r.allowed.includes("html"));
});

test("PARITY · REST's GET is untouched — top-level query fields are still not judged there", async () => {
  // `GET /household` hands this function the WHOLE query string, and bouncing
  // unknown query parameters at a public REST GET is the founder's call, not a
  // lane's (door-parity report, class 4 — browsers append cache-busters). So
  // the skin that does not set `strictFields` keeps answering what it answered.
  // CAN-FAIL: make the validation unconditional and this reddens with a 422.
  const key = { household: "keemin", handles: new Set(["wright"]) };
  const rest = await householdApex({ read: "address", _cachebuster: "1757640000" }, key, { db });
  assert.ok(!rest.error, JSON.stringify(rest).slice(0, 200));
  assert.equal(rest.of, "wright");
  // …and the same call through a skin that DOES speak the apex grammar refuses it.
  const apex = await householdApex({ read: "address", _cachebuster: "1757640000" }, key, STRICT());
  assert.equal(apex.defect, 'unknown argument "_cachebuster" for household { read: "address" }');
});

test("PARITY · an `args:` envelope is judged at EVERY skin, REST included — it is the apex's own grammar", async () => {
  // The half that is not skin-dependent: a caller who typed `args:` is speaking
  // the apex grammar whatever door they came through, and that is the shape the
  // ruling was measured on.
  const key = { household: "keemin", handles: new Set(["wright"]) };
  const r = await householdApex({ read: "address", args: { bogus: 1 } }, key, { db });
  assert.equal(r.defect, 'unknown argument "bogus" for household { read: "address" }');
});

test("PARITY · every readable name has a declared field list, and every declared name is one the branch reads", async () => {
  // THE TWO WAYS THIS TABLE CAN GO WRONG, both caught here rather than by a
  // resident: a read added without a row (its fields would go unjudged), and a
  // row naming a field the branch never looks at (a field accepted and ignored,
  // which is the defect this whole lane closes, reintroduced by the fix).
  const { HOUSEHOLD_READ_FIELDS, HOUSEHOLD_READABLE } = await import("../src/household-apex.mjs");
  const { readFileSync } = await import("node:fs");
  assert.deepEqual([...HOUSEHOLD_READABLE].sort(), Object.keys(HOUSEHOLD_READ_FIELDS).sort(),
    "every read this door advertises declares what it takes");
  const src = readFileSync(new URL("../src/household-apex.mjs", import.meta.url), "utf8");
  const branch = src.slice(src.indexOf("// ── read shadows"), src.indexOf("// ── the act ──"));
  for (const [read, props] of Object.entries(HOUSEHOLD_READ_FIELDS))
    for (const field of Object.keys(props))
      assert.ok(branch.includes(`f.${field}`),
        `${read} declares "${field}" and the read branch never reads f.${field} — a field accepted and ignored is the defect, not the fix`);
});
