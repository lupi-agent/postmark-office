// bounded-reads.test.mjs — falsifiers for the bounded TOWN reads (2026-08-25).
// The world lane's own falsifiers live in bounded-world-reads.test.mjs.
//
// Every test here quotes the law it asserts, verbatim, because a brief is lossy
// and the engine has to be able to build FROM the sentence. Three laws govern
// the whole file:
//
//   "A bound and its count are ONE change, never two."
//   "A budget decides how much gets said; it must not decide what is true."
//   "A cap must be visible" — a short page and a full one must not look alike.
//
// AND THE TRAP THESE TESTS EXIST TO AVOID. From the audit's own falsifier note:
// "A test that asserts `count === letters.length` passes both before and after
// the fix and proves nothing. The falsifier that can fail: seed more rows than
// the page holds and assert `total > shown`." So every fixture below is
// deliberately LARGER than the bound it tests. A fixture that fits inside the
// bound would make this whole file green against the defect.

import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { SCHEMA } from "../src/schema.mjs";
import {
  resident, mailList, letterList, repoLog, residentPage, residentList,
  doorstep, bulletinTeaser, stampsRoster, search, regionList, CARD_MAIL, mailAwaiting,
} from "../src/queries.mjs";

const AS_OF = "bigfixture00000000000000000000000000000";

/**
 * A town deliberately bigger than every bound in this wave.
 *
 * 60 residents, 40 letters into one inbox, 45 commits, 30 conversations, 15
 * bulletin entries. The exact sizes matter: each one exceeds its own page, so
 * `total` and `shown` are forced to be different numbers. If a bound is ever
 * raised above one of these, the corresponding test stops being able to fail
 * and should be re-sized rather than deleted.
 */
function bigDb() {
  const db = new DatabaseSync(":memory:");
  db.exec(SCHEMA);
  const put = db.prepare("INSERT INTO meta VALUES (?, ?)");
  put.run("as_of", AS_OF);
  put.run("town_path", "fixture");
  put.run("hydrated_counts", JSON.stringify({}));

  const insR = db.prepare("INSERT INTO residents VALUES (?, ?)");
  for (let i = 0; i < 60; i++) {
    const handle = `r${String(i).padStart(3, "0")}`;
    // Half joined in June, half in August — so a `since` filter has a real
    // subset to find, spread across the whole roll rather than bunched at the
    // front where a slice-then-filter bug would accidentally look right.
    const joined = i % 2 === 0 ? "2026-06-10" : "2026-08-20";
    insR.run(handle, JSON.stringify({
      handle, is_office: i === 7, last_active: null,
      address: { data: { since: "2026-01-01", joined, office: i === 7 || undefined } },
    }));
  }

  const insL = db.prepare("INSERT INTO letters VALUES (?,?,?,?,?,?,?,?,?,?)");
  for (let i = 0; i < 40; i++) {
    const id = `r001-2026-07-${String((i % 28) + 1).padStart(2, "0")}-to-r000-n${i}`;
    const at = `2026-07-${String((i % 28) + 1).padStart(2, "0")}T08:00:00.000Z`;
    const json = JSON.stringify({ id, from: "r001", to: "r000", body: `# letter ${i}\n\nbody ${i}` });
    insL.run(id, "r001", "r000", at.slice(0, 10), null, "inbox", "r000", `WHITE_PAGES/r000/inbox/${i}.md`, json, at);
  }
  // Six letters the other way, so the outbox is a different, smaller set.
  for (let i = 0; i < 6; i++) {
    const id = `r000-2026-07-01-to-r001-out${i}`;
    const json = JSON.stringify({ id, from: "r000", to: "r001", body: `# out ${i}\n\nbody` });
    insL.run(id, "r000", "r001", "2026-07-01", null, "outbox", "r001", `x${i}.md`, json, "2026-07-01T08:00:00.000Z");
  }

  // 45 commits; commit 0 touches three files so a DISTINCT-sha total cannot be
  // confused with a row count.
  const insG = db.prepare("INSERT INTO repo_log VALUES (?,?,?,?,?,?)");
  for (let i = 0; i < 45; i++) {
    const sha = `sha${String(i).padStart(3, "0")}`;
    const at = `2026-07-${String((i % 28) + 1).padStart(2, "0")}T08:00:00.000Z`;
    const files = i === 0 ? 3 : 1;
    for (let f = 0; f < files; f++) insG.run(sha, at, "someone", `subject ${i}`, "M", `path/${i}/${f}.md`);
  }

  const insB = db.prepare("INSERT INTO bulletin VALUES (?, ?)");
  for (let i = 0; i < 15; i++) {
    const slug = `2026-07-${String(i + 1).padStart(2, "0")}-notice-${i}`;
    insB.run(slug, JSON.stringify({ slug, data: { title: `notice ${i}` }, body: `# notice ${i}\n\nprose` }));
  }

  // 30 conversations. The ones that await a reply sit at indices 25–29 —
  // PAST the 20-row render bound — because that is exactly where a
  // slice-then-derive bug hides: it would report zero threads awaiting reply to
  // someone with five of them.
  const conversations = [];
  for (let i = 0; i < 30; i++) {
    conversations.push({
      conversation: `c${String(i).padStart(3, "0")}`,
      attention_state: i >= 25 ? "new_inbound" : "last_word_yours",
      reason: "fixture", latest_delivered_id: `l${i}`, latest_delivered_from: i >= 25 ? "them" : "r000",
      queued_reply_id: null, latest_event: { ordinal: 1000 - i, date: "2026-07-01" },
      next_actor: i >= 25 ? "you" : "them", others: ["r001"], letters: 2,
    });
  }
  db.prepare("INSERT INTO mail_state VALUES (?, ?)").run("r000", JSON.stringify({
    handle: "r000", language: "sequence, never debt", conversations,
    summary: { they_spoke_last: 5, new_inbound: 5, they_spoke_again: 0, reply_queued: 0, last_word_yours: 25, bounced: 0 },
  }));
  return db;
}

const db = bigDb();

// ── the address card ────────────────────────────────────────────────────────

test("resident card: the inbox is bounded, and the total is a DIFFERENT number", () => {
  // "A bound and its count are ONE change, never two" — a count that could
  // never differ from its own list is the list length wearing a total's name.
  const r = resident(db, "r000");
  assert.equal(r.inbox.length, CARD_MAIL, "the card renders the newest few, not the box");
  assert.equal(r.inbox_total, 40, "the total counts the whole box");
  assert.notEqual(r.inbox_total, r.inbox.length,
    "THE FALSIFIER: if these two can never disagree, the total is not a total");
  assert.equal(r.outbox.length, CARD_MAIL);
  assert.equal(r.outbox_total, 6);
  assert.notEqual(r.outbox_total, r.outbox.length);
});

test("resident card: the excerpt carries no letter body, and names the door to the rest", () => {
  const r = resident(db, "r000");
  for (const l of r.inbox) {
    assert.equal(l.body, undefined, "a body on the identity card is the 782 KB defect returning");
    assert.ok(typeof l.first_line === "string", "list_mail's excerpt shape, not a bare id");
  }
  // psaFold's `more_note` shape: the count of what was withheld AND the exact
  // call that returns it.
  assert.match(r.mail_note, /list_mail/);
  assert.match(r.mail_note, /read_letter/);
  assert.match(r.mail_note, /\b36 further letters\b/, "35 inbox + 1 outbox withheld, said out loud");
});

test("resident card: a bound not reached says so, rather than looking like a cut one", () => {
  // "A cap must be visible": r002 has no mail at all, and must not read like
  // someone whose card merely stopped at five.
  const r = resident(db, "r002");
  assert.equal(r.inbox_total, 0);
  assert.equal(r.inbox.length, 0);
  assert.match(r.mail_note, /nothing is withheld/);
  assert.doesNotMatch(r.mail_note, /further letter/);
});

// ── list_mail ───────────────────────────────────────────────────────────────

test("list_mail: total, page, and a door past the bound that actually walks", () => {
  const page = mailList(db, "r000", "inbox", { limit: 10 });
  assert.equal(page.shown, 10);
  assert.equal(page.total, 40);
  assert.notEqual(page.total, page.shown, "THE FALSIFIER: bound < total, count still true");
  assert.equal(page.complete, false);
  assert.equal(page.next_offset, 10);
  // Walk the whole box and prove the pages tile it: no gaps, no repeats.
  const seen = [];
  let offset = 0;
  for (let guard = 0; guard < 10; guard++) {
    const p = mailList(db, "r000", "inbox", { limit: 10, offset });
    seen.push(...p.letters.map((l) => l.id));
    if (p.complete) break;
    offset = p.next_offset;
  }
  assert.equal(seen.length, 40);
  assert.equal(new Set(seen).size, 40, "the pages tile the box — no letter served twice");
});

test("list_mail: the last page says complete, and carries no read-more it cannot honour", () => {
  const last = mailList(db, "r000", "inbox", { limit: 10, offset: 30 });
  assert.equal(last.complete, true);
  assert.equal(last.next_offset, undefined, "a cursor that points past the end is a lie in a field");
  assert.equal(last.more_note, undefined);
});

// ── list_letters ────────────────────────────────────────────────────────────

test("list_letters: `count` keeps its old meaning; `total` is the new, honest one", () => {
  const l = letterList(db, { limit: 5 });
  assert.equal(l.shown, 5);
  assert.equal(l.count, 5, "cached readers read `count` as the rows in hand — unchanged");
  assert.equal(l.total, 46, "40 in + 6 out");
  assert.notEqual(l.total, l.count, "THE FALSIFIER: the page size and the match count are different facts");
  assert.equal(l.complete, false);
});

test("list_letters: the total counts the FILTER's matches, not the table", () => {
  // "A budget decides how much gets said; it must not decide what is true."
  const filtered = letterList(db, { resident: "r001", limit: 5 });
  assert.equal(filtered.total, 46, "every letter in this fixture touches r001");
  const narrow = letterList(db, { since: "2026-07-20", limit: 2 });
  assert.ok(narrow.total < 46, "a narrower filter must move the total, or it is not reading the filter");
  assert.ok(narrow.total >= narrow.shown);
});

test("list_letters: full: true carries bodies; the default still carries none", () => {
  const lean = letterList(db, { limit: 2 });
  assert.equal(lean.letters[0].body, undefined);
  assert.equal(lean.full, undefined);
  const full = letterList(db, { limit: 2, full: true });
  assert.equal(full.full, true);
  assert.match(full.letters[0].body, /body/, "the bulk-body door the address-card bound made necessary");
  assert.equal(full.total, lean.total, "the shape dial must not move the total");
});

// ── list_commits ────────────────────────────────────────────────────────────

test("list_commits: the total is COMMITS, not file-change rows", () => {
  const c = repoLog(db, { limit: 10 });
  assert.equal(c.shown, 10);
  assert.equal(c.total, 45, "45 commits — the table holds 47 rows, because one commit touched three files");
  const rows = Object.values(db.prepare("SELECT COUNT(*) AS n FROM repo_log").get())[0];
  assert.equal(rows, 47);
  assert.notEqual(c.total, rows,
    "THE FALSIFIER: a plain COUNT(*) here would report file rows under a commits noun");
  assert.notEqual(c.total, c.shown);
});

test("list_commits: offset reaches the tail of history the bound could not", () => {
  const first = repoLog(db, { limit: 10 });
  const tail = repoLog(db, { limit: 10, offset: 40 });
  assert.equal(tail.shown, 5);
  assert.equal(tail.complete, true);
  assert.equal(tail.total, 45, "the total does not shrink as you walk");
  const overlap = new Set(first.commits.map((c) => c.sha));
  assert.ok(tail.commits.every((c) => !overlap.has(c.sha)), "offset walked past the first page");
});

// ── list_residents ──────────────────────────────────────────────────────────

test("list_residents: bounded, counted, and it takes arguments at all now", () => {
  const p = residentPage(db, {});
  assert.equal(p.shown, 50);
  assert.equal(p.total, 60);
  assert.notEqual(p.total, p.shown, "THE FALSIFIER: bound < roll, count still true");
  assert.equal(p.complete, false);
  assert.equal(p.next_offset, 50);
});

test("list_residents: FILTER FIRST, THEN SLICE — the total counts every match", () => {
  // "A budget decides how much gets said; it must not decide what is true."
  // The August joiners are every ODD index across all 60 residents, so a
  // slice-then-filter bug would find 25 of them inside the first 50 and report
  // 25. Filtering first finds all 30.
  const lately = residentPage(db, { since: "2026-08-01", limit: 5 });
  assert.equal(lately.total, 30, "every August joiner, not the ones that survived a page cut");
  assert.equal(lately.shown, 5);
  assert.ok(lately.residents.every((r) => r.joined >= "2026-08-01"));
  assert.equal(lately.town_total, 60, "the roll's own size stays visible beside the filtered total");
  // and the filtered set is genuinely walkable to its end
  const rest = residentPage(db, { since: "2026-08-01", limit: 5, offset: 25 });
  assert.equal(rest.complete, true);
  assert.equal(rest.total, 30);
});

test("list_residents: the office filter narrows the total too", () => {
  const offices = residentPage(db, { office: true });
  assert.equal(offices.total, 1);
  assert.equal(offices.complete, true);
  const people = residentPage(db, { office: false });
  assert.equal(people.total, 59);
});

test("residentList stays WHOLE — the bound lives at the door, not in the derivation", () => {
  // Half the office derives from this roll (the walkers roll, the letter
  // filters, the doorstep's arrivals) and every one of them wants everyone.
  assert.equal(residentList(db).length, 60);
});

// ── the doorstep ────────────────────────────────────────────────────────────

// THE BLOCK NAMES MOVED, THE LAWS DID NOT (2026-08-25, the bundle refactor).
// `correspondence` and `awaiting_reply` were two views of one ledger; they are
// one read now — `household read: "mail", view: "awaiting"` — and the doorstep
// carries it as its `awaiting` segment. Each assertion below is the same
// assertion at the new address; the bundle's own structural falsifier lives in
// test/doorstep-bundle.test.mjs.
test("doorstep: the conversation ledger is bounded and the summary counts the whole of it", async () => {
  const d = (await doorstep(db, "r000", AS_OF));
  assert.equal(d.awaiting.conversations.length, 20);
  assert.equal(d.awaiting.conversations_total, 30);
  assert.notEqual(d.awaiting.conversations_total, d.awaiting.conversations.length,
    "THE FALSIFIER: the summary beside an uncut list was decoration; beside a cut one it is information");
  assert.equal(d.awaiting.conversations_complete, false);
  assert.equal(d.awaiting.conversations_next_offset, 20);
  // the law's own numbers ride through untouched
  assert.equal(d.awaiting.summary.last_word_yours, 25);
  assert.match(d.awaiting.language, /sequence, never debt/);
});

test("doorstep: the awaiting threads are DERIVED FROM THE WHOLE LEDGER, then bounded", async () => {
  // The five threads awaiting a reply sit at conversation indices 25–29 —
  // beyond the 20-row render bound. Deriving from the slice would answer "no
  // threads awaiting your reply" to someone with five of them. That is the
  // children-reported-as-neighbours bug in a new mouth:
  // "A budget decides how much gets said; it must not decide what is true."
  //
  // ⚠ THE INSTRUMENT CHANGED, THE CLAIM DID NOT (2026-09-07, lane E item 4).
  // This test used to prove the claim by POSITION — the five awaiting threads
  // happened to sit past the render bound, so finding them in `threads` proved
  // the derivation had not been drawn from the slice. The page is now ordered
  // `next_actor: "you"` first (queries.mjs § YOURS FIRST), so those five are on
  // page one by design and the positional proof can no longer fail. A probe
  // that cannot fail proves nothing, so it is replaced rather than deleted: the
  // claim is now tested by SHRINKING THE BUDGET, which is the law's own words —
  // "a budget decides how much gets said; it must not decide what is true."
  const d = (await doorstep(db, "r000", AS_OF));
  assert.equal(d.awaiting.threads_total, 5);
  assert.equal(d.awaiting.threads.length, 5);
  assert.ok(d.awaiting.threads.every((a) => a.state === "new_inbound"));
  // The budget cut to two rows. Derive from the slice and `threads_total` falls
  // with it; derive from the whole ledger and it does not move.
  const tight = mailAwaiting(db, "r000", { limit: 2 });
  assert.equal(tight.conversations.length, 2, "the budget did decide how much gets said");
  assert.equal(tight.threads_total, 5, "…and did not decide what is true");
  assert.equal(tight.outgoing_total, d.awaiting.outgoing_total, "the queued replies are whole-set too");
  assert.equal(tight.conversations_total, 30, "and the total is the ledger's, never the page's");
});

test("doorstep: what awaits YOU is on the first page, and the summary still counts the whole ledger", () => {
  // Walk #1 (docs/2026-09-05/resident-walk.md, 21:23 EDT, item 2), verbatim:
  //
  //   "Summary: they_spoke_last: 109 · new_inbound: 27. Rows shown: five
  //    threads, every one last_word_yours. … A resident asking 'what do I owe'
  //    gets a count of 109 and five rows that all say 'nothing'."
  //
  // Both numbers were right about different questions. The rows move; the
  // summary does not.
  const a = mailAwaiting(db, "r000", { limit: 3 });
  assert.ok(a.conversations.every((c) => c.next_actor === "you"),
    "the first rows a resident sees are the ones on their side of the table");
  assert.equal(a.conversations_awaiting_you, 5, "and the page says how many of the whole those are");
  assert.match(a.conversations_order, /next_actor: "you" first/, "the page states its own order");
  assert.match(a.conversations_summary_scope, /never this page/, "and that the summary is not about it");
  // The ledger's newest-first order survives INSIDE each group — this regroups
  // the page, it does not re-date it.
  const ord = (c) => c.latest_event?.ordinal ?? -1;
  const theirs = a.conversations.filter((c) => c.next_actor !== "you");
  for (const group of [a.conversations.filter((c) => c.next_actor === "you"), theirs]) {
    for (let i = 1; i < group.length; i++)
      assert.ok(ord(group[i - 1]) >= ord(group[i]), "newest-first inside the group");
  }
  assert.equal(a.summary.last_word_yours, 25, "the law's own numbers ride through untouched");
});

test("doorstep: the correspondence cursor walks to the end and stops", async () => {
  const d = (await doorstep(db, "r000", AS_OF, { conversationsOffset: 20 }));
  assert.equal(d.awaiting.conversations.length, 10);
  assert.equal(d.awaiting.conversations_offset, 20);
  assert.equal(d.awaiting.conversations_complete, true);
  assert.equal(d.awaiting.conversations_next_offset, undefined);
  assert.equal(d.awaiting.conversations_total, 30, "the total does not shrink as you walk");
});

test("doorstep: the bulletin is a teaser with a total, newest first", async () => {
  const d = (await doorstep(db, "r000", AS_OF));
  // Three on the morning page now, not ten: the bundle's bulletin segment IS
  // `town read: "bulletin", limit: 3` — a teaser and a pointer, per the
  // refactor. `read_bulletin` with no arguments still answers the whole board.
  assert.equal(d.bulletin.entries.length, 3);
  assert.equal(d.bulletin.total, 15);
  assert.notEqual(d.bulletin.total, d.bulletin.entries.length);
  assert.equal(d.bulletin.more, 12);
  assert.match(d.bulletin.more_note, /read_bulletin/);
  assert.equal(d.bulletin.entries[0].slug, "2026-07-15-notice-14", "newest first — the tail is what a teaser drops");
});

test("bulletinTeaser: the offset the more_note names actually walks the board", () => {
  // "A cap must be visible" has a sibling: a read-more a caller cannot take is
  // a pointer at a door that does not open. The note said the whole listing was
  // one read away and meant fetching all fifteen; now it names an offset.
  const first = bulletinTeaser(db, { limit: 3 });
  assert.equal(first.next_offset, 3);
  const second = bulletinTeaser(db, { limit: 3, offset: first.next_offset });
  assert.equal(second.offset, 3);
  assert.equal(second.total, 15, "the total does not shrink as you walk");
  assert.notEqual(second.entries[0].slug, first.entries[0].slug, "the second page is a different page");
  const last = bulletinTeaser(db, { limit: 3, offset: 12 });
  assert.equal(last.complete, true);
  assert.equal(last.next_offset, undefined, "a cursor is null exactly when there is nothing more");
});

test("bulletinTeaser: a board shorter than the bound reports itself complete", () => {
  const small = new DatabaseSync(":memory:");
  small.exec(SCHEMA);
  small.prepare("INSERT INTO bulletin VALUES (?, ?)").run("a", JSON.stringify({ data: {}, body: "# a" }));
  const t = bulletinTeaser(small);
  assert.equal(t.total, 1);
  assert.equal(t.complete, true);
  assert.equal(t.more, undefined, "a short list and a cut list must not look alike");
});
// ── the second pass: the surfaces the first wave left standing ───────────────

test("stampsRoster: minted_cumulative is NOT the account count, so the roster needed its own", () => {
  // The trap this closes is subtler than the others: this read always carried a
  // total — `minted_cumulative` — and it is a total of STAMPS, in a different
  // unit from the list beside it. A reader could not learn from it how many
  // accounts the roster stopped short of, which is the only question a bounded
  // roster raises.
  const small = new DatabaseSync(":memory:");
  small.exec(SCHEMA);
  const insS = small.prepare("INSERT INTO stamps (handle, balance, mint_count, staked) VALUES (?, ?, ?, ?)");
  for (let i = 0; i < 70; i++) insS.run(`h${String(i).padStart(3, "0")}`, 100 - i, 100 - i, 0);
  const r = stampsRoster(small, { stamps_minted: "9999" }, {});
  assert.equal(r.balances.length, 50);
  assert.equal(r.accounts, 70);
  assert.equal(r.minted_cumulative, 9999);
  assert.notEqual(r.accounts, r.balances.length, "THE FALSIFIER: bound < accounts, count still true");
  assert.notEqual(r.accounts, r.minted_cumulative, "and the two totals are different facts in different units");
  assert.equal(r.complete, false);
  assert.equal(r.next_offset, 50);
  // sorted by balance descending, so the page is the top of the table
  assert.equal(r.balances[0].balance, 100);
  const tail = stampsRoster(small, { stamps_minted: "9999" }, { offset: 50 });
  assert.equal(tail.balances.length, 20);
  assert.equal(tail.complete, true);
  assert.equal(tail.accounts, 70, "the total does not shrink as you walk");
});

test("search: a truncated search SAYS it truncated, per bucket", () => {
  // "A search that silently truncates at 25 and says nothing is the `capped`
  // lesson unlearned." The two buckets cut at different sizes and are capped
  // independently, so one flag for both would be a lie half the time.
  const hits = search(db, "letter", {});
  assert.equal(hits.letters.length, 25);
  assert.equal(hits.matches.letters, 40);
  assert.notEqual(hits.matches.letters, hits.letters.length,
    "THE FALSIFIER: bound < matches, count still true");
  assert.equal(hits.capped.letters, true);
  assert.equal(hits.capped.residents, false, "no resident matches 'letter' — an honest false, not a copied flag");
  assert.equal(hits.next_offset, 25);
  const rest = search(db, "letter", { offset: 25 });
  assert.equal(rest.letters.length, 15);
  assert.equal(rest.complete, true);
  assert.equal(rest.matches.letters, 40);
});

test("search: a term that fits reports capped false in both buckets", () => {
  // "out2" hits exactly one letter id and no resident — a search whose answer
  // is genuinely the whole answer, which must not read like a page of one.
  const hits = search(db, "out2", {});
  assert.equal(hits.matches.letters, 1);
  assert.equal(hits.letters.length, 1);
  assert.equal(hits.capped.letters, false);
  assert.equal(hits.capped.residents, false);
  assert.equal(hits.complete, true);
  assert.equal(hits.next_offset, undefined, "no cursor that points past the end");
});

test("regionList: the region page and the per-region roll are counted separately", () => {
  const small = new DatabaseSync(":memory:");
  small.exec(SCHEMA);
  const insReg = small.prepare("INSERT INTO regions VALUES (?, ?, ?)");
  for (let i = 0; i < 30; i++) {
    const residents = Array.from({ length: i === 0 ? 40 : 2 }, (_, k) => `r${k}`);
    insReg.run(`reg-${String(i).padStart(2, "0")}`, `Region ${i}`, JSON.stringify({ body: `Description ${i}`, residents }));
  }
  const a = regionList(small, {});
  assert.equal(a.shown, 25);
  assert.equal(a.total, 30);
  assert.notEqual(a.total, a.shown, "THE FALSIFIER: the atlas page is not the atlas");
  // and the roll INSIDE a region is its own bound with its own total
  const big = a.regions.find((r) => r.slug === "reg-00");
  assert.equal(big.residents.length, 25);
  assert.equal(big.residents_total, 40);
  assert.notEqual(big.residents_total, big.residents.length,
    "a region's roll grows with the town even when the atlas does not");
  const small2 = a.regions.find((r) => r.slug === "reg-01");
  assert.equal(small2.residents_total, 2);
  assert.equal(small2.residents_note, undefined, "a roll that fits says nothing");
});
