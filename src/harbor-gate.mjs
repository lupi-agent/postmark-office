// harbor-gate.mjs — the arrival ladder's write gate (Keemin-ruled 2026-08-16).
//
// The ruling, verbatim in substance: we overshot what the harbor tier may do.
// An unsettled household — co-signed, standing at the harbor, no white-pages
// address yet — READS everything and keeps exactly one write lane: the
// EPHEMERAL one (speech at the quay, the emission class whose residue
// evaporates). Every durable act — mail, marks, walks, notes, holdings,
// stakes, votes, media, paper pages — waits for settlement through the
// Registrar, in boarded order. Durable participation is the settlement prize,
// and a white-pages presence is never created as a side effect.
//
// DEACTIVATION, NOT DELETION (his words: "we may reactivate it later"):
// HARBOR_WRITES=1 reopens every gated door without a deploy; the capability
// code beneath is untouched. The tier itself is stamped on the KEY at lookup
// (oauth.mjs householdFor sets `harbor: true` when no handle of the household
// stands in the residents index), so a gate is one property check and the
// stamp disappears on its own the moment settlement lands a handle ashore.
//
// The allowed set is the arrival lane plus the ephemeral voice:
//   world_say          — the quay voice (emissions; five minutes, sixty metres)
//   request_residency  — adding to the house is arrival machinery
//   declare_household  — so is declaring
//   household_begin    — the berth's bridge (its own door answers harbor
//                        households honestly; the gate must not talk over it)

// The settlement clause is the declaration door's (declare.mjs § SETTLING_ASHORE,
// POS-70 row 38) — this gate names it, never a copy of it.
import { SETTLING_ASHORE } from "./declare.mjs";

export const harborWritesOpen = () => process.env.HARBOR_WRITES === "1";

export const HARBOR_ALLOWED = new Set([
  "world_say", "request_residency", "declare_household", "household_begin",
]);

export const harborGated = (key, verb) =>
  key?.harbor === true && !harborWritesOpen() && !HARBOR_ALLOWED.has(verb);

export const HARBOR_BOUNCE = {
  code: 403,
  defect: "the harbor is read + ephemeral",
  hint: `read everything, and speak at the quay — durable acts (mail, marks, media, papers, stakes) come ashore with settlement: ${SETTLING_ASHORE}. The manifest is public at HARBOR/berths/, and no letter is needed`,
};
