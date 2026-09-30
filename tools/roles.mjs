#!/usr/bin/env node
// roles.mjs — the operator's desk for the role registry.
//
//   node tools/roles.mjs list   [--role <name>] [--subject <who>] [--limit <n>] [--json]
//   node tools/roles.mjs grant  --subject <who> [--role <name>] [--note "<why>"] [--actor <who>] [--json]
//   node tools/roles.mjs revoke --subject <who> [--role <name>] [--note "<why>"] [--actor <who>] [--json]
//
//   --db <path>       the registry file (default: roles.db beside office.db)
//   --gh-id <n>       the subject, explicitly, as an immutable GitHub account id
//   --login <name>    the subject, explicitly, as a GitHub login to be resolved
//   --clone <path>    town clone for tools/github-ids.json (default: TOWN_CLONE)
//   --oauth-db <path> oauth.db, the second resolution source (default beside roles.db)
//
// ── THE SUBJECT IS A gh_id, AND THE TOOL WILL NOT GUESS ONE ────────────────
//
// Rows key on the immutable GitHub account id (src/roles.mjs says why at
// length). An operator thinks in names, so `--subject` accepts either and
// RESOLVES a name to an id before writing. It resolves from two sources, both
// read-only:
//
//   1. the town clone's `tools/github-ids.json` — records are keyed by town
//      HANDLE and each carries `{ login, id }`, so a login is found by scanning
//      values. One login may appear under several handles (`alden` and `corwin`
//      are both `fox-hearth`, id 20786448); that is one household with two
//      handles and resolves fine. If two records disagree on the id, the tool
//      REFUSES rather than pick.
//   2. `oauth.db`'s `tokens` table (`gh_login` -> `gh_id`) — anyone who has
//      ever signed in.
//
// If neither resolves it, the tool REFUSES and tells the operator to pass
// `--gh-id`. It does not store the string hopefully. A registry that accepted
// an unresolvable name would be storing a typo that silently grants nobody
// anything, and the operator would have no way to see that from `list` — the
// row would look exactly like a working one.
//
// HAND-KEPT IS THE WORKFLOW, not a stopgap to apologise for. v0 of the
// subscription lane is a single whitelist an operator maintains — they run this
// locally against a copy, or they ssh to the box and run it against the live
// file. There is no self-serve path, no webhook, no door that writes here, and
// that is the point: while the list is short, a human deciding each line is
// cheaper and far more legible than machinery, and every line carries who
// decided it.
//
// ── WHO RAN THIS ───────────────────────────────────────────────────────────
//
// Every act names an actor and the audit row keeps it. `--actor` is explicit;
// absent it, the tool takes the OS username, and absent THAT it refuses rather
// than write `unknown` into a book whose entire job is accountability. An audit
// trail whose actor column says "unknown" is a state with no receipt wearing
// the costume of one.
//
// ── LIST SHOWS THE TRAIL ───────────────────────────────────────────────────
//
// `list` prints the standing AND the audit beneath it, because the two answer
// different questions and an operator at a terminal almost always has the
// second one. The standing says who may pass right now; the trail says how each
// of them got there, and — the half only the trail can answer — who USED to
// pass and does not any more. A revoked household vanishes from the first list
// entirely; if `list` only printed standing, the most interesting fact the
// registry holds would be invisible from the operator's only view of it.
//
// ── WHICH BOOK (POS-271) ───────────────────────────────────────────────────
//
// With OFFICE_PAPERWORK_STORE=1 and the store's WORLD2_PG / WORLD2_PG_URL in
// this shell, the tool writes the store's office_roles (and --db's file after
// it, as the office's own mirror does). Without them it writes the file only.
// An office switched to the store reads only the store, so a grant written to
// the file alone would grant nobody: every run prints which book it wrote, on
// its first line, so the operator sees that before anything else.

import { resolve, join, dirname } from "node:path";
import { userInfo } from "node:os";
import { readFileSync, existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import {
  rolesSchema, DEFAULT_ROLES_DB, ROLE_SUBSCRIBER,
  grantRole, revokeRole, listRoles, auditTrail, normalizeSubject, staleRows,
} from "../src/roles.mjs";
import { openPaper, paperworkStoreOn } from "../src/paperwork.mjs";

const argOf = (name, fallback = null) => {
  const i = process.argv.indexOf(name);
  return i !== -1 ? process.argv[i + 1] : fallback;
};
const flag = (name) => process.argv.includes(name);

const CMD = process.argv[2] ?? "";
const JSON_OUT = flag("--json");
const DB_PATH = resolve(argOf("--db", DEFAULT_ROLES_DB));
const ROLE = argOf("--role", ROLE_SUBSCRIBER);
const SUBJECT = argOf("--subject", null);
const GH_ID = argOf("--gh-id", null);
const LOGIN = argOf("--login", null);
const NOTE = argOf("--note", null);
const CLONE = resolve(argOf("--clone", process.env.TOWN_CLONE ?? join(dirname(DB_PATH), "town-clone")));
const OAUTH_DB = resolve(argOf("--oauth-db", join(dirname(DB_PATH), "oauth.db")));

const USAGE = `roles — the office's role registry (hand-kept)

  node tools/roles.mjs list   [--role <name>] [--subject <who>] [--limit <n>]
  node tools/roles.mjs grant  --subject <who> [--role <name>] [--note "<why>"]
  node tools/roles.mjs revoke --subject <who> [--role <name>] [--note "<why>"]

  --subject <who>    a GitHub login (resolved to an id) or an account id
  --gh-id <n>        the account id, explicitly — skips resolution
  --login <name>     a login, explicitly — always resolved, never read as an id
  --actor <who>      who is running this (default: the OS user)
  --role <name>      default "${ROLE_SUBSCRIBER}"
  --db <path>        the registry (default: ${DEFAULT_ROLES_DB})
  --clone <path>     town clone, for tools/github-ids.json (default: TOWN_CLONE)
  --oauth-db <path>  oauth.db, the second resolution source
  --json             machine-readable output

  A role is held by a HOUSEHOLD, and a household is its immutable GitHub
  ACCOUNT ID — not its login, which the owner can change at any time. Every
  resident of the house inherits the role. You may type a login; it is resolved
  to an id before anything is written, and if it cannot be resolved this tool
  refuses rather than store a name that would grant nobody anything.`;

const die = (msg) => { console.error(msg); process.exit(1); };

// ── login -> gh_id ──────────────────────────────────────────────────────────

/** Every {login, id} the town clone pins, as a login -> Set(ids) index. */
function pinsIndex(clonePath) {
  const p = join(clonePath, "tools", "github-ids.json");
  const byLogin = new Map();
  if (!existsSync(p)) return { byLogin, source: null };
  try {
    const pins = JSON.parse(readFileSync(p, "utf8"));
    for (const rec of Object.values(pins)) {
      const login = String(rec?.login ?? "").trim().toLowerCase();
      const id = rec?.id;
      if (!login || !Number.isSafeInteger(id)) continue;
      if (!byLogin.has(login)) byLogin.set(login, new Set());
      byLogin.get(login).add(String(id));
    }
    return { byLogin, source: p };
  } catch { return { byLogin, source: null }; }
}

/** Logins the office has actually seen sign in. */
function tokenIds(oauthDbPath, login) {
  if (!existsSync(oauthDbPath)) return new Set();
  let db;
  try {
    db = new DatabaseSync(oauthDbPath, { readOnly: true });
    const rows = db.prepare("SELECT DISTINCT gh_id FROM tokens WHERE lower(gh_login) = ? AND gh_id IS NOT NULL").all(login);
    return new Set(rows.map((r) => String(r.gh_id)));
  } catch { return new Set(); }
  finally { try { db?.close(); } catch { /* nothing to close */ } }
}

/**
 * Turn what the operator typed into a gh_id, or die explaining why not.
 * Returns { subject, login }.
 */
function resolveSubject({ subject, ghId, login, clone, oauthDb }) {
  const given = [ghId && "--gh-id", login && "--login", subject && "--subject"].filter(Boolean);
  if (given.length === 0) die(`this command needs a subject: --subject <login|id>, or --gh-id <n>, or --login <name>\n\n${USAGE}`);
  if ((ghId && login) || (ghId && subject) || (login && subject))
    die(`pass only ONE of --subject, --gh-id, --login (got ${given.join(", ")}) — they say the same thing and disagreeing would be silent.`);

  if (ghId) {
    const s = normalizeSubject(ghId);
    if (!s) die(`--gh-id must be a positive integer (a GitHub account id). Got ${JSON.stringify(ghId)}`);
    return { subject: s, login: null };
  }

  const raw = String(login ?? subject).trim();
  const asName = raw.toLowerCase();
  const { byLogin, source } = pinsIndex(clone);
  const fromPins = byLogin.get(asName) ?? new Set();
  const fromTokens = tokenIds(oauthDb, asName);
  const found = new Set([...fromPins, ...fromTokens]);

  // A GitHub login MAY be all digits, so a bare --subject that looks like an id
  // is genuinely ambiguous. Refuse rather than pick; that is the same discipline
  // the gate's three refusals follow. --gh-id / --login resolve it.
  const looksNumeric = /^[1-9][0-9]*$/.test(raw);
  if (looksNumeric && !login) {
    if (found.size > 0)
      die(`"${raw}" is ambiguous: it is a valid GitHub account id AND it resolves as a login (id ${[...found].join(", ")}).\n` +
          `Say which you mean: --gh-id ${raw}   or   --login ${raw}`);
    return { subject: raw, login: null };
  }

  if (found.size === 1) return { subject: [...found][0], login: asName };
  if (found.size > 1)
    die(`"${raw}" resolves to more than one GitHub id (${[...found].join(", ")}) — the town's records disagree.\n` +
        `Refusing rather than picking one. Pass --gh-id <n> with the correct id, and fix the records.`);

  die(`could not resolve "${raw}" to a GitHub account id.\n\n` +
    `Looked in:\n` +
    `  ${source ?? join(clone, "tools", "github-ids.json") + "  (not found)"}\n` +
    `  ${existsSync(oauthDb) ? oauthDb : oauthDb + "  (not found)"}\n\n` +
    `A role keys on the immutable account id, so storing the name would store a row that\n` +
    `grants nobody anything and looks identical to one that works. If you know the id:\n` +
    `  node tools/roles.mjs ${CMD} --gh-id <n> ...\n` +
    `Find it with:  gh api users/${raw} --jq .id\n` +
    `Or point at the town clone with --clone <path> (or set TOWN_CLONE).`);
}

/** Who ran this. Explicit beats the OS user; neither present is a refusal. */
function resolveActor() {
  const explicit = argOf("--actor", null);
  if (explicit && explicit.trim()) return explicit.trim();
  try {
    const u = userInfo().username;
    if (u && u.trim()) return u.trim();
  } catch { /* no OS user available */ }
  return null;
}

async function main() {
  if (!CMD || flag("--help") || flag("-h") || CMD === "help") { console.log(USAGE); return; }
  if (!["list", "grant", "revoke"].includes(CMD)) die(`unknown command "${CMD}"\n\n${USAGE}`);

  // A raw ERR_SQLITE_ERROR stack is the wrong thing to show the one person
  // this tool has: an operator on a box, often at the wrong hour, who has
  // almost always just mistyped --db or run from the wrong directory. Say which
  // path failed and what the two likely causes are.
  let rdb;
  try {
    rdb = await openPaper(DB_PATH, { schema: rolesSchema });
  } catch (e) {
    if (paperworkStoreOn()) die(`could not reach the store's registry (OFFICE_PAPERWORK_STORE=1):\n  ${String(e?.message ?? e)}`);
    die(`could not open the registry at:\n  ${DB_PATH}\n\n` +
      `${String(e?.message ?? e)}\n\n` +
      `Usually one of two things: the parent directory does not exist (SQLite creates the\n` +
      `file, never the folder), or this user cannot write there. Pass --db <path> to point\n` +
      `somewhere else; the default is ${DEFAULT_ROLES_DB}.`);
  }

  if (CMD === "list") {
    // Filtering is optional here, so an unresolvable name narrows to nothing
    // rather than killing the command — `list` is how an operator finds out
    // what is true, and it should still answer.
    const filter = (SUBJECT || GH_ID || LOGIN)
      ? resolveSubject({ subject: SUBJECT, ghId: GH_ID, login: LOGIN, clone: CLONE, oauthDb: OAUTH_DB }).subject
      : null;
    const standing = await listRoles(rdb, { role: argOf("--role", null) });
    const trail = await auditTrail(rdb, {
      subject: filter,
      limit: Math.max(1, Number(argOf("--limit", 50)) || 50),
    });
    const stale = await staleRows(rdb);
    const staleKeys = new Set(stale.map((r) => `${r.subject} ${r.role}`));
    // STANDING says "who may pass right now", so a row that CANNOT pass must not
    // appear under it. Stale rows get their own section that says what they are.
    const rows = (filter ? standing.filter((r) => r.subject === filter) : standing)
      .filter((r) => !staleKeys.has(`${r.subject} ${r.role}`));

    if (JSON_OUT) { console.log(JSON.stringify({ db: BOOK(rdb), standing: rows, audit: trail, stale }, null, 1)); return; }

    const who = (r) => `${r.subject}${r.login ? ` (${r.login})` : ""}`;
    console.log(`registry: ${BOOK(rdb)}\n`);
    console.log(`STANDING — who may pass right now (${rows.length})`);
    if (!rows.length) console.log("  (nobody holds a role)");
    for (const r of rows)
      console.log(`  ${who(r)} · ${r.role} · granted ${r.granted_at} by ${r.granted_by}${r.note ? ` · ${r.note}` : ""}`);

    // Inert rows are not the same as absent rows, and only `list` can say so.
    if (stale.length) {
      console.log(`\n⚑ STALE — ${stale.length} row(s) keyed on a NAME, not a GitHub id. These grant NOTHING:`);
      for (const r of stale)
        console.log(`  ${r.subject} · ${r.role} · granted ${r.granted_at} by ${r.granted_by}`);
      console.log(`  Written before the gh_id rekey. There is no automatic backfill — a name cannot`);
      console.log(`  be turned back into an id without asking GitHub. Re-grant with --gh-id, then`);
      console.log(`  revoke the stale row.`);
    }

    console.log(`\nTRAIL — what happened, newest first (${trail.length})`);
    if (!trail.length) console.log("  (nothing has ever been granted or revoked)");
    for (const a of trail)
      console.log(`  ${a.at} · ${a.action} · ${a.subject}${a.login ? ` (${a.login})` : ""} · ${a.role} · by ${a.actor}${a.note ? ` · ${a.note}` : ""}`);
    return;
  }

  // grant / revoke
  const { subject, login } = resolveSubject({
    subject: SUBJECT, ghId: GH_ID, login: LOGIN, clone: CLONE, oauthDb: OAUTH_DB,
  });
  const actor = resolveActor();
  if (!actor) die(
    "refusing to write: no actor.\n" +
    "Pass --actor <who>. The audit trail's whole job is saying who decided this,\n" +
    "and a row that says \"unknown\" is worse than no row at all."
  );

  const fn = CMD === "grant" ? grantRole : revokeRole;
  const out = await fn(rdb, { subject, role: ROLE, actor, note: NOTE, ...(CMD === "grant" ? { login } : {}) });
  const label = out.login ? `${out.subject} (${out.login})` : out.subject;

  if (JSON_OUT) { console.log(JSON.stringify({ db: BOOK(rdb), action: CMD, ...out }, null, 1)); return; }
  console.log(`registry: ${BOOK(rdb)}`);
  if (CMD === "grant") {
    console.log(`granted "${out.role}" to ${label} — by ${actor} at ${out.at}`);
    console.log("keyed on the GitHub account id, so it survives a login change.");
    console.log("every resident of that household now holds it.");
  } else {
    console.log(out.held
      ? `revoked "${out.role}" from ${label} — by ${actor} at ${out.at}`
      : `${label} did not hold "${out.role}" — nothing to remove, and the attempt is in the trail`);
    console.log("the standing is gone; the trail keeps every line it ever had.");
  }
}

// The book this run wrote, said in full: the store, with the file it mirrors
// to, or the file alone.
const BOOK = (paper) => paper.onStore
  ? `the store (office_roles)${paper.file ? `, mirrored to ${DB_PATH}` : ""}`
  : DB_PATH;

main().then(() => process.exit(0), (e) => die(String(e?.message ?? e)));
