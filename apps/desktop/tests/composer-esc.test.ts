// 浮层 Esc 收口（2026-10-18）：斜杠菜单此前没有 Esc 路径；mention 只在“已有命中”时处理 Esc，
// 加载中/零命中时 Esc 落空。现在两条浮层统一走 menuDismissed：Esc 只关菜单、不动草稿，
// 文本一变就复位（继续打字会重新打开）。真机验过：/ → Esc 关闭且文本仍是 /；再敲 c 重新出现。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const src = readFileSync(fileURLToPath(new URL("../src/renderer/components/Composer.tsx", import.meta.url)), "utf8");

describe("Composer 浮层 Esc", () => {
  it("斜杠/mention 都受 menuDismissed 控制，文本变化复位", () => {
    expect(src).toContain('useState<"slash" | "mention" | null>(null)');
    expect(src).toContain("useEffect(() => { setMenuDismissed(null); }, [text]);");
    expect(src).toContain('menuDismissed === "slash" ? []');
    expect(src).toContain("const mentionVisible = mention !== null && menuDismissed !== \"mention\";");
  });

  it("外部点击/失焦 Esc 也能收；只豁免菜单自身与输入区", () => {
    expect(src).toContain("ref={cardRef}");
    expect(src).toContain('document.addEventListener("pointerdown", onPointer, true)');
    expect(src).toContain('document.addEventListener("keydown", onKey)');
    // 2026-10-18：豁免面从「整张卡片」收窄成「菜单自身 + 输入区」。旧判据钉的是
    // cardRef.current?.contains(t) === true（卡片内一律不关）——那正是两个弹层同屏叠放
    // 的根因：斜杠菜单开着再点模型/权限/附件钮，两个 pop 同时在场。
    // 现在只豁免 ①菜单（点选要走自己的 click）②textarea（继续打字），
    // 卡片内其它控件 = 用户去了别处，先收菜单。
    expect(src).toContain('t.closest(".slash-menu, .mention-menu, textarea") !== null');
    expect(src).not.toContain("cardRef.current?.contains(t) === true");
    // 卡片内仍挂 onDrop/onDragOver（cardRef 未被删，只是不再当豁免边界）
    expect(src).toContain("ref={cardRef}");
  });

  it("Esc 在 mention 导航之前处理，且不依赖命中数", () => {
    const escAt = src.indexOf('if (e.key === "Escape") {');
    const navAt = src.indexOf('if (mentionVisible && mentionList.length > 0) {');
    expect(escAt).toBeGreaterThan(-1);
    expect(navAt).toBeGreaterThan(escAt);
    expect(src).toContain('setMenuDismissed("slash")');
    expect(src).toContain('setMenuDismissed("mention")');
    // 旧行为（只在命中>0 时 Esc）已移除
    expect(src).not.toContain("if (mention !== null && mentionList.length > 0) {");
  });
});
