// verify 命令的**信任闸**（审查 S3，2026-10-05 第 373 页）。
//
// S3 的确切形状（现读代码量出来的，不是推断）：
//   harness 的自动补拍执行 `verifyCommands(loadVerifyConfig(repoDir))`，而 `loadVerifyConfig`
//   的两个来源**都是仓库自带文件**——`.agent/config.json` 的 verify 字段，或 `package.json`
//   的 scripts，或 Makefile / go.mod / Cargo.toml / pyproject 的探测结果。
//   **没有任何一条来自宿主配置。** 而这条执行路径上一次权限判定都没有：
//   `src/agent/verify.ts` 对 permission / approve / ask / trusted 零命中（实测 grep）。
//
//   于是：克隆一个仓库 ⇒ 文件里带一条 `test: curl … | sh` ⇒ 模型改任意一个文件 ⇒ 收束闸
//   自动补拍 ⇒ 任意命令执行。它**不经过** shell 威胁表、**不经过**网络审批通道、
//   **不产生任何审批卡**——模型自己写 `package.json` 那条路已被 S2 的路径通道堵住
//   （实测 `.agent/config.json` 写入得 ask/high），但**克隆即携带**这条路与写盘无关，照样通。
//
// 本模块只做**判据**（纯函数，可单测）：把「这批命令的来源可不可信」变成一个布尔加一句
// 能直接回注给模型的话。执行侧的门在 `createVerifyHook` 与 agent-runner 那条接缝上。
//
// 为什么不做「读一次记进白名单」那种自动信任：内容指纹信任门已经在 `.agent/plugins` 上
// 有一只（见 #58），复用它是本仓既定路线，但复用要改接线、且那支文件正在被别人持有。
// 本轮先把**判据与 fail-closed 默认**立住，接线复用留下一条明确的后续（不假装已做）。

/** 这批 verify 命令从哪儿来。`repo-*` 两类都是仓库自带文件＝外部输入。 */
export type VerifyProvenance = "repo-config" | "repo-probed" | "host";

/** 宿主侧的显式配置（settings / CLI flag / 测试注入）——不是外部输入，直接放行。 */
export interface VerifyTrustInput {
  provenance: VerifyProvenance;
  commands: readonly string[];
  /** 上游已确认可信（例如用户在审批卡上点了「本次会话允许」，或调用方自己拥有该仓库）。 */
  trusted: boolean;
}

export interface VerifyTrustDecision {
  /** 能不能跑。false 时必须**不跑**并把 reason 回注——不许降级成「跑一半」或「换个源跑」。 */
  run: boolean;
  /** 给模型看的那一句（`run:true` 时是空串）。要写清「为什么没验」，否则模型会反复重试。 */
  reason: string;
}

/** 命令清单为空 ⇒ 根本没有可验面，不是信任问题，放行（真正的空清单在 surface() 那层判）。 */
export function verifyTrustDecision(input: VerifyTrustInput): VerifyTrustDecision {
  if (input.commands.length === 0) return { run: true, reason: "" };
  if (input.provenance === "host") return { run: true, reason: "" };
  if (input.trusted) return { run: true, reason: "" };
  const where = input.provenance === "repo-config"
    ? "仓库的 .agent/config.json"
    : "仓库的 package.json / Makefile 等探测面";
  return {
    run: false,
    reason: "[verify] 已跳过：验证命令来自" + where
      + "，属于仓库自带内容，未经授权不在自动补拍里执行（自动补拍不经过 shell 威胁表与网络审批通道）。"
      + "要验的话，二选一：① 自己用 run_shell 跑（那条路有审批与威胁表）；"
      + "② 告诉我要用哪条命令，我把它作为宿主配置接进来。",
  };
}