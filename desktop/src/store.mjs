import fs from "node:fs";
import path from "node:path";

const SAVE_DELAY_MS = 400;

/** A small JSON file for what the shell remembers between launches. */
export function createStore(file) {
  let data = {};
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) data = parsed;
  } catch {
    // Missing or unreadable: start empty.
  }

  let timer = null;

  function flush() {
    if (timer) clearTimeout(timer);
    timer = null;
    const temp = `${file}.${process.pid}.tmp`;
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      // Temp file and rename, so a crash mid-write leaves the old file whole.
      fs.writeFileSync(temp, JSON.stringify(data, null, 2));
      fs.renameSync(temp, file);
    } catch {
      fs.rmSync(temp, { force: true });
    }
  }

  return {
    get(key) {
      return data[key];
    },
    set(key, value) {
      data[key] = value;
      if (!timer) timer = setTimeout(flush, SAVE_DELAY_MS);
    },
    flush,
  };
}
