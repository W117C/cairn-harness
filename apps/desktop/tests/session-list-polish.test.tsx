// 业主 23.13–23.16 四图批（会话列表 + 会话条）判卷：判卷先红——本文件先于实现落盘。
// 病灶（截图 + 蓝本对账）：
//   ① 侧栏长标题用「末端渐隐」切在半个字上——brief §2.1 明示「超长标题用省略号，不用渐隐」；
//   ② 行右侧相对时间 hover 才显（非选中行右侧全空）——brief §2.1 行三件套 = 状态图标 + 标题 +
//      右侧相对时间（常驻）；
//   ③ 时间桶分组只有无声间隔——brief §2.1「按时间分组（今天/昨天/过去7天/更早）」应有标签；
//   ④ 会话条（chat-bar）长标题：hover 只见动作提示读不到全文；点按进重命名后输入框停在串尾，
//      只露串中段碎片（业主截图：「件HTML，使用内联SV…」）。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Sidebar } from "../src/renderer/components/Sidebar";
import type { ProjectRecord } from "../../../src/main/ipc-protocol";

const styles = readFileSync(fileURLToPath(new URL("../src/renderer/styles.css", import.meta.url)), "utf8");
const sidebarSrc = readFileSync(fileURLToPath(new URL("../src/renderer/components/Sidebar.tsx", import.meta.url)), "utf8");
const appSrc = readFileSync(fileURLToPath(new URL("../src/renderer/App.tsx", import.meta.url)), "utf8");

/** 取 CSS 规则块正文（简单匹配：`.sel {` 到首个 `}`）。 */
function block(css: string, sel: string): string {
  const at = css.indexOf(sel + " {");
  expect(at, `样式缺 ${sel}`).toBeGreaterThan(-1);
  const end = css.indexOf("}", at);
  return css.slice(at, end);
}

const PROJECT: ProjectRecord = {
  id: "p1",
  name: "工作区甲",
  path: "/tmp/ws",
  defaultLocation: "/tmp/ws",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function sidebarHtml(sessions: Parameters<typeof Sidebar>[0]["sessions"]): string {
  return renderToStaticMarkup(
    <Sidebar
      projects={[PROJECT]}
      sessions={sessions}
      activeId={null}
      activeWorkspace={null}
      running={new Set<string>()}
      waitingIds={new Set<string>()}
      outcomes={new Map<string, "ok" | "failed">()}
      providerOk={null}
      theme="system"
      onThemeChange={() => undefined}
      usage={{ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, usageCount: 0, toolSteps: 0, rounds: 0 }}
      onOpen={() => undefined}
      onNewTask={() => undefined}
      onOpenPalette={() => undefined}
      onSwitchWorkspace={() => undefined}
      onAddProject={async () => undefined}
      onCloneProject={async () => undefined}
      onOpenNewProjectDialog={() => undefined}
      onUpdateProject={async () => undefined}
      onRemoveProject={async () => undefined}
      onRevealProject={() => undefined}
      onOpenSettings={() => undefined}
      onPickDirectory={() => Promise.resolve(null)}
    />,
  );
}

describe("① 长标题截断（brief §2.1：省略号，不用渐隐）", () => {
  it(".s-title 走 text-overflow: ellipsis，mask 渐隐退场", () => {
    const t = block(styles, ".s-title");
    expect(t).toContain("text-overflow: ellipsis");
    expect(t).not.toContain("mask-image");
    expect(styles).not.toContain("-webkit-mask-image: linear-gradient(90deg, hsl(var(--text-000))");
  });
});

describe("② 右侧相对时间常驻（brief §2.1 行三件套）", () => {
  it(".s-time 不再 visibility 藏匿，hover 揭布规则删除", () => {
    const t = block(styles, ".s-time");
    expect(t).not.toContain("visibility: hidden");
    expect(styles).not.toContain(".session:hover .s-time");
    expect(styles).not.toContain(".session:focus-visible .s-time");
  });
});

describe("③ 时间桶分组标签（今天/昨天/过去7天/更早）", () => {
  it("跨桶 SSR：两个桶标签都在场（顺序 = 今天在前、更早在后）", () => {
    const now = Date.now();
    const html = sidebarHtml([
      { id: "t1", title: "今天的活", mtimeMs: now - 60_000, lines: 1, workspace: "/tmp/ws" },
      { id: "t2", title: "很久的活", mtimeMs: now - 40 * 86_400_000, lines: 1, workspace: "/tmp/ws" },
    ] as Parameters<typeof Sidebar>[0]["sessions"]);
    const iToday = html.indexOf("今天");
    const iEarlier = html.indexOf("更早");
    expect(iToday).toBeGreaterThan(-1);
    expect(iEarlier).toBeGreaterThan(-1);
    expect(iToday).toBeLessThan(iEarlier);
    // 桶标签是独立行元素（不是塞进标题/时间）
    expect(sidebarSrc).toContain('className="s-bucket"');
    expect(sidebarSrc).toContain("BUCKET_LABEL");
  });
});

describe("④ 会话条重命名开态可读（业主截图：只露串中段）", () => {
  it("hover 提示 = 完整会话名 + 动作（先读全文，再决定改不改）", () => {
    expect(appSrc).toContain("title={`${sessionTitle} · 点按或按 F2 重命名`}");
  });
  it("开态聚焦：全选 + 视口回串首（chat-bar 与侧栏行内两处输入框同修）", () => {
    expect(appSrc).toContain("el.select()");
    expect(appSrc).toContain("el.scrollLeft = 0");
    expect(sidebarSrc).toContain("el.select()");
    expect(sidebarSrc).toContain("el.scrollLeft = 0");
  });
});
