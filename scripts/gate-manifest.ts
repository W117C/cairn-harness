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
  "sandbox:check",
  "fork-check",
  "gate-check",
  "docs-check",
  "autonomy-check",
  "compaction-check",
  "tools-check",
  "map-check",
  "prune-check",
  "provider:check",
  "memory-check",
  "plugins-check",
  "security-check",
  "gym-check",
  "routing-check",
  "supervisor-check",
  "model-surface-check",
  "prefix-churn-check",
  // 第 174 页登记（任务 #13）：模型可见文本里点到的工具名，要在**每一档的工具面**上真拿得到。
  // 动因：`BASE_SYSTEM` 是一份文本对四档（现读 read-only 面 8 把、其余三档 20 把），而同类事故已命中四次
  // （glob 那句逃生口 / maxFiles 死参数 / prune 附件说 read_file 够不到 / verify 指向 .agent/ 禁写面）。
  // 存量按豁免表逐条带理由登记（3 条 odd，全在 read-only），**只准调低、过期即红**；真修法是拆 per-mode 文本（任务 #16）。
  // 同轮声明代价：取的是 runner 印的那一道门。第 174 页首测 **981ms**（一份文本对四档）；
  // 第 175 页拆成 per-mode 文本后 **814ms**（两份系统文本）；第 176 页加 68 份工具描述面后 **773ms**；
  // 第 177 页再加 8 份 goal 续跑提醒（共 78 份面）复测 **829ms**——单次读数，与前三次同量级（不是复测求出的噪声底）。
  // 第 178 页再加 189 份**参数描述**面（共 267 份，面数 ×3.4）：runner 三次读数 800/716/703ms，中位 **716ms**
  // ⇒ 与第 177 页那一次同量级、没有可分辨的涨幅（代价主要在 tsx 启动，不在面数）。
  // 第 179 页加覆盖率那一格（只印不拦）＋两把写向工具的 path 说明（参数面 189→195）：
  // runner 三次 846/744/741ms，中位 **744ms**——仍在同一噪声带内，同样没有可分辨涨幅。
  // 相对 mutate-verify 一轮（单价×条数见上面那段）可忽略。
  "prompt-surface-check",
  "replay-determinism-check",
  "no-progress-check",
  "cost-per-progress-check",
  // 第 146 页登记：0.26s 的一把尺，量的正是「消费者入库了新文件没入库」这一格——
  // 那一格从第 131 页起让认证树连续多笔读不到东西（167 条格子量不出来），而默认门表里没人问它。
  "head-import-check",
  // 第 149 页登记（任务 #4 结案）：认证**干净 HEAD** 的整棵树（切树→核 rev→补依赖→import 面→门表→typecheck→全量判卷）。
  // 为什么要进默认门表：`"test"` 那道门量的是工作树，而工作树可以替 HEAD 遮红——第 123 页数过：86 笔提交跑在红灯上。
  // 代价实测（本文件同笔，`gates --only=head-cert-check` 于 `123835b`）：**这道门 123.7s**（其中全量判卷 86.66s，其余是切树/补依赖/import 面/门表/typecheck）。
  // 对照的那一道必须带分母（第 170 页改的这句：从前只写「一道 16.9 分钟＝1/8」，条数一变就替错误背书——规则 245/250）：
  //   那 16.9 分钟是 26 道门那一趟里 mutate-verify 的墙钟，同一趟自己印的是 `跑了 568/568 条`＋`未证 265 条（236 条源文件在飞/未跟踪 ⇒ 根本没跑；29 条判卷文件在飞）`
  //   ⇒ 买到的只有**跑到的 568 条**＝单价 1.77s/条，当时表长 833 条（568＋265 对得上），今天的表 950 条。取料：`outputs/mutation-selector-scan-2026-09-28/old-mode-price-from-logs-2026-09-28.md`。
  //   现读同分母（第 170 页 selector 跑法、独占窗口、`6172a62`）：`跑了 949/949 条 · 本次耗时 1472.3s`＝1.55s/条 ⇒ 这道门相对是 **1/11.9**（不是 1/8）。
  //   再一份现读同分母（第 197 页：一棵干净树、独占、无预算、`aefc50b`、整表 1019 条）：
  //     `本次耗时 1085.3s · 跑了 1019/1019 条`＝**1.065s/条** ⇒ 这道门相对 **1/8.8**。单价从 1.55 掉到 1.065 的机制是第 173 页⑩
  //     把「还原后再测一遍」那一拍换成逐字节比对（每条少付一次 spawn），不是运气。
  //     取料：`outputs/mutation-parallel-shard-2026-09-29/serial-whole-table-1019.log`（这份原文逐条成本格抽得到 1019/1019 条）。
  //   并行那一臂（同一份 1019 条、四棵干净树、按实测秒装箱）墙钟 **350.2s＝5.8 分钟** ⇒ 串行 ÷ 并行 = **3.10×**，
  //     代价是每条单价被四棵树抬到 1.307s（＋22.7%）；同目录 measurements.md §十，那里还说清了"3.10× 与重叠度 3.54× 是两个口径"。
  //   逐条秒之和＝1036.4s，比机器自报墙钟 1085.3s 少 48.9s（4.5%）＝编排/换盘/git 那部分不在逐条账里 ⇒ 别拿逐条之和÷条数当墙钟单价。
  // 第 204 页（#21 笔1）把表从 1019 条长到 **1023 条**，并新增一个判卷宿主 `tests/impact-cap-policy.test.ts`。
  //   增量账的形状还是「单价×条数＋出处」：这 4 条各付 2 拍（第 173 页⑩之后没有第三拍）；
  //   **单价本笔不猜**——由认证那趟机器自报（`本次耗时 …s · 跑了 N/N 条`）回填，凭证页取料。
  //   这一笔真正贵的是**运行时**而非门：建图从「帽 400」放到全量，本仓候选 512 实测 1071ms → 1247ms＝**＋176ms／次建图**
  //   （独立进程、帽 400 与全量两种顺序各跑一次，同臂散布 ≤13ms；同进程连建两图那趟读数是反的，已作废）。
  //   取料：`outputs/impact-cap-decision-2026-09-30/decision-input.md` §三。付账对象是**默认开着**的那两条
  //   （`settings.ts` 的 `impactAnalysis: true` ⇒ 语义租约管 spawn 准入；每写一次就回注一句 `[impact]`），不是待配置路径。
  // 第 206 页（#33）再把表长到 **1027 条**（＋4 条：地图自述／地图分母退回切片后／ok:false 那支不出声／注入侧 catch 不出声）。
  //   同样**不猜单价**：判卷宿主 `tests/map-self-report.test.ts` 走 selector 跑法，量级参照第 205 页那批
  //   （同族合成靶子：7 条 7.4s、selector 中位 0.49s/拍）——认证那趟由机器自报回填。
  //   这一笔改的是**注入面的文本**（地图正文多一句自述、降级时多一行说明）⇒ 代价记在 A-4 那一格：
  //   地图文本本来就先进 `mapChars` 再进压缩判定，多这一句跟着一起被算，不需要新预算位。
  // 第 208→211 页把表从 1027 条长到 **1031 条**（#26 三条普查第三态＋#8 两条树闸证人），单价本笔**有实测**：
  //   同表整跑两趟（四棵干净树、`0513d13`）里逐条自报——新增五条中四条各 **0.7s／2 拍**，
  //   只有钉接线那条（`tree-guard-refusal-not-wired`）要 **2.0–2.5s／2 拍**；四条都在 selector 跑法那一支
  //   （体检行里既不零命中也不多命中），所以**这一格不是「整文件 vs 精确」能解释的**，机制本笔未量，只登记读数
  //   （取料：`outputs/0513d13-credential-2026-09-30/`）。
  //   同一趟还第一次有**同分母 A/B**：按条数装箱 377.7s vs 按实测秒装箱 349.0s＝**省 28.7s（7.6%）**，
  //   机制不是少干活（逐片之和 1345.1s vs 1357.4s，差 0.9% 在噪声里）而是把最长那片从 375.2s 压到 346.9s；
  //   臂内散布的底＝两次按条数装箱（`7da5c50` 379.8s／`0513d13` 377.7s，表只差 2 条）差 2.1s ≪ 28.7s ⇒ 符号稳、幅度只有一个 pair。
  // 从前挂在这道门上的「整表 20 分钟」这个反对理由，量的其实是整张变异表——两把尺的数不许互借。
  // 它排在 mutate-verify 之前：这道门红的时候，先知道「HEAD 本来就红」比先花上面那 18.1 分钟（1085.3s）跑变异更有用（跑法再变，这个次序都不变）。
  "head-cert-check",
  "mutate-verify",
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
 *
 * `exempt` 之所以开成一个形参（缺省仍是那张表）：豁免表**今天是空的**，
 *  那两个分支因此没有任何输入能走到——"留着但没人验收"不等于"已验收"（规则 210/223 那一族）。
 *  有了这个口子，判卷才能当场造一份豁免表把两条分支各测一次。 */
export function checkGateManifest(
  scripts: Record<string, string>,
  exempt: Readonly<Record<string, string>> = EXEMPT_SCRIPTS,
): ManifestViolation[] {
  const out: ManifestViolation[] = [];
  const scriptNames = new Set(Object.keys(scripts));
  const gates = new Set(GATES);

  for (const name of Object.keys(scripts)) {
    if (!ACCEPTANCE_SHAPE.test(name)) continue;
    if (gates.has(name)) continue;
    if (Object.prototype.hasOwnProperty.call(exempt, name)) continue;
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

  for (const [name, reason] of Object.entries(exempt)) {
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
