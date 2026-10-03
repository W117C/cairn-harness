// 桥面通道名唯一事实源。INVOKE_CHANNELS 的映射类型是完整性红线：
// AgentApi 新增方法而这里不加行 ⇒ typecheck 红（ipc-protocol 删键同理）。
import type { AgentApi } from "../../../../src/main/ipc-protocol";

export type PushChannel = "onEvent" | "onAsk" | "onAskDone";
export type InvokeChannel = Exclude<keyof AgentApi, PushChannel>;

export const PUSH_CHANNELS: { [K in PushChannel]: string } = {
  onEvent: "agent:event",
  onAsk: "agent:ask",
  onAskDone: "agent:ask-done",
};

export const INVOKE_CHANNELS: { [K in InvokeChannel]: string } = {
  run: "agent:run",
  decide: "agent:decide",
  submitClarify: "agent:clarify-submit",
  decidePlan: "agent:plan-decide",
  setGoal: "agent:goal-set",
  runCancel: "agent:run-cancel",
  compact: "agent:compact",
  getState: "agent:state",
  getProviderInfo: "agent:provider-info",
  getOnboarding: "agent:onboarding",
  getSettings: "agent:settings-get",
  setSettings: "agent:settings-set",
  listSessions: "agent:sessions-list",
  createSession: "agent:sessions-create",
  openSession: "agent:sessions-open",
  renameSession: "agent:sessions-rename",
  deleteSession: "agent:sessions-delete",
  listProjects: "agent:projects-list",
  addProject: "agent:projects-add",
  removeProject: "agent:projects-remove",
  setSessionPinned: "agent:session-pin",
  setSessionArchived: "agent:session-archive",
  assignSessionProject: "agent:session-assign",
  deleteMemory: "agent:memory-delete",
  pluginDecide: "agent:plugin-decide",
  sidechatCreate: "agent:sidechat-create",
  sidechatAsk: "agent:sidechat-ask",
  sidechatPromote: "agent:sidechat-promote",
  sidechatState: "agent:sidechat-state",
  cardAction: "agent:card-action",
  scheduleSnapshot: "agent:schedule-snapshot",
  scheduleUpsert: "agent:schedule-upsert",
  scheduleDelete: "agent:schedule-delete",
  scheduleRunNow: "agent:schedule-run-now",
  providerKeySet: "agent:provider-key-set",
  providerKeyDelete: "agent:provider-key-delete",
  providerKeyStatus: "agent:provider-key-status",
  checkUpdate: "agent:check-update",
  openExternal: "agent:open-external",
  // M4-5：dialog 选目录（M3 deferred 收口）——main 端 dialog.showOpenDialog({ openDirectory })，
  // preload 程序化桥自动透传（桥面无逐通道代码，缺行才红）。
  pickDirectory: "agent:pick-directory",
};
