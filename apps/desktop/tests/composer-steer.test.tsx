/** 运行中那颗「加入队列」钮必须**真的排队**（第 9 点，2026-10-23）。
 *
 *  动因：运行中回车改成「插话到本轮」之后，同一个 onSend 路径被两种意图共用。
 *  若队列钮也走默认语义，点「加入队列」的人会看到话被插进当前轮——**按钮在说谎**，
 *  而这类谎在界面上完全看不出来（两种结局都显示「发出去了」）。
 *  本判据钉的就是这一个分岔：队列钮传 `forceQueue`，回车不传。
 *
 *  本仓无 jsdom（见 render-structure.test.tsx 头注），所以走 SSR 结构 + 源码断言两面。
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Composer } from "../src/renderer/components/Composer";
import { STR } from "../src/renderer/strings";
import { showQueueButton } from "../src/renderer/components/Composer";

const composerSrc = readFileSync(fileURLToPath(new URL("../src/renderer/components/Composer.tsx", import.meta.url)), "utf8");

describe("运行中：插话与排队的两个入口不混", () => {
  it("队列钮的点击传 forceQueue（否则「加入队列」实际会插话）", () => {
    // 源码面：队列钮那一行的 onClick 必须带 forceQueue: true
    expect(composerSrc).toMatch(/showQueueButton[\s\S]{0,400}submit\(\{\s*forceQueue:\s*true\s*\}\)/);
  });

  it("回车 Enter 的那条路**不**传 forceQueue（默认=先试插话）", () => {
    // submit 的缺省调用点（Enter / 发送钮）不带这个参数 <<<
    expect(composerSrc).toMatch(/const submit = \(opts\?: \{ interrupt\?: boolean; forceQueue\?: boolean \}\)/);
    // 只有队列钮那一处传它；别处出现就是两种意图又混回去
    const occurrences = composerSrc.match(/forceQueue:\s*true/g) ?? [];
    expect(occurrences).toHaveLength(1);
  });

  it("运行中且有草稿 ⇒ 队列钮出现（与插入话路径同一判据）", () => {
    expect(showQueueButton(true, true)).toBe(true);
    expect(showQueueButton(true, false)).toBe(false); // 空输入只留打断钮
    expect(showQueueButton(false, true)).toBe(false); // 空闲时不需要队列钮
  });

  it("运行中 SSR：打断钮在位、输入可用、不摆常驻「回车排队」", () => {
    // props 形状照 composer-running.test.tsx 的 base（Composer 有多处必填的读数面）
    const base = {
      mode: "default" as const,
      activeId: "s1",
      providerInfo: null,
      pickerValue: null,
      usage: { inputTokens: 0, outputTokens: 0, usageCount: 0, cacheReadTokens: 0, lastInputTokens: 0 },
      phaseLabel: "执行工具",
      phase: "tool" as const,
      elapsedSec: 3,
      steps: 2,
      onSend: () => undefined,
      onCancel: () => undefined,
      onModeChange: () => undefined,
      onModelChange: () => undefined,
      onCompact: () => undefined,
    };
    const html = renderToStaticMarkup(<Composer {...base} running disabled={false} stopped={false} />);
    expect(html).toContain(`aria-label="${STR.composer.stopAria}"`);
    expect(html).not.toContain("回车排队");
    const ta = /<textarea[^>]*>/.exec(html)?.[0] ?? "";
    expect(ta).not.toContain("disabled"); // 运行中仍可打字（插话的前提）
  });
});
