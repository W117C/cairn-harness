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

// ---- 重定向写面（09-22 补，探针 ④ 段四支红）----
// 这一族此前在威胁表里**零条目**：`echo x > /etc/hosts`、`cat > .git/hooks/pre-commit`、
// `echo hi >> ~/.zshrc` 全按 risk=none 直通（自主档 approve，连一张卡都不出）。
// 同一条「写面元字符」判据，worker 的只读那一支早就一票否决（`worker-shell-tools.ts` 的
// `SHELL_WRITE_META`），主会话写面却没有对应条目——「同一判据只硬化一支」的又一实例。
/** 组一条「`>` / `>>` 后面跟这个目标」的正则：允许 fd 数字前缀（`2>>err`），可选引号，
 *  描述符复制（`>&1`）与丢弃到 `/dev/null` 由调用方的负向前瞻排除——那两种不落进任何文件。 */
function redirectOnto(target: string): RegExp {
  return new RegExp(`(?:^|[^\\w>])\\d*>>?\\s*["'\`]?${target}`);
}
const REDIRECT_TAIL = "[^\\s\"'`;|&)]*"; // 目标路径的其余部分（到空白 / 引号 / 链分隔符为止）

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
  // C11（审查 P2）：带路径前缀的 shell（/bin/sh、/usr/bin/zsh）——旧正则只认裸 sh 系名。
  { re: /\b(?:curl|wget)\b[^;|&]*\|\s*(?:sudo\s+)?(?:[\w./-]*\/)?(?:ba|z|da|fi)?sh\b/, level: "critical", category: "远程代码执行", note: "下载内容直接管道进 shell（含绝对路径 shell）" },
  { re: /\bawk\b[^;|&]*system\s*\(/, level: "critical", category: "远程代码执行", note: "awk system() 调用（执行面）" },
  // 09-22（探针 ② 段最后一支）：`echo hi | sh` 这类"管道进 shell"此前只有 curl/wget 那条 critical
  // 覆盖，其它来源一律无条目 ⇒ 自主档 approve@L4-pass。执行面与来源无关，按 high 记。
  { re: /\|\s*(?:sudo\s+)?(?:[\w./-]*\/)?(?:ba|z|da|fi)?sh\b/, level: "high", category: "远程代码执行", note: "管道进 shell（把上游当脚本执行）" },
  { re: /\b(?:perl|python3?)\b[^;|&]*(?:os\.system|subprocess|exec\s*\()/, level: "critical", category: "远程代码执行", note: "脚本语言内嵌进程执行" },
  // ---- 数据外送 ----
  { re: /\b(?:curl|wget|scp|rsync|nc|netcat|ftp|telnet|ssh)\b/, level: "medium", category: "数据外送", note: "外联命令（出网通道）" },
  { re: /\b(?:npm|pnpm|yarn|pip|pip3|brew)\s+(?:i|install|add)\s+(?:-[a-zA-Z]*g|--global)/, level: "medium", category: "数据外送", note: "全局安装（外联）" },
  // C11（审查 P2）：包管理器 install 会执行第三方包生命周期脚本（postinstall 面）。
  { re: /\b(?:npm|pnpm|yarn)\s+(?:i|install|add)\b/, level: "medium", category: "数据外送", note: "安装第三方包（执行其 postinstall 生命周期脚本）" },
  // ---- 系统修改 ----
  { re: /\bchmod\s+(?:-R\s+)?777/, level: "high", category: "系统修改", note: "chmod 777 放开权限" },
  // C11（审查 P2）：递归改权限（不限于 777）——对仓库/系统文件的大面积权限变更面。
  { re: /\bchmod\s+-[a-zA-Z]*[Rr]/, level: "medium", category: "系统修改", note: "chmod 递归改权限" },
  // C11（审查 P2）：dd 任意写（不限于 /dev/）——of= 指向任何路径都是底层覆写。
  { re: /\bdd\b[^;|&]*\bof=/, level: "high", category: "文件破坏", note: "dd 任意路径覆写" },
  { re: /\b(?:crontab|launchctl|systemctl|defaults\s+write)\b/, level: "high", category: "系统修改", note: "系统配置写入" },
  { re: /\b(?:chown|chgrp)\b/, level: "medium", category: "系统修改", note: "改变属主" },
  // 重定向写面（见上方 redirectOnto 段注释）：敏感目标 high（自主档出卡），任意目标 medium
  // ——刻意不是"一律 high"：`build > out.log` 这类工作区落盘天天发生，全抬成 ask 只会让人
  // 闭眼点同意，那才是真正的风险稀释。
  { re: redirectOnto(`(?:~|\\$HOME)\\)?${REDIRECT_TAIL}/`), level: "high", category: "系统修改", note: "重定向写入家目录（含 shell 启动文件、凭证配置）" },
  { re: redirectOnto(`/(?:etc|usr|bin|sbin|var|Library|System|private|Applications)${REDIRECT_TAIL}/`), level: "high", category: "系统修改", note: "重定向写入系统路径" },
  { re: redirectOnto(`\\S*(?:\\.git/hooks|\\.ssh|authorized_keys|known_hosts|\\.zshrc|\\.bashrc|\\.bash_profile|\\.zprofile|\\.profile|\\.gitconfig|\\.npmrc|\\.netrc|crontab)`), level: "high", category: "系统修改", note: "重定向写入执行/凭证面（git 钩子、ssh、shell 启动文件、调度表）" },
  { re: redirectOnto(`(?!&|/dev/null)\\S`), level: "medium", category: "系统修改", note: "重定向写文件" },
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

/** 改变「这条命令到底是什么」的 shell 载荷：重定向、命令替换、变量展开、管道。
 *  「总是允许」的同意范围**不覆盖**它们（09-21 探针 ② 段：`echo hi` 的一次点击曾覆盖
 *  `echo hi > /tmp/pwned`、`echo hi $(rm -rf …)`、`echo hi | sh`）。判定面在 rules.ts 的 allow 支。 */
export const ALLOW_PAYLOAD = /[<>]|\$\(|`|\$\{|\|/;

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
  // web_fetch：出网取内容。**必须排在下面 `!hasThreatTableSurface` 早退之前**——非 shell 工具
  // 默认拿 NONE，插在后面等于没写这一支。
  //  为什么是 high 而非 medium（`run_shell` 跑 curl 是 medium）：默认档与只读档的 `riskAskAt` 就是 high，
  //  给 medium 的话那两档根本不会被问——而出网永不免批是本仓的既有立场（`L4-network` 出口 + sandbox.ts
  // 的红线注释）。high 让四档的 `RISK_ORDER[risk] >= RISK_ORDER[riskAskAt]` 一条出口全中。
  //  `as string` 是必须的：`web_fetch` 是运行时注入工具，不在 TOOL_NAMES 这个字面量联合里，
  //  直接 `tool === "web_fetch"` 是 TS2367（两侧无重叠）——反向先例见 agent-runner 的 `as ToolName`。
  // web_search 是同族的第二个名字：检索也是出网、结果也是外部不可信输入。不给 high 的后果是
  // auto 档会免批放行它（writeAsk=false 且无风险通道命中）——撞「出网永不免批」红线。
  if ((tool as string) === "web_fetch" || (tool as string) === "web_search") {
    return { level: "high", reason: "出网取内容（外部不可信输入，SSRF 面）" };
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
