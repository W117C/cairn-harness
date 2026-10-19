// 侧栏 ↑↓ 导航判卷（2026-10-18 补 roving focus）。
//
// 缺口：会话行每行都可 Tab、可 Enter/Space 打开，但**没有方向键**——也没有 listbox/option 结构。
// 后果：① 换会话得逐行 Tab，还要穿过每行行内的「…」按钮，二十个会话就是二十次 Tab；
//       ② 读屏念不出「第几项 / 共几项」，也无从判断列表边界。
// 修法：.sidenav 升为 role=listbox，行升为 role=option（带 aria-selected / posinset / setsize），
//       ↑/↓ 在**看得见**的行之间移动焦点（折叠组的行仍在 DOM 里，必须滤掉）。
// 选中语义不变：option 的激活键仍是 Enter/Space，与 activates() 同口径。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sidebar = readFileSync(fileURLToPath(new URL("../src/renderer/components/Sidebar.tsx", import.meta.url)), "utf8");

describe("侧栏会话列表 ARIA 结构", () => {
  it(".sidenav 是 listbox（一组可选项、一次选一个的正解）", () => {
    expect(sidebar).toContain('<nav className="sidenav" role="listbox"');
  });

  it("行是 option，带选中态与位置读数", () => {
    expect(sidebar).toContain("role=\"option\"");
    expect(sidebar).toContain("aria-selected={s.id === props.activeId}");
    expect(sidebar).toContain("aria-posinset={props.posInSet}");
    expect(sidebar).toContain("aria-setsize={props.setSize}");
  });

  it("位置读数由渲染序算出（与 ↑↓ 依据同源）", () => {
    expect(sidebar).toContain("const flatOrder: readonly WorkspaceSession[] = [");
    expect(sidebar).toContain("posInSet={flatOrder.indexOf(s) + 1}");
    expect(sidebar).toContain("setSize={flatOrder.length}");
    // 归档组在末尾（与渲染顺序一致，不能漏）
    expect(sidebar).toContain("...visibleArchived,");
  });

  it("不再把行当裸 button（那会儿读屏报不出位置）", () => {
    const rowAt = sidebar.indexOf('data-session-id={s.id}');
    const row = sidebar.slice(rowAt - 200, rowAt + 200);
    expect(row).not.toContain('role="button"');
  });
});

describe("↑↓ 在会话之间移动焦点", () => {
  it("↑/↓ 都接，且 preventDefault（否则页面跟着滚）", () => {
    const at = sidebar.indexOf('if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;');
    expect(at).toBeGreaterThan(-1);
    const seg = sidebar.slice(at, at + 900);
    expect(seg).toContain("e.preventDefault()");
    expect(seg).toContain('e.key === "ArrowDown" ? 1 : -1');
  });

  it("Enter/Space 仍打开（选中语义不因改 role 而变）", () => {
    const at = sidebar.indexOf('if (e.key === "Enter" || e.key === " ") { e.preventDefault(); props.onOpen(s.id); return; }');
    expect(at).toBeGreaterThan(-1);
  });

  it("只把看得见的行算进移动序列（折叠组仍在 DOM 里）", () => {
    expect(sidebar).toContain('.querySelectorAll<HTMLElement>(".session")');
    expect(sidebar).toContain("el.getClientRects().length > 0");
    // 反向：不能用 [inert] 判（折叠组用的是 visibility:hidden，不是 inert）
    expect(sidebar).not.toContain('".session:not([inert])"');
  });

  it("到边界不环绕（rows[at±1] 为 undefined 时静默不动）", () => {
    expect(sidebar).toContain("next?.focus()");
    // 没有取模 ⇒ 首行按 ↑、末行按 ↓ 都是 no-op，不跳到另一端
    expect(sidebar).not.toMatch(/rows\[\(at \+ [^)]*\) % rows\.length\]/);
  });

  it("行内「…」按钮的方向键不冒泡触发行移动（只在宿主聚焦时处理）", () => {
    expect(sidebar).toContain("if (props.renaming || e.target !== e.currentTarget) return;");
  });
});
