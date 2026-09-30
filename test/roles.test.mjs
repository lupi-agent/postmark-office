// roles.test.mjs — the role registry (the subscription lane's first primitive).
//
// Every test below quotes the design sentence it asserts, verbatim in the test
// name or in its assertion message, so a reader can tell what law broke without
// leaving the failure output. Each was run RED first — the flip is recorded in
// the commit that carries it.
//
//   node --test test/roles.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

import {
  openRolesDb, grantRole, revokeRole, listRoles, auditTrail,
  hasRole, roleCheck, roleGate, roleGatesOn, roleBounce,
  normalizeSubject, staleRows, ROLE_SUBSCRIBER,
} from "../src/roles.mjs";

const SRC = join(import.meta.dirname, "..", "src");

/** A fresh registry per test — on disk, because a file-backed store is what ships. */
async function withDb(fn) {
  const dir = mkdtempSync(join(tmpdir(), "roles-"));
  const rdb = openRolesDb(join(dir, "roles.db"));
  try { return await fn(rdb, dir); }
  finally {
    try { rdb.close(); } catch { /* already closed */ }
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

/** The gate flag is process-global; never leak it out of a test. */
async function withGates(on, fn) {
  const saved = process.env.OFFICE_ROLE_GATES;
  try {
    if (on) process.env.OFFICE_ROLE_GATES = "1"; else delete process.env.OFFICE_ROLE_GATES;
    return await fn();
  } finally {
    if (saved === undefined) delete process.env.OFFICE_ROLE_GATES; else process.env.OFFICE_ROLE_GATES = saved;
  }
}

const key = (ghId, ghLogin = "somebody") => ({ ghId, ghLogin, household: ghLogin, handles: new Set(["someone"]) });
const KEEMIN = 583231, STRANGER = 999001, PATRON = 424242;

// ── THE GATE ────────────────────────────────────────────────────────────────

test('"a granted household passes the gate" — and every resident of it inherits', async () => {
  await withDb(async (rdb) => await withGates(true, async () => {
    await grantRole(rdb, { subject: KEEMIN, actor: "test" });
    assert.equal((await roleGate(rdb, key(KEEMIN), ROLE_SUBSCRIBER)), null,
      "a granted household must pass");
    assert.ok((await hasRole(rdb, KEEMIN)), "hasRole(household, role) is the helper the doors ask");

    // "roles key to the household, the credential grain — one human subscribes,
    // all their residents inherit." The subject never mentions a handle, so a
    // house with different residents answers the same.
    assert.equal((await roleGate(rdb, { ghId: KEEMIN, ghLogin: "keeminlee", handles: new Set(["wright", "rei"]) }, ROLE_SUBSCRIBER)), null,
      "the role is the HOUSE's — changing which residents stand in it changes nothing");
  }));
});

test('"ungranted refuses with a readable reason naming the role"', async () => {
  await withDb(async (rdb) => await withGates(true, async () => {
    const b = (await roleGate(rdb, key(STRANGER), ROLE_SUBSCRIBER));
    assert.ok(b, "an ungranted household must be refused");
    assert.equal(b.code, 403);
    assert.match(b.defect, /subscriber/, "the refusal must NAME the role the door wants");
    assert.match(b.hint, /household/i, "and say roles are held by a household");
    assert.match(b.hint, /operator/i, "and say who can change it");
    // The hint must not send them down a road that cannot work.
    assert.doesNotMatch(b.hint, /add a resident/i,
      "adding a resident cannot grant a role — the hint must not imply it can");
  }));
});

test('the three refusals are DISTINGUISHABLE — "an answer given without its inputs must never wear the grammar of an answer that had them"', async () => {
  await withDb(async (rdb) => await withGates(true, async () => {
    // signed out, signed-in-but-ungranted, and store-unreadable are three
    // different worlds; a single 403 for all three would be a lie in two.
    const anon = (await roleGate(rdb, { household: null, handles: new Set() }, ROLE_SUBSCRIBER));
    const ungranted = (await roleGate(rdb, key(STRANGER), ROLE_SUBSCRIBER));
    const broken = (await roleGate(null, key(STRANGER), ROLE_SUBSCRIBER));

    assert.equal(anon.code, 401, "no key at all is an authentication answer, not a standing answer");
    assert.equal(ungranted.code, 403, "signed in and not granted is a standing answer");
    assert.equal(broken.code, 503, "an unreadable registry is the office's fault, not the caller's");

    assert.match(broken.defect, /could not be read/,
      "the broken-store refusal must say the book could not be read");
    assert.match(broken.hint, /NOT a statement about your standing/,
      "and must explicitly disclaim being a judgement about the caller");

    assert.notEqual(anon.defect, ungranted.defect);
    assert.notEqual(ungranted.defect, broken.defect);
  }));
});

test('an unreadable registry REFUSES rather than admits — "an unreadable index must never widen the gate"', async () => {
  await withGates(true, async () => {
    assert.equal((await roleCheck(null, KEEMIN)).reason, "store-unreadable");
    assert.equal((await hasRole(null, KEEMIN)), false,
      "a corrupt or missing registry must never become a free door");
    assert.ok((await roleGate(null, key(KEEMIN), ROLE_SUBSCRIBER)),
      "fail closed: with gates ON and no store, everyone is refused");
  });
});

// ── THE FLAG ────────────────────────────────────────────────────────────────

test('"the gate defaults OFF/OPEN — absolutely nothing changes for any caller"', async () => {
  await withDb(async (rdb) => await withGates(false, async () => {
    assert.equal(roleGatesOn(), false, "unset means off");
    for (const k of [key(STRANGER), key(KEEMIN), { household: null, handles: new Set() }, null])
      assert.equal((await roleGate(rdb, k, ROLE_SUBSCRIBER)), null,
        "flag off: every caller passes every gated door, granted or not");
  }));
});

test("flag off never even READS the registry — a broken roles.db cannot affect an ungated office", async () => {
  await withGates(false, async () => {
    // null stands in for a store that could not be opened. If the flag were
    // checked after the lookup rather than before, this would refuse.
    assert.equal((await roleGate(null, key(STRANGER), ROLE_SUBSCRIBER)), null);
  });
});

// ── GRANT / REVOKE / THE TRAIL ──────────────────────────────────────────────

test('"a revoke takes effect"', async () => {
  await withDb(async (rdb) => await withGates(true, async () => {
    await grantRole(rdb, { subject: KEEMIN, actor: "test" });
    assert.equal((await roleGate(rdb, key(KEEMIN), ROLE_SUBSCRIBER)), null);

    await revokeRole(rdb, { subject: KEEMIN, actor: "test", note: "lapsed" });
    assert.ok((await roleGate(rdb, key(KEEMIN), ROLE_SUBSCRIBER)),
      "after a revoke the household must be refused");
    assert.equal((await listRoles(rdb)).length, 0, "the standing row is gone");
  }));
});

test('"the audit survives revoke" — a revoke never deletes the audit trail', async () => {
  await withDb(async (rdb) => {
    await grantRole(rdb, { subject: KEEMIN, actor: "keemin", note: "founder" });
    await revokeRole(rdb, { subject: KEEMIN, actor: "wright", note: "lapsed" });

    const trail = (await auditTrail(rdb, { subject: KEEMIN }));
    assert.equal(trail.length, 2, "both acts are in the book");
    assert.deepEqual(trail.map((r) => r.action), ["revoke", "grant"], "newest first");

    // "The db is the state; the audit is the receipt." The state is empty and
    // the receipt is whole — that is the entire point of the two tables.
    assert.equal((await listRoles(rdb)).length, 0);
    assert.equal(trail.find((r) => r.action === "grant").actor, "keemin",
      "the grant's actor survives the revoke");
    assert.equal(trail.find((r) => r.action === "grant").note, "founder",
      "and so does its note — the trail is why a restore is possible at all");
  });
});

test("every grant and revoke names WHO ran it, and refuses to write without one", async () => {
  await withDb(async (rdb) => {
    await assert.rejects(async () => grantRole(rdb, { subject: KEEMIN, actor: null }), /actor/,
      "an audit row whose actor is unknown is a receipt in costume");
    await assert.rejects(async () => revokeRole(rdb, { subject: KEEMIN, actor: "" }), /actor/);
    await assert.rejects(async () => grantRole(rdb, { subject: "", actor: "test" }), /subject/);

    await grantRole(rdb, { subject: KEEMIN, actor: "keemin" });
    assert.equal((await auditTrail(rdb))[0].actor, "keemin");
  });
});

test("revoking a role never held still writes its line — a silent no-op would be a state with no receipt", async () => {
  await withDb(async (rdb) => {
    const out = (await revokeRole(rdb, { subject: 777001, actor: "test" }));
    assert.equal(out.held, false, "the tool reports that nothing was held");
    assert.equal((await auditTrail(rdb, { subject: 777001 })).length, 1,
      "and the attempt is still in the trail");
  });
});

test("a re-grant is audited too — asking again is itself a fact worth keeping", async () => {
  await withDb(async (rdb) => {
    await grantRole(rdb, { subject: KEEMIN, actor: "keemin", note: "first" });
    await grantRole(rdb, { subject: KEEMIN, actor: "wright", note: "second" });
    assert.equal((await listRoles(rdb)).length, 1, "still one standing row");
    assert.equal((await listRoles(rdb))[0].granted_by, "wright", "the state carries the latest grant");
    assert.equal((await auditTrail(rdb, { subject: KEEMIN })).length, 2, "both asks are in the trail");
  });
});

// ── THE SUBJECT ─────────────────────────────────────────────────────────────

test('THE REKEY: "a subject granted under one login still passes the gate after the login changes"', async () => {
  await withDb(async (rdb) => await withGates(true, async () => {
    // Granted while the account was called "alden".
    await grantRole(rdb, { subject: KEEMIN, actor: "keemin", login: "alden", note: "paid" });
    assert.equal((await roleGate(rdb, key(KEEMIN, "alden"), ROLE_SUBSCRIBER)), null);

    // THE RENAME. Same human, same account id, new login — exactly what the
    // town's own tools/github-ids.json records for `alden` and `corwin`:
    // "renamed": "2026-07-31 (github login rename; id unchanged)", both now
    // signing in as fox-hearth against the unchanged id 20786448.
    assert.equal((await roleGate(rdb, key(KEEMIN, "fox-hearth"), ROLE_SUBSCRIBER)), null,
      "a rename must NOT revoke what somebody paid for — the id did not change, so the standing does not");

    // The label followed them; the key did not move.
    assert.equal((await listRoles(rdb))[0].login, "fox-hearth", "the display login is refreshed on sight");
    assert.equal((await listRoles(rdb))[0].subject, String(KEEMIN), "the subject is still the gh_id");
    assert.equal((await listRoles(rdb)).length, 1, "one row, not two — a rename must never fork a household");

    // And the reverse: a DIFFERENT account that happens to arrive carrying the
    // old login gets nothing. This is the security half — GitHub releases
    // abandoned logins for re-registration.
    assert.ok((await roleGate(rdb, key(STRANGER, "alden"), ROLE_SUBSCRIBER)),
      "someone who claims the abandoned login must not inherit the role");
  }));
});

test("a login is never a subject — the registry cannot be keyed on a name even by mistake", async () => {
  await withDb(async (rdb) => {
    for (const notAnId of ["keeminlee", "fox-hearth", "gh:123", "", "   ", null, undefined, -5, 1.5, "0123", "12a"])
      assert.equal(normalizeSubject(notAnId), null, `${JSON.stringify(notAnId)} must not normalize to a subject`);
    assert.equal(normalizeSubject(583231), "583231", "a number is canonicalised to digits");
    assert.equal(normalizeSubject(" 583231 "), "583231", "and so is a numeric string");

    await assert.rejects(async () => grantRole(rdb, { subject: "keeminlee", actor: "test" }), /gh_id/,
      "granting to a login must throw, naming what it wanted");
    await assert.rejects(async () => revokeRole(rdb, { subject: "fox-hearth", actor: "test" }), /gh_id/);
  });
});

test("a caller with no verified GitHub identity can never match a row", async () => {
  await withDb(async (rdb) => {
    await grantRole(rdb, { subject: KEEMIN, actor: "test" });
    // A bare berth (oauth.mjs § berthLookup) and a static OFFICE_KEYS row both
    // arrive with no ghId at all. Neither may resolve to anything.
    assert.equal((await hasRole(rdb, null)), false);
    assert.equal((await hasRole(rdb, "")), false);
    assert.equal((await roleCheck(rdb, null)).reason, "no-subject");
    assert.equal((await roleGate(rdb, { berth: true, slug: "x", household: null, handles: new Set() }, ROLE_SUBSCRIBER)) !== null, false,
      "flag off: nothing is gated regardless");
    await withGates(true, async () => {
      const bare = (await roleGate(rdb, { berth: true, slug: "x", household: null, handles: new Set() }, ROLE_SUBSCRIBER));
      assert.equal(bare.code, 401, "a bare berth has no verified identity");
      // The old OFFICE_KEYS shape: an operator-chosen household string, no id.
      const staticKey = (await roleGate(rdb, { household: "keemin", handles: new Set(["wright"]) }, ROLE_SUBSCRIBER));
      assert.equal(staticKey.code, 401,
        "a household that exists only as an env string cannot hold a role — founder-ruled");
      assert.match(staticKey.hint, /static office key with no id/,
        "and the refusal must name that case, since only an operator can fix it");
      // With an id pinned in the env row, the same static key resolves.
      await grantRole(rdb, { subject: 424243, actor: "test" });
      assert.equal((await roleGate(rdb, { household: "keemin", ghId: 424243, handles: new Set(["wright"]) }, ROLE_SUBSCRIBER)), null,
        "OFFICE_KEYS with an explicit #gh_id resolves like any other credential");
    });
  });
});

test("stale login-keyed rows are INERT and are reported as such — inert is not the same as absent", async () => {
  await withDb(async (rdb, dir) => await withGates(true, async () => {
    // Write a pre-rekey row the way an old build would have.
    rdb.prepare("INSERT INTO roles (subject, role, granted_at, granted_by, note) VALUES ('keeminlee','subscriber','then','old',NULL)").run();
    assert.equal((await hasRole(rdb, KEEMIN)), false, "a login-keyed row grants nothing to the real account");
    assert.equal((await roleGate(rdb, key(KEEMIN, "keeminlee"), ROLE_SUBSCRIBER))?.code, 403,
      "fail closed: the stale row cannot be mistaken for a grant");
    const stale = (await staleRows(rdb));
    assert.equal(stale.length, 1, "and it is surfaced, not silently ignored");
    assert.equal(stale[0].subject, "keeminlee");
  }));
});

test('a stale row is NOT listed under "who may pass right now" — that heading would be a lie about it', async () => {
  const dir = mkdtempSync(join(tmpdir(), "roles-stale-"));
  const dbPath = join(dir, "roles.db");
  try {
    const seed = openRolesDb(dbPath);
    try {
      seed.prepare("INSERT INTO roles (subject,role,granted_at,granted_by) VALUES ('keeminlee','subscriber','then','old')").run();
    } finally { seed.close(); }
    const out = cli(["list"], dbPath).out;

    const standing = out.slice(out.indexOf("STANDING"), out.indexOf("⚑ STALE"));
    assert.doesNotMatch(standing, /keeminlee/,
      "a row that cannot pass must not appear under the heading that says who may pass");
    assert.match(standing, /\(0\)/, "standing is empty, and says so");
    assert.match(out, /⚑ STALE/, "it appears in the section that explains what it is");
    assert.match(out, /grant NOTHING/);
  } finally { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
});

// ── THE SCHEMA ──────────────────────────────────────────────────────────────

test('"the schema must not need migration to add role names later"', async () => {
  await withDb(async (rdb) => await withGates(true, async () => {
    // A second role name is a second ROW. No DDL runs, nothing is altered.
    await grantRole(rdb, { subject: KEEMIN, role: "subscriber", actor: "test" });
    await grantRole(rdb, { subject: KEEMIN, role: "patron", actor: "test" });
    await grantRole(rdb, { subject: PATRON, role: "patron", actor: "test" });

    assert.ok((await hasRole(rdb, KEEMIN, "subscriber")));
    assert.ok((await hasRole(rdb, KEEMIN, "patron")), "a role name the code has never heard of works");
    assert.equal((await hasRole(rdb, PATRON, "subscriber")), false,
      "holding one role grants no other");

    assert.equal((await listRoles(rdb, { role: "patron" })).length, 2, "roles are listable by name");
    // The gate is per-role: a door asking for `patron` is a different question.
    assert.ok((await roleGate(rdb, key(PATRON), "subscriber")));
    assert.equal((await roleGate(rdb, key(PATRON), "patron")), null);
  }));
});

test("a role is keyed on (subject, role), so revoking one leaves the others standing", async () => {
  await withDb(async (rdb) => {
    await grantRole(rdb, { subject: KEEMIN, role: "subscriber", actor: "test" });
    await grantRole(rdb, { subject: KEEMIN, role: "patron", actor: "test" });
    await revokeRole(rdb, { subject: KEEMIN, role: "patron", actor: "test" });
    assert.ok((await hasRole(rdb, KEEMIN, "subscriber")));
    assert.equal((await hasRole(rdb, KEEMIN, "patron")), false);
  });
});

// ── THE BOUNDARY (asserted structurally, not promised) ──────────────────────

test('THE BOUNDARY: "roles live AT THE DOOR only" — the office\'s world half carries zero references to the registry', () => {
  const worldFiles = readdirSync(SRC).filter((f) => f.startsWith("world") && f.endsWith(".mjs"));
  assert.ok(worldFiles.length >= 10,
    `expected the world modules to be found; got ${worldFiles.length}. If they were renamed or moved, THIS TEST STOPPED GUARDING ANYTHING — fix the glob, do not delete the test.`);

  const offenders = [];
  for (const f of worldFiles) {
    const src = readFileSync(join(SRC, f), "utf8");
    if (/roles\.mjs|hasRole|roleGate|roleCheck|roleBounce|openRolesDb|ROLE_SUBSCRIBER|OFFICE_ROLE_GATES/.test(src))
      offenders.push(f);
  }
  assert.deepEqual(offenders, [],
    "the world's response function and derivation stay roles-blind; a role must never be able to change what the world IS, only whether a door opens");
});

test("THE BOUNDARY, the other half: the registry itself imports nothing world-shaped", async () => {
  const src = readFileSync(join(SRC, "roles.mjs"), "utf8");
  const imports = [...src.matchAll(/^import\s[^;]*?from\s+["']([^"']+)["']/gm)].map((m) => m[1]);
  // NODE BUILTINS ONLY. The registry has no edge into office domain code at
  // all, world-shaped or otherwise — it derives the office root itself rather
  // than importing it from world-store.mjs. Pin the whole list, so a future
  // edit that reaches for world state has to come through this test to do it.
  //
  // ONE OFFICE MODULE IS ADMITTED, and it is pinned the same way (POS-271): the
  // registry reaches its store through paperwork.mjs, the one door onto the
  // office's paperwork, and that module's own imports are node builtins. So the
  // edge the boundary forbids still cannot exist, one hop further out.
  assert.deepEqual(imports.sort(), ["./paperwork.mjs", "node:path", "node:sqlite"],
    "roles.mjs may know where the office root is and how to reach its paperwork; it may not know anything about the world");
  assert.ok(imports.every((i) => i.startsWith("node:") || i === "./paperwork.mjs"),
    `every import must be a node builtin or the paperwork door; got ${imports.join(", ")}`);
  const paper = readFileSync(join(SRC, "paperwork.mjs"), "utf8");
  const paperImports = [...paper.matchAll(/^import\s[^;]*?from\s+["']([^"']+)["']/gm)].map((m) => m[1]);
  assert.ok(paperImports.length > 0 && paperImports.every((i) => i.startsWith("node:")),
    `paperwork.mjs, the registry's one door, must import only node builtins; got ${paperImports.join(", ")}`);
});

test("THE BOUNDARY is structural: postmark-world is a separate repo and nothing in it can reach the office", async () => {
  // The office imports the engine FROM the world clone (world.mjs § engineDir);
  // the edge runs office -> clone and there is no path back. If a world clone is
  // present, assert it carries no reference to this registry. Absent, the claim
  // is still true by construction — a separate repository cannot import from
  // this one — and the test says so rather than passing silently on nothing.
  const clone = process.env.WORLD_CLONE ?? join(import.meta.dirname, "..", "..", "postmark-world");
  if (!existsSync(clone)) {
    assert.ok(true, "no world clone here; the boundary rests on repo separation, which no test in THIS repo can weaken");
    return;
  }
  const RE = /roles\.mjs|OFFICE_ROLE_GATES|openRolesDb|roleGate\b/;
  const hits = [];
  let scanned = 0;
  const walk = (dir, depth = 0) => {
    if (depth > 4 || !existsSync(dir)) return;
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name === ".git" || e.name === "node_modules") continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p, depth + 1);
      else if (e.name.endsWith(".mjs") || e.name.endsWith(".js")) {
        try {
          const src = readFileSync(p, "utf8");
          scanned += 1;
          if (RE.test(src)) hits.push(p);
        } catch { /* unreadable file is not a reference */ }
      }
    }
  };
  walk(join(clone, "tools"));

  // A LEXICAL-ABSENCE CLAIM IS WORTHLESS UNTIL THE PROBE IS SHOWN TO FIND A
  // KNOWN POSITIVE. A wrong path, a typo'd extension filter or a regex that
  // matches nothing all produce the same clean zero as a genuinely clean repo,
  // and the clean zero is the answer this test exists to give — so it has to
  // earn it. Two guards: the walk must actually have read files, and the
  // pattern must actually match text it should match.
  assert.ok(scanned > 0,
    `scanned ${scanned} files under ${join(clone, "tools")} — a zero-file walk reports "no references" no matter what is there. Fix the path; do not trust this pass.`);
  assert.ok(RE.test('import { roleGate } from "./roles.mjs";'),
    "the probe must match a reference it is meant to catch, or its zero means nothing");

  assert.deepEqual(hits, [], "world engine code must carry zero knowledge of the role registry");
});

// ── THE OPERATOR CLI (a script existing is not a script running) ────────────

/** Run tools/roles.mjs for real. Returns { code, out }. */
function cli(args, dbPath) {
  const r = spawnSync(process.execPath,
    [join(import.meta.dirname, "..", "tools", "roles.mjs"), ...args, "--db", dbPath],
    { encoding: "utf8" });
  return { code: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

test("the CLI grants, revokes and lists — against the same store the door reads", async () => {
  const dir = mkdtempSync(join(tmpdir(), "roles-cli-"));
  const dbPath = join(dir, "roles.db");
  try {
    assert.equal(cli(["grant", "--gh-id", String(KEEMIN), "--actor", "keemin", "--note", "dad grant"], dbPath).code, 0);
    assert.equal(cli(["grant", "--gh-id", "700100", "--actor", "keemin"], dbPath).code, 0);
    assert.equal(cli(["revoke", "--gh-id", "700100", "--actor", "wright", "--note", "lapsed"], dbPath).code, 0);

    // The door's own read agrees with what the operator's tool wrote.
    const rdb = openRolesDb(dbPath);
    try {
      assert.ok((await hasRole(rdb, KEEMIN)), "the CLI's grant is what the gate sees");
      assert.equal((await hasRole(rdb, 700100)), false, "and its revoke too");
    } finally { rdb.close(); }

    const listed = cli(["list"], dbPath);
    assert.equal(listed.code, 0);
    assert.match(listed.out, /STANDING/);
    assert.match(listed.out, new RegExp(`${KEEMIN} · subscriber`), "standing names the subject and role");
    assert.match(listed.out, /TRAIL/, '"make `list` show the audit trail too"');
    assert.match(listed.out, /revoke · 700100/,
      "the trail is the ONLY place a revoked household is still visible — standing has dropped it entirely");
    assert.match(listed.out, /by wright/, "and who did it");
  } finally { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
});

/** A throwaway town clone carrying the pins the resolver reads. */
async function withClone(fn) {
  const dir = mkdtempSync(join(tmpdir(), "roles-clone-"));
  mkdirSync(join(dir, "tools"), { recursive: true });
  writeFileSync(join(dir, "tools", "github-ids.json"), JSON.stringify({
    // The real shape, including the real rename: two handles, one login, one id.
    alden: { login: "fox-hearth", id: 20786448, pinned: "2026-07-05", renamed: "2026-07-31 (github login rename; id unchanged)" },
    corwin: { login: "fox-hearth", id: 20786448, pinned: "2026-07-30" },
    wright: { login: "keeminlee", id: 583231, pinned: "2026-07-01" },
    // Two records that disagree on the id behind one login.
    twin: { login: "doubled", id: 111 },
    twin2: { login: "doubled", id: 222 },
  }));
  try { return await fn(dir); }
  finally { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
}

test('the CLI RESOLVES a login to its gh_id — "refuse if unresolvable rather than storing a string that might be a typo"', async () => {
  await withClone(async (clone) => {
    const dir = mkdtempSync(join(tmpdir(), "roles-cli-"));
    const dbPath = join(dir, "roles.db");
    try {
      // A login the pins know resolves, and what lands is the ID.
      const ok = cli(["grant", "--subject", "fox-hearth", "--actor", "keemin", "--clone", clone], dbPath);
      assert.equal(ok.code, 0, ok.out);
      assert.match(ok.out, /20786448/, "the id is what was written, not the name");
      // Two handles share that login and that id — one household, and the
      // resolver must not read the duplication as a conflict.
      const rdb = openRolesDb(dbPath);
      try {
        assert.ok((await hasRole(rdb, 20786448)), "the gate finds it by id");
        assert.equal((await listRoles(rdb))[0].subject, "20786448");
        assert.equal((await listRoles(rdb))[0].login, "fox-hearth", "the login rides along as a label");
      } finally { rdb.close(); }

      // An unknown name REFUSES rather than storing a typo.
      const bad = cli(["grant", "--subject", "keeeminlee", "--actor", "keemin", "--clone", clone], dbPath);
      assert.notEqual(bad.code, 0, "an unresolvable name must not be written");
      assert.match(bad.out, /could not resolve/);
      assert.match(bad.out, /--gh-id/, "and must tell the operator how to proceed");
      assert.doesNotMatch(bad.out, /at ModuleJob\.run/, "a sentence, not a stack trace");

      // Records that disagree refuse rather than pick.
      const amb = cli(["grant", "--subject", "doubled", "--actor", "keemin", "--clone", clone], dbPath);
      assert.notEqual(amb.code, 0);
      assert.match(amb.out, /more than one GitHub id/,
        "two records disagreeing is a refusal, never a coin flip");
    } finally { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
  });
});

test("an all-digit login is genuinely ambiguous, so the CLI refuses instead of guessing", async () => {
  const dir = mkdtempSync(join(tmpdir(), "roles-clone-"));
  const dbPath = join(dir, "roles.db");
  try {
    mkdirSync(join(dir, "tools"), { recursive: true });
    // GitHub logins may be all digits. "123456" is both a plausible account id
    // and, here, a real login belonging to a DIFFERENT account.
    writeFileSync(join(dir, "tools", "github-ids.json"), JSON.stringify({
      numeric: { login: "123456", id: 987654 },
    }));
    const r = cli(["grant", "--subject", "123456", "--actor", "keemin", "--clone", dir], dbPath);
    assert.notEqual(r.code, 0, "guessing here could grant a stranger someone else's subscription");
    assert.match(r.out, /ambiguous/);
    assert.match(r.out, /--gh-id 123456/, "and offers both ways to say what was meant");
    assert.match(r.out, /--login 123456/);

    // --login forces the resolution road and lands the account behind the name.
    const viaLogin = cli(["grant", "--login", "123456", "--actor", "keemin", "--clone", dir], dbPath);
    assert.equal(viaLogin.code, 0, viaLogin.out);
    assert.match(viaLogin.out, /987654/, "--login resolved to the account behind the name");
  } finally { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
});

test("the CLI refuses to write without a subject, and explains itself instead of throwing", async () => {
  const dir = mkdtempSync(join(tmpdir(), "roles-cli-"));
  try {
    const r = cli(["grant", "--actor", "keemin"], join(dir, "roles.db"));
    assert.notEqual(r.code, 0, "a grant with no subject must fail");
    assert.match(r.out, /--subject/, "and say what was missing");
    assert.doesNotMatch(r.out, /at ModuleJob\.run/, "an operator gets a sentence, not a stack trace");
  } finally { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
});

test("an unopenable registry gives the operator a sentence naming the path, not ERR_SQLITE_ERROR", async () => {
  const r = cli(["list"], join("C:", "nope-does-not-exist", "roles.db"));
  assert.notEqual(r.code, 0);
  assert.match(r.out, /could not open the registry at/);
  assert.match(r.out, /parent directory does not exist/, "and names the likely cause");
  assert.doesNotMatch(r.out, /at ModuleJob\.run/, "no stack trace");
});

// ── THE BOUNCE SHAPES ───────────────────────────────────────────────────────

test("every bounce shape is complete — code, defect, hint, and the role named in all three refusals", async () => {
  for (const reason of ["no-subject", "not-granted", "store-unreadable"]) {
    const b = roleBounce({ reason, role: "subscriber" });
    assert.ok(Number.isInteger(b.code) && b.code >= 400, `${reason} needs an http code`);
    assert.ok(b.defect && b.hint, `${reason} needs both halves of the sentence`);
    assert.match(b.defect, /subscriber/, `${reason} must name the role`);
  }
});
