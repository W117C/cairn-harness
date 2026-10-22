// 交互死点收口（2026-10-18）：快捷键按下去没有落点时，要么给回执，要么别消费按键。
// 判据分三层：纯函数/组件行为能测的就测；不能测的（全局键盘、焦点）钉接线与反向锚。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { userMessageCopy } from "../src/renderer/transcript";
import { readAppSurface } from "./helpers/app-surface";

const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const app = readAppSurface();
const composer = read("../src/renderer/components/Composer.tsx");
const picker = read("../src/renderer/components/ModelPicker.tsx");
const sidebar = read("../src/renderer/components/Sidebar.tsx");
const stream = read("../src/renderer/components/Stream.tsx");
const css = read("../src/renderer/styles.css");

describe("快捷键静默死点（F6/F7 + F5）", () => {
  it("⌘W：主页给回执；在跑的一轮回主页后说明它仍在后台", () => {
    // 2026-10-20 起这两条回执收在一处出口（⌘W 与原生菜单「关闭会话」共用），
    // 判据跟着从「键位块里有这两行」升到「出口里有这两行 + 两个入口都走它」。
    expect(app).toContain("const closeSessionToHome = useCallback((): void => {");
    expect(app).toContain("toast(STR.shortcut.alreadyHome)");
    expect(app).toContain("const wasRunning = runningSet.current.has(runKey(activeWorkspaceRef.current, sid));");
    expect(app).toContain("if (wasRunning) toast(STR.shortcut.leftRunning);");
    expect(app).toContain("h.closeSessionToHome();");
    expect(app).toContain('"close-session": closeSessionToHome,');
  });

  it("F2：startRename 返回是否落点；主页不再 preventDefault 后无动作", () => {
    expect(app).toContain("const startBarRename = useCallback((): boolean => {");
    expect(app).toContain("if (!h.startRename()) toast(STR.shortcut.renameNeedsSession);");
  });

  it("会话循环无会话时给回执（Ctrl+Tab / ⌘⇧[ / ⌘⇧] 三处 + 菜单两项，同一出口）", () => {
    // 2026-10-20：回执从「三个键位各抄一份」收成一处出口（菜单也走它），
    // 判据不再数散落的字面量，而是钉出口 + 入口数——散抄的那种写法改口径必漏。
    expect(app.match(/toast\(STR\.shortcut\.noSession\)/g)?.length).toBe(1);
    expect(app).toContain("const cycleSessionOrToast = useCallback((dir: 1 | -1): void => {");
    expect(app).toContain("const cycleSession = useCallback((dir: 1 | -1): boolean => {");
    // 五个入口：Ctrl+Tab、⌘⇧]、⌘⇧[、菜单「上一个/下一个会话」
    // 调用点 5 处（键位 3 + 菜单 2）；定义那行是 `= useCallback(` 不算调用，故这里是 5。
    expect(app.match(/cycleSessionOrToast\(/g)?.length).toBe(5);
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

describe("侧栏宽度把手（键盘 / 可读名 / 复位）", () => {
  it("范围与复位值取自常量——不再手写固定像素", () => {
    // 2026-10-21 设计重做：缺省 200 在 1440 宽下过窄（标题两行截断、画布失衡）⇒ 256；
    // 上限 320 让多项目/长标题有伸展空间。三个数仍只从常量来，把手文案跟着走。
    expect(app).toContain("const SIDEBAR_MIN = 200;");
    expect(app).toContain("const SIDEBAR_MAX = 320;");
    expect(app).toContain("const SIDEBAR_DEFAULT = 256;");
    expect(app).toContain("aria-label={`调整侧栏宽度（${SIDEBAR_MIN}–${SIDEBAR_MAX}px）`}");
    expect(app).toContain("title={`拖动调整侧栏宽度；双击回到 ${SIDEBAR_DEFAULT}px`}");
    expect(app).not.toContain("240–280px");
    expect(app).not.toContain("双击回到 240px");
    expect(app).toContain("persistSidebarWidth(SIDEBAR_DEFAULT)");
  });

  it("separator 暴露当前值与范围；左右键各步进 16px", () => {
    expect(app).toContain("aria-valuemin={SIDEBAR_MIN}");
    expect(app).toContain("aria-valuemax={SIDEBAR_MAX}");
    expect(app).toContain("aria-valuenow={sidebarWidth}");
    expect(app).toContain("sidebarWidthRef.current + (e.key === \"ArrowRight\" ? 16 : -16)");
  });
});

describe("窄窗检查器一键开（⌘⌥B）", () => {
  it("侧栏收起有 240ms 过渡：expand 排在过渡后，不再两个 rAF 抢跑", () => {
    // 2026-10-20 真机：880px 窗、侧栏 200、主组 680、inspector 0 时按 ⌘⌥B，storage 写成 "1"
    // 但宽度仍 0；再按一次才开。两个 rAF 时侧栏还在收起，expand 被布局夹回 0。
    expect(app).toContain('const expandDelay = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 260;');
    expect(app).toContain("window.setTimeout(() => { inspectorRef.current?.expand(); setInspectorCollapsed(false); }, expandDelay);");
    const revealBlock = app.slice(app.indexOf("const revealInspector = useCallback"), app.indexOf("revealInspectorRef.current = revealInspector"));
    expect(revealBlock).not.toContain("window.requestAnimationFrame");
    expect(revealBlock).toContain("INSPECTOR_SIDEBAR_COLLAPSE_BELOW");
  });
});
