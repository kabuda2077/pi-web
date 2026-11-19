import fs from "node:fs";
import path from "node:path";

const MAX_BYTES = 5 * 1024 * 1024;

/** Appends timestamped lines to a file, keeping one previous file once it passes MAX_BYTES. */
export function createLog(file) {
  let size = 0;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    size = fs.statSync(file, { throwIfNoEntry: false })?.size ?? 0;
  } catch {
    // Handled per write below.
  }

  return function write(line) {
    const text = `${new Date().toISOString()} ${line}\n`;
    try {
      if (size > MAX_BYTES) {
        fs.renameSync(file, `${file}.1`);
        size = 0;
      }
      fs.appendFileSync(file, text);
      size += Buffer.byteLength(text);
    } catch {
      // A log that cannot be written must not take the app down.
    }
  };
}
