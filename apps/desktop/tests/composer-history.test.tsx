// 已发提示历史（2026-10-18）：空输入框 ↑ 取上一条、↓ 往回走；只在空或正在翻历史时接管方向键，
// 菜单开着时由菜单先吃；一打字即退出历史浏览。按会话分桶（与草稿同一把键）。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { readAppSurface } from "./helpers/app-surface";

const src = readFileSync(fileURLToPath(new URL("../src/renderer/components/Composer.tsx", import.meta.url)), "utf8");
const app = readAppSurface();

describe("Composer 已发提示历史", () => {
  it("发送时入栈并重置游标；切换会话/打字都退出历史", () => {
    expect(src).toContain("historyRef.current.set(draftKeyRef.current, [sent, ...hist].slice(0, 50));");
    expect(src).toContain("histIndexRef.current = -1;");
    expect(src).toContain('e.key === "ArrowUp" || e.key === "ArrowDown"');
  });

  it("打开旧会话从投影行回填一次（本实例发过的以本地栈为准）", () => {
    expect(app).toContain("const promptHistory = useMemo(");
    expect(app).toContain("promptHistory={promptHistory}");
    expect(src).toContain("if (h === undefined || h.length === 0 || historyRef.current.has(draftKey)) return;");
    expect(src).toContain("historyRef.current.set(draftKey, [...h].slice(0, 50));");
  });

  it("只在空输入框或正在翻历史时接管", () => {
    expect(src).toContain('(text === "" || histIndexRef.current >= 0)');
    // 菜单位在历史块之前（菜单优先）
    const slashAt = src.indexOf("if (slashHits.length > 0) {");
    const histAt = src.indexOf("const hist = historyRef.current.get(draftKeyRef.current) ?? [];", slashAt);
    expect(slashAt).toBeGreaterThan(-1);
    expect(histAt).toBeGreaterThan(slashAt);
  });
});
