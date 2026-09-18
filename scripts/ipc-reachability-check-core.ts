// ipc-reachability 的纯内核（解析 + 棘轮比对），单独成模块是为了**可单测**：
// 脚本本体顶层有 process.exit，直接 import 会把门禁跑起来（gate-manifest / assertion-health 同族处置）。
// 判据一律写在 JS 侧（AGENTS.md：BSD grep 不支持 \b \s \|，且静默返空）。

export interface BridgeRow {
  /** preload 暴露的方法名（渲染层按它调用）。 */
  api: string;
  /** IPC 通道名。 */
  channel: string;
  /** invoke/send = 渲染层主动调；push = 主进程推事件。 */
  kind: "invoke" | "send" | "push";
}

/** 逐行扫 preload：`identifier:` 起一个方法，其后（可跨行）出现的通道字面量归给它。 */
export function parsePreload(src: string): BridgeRow[] {
  const rows: BridgeRow[] = [];
  let current: string | null = null;
  for (const line of src.split("\n")) {
    const key = line.match(/^\s{2}(?:readonly\s+)?(\w+)\s*:/);
    if (key) current = key[1];
    if (!current) continue;
    const call = line.match(/ipcRenderer\.(invoke|send)\(\s*"([^"]+)"/);
    if (call) {
      rows.push({ api: current, channel: call[2], kind: call[1] as "invoke" | "send" });
      continue;
    }
    const sub = line.match(/(?:subscribe[\w<>,\s]*|ipcRenderer\.on)\(\s*"([^"]+)"/);
    if (sub) rows.push({ api: current, channel: sub[1], kind: "push" });
  }
  return rows;
}

/** 渲染层引用了哪些 preload 方法（api.X / window.agent.X / agent?.X / api["X"]）。 */
export function parseRendererRefs(sources: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (const src of sources) {
    for (const m of src.matchAll(/\b(?:api|agent|window\.agent)\??\.(?:\w+\.)*(\w+)\b/g)) out.add(m[1]);
    for (const m of src.matchAll(/\b(?:api|agent)\[\s*"(\w+)"\s*\]/g)) out.add(m[1]);
    // `window["agent"]["listSessions"]()` 这类全括号链：只认紧跟在 `"]["` 后的那个名字。
    // 多收的名字无害（判据是「与 preload 方法名求交」，收进来对不上号就当没引用）。
    for (const m of src.matchAll(/\]\s*\[\s*"(\w+)"\s*\]/g)) out.add(m[1]);
  }
  return out;
}

/** 渲染层直接写出的通道字面量（极少数绕方法名的用法也算引用）。 */
export function parseRendererChannels(sources: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (const src of sources) for (const m of src.matchAll(/["'`]((?:agent|plugin|update|window|shell):[\w-]+)["'`]/g)) out.add(m[1]);
  return out;
}

/** A2 棘轮比对：新增孤儿 / 基线已失效 各自成列表。 */
export function ratchetDiff(
  orphans: readonly string[],
  baseline: readonly string[],
): { added: string[]; fixed: string[] } {
  const o = new Set(orphans), b = new Set(baseline);
  return {
    added: [...o].filter((c) => !b.has(c)).sort(),
    fixed: [...b].filter((c) => !o.has(c)).sort(),
  };
}
