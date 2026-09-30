// 运行时注入工具的**唯一清单**：生产与 G-B 对账（tests/tool-surface-parity.test.ts）共读这一份。
// 测试里再抄一张 = 第二个事实源，正是本仓判死过多次的形态。
// 进这张表的条件：该工具不在 src/tools/index.ts 的静态注册表里，而是在运行期挂上模型面。
// 不进表的：插件 skill 与 MCP scoped 工具（名字动态，由 plugins-check 按「规格与可执行面同集合」判）；
// verify（不在 TOOLS 里，由 runLoop 当系统门特判，塞进工具对账门只会产生一条必须豁免的假红）。

export interface InjectedToolSurface {
  name: string;
  /** 规格从哪一面来：`static` = glm-session 的 gateToolSpecs 静态表（常驻原语），
   *  `runtime` = 运行期按开关注入。不区分的话，静态门会去静态表里找只在运行期出现的工具 ⇒ 假红。 */
  specFace: "static" | "runtime";
  /** worker 哪一档够得着（`remember` 只在 write 面出现——粗粒度布尔会把 read 面判成假红） */
  workerReachable: "both" | "read" | "write" | false;
  /** 只读档（sidechat / read-only 会话）模型面是否应出现。仅对 specFace=static 有判据可查。 */
  reachableWhenReadOnly: boolean;
  /** 是否被 SIDE_EFFECT_TOOLS 计入写向（决定它受不受方案门挡）；与 permissions 的真值对账 */
  mainSessionSideEffect: boolean;
}

export const INJECTED_TOOLS: readonly InjectedToolSurface[] = [
  { name: "spawn_agent", specFace: "static", workerReachable: false, reachableWhenReadOnly: false, mainSessionSideEffect: true },
  { name: "wait_for_agents", specFace: "static", workerReachable: false, reachableWhenReadOnly: false, mainSessionSideEffect: false },
  // 撤自己派出的活（能力 4 动态调整）。worker 两面都不给：让 worker 撤兄弟 = 深度恒 1 的反面。
  { name: "cancel_agents", specFace: "static", workerReachable: false, reachableWhenReadOnly: false, mainSessionSideEffect: false },
  // 只改目标措辞、不写盘也不派活 ⇒ 不是写向；只读档也留着（长任务可以在只读档跑）
  { name: "refine_goal", specFace: "static", workerReachable: false, reachableWhenReadOnly: true, mainSessionSideEffect: false },
  { name: "remember", specFace: "static", workerReachable: "write", reachableWhenReadOnly: false, mainSessionSideEffect: false },
  // impact_query 的 worker 三处同源另有 3 条变异锚点守着，登记进表 = 再多一道静态兜底
  { name: "impact_query", specFace: "runtime", workerReachable: "both", reachableWhenReadOnly: true, mainSessionSideEffect: false },
  // 与 impact_query 同族：运行期按开关（solpiEnabled）注入，worker 面不开放
  { name: "obs_recall", specFace: "runtime", workerReachable: false, reachableWhenReadOnly: false, mainSessionSideEffect: false },
  // 插件 skill：实例面在 agent-runner 里 `table["skill"] =`，规格走运行期（插件装载了才有）
  { name: "skill", specFace: "runtime", workerReachable: false, reachableWhenReadOnly: false, mainSessionSideEffect: false },
  // 定时任务五件（§12.2.5）：实现一直有，规格第 42 页才补上 ⇒ 登记进表，让 G-B 从此盯着这一族。
  // worker 面不给（它们已在 WORKER_FORBIDDEN_TOOLS 里）；只读档也不给（只读会话不该排下一次无人值守的写）。
  { name: "automation_create", specFace: "static", workerReachable: false, reachableWhenReadOnly: false, mainSessionSideEffect: false },
  { name: "automation_update", specFace: "static", workerReachable: false, reachableWhenReadOnly: false, mainSessionSideEffect: false },
  { name: "automation_delete", specFace: "static", workerReachable: false, reachableWhenReadOnly: false, mainSessionSideEffect: false },
  { name: "automation_run_now", specFace: "static", workerReachable: false, reachableWhenReadOnly: false, mainSessionSideEffect: false },
  { name: "automation_list", specFace: "static", workerReachable: false, reachableWhenReadOnly: false, mainSessionSideEffect: false },
  // web_fetch（出网查文档）：不是写向（不落盘、不改仓库）⇒ 只读档也留着——只读会话查文档是
  // 最正当的用法之一，把它按"写工具"摘掉就等于把"不写盘"误当成"不许学东西"。
  // worker 面不给是**原则性**的：worker 出网是无条件 deny（要联网只能回主会话发）。
  { name: "web_fetch", specFace: "static", workerReachable: false, reachableWhenReadOnly: true, mainSessionSideEffect: false },
];

/** 「缺谁」的单一实现——反向对照也走它，保证判据本身被测过而不是被调绿。 */
export function missingFromFace(names: readonly string[], face: ReadonlySet<string>): string[] {
  return names.filter((n) => !face.has(n));
}

/** 派活／撤活这一对的名字（唯一落点；`src/tools/cancel_agents.ts` 里的 `CANCEL_AGENTS_TOOL` 由判卷钉住与此一致）。 */
export const SPAWN_AGENT_NAME = "spawn_agent";
export const CANCEL_AGENTS_NAME = "cancel_agents";

/** 「派得出去、撤不回来」：撤活被摘（skill 的 disallowed-tools 只写了 `cancel_agents`）而派活仍在模型可见面内。
 *  为什么不拦这个组合：§9.3 承诺"插件申报什么就生效什么"，替作者配对是扩权（`allow` 刻意不跟扩是同一课）。
 *  要的是**在派活之前**把它说出口：派完才发现撤不掉，与派之前知道撤不掉，是两个不同的成本
 *  （可达性实测：`outputs/cancel-asymmetry-2026-09-27/measure.mts`，注脚今天只报名字不报后果）。 */
export function strandsWorkersOnSpawn(deniedNames: Iterable<string>, visibleNames: Iterable<string>): boolean {
  const denied = new Set(deniedNames);
  const visible = new Set(visibleNames);
  return denied.has(CANCEL_AGENTS_NAME) && visible.has(SPAWN_AGENT_NAME);
}
