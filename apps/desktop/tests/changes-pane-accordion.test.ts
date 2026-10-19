// 检查器「变更」窗格按轮折叠（2026-10-18）：23 轮全展开会把检查器塞满；默认只展开最新一轮，
// 一次只开一轮（手风琴），头部保留轮号/文件数/验证状态。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const src = readFileSync(fileURLToPath(new URL("../src/renderer/components/PaneDock.tsx", import.meta.url)), "utf8");

describe("变更窗格按轮折叠", () => {
  it("默认展开最新一轮；一次只开一轮", () => {
    expect(src).toContain("useState<number | null>(() => (turns.length > 0 ? turns[turns.length - 1]!.round : null))");
    expect(src).toContain("onClick={() => { setOpenRound(openRound === t.round ? null : t.round); }}");
    expect(src).toContain("{openRound === t.round && (");
  });

  it("头部有 aria-expanded 的折叠钮；正文含文件列表与后果行", () => {
    expect(src).toContain('aria-expanded={openRound === t.round}');
    expect(src).toContain('aria-label={openRound === t.round ? "收起这一轮的改动" : "展开这一轮的改动"}');
    expect(src).toContain('<ul className="changes-list">');
    expect(src).toContain("未验证：{t.unverifiedFiles.join(\"、\")}");
  });
});
