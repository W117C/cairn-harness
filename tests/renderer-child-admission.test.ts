// 子流事件的界面准入（§4.4.4「父上下文唯一接收物 = agent_result」的渲染层那一半）。
//
// 起因（2026-09-21）：编排器给 worker 的 tool_call/正文/错误打上 agent_id，是为了**归因**；
// 渲染层拿到 agent_id 之后却只拿它分过桶（history-window），live 那支（app.js renderEvent）
// 压根没看——于是子模型说过的话被画进父会话的 AI 泡里。父从没说过那句话，界面却说它说了。
// 这不是样式问题，是**冒充**：右栏 agent 面板本来就在列每条 worker 的进展、工具与花费。
//
// 本文件判三件事：① 判据本身认的是「带不带归因」，不是把某类事件整块掐掉（每型都配反向对照）；
// ② 编排器那张归因表与界面这张黑名单必须**同源可对照**，新类型不许静默落进主流；
// ③ 两条渲染器共用同一个实现——判据一旦在界面里出现第二份，其中一支迟早悄悄少做几件事。
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { WORKER_STREAM_TYPES } from "../src/agent/worker-projection";
import {
  entersMainConversation,
  RENDERER_CHILD_DETAIL_TYPES,
} from "../src/renderer/projections";

/** 带归因、但**刻意留在主对话流**的类型。每条都有理由，删这条理由就得同时删这条记录。 */
const DELIBERATELY_KEPT: { type: string; why: string }[] = [
  { type: "usage", why: "底栏「这一会话花了多少」必须含 worker 的真钱，漏了就是少报成本" },
  { type: "verify_result", why: "写档 worker 的验证证据是合并/丢弃决策的输入，摘了等于失明" },
];

const hidden = (type: string) => !entersMainConversation({ type, agent_id: "w-a" });

describe("准入判据认归因，不认类型黑名单", () => {
  it.each([...RENDERER_CHILD_DETAIL_TYPES])("带归因的 %s 不进主流，摘掉归因就进", (t) => {
    expect(hidden(t)).toBe(true);
    expect(entersMainConversation({ type: t })).toBe(true);
  });

  it("空串归因按「不带」处理（legacy 流不得被静默清空）", () => {
    expect(entersMainConversation({ type: "assistant_message", agent_id: "" })).toBe(true);
  });

  it.each(DELIBERATELY_KEPT)("$type 带归因仍进主流：$why", ({ type }) => {
    expect(hidden(type)).toBe(false);
  });

  it.each(["agent_spawned", "agent_message", "agent_status", "agent_result", "approval_requested"])(
    "编排叙事 %s 带归因也进主流（worker 的审批卡就在主线等答复，藏掉等于这道门没人能答）",
    (t) => {
      expect(hidden(t)).toBe(false);
    },
  );

  it("子模型的正文不会凭空消失：它以 agent_message 的形态进主流（摘的是冒充，不是信息）", () => {
    // 反控「藏 = 丢信息」：编排器落带归因子流之外，另发一条 agent_message{kind:progress}
    // （orchestrator 的 workerPipeline，text = 同一段正文前 500 字，带 agent_id）。
    // ⇒ 修复前这句在主流上屏**两次**：一次冒充父发言（assistant_message 画的 AI 泡），
    //   一次是正确的（agent_message 画的「worker 消息」卡 + .tag 归因）。摘掉前者，后者照在。
    expect(entersMainConversation({ type: "assistant_message", agent_id: "w-a" })).toBe(false);
    // 只喂判据真正读的两位（type / agent_id）——它不读 kind，写进参数就是假装它读了。
    expect(entersMainConversation({ type: "agent_message", agent_id: "w-a" })).toBe(true);
  });

  it("黑名单与「刻意保留」恰好覆盖编排器归因表，且互斥", () => {
    for (const t of WORKER_STREAM_TYPES) {
      const kept = DELIBERATELY_KEPT.some((k) => k.type === t);
      // 既不在黑名单也没记在保留清单 = 新类型静默落进主流（正是要拦的那种漂移）
      expect(hidden(t) || kept, `${String(t)} 未被界面裁决：既没进子流黑名单也没记在刻意保留里`).toBe(true);
      expect(hidden(t) && kept, `${String(t)} 同时被判成隐藏和保留`).toBe(false);
    }
    // 界面独有的类型 = 编排器根本没归因的类型（那才是真缺陷，不许有）
    const unattributed = [...RENDERER_CHILD_DETAIL_TYPES].filter((t) => !WORKER_STREAM_TYPES.has(t as never));
    expect(unattributed).toEqual([]);
  });

  it("判据永不藏掉不带归因的事件（把父自己的正文藏掉才是真事故）", () => {
    for (const t of [...RENDERER_CHILD_DETAIL_TYPES, ...DELIBERATELY_KEPT.map((k) => k.type)]) {
      expect(entersMainConversation({ type: t }), t).toBe(true);
    }
  });
});

describe("两条渲染器共用同一个实现", () => {
  const app = readFileSync(new URL("../src/renderer/app.js", import.meta.url), "utf8");
  const hist = readFileSync(new URL("../src/renderer/history-window.js", import.meta.url), "utf8");

  it("两支都从 projections 取判据，且都不自己抄一份", () => {
    for (const [name, src] of [["app.js", app], ["history-window.js", hist]] as const) {
      expect(src, `${name} 未从 ./projections 导入判据`).toMatch(
        /import \{[^}]*\bentersMainConversation\b[^}]*\} from ['"]\.\/projections['"]/,
      );
      // 本地另写一份 = 两支迟早分叉（本文件存在的全部理由）
      expect(src, `${name} 自己声明了一份准入判据`).not.toMatch(
        /function entersMainConversation|CHILD_DETAIL_TYPES\s*=\s*new Set/,
      );
    }
  });

  it("live 那一支在 renderEvent 的第一句就把关（不是散落在各 case 里补）", () => {
    const at = app.indexOf("function renderEvent(e) {");
    expect(at).toBeGreaterThanOrEqual(0);
    const head = app.slice(at, app.indexOf("switch (e.type)", at));
    expect(head).toContain("if (!entersMainConversation(e)) return;");
  });

  it("重放那一支在产单元之前就把关（产完再筛会留下空单元行）", () => {
    const at = hist.indexOf("export function projectUnits(events) {");
    expect(at).toBeGreaterThanOrEqual(0);
    const head = hist.slice(at, hist.indexOf("AI_TEXT_TYPES.has(e.type)", at));
    expect(head).toContain("if (!entersMainConversation(e)) return;");
    expect(head).toContain('e.type === "usage"');
  });
});
