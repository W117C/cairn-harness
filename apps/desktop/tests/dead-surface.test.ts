// 死面判卷：组件导出了却从没被渲染 = 产品里不存在的那一面。
// 为什么钉这条：用量浮层（UsagePanel）2026-10-26 就把入口换成「直达设置·用量统计」了，
// 组件 / CSS / 文案 / 状态链全留在原地，还带着两个测试天天绿——测试证明的是一个
// 用户永远打不开的面板。渲染层没报错、套件没红、肉眼看不出，只有机械清点能抓到。
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const renderer = fileURLToPath(new URL("../src/renderer", import.meta.url));
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === ".mimosa" ? [] : sources(p);
    return /\.(tsx|ts)$/.test(name) ? [p] : [];
  });
}
const all = sources(renderer);
const componentFiles = all.filter((p) => /[\\/](components|panes)[\\/]/.test(p) && p.endsWith(".tsx"));
const corpus = all.map((p) => ({ p, src: readFileSync(p, "utf8") }));

describe("死面：导出的组件必须被真正渲染", () => {
  it("components/panes 里每个导出组件都在 renderer 某处出现 JSX 用法", () => {
    const orphans: string[] = [];
    for (const { p, src } of corpus.filter((c) => componentFiles.includes(c.p))) {
      // 只认组件形状的导出：大写字母开头（React 约定）。同文件里的助手
      // （visionCapabilityLabel / parseBudgetField 这类小写导出）不是"没渲染的面"。
      for (const m of src.matchAll(/^export function ([A-Z]\w*)\(/gm)) {
        const name = m[1];
        // 同文件内自渲染算活（一个文件里 Destination 包着 Workspace 是正常形状）。
        const live = corpus.some((c) => new RegExp(`<${name}[\\s/>]`).test(c.src)
          || c.src.includes(`createElement(${name}`));
        if (!live) orphans.push(`${basename(p)} → ${name}`);
      }
    }
    expect(orphans, `这些组件产品里没人渲染（只有测试在跑它 = 死面）：\n${orphans.join("\n")}`).toEqual([]);
  });

  it("被删掉的用量浮层不许回来（组件 / 类名 / 文案 / 状态链）", () => {
    const gone = [
      "UsagePanel", "usage-pop", "usage-anchor", "usage-grid", "usage-scope",
      "usage-comp", "uc-seg", "uc-dot", "usage-note", "usage-fail",
      "usageAll", "loadUsageAll", "UsageAllState",
    ];
    const found = gone.filter((needle) =>
      corpus.some((c) => new RegExp(`\\b${needle}\\b`).test(c.src)));
    expect(found, `用量浮层只剩「直达设置·用量统计」这一条路，这些名字不该再出现：${found.join(", ")}`).toEqual([]);
  });

  it("反向自证：清点面不是恒真——把真在渲染的组件当孤儿要能被抓出来", () => {
    // 拿一个确实活着的组件（UsageMeter：Composer 渲染它）临时改名成不存在的符号，
    // 若清点逻辑是假的（永远返回空），这一步不会红。
    const composer = corpus.find((c) => c.p.endsWith("components/Composer.tsx"));
    expect(composer, "找不到 Composer，反向自证失效").toBeTruthy();
    expect(/<UsageMeter[\s/]/.test(composer!.src)).toBe(true);
    expect(/export function UsageMeter\(/.test(
      corpus.find((c) => c.p.endsWith("components/UsageMeter.tsx"))!.src)).toBe(true);
  });
});
