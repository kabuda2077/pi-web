import { randomUUID } from "node:crypto";
import { accessSync, constants, mkdirSync, opendirSync, realpathSync, rmdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import lockfile from "proper-lockfile";
import { writePrivateFileAtomicSync } from "./atomic-file";
import { serializeByKey } from "./key-serializer";
import { readRegularFileText } from "./regular-file";
import { tempChatPathKey } from "./temp-chat-path";

interface TempChats {
  root: string;
  cwds: string[];
}

type StoredTempChats = TempChats & { customRoot: boolean };

const queue = Symbol.for("pi-web:temp-chats-write-queue");
const maxBytes = 4 * 1024 * 1024;
const statePath = (agentDir: string) => join(agentDir, "pi-web-temp-chats.json");
const defaultRoot = (agentDir: string) => process.env.PI_CODING_AGENT_DIR
  ? resolve(agentDir, "pi-web-chats")
  : join(homedir(), "Chats");

function absolutePath(value: unknown): value is string {
  return typeof value === "string" && !value.includes("\0") && isAbsolute(value);
}

function readStoredTempChats(agentDir: string): StoredTempChats {
  const fallback = defaultRoot(agentDir);
  const text = readRegularFileText(statePath(agentDir), maxBytes);
  if (text === undefined) return { root: fallback, cwds: [], customRoot: false };
  let state;
  try { state = JSON.parse(text); } catch { /* Never quote persisted file contents in an API error. */ }
  if (!absolutePath(state?.root) || !Array.isArray(state.cwds) || !state.cwds.every(absolutePath)
    || (state.customRoot !== undefined && typeof state.customRoot !== "boolean")) {
    throw new Error("Invalid temporary chat settings; the file has not been changed");
  }
  // Old registries stored the literal default path with no provenance. Match
  // only what that version wrote, never a basename, symlink or cwd prefix.
  if (state.customRoot === undefined) {
    const oldDefault = process.env.PI_CODING_AGENT_DIR ? fallback : join(homedir(), "Pi Chats");
    if (state.root === oldDefault) return { root: fallback, cwds: state.cwds, customRoot: false };
  }
  return { root: state.root, cwds: state.cwds, customRoot: state.customRoot ?? true };
}

export function readTempChats(agentDir = getAgentDir()): TempChats {
  const { root, cwds } = readStoredTempChats(agentDir);
  return { root, cwds };
}

function change<T>(agentDir: string, operation: (state: StoredTempChats, save: () => void) => T): Promise<T> {
  const path = statePath(agentDir);
  return serializeByKey(queue, path, async () => {
    mkdirSync(agentDir, { recursive: true, mode: 0o700 });
    const release = await lockfile.lock(path, {
      realpath: false,
      retries: { retries: 10, minTimeout: 25, maxTimeout: 500 },
      onCompromised: (error) => console.warn(`[pi-web] temporary chat settings lock: ${error.message}`),
    });
    try {
      const state = readStoredTempChats(agentDir);
      return operation(state, () => {
        const text = JSON.stringify(state, null, 2) + "\n";
        if (Buffer.byteLength(text) > maxBytes) throw new Error("Temporary chat settings are full");
        writePrivateFileAtomicSync(path, text);
      });
    } finally {
      await release();
    }
  });
}

export class TempChatRootError extends Error {}

export function setTempChatRoot(root: unknown, agentDir = getAgentDir()) {
  if (!absolutePath(root)) throw new TempChatRootError("Select an absolute directory path");
  let canonical: string;
  try {
    canonical = realpathSync.native(root);
    if (!statSync(canonical).isDirectory()) throw new Error();
    accessSync(canonical, constants.R_OK | constants.W_OK | constants.X_OK);
  } catch {
    throw new TempChatRootError("Select an existing, writable directory");
  }
  return change(agentDir, (state, save) => {
    if (state.root !== canonical || !state.customRoot) {
      state.root = canonical;
      state.customRoot = true;
      save();
    }
    return { root: state.root };
  });
}

// Who holds which folder for a General chat that has not started yet: holder →
// folder. A holder is a window or a tab (hooks/useTempChatDirectories.ts), and
// asking again as the same holder answers the same folder, so a page that
// takes the place of one that went away without a word (a reload, a crash, a
// window the desktop shell gave back) gets its folder and no other is made.
// In memory: after a restart every folder no chat used is free again. On
// globalThis, as route handlers are bundled apart.
const held = Symbol.for("pi-web:temp-chats-held");
// A tab that closed without a word keeps its folder from the others: beyond this
// many holders, the one that asked longest ago loses it. No more than this many
// folders ever wait unused.
const MAX_HOLDERS = 20;
function holders(): Map<string, string> {
  const store = globalThis as { [held]?: Map<string, string> };
  return store[held] ??= new Map();
}

function isEmptyDirectory(path: string): boolean {
  try {
    const dir = opendirSync(path);
    try { return dir.readSync() === null; } finally { dir.closeSync(); }
  } catch {
    return false;
  }
}

/**
 * The folder for the General chat `holder` starts next: the one it holds
 * already, else a folder of the current root that is empty, that no session
 * has (`isUsed`) and that nobody else holds, else a new one. A folder no chat
 * was started in is taken again, so opening the app, or a chat, and leaving it
 * does not leave folders behind. Without a holder the folder is held under a
 * name of its own, until the server restarts.
 */
export function reserveTempChat(isUsed: (cwd: string) => boolean, holder?: string, agentDir = getAgentDir()) {
  return change(agentDir, (state, save) => {
    // Only our own default is created lazily. A missing user-selected root
    // (e.g. a disconnected drive) must not silently be recreated elsewhere.
    if (!state.customRoot && state.root === defaultRoot(agentDir)) mkdirSync(state.root, { recursive: true, mode: 0o700 });
    const root = realpathSync.native(state.root);
    const rootKey = tempChatPathKey(root);
    const holds = holders();
    const name = holder || `anonymous:${randomUUID()}`;
    const mine = holds.get(name);
    holds.delete(name);
    const others = new Set(holds.values());
    const free = (cwd: string) => tempChatPathKey(dirname(cwd)) === rootKey && !isUsed(cwd) && isEmptyDirectory(cwd);
    let cwd = state.cwds.find((dir) => tempChatPathKey(dir) === mine && free(dir))
      ?? state.cwds.find((dir) => !others.has(tempChatPathKey(dir)) && free(dir));
    if (!cwd) {
      cwd = join(root, `chat-${randomUUID()}`);
      mkdirSync(cwd, { mode: 0o700 });
      try {
        state.cwds.push(cwd);
        save();
      } catch (error) {
        // Never recursively delete anything another process placed in the folder.
        try { rmdirSync(cwd); } catch { /* Preserve the original save error. */ }
        throw error;
      }
    }
    // The holders asked longest ago go first: tabs that were closed without a word.
    while (holds.size >= MAX_HOLDERS) holds.delete(holds.keys().next().value as string);
    holds.set(name, tempChatPathKey(cwd));
    return { cwd };
  });
}

/** A holder that goes away gives its folder back; `cwd` names the folder of a holder without a name. */
export function releaseTempChat({ holder, cwd }: { holder?: string | null; cwd?: string | null }): void {
  const holds = holders();
  if (holder) holds.delete(holder);
  if (!cwd) return;
  const key = tempChatPathKey(cwd);
  for (const [name, folder] of holds) if (folder === key) holds.delete(name);
}
