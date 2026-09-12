// M1c 风险三通道（§11.7.4）：静态威胁表 ⊕ 模型 requires_approval 标记 ⊕ 沙箱装不下。
// risk = max(静态评级, 模型映射)；critical 任何档位强制审批（管线 L4）。
// 不做 LLM 风险分析器 V1（§11.7.4 拍板）。
import type { ToolName } from "../tools/base";

export type RiskLevel = "none" | "low" | "medium" | "high" | "critical";

export const RISK_ORDER: Record<RiskLevel, number> = { none: 0, low: 1, medium: 2, high: 3, critical: 4 };

export function maxRisk(a: RiskLevel, b: RiskLevel): RiskLevel {
  return RISK_ORDER[a] >= RISK_ORDER[b] ? a : b;
}

export type ThreatCategory =
  | "文件破坏"
  | "远程代码执行"
  | "数据外送"
  | "系统修改"
  | "权限提升"
  | "命令注入";

interface ThreatEntry {
  re: RegExp;
  level: Exclude<RiskLevel, "none" | "low">;
  category: ThreatCategory;
  note: string;
}

/** 静态威胁表（六类四级；首批条目收编 Goose patterns + Roo 元字符展开表，§11.7.4）。 */
export const THREAT_TABLE: ThreatEntry[] = [
  // ---- 文件破坏 ----
  { re: /\brm\s+(?:-[a-zA-Z]+\s+)*\/(?:\s|$|\*)/, level: "critical", category: "文件破坏", note: "rm 递归删除根路径" },
  { re: /\brm\s+(?:-[a-zA-Z]+\s+)*~/, level: "critical", category: "文件破坏", note: "rm 递归删除家目录" },
  { re: /\brm\s+-[a-zA-Z]*[rf]/, level: "high", category: "文件破坏", note: "rm 递归/强制删除" },
  { re: /\bdd\b[^;|&]*of=\/dev\//, level: "critical", category: "文件破坏", note: "dd 直写设备" },
  { re: /\bmkfs/, level: "critical", category: "文件破坏", note: "格式化文件系统" },
  { re: />\s*\/dev\/(sd|disk|nvme)/, level: "critical", category: "文件破坏", note: "重定向覆盖块设备" },
  // ---- 远程代码执行 ----
  { re: /\b(?:curl|wget)\b[^;|&]*\|\s*(?:ba|z|da|fi)?sh/, level: "critical", category: "远程代码执行", note: "下载内容直接管道进 shell" },
  { re: /\b(?:curl|wget)\b[^;|&]*\|\s*(?:sudo\s+)?(?:ba)?sh/, level: "critical", category: "远程代码执行", note: "远程脚本执行" },
  // ---- 数据外送 ----
  { re: /\b(?:curl|wget|scp|rsync|nc|netcat|ftp|telnet|ssh)\b/, level: "medium", category: "数据外送", note: "外联命令（出网通道）" },
  { re: /\b(?:npm|pnpm|yarn|pip|pip3|brew)\s+(?:i|install|add)\s+(?:-[a-zA-Z]*g|--global)/, level: "medium", category: "数据外送", note: "全局安装（外联）" },
  // ---- 系统修改 ----
  { re: /\bchmod\s+(?:-R\s+)?777/, level: "high", category: "系统修改", note: "chmod 777 放开权限" },
  { re: /\b(?:crontab|launchctl|systemctl|defaults\s+write)\b/, level: "high", category: "系统修改", note: "系统配置写入" },
  { re: /\b(?:chown|chgrp)\b/, level: "medium", category: "系统修改", note: "改变属主" },
  // ---- 权限提升 ----
  { re: /\bsudo\b/, level: "high", category: "权限提升", note: "sudo 提权" },
  { re: /\bsu\s+[a-zA-Z]/, level: "high", category: "权限提升", note: "切换身份" },
  // ---- 命令注入（Roo 元字符展开表，整表强制 ask 级别）----
  { re: /\$\{[a-zA-Z_][a-zA-Z0-9_]*@[A-Z]\}/, level: "medium", category: "命令注入", note: "参数展开 ${var@P}" },
  { re: /\$\{![a-zA-Z_]/, level: "medium", category: "命令注入", note: "间接引用 ${!var}" },
  { re: /<<<\s/, level: "medium", category: "命令注入", note: "here-string 命令替换" },
  { re: /=\(/, level: "medium", category: "命令注入", note: "zsh 进程替换 =(…)" },
  { re: /\(e:/, level: "medium", category: "命令注入", note: "glob 代码执行 (e:…)" },
];

export interface RiskFinding {
  level: RiskLevel;
  reason: string;
}

const NONE: RiskFinding = { level: "none", reason: "" };

/** 携带 shell 命令面的工具（M0 复盘 P0-1）：权限层的命令级判据必须按「能力」识别，
 *  而不是按字面工具名。编排内核给 worker 起的 shell 工具叫 shell_rw / shell_ro，
 *  旧实现只认 run_shell，导致 write worker 的静态威胁表 / 副作用判定 / 命令级规则
 *  三道防线同时静默失效（任意 shell 命令走 auto 档零风险直通）。 */
export const SHELL_FAMILY: ReadonlySet<string> = new Set(["run_shell", "shell_rw", "shell_ro"]);

export function isShellFamily(tool: string): boolean {
  return SHELL_FAMILY.has(tool);
}

/** 静态威胁表的适用范围 = shell 家族 − shell_ro。
 *  shell_ro 自带 fail-closed 的只读静态白名单硬闸（对危险命令强于威胁表）：若让它的命令
 *  先过 staticRisk，`curl … | sh` 会被判 critical 走 L4「送审」而不是静态拒绝，
 *  等于把 deny 降级成 ask（agents.test 断言「只读 bash 静态过滤拒绝」）。 */
export function hasThreatTableSurface(tool: string): boolean {
  return isShellFamily(tool) && tool !== "shell_ro";
}

/** 静态通道：扫描命令（含链）命中威胁表取最高级。 */
export function staticRisk(tool: ToolName, args: Record<string, unknown>): RiskFinding {
  // edit_file：就地改文件（文件破坏面 ≤ write_file 的覆盖写，但仍是写向操作）
  if (tool === "edit_file") {
    return { level: "medium", reason: "编辑文件（写向操作）" };
  }
  if (!hasThreatTableSurface(tool)) return NONE;
  const command = typeof args.command === "string" ? args.command : "";
  if (command.trim() === "") return NONE;
  let best: RiskFinding = NONE;
  for (const t of THREAT_TABLE) {
    if (t.re.test(command)) {
      const reason = `${t.note}（静态威胁表：${t.category}/${t.level}）`;
      if (RISK_ORDER[t.level] > RISK_ORDER[best.level]) best = { level: t.level, reason };
    }
  }
  return best;
}

/** 模型通道：模型在参数里标记 requires_approval（Cline 协议：<requires_approval> 标签并入语义）。
 * 映射为 high——模型自认该动作需要审批，任何档位都应问人。 */
export function modelRisk(args: Record<string, unknown>): RiskFinding {
  const marked =
    args.requires_approval === true ||
    Object.values(args).some((v) => typeof v === "string" && v.includes("<requires_approval>"));
  if (!marked) return NONE;
  return { level: "high", reason: "模型标记 requires_approval（模型通道）" };
}

/** 沙箱通道：沙箱装不下 → 审批。available === false 表示自检过但降级（未接线 null 不触发，与 M1b 语义一致）。 */
export function sandboxRisk(
  sandboxAvailable: boolean | null,
  tool: ToolName,
  isSideEffect: boolean,
): RiskFinding {
  if (sandboxAvailable !== false || !isSideEffect) return NONE;
  return { level: "high", reason: "沙箱不可用（降级），写向操作强制审批（沙箱通道）" };
}

const NETWORK_RE =
  /\b(?:curl|wget|scp|rsync|nc|netcat|ftp|telnet|ssh)\b|\b(?:npm|pnpm|yarn|pip|pip3|brew)\s+(?:i|install|add)\s+(?:-[a-zA-Z]*g|--global)/;

/** 网络类命令判定：外泄主通道，scope 不对其提供 session_kind/always（强制 once，§11.7.2）。 */
export function isNetworkCommand(command?: string): boolean {
  if (command === undefined || command.trim() === "") return false;
  return NETWORK_RE.test(command);
}
