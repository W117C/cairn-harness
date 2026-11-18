// 原生视图让位（第 1261 页登记，2026-11-18 审计接线）：账本的四个持有方 + 一个宿主。
//
// 背景（真缺陷）：`state/native-view-occlusion.ts` 2026-11-16 就写好了计数制账本，
// 但**零个消费者**——ModalSurface / CommandPalette / 拖放蒙层都没持有，BrowserPane 也没订阅。
// 于是「命令面板开在浏览器窗格上」时，原生 WebContentsView 照旧画在最上层：z-index 再高
// 也盖不过它（它不是 DOM）。这不是"还没做"，是"做了一半、缺两头"。
//
// 判据为什么读面（app-surface）：接线一旦搬家，读单文件的 not.toContain 会空过——
// 那条纪律见 AGENTS.md「a judge that asserts on renderer source text must read the whole app surface」。
import { describe, expect, it } from "vitest";
import { readAppSurface } from "./helpers/app-surface";

const src = readAppSurface();

describe("原生视图让位：持有方与宿主都接上账本", () => {
  it("持有方：模态面 / 命令面板 / 拖放蒙层各持一份", () => {
    // 模态面：挂载期间恒持有（卸载即释放；StrictMode 双跑靠计数+幂等释放兜住）。
    expect(src).toContain("useNativeViewOcclusion(true);");
    // 命令面板不走 ModalSurface（cmdk Dialog 自管焦点），按 open 受控持有。
    expect(src).toContain("useNativeViewOcclusion(open);");
    // 拖放蒙层不是模态（无焦点圈禁），但同样盖在窗格区上。
    expect(src).toContain("useNativeViewOcclusion(dragOverApp);");
  });

  it("宿主：BrowserPane 订阅让位账，隐藏时收成零矩形", () => {
    expect(src).toContain("const hiddenByOverlay = useNativeViewHidden();");
    // 贴合函数的前置条件里必须带让位账——少了它，浮层开着时视图会被重新贴回容器矩形。
    expect(src).toContain("if (!paneActiveRef.current || hiddenRef.current) { hideAllViews(); return; }");
    // 账本变化要驱动一次重贴合（只订阅不动作＝账记了但没人执行）。
    expect(src).toContain("}, [hiddenByOverlay]);");
    // 反面对照：让位账不许被当成 pane 活跃度用（那是另一件事：切标签页）。
    expect(src).not.toContain("paneActiveRef.current = props.active || hiddenByOverlay");
  });

  it("账本本身是计数制且释放幂等", () => {
    expect(src).toContain("export function holdNativeViewHidden(): () => void {");
    expect(src).toContain("if (holders === 0) emit();");
    // 重复释放安全（StrictMode 双跑不漏账）：这一行删掉，计数会掉成负数。
    expect(src).toContain("if (released) return;");
  });
});
