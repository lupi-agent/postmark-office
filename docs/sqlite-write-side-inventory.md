# The write side's SQLite, inventoried (POS-269 / POS-271)

Every open, write and read of `dynamic.db`, `roles.db` and `oauth.db` in this
tree (base `60098fe`, train/2026-w41), each with its writer, its readers, and
whether the record (Postgres `acts` and its projections) already carries the
fact. The read side (`office.db`, `world.db`) is POS-268/270's and is not
listed here.

Flags as prod runs them, from the day docs (2026-09-08 catch-up, the
2026-09-05 flip report): `W2_PEN=stance,hold,say,walk,frame,mark`,
`W2_GUARDS=1`, `WORLD2_PG=1`, `WORLD_SINGLE_LOG=1`, `WORLD_APEX=1`.
`TOWN_SINGLE_LOG` is unset on the box (`deploy/postmark-ferry.service`).
`WORLD_EMISSIONS`, `WORLD_PRESENCE`, `WORLD_MOVEMENT_V2` and
`OFFICE_ROLE_GATES` are not recorded as set anywhere this lane could read; the
box's `/etc/postmark-office.env` was not read (no box).

## What contradicts the brief

1. **Voices are not in `dynamic.db`.** The say's record is `acts` (say lane
   flipped 2026-09-03) and its 1.0 log is `voices-log.jsonl`. What the say path
   does to `dynamic.db` is two things: `penVoiceAct` opens it **in write mode**
   for every say and never uses the handle, and `emissionFromVoice` writes an
   emission row behind `WORLD_EMISSIONS`. The write-mode open runs
   `PRAGMA journal_mode = WAL`, the whole DDL and a `meta` read on every call,
   and it sits before the pen. A `database is locked` there throws past the
   `PenUnreachableError` catch, so the say is refused with a 500. That fits the
   Snug night's refused voice better than "a reverse mirror failed", because
   there has been no reverse mirror since G1 (POS-156).
2. **The journal and movements writes are already gone.** G1 deleted the
   general journal INSERT and the reverse mirror; `appendJournal` and
   `appendActFlipped` take `db` and never touch it. Six doors still open the
   store in write mode to hand that unused handle over.
3. **The arena stays on `dynamic.db` by founder ruling.** P-143 (2026-08-29:
   "we can just keep the arena on sqlite for now") keeps `appendArenaRow` and
   the arena's fold on the sqlite journal. The beat's `seq` is its identity
   inside the fold. `src/world2-acts.mjs § EXEMPT_LANES` says lifting it is "a
   founder ruling PLUS the arena read ports, together". "dynamic.db goes"
   cannot be finished without that ruling.
4. **`oauth.db` holds more than sign-in sessions.** Besides the OAuth tables
   it holds the media ledger (`media`, the household storage quota) and the
   town log (`town_journal` + `meta`, behind `TOWN_SINGLE_LOG`). The hold's
   attachment edge is a **live sqlite write** too (`declareHolding`), not a
   mirror that has already died.

## dynamic.db

Opener: `src/dynamic-store.mjs § openDynamic / openDynamicReadOnly`. The path
is `WORLD_DYNAMIC_DB`, or `dynamic.db` beside the office.

### Tables

| table | writer today | readers today | in the record? |
|---|---|---|---|
| `journal` | `appendArenaRow` only (arena, P-143) | `arena.mjs` fold (`readJournal cls: arena-act`); `world-drain.mjs § drain` (settlement-auto, prod); `world-journal.mjs § draftsForKey` (mark rows, none since G1); `dynamicHealth` | arena beats reach `acts` through `mirrorAct` (fire-and-forget); every other class is written to `acts` only |
| `attachments` | `world-hold.mjs § declareHolding` (every give/drop/take, inside `BEGIN IMMEDIATE` held across the Postgres pen); `tools/dynamic-rebuild`, `tools/arena-play` | `guardedAttachments` fallback (only when `W2_GUARDS` is off); `arena.mjs § weaponInHand` and the arena fold; `world-apex.mjs § portalBlockAt` (floor); `tools/crossing-save`, `crossing-replay-check` | **yes**: holding acts (`world2-guards § storeAttachmentRows / pgAttachmentsFor`), which prod's holder check already reads |
| `movements` | none since G1 (`declareMovement` removed) | `tools/ledger-freeze.mjs`; `dynamicHealth` | yes: walk acts |
| `entities` | `refreshEntities` from `tools/crossing-save` and `tools/dynamic-rebuild` only | `dynamic-presence.mjs § readPresence` (behind `WORLD_PRESENCE`); `tools/crossing-replay-check` | yes: walk acts, and the positions projection (POS-264, `WORLD_POSITIONS`) |
| `emissions` | `emissionFromVoice` on every say, behind `WORLD_EMISSIONS` | tools only: `crossing-save`, `state-to-r2`, `thread-parity`, `falsifier-live-equality`; `dynamicHealth` | yes: say acts (class voice) carry the words, the place and the instant |
| `meta` | `openDynamic` (schema stamp); the drain's cursor; crossing-save's `logged_through`; `refreshEntities`' stamps | the same tools; `dynamicHealth` | tool bookkeeping, not town facts |

### Runtime opens (src/)

| site | mode | uses the handle for | verdict |
|---|---|---|---|
| `world.mjs § penVoiceAct` (every say, before the pen) | write | nothing | **delete the open**, which is the say's lock |
| `walk-exec.mjs` (every walk) | write | nothing | delete the open |
| `crossing-exec.mjs` (every enter/exit) | write | nothing | delete the open |
| `world-apex.mjs § crossing record` (every ride) | write | nothing | delete the open |
| `world-stance.mjs` ×2 (set-down stance, stance) | write | nothing | delete the open |
| `world.mjs § journalLeaveMark / journalWithdraw` | write | `guardedLiveMarks(db)` / `guardedLiveChildrenOf(db)`, both of which ignore it | delete the open |
| `world-hold.mjs` hold door (give/drop/take) | write | `declareHolding`'s attachment INSERT; the transaction around the pen | **the live write**: the acts row is the record, so the sqlite edge goes |
| `world-hold.mjs` `world_holdings` | read | nothing when `W2_GUARDS=1` | reads the record |
| `world-hold.mjs § loot shroud guard` | read | `lootHiddenReason` (arena fold) | arena (P-143) |
| `world-journal.mjs § draftsForKey` | read | replays mark rows, of which there are none since G1 | answered by `guardedDraftsForKey` under `W2_GUARDS=1`; the flag-off arm reads an empty table |
| `dynamic-presence.mjs § readPresence` | read | `entities` (behind `WORLD_PRESENCE`) | needs a port onto the positions projection |
| `arena.mjs` ×2, `world-apex.mjs` enter/leave wheel and `portalBlockAt` | read and write | the arena journal and fold | arena (P-143) |
| `world-drain.mjs § drain` (settlement-auto on prod) | write | drains the journal, which only arena beats still reach | follows the arena ruling |
| `dynamic-store.mjs § dynamicHealth` (`GET /world/dynamic`) | read | counts | goes with the file |
| `server.mjs` boot | none | a read worker exits 78 when the file is absent | must go before "starts with the file absent" can hold for a worker |

### Tools

`crossing-save` (unit delivered, not installed), `crossing-replay-check`,
`dynamic-rebuild`, `thread-parity`, `state-to-r2`, `ledger-freeze`,
`arena-play`, `world2/tools/falsifier-{apex,guard,live}-equality`,
`falsifier-acts-lane-closure`, `falsifier-pen-flip`, `backfill-departures`.
These are the instruments of the store they measure, so they retire with it.
None runs on a timer on prod except the drain inside settlement-auto.

## roles.db

Opener: `src/roles.mjs § openRolesDb`, opened in `server.mjs` with
`--roles-db`, default `roles.db`.

| table | writer | readers | in the record? |
|---|---|---|---|
| `roles` (subject = gh_id, role, login, granted_at/by, note) | `tools/roles.mjs` (operator CLI) only | `roleGate` / `hasRole` / `roleCheck` in server's gated doors, only when `OFFICE_ROLE_GATES=1`; `listRoles`, `staleRows` (CLI) | no |
| `role_audit` (append-only) | `grantRole`, `revokeRole`, `refreshLogin` | `auditTrail` (CLI) | no |

`tools/roles.mjs` also opens `oauth.db` read-only to turn a login into a gh_id
(`SELECT DISTINCT gh_id FROM tokens`). `test/roles-db-rides-the-backup.test.mjs`
pins the file into the backup.

## oauth.db

Opener: `src/oauth.mjs § openOauthDb`, opened once at boot in `server.mjs`
(`--oauth-db`); a read worker opens it read-only and exits 78 when it is absent.

| table | writer | readers | in the record? |
|---|---|---|---|
| `clients` (dynamic client registration) | `/oauth/register` | `/oauth/authorize`, `/oauth/token` | no |
| `pending` (authorize, TTL 10 min) | `/oauth/authorize` | the GitHub callback | no |
| `codes` (TTL 120 s) | the consent | `/oauth/token` | no |
| `tokens` (access 30 d, refresh 60 d, household keys; `held_by`, `claimed_handle`, `cosigned_*`) | `/oauth/token`, `mintHouseholdKey`, rotation, the claim desk | `oauthLookup`, `keyLookup` on **every signed-in request** (writer and read workers); `tools/roles.mjs` | no |
| `berths` (guest berth keys and cards) | `mintBerth`, cosign, `household-apex.mjs` (card) | `berthLookup` on every berth request; `household-apex.mjs` | no |
| `key_claims` (claim desk asks) | `mintClaim`, `cosignClaim`, `sweepClaims` | `claimByAsk`, `claimState`, `claimLookup` | no |
| `media` (household media quota ledger) | `media.mjs` upload | quota and listing in `media.mjs`, `household-media.mjs`; `tools/media-thumbnails-backfill` | no |
| `town_journal` + `meta` (the town log) | `town-journal.mjs § appendTownJournal`, behind `TOWN_SINGLE_LOG` (off on the box) | `town-updates`, `town-mail`, `town-bridge`, `town-drain` (ferry), `earpiece-mail`, `doorstep-bundle`, `residency`, `send-at-door`, `paper-fresh` | no |

Every call into these tables is synchronous (`node:sqlite`). Moving them to
Postgres turns each lookup async, and `oauthLookup` / `keyLookup` /
`berthLookup` / `claimLookup` sit under the auth resolution of every door. So
the switch changes signatures at every caller, and that is the part the brief
says to STOP before.
