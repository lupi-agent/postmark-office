#!/usr/bin/env node
// check-vendor-drift.mjs — the checker `vendor/*` headers have named since
// 2026-07-07 and which did not exist until now (POS-128, postmark#2765).
//
// WHAT A VENDORED FILE PROMISES. Its first two lines say: this body is a
// byte-for-byte copy of <upstream path>, whose sha256 is <hash>; do not edit
// here. Both halves of that promise can rot, and they rot differently:
//
//   the LOCAL half   — somebody edits the body here. The header still names a
//                      hash the body no longer has.
//   the UPSTREAM half — the upstream moves. The header's hash still matches our
//                      body, and both are stale against the file we copied.
//
// So there are two modes. The default checks the LOCAL half and needs nothing
// but this checkout — no network, no clone — which is why it can sit in
// `npm test`. `--upstream <dir>` checks the UPSTREAM half against a local
// clone. Neither mode ever fetches; a checker that reaches the network is a
// checker that goes red when the network does.
//
// THE CONVENTION IS PART OF THE HASH, and leaving it unstated cost a real
// measurement (POS-128, 2026-09-21). `vendor/town.mjs`'s recorded
// a408ddfd… did not match its own body under sha256, and looked for an hour
// like a local edit. It was not: the July vendoring hashed the upstream as it
// sat in a Windows checkout, CRLF, while `vendor/ids.mjs`'s recorded hash the
// same day was LF. Two files, one day, two conventions, nothing written down.
// So a header written from here states its convention, and the parser below
// reads `CRLF` when a header says so and LF otherwise — LF being both the
// repo's law (.gitattributes: "Text, LF, always") and the older files' default.

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const VENDOR = join(ROOT, "vendor");

// `// VENDORED from <repo> <path> (upstream sha256 <hex>[...][, <CONV>], vendored <date>).`
// The `...` and the missing convention are the pre-POS-128 shape, still live in
// vendor/ids.mjs; both shapes parse.
const HEADER = /^\/\/ VENDORED from (\S+) (\S+) \(upstream sha256 ([0-9a-f]+)(\.\.\.|…)?(?:, (CRLF|LF))?, vendored (\d{4}-\d{2}-\d{2})\)\.$/;

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

/**
 * Hash `text` under the header's stated line-ending convention.
 *
 * BOTH SIDES GO THROUGH HERE, and that is the whole point. The first draft of
 * this checker hashed the local body under the convention and the upstream file
 * as raw bytes, and it reported DRIFT on three files that had just been vendored
 * byte-for-byte — because `git archive` out of a Windows clone hands you CRLF
 * for a blob that is LF in the object store. That is the same trap that made
 * `vendor/town.mjs`'s July hash unreadable, sprung again inside the tool written
 * to catch it. Normalise to LF first, then re-apply the convention, so what is
 * compared is the file and never the checkout it came out of.
 */
function hashUnder(text, convention) {
  const lf = text.replace(/\r\n/g, "\n");
  return sha256(Buffer.from(convention === "CRLF" ? lf.replace(/\n/g, "\r\n") : lf, "utf8"));
}

/** The body is everything after the two header lines. */
const bodyHash = (text, convention) => hashUnder(text.replace(/\r\n/g, "\n").split("\n").slice(2).join("\n"), convention);

/** A recorded hash may be a 16-char prefix (the old shape). Compare like for like. */
const agrees = (recorded, actual) => actual.slice(0, recorded.length) === recorded;

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (name.endsWith(".mjs")) out.push(p);
  }
  return out;
}

const upstreamDir = (() => {
  const i = process.argv.indexOf("--upstream");
  if (i === -1) return null;
  const dir = process.argv[i + 1];
  if (!dir || dir.startsWith("--")) {
    console.error("FAIL: --upstream needs a directory (the root of a local postmark-site checkout)");
    process.exit(2);
  }
  if (!existsSync(dir)) {
    console.error(`FAIL: --upstream ${dir} does not exist`);
    process.exit(2);
  }
  return dir;
})();

if (!existsSync(VENDOR)) {
  console.error("FAIL: no vendor/ directory — this checker has nothing to stand on");
  process.exit(1);
}

const files = walk(VENDOR).sort();
if (files.length === 0) {
  // A checker that passes because it found nothing is the failure mode this
  // whole file exists to prevent. An empty vendor/ is a red, not a green.
  console.error("FAIL: vendor/ holds no .mjs files — nothing was checked");
  process.exit(1);
}

let checked = 0;
let drifted = 0;
let unheadered = 0;

for (const file of files) {
  const rel = relative(ROOT, file).replace(/\\/g, "/");
  const text = readFileSync(file, "utf8");
  const m = HEADER.exec(text.split("\n")[0]);
  if (!m) {
    console.error(`UNHEADERED  ${rel} — a file in vendor/ that does not say what it is a copy of`);
    unheadered++;
    continue;
  }
  const [, repo, path, recorded, , convention = "LF", date] = m;

  const actual = bodyHash(text, convention);
  checked++;
  if (agrees(recorded, actual)) {
    console.log(`ok    ${rel}  (${repo} ${path}, ${convention}, vendored ${date})`);
  } else {
    drifted++;
    console.error(`DRIFT ${rel} — the body here is not the body this header names`);
    console.error(`        header  sha256 ${recorded}`);
    console.error(`        body    sha256 ${actual.slice(0, recorded.length)}   (full: ${actual})`);
    console.error(`        convention ${convention}. Either the body was edited here — it must not be —`);
    console.error(`        or the header was not rewritten when it was re-vendored.`);
  }

  if (upstreamDir) {
    const up = join(upstreamDir, path);
    if (!existsSync(up)) {
      console.error(`        (upstream ${path} not in ${upstreamDir} — this file's upstream was not checked)`);
      continue;
    }
    const upHash = hashUnder(readFileSync(up, "utf8"), convention);
    if (agrees(recorded, upHash)) {
      console.log(`      upstream matches: ${up}`);
    } else {
      drifted++;
      console.error(`DRIFT ${rel} — UPSTREAM has moved since we vendored it`);
      console.error(`        header   sha256 ${recorded}`);
      console.error(`        upstream sha256 ${upHash.slice(0, recorded.length)}   (full: ${upHash})`);
      console.error(`        re-vendor: copy ${up} in, and rewrite the header's hash and date.`);
    }
  }
}

console.log(`\n${checked} vendored file(s) checked, ${drifted} drifted, ${unheadered} unheadered.`);
process.exit(drifted + unheadered > 0 ? 1 : 0);
