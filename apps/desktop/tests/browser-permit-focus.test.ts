// 站点授权对话框（2026-10-18）：弹出时把焦点送进对话框（默认「允许本次」），否则键盘用户还停在地址栏。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const src = readFileSync(fileURLToPath(new URL("../src/renderer/components/PaneDock.tsx", import.meta.url)), "utf8");

describe("站点授权弹层", () => {
  it("pending 出现时聚焦允许本次", () => {
    expect(src).toContain("const permitFirstRef = useRef<HTMLButtonElement | null>(null);");
    expect(src).toContain("if (pending !== null) permitFirstRef.current?.focus();");
    expect(src).toContain("}, [pending]);");
    expect(src).toContain("<button ref={permitFirstRef} className=\"mini-btn primary\" onClick={() => allowAndGo(false)}>允许本次</button>");
  });

  it("对话框有三条动作与 aria 标签", () => {
    // 2026-10-18：弹层改为多行属性并加了 onKeyDown，role/aria 分开断言。
    expect(src).toContain('role="alertdialog"');
    expect(src).toContain('aria-label="站点授权"');
    expect(src).toContain('onClick={() => allowAndGo(true)}>记住该域</button>');
    expect(src).toContain('onClick={() => setPending(null)}>拒绝</button>');
  });
});
