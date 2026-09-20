/* 门 0（可达性）的解析与棘轮内核判据。
   脚本本体走 process.exit，所以可测部分（preload 解析、渲染层引用解析、棘轮双向差、桥名拼写）单独钉——
   与 gate-manifest / assertion-health 同一处置理由（内核独立成模块正是为此）。 */
import { describe, expect, it } from "vitest";
import { findUnknownApiRefs, parsePreload, parseRendererChannels, parseRendererRefs, ratchetDiff, stripCommentFaces } from "../scripts/ipc-reachability-check-core";

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
  it("新增孤儿桥 ⇒ added 点名（A2a 的判据：写一条 UI 不引用的桥就红）", () => {
    expect(ratchetDiff(["a:1", "b:2"], ["b:2", "c:3"]).added).toEqual(["a:1"]);
    expect(ratchetDiff(["b:2"], ["b:2"]).added).toEqual([]);
  });

  it("基线里的通道已接上 UI ⇒ fixed 点名（A2b 的判据：还留着欠账记录也算红）", () => {
    expect(ratchetDiff(["a:1", "b:2"], ["b:2", "c:3"]).fixed).toEqual(["c:3"]);
    expect(ratchetDiff(["b:2"], ["b:2"]).fixed).toEqual([]);
  });
});

describe("findUnknownApiRefs（A3：引用「有没有」之外还要问「写得对不对」）", () => {
  const apiNames = new Set(["run", "submitClarify", "renameSession"]);

  it("非表内的 api.X / api?.X 点名（桥名是本仓自己拼的，拼错＝调用静默变 undefined、卡片渲染得出按钮按不动）", () => {
    expect(findUnknownApiRefs(['await api.clarify(id, answers);', "api?.compact();"], apiNames)).toEqual([
      "clarify",
      "compact",
    ]);
  });

  it("表内名字不报；宽度只认独立别名 api（svc.api.list / window.agent.foo 都不收，同名对象不该被卷进来）", () => {
    expect(
      findUnknownApiRefs(
        ["await api.submitClarify(id, answers);", "const rows = svc.api.list();", "window.agent.whatever();"],
        apiNames,
      ),
    ).toEqual([]);
  });

  it("同一个错名调十次也只报一条（点名是「哪个名字不存在」，不是出现次数）", () => {
    expect(findUnknownApiRefs(["api.clarify(1);", "api.clarify(2);", "api.clarify(3);"], apiNames)).toEqual(["clarify"]);
  });

  it("注释里的桥名不算引用（否则一句话就能把棘轮的欠账记录抹掉）", () => {
    const stripped = [stripCommentFaces(
      [
        "/* 不写 api.submitClarify ? … : null 那种兜底 */",
        "// api.compact();",
        "<!-- agent:sessions-rename 曾接在这里 -->",
        "await api.run({ message });",
      ].join("\n"),
    )];
    expect([...parseRendererRefs(stripped)]).toEqual(["run"]);
    expect([...parseRendererChannels(stripped)]).toEqual([]);
    // 去注释后代码面只剩 api.run：表外名字为空，说明 A3 看的也不是散文
    expect(findUnknownApiRefs(stripped, new Set(["run"]))).toEqual([]);
  });

  it("行尾拖注释仍算代码（有意留的口子：剥它会把含 `//` 的字符串误吃成真引用丢失 = 假红）", () => {
    const refs = parseRendererRefs([stripCommentFaces("await api.getState(); // 顺带一提 api.compact")]);
    expect([...refs].sort()).toEqual(["compact", "getState"]);
  });
});
