// 清除浏览数据前确认（2026-10-18）：菜单项带「…」却当场执行，且不可撤销；现在先弹内嵌确认，
// 取消不产生任何通知，确认后才真正清除。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const src = readFileSync(fileURLToPath(new URL("../src/renderer/components/PaneDock.tsx", import.meta.url)), "utf8");

describe("清除浏览数据确认", () => {
  it("菜单项只打开确认；不再直接 doClear", () => {
    expect(src).toContain("onSelect={() => { setConfirmClear(true); }}>清除浏览数据…</DropdownMenu.Item>");
    expect(src).toContain("const [confirmClear, setConfirmClear] = useState(false);");
  });

  it("确认卡说明不可撤销；取消/清除分别处理", () => {
    expect(src).toContain('role="alertdialog" aria-label="清除浏览数据"');
    expect(src).toContain("此操作不可撤销。");
    expect(src).toContain('onClick={() => { setConfirmClear(false); doClear(); }}>清除</button>');
    expect(src).toContain('onClick={() => { setConfirmClear(false); }}>取消</button>');
  });
});
