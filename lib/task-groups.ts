import type { SessionInfo } from "./types";

export interface TaskActivity {
  runningSessionIds: ReadonlySet<string>;
  awaitingInputSessionIds: ReadonlySet<string>;
  subagentsActiveSessionIds?: ReadonlySet<string>;
}

export type TaskGroup = "waiting" | "running" | "recent";

/** Classify from the same live ID sets as the sidebar badge, not the catalog's older metadata. */
export function categorizeTasks(sessions: readonly SessionInfo[], activity: TaskActivity): Record<TaskGroup, SessionInfo[]> {
  const groups: Record<TaskGroup, SessionInfo[]> = { waiting: [], running: [], recent: [] };
  const sorted = sessions.map(session => ({ session, time: Date.parse(session.modified) || Date.parse(session.created) || 0 }))
    .sort((a, b) => b.time - a.time || a.session.id.localeCompare(b.session.id));
  const seen = new Set<string>();
  for (const { session } of sorted) {
    if (seen.has(session.id)) continue;
    seen.add(session.id);
    if (activity.awaitingInputSessionIds.has(session.id)) groups.waiting.push(session);
    else if (activity.runningSessionIds.has(session.id) || activity.subagentsActiveSessionIds?.has(session.id)) groups.running.push(session);
    else if (groups.recent.length < 20) groups.recent.push(session);
  }
  return groups;
}
