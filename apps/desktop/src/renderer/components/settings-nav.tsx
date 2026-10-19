// 设置导航的轻量单源：命令面板只需要分区 id/标签，不应因此把设置页正文与工作台一起拉进首屏。
import { BookOpen, Brain, Clock, Globe, KeyRound, Keyboard, Puzzle, Shield, SlidersHorizontal, Wrench } from "lucide-react";

export type PageId = "plugins" | "automation" | "skills" | "memory";

/** 页面顺序（导航与图标/标题事实源）：设置页的四个分区按此渲染，不再各抄一份。 */
export const PAGE_ORDER: readonly PageId[] = ["plugins", "automation", "skills", "memory"];

export const PAGE_META: Record<PageId, { label: string; icon: React.JSX.Element }> = {
  plugins: { label: "插件", icon: <Puzzle size={14} /> },
  automation: { label: "自动化任务", icon: <Clock size={14} /> },
  skills: { label: "技能中心", icon: <BookOpen size={14} /> },
  memory: { label: "记忆系统", icon: <Brain size={14} /> },
};

export type SectionId = "general" | "provider" | "permissions" | "advanced" | "shortcuts" | PageId | "about";

const PAGE_SECTIONS = PAGE_ORDER.map((id) => ({ id, label: PAGE_META[id].label, icon: PAGE_META[id].icon }));

/** 设置分区（顺序固定，唯一事实源——导航与命令面板只许从这里取）。 */
export const SECTIONS: readonly { id: SectionId; label: string; icon: React.JSX.Element }[] = [
  { id: "general", label: "通用", icon: <SlidersHorizontal size={14} /> },
  { id: "provider", label: "模型与 Provider", icon: <KeyRound size={14} /> },
  { id: "permissions", label: "权限与安全", icon: <Shield size={14} /> },
  // 2026-10-18 补：AppSettings 里一直在生效、却没有开关的字段（记忆沉淀 / 跨文件波及 /
  // prompt 缓存 / 花费上限 / 隐私）——用户看不见也改不了，等于悄悄替他决定。
  { id: "advanced", label: "高级", icon: <Wrench size={14} /> },
  { id: "shortcuts", label: "快捷键", icon: <Keyboard size={14} /> },
  ...PAGE_SECTIONS,
  { id: "about", label: "关于与更新", icon: <Globe size={14} /> },
];

/** 分区搜索词（2026-10-18 补设置页搜索）：只补**同义/口语**词，不进 SECTIONS 本体——
 *  SECTIONS 的形状被壳导航与命令面板消费，加字段要连带改两处与它们的判据；
 *  词表单独一份，改词不影响任何既有 import 面。
 *  收录口径：用户会打、但分区名里没有的字（如「暗模式」「密钥」「预算」）。 */
export const SECTION_KEYWORDS: Readonly<Record<SectionId, string>> = {
  general: "主题 暗 亮 深色 夜间 外观 界面 语言 ctrl tab 循环 会话切换",
  provider: "模型 通道 api key 密钥 token 接口 glm openai anthropic gemini deepseek 自定义 识图 视觉 联网 搜索",
  permissions: "权限 档位 模式 只读 自动 引导 审批 安全 沙箱 网络 方案 计划 写文件",
  advanced: "记忆 沉淀 波及 缓存 prompt 花费 预算 上限 成本 价格 隐私 遥测 统计",
  shortcuts: "快捷键 按键 键盘 键位 热键",
  plugins: "插件 扩展 mod",
  automation: "自动化 定时 任务 调度 计划任务 cron",
  skills: "技能 skill 命令 斜杠",
  memory: "记忆 memory 上下文",
  about: "关于 更新 版本 诊断 日志 更新源 manifest",
};

/** 设置分区搜索（纯函数，可单测）：空查询 = 全量；按 label + 关键词做大小写不敏感的子串匹配。
 *  返回**保序**结果（顺序仍由 SECTIONS 定，不让匹配度重排——用户对固定顺序有肌肉记忆）。
 *  匹配口径：关键词**互相**子串匹配（词含查询 或 查询含词）——这样打「记忆」命中「记忆系统」，
 *  打「遥」也命中「遥测」，不必要求用户打全。 */
export function filterSections(query: string): readonly SectionId[] {
  const q = query.trim().toLowerCase();
  if (q === "") return SECTIONS.map((s) => s.id);
  return SECTIONS.filter((s) => {
    if (s.label.toLowerCase().includes(q)) return true;
    const keys = (SECTION_KEYWORDS[s.id] ?? "").toLowerCase().split(/\s+/);
    return keys.some((k) => k !== "" && (k.includes(q) || q.includes(k)));
  }).map((s) => s.id);
}
