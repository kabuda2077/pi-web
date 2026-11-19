import assert from "node:assert/strict";
import test from "node:test";
import { localFilePath, revealTarget } from "../src/files.mjs";

test("a path on a drive letter becomes the path Windows writes", () => {
  assert.equal(localFilePath("D:/work/docs/a.md"), "D:\\work\\docs\\a.md");
  assert.equal(localFilePath("d:\\work\\a.md"), "d:\\work\\a.md");
  assert.equal(localFilePath("D:/work/docs/../a b.md"), "D:\\work\\a b.md");
  assert.equal(localFilePath("D:/work/"), "D:\\work");
  assert.equal(localFilePath("D:/"), "D:\\");
});

test("anything else is not touched", () => {
  for (const value of [
    // Chat text comes from a model: a UNC path would sign Windows in to the server it names.
    "//evil.example/share/a.md",
    "\\\\evil.example\\share\\a.md",
    "\\\\?\\C:\\a.md",
    "/home/me/a.md",
    "docs/a.md",
    "D:a.md",
    "file:///D:/a.md",
    "https://example.com/a.md",
    "D:/a\0.md",
    `D:/${"a".repeat(5000)}`,
    "",
    null,
    undefined,
    42,
    { path: "D:/a.md" },
  ]) {
    assert.equal(localFilePath(value), null, String(value));
  }
});

test("Explorer shows the file, or the folder of a file that is gone", () => {
  const on = (...present) => (candidate) => present.includes(candidate);
  assert.deepEqual(revealTarget("D:\\work\\a.md", on("D:\\work\\a.md", "D:\\work")), { select: "D:\\work\\a.md" });
  assert.deepEqual(revealTarget("D:\\work\\a.md", on("D:\\work")), { open: "D:\\work" });
  assert.equal(revealTarget("D:\\work\\a.md", on()), null);
  // A drive that is not there has no folder above it to fall back to.
  assert.equal(revealTarget("Z:\\", on()), null);
});
