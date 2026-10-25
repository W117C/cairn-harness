// 会话切换/事件流的跨会话污染判卷（2026-10-19 独立评审追出的一组真缺陷）。
// 这些缺陷的共同形状：App 在「旧会话的数据」与「新会话的身份」之间短暂（或永久）错位，
// 用户看到的卡/转录/动作属于 A，点下去却作用于 B。判据全部落在源码接线处（本仓无 jsdom，
// 交互逻辑走「纯函数 + 接线见证」两面，见 render-structure.test.tsx 头注）。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { readAppSurface } from "./helpers/app-surface";

const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const app = readAppSurface();
const composer = read("../src/renderer/components/Composer.tsx");
// 投影真身已搬进 derived/（Phase 2 · 批 2.2）：projections.ts 现在只是门面（逐名转发），
// 判据要看的**函数体**在 derived/session.ts ⇒ 读那一份（读面迁移，不是改判据）。
const projections = read("../src/renderer/derived/session.ts");

const between = (src: string, start: string, end: string): string => {
  const i = src.indexOf(start);
  const j = src.indexOf(end, i + start.length);
  expect(i).toBeGreaterThan(-1);
  expect(j).toBeGreaterThan(i);
  return src.slice(i, j);
};

describe("主会话运行旗：worker 终态不得摘旗", () => {
  it("onEvent 用 isMainSessionTerminalEvent，而不是内联 status 判定", () => {
    expect(app).toContain("const terminal = isMainSessionTerminalEvent(e);");
    // 反面对照：旧形状（只按 type/status 判）不许回来。
    expect(app).not.toMatch(/e\.type === "agent_status" &&\s*\(\(e as \{ status\?: string \}\)\.status === "done"/);
  });

  it("判据本身排除带 agent_id 的子流终态", () => {
    expect(projections).toContain("export function isMainSessionTerminalEvent");
    const fn = between(projections, "export function isMainSessionTerminalEvent", "\n}");
    expect(fn).toContain("isWorkerSubflowEvent(e)");
  });
});

describe("打开会话：先清旧流，读盘期间的增量要合并", () => {
  it("openSession 在发 IPC 前清空事件，并把 live 增量收集到 openPending", () => {
    const open = between(app, "const openSession = useCallback", "const queued = window.agent.queueGet");
    const clearAt = open.indexOf("setEvents([]);");
    const pendingAt = open.indexOf("openPending.current = pending;");
    const callAt = open.indexOf("window.agent.openSession(id, sessionWs ?? undefined)");
    expect(clearAt).toBeGreaterThan(-1);
    expect(pendingAt).toBeGreaterThan(-1);
    expect(callAt).toBeGreaterThan(-1);
    expect(clearAt).toBeLessThan(callAt);
    expect(pendingAt).toBeLessThan(callAt);
  });

  it("回包用 mergeSessionSnapshot（快照 + 增量），不在读盘窗口丢流式文本", () => {
    expect(app).toContain("setEvents(mergeSessionSnapshot(r.events, pending.events));");
    expect(app).toContain("openPending.current.events.push(e);");
  });

  it("分叉 / 编辑走 openSession（裸 activate 会把旧转录留在屏上）；回放已撤（2026-10-24）", () => {
    for (const marker of ["handleBranch", "handleEditUser"]) {
      const block = between(app, `const ${marker} = useCallback`, "\n  }, [");
      expect(block).toContain("openSession(");
    }
    // 反向：这三条路径里不许再出现裸 activate(r.id)（rename 换 id 是唯一合法处）。
    expect(app).not.toContain("activate(r.id); // 分叉");
    expect(app).not.toContain("activate(id);\n      injectText");
  });
});

describe("审批卡按会话键控：并发门互不覆盖", () => {
  it("卡存 Map<sessionId, 卡>，渲染只取当前会话那张", () => {
    expect(app).toContain("const [askBySid, setAskBySid] = useState<ReadonlyMap<string, AskPayload>>(new Map());");
    expect(app).toContain("askBySid.get(activeId) ?? askBySid.get(\"\")");
  });

  it("onAskDone 只删这一张 askId，不再清空整张表", () => {
    const done = between(app, "const offDone = window.agent.onAskDone", "return () =>");
    expect(done).toContain("payload.askId === p.askId");
    expect(done).not.toContain("askById.current.clear();");
  });
});

describe("排队消息按派发时的权限档执行", () => {
  it("runOn 读 modeRef.current，不捕获起跑时的 mode 值", () => {
    expect(app).toContain("const modeRef = useRef(mode);");
    expect(app).toContain("mode: modeRef.current, sessionId: sid");
    expect(app).not.toContain("message: msg.text, mode, sessionId: sid");
  });
});

describe("Esc 不被常驻侧栏 listbox 短路", () => {
  it("浮层选择器排除 .sidenav，其余 listbox 仍优先关浮层", () => {
    expect(app).toContain("[role='listbox']:not(.sidenav)");
    expect(app).not.toContain("'.pop.show, .pop-rd, [role=\\'menu\\'][data-state=\\'open\\'], [role=\\'listbox\\']\"");
  });
});

describe("Composer：失败回滚 / 重命名迁移 / 建议与注入的序号守卫", () => {
  it("发送失败把原文与附件还给对应会话（切走只存桶）", () => {
    expect(app).toContain("setDraftRestore({ forSession: id ?? null, text, attachments");
    expect(composer).toContain("props.restoreDraft");
    const effect = between(composer, "const lastRestore = useRef(0);", "const lastInjectedAttachment");
    expect(effect).toContain("key !== draftKeyRef.current");
    expect(effect).toContain("draftKeyFor(props.workspacePath, r.forSession)");
    expect(effect).toContain("draftsRef.current.set(key, r.text)");
  });

  it("重命名换 id 时草稿/附件桶跟着搬家", () => {
    expect(composer).toContain("props.draftRemap");
    const effect = between(composer, "const lastRemap = useRef(0);", "const lastRestore = useRef(0);");
    expect(effect).toContain("draftsRef.current.set(toKey, moved)");
    expect(effect).toContain("attachByKey.current.set(toKey, movedAttach)");
  });

  it("想下一条带会话代际号：切走后迟到结果作废", () => {
    expect(composer).toContain("const suggestSeq = useRef(0);");
    expect(composer).toContain("suggestSeq.current += 1;");
    expect(composer).toContain("if (suggestSeq.current !== my) return;");
  });

  it("同一段建议连点两次也会重新填入（seq 递增）", () => {
    expect(app).toContain("setInjectedTextSeq(++injectedSeqRef.current)");
    expect(composer).toContain("props.injectedTextSeq");
    expect(composer).toContain("seq !== 0 && seq !== lastInjectedSeq.current");
  });
});
