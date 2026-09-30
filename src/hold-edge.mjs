// hold-edge.mjs — where the holding edge lives at this office (POS-269).
//
// Where the hold lane's pen is flipped and the guards read the record (prod:
// W2_PEN has hold, W2_GUARDS=1), every give, drop and take is an act in
// `acts`, the door's holder check reads it back, and the act IS the edge:
// the door writes nothing to dynamic.db's `attachments`
// (world-hold.mjs § declareHoldingFlipped), and crossing-save reads holdings
// from the record (tools/crossing-save.mjs § attachmentsForSave). Elsewhere
// sqlite is still that office's record, and both read it as before.
//
// This file held an in-memory snapshot of the record's attachment rows for the
// arena's fold and the apex's portal block, the two synchronous readers. The
// arena closed on 2026-09-30 (Keemin) and took both with it, so the snapshot
// had no reader left and went too. The switch is what remains.

import { laneFlipped } from "./world2-pen.mjs";
import { guardsFlipped } from "./world2-guards.mjs";

/**
 * Is the holding edge `acts` and only `acts` at this office? Two flags, both
 * prod's, because it takes both: the pen must write the act, and the door's
 * holder check must read it (`guardedAttachments` reads sqlite while W2_GUARDS
 * is off, and that office still needs its sqlite edge written).
 */
export const holdEdgeOnActs = (env = process.env) => laneFlipped("hold", env) && guardsFlipped(env);
