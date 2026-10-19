// 交互死点收口（2026-10-18）：快捷键按下去没有落点时，要么给回执，要么别消费按键。
// 判据分三层：纯函数/组件行为能测的就测；不能测的（全局键盘、焦点）钉接线与反向锚。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { userMessageCopy } from "../src/renderer/transcript";

const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const app = read("../src/renderer/App.tsx");
const composer = read("../src/renderer/components/Composer.tsx");
const picker = read("../src/renderer/components/ModelPicker.tsx");
const sidebar = read("../src/renderer/components/Sidebar.tsx");
const stream = read("../src/renderer/components/Stream.tsx");
const css = read("../src/renderer/styles.css");

describe("快捷键静默死点（F6/F7 + F5）", () => {
  it("⌘W：主页给回执；在跑的一轮回主页后说明它仍在后台", () => {
    expect(app).toContain("toast(STR.shortcut.alreadyHome)");
    expect(app).toContain("const wasRunning = h.running;");
    expect(app).toContain("if (wasRunning) toast(STR.shortcut.leftRunning);");
  });

  it("F2：startRename 返回是否落点；主页不再 preventDefault 后无动作", () => {
    expect(app).toContain("const startBarRename = useCallback((): boolean => {");
    expect(app).toContain("if (!h.startRename()) toast(STR.shortcut.renameNeedsSession);");
  });

  it("会话循环无会话时给回执（Ctrl+Tab / ⌘⇧[ / ⌘⇧] 三处）", () => {
    expect(app.match(/toast\(STR\.shortcut\.noSession\)/g)?.length).toBe(3);
    expect(app).toContain("const cycleSession = useCallback((dir: 1 | -1): boolean => {");
  });

  it("输入区锁定时 ⌘⇧I/M/E 说清原因，不再静默无效", () => {
    expect(app).toContain("const composerLock = composerLockReason({");
    expect(app).toContain("const composerMenuBlock = composerLock === \"queue\"");
    expect(app).toContain("STR.shortcut.menuLockedQueue");
    expect(app).toContain("STR.shortcut.menuLockedCreating");
    expect(app).toContain("STR.shortcut.menuLockedGate");
    // 三键都必须先看锁再开菜单（反向：任何一键少了提示就会有一条 openComposerMenu 裸调用）
    expect(app.match(/if \(h\.composerMenuBlock !== null\) toast\(h\.composerMenuBlock\);/g)?.length).toBe(3);
    expect(app.match(/else h\.openComposerMenu\("(model|perm|effort)"\);/g)?.length).toBe(3);
  });

  it("锁因同时驱动占位文案（真机抓到：门未决曾写成「正在创建会话…」）", () => {
    expect(app).toContain("{...(composerLock !== null ? { disabledReason: composerLock } : {})}");
    expect(composer).toContain('disabled && props.disabledReason === "gate" ? STR.composer.placeholderGate');
    expect(composer).toContain('disabled && props.disabledReason === "queue" ? STR.composer.placeholderQueue');
    expect(composer).toContain('disabled && props.disabledReason === "creating" ? STR.composer.placeholderCreating');
  });
});

describe("⌘⇧E 的落点（不再与 ⌘⇧I 完全同路）", () => {
  it("信号层：effort → pickerFocus=effort；model → model；用户点开复位 model", () => {
    expect(composer).toContain('setPickerFocus(sig.kind === "effort" ? "effort" : "model");');
    expect(composer).toContain('onUserOpen={() => setPickerFocus("model")}');
    expect(composer).toContain("initialFocus={pickerFocus}");
  });

  it("菜单层：effort 首帧聚焦思考分段（禁用时聚焦分组本身），带可驱动锚点", () => {
    expect(picker).toContain('if (props.initialFocus !== "effort") { searchRef.current?.focus(); return; }');
    expect(picker).toContain('box.querySelector<HTMLButtonElement>("button:not(:disabled)") ?? box');
    expect(picker).toContain('data-effort-anchor="true"');
    expect(picker).toContain("target.focus({ preventScroll: true });");
    expect(picker).toContain('target.scrollIntoView({ block: "nearest" });');
  });
});

describe("行级复制补附件（与整段转录同一份格式）", () => {
  it("userMessageCopy：正文 + 附件清单；空正文只有附件也成文", () => {
    expect(userMessageCopy("看这个", [{ path: "/ws/a.txt", kind: "file" }]))
      .toBe("看这个\n\n附件：\n- 文件：`/ws/a.txt`");
    expect(userMessageCopy("  ", [{ path: "/ws/d", kind: "directory" }]))
      .toBe("附件：\n- 目录：`/ws/d`");
    expect(userMessageCopy("纯正文")).toBe("纯正文");
  });

  it("用户行复制走同一函数（不再只传 r.text）", () => {
    expect(stream).toContain("userMessageCopy(r.text, r.attachments)");
    expect(stream).not.toContain("onCopyText?.(r.text)");
  });
});

describe("侧栏首屏：加载 ≠ 空，失败 ≠ 空", () => {
  it("Sidebar 接 loading / loadError / onRetryLoad，并有骨架与重试", () => {
    expect(sidebar).toContain("loading?: boolean;");
    expect(sidebar).toContain("loadError?: boolean;");
    expect(sidebar).toContain('aria-busy={props.loading === true}');
    expect(sidebar).toContain("side-skeleton-row");
    expect(sidebar).toContain("STR.sidebar.loadFailed");
    expect(sidebar).toContain("props.onRetryLoad");
  });

  it("App：读取失败被接住，但不放行启动恢复（否则会顺手清掉上次会话键）", () => {
    expect(app).toContain("const [sessionsLoadError, setSessionsLoadError] = useState(false);");
    expect(app).toContain("setSessionsLoadError(true);");
    // 反向锚：失败分支里不许出现 setSessionsLoaded(true)（成功分支里有且仅有一处）
    const failBranch = app.slice(app.indexOf("setSessionsLoadError(true);"), app.indexOf("}, []);", app.indexOf("setSessionsLoadError(true);")));
    expect(failBranch).not.toContain("setSessionsLoaded(true)");
    expect(app).toContain("loading={!sessionsLoaded && !sessionsLoadError}");
    expect(app).toContain("const retrySessions = useCallback(() => {");
    expect(app).toContain("loadError={sessionsLoadError}");
    expect(app).toContain("onRetryLoad={retrySessions}");
  });

  it("CSS：骨架条只表示读取中（reduced-motion 由全局块停掉动画）", () => {
    expect(css).toContain(".side-skeleton-row {");
    expect(css).toContain("animation: breathe 1.6s ease-in-out infinite;");
  });
});
