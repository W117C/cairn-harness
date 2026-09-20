// 澄清卡的 live 提交面（agent:clarify 的生产者）。
// 为什么这条只能钉源码：vm 切片要能跑就得给一个 200 行的 switch 造整棵 DOM 桩——那份桩子测的
// 东西不比断言多。所以这里钉**契约**（形状与顺序），真渲染与只读不变量由 panels-check B6 在真窗口里实测。
// 「桥名拼得对不对」不在本文件：门 0 的 A3 全仓查（findUnknownApiRefs）。这里曾把它当成
// 「门 0 管不到」而只钉字面量，结果字面量把 `api.clarify` 这个**不存在**的方法钉成了期望值，
// 测试绿、功能死（2026-09-20 P1）。钉字面量之前要先确认它在桥表里。
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const source = readFileSync(new URL("../src/renderer/app.js", import.meta.url), "utf8");
const at = source.indexOf("      case 'clarify_requested': {");
const end = source.indexOf("      case 'plan_proposed': {", at);
expect(at).toBeGreaterThanOrEqual(0);
expect(end).toBeGreaterThan(at);
const block = source.slice(at, end);

it("它有专属分支，不再退回通用记录支（连标签表里那份都撤了——两份渲染就是一张假卡）", () => {
  expect(block).toContain("clarify-send");
  expect(block).toContain("e.questions");
  const labels = source.slice(source.indexOf("const EVENT_LABELS = {"), source.indexOf("function eventLabel"));
  expect(labels).not.toContain("clarify_requested");
});

it("提交形状 = ClarifyAnswerMap 契约：key 用问题原文，value 单选标量 / 多选数组，且挂在原 callId 上", () => {
  expect(block).toContain("api.submitClarify(e.callId, answers)");
  expect(block).toContain("answers[q.question]");
  expect(block).toContain("q.multiSelect ? picked : picked[0]");
});

it("桥调用不做存在性兜底（`api.X ? … : null` 会把「方法不存在」报成「已被回答过」——假解释比抛错坏）", () => {
  expect(block).not.toMatch(/\bapi\.\w+\s*\?\s*await/);
});

it("一条都没答时不许把门解掉（空 map 会让模型拿不到任何信息还得重问）", () => {
  const guard = block.indexOf("Object.keys(answers).length === 0");
  const call = block.indexOf("api.submitClarify(");
  expect(guard).toBeGreaterThanOrEqual(0);
  expect(guard).toBeLessThan(call); // 拦在调用之前
  expect(block.slice(guard, call)).toContain("return;");
});

it("主进程说没送达就不许改口成「已回答」：置成功的语句必须排在 r !== true 之后", () => {
  const fail = block.indexOf("if (r !== true)");
  const done = block.indexOf("'已回答'");
  expect(fail).toBeGreaterThanOrEqual(0);
  expect(done).toBeGreaterThan(fail);
  expect(block.slice(fail, done)).toContain("return;");
});

it("callId 是外部字符串：只准进 dataset 与提交参数，不进 HTML 属性也不进选择器", () => {
  // 只看模板那一段（innerHTML 赋值 → appendChild）：跨整块去 [\s\S] 匹配会把后面的
  // api.submitClarify(e.callId) 也算进来，那是合法用法，判出来是假红。
  const tplStart = block.indexOf("c.innerHTML =");
  const tplEnd = block.indexOf("cardHost().appendChild(c);", tplStart);
  expect(tplStart).toBeGreaterThanOrEqual(0);
  expect(tplEnd).toBeGreaterThan(tplStart);
  const template = block.slice(tplStart, tplEnd);
  expect(template).not.toContain("e.callId");
  expect(block).not.toMatch(/querySelector\([^)]*e\.callId/);
  expect(block).toContain("c.dataset.clarifyCall = e.callId");
  expect(block).toContain("api.submitClarify(e.callId, answers)");
});

it("重放只读：提交面摘掉且输入全部 disabled（与 plan 卡同一不变量）", () => {
  const replay = block.slice(block.indexOf("if (rc.replay)"), block.indexOf("} else {"));
  expect(replay).toContain(".plan-acts");
  expect(replay).toContain("el.disabled = true");
});
