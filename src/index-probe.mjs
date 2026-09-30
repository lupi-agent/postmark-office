// index-probe.mjs — THE WRITE PATH'S QUESTIONS OF THE INDEX (POS-268, group 4).
//
// The doors that write ask the town index four small things, synchronously and
// deep inside checks that were written sync: is this handle a resident (the
// recipient check, the join and declare desks, the key desk, the berth desk,
// the harbor stamp), is this a letter id (a thread, a duplicate), which handles
// a GitHub login is bound to (the sign-in's household), and a resident's
// mail_state row (the threadless reply hint). Each was a line of SQL on
// office.db, and each out-of-process pen (declare-exec, join-bind-exec, the
// earpiece's deliverer, the drain) opened office.db to ask it.
//
// A PROBE answers the same four questions. There are two:
//   · officeProbe(db): the same SQL over office.db, unchanged;
//   · the store's (town-index-store.mjs § probeOver): a snapshot of the store's
//     resident handles, letter ids and GitHub lines, read once per store head
//     and held here by the process that loaded it.
//
// Every check still takes its `db` argument and asks `probeOf(db)`. Unswitched,
// that is officeProbe(db), so an office.db handle (and every test passing one)
// reads exactly as before. With TOWN_INDEX_READS=store it is the store's held
// probe, whatever `db` was: never office.db, never a fallback to it. A process
// that has not loaded the store's snapshot yet holds the REFUSING probe, whose
// every question throws the store's 503 in the bounce vocabulary each check
// already throws. No imports: the checks that use this sit under the store.

export const indexSwitched = (env = process.env) => env.TOWN_INDEX_READS === "store";

// The store's words when it cannot answer. town-index-store.mjs § UNREACHABLE is
// built from these; they live here because that module imports the checks that
// import this one.
export const UNREACHABLE_DEFECT = "the office's town index (the store) cannot be reached — nothing was read";
export const UNREACHABLE_HINT = "this door reads the store (TOWN_INDEX_READS=store); ask again shortly, and it answers when the store does";
const unreachable = () => { const e = new Error(UNREACHABLE_DEFECT); Object.assign(e, { code: 503, field: null, defect: UNREACHABLE_DEFECT, hint: UNREACHABLE_HINT }); return e; };

/** Is this the refusing probe's 503? A door that answers its own 500 answers this one as itself. */
export const isUnreachable = (e) => e?.code === 503 && e?.defect === UNREACHABLE_DEFECT;

/** The probe of a process whose store snapshot is not loaded: every question is the 503. */
export const REFUSING = Object.freeze({
  hasResident: () => { throw unreachable(); },
  hasLetter: () => { throw unreachable(); },
  loginStamp: () => { throw unreachable(); },
  loginRows: () => { throw unreachable(); },
  mailStateJson: () => { throw unreachable(); },
});

let held = null; // the store's probe this process last loaded (town-index-store.mjs sets it)
export const holdStoreProbe = (p) => { held = p; };
export const heldStoreProbe = () => held ?? REFUSING;

const officeProbes = new WeakMap(); // db -> its probe, so the login memo keys on one object

/** The four questions over office.db, as each check asked them. SQL errors throw to the check, as before. */
export function officeProbe(db) {
  let p = officeProbes.get(db);
  if (p) return p;
  p = Object.freeze({
    hasResident: (h) => Boolean(db.prepare("SELECT 1 FROM residents WHERE handle = ?").get(h)),
    hasLetter: (id) => Boolean(db.prepare("SELECT 1 FROM letters WHERE id = ?").get(id)),
    // a cheap stamp of the residents table, no JSON parsed
    loginStamp: () => {
      const st = db.prepare("SELECT count(*) AS n, total(length(json)) AS l, max(rowid) AS r FROM residents").get();
      return `${st.n}:${st.l}:${st.r}`;
    },
    // every row's GitHub line in rowid order: `github`, else the card's, else ""
    loginRows: () => db.prepare("SELECT handle, json FROM residents").all().map((r) => {
      const d = JSON.parse(r.json);
      return { handle: r.handle, github: d.github ?? d.address?.data?.github ?? "" };
    }),
    mailStateJson: (h) => db.prepare("SELECT json FROM mail_state WHERE handle = ?").get(h)?.json ?? null,
  });
  officeProbes.set(db, p);
  return p;
}

/**
 * The probe a check asks. A probe handed in is itself (a door that loaded one
 * row for the call); switched, the store's held probe; else null stays null
 * and a db is officeProbe(db).
 */
export function probeOf(x, { env = process.env } = {}) {
  if (x != null && typeof x.hasResident === "function") return x;
  if (indexSwitched(env)) return heldStoreProbe();
  return x == null ? null : officeProbe(x);
}
