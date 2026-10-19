// 独立窗格窗口标题（2026-10-18）：此前和主窗口一样叫「Cairn」，多开时分不清；现在带窗格名。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const src = readFileSync(fileURLToPath(new URL("../src/renderer/components/PopoutApp.tsx", import.meta.url)), "utf8");

describe("独立窗格标题", () => {
  it("按窗格类型设置 document.title", () => {
    expect(src).toContain('import { PANE_META } from "./panes";');
    expect(src).toContain("document.title = `Cairn · ${PANE_META[props.kind].label}${sid}`;");
    expect(src).toContain("props.sessionId.length > 24 ? `${props.sessionId.slice(0, 24)}…` : props.sessionId");
    expect(src).toContain("}, [props.kind, props.sessionId]);");
  });
});
