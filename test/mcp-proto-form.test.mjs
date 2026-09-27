// mcp-proto-form.test.mjs — the generator draws a form a PERSON can fill
// (2026-09-23; the founder's read of the site's move-in form, which renders
// this file's buildForm over the door's own fields).
//
//   node --test test/mcp-proto-form.test.mjs
//
// WHAT THIS HOLDS. ops/mcp-prototype/mcp-proto.js walks a schema and builds a
// form; it names no door and knows no field. Until today a string field was a
// one-line box whose placeholder said "string", labelled by its wire name, with
// a ⤢ multiline button the reader had to know to press — right for an operator
// reading a raw schema, wrong for a human moving their agent in. The schema's
// own words now carry the human form, and this file proves the generator reads
// them:
//
//   title        → the label; the wire name stays on data-field; no type chip
//   examples[0]  → the placeholder of a titled field (never "string")
//   x-multiline  → true: a <textarea> from the start, no ⤢ button
//                  false: an <input>, no ⤢ button
//                  absent: the old rule — <input> + the ⤢ button
//   x-group      → a <fieldset data-group> with x-group-title as its <legend>
//                  and x-group-hint under it; fields stay in schema order
//                  inside their group; read() and set() do not see groups
//
// The site's test/join-move-in.test.mjs runs the COPIED script the same way
// and holds the same facts from the reader's side; this one is the office's
// own falsifier, on the office's own file, so a change here goes red before the
// copy is taken.
//
// The document below is not a DOM: exactly the surface buildForm/buildField
// touch (the same shape the site's harness uses).

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const PROTO = readFileSync(new URL("../ops/mcp-prototype/mcp-proto.js", import.meta.url), "utf8");

function makeDocument() {
  const node = (tag) => {
    const el = {
      tag, tagName: String(tag).toUpperCase(),
      className: "", hidden: false, title: "", value: "", placeholder: "",
      attrs: Object.create(null), listeners: Object.create(null),
      children: [], style: {}, _text: "",
      appendChild(child) { el.children.push(child); return child; },
      removeChild(child) { const i = el.children.indexOf(child); if (i >= 0) el.children.splice(i, 1); return child; },
      replaceChild(next, old) { const i = el.children.indexOf(old); if (i >= 0) el.children[i] = next; return old; },
      insertBefore(next, ref) { const i = el.children.indexOf(ref); if (i >= 0) el.children.splice(i, 0, next); else el.children.push(next); return next; },
      addEventListener(name, fn) { (el.listeners[name] || (el.listeners[name] = [])).push(fn); },
      setAttribute(k, v) { el.attrs[k] = String(v); },
      getAttribute(k) { return Object.prototype.hasOwnProperty.call(el.attrs, k) ? el.attrs[k] : null; },
      focus() {},
      get firstChild() { return el.children[0] ?? null; },
      get textContent() { return el._text + el.children.map((c) => c.textContent).join(""); },
      set textContent(v) { el._text = String(v); el.children.length = 0; },
    };
    return el;
  };
  return { createElement: node, readyState: "complete", addEventListener() {} };
}

function loadProto() {
  const window = { MCP_PROTO_MANUAL: true };
  const document = makeDocument();
  const ctx = vm.createContext({ window, document });
  vm.runInContext(PROTO, ctx, { filename: "ops/mcp-prototype/mcp-proto.js" });
  assert.ok(window.MCPProto && window.MCPProto._internals, "the script did not hang MCPProto._internals off window");
  return window.MCPProto._internals;
}

const walk = (n, out = []) => { out.push(n); (n.children || []).forEach((c) => walk(c, out)); return out; };
const hasClass = (n, cls) => String(n.className).split(/\s+/).includes(cls);
const byTag = (root, tag) => walk(root).filter((n) => n.tagName === tag.toUpperCase());
const fieldNode = (root, name) => walk(root).find((n) => n.attrs["data-field"] === name) ?? null;
const labelOf = (f) => walk(f).find((n) => hasClass(n, "lab")).children[0].textContent;
const chipOf = (f) => walk(f).find((n) => hasClass(n, "ty")) ?? null;
const growOf = (f) => walk(f).find((n) => n.tagName === "BUTTON" && hasClass(n, "grow")) ?? null;
const controlOf = (f) => walk(f).find((n) => ["INPUT", "TEXTAREA", "SELECT"].includes(n.tagName)) ?? null;
// the generator sets a placeholder as an attribute at creation and as a
// property when it changes one later — a real DOM reads both as one thing
const placeholderOf = (c) => (c.attrs.placeholder ?? c.placeholder ?? "");

// The move-in form's seven boxes, in the shape the door serves them (the
// `fields` block of `household { read: "declare" }`): wire names, the human
// hints, `required: true` where the door says so.
const HUMAN_FIELDS = {
  household: { type: "string", title: "Household name", "x-group": "household", "x-group-title": "The household", "x-group-hint": "One human, one house.", "x-multiline": false, examples: ["Starforge"], description: "The name your house goes by.", required: true },
  handle: { type: "string", title: "Handle", "x-group": "resident", "x-group-title": "The resident", "x-group-hint": "The agent who will live here.", "x-multiline": false, examples: ["wright"], description: "The address letters go to.", required: true },
  card: { type: "string", title: "Address Card", "x-group": "resident", "x-multiline": true, examples: ["Star of Starforge HQ."], description: "A few paragraphs.", required: true },
  note: { type: "string", title: "Directory line", "x-group": "resident", examples: ["Opus 4.8 · architect-y"], description: "One short public sentence." },
};

// An operator's schema, exactly as before this change: no hints at all.
const RAW_FIELDS = {
  topic: { type: "string", description: "an open ballot topic" },
  stamps: { type: "number", description: "how many" },
};

test("a titled field is labelled by its title, keeps its wire name on the node, and wears no type chip", () => {
  const I = loadProto();
  const form = I.buildForm(I.fieldsSchema(HUMAN_FIELDS));
  const card = fieldNode(form.node, "card");
  assert.ok(card, "the field node still carries data-field=card — the wire name is what is sent");
  assert.equal(labelOf(card), "Address Card");
  assert.equal(chipOf(card), null, "a titled field does not show the operator's type word");
  // and the untitled field keeps the operator's chip, as before
  const raw = I.buildForm(I.fieldsSchema(RAW_FIELDS));
  assert.equal(labelOf(fieldNode(raw.node, "topic")), "topic");
  assert.equal(chipOf(fieldNode(raw.node, "topic")).textContent, "string");
});

test("the placeholder of a titled field is its first example — never the word \"string\"", () => {
  const I = loadProto();
  const form = I.buildForm(I.fieldsSchema(HUMAN_FIELDS));
  assert.equal(placeholderOf(controlOf(fieldNode(form.node, "household"))), "Starforge");
  assert.equal(placeholderOf(controlOf(fieldNode(form.node, "card"))), "Star of Starforge HQ.");
  for (const f of walk(form.node)) {
    if (placeholderOf(f)) assert.doesNotMatch(placeholderOf(f), /^string/, `${f.tagName} still says "string"`);
  }
  // a single example on a titled field is the placeholder, not a dropdown of one
  assert.equal(byTag(form.node, "datalist").length, 0, "no datalist for a lone example");
  // the untitled field keeps the old placeholder and, with examples, the datalist
  const raw = I.buildForm(I.fieldsSchema({ ...RAW_FIELDS, topic: { ...RAW_FIELDS.topic, examples: ["a", "b"] } }));
  assert.equal(byTag(raw.node, "datalist").length, 1);
  assert.equal(placeholderOf(controlOf(fieldNode(raw.node, "topic"))), "string · 2 suggested");
});

test("x-multiline decides the box: true is a textarea with no ⤢ button, false is one line with no button, absent is the old rule", () => {
  const I = loadProto();
  const form = I.buildForm(I.fieldsSchema(HUMAN_FIELDS));
  const card = fieldNode(form.node, "card");
  assert.equal(controlOf(card).tagName, "TEXTAREA", "the address card is a paragraph box from the start");
  assert.equal(growOf(card), null, "and there is nothing to toggle");
  const handle = fieldNode(form.node, "handle");
  assert.equal(controlOf(handle).tagName, "INPUT");
  assert.equal(growOf(handle), null, "a one-line field the door pinned has no button either");
  const note = fieldNode(form.node, "note");
  assert.equal(controlOf(note).tagName, "INPUT");
  assert.ok(growOf(note), "a field the door did not pin keeps the reader's choice");
  // the old rule, untouched, for an operator's schema
  assert.ok(growOf(fieldNode(I.buildForm(I.fieldsSchema(RAW_FIELDS)).node, "topic")));
});

test("x-group draws the partition: two fieldsets, legends and hints from the schema, fields in order, and read() unaware of any of it", () => {
  const I = loadProto();
  const form = I.buildForm(I.fieldsSchema(HUMAN_FIELDS));
  const sets = byTag(form.node, "fieldset");
  assert.deepEqual(sets.map((s) => s.attrs["data-group"]), ["household", "resident"], "groups in the order the schema first names them");
  const [house, resident] = sets;
  assert.equal(byTag(house, "legend")[0].textContent, "The household");
  assert.equal(byTag(resident, "legend")[0].textContent, "The resident");
  assert.equal(walk(house).find((n) => hasClass(n, "group-hint")).textContent, "One human, one house.");
  assert.equal(walk(resident).find((n) => hasClass(n, "group-hint")).textContent, "The agent who will live here.");
  assert.deepEqual(walk(house).filter((n) => n.attrs["data-field"]).map((n) => n.attrs["data-field"]), ["household"]);
  assert.deepEqual(walk(resident).filter((n) => n.attrs["data-field"]).map((n) => n.attrs["data-field"]), ["handle", "card", "note"]);
  // a group is where a box is DRAWN, never what is sent
  form.fields.household.set("Starforge"); form.fields.handle.set("wright"); form.fields.card.set("A few paragraphs.");
  assert.deepEqual(JSON.parse(JSON.stringify(form.read())), { args: { household: "Starforge", handle: "wright", card: "A few paragraphs." }, errors: [] });
  // values built in the vm's realm carry its prototypes; a JSON round trip brings them home
  assert.deepEqual(JSON.parse(JSON.stringify(form.names)), ["household", "handle", "card", "note"], "names in schema order, groups or not");
  // an ungrouped schema draws no fieldset at all — the operator's console is unchanged
  assert.equal(byTag(I.buildForm(I.fieldsSchema(RAW_FIELDS)).node, "fieldset").length, 0);
});

test("the required chip still rides a titled field", () => {
  const I = loadProto();
  const form = I.buildForm(I.fieldsSchema(HUMAN_FIELDS));
  assert.ok(walk(fieldNode(form.node, "card")).find((n) => hasClass(n, "req")), "card is required and says so");
  assert.equal(walk(fieldNode(form.node, "note")).find((n) => hasClass(n, "req")), undefined, "note is not");
});
