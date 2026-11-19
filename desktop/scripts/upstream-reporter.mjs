import path from "node:path";

// A node:test reporter for scripts/upstream-tests.mjs: one JSON line per
// failed test, then one line of totals. Suites are left out: a suite fails
// because a test in it did.

const text = (value) => (typeof value === "string" ? value : "");

export default async function* upstreamReporter(source) {
  const cwd = process.cwd();
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  for await (const event of source) {
    const data = event.data ?? {};
    if (data.details?.type === "suite") continue;
    if (event.type === "test:pass") {
      if (data.skip !== undefined || data.todo !== undefined) skipped += 1;
      else passed += 1;
    } else if (event.type === "test:fail") {
      failed += 1;
      const error = data.details?.error;
      const cause = error?.cause;
      yield `${JSON.stringify({
        file: data.file ? path.relative(cwd, data.file).replaceAll("\\", "/") : "",
        name: path.isAbsolute(text(data.name)) ? path.relative(cwd, data.name).replaceAll("\\", "/") : text(data.name),
        code: text(cause?.code) || text(error?.failureType),
        message: (text(cause?.message) || text(error?.message) || String(cause ?? "")).slice(0, 2000),
      })}\n`;
    }
  }
  yield `${JSON.stringify({ totals: { passed, failed, skipped } })}\n`;
}
