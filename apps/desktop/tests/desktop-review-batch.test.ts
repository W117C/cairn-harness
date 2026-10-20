// 桌面端这一批修法的**接线钉**（2026-10-20 独立评审的四条真缺陷）。
//
// 这一份是**源文本**对账（这些行为都在 React 组件里，逐条渲染整棵 App 不现实；
// 行为那一半各自另有判卷：命令门 = tests/command-gate.test.ts（纯函数，真跑）；
// 相位文案 = tests/phase-label.test.ts（纯函数，真跑）；草稿搬移 = 本文件末尾的通道对账）。
// 它钉的是**接线**：修法真的落在那条路上，而不是"某处有个一样的字符串"。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const app = readFileSync(fileURLToPath(new URL("../src/renderer/App.tsx", import.meta.url)), "utf8");
const kernel = readFileSync(fileURLToPath(new URL("../src/main/kernel-host.ts", import.meta.url)), "utf8");

describe("改名绑定到发起时那条会话（切会话不能改错对象）", () => {
  it("改名状态带着 id；提交时用绑定的 id，不用 activeId", () => {
    expect(app).toContain("useState<{ id: string; text: string } | null>(null)");
    expect(app).toContain("void renameSessionById(barRenaming.id, v);");
    // 反向对照：提交时**不许**再用 activeId（那正是"把 B 改名成 A 的标题"那一步）
    expect(app).not.toContain("void renameSessionById(activeId, v);");
  });

  it("切会话 ⇒ 取消改名（输入框不跨会话活着）", () => {
    expect(app).toContain("setBarRenaming(null);\n  }, [activeId]);");
  });
});

describe("空分支删除前先搬走用户还没发出去的稿", () => {
  it("删除前走**既有的草稿搬家通道**（Composer 是草稿桶的唯一写手，另起一条路会被它盖回去）", () => {
    expect(app).toContain("setDraftRemap({ from: ctx.forkId, to: ctx.originId, seq: ++draftRemapSeq.current });");
    // 反向对照：App 不许自己直写草稿桶（那是 Composer 的活，两处各写一份就会互相盖）
    expect(app, "App 不许自己写草稿桶").not.toContain("DRAFTS_KEY");
  });

  it("通道本身：Composer 侧搬的是桶里的那一格（不覆盖目标已有的稿）", () => {
    const composer = readFileSync(fileURLToPath(new URL("../src/renderer/components/Composer.tsx", import.meta.url)), "utf8");
    expect(composer).toContain("const moved = draftsRef.current.get(r.from);");
    expect(composer).toContain("if (moved !== undefined && !draftsRef.current.has(r.to)) draftsRef.current.set(r.to, moved);");
    expect(composer).toContain("draftsRef.current.delete(r.from);");
  });
});

describe("换渲染层实例后接管在跑的会话：秒表接着真值算", () => {
  it("main 报这一轮的起点；渲染层拿它补上本机没有的起点", () => {
    expect(kernel).toContain("runStartedAt");
    expect(kernel).toContain("startedAt: runStartedAt.get(id)");
    expect(app).toContain("runStartBySession.current.set(id, r.startedAt ?? Date.now());");
  });
});

describe("测量脚本要有预算（量过了 ≠ 没变）", () => {
  it("性能冒烟：帧时间/启动时间各有一道帽，且**退出码看它**", () => {
    const perf = readFileSync(fileURLToPath(new URL("../scripts/performance-smoke.cjs", import.meta.url)), "utf8");
    expect(perf).toContain("CAIRN_PERF_P95_BUDGET_MS");
    expect(perf).toContain("CAIRN_PERF_MAX_BUDGET_MS");
    expect(perf).toContain("CAIRN_PERF_STARTUP_BUDGET_MS");
    // 关键：退出码**看**预算（从前的形状是量完就 exit 0 ⇒ 3× 回归照样"绿"）
    expect(perf).toContain("overBudget.length===0 ? 0:1");
  });

  it("首屏 JS 审计：给一个帽，超了 exit 非 0", () => {
    const bundle = readFileSync(fileURLToPath(new URL("../scripts/bundle-audit.mjs", import.meta.url)), "utf8");
    expect(bundle).toContain("CAIRN_BUNDLE_INITIAL_BUDGET_BYTES");
    expect(bundle).toContain("process.exitCode=1");
  });

  it("原生宿主冒烟：认得 lo0 没绑 127.0.0.2 ⇒ 说清怎么开 + 独立退出码（不许 exit 0）", () => {
    const native = readFileSync(fileURLToPath(new URL("../scripts/native-host-smoke.ts", import.meta.url)), "utf8");
    // 判据要钉**分支真的在**（只钉"文件里有这几个字"= 恒真：把条件改成 if(false) 也照样全绿）
    expect(native).toContain('if (code === "EADDRNOTAVAIL") {');
    expect(native).toContain("ifconfig lo0 alias 127.0.0.2");
    expect(native).toContain("app.exit(2)");
    // 「跑不了」那一支**不许再 throw**（2026-10-21 真机冒烟实测）：`app.exit` 是异步退出的，
    // 紧接着 throw ⇒ 外层 `main().catch` 接手 ⇒ 原始错误被原样印出来、外层再退 1
    // ⇒ 「跑不了」被读成「跑挂了」，退出码也不是那个 2。这一格钉住"return 收束"。
    const branch = native.slice(native.indexOf('if (code === "EADDRNOTAVAIL") {'));
    const beforeThrow = branch.slice(0, branch.indexOf("throw err;"));
    expect(beforeThrow, "EADDRNOTAVAIL 分支里必须以 return 收束（不许再 throw 给外层）").toContain("return;");
    // 反向对照：跑不了不许走"全过"那个出口
    expect(native).not.toMatch(/EADDRNOTAVAIL[\s\S]{0,600}app\.exit\(0\)/);
  });
});
