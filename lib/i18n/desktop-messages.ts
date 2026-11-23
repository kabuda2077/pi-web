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
    // The main window's caption buttons
    "window.minimize": "Minimize window",
    "window.maximize": "Maximize window",
    "window.restore": "Restore window",
    "window.close": "Close window",
    // Importing models
    "models.importContext": "Default context window (tokens)",
    "models.importContextPlaceholder": "Use each model’s own limit",
    "models.importContextInvalid": "Enter a positive whole number of tokens.",
    "models.applyImportContext": "Apply to all",
    "models.importContextApplied": "Applied",
    "models.importSummary": "Added {total} · Catalog matches: {matched} · Not matched: {missing}",
    "models.importQueryFailed": "Catalog lookup failed for {count}; models still added.",
  },
  "zh-CN": {
    // The turn navigator
    "turnNavigator.label": "对话轮次",
    "turnNavigator.turn": "第 {number}/{total} 轮",
    // The main window's caption buttons
    "window.minimize": "最小化窗口",
    "window.maximize": "最大化窗口",
    "window.restore": "还原窗口",
    "window.close": "关闭窗口",
    // Importing models
    "models.importContext": "默认上下文窗口（tokens）",
    "models.importContextPlaceholder": "留空则使用模型自身规格",
    "models.importContextInvalid": "请输入大于 0 的整数。",
    "models.applyImportContext": "批量应用",
    "models.importContextApplied": "已应用",
    "models.importSummary": "已添加 {total} 个模型，匹配 {matched} 个，未匹配 {missing} 个",
    "models.importQueryFailed": "另有 {count} 个查询失败，已正常添加。",
  },
  "zh-TW": {
    // The turn navigator
    "turnNavigator.label": "對話輪次",
    "turnNavigator.turn": "第 {number}/{total} 輪",
    // The main window's caption buttons
    "window.minimize": "最小化視窗",
    "window.maximize": "最大化視窗",
    "window.restore": "還原視窗",
    "window.close": "關閉視窗",
    // Importing models
    "models.importContext": "預設上下文視窗（tokens）",
    "models.importContextPlaceholder": "留空則使用模型自身規格",
    "models.importContextInvalid": "請輸入大於 0 的整數。",
    "models.applyImportContext": "批次套用",
    "models.importContextApplied": "已套用",
    "models.importSummary": "已新增 {total} 個模型，符合 {matched} 個，未符合 {missing} 個",
    "models.importQueryFailed": "另有 {count} 個查詢失敗，已正常新增。",
  },
};

/** A locale of pi-web with the fork's text added. */
export function withDesktopMessages(plugin: LocalePlugin): LocalePlugin {
  const own = Object.hasOwn(desktopMessages, plugin.id) ? desktopMessages[plugin.id as Locale] : undefined;
  return own ? { ...plugin, messages: { ...plugin.messages, ...own } } : plugin;
}
