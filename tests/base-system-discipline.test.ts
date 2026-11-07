// 主会话系统提示词的纪律面（能力 2/5 的「说一次、每轮都吃」成本面）。
// 为什么值得锁：BASE_SYSTEM 此前从未有测——删掉任何一条纪律都不会红，而每条都对应一个真实返工面。
// 它每轮重送（静态段）。2026-11-05 业主裁决：体积帽取消，质量优先——成本读数走 prompt-cost 报告，判卷不再约束体积。
import { describe, expect, it } from "vitest";
import { BASE_SYSTEM } from "../src/main/agent-runner";
import { gateToolSpecs } from "../src/agent/session-provider";

const rule = (n: number): string => {
  const line = BASE_SYSTEM.split("\n").find((l) => l.startsWith(String(n) + ")"));
  if (line === undefined) throw new Error("缺第 " + String(n) + ") 条纪律");
  return line;
};

describe("BASE_SYSTEM 纪律面", () => {
  it("纪律 2 与 propose_plan 说明书同向：只有复杂/验收未定才提方案，明确小改动直接做并验证", () => {
    const r2 = rule(2);
    expect(r2).toMatch(/Multi-file\/structural/i);
    expect(r2).toMatch(/single clear changes/i);
    expect(r2).toContain("verify");
    expect(r2, "方案门不该再要求所有写盘改动都先提方案").not.toMatch(/any (?:write|disk) changes?/i);
    const spec = gateToolSpecs().find((s) => s.function.name === "propose_plan");
    const desc = String(spec?.function.description ?? "");
    expect(desc).toMatch(/多文件\/结构性改动|Multi-file\/structural/i);
    expect(desc).toMatch(/单一明确的小改动直接做|single clear changes/i);
    // 反向证人：把旧文案喂给判卷，必须抓出「任何要改盘」这句正在把小改动也锁进方案门。
    expect(/任何要改盘|any (?:write|disk) changes?/.test("任何要改盘的活开工前")).toBe(true);
  });

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
    expect(head).not.toContain("Desktop");
    expect(head).not.toContain("桌面");
  });

  it("先红后绿写进纪律：修 bug 必须先有跑到红的复现，没红过不得宣称修好（能力 5 的正面）", () => {
    const r4 = rule(4);
    expect(r4).toMatch(/reproduc/i);
    expect(r4).toMatch(/run to red/i);
    expect(r4).toMatch(/never claim resolved without/i);
  });

  it("补丁优先写进纪律：改已有文件用 edit_file，write_file 只用于新建（能力 2「补丁级 diff」）", () => {
    const r3 = rule(3);
    expect(r3).toContain("edit_file");
    expect(r3).toContain("write_file");
    expect(r3).toMatch(/only for creating/i);
  });

  it("两条纪律不互斥：明确「第 4 条是新增用例，不是改判卷文件」", () => {
    const r6 = rule(6);
    expect(r6).toMatch(/judging/i);
    expect(r6).toMatch(/new test/i);
  });

  it("静态段体积帽已取消（2026-11-05 业主裁决：无上限，只要能做到最好）", () => {
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
    // 2026-10-16 第二次加句（帽没抬，字节是腾出来的）：同一场交付里落盘那份与最终回复里
    // 重抄的那份**动画数据不同** ⇒ 视觉段 118→259 字节，加上「只交付落盘那一份、不要在
    // 回复里重抄」。腾出来的地方：纪律 3 138→126、机制边界子代理段 197→150
    // （删的是 spawn_agent 说明书里已有的重复信息，不是删约束）。
    // 2026-11-05 第三次预算裁决（1750 → 4000）：对标 Codex / Claude Code / Muse 引入 AGI 级
    // 科学假设调试（多假设诊断与特异性复现）、全景架构保护与最小影响面（波及分析与最小破坏原则）
    // 以及失败分类应对。在现代前沿模型静态前缀缓存（Prefix Caching）支撑下，静态首段跨轮命中率达 98.8%，
    // 扩充认知厚度不增加线性请求开销，换取复杂 Bug 根因定位与大项目零次生破坏。
    // 2026-11-05 第四次预算裁决（4000 → 5000）：进一步注入 AGI 级元认知反思（动作前意图与信息增益审视、
    // 意外回执反思、归零反思机制）、禁绝掩盖式防御（禁绝 ?. / fallback / 空 catch 吞异常掩盖真实病灶）、
    // 行动优先解码、局部受阻推进、读改对称与判卷不可侵犯原则。实测当前 4,432B，留出 568B 安全缓冲。
    // 2026-11-05 第五次预算裁决（全英文 SOTA 提示词重构）：全面转向 100% 英文 SOTA 提示词体系，
    // 英文分词效率大幅超越中文（Token 数减半，逻辑严密度与因果推理能力最大化）。
    // 2026-11-05 第六次裁决（业主拍板）：字节帽取消，质量优先。体积监督走 prompt-cost 报告
    // （advisory，不进门禁）；判卷只钉「非空字符串」，不再约束体积。
    // 历史帽值（1400→1600→1750→4000→5000）与完整预算裁决账目见 git 历史里本文件的上一版。
    expect(typeof BASE_SYSTEM).toBe("string");
    expect(BASE_SYSTEM.length).toBeGreaterThan(0);
  });

  it("视觉产物自检段在：交付前必须真的看过（能力 5 对非代码产物同样成立）", () => {
    const line = BASE_SYSTEM.split("\n").find((l) => l.startsWith("Visual artifacts"));
    if (line === undefined) throw new Error("BASE_SYSTEM 缺「视觉产物」段——模型写完美化产物后没人要求它回头看");
    expect(line).toMatch(/Must inspect actual output before delivery/i);
  });

  // 产物权威版（2026-10-16 加）：同一次生成里落盘那份与最终回复里重抄的那份腿部动画数据不同
  // （两条腿被写成同一组数、髋关节横移 40 单位、脚偏离曲柄圆周最多 22.9 单位）⇒ 用户从聊天
  // 复制到的和打开 agent 存的文件看到的是两个动画。这一段把「引用落盘那一份」定成交付方式。
  it("产物权威版段在：只交付落盘那一份，不许在回复里重抄", () => {
    const line = BASE_SYSTEM.split("\n").find((l) => l.startsWith("Visual artifacts"));
    if (line === undefined) throw new Error("BASE_SYSTEM 缺产物权威版约束——重抄一份就有两个版本，而两个版本必然漂移");
    expect(line).toContain("only deliver the file on disk");
    expect(line).toMatch(/do not duplicate in reply/i);
    // 反面也钉：这句不是"建议"，是禁止。
    expect(line).not.toContain("can duplicate");
  });

  it("视觉产物段不占纪律编号（同编排段：条件段混进编号会造断号）", () => {
    const line = BASE_SYSTEM.split("\n").find((l) => l.startsWith("Visual artifacts"));
    expect(line).toBeDefined();
    expect(/^\d+\)/.test(line ?? "")).toBe(false);
  });

  it("编排段在：拆的判据 / 任务书自包含 / 派完必须收队，三句各锁一句（W1a 的收队义务此前只在工具描述里）", () => {
    const line = BASE_SYSTEM.split("\n").find((l) => l.startsWith("Orchestration"));
    if (line === undefined) throw new Error("BASE_SYSTEM 缺「编排」段——模型面没人教何时派子代理、派完怎么收队");
    expect(line).toContain("Only decompose when independently verifiable");
    expect(line).toContain("taskbook must be self-contained");
    expect(line).toMatch(/wait_for_agents/);
    expect(line).toMatch(/never relay findings without receipt/i);
  });

  it("编排段不占纪律编号（纪律 1–6 的连续性是上一条测钉的，条件段混进编号会造断号）", () => {
    const line = BASE_SYSTEM.split("\n").find((l) => l.startsWith("Orchestration"));
    expect(line).toBeDefined();
    expect(/^\d+\)/.test(line ?? "")).toBe(false);
  });
});
