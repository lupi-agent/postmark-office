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
