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
];

/** 「缺谁」的单一实现——反向对照也走它，保证判据本身被测过而不是被调绿。 */
export function missingFromFace(names: readonly string[], face: ReadonlySet<string>): string[] {
  return names.filter((n) => !face.has(n));
}
