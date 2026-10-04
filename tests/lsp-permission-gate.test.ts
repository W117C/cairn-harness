// #58 的判卷：lsp 会 spawn 工作区配置里的命令 ⇒ "要不要问人"这一层不能缺席（2026-10-05 第 383 页）。
//
// 形状与 S3 同源：`lsp` 起的是 `.agent/lsp.json` 里写的 `command`——**仓库自带的外部输入**。
// 写那份配置已被 S2 的路径通道抬到 high（实测），但**克隆即携带**那条路与写盘无关：
// 模型根本不用动手，配置跟着 clone 一起到，任何一次 lsp 调用就按它起进程。
//
// **与既有一条裁决的关系（本页特意钉住它）**：`tests/write-face.test.ts` 钉着
// 「lsp 不该被算成改盘」——那条是对的（lsp 确实不写盘）。所以本笔**不**把 lsp 塞进
// `SIDE_EFFECT_TOOLS`（那会让它变成写向、受方案门挡，是另一件事，且会推翻那条裁决）。
// 本笔只补"要不要问人"：风险定级 + gatedTool 包装，两件同笔（缺任一半都等于没门）。
import { it, expect, describe } from "vitest";
import { staticRisk } from "../src/permissions/risk";
import { evaluate, newAutonomySession, type AutonomySession } from "../src/permissions";
import { mayHaveWrittenDisk } from "../src/agent/write-face";

function session(mode: "guided" | "auto" | "default"): AutonomySession {
  const s = newAutonomySession(mode, { rules: [], sandboxAvailable: null, sessionScopes: new Set<string>() });
  s.planBlocked = () => false;
  s.consecutiveAutoApprovals = 0;
  s.breakerTripped = false;
  s.consecutiveCriticalDenials = 0;
  return s;
}

describe("① 风险定级：lsp 是 high，不是默认的 none", () => {
  it("staticRisk('lsp') ⇒ high（且不是走默认的 none 出口）", () => {
    const r = staticRisk("lsp" as never, {});
    expect(r.level, "lsp 拿默认 none ⇒ 引导/自主两档会静默放行它（#58 复发）").toBe("high");
    // 判**行为**而不是措辞：初版这里钉 `.reason` 里含配置文件名，被 `prose-needle-scan` 的
    // 顶包水位尺收成候选（我的 1 条把它从帽内 10 顶到 11）——而它判的其实是**文案**，
    // 文案一改判卷就红，判卷还成了该文案的唯一出处。改成与"默认出口"对照：
    // 真正的定级必须给出理由，而默认出口（NONE）是空理由。
    const fallback = staticRisk("read_file" as never, {});
    expect(fallback.level).toBe("none");
    expect(r.reason ?? "", "定级了却不给理由 ⇒ 模型看卡面时不知道为什么要问").not.toBe(fallback.reason ?? "");
    expect((r.reason ?? "").length).toBeGreaterThan(0);
  });

  it("反向守卫：默认档与只读档的 riskAskAt 就是 high ⇒ 给 medium 等于那两档不会被问", () => {
    // 这一条把"为什么必须是 high 而不是 medium"钉住：给 medium 时下面三档里会有档位放行。
    const d = evaluate("lsp" as never, {} as never, session("default"));
    expect(d.verdict, "默认档放行了 lsp").not.toBe("approve");
  });
});

describe("② 四档都出卡（不是只有严的那两档）", () => {
  it.each(["guided", "auto", "default"] as const)("%s 档 lsp 不被 approve 直通", (mode) => {
    const d = evaluate("lsp" as never, {} as never, session(mode));
    expect(d.verdict, mode + " 档把 lsp 直通了").not.toBe("approve");
  });
});

describe("③ 既有裁决不许被我推翻（本页的非回归面）", () => {
  it("lsp 仍然**不算改盘**（write-face 那条裁决照旧）", () => {
    expect(mayHaveWrittenDisk("lsp", {}), "lsp 被算成改盘了 ⇒ 推翻了既有裁决，本笔不该这样改").toBe(false);
  });
});
