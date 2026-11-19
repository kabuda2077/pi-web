import assert from "node:assert/strict";
import test from "node:test";
import { externalUrl, isAppUrl, restorablePath } from "../src/links.mjs";

const ORIGIN = "http://127.0.0.1:30171";

test("only the local server's pages count as the app", () => {
  assert.equal(isAppUrl(`${ORIGIN}/?session=abc`, ORIGIN), true);
  assert.equal(isAppUrl(`${ORIGIN}/api/sessions/abc/export`, ORIGIN), true);
  // Another port is another program on this machine.
  assert.equal(isAppUrl("http://127.0.0.1:30141/", ORIGIN), false);
  assert.equal(isAppUrl("http://localhost:30171/", ORIGIN), false);
  assert.equal(isAppUrl("https://127.0.0.1:30171/", ORIGIN), false);
  // A host that only starts like the server's.
  assert.equal(isAppUrl("http://127.0.0.1:30171.example.com/", ORIGIN), false);
  assert.equal(isAppUrl("http://127.0.0.1:30171@example.com/", ORIGIN), false);
  assert.equal(isAppUrl("not a url", ORIGIN), false);
  assert.equal(isAppUrl(`${ORIGIN}/`, null), false);
});

test("only web and mail links are handed to the OS", () => {
  assert.equal(externalUrl("https://github.com/agegr/pi-web"), "https://github.com/agegr/pi-web");
  assert.equal(externalUrl("http://example.com/a b"), "http://example.com/a%20b");
  assert.equal(externalUrl("mailto:someone@example.com"), "mailto:someone@example.com");
  // Chat text comes from a model: nothing in it may start a local program.
  for (const url of [
    "file:///C:/Windows/System32/calc.exe",
    "C:\\Windows\\System32\\calc.exe",
    "ms-msdt:/id PCWDiagnostic",
    "vscode://file/c:/x",
    "javascript:alert(1)",
    "data:text/html,<script>1</script>",
    "",
    "relative/path",
  ]) {
    assert.equal(externalUrl(url), null, url);
  }
});

test("the page to reopen is the app's own, and never the login page or an API reply", () => {
  assert.equal(restorablePath(`${ORIGIN}/?session=abc#m1`, ORIGIN), "/?session=abc#m1");
  assert.equal(restorablePath(`${ORIGIN}/`, ORIGIN), "/");
  assert.equal(restorablePath(`${ORIGIN}/login?next=%2F`, ORIGIN), null);
  assert.equal(restorablePath(`${ORIGIN}/api/sessions/abc/export`, ORIGIN), null);
  assert.equal(restorablePath("https://example.com/?session=abc", ORIGIN), null);
  assert.equal(restorablePath("file:///C:/app/loading.html", ORIGIN), null);
});
