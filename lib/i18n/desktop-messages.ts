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
    // The tasks page
    "tasks.title": "Tasks",
    "tasks.scope": "Waiting, running and recently updated sessions across projects and general chats.",
    "tasks.updated": "Updated {time}",
    "tasks.waiting": "Needs your attention",
    "tasks.running": "Running",
    "tasks.recent": "Recent",
    "tasks.conversation": "Chat",
    "tasks.untitled": "Untitled task",
    "tasks.subagent": "Subagent: {status}",
    "tasks.loading": "Loading tasks…",
    "tasks.error": "Could not load tasks.",
    "tasks.empty": "No tasks yet.",
    "sidebar.tasks": "Tasks",
    // General chats
    "settings.tempChatFolder": "General chat folder",
    "settings.tempChatFolderNote": "Each new chat gets its own folder here. Existing chats stay where they are.",
    "settings.chooseChatFolder": "Choose folder",
    "sidebar.chats": "General",
    "sidebar.newTempChat": "New chat",
    // The sidebar's sections and new projects
    "sidebar.newConversation": "New conversation",
    "newProject.title": "New project",
    "newProject.name": "Project name",
    "newProject.parent": "Parent folder",
    "newProject.chooseParent": "Choose parent folder",
    "newProject.create": "Create project",
    "newProject.retryOpen": "Retry opening",
    "newProject.exists": "A file or folder with that name already exists. Choose another name.",
    "newProject.invalidName": "Enter a single valid folder name.",
    "newProject.createFailed": "Could not create the folder. Check the location and write permissions.",
    "newProject.openFailed": "Created {path}, but could not open it as a project.",
    "sidebar.projects": "Projects",
    "sidebar.newProject": "New project",
    // General settings in two columns
    "settings.workspaceGroup": "Workspace",
    "settings.toolsNotifications": "Tools and notifications",
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
    // The tasks page
    "tasks.title": "任务",
    "tasks.scope": "所有项目和通用对话中，等你处理、正在运行和最近更新的会话。",
    "tasks.updated": "{time}更新",
    "tasks.waiting": "等你处理",
    "tasks.running": "运行中",
    "tasks.recent": "最近",
    "tasks.conversation": "对话",
    "tasks.untitled": "未命名任务",
    "tasks.subagent": "子代理：{status}",
    "tasks.loading": "正在加载任务…",
    "tasks.error": "无法加载任务。",
    "tasks.empty": "暂无任务。",
    "sidebar.tasks": "任务",
    // General chats
    "settings.tempChatFolder": "通用对话文件夹",
    "settings.tempChatFolderNote": "每个新建的通用对话都会在这里创建独立文件夹。已有对话的位置不变。",
    "settings.chooseChatFolder": "选择文件夹",
    "sidebar.chats": "通用",
    "sidebar.newTempChat": "新建通用对话",
    // The sidebar's sections and new projects
    "sidebar.newConversation": "新对话",
    "newProject.title": "新建项目",
    "newProject.name": "项目名称",
    "newProject.parent": "上级文件夹",
    "newProject.chooseParent": "选择上级文件夹",
    "newProject.create": "创建项目",
    "newProject.retryOpen": "重新打开",
    "newProject.exists": "已有同名文件或文件夹，请换一个名称。",
    "newProject.invalidName": "请输入有效的文件夹名称，不要包含路径。",
    "newProject.createFailed": "无法创建文件夹，请检查保存位置和写入权限。",
    "newProject.openFailed": "已创建 {path}，但未能打开该项目。",
    "sidebar.projects": "项目",
    "sidebar.newProject": "新建项目",
    // General settings in two columns
    "settings.workspaceGroup": "工作区",
    "settings.toolsNotifications": "工具与通知",
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
    // The tasks page
    "tasks.title": "任務",
    "tasks.scope": "所有專案和通用對話中，等你處理、執行中和最近更新的工作階段。",
    "tasks.updated": "{time}更新",
    "tasks.waiting": "等你處理",
    "tasks.running": "執行中",
    "tasks.recent": "最近",
    "tasks.conversation": "對話",
    "tasks.untitled": "未命名任務",
    "tasks.subagent": "子代理：{status}",
    "tasks.loading": "正在載入任務…",
    "tasks.error": "無法載入任務。",
    "tasks.empty": "暫無任務。",
    "sidebar.tasks": "任務",
    // General chats
    "settings.tempChatFolder": "通用對話資料夾",
    "settings.tempChatFolderNote": "每個新的通用對話都會在這裡建立獨立資料夾。現有對話的位置不變。",
    "settings.chooseChatFolder": "選擇資料夾",
    "sidebar.chats": "通用",
    "sidebar.newTempChat": "新增通用對話",
    // The sidebar's sections and new projects
    "sidebar.newConversation": "新對話",
    "newProject.title": "新增專案",
    "newProject.name": "專案名稱",
    "newProject.parent": "上層資料夾",
    "newProject.chooseParent": "選擇上層資料夾",
    "newProject.create": "建立專案",
    "newProject.retryOpen": "重新開啟",
    "newProject.exists": "已有同名檔案或資料夾，請換個名稱。",
    "newProject.invalidName": "請輸入有效的資料夾名稱，不要包含路徑。",
    "newProject.createFailed": "無法建立資料夾，請檢查儲存位置和寫入權限。",
    "newProject.openFailed": "已建立 {path}，但無法開啟這個專案。",
    "sidebar.projects": "專案",
    "sidebar.newProject": "新增專案",
    // General settings in two columns
    "settings.workspaceGroup": "工作區",
    "settings.toolsNotifications": "工具與通知",
  },
};

/** A locale of pi-web with the fork's text added. */
export function withDesktopMessages(plugin: LocalePlugin): LocalePlugin {
  const own = Object.hasOwn(desktopMessages, plugin.id) ? desktopMessages[plugin.id as Locale] : undefined;
  return own ? { ...plugin, messages: { ...plugin.messages, ...own } } : plugin;
}
