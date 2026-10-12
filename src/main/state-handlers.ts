// agent:state 聚合面 + 插件面板/信任决议 + 孤儿 worktree 扫描 + 「此刻工作区」解析——拆分面
// （同 provider-key-inject 先例）：实现从 agent-runner.ts 搬来本轻模块，装配根按原路径继续导出。
// 本模块不反向依赖装配根：它需要装配根的三处活状态（缺省靶子 / 沙箱自检结果 / 最近一次 run 的日志
// 路径），由装配根启动时 `setStateHandlerDeps` 注入；插件面板留档快照随本面搬进来，装配根写完
// 一场 run 的快照经 `setPluginSnapshot` 交回（原先那行是直接写装配根的同名变量）。
import { homedir } from "node:os";
import { join } from "node:path";
import { replay } from "../events";
import { PluginRuntime, currentPluginRuntime, pluginDataRootOf, type PluginPanelSnapshot } from "../agent/plugins";
import { listWorktreeDirs, orphanWorktrees } from "../agent/worktree";
import type { MemorySnapshot, SidechatPanelSnapshot } from "./ipc-protocol";
import type { LicenseState } from "./license";
import { memorySnapshot } from "./memory-handlers";
import { getLastWorkspace } from "./runner-workspace";
import type { SandboxStatus } from "./sandbox";
import type { ScheduleSnapshot } from "./scheduler";
import { handleScheduleSnapshot } from "./scheduler-runtime";
import { handleSidechatState } from "./sidechat-handlers";
import { getAppVersion, handleLicenseStatus, handleProviderKeyStatus, store } from "./settings-handlers";

export interface StateHandlerDeps {
  /** 缺省靶子（装配根的 `WORKSPACE` 常量）。 */
  defaultWorkspace: () => string;
  /** 沙箱自检结果（装配根的可变状态，活读）。 */
  sandboxState: () => SandboxStatus;
  /** 「最近一次 run 的日志路径」（装配根的可变状态，活读）。 */
  lastLogPath: () => string | null;
}

let deps: StateHandlerDeps | null = null;
/** 装配根启动时注入（可重入：判卷 `vi.resetModules` 重组时按新装配根重注）。 */
export function setStateHandlerDeps(d: StateHandlerDeps): void {
  deps = d;
}
function D(): StateHandlerDeps {
  if (!deps) throw new Error("state-handlers: 装配根未注入依赖（唯一入口 setStateHandlerDeps）");
  return deps;
}

// M2e：最近一次 run 的插件面板快照（纯投影的留档，供 run 间隙的 agent:state 查询）。
let pluginSnapshot: PluginPanelSnapshot | null = null;
/** 装配根在一场 run 收束时把快照交进来（原来那行写的是装配根的同名变量）。 */
export function setPluginSnapshot(s: PluginPanelSnapshot | null): void {
  pluginSnapshot = s;
}

/** IPC "agent:state" 的处理函数。 */
export async function handleAgentState(): Promise<{ sandbox: SandboxStatus; memory?: MemorySnapshot; plugins?: PluginPanelSnapshot; sidechat?: SidechatPanelSnapshot; worktree?: { orphans: string[] }; schedule?: ScheduleSnapshot; license?: LicenseState; providerKeys?: { available: boolean; stored: string[]; envActive: boolean }; about?: { version: string } }> {
  let memory: MemorySnapshot | undefined;
  try {
    memory = await memorySnapshot();
  } catch {
    memory = undefined; // 快照失败不阻塞 state（沙箱状态是主应答）
  }
  let plugins: PluginPanelSnapshot | undefined;
  try {
    const rt = currentPluginRuntime();
    plugins = rt ? rt.snapshot() : (pluginSnapshot ?? await pluginSnapshotLite());
  } catch {
    plugins = undefined;
  }
  let sidechat: SidechatPanelSnapshot | undefined;
  try {
    sidechat = await handleSidechatState();
  } catch {
    sidechat = undefined;
  }
  // M3b 孤儿 worktree 扫描（§4.4.9：启动/会话重开语义 = state 拉取时现算；只列不自动删）
  let worktree: { orphans: string[] } | undefined;
  try {
    worktree = { orphans: await scanOrphanWorktrees() };
  } catch {
    worktree = undefined;
  }
  // M4a schedule 面板快照（真缺陷修复，半托截图路径抓出：schedule 通道挂了 IPC handler 但从未进 state 应答，
  // 面板 getState().schedule 恒 undefined → 任务列表/运行历史永久为空）
  let schedule: ScheduleSnapshot | undefined;
  try {
    schedule = await handleScheduleSnapshot();
  } catch {
    schedule = undefined;
  }
  // M4b：license 状态（valid/expired/inactive/invalid；未激活 → renderer 引导横幅）与 provider key 状态面
  let license: LicenseState | undefined;
  try {
    license = await handleLicenseStatus();
  } catch {
    license = undefined;
  }
  let providerKeys: { available: boolean; stored: string[]; envActive: boolean; envProviders: string[] } | undefined;
  try {
    providerKeys = await handleProviderKeyStatus();
  } catch {
    providerKeys = undefined;
  }
  return { sandbox: D().sandboxState(), memory, plugins, sidechat, worktree, schedule, license, providerKeys, about: { version: getAppVersion() } };
}

/** M3b 孤儿 worktree 扫描（纯投影面）：.agents/wt-* 目录 − 事件流有终态/收尾记录的 agent。 */
export async function scanOrphanWorktrees(workspace?: string): Promise<string[]> {
  const ws = workspace ?? (await currentWorkspace());
  const dirs = await listWorktreeDirs(ws);
  if (dirs.length === 0) return [];
  const lp = D().lastLogPath();
  const events = lp ? await replay(lp).catch(() => []) : [];
  return orphanWorktrees(
    dirs,
    events.map((e) => e as { type: string; agent_id?: string; status?: string; callId?: string }),
  );
}

/** 「此刻这个会话的工作区」的唯一答案：跑过就用最近一次 run 的，没跑过用**用户配置的**
 *  （settings.workspace），两者都没有才落到缺省靶子。
 *  此前有六处各写一份 `getLastWorkspace() ?? WORKSPACE`：一轮都没跑时，插件面板 / 信任决议 /
 *  孤儿 worktree 扫描 / sidechat 全都在扫 fixtures/todo-app，而不是用户真正打开的项目——
 *  面板上列出来的「已信任」可能根本是另一个仓的插件。 */
export async function currentWorkspace(): Promise<string> {
  const last = getLastWorkspace();
  if (last) return last;
  let conf: string | null = null;
  try {
    conf = (await store().get()).workspace;
  } catch {
    conf = null; // headless 脚本未装配 settings ⇒ 与旧行为一致（缺省工作区）
  }
  return conf ?? D().defaultWorkspace();
}

/** M2e run 装配与 M2g 运行间隙决议共用的插件运行时配置（信任文件路径的单一事实源在 PluginRuntime.load）。
 *  导出（第 438 页）是因为 `cairn --plugins` 也吃这一批根：CLI 若自己再拼一遍 env 与路径，
 *  它列出来的面可以和一次真 run 扫到的面不同——那正是「照着列表去批准」这条路最坏的失效。 */
export function pluginRuntimeOpts(workspace: string): Omit<Parameters<typeof PluginRuntime.load>[0], "mode"> {
  return {
    ...(process.env.M2E_USER_PLUGINS ? { userPluginsDir: process.env.M2E_USER_PLUGINS } : {}),
    projectPluginsDir: join(workspace, ".agent", "plugins"),
    ...(process.env.M2E_LOOSE_SKILLS ? { looseRoots: [process.env.M2E_LOOSE_SKILLS] } : {}),
    workspace,
    pluginDataRoot: pluginDataRootOf(process.env, homedir()),
    ...(process.env.M2E_TRUST_FILE ? { trustFile: process.env.M2E_TRUST_FILE } : {}),
  };
}

/** 运行间隙的冷快照：还没有 runtime（本进程一轮都没跑过）时也照样发现一次并留档。
 *  少了这一条，插件面板对「装了但从未跑过」的会话永远是空的——而那恰恰是唯一需要看到
 *  「待信任」并授权的时刻（§9.8 未信任不激活：没有列表就没有授权口）。
 *  与 handlePluginDecide 的 lite 分支同款配置、同样是只读发现（不 connectMcp、不跑钩子之外的动作）。 */
async function pluginSnapshotLite(): Promise<PluginPanelSnapshot> {
  const lite = await PluginRuntime.load(pluginRuntimeOpts(await currentWorkspace()));
  try {
    pluginSnapshot = lite.snapshot();
    return pluginSnapshot;
  } finally {
    await lite.shutdown().catch(() => {});
  }
}

/** IPC "agent:plugin-decide"：信任卡决议（批准/拒绝）→ 决议持久化 + 同样本重新激活（M2e §9.8）。
 *  M2g 收口修复：运行间隙（runtime 已回收）点击不再静默 ok:false——按 run 同款配置做一次轻量
 *  发现 + 决议落信任文件（下次 load 生效），留档快照同步改写（面板徽标即时反映）。 */
export async function handlePluginDecide(pluginName: string, trusted: boolean): Promise<{ ok: boolean; snapshot?: PluginPanelSnapshot }> {
  const rt = currentPluginRuntime();
  if (rt) {
    const found = await rt.trustDecide(pluginName, trusted);
    if (!found) return { ok: false };
    await rt.connectMcp(); // 信任后同样本开始生效（MCP 补连；hook 引擎已在重建后的 runtime 内）
    return { ok: true, snapshot: rt.snapshot() };
  }
  const lite = await PluginRuntime.load(pluginRuntimeOpts(await currentWorkspace()));
  let decided = false;
  try {
    decided = await lite.trustDecide(pluginName, trusted);
  } finally {
    await lite.shutdown().catch(() => {});
  }
  if (!decided) return { ok: false };
  if (pluginSnapshot) {
    pluginSnapshot = {
      ...pluginSnapshot,
      plugins: pluginSnapshot.plugins.map((p) => (p.name === pluginName ? { ...p, trust: trusted ? "trusted" : "declined" } : p)),
      // 审查 S2-12（任务 4.6）：散装 skill 走同一出口后，留档快照也要同步改写——否则运行间隙
      // 批准一个 loose skill，面板徽标仍停在「待信任」（rt 在场时走 rt.snapshot() 不受影响）。
      looseSkills: pluginSnapshot.looseSkills.map((l) => (l.name === pluginName ? { ...l, trust: trusted ? "trusted" : "declined" } : l)),
    };
  }
  return { ok: true, snapshot: pluginSnapshot ?? undefined };
}
