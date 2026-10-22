// 桌面端这一批修法的**接线钉**（2026-10-20 独立评审的四条真缺陷）。
//
// 这一份是**源文本**对账（这些行为都在 React 组件里，逐条渲染整棵 App 不现实；
// 行为那一半各自另有判卷：命令门 = tests/command-gate.test.ts（纯函数，真跑）；
// 相位文案 = tests/phase-label.test.ts（纯函数，真跑）；草稿搬移 = 本文件末尾的通道对账）。
// 它钉的是**接线**：修法真的落在那条路上，而不是"某处有个一样的字符串"。
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { readAppShell } from "./helpers/app-surface";

const app = readAppShell();
const kernel = readFileSync(fileURLToPath(new URL("../src/main/kernel-host.ts", import.meta.url)), "utf8");

describe("改名绑定到发起时那条会话（切会话不能改错对象）", () => {
  it("改名状态带着 id；提交时用绑定的 id，不用 activeId", () => {
    expect(app).toContain("useState<{ id: string; text: string } | null>(null)");
    expect(app).toContain("void renameSessionById(barRenaming.id, v);");
    // 反向对照：提交时**不许**再用 activeId（那正是"把 B 改名成 A 的标题"那一步）
    expect(app).not.toContain("void renameSessionById(activeId, v);");
  });

  it("切会话（含跨工作区同名会话）⇒ 取消改名（输入框不跨会话活着）", () => {
    expect(app).toContain("setBarRenaming(null);\n  }, [activeId, activeWorkspace]);");
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

  it.runIf(process.platform === "darwin")("原生宿主实际运行：无系统配置前提，完整验证导航、窗口归属和 PTY", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cairn-native-regression-"));
    try {
      const electron = createRequire(import.meta.url)("electron") as string;
      const output = join(dir, "checks.json");
      // 子进程**不许**继承 ELECTRON_RUN_AS_NODE：那个变量把 Electron 降级成纯 Node
      // （require("electron") 返回二进制路径字符串、app 为 undefined），原生宿主一启动
      // 就死在 app.setPath 上。开发本仓的宿主（DSH）会把该变量注入每个 shell ⇒ 不清掉
      // 这一格就是**恒红**，而恒红会被读成"产品坏了"——真因却与产品无关。
      const env = { ...process.env };
      delete env.ELECTRON_RUN_AS_NODE;
      await promisify(execFile)(electron, [fileURLToPath(new URL("../scripts/native-host-smoke.cjs", import.meta.url)), output], { timeout: 30000, env });
      const checks = JSON.parse(readFileSync(output, "utf8")) as { name: string; ok: boolean; detail?: { foreignHits?: number } }[];
      expect(checks.length).toBeGreaterThanOrEqual(14);
      expect(checks.filter(c => !c.ok)).toEqual([]);
      expect(checks.find(c => c.name === "未授权重定向没有发到目标服务")?.detail?.foreignHits).toBe(0);
      expect(checks.find(c => c.name === "后台弹窗页面挂到调用窗口而非聚焦窗口")?.ok).toBe(true);
      expect(checks.find(c => c.name === "宿主窗口销毁时释放视图及登记")?.ok).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 35000);
});
