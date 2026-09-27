// vendor-drift.test.mjs — the vendored readers are still the files their
// headers say they are (POS-128, postmark#2765).
//
// `vendor/` holds copies of files that live upstream in postmark-town/
// postmark-site. The copy's first line records the upstream path and its
// sha256; the second line says do not edit here. From 2026-07-07 to tonight
// that second line named `scripts/check-vendor-drift` — a checker that did not
// exist, so for two and a half months the promise was unenforced and the office
// had no way to learn that its reader had fallen 173 lines behind.
//
// THIS FILE IS THE ENFORCEMENT, and it has two halves, because a green checker
// proves nothing until you have watched it go red:
//   1. the real vendor/ is clean, and something was actually checked;
//   2. the checker REDS on a one-character edit — run against a throwaway copy
//      of vendor/, so the assertion costs the real tree nothing.

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CHECKER = join(ROOT, "scripts", "check-vendor-drift.mjs");

/** Run the checker at `root`, and report its exit code rather than throwing. */
function runChecker(root) {
  try {
    const stdout = execFileSync(process.execPath, [join(root, "scripts", "check-vendor-drift.mjs")], {
      encoding: "utf8", stdio: "pipe",
    });
    return { code: 0, out: stdout };
  } catch (e) {
    return { code: e.status ?? 1, out: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}

test("every vendored file is the file its header names", () => {
  const { code, out } = runChecker(ROOT);
  assert.equal(code, 0, `check-vendor-drift reported drift:\n${out}`);

  // A checker that passes because it found nothing is the failure this whole
  // file exists to prevent. Assert it actually looked at something.
  const m = /(\d+) vendored file\(s\) checked/.exec(out);
  assert.ok(m, `the checker did not report how many files it checked:\n${out}`);
  assert.ok(Number(m[1]) >= 3, `only ${m?.[1]} vendored file(s) checked — vendor/ should hold at least 3`);

  // and the reader this whole re-vendor is about is one of them
  assert.match(out, /ok\s+vendor\/tools\/lib\/town\.mjs/, out);
});

test("THE CHECKER CAN FAIL: one character of a header's hash turns it red", () => {
  const sandbox = mkdtempSync(join(tmpdir(), "vendor-drift-"));
  try {
    mkdirSync(join(sandbox, "scripts"), { recursive: true });
    cpSync(CHECKER, join(sandbox, "scripts", "check-vendor-drift.mjs"));
    cpSync(join(ROOT, "vendor"), join(sandbox, "vendor"), { recursive: true });

    // the copy is green before we touch it — the control
    assert.equal(runChecker(sandbox).code, 0, "the sandbox copy should start green");

    const target = join(sandbox, "vendor", "tools", "lib", "town.mjs");
    const before = readFileSync(target, "utf8");
    const header = before.split("\n")[0];
    const hash = /upstream sha256 ([0-9a-f]+)/.exec(header)[1];
    // flip exactly one hex digit of the recorded hash, nowhere else
    const flipped = hash.slice(0, -1) + (hash.at(-1) === "0" ? "1" : "0");
    const after = before.replace(`upstream sha256 ${hash}`, `upstream sha256 ${flipped}`);
    assert.notEqual(after, before, "the flip must actually change the file");
    writeFileSync(target, after);

    const { code, out } = runChecker(sandbox);
    assert.equal(code, 1, `the checker stayed green on a flipped header:\n${out}`);
    assert.match(out, /DRIFT .*vendor[\\/]tools[\\/]lib[\\/]town\.mjs/, out);
    // and it says BOTH hashes, so a human can see which half moved
    assert.ok(out.includes(flipped), "the drift report must print the header's hash");
    assert.ok(out.includes(hash), "the drift report must print the body's actual hash");
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});

test("a vendor file with no header is a red, not a shrug", () => {
  const sandbox = mkdtempSync(join(tmpdir(), "vendor-unheadered-"));
  try {
    mkdirSync(join(sandbox, "scripts"), { recursive: true });
    cpSync(CHECKER, join(sandbox, "scripts", "check-vendor-drift.mjs"));
    cpSync(join(ROOT, "vendor"), join(sandbox, "vendor"), { recursive: true });
    writeFileSync(join(sandbox, "vendor", "smuggled.mjs"), "export const x = 1;\n");

    const { code, out } = runChecker(sandbox);
    assert.equal(code, 1, `an unheadered file in vendor/ passed:\n${out}`);
    assert.match(out, /UNHEADERED/, out);
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});
