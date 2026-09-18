/* 门 0（可达性）的解析与棘轮内核判据。
   脚本本体走 process.exit，所以可测部分（preload 解析、渲染层引用解析、棘轮双向差）单独钉——
   与 gate-manifest / assertion-health 同一处置理由（内核独立成模块正是为此）。 */
import { describe, expect, it } from "vitest";
import { parsePreload, parseRendererRefs, ratchetDiff } from "../scripts/ipc-reachability-check-core";

const PRELOAD = [
  "const api: AgentApi = {",
  '  run: (req: RunRequest) => ipcRenderer.invoke("agent:run", req),',
  "  decide: (askId: string, approved: boolean, scope?: string) =>",
  '    ipcRenderer.invoke("agent:decide", askId, approved, scope),',
  '  getSettings: (): Promise<AppSettings> => ipcRenderer.invoke("agent:settings-get"),',
  '  onEvent: (cb: (e: AgentEvent) => void) => subscribe<AgentEvent>("agent:event", cb),',
  "};",
].join("\n");

describe("parsePreload（跨行箭头体也要认到正确的方法名）", () => {
  it("invoke 归属最近的方法名；带返回类型注解不算漏；subscribe 记为 push", () => {
    expect(parsePreload(PRELOAD)).toEqual([
      { api: "run", channel: "agent:run", kind: "invoke" },
      { api: "decide", channel: "agent:decide", kind: "invoke" }, // 键在上一行，通道在下一行
      { api: "getSettings", channel: "agent:settings-get", kind: "invoke" }, // `(): Promise<T> =>` 形态
      { api: "onEvent", channel: "agent:event", kind: "push" },
    ]);
  });

  it("对象外的 ipcRenderer 调用不归属任何方法（不误挂到上一个键上）", () => {
    expect(parsePreload('ipcRenderer.invoke("agent:orphan");\n')).toEqual([]);
  });
});

describe("parseRendererRefs（别名形态）", () => {
  it("api.X / window.agent.X / agent?.X / api[\"X\"] 都算引用", () => {
    const refs = parseRendererRefs([
      "const api = window.agent;",
      "await api.run({ message });",
      "api?.compact();",
      'const s = await window.agent.getState();',
      'window["agent"]["listSessions"]();',
      'api["renameSession"](a, b);',
    ]);
    expect([...refs].sort()).toEqual(["compact", "getState", "listSessions", "renameSession", "run"]);
  });
});

describe("ratchetDiff（只减不增）", () => {
  it("新增孤儿与基线失效各自成列表（两个方向都算红）", () => {
    expect(ratchetDiff(["a:1", "b:2"], ["b:2", "c:3"])).toEqual({ added: ["a:1"], fixed: ["c:3"] });
    expect(ratchetDiff(["b:2"], ["b:2"])).toEqual({ added: [], fixed: [] });
  });
});
