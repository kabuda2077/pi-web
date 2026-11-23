/**
 * The desktop fork's sidebar sections: General (chats that belong to no
 * project, each in a folder of its own) above Projects. The session tree has
 * them when buildSessionTree() is given `chats`. Without it the tree is
 * pi-web's own, its "Open another project…" footer included, which is what
 * pi-web's tests build.
 */
import type { SessionFamily } from "./session-family";
import type { SidebarLayout, SidebarProject, SidebarRow } from "./session-tree";
import { isTempChatCwd } from "./temp-chat-path";
import { workspaceKeyOf } from "./workspace-memory";

/** The General section: its chats' folders, its fold, whether a draft is open, its name. */
export interface ChatsSection { cwds: readonly string[]; collapsed: boolean; draft: boolean; label: string }

export type SectionRow =
  | { kind: "chats-header"; key: "chats-header"; collapsed: boolean }
  | { kind: "chat-draft"; key: "chat-draft" }
  | { kind: "chats-more"; key: "chats-more"; hidden: number; canShowLess: boolean; nextShown: number }
  | { kind: "projects-header"; key: "projects-header"; collapsed: boolean }
  /** A gap of its own height: the three entries sit closer than pi-web's 8px. */
  | { kind: "spacer"; key: "top-spacer" | "chats-spacer"; height: number };

export type SectionRowKind = Exclude<SectionRow["kind"], "spacer">;

/** A section header is 30px, as the Tasks entry above the tree; its rows follow pi-web's rhythm. */
export const SECTION_ROW_HEIGHTS: Record<SidebarLayout, Record<SectionRowKind, number>> = {
  desktop: { "chats-header": 30, "projects-header": 30, "chat-draft": 28, "chats-more": 26 },
  mobile: { "chats-header": 44, "projects-header": 44, "chat-draft": 44, "chats-more": 36 },
};

/** `moreShown` entry for the General section's "show more". */
export const CHATS_MORE_KEY = "chats";
// Project keys identify filesystem paths. This section never goes in projectOrder.
export const CHATS_SECTION_KEY = "sidebar:chats";

/** Where a family is listed and counted: the General section, else its project. */
export function sidebarSectionKey(family: SessionFamily, chats: ChatsSection | undefined): string {
  return chats && isTempChatCwd(family.root.cwd, chats.cwds) ? CHATS_SECTION_KEY : workspaceKeyOf(family.root);
}

/** The General section where a row or an archive header names a project. */
export function chatSection(label: string): SidebarProject {
  return { key: CHATS_SECTION_KEY, name: label, root: "", current: false, pinned: false, customName: null };
}

/** The height of a row of the sections; undefined for a row of pi-web's own. */
export function sectionRowHeight(row: SidebarRow, layout: SidebarLayout): number | undefined {
  if (row.kind === "spacer") return "height" in row ? row.height : undefined;
  const heights: Partial<Record<SidebarRow["kind"], number>> = SECTION_ROW_HEIGHTS[layout];
  return heights[row.kind];
}

/** A section header that stands for rows: the tree's "no sessions" note stays away. */
export function isSectionContent(row: SidebarRow): boolean {
  return row.kind === "chats-header" || (row.kind === "projects-header" && row.collapsed);
}
