// 门禁清单 + 漂移护栏（从 gates.ts 抽出，便于单测——gates.ts 顶层有 `await main()`，
// 直接 import 会跑起全套门禁，与 assertion-health.ts 同一处置理由）。
//
import { join } from "node:path";
// 「清单即事实源」的缺口：GATES 是手写的，package.json scripts 也是手写的，
// 两者之间没有机械校验——新增一条 `pnpm xxx-check` 却忘了登记进 GATES，
// 就得到一道**从不运行的门**（provider:check 即历史实例）。
// 本模块用「scripts 侧无孤儿」的方向兜底：凡是 *-check / *:check 形态的验收脚本，
// 必须在 GATES 里，或在 EXEMPT_SCRIPTS 里**显式**列明豁免理由。
// 它不能证明 GATES 里的每一项都值得跑，但能保证没有验收脚本被静默冷落。

/** 全部门清单（清单即事实源）：六道基建门 + 验收门。新增门只改这里。 */
export const GATES: readonly string[] = [
  "typecheck",
  "test",
  "e2e",
  "ipc:check",
  // 门 0 可达性：IPC 桥两端对齐 + 渲染层可达性棘轮（能力已发货但用户点不到 = 零价值）。
  "ipc-reachability-check",
  "sandbox:check",
  "build",
  "fork-check",
  "gate-check",
  // 文档分层预算：现行层字节预算 + 文档指针禁行号 + STATE.md rev 真伪（D-2 禁手抄观测值待 spec §12 D 段）。
  "docs-check",
  "autonomy-check",
  "compaction-check",
  "panels-check",
  "tools-check",
  "map-check",
  "prune-check",
  "providers-check",
  "provider:check",
  "memory-check",
  "plugins-check",
  "sidechat-check",
  "security-check",
  "agents-check",
  "schedule-check",
  "commercial-check",
  "gym-check",
  "routing-check",
  "supervisor-check",
  "renderer-arch-check",
  // 模型面总预算门：每请求固定成本（基础提示 + 工具规格）此前逐件有帽、总和无人记账——
  // MCP 工具在 sessionToolSpecs 里是裸 push，装三个话痨 server 就能把固定面抬一个数量级而不惊动任何门。
  "model-surface-check",
  // 前缀抖动门：命中率由上游支配（实测 41.5% 的暖轮整段归零），不能拿它当判据；
  // 我们这一侧确定可判的是「没有声明的变异源时装配必须逐字纯追加」——钉住排序纪律。
  "prefix-churn-check",
  // 可复现性门：同一输入两次跑必须逐字段等值。起因是 BLOCKED #56——wall-clock 漏进身份字段
  // （D7 快照目录名 + 模型可见的快照提示），判卷层的「两次跑一致」从此静默失效。
  // ts 只准用于观测：本仓今天没人读它，这条把「今天成立」钉成「一直成立」。
  "replay-determinism-check",
  "a11y-check",
  // 变异验证：证明单元断言非恒真（注入行为突变必须被测试杀死）。
  // 与 gate-check 的静态恒真式体检互补——静态查不出「非空但没对准逻辑」的断言。
  "mutate-verify",
  // 变异表针脚静态预检（秒级，不跑测试）：整张变异表要跑几十分钟且常被并发堵着，
  // 那段时间里「针脚已随重构失效」的锚点在假装守护——这条把那种失效变成当场红。
  "mutate-needles-check",
];

/** 形如验收脚本的 script 名（这些必须有归宿：要么进 GATES，要么进 EXEMPT）。
 *  H5（审查 P2）：词根匹配——旧实现只认 `-check`/`:check` 结尾，`foo-check.mjs`、
 *  `bar:check2` 等换后缀命名即逃逸孤儿护栏。含 check 词根即视为验收形态（豁免列表可放行）。 */
const ACCEPTANCE_SHAPE = /check/i;

/**
 * 显式豁免的验收形态脚本：收尾门 / 真连门 / 被别的门覆盖的同族门。
 * 每条必须写明理由——豁免本身可审计，不接受无声放行。
 */
export const EXEMPT_SCRIPTS: Readonly<Record<string, string>> = {
  // e2e / ipc-check 是独立门名，但 `pnpm e2e` 直接就是脚本名，不属 *-check 形态；
  // 这里只列真正被排除在 GATES 之外、仍值得解释的脚本。
};

export interface ManifestViolation {
  kind: "orphan-acceptance-script" | "gate-without-script" | "exempt-without-reason" | "exempt-unknown-script";
  name: string;
  detail: string;
}

/**
 * 校验 GATES / package.json scripts / EXEMPT_SCRIPTS 三者一致（纯函数，可单测）。
 * - orphan-acceptance-script：*-check / *:check 形态却既不在 GATES 也不在 EXEMPT
 * - gate-without-script：GATES 里列了，但 package.json 没有同名 script（会 spawn 失败）
 * - exempt-unknown-script：EXEMPT 里列了，但 package.json 没有同名 script（陈旧豁免）
 * - exempt-without-reason：EXEMPT 的值是空白理由
 */
export function checkGateManifest(scripts: Record<string, string>): ManifestViolation[] {
  const out: ManifestViolation[] = [];
  const scriptNames = new Set(Object.keys(scripts));
  const gates = new Set(GATES);

  for (const name of Object.keys(scripts)) {
    if (!ACCEPTANCE_SHAPE.test(name)) continue;
    if (gates.has(name)) continue;
    if (Object.prototype.hasOwnProperty.call(EXEMPT_SCRIPTS, name)) continue;
    out.push({
      kind: "orphan-acceptance-script",
      name,
      detail: name + " 是验收形态脚本却不在 GATES；登记进 GATES 或在 EXEMPT_SCRIPTS 写明豁免理由",
    });
  }

  for (const gate of GATES) {
    if (!scriptNames.has(gate)) {
      out.push({
        kind: "gate-without-script",
        name: gate,
        detail: "GATES 列了 " + gate + "，但 package.json scripts 没有同名条目",
      });
    }
  }

  for (const [name, reason] of Object.entries(EXEMPT_SCRIPTS)) {
    if (!scriptNames.has(name)) {
      out.push({ kind: "exempt-unknown-script", name, detail: "EXEMPT_SCRIPTS 列了不存在的 script: " + name });
    }
    if (reason.trim() === "") {
      out.push({ kind: "exempt-without-reason", name, detail: "EXEMPT_SCRIPTS 的 " + name + " 缺理由" });
    }
  }

  return out;
}

/** 门的执行计划：本函数只回答「跑什么」，spawn 由 gates.ts 负责（gates.ts 顶层有 `await main()`，
 *  判据放这儿才能单测——与 assertion-health.ts / 本文件同处置）。
 *
 *  直跑模式（`--direct` 或 `DSH_GATE_DIRECT=1`）绕开 pnpm：pnpm 11 在任何 run 之前做 deps 状态检查，
 *  而它拒绝「node_modules 的解析目标不在项目根之内」的目录并试图就地 install（报 ERR_PNPM_UNSAFE_MODULES_DIR）。
 *  「隔离 worktree + symlink 主树 node_modules」正是这个形状 ⇒ `pnpm gates` 只能在主树跑，
 *  而主树可能正被另一个会话写入，整表验证就被无限期挂起。门清单与命令事实源都不变，只换执行器。 */
export interface GateCommand {
  cmd: string;
  args: string[];
  /** 直跑模式要把本仓的 node_modules/.bin 顶到 PATH 前面（脚本正文里的裸 `vitest` 等才找得到）。 */
  pathPrepend?: string;
  /** package.json 里没有这条 script ⇒ 调用方必须判红，不得当成"没有要跑的东西"静默跳过。 */
  missingScript?: boolean;
}

export function gateCommand(
  name: string,
  opts: { direct: boolean; scripts: Record<string, string>; root: string },
): GateCommand {
  if (opts.direct !== true) return { cmd: "pnpm", args: ["run", name] };
  const body = opts.scripts[name];
  if (typeof body !== "string") {
    return { cmd: "", args: [], missingScript: true };
  }
  if (body.trim() === "") {
    return { cmd: "", args: [], missingScript: true };
  }
  return { cmd: "/bin/sh", args: ["-c", body], pathPrepend: join(opts.root, "node_modules", ".bin") };
}
