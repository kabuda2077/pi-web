const zh = {
  starting: "正在启动…",
  restarting: "服务已停止，正在重新启动…",
  failedTitle: "服务没有启动成功",
  failedHint: "可以重试，或者打开日志看看原因。",
  retry: "重试",
  openLogs: "打开日志",
  quit: "退出",

  trayShow: "打开 {name}",
  trayRestart: "重启后台服务",
  trayLogs: "打开日志文件夹",
  trayHintTitle: "{name} 仍在后台运行",
  trayHintBody: "正在进行的任务不会中断。要完全退出，请右键托盘图标。",

  interruptMessage: "还有任务正在运行",
  interruptDetailQuit: "现在退出会中断这些任务。",
  interruptDetailRestart: "现在重启服务会中断这些任务。",
  quitAnyway: "仍然退出",
  restartAnyway: "仍然重启",
  cancel: "取消",

  menuOpenLink: "在浏览器中打开链接",
  menuCopyLink: "复制链接地址",
  menuCopyImage: "复制图片",
  menuSaveImage: "图片另存为…",
  menuCut: "剪切",
  menuCopy: "复制",
  menuPaste: "粘贴",
  menuSelectAll: "全选",
  menuInspect: "检查元素",
  menuOpenFile: "打开",
  menuRevealFile: "在资源管理器中显示",
  menuCopyPath: "复制路径",
};

const en = {
  starting: "Starting…",
  restarting: "The server stopped. Restarting…",
  failedTitle: "The server did not start",
  failedHint: "Try again, or open the logs to see why.",
  retry: "Retry",
  openLogs: "Open logs",
  quit: "Quit",

  trayShow: "Open {name}",
  trayRestart: "Restart the server",
  trayLogs: "Open log folder",
  trayHintTitle: "{name} is still running",
  trayHintBody: "Running tasks continue. To quit, right-click the tray icon.",

  interruptMessage: "Tasks are still running",
  interruptDetailQuit: "Quitting now stops them.",
  interruptDetailRestart: "Restarting the server now stops them.",
  quitAnyway: "Quit anyway",
  restartAnyway: "Restart anyway",
  cancel: "Cancel",

  menuOpenLink: "Open link in browser",
  menuCopyLink: "Copy link address",
  menuCopyImage: "Copy image",
  menuSaveImage: "Save image as…",
  menuCut: "Cut",
  menuCopy: "Copy",
  menuPaste: "Paste",
  menuSelectAll: "Select all",
  menuInspect: "Inspect",
  menuOpenFile: "Open",
  menuRevealFile: "Show in Explorer",
  menuCopyPath: "Copy path",
};

/** The shell's own text for a locale, with `{name}` filled in. */
export function stringsFor(locale, name) {
  const table = locale.toLowerCase().startsWith("zh") ? zh : en;
  return Object.fromEntries(Object.entries(table).map(([key, text]) => [key, text.replaceAll("{name}", name)]));
}
