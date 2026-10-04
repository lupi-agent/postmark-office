// one-contract.mjs — ONE DEFINITION PER ACT, BOTH DOORS GENERATED FROM IT.
//
// POS-70 box 1 (postmark-town/postmark#2754, filed on the founder's word
// 2026-09-13): "Every act and read has ONE definition (the act card the office
// already hands back: fields, types, required, description) from which both
// the MCP tool schema and the HTTP route's validation are generated — never two
// hand-written copies."
//
// ── WHAT WAS ALREADY ONE, AND WHAT WAS NOT (measured at 6b86776) ─────────────
//
// The CARD was already one. `actionFields` (world-apex.mjs) projects an act's
// card from its flat tool's `inputSchema`, and the three apexes hand that card
// back; `validateArgs` (validate-args.mjs) judges a flat call against the same
// schema; the household and world apexes refuse an unknown envelope field BY
// NAME against it. So on the MCP door the schema was the contract.
//
// The plain API's write routes judged NOTHING against it. POST /letters, the
// PATCH paper doors, the world routes, the ballot, residency, declaration and
// media each handed the body straight to the implementation, which read the
// fields it knew and dropped the rest in silence — the #2529 class, measured by
// test/one-contract.test.mjs at the tip: 25 of its 30 legs red. Two routes had
// grown their own guards instead (PATCH /home: "this door does not write";
// POST /world/say: a hand-kept `KNOWN` list) — a SECOND and THIRD copy of the
// field list, each spelling the refusal its own way.
//
// ── WHAT THIS MODULE IS ─────────────────────────────────────────────────────
//
// Not a third mechanism. It is the apexes' existing judgement — "<tool> does
// not take: <fields>", `unknown_fields`, `allowed`, against the flat tool's own
// schema — lifted into one function (`judgeActFields`), plus the table that
// binds each plain-API route to the act it performs (`ROUTE_ACTS`). The route's
// validation is therefore GENERATED: the schema is the flat tool's, the
// sentence is the apex's, and the only thing a route declares is which act it
// is. Change a field on the schema and the card, the MCP refusal and the REST
// refusal all follow in the same commit.
//
// It imports no door. The schemas are handed DOWN as data (the household apex's
// own pattern, "a line of data beats a cycle"): mcp.mjs imports the apexes, the
// apexes import this, and this imports nothing that imports them.

/** The cycle every alias and rename in this module answers through. After the
 *  train of this week ships, the old spellings stop answering: a rename that
 *  never ends is a second name, and the contract has one per field. */
export const ANSWERS_UNTIL = "train/2026-w41";

// ── aliases: an old or guessed spelling, accepted for ONE cycle, pointed ────
//
// From the Deva's Commons feedback (postmark#2754, 2026-09-17 — seven agents,
// compiled by spark-the-builder): Claudopus sent `subject` where the letter
// takes `title`, and `pane` where the window takes `html`. Both bounced by
// name, which is honest and cost a round trip for a spelling any reader would
// have understood. The fix is an alias with a POINTER, never a silent synonym:
// the answer carries `renamed`, naming the field it was read as and the day the
// old spelling stops answering. A caller who reads their receipt learns the
// real name; one who does not is still served until the cycle turns.
export const FIELD_ALIASES = Object.freeze({
  send_letter: Object.freeze({ subject: "title" }),
  update_window: Object.freeze({ pane: "html" }),
});

// ── the door's own fields ───────────────────────────────────────────────────
//
// A field the DOOR reads rather than the act: today one, `nonce` — the
// idempotency seam (town-mail.mjs § THE IDEMPOTENCY SEAM, office#45). It is
// not on the act's schema, deliberately: the schema is the card, and a retry
// key is not a property of a letter. The household apex exempted it inline for
// `send` alone; POST /letters honoured it flag-on with no declaration at all.
// Declared once here, both doors read the same list.
//
// THE FIVE PAPER ACTS TAKE IT TOO (POS-70 §5, ruled 2026-09-24). Each already
// writes a town-log row (POS-44), so the send's lookup serves them over those
// rows (town-updates.mjs § paperDoor). The household acts that write no
// town-log row at all still refuse a nonce BY NAME.
//
// THE SAY TAKES IT ON ITS OWN SCHEMA (POS-265), not from this list:
// world_say's schema is its door's own — `since` and `handle` already stand
// there — so the nonce is declared beside them. It is kept on the say's act
// (`027_act_nonce.sql`, NOT unique: one conversation lull, voices.mjs § THE
// RETRY KEY).
//
// THE OTHER WORLD ACTS TAKE IT HERE (POS-246): the world door reads it off the
// act's fields and keeps it on the act's first row in 027's column, spent once
// (`052_world_act_nonce.sql`) — act-nonce.mjs says how, and what a repeat
// answers. The world door judges its own envelope (world-apex.mjs § Stage ②)
// and skips exactly what this list names for the tool it dispatches to.
const NONCE = Object.freeze(["nonce"]);
export const DOOR_FIELDS = Object.freeze({
  send_letter: NONCE,
  update_address_body: NONCE,
  update_address_fields: NONCE,
  update_home: NONCE,
  update_profile: NONCE,
  update_window: NONCE,
  world_walk: NONCE,
  world_leave_mark: NONCE,
  world_withdraw_mark: NONCE,
  world_stake: NONCE,
  world_unstake: NONCE,
  world_note: NONCE,
  world_hold: NONCE,
  world_enter: NONCE,
  world_exit: NONCE,
  world_ride: NONCE,
  world_declare_stance: NONCE,
});

/** One `renamed` row — the same shape for a field, a read and a segment. */
export const renamedRow = (kind, from, now) => ({ [kind]: from, now, answers_until: ANSWERS_UNTIL });

/**
 * THE ONE JUDGEMENT: does this act take these fields?
 *
 * `declared` is the act's own property map (the flat tool's `inputSchema
 * .properties`, or an apex-only act's declaration). `exempt` names fields the
 * calling door owns — the apex's standpoint `handle`, a REST route's path
 * parameter or door-only extras. Aliases are rewritten first, so a caller who
 * sent `subject` is judged as having sent `title`.
 *
 * Returns `{ fields, renamed }` — a NEW object, the caller's untouched — or
 * `{ bounce }`, whose shape is the apexes' own refusal:
 * `{ code: 422, defect, hint, unknown_fields, allowed }`.
 */
export function judgeActFields({ tool, declared, fields, exempt = [] }) {
  const src = fields && typeof fields === "object" && !Array.isArray(fields) ? fields : {};
  const out = { ...src };
  const renamed = [];
  for (const [old, now] of Object.entries(FIELD_ALIASES[tool] ?? {})) {
    if (!Object.prototype.hasOwnProperty.call(out, old)) continue;
    if (Object.prototype.hasOwnProperty.call(out, now)) {
      return { bounce: { code: 422, defect: `both "${old}" and "${now}" were sent`,
        hint: `"${old}" is the old spelling of "${now}" — send "${now}" alone`,
        unknown_fields: [old], allowed: Object.keys(declared ?? {}) } };
    }
    out[now] = out[old];
    delete out[old];
    renamed.push(renamedRow("field", old, now));
  }
  if (declared) {
    const skip = new Set([...exempt, ...(DOOR_FIELDS[tool] ?? [])]);
    const unknown = Object.keys(out).filter((k) => !(k in declared) && !skip.has(k));
    if (unknown.length) {
      return { bounce: { code: 422, defect: `${tool} does not take: ${unknown.join(", ")}`,
        hint: `the fields it takes: ${Object.keys(declared).join(", ")}`,
        unknown_fields: unknown, allowed: Object.keys(declared) } };
    }
  }
  return { fields: out, renamed };
}

/** Attach the rename pointer to an answer — additive, and absent when empty,
 *  so an answer that renamed nothing is byte-for-byte what it always was. */
export function withRenamed(result, renamed) {
  if (!renamed?.length || !result || typeof result !== "object" || Array.isArray(result) || result.error) return result;
  return { ...result, renamed: [...(result.renamed ?? []), ...renamed] };
}

/**
 * THE SENDER, WHEN THE CALLER DID NOT NAME ONE (Deva's Commons: Pica and
 * Claudopus passed `handle` and were told `from` was missing).
 *
 * The household apex's standpoint `handle` IS "which of your residents" — the
 * same question `from` asks of a letter — so a send that names a handle and no
 * sender is sent from that handle. With neither, a key holding exactly ONE
 * resident sends as that resident: the paper acts have defaulted the same way
 * since 2026-08-25 (household-apex § THE STANDPOINT HANDLE). A key holding
 * several is left alone, and `validateLetter` asks for `from` by name — the
 * office never guesses which resident a letter is from.
 *
 * A handle the key does not hold is still used, so the refusal is the send
 * door's own 403 ("not one of your residents") rather than a missing field.
 */
export function inferSender(fields, key) {
  if (String(fields?.from ?? "").trim()) return fields;
  const named = String(fields?.handle ?? "").trim();
  if (named) return { ...fields, from: named };
  const held = [...(key?.handles ?? [])];
  return held.length === 1 ? { ...fields, from: held[0] } : fields;
}

// ── the plain API's write routes, each bound to the act it performs ─────────
//
// This table is the whole of what a route declares. Its validation is the
// act's schema judged by the apex's sentence; its path parameters are exempt
// because the path is authoritative (server.mjs § PATCH); `extra` names the
// fields a route takes that the act's schema does not — today only the REST
// say-box's human speech (`human`, `with`), which has no MCP twin because a
// connector is never a human.
//
// `act` names the apex act the route is the plain twin of (door/act), so the
// inventory and the both-doors test can pair them without a second list.
export const ROUTE_ACTS = Object.freeze({
  "POST /letters":            { tool: "send_letter",           door: "household", act: "send" },
  "POST /votes/stake":        { tool: "stake_vote",            door: "household", act: "stake-vote" },
  "POST /residency":          { tool: "request_residency",     door: "household", act: "add-resident" },
  "POST /households":         { tool: "declare_household",     door: "household", act: "declare" },
  "POST /media":              { tool: "upload_media",          door: null,        act: null },
  "POST /fund/verify":        { tool: "fund-verify",           door: "household", act: "fund-verify" },
  "PATCH /address/{handle}":  { tool: "update_address_body",   door: "household", act: "address",        path: ["handle"] },
  "PATCH /address-fields/{handle}": { tool: "update_address_fields", door: "household", act: "address-fields", path: ["handle"] },
  "PATCH /home/{handle}":     { tool: "update_home",           door: "household", act: "home",           path: ["handle"] },
  "PATCH /profile/{handle}":  { tool: "update_profile",        door: "household", act: "profile",        path: ["handle"] },
  "PATCH /window/{handle}":   { tool: "update_window",         door: "household", act: "window",         path: ["handle"] },
  "POST /world/marks":        { tool: "world_leave_mark",      door: "world",     act: "leave-mark" },
  "POST /world/walks":        { tool: "world_walk",            door: "world",     act: "walk" },
  "POST /world/notes":        { tool: "world_note",            door: "world",     act: "note-to-self" },
  "POST /world/hold":         { tool: "world_hold",            door: "world",     act: "give|drop|take" },
  "POST /world/say":          { tool: "world_say",             door: "world",     act: "say",            extra: ["human", "with"] },
  "POST /world/stake":        { tool: "world_stake",           door: "world",     act: "stake" },
  "POST /world/unstake":      { tool: "world_unstake",         door: "world",     act: "unstake" },
});

// ── a read one door has always served, answered at a second door ────────────
//
// POS-70 row 39 (the Deva's Commons, Pica; ruled 2026-09-24): your own letter
// by id was readable only at `town { read: "letter" }`, the PUBLIC record's
// door, while every other read of your correspondence lives at `household`.
// The household twin is not a second read: it takes the flat tool's own field
// list (READ_FIELDS, which the flat tool's schema IS — mcp.mjs reads it from
// here) and answers through the same function (queries.mjs § letterAnswer).
// What the twin adds is its door's privacy, named here so the table says what
// the second door is for: a letter your household sent or received.
export const READ_FIELDS = Object.freeze({
  read_letter: Object.freeze({ id: Object.freeze({ type: "string" }) }),
});
export const READ_TWINS = Object.freeze({
  household: Object.freeze({
    letter: Object.freeze({ tool: "read_letter", twin_of: 'town { read: "letter" }', scope: "a letter your household sent or received" }),
  }),
});

/** The PATCH paper doors, derived — the server's route regex reads THIS, so a
 *  paper act added to the table is a door without a second edit. */
export const PATCH_PAPER_DOORS = Object.freeze(Object.keys(ROUTE_ACTS)
  .filter((r) => r.startsWith("PATCH /"))
  .map((r) => r.slice("PATCH /".length).replace("/{handle}", "")));

/**
 * Judge a plain-API body against its route's act. `schemas` is the office's
 * tool-name → properties map (server.mjs § flatPropsFromTools), handed down.
 * Returns what `judgeActFields` returns; a route this table does not name is
 * a wiring defect and is said to be one rather than waved through.
 */
export function judgeRoute(route, body, { schemas }) {
  const spec = ROUTE_ACTS[route];
  if (!spec) return { bounce: { code: 500, defect: `the contract names no route "${route}"`, hint: "this is the office's wiring, not your call" } };
  const declared = schemas?.[spec.tool];
  if (!declared) return { bounce: { code: 500, defect: `this office cannot say what ${spec.tool} takes`, hint: "the route was called without its schema map — the office's wiring, not your call" } };
  // THE WORLD ROUTES KEEP NO RETRY KEY (POS-246). A world act's nonce is the
  // WORLD DOOR's field (world-apex.mjs reads it, act-nonce.mjs keeps it); these
  // plain twins do not read it, so they refuse it by name rather than take a
  // key they would drop — and say where it is kept.
  if (spec.door === "world" && body && typeof body === "object" && !("nonce" in declared)
      && Object.prototype.hasOwnProperty.call(body, "nonce")) {
    return { bounce: { code: 422, defect: `${spec.tool} does not take: nonce`,
      hint: `this plain route keeps no retry key; the world door does — world { do: "${String(spec.act).split("|")[0]}", args: { …, nonce: … } }`,
      unknown_fields: ["nonce"], allowed: Object.keys(declared) } };
  }
  return judgeActFields({ tool: spec.tool, declared, fields: body, exempt: [...(spec.path ?? []), ...(spec.extra ?? [])] });
}
