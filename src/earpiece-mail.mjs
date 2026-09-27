// earpiece-mail.mjs — THE EARPIECE'S MAIL PORT: postmark-pen writes the letter
// (POS-209, the mail sender).
//
// The earpiece's rules are src/earpiece.mjs's; this file is only the hand. It
// writes a mail wake through the office's ONE send (send-at-door.mjs §
// sendAtDoor), exactly as a resident's `do: "send"` is written: flag-off an
// outbox file at WHITE_PAGES/postmark-pen/outbox/ committed to the town clone,
// flag-on (TOWN_SINGLE_LOG=1) a town-log row the crossing's drain turns into
// that same file. The ferry carries it either way; nothing here delivers.
//
// ── THE SENDER (Keemin 2026-09-25) ──────────────────────────────────────────
//
// "we have postmark-pen in git, so let's just reuse that handle under the-town".
// postmark-pen is a resident of the town's own household (town
// WHITE_PAGES/postmark-pen/ADDRESS.md, tools/households.json `the-town`). Not
// postmaster: that is Ferry's voice, and the office writing in it without her
// would be impersonation.
//
// ── THE KEY IS NOT A CREDENTIAL ─────────────────────────────────────────────
//
// This is the office's own machinery, not a door call, so there is no token
// and no secret. The pen's fence is `key.handles.has(from)` (write.mjs §
// validateLetter), and the key below is built the way the drain rebuilds one
// from a row (town-mail.mjs § replayLetter): "only as far as the pen's own
// identity fence needs: the sender it acted for and the household it was
// charged to". `household` is read by the commit message, the town-log row and
// the nonce slot, and nothing else.

import { sendAtDoor } from "./send-at-door.mjs";
import { PEN_HANDLE } from "./earpiece.mjs";

export const PEN_KEY = Object.freeze({
  household: "the-town",
  handles: new Set([PEN_HANDLE]),
  ghLogin: "postmark-pen",
  ghId: "301406700",
});

/**
 * The mail port the deliverer calls: `({ to, title, body }) → { ok, letter_id }`.
 * A bounce from the office's own fence throws, in its own vocabulary, and the
 * deliverer logs it `failed` (uncharged) with that sentence.
 *
 * `thread` is `new`: the fence accepts only `new` or a letter id the index
 * knows, and an event id is neither (MEASUREMENT.md, finding 1).
 */
export function penMailPort({ db, clone, odb = null, key = PEN_KEY, send = sendAtDoor } = {}) {
  return async ({ to, title, body }) => {
    if (!db) return { ok: false, detail: "the office's index (office.db) is not there, so the pen cannot check the recipient" };
    if (!clone) return { ok: false, detail: "no town clone is configured (TOWN_CLONE), so the pen has nowhere to write" };
    const { result } = await send({ from: PEN_HANDLE, to, title, body, thread: "new" }, key, { db, clone, odb });
    return { ok: true, letter_id: result?.letter_id ?? null };
  };
}
