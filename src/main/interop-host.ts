/** 产品级 AgentClientV1 宿主：把 SDK/ACP 的 run 回调接到 `handleAgentRun` 的既有装配。
 *
 *  这里刻意不复制 provider、工具表、权限门或会话仓储：
 *  `handleAgentRun` 已经是 CLI/桌面共用的产品入口，ACP 走它才不会长成第二条执行面。
 *
 *  `unattended` 缺省 true：stdio 服务没有内建审批 UI，写工具必须 fail-closed；
 *  需要写能力的调用方显式使用 `mode:"auto"`（或先补 ACP 权限桥）。 */

import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { handleAgentRun, initSandbox } from "./agent-runner";
import { initMemoryHome } from "../agent/memory/store";
import { initSessionsDir } from "./session-handlers";
import { initSettingsStore } from "./settings-handlers";
import { pathOf } from "./sessions";
import type { PermissionMode } from "../permissions";
import type { AskGate } from "./ask-gate";
import {
  createAgentClientV1,
  type AgentClientRunContext,
  type AgentClientV1,
  type AgentClientHost,
} from "../interop/sdk";

export interface ProductInteropOptions {
  /** 固定工作区；session/new 的 cwd 必须解析到同一路径。 */
  workspace: string;
  mode?: PermissionMode;
  /** 缺省 true：没有审批 UI 时写工具 fail-closed。 */
  unattended?: boolean;
  /** 注入审批门（如 ACP 权限桥）：审批路由仍走 tool-gates 的 ask 通道，只是「问谁」换了。 */
  askGate?: AskGate;
  noAnswerer?: boolean;
  trustedRepo?: boolean;
  newSessionId?: () => string;
  newRunId?: () => string;
  now?: () => number;
}

export async function createProductAgentClientV1(opts: ProductInteropOptions): Promise<AgentClientV1> {
  const workspace = resolve(opts.workspace);
  const sessionsDir = join(workspace, ".agent", "sessions");
  await mkdir(join(workspace, ".agent"), { recursive: true });
  await mkdir(sessionsDir, { recursive: true });
  initSettingsStore(join(workspace, ".agent", "settings.json"), { source: "workspace" });
  initSessionsDir(sessionsDir);
  initMemoryHome(join(workspace, ".agent", "memory-home"));
  await initSandbox();

  const mode = opts.mode ?? "default";
  const unattended = opts.unattended ?? true;
  const host: AgentClientHost = {
    ...(opts.now !== undefined ? { now: opts.now } : {}),
    ...(opts.newSessionId !== undefined ? { newSessionId: opts.newSessionId } : {}),
    ...(opts.newRunId !== undefined ? { newRunId: opts.newRunId } : {}),
    run: async ({ session, text, signal, emit }: AgentClientRunContext) => {
      if (resolve(session.workspace) !== workspace) {
        throw new Error("session workspace is fixed to " + workspace + "; got " + session.workspace);
      }
      const result = await handleAgentRun(
        { message: text, mode },
        {
          workspace,
          sessionId: session.sessionId,
          logPath: pathOf(sessionsDir, session.sessionId),
          signal,
          onEvent: emit,
          unattended,
          ...(opts.askGate !== undefined ? { askGate: opts.askGate } : {}),
          ...(opts.noAnswerer ? { noAnswerer: true } : {}),
          ...(opts.trustedRepo ? { trustedRepo: true } : {}),
        },
      );
      if (!result.ok) throw new Error(result.error ?? "agent run failed");
    },
  };
  const client = createAgentClientV1(host);
  return {
    createSession(input) {
      if (resolve(input.workspace) !== workspace) {
        return Promise.reject(new Error("createSession: workspace is fixed to " + workspace));
      }
      return client.createSession({ ...input, workspace });
    },
    send: (session, input) => client.send(session, input),
    stream: (run, signal) => client.stream(run, signal),
    cancel: (run) => client.cancel(run),
    close: (session) => client.close(session),
  };
}
