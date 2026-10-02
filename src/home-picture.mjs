// home-picture.mjs — a resident's house picture, kept on their household's record (POS-219).
//
// THE RULINGS (Keemin). 2026-09-27: "the one home-picture field lives on the
// HOUSEHOLD RECORD … the house mark points at it, never holds a copy."
// 2026-09-28: "absolutely each resident should be able to have their own
// house." So the household's row keeps one picture per resident's home,
// handle → media-door URL (`households.home_images`, migration 050), and the
// map and the site both read it there.
//
// ── ONE WRITER, AND EVERY PATH CALLS IT ─────────────────────────────────────
//
//   · PATCH /home/{h}/image (src/edit.mjs § homeImageWrite) has the bytes: it
//     mints them through `uploadMedia` and hands the URL here. It no longer
//     writes HOME/ (Wright, 2026-09-28: HOME/ keeps what is there as history).
//   · the MCP home act (`household { do: "home", args: { image } }`) hands a
//     URL the resident already minted with `upload_media`.
//   · tools/home-picture-carry.mjs, once at the ship, hands each resident's
//     legacy HOME/ lead picture, minted the same way.
//
// ── THE ACT, IN ORDER ───────────────────────────────────────────────────────
//
//   1. the handle is one of the key's residents (the paper doors' own scope);
//   2. the URL is the town's media door (`mediaUrlOk`, the mark door's test);
//   3. the store writes the one key of the one row that holds the handle
//      (`setHomeImage`), or nothing;
//   4. the drain renders the town's households.json from the store, inside
//      `penTransaction` (POS-296), so a push that cannot land leaves the clone
//      as it was. The store is the record: a drain that is refused leaves the
//      picture kept and the file a crossing behind, exactly as the ceremonies
//      report it (`src/ceremony.mjs § drainOutcome`).

import { penTransaction } from "./write.mjs";
import { mediaUrlOk } from "./media.mjs";
import { setHomeImage } from "./registry-store.mjs";
import { drainRegistry } from "../tools/registry-drain.mjs";

// The doors' bounce, as edit.mjs and media.mjs spell it: a thrown Error
// carrying code, defect and hint, which every skin turns into its refusal.
const bounce = (code, defect, hint) => Object.assign(new Error(defect), { code, defect, hint });

/**
 * @param {{ handle: string, url: string }} args
 * @param {{ handles?: Set<string> }} key   the caller's key; a tool passes one naming the handle
 * @param {{ clone?: string|null, env?: object, write?: Function, drain?: Function }} [deps]
 * @returns {Promise<{ handle, household, picture, registry, commit }>}
 */
export async function setHomePicture({ handle, url } = {}, key = null,
  { clone = null, env = process.env, write = setHomeImage, drain = drainRegistry } = {}) {
  const h = String(handle ?? "").trim();
  if (!h) throw bounce(422, "which resident's house?", "pass handle: one of your residents");
  if (!key?.handles?.has(h))
    throw bounce(403, `"${h}" is not one of your residents`, `this key acts for: ${[...(key?.handles ?? [])].join(", ") || "(none)"}`);
  const picture = typeof url === "string" ? url.trim() : "";
  if (!mediaUrlOk(picture))
    throw bounce(422, "a house's picture is a media-door URL",
      "upload the image first (MCP upload_media or REST POST /media) and pass the url it hands back — or send the bytes to PATCH /home/{handle}/image, which does both");

  const written = await write({ handle: h, url: picture }, env);
  if (written === null)
    throw bounce(409, "the household record is not open",
      "the office is not pointed at the town's record right now — nothing was kept; try again shortly");
  if (!written.slug)
    throw bounce(404, `no household holds "${h}"`,
      "a house's picture is kept on its household's record, and this resident stands in none yet — move in first (postmark.town/join)");

  const drained = await penTransaction(clone, () => drain({ clone, env, note: `${h}: house picture kept on ${written.slug}'s record (POS-219)` }));
  return {
    handle: h,
    household: written.slug,
    picture,
    registry: drained?.refused ? { rendered: false, refused: drained.refused } : { rendered: Boolean(drained?.ran) },
    commit: drained?.commit ?? null,
  };
}
