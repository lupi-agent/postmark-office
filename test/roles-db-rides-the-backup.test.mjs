// roles-db-rides-the-backup.test.mjs — POS-185. The office's one file with
// authored state and no other copy now rides the nightly backup lane.
//
// WHAT THIS PROVES, and why each one is here rather than trusted:
//
//   the mechanic   the copier embedded in deploy/world2-backup.sh is EXTRACTED
//                  FROM THE SHIPPED SCRIPT and run. A rewrite of that lane to
//                  `cp roles.db` cannot pass this file, because the program
//                  under test is the lane's own text, not a copy of it here.
//   rows survive   every roles and role_audit row comes back identical, field
//                  for field, and the counts are the ones the fixture wrote.
//   NOT a cp       the copy's BYTES differ from the source's — VACUUM INTO
//                  defragments — which is exactly why the row comparison above
//                  is the check and a file hash would be the wrong one.
//   it can fail    the tamper: change one audit row in the copy and the same
//                  comparison reddens. A probe that cannot fail proves nothing.
//   read-only      the lane copies who paid without a pen over it, and the
//                  source is byte-identical after the run.
//   absent is ok   a box that never granted a role has no file, and that is
//                  reported rather than failed.
//   the receipt    LATEST.json and the state file carry roles_db_bytes and the
//                  role_audit count, so the roll-call row that already watches
//                  this lane now covers this file too.
//
//   node --test test/roles-db-rides-the-backup.test.mjs

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const LANE = readFileSync("deploy/world2-backup.sh", "utf8");
const REHEARSE = readFileSync("deploy/world2-restore-rehearse.sh", "utf8");

const scratch = mkdtempSync(join(tmpdir(), "pos185-"));
after(() => { try { rmSync(scratch, { recursive: true, force: true, maxRetries: 5 }); } catch { /* litter */ } });

// THE PROGRAM UNDER TEST IS THE LANE'S OWN. Extracted from the heredoc rather
// than pasted here: a test carrying its own copy of the code it checks passes
// forever after the real one is changed.
function copierSource() {
  const m = LANE.match(/<<'NODE'\n([\s\S]*?)\nNODE\n/);
  assert.ok(m, "deploy/world2-backup.sh no longer embeds a NODE heredoc — the copier moved and this test is now measuring nothing");
  return m[1];
}

function makeFixture(path, { grants = 7, revoke = true, churn = true } = {}) {
  rmSync(path, { force: true });
  const db = new DatabaseSync(path);
  db.exec(`CREATE TABLE roles (subject TEXT NOT NULL, role TEXT NOT NULL, login TEXT,
      granted_at TEXT NOT NULL, granted_by TEXT NOT NULL, note TEXT, PRIMARY KEY (subject, role));
    CREATE TABLE role_audit (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, action TEXT NOT NULL,
      subject TEXT NOT NULL, role TEXT NOT NULL, login TEXT, actor TEXT NOT NULL, note TEXT);
    CREATE INDEX role_audit_subject ON role_audit (subject, id);`);
  const g = db.prepare("INSERT INTO roles VALUES (?,?,?,?,?,?)");
  const a = db.prepare("INSERT INTO role_audit (at,action,subject,role,login,actor,note) VALUES (?,?,?,?,?,?,?)");
  for (let i = 1; i <= grants; i++) {
    g.run(String(100000 + i), "subscriber", `house${i}`, `2026-09-${10 + i}T00:00:00Z`, "wright", `paid ${i}`);
    a.run(`2026-09-${10 + i}T00:00:00Z`, "grant", String(100000 + i), "subscriber", `house${i}`, "wright", `paid ${i}`);
  }
  if (revoke) {
    // A revoke DELETES the state row and ADDS a receipt row. The fixture carries
    // one so the two counts cannot be accidentally equal — a test where every
    // number is the same number cannot tell them apart when they are swapped.
    db.prepare("DELETE FROM roles WHERE subject = ?").run("100003");
    a.run("2026-09-20T00:00:00Z", "revoke", "100003", "subscriber", "house3", "wright", "lapsed");
  }
  // Free pages, so VACUUM INTO has something to reclaim and the copy's SIZE
  // must differ from the source's. Without this the "not a cp" assertion could
  // pass by coincidence on a small enough database.
  if (churn) db.exec("CREATE TABLE churn (x TEXT); INSERT INTO churn SELECT randomblob(4000) FROM role_audit; DROP TABLE churn;");
  db.close();
}

const rows = (path, table) => {
  const db = new DatabaseSync(path, { readOnly: true });
  const r = db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all();
  db.close();
  return r;
};

// Runs the lane's own copier exactly as the shell invokes it: `node - <src> <dst>`.
function runCopier(src, dst) {
  const out = execFileSync(process.execPath, ["-", src, dst], {
    input: copierSource(), encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
  });
  return JSON.parse(out);
}

test("the copier is the LANE'S OWN text, and it is a VACUUM INTO from a read-only handle — never a cp", () => {
  const src = copierSource();
  assert.match(src, /VACUUM INTO/, "the copier does not VACUUM INTO — a torn SQLite file restores as nothing");
  assert.match(src, /readOnly:\s*true/, "the copier opens roles.db writable — a backup lane must not hold a pen over who paid");
  assert.match(src, /require\("node:sqlite"\)/, "the copier left node:sqlite — the box has no sqlite3 CLI dependency and must not gain one");

  // THE NEGATIVE, by grep over the whole lane: no cp/rsync/install of the LIVE
  // roles.db anywhere. `cp "$ROLES_COPY"` — the already-consistent VACUUM INTO
  // output going into the repo — is legal and is the only one this lane may make.
  const cpLines = LANE.split("\n").filter((l) => /^\s*(cp|rsync|install)\b/.test(l) && /roles/i.test(l));
  assert.deepEqual(cpLines.map((l) => l.trim()), ['cp "$ROLES_COPY" "$REPO/roles/"'],
    "a cp-shaped copy of the LIVE roles.db appeared in the lane — only the VACUUM INTO output may be cp'd");
  assert.ok(!/\bcp\b[^\n]*ROLES_SRC/.test(LANE), "the lane cp's the live roles.db");
});

test("a fixture roles.db survives the copy row for row, and the counts are the ones the lane reports", () => {
  const src = join(scratch, "roles.db");
  const dst = join(scratch, "roles-copy.db");
  makeFixture(src);

  const before = readFileSync(src);
  const out = runCopier(src, dst);

  // 7 grants, one revoked -> 6 live roles; 7 grant receipts + 1 revoke receipt -> 8 audit rows.
  assert.equal(out.audit_rows, 8, "role_audit count is not what the fixture wrote");
  assert.equal(out.grant_rows, 6, "live grant count is not what the fixture wrote");
  assert.equal(out.bytes, statSync(dst).size, "the reported byte count is not the copy's actual size");

  assert.deepEqual(rows(dst, "role_audit"), rows(src, "role_audit"), "an audit row changed in the copy");
  assert.deepEqual(rows(dst, "roles"), rows(src, "roles"), "a grant row changed in the copy");

  // NOT A FILE COPY, and this is the assertion that makes the row comparison the
  // right check: the bytes differ because VACUUM INTO reclaims the free pages.
  assert.notEqual(statSync(dst).size, statSync(src).size,
    "the copy is byte-identical in SIZE to the source — if this lane became a cp, the row checks above would still pass");

  // READ-ONLY, proved by the source rather than by the flag: unchanged after.
  assert.deepEqual(readFileSync(src), before, "the lane MODIFIED roles.db while backing it up");
});

test("THE TAMPER: the row comparison can FAIL — one altered audit row reddens it", () => {
  const src = join(scratch, "tamper.db");
  const dst = join(scratch, "tamper-copy.db");
  makeFixture(src);
  runCopier(src, dst);
  assert.deepEqual(rows(dst, "role_audit"), rows(src, "role_audit"), "control: the untampered copy must match");

  const db = new DatabaseSync(dst);
  db.prepare("UPDATE role_audit SET actor = ? WHERE id = ?").run("somebody-else", 1);
  db.close();

  assert.throws(() => assert.deepEqual(rows(dst, "role_audit"), rows(src, "role_audit")),
    "a changed audit row did NOT redden the comparison — the check above proves nothing");
});

test("an absent roles.db is reported, never failed — no role has been granted on most boxes", () => {
  // src/server.mjs: OFFICE_ROLE_GATES is unset on every office today, so the
  // file legitimately does not exist. The lane must not redden for that.
  assert.match(LANE, /ROLES_STATUS=absent/, "the lane has no `absent` state for a box that never granted a role");
  assert.match(LANE, /if \[ -f "\$ROLES_SRC" \]/, "the lane does not test for the file before copying it");
  // …and the FAILURE path is still a failure: an unreadable file exits non-zero.
  assert.match(LANE, /fail "roles\.db VACUUM INTO failed/, "a failed copy does not redden the unit");
});

test("the receipt and LATEST.json carry the bytes and the audit count, under the row that already watches this lane", () => {
  assert.match(LANE, /"roles_db_bytes":\s*\$ROLES_BYTES/, "LATEST.json does not carry roles_db_bytes");
  assert.match(LANE, /"role_audit_rows":\s*\$ROLES_AUDIT/, "LATEST.json does not carry the role_audit count");
  assert.match(LANE, /"roles_status":"%s","roles_db_bytes":%d,"role_audit_rows":%d,"grant_rows":%d/,
    "the state file the roll-call reads does not carry the roles numbers");

  // NO NEW ROLL-CALL ROW: the existing backup row's receipt is the one that
  // covers this file. A second row would be a second thing to watch for one
  // small file, and the point of riding this lane is that there isn't one.
  const manifest = JSON.parse(readFileSync("deploy/box-rollcall-manifest.json", "utf8"));
  const backup = manifest.units.filter((u) => /roles|backup/.test(u.unit));
  assert.deepEqual(backup.map((u) => u.unit), ["postmark-world2-backup.timer"],
    "a roles row appeared in the roll-call — this file rides the backup lane's row, it does not get its own");
  assert.match(backup[0].stale_means, /who paid/,
    "the backup row's stale_means does not say that a silence now also costs who paid");
});

// ── the rehearsal's comparison, RUN rather than read ────────────────────────
// Asserting that the rehearsal's TEXT mentions role_audit would be a check that
// does not read the behaviour it names: it passes over a block that computes the
// wrong verdict. So the block is EXTRACTED FROM THE SHIPPED SCRIPT and executed
// against fixtures, with the surrounding script stubbed down to what it touches
// (`say`, `bad`, `drift_lines`, the two paths).
function runRehearsalBlock(rolesDir, liveDb) {
  const start = 'say "== roles.db, shipped copy vs live registry"';
  const from = REHEARSE.indexOf(start);
  assert.ok(from > 0, "the rehearsal no longer has a roles comparison block — this test is now measuring nothing");
  const end = REHEARSE.indexOf("\nfi\n", REHEARSE.indexOf("\nelse\n", from));
  const block = REHEARSE.slice(from, end + 4)
    .replace('ROLES_DIR="$WORLD2_LAB/private-dumps"', `ROLES_DIR="${rolesDir}"`);

  const harness = join(scratch, "harness.sh");
  writeFileSync(harness, [
    "set -uo pipefail",
    "say() { printf '%s\\n' \"$*\"; }",
    "bad=0; drift_lines=''; FROM_REMOTE=false; TMPCLONE=''",
    `W2_ROLES_DB="${liveDb}"; WORLD2_LAB="${rolesDir}"; WORLD2_OFFICE="${liveDb}"`,
    block,
    'echo "BAD=$bad"',
  ].join("\n"));
  const out = execFileSync("bash", [harness], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  return { out, bad: Number(out.match(/BAD=(\d+)/)[1]) };
}

function auditDb(path, n) {
  rmSync(path, { force: true });
  const db = new DatabaseSync(path);
  db.exec("CREATE TABLE role_audit (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT, action TEXT, subject TEXT, role TEXT, login TEXT, actor TEXT, note TEXT);");
  const a = db.prepare("INSERT INTO role_audit (at,action,subject,role,actor) VALUES (?,?,?,?,?)");
  for (let i = 0; i < n; i++) a.run("t", "grant", String(i), "subscriber", "wright");
  db.close();
}

test("the restore rehearsal COMPARES the roles copy — and only the impossible direction reddens", () => {
  assert.match(REHEARSE, /role_audit/, "the rehearsal does not compare the role_audit count");

  const dir = mkdtempSync(join(scratch, "reh-"));
  const live = join(dir, "live-roles.db");
  const copy = join(dir, "roles-20260921T081000Z.db");

  // A · the live registry has GAINED rows since the copy. role_audit is
  // append-only and the town kept selling, so this is the ordinary night.
  auditDb(copy, 8); auditDb(live, 11);
  let r = runRehearsalBlock(dir, live);
  assert.match(r.out, /live \+3 \(grants since the copy — expected\)/);
  assert.equal(r.bad, 0, "a live registry ahead of the copy reddened the rehearsal — that is the town being alive");

  // B · THE FINDING: the copy holds MORE than live. No clock explains that, so
  // the two disagree about history and the rehearsal must fail.
  auditDb(live, 4);
  r = runRehearsalBlock(dir, live);
  assert.match(r.out, /COPY HAS MORE \(\+4\) — THE REGISTRY LOST ROWS IT ONCE HAD/);
  assert.equal(r.bad, 1, "the copy holding rows the live registry lost did NOT redden — the comparison proves nothing");

  // C · nothing shipped yet, on a box where no role was ever granted. Reported
  // as NOT-RUN in the operator's words, never silently as a pass.
  const empty = mkdtempSync(join(scratch, "empty-"));
  r = runRehearsalBlock(empty, live);
  assert.match(r.out, /NOT-RUN: no roles-\*\.db/);
  assert.equal(r.bad, 0, "an absent copy reddened — a box that never granted a role has nothing to ship");

  // D · the rescue box: a copy in hand and no live registry to compare against.
  r = runRehearsalBlock(dir, join(dir, "nonesuch.db"));
  assert.match(r.out, /live registry absent — nothing to compare against/);
  assert.equal(r.bad, 0, "a missing live registry reddened — that is the restore case, not a fault");
});
