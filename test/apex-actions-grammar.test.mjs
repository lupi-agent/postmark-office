// apex-actions-grammar.test.mjs — one grammar, two apexes.
//
//   node --test test/apex-actions-grammar.test.mjs
//
// The site's procedural affordance is gated on a SHAPE, deliberately: no action
// name, tool name or door is known downstream. The gate is three conditions
// (ops/mcp-prototype/mcp-proto.js) —
//
//   1. an array named `actions` OR `acts`, anywhere in the payload
//   2. whose entries carry the matching name key (`action` / `act`, a
//      non-empty string) and `fields` (a plain object)
//   3. on a tool whose own inputSchema declares the do: + args: envelope
//
// TWO SPELLINGS, ONE GRAMMAR (Keemin-ruled 2026-08-25): the world speaks
// `actions` — class-granted, read where you stand — while household and town
// speak `acts`, the door's own fixed verbs. For one release the household and
// town answers carried both keys as aliases; the walker learned `acts` and
// the duplicate retired.
//
// THESE FALSIFIERS RUN THE PROTOTYPE'S OWN CODE. `collectActions` and
// `apexEnvelope` are lifted out of mcp-proto.js by source slice and evaluated
// here, rather than reimplemented — a local copy of a gate is a second gate,
// and the drift it hides is exactly the drift this round exists to close. If
// either function is renamed or rewritten, the slice fails and this file goes
// red, which is the correct answer: the grammar changed and the doors have not
// been re-checked.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { householdApex, HOUSEHOLD_DISPATCHABLE, HOUSEHOLD_TOOL } from "../src/household-apex.mjs";
import { actionFields, STANDPOINT_PARAMS } from "../src/world-apex.mjs";
import { TOOLS } from "../src/mcp.mjs";
import { indexStore } from "./helpers/office-under-test.mjs";

// The doors below run in this process. They never had a town index, and the
// office will not run without one (POS-268): this file's is an empty store.
const IX = await indexStore(null);
const IX_RESTORE = await IX.useInProcess();
test.after(async () => { await IX_RESTORE(); await IX.stop(); });

const PROTO = readFileSync(new URL("../ops/mcp-prototype/mcp-proto.js", import.meta.url), "utf8");

/** One top-level `function NAME(...) { … }` lifted whole, by brace balance. */
function liftFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `the prototype no longer declares ${name} — the gate moved and these tests must be re-aimed`);
  let depth = 0, i = source.indexOf("{", start);
  for (let j = i; j < source.length; j++) {
    if (source[j] === "{") depth++;
    else if (source[j] === "}" && --depth === 0) {
      // eslint-disable-next-line no-new-func
      return new Function(`return (${source.slice(start, j + 1)});`)();
    }
  }
  throw new Error(`unbalanced braces lifting ${name}`);
}

const collectActions = liftFunction(PROTO, "collectActions");
const apexEnvelope = liftFunction(PROTO, "apexEnvelope");

const key = () => ({ household: "testers", handles: new Set(["tester"]) });

// THE REAL SCHEMA MAPS, built exactly as the two doors build them (mcp.mjs §
// flatPropsMap / flatRequiredMap, server.mjs § its twin). An earlier draft of
// this file passed `{}` for both, and three flips went green through it: with no
// tool schemas the paper acts have no fields at all, so "handle is stripped" and
// "the fields are generated" were true of an empty object and would have stayed
// true however the generator broke. A fixture that cannot tell right from broken
// is not a fixture.
const schemas = Object.fromEntries(TOOLS.map((t) => [t.name, t.inputSchema?.properties ?? {}]));
const schemaRequired = Object.fromEntries(TOOLS.map((t) => [t.name, t.inputSchema?.required ?? []]));
// No world store: what these prove is the grammar, not a rich class layer.
const ctx = { db: null, schemas, schemaRequired };
const bare = () => householdApex({}, key(), ctx);

// ── the gate, all three conditions, against the real answer ─────────────────

test("the bare household answer passes the prototype's own affordance gate", async () => {
  const answer = await bare();

  // 1 + 2 — the prototype's walker, unmodified, over the actual payload.
  const found = collectActions(answer);
  assert.ok(found.length > 0, "collectActions found nothing — the answer is still speaking a dialect");
  assert.equal(found.length, HOUSEHOLD_DISPATCHABLE.length,
    `every dispatchable act must reach the strip (${HOUSEHOLD_DISPATCHABLE.length} acts, ${found.length} collected)`);
  assert.deepEqual(found.map((e) => e.action).sort(), [...HOUSEHOLD_DISPATCHABLE].sort());

  // 3 — the envelope, off this tool's own published schema.
  assert.deepEqual(apexEnvelope(HOUSEHOLD_TOOL), { doKey: "do", argsKey: "args" },
    "the do:/args: envelope must be declared on the tool, or the prefill has nowhere to land");
});

test("the three conditions, named literally, so a dialect drift says which one broke", async () => {
  const answer = await bare();

  // 1 — an array NAMED acts (the door's own word; `actions` is the world's).
  assert.ok(Array.isArray(answer.acts), "condition 1: `acts` must be an array on the answer");

  // 2 — entries carrying act + fields, in the walker's exact terms.
  for (const e of answer.acts) {
    assert.equal(typeof e.act, "string", "condition 2: `act` is a string");
    assert.ok(e.act.length > 0, "condition 2: `act` is non-empty");
    assert.equal(typeof e.fields, "object", "condition 2: `fields` is an object");
    assert.notEqual(e.fields, null, "condition 2: `fields` is not null");
    assert.equal(Array.isArray(e.fields), false, "condition 2: `fields` is not an array");
  }

  // 3 — the envelope's two properties, by type, as apexEnvelope reads them.
  const p = HOUSEHOLD_TOOL.inputSchema.properties;
  assert.equal(p.do?.type, "string", "condition 3: a do:-shaped string property");
  assert.equal(p.args?.type, "object", "condition 3: an args:-shaped object property");
});

test("both spellings pass the gate; half-shapes are still REFUSED", () => {
  // The two lawful grammars (Keemin-ruled 2026-08-25): the world's
  // `actions`/`action` and the door's `acts`/`act`. Both collect, and both
  // normalize to `.action` so downstream keeps one key.
  const world = collectActions({ actions: [{ action: "walk", fields: { to: {} } }] });
  assert.equal(world.length, 1);
  assert.equal(world[0].action, "walk");
  const door = collectActions({ acts: [{ act: "home", fields: { body: {} } }] });
  assert.equal(door.length, 1);
  assert.equal(door[0].action, "home", "an `acts` entry normalizes to `.action` for the strip");
  // The TRULY old shape — fields missing — must still not pass, or the gate
  // proves nothing. Half-shapes refused under either spelling.
  assert.equal(collectActions({ acts: [{ act: "home", blurb: "…" }] }).length, 0, "act without fields");
  assert.equal(collectActions({ actions: [{ action: "home" }] }).length, 0, "action without fields");
  assert.equal(collectActions({ actions: [{ fields: {} }] }).length, 0, "fields without a name");
  assert.equal(collectActions({ acts: [{ fields: {} }] }).length, 0, "fields without a name, acts spelling");
  assert.equal(collectActions({ actions: [{ action: "home", fields: [] }] }).length, 0, "fields must not be an array");
  assert.equal(collectActions({ acts: [{ act: "home", fields: [] }] }).length, 0, "fields must not be an array, acts spelling");
  // And an entry does not pass by wearing the OTHER spelling's name key.
  assert.equal(collectActions({ acts: [{ action: "home", fields: {} }] }).length, 0, "an acts array is read by `act`, never `action`");
});

// ── the fields are real, and come from the world apex's own path ────────────

test("every act's fields are generated, never empty-by-accident", async () => {
  const answer = await bare();
  const at = (a) => answer.acts.find((e) => e.act === a);

  // begin/declare read DECLARE_SCHEMA, and its three required fields must be
  // marked — an unmarked required field is the prefill offering a form that
  // cannot be submitted.
  for (const act of ["begin", "declare"]) {
    const f = at(act).fields;
    for (const name of ["household", "handle", "card"]) {
      assert.equal(f[name]?.required, true, `${act}.${name} must be marked required`);
    }
    assert.equal(f.note?.required, undefined, "an optional field is not marked");
  }

  // The apex-only acts have no flat tool to borrow from — their own schema is
  // the source, and it must describe rather than merely exist.
  const stake = at("stake").fields;
  assert.deepEqual(Object.keys(stake).sort(), ["from", "pot", "preview", "stamps"]);
  assert.equal(stake.stamps.type, "number");
  assert.equal(stake.from.required, true);
  assert.ok(stake.pot.description.length > 0, "a field with no description teaches nothing");
  // POS-83's opt-in, and the grammar has to carry it or the unknown-field
  // validator refuses a preview by name on the one act with no flat tool to
  // borrow the field from. Described, like every other field on this card.
  assert.equal(stake.preview.type, "boolean");
  assert.equal(stake.preview.required, undefined, "the founder ruled opt-in, not a forced two-step");
  assert.ok(stake.preview.description.length > 0, "a field with no description teaches nothing");

  // The paper acts borrow their fields from the flat tool they dispatch to, and
  // those must arrive non-empty — an empty `fields` block does not read as "the
  // office has nothing to tell you", it reads as THIS ACT TAKES NO ARGUMENTS
  // (the world apex's own words, its flatSchemas comment).
  for (const act of ["address", "home", "profile", "window"]) {
    const f = at(act).fields;
    assert.ok(Object.keys(f).length > 0, `${act} must carry the fields its flat tool declares`);
  }
  assert.ok("body" in at("home").fields, "home's body is the thing a caller actually writes");
  // And the borrowed fields must arrive MARKED, not merely copied: these
  // requirements live in the flat tools' own `required` lists, so a generator
  // that forwards properties and drops the required pass shows up right here.
  assert.equal(at("address").fields.body.required, true, "update_address_body requires body");
  assert.equal(at("add-resident").fields.handle.required, true, "request_residency requires handle");
  assert.equal(at("home").fields.body.required, undefined, "update_home does not require body — and the grammar must not say it does");
  // #2921 (2026-09-18): window's html stopped being required the day file_path
  // arrived — the pane rides as ONE of the two, and the door refuses none-of and
  // both-of by name (edit.mjs § paneSourceOf), the way upload_media's three
  // inputs are. This line used to assert `html.required === true`; a grammar
  // that still marked html required would refuse a lawful file_path call.
  assert.equal(at("window").fields.html.required, undefined, "update_window does not require html — file_path is the other road");
  assert.equal(at("window").fields.file_path.type, "string", "file_path is on the card");
  assert.match(at("window").fields.file_path.description, /your own house/, "and it says whose house it reads");

  assert.equal(at("fund-verify").fields.txhash.required, true);
  assert.equal(at("fund-verify").fields.handle.required, undefined,
    "the patron handle is optional on fund-verify, and the grammar must not invent a requirement");
});

test("the standpoint handle is stripped where the standpoint answers it — and ONLY there", async () => {
  const answer = await bare();
  const at = (a) => answer.acts.find((e) => e.act === a);

  // The four paper acts: `handle` is "which of YOUR residents", already settled
  // by the apex's own top-level parameter.
  for (const act of ["address", "home", "profile", "window"]) {
    assert.equal("handle" in at(act).fields, false,
      `${act} must not offer a second way to answer what the standpoint settled`);
  }
  // Everywhere else it is the act's OWN argument and must survive: on declare it
  // is the resident being founded — a required field. Stripping it globally, as
  // the world apex does, would hide it.
  assert.equal(at("declare").fields.handle?.required, true,
    "declare's handle is the resident being founded, not a standpoint");
  assert.ok("handle" in at("fund-verify").fields,
    "fund-verify's handle is the patron being credited");
  assert.equal(at("add-resident").fields.handle?.required, true,
    "add-resident's handle is the resident being added — required, and stripping it would hide the whole act");
});

test("the fields come from the world apex's actionFields, not a second copy", () => {
  // The shared path, exercised directly: same stripping, same required marking.
  const props = { body: { type: "string" }, handle: { type: "string" }, x: { type: "number" } };
  assert.deepEqual(actionFields(props, ["body"]), { body: { type: "string", required: true }, x: { type: "number" } },
    "the world door's own standpoint set strips handle, and marks the required one");
  assert.deepEqual(Object.keys(actionFields(props, [], { strip: new Set() })).sort(), ["body", "handle", "x"],
    "and a caller with a different standpoint says so, rather than getting the world's");
  // x and y are NOT standpoint any more — the walk round freed them, because at
  // an embodied-only apex they had stopped meaning "from where" and were eating
  // walk's destination out of its own card. Pinned here because this test is one
  // of the two readers of that set, and a silent re-widening would change what
  // the household door strips without touching the household door.
  assert.deepEqual([...STANDPOINT_PARAMS], ["handle"]);
});

// ── the richness that was already there is still there ──────────────────────

test("the teaching prose survives the grammar, beside the quoted law", async () => {
  const answer = await bare();
  const home = answer.acts.find((e) => e.act === "home");
  assert.match(home.teaches, /Tend your HOME page/,
    "the office's own how-to sentence must ride every entry — it used to appear only when the residue failed to resolve");
  assert.ok(home.blurb.length > 0, "and the blurb is still there");
  assert.equal(home.dispatches_to, "update_home", "and the target it becomes");
});

test("the duplicate is dead: `actions` no longer rides the household answer", async () => {
  const answer = await bare();
  assert.equal("actions" in answer, false,
    "one key, `acts` — the alias era lasted one release and is over");
  // The walker still finds every act exactly once, through the acts spelling.
  const seen = collectActions(answer).map((e) => e.action);
  assert.equal(seen.length, HOUSEHOLD_DISPATCHABLE.length, "every act collected through `acts`");
  assert.equal(new Set(seen).size, seen.length, "no act appears twice in the strip");
});

test("the act ANSWER's card speaks the same grammar, one key", async () => {
  const r = await householdApex({ do: "declare", args: { household: "H", handle: "h", card: "c" } }, key(),
    { ...ctx, clone: null, canWrite: false });
  // The act itself fails here (no clone) — the card rides the answer either way,
  // which is the point: the law is shown at the door whatever the outcome.
  assert.equal(r.card.act, "declare", "the door's own key, and the only one");
  assert.equal("action" in r.card, false, "the alias-era `action` key is retired from the card");
  assert.equal(typeof r.card.fields, "object");
  assert.equal(r.card.fields.household.required, true);

  // And on an act whose fields come from the CONTEXT rather than from
  // DECLARE_SCHEMA — otherwise a card built without the schema maps still looks
  // right here, because declare carries its own schema and hides the omission.
  const paper = await householdApex({ do: "home", args: { body: "x" } }, key(),
    { ...ctx, clone: null, canWrite: false });
  assert.equal(paper.card.act, "home");
  assert.ok("body" in paper.card.fields,
    "the card's fields must come through the same context the bare read uses");
});
