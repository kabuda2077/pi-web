import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { writePrivateFileAtomicSync } from "./atomic-file";
import { parseImportContextWindow } from "./model-import";
import { readRegularFileText } from "./regular-file";

// Where the models editor's import defaults are kept (lib/model-import.ts):
// a file of the desktop fork's own beside pi's models.json, so that models.json
// holds nothing pi's schema does not know.

const MAX_BYTES = 1024 * 1024;
const MAX_PROVIDERS = 1000;
const filePath = (agentDir: string) => join(agentDir, "pi-web-model-import.json");

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export class ImportDefaultsError extends Error {}

/** provider id → token count, from a request or the file. With `strict`, anything else throws; without, it is skipped. */
function contextWindows(value: unknown, strict: boolean): Record<string, number> {
  if (!isRecord(value)) {
    if (strict) throw new ImportDefaultsError("contextWindows must be an object of provider ids and token counts");
    return {};
  }
  const entries = Object.entries(value);
  if (strict && entries.length > MAX_PROVIDERS) throw new ImportDefaultsError("Too many providers");
  const result: Record<string, number> = {};
  for (const [providerId, raw] of entries) {
    const parsed = parseImportContextWindow(raw);
    if (parsed !== undefined) Object.defineProperty(result, providerId, { value: parsed, enumerable: true, configurable: true, writable: true });
    else if (strict) throw new ImportDefaultsError(`Context window of ${providerId} must be a positive whole number of tokens`);
  }
  return result;
}

/** No file, or one nobody can make sense of, reads as no defaults: the editor works without them. */
export function readImportContextWindows(agentDir = getAgentDir()): Record<string, number> {
  let text: string | undefined;
  try {
    text = readRegularFileText(filePath(agentDir), MAX_BYTES);
  } catch {
    return {};
  }
  if (text === undefined) return {};
  try {
    const parsed: unknown = JSON.parse(text);
    return contextWindows(isRecord(parsed) ? parsed.contextWindows : undefined, false);
  } catch {
    return {};
  }
}

/** Replaces the stored defaults with `value`, the whole set the editor saved. */
export function writeImportContextWindows(value: unknown, agentDir = getAgentDir()): Record<string, number> {
  const next = contextWindows(value, true);
  mkdirSync(agentDir, { recursive: true, mode: 0o700 });
  writePrivateFileAtomicSync(filePath(agentDir), `${JSON.stringify({ contextWindows: next }, null, 2)}\n`);
  return next;
}
