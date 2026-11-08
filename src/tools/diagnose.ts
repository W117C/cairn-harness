// diagnose：把「跑本仓配置的 lint/test」从 run_shell 的整块 stdout 变成可逐条定位的结构化清单。
//
// 与 verify 的分工（**不重复机制**）：配置读取、执行器、归因**全部复用** `src/agent/verify.ts`
// （loadVerifyConfig / ExecFn / classifyVerifyFailure）；执行器由 agent-runner 传
// `verifyExec(sandbox)` —— 与 verify 同一条沙箱出口。本工具只加两样：
//   ① 结构化解析层（`diagnose-parse.ts`，纯函数、可离线判卷）；
//   ② 模型面入口（规格 + 实例同时注入，见 agent-runner）。
//
// 注入纪律（同 impact_query / lsp）：本工作区**真有可诊断面**才注入——没有可跑的命令时挂着它
// 只有成本没有能力。写向档位＝**写向类**（它执行进程；不执行不代表不改盘——测试会写缓存/产物，
// 本仓 `mayHaveWrittenDisk` 对任意非白名单命令就是按"可能改盘"管的）：
// 由 agent-runner 用 `gatedTool` 包装 ⇒ 只读档摘除/拒、方案门挡、沙箱降级时强制审批，四条全在。

import { classifyVerifyFailure, DEFAULT_VERIFY_TIMEOUT_MS, loadVerifyConfig, type ExecFn, type VerifyConfig } from "../agent/verify.js";
import type { VerifyProvenance, VerifyTrustDecision } from "../agent/verify-trust.js";
import { ToolError, type Tool, type ToolResult } from "./base.js";
import { parseDiagnostics, type DiagnosticEntry } from "./diagnose-parse.js";

/** 单条消息进输出前截断：解析出来的 message 可能是一整行压缩代码。 */
const MESSAGE_CAP = 300;
/** 解析不出条目时的原文兜底尾部（有界；给的是"原材料"不是"我猜的结构"）。 */
const RAW_TAIL_CAP = 1500;

/** 本工作区有没有可诊断面（≥1 条配置命令）。坏配置按「没有」处理——口径同 agent-runner 的
 *  `lspConfigured`：那是工具/verify 调用时要喊的错，不该让整轮 run 起不来。 */
export async function diagnoseSurface(workspace: string): Promise<boolean> {
  try {
    const { config } = await loadVerifyConfig(workspace);
    return [...(config.lint ?? []), ...(config.test ?? [])].length > 0;
  } catch {
    return false;
  }
}

const clip = (s: string): string => (s.length > MESSAGE_CAP ? s.slice(0, MESSAGE_CAP) + "…" : s);

/** 一条结构化条目的单行渲染：`file:line:col severity [rule]: message`（与常见工具同序，模型好认）。 */
export function entryLine(e: DiagnosticEntry): string {
  const loc = e.file + (e.line !== undefined ? ":" + String(e.line) : "") + (e.col !== undefined ? ":" + String(e.col) : "");
  const rule = e.rule !== undefined ? " [" + e.rule + "]" : "";
  return loc + " " + e.severity + rule + ": " + clip(e.message);
}

export interface DiagnoseDeps {
  /** 执行器（agent-runner 传 verifyExec(sandbox)：与 verify 同一条沙箱出口）。 */
  exec: ExecFn;
  /** 信任闸（**必填**，2026-10-21 评审修）：diagnose 会执行仓库自带配置里的命令，
   *  与 verify 同一条 S3 门——不批不跑。生产实现复用 verifyTrust resolver。 */
  authorize: (req: {
    repoDir: string;
    config: VerifyConfig;
    provenance: VerifyProvenance;
    commands: readonly string[];
    signal?: AbortSignal;
  }) => Promise<VerifyTrustDecision>;
}

/** 模型可见规格（由 agent-runner 与实例同时注入；描述刻意写短——工具面是每轮重送的固定成本）。 */
export const diagnoseSpec = {
  name: "diagnose",
  description:
    "跑本工作区配置的 lint/test 命令，把失败输出解析成结构化错误清单（文件:行:列 严重度 规则 原文）——" +
    "比 run_shell 贴整块 stdout 省上下文、错误逐条可定位。face 可只跑 lint 或 test；没有可诊断面时如实报缺。",
  parameters: {
    type: "object",
    properties: {
      face: { type: "string", enum: ["lint", "test"], description: "只跑哪一类（缺省两类都跑）" },
    },
  },
} as const;

export function createDiagnoseTool(deps: DiagnoseDeps): Tool {
  return {
    name: "diagnose",
    async run(args, ctx): Promise<ToolResult> {
      const face = args.face;
      if (face !== undefined && face !== "lint" && face !== "test") {
        throw new ToolError("diagnose: face 只认 lint / test（缺省两类都跑），收到: " + JSON.stringify(face));
      }
      let loaded;
      try {
        loaded = await loadVerifyConfig(ctx.workspace);
      } catch (e) {
        // 配置存在但坏 ⇒ fail loud（口径同 verify），但走 ToolError 出口：loop 把它转成 ok:false 回执。
        throw new ToolError("diagnose: 读 verify 配置失败——" + (e instanceof Error ? e.message : String(e)));
      }
      const { config, source } = loaded;
      const picked: { face: "lint" | "test"; command: string }[] = [];
      if (face !== "test") for (const c of config.lint ?? []) picked.push({ face: "lint", command: c });
      if (face !== "lint") for (const c of config.test ?? []) picked.push({ face: "test", command: c });
      if (picked.length === 0) {
        const why =
          source === "config"
            ? ".agent/config.json 的 verify 配置里没有这一类的命令"
            : "未找到可跑的 lint/test 配置（.agent/config.json 无 verify 字段，package.json 无 lint/test scripts，也未探到 go/cargo/pytest/make 测试面）";
        return { ok: false, output: `diagnose: 本工作区没有可诊断面（${why}）。先在配置里补上再调本工具。` };
      }

      const commands = picked.map((p) => p.command);
      const provenance: VerifyProvenance = source === "config" ? "repo-config" : "repo-probed";
      const grant = await deps.authorize({
        repoDir: ctx.workspace,
        config,
        provenance,
        commands,
        ...(ctx.signal ? { signal: ctx.signal } : {}),
      });
      if (!grant.run) return { ok: false, output: grant.reason };

      const timeoutMs = config.timeoutMs ?? DEFAULT_VERIFY_TIMEOUT_MS;
      const out: string[] = [];
      let failed = 0;
      let total = 0;
      let errors = 0;
      let warnings = 0;
      for (const { face: f, command } of picked) {
        const r = await deps.exec(command, ctx.workspace, timeoutMs, ctx.signal);
        if (r.ok) {
          out.push(`[diagnose] ${f} · ${command} → ✅ 通过`);
          continue;
        }
        failed += 1;
        const cause = r.cause ?? classifyVerifyFailure({ timedOut: false, exitCode: r.exitCode ?? null, output: r.output });
        const diag = parseDiagnostics(r.output);
        total += diag.total;
        for (const e of diag.entries) if (e.severity === "error") errors += 1;
        for (const e of diag.entries) if (e.severity === "warning") warnings += 1;
        out.push(
          `[diagnose] ${f} · ${command} → ❌ 失败（exit ${r.exitCode === null || r.exitCode === undefined ? "无" : String(r.exitCode)} · ${cause}）` +
            `｜结构化 ${String(diag.total)} 条${diag.truncated ? `（只列前 ${String(diag.entries.length)} 条）` : ""}`,
        );
        for (const e of diag.entries) out.push("  " + entryLine(e));
        if (diag.total === 0) {
          const tail = r.output.slice(-RAW_TAIL_CAP);
          out.push(`  （未从这条命令的输出解析出结构化错误——原文尾部 ${String(tail.length)} 字符如下，供人工/模型直读）`);
          for (const l of tail.split("\n")) out.push("  │ " + l);
        }
      }
      out.push(
        `共 ${String(picked.length)} 条命令：✅ ${String(picked.length - failed)} / ❌ ${String(failed)}｜结构化条目 ${String(total)} 条（error ${String(errors)} / warning ${String(warnings)}）`,
      );
      return { ok: failed === 0, output: out.join("\n") };
    },
  };
}
