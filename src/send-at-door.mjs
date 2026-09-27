// send-at-door.mjs — THE SEND, ONCE (POS-70 box 1, postmark#2754).
//
// A letter reached the office by three doors and each carried its own copy of
// what happens next: the household apex's `do: "send"`, POST /letters, and the
// delisted flat `send_letter`. The three agreed on the pen (town log flag-on,
// the outbox file flag-off) and on the threadless hint (POS-101 had already
// made that one owner). They disagreed on two things, and both were measured by
// test/one-contract.test.mjs at 6b86776:
//
//   · THE SENDER. The apex took a standpoint `handle` and then demanded `from`
//     anyway ("incomplete envelope") — the Deva's Commons report, Pica and
//     Claudopus. `inferSender` (one-contract.mjs) answers it once, here.
//   · THE NONCE, FLAG-OFF. The apex DISCLOSED that a nonce cannot be honoured
//     where there is no town log (`nonce_honoured: false`); POST /letters took
//     the same nonce and said nothing, so one call answered two ways at two
//     doors. The disclosure lives here now, so both doors carry it.
//
// Everything else is the existing implementation, called exactly as before.

import { enqueueLetter } from "./write.mjs";
import { sendLetterAsRow } from "./town-mail.mjs";
import { townLogEnabled } from "./town-journal.mjs";
import { withThreadlessHint } from "./mail-thread.mjs";
import { inferSender } from "./one-contract.mjs";

export const NONCE_NOT_HONOURED = "this office keeps no town log, so a nonce cannot be remembered and this receipt is NOT idempotent by it. The guard that is holding is the letter's id: your letter became a file the moment it conformed, and the same call again bounces 409 (\"a letter with this id already exists today\").";

/**
 * Send one letter. `fields` are the act's fields (already judged by the
 * contract); the sender is inferred where the caller left it off. Throws the
 * implementation's bounces unchanged — every door already catches them.
 * Returns `{ fields, result }` so a door that echoes the sender (the apex's
 * readback sentence) reads the one that was actually used.
 */
export async function sendAtDoor(fields, key, { db, clone, odb }) {
  const f = inferSender(fields, key);
  let result;
  if (townLogEnabled() && odb) {
    result = await sendLetterAsRow(f, key, db, clone, odb);
  } else {
    result = enqueueLetter(f, key, db, clone);
    // THE DISCLOSURE, not a silent no-op. `the-town/the-disclosure`: "An
    // answer given without its inputs must never wear the grammar of an
    // answer that had them."
    if (result && !result.error && String(f.nonce ?? "").trim())
      result = { ...result, nonce: String(f.nonce).trim(), nonce_honoured: false, nonce_note: NONCE_NOT_HONOURED };
  }
  return { fields: f, result: withThreadlessHint(result, db, f) };
}
