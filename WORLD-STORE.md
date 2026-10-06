# The world store

`world.db` — the office's read index of the **world** repo, as `office.db` is its
read index of the **town** repo. Stage 1 of the world-graph plan
(`G:/Starstory/docs/2026-08-09/world-graph-apex-proposal.html`, §5.2): the store,
shadow-proven, and now behind two flags a live office read can be served from —
**both off by default**, and off is byte-identical to having no store at all.
See **§ Serving** below for what may be served, what may not, and the one finding
the live shadow turned up on its first run.

## Run it

```
npm run hydrate:world -- --ref refs/heads/main   # build world.db from published main
npm run hydrate:world -- --ref <sha>             # ...or at any commit
npm run world:lints                   # the eight standing invariants, from the built store
npm run world:shadow                  # parity vs the world's own engine — the serving gate
npm run world:store                   # the serving flag's instrument panel (= GET /world/store)
npm run world:gexf                    # regenerate the ad-hoc window by hand
node --test test/world-store.test.mjs # the tense law and the FAILED-index guard
node --test test/world-serve.test.mjs # the flags, the guard, the shadow
```

**Hydrate at `refs/heads/main`, not at HEAD.** The default is `HEAD`, and the
world clone is routinely parked on a household's draft branch by the write pen —
a store stamped with a draft sha can never become eligible to serve, because
eligibility is an exact match against the sha published main points at.

Hydration takes about eight seconds and regenerates the lints and both GEXF files
at the end, so nothing downstream can drift behind the store.

Flags: `--world <path>` (default: `WORLD_CLONE`, resolved exactly as
`src/world.mjs` resolves it), `--ref <ref|sha>`, `--office <path>`, `--db <path>`,
`--no-lints`, `--no-gexf`, `--json`.

## The files

| file | what |
|---|---|
| `src/world-store.mjs` | the DDL, the sha-pinned materialiser, the Graphology runtime, the as-of read |
| `src/world-hydrate.mjs` | the hydrator: gates, marks, edges, geometry versions, events, code graph |
| `src/world-lints.mjs` | the eight standing invariants, each citing the mark it enforces; also a CLI over a built store |
| `src/world-serve.mjs` | **the serving layer**: the two flags, the eligibility guard, the shadow, the counters |
| `tools/world-gexf.mjs` | GEXF export (full + static), regenerated every hydration |
| `tools/world-shadow.mjs` | shadow parity vs the world's own engine at the same sha |
| `test/world-store.test.mjs` | the tense law, locked |
| `test/world-serve.test.mjs` | flag-off equivalence, the injected-discrepancy catch, the ruling-9 guard |

`world.db`, `world-graph.gexf` and `world-graph-static.gexf` are all gitignored
build products. Deleting any of them loses nothing.

## The covenant

**The DB is an INDEX, never the truth.** Every row in `world.db` is recomputable
from the two checkouts at the two shas stamped in `meta` (`as_of_world`,
`as_of_office`). The file is deleted and rebuilt whole on every hydration; it has
no state of its own to keep. Delete it at any time and lose nothing the town owns.

**Rebuildable at any commit.** The hydrator never reads the working tree. It
materialises `WORLD/` and `tools/` *at the sha* into a sha-keyed cache and reads
from there — the same discipline `src/world-branches.mjs` uses for engine code
("what is checked out cannot change what the office executes"), for the same
reason: the world clone is fetch-never-pull and the write pen routinely parks it
on a household's draft branch. `--ref <sha>` therefore rebuilds the world as it
stood at that commit, and that is not a debugging convenience — it is what makes
`geometry_versions` checkable.

**A separate file from `office.db`, on purpose.** `office.db` indexes the town
repo, `world.db` indexes the world repo, and the two advance on different clocks
(dial 8: hydrate on every main-advance; the *public* clock stays the crossing).
One file could not stamp a truthful As-Of for both at once. `oauth.db` remains
what it has always been: paperwork, not town truth.

**The three state classes** (§2.8), and where Stage 1 sits in them:

| class | canon | loss story | in the store today |
|---|---|---|---|
| repo-canon — marks, classes, law, mail | git | none: the store rebuilds from it at any commit | **all of it.** `nodes`, `edges`, `events`, `geometry_versions` |
| store-canon-durable — entity positions, attachments | the dynamic db | bounded by the crossing-save: recover from the last `STATE/` crystallization | Stage 2, in `dynamic.db` — see `DYNAMIC-STORE.md` |
| store-ephemeral — emission presence | the dynamic db, TTL | loss *is* fading; occurrence survives in the crossing log | Stage 2, in `dynamic.db` — see `DYNAMIC-STORE.md` |

So `world.db` remains entirely class one: a pure index of repo truth, with no
durable state of its own and nothing to lose. Stage 2 put the other two classes
in a **separate file** rather than here, for the same reason `world.db` is
separate from `office.db` and a sharper one: this file is deleted and rebuilt
whole on every hydration, and the dynamic layer is precisely the state that must
survive that. An earlier reading of the plan had entities and emissions landing
as `nodes` rows here; the schema comment still describes that shape and it is
kept as a record of the shape considered, not of the shape built.

One Stage-2 change does land in this store: the hydrator now carries a mark's
**class fields** — `class`, `version`, `dials`, `extends`, `implements`,
`affordances`, `mobility`, `anchor`, `exempt` — into node props. It used to drop
exactly the fields that make a class mark law, so `the-town/sound`'s `dials:`
reached no reader and the running office kept its own copy of every constant.
They are additive props; the serving projection does not read them and the
shadow is unchanged (EMPTY DIFF at `2fcaff0`).

### `in_works` — position, after the freeze (2026-08-25)

> "Filing is frozen as of 2026-08-25. A mark's directory is its historical
> filing: it carries no claim, and it never moves again. New marks are filed by
> identity — `WORLD/marks/<household>/<slug>/` — and containment lives only in
> the derived fold, emitted as an artifact each settlement."
> — LOGOS/state-and-time.md § *The freeze — filing is static, and the tree is a fossil*

Whether a mark may MINT A VERB has one position clause: it must stand in the
Keeping Works. That used to be the substring `/the-keeping-works/` in the mark's
stored path — sound only while a directory made a claim. Under the freeze it
fails QUIETLY: a class mark filed at its id stands in the works by containment,
misses the substring, and declares nothing, with no refusal and no log line.

So the hydrator stamps **`props.in_works`** on every mark, from the containment
CHAIN in `WORLD/containment.json`, and `worksClause()` in `src/world-store.mjs`
reads that stamp. The path arm survives as the fallback for a store hydrated
before the stamp existed; an explicit `false` refuses. One implementation, taken
by an alias, so the joined query in `src/world-classes.mjs` shares it instead of
copying it. `props.declares` and the `instance-of` rails re-key with it.

Measured over the freeze-day tree before the change was written: chain-membership
and the path substring select the **same 330 marks**, zero either way. The re-key
changes nothing about the world as filed — only what happens to what is filed
next. `report.counts.containment_source` names which question a hydration
actually asked.

## The deriver's gate law

Every deriver refuses or discloses its absent inputs; no silent empty tables,
ever.

**Refuses** (named, nonzero, and the existing `world.db` is left untouched —
a hydrator that deletes a good index and then discovers it cannot build a new
one has turned a refusal into an outage):

- `world-clone` — no `WORLD/marks` under the given path
- `world-git` — the path is not a git checkout of its own, or the ref will not resolve
- `world-history` — `git log` over `WORLD/marks` fails, returns fewer than two commits, or the clone is shallow. A shallow clone would otherwise produce exactly one version per mark: geometry with no tense, silently.
- `world-tools` — the world's own `marks-fold.mjs` / `geometry.mjs` will not import at that sha
- `marks-readable` — the world's own loader returns zero marks

**Discloses** (recorded in `meta.gates` with the tables it leaves empty, printed
as `GATE ABSENT`): `office-git`, `physics-registry`, `engine-doctrine`,
`walk-ledger`, `code-root-office`, `code-root-world`.

**And then checks itself.** After the build, every table a PRESENT gate promised
is counted. An empty one stamps `meta.hydration_status = FAILED: …`, exits
nonzero, and `loadWorldGraph` refuses to open the file — so a half-built index
cannot be read by accident and mistaken for an empty world.

## `geometry_versions` — the tense law

A mark's geometry is not a fact, it is a fact **with a validity window**. Without
that, every lint over historical events re-decides history each time a mark
moves. The spike watched it happen: Keemin's ruling moved the Pando landing
1216 m, and a departure that had been a 22 m near-miss became a 1238 m gross
error it never was — nothing about the departure changed, only the yardstick.

The table is derived mechanically from git history: one row per (mark, geometry)
the record has ever held, `valid_from_iso` being the **committer** instant of the
commit that wrote it (the settled clock, the same one `office.db`'s `repo_log`
uses), `valid_to_iso` the next version's, `NULL` for the version standing at
`as_of`. The author instant is kept alongside in `authored_iso` — both clocks
named, per the two-clocks law. Nothing here is hand-authored.

Implementation note: `git log --follow` is a per-path walk, and 578 of them is
578 process spawns. The hydrator does the same job in one whole-history pass over
`WORLD/marks` with rename detection and an alias map walked newest-to-oldest, and
one `cat-file --batch` for every blob. Verified against the literal method — see
the receipts below.

`geometryAsOf()` distinguishes **`not-yet`** (the instant precedes the mark's
first version) from **`unknown-mark`** (nothing versions this id). A caller that
conflated them would answer "departed from nowhere near a stop" about a stop that
had simply not been recorded yet.

## Current receipts — world `f233ceb`, office `ce70458`, 2026-08-09

Hydration green on the real clone (`G:/Postmark/repo-clones/wright/postmark-world`) at main, 7.8s.

- **686 nodes** — 582 marks (256 sited · 267 predicated · 53 parcel · 6 naming), 84 code, 12 class, 8 doctrine
- **805 edges** — 308 contains · 274 describes · 99 imports · 60 reads · 53 instance-of · 9 implements · 2 stop-of
- **304 events** (departures), 0 ledger lines unparseable
- **381 geometry versions over 318 marks** — 318 births, 49 moved, 10 resized, 4 moved+resized. Nine of the 318 are marks that carried geometry once and are predicates today; every currently-geometric mark has an open version, and every open version equals the tree at `as_of` (the deriver's own self-check: `geometry_history_problems: 0`).
- **12 gates present, 0 absent**
- **anomalies**: 0 geometry disagreements · 0 placement disagreements · 0 dangling stops · 0 dangling mechanics · 0 frontmatter problems · 2 imports leaving the scanned set · 18 quoted `WORLD/` paths that do not exist (test fixtures) · 75 marks whose id differed earlier in history (almost all one migration: `by:` moved from the path into the frontmatter)

### Shadow parity — EMPTY DIFF

309 geometric marks, 308 spines checked, 1 `far` exempt by construction.

| axis | store side | engine side | diffs |
|---|---|---|---|
| containment spine | walk up the `contains` edges written from directory nesting | the world's own `placementParent` at the same sha | **0** |
| fan-up weight | marks hanging under each, from the store's parent links | same, from the engine's | **0** |
| geometry verdict | each `contains` edge's stored `geometry_ok` | recomputed with the world's own `contains()` | **0** (307 checked) |

> **⚠ Two of these three axes went VACUOUS on 2026-08-25, and the table above is
> the last run where they were not.** The freeze re-keyed `contains` off
> directory nesting and onto `WORLD/containment.json` — whose sited/parcel rows
> ARE `placementParent` — so the store side and the engine side of *containment
> spine* and *fan-up weight* are now the same derivation compared with itself. An
> empty diff there no longer means the tree and the ground agree; it means
> arithmetic is deterministic. The **geometry verdict** row still measures
> something real: it checks the map the settlement EMITTED against the office's
> own recompute of the same geometry, which is a machinery check on the fold.
>
> Rebuilding the first two axes into an honest comparison is unbuilt and
> deliberately not attempted here — flagged rather than quietly left reading like
> a receipt. (`tools/world-shadow.mjs` did get one real fix in the same pass: its
> root was "the mark with no mark.md above it", which after the freeze is true of
> every mark filed at its id.)

The engine is imported the way `src/world.mjs` imports it — from a subtree
materialised at a ref, never the working tree. The one deliberate difference:
`world.mjs` pins to freshest-main because it is serving now; this pins to
`meta.as_of_world` because it is auditing then. Same sha on both sides or the
diff measures two worlds.

### The eight standing invariants

Each one is a constitutional mark, not this office's own opinion: the
`postmark-invariant` family under
`WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/`, one class
per invariant, carrying `dials: {"lint": "Lx"}` and a single claim, with a
mechanic child naming `src/world-lints.mjs`. Every finding leaves the office
carrying `law` (the mark id) and `law_text` (that mark's claim, verbatim), and
L0 reads the marks back off the world tree so a citation that has drifted from
the law goes red instead of quietly lying. The pairing:

| lint | mark | the claim it enforces |
|---|---|---|
| L0 | `the-town/the-readable-inputs` | A reading that cannot read its own inputs says so, loud |
| L1 | `the-town/the-reaching-mechanic` | Every mechanic names running code and the name resolves |
| L2 | `the-town/the-unmoved-past` | A departure is judged against the stop geometry of its own instant |
| L3 | `the-town/the-owned-constants` | Every constant in the machinery is owned by a dial or a law |
| L4 | `the-town/the-conforming-instance` | Every instance conforms to its class |
| L5 | `the-town/the-consulted-doctrine` | Every doctrine rule reaches an enforcing surface |
| L6 | `the-town/the-live-handler` | Every exposed action has a live handler |
| L7 | `the-town/the-classed-mark` | Every mark is an instance of a class |

The verdicts below are a SNAPSHOT of one run, kept for the L2 receipt that
follows it; it predates L0 and L7 and says nothing about today. Run
`npm run world:lints` for the live reading.

| lint | verdict | headline |
|---|---|---|
| L1 mechanics reach running code | RED | `timetable` declares `tools/vessel.mjs` and the running office never loads it; 6 of 7 mark-carried mechanics declare no implementing module at all |
| L2 stops vs observed departures | RED | 2 of 3 departures left from outside every stop's footprint *as it stood at that instant*; 2 read differently against today's geometry |
| L3 no orphan constants | RED | 34 files carry a watched class constant as a bare literal with no link to its owner (20 on a line naming the constant's own domain) |
| L4 instances conform to their class | RED | 5 of 53 parcels are not 25×25; every one carries `pre: true` — seeded prior estate the class law grandfathers, so the door has never written an off-dial parcel |
| L5 doctrine reaches enforcement | RED | 0 of 8 ENGINE.md sections reach an enforcing surface |
| L6 subverbs have live handlers | N/A | no apex `world` verb exists yet — checked, not assumed |

Verdicts land in `lint_findings` (one row per lint per hydration). Because the
store is rebuilt from scratch that table holds exactly this run; the delta is
read off the outgoing file before it is deleted and written to `meta.lint_delta`,
explicitly labelled as an observation about *this machine's* previous hydration.
Two commits are compared by rebuilding at both.

### The L2 tense receipt — and one finding

Same lint, same three ledger departures, two different questions:

| departure | judged at its own instant | judged against today's geometry |
|---|---|---|
| 2026-08-08T18:00Z from `-30,40` | inside stop 0 — on schedule | on schedule |
| 2026-08-08T22:24Z from `-95445.5,-95445.5` | **22 m** outside the landing | **1238 m** outside |
| 2026-08-09T12:00Z from `-94570,-94570` | **1216 m** outside the landing | on schedule |

The 22:24Z departure is the healing the versioned table was built for: it reads
as the near-miss it was, not as the 1238 m absurdity the re-siting made of it.

**The finding is the row below it.** The plan expected the 12:00Z cast-off to
come back on-schedule under as-of judgement. It does not, and cannot: the ruling
that moved the landing was committed at **2026-08-09T21:32:24Z**, nine and a half
hours *after* that departure. At 12:00Z the record still placed the landing
1216 m away, so an as-of read says 1216 m — which is the true history, and is
precisely the drift that prompted the ruling. The vessel had been leaving from
Porch Hill since 08-08 while the wheelhouse still named the old landing.

The gap is real and it is not in the derivation: **the record has no way to say
"effective from"**. `geometry_versions` carries the settled clock because that is
the only clock git can give it; a ruling meant to legalise something
retroactively still shows the past as it was recorded at the time. Giving marks
an effective-from field is a doctrine question for Keemin's pen, not something a
deriver may invent — a hydrator that read "Keemin's 2026-08-08 ruling" out of a
commit message and back-dated a geometry version would be fabricating law from
prose. Rebuilding at the pre-move commit is the control: at `4eb6fc6` the landing
carries one version, as-of and current agree, and both departures read 1216 m and
22 m — the same numbers, with nothing to invert.

### Refusal receipts

```
$ node src/world-hydrate.mjs --world <a directory with no WORLD/marks>
GATE REFUSED world-clone — not a world checkout — no WORLD/marks under …
world.db NOT rebuilt; any existing index at …\world.db is untouched.        exit 1

$ node src/world-hydrate.mjs --world <a --depth 1 clone of the world>
GATE REFUSED world-history — git log over WORLD/marks returned 1 commit(s)
 — a shallow or truncated history cannot version geometry                   exit 1
```

`world.db` was byte-identical before and after all refusals.

### The window (Stage E)

Two lanes onto the same store, and the standing page is the one with the
findings on it.

**`GET /world/graph`** — the store as one Cytoscape-ready payload: every node
and edge, plus the lint findings **resolved onto the ids they are about**, so
the picture can go red in the right place. That resolution is the whole of
`src/world-graph.mjs` and it is the hop the lints themselves do not make: a lint
says "timetable declares `world/tools/vessel.mjs` and the office never loads
it"; this turns that sentence into the node and edge ids the sentence names.
Three rules govern it —

- **nothing is inferred from prose.** Every painted id comes from a structured
  field the lint wrote (`carried_by`, `parcel`, `rule`, `hits[].file`), never
  from parsing a headline;
- **an id the graph does not hold is reported, not dropped** — each finding
  carries an `unmatched` list, because a finding about something the store has
  no node for is itself a finding;
- **a lint that cannot be addressed says so** — `implicates.paints: false` with
  a note, rather than being quietly absent from the panel. L6 has three of these
  silences (no apex verb at all; every subverb dispatching; one that does not)
  and they must not be confused for each other.

Keyless like the rest of the world's read tier — the marks are published records
at a named sha, the code and doctrine nodes are paths in two public repos, and
the verdicts print from `npm run world:lints` to anyone's terminal. `?kinds=`
mirrors `tools/world-gexf.mjs`'s flag exactly, `?types=` narrows edges, and
`?drop-unresolved=1` gives the static view. **404 when there is no store**: the
window has no fold to fall through to, and an empty graph would read as a clean
world nobody had hydrated. Served compact rather than pretty-printed — 719 nodes
and 861 edges is 353 KiB, and the one-space indent was a third of it.

Positions ride **unnegated**: the world's y runs south, a canvas renderer's runs
down, and south-down is north-up. The payload states the contract
(`coordinates`) rather than leaving it to a comment on one side, because
`world-gexf.mjs` must flip the same numbers for Gephi and one of the two viewers
was otherwise always going to draw the town mirrored.

**`GET /world/graph.gexf`** (`?view=static`) — the zero-build lane, streaming
`world-graph.gexf` (719 nodes / 861 edges, 899 KiB) and `world-graph-static.gexf`
(717 / 859, 898 KiB), both regenerated at the end of every hydration and
resolved from `OFFICE_ROOT` because that is exactly where `world-hydrate.mjs`
writes them. Drop either into Gephi Lite in a browser tab. The two views differ
today only by the placeholder ends of two dangling edges: the full view keeps
them because a dangling edge is a finding, and the window is where you go to see
findings. They diverge properly at Stage 2, when entities and emissions enter
the store.

The page that reads all this is **postmark.town/ops/graph/**, in the site repo —
kind-shaped nodes, marks coloured by the tier lattice, findings red on the graph
with a panel that lights exactly what each one names, a map view at the world's
own scale, and an As-Of bar that asks `GET /world/store` whether the store is
still the sha main points at.

## Serving

Two flags, read from the environment, both off by default:

| | what it does |
|---|---|
| *(neither)* | the store is **never opened** — not opened and ignored. `servedRead` returns the fold on its first line, before a stat, a git call or a counter. |
| `WORLD_STORE_SHADOW=1` | every eligible read computes **both** answers, serves the **fold's**, and logs any disagreement. Residents see nothing change. This is the mode that runs on the box first. |
| `WORLD_STORE_READS=1` | eligible reads answer from the **store**. |
| both | the store answers, the fold verifies. The transitional rung. |

### What may be served

**Published-main reads only** — `world.db` indexes published main, and since the
world runtime ladder's **§1c** (2026-08-22) so does the fold path: every read
serves canon, and a household's drafts reach their author as a delta. The two
paths index the same world by construction.

Eligibility still calls `draftRefForKey()` and refuses a keyed caller, but that
arm is now a **belt, not a mirror**: `servedRead` still accepts a `key`, and a
household-scoped read wired into this lane in future should fall through to the
fold rather than quietly collect main from the store. The one live caller
(`place_words`) is keyless by construction, so it fires for nobody today. Retire
it when the `key` parameter leaves `servedRead`, or when a keyed read is
deliberately admitted here.

The second half is **freshness, exact**: the store may answer only when
`meta.as_of_world` is the very commit main points at. Not "recent", not "within a
crossing" — the same sha, checked per read at the cost of one `git rev-parse`
(the same spawn the fold path already makes).

And a query may still refuse for its own reasons. `cannotAnswer(reason)` falls
through to the fold, counted and named. Three exist today, all about place words:

- **`irregular-shape-in-play`** — six water marks carry `points:` rings, and the
  hydrator records a ring only as its **vertex count**. The engine tests a point
  against the ring; the store would answer by bounding box. Refused whenever the
  point lies inside any ring-carrying mark's bbox — sound and complete, because
  a ring never reaches outside its own bbox and every other containment test goes
  analytic once no irregular mark is in range. This is 49% of reads today and the
  honest fix is a hydrator that stores the ring.
- **`nearest-tie`** — when nothing contains the point, place words fall back to
  the nearest sited mark, chosen with a strict `<`, so an exact distance tie keeps
  whichever came first in the list. 58 pairs of marks in the world share a centre
  (a parcel and the house standing on it — ruling 7), so this is an ordinary
  arrangement, not a freak one. The answer is genuinely order-dependent today;
  the store declines to guess and the resident gets exactly what they get now.
- **`equal-extent-tie`** — `containmentChain` sorts containing marks by extent
  area with a stable sort, so two containing marks of equal area leave the
  innermost decided by iteration order. Not yet observed live.

### The one read served, and why only one

`placeWords` — the words a resident's position is spoken in, on every `world_say`
reply and every conversations read. It is the **only** office world read whose
entire input is the published-main mark list; `world(null)` on its first line has
said "always published main" since long before there was a store. Every other
verb here composes the fold's whole assembled world — skeleton, terrain, parcels,
portfolios — which `world.db` does not hold and Stage 1 never claimed it did.
That is the true Stage-1 boundary, and forcing more call sites through the flag
would have meant pretending otherwise.

Both paths run the **same** derivation over different mark lists: the store
supplies the facts, the world's own engine supplies the maths. A second
implementation over the store would have made the shadow measure my typing
instead of the store's contents.

Three further queries exist, tested, with **no live consumer yet**: `markRecord`
(one mark's record fields — never the fold's `stamps`/`weight`, which are
settled-stake outputs rather than repo facts), `markSpine` and `fanUp`. The last
two answer questions **the fold cannot answer at all** — a folded mark carries no
parent link for geometric kinds — so they are not live-shadowed; there is nothing
on the read path to diff them against. `npm run world:shadow` is their parity
gate, offline, against the engine's own `placementParent`.

### The As-Of a store-flagged office publishes

With either flag set, every REST response carries
`x-postmark-world-store-as-of: <as_of_world>` alongside the existing
`x-postmark-as-of` (which is and remains `office.db`'s town sha — two indexes,
two clocks, two headers). It says **which `world.db` this office has loaded** —
deliberately not "the sha this body was folded from", because in shadow mode the
body is still the fold's and a header claiming otherwise would be the one kind of
lie this layer exists to prevent. Whether that loaded store is fresh enough to
answer anything is `GET /world/store`'s question, not the header's. With the
flags off the header does not appear at all.

### The box rollout order

```
1.  deploy with BOTH FLAGS OFF                       # nothing changes; prove it in the logs
2.  hydrate at published main                        # npm run hydrate:world -- --ref refs/heads/main
3.  npm run world:shadow                             # must read EMPTY DIFF
4.  WORLD_STORE_SHADOW=1, restart, soak              # residents unaffected
5.  watch  curl -s localhost:PORT/world/store        # counters.diffs must stay 0
        or npm run world:store
6.  read   world-shadow-diff.jsonl                   # one line per DISTINCT disagreement
7.  only then WORLD_STORE_READS=1
```

Steps 4–6 are not a formality. **Do not perform step 7 until the finding below is
closed.**

### The live shadow's first finding — the fold and the records are two worlds

910 place-word reads over the real world at `ea34eaf`, store and main on the same
sha: **279 compared, 277 agreed, 2 disagreed**, 631 fell through (442
`irregular-shape-in-play`, 189 `nearest-tie`). Both disagreements are the same
mark:

```
{"read":"place_words","query":{"x":-94570,"y":-94570},
 "diff":{"fold":"\"Porch Hill, Pando Peak\"","store":"\"the Pando Landing, Pando Peak\""}}
```

The store is not wrong. At one and the same commit on main, the record
`WORLD/marks/.../the-pando-landing/mark.md` says `at: -94570,-94570` — Keemin's
ruling moving the landing to Porch Hill — while the committed derived file
`WORLD/world-state.json` still says `-95430,-95430`. **The store indexes the
records; an anonymous fold serves the committed file**, and at this sha those two
describe different worlds:

| | records (the store) | committed fold (`world-state.json`) |
|---|---|---|
| marks | 594 | 582 — missing 12 predicated constitution marks written since the last regeneration |
| the Pando landing | `-94570,-94570` | `-95430,-95430` |
| bodies | 5 rewritten, plus 3 differing only by CRLF | the pre-rewrite text |

Place words is a narrow window on this: the 12 absent marks are `predicated` and
carry no geometry, so `containmentChain` cannot see them, and the body rewrites
never reach a place word. **The divergence is much wider than two diffs.** That
is the argument against flipping serve mode today: not that the store is
untrustworthy, but that every other office read — orient, eyes, investigate,
walkers — folds `world-state.json`, and serving one read from a world a
Settlement ahead of the others would make the door disagree with itself. Being
right in one read is worth less than the door speaking with one voice.

The fix is upstream and is not this branch's: `WORLD/world-state.json` wants
regenerating in the same commit as the marks that change it (or the office wants
to fold the records rather than read the committed file). Until then the shadow
sits at 2 diffs and correctly refuses to graduate.

### What the flag buys

200 distinct place-word cells across the Pando transect, all store-answerable:

| | ms per read |
|---|---|
| flags off (fold) | 137 |
| `WORLD_STORE_READS=1` | 43 |

The fold path pays a `git rev-parse`, a `git show` of the whole
`world-state.json` and the parse after it on **every** call, because
`publishedState` reads before the assembled-world cache is consulted. The store pays
one `rev-parse` for the freshness check and then answers from memory. Both
numbers are dominated by Windows process spawns.

One behaviour the store path forced into the open: in serve mode `world()` never
runs, so the rebuild that clears the place-word cache never happens either — and
a cache **hit** returns before the harness that would notice a rehydration. A hot
cell would have repeated a retired snapshot's words forever. The store's epoch is
now the second clock that cache answers to; with the flags off it is a constant
zero and never fires.

## The store's second reader — the apex verb (Stage 3)

Everything above is about serving reads the fold could also have served. The
apex verb `world` is a different kind of reader, and the difference matters:
**it asks the store for something the fold does not have.**

`marks-fold.mjs` carries a whitelist of frontmatter fields into
`world-state.json` — `mechanic`, `top_m`, `feature`, `points`, `timetable` — and
the class layer (`class:`, `dials:`, `affordances:`, `implements:`) is not on
it. The store keeps whole frontmatter in `nodes.props`. So affordances have no
fold answer to fall through to, and the store is not an optimisation here, it is
the only reader of the fact.

Two consequences, both deliberate:

- **`WORLD_APEX=1` opens the store regardless of the serving flags.** The
  promise at the top of `world-serve.mjs` — with neither flag, the store is
  never opened — is about serving a fold-equivalent read *in place of* the fold.
  With `WORLD_APEX` unset nothing in `world-apex.mjs` runs at all, so the
  promise holds exactly where it was made.
- **Absence is disclosed, never substituted.** A missing, failed or unreadable
  store makes the read return no affordances and say why in `law.unavailable`;
  an *act* refuses outright (503), because the law that binds an act has to
  arrive with it.

### Two rules, four spellings, one meaning each

**The trust gate** — `CLASS_MARK_GATE_SQL` / `isClassMark`. A mark mints an
affordance only if it is `by: the-town`, `tier: constitution`, and carries a
`class:` field and an `affordances:` field. `by` is the clause carrying the
weight: tier is a word in somebody's frontmatter until authorship makes it a
fact, and every write door stamps `by` from the caller's own resident handles.

**Ambient reach** — `AMBIENT_REACH_SQL` / `isAmbient`. A class marked
`ambient: true` gathers everywhere rather than only where it stands:
jurisdiction travels the law, not the address. Speech is governed by the law of
speech, not by proximity to the building that records it.

The two are **not** folded together, and the separation is the point. Ambient
widens *reach*, never *trust*: a row must clear the trust gate first, and
ambient only decides whether a row that already cleared it is visible from where
the caller stands. An ambient mark that is not the town's constitutional law is
gathered by nobody, from nowhere.

It is also why `isClassMark` was not narrowed to the ambient marks. That
predicate answers "is this a class mark", and lint **L6** — *every exposed
subverb has a live handler* — asks it of every mark in the world; narrowing it
would blind L6 to exactly the sited affordances it exists to catch. Each rule
has a SQL/predicate twin, and a test asserts each pair selects the same nodes.

### The boolean that is a string

`ambient: true` in a mark file reaches the hydrator as the **string** `"true"`.
The world's frontmatter parser (`marks-fold.mjs` `parseRecord`) coerces objects,
arrays and numbers, and has no boolean case at all — so both shapes are live in
the town today depending on which pipeline a field travels: `pre` is stored as
text, `far` as a real boolean.

The hydrator therefore **normalizes at that boundary and nowhere else**:
`true` and `"true"` become the boolean, everything else becomes null. Not
truthiness — `ambient: 1`, `"yes"` and `"TRUE"` widen nothing, and each is
reported through `frontmatter_problems` so an author who believed they declared
world-wide reach finds out. Downstream the field is a real boolean and the
store's rule stays strict (`json_type = 'true'`).

The root fix is boolean support in `parseRecord`, which is a world-repo change
with a wide blast radius — every boolean-shaped field in the town changes shape
at once — and wants doing deliberately rather than as a side effect.

### What stood on 2026-08-09

*A dated receipt. Today's acts are the bare `world` call's `actions:`, read
from the class marks where you stand; `docs/MCP-ROSTER.md` renders the
dispatch table.*

At world `0428141`, exactly **one** subverb is exposed: `say`, from
`the-town/sound`, ambient, and it dispatches. L6 is GREEN.

`the-town/the-wheelhouse` is constitutional law now — the defaulted tier was
latent and has been trued — but its `board` affordance is **withheld** until
Stage D gives boarding a handler, so the mark carries no `affordances:` field
and passes three of the gate's four clauses. An advertised door that cannot be
invoked is a lying door; law chose not to lie rather than making the office
apologise at the threshold. Stage D restores the affordance and the handler in
one commit, and L6 is what makes that pairing checkable rather than a matter of
remembering.

## Not in scope, deliberately

No hydrator change (the rings stay a vertex count — that is the next commit, not
this one), no `office.db` code path, no site change, no deployment. The flags ship
off, and `npm run world:shadow` reading EMPTY DIFF is still the gate anything
here has to pass first.
