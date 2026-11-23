import type { Locale, LocalePlugin } from "./types";

/**
 * The desktop fork's own interface text. It is kept out of messages/*.ts, which
 * change with every pi-web release, and merged over them in registry.ts. Every
 * key here is the fork's own: none replaces a text of pi-web.
 */
const desktopMessages: Record<Locale, Record<string, string>> = {
  en: {
    // The turn navigator
    "turnNavigator.label": "Conversation turns",
    "turnNavigator.turn": "Turn {number}/{total}",
  },
  "zh-CN": {
    // The turn navigator
    "turnNavigator.label": "对话轮次",
    "turnNavigator.turn": "第 {number}/{total} 轮",
  },
  "zh-TW": {
    // The turn navigator
    "turnNavigator.label": "對話輪次",
    "turnNavigator.turn": "第 {number}/{total} 輪",
  },
};

/** A locale of pi-web with the fork's text added. */
export function withDesktopMessages(plugin: LocalePlugin): LocalePlugin {
  const own = Object.hasOwn(desktopMessages, plugin.id) ? desktopMessages[plugin.id as Locale] : undefined;
  return own ? { ...plugin, messages: { ...plugin.messages, ...own } } : plugin;
}
