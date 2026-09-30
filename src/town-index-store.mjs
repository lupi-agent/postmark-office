// town-index-store.mjs — the office.db readers that have moved to the store
// (POS-268). Each one answers exactly what its office.db twin in queries.mjs
// answers, over the town_* tables (033_town_index.sql), and each has a test
// holding the two equal: test/town-index-reads.test.mjs.
//
// ── THE SWITCH ───────────────────────────────────────────────────────────────
//
// `TOWN_INDEX_READS=store` moves every door listed in MOVED to these readers.
// Unset, the office reads office.db exactly as before; rolling back is unsetting
// it. There is no fallback between the two: a door switched to the store that
// cannot reach it says so (the pen's 503), rather than quietly answering from the
// other index (`the-town/the-disclosure`).
//
// ── WHAT A PORT HAS TO CARRY ─────────────────────────────────────────────────
//
// Three sqlite behaviours the doors' answers depended on without saying so:
//   · text compares and sorts BYTEWISE. Postgres' default collation does not, so
//     every comparison and ORDER BY on text here is `COLLATE "C"`.
//   · LIKE ignores ASCII case, and only ASCII case. `ilike` would fold more
//     than that, so both sides are folded with `translate` over A–Z alone.
//   · rows come back in insert order where nothing orders them (a commit's files
//     by rowid). The store keeps that order as `n` (town_repo_log).
// And one it did say: `GROUP BY sha ORDER BY committed_at DESC` breaks ties by
// sha ascending (measured on the live index: 47 tied timestamps, 0 positions
// that differ from that order), so the port names the tiebreak.
//
// Every reader takes a client (anything with pg's `query`), so a caller runs it
// inside `officeRead`'s READ ONLY transaction and a test runs it on its own.

export const MOVED = Object.freeze(["repoLog", "regionList", "regionOne"]);

/** Is the switch on? Only the exact value `store` turns it on. */
export const townIndexReads = (env = process.env) => env.TOWN_INDEX_READS === "store";

const UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ", LOWER = "abcdefghijklmnopqrstuvwxyz";
/** sqlite's LIKE: ASCII case folded on both sides, nothing else. */
const likeAscii = (col, param, escape = "\\") => `translate(${col}, '${UPPER}', '${LOWER}') LIKE translate(${param}, '${UPPER}', '${LOWER}') ESCAPE '${escape}'`;

/** The sha the store's index was last ingested at (town_meta `as_of`), or null. */
export async function townIndexAsOf(q) {
  const r = await q.query("SELECT value FROM town_meta WHERE key = 'as_of'");
  return r.rows[0]?.value ?? null;
}

/** queries.repoLog, from the store. The same filters, page, total and notes. */
export async function repoLog(q, opts = {}) {
  const limit = Math.min(Math.max(Number(opts.limit) || 30, 1), 200);
  const offset = Math.max(Number(opts.offset) || 0, 0);
  const where = [];
  const params = [];
  const p = (v) => { params.push(v); return `$${params.length}`; };
  const likePrefix = opts.path ? String(opts.path).replace(/[\\%_]/g, (c) => "\\" + c) + "%" : null;
  if (likePrefix) where.push(likeAscii("path", p(likePrefix)));
  if (opts.author) where.push(likeAscii("author", p(`%${opts.author}%`), "")); // sqlite's author LIKE has no escape at all
  if (opts.since) where.push(`committed_at COLLATE "C" >= ${p(String(opts.since))}`);
  if (opts.until) {
    const u = String(opts.until);
    where.push(`committed_at COLLATE "C" <= ${p(u.length === 10 ? `${u}T23:59:59.999Z` : u)}`);
  }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const fixed = params.slice();
  // One commit's rows share its time, author and subject, so min() is that value.
  const commits = (await q.query(
    `SELECT sha, min(committed_at) AS committed_at, min(author) AS author, min(subject) AS subject
       FROM town_repo_log ${clause} GROUP BY sha
      ORDER BY min(committed_at) COLLATE "C" DESC, sha COLLATE "C" LIMIT ${p(limit)} OFFSET ${p(offset)}`, params)).rows;
  const total = Number((await q.query(`SELECT COUNT(DISTINCT sha) AS n FROM town_repo_log ${clause}`, fixed)).rows[0].n);
  const next = offset + commits.length;
  const complete = next >= total;
  const filesWhere = likePrefix ? `sha = $1 AND ${likeAscii("path", "$2")}` : "sha = $1";
  const filesArgs = (sha) => (likePrefix ? [sha, likePrefix] : [sha]);
  const out = [];
  for (const c of commits) {
    const files = (await q.query(`SELECT op, path FROM town_repo_log WHERE ${filesWhere} ORDER BY n LIMIT 100`, filesArgs(c.sha))).rows
      .map((r) => ({ op: r.op, path: r.path }));
    const ft = files.length === 100
      ? Number((await q.query(`SELECT COUNT(*) AS n FROM town_repo_log WHERE ${filesWhere}`, filesArgs(c.sha))).rows[0].n)
      : files.length;
    out.push({
      sha: c.sha, committed_at: c.committed_at, author: c.author, subject: c.subject,
      ...(ft > files.length ? { files_total: ft } : {}),
      files,
    });
  }
  return {
    total, shown: commits.length, count: commits.length, limit, offset, complete,
    ...(complete ? {} : { next_offset: next,
      more_note: `${total - next} further commit${total - next === 1 ? "" : "s"} match this filter — call again with offset: ${next} (limit up to 200)` }),
    note: "the town's own history, from the town's own door — ops are git status letters (A added, M modified, D deleted); files capped at 100/commit, and a commit that hit the cap says so with files_total; when path is given, only matching files are listed",
    commits: out,
  };
}

const REGIONS_PAGE = 25;
const REGION_RESIDENTS = 25;

/** queries.regionList, from the store. */
export async function regionList(q, { limit, offset } = {}) {
  const n = Math.min(Math.max(Number(limit) || REGIONS_PAGE, 1), 200);
  const start = Math.max(Number(offset) || 0, 0);
  const total = Number((await q.query("SELECT COUNT(*) AS n FROM town_regions")).rows[0].n);
  const regions = (await q.query(`SELECT id, name, json FROM town_regions ORDER BY id COLLATE "C" LIMIT $1 OFFSET $2`, [n, start])).rows.map((r) => {
    const d = JSON.parse(r.json);
    const description = (d.body ?? "").split(/\r?\n/)
      .find((l) => { const t = l.trim(); return t && !t.startsWith("#") && !t.startsWith("!["); })?.slice(0, 200) ?? "";
    const all = d.residents ?? [];
    const shown = all.slice(0, REGION_RESIDENTS);
    return { slug: r.id, name: r.name, description,
      residents_total: all.length,
      ...(all.length > shown.length
        ? { residents_note: `${all.length - shown.length} more live here — read_home or list_residents names them all` }
        : {}),
      residents: shown };
  });
  const next = start + regions.length;
  const complete = next >= total;
  return {
    total, shown: regions.length, limit: n, offset: start, complete,
    ...(complete ? {} : { next_offset: next,
      more_note: `${total - next} further region${total - next === 1 ? "" : "s"} in the atlas — call again with offset: ${next}` }),
    regions,
  };
}

/**
 * queries.regionOne, from the store. sqlite's `.get()` on `id = ? OR name = ?`
 * answers the first row in table order; a slug that is one region's id and
 * another's name is not a case the atlas has, and the id match is taken first.
 */
export async function regionOne(q, slug) {
  const row = (await q.query(
    `SELECT id, name, json FROM town_regions WHERE id = $1 OR name = $1 ORDER BY (id = $1) DESC, id COLLATE "C" LIMIT 1`, [slug])).rows[0];
  if (!row) return null;
  const d = JSON.parse(row.json);
  const residents = d.residents ?? [];
  return {
    slug: row.id,
    name: row.name,
    founder: d.holder ?? null,
    style: d.style ?? null,
    description: d.body ?? "",
    assets: d.images ?? [],
    residents,
    residents_total: residents.length,
  };
}

/**
 * Run one store reader in the pen's READ ONLY transaction, with the index's
 * as-of from the same snapshot. A caller that cannot reach the store gets the
 * pen's own error, which its door turns into the 503.
 */
export async function readTownIndex(fn, { env = process.env } = {}) {
  const { officeRead } = await import("./world2-pen.mjs");
  return officeRead(async (client) => ({ out: await fn(client), asOf: await townIndexAsOf(client) }), { env });
}

/** The refusal a switched door gives when the store cannot answer. Fixed words, never the driver's message. */
export const UNREACHABLE = Object.freeze({
  error: "bounce",
  defect: "the office's town index (the store) cannot be reached — nothing was read",
  hint: "this door reads the store (TOWN_INDEX_READS=store); ask again shortly, and it answers when the store does",
});

/**
 * A switched door's answer: `{ out, asOf }` from the store, or `{ refused }`
 * (UNREACHABLE) when it cannot be read. Doors turn the refusal into their 503.
 */
export async function storeAnswer(fn, { env = process.env } = {}) {
  try { return await readTownIndex(fn, { env }); }
  catch { return { refused: UNREACHABLE }; }
}
