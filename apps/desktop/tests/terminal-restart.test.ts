// 终端退出后就地重启（2026-10-18）：此前只能关窗格再开；现在 notice 上给「重新启动」，
// gen 递增触发 effect 重跑（旧 xterm dispose + kill，新会话接同一 host）。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const src = readFileSync(fileURLToPath(new URL("../src/renderer/components/PaneDock.tsx", import.meta.url)), "utf8");

describe("终端退出重启", () => {
  it("退出记录原因并显示重启按钮；gen 变化重跑 effect", () => {
    expect(src).toContain("const [exited, setExited] = useState<string | null>(null);");
    expect(src).toContain("setExited(why);");
    expect(src).toContain("}, [gen]);");
    expect(src).toContain(">重新启动</button>");
    expect(src).toContain("setGen((g) => g + 1);");
  });
});
