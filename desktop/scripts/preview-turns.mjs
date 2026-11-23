// An isolated, read-only sample conversation for the browser preview. No model calls.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { repoDir } from "./paths.mjs";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-turn-preview-"));
const cwd = path.join(root, "导航预览");
fs.mkdirSync(cwd);
fs.writeFileSync(path.join(cwd, "notes.md"), "# 对话导航\n\n仅供预览使用。\n");
process.env.PI_CODING_AGENT_DIR = path.join(root, "agent");
const dir = path.join(process.env.PI_CODING_AGENT_DIR, "sessions", `--${cwd.split(path.sep).join("-").replaceAll(":", "-")}--`);
fs.mkdirSync(dir, { recursive: true });
const id = "0199c0de-0000-7000-8000-000000000032";
const stamp = new Date().toISOString();
const rows = [{ type: "session", version: 3, id, cwd, timestamp: stamp }];
const topics = ["正文宽度", "输入框对齐", "文件预览", "历史分页", "深色主题", "键盘跳转", "悬停卡片", "当前轮次"];
const phases = ["准备检查", "确认设计", "复核细节", "记录结果"];
const answers = ["正文保持在中央，两侧留白随窗口宽度变化。", "输入框和消息列使用相同的左右边距。", "打开右侧文件面板后，聊天区会重新测量剩余空间。", "加载更早的消息，只增加前面的刻度，不改变已有轮次的编号。", "卡片沿用会话配色，正文与次要文字保持原来的层次。", "用上下方向键切换相邻轮次，也可以直接回到第一轮。", "移动到刻度上即可看到问题和回答摘要，正文停留在原处。", "每条刻度对应一轮对话，点击后直接定位到当时的问题。"];
const usage = { input: 1, output: 1, totalTokens: 2, cacheRead: 0, cacheWrite: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
let parentId = null;
for (let i = 0; i < 32; i++) {
  const n = i % topics.length;
  for (const [role, text] of [["user", `${phases[i >> 3]}：${topics[n]}`], ["assistant", `${answers[n]}\n\n见[设计笔记](notes.md)。`]]) {
    const eid = rows.length.toString(16).padStart(8, "0");
    rows.push({ type: "message", id: eid, parentId, timestamp: stamp, message: { role, content: [{ type: "text", text }], timestamp: Date.parse(stamp), ...(role === "assistant" ? { model: "preview", provider: "preview", api: "openai-responses", usage, stopReason: "stop" } : {}) } });
    parentId = eid;
  }
}
fs.writeFileSync(path.join(dir, `${stamp.replace(/[:.]/g, "-")}_${id}.jsonl`), rows.map(r => JSON.stringify(r)).join("\n") + "\n");
process.chdir(repoDir);
process.argv = [process.execPath, "next", "start", "--hostname", "127.0.0.1", "--port", "30242"];
await import(pathToFileURL(path.join(repoDir, "node_modules/next/dist/bin/next")).href);
