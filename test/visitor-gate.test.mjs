// visitor-gate.test.mjs — a visitor may open two doors, by verb, through either
// grammar (postmark#2816, 2026-09-15).
//
//   node --test test/visitor-gate.test.mjs
//
// THE INSTANCE. A chat-only applicant filled the browser's Declare form and
// pressed Send. The form sends the apex envelope `household { do: "declare" }`
// (site: src/lib/join-move-in.mjs). The door's visitor gate compared the tool
// name on the wire — "household" — against the two flat names it exempts,
// refused, and said "visitor pass: no address yet … declare_household to found
// your own house" — refusing the act it recommended. No berth, no pin, no PR;
// the Registrar filed it as a silent failure. The harbor gate one block above
// already resolved apex acts to verbs; the visitor gate never did.
//
// The decision is a pure function now, so this file asks it exactly the
// question the browser asks, with the key shape oauth.mjs mints for a
// signed-in account with no household.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { visitorBounces } from "../src/mcp.mjs";

const VISITOR = { ghId: 424242, ghLogin: "some-stranger", household: "some-stranger", handles: new Set(), visitor: true };
const RESIDENT = { household: "house-a", handles: new Set(["alpha"]), visitor: false };
const DECLARE_ARGS = { household: "The New House", handle: "newcomer", address: "A card with words on it.", agent: "Newcomer" };

test("the browser form's declare — household { do: \"declare\" } — is NOT bounced for a visitor", () => {
  assert.equal(visitorBounces("household", { do: "declare", args: DECLARE_ARGS }, VISITOR), false,
    "founding a house is the act a visitor most needs; having no household is its precondition, not a reason to refuse it");
  // ⚑ THE FLIP: compare the wire name instead of the resolved verb and this reads true —
  //   the exact refusal the Registrar reported.
});

test("the two flat verbs stay open to a visitor, as they always were", () => {
  assert.equal(visitorBounces("declare_household", DECLARE_ARGS, VISITOR), false);
  assert.equal(visitorBounces("request_residency", { handle: "newcomer" }, VISITOR), false);
});

test("every other write is still refused to a visitor — flat or through the apex", () => {
  assert.equal(visitorBounces("send_letter", { to: "wright", body: "hi" }, VISITOR), true);
  assert.equal(visitorBounces("household", { do: "profile", args: { bio: "x" } }, VISITOR), true,
    "editing a profile in a house you do not have resolves to update_profile — not one of the two doors");
  assert.equal(visitorBounces("household", { do: "add-resident", args: { handle: "x" } }, VISITOR), false,
    "add-resident resolves to request_residency, the second door — the flat handler decides what a visitor may add, exactly as before");
  assert.equal(visitorBounces("world", { do: "leave-mark", args: { slug: "x" } }, VISITOR), true);
  assert.equal(visitorBounces("town", { do: "stake", args: { mark: "pot/darko-fund", stamps: 1 } }, VISITOR), true);
});

test("reads are never a visitor's problem, and residents are never gated here", () => {
  assert.equal(visitorBounces("household", {}, VISITOR), false, "the bare read the form makes on load");
  assert.equal(visitorBounces("household", { read: "doorstep", handle: "wright" }, VISITOR), false);
  assert.equal(visitorBounces("household", { do: "add-resident", args: { handle: "x" } }, RESIDENT), false,
    "a resident's writes are the other gates' business");
  assert.equal(visitorBounces("send_letter", { to: "wright" }, null), false, "no key: the auth challenge, not this gate");
});

test("the door's gate calls the decision, so the pure answer is the wire's answer", () => {
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "src", "mcp.mjs"), "utf8");
  assert.match(src, /if \(visitorBounces\(name, args, ctx\.key\)\) \{/, "the gate line asks visitorBounces");
  assert.doesNotMatch(src, /name !== "request_residency" && name !== "declare_household" && ctx\.key\?\.visitor/,
    "the old wire-name comparison is gone");
  assert.match(src, /defect: VISITOR_BOUNCE\.defect,\s*hint: VISITOR_BOUNCE\.hint/, "…and the words come from the one constant");
});

// ── THE SWEEP (2026-09-15): the same decision on every door that takes an act ──
test("the town door's acts resolve too: a visitor's town { do: \"post\" } is refused as town_post would be", () => {
  assert.equal(visitorBounces("town", { do: "post", args: { text: "an idea" } }, VISITOR), true);
  assert.equal(visitorBounces("town", { read: "bulletin" }, VISITOR), false, "a town read is a read");
});

test("the REST skin asks the same decision on its two apex routes, with the same words", () => {
  const server = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "src", "server.mjs"), "utf8");
  assert.match(server, /import \{[^}]*visitorBounces[^}]*VISITOR_BOUNCE[^}]*\} from "\.\/mcp\.mjs"/, "server.mjs imports the decision and the words");
  assert.match(server, /visitorBounces\("household", payload, key\)/, "POST /household asks it before the household apex acts");
  assert.match(server, /visitorBounces\("world", payload, key\)/, "POST /world/apex asks it in the do: branch");
  // THREE since POS-70: POST /town/apex is the town verb's plain door, and it
  // asks the same decision in its do: branch, in the same words.
  assert.match(server, /visitorBounces\("town", payload, key\)/, "POST /town/apex asks it in the do: branch");
  assert.equal((server.match(/VISITOR_BOUNCE\.defect, VISITOR_BOUNCE\.hint/g) ?? []).length, 3, "all three routes answer with the one constant's words");
  // ⚑ THE FLIP: drop either route's line and its match reads zero.
});
