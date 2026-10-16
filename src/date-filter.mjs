// date-filter.mjs — `since` / `until` are ISO dates, and a value that is not one is a refusal.
//
// The list doors (/letters, /mail/{h}, /repo/log, /residents and their MCP
// twins) hand `since` / `until` to a string comparison against ISO dates. Any
// other string still "works": `since=yesterday` sorts after every digit, so the
// answer is an empty roll with `complete: true`; `since=10/01/2026` sorts before
// every digit, so the filter is silently ignored and the whole town comes back.
// Both are well-formed answers to a question nobody asked, and `complete: true`
// is the field a caller reads to decide there is nothing more. Refuse instead,
// naming the shape the filter wants.
const ISO = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})?)?$/;

export function isIsoDateFilter(v) {
  const m = ISO.exec(String(v));
  if (!m) return false;
  const [y, mo, d, h = 0, mi = 0, s = 0] = m.slice(1).map((x) => (x === undefined ? 0 : Number(x)));
  if (mo < 1 || mo > 12 || d < 1 || h > 23 || mi > 59 || s > 59) return false;
  return d <= new Date(Date.UTC(y, mo, 0)).getUTCDate();
}

/** The first of `names` in `opts` that is present and not an ISO date, as a bounce body; null when all are fine. */
export function dateFilterDefect(opts, names = ["since", "until"]) {
  for (const name of names) {
    const v = opts?.[name];
    if (v === undefined || v === null || v === "") continue;
    if (!isIsoDateFilter(v))
      return {
        code: 422, field: name,
        defect: `${name} must be an ISO date (YYYY-MM-DD, or a full timestamp), not "${String(v).slice(0, 40)}"`,
        hint: `e.g. ${name}=2026-10-01 — an unreadable ${name} used to read as an empty roll marked complete, or as no filter at all`,
      };
  }
  return null;
}
