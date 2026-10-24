// agent:state 聚合面 + 插件面板/信任决议 + 孤儿 worktree 扫描 + 「此刻工作区」解析——拆分面
// （同 provider-key-inject 先例）：实现从 agent-runner.ts 搬来本轻模块，装配根按原路径继续导出。
// 本模块不反向依赖装配根：它需要装配根的三处活状态（缺省靶子 / 沙箱自检结果 / 最近一次 run 的日志
// 路径），由装配根启动时 `setStateHandlerDeps` 注入；插件面板留档快照随本面搬进来，装配根写完
// 一场 run 的快照经 `setPluginSnapshot` 交回（原先那行是直接写装配根的同名变量）。
import { homedir } from "node:os";
import { projectAgentPath } from "../app-data";
import { replay } from "../events";
import { PluginRuntime, currentPluginRuntime, defaultForeignSources, pluginDataRootOf, type PluginPanelSnapshot } from "../agent/plugins";
import { ownedWorktreeAgentIds } from "../agent/orchestrator";
import { listWorktreeDirs, orphanWorktrees, worktreeDirty } from "../agent/worktree";
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
/** 该快照属于哪个工作区（2026-10-18）：快照不能跨项目复用——在 A 项目留档的空快照
 *  会让 B 项目的技能中心显示「还没有技能」，信任按钮也没有入口。 */
let pluginSnapshotWorkspace: string | null = null;
/** 装配根在一场 run 收束时把快照交进来（原来那行写的是装配根的同名变量）。 */
export function setPluginSnapshot(s: PluginPanelSnapshot | null, workspace: string | null = null): void {
  pluginSnapshot = s;
  pluginSnapshotWorkspace = workspace;
}

/** 面板快照取用器：任何一支旁路面板炸了，只让它自己缺席，不许把 state 主应答拖红。
 *
 * 2026-10-17 由七份同形 `try { x = await f() } catch { x = undefined }` 合一（结构债审查报告 #6-5）：
 * 同一件事抄七遍的后果是「为什么吞」只写了一遍——原先只有 memory 那份带注释，其余六份是裸
 * catch，下一个人分不清是刻意还是漏写。理由收在这里一次说清。
 *
 * **不**收窄到 `ENOENT`（审查给的另一个选项）：这里的意图是「面板失败即缺席」，不是「只吞文件
 * 不存在」。收窄等于把一支面板的异常升级成整条 IPC 的异常——那正好是这七份 catch 要防的事。
 */
async function optionalPanel<T>(f: () => Promise<T>): Promise<T | undefined> {
  try {
    return await f();
  } catch {
    return undefined;
  }
}

/** 斜杠菜单的技能清单（2026-10-18）：只取 `looseSkills` 的调用名/描述/信任态。
 *  与设置页「技能中心」同一份快照（冷启动时经 pluginSnapshotLite 现发现一次），不另建发现面。 */
export async function handleListSkills(workspaceOverride: string | null = null): Promise<{ skills: { invoke: string; description: string; trust: string }[]; commands: { invoke: string; description: string; trust: string }[] }> {
  // 不复用在档快照（cache=false）：斜杠菜单按「显式工作区」出清单，而在档快照可能是另一个
  // 工作区、或一轮 run 的留档——用它会让菜单列出别人的技能。发现是纯目录扫描，按需现做。
  const snap = await pluginSnapshotLite(workspaceOverride, false);
  // 插件容器里的技能也进菜单（调用名 = /plugin:skill，信任随插件）；散装技能在前。
  return {
    skills: [
      ...snap.looseSkills.map((s) => ({ invoke: s.invoke, description: s.description, trust: s.trust })),
      ...snap.plugins.flatMap((p) => p.skills.map((s) => ({ invoke: s.invoke, description: s.description, trust: p.trust }))),
    ],
    commands: snap.plugins.flatMap((p) => p.commands.map((c) => ({ invoke: c.invoke, description: c.description, trust: p.trust }))),
  };
}

/** IPC "agent:skill-body"：读 loose skill 的正文（设置页「读了再信任」）。
 *  一次 load + 读取 + shutdown；不 connectMcp、不跑 hook（只读发现，与插件面板同款配置）。
 *  正文超 20000 字符截断（面板滚动展示，不把一份巨大 SKILL.md 整个塞进 IPC）。 */
export async function handleSkillBody(name: string, workspaceOverride: string | null = null): Promise<{ ok: boolean; body?: string; truncated?: boolean; path?: string; error?: string }> {
  const target = String(name ?? "").trim();
  if (target === "") return { ok: false, error: "技能名为空" };
  const ws = workspaceOverride !== null && workspaceOverride !== "" ? workspaceOverride : await currentWorkspace();
  const lite = await PluginRuntime.load(pluginRuntimeOpts(ws));
  try {
    const want = target.replace(/^\/+/, "");
    const loose = lite.manifest.looseSkills.find((s) => s.name === target);
    // 容器插件技能：调用名 /plugin:skill（唯一）；散装技能按 name 查，两条路不互相猜。
    const pluginSkill = loose === undefined
      ? lite.manifest.plugins.flatMap((p) => p.skills).find((s) => s.plugin !== null && `${s.plugin}:${s.name}` === want)
      : undefined;
    const entry = loose?.entry ?? pluginSkill;
    if (entry === undefined) return { ok: false, error: `未找到技能：${target}` };
    const text = entry.body;
    const MAX = 20_000;
    const truncated = text.length > MAX;
    return { ok: true, body: truncated ? `${text.slice(0, MAX)}\n…（已截断）` : text, truncated, path: entry.path };
  } finally {
    await lite.shutdown().catch(() => {});
  }
}

/** IPC "agent:state" 的处理函数。 */
export async function handleAgentState(workspaceOverride: string | null = null): Promise<{ sandbox: SandboxStatus; memory?: MemorySnapshot; plugins?: PluginPanelSnapshot; sidechat?: SidechatPanelSnapshot; worktree?: { workspace: string; orphans: string[]; details?: { name: string; dirty: boolean }[] }; schedule?: ScheduleSnapshot; license?: LicenseState; providerKeys?: { available: boolean; stored: string[]; envActive: boolean }; about?: { version: string } }> {
  const memory = await optionalPanel(() => memorySnapshot(workspaceOverride));
  const plugins = await optionalPanel(async () => {
    // 工作区对不上就现发现：在档快照只服务它自己的项目（见 pluginSnapshotWorkspace）。
    const ws = workspaceOverride !== null && workspaceOverride !== "" ? workspaceOverride : await currentWorkspace();
    const rt = currentPluginRuntime();
    const rtWs = getLastWorkspace();
    if (rt !== null && (rtWs === null || rtWs === ws)) return rt.snapshot();
    if (pluginSnapshot !== null && pluginSnapshotWorkspace === ws) return pluginSnapshot;
    return pluginSnapshotLite(ws);
  });
  const sidechat = await optionalPanel(handleSidechatState);
  // M3b 孤儿 worktree 扫描（§4.4.9：启动/会话重开语义 = state 拉取时现算；只列不自动删）
  const worktree = await optionalPanel(async () => {
    const ws = workspaceOverride ?? (await currentWorkspace());
    const orphans = await scanOrphanWorktrees(ws);
    return {
      workspace: ws,
      orphans,
      // 逐棵读「有没有未提交改动」：清理是不可逆动作，界面必须先说清会丢什么。
      details: await Promise.all(orphans.map(async (name) => ({ name, dirty: await worktreeDirty(ws, name) }))),
    };
  });
  // M4a schedule 面板快照（真缺陷修复，半托截图路径抓出：schedule 通道挂了 IPC handler 但从未进 state 应答，
  // 面板 getState().schedule 恒 undefined → 任务列表/运行历史永久为空）
  const schedule = await optionalPanel(handleScheduleSnapshot);
  // M4b：license 状态（valid/expired/inactive/invalid；未激活 → renderer 引导横幅）与 provider key 状态面
  const license = await optionalPanel(handleLicenseStatus);
  // 面板只取三枚在场格（envProviders 归「能力在场性」通道，不进 state 应答）——显式收窄，同原实现。
  const providerKeys: { available: boolean; stored: string[]; envActive: boolean } | undefined =
    await optionalPanel(handleProviderKeyStatus);
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
    // 多会话共用一个 workspace：另一会话运行中/待合并的 worker 在本会话日志里没有终态，
    // 不能因此进「可清理」面板（目录是 workspace 级，事件流是 session 级）。
    new Set(ownedWorktreeAgentIds()),
  );
}

/** 「此刻这个会话的工作区」的唯一答案：跑过就用最近一次 run 的，没跑过用**用户配置的**
 *  （settings.workspace），两者都没有才落到调用方 cwd（2026-10-19 起；此前是
 *  `fixtures/todo-app`，见 `demo-scripted.ts` 的 `DEFAULT_WORKSPACE` 注释）。
 *  此前有六处各写一份 `getLastWorkspace() ?? WORKSPACE`：一轮都没跑时，插件面板 / 信任决议 /
 *  孤儿 worktree 扫描 / sidechat 全都在扫 fixtures/todo-app，而不是用户真正打开的项目——
 *  面板上列出来的「已信任」可能根本是另一个仓的插件。缺省值换成 cwd 之后，
 *  「一轮都没跑」这一格扫到的是调用方所在目录，仍然不是判卷 fixture。 */
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
    projectPluginsDir: projectAgentPath(workspace, "plugins"),
    ...(process.env.M2E_LOOSE_SKILLS ? { looseRoots: [process.env.M2E_LOOSE_SKILLS] } : {}),
    // 外部声明式来源：项目级恒扫（.opencode/.pi/.agents/.qoder/.claude）；用户级目录只在装配面显式带 home。
    // `M2E_FOREIGN_SOURCES=off` 关掉整顶——判卷要可复现，不能让结果取决于跑测试那台机器的 home。
    foreignSources: process.env.M2E_FOREIGN_SOURCES === "off" ? [] : defaultForeignSources(workspace, homedir()),
    workspace,
    pluginDataRoot: pluginDataRootOf(process.env, homedir()),
    ...(process.env.M2E_TRUST_FILE ? { trustFile: process.env.M2E_TRUST_FILE } : {}),
  };
}

/** 运行间隙的冷快照：还没有 runtime（本进程一轮都没跑过）时也照样发现一次并留档。
 *  少了这一条，插件面板对「装了但从未跑过」的会话永远是空的——而那恰恰是唯一需要看到
 *  「待信任」并授权的时刻（§9.8 未信任不激活：没有列表就没有授权口）。
 *  与 handlePluginDecide 的 lite 分支同款配置、同样是只读发现（不 connectMcp、不跑钩子之外的动作）。 */
async function pluginSnapshotLite(workspaceOverride: string | null = null, cache = true): Promise<PluginPanelSnapshot> {
  const lite = await PluginRuntime.load(pluginRuntimeOpts(workspaceOverride ?? await currentWorkspace()));
  try {
    const snap = lite.snapshot();
    if (cache) { pluginSnapshot = snap; pluginSnapshotWorkspace = workspaceOverride ?? await currentWorkspace(); }
    return snap;
  } finally {
    await lite.shutdown().catch(() => {});
  }
}

/** IPC "agent:plugin-decide"：信任卡决议（批准/拒绝）→ 决议持久化 + 同样本重新激活（M2e §9.8）。
 *  M2g 收口修复：运行间隙（runtime 已回收）点击不再静默 ok:false——按 run 同款配置做一次轻量
 *  发现 + 决议落信任文件（下次 load 生效），留档快照同步改写（面板徽标即时反映）。 */
export async function handlePluginDecide(pluginName: string, trusted: boolean, workspaceOverride: string | null = null): Promise<{ ok: boolean; snapshot?: PluginPanelSnapshot }> {
  const ws = workspaceOverride ?? await currentWorkspace();
  const rt = currentPluginRuntime();
  const rtWs = getLastWorkspace();
  if (rt !== null && (rtWs === null || rtWs === ws)) {
    const found = await rt.trustDecide(pluginName, trusted);
    if (!found) return { ok: false };
    await rt.connectMcp(); // 信任后同样本开始生效（MCP 补连；hook 引擎已在重建后的 runtime 内）
    return { ok: true, snapshot: rt.snapshot() };
  }
  const lite = await PluginRuntime.load(pluginRuntimeOpts(ws));
  let decided = false;
  try {
    decided = await lite.trustDecide(pluginName, trusted);
    if (!decided) return { ok: false };
    // 决议后 runtime 已自行重载 manifest，直接取新快照；在档快照（同工作区）作废，下次 state 现发现。
    if (pluginSnapshotWorkspace === ws) pluginSnapshot = null;
    return { ok: true, snapshot: lite.snapshot() };
  } finally {
    await lite.shutdown().catch(() => {});
  }
}
