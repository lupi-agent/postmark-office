#!/usr/bin/env node
// g1-dev-proof.mjs — THE ONE CROSSING ON DEV: do the doors round-trip through
// the store with no journal row behind them?
//
//   node tools/g1-dev-proof.mjs --base https://dev.postmark.town --key-env PM_DEV_KEY
//
// POS-156 (G1). The runbook's cutover step for this lane is "one crossing on
// dev", and a crossing is not a thing a suite can stand up: it needs a running
// office, a real store, a real key and the doors' own HTTP surface. So the
// proof is a SCRIPT rather than a test, run by hand against the DEV office
// (whose store has been its own sandbox since 2026-09-22), and it never touches
// prod, the box, Postgres or a secrets file — it speaks HTTP and reads one
// keyless health door.
//
// ── WHAT IT ASSERTS, AND WHY THOSE TWO HALVES ───────────────────────────────
//
// Per act class, the cheapest lawful act the doors accept, then BOTH halves:
//
//   1. THE READ-BACK. The store-backed door that the write should have moved
//      answers with the act in it. A write that lands somewhere nobody reads is
//      the failure this whole project exists to end, so "the pen returned 200"
//      is not the proof — the READER saying so is.
//
//   2. THE JOURNAL DELTA. `GET /world/dynamic` is keyless and reports
//      `db.journal` (COUNT), `db.journal_head` (MAX(seq)) and `db.movements`
//      (COUNT) straight off the sqlite file. Photographed before and after, a
//      delta of zero is the proof the sqlite write is gone. `--db <path>` reads
//      the same three numbers out of the file directly, for an office whose
//      health door is unreachable.
//
// Either half failing fails the class, and a class failing exits 1.
//
// ── IT IS HONEST BEFORE THE DELETION TOO, AND THAT IS DELIBERATE ────────────
//
// Run against an office that STILL writes the journal, this exits 1 and names
// exactly which classes moved `journal_head` and by how much. That is not a
// broken probe; it is the pre-deletion measurement, and it is the receipt that
// says the write really was firing before anyone claims it stopped. A probe
// that could only ever pass would prove nothing (verification-probes-must-be-
// able-to-fail). `--expect-journal` states the other expectation out loud for
// that run, so a green pre-deletion run can never be mistaken for a green
// post-deletion one: the verdict line always says which expectation it held to.
//
// ── WHAT IT WRITES INTO THE TOWN, SAID PLAINLY ──────────────────────────────
//
// Three real acts by the key's own resident: a sited mark draft (unstaked — a
// draft costs nothing and never reaches the public docket), a ZERO-DISTANCE
// walk (the walk ledger's "stand here": the resident's own current point, so
// nobody moves), and one short say. On dev that is ordinary traffic. It is
// still traffic, which is why this names a `--dry-run` that does every read and
// no write, and why the mark's slug carries the run's own instant.

// ── argv ─────────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const arg = (name, fallback = null) => {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : fallback;
};
const flag = (name) => argv.includes(name);

const BASE = String(arg("--base", "") ?? "").replace(/\/+$/, "");
const KEY_ENV = arg("--key-env", "POSTMARK_KEY");
const DB_PATH = arg("--db", null);
const DRY_RUN = flag("--dry-run");
// The expectation this run holds to. Default: the journal is GONE (post-G1).
// `--expect-journal` inverts it for a pre-deletion measurement, and the verdict
// says which one it held, always.
const EXPECT_JOURNAL = flag("--expect-journal");

if (flag("--help") || !BASE) {
  console.log(`g1-dev-proof — the doors round-trip through the store, with no journal row

  node tools/g1-dev-proof.mjs --base <url> --key-env <VAR> [--db <path>] [--dry-run] [--expect-journal]

  --base <url>       the office to exercise (DEV — never prod)
  --key-env <VAR>    the env var holding a resident Bearer key (default POSTMARK_KEY)
  --db <path>        read the journal/movements counts from this sqlite file
                     instead of GET /world/dynamic
  --dry-run          every read, no write — proves the probe can reach the doors
  --expect-journal   hold to the PRE-deletion expectation (the journal DOES grow).
                     Without it the run asserts the post-G1 truth: zero delta.

  exit 0  every class passed both halves
  exit 1  a class failed, or the probe could not reach the office`);
  // `--help` is a question and it is answered: 0. A MISSING `--base` is a
  // misuse and exits 2, so a wrapper that forgets the flag cannot read as a
  // green run — the class of defect where a probe that never ran reports pass.
  process.exit(flag("--help") ? 0 : 2);
}

const KEY = String(process.env[KEY_ENV] ?? "").trim();
if (!KEY && !DRY_RUN) {
  console.error(`no key: ${KEY_ENV} is empty. Export the DEV resident key into it — this script never reads a secrets file.`);
  process.exit(2);
}

// ── the wire ─────────────────────────────────────────────────────────────────

/**
 * One call. Never throws for a status: a 422 from a door is an ANSWER this
 * probe has to be able to print, and turning it into an exception would lose
 * the door's own sentence, which is the most useful line in a failed run.
 */
async function call(method, path, body = null, { keyed = false } = {}) {
  const headers = { accept: "application/json" };
  if (keyed) headers.authorization = `Bearer ${KEY}`;
  if (body != null) headers["content-type"] = "application/json";
  let res, text;
  try {
    res = await fetch(`${BASE}${path}`, { method, headers, ...(body == null ? {} : { body: JSON.stringify(body) }) });
    text = await res.text();
  } catch (e) {
    return { ok: false, status: 0, json: null, text: "", error: String(e?.message ?? e) };
  }
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON — `text` is the answer */ }
  return { ok: res.ok, status: res.status, json, text, error: null };
}

/** The door's own sentence for a bad answer, so a failure prints why and not just a number. */
const why = (r) => r.error ? r.error
  : `${r.status} ${String(r.json?.defect ?? r.json?.error ?? r.text ?? "").slice(0, 160)}`;

// ── the instrument: the sqlite counts, before and after ─────────────────────

/**
 * `{ journal, journal_head, movements }` — the three numbers G1 is about.
 *
 * `null` for a table means FEATURE-DETECTED ABSENT, which is a real and good
 * answer after the drop and must never read as zero: "the table is gone" and
 * "the table is empty" are different facts, and a probe that conflated them
 * would pass on a store that had simply lost its journal to something else.
 */
async function counts() {
  if (DB_PATH) {
    // IMPORTED HERE, NOT AT THE TOP. `node:sqlite` is experimental: importing it
    // unconditionally prints a warning into every run's output and keeps a
    // handle the exit path has to wait on. The default instrument is the health
    // door, and a default run should not pay for a fallback it never takes.
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(DB_PATH, { readOnly: true });
    try {
      const has = (t) => !!db.prepare("SELECT name n FROM sqlite_master WHERE type='table' AND name=?").get(t);
      return {
        source: DB_PATH,
        journal: has("journal") ? db.prepare("SELECT COUNT(*) c FROM journal").get().c : null,
        journal_head: has("journal") ? (db.prepare("SELECT MAX(seq) s FROM journal").get().s ?? 0) : null,
        movements: has("movements") ? db.prepare("SELECT COUNT(*) c FROM movements").get().c : null,
      };
    } finally { try { db.close(); } catch { /* already gone */ } }
  }
  const r = await call("GET", "/world/dynamic");
  if (!r.ok || !r.json?.db) throw new Error(`GET /world/dynamic did not answer (${why(r)})`);
  const d = r.json.db;
  return {
    source: `${BASE}/world/dynamic`,
    journal: d.journal ?? null,
    journal_head: d.journal_head ?? null,
    movements: d.movements ?? null,
  };
}

/**
 * Did the sqlite side move? The COUNT alone is not enough: the reaper and the
 * drain both DELETE, so a write and a reap inside one run would net to zero
 * rows while `journal_head` still advanced. The HEAD is the honest tell for an
 * append, and it never goes backwards.
 */
function journalMoved(before, after) {
  if (before.journal_head == null && after.journal_head == null) return { moved: false, by: 0, absent: true };
  const b = Number(before.journal_head ?? 0), a = Number(after.journal_head ?? 0);
  return { moved: a > b, by: a - b, absent: false };
}

function movementsMoved(before, after) {
  if (before.movements == null && after.movements == null) return { moved: false, by: 0, absent: true };
  const b = Number(before.movements ?? 0), a = Number(after.movements ?? 0);
  return { moved: a > b, by: a - b, absent: false };
}

// ── the classes ──────────────────────────────────────────────────────────────

const stamp = new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14);

/**
 * Each class: the cheapest lawful act, and the store-backed READ that should
 * now hold it. `find` gets the door's answer and the read's body and says, in
 * one sentence, whether the act is in there — the sentence is the verdict, so a
 * class that half-worked cannot print as a pass.
 */
function classes(me) {
  const who = me.handle;
  const slug = `g1-dev-proof-${stamp}`;
  const markId = `${who}/${slug}`;
  const said = `g1 dev proof ${stamp}`;
  // ONE STRING PER READER, used by the call AND by every sentence about it,
  // so the door a line names is always the door the probe actually asked.
  const MARK_READER = "/world2/my-marks";
  const WALK_READER = "/world2/walks";
  const SAY_READER = "/world2/conversations";

  return [
    {
      name: "mark (draft)",
      reader: MARK_READER,
      write: async (at) => call("POST", "/world/marks", {
        by: who, slug, kind: "sited", body: `a probe stood here at ${stamp} and wrote this line`,
        at: { x: at.x, y: at.y }, extent: { w: 1, h: 1 },
      }, { keyed: true }),
      // THE DRAFT'S LAWFUL READER, and it is KEYED. POS-199: this read-back
      // first asked `/world2/investigate`, which by 007's law never shows a
      // draft — so the first dev run (2026-09-22, train 5bfad5e) reddened the
      // mark class on a green write. `/world2/my-marks` is the portfolio's 2.0
      // twin (server.mjs, ahead of the keyless router because "your marks need
      // your resident household identity"): it answers the key's own household,
      // and a draft is in `drafts` by its `by/slug` id — or, past the page
      // bound, named by id in `withheld.drafts`. The probe sends the SAME
      // Bearer key the write was made with, so the reader asks as the author.
      read: async () => call("GET", MARK_READER, null, { keyed: true }),
      find: (wrote, got) => {
        if (!wrote.ok) return { ok: false, said: `the door refused the draft — ${why(wrote)}` };
        if (!got.ok) return { ok: false, said: `the mark was written but ${MARK_READER} did not answer — ${why(got)}` };
        // By ID, in the drafts list — not a substring of the whole body. The
        // draft is unstaked, so `drafts` is where the portfolio files it; the
        // slug turning up anywhere else is not this read-back's answer.
        const shown = Array.isArray(got.json?.drafts) ? got.json.drafts.map((m) => m?.id) : [];
        const withheld = Array.isArray(got.json?.withheld?.drafts) ? got.json.withheld.drafts : [];
        return shown.includes(markId) || withheld.includes(markId)
          ? { ok: true, said: `${MARK_READER} holds the draft ${markId}` }
          : { ok: false, said: `the door took the draft and ${MARK_READER} does not list ${markId} among the key's drafts — the write did not reach the reader` };
      },
    },
    {
      name: "walk (stand here)",
      reader: WALK_READER,
      // ZERO DISTANCE, ON PURPOSE. The walk ledger's own "stand here" — a
      // departure from the resident's current point toward the same point. It
      // is a real departure record and it moves nobody, which is the cheapest
      // lawful act of this class and the only one safe to run repeatedly.
      write: async (at) => call("POST", "/world/walks", { x: at.x, y: at.y }, { keyed: true }),
      read: async () => call("GET", `${WALK_READER}?handle=${encodeURIComponent(who)}`),
      find: (wrote, got) => {
        if (!wrote.ok) return { ok: false, said: `the door refused the walk — ${why(wrote)}` };
        // THE DOOR'S OWN `movement.record` LINE, which the brief names as an
        // instrument in its own right: after G1 it must not still be promising
        // a `dynamic.db/movements` copy, and `seq` (the reverse-mirror journal
        // seq) must be null.
        const rec = String(wrote.json?.movement?.record ?? "");
        const seq = wrote.json?.seq ?? null;
        if (!got.ok) return { ok: false, said: `the walk was recorded (${rec || "record unnamed"}) but ${WALK_READER} did not answer — ${why(got)}` };
        const hay = JSON.stringify(got.json ?? got.text);
        if (!hay.includes(who)) return { ok: false, said: `the door took the walk and ${WALK_READER} does not name ${who} — the write did not reach the reader` };
        const mirrorClaim = /dynamic\.db\/movements/.test(rec);
        if (!EXPECT_JOURNAL && (mirrorClaim || seq != null))
          return { ok: false, said: `${WALK_READER} holds the departure, but the door still answers record="${rec}"${seq == null ? "" : ` seq=${seq}`} — the sqlite copy is still being promised` };
        return { ok: true, said: `${WALK_READER} holds ${who}'s departure; the door names record="${rec}"${seq == null ? "" : ` seq=${seq}`}` };
      },
    },
    {
      name: "say",
      reader: SAY_READER,
      write: async () => call("POST", "/world/say", { text: said }, { keyed: true }),
      // THE ACT READER THAT CARRIES EVERY SAY. POS-199: this read-back first
      // asked `/world2/say`, which reads only `emission` acts (the air at an
      // instant), so a live `say` act can never come back through it and the
      // first dev run reddened a green write. `/world2/conversations` reads
      // `acts` over all three VOICE_ACTIONS — its own disclosure: "the
      // crystallized record ... and the live say acts the lane hook mirrors" —
      // and a voice sits in a thread (`live` or `closed`) as `{ handle, said }`.
      read: async () => call("GET", SAY_READER),
      find: (wrote, got) => {
        if (!wrote.ok) return { ok: false, said: `the door refused the say — ${why(wrote)}` };
        if (!got.ok) return { ok: false, said: `the words were spoken but ${SAY_READER} did not answer — ${why(got)}` };
        const threads = [...(Array.isArray(got.json?.live) ? got.json.live : []), ...(Array.isArray(got.json?.closed) ? got.json.closed : [])];
        const heard = threads.some((t) => Array.isArray(t?.voices) && t.voices.some((v) => v?.handle === who && v?.said === said));
        return heard
          ? { ok: true, said: `${SAY_READER} carries ${who}'s line back` }
          // NAMED, NOT SWALLOWED. A reader that cannot answer is a red with
          // the door's name, never a green.
          : { ok: false, said: `the door took the say and ${SAY_READER} does not carry ${who}'s line back — the write did not reach the reader` };
      },
    },
  ];
}

// ── the apex, read once at the end ──────────────────────────────────────────

/**
 * `/world2/apex` at the resident's own point — the store's whole answer for
 * where they stand. Read AFTER all three acts, because it is the one read that
 * should reflect every one of them at once, and a run whose three classes each
 * passed while the apex saw none of them is a finding worth its own line.
 */
async function apexAt(at) {
  const r = await call("GET", `/world2/apex?x=${at.x}&y=${at.y}`);
  return r.ok ? { ok: true, said: `/world2/apex answers at ${at.x},${at.y}` } : { ok: false, said: `/world2/apex did not answer — ${why(r)}` };
}

// ── the run ──────────────────────────────────────────────────────────────────

async function main() {
  const lines = [];
  let failed = 0;

  console.log(`g1-dev-proof · ${BASE} · ${new Date().toISOString()}`);
  console.log(`expectation: ${EXPECT_JOURNAL ? "PRE-G1 — the sqlite journal DOES grow" : "POST-G1 — the sqlite journal does NOT grow"}${DRY_RUN ? " · DRY RUN (no writes)" : ""}`);

  // WHO, AND WHERE THEY STAND. Both from the office, never from argv: a probe
  // that takes the handle on the command line is a probe that can be pointed at
  // somebody else's resident by a typo.
  const meR = DRY_RUN && !KEY ? { ok: false } : await call("GET", "/me", null, { keyed: true });
  if (!meR.ok) { console.error(`could not read /me — ${why(meR)}`); process.exitCode = 1; return; }
  const handle = meR.json?.handles?.[0] ?? meR.json?.handle ?? null;
  if (!handle) { console.error("/me named no handle for this key — this key acts for no resident"); process.exitCode = 1; return; }

  const orient = await call("GET", `/world/orient?handle=${encodeURIComponent(handle)}`, null, { keyed: true });
  const here = orient.json?.you ?? orient.json?.position ?? orient.json ?? {};
  const x = Number(here.x ?? here?.at?.x), y = Number(here.y ?? here?.at?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    console.error(`could not read where ${handle} stands from /world/orient — a zero-distance walk needs their own point (${why(orient)})`);
    process.exitCode = 1;
    return;
  }
  const at = { x, y };
  console.log(`resident: ${handle} at ${x},${y}`);

  const before = await counts();
  console.log(`before: journal=${before.journal ?? "(absent)"} head=${before.journal_head ?? "(absent)"} movements=${before.movements ?? "(absent)"}  [${before.source}]`);

  const run = classes({ handle });
  // WHICH DOOR ANSWERED, on the verdict line itself — so a future red says
  // which reader each class was read through without anyone opening this file.
  const readers = `readers: ${run.map((c) => `${c.name.split(" ")[0]}: ${c.reader}`).join(", ")}`;
  for (const c of run) {
    const b = await counts();
    if (DRY_RUN) {
      const got = await c.read();
      lines.push(`  DRY  ${c.name} via ${c.reader} — read reachable: ${got.ok ? "yes" : `no (${why(got)})`}`);
      if (!got.ok) failed++;
      continue;
    }
    const wrote = await c.write(at);
    const got = await c.read();
    const v = c.find(wrote, got);
    const a = await counts();
    const jm = journalMoved(b, a);
    const mm = movementsMoved(b, a);

    // THE TWO HALVES, JOINED HERE AND NOWHERE ELSE, so a class cannot pass on
    // one of them. The journal half is read against whichever expectation this
    // run declared, and the line always says what it saw.
    const journalOk = EXPECT_JOURNAL ? true : !jm.moved;
    const sqliteSaid = jm.absent
      ? "no journal table"
      : `journal_head ${jm.moved ? `+${jm.by}` : "unmoved"}${mm.absent ? "" : `, movements ${mm.moved ? `+${mm.by}` : "unmoved"}`}`;
    const ok = v.ok && journalOk;
    if (!ok) failed++;
    lines.push(`  ${ok ? "PASS" : "FAIL"} ${c.name} via ${c.reader} — ${v.said}; sqlite: ${sqliteSaid}`);
  }

  if (!DRY_RUN) {
    const apex = await apexAt(at);
    if (!apex.ok) failed++;
    lines.push(`  ${apex.ok ? "PASS" : "FAIL"} apex — ${apex.said}`);
  }

  const after = await counts();
  console.log(`after:  journal=${after.journal ?? "(absent)"} head=${after.journal_head ?? "(absent)"} movements=${after.movements ?? "(absent)"}`);
  console.log("");
  for (const l of lines) console.log(l);
  console.log("");

  const total = journalMoved(before, after);
  console.log(total.absent
    ? "the store has no journal table at all — the drop has been applied"
    : `the whole run moved journal_head by ${total.by}`);
  console.log(failed === 0
    ? `GREEN — every class round-tripped through the store${EXPECT_JOURNAL ? " (pre-G1 expectation: the journal still grew, as declared)" : ", and nothing was written to the sqlite journal"} · ${readers}`
    : `RED — ${failed} ${failed === 1 ? "class" : "classes"} failed; the lines above say which half · ${readers}`);
  // `process.exitCode`, NEVER `process.exit()`. An abrupt exit while fetch's
  // sockets are still closing aborts libuv on Windows — the run prints GREEN and
  // the shell reads 0xC0000409, which is a probe that cannot report its own
  // verdict. Setting the code and letting the loop drain says the same thing and
  // survives the platform.
  process.exitCode = failed === 0 ? 0 : 1;
}

main().catch((e) => { console.error(`the probe tripped: ${String(e?.stack ?? e)}`); process.exitCode = 1; });
