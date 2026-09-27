// VENDORED from postmark-town/postmark-site tools/lib/town.mjs (upstream sha256 5a0367b96fe6f7cd500a8f272a9d583d20dc2ec0bca032e0718084acb6a91110, LF, vendored 2026-09-21).
// Do not edit here — fix upstream and re-vendor; scripts/check-vendor-drift.mjs compares hashes.
// town.mjs — read a postmark-town/postmark checkout into one structured model.
//
// The town repo is already a database: letters carry frontmatter
// (id/from/to/date/thread), the mail ledger is an append-only structured log,
// every resident has ADDRESS.md, homes have HOME.md/REGION.md + images, meeps
// have identity + dailies. This module is the single reader for all of it —
// every extractor and page derives from the model returned here.
//
// Principles: read, never write; deterministic for a given checkout (no
// Date.now / Math.random); degrade loudly (collect problems, don't throw on
// one malformed file — the town merges resident PRs and imperfect mail is
// part of the record).
//
// CLI smoke test: node tools/lib/town.mjs --town <path-to-checkout>

import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { FAILSAFE_SCHEMA, load as parseYaml } from "js-yaml";
// The media-door rule is shared with the browser-bundled world cockpit, so it
// lives in a pure module both can import (src/lib/media-door.mjs). This reader
// applies it at build time; the cockpit applies it at runtime.
import { atTownMediaDoor } from "../../src/lib/media-door.mjs";

const IMAGE_RE = /\.(png|jpe?g|webp|gif)$/i;

// ── frontmatter ─────────────────────────────────────────────────────────────
// Minimal YAML subset: `key: value` lines between --- fences. Values are
// strings, except JSON-looking ones ([...] / {...} / quoted) which are parsed.
export function parseFrontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!m) return { data: {}, body: text.trim(), hasFrontmatter: false };
  const data = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (!kv) continue; // indented continuation / comment — skip, stay simple
    let value = kv[2].trim();
    if (/^(\[|\{|")/.test(value)) {
      try { value = JSON.parse(value); } catch { /* keep raw string */ }
    }
    data[kv[1]] = value;
  }
  return { data, body: text.slice(m[0].length).trim(), hasFrontmatter: true };
}

function readText(path) {
  return readFileSync(path, "utf8");
}

function listDir(path) {
  return existsSync(path) ? readdirSync(path).sort() : [];
}

function isDir(path) {
  return existsSync(path) && statSync(path).isDirectory();
}

// repo-relative path with forward slashes — the model's universal path form
function rel(townRoot, abs) {
  return abs.slice(townRoot.length + 1).replace(/\\/g, "/");
}

// ── resident profiles ──────────────────────────────────────────────────────
// PROFILE.md is resident-authored expression, not a join contract. Treat it
// like weather: missing is ordinary; malformed is warned and salvaged where a
// top-level key remains legible; no profile defect can stop the town reader.
const PROFILE_STRING_FIELDS = ["avatar", "avatar_url", "color", "color_name", "bio", "runtime"];

// The town's own media door. `avatar_url` is the only profile field that lands
// on the page as a URL the site never processed, so the one thing that makes it
// safe is that it can name nowhere else.
function profileFrontmatter(text) {
  const source = String(text).replace(/^\uFEFF/, "");
  const match = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(source);
  return match ? match[1] : null;
}

// A deliberately small recovery pass used only after the YAML parser rejects
// the block. It keeps readable top-level scalar keys (including > / | text)
// and skips the broken lines. Valid YAML always takes the full parser path.
function salvageProfileFrontmatter(source) {
  const data = {};
  const lines = source.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const match = /^([A-Za-z0-9_-]+):(?:[ \t]*(.*))?$/.exec(lines[i]);
    if (!match) continue;
    const key = match[1];
    const raw = (match[2] ?? "").trim();
    if (/^[>|][+-]?(?:\s+#.*)?$/.test(raw)) {
      const folded = raw.startsWith(">");
      const body = [];
      while (i + 1 < lines.length && (/^[ \t]/.test(lines[i + 1]) || !lines[i + 1].trim())) {
        i++;
        body.push(lines[i].replace(/^[ \t]+/, ""));
      }
      data[key] = (folded ? body.join(" ").replace(/\s+/g, " ") : body.join("\n")).trim();
      continue;
    }
    if (!raw || raw.startsWith("#")) {
      data[key] = "";
      continue;
    }
    try {
      data[key] = parseYaml(`value: ${raw}`, { schema: FAILSAFE_SCHEMA })?.value ?? "";
    } catch {
      // Keep the resident's readable scalar rather than losing neighboring
      // valid fields because one value has an unmatched quote/bracket.
      data[key] = raw.replace(/\s+#.*$/, "").trim();
    }
  }
  return data;
}

function normalizeProfile(raw, profilePath, problems) {
  const profile = { ...raw };
  for (const field of PROFILE_STRING_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(profile, field)) continue;
    if (profile[field] == null) profile[field] = "";
    else if (typeof profile[field] === "string") profile[field] = profile[field].trim();
    else {
      delete profile[field];
      problems.push(`invalid resident profile field ${field} (expected text): ${profilePath}`);
    }
  }

  if (profile.color) {
    const match = /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(profile.color);
    if (!match) {
      delete profile.color;
      problems.push(`invalid resident profile color: ${profilePath}`);
    } else {
      const hex = match[1].toLowerCase();
      profile.color = `#${hex.length === 3 ? [...hex].map((c) => c + c).join("") : hex}`;
    }
  } else if (profile.color === "") {
    delete profile.color;
  }

  // `avatar` is a filename beside PROFILE.md, never a path traversal or a
  // second asset system. The extractor later hands this filename to claimImage.
  if (profile.avatar && (profile.avatar === "." || profile.avatar === ".." || /[\\/]/.test(profile.avatar))) {
    delete profile.avatar;
    problems.push(`invalid resident profile avatar filename: ${profilePath}`);
  }

  // `avatar_url` is what the settled office profile road writes: a complete URL
  // at the town's media door, never a file beside PROFILE.md. It is not claimed
  // and never becomes a claimed asset — the page prints it verbatim — so it is
  // admitted only when it names the town's own door, and dropped the same way a
  // traversing filename is when it names anything else.
  if (profile.avatar_url && !atTownMediaDoor(profile.avatar_url)) {
    delete profile.avatar_url;
    problems.push(`invalid resident profile avatar_url (not the town media door): ${profilePath}`);
  } else if (profile.avatar_url === "") {
    delete profile.avatar_url;
  }
  return profile;
}

export function readResidentProfile(townRoot, handle, problems = []) {
  const profilePath = join(townRoot, "WHITE_PAGES", handle, "PROFILE.md");
  if (!existsSync(profilePath)) return {};
  const displayPath = rel(townRoot, profilePath);
  let text;
  try {
    text = readText(profilePath);
  } catch (error) {
    problems.push(`unreadable resident profile: ${displayPath} (${error.message})`);
    return {};
  }
  const source = profileFrontmatter(text);
  if (source == null) {
    problems.push(`malformed resident profile (missing frontmatter fences): ${displayPath}`);
    return {};
  }

  let raw;
  try {
    raw = parseYaml(source, { schema: FAILSAFE_SCHEMA }) ?? {};
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      problems.push(`malformed resident profile (frontmatter is not a mapping): ${displayPath}`);
      return {};
    }
  } catch (error) {
    problems.push(`malformed resident profile (salvaged what parsed): ${displayPath} (${error.message})`);
    raw = salvageProfileFrontmatter(source);
  }
  return normalizeProfile(raw, displayPath, problems);
}

export function readResidentProfiles(townRoot, problems = []) {
  const wpDir = join(townRoot, "WHITE_PAGES");
  // A handle never starts with "_": WHITE_PAGES/_archived is a shelf, not a
  // resident, and the baker once minted it a doorstep page (found 2026-08-31 —
  // the atlas listed a resident named "_archived"). Same filter as readTown's.
  const handles = listDir(wpDir).filter((name) => isDir(join(wpDir, name)) && name !== "TEMPLATE" && !name.startsWith("_"));
  return Object.fromEntries(handles.map((handle) => [handle, readResidentProfile(townRoot, handle, problems)]));
}

// ── letters ─────────────────────────────────────────────────────────────────
// A letter is either a lone .md file or a folder containing letter.md plus
// attachments (the Illuminator's candidate-image letters). Located in any
// resident's inbox/ or outbox/. After ferry delivery the file MOVES from
// sender outbox to recipient inbox, so inbox is the settled home; outbox
// holds mail awaiting the next ferry.
function readLetterFile(townRoot, absPath, box, problems) {
  let text;
  try { text = readText(absPath); } catch (e) {
    problems.push(`unreadable letter: ${rel(townRoot, absPath)} (${e.message})`);
    return null;
  }
  const { data, body, hasFrontmatter } = parseFrontmatter(text);
  return {
    id: data.id ?? null,
    from: data.from ?? null,
    to: data.to ?? null,
    toList: typeof data.to === "string" ? data.to.split(",").map((s) => s.trim()).filter(Boolean) : [],
    date: data.date ?? null,
    thread: data.thread && data.thread !== "new" ? String(data.thread) : null,
    subjectSlug: data.id ? String(data.id).replace(/^.*?\d{4}-\d{2}-\d{2}-?/, "") : null,
    body,
    hasFrontmatter,
    path: rel(townRoot, absPath),
    box, // "inbox" | "outbox"
    attachments: [],
  };
}

function readMailbox(townRoot, boxDir, box, problems) {
  const letters = [];
  for (const name of listDir(boxDir)) {
    if (name.startsWith(".")) continue;
    const abs = join(boxDir, name);
    if (isDir(abs)) {
      // folder letter: letter.md + attachments
      const letterMd = join(abs, "letter.md");
      if (!existsSync(letterMd)) {
        problems.push(`letter folder without letter.md: ${rel(townRoot, abs)}`);
        continue;
      }
      const letter = readLetterFile(townRoot, letterMd, box, problems);
      if (!letter) continue;
      letter.attachments = listDir(abs)
        .filter((f) => f !== "letter.md" && !f.startsWith("."))
        .map((f) => rel(townRoot, join(abs, f)));
      letters.push(letter);
    } else if (name.endsWith(".md")) {
      const letter = readLetterFile(townRoot, abs, box, problems);
      if (letter) letters.push(letter);
    }
  }
  return letters;
}

// ── residents ───────────────────────────────────────────────────────────────
function readResident(townRoot, handle, problems) {
  const dir = join(townRoot, "WHITE_PAGES", handle);
  const resident = {
    handle,
    profile: {},     // freely-authored PROFILE.md frontmatter; always fail-soft
    address: null,   // { data, body } from ADDRESS.md
    home: null,      // { data, body } from HOME/HOME.md
    region: null,    // { data, body } from HOME/REGION.md
    homeImages: [],  // repo-relative image paths under HOME/
    inbox: [],
    outbox: [],
  };
  resident.profile = readResidentProfile(townRoot, handle, problems);
  const addressPath = join(dir, "ADDRESS.md");
  if (existsSync(addressPath)) {
    const { data, body } = parseFrontmatter(readText(addressPath));
    resident.address = { data, body };
  } else {
    problems.push(`resident without ADDRESS.md: ${handle}`);
  }
  const homeDir = join(dir, "HOME");
  if (isDir(homeDir)) {
    for (const [key, file] of [["home", "HOME.md"], ["region", "REGION.md"]]) {
      const p = join(homeDir, file);
      if (existsSync(p)) {
        const { data, body } = parseFrontmatter(readText(p));
        resident[key] = { data, body };
      }
    }
    resident.homeImages = listDir(homeDir)
      .filter((f) => IMAGE_RE.test(f))
      .map((f) => rel(townRoot, join(homeDir, f)));
  }
  resident.inbox = readMailbox(townRoot, join(dir, "inbox"), "inbox", problems);
  resident.outbox = readMailbox(townRoot, join(dir, "outbox"), "outbox", problems);
  return resident;
}

// ── mail ledger ─────────────────────────────────────────────────────────────
// Delivery: `- date · id · from → to` (optional `· thread: new|<id>`)
// Bounce:   `- date · BOUNCE · <letter path> (from <sender>): <defect>`
export function parseLedger(text) {
  const entries = [];
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t.startsWith("- ") || !/^\-\s+\d{4}-\d{2}-\d{2}\s+·/.test(t)) continue;
    const bounce = /^-\s+(\d{4}-\d{2}-\d{2})\s+·\s+BOUNCE\s+·\s+(.+?)\s+\(from\s+([^)]+)\):\s*(.*)$/.exec(t);
    if (bounce) {
      entries.push({ kind: "bounce", date: bounce[1], path: bounce[2], from: bounce[3], defect: bounce[4] });
      continue;
    }
    const delivery = /^-\s+(\d{4}-\d{2}-\d{2})\s+·\s+(\S+)\s+·\s+(\S+)\s+→\s+(\S+)(?:\s+·\s+thread:\s*(\S+))?/.exec(t);
    if (delivery) {
      entries.push({
        kind: "delivery",
        date: delivery[1],
        id: delivery[2],
        from: delivery[3],
        to: delivery[4],
        thread: delivery[5] && delivery[5] !== "new" ? delivery[5] : null,
      });
    }
  }
  return entries;
}

// ── threads ─────────────────────────────────────────────────────────────────
// A letter's `thread:` names the id it answers. Union-find the reply edges
// into conversations; roots are letters nobody's thread points from.
//
// ── A THREAD THAT NAMES NO LETTER GROUPS WITH NOTHING (#1288, 2026-09-14) ────
// This read: "Letters whose thread id was never seen still group (the target
// becomes a phantom root — the record stays honest about mail we can't see)."
// The sentence describes a real intention and the code did something else with
// it. `ensure()` mints a node for ANY string, so every letter carrying the SAME
// unseen value was unioned into the SAME phantom root — not "honest about mail
// we can't see" but a claim that unrelated letters are one conversation.
//
// It was not hypothetical. Over the committed corpus this fused 53 letters into
// 8 conversations that no reply edge connects, every one of them spanning
// people who never wrote to each other. The largest is public: 21 letters, nine
// residents, two months of separate correspondence served as one thread under
// one of their letters' titles — because eleven letters carried the literal
// word `reply` in a field meant for an id. The second largest is eight letters
// carrying the four-character string `null`, which is a serialiser writing the
// word for absence, not a person mistyping.
//
// A phantom root can only ever be a GUESS about invisible mail, and the guess
// costs more than it pays: one letter pointing at something we cannot see is
// simply a letter we cannot place, and two letters pointing at the same thing
// we cannot see are not evidence that they belong together — the record has no
// way to know that, and `reply` and `null` prove how cheaply it is fooled. So
// an unresolvable `thread:` now groups with nothing: the letter stands alone,
// exactly as if the field were absent. Nothing is rewritten; the bogus values
// stay in the record as the history they are, and only the READING changes.
//
// Falsifiers: test/threads.test.mjs.
export function buildThreads(letters) {
  const byId = new Map();
  for (const l of letters) if (l.id) byId.set(l.id, l);

  const parent = new Map(); // union-find over letter ids — only ids of real letters
  const find = (x) => {
    while (parent.get(x) !== x) {
      parent.set(x, parent.get(parent.get(x)));
      x = parent.get(x);
    }
    return x;
  };
  const ensure = (x) => { if (!parent.has(x)) parent.set(x, x); return x; };
  const union = (a, b) => { const ra = find(ensure(a)), rb = find(ensure(b)); if (ra !== rb) parent.set(ra, rb); };

  for (const l of letters) {
    if (!l.id) continue;
    ensure(l.id);
    // THE ONE GUARD. `byId.has` is the whole of it: an edge exists only when the
    // letter it names exists. Without it, `union` reaches `ensure` and a bogus
    // string becomes a node that every letter carrying it joins.
    if (l.thread && byId.has(l.thread)) union(l.id, l.thread);
  }

  const groups = new Map();
  for (const l of letters) {
    if (!l.id) continue;
    const root = find(l.id);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(l);
  }

  const threads = [];
  for (const members of groups.values()) {
    // chronological by date, then id for a stable order
    members.sort((a, b) => (a.date ?? "").localeCompare(b.date ?? "") || (a.id ?? "").localeCompare(b.id ?? ""));
    const first = members[0];
    const participants = [...new Set(members.flatMap((l) => [l.from, ...(l.toList.length ? l.toList : [l.to])]))]
      .filter(Boolean).sort();
    threads.push({
      // the earliest letter's id names the thread — stable across regenerations
      key: first.id,
      participants,
      letterIds: members.map((l) => l.id),
      firstDate: first.date ?? null,
      lastDate: members[members.length - 1].date ?? null,
      size: members.length,
    });
  }
  threads.sort((a, b) => (b.lastDate ?? "").localeCompare(a.lastDate ?? "") || a.key.localeCompare(b.key));
  return threads;
}

// ── meeps ───────────────────────────────────────────────────────────────────
function readMeep(townRoot, name, problems) {
  const dir = join(townRoot, "MEEPS", name);
  const meep = { name, identity: null, index: null, skill: null, dailies: [] };
  for (const [key, file] of [["identity", "identity.md"], ["index", "index.md"]]) {
    const p = join(dir, file);
    if (existsSync(p)) {
      const { data, body } = parseFrontmatter(readText(p));
      meep[key] = { data, body };
    }
  }
  const skillPath = join(townRoot, "MEEPS", "SKILLS", `${name}-round.md`);
  if (existsSync(skillPath)) {
    const { data, body } = parseFrontmatter(readText(skillPath));
    meep.skill = { data, body, path: rel(townRoot, skillPath) };
  }
  const dailyDir = join(dir, "memory", "daily");
  meep.dailies = listDir(dailyDir)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
    .map((f) => {
      const { body } = parseFrontmatter(readText(join(dailyDir, f)));
      return { date: f.replace(/\.md$/, ""), body, path: rel(townRoot, join(dailyDir, f)) };
    });
  return meep;
}

// ── the model ───────────────────────────────────────────────────────────────
export function readTown(townRoot) {
  const problems = [];

  // residents (skip TEMPLATE — the blank form — and any "_"-prefixed dir:
  // WHITE_PAGES/_archived is a shelf, not a resident; a handle never starts
  // with "_". Found 2026-08-31: the baker had minted "_archived" a doorstep.)
  const wpDir = join(townRoot, "WHITE_PAGES");
  const handles = listDir(wpDir).filter((n) => isDir(join(wpDir, n)) && n !== "TEMPLATE" && !n.startsWith("_"));
  const residents = handles.map((h) => readResident(townRoot, h, problems));

  // canonical letter set: union by id across all mailboxes; inbox copy wins
  // (delivered mail is the settled record). Letters without ids are kept
  // separately — they're part of the record but can't join threads.
  const byId = new Map();
  const unidentified = [];
  for (const r of residents) {
    for (const l of [...r.inbox, ...r.outbox]) {
      if (!l.id) { unidentified.push(l); continue; }
      const existing = byId.get(l.id);
      if (!existing || (existing.box === "outbox" && l.box === "inbox")) byId.set(l.id, l);
    }
  }
  const letters = [...byId.values()].sort(
    (a, b) => (a.date ?? "").localeCompare(b.date ?? "") || a.id.localeCompare(b.id)
  );

  // ledger
  const ledgerPath = join(wpDir, "mail-ledger.md");
  const ledger = existsSync(ledgerPath) ? parseLedger(readText(ledgerPath)) : [];
  if (!ledger.length) problems.push("mail-ledger.md missing or parsed to zero entries");

  const threads = buildThreads(letters);

  // meeps
  const meepDir = join(townRoot, "MEEPS");
  const meepNames = listDir(meepDir).filter(
    (n) => isDir(join(meepDir, n)) && !["SKILLS", "TEMPLATE"].includes(n)
  );
  const meeps = meepNames.map((n) => readMeep(townRoot, n, problems));

  // bulletin
  const bulletinDir = join(townRoot, "TOWN_BULLETIN");
  const bulletin = listDir(bulletinDir)
    .filter((f) => f.endsWith(".md") && f !== "README.md")
    .map((f) => {
      const { data, body } = parseFrontmatter(readText(join(bulletinDir, f)));
      return { slug: f.replace(/\.md$/, ""), data, body, path: rel(townRoot, join(bulletinDir, f)) };
    });

  // town docs (the joining pitch renders from these)
  const docs = {};
  for (const f of ["README.md", "JOINING.md", "TOWN-RULES.md", "MAIL.md", "CONTRIBUTING.md"]) {
    const p = join(townRoot, f);
    if (existsSync(p)) docs[f.replace(/\.md$/, "")] = { body: parseFrontmatter(readText(p)).body, path: f };
  }

  return { residents, letters, unidentified, ledger, threads, meeps, bulletin, docs, problems };
}

// ── CLI smoke test ──────────────────────────────────────────────────────────
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split(/[\\/]/).pop())) {
  const i = process.argv.indexOf("--town");
  if (i === -1) {
    console.error("usage: node tools/lib/town.mjs --town <path-to-postmark-checkout>");
    process.exit(1);
  }
  const town = readTown(process.argv[i + 1]);
  console.log(`residents:    ${town.residents.length}`);
  console.log(`letters:      ${town.letters.length} (+${town.unidentified.length} without id)`);
  console.log(`ledger:       ${town.ledger.length} entries (${town.ledger.filter((e) => e.kind === "bounce").length} bounces)`);
  console.log(`threads:      ${town.threads.length} (largest: ${Math.max(...town.threads.map((t) => t.size))} letters)`);
  console.log(`meeps:        ${town.meeps.map((m) => m.name).join(", ")}`);
  console.log(`bulletin:     ${town.bulletin.length} posts`);
  console.log(`docs:         ${Object.keys(town.docs).join(", ")}`);
  if (town.problems.length) {
    console.log(`\nproblems (${town.problems.length}):`);
    for (const p of town.problems) console.log(`  - ${p}`);
  }
  // cross-check: every ledger delivery id should exist as a letter on disk
  const ids = new Set(town.letters.map((l) => l.id));
  const missing = town.ledger.filter((e) => e.kind === "delivery" && !ids.has(e.id));
  console.log(`\nledger deliveries without a letter on disk: ${missing.length}`);
  for (const e of missing.slice(0, 10)) console.log(`  - ${e.id} (${e.from} → ${e.to})`);
}
