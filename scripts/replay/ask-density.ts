// 复跑面 · 登记项 `replay:ask-density`（判卷读数：judgment-layer §3.2 两档 ask 密度 + §3.3 risk 分布）
//
// 为什么从文档里的 heredoc 搬进真脚本：内联在 `.md` 里的 `node --import tsx -e "$(cat <<'TS' … TS)"`
// **永不过编译**——`planBlocked` 从 `boolean` 变成 `() => boolean`（评审 C6：快照布尔只有主会话三处刷新，
// worker 那条路从不刷）之后，那句「下面这段可直接粘贴复跑」静默变成 TypeError（2026-09-23 实测），
// 没有任何门知道。搬进来之后它进 tsc 覆盖面，且 fixture 走 `newAutonomySession`：
// 会话形状由构造器持有，再加字段/改形状会在编译期崩，而不是落在下一个想复跑的人身上。
//
// 取料面（roots / walk / 受管集 / 零语料体检）不在这儿写第二份，统一走 ./corpus。
// 口径与 2026-09-21 那次一致（同 walk、同受管集、同那三臂），否则新旧读数不可比；
// guided 臂是 2026-09-23 中间档落地后**追加**的，三条旧臂一字未动。
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { evaluate, isNetworkCommandCall, newAutonomySession } from "../../src/permissions/autonomy";
import { modelRisk, staticRisk } from "../../src/permissions/risk";
import { PERMISSION_MODES } from "../../src/permissions/modes";
import type { PermissionMode } from "../../src/permissions";
import type { ToolName } from "../../src/tools/base";
import { corpusProblem, isGatedTool, readJsonl, scanCorpus } from "./corpus";

interface Call { tool: string; args: Record<string, unknown> }

function collectCalls(files: readonly string[]): Call[] {
  const calls: Call[] = [];
  for (const f of files) {
    for (const raw of readJsonl(f)) {
      const ev = raw as { type?: string; name?: string; args?: Record<string, unknown> };
      if (ev.type === "tool_call") calls.push({ tool: String(ev.name ?? ""), args: ev.args ?? {} });
    }
  }
  return calls;
}

// 每档一条臂（判卷 `ask-density 的臂覆盖每一档` 钉这条，缺臂由下面的运行时守卫直接红）。
// sandboxAvailable 必须是 null 或 false，写 true 会把「沙箱真生效」当成前提——本机宿主常拒 apply，那条臂就成了假读数。
// 读-only 臂的 ask 天然接近 0（写向在 L0 就被摘除，不是"放行"）：它读的是**残余出卡**，别把它当低成本臂。
export const ARMS: readonly { mode: PermissionMode; sandbox: boolean | null }[] = [
  { mode: "read-only", sandbox: null },
  { mode: "default", sandbox: null },
  { mode: "guided", sandbox: null },
  { mode: "auto", sandbox: null },
  { mode: "auto", sandbox: false },
];

function main(): void {
  const scan = scanCorpus();
  const calls = collectCalls(scan.files);
  const problem = corpusProblem(scan, calls.length);
  if (problem !== null) {
    console.error("⚠️ ask-density 读数无意义：" + problem);
    process.exitCode = 1;
    return;
  }
  // 档位覆盖自检（读脚本三态守卫）：少一臂 = 那一档的密度读不到，比红更坏的是安静地读成 0。
  const unarm = PERMISSION_MODES.filter((m) => !ARMS.some((a) => a.mode === m));
  if (unarm.length > 0) {
    console.error("⚠️ ask-density 有档位没臂：" + unarm.join(" ") + "（ARMS 加臂，别把缺读数当结论）");
    process.exitCode = 1;
    return;
  }
  const gated = calls.filter((c) => isGatedTool(c.tool));
  console.log(`语料=${String(scan.files.length)} 个 jsonl · tool_call=${String(calls.length)} · 受管=${String(gated.length)}`);

  for (const a of ARMS) {
    const session = newAutonomySession(a.mode, { sandboxAvailable: a.sandbox, planBlocked: () => false });
    let ask = 0;
    const risk = new Map<string, number>();
    /** 出卡**落在哪一层**（`d.layer`）。这条是 §7 第 1 步的位置判据：
     *  「default 行 ask 密度必须动起来」是数量判据，会被别的原因推动；
     *  位置判据只认一格——`L3-mode` 必须掉、`L4-*` 必须非 0（拆短路真生效的直接证据）。 */
    const byLayer = new Map<string, number>();
    for (const c of gated) {
      const d = evaluate(c.tool as ToolName, c.args, session);
      if (d.verdict === "ask") {
        ask++;
        byLayer.set(d.layer, (byLayer.get(d.layer) ?? 0) + 1);
      }
      // deny 支上没有 risk（EvaluateDecision 是判别联合）——旧 heredoc 靠 `as any` 混过去，
      // 于是"deny 也算一档 risk"这件事从没被类型检查看过。这里按分支读，语义与 `d.risk ?? "deny"` 同。
      const r = d.verdict === "deny" ? "deny" : String(d.risk);
      risk.set(r, (risk.get(r) ?? 0) + 1);
    }
    console.log(
      a.mode,
      "sandbox=" + String(a.sandbox),
      "受管=" + String(gated.length),
      "ask=" + String(ask),
      "askByLayer=" + [...byLayer.entries()].sort((x, y) => y[1] - x[1]).map(([k, v]) => k + ":" + String(v)).join(" "),
      "risk=" + [...risk.entries()].map(([k, v]) => k + ":" + String(v)).join(" "),
    );
  }
  console.log(
    "staticRisk 非 none:",
    String(gated.filter((c) => staticRisk(c.tool as ToolName, c.args).level !== "none").length),
    "网络命令:",
    String(gated.filter((c) => isNetworkCommandCall(c.tool as ToolName, c.args)).length),
    "modelRisk 标记:",
    String(gated.filter((c) => modelRisk(c.args).level !== "none").length),
  );
}

// 只在直接执行时跑读数：判卷要 import `ARMS` 对账，模块加载不得有副作用。
// 比较走 fileURLToPath——本仓路径里有空格，`import.meta.url` 会把它编码成 %20，
// 用 endsWith 会比不中，于是"复跑面静默不跑"（比红更坏的读法）。
const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) main();
