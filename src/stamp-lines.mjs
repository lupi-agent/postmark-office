// stamp-lines.mjs — THE STAMP LEDGER'S CHAIN LIVES IN THE STORE (POS-341, Q1).
//
// Ruled by Darko, 2026-10-04: the signed append-only chain that proves the town's
// economy lives in the store (064, stamp_lines), appended by the pen IN THE SAME
// TRANSACTION as the act that writes it, and the town repo's
// WHITE_PAGES/stamp-ledger.md becomes its signed public export. This file is the
// writer, the reader and the verifier.
//
// ── THE PEN'S TRANSACTION ────────────────────────────────────────────────────
//
// Every ledger line is still signed by the town's own engine (appendSigned, the
// CLIs, the mint runner) into the clone's file under the town lock. What changes
// is the commit: `stampedCommit` opens ONE store transaction, records every line
// the file now holds past the store's last row (each one's seal recomputed and
// its signature verified), then runs the pen's git ceremony inside it. Git
// refuses (a push that can't land, a commit that fails), and the transaction
// rolls back with it: the store never holds a line the export lost. The store
// refuses (a forged or unsigned line, a changed past), and the commit never
// runs. The one window left is a git landing whose COMMIT then fails, which
// leaves the store BEHIND its export; the next stamped write or
// `stamp-lines.mjs --sync` records those lines (the store reads git), and the
// verifier says so until it does.
//
// ── THE SWITCH ───────────────────────────────────────────────────────────────
//
// `STAMP_LINES=store` turns the store write on. Unset, `stampedCommit` is the
// plain pen commit, exactly as before 064, and the rollback is unsetting it.
// Apply 064 before setting it.
//
// ── ONE ROW VOUCHES FOR THE WHOLE PAST ──────────────────────────────────────
//
// A line's signature is over its seal, and a seal is sha256(previous seal +
// canonical) from the town's genesis. So a file whose line N carries the same
// canonical and signature as the store's row N has the same N lines the store
// has, and only the lines after it are new. The verifier still walks the whole
// chain; the writer needs one row.

import { createPublicKey, verify as edVerify } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { NOT_LANDED, penCommit } from "./write.mjs";

const LEDGER_REL = join("WHITE_PAGES", "stamp-ledger.md");
const ledgerOf = (clone) => join(clone, LEDGER_REL);
const isLedger = (clone, p) => /(^|[\\/])WHITE_PAGES[\\/]stamp-ledger\.md$/.test(String(p));

/** Is the store write on? Only the exact value `store` turns it on. */
export const stampLinesOn = (env = process.env) => env.STAMP_LINES === "store";

/** The town's engine, from the clone (the one grammar, the one seal). */
export async function engineOf(clone) {
  return import(pathToFileURL(join(clone, "tools", "stamp-mint.mjs")).href);
}

/** The town's public key, from the clone. */
export function pubkeyOf(clone) {
  const p = join(clone, "tools", "stamp-pubkey.pem");
  return existsSync(p) ? readFileSync(p, "utf8") : null;
}

const rawOf = (r) => `${r.canonical} · sig: ${r.sig}`;

/** Every row, in ledger order, as parseStampLedger entries: `{ seq, canonical, sig, seal, raw }`. */
export async function stampLinesVia(q) {
  const { rows } = await q.query("SELECT seq, canonical, sig, seal FROM stamp_lines ORDER BY seq");
  return rows.map((r) => ({ ...r, raw: rawOf(r) }));
}

/** The seal a line takes after `prev` (null for the first line), by the town's own construction. */
export function sealAfter(engine, prev, canonical) {
  return prev == null ? engine.sealChain([canonical])[0] : engine.sha256hex(prev + canonical);
}

const sigOk = (key, seal, sig) => {
  try { return edVerify(null, Buffer.from(seal, "utf8"), key, Buffer.from(sig, "base64url")); }
  catch { return false; }
};

/**
 * Record every line the clone's ledger holds past the store's last row, inside
 * the caller's transaction. Refuses, writing nothing, on: a file shorter than
 * the store, a file whose line at the store's last row is not that row (the
 * past moved), an unsigned line, or a signature that does not verify over the
 * recomputed seal. Returns `{ held, inserted }`.
 */
export async function syncStampLinesVia(client, clone, { engine = null, pubkeyPem = null } = {}) {
  const eng = engine ?? await engineOf(clone);
  const pem = pubkeyPem ?? pubkeyOf(clone);
  if (!pem) throw new Error("no tools/stamp-pubkey.pem in the clone: a line's signature cannot be checked, so none is recorded");
  const key = createPublicKey(pem);
  await client.query("SELECT pg_advisory_xact_lock(hashtext('stamp_lines'))");
  const path = ledgerOf(clone);
  const entries = existsSync(path) ? eng.parseStampLedger(readFileSync(path, "utf8")) : [];
  const { rows: [head] } = await client.query(
    "SELECT seq, canonical, sig, seal FROM stamp_lines ORDER BY seq DESC LIMIT 1");
  const held = head ? Number(head.seq) : 0;
  if (entries.length < held)
    throw new Error(`the stamp ledger's export holds ${entries.length} lines and the store ${held}: the export lost lines the store recorded. Nothing was written.`);
  if (head) {
    const at = entries[held - 1];
    if (at.canonical !== head.canonical || at.sig !== head.sig)
      throw new Error(`the stamp ledger's line ${held} is not the line the store holds: its past changed, and it is append-only by town law. Nothing was written.`);
  }
  let prev = head?.seal ?? null;
  const fresh = [];
  for (let i = held; i < entries.length; i++) {
    const e = entries[i];
    if (!e.sig) throw new Error(`the stamp ledger's line ${i + 1} is UNSIGNED: the store records only signed lines. Nothing was written.`);
    const seal = sealAfter(eng, prev, e.canonical);
    if (!sigOk(key, seal, e.sig)) throw new Error(`the stamp ledger's line ${i + 1}: its signature does not verify over its seal. Nothing was written.`);
    fresh.push([i + 1, e.canonical, e.sig, seal]);
    prev = seal;
  }
  for (let i = 0; i < fresh.length; i += 1000) {
    const c = fresh.slice(i, i + 1000);
    await client.query(
      `INSERT INTO stamp_lines (seq, canonical, sig, seal)
       SELECT * FROM unnest($1::int[], $2::text[], $3::text[], $4::text[])`,
      [c.map((r) => r[0]), c.map((r) => r[1]), c.map((r) => r[2]), c.map((r) => r[3])]);
  }
  return { held, inserted: fresh.length };
}

/**
 * THE VERIFIER: the store's chain on its own (every seal recomputed from the
 * town's genesis, every signature verified), and the export byte for byte (the
 * file's entry lines, each exactly `canonical · sig: sig` of the row at its
 * position, no more and no fewer). `{ ok, problems, held, exported }`.
 */
export async function verifyStampLinesVia(q, clone, { engine = null, pubkeyPem = null } = {}) {
  const eng = engine ?? await engineOf(clone);
  const pem = pubkeyPem ?? pubkeyOf(clone);
  const problems = [];
  const rows = await stampLinesVia(q);
  if (!pem) problems.push("no tools/stamp-pubkey.pem: the store's signatures were not checked");
  const key = pem ? createPublicKey(pem) : null;
  let prev = null;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (Number(r.seq) !== i + 1) { problems.push(`store: row ${i + 1} carries seq ${r.seq}: the chain has a gap`); break; }
    const seal = sealAfter(eng, prev, r.canonical);
    if (seal !== r.seal) { problems.push(`store: line ${r.seq}'s seal is not the chain's`); break; }
    if (key && !sigOk(key, seal, r.sig)) { problems.push(`store: line ${r.seq}'s signature does not verify`); break; }
    prev = seal;
  }
  const path = ledgerOf(clone);
  const exported = existsSync(path) ? eng.parseStampLedger(readFileSync(path, "utf8")) : [];
  const n = Math.min(rows.length, exported.length);
  for (let i = 0; i < n; i++)
    if (exported[i].raw !== rows[i].raw) { problems.push(`export: line ${i + 1} differs from the store's\n  store : ${rows[i].raw}\n  export: ${exported[i].raw}`); break; }
  if (exported.length > rows.length) problems.push(`export: ${exported.length - rows.length} line(s) past the store's ${rows.length} (the store is behind its export: run stamp-lines.mjs --sync)`);
  if (exported.length < rows.length) problems.push(`export: ${rows.length - exported.length} line(s) the store holds are missing from the export`);
  return { ok: problems.length === 0, problems, held: rows.length, exported: exported.length };
}

/**
 * THE PEN'S COMMIT WHEN IT CARRIES LEDGER LINES. With the switch on and the
 * ledger among `addPaths`: one store transaction records the new lines, then
 * the git ceremony runs inside it, and either both land or neither does (see
 * the header). Otherwise it is `penCommit`. Async: callers await it.
 */
export async function stampedCommit(clone, addPaths, message, { env = process.env, engine = null } = {}) {
  if (!stampLinesOn(env) || !addPaths.some((p) => isLedger(clone, p))) return penCommit(clone, addPaths, message);
  const { officeWrite } = await import("./world2-pen.mjs");
  const eng = engine ?? await engineOf(clone);
  return officeWrite(async (client) => {
    await syncStampLinesVia(client, clone, { engine: eng });
    const commit = penCommit(clone, addPaths, message);
    // A lost race rebases the commit onto the remote: every line it carries is
    // recorded again here (a no-op when the rebase brought none).
    await syncStampLinesVia(client, clone, { engine: eng });
    return commit;
  }, { env });
}

/** landOrRefuse for a stamped commit: a push that cannot land is the exec's answer, not a trip. */
export async function landStamped(clone, addPaths, message, opts = {}) {
  try { return await stampedCommit(clone, addPaths, message, opts); }
  catch (e) {
    if (e?.pen !== NOT_LANDED) throw e;
    return { error: { code: e.code, defect: e.defect, hint: e.hint } };
  }
}
