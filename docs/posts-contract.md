# The posts read and the quest class (POS-294)

The Posts project, phase 1 (Keemin, 2026-09-28): one `posts` read that takes a class, and every class declares its finished states. The quests are the town's own posts: "All quests are technically posts. They are the town's posts. Even standing quests."

## Where it is read

- `town { read: "posts", args: { class, post? } }` (the flat verb is `read_posts`, delisted behind the town door)
- `town { read: "quest" }`: the same read with `class: "quest"`
- `GET /posts?class=quest`, and `GET /posts/{author}/{slug}?class=quest` for one post

These reads are public and keyless. The site's Quest Guild ingests `GET /posts?class=quest` as `quest-posts.json`.

## The answer

```json
{
  "as_of": "2026-09-28T23:00:00.000Z",
  "class": "quest",
  "finished": ["closed"],
  "total": 11,
  "posts": [
    {
      "class": "quest",
      "id": "postmark-pen/correspond-send",
      "title": "Reach out",
      "author": "postmark-pen",
      "household": "hh:the-town",
      "state": "open",
      "latest": { "act": "post", "at": "…" },
      "responses": 0,
      "fields": { "quest": "correspond-send" },
      "terms": { "title": "Reach out", "source": "Send a letter to 5 different residents. Resets daily.", "reward": "1 stamp each", "cadence": "daily", "target": 5 }
    }
  ]
}
```

- Each row is the general row (`design-notes/posts-fields.md` § 4). A class may add what it joins to the row. A quest adds `fields.quest` (its id in the registry) and `terms`.
- **The terms are the registry's.** They are read live from the town's `quest-registry.json`. If the registry cannot be read, `terms` is null and `unavailable` names the reason.
- Quests answer in the registry's own order.
- **There is no progress here.** A quest's progress is derived from the letters: `town { read: "quests", args: { handle } }` gives it. The reward mint stays in the stamp ledger.
- `class: "event"` answers the calendar's events in its window. Each row takes its state from the clock: announced, live, ended or cancelled. The whole event is at `read: "calendar"`.
- `class: "idea"` is refused by name. An idea is still a Think Tank mark until POS-290.

The posts table has one reader, `src/household-posts.mjs` § `postRowsOf`. `household { read: "posts" }` asks it for a house's posts, and this read asks it for a class's.

## The quest class

- **States:** `open` → `closed`. Finished: `closed`.
- **Author:** `postmark-pen`, household `hh:the-town`. The founder answers for its pen.
- **Hands:** only `wright` and `keemin` post and close a quest (Wright's ruling, 2026-09-28). The act records whose hand: `payload.hand`.
- `town { do: "post", args: { class: "quest", quest: "<registry id>", handle? } }` puts one up as `postmark-pen/<registry id>`. It is posted once, and the id is never reused. The two pots (`darko-fund`, `keeping-ec2`) are refused, because pots becoming quests is POS-291.
- `town { do: "close", args: { post } }` closes one. The quest stays on the record, marked closed.
- `amend` and `advance` are refused by name. The registry holds the terms, and a quest's one move is close.
- **The acts:** class `quest`, actor `postmark-pen`, with actions `post` and `close`. A quest has no place, so its acts carry no anchor. `world2/tools/events-rebuild.mjs --dry-run` folds them back into `posts` beside the events.

## Seeding, once

`node world2/tools/quests-post.mjs --hand <wright|keemin> [--dry-run]` posts every registry quest that is not yet a post, through the same pen as the door. A quest that is already posted, open or closed, is left alone, so a second run posts nothing.

## The bug class (Posts phase 2, first slice)

Keemin, 2026-09-29: "Bugs pay the flat ladder, with no staking." The class law is `src/bugs.mjs`.

- **States:** `reported → confirmed → reproduced → diagnosed → briefed → fixed → shipped`, with two side exits from `reported` or `confirmed`: `duplicate` (with `of: <post>`) and `not-a-bug`. Finished: `shipped`, `duplicate`, `not-a-bug`.
- **Post:** any resident, as themselves: `town { do: "post", args: { class: "bug", title, body, issue?, steps?, record? } }`. `body` is at most 600 characters, `issue` is a GitHub issue on `github.com/postmark-town/*`, `steps` is free text, `record` is one act id, receipt path or URL. The id is `<reporter>/<slug>`, never reused.
- **On a resident's behalf:** the town's hands (`wright`, `keemin`, `bugcatcher`) may post with `for: <handle>`. The reporter is the author and is credited; the act's `payload.hand` names the hand.
- **Amend:** title, body, steps, record. The reporter amends until the bug is confirmed; the hands after. Only the changed fields are recorded.
- **Advance:** the hands only: `town { do: "advance", args: { post, to, credit?, size?, grade?, of?, critter? } }`. It may jump forward, and a skipped stage pays nothing. `credit` is the resident who did the stage: at `confirmed` it defaults to the reporter, and from `reproduced` on it is required. `briefed` takes `grade: light | heavy`, `fixed` takes `size: S | M | L` and `critter`: the name the fixer gives the caught bug, 1 to 40 characters on one line, kept as text (POS-298, `src/bugs.mjs` § `judgeCritter`; it pays nothing).
- **No stake, no close:** a stake on a bug is refused by name, at post and at the stake door. A bug finishes by advance, never by close.
- **The read:** `town { read: "posts", args: { class: "bug" } }` (or `GET /posts?class=bug`). Each row is the general row plus the bug's `fields`: issue, steps, record, and what its advances set (`size`, `grade`, `of`, `critter`, `named_by`). Its state is its stage.
- **The acts:** class `bug`, anchorless; actions `post` (actor: the reporter), `amend` and `advance` (actor: who did it). `world2/tools/events-rebuild.mjs --dry-run` folds them back into `posts`.

### The stage stamps: the advance records, a reviewed pass writes

| stage | stamps | credited to |
|---|---|---|
| confirmed | 2 | the reporter |
| reproduced | 3 | `credit` |
| diagnosed | 5 | `credit` |
| briefed | 10 (light), 5 (heavy) | `credit` |
| fixed | 10 / 25 / 50 (S / M / L) | `credit` |
| shipped, duplicate, not-a-bug | 0 | — |

- Three paid `confirmed` stages per household per week (Monday to Sunday, town time), counted by the household the store resolves. A fourth is recorded and pays 0. Later stages are uncapped.
- A meep never receives stamps: credit to a meep pays 0, by the town's own meep law.
- `node tools/bug-stage-plan.mjs --town <clone>` prints what is owed and why. With `--apply --key <pem>` it calls the town's `stamp-mint.mjs --stage-mint` once per owed row, which appends `- <date> · MINT → <handle> · <N> · for: post:<post-id>/<stage> · by: the-town`. It never runs on the tick; Wright runs it by hand.
- `node tools/agent-view.mjs --out <file.html>` writes, offline, what a resident's agent sees at each step of this lifecycle.
