import type { CSSProperties, ReactNode } from "react";
import { useDesktopSidebar } from "@/hooks/useDesktopSidebar";
import { useI18n } from "@/hooks/useI18n";
import { ArchiveIcon } from "./SidebarIcons";

export function SidebarArchiveEntry({ rowKey, count, style, onOpen, children }: {
  rowKey: string;
  count: number;
  style: CSSProperties;
  onOpen: () => void;
  children: ReactNode;
}) {
  const { t } = useI18n();
  const { onOpenTasks } = useDesktopSidebar();
  if (!onOpenTasks) return children;

  return (
    <div className="session-tree-row session-tree-footer sidebar-archive-entry" style={style} data-row-key={rowKey}>
      <button type="button" className="session-tree-footer-button" onClick={onOpen}>
        <ArchiveIcon size={14} />
        <span className="session-tree-footer-label">{t("sidebar.archive")}</span>
        <span className="sidebar-archive-entry-count">{count}</span>
      </button>
    </div>
  );
}

export function SidebarArchiveBackIcon() {
  return (
    <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 12H5m6-6-6 6 6 6" />
    </svg>
  );
}
