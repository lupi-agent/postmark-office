// crossing-receipts.mjs — the crossing's receipt, in the store (POS-352, 061).
//
// The crossing (deploy/settlement-auto.sh) writes its receipt to
// /srv/postmark-harbor/settlement-auto.json and, since POS-352, records the
// same bytes as a `crossing_receipts` row (world2/tools/crossing-receipt.mjs).
// The store is the record: the office serves the receipts from it, so a reader
// that is not on the box (the site's harbor page, a runbook, a Meep's round)
// asks the office rather than a file nginx happens to serve.
//
//   GET /crossings/receipts            the newest receipt, whole
//   GET /crossings/receipts?limit=N    the newest N rows' lifted fields (≤ 60),
//                                      newest first, without the receipt bodies
//
// Reads only. `null` from `actsQuery` (not pointed at the record) is answered
// as "not-yet-open", never as "no crossings".

import { createHash } from "node:crypto";
import { actsQuery } from "./world2-acts.mjs";

export const RECEIPT_LIMIT_MAX = 60;

export const receiptDigest = (text) => createHash("sha256").update(String(text)).digest("hex");

/** The lifted fields a row carries beside the receipt text. */
export function receiptRow(text) {
  const receipt = JSON.parse(text);
  return {
    at: receipt?.at ?? null,
    status: receipt?.status ?? null,
    class: receipt?.class ?? null,
    by_hand: receipt?.by_hand === true,
    world_from: receipt?.world_from || null,
    world_to: receipt?.world_to || null,
    receipt: text,
    digest: receiptDigest(text),
  };
}

/** Record one receipt (idempotent on its digest). Answers `{ recorded, id }`, or null when not pointed at the record. */
export async function recordReceipt(text, env = process.env) {
  const r = receiptRow(text);
  const rows = await actsQuery(
    `INSERT INTO crossing_receipts (at, status, class, by_hand, world_from, world_to, receipt, digest)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (digest) DO NOTHING
     RETURNING id`,
    [r.at, r.status, r.class, r.by_hand, r.world_from, r.world_to, r.receipt, r.digest], env);
  if (rows === null) return null;
  return { recorded: rows.length === 1, id: rows[0]?.id ? Number(rows[0].id) : null, digest: r.digest };
}

/** The door's answer. Throws `{ code, defect, hint }` for a refusal. */
export async function receiptsRead(params, env = process.env) {
  const raw = params?.get?.("limit") ?? null;
  if (raw === null) {
    const rows = await actsQuery(
      "SELECT id, receipt, recorded_at FROM crossing_receipts ORDER BY id DESC LIMIT 1", [], env);
    if (rows === null) throw Object.assign(new Error("not-yet-open"), { code: 409, defect: "not-yet-open", hint: "this office is not pointed at the record, which keeps the crossings' receipts" });
    if (!rows.length) return { receipt: null, note: "no crossing has recorded a receipt in the store yet" };
    return { id: Number(rows[0].id), recorded_at: rows[0].recorded_at, receipt: JSON.parse(rows[0].receipt) };
  }
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > RECEIPT_LIMIT_MAX)
    throw Object.assign(new Error("limit"), { code: 422, defect: `limit must be a whole number from 1 to ${RECEIPT_LIMIT_MAX}`, hint: "GET /crossings/receipts?limit=10" });
  const rows = await actsQuery(
    `SELECT id, at, status, class, by_hand, world_from, world_to, recorded_at
       FROM crossing_receipts ORDER BY id DESC LIMIT $1`, [n], env);
  if (rows === null) throw Object.assign(new Error("not-yet-open"), { code: 409, defect: "not-yet-open", hint: "this office is not pointed at the record, which keeps the crossings' receipts" });
  return { receipts: rows.map((r) => ({ ...r, id: Number(r.id) })) };
}
