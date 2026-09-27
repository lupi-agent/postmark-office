#!/usr/bin/env node
// crossing-save.mjs — the save tick.
//
//   node tools/crossing-save.mjs [--at <iso>] [--world <clone>] [--state <dir>]
//                                [--db <path>] [--no-refresh] [--no-commit]
//                                [--prune] [--json]
//   node tools/crossing-save.mjs --check [--window <N>[,<N>…]] [--world <clone>]
//
// `--check` (POS-196) renders the departure record from the REGISTER and diffs
// it against `STATE/log/<N>.jsonl` on disk, on the fields the world repo
// actually reads. It writes nothing. Exit 1 is its verdict, not its health.
//
// The model is a game's save, and THE CROSSING IS THE SAVE TICK — the cadence is
// the town's existing heartbeat, not a new clock. dynamic.db's live layer
// crystallizes up into files in the world repo, so a crash loses at most half a
// crossing of movement.
//
//   STATE/snapshot/<N>/entities.json   state AT THE BOUNDARY of crossing N
//   STATE/log/<N>.jsonl                events DURING crossing N
//   STATE/log/<N>.meta.json            the window that file actually covers
//
// SNAPSHOT-AT-THE-BOUNDARY is the only reading under which snapshot and log
// compose: if the snapshot held save-instant state, replaying the crossing's own
// log over it would apply those events twice. The boundary is also the one
// instant a save and a later reader can both name without negotiating.
//
// TWO THINGS RIDE IN THE SNAPSHOT that a naive save would drop, and replay fails
// without either — the law states them as one sentence ("save the derivation's
// input alongside its output, and the instant it was evaluated"):
//
//   · the governing DEPARTURE RECORD, not just x,y. Position is derived, so a
//     snapshot of coordinates alone is a photograph of a moving thing: it cannot
//     be carried forward to any other instant.
//   · `evaluated_at`. Derived state without its clock is not state, it is a
//     number.
//
// CLOSING THE PREVIOUS CROSSING. A save fires a little after the boundary, so
// the log it last wrote for the outgoing crossing stops at the PREVIOUS save
// instant — leaving the minutes between that and the boundary in no file at all.
// Each run therefore also completes the crossing it just left, when that file is
// incomplete or missing. Every window is derived from its sources, so rewriting
// one is idempotent rather than additive.
//
// WHAT THE LOG CARRIES. Speech goes in whole — the words, the speaker, the
// place, the instant. That is the reading of "full-fidelity replay between any
// two crossings" and of the reason the record exists at all: people often find
// out only later what their agents were up to, and a record of bare timestamps
// could not tell them. It is also why the disclosure ships in this same commit.
// Keeping less than the words is a doctrine change for Keemin's pen, not a flag
// on this tool.
//
// NOT IN THIS SAVE, deliberately and said out loud in the file itself: VESSELS.
// Derived mobility crystallizes with the timetable work; until then the Post
// Office's position stays f(timetable, clock) and is absent from the snapshot
// rather than frozen into it at a stale coordinate.
//
// Deterministic: same store, same instant, same bytes. Nothing here reads a wall
// clock into the payload — every instant in the output is `--at` or derived from
// it, so a save run twice over an unchanged store commits nothing the second
// time.
//
// Env: WORLD_CLONE, TOWN_PUSH=1 to push, BOT_NAME/BOT_EMAIL (penCommit's).

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { penCommit } from "../src/write.mjs";
import { WORLD_CLONE } from "../src/world-store.mjs";
import { openDynamic, putMeta, getMeta } from "../src/dynamic-store.mjs";
import { world2Enabled } from "../src/world2-acts.mjs";
import {
  readDepartureEvents, governingAt, entityFromDeparture, byHandle,
  refreshEntities, readEntities, readAttachments,
  mergedDepartureEvents, walkModule,
} from "../src/dynamic-entities.mjs";
import { DEPARTURE_GAPS, RECORD_READ_FIELDS, storedDepartureEvents } from "../src/world-movement.mjs";
import { emissionsBetween, pruneEmissions } from "../src/dynamic-emissions.mjs";

const argOf = (name, fallback = null) => { const i = process.argv.indexOf(name); return i !== -1 ? process.argv[i + 1] : fallback; };
const flag = (name) => process.argv.includes(name);

const CLONE = resolve(argOf("--world", process.env.WORLD_CLONE ?? WORLD_CLONE));
const STATE_DIR = resolve(argOf("--state", join(CLONE, "STATE")));
const DB_PATH = argOf("--db", null);
const JSON_OUT = flag("--json");

/** Stable bytes: two-space JSON, arrays already ordered by their builders, one trailing newline. */
export const stableJson = (v) => `${JSON.stringify(v, null, 2)}\n`;

const die = (code, gate, detail) => {
  console.error(`\nGATE REFUSED ${gate} — ${detail}`);
  console.error("nothing was written; STATE/ is untouched.");
  process.exit(code);
};

/** The snapshot's entity shape: derived output and the input it came from, flat. */
const snapshotEntity = (e) => ({
  handle: e.handle,
  x: e.x, y: e.y,
  arrived: e.provenance.arrived,
  standing: e.provenance.standing,
  leg_m: e.provenance.leg_m,
  travelled_m: e.provenance.travelled_m,
  remaining_m: e.provenance.remaining_m,
  eta_crossings: e.provenance.eta_crossings,
  departure: e.provenance.departure,
});

/**
 * Build the snapshot for the boundary of `crossing`, and the log lines for one
 * half-open window [from, to). Pure: given the same rows and instants it
 * produces the same objects.
 */
export function buildSave({ crossing, boundaryMs, fromMs, toMs, crossingMs, events, attachments, emissions, walk, asOfWorld }) {
  const entities = [...governingAt(events, boundaryMs).entries()]
    .map(([handle, dep]) => snapshotEntity(entityFromDeparture(handle, dep, boundaryMs, walk)))
    .sort(byHandle);

  const aboardAtBoundary = attachments
    .filter((a) => Date.parse(a.born_at) <= boundaryMs)
    .map(({ entity, target, policy, declared_by, born_at }) => ({ entity, target, policy, declared_by, born_at }))
    .sort((a, b) => (a.born_at === b.born_at ? a.entity.localeCompare(b.entity) : a.born_at.localeCompare(b.born_at)));

  // NOTHING IN A COMMITTED FILE MAY BE MEASURED AGAINST A MOVING TARGET. An
  // earlier draft carried `world_store_fresh` here, and it flipped to false the
  // instant the save's own commit advanced main — so every run rewrote its own
  // snapshot to report a staleness that had not happened. `as_of_world` names
  // the exact commit the ledger was read at, which is a durable fact a reader
  // can check for themselves; freshness is a property of the moment you ask, and
  // it belongs in the run's report and the health surface, not in the record.
  const snapshot = {
    crossing,
    evaluated_at: new Date(boundaryMs).toISOString(),
    grammar: "entities: position derived from the governing departure AT evaluated_at, and that departure travels with it — a snapshot of coordinates alone cannot be moved to another clock",
    as_of_world: asOfWorld,
    omits: ["vessels — derived mobility (position = f(timetable, clock)) is not crystallized at Stage 2; the boat is absent here rather than frozen at a stale coordinate"],
    entity_count: entities.length,
    entities,
    attachment_count: aboardAtBoundary.length,
    attachments: aboardAtBoundary,
  };

  const inWindow = (iso) => { const t = Date.parse(iso); return t >= fromMs && t < toMs; };

  const lines = [
    ...events.filter((ev) => inWindow(ev.at)).map((ev) => ({
      at: ev.at, type: "departure", actor: ev.actor, seq: ev.seq,
      payload: typeof ev.payload === "string" ? JSON.parse(ev.payload) : ev.payload,
    })),
    ...attachments.filter((a) => inWindow(a.born_at)).map((a) => ({
      at: a.born_at, type: "attachment", actor: a.entity, seq: a.seq,
      payload: { target: a.target, policy: a.policy, declared_by: a.declared_by },
    })),
    ...emissions.filter((e) => inWindow(e.born_at)).map((e) => ({
      at: e.born_at, type: "emission", actor: e.source, id: e.id,
      payload: {
        class: e.class, x: e.x, y: e.y,
        ttl_expires_at: e.ttl_expires_at,
        spoken_by: e.props.spoken_by ?? e.source,
        human: Boolean(e.props.human),
        aboard: Boolean(e.props.aboard),
        place: e.props.place ?? null,
        text: e.props.text ?? "",
        class_version: e.props.class_version ?? null,
        radius_m: e.props.radius_m ?? null,
        ttl_min: e.props.ttl_min ?? null,
      },
    })),
  ].sort((a, b) => (a.at === b.at
    ? String(a.id ?? a.seq ?? "").localeCompare(String(b.id ?? b.seq ?? ""))
    : a.at.localeCompare(b.at)));

  const counts = { departure: 0, attachment: 0, emission: 0 };
  for (const l of lines) counts[l.type]++;

  const meta = {
    crossing,
    covers_from: new Date(fromMs).toISOString(),
    covers_to: new Date(toMs).toISOString(),
    complete: toMs >= boundaryMs + crossingMs,
    as_of_world: asOfWorld,
    event_count: lines.length,
    counts,
  };

  return { snapshot, lines, meta };
}

// `crossingMs` is passed in rather than imported: 12 hours has exactly one home
// and it is the world's own tools/walk.mjs, which this pure builder must not
// reach for. (The no-literals law, applied to a duration.)

// ═════════════════════════════════════════════════════════════════════════════
// POS-196 · `--check`: THE RECORD ON DISK AGAINST THE RECORD IN THE REGISTER
// ═════════════════════════════════════════════════════════════════════════════
//
// G1 removes `dynamic.db/movements`, and the departure half of this tool is the
// world repo's ONLY live writer of that record. Before the write may move to
// the register, the two have to be shown to agree — on the fields that are
// actually READ, which is the whole of `movement-records.mjs § storeRecords`
// and its two callers, and not on the fields nobody in that repo opens.
//
// The shape is POS-155's (`world2/tools/state-log-write.mjs --check`): render
// the window, diff it against the file, class every difference, and let an
// UNEXPLAINED one outrank a known gap in the one line a reader gets.
//
// ⚑ IT WRITES NOTHING AND COMMITS NOTHING. `--check` is the instrument Wright
// runs by hand on the box; three windows clean is what earns the swap.
//
// ⚑ THE PAIRING KEY IS `(actor, payload.crossing)`, NOT `at` AND NOT `seq`,
// because those two are exactly the quantities under measurement — pairing on a
// field that is expected to differ reports every line as a pair of orphans and
// the real disagreements drown. `crossing` is safe to pair on because ONE
// variable fills it on both sides: `world.mjs § walkViaOffice` computes
// `fractionalCrossing()` once and hands it to `declareMovement`'s `crossing`
// and to `walkEntry`'s `crossing` alike. Unique across the last ten windows'
// 218 lines, 218 distinct keys.

/** The store-era lines of one `<N>.jsonl`. Era one carries `line_no` and no `source`, and is not this record's half. */
export const storeEraLines = (lines) => lines.filter((l) => {
  const p = l.payload ?? {};
  return p.source === "dynamic.db/movements" || p.source === "acts";
});

const departureKey = (l) => `${l.actor}|${(l.payload ?? {}).crossing}`;

const valueAt = (line, path) => {
  const [head, tail] = path.split(".");
  const v = tail ? (line[head] ?? {})[tail] : line[head];
  return v === undefined ? null : v;
};

/**
 * Two departure lines, field by field. `read` is the verdict that decides the
 * exit code — every field `RECORD_READ_FIELDS` names, compared as bytes
 * (`JSON.stringify`, so `{x,y}` key order counts too). The rest are classed and
 * reported so an operator can see the shape of what is left over.
 */
export function compareDepartureLine(fileLine, derivedLine) {
  const causes = [];
  for (const path of RECORD_READ_FIELDS) {
    const a = JSON.stringify(valueAt(fileLine, path));
    const b = JSON.stringify(valueAt(derivedLine, path));
    if (a !== b) causes.push({ field: path, read: true, file: a, derived: b });
  }
  const gapped = [
    ["seq", fileLine.seq, derivedLine.seq],
    ["payload.declared_by", (fileLine.payload ?? {}).declared_by, (derivedLine.payload ?? {}).declared_by],
    ["payload.note", (fileLine.payload ?? {}).note ?? null, (derivedLine.payload ?? {}).note ?? null],
    ["payload.source", (fileLine.payload ?? {}).source, (derivedLine.payload ?? {}).source],
  ];
  for (const [field, a, b] of gapped) {
    if (JSON.stringify(a) !== JSON.stringify(b)) causes.push({ field, read: false, file: JSON.stringify(a), derived: JSON.stringify(b) });
  }
  return causes;
}

/**
 * Which named gap a difference falls in. Anything this does not recognise is
 * `unexplained`, and that word is the point of the check: a known gap is a cost
 * already measured and written down, and anything else is a finding.
 */
export function gapClassOf(cause) {
  if (cause.field === "at") return "at";
  if (cause.field === "seq") return "seq";
  if (cause.field === "payload.declared_by") return "declared_by";
  if (cause.field === "payload.note") return "note";
  if (cause.field === "payload.source") return "source";
  return "unexplained";
}

/** Pair the two sides on the key, oldest first. Nothing is dropped; an unpaired line on either side is named. */
export function pairDepartures(fileLines, derivedLines) {
  const byKey = new Map(derivedLines.map((l) => [departureKey(l), l]));
  const paired = [], onlyInFile = [];
  for (const f of fileLines) {
    const k = departureKey(f);
    const d = byKey.get(k);
    if (!d) { onlyInFile.push(f); continue; }
    byKey.delete(k);
    paired.push({ key: k, file: f, derived: d });
  }
  return { paired, onlyInFile, onlyInDerived: [...byKey.values()] };
}

/**
 * ONE WINDOW, CHECKED.
 *
 * The horizon is the file's OWN declared window (`<N>.meta.json`'s
 * `covers_from` / `covers_to`), applied to both sides — POS-155's rule, for its
 * reason: the derivation and the file must be cut at the same instant or every
 * line outside the overlap is reported as a finding that is really a boundary.
 *
 * With no meta on disk the crossing's own bounds stand in, and the check says
 * which of the two it used rather than leaving a reader to guess.
 */
export async function checkDepartureWindow({ crossing, stateDir, crossingStartMs, crossingMs }) {
  const logPath = join(stateDir, "log", `${crossing}.jsonl`);
  const metaPath = join(stateDir, "log", `${crossing}.meta.json`);
  if (!existsSync(logPath)) {
    return { crossing, refused: "no-file", detail: `${logPath} does not exist — the record is dark for this crossing`, path: logPath };
  }

  let fromMs = crossingStartMs, toMs = crossingStartMs + crossingMs, horizon = "the crossing's own bounds (no meta on disk)";
  if (existsSync(metaPath)) {
    try {
      const m = JSON.parse(readFileSync(metaPath, "utf8"));
      const a = Date.parse(m.covers_from), b = Date.parse(m.covers_to);
      if (Number.isFinite(a) && Number.isFinite(b)) { fromMs = a; toMs = b; horizon = `${m.covers_from} … ${m.covers_to} (the file's own meta)`; }
    } catch { /* an unreadable meta is not a reason to refuse; the crossing's bounds stand in and the horizon says so */ }
  }

  const all = [], unparsed = [];
  for (const raw of readFileSync(logPath, "utf8").split("\n")) {
    if (!raw.trim()) continue;
    try { all.push(JSON.parse(raw)); } catch { unparsed.push(raw.slice(0, 80)); }
  }
  const fileDepartures = all.filter((l) => l.type === "departure");
  const fileLines = storeEraLines(fileDepartures);
  const ledgerEra = fileDepartures.length - fileLines.length;

  const { events, absent } = await storedDepartureEvents({ atMs: toMs });
  if (absent) return { crossing, refused: "register", detail: absent, path: logPath };

  const inWindow = (iso) => { const t = Date.parse(iso); return t >= fromMs && t < toMs; };
  const derivedLines = events.filter((e) => inWindow(e.at)).map((e) => ({
    at: e.at, type: "departure", actor: e.actor, seq: e.seq,
    payload: typeof e.payload === "string" ? JSON.parse(e.payload) : e.payload,
  }));

  const { paired, onlyInFile, onlyInDerived } = pairDepartures(fileLines, derivedLines);

  const classes = {};
  let firstUnexplained = null, firstKnown = null, firstRead = null;
  const note = (k, text, read) => {
    classes[k] = (classes[k] ?? 0) + 1;
    if (k === "unexplained") { if (!firstUnexplained) firstUnexplained = text; return; }
    if (read && !firstRead) firstRead = text;
    if (!firstKnown) firstKnown = text;
  };
  for (const p of paired) {
    for (const c of compareDepartureLine(p.file, p.derived)) {
      const k = gapClassOf(c);
      note(k, `${p.key} · ${DEPARTURE_GAPS[k] ?? DEPARTURE_GAPS.unexplained} · field ${c.field}: file ${c.file}, register ${c.derived}`, c.read);
    }
  }
  for (const l of onlyInFile) note("unexplained", `${departureKey(l)} · ${DEPARTURE_GAPS.unexplained} · in the file, not in the register`, true);
  for (const l of onlyInDerived) note("unexplained", `${departureKey(l)} · ${DEPARTURE_GAPS.unexplained} · in the register, not in the file`, true);
  for (const raw of unparsed) note("unexplained", `a line the file holds that is not JSON (${raw}) · ${DEPARTURE_GAPS.unexplained}`, true);

  // THE VERDICT IS THE READ FIELDS, and the rank is unexplained → read → known.
  // The `source` stamp differs on every line by construction once the writer
  // moves, so leading with "the first difference in order" would bury the one
  // line a reader needs under a cost the town has already accepted.
  const readEqual = paired.every((p) => !compareDepartureLine(p.file, p.derived).some((c) => c.read))
    && onlyInFile.length === 0 && onlyInDerived.length === 0 && unparsed.length === 0;

  return {
    crossing, path: logPath, horizon,
    file_lines: fileLines.length, ledger_era: ledgerEra, derived_lines: derivedLines.length,
    paired: paired.length, only_in_file: onlyInFile.length, only_in_register: onlyInDerived.length,
    unparsed: unparsed.length,
    read_equal: readEqual,
    read_fields: RECORD_READ_FIELDS,
    classes,
    first_difference: firstUnexplained ?? firstRead ?? firstKnown ?? null,
    // AN EMPTY WINDOW IS NOT CLEAN. Nothing was compared, so nothing was shown,
    // and a check that answers "green, I looked at nothing" is the starving
    // crossing one layer down.
    note: (fileLines.length || derivedLines.length) ? null
      : "the window holds no store-era departures on either side — nothing to compare, which is not the same as equal",
  };
}

/** Every window asked for, and the run's one-word verdict. */
export async function checkDepartures({ crossings, stateDir, crossingStartMs, crossingMs }) {
  const windows = [];
  for (const c of crossings) {
    windows.push(await checkDepartureWindow({ crossing: c, stateDir, crossingStartMs: crossingStartMs(c), crossingMs }));
  }
  const compared = windows.filter((w) => !w.refused && !w.note);
  return {
    windows,
    clean: compared.length > 0 && compared.every((w) => w.read_equal) && windows.every((w) => !w.refused),
    compared: compared.length,
    read_fields: RECORD_READ_FIELDS,
  };
}

const writeIfChanged = (path, text) => {
  mkdirSync(dirname(path), { recursive: true });
  if (existsSync(path) && readFileSync(path, "utf8") === text) return false;
  writeFileSync(path, text, "utf8");
  return true;
};

async function main() {
  if (!existsSync(join(CLONE, "WORLD"))) die(1, "world-clone", `no WORLD/ under ${CLONE} — this is not a world checkout`);

  const atIso = argOf("--at", null);
  const saveMs = atIso ? Date.parse(atIso) : Date.now();
  if (!Number.isFinite(saveMs)) die(2, "save-instant", `unparseable --at: ${atIso}`);

  // The town's own clock arithmetic, from the world's own tools/, read at a ref.
  let walk;
  try { walk = await walkModule({ repo: CLONE }); }
  catch (e) { return die(3, "world-tools", `cannot import the world's tools/walk.mjs (${String(e?.message ?? e).slice(0, 160)})`); }
  const crossingMs = walk.CROSSING_MS;
  const crossingStartMs = (n) => walk.CROSSING_EPOCH_UTC + n * crossingMs;

  const crossing = Math.floor(walk.fractionalCrossing(saveMs));
  const boundaryMs = crossingStartMs(crossing);

  // ── `--check`: READ ONLY, AND IT LEAVES BEFORE ANY STORE IS OPENED ────────
  // The instrument runs against the register and the files on disk. It opens no
  // `dynamic.db`, takes no lock, writes nothing and commits nothing — so it is
  // safe to run on the box while the save's own timer is armed. Its exit code
  // is its VERDICT, not its health: 1 means the two records disagree on a field
  // the world reads, which is a finding and not a fault in the tool.
  if (flag("--check")) {
    const arg = argOf("--window", null);
    const crossings = arg
      ? arg.split(",").map((s) => Number(s.trim())).filter((n) => Number.isFinite(n))
      : [crossing - 1, crossing].filter((n) => n >= 0);
    if (!crossings.length) return die(2, "check-window", `unreadable --window: ${arg}`);
    const out = await checkDepartures({ crossings, stateDir: STATE_DIR, crossingStartMs, crossingMs });
    if (JSON_OUT) console.log(stableJson(out));
    else {
      for (const w of out.windows) {
        if (w.refused) { console.log(`crossing ${w.crossing}: REFUSED ${w.refused} — ${w.detail}`); continue; }
        console.log(`crossing ${w.crossing}: ${w.read_equal ? "EQUAL" : "DIFFERS"} on the read fields — ` +
          `${w.paired} paired, ${w.file_lines} in the file (${w.ledger_era} era one), ${w.derived_lines} in the register`);
        console.log(`  horizon: ${w.horizon}`);
        if (w.note) console.log(`  ${w.note}`);
        for (const [k, n] of Object.entries(w.classes)) console.log(`  ${n} × ${DEPARTURE_GAPS[k] ?? k}`);
        if (w.first_difference) console.log(`  first: ${w.first_difference}`);
      }
      console.log(`\n${out.clean ? "CLEAN" : "NOT CLEAN"} — ${out.compared} window(s) compared on ${out.read_fields.join(", ")}`);
    }
    process.exit(out.clean ? 0 : 1);
  }

  const db = openDynamic(DB_PATH ?? undefined);

  // The store and the save must share ONE clock, or the replay check compares
  // two different worlds and calls the difference a finding.
  let refresh = null;
  if (!flag("--no-refresh")) {
    refresh = await refreshEntities({ db, repo: CLONE, at: saveMs, walk });
    if (!refresh.ok) { db.close(); return die(4, refresh.refused.gate, refresh.refused.detail); }
  }

  const read = readDepartureEvents({ repo: CLONE });
  if (read.refused) { db.close(); return die(4, read.refused.gate, read.refused.detail); }

  // STAGE D: the walk ledger is frozen with honor and `STATE/log/` becomes the
  // movement record, so a departure declared after the seam reaches the save
  // from the store rather than from world.db's hydrated ledger. Both eras go
  // into ONE ordered list before anything is built, so the log lines, the
  // snapshot's governing departures and the replay all read one vocabulary and
  // the seam is invisible to every one of them.
  //
  // ── THE RECORD IS WRITTEN FROM THE REGISTER (POS-196's held swap, POS-156) ─
  //
  // This read was `readMovements(db)` — `dynamic.db/movements`, the
  // REVERSE-MIRROR copy G1 removes, and the source stamped on all 2,857 of the
  // record's store-era lines. It is `storedDepartureEvents` now: the same
  // departures rendered from `acts`, in this file's own `events` row shape, so
  // `mergedDepartureEvents`, `buildSave` and every replay read one vocabulary
  // and the swap is a change of WRITER, not of meaning. The rendered lines are
  // stamped `"source":"acts"` — the one allowed diff, which no world reader
  // reads (`RECORD_READ_FIELDS`).
  //
  // POS-196 built this renderer and held the swap on one measured STOP: the
  // register had no departure INSTANT, and `at` is the first field every world
  // reader reads and the key `mergedRecords` orders and cuts on. POS-198 closed
  // it — one clock read in `walkViaOffice`, handed to both pens.
  //
  // ⚑ `absent` IS A REFUSAL HERE, never an empty list. The thing this tool
  // would otherwise commit is a PUBLIC FILE: an unreachable register that read
  // as `[]` would write a window holding only the frozen era over a good one
  // and push it. `world2Enabled()` false is the other case and it is not a
  // failure — an office pointed at no register has no live era at all, exactly
  // as `movementV2Enabled()` false meant before.
  let storeMovements = [];
  if (world2Enabled()) {
    const stored = await storedDepartureEvents({ atMs: saveMs });
    if (stored.absent) { db.close(); return die(4, "register", stored.absent); }
    storeMovements = stored.events;
  }
  const departureEvents = storeMovements.length ? mergedDepartureEvents(read.events, storeMovements) : read.events;

  const attachments = readAttachments(db);
  const allEmissions = emissionsBetween(db, new Date(0).toISOString(), new Date(saveMs).toISOString());

  const written = [];
  const saves = [];

  // 1. Close the crossing we have just left, if its file is short or missing.
  //    Bounded to one step back: a box down for days is an operator's problem,
  //    not something a save should quietly paper over by inventing history.
  const prev = crossing - 1;
  if (prev >= 0) {
    const prevMeta = join(STATE_DIR, "log", `${prev}.meta.json`);
    let prevComplete = false;
    if (existsSync(prevMeta)) {
      try { prevComplete = Date.parse(JSON.parse(readFileSync(prevMeta, "utf8")).covers_to) >= boundaryMs; }
      catch { prevComplete = false; }
    }
    if (!prevComplete) {
      saves.push(buildSave({
        crossing: prev, boundaryMs: crossingStartMs(prev),
        fromMs: crossingStartMs(prev), toMs: boundaryMs, crossingMs,
        events: departureEvents, attachments, emissions: allEmissions, walk,
        asOfWorld: read.as_of_world,
      }));
    }
  }

  // 2. The crossing we are in, up to the save instant.
  saves.push(buildSave({
    crossing, boundaryMs,
    fromMs: boundaryMs, toMs: saveMs, crossingMs,
    events: departureEvents, attachments, emissions: allEmissions, walk,
    asOfWorld: read.as_of_world,
  }));

  // The pen stands on main before it writes. The clone is shared with the write
  // pen, which parks it on household draft branches; the walk ledger once lost
  // 17 public lines to exactly that.
  try { execFileSync("git", ["-C", CLONE, "switch", "-q", "main"], { encoding: "utf8" }); }
  catch (e) { db.close(); return die(5, "world-main", `the world clone would not stand on main (${String(e?.message ?? e).slice(0, 160)})`); }
  if (process.env.TOWN_PUSH === "1")
    try { execFileSync("git", ["-C", CLONE, "pull", "--rebase", "-q"], { encoding: "utf8" }); } catch { /* offline or behind — save locally */ }

  for (const s of saves) {
    const snapPath = join(STATE_DIR, "snapshot", String(s.snapshot.crossing), "entities.json");
    const logPath = join(STATE_DIR, "log", `${s.meta.crossing}.jsonl`);
    const metaPath = join(STATE_DIR, "log", `${s.meta.crossing}.meta.json`);
    if (writeIfChanged(snapPath, stableJson(s.snapshot))) written.push(snapPath);
    if (writeIfChanged(logPath, s.lines.map((l) => JSON.stringify(l)).join("\n") + (s.lines.length ? "\n" : ""))) written.push(logPath);
    if (writeIfChanged(metaPath, stableJson(s.meta))) written.push(metaPath);
  }

  // ── THE PASSAGES ARE NOT WRITTEN HERE. THEY ARE NOT WRITTEN ANYWHERE (#2152)
  //
  // This is where the save used to emit `WORLD/enter-exit-ledger.md` and its
  // retired twin into the clone, and it was one of the two pens that had to go.
  //
  // The world repo's own law says what the committed copy is, quoted verbatim
  // from `tools/enter-exit-record.test.mjs` over there:
  //
  //     "the world repo has no journal to read — a longer derived file means a
  //      hand wrote in it"
  //
  // The committed file is the FROZEN ERA exactly, 155 act-lines, and it stays
  // that way. Every passage since the 2026-08-24 cutover lives in the office
  // journal, and the READ derives the live era on every request
  // (`servedEnterExitLedger`, the `/world/enter-exit-ledger` door, and the
  // viewer through it). Nothing is lost by not writing: the record the town
  // reads is complete, and it was complete before this line was deleted.
  //
  // What the emit actually did was bake live-era lines into the committed file
  // during passage activity, which put the world's grammar suite in the red —
  // and a red grammar suite costs the settlement sweep its isolation, which
  // refuses the whole crossing. Three hand-repairs on world main before both
  // pens were named. The other pen was `materializeLedgers` in
  // `src/world-drain.mjs`; it now filters these ledgers out explicitly.
  //
  // (World 2.0's database migration supersedes this seam. Until then the
  // passage record has exactly one writer, and it is the reader.)
  //
  // ── AND THE REPORT'S COUNT IS GONE TOO (G1 / POS-156, 2026-09-22) ────────
  //
  // What remained here was a READ: `enterExitLedgerText(CLONE, readJournal(db))`,
  // counted for the report so the operator could see the record moving. Its
  // source was the sqlite journal's frame rows, and G1 deletes the INSERT that
  // filled them — so the number it printed would be the FROZEN ERA's 155 lines
  // on every run for ever, a count that cannot move, reported as "the record
  // moving". A stale instrument is worse than none: it answers.
  //
  // It is deleted rather than re-pointed. The live era HAS a reader and it is
  // not this tool: POS-194 moved `servedEnterExitLedger` onto `acts`
  // (`enter-exit-ledger.mjs § livePassageRows`), and the
  // `/world/enter-exit-ledger` door and the viewer read it there. A second
  // count derived on the save's own clock would be a second answer to a
  // question that already has an owner.

  // A STATE directory outside the clone is a legitimate thing to write (tests
  // do it), but it is not something the pen can commit — and a save that
  // reported a commit it never made would poison the prune's gate.
  const inClone = resolve(STATE_DIR).toLowerCase().startsWith(resolve(CLONE).toLowerCase());

  let commit = null, committed = false, pushed = false, push_error = null;
  if (!flag("--no-commit") && inClone) {
    const last = saves.at(-1);
    // STATE, and only STATE. The passage record used to ride this commit; it is
    // derived now and no longer belongs to any pen (#2152, above).
    commit = penCommit(CLONE, [join(STATE_DIR)],
      `crossing-save ${last.meta.crossing}: ${last.snapshot.entity_count} entities, ${saves.reduce((n, s) => n + s.meta.event_count, 0)} events`);
    committed = true;                      // the ceremony ran; `null` means nothing had changed
    if (process.env.TOWN_PUSH === "1" && commit) {
      try { execFileSync("git", ["-C", CLONE, "push", "-q", "origin", "main"], { encoding: "utf8" }); pushed = true; }
      catch (e) { push_error = String(e?.message ?? e).slice(0, 200); }
    }
  }

  // `logged_through` is the prune's gate, so it is stamped ONLY when the
  // occurrences actually reached the record. --no-commit leaves it alone: files
  // in a working tree are not the town's memory, and a prune trusting them could
  // drop speech a `git clean` was about to erase.
  let prune = null;
  if (committed) {
    putMeta(db, "logged_through", new Date(saves.at(-1).meta.covers_to).toISOString());
    putMeta(db, "last_crossing_saved", String(saves.at(-1).meta.crossing));
    putMeta(db, "last_save_at", new Date(saveMs).toISOString());
    putMeta(db, "last_save_commit", commit);
    if (flag("--prune")) prune = pruneEmissions(db, { atMs: saveMs });
  }

  const report = {
    crossing,
    saved_at: new Date(saveMs).toISOString(),
    state_dir: STATE_DIR,
    crossings_written: saves.map((s) => ({
      crossing: s.meta.crossing,
      covers_from: s.meta.covers_from, covers_to: s.meta.covers_to, complete: s.meta.complete,
      entities: s.snapshot.entity_count, attachments: s.snapshot.attachment_count,
      events: s.meta.event_count, counts: s.meta.counts,
    })),
    files_changed: written,
    commit, pushed, push_error,
    logged_through: getMeta(db, "logged_through"),
    entities_refreshed: refresh ? { count: refresh.entities, mid_walk: refresh.mid_walk, as_of: refresh.as_of } : null,
    source: { as_of_world: read.as_of_world, hydrated_at: read.hydrated_at, fresh: read.fresh },
    disclosed: read.disclosed,
    // THE PASSAGES, COUNTED AND NOT WRITTEN (#2152). The save no longer folds
    // this record into the repo — it is derived on every read — but it still
    // says how many acts the read would serve, because a number that stops
    // moving is how the two-day staleness was finally noticed, and losing the
    // number would be trading one silence for another.
    enter_exit_ledger: { written: false, where: "derived at read time from the frozen era + the REGISTER (POS-194, `livePassageRows`); the committed copy is the frozen era by the world repo's own law (#2152). The `derived_acts` count this used to carry read the sqlite journal and went with G1 — ask the door, which owns that derivation" },
    prune,
  };
  db.close();

  if (JSON_OUT) { console.log(JSON.stringify(report, null, 2)); return; }
  console.log(`crossing-save · crossing ${crossing}  (saved at ${report.saved_at})`);
  for (const c of report.crossings_written)
    console.log(`  ${String(c.crossing).padStart(5)}  ${c.covers_from} → ${c.covers_to}  ${c.complete ? "COMPLETE" : "open"}`
      + `  ${c.entities} entities · ${c.events} events (${c.counts.departure}d ${c.counts.attachment}a ${c.counts.emission}e)`);
  console.log(`  files    ${written.length ? written.length + " changed" : "no change — the save is idempotent"}`);
  console.log(`  commit   ${commit ?? (flag("--no-commit") ? "skipped (--no-commit)" : (inClone ? "nothing to commit" : "skipped — STATE/ is outside the world clone"))}${pushed ? " · pushed" : ""}${push_error ? ` · PUSH FAILED: ${push_error}` : ""}`);
  console.log(`  world    ${String(read.as_of_world).slice(0, 12)} hydrated ${read.hydrated_at}${read.fresh === false ? "  (the walk ledger has MOVED since — disclosed in this report)" : ""}`);
  console.log("  passages · NOT written — the save has no pen here (#2152); the derived record is the door's (GET /world/enter-exit-ledger)");
  for (const d of read.disclosed) console.log(`  DISCLOSED ${d}`);
  if (prune) console.log(`  prune    ${prune.refused ?? `${prune.pruned} faded emission(s) dropped (occurrence saved through ${prune.horizon})`}`);
}

if (process.argv[1]?.endsWith("crossing-save.mjs")) {
  main().catch((e) => { console.error(`crossing-save tripped: ${String(e?.stack ?? e)}`); process.exit(9); });
}
