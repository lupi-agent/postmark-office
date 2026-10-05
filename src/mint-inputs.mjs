// mint-inputs.mjs — what the stamp mint decides from, read from the store
// (POS-341, ruled by Darko 2026-10-04).
//
// The mint (town tools/stamp-mint.mjs § --append) decides every correspondence
// mint, friendship mint, transfer and void from three inputs:
//
//   the ledger      the recorded lines, their laws and their sealed `registry:`
//                   revisions. In the store: stamp_lines (064, src/stamp-lines.mjs).
//   the key base    "which household shares a cap", from genesis: the pins, then
//                   each room's ADDRESS login, then `solo:<room>`. In the store:
//                   household_pins (019) and town_rooms (065).
//   the deliveries  the mail ledger's delivered letters, `pays:` included. In the
//                   store: town_mail_lines (065).
//
// This file DERIVES the two 065 projections from a town checkout (the ingest's
// half), WRITES them (the ingest calls writeMintInputs in its seed and its
// delta), and READS all three back into the shapes the town's own engine takes
// (the runner's half). The law stays the town's: the runner hands these to the
// engine's own deriveMints, deriveTransfers and walkLedger.
//
// ── TWO THINGS ARE RESTATED HERE, AND THE PARITY GATE HOLDS BOTH ─────────────
//
// `roomRows` restates how householdKeys walks the rooms and reads an ADDRESS
// login, and `keyBaseOf` restates householdKeys' order: a pin first unless the
// ledger sealed that handle before the pin's own date, then the room's login,
// then solo. The engine computes both inside one function over a checkout and
// exports neither half. The ruled gate (world2/tools/stamp-mint-parity.mjs) is
// base(store) = base(file) for every handle plus a replay green with the store
// base injected, so a drift here reds the gate before it reaches a mint.
// The deliveries are NOT restated: the town's parseDeliveries reads the raw
// lines (deliveriesOf).

import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { registryRowsVia } from "./registry-store.mjs";
import { pinsFromRows } from "./registry-rows.mjs";

const digest = (row) => createHash("md5").update(JSON.stringify(row)).digest("hex");

// ── the derivation, from a checkout ──────────────────────────────────────────

/**
 * Every room the mint walks, with the login its ADDRESS names: `[handle,
 * github|null]`, sorted. The walk is householdKeys': every directory under
 * WHITE_PAGES but TEMPLATE and `_` shelves. The login is its reading: the first
 * line anywhere in ADDRESS.md that starts `github:`, its first word,
 * lowercased.
 */
export function roomRows(TOWN) {
  const dir = join(TOWN, "WHITE_PAGES");
  if (!existsSync(dir)) return [];
  const rooms = readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name !== "TEMPLATE" && !e.name.startsWith("_")).map((e) => e.name).sort();
  return rooms.map((room) => {
    const addr = join(dir, room, "ADDRESS.md");
    if (!existsSync(addr)) return [room, null];
    const m = /^github:\s*(\S+)/m.exec(readFileSync(addr, "utf8"));
    return [room, m ? m[1].toLowerCase() : null];
  });
}

/** The mail ledger's entry lines as written: `[seq, line]`, every line that starts `- `, CRLF read as LF. */
export function mailLineRows(TOWN) {
  const p = join(TOWN, "WHITE_PAGES", "mail-ledger.md");
  if (!existsSync(p)) return [];
  return readFileSync(p, "utf8").replace(/\r\n/g, "\n").split("\n")
    .filter((l) => l.startsWith("- ")).map((line, i) => [i + 1, line]);
}

// ── the ingest's write ───────────────────────────────────────────────────────

/**
 * Bring town_rooms and town_mail_lines to the checkout, inside the caller's
 * transaction (the ingest's). Rooms are re-derived whole (a few hundred rows)
 * and written where the digest moved. Mail lines are appended past the held
 * count, after every held line is checked against the checkout. A changed past
 * throws and the caller's transaction writes nothing: the mail ledger is
 * append-only by town law. Returns `{ rooms: { inserted, deleted }, mail_lines: { inserted } }`.
 */
export async function writeMintInputs(client, TOWN) {
  const out = { rooms: { inserted: 0, deleted: 0 }, mail_lines: { inserted: 0 } };

  const want = new Map(roomRows(TOWN).map((r) => [r[0], { row: r, digest: digest(r) }]));
  const held = new Map((await client.query("SELECT handle, digest FROM town_rooms")).rows.map((r) => [r.handle, r.digest]));
  for (const [h, d] of held) {
    if (want.get(h)?.digest === d) continue;
    await client.query("DELETE FROM town_rooms WHERE handle = $1", [h]);
    out.rooms.deleted++;
  }
  for (const [h, { row, digest: d }] of want) {
    if (held.get(h) === d) continue;
    await client.query("INSERT INTO town_rooms (handle, github, digest) VALUES ($1, $2, $3)", [row[0], row[1], d]);
    out.rooms.inserted++;
  }

  const lines = mailLineRows(TOWN);
  const stored = (await client.query("SELECT seq, digest FROM town_mail_lines ORDER BY seq")).rows;
  if (lines.length < stored.length)
    throw new Error(`the mail ledger shrank (${stored.length} lines held, ${lines.length} now): it is append-only by town law. Nothing was written.`);
  for (const { seq, digest: d } of stored)
    if (d !== digest(lines[seq - 1]))
      throw new Error(`the mail ledger's line ${seq} is not the line the store holds: its past changed, and it is append-only by town law. Nothing was written.`);
  const fresh = lines.slice(stored.length);
  for (let i = 0; i < fresh.length; i += 500) {
    const chunk = fresh.slice(i, i + 500);
    await client.query(
      `INSERT INTO town_mail_lines (seq, line, digest)
       SELECT * FROM unnest($1::int[], $2::text[], $3::text[])`,
      [chunk.map((r) => r[0]), chunk.map((r) => r[1]), chunk.map((r) => digest(r))]);
  }
  out.mail_lines.inserted = fresh.length;
  return out;
}

// ── the runner's read ────────────────────────────────────────────────────────

/**
 * The key base and the deliveries' raw lines, as the queryable's store holds
 * them: `{ pins, rooms, mailLines }`. `pins` is the registry fold the drain
 * prints tools/github-ids.json from; `rooms` is a Map(room -> login|null).
 */
export async function mintInputsVia(q) {
  const pins = pinsFromRows(await registryRowsVia(q));
  const rooms = new Map((await q.query(`SELECT handle, github FROM town_rooms ORDER BY handle COLLATE "C"`)).rows.map((r) => [r.handle, r.github]));
  const mailLines = (await q.query("SELECT line FROM town_mail_lines ORDER BY seq")).rows.map((r) => r.line);
  return { pins, rooms, mailLines };
}

/**
 * The earliest sealed `registry:` date per handle, from the ledger's entries
 * (stamp-mint.mjs § sealedRegistryDates, over entries rather than the file).
 */
export function sealedDatesOf(engine, entries) {
  const out = new Map();
  for (const r of engine.parseLaws(entries).revisions) {
    const prev = out.get(r.handle);
    if (!prev || r.date < prev) out.set(r.handle, r.date);
  }
  return out;
}

/**
 * THE KEY BASE, from the store's rows: householdKeys' answer, restated (see the
 * header). A pin with an id keys its handle `gh:<id>`, unless the ledger sealed
 * that handle on or before the pin's own date (the pin is then inert: the
 * ledger outranks the file). Every room not keyed by then takes `login:<login>`
 * from its ADDRESS, or `solo:<room>`, provisional.
 */
export function keyBaseOf({ pins, rooms, sealed }) {
  const map = new Map();
  for (const [handle, rec] of Object.entries(pins ?? {})) {
    if (!rec || !rec.id) continue;
    const line = sealed.get(handle);
    if (line && rec.pinned && rec.pinned >= line) continue;
    map.set(handle, { key: `gh:${rec.id}`, provisional: false });
  }
  for (const room of [...rooms.keys()].sort()) {
    if (map.has(room)) continue;
    const login = rooms.get(room);
    map.set(room, login ? { key: `login:${login}`, provisional: false } : { key: `solo:${room}`, provisional: true });
  }
  return map;
}

/**
 * The deliveries in the raw lines, read by the TOWN'S OWN parseDeliveries. It
 * takes a checkout path, so the lines are written to a scratch checkout's
 * WHITE_PAGES/mail-ledger.md for the one call and the scratch is removed. Not a
 * second reading of the grammar: the engine's own regexes read every line.
 */
export function deliveriesOf(engine, lines) {
  const dir = mkdtempSync(join(tmpdir(), "mint-deliveries-"));
  try {
    mkdirSync(join(dir, "WHITE_PAGES"), { recursive: true });
    writeFileSync(join(dir, "WHITE_PAGES", "mail-ledger.md"), `# Mail ledger\n\n${lines.join("\n")}\n`);
    return engine.parseDeliveries(dir);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
