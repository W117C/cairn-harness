// 主会话系统提示词的纪律面（能力 2/5 的「说一次、每轮都吃」成本面）。
// 为什么值得锁：BASE_SYSTEM 此前从未有测——删掉任何一条纪律都不会红，而每条都对应一个真实返工面。
// 同时它每轮重送（静态段），所以体积也要有上界，不能靠不断加句子来"教"模型。
import { describe, expect, it } from "vitest";
import { BASE_SYSTEM } from "../src/main/agent-runner";

const rule = (n: number): string => {
  const line = BASE_SYSTEM.split("\n").find((l) => l.startsWith(String(n) + ")"));
  if (line === undefined) throw new Error("缺第 " + String(n) + ") 条纪律");
  return line;
};

describe("BASE_SYSTEM 纪律面", () => {
  it("六条纪律编号连续（缺号=模型读到断号，会以为后面的约束可省）", () => {
    for (let i = 1; i <= 6; i++) expect(rule(i).length).toBeGreaterThan(0);
    expect(BASE_SYSTEM).not.toContain("7)");
  });

  // 身份行不写产品旧名、也不把交付面说成桌面壳：业主裁决「桌面不作 v1 交付面」，而交付面就是
  // electron-free 的 agent 本体。为什么值得钉：这句是模型每轮第一眼看的东西，把它读成"我做的是桌面
  // 应用"就会在改核心时替 UI 让路；而旧品牌串正在被逐笔改名（`bin/`、env 名），没有守卫就会漂回来。
  it("身份行没有旧品牌串、也不自称桌面（交付面是 agent 本体）", () => {
    const head = BASE_SYSTEM.split("\n")[0] ?? "";
    expect(head.length).toBeGreaterThan(0);
    expect(head).not.toContain("M0");
    expect(head).not.toContain("桌面");
  });

  it("先红后绿写进纪律：修 bug 必须先有跑到红的复现，没红过不得宣称修好（能力 5 的正面）", () => {
    const r4 = rule(4);
    expect(r4).toContain("复现");
    expect(r4).toMatch(/跑到红/);
    expect(r4).toMatch(/没有红过的复现就不要宣称/);
  });

  it("补丁优先写进纪律：改已有文件用 edit_file，write_file 只用于新建（能力 2「补丁级 diff」）", () => {
    const r3 = rule(3);
    expect(r3).toContain("edit_file");
    expect(r3).toContain("write_file");
    expect(r3).toMatch(/只用于新建/);
  });

  it("两条纪律不互斥：明确「第 4 条是新增用例，不是改判卷文件」", () => {
    const r6 = rule(6);
    expect(r6).toContain("判卷");
    expect(r6).toMatch(/新增/);
  });

  it("静态段体积有上界（每轮重送的固定成本，随轮数放大）", () => {
    // 帽从 1400 → 1600 是一次**预算裁决**，不是为通过而调：W3 的调度纪律段实测 +115 字符 /
    // +269 字节（改前 1272B，改后 1542B）。留 58B 余量，再想加句子必须先量数再调帽。
    // 帽 1600 → 1750 是第二次预算裁决，动因是一次真实失败（2026-10-16）：
    // 桌面端让 agent 写「鹈鹕骑自行车的循环动画」，它 IK 算对了、模板组装对了、
    // 回执确认无残留占位符——然后就没回头看。产物里膝盖被选肢钉死在身体右前方
    // （膝 x 全程只摆 21px），而它三个机会都没发现：read_file limit=20 只读前 20 行、
    // 想跑 PIL 分析截图被权限门拒、verify 面是全仓 TS 套件（219s > 60s 帽）每轮必超。
    // 于是加一条「视觉产物交付前必须真的看过」的纪律（+110 字节）。
    // 代价量过：约 68 tok/轮（按 1B≈0.6tok 估），比 read_image 工具说明书（101 tok/轮）便宜，
    // 而那把工具正是这条纪律要调用的东西——只加工具不写纪律，等于买了设备没人用。
    // 30 轮会话累计约 2000 token，换「交付前真的看一眼」，这个交换成立。
    expect(Buffer.byteLength(BASE_SYSTEM, "utf8")).toBeLessThan(1750);
  });

  it("视觉产物自检段在：交付前必须真的看过（能力 5 对非代码产物同样成立）", () => {
    const line = BASE_SYSTEM.split("\n").find((l) => l.startsWith("视觉产物"));
    if (line === undefined) throw new Error("BASE_SYSTEM 缺「视觉产物」段——模型写完美化产物后没人要求它回头看");
    expect(line).toContain("read_image");
    expect(line).toMatch(/不许只凭/);
  });

  it("视觉产物段不占纪律编号（同编排段：条件段混进编号会造断号）", () => {
    const line = BASE_SYSTEM.split("\n").find((l) => l.startsWith("视觉产物"));
    expect(line).toBeDefined();
    expect(/^\d+\)/.test(line ?? "")).toBe(false);
  });

  it("编排段在：拆的判据 / 任务书自包含 / 派完必须收队，三句各锁一句（W1a 的收队义务此前只在工具描述里）", () => {
    const line = BASE_SYSTEM.split("\n").find((l) => l.startsWith("编排"));
    if (line === undefined) throw new Error("BASE_SYSTEM 缺「编排」段——模型面没人教何时派子代理、派完怎么收队");
    expect(line).toContain("能各自独立验收才拆");
    expect(line).toContain("任务书必须自包含");
    expect(line).toMatch(/wait_for_agents/);
    expect(line).toMatch(/未拿到回执不得转述/);
  });

  it("编排段不占纪律编号（纪律 1–6 的连续性是上一条测钉的，条件段混进编号会造断号）", () => {
    const line = BASE_SYSTEM.split("\n").find((l) => l.startsWith("编排"));
    expect(line).toBeDefined();
    expect(/^\d+\)/.test(line ?? "")).toBe(false);
  });
});
