// /compact 命令化（2026-10-18）：斜杠项此前只是把字塞进输入框，发出去是普通消息；
// compact 通道又不带会话 id，主进程落到 lastLogPath（本进程没跑过就「无会话日志」，跑过也可能压错会话）。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const app = read("../src/renderer/App.tsx");

describe("/compact 命令", () => {
  it("斜杠命令被拦截为 compact 调用，而不是发消息", () => {
    expect(app).toContain('text.trim() === "/compact"');
    expect(app).toContain("void compact(sid).then((r) => {");
  });

  it("协议与 wired 表把活动会话 id 传给主进程（不再落到 lastLogPath）", () => {
    const proto = read("../../../src/main/ipc-protocol.ts");
    const wired = read("../src/main/index.ts");
    expect(proto).toContain("compact?(sessionId?: string): Promise<CompactResponse>;");
    expect(wired).toContain("compact: (sessionId) => handleCompact({ sessionId: sessionId as string | undefined })");
  });

  it("三处入口共用 compactNow（斜杠 / 上下文菜单 / 命令面板）", () => {
    expect(app).toContain("const compactNow = useCallback((): void => {");
    expect(app).toContain("if (text.trim() === \"/compact\") {\n      compactNow();");
    expect(app).toContain("onCompact={() => { compactNow(); }}");
    expect(app).toContain('case "compact":');
    const palette = read("../src/renderer/components/CommandPalette.tsx");
    expect(palette).toContain('{ id: "compact", label: "压缩当前会话历史" }');
  });
});
