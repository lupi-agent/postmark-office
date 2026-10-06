// ledger-pen.mjs — the office's one signer for stamp-ledger lines.
//
// Moved out of src/town-drain.mjs (2026-10-05, #3429) when admission became a
// second caller of the house-key writer (src/house-key.mjs): the drain, every
// admission road, the first-idea sweep and the rekey tool all sign through
// this one function, and none of them should have to import the crossing to
// do it. The words below are the drain's, unchanged.
//
// ── THE DRAIN SIGNS WHAT IT WRITES (#2040, the third unsigned line) ─────────
//
// The stamp-ledger's grammar has required an office-pen signature on every
// assertion line since the Ember fold (town tools/stamp-mint.mjs § SEAL +
// SIGNATURE: "seal_n = sha256(seal_{n-1} + canonical(line_n))", "sig_n =
// ed25519.sign(utf8(seal_n))", "Signing the running seal means every signature
// binds the entire prefix"). This drain was the ONE ledger writer in the office
// that appended bare — fund/gift/stake/pot all sign — and each native join
// minted a line stamp-verify refuses: zeno 08-27, errant 08-28, each repaired
// by hand. On the native path the signature is the line's only authentication:
// every box commit rides one shared git credential, so the seal chain is what
// says the office's authorized writer emitted this line at this position.
//
// The seal arithmetic is the TOWN's, not ours — computed by importing the
// clone's own tools/stamp-mint.mjs in a subprocess (the same subprocess-pen
// shape the fund/gift/stake execs already are), so there is exactly one
// authority for canonical + chain and this file duplicates none of it.
// STAMP_ENGINE_DIR overrides the tools dir for fixtures whose throwaway clones
// carry no tools/ (the fund.test.mjs precedent).

import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

export const DRAIN_KEY_PATH = () => process.env.STAMP_KEY ?? "/srv/postmark-office/stamp-key.pem";

export function signedRegistryLines(clone, bareLines) {
  const keyPath = DRAIN_KEY_PATH();
  if (!existsSync(keyPath)) {
    const e = new Error(`the ledger pen's key is absent (${keyPath}) — the drain refuses to append an unsigned registry line`);
    e.code = "pen-key-absent";
    throw e;
  }
  const engineDir = process.env.STAMP_ENGINE_DIR ?? join(clone, "tools");
  const script = [
    "const [clone, engineDir, keyPath] = process.argv.slice(1);",
    "const { readFileSync } = await import('node:fs');",
    "const { createPrivateKey, sign } = await import('node:crypto');",
    "const { pathToFileURL } = await import('node:url');",
    "const { parseStampLedger, sealChain } = await import(pathToFileURL(engineDir + '/stamp-mint.mjs'));",
    "const bare = JSON.parse(readFileSync(0, 'utf8'));",
    "const prior = parseStampLedger(readFileSync(clone + '/WHITE_PAGES/stamp-ledger.md', 'utf8')).map((e) => e.canonical);",
    "const seals = sealChain([...prior, ...bare]);",
    "const key = createPrivateKey(readFileSync(keyPath, 'utf8'));",
    "const out = bare.map((line, i) => line + ' · sig: ' + sign(null, Buffer.from(seals[prior.length + i], 'utf8'), key).toString('base64url'));",
    "process.stdout.write(JSON.stringify(out));",
  ].join("\n");
  const stdout = execFileSync(process.execPath, ["--input-type=module", "-e", script, clone, engineDir, keyPath],
    { input: JSON.stringify(bareLines), encoding: "utf8" });
  const signed = JSON.parse(stdout);
  if (!Array.isArray(signed) || signed.length !== bareLines.length)
    throw new Error("the signing subprocess answered a shape that is not one signed line per bare line");
  return signed;
}

/**
 * Is the ledger pen ready to sign this clone's registry appends? The drain's
 * caller asks BEFORE writing anything, so a missing key is a refusal that
 * leaves every row queued and the cursor unmoved — refuse, never degrade: an
 * unsigned line is not a lesser record, it is a red the whole ledger wears.
 */
export function drainPenReady(clone) {
  if (!existsSync(join(clone, "WHITE_PAGES", "stamp-ledger.md"))) return { ready: true, note: "no ledger in this clone — nothing to sign" };
  if (!existsSync(DRAIN_KEY_PATH())) return { ready: false, why: `pen key absent at ${DRAIN_KEY_PATH()}` };
  return { ready: true };
}
