// roles.mjs — the role registry: who the office lets through a gated door.
//
// The first primitive of the SUBSCRIPTION lane, which sits BESIDE the stamps /
// holo ownership economy and does not touch it. A role is not a holding, not a
// deed, not a stamp: it is a line in an operator-kept book saying this
// household may pass. Purely db-based, hand-kept, one whitelist to start.
//
// ── THE SUBJECT IS THE GH_ID. THE LOGIN IS DECORATION ──────────────────────
//
// Founder-ruled twice, and the second ruling corrected the first. Roles key to
// the HOUSEHOLD, never to a resident handle and never to a session — one human
// subscribes, every resident of their house inherits it. But the household's
// *identifier* is `gh_id`, the immutable GitHub numeric account id, NOT the
// login: "we should 100% use gh_id as primary key for everything."
//
// WHY THE FIRST SHAPE WAS WRONG. `oauth.mjs § householdFor` answers
// `household: ghLogin ?? String(ghId)` — the login, because the `??` only
// reaches the id when the login is absent, which for a signed-in account is
// never. A GitHub login is MUTABLE: a user renames their account and the string
// changes. Keying a paid role on it means a rename silently revokes what
// somebody paid for, with no error, no audit line, and nothing for the resident
// to point at. Handles survive a rename (they resolve through pinned numeric
// ids); the household string does not.
//
// THIS IS NOT HYPOTHETICAL. The town's own `tools/github-ids.json` carries two
// residents whose records read `"renamed": "2026-07-31 (github login rename; id
// unchanged)"` — `alden` and `corwin`, both now logged in as `fox-hearth`.
// They survived exactly because they were pinned BY ID. A login-keyed registry
// would have dropped them.
//
// So `subject` is the gh_id, canonicalised to a digit string (see
// `normalizeSubject`), and `login` is a display column beside it — written on
// grant, refreshed on sight, and NEVER read to decide anything. The rule in one
// line: **an identifier a human can change is a label, not a key.**
//
// The gate therefore reads `key.ghId`, which oauth.mjs already puts on every
// credential shape it verifies (`oauthLookup`, `keyLookup`, and the co-signed
// `berthLookup` all spread `{ ghId, ghLogin }`). A caller with no verified
// GitHub identity — a bare berth, or a static OFFICE_KEYS row with no id — has
// no subject and can hold no role. See `server.mjs § KEYS` for the env format
// that lets an operator pin one.
//
// ── THE BOUNDARY, WHICH IS STRUCTURAL AND NOT A PROMISE ────────────────────
//
// Roles live AT THE DOOR. The world's response function, the world derivation,
// and everything in the `postmark-world` package are roles-blind, and the
// structure — not anyone's discipline — is what enforces it:
//
//   `postmark-world` is a SEPARATE REPOSITORY, cloned at WORLD_CLONE. The
//   dependency edge runs office -> clone and only that way: `world.mjs`'s
//   `engineDir()` reads the clone's `tools/` subtree at a published sha and
//   imports the engine FROM it. Nothing in the clone can import
//   `postmark-office/src/`; there is no path, no package entry, no resolution
//   root that reaches back. A module in this directory is therefore unreachable
//   from world evaluation by construction, the same way it is unreachable from
//   any other repository on the machine.
//
// What discipline still owns is the office's OWN world-facing half — the
// `src/world*.mjs` modules that compose world reads. Those could import this
// file, so a falsifier asserts they do not (test/roles.test.mjs § THE
// BOUNDARY), and it is written to fail if anyone ever wires one up.
//
// ── THE STATE AND THE RECEIPT ──────────────────────────────────────────────
//
// Two tables, and the split is the design: `roles` is the STATE (what is true
// now — a revoke deletes the row) and `role_audit` is the RECEIPT (what
// happened — append-only, a revoke ADDS to it and never removes). Reading the
// gate costs one indexed lookup against the small table; reconstructing how a
// household got its standing costs a scan of the long one.
//
// ⚑ DURABILITY, NAMED RATHER THAN ASSUMED. `roles.db` is its own file beside
// `oauth.db` and `dynamic.db`, and `*.db` is gitignored, so it lives on the box
// and nowhere else. It is NOT the same durability class as its neighbours, and
// the difference matters: `office.db` and `world.db` are pure indexes, deleted
// and rebuilt whole from a clone; `oauth.db` is auth paperwork whose loss only
// forces everyone to sign in again; `dynamic.db` carries an explicit covenant
// that every row re-derives or recovers from a crossing-save. This file carries
// NO such covenant, because a grant exists nowhere else in the world — no repo
// holds it, no fold recomputes it. Losing roles.db loses who paid. The audit
// table is what a restore would be rebuilt FROM, which is the strongest reason
// it is append-only; a backup discipline for this one file is an operations
// decision that is not this module's to make, only to state.
//
// ⚑ AND SINCE POS-271 IT HAS ONE: the store. Every function below takes a
// paper (paperwork.mjs) as `rdb` — roles.db by default, the store's
// office_roles / office_role_audit once the office is switched
// (OFFICE_PAPERWORK_STORE=1) — so every one of them is async. The store is
// backed up with everything else in it (deploy/world2-backup.sh), which is the
// durability this file could only name.

import { DatabaseSync } from "node:sqlite";
import { join, resolve } from "node:path";
import { asPaper } from "./paperwork.mjs";

// THIS MODULE IMPORTS NOTHING BUT NODE BUILTINS, ON PURPOSE.
//
// The office root has a home — `world-store.mjs § OFFICE_ROOT` — and the
// one-home rule would normally say import it. It is re-derived here instead,
// and the duplication is the cheaper of two costs: importing the WORLD's store
// module to learn a filesystem path would give the role registry a live edge
// into world code, which is the exact edge this module's whole boundary claim
// says does not exist. A reader auditing that claim should not have to work out
// that the import was only for a constant. What is duplicated is one line of
// repo layout, not a domain constant, and `test/roles.test.mjs § THE BOUNDARY,
// the other half` pins the import list so this cannot quietly regrow.
const OFFICE_ROOT = resolve(import.meta.dirname, "..");

export const DEFAULT_ROLES_DB = join(OFFICE_ROOT, "roles.db");

// ── the one role v0 ships with ──────────────────────────────────────────────
// A NAME, not an enum. The schema stores `role` as a column and keys on
// (subject, role), so a second role name is a second row and never a migration.
// This constant exists so the proof door and the CLI's default agree on a
// spelling, not to constrain the table.
export const ROLE_SUBSCRIBER = "subscriber";

/**
 * A gh_id (number or string) -> the canonical subject a row is keyed on.
 *
 * Digits only, no leading zeros, no sign, no whitespace. Anything else — a
 * login, an empty string, undefined, a float, `"gh:123"` — is null, and null
 * can never match a row. That strictness is the point: it is what makes it
 * impossible to key a row on a login by accident, which is the entire defect
 * this rekey exists to close. If a caller has no verified numeric identity they
 * have no subject, and the gate says so in those words rather than refusing as
 * though their standing had been checked.
 */
export function normalizeSubject(ghId) {
  if (typeof ghId === "number") return Number.isSafeInteger(ghId) && ghId > 0 ? String(ghId) : null;
  const s = String(ghId ?? "").trim();
  return /^[1-9][0-9]*$/.test(s) ? s : null;
}

/** A login for the display column: trimmed, lowercased, or null. Never a key. */
export const displayLogin = (login) => {
  const s = String(login ?? "").trim().toLowerCase();
  return s === "" ? null : s;
};

// ── storage ─────────────────────────────────────────────────────────────────

// `readOnly` for the read worker (runbook DEC-4, G3), same shape and same
// reason as `openOauthDb`'s: `roleGate` is a SELECT, so a worker must be able
// to run it, and the schema plus its additive migrations belong to the writer.
// With OFFICE_ROLE_GATES unset — the default, and every office today — no door
// consults this handle at all, so a worker that could not open it would still
// serve every route; opening it read-only keeps the gated case working without
// giving the worker a pen.
export function openRolesDb(path = DEFAULT_ROLES_DB, { readOnly = false } = {}) {
  if (readOnly) return new DatabaseSync(path, { readOnly: true });
  const db = new DatabaseSync(path);
  rolesSchema(db);
  return db;
}

/** The file's own shape and its additive migrations (the writer runs it; the
 *  store's shape is 031's). Exported for paperwork.mjs § openPaper. */
export function rolesSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS roles (
      subject    TEXT NOT NULL,
      role       TEXT NOT NULL,
      login      TEXT,
      granted_at TEXT NOT NULL,
      granted_by TEXT NOT NULL,
      note       TEXT,
      PRIMARY KEY (subject, role)
    );
    CREATE TABLE IF NOT EXISTS role_audit (
      id      INTEGER PRIMARY KEY AUTOINCREMENT,
      at      TEXT NOT NULL,
      action  TEXT NOT NULL,
      subject TEXT NOT NULL,
      role    TEXT NOT NULL,
      login   TEXT,
      actor   TEXT NOT NULL,
      note    TEXT
    );
    CREATE INDEX IF NOT EXISTS role_audit_subject ON role_audit (subject, id);
  `);
  // Additive migrations for a registry created before the gh_id rekey. The
  // `login` columns are display-only, so adding them is safe and lossless.
  for (const sql of ["ALTER TABLE roles ADD COLUMN login TEXT",
                     "ALTER TABLE role_audit ADD COLUMN login TEXT"])
    try { db.exec(sql); } catch { /* already there */ }
}

/**
 * Rows whose subject is not a gh_id — i.e. login-keyed rows left by a registry
 * created before the rekey. They are INERT: the gate looks up by gh_id and can
 * never match them, so they neither grant nor deny anything. But inert is not
 * the same as absent, and an operator reading `list` deserves to be told the
 * difference rather than seeing a row that looks live and does nothing. There
 * is no automatic backfill because there cannot be one — a login cannot be
 * turned back into an id without asking GitHub, and guessing is how you grant
 * a stranger someone else's subscription.
 */
export async function staleRows(rdb) {
  try {
    return (await asPaper(rdb).all("SELECT * FROM roles")).filter((r) => normalizeSubject(r.subject) === null);
  } catch { return []; }
}

const nowIso = () => new Date().toISOString();

// ── the write acts (both audited, always) ───────────────────────────────────
//
// `grant` and `revoke` each write the audit row in the SAME transaction as the
// state change, so there is no interleaving in which the book moved and the
// receipt did not. A re-grant of a role already held is still audited — the
// second line is the fact that someone asked again, which is exactly the kind
// of thing an operator later wants to see.

export async function grantRole(rdb, { subject, role = ROLE_SUBSCRIBER, actor, note = null, login = null }) {
  const s = normalizeSubject(subject);
  if (!s) throw new Error(`grant needs a subject: the household's gh_id (digits). Got ${JSON.stringify(subject)}`);
  if (!role) throw new Error("grant needs a role name");
  if (!actor) throw new Error("grant needs an actor — who ran this");
  const at = nowIso();
  const who = displayLogin(login);
  await asPaper(rdb).tx(async (t) => {
    await t.run(
      "INSERT INTO roles (subject, role, login, granted_at, granted_by, note) VALUES (?,?,?,?,?,?)" +
      " ON CONFLICT(subject, role) DO UPDATE SET granted_at = excluded.granted_at," +
      " granted_by = excluded.granted_by, note = excluded.note," +
      // A re-grant with no login known must not ERASE the label we already had.
      " login = COALESCE(excluded.login, roles.login)",
      s, role, who, at, actor, note);
    await t.append("INSERT INTO role_audit (at, action, subject, role, login, actor, note) VALUES (?,'grant',?,?,?,?,?)",
      [at, s, role, who, actor, note], "id");
  });
  return { subject: s, role, at, login: who };
}

/**
 * Refresh the display label when a caller shows up under a new login.
 *
 * This is the whole rename story in four lines: the row is untouched, the
 * standing is untouched, and only the human-readable label moves. It is a write
 * on a read path, so it is wrapped and utterly best-effort — a locked or
 * read-only registry must never turn a successful gate check into a failure.
 * Fires only when the label actually differs, so the common request writes
 * nothing.
 */
export async function refreshLogin(rdb, subject, login) {
  const s = normalizeSubject(subject);
  const who = displayLogin(login);
  if (!rdb || !s || !who) return false;
  try {
    const P = asPaper(rdb);
    const row = await P.get("SELECT login FROM roles WHERE subject = ? LIMIT 1", s);
    if (!row || row.login === who) return false;
    await P.run("UPDATE roles SET login = ? WHERE subject = ?", who, s);
    return true;
  } catch { return false; }
}

/**
 * Revoking DELETES the state row and APPENDS to the audit. The trail is what
 * survives; the standing is what does not. Revoking a role that was never held
 * is not an error — it still writes its audit line, because "someone tried to
 * revoke this" is a fact worth keeping, and a silent no-op here would be a
 * state with no receipt.
 */
export async function revokeRole(rdb, { subject, role = ROLE_SUBSCRIBER, actor, note = null }) {
  const s = normalizeSubject(subject);
  if (!s) throw new Error(`revoke needs a subject: the household's gh_id (digits). Got ${JSON.stringify(subject)}`);
  if (!role) throw new Error("revoke needs a role name");
  if (!actor) throw new Error("revoke needs an actor — who ran this");
  const at = nowIso();
  let held = false;
  let who = null;
  await asPaper(rdb).tx(async (t) => {
    const row = await t.get("SELECT login FROM roles WHERE subject = ? AND role = ?", s, role);
    held = Boolean(row);
    who = row?.login ?? null;
    await t.run("DELETE FROM roles WHERE subject = ? AND role = ?", s, role);
    // The label goes into the audit line so the trail stays READABLE after the
    // standing row — and its login column — is gone.
    await t.append("INSERT INTO role_audit (at, action, subject, role, login, actor, note) VALUES (?,'revoke',?,?,?,?,?)",
      [at, s, role, who, actor, note], "id");
  });
  return { subject: s, role, at, held, login: who };
}

// ── the reads ───────────────────────────────────────────────────────────────

export function listRoles(rdb, { role = null } = {}) {
  const P = asPaper(rdb);
  return role
    ? P.all("SELECT * FROM roles WHERE role = ? ORDER BY subject", role)
    : P.all("SELECT * FROM roles ORDER BY subject, role");
}

export function auditTrail(rdb, { subject = null, limit = 100 } = {}) {
  const s = normalizeSubject(subject);
  const P = asPaper(rdb);
  return s
    ? P.all("SELECT * FROM role_audit WHERE subject = ? ORDER BY id DESC LIMIT ?", s, limit)
    : P.all("SELECT * FROM role_audit ORDER BY id DESC LIMIT ?", limit);
}

// ── the check ───────────────────────────────────────────────────────────────
//
// `roleCheck` is the honest one and `hasRole` is the thin boolean over it. The
// split exists for one reason, and it is the town's own disclosure law
// (`the-town/the-disclosure`, 2026-08-18): *an answer given without its inputs
// must never wear the grammar of an answer that had them.* Three different
// worlds make a caller fail this gate —
//
//   they are not signed in            (no subject)
//   they are signed in and not granted (not granted)
//   the registry could not be read    (store unreadable)
//
// — and a bare boolean collapses all three into one refusal that says "you need
// the subscriber role", which is a lie in the third case and unhelpful in the
// first. `roleCheck` names which world it is in, and `roleBounce` spends that
// name, so the sentence a caller reads is the sentence that was true.
//
// An unreadable store REFUSES rather than admits. That is the same direction
// `oauth.mjs` fails in ("an unreadable index must never widen the gate") and it
// is the only safe direction for a paywall: a corrupt file must not silently
// become a free door. It is loud rather than silent precisely because the
// reason rides out with the refusal.

export async function roleCheck(rdb, ghId, role = ROLE_SUBSCRIBER) {
  const subject = normalizeSubject(ghId);
  if (!subject) return { ok: false, reason: "no-subject", subject: null, role };
  if (!rdb) return { ok: false, reason: "store-unreadable", subject, role };
  try {
    const row = await asPaper(rdb).get("SELECT 1 FROM roles WHERE subject = ? AND role = ?", subject, role);
    return row
      ? { ok: true, reason: "granted", subject, role }
      : { ok: false, reason: "not-granted", subject, role };
  } catch {
    return { ok: false, reason: "store-unreadable", subject, role };
  }
}

/**
 * The plain question, for callers that genuinely only need yes or no.
 * Takes the household's gh_id — never a login, never `key.household`.
 */
export async function hasRole(rdb, ghId, role = ROLE_SUBSCRIBER) {
  return (await roleCheck(rdb, ghId, role)).ok === true;
}

// ── the gate ────────────────────────────────────────────────────────────────
//
// Shaped after `harbor-gate.mjs`, deliberately: a flag read fresh from the
// environment on every call (never latched at import, so a test can flip it and
// an operator flipping it is restarting the office anyway), a one-expression
// predicate, and a bounce that says the whole truth.
//
// THE FLAG DEFAULTS OFF, AND OFF MEANS OPEN. With `OFFICE_ROLE_GATES` unset —
// which is every office today — `roleGated` is `false` for every caller, every
// role, every door, without so much as opening the database. Wiring a door
// therefore changes nothing for anybody until the founder designates real gated
// surfaces. WHICH doors get gated for real is a product decision and is not
// this module's, nor its author's, to make.

export const roleGatesOn = () => process.env.OFFICE_ROLE_GATES === "1";

/**
 * The gate. Returns null to let the caller through, or a bounce object.
 * Note the flag is checked FIRST and short-circuits: flag off never reads the
 * store, so a missing or broken roles.db cannot affect an ungated office.
 */
export async function roleGate(rdb, key, role = ROLE_SUBSCRIBER) {
  if (!roleGatesOn()) return null;
  // `key.ghId` — the immutable account id oauth.mjs verifies — and NEVER
  // `key.household`, which is the mutable login. That one property choice is
  // the whole rekey: a caller who renamed their GitHub account arrives here
  // with the same ghId and a different ghLogin, and passes.
  const check = await roleCheck(rdb, key?.ghId ?? null, role);
  // The label follows the human, on sight, without ever being consulted.
  if (check.ok) await refreshLogin(rdb, check.subject, key?.ghLogin);
  return check.ok ? null : roleBounce(check);
}

export function roleBounce({ reason, role }) {
  if (reason === "no-subject") return {
    code: 401,
    defect: `this door is for the "${role}" role, and the request carries no verified GitHub identity`,
    hint: `a role is held by a HOUSEHOLD, and a household is identified by its immutable GitHub account id — not by a name, which can be changed. Three kinds of caller land here: nobody signed in at all; a harbor berth not yet co-signed by a human; and a static office key with no id pinned to it. The first two are fixed by signing in (your human mints a household key at the key desk on the join page, or a connector authenticates through GitHub). The third is fixed by an operator.`,
  };
  if (reason === "store-unreadable") return {
    code: 503,
    defect: `this door is for the "${role}" role, and the role registry could not be read`,
    hint: `this is NOT a statement about your standing — the office could not open its own book, so it refused rather than guess. An operator is needed; nothing you can do at your end changes this answer.`,
  };
  return {
    code: 403,
    defect: `this door is for the "${role}" role, and your household does not hold it`,
    hint: `roles are kept by hand by the town's operators and are held by a HOUSEHOLD — every resident of a house shares its roles, so adding a resident will not change this. Ask an operator to grant "${role}" to your household.`,
  };
}
