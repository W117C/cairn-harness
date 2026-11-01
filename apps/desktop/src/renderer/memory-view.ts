// 记忆页展示纯函数（2026-10-16 记忆页重做 · 业主要求 F/E；同日补通道加 bodyLines）：
//   relativeTime  ISO 时间戳 → 相对时间（列表与抽屉元信息用；悬停的完整时间走 fullTime）
//   fullTime      悬停 title 的完整时间（本地时区，YYYY-MM-DD HH:mm；解析不了原样返回，不装懂）
//   indexLines    MEMORY.md 索引切行（去空行、剥行首「- 」——标记渲染交 markdown.tsx 的 renderInline）
//   bodyLines     主题正文切行（去空行；不剥记号——正文是原文。空数组 = 渲染侧「暂无正文」回落）
// 纯函数面（判卷锚）：UI 只做编排，不在这里塞任何 JSX。
export function relativeTime(iso: string, now: number): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  const diff = now - t;
  if (diff < 60_000) return "刚刚"; // 含未来戳（时钟偏差）：都按「刚刚」——不摆负分钟
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return `${String(minutes)} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${String(hours)} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${String(days)} 天前`;
  const d = new Date(t);
  const p = (n: number): string => String(n).padStart(2, "0");
  return `${String(d.getFullYear())}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function fullTime(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  const d = new Date(t);
  const p = (n: number): string => String(n).padStart(2, "0");
  return `${String(d.getFullYear())}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 索引切行：trim、丢空行、剥行首「- 」列表符（行内 **加粗** / `代码` 标记留给 renderInline）。 */
export function indexLines(index: string): string[] {
  return index
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .map((line) => line.replace(/^-\s+/, ""));
}

/** 主题正文切行（2026-10-16 补通道）：丢空行、剥行尾空白；**不剥**「- 」等 Markdown 记号
 *  ——正文是原文，不是索引摘要（与 indexLines 的唯一差别）。渲染侧空数组回落到「暂无正文」。 */
export function bodyLines(body: string): string[] {
  return body
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.trim() !== "");
}

/** 记忆导出 Markdown（第 824 页）：项目层/全局层分节，主题带类型、修改时间、大小与正文；
 *  空层给一句「本层暂无主题」，不导出空壳。纯函数，方便判卷与未来 CLI 复用。 */
import type { MemorySnapshot } from "../../../../src/main/ipc-protocol";

export function memoryExportMarkdown(snap: MemorySnapshot, generatedAt = new Date().toISOString()): string {
  const lines: string[] = [
    "# Cairn 记忆导出",
    "",
    `生成时间：${generatedAt}`,
    "",
    `项目层：${snap.project.path}`,
    `全局层：${snap.global.path}`,
    "",
  ];
  const layer = (title: string, layerSnap: MemorySnapshot["project"]): void => {
    lines.push(`## ${title}`, "");
    if (layerSnap.index !== null && layerSnap.index.trim() !== "") {
      lines.push("### 索引", "", layerSnap.index.trimEnd(), "");
    }
    if (layerSnap.topics.length === 0) {
      lines.push("_本层暂无主题_", "");
      return;
    }
    for (const topic of layerSnap.topics) {
      lines.push(`### ${topic.topic}`, "", `- 类型：${topic.type}`, `- 修改：${topic.modified}`, `- 大小：${String(topic.bytes)} B`, "");
      lines.push(topic.body.trim() === "" ? "_此主题暂无正文_" : topic.body.trimEnd(), "");
    }
  };
  layer("项目层", snap.project);
  layer("全局层", snap.global);
  return lines.join("\n").trimEnd() + "\n";
}
