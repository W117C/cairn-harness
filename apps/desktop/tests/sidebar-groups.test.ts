import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
// groupByWorkspace 与哨兵常量迁居至 sessions-view.ts（P1-1 主界面重做；判据一字未动），
// 测试环境是 node，不渲染 JSX，只调函数。
import { groupByWorkspace, OTHER_WORKSPACE, type WorkspaceSession } from "../src/renderer/sessions-view";
import type { SessionInfoPayload } from "../../../src/main/ipc-protocol";

// 会话夹具：host.listSessions() 的 desktop 扩展形状（SessionInfoPayload & { workspace: string }）。
const ws = (id: string, workspace: string, mtimeMs = 0): WorkspaceSession => ({
  id,
  workspace,
  mtimeMs,
  lines: 1,
});

describe("groupByWorkspace（M3-3 分组侧栏纯函数）", () => {
  it("正常分组：会话按归属工作区落组，注册顺序即组序，组内保持输入序", () => {
    const groups = groupByWorkspace(
      [ws("s1", "/repo/a"), ws("s2", "/repo/b"), ws("s3", "/repo/a")],
      ["/repo/a", "/repo/b"],
    );
    expect(groups.map((g) => [g.workspace, g.sessions.map((s) => s.id)])).toEqual([
      ["/repo/a", ["s1", "s3"]],
      ["/repo/b", ["s2"]],
    ]);
  });

  it("空组也列：已注册工作区零会话仍出组（侧栏可见可切换），不挤掉也不重排", () => {
    const groups = groupByWorkspace([ws("s1", "/repo/a")], ["/repo/a", "/repo/empty"]);
    expect(groups.map((g) => g.workspace)).toEqual(["/repo/a", "/repo/empty"]);
    expect(groups.find((g) => g.workspace === "/repo/empty")?.sessions).toEqual([]);
  });

  it("未登记工作区的会话归「其他」组垫底，不静默吞数据", () => {
    const groups = groupByWorkspace(
      [ws("s1", "/repo/a"), ws("ghost1", "/ghost/x"), ws("ghost2", "/ghost/y")],
      ["/repo/a"],
    );
    // 「其他」恒垫底；哨兵不是任何真实工作区路径（真实工作区恒为绝对路径）
    expect(groups.map((g) => g.workspace)).toEqual(["/repo/a", OTHER_WORKSPACE]);
    expect(OTHER_WORKSPACE).not.toMatch(/^\//);
    // 「其他」组收拢全部未登记会话且保输入序
    expect(groups[1]!.sessions.map((s) => s.id)).toEqual(["ghost1", "ghost2"]);
    // 不吞数据：全会话恰好多分组一次（防 listProjects 与盘上漂移时丢会话）
    expect(groups.flatMap((g) => g.sessions).map((s) => s.id)).toEqual(["s1", "ghost1", "ghost2"]);
  });

  it("注册表为空 ⇒ 全部会话进「其他」，零丢失", () => {
    const groups = groupByWorkspace([ws("s1", "/repo/a"), ws("s2", "/repo/b")], []);
    expect(groups.map((g) => g.workspace)).toEqual([OTHER_WORKSPACE]);
    expect(groups[0]!.sessions.map((s) => s.id)).toEqual(["s1", "s2"]);
  });

  it("防御：workspaces 重复条目不产生重复组（registry 保 path 唯一，纯函数不信任上游）", () => {
    const groups = groupByWorkspace([ws("s1", "/repo/a")], ["/repo/a", "/repo/a"]);
    expect(groups.map((g) => g.workspace)).toEqual(["/repo/a"]);
    expect(groups[0]!.sessions.map((s) => s.id)).toEqual(["s1"]);
  });

  it("类型面：WorkspaceSession 是 SessionInfoPayload 的超集（workspace 必带）", () => {
    // 静态锚：缺 workspace 字段的对象不能当 WorkspaceSession 用（host 扩展字段是分组依据）
    const base: SessionInfoPayload = { id: "s", mtimeMs: 0, lines: 0 };
    expect(base.id).toBe("s");
    const widened: WorkspaceSession = { ...base, workspace: "/repo/a" };
    expect(groupByWorkspace([widened], ["/repo/a"])).toHaveLength(1);
  });
});

describe("置顶于组内（第十四遍：原型 §2.1「置顶于组内」）", () => {
  it("置顶恒浮组内最前；同层保持输入序（最近活动序），「其他」组同规", () => {
    const pw = (id: string, workspace: string, pinned: boolean): WorkspaceSession => ({ ...ws(id, workspace), pinned });
    const groups = groupByWorkspace(
      [
        pw("s1", "/repo/a", false),
        pw("s2", "/repo/a", true),
        pw("s3", "/repo/a", false),
        pw("s4", "/repo/a", true),
        pw("ghost1", "/ghost/x", false),
        pw("ghost2", "/ghost/y", true),
      ],
      ["/repo/a"],
    );
    expect(groups[0]!.sessions.map((s) => s.id)).toEqual(["s2", "s4", "s1", "s3"]);
    expect(groups[1]!.workspace).toBe(OTHER_WORKSPACE);
    expect(groups[1]!.sessions.map((s) => s.id)).toEqual(["ghost2", "ghost1"]);
  });

  it("全不置顶时原序不动（stable sort——旧口径「组内保持输入序」不被排序改写）", () => {
    const groups = groupByWorkspace([ws("s1", "/repo/a"), ws("s2", "/repo/a"), ws("s3", "/repo/a")], ["/repo/a"]);
    expect(groups[0]!.sessions.map((s) => s.id)).toEqual(["s1", "s2", "s3"]);
  });
});

// 源码哨兵（同 send-queue.test.ts 打断接线哨兵先例）：菜单五项与词族是「对齐原型 v3-lite」的
// 承诺面，行为测试测不到组件文面——缺行/改序/词面回退都在这里爆红灯。
// P1 主界面重做：词面单源迁至 strings.ts（源文禁裸中文），哨兵改指 STR 键序 + 值断言（口径不变）。
describe("对话菜单对齐原型 v3-lite（第十四遍；词面单源 STR——P1 重订）", () => {
  const sidebarSrc = readFileSync(new URL("../src/renderer/components/Sidebar.tsx", import.meta.url), "utf8");
  const appSrc = readFileSync(new URL("../src/renderer/App.tsx", import.meta.url), "utf8");

  it("五项菜单俱在且顺序同原型 ['置顶','重命名','分叉','归档','删除']", async () => {
    const { STR } = await import("../src/renderer/strings");
    // 锚到行菜单内容块（重命名输入框的 aria-label 也用 STR.sessionMenu.rename——先于菜单出现，
    // 裸 indexOf 会撞上它）：从「置顶」项首个标志串之后起量五项的相对顺序。
    const anchor = sidebarSrc.indexOf("a.onPin(s.pinned !== true)");
    expect(anchor, "行菜单内容块").toBeGreaterThan(-1);
    const idx = (needle: string): number => {
      const at = sidebarSrc.indexOf(needle, anchor);
      expect(at, needle).toBeGreaterThan(-1);
      return at;
    };
    const pin = idx("STR.sessionMenu.pin");
    const rename = idx("STR.sessionMenu.rename");
    const fork = idx("STR.sessionMenu.fork");
    const archive = idx("STR.sessionMenu.archive");
    const del = idx("STR.sessionMenu.delete");
    expect(pin).toBeLessThan(rename);
    expect(rename).toBeLessThan(fork);
    expect(fork).toBeLessThan(archive);
    expect(archive).toBeLessThan(del);
    // 词面（值与第十四遍口径逐字相同）
    expect([
      STR.sessionMenu.pin, STR.sessionMenu.unpin, STR.sessionMenu.rename,
      STR.sessionMenu.fork, STR.sessionMenu.archive, STR.sessionMenu.unarchive, STR.sessionMenu.delete,
    ]).toEqual(["置顶", "取消置顶", "重命名…", "分叉…", "归档…", "取消归档", "删除…"]);
  });

  it("词族统一「置顶」：置顶后行上钉形可见标记；旧「固定」词面全清", async () => {
    const { STR } = await import("../src/renderer/strings");
    expect(STR.sidebar.pinned).toBe("已置顶");
    expect(sidebarSrc).toContain("STR.sidebar.pinned"); // 行上 Pin 标记（此前置顶后零标记）
    expect(sidebarSrc).not.toContain("已固定");
    expect(sidebarSrc).not.toContain("取消固定");
  });

  it("分叉接线：App 走 round=0 全量分叉哨兵 + 菜单回调上抛 + 落点是 openSession（载转录，不是裸切 activeId），失败 fail-visible", () => {
    expect(appSrc).toContain("window.agent.forkSession(s.id, 0, true)");
    expect(appSrc).toContain("onForkSession={forkSessionFromMenu}");
    // 菜单能分非当前会话：只 activate 会把上个会话的流留在屏上 ⇒ 落点必须是 openSession(r.id)
    expect(appSrc).toContain("openSession(r.id);");
    expect(appSrc).toContain("分叉失败：");
  });

  it("行菜单点击不冒泡回行（Portal 事件沿 React 树回流 ⇒ 点菜单项被当成点行；真机判卷实证）", () => {
    expect(sidebarSrc).toContain("行菜单点击不得冒泡");
  });
});

// 第二十二遍（业主反馈「点文件夹那个框就可以展开/收起」）+ P1 合同（brief 第二节）：
// 文件夹行整行切换的源码哨兵。旧形态（组头点击=切归属、箭头独立点折）如果回归，在这里爆红灯。
describe("文件夹行整行展开/收起（第二十二遍；P1 合同重订——＋＝在此项目新任务）", () => {
  const sidebarSrc = readFileSync(new URL("../src/renderer/components/Sidebar.tsx", import.meta.url), "utf8");

  it("整行按钮走 toggleGroup(key)；箭头不再有自己的 onClick（旧小箭头独立点击形态清零）", () => {
    expect(sidebarSrc).toContain('className="group-toggle"');
    expect(sidebarSrc).toContain("aria-expanded={!isCollapsed}");
    expect(sidebarSrc).toContain("toggleGroup(key)");
    expect(sidebarSrc).not.toContain("e.stopPropagation(); toggleGroup(key)");
  });

  it("归属语义在行上「＋」（切归属 + 新任务面）；哨兵组无＋（新任务不能落未注册工作区）", () => {
    expect(sidebarSrc).toContain('className="g-new"');
    expect(sidebarSrc).toContain("props.onSwitchWorkspace(project.path);");
    expect(sidebarSrc).toContain("props.onNewTask();");
    // 哨兵守卫：临时对话组不渲染项目菜单与＋（两处都以 project !== null 为闸）
    expect(sidebarSrc).toContain("{project !== null && (");
    // 旧形态清零：组头不再是「点了只为切归属」的幽灵行为；旧徽标文案不再出现
    expect(sidebarSrc).not.toContain("if (!switchable) return;");
    expect(sidebarSrc).not.toContain("在这个文件夹里新对话");
  });
});

// 归档分区（2026-10-17 真机实证）：归档写入成功但侧栏照常显示；归档卡承诺的「移出常规列表」
// 与「筛选已归档可找回」当时都是空话。splitArchived 是分区判据（纯函数），侧栏两处消费。
import { fileURLToPath } from "node:url";
import { splitArchived } from "../src/renderer/sessions-view";

describe("splitArchived（归档分区）", () => {
  it("active / archived 互斥且并集完整、保输入序、不改入参", () => {
    const list = [{ id: "a" }, { id: "b", archived: true }, { id: "c" }, { id: "d", archived: true }];
    const { active, archived } = splitArchived(list);
    expect(active.map((x) => x.id)).toEqual(["a", "c"]);
    expect(archived.map((x) => x.id)).toEqual(["b", "d"]);
    expect(list.map((x) => x.id)).toEqual(["a", "b", "c", "d"]); // 入参未动
    expect([...active, ...archived].length).toBe(list.length);    // 零丢失
  });

  it("archived=false / 缺省都算常规（不误吞）", () => {
    const { active, archived } = splitArchived([{ archived: false }, {}, { archived: true }]);
    expect(active.length).toBe(2);
    expect(archived.length).toBe(1);
  });

  it("侧栏接线：常规组只吃 active；已归档单列并在组头显示计数", () => {
    const src = readFileSync(fileURLToPath(new URL("../src/renderer/components/Sidebar.tsx", import.meta.url)), "utf8");
    expect(src).toContain("splitArchived(props.sessions)");
    expect(src).toContain("groupByWorkspace(visibleActive");
    // 归档组渲染/计数都走 visibleArchived（2026-10-18 接通侧栏搜索后）：
    // 搜索时归档会话也要能命中并在归档组里显示，所以不能再直接 map archivedSessions。
    expect(src).toContain("visibleArchived.map");
    expect(src).toContain("visibleArchived.length");
    expect(src).toContain("STR.sidebar.archivedGroup");
  });
});
