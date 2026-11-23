"use client";

import { useEffect, useMemo } from "react";
import { useI18n } from "@/hooks/useI18n";
import { suspendGlobalAbort } from "@/hooks/useKeyboardShortcuts";
import { formatRelativeTime } from "@/lib/i18n/format";
import { projectNameOf } from "@/lib/session-tree";
import { categorizeTasks, type TaskActivity } from "@/lib/task-groups";
import { isTempChatCwd } from "@/lib/temp-chat-path";
import type { SessionInfo } from "@/lib/types";
import { workspaceKeyOf } from "@/lib/workspace-memory";
import styles from "./TasksPage.module.css";

export interface TasksPageProps extends TaskActivity {
  sessions: readonly SessionInfo[];
  tempChatCwds?: readonly string[];
  projectNames?: Readonly<Record<string, string>>;
  loading?: boolean;
  error?: string | null;
  onOpenSession: (id: string) => void;
}

export function TasksPage({ sessions, runningSessionIds, awaitingInputSessionIds, subagentsActiveSessionIds,
  tempChatCwds = [], projectNames, loading, error, onOpenSession }: TasksPageProps) {
  const { t, locale } = useI18n();
  // The chat under this page stays mounted: Esc here must not stop its run.
  useEffect(() => {
    suspendGlobalAbort(true);
    return () => suspendGlobalAbort(false);
  }, []);
  const groups = useMemo(() => categorizeTasks(sessions, { runningSessionIds, awaitingInputSessionIds, subagentsActiveSessionIds }),
    [sessions, runningSessionIds, awaitingInputSessionIds, subagentsActiveSessionIds]);

  return (
    <section className={styles.page} aria-label={t("tasks.title")}>
      <div className={styles.content}>
        <h1 className={styles.heading}>{t("tasks.title")}</h1>
        <p className={styles.scope}>{t("tasks.scope")}</p>
        {error && <p role="alert" className={styles.notice}>{t("tasks.error")} {error}</p>}
        {!sessions.length && !error && <p role="status" className={styles.notice}>{t(loading ? "tasks.loading" : "tasks.empty")}</p>}
        {(["waiting", "running", "recent"] as const).map(group => groups[group].length > 0 && (
          <section className={styles.group} data-group={group} key={group}>
            <h2 className={styles.groupHeading}>{t(`tasks.${group}`)} <span className={styles.count}>{groups[group].length}</span></h2>
            <ul className={styles.list}>
              {groups[group].map(session => {
                const relation = session.relation?.kind === "subagent" ? session.relation : undefined;
                const title = relation?.description.trim() || session.name?.trim() || session.firstMessage.trim() || t("tasks.untitled");
                const key = workspaceKeyOf(session);
                const project = isTempChatCwd(session.cwd, tempChatCwds) ? t("sidebar.chats")
                  : (projectNames && Object.hasOwn(projectNames, key) && projectNames[key]) || projectNameOf(session.projectRoot || session.cwd) || t("tasks.conversation");
                const status = runningSessionIds.has(session.id) ? "running" : relation?.status;
                const date = Number.isFinite(Date.parse(session.modified)) ? formatRelativeTime(session.modified, locale) : "";
                const detail = relation ? t("tasks.subagent", { status: t(`agentSwitcher.status.${status}`) })
                  : group === "recent" ? "" : t(`tasks.${group}`);
                return (
                  <li key={session.id}>
                    <button type="button" className={styles.row} onClick={() => onOpenSession(session.id)}>
                      <span className={styles.indicator} aria-hidden="true" />
                      <span className={styles.summary}>
                        <span className={styles.title} title={title}>{title}</span>
                        <span className={styles.meta}>
                          {detail}{detail && date && " · "}
                          {date && <time dateTime={session.modified} title={session.modified}>{group === "recent" ? date : t("tasks.updated", { time: date })}</time>}
                        </span>
                      </span>
                      <span className={styles.project} title={project}>{project}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </section>
  );
}
