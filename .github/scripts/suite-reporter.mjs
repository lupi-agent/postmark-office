// suite-reporter.mjs — a node:test reporter that writes one JSON line per
// finished test: its name, nesting, whether it was a test or a suite, the
// outcome, skip/todo, and for a red its failure type and the first line of its
// error. Workflow machinery for .github/workflows/suite.yml (POS-417), run
// beside the TAP reporter, so the TAP stays the human record and this is the
// machine's. suite-lib.mjs § readEvents reads it.
//
//   node --test --test-reporter=tap --test-reporter-destination=x.tap \
//        --test-reporter=./.github/scripts/suite-reporter.mjs --test-reporter-destination=x.jsonl test/x.test.mjs

const firstLine = (err) => {
  if (!err) return null;
  const inner = err.cause ?? err;
  const msg = String(inner?.message ?? inner ?? "").split("\n")[0];
  return msg.slice(0, 300) || null;
};

export default async function* suiteReporter(source) {
  for await (const event of source) {
    if (event.type !== "test:pass" && event.type !== "test:fail") continue;
    const d = event.data;
    const err = d.details?.error;
    yield JSON.stringify({
      name: d.name,
      nesting: d.nesting,
      type: d.details?.type ?? "test",
      outcome: event.type === "test:pass" ? "pass" : "fail",
      skip: d.skip === undefined || d.skip === false ? null : (d.skip === true ? "skipped" : String(d.skip)),
      todo: d.todo === undefined || d.todo === false ? null : (d.todo === true ? "todo" : String(d.todo)),
      ms: d.details?.duration_ms ?? null,
      failureType: err?.failureType ?? null,
      error: event.type === "test:fail" ? firstLine(err) : null,
    }) + "\n";
  }
}
