"use client";

import type { CSSProperties } from "react";
import { useI18n } from "@/hooks/useI18n";
import type { SectionRow } from "@/lib/sidebar-sections";
import { FolderIcon, MessageIcon, PlusIcon } from "./SidebarIcons";

/** What the sections' rows ask of the sidebar; the session tree hands its own handlers on. */
export interface SectionRowHandlers {
  onToggleChats?(): void;
  onNewChat?(): void;
  onToggleProjects?(): void;
  onNewProject?(): void;
}

type Row = Extract<SectionRow, { kind: "chats-header" | "projects-header" | "chat-draft" }>;

/**
 * The session tree's rows of the General and Projects sections: a header (its
 * fold, and a + that shows on hover or focus), and the General chat that has
 * no session yet. Handlers are read when used, as the tree's other rows do.
 */
export function SidebarSectionRow({ row, style, handlers }: { row: Row; style: CSSProperties; handlers: { readonly current: SectionRowHandlers } }) {
  const { t } = useI18n();
  if (row.kind === "chat-draft") {
    return (
      <div className="session-tree-row session-tree-session is-selected session-tree-chat-draft" style={style} data-row-key={row.key} aria-current="true">
        <span className="session-tree-title">{t("sidebar.newTempChat")}</span>
      </div>
    );
  }
  const isChat = row.kind === "chats-header";
  const Icon = isChat ? MessageIcon : FolderIcon;
  const addLabel = t(isChat ? "sidebar.newTempChat" : "sidebar.newProject");
  return (
    <div className="session-tree-row sidebar-section-entry" style={style} data-row-key={row.key}>
      <button type="button" className="sidebar-section-toggle" aria-expanded={!row.collapsed} onClick={() => isChat ? handlers.current.onToggleChats?.() : handlers.current.onToggleProjects?.()}>
        <Icon size={isChat ? 14 : 16} className={isChat ? undefined : "sidebar-projects-icon"} />
        <span>{t(isChat ? "sidebar.chats" : "sidebar.projects")}</span>
      </button>
      {(isChat ? handlers.current.onNewChat : handlers.current.onNewProject) && (
        <button type="button" className="sidebar-section-add" title={addLabel} aria-label={addLabel} onClick={() => isChat ? handlers.current.onNewChat?.() : handlers.current.onNewProject?.()}>
          <PlusIcon size={14} />
        </button>
      )}
    </div>
  );
}
