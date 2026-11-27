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
  /** A gap after the General section, and one between the Projects header and what it lists. */
  | { kind: "spacer"; key: "chats-spacer" | "projects-spacer" };

export type SectionRowKind = Exclude<SectionRow["kind"], "spacer">;

/** A section header is a row of a project's height, as the Tasks entry above the tree is. */
export const SECTION_ROW_HEIGHTS: Record<SidebarLayout, Record<SectionRowKind, number>> = {
  desktop: { "chats-header": 28, "projects-header": 28, "chat-draft": 28, "chats-more": 26 },
  mobile: { "chats-header": 44, "projects-header": 44, "chat-draft": 44, "chats-more": 36 },
};

/**
 * The gaps of a tree that has the sections, where pi-web has 8px everywhere.
 * Tasks, General and Projects are entries of one kind: SECTION_GAP parts
 * them, and the Tasks entry has the same above it (app/desktop.css). The
 * projects are what Projects lists: PROJECT_GAP, a step closer, below its
 * header and between two of them, so the list reads as the header's.
 */
export const SECTION_GAP = 6;
export const PROJECT_GAP = 4;
/** The spacers between the entries, and the one that parts the projects from the footer. */
const SECTION_SPACERS: ReadonlySet<string> = new Set(["top-spacer", "chats-spacer", "footer-spacer"]);

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

/** The tree has the sections when General's header opens it, right below pi-web's top spacer. */
function hasSections(rows: readonly SidebarRow[]): boolean {
  return rows[1]?.kind === "chats-header";
}

/** The height of rows[index] where the sections decide it; undefined for a row that keeps pi-web's. */
export function sectionRowHeight(rows: readonly SidebarRow[], index: number, layout: SidebarLayout): number | undefined {
  const row = rows[index];
  if (row.kind === "spacer") return hasSections(rows) ? (SECTION_SPACERS.has(row.key) ? SECTION_GAP : PROJECT_GAP) : undefined;
  // Leave a section gap above the archive button (app/desktop.css).
  if (row.kind === "footer-archived" && hasSections(rows)) return SECTION_ROW_HEIGHTS[layout]["projects-header"] + SECTION_GAP;
  const heights: Partial<Record<SidebarRow["kind"], number>> = SECTION_ROW_HEIGHTS[layout];
  return heights[row.kind];
}

/** A section header that stands for rows: the tree's "no sessions" note stays away. */
export function isSectionContent(row: SidebarRow): boolean {
  return row.kind === "chats-header" || (row.kind === "projects-header" && row.collapsed);
}
