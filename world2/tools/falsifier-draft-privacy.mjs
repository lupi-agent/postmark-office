// falsifier-draft-privacy.mjs — a private draft is private, or this goes red.
//
// LAW (gold plan postmark-world-2.md § 4, Phase 5.6 — verbatim, because a
// falsifier quotes the sentence it asserts):
//
//   "(a) a **leak falsifier** — no draft-status row may ever appear in any
//    export, render, archive, or public door answer, red otherwise; (b) drafts
//    are deliberately EXCLUDED from the notary/archives (private things don't
//    ride the public bucket), so they get a private durability lane (pg_dump)
//    instead."
//
// ── HOW IT ASKS ─────────────────────────────────────────────────────────────
//
// Two strings, planted in a scratch draft and then hunted across every surface
// a resident's words can reach. The strings are the whole method: the probes do
// not know what a claim looks like on each surface, they know what THIS
// RESIDENT'S SENTENCE looks like, and they read the entire answer. A leak
// through a field nobody thought to check is still a leak, and a probe that
// only checked `status` would miss it.
//
// THE TWO STRINGS ARE NOT INTERCHANGEABLE, and getting that wrong is how this
// falsifier was born red on its first run against a store with nothing wrong
// with it:
//
//   NONCE  rides the SLUG — the draft's identity. It is a fine needle for a
//          surface the caller did not name it to, and a useless one for
//          `/world2/mark?slug=<nonce>`, whose 404 quotes the slug back at you.
//          Echoing your own question is not a leak, and the first version of
//          this file called it one.
//   SECRET rides the BODY — the resident's actual private sentence. It is
//          never sent in any request, so finding it in ANY answer means the
//          store gave it up. Every leak leg hunts this one.
//
// The slug leg survives, narrowed to what it can honestly assert: the door
// answers "no such mark" rather than a mark.
//
// ── EVERY LEG CAN FAIL, AND THEY FAIL TWO DIFFERENT WAYS ────────────────────
//
// A falsifier nobody has watched fail is not a falsifier, and this one has
// eleven legs over surfaces of genuinely different kinds. Two mechanisms:
//
//   INJECTED FAULT (--self-test). A permissive SELECT policy is created on
//   `claims` for the reading roles — the exact hole 007 exists to prevent — and
//   the SQL legs are asserted to go RED with it in place. It is dropped again in
//   a `finally`, so an interrupted self-test does not leave the store open.
//
//   PAIRED CONTROL (every run, always). Each leg that cannot be red-proved by
//   injection carries a positive control on the SAME read: a string that IS in
//   that answer, asserted present. A door leg that finds its control and misses
//   the nonce has proved the nonce is absent; a door leg that finds NEITHER has
//   proved only that it is asleep, and this exits 2 rather than reporting green.
//   That distinction is the whole reason the controls are here — a green suite
//   doing the wrong arithmetic is worse than a red one.
//
// ── WHAT THE EXPORT LEG IS ACTUALLY GUARDING ────────────────────────────────
//
// Stated honestly, because the leg reads stronger than it is. The notary
// (snapshot-export.mjs) selects from `acts`, `marks` and `windows` and never
// from `claims`, and a draft writes no act and becomes no mark — so there are
// TWO independent reasons a draft cannot reach the repo, and the row policy is
// only the second of them. This leg is therefore a REGRESSION guard: the day
// someone exports the docket for transparency (a good idea, and it will be
// proposed), the exporter starts reading `claims`, and this is what stands
// between that change and every resident's private compose space in a public
// git repo. The `--self-test` proves `snapshot_reader`'s blindness directly,
// which is the half that would matter then.
//
// ── USAGE ───────────────────────────────────────────────────────────────────
//
//   WORLD2_PG_URL=postgres://office_api:…@localhost/world2_dev \
//   W2_OWNER_URL=…  W2_READER_URL=…  W2_CLEARING_URL=… \
//   W2_STANCE_URL=…   (stance_reader — 023's named carve; without it that leg
//                      is ASLEEP and the run cannot say whether 023 applied) \
//     node world2/tools/falsifier-draft-privacy.mjs \
//       --office http://localhost:4382 --key <bearer> --other-key <bearer> \
//       [--target /path/to/scratch-notary-checkout] [--self-test]
//
// EXIT CODES: 0 green · 1 RED (a draft leaked) · 2 cannot run / probe asleep.

import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const arg = (n, d = null) => { const i = process.argv.indexOf(n); return i === -1 ? d : process.argv[i + 1]; };
const SELF_TEST = process.argv.includes("--self-test");
const OFFICE = arg("--office", "http://localhost:4382").replace(/\/$/, "");
const KEY = arg("--key");
const OTHER_KEY = arg("--other-key");
const TARGET = arg("--target");

const need = (v, name) => { if (!v) { console.error(`${name} missing`); process.exit(2); } return v; };
const OFFICE_URL = need(process.env.WORLD2_PG_URL, "WORLD2_PG_URL (office_api)");
const OWNER_URL = need(process.env.W2_OWNER_URL, "W2_OWNER_URL (world2_owner — the positive control)");
const READER_URL = need(process.env.W2_READER_URL, "W2_READER_URL (snapshot_reader)");
const CLEARING_URL = need(process.env.W2_CLEARING_URL, "W2_CLEARING_URL (clearing_job)");

const { default: pg } = await import("pg");
const pools = new Map();
const P = (url) => { if (!pools.get(url)) pools.set(url, new pg.Pool({ connectionString: url, max: 2 })); return pools.get(url); };

const stamp = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const NONCE = `draftprivacy-${stamp()}`;   // the identity; may be echoed by a bounce
const SECRET = `sealed-${stamp()}`;        // the content; never sent in any request
const ACTOR = arg("--actor", "wright");    // must be a handle the --key acts for
const SLUG = `${ACTOR}/${NONCE}`;
const BODY = `a private sentence nobody but its author may read — ${SECRET}`;

const findings = [];
const asleep = [];
const red = (leg, detail) => findings.push(`RED · ${leg} — ${detail}`);
const dead = (leg, detail) => asleep.push(`ASLEEP · ${leg} — ${detail}`);

/**
 * The pen's own spelling: a draft is only ever written inside a declared
 * household.
 *
 * TWO SETTINGS since POS-160 RULING 4 (`024_household_spellings.sql`): the
 * store never re-spells a row, so a house declares every spelling it has ever
 * carried and the four draft policies compare `household = ANY(app.household_keys)`.
 *
 * THE SET HERE IS ONE LONG, ON PURPOSE. This falsifier writes its own draft,
 * under this one key, in this run — so the house's history is irrelevant to
 * what it is proving and importing the deriver to fetch it would give this file
 * a second thing that can be wrong. A one-key set is the NARROWEST lawful
 * session, which is the right instrument for a privacy falsifier: every
 * "blind" leg is proven against the tightest declaration the office can make,
 * and the one "visible to its own author" leg still passes, because the row was
 * written under exactly this key.
 */
async function withHousehold(pool, household, fn) {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT set_config('app.household', $1, true)", [household]);
    await c.query("SELECT set_config('app.household_keys', $1, true)", [household]);
    const out = await fn(c);
    await c.query("COMMIT");
    return out;
  } catch (e) { try { await c.query("ROLLBACK"); } catch { /* gone */ } throw e; }
  finally { c.release(); }
}

/** Does this credential, asking the plainest possible question, see the nonce? */
// A SQL leg holds the store directly, so it may hunt both needles: nothing here
// is echoing a request back.
const SEE = "SELECT count(*)::int AS c FROM claims WHERE body LIKE $1 OR slug LIKE $2";
async function sqlSeesNonce(url, { household = null } = {}) {
  const like = [`%${SECRET}%`, `%${NONCE}%`];
  const { rows } = household === null
    ? await P(url).query(SEE, like)
    : await withHousehold(P(url), household, (c) => c.query(SEE, like));
  return rows[0].c;
}

async function door(path, key = null) {
  const res = await fetch(`${OFFICE}${path}`, { headers: key ? { authorization: `Bearer ${key}` } : {} });
  return { code: res.status, text: await res.text() };
}

/** Every file under a tree, read as text. The export leg's haystack. */
function treeText(dir) {
  const out = [];
  const walk = (d) => {
    for (const e of readdirSync(d)) {
      if (e === ".git") continue;
      const p = join(d, e);
      if (statSync(p).isDirectory()) walk(p);
      else { try { out.push(`${p}\n${readFileSync(p, "utf8")}`); } catch { /* binary */ } }
    }
  };
  walk(dir);
  return out.join("\n");
}

// ── plant the scratch draft ─────────────────────────────────────────────────
// THE HOUSEHOLD KEY IS ASKED OF THE DOOR, not derived here.
//
// This is the same lesson as `householdKeyForKey` in world2-claims.mjs, and it
// was learned by getting it wrong: an office key's household is a NAME
// (`darko`), which resolves through `identities` to a KEY (`gh:…`, or
// `solo:darko` when the town does not know that name yet). A falsifier that
// guessed the key from the ACTOR's handle would plant its scratch draft in one
// household and ask the door about another — and then report a beautiful green
// meaning nothing, because of course the door does not show a draft that is not
// there. Asking `/world2/my-drafts` for its own answer removes the guess.
const HOUSEHOLD = arg("--household") ?? await (async () => {
  if (!KEY) { console.error("give --key (so the household can be read off the door) or --household <resolved key>"); process.exit(2); }
  const { code, text } = await door("/world2/my-drafts", KEY);
  let named = null;
  try { named = JSON.parse(text)?.household ?? null; } catch { /* not JSON */ }
  if (!named) { console.error(`cannot read the acting household from /world2/my-drafts (HTTP ${code}): ${text.slice(0, 200)}`); process.exit(2); }
  return named;
})();

let planted = false;
try {
  await withHousehold(P(OFFICE_URL), HOUSEHOLD, async (c) => {
    const { rows: [win] } = await c.query("SELECT id FROM windows WHERE status = 'open' ORDER BY id DESC LIMIT 1");
    if (!win) { console.error("no open window — cannot plant a scratch draft"); process.exit(2); }
    await c.query(
      `INSERT INTO claims (window_id, class, claimant, household, body, geometry, bbox, stake, data, slug, status)
       VALUES ($1,'sited',$2,$3,$4,$5,null,0,'{"_falsifier":"draft-privacy"}'::jsonb,$6,'draft')`,
      [win.id, ACTOR, HOUSEHOLD, BODY, JSON.stringify({ slug: SLUG }), SLUG]);
  });
  planted = true;

  // ── CONTROL 0 · the probe is pointed at a real row ────────────────────────
  // world2_owner is not subject to the policy (007 § why not FORCE), so it sees
  // the row the others must not. If THIS is zero, nothing below means anything.
  const ownerSees = await sqlSeesNonce(OWNER_URL);
  if (ownerSees !== 1) {
    console.error(`CANNOT RUN: the scratch draft is not where the probe looks (owner sees ${ownerSees}, want 1) — every green below would be meaningless`);
    process.exit(2);
  }

  // ── the SQL legs · the credentials that read this store ───────────────────
  const sqlLegs = [
    ["snapshot_reader (the notary's credential)", () => sqlSeesNonce(READER_URL)],
    ["clearing_job (the candle)", () => sqlSeesNonce(CLEARING_URL)],
    ["office_api, no household declared (every public read)", () => sqlSeesNonce(OFFICE_URL)],
    ["office_api, ANOTHER household declared", () => sqlSeesNonce(OFFICE_URL, { household: "gh:299249282" })],
  ];
  for (const [leg, run] of sqlLegs) {
    const n = await run();
    if (n !== 0) red(leg, `sees ${n} row(s) carrying the nonce — a draft is readable by a credential that must not read it`);
  }

  // ── THE STANCE CARVE · the ONE credential that may see a draft ────────────
  //
  // NAMED EXCEPTION, added 2026-09-22 under RULING 2 (POS-195) and deliberately
  // not folded into `sqlLegs` above, where it would read as a leak.
  //
  // THE LAW IT CARVES, verbatim:
  //
  //   "the stance derivation may read draft rows through `stance_reader`; its
  //    output is asserted to carry no draft body."
  //
  // WHY THE CARVE IS NOT A HOLE. `worldForStances` — the stance candidate list —
  // must know that an unpublished sketch stands on your ground, or the-late-
  // welcome stops being true ("A stance may arrive after the sketch and before
  // the publish"). 1.0 told you that from the sqlite journal; G1 deletes the
  // journal. So the fact moves records, and the BOUNDARY does not move: what a
  // ground-holder learns is that a sketch EXISTS on their ground, never what it
  // says. `world2/schema/023_stance_reader.sql` carries the whole argument.
  //
  // ── WHAT THIS LEG CAN AND CANNOT ASSERT, SAID PLAINLY ────────────────────
  //
  // The ruling's clause is about the DERIVATION'S OUTPUT, and this file cannot
  // read that output. The stance read is MCP-only — `world { read:
  // "declare-stance-on" }` and the household doorstep, no REST door — which is
  // the same wall this file already records for `worldMyDrafts`. Worse, the
  // scratch draft planted above carries `geometry: {slug}` and no at/extent, so
  // it could never BE a candidate: the derivation drops a mark with no ground.
  // A leg that called the derivation here would prove nothing and report green.
  //
  // So the output half is asserted where a fixture can give a draft real ground
  // and a caller real standing: `test/stance-candidates-read-the-store.test.mjs`
  // § THE SENTINEL, which plants a sentinel body in the store and asserts it
  // reaches no stance arm — with the store HOLDING it, so the probe can fail.
  // That split is recorded rather than papered over.
  //
  // WHAT THIS LEG ASSERTS, which the unit cannot: that the carve on the LIVE
  // box is the carve that was ruled — one role, one verb, one table.
  {
    const STANCE_URL = process.env.W2_STANCE_URL ?? null;
    if (!STANCE_URL) {
      dead("the stance carve · stance_reader sees the draft",
        "no W2_STANCE_URL given — the carve was not exercised, so this run says nothing about whether 023 applied");
    } else {
      // (a) POSITIVE CONTROL. `stance_reader` MUST see it. A zero here means
      // 023 did not apply, or the policy was dropped — and then the-late-welcome
      // is silently dead on this box while every leg above stands green.
      const sees = await sqlSeesNonce(STANCE_URL);
      if (sees !== 1) {
        red("the stance carve · stance_reader sees the draft",
          `sees ${sees} row(s), want 1 — 023_stance_reader.sql's claims_read_stance is not in force, so the stance ` +
          `candidate list cannot learn that an unpublished sketch stands on a resident's ground. the-late-welcome ` +
          `("a stance may arrive after the sketch and before the publish") is dead on this store.`);
      }

      // (b) THE CARVE DID NOT WIDEN. One verb, one table, and no write anywhere.
      // 003's second query asks the policy side of this; this asks the grant
      // side, on the live box, and the two together are the whole extent.
      const { rows: held } = await P(OWNER_URL).query(
        `SELECT table_name, privilege_type FROM information_schema.role_table_grants
          WHERE table_schema = 'public' AND grantee = 'stance_reader' ORDER BY table_name, privilege_type`);
      const unlawful = held.filter((g) => !(g.table_name === "claims" && g.privilege_type === "SELECT"));
      if (unlawful.length) {
        red("the stance carve · one verb, one table",
          `stance_reader holds ${unlawful.map((g) => `${g.privilege_type} on ${g.table_name}`).join(", ")} beyond ` +
          `SELECT on claims. The carve was ruled for ONE reader of ONE list; every privilege past that is a second ` +
          `reader nobody argued for. 023's header: "The role is SELECT-ONLY on ONE table."`);
      } else if (!held.length) {
        dead("the stance carve · one verb, one table",
          "stance_reader holds no grants at all — either 023 did not apply or the role is not the one 023 named, and " +
          "either way the leg above proved nothing about a carve that is not there");
      }
    }
  }

  // ── the door legs · every public answer, read whole ───────────────────────
  // Each carries its control: a string that IS in that answer. Nonce absent +
  // control present = the surface was genuinely read and genuinely lacks it.
  const doorLegs = [
    ["/world2/docket", "the public docket"],
    ["/world2/marks?all=true&full=true", "standing register"],
    ["/world2/windows", "the candle's ledger"],
    ["/world2/status", "world 2.0 store status"],
  ];
  for (const [path, control] of doorLegs) {
    const { code, text } = await door(path);
    if (text.includes(SECRET) || text.includes(NONCE)) red(`door ${path}`, `the answer carries the draft (HTTP ${code})`);
    else if (!text.includes(control)) dead(`door ${path}`, `neither the draft NOR this leg's control ("${control}") is in the answer (HTTP ${code}) — this leg proved nothing`);
  }

  // The slug leg, narrowed to what it can honestly assert. The nonce IS the
  // query here, so a bounce quoting it back is not a leak — only SECRET, which
  // this request does not carry, would be. What the leg adds is the answer's
  // shape: "no such mark", not a mark.
  {
    const { code, text } = await door(`/world2/mark?slug=${encodeURIComponent(SLUG)}`);
    if (text.includes(SECRET)) red(`door /world2/mark?slug=`, `the answer carries the draft's body (HTTP ${code})`);
    else if (!text.includes("bounce") || code !== 404) red(`door /world2/mark?slug=`, `answered HTTP ${code} instead of a 404 bounce: ${text.slice(0, 160)}`);
  }

  // ── the cross-household door leg ──────────────────────────────────────────
  if (OTHER_KEY) {
    const { code, text } = await door("/world2/my-drafts", OTHER_KEY);
    if (text.includes(SECRET) || text.includes(NONCE)) red("door /world2/my-drafts as ANOTHER household", `the answer carries the draft (HTTP ${code})`);
    else if (!text.includes("compose space")) dead("door /world2/my-drafts as ANOTHER household", `the door did not answer as itself (HTTP ${code}: ${text.slice(0, 120)})`);
  } else dead("door /world2/my-drafts as ANOTHER household", "no --other-key given — the cross-household read was not exercised");

  // ── THE DOOR A RESIDENT ACTUALLY READS (2026-09-07, lane-a / R3) ──────────
  //
  // THE GAP THIS CLOSES, and it is the reason the finding took a walk to find:
  // every leg above hunts `/world2/*`, and `/world2/my-drafts` reads
  // `readDraftClaims` — one query, `WHERE status = 'draft' AND household = $1`.
  // The door a RESIDENT reads is `world { read: "leave-mark" }` → `worldMyMarks`
  // → `guardedDraftsForKey` → `pgDraftsForKey`, which is a DIFFERENT reader
  // with a different query (`status = ANY(draft,pending)`), unioned with the git
  // sketchbook, and NO LEG TOUCHED IT. On 2026-09-06 a resident read eighteen
  // rows there, fifteen of them by other households, and could not tell a
  // mislabel from a leak — while this falsifier stood green over four `/world2`
  // paths.
  //
  // A leak falsifier that does not cover the door the residents use is a green
  // suite doing the wrong arithmetic, which this file's own header calls worse
  // than a red one.
  //
  // ⚑ ONE PATH, NOT TWO, and the reason is a finding of its own: `worldMyDrafts`
  // (`world_my_drafts`, the other reader of this overlay) has NO REST DOOR — it
  // is MCP-only, so an HTTP falsifier cannot reach it at all. `/world/my-marks`
  // is the one door of the pair this file can hunt, and it shares the overlay,
  // so a leak in `guardedDraftsForKey` shows here. That the sibling is
  // unreachable from any probe of this shape is recorded rather than papered
  // over; closing it needs an MCP-speaking leg, which is not this file's shape.
  // ⚑ THE CONTROL IS A FIELD THE OVERLAY PRODUCED, NOT ONE THE DOOR PRINTS
  // ANYWAY (tightened 2026-09-07, reviewer-found). It was `"drafts"` — a key
  // `worldMyMarks` emits on EVERY successful answer, together with its
  // `labels.drafts` prose, including one where `log.readable` is false and the
  // overlay was never consulted at all. So the control proved the door answered
  // and nothing about whether the thing being hunted was even looked for.
  //
  // `"log"` is the block `guardedDraftsForKey` attaches when it has actually
  // read the live layer (`{ readable, source, ... }`) — present on the overlay's
  // own path and on nothing else this answer carries. A leg that finds it has
  // proved the overlay ran; a leg that does not is ASLEEP and says so, which by
  // this file's own standard is the only honest alternative to a red.
  for (const [path, control] of [["/world/my-marks", '"log"']]) {
    if (OTHER_KEY) {
      const { code, text } = await door(path, OTHER_KEY);
      if (text.includes(SECRET) || text.includes(NONCE))
        red(`door ${path} as ANOTHER household`, `the answer carries the draft (HTTP ${code}) — this is the door a resident reads`);
      else if (!text.includes(control))
        dead(`door ${path} as ANOTHER household`, `the draft is absent, but so is this leg's control (${control} — the overlay's own block, present only when the live layer was actually read) at HTTP ${code}: ${text.slice(0, 120)} — so this leg proved the door ANSWERED, not that the overlay was consulted`);
    } else dead(`door ${path} as ANOTHER household`, "no --other-key given — the cross-household read was not exercised");

    if (KEY) {
      const { code, text } = await door(path, KEY);
      if (!text.includes(NONCE))
        dead(`control: the author's own ${path}`, `the author's own draft is NOT in their own answer (HTTP ${code}) — so the cross-household leg above proves nothing about this door`);
    } else dead(`control: the author's own ${path}`, "no --key given — the positive door control was not exercised");
  }

  // ── THE LEG THAT WOULD HAVE CAUGHT #2556, AND THE ONE ABOVE WOULD NOT ─────
  //
  // Every leg in this file hunts a PLANTED NEEDLE: a nonce in a slug, a secret
  // in a body, both written by this run. That is the right instrument for "did
  // my private sentence escape" and it is BLIND to the defect the 2026-09-07
  // walks actually found — `read: "leave-mark"` answering `drafts: 18` where
  // fifteen were other households' PUBLISHED marks, mislabelled as the caller's
  // private compose space. Published marks carry no nonce, so nothing here so
  // much as twitched, through two walks and a review.
  //
  // The cause was the sketchbook half diffing against a STALE base
  // (`world-branches.mjs § freshestMainRef`, and this branch's commit 1), so
  // every mark every household published since that base read as an addition
  // the caller was proposing. What leaked was PUBLIC canon under a private
  // label — a mislabel, not a disclosure — but a resident cannot tell those
  // apart from where they stand, and neither could two walks.
  //
  // So this leg hunts the CLASS instead of a needle: EVERY id in your own
  // `drafts` must be authored by a resident of your own household. It needs no
  // plant, it cannot go stale, and it is red on any future reader that widens
  // this list by accident.
  if (KEY) {
    const { code, text } = await door("/world/my-marks", KEY);
    let answer = null;
    try { answer = JSON.parse(text); } catch { /* named below */ }
    const drafts = answer?.drafts;
    if (!Array.isArray(drafts)) {
      dead("class: every id in your own drafts is your household's",
        `/world/my-marks did not answer with a drafts array (HTTP ${code}: ${text.slice(0, 120)}) — this leg proved nothing`);
    } else if (!answer.household) {
      dead("class: every id in your own drafts is your household's",
        "the answer names no household, so there is nothing to compare the authors against");
    } else {
      // The household's own residents, from the answer itself — the door
      // already resolved them, and asking a second source is how two notions of
      // one household are born (world2-claims.mjs § THE ONE RESOLVER).
      const ours = new Set([
        ...(Array.isArray(answer.residents) ? answer.residents : []),
        ...(answer.backed ?? []).filter((b) => b?.yours).map((b) => String(b.by)),
        ...(answer.published ?? []).map((m) => String(m.by)),
      ].filter(Boolean));
      const foreign = drafts
        .map((m) => ({ id: m?.id, by: m?.by ?? String(m?.id ?? "").split("/")[0] }))
        .filter((m) => m.by && ours.size > 0 && !ours.has(m.by));
      if (foreign.length)
        red("class: every id in your own drafts is your household's",
          `${foreign.length} of ${drafts.length} rows in YOUR drafts are authored by residents this household does not hold: ${
            foreign.slice(0, 5).map((m) => m.id).join(", ")}${foreign.length > 5 ? " …" : ""}`);
      else if (ours.size === 0)
        dead("class: every id in your own drafts is your household's",
          "the answer named no residents at all (no published marks, no backed rows), so every author compared against an empty set and nothing could have been caught");
    }
  } else dead("class: every id in your own drafts is your household's", "no --key given");

  // ── CONTROL 1 · the owner's own door DOES show it ─────────────────────────
  // The one answer that must carry the nonce. Without this the whole suite is
  // consistent with the draft never having been saved at all.
  if (KEY) {
    const { code, text } = await door("/world2/my-drafts", KEY);
    if (!text.includes(SECRET)) {
      console.error(`CANNOT RUN: the owning household's own door does not show the draft (HTTP ${code}) — either the write or the household resolution is broken, and "nobody else can see it" is not the fact being proved`);
      process.exit(2);
    }
  } else dead("control: the owner's own /world2/my-drafts", "no --key given — the positive door control was not exercised");

  // ── the export leg · render + archives, the whole tree ────────────────────
  if (TARGET) {
    try {
      execFileSync(process.execPath, [join(import.meta.dirname, "snapshot-export.mjs"), "--target", TARGET], {
        env: { ...process.env, WORLD2_PG_URL: READER_URL }, stdio: "pipe", timeout: 300_000,
      });
    } catch (e) {
      const out = `${e.stdout ?? ""}${e.stderr ?? ""}`;
      if (!out) { dead("export (render + archives)", `the notary could not run: ${String(e?.message ?? e).slice(0, 160)}`); }
    }
    const tree = treeText(TARGET);
    if (tree.includes(SECRET) || tree.includes(NONCE)) red("export (render + archives)", `the draft is in the notary's output tree at ${TARGET}`);
    else if (!tree.includes("CERTIFICATION")) dead("export (render + archives)", `${TARGET} holds no certification — the notary wrote nothing, so the grep proved nothing`);
  } else dead("export (render + archives)", "no --target given — the notary's output was not searched");

  // ── the injected fault · watch the SQL legs fail ──────────────────────────
  if (SELF_TEST) {
    let caught = 0;
    try {
      await P(OWNER_URL).query("CREATE POLICY falsifier_injected_hole ON claims FOR SELECT TO snapshot_reader, clearing_job, office_api USING (true)");
      for (const [leg, run] of sqlLegs) {
        const n = await run();
        if (n !== 0) caught += 1;
        else console.error(`  the hole is open and "${leg}" still sees nothing — that leg cannot go red`);
      }
    } finally {
      await P(OWNER_URL).query("DROP POLICY IF EXISTS falsifier_injected_hole ON claims");
    }
    const after = await sqlSeesNonce(READER_URL);
    console.log(`self-test: ${caught}/${sqlLegs.length} SQL legs went red with a permissive policy in place; the hole is ${after === 0 ? "closed again" : "STILL OPEN — DROP POLICY falsifier_injected_hole ON claims"}`);
    if (caught !== sqlLegs.length || after !== 0) { await Promise.all([...pools.values()].map((p) => p.end())); process.exit(1); }
  }
} finally {
  if (planted) {
    // The draft goes the way 007 says a draft may go: deleted, by its own
    // household, owing nobody an account of it.
    try {
      await withHousehold(P(OFFICE_URL), HOUSEHOLD, (c) =>
        c.query("DELETE FROM claims WHERE status = 'draft' AND slug = $1 AND household = $2", [SLUG, HOUSEHOLD]));
    } catch (e) { console.error(`WARNING: the scratch draft ${SLUG} was not cleaned up: ${String(e?.message ?? e)}`); }
  }
}

await Promise.all([...pools.values()].map((p) => p.end()));

for (const a of asleep) console.error(a);
if (findings.length) {
  for (const f of findings) console.error(f);
  console.error(`RED: a private draft reached ${findings.length} surface(s) it must never reach`);
  process.exit(1);
}
if (asleep.length) {
  console.error(`CANNOT RUN: ${asleep.length} leg(s) proved nothing — a green here would be arithmetic, not evidence`);
  process.exit(2);
}
console.log(`GREEN: the draft ${SLUG} was visible to its own household, to stance_reader through 023's named carve, and to nothing else — ${4} credentials blind, 5 public doors, the cross-household door, the notary's whole output tree, and the carve held to SELECT on claims alone`);
