// kernel-host：内核装配单点（spec §3.2 预留 C 缝）。electron-free——
// headless 判卷直接 import；Electron main / 未来 utilityProcess 宿主都只消费本文件出口。
// 只装配、不实现：全部能力都是 src/main 既有出口的直调/小包装，缺的缝就地补一行。
// 装配出口是进程级单例：二次 createKernelHost 会静默覆盖前一次的装配
// （setAppHooks/initSettingsStore 等进程级出口「最后一个赢」），v0.1 契约是每进程只建一次。
import { join } from "node:path";
import type { AgentEvent } from "../../../../src/events";
import type { RunRequest, RunResponse, SessionInfoPayload } from "../../../../src/main/ipc-protocol";
import {
  handleAgentDecide,
  handleAgentRun,
  handleRunCancel,
  initMemoryHome,
  resolveProviderKind,
  setAppHooks,
  updateScheduleCap,
} from "../../../../src/main/agent-runner";
import {
  handleSessionCreate,
  handleSessionList,
  handleSessionOpen,
  initSessionsDir,
} from "../../../../src/main/session-handlers";
import { initSettingsStore, setSettingsHostDeps } from "../../../../src/main/settings-handlers";

export interface KernelHostDeps {
  workspace: string; // 当前工作区绝对路径
  userDataDir: string; // app userData（settings/日志）
  outbox: (channel: "onEvent" | "onAsk" | "onAskDone", payload: unknown) => void;
}

export interface KernelHost {
  run(req: RunRequest): Promise<RunResponse>;
  decide(askId: string, approved: boolean, scope?: "once" | "session_kind" | "always"): boolean;
  cancel(): Promise<{ ok: boolean; error?: string }>;
  listSessions(): Promise<SessionInfoPayload[]>;
  createSession(name?: string): Promise<{ id: string }>;
  openSession(id: string): Promise<{ events: AgentEvent[] }>;
}

export function createKernelHost(deps: KernelHostDeps): KernelHost {
  // 会话根按工作区解析（spec §4.1）：与 CLI 同根 <ws>/.agent/sessions
  initSessionsDir(join(deps.workspace, ".agent", "sessions"));
  initMemoryHome(join(deps.userDataDir, "memory"));
  // settings 存储挂 userData（task-3-brief 把这一行记在 setSettingsHostDeps 名下——实测
  // settings-handlers 的存储走独立出口 initSettingsStore(filePath)，宿主依赖面另两个回调：
  // provider 判定与 run 同源（resolveProviderKind），并发上限变更转发调度器缓存（updateScheduleCap）。
  initSettingsStore(join(deps.userDataDir, "settings.json"));
  setSettingsHostDeps({ resolveProviderKind, onScheduleCapChange: updateScheduleCap });
  // 工具注册面不在这里装：installAppTools 的能力 face（定时/目标/记忆/lsp/子代理）是进程级
  // 「第一个调用赢」的守卫量，而 runAgent 每场 run 会按真实状态（settings memo + 工作区 lsp 配置）
  // 算好 face 再自装（agent-runner.ts:1577）。装配点若抢跑，第二场的计算 face 与抢跑 face 不一致
  // 时当场硬拒（agent-runner.ts:1008），首场 run 直接废掉——实测踩中。产品路径（IPC run、调度器
  // serveScheduler）各自负责自己的 install 时机，装配点只挂 UI 回调与目录/存储。
  setAppHooks({
    onEvent: (e) => deps.outbox("onEvent", e),
    onAsk: (p) => deps.outbox("onAsk", p),
    onAskOutcome: (p) => deps.outbox("onAskDone", p),
  });

  return {
    run: (req) => handleAgentRun(req),
    decide: (askId, approved, scope) => handleAgentDecide(askId, approved, scope),
    // handleRunCancel 是同步出口（返回值即结果）；宿主面对壳许诺 Promise——async 包装补齐缝。
    cancel: async () => handleRunCancel(),
    listSessions: () => handleSessionList(),
    createSession: (name) => handleSessionCreate(name),
    openSession: (id) => handleSessionOpen(id),
  };
}
