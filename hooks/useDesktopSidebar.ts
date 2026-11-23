"use client";

import { createContext, useContext } from "react";

/**
 * What the desktop fork adds to pi-web's sidebar. The shell
 * (components/AppShell.tsx) hands it down in a context and not in props, so
 * that SessionSidebar's props and its signature stay pi-web's: a line both
 * sides edit is what a merge conflicts on. Outside a provider every part is
 * off and the sidebar is pi-web's own, which is what pi-web's tests render.
 */
export interface DesktopSidebar {
  /** The tasks page shows in the chat's place. */
  taskPageOpen: boolean;
  onOpenTasks?: () => void;
  /** The sessions waiting for an answer and those waiting for a subagent, for the tasks page to list. */
  onTaskStatusChange?: (awaiting: Set<string>, subagents: Set<string>) => void;
  /** A General chat's fresh composer shows. */
  tempChatDraft: boolean;
  /** The folders that are General chats. */
  tempChatCwds: string[];
  /** False until those folders are known: a project's New waits for it. */
  chatDirectoriesReady: boolean;
  /** Opens a General chat's composer: at once, or once its folder is reserved (a promise, rejected when none could be had). */
  onNewTempChat?: () => void | Promise<void>;
}

export const NO_DESKTOP_SIDEBAR: DesktopSidebar = {
  taskPageOpen: false,
  tempChatDraft: false,
  tempChatCwds: [],
  chatDirectoriesReady: true,
};

export const DesktopSidebarContext = createContext<DesktopSidebar>(NO_DESKTOP_SIDEBAR);

export function useDesktopSidebar(): DesktopSidebar {
  return useContext(DesktopSidebarContext);
}
