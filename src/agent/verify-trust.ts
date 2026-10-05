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
// 状态（同一批日子的第二页，业主批准形状后接线）：上面那句「一次权限判定都没有」说的是**立闸前**的现场，
// 而闸本身当时把生产那一环一起关死了——三处装配点的 `trustedRepo` 恒 false 且无人能置真，于是
// 缺省开着的 autoVerify 从未真跑。现在这一环接上了：**一次一问 + 同指纹免问**（不是免批，也不是开关）。
// 判定与端口住本文件（纯函数，可单测），「问谁 / 记在哪张表」住 `src/main/verify-trust-gate.ts`。
//
// 本模块只做**判据与端口**（纯函数 + 一个注入接口，可单测）：把「这批命令的来源可不可信」变成一个布尔
// 加一句能直接回注给模型的话，并把「问谁、记在哪张表上」这件事收成 `VerifyTrustResolver` 一个口。
// 执行侧的门与审批卡通道在 `src/main/agent-runner.ts`（装配根）——它把现成那份信任表
// （`src/agent/plugins/trust.ts` 的 `TrustStore`，插件 hook/MCP 用的同一个类、同一份文件）与本场 run 的
// `AskGate` 组成一个 resolver 递进来（`src/main/verify-trust-gate.ts`）。
// **不在这里再写第二份信任表**：本仓对「第二份事实源」零容忍，而插件那条信任门早已把
// 「内容绑定 + 首次问人 + 同指纹免问 + 持久化」这一整套做完了（见 #58 / 审查 E-10 / S1-7），
// verify 面要的正是同一套，只差把键换成 (repoDir, verify 面内容)。

import { createHash } from "node:crypto";
import type { VerifyConfig } from "./verify";

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

/** 一次信任查询/一问的载荷：键的**两个维度**都在里面（目录 + 面内容），问人与记账共用同一份。 */
export interface VerifyTrustRequest {
  repoDir: string;
  /** `verifySurfaceFingerprint` 算出的面内容指纹——信任绑定的是它，不是「这个仓我信」。 */
  fingerprint: string;
  commands: readonly string[];
  provenance: VerifyProvenance;
  /** 本场 run 的取消信号：卡片必须随 run 收束（沿用 AskGate 的 D12 通道，不许悬到超时）。 */
  signal?: AbortSignal;
}

/** 信任表 + 审批卡的组合口。实现住 `src/main/verify-trust-gate.ts`（装配根侧），
 *  这一层只声明端口 —— `src/agent/` 不 import `src/main/`，方向与 desktop 边界那条同一个规矩。 */
export interface VerifyTrustResolver {
  /** 表里有没有这一 (repoDir, 面内容) 的批准记录。true ⇒ 免问。 */
  isTrusted(req: VerifyTrustRequest): Promise<boolean>;
  /** 问人：批准 ⇒ 实现负责把这条批准**登记进表**（同指纹之后免问由那次写入兑现）。
   *  拒／无人应答／取消一律 false，且**不写表**——那三种都不是人的决议。 */
  requestTrust(req: VerifyTrustRequest): Promise<boolean>;
}

/** 信任表的**键域标签**：verify 面的决议与插件的决议住在同一份文件、同一个 `TrustStore`，
 *  但键的第一维必须区分开——插件条目的第一维是插件根目录的绝对路径，这里给仓库目录加一个域标签。
 *  为什么不能直接共用裸目录路径：`TrustStore.hit` 有条明文备案的旧版兼容（裸路径条目命中无界条目），
 *  那条兼容是给插件历史留的；若 verify 也用裸路径，一条历史的插件裸路径条目就可能顺带免掉仓库命令的问。
 *  加了标签 ⇒ 那种条目永远不会被写出来，兼容面也就顶不到这一门。 */
export const VERIFY_TRUST_KEY_TAG = "#verify";

/** (repoDir) → 信任表条目的第一维。第二维由 `TrustStore` 拼 `@指纹`。 */
export function verifyTrustKey(repoDir: string): string {
  return repoDir + VERIFY_TRUST_KEY_TAG;
}

/** verify 面的**内容**指纹：命令面按桶位（typecheck / lint / test）逐条入串，
 *  再带上来源与超时帽——键绑的是「将要被执行的是什么」，不是那个文件在盘上的字节。
 *
 *  为什么必须把内容算进键（这一格就是判卷 ③ 的动因）：只按 repoDir 记的话，「批过一次」会一直有效，
 *  于是**批准 `pnpm test` 之后**把 `test` 改成 `curl … | sh`（同一个仓、同一次克隆面）就自动可信了——
 *  那正是 S3 立闸要堵的那条路。内容进键之后，改一条命令就是换一个键 ⇒ 重新问一次。
 *  反过来，同一个面换个 JSON 写法（键序/缩进/换行）算不出第二个键：这里吃的是 `loadVerifyConfig`
 *  **解析后**的结构，不是文件字节，所以不会因为排版变化白问一次。
 *  `timeoutMs` 也进：它决定「这条命令被掐死之前能跑多久」，属于人要批的那件事的一部分。 */
export function verifySurfaceFingerprint(config: VerifyConfig, provenance: VerifyProvenance): string {
  const surface = JSON.stringify({
    provenance,
    typecheck: config.typecheck ?? [],
    lint: config.lint ?? [],
    test: config.test ?? [],
    timeoutMs: config.timeoutMs ?? null,
  });
  return createHash("sha256").update(surface).digest("hex").slice(0, 32);
}