// M7 retrieval.ts 的判卷面：词面选材的次序主干（词面分）、双门槛（入选/唤醒）、
// 休眠不挡强命中、无正文不注、确定性同分次序、码点安全截断。
// 末段是**全链集成**（buildMemoryInjection）：选材 → 注入 → 预算淘汰 → 记账的账实相符。
import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  RECALL_MAX_TOPICS,
  RECALL_MIN_SCORE,
  WAKE_MIN_SCORE,
  clipByCodepoints,
  scoreRecallCandidates,
  selectRecall,
  type RecallInput,
} from "../src/agent/memory/retrieval";
import type { MemoryStat } from "../src/agent/memory/strength";

const NOW = "2026-10-25T00:00:00.000Z";

function cand(topic: string, digest: string, body: string | null = "正文", stat?: MemoryStat): RecallInput {
  return { topic, type: "project", digest, stat, body };
}
function dormantStat(): MemoryStat {
  return { topic: "x", hits: 1, lastRetrieved: "2020-01-01T00:00:00.000Z", strength: 0.01, dormant: true };
}

describe("scoreRecallCandidates", () => {
  it("CJK 二元组词面命中计分，命中词如实报出", () => {
    const out = scoreRecallCandidates("部署超时怎么处理", [
      cand("deploy-runbook", "部署超时阈值与告警策略"),
      cand("style-guide", "命名与注释风格约定"),
    ]);
    expect(out.length).toBeGreaterThan(0);
    expect(out[0]!.topic).toBe("deploy-runbook");
    expect(out[0]!.matched).toContain("部署");
    expect(out[0]!.matched).toContain("超时");
  });
  it("问句为空/候选为空 → 空结果（零注入回归的两道门）", () => {
    expect(scoreRecallCandidates("", [cand("a", "x")])).toEqual([]);
    expect(scoreRecallCandidates("部署", [])).toEqual([]);
  });
  it("库内到处都是的词当停用词：只命中它 → 不得分", () => {
    // 10 个候选里 4 个含「配置」⇒ df=4 > stopAt=max(3, ⌊10×0.15⌋)=3 ⇒ 停用；
    // 问句只含「配置」⇒ 无可计分词 ⇒ 空。
    const many = Array.from({ length: 10 }, (_, i) =>
      cand("t" + String(i), i < 4 ? "配置相关条目" + String(i) : "别的内容" + String(i)),
    );
    expect(scoreRecallCandidates("配置在哪", many)).toEqual([]);
  });
});

describe("selectRecall", () => {
  it("按词面分取 top-k，无关条目不进（宁缺勿滥的下限）", () => {
    const picks = selectRecall(
      "部署超时怎么处理",
      [cand("deploy-runbook", "部署超时阈值与告警策略"), cand("style-guide", "命名与注释风格约定")],
      { nowISO: NOW },
    );
    expect(picks.map((p) => p.topic)).toEqual(["deploy-runbook"]);
    expect(picks[0]!.score).toBeGreaterThanOrEqual(RECALL_MIN_SCORE);
    expect(picks[0]!.matched.length).toBeGreaterThan(0);
  });
  it("k 条上限生效，且同分按 topic 字典序（确定性不交给遍历顺序）", () => {
    const picks = selectRecall(
      "部署超时阈值",
      [cand("zz-deploy", "部署超时阈值"), cand("aa-deploy", "部署超时阈值"), cand("mm-deploy", "部署超时阈值"), cand("other", "别的主题")],
      { k: 2, nowISO: NOW },
    );
    expect(picks.map((p) => p.topic)).toEqual(["aa-deploy", "mm-deploy"]);
    expect(RECALL_MAX_TOPICS).toBeGreaterThan(0);
  });
  it("单弱词命中不过下限 → 不选（RECALL 每条都占预算）", () => {
    // 三候选只有目标含「超时」：idf=log(1+3)≈1.386 < 1.5 下限 ⇒ 不选。
    const picks = selectRecall(
      "超时",
      [cand("target", "部署超时阈值"), cand("b", "风格约定"), cand("c", "别的主题")],
      { nowISO: NOW },
    );
    expect(picks).toEqual([]);
  });
  it("休眠条目：中等命中不出场，强命中唤醒并如实标注 woke", () => {
    // 两个陪跑候选抬 n=3（stopAt=3 ⇒ 全词计分，单词 idf=log(1+3)≈1.386）。
    const base = [cand("b", "风格约定"), cand("c", "别的主题")];
    // 中等命中：问句「部署告警」与休眠条目共享 部署/告警 两个二元组 ⇒ ≈2.77，
    // 过了入选下限（1.5）但够不着唤醒线（4.0）⇒ 休眠条目不出场。
    const moderate = selectRecall("部署告警", [cand("dormant-one", "部署超时阈值与告警", "正文", dormantStat()), ...base], { nowISO: NOW });
    expect(moderate).toEqual([]);
    // 强命中：5 个二元组 ⇒ ≈6.93 ≥ WAKE_MIN_SCORE ⇒ 唤醒。
    const strong = selectRecall("部署超时阈值怎么定", [cand("dormant-one", "部署超时阈值与告警", "正文", dormantStat()), ...base], { nowISO: NOW });
    expect(strong.length).toBe(1);
    expect(strong[0]!.woke).toBe(true);
    expect(WAKE_MIN_SCORE).toBeGreaterThan(RECALL_MIN_SCORE);
  });
  it("无正文（读不动的那份）整个跳过，不让它占 k 的槽位", () => {
    const picks = selectRecall(
      "部署超时怎么处理",
      [cand("deploy-runbook", "部署超时阈值", null), cand("deploy-second", "部署超时手册", "正文")],
      { nowISO: NOW },
    );
    expect(picks.map((p) => p.topic)).toEqual(["deploy-second"]);
  });
  it("强度只做折半微调：同词面分下常用品在前，但 0 强度的强命中仍在场", () => {
    const strong = { topic: "a", hits: 9, lastRetrieved: NOW, strength: 1 } as MemoryStat;
    const weak = { topic: "b", hits: 0, lastRetrieved: "2020-01-01T00:00:00.000Z", strength: 0.001 } as MemoryStat;
    const picks = selectRecall(
      "部署超时怎么处理",
      [cand("b", "部署超时阈值", "正文", weak), cand("a", "部署超时手册", "正文", strong)],
      { nowISO: NOW },
    );
    expect(picks[0]!.topic).toBe("a"); // eff = score×(0.5+0.5×1) > score×~0.5
    expect(picks.length).toBe(2);      // 0 强度的那条没有出局（词面是主干）
  });
});

describe("clipByCodepoints（UTF-8/代理对安全）", () => {
  it("不超帽原样返回；超帽按码点截断并带说明尾", () => {
    expect(clipByCodepoints("短文", 10)).toBe("短文");
    const clipped = clipByCodepoints("a".repeat(50), 10);
    expect(Array.from(clipped).length).toBe(10 + "…（超长截断，原文见记忆文件）".length);
  });
  it("代理对不被劈开：emoji 序列截后仍是完整字符", () => {
    const emoji = "😀".repeat(1500);
    const clipped = clipByCodepoints(emoji, 1200);
    const chars = Array.from(clipped);
    // 截断段内每个字符仍是完整的 😀（没有落单的代理项半边）
    const head = chars.slice(0, 1200);
    expect(head.every((c) => c === "😀")).toBe(true);
  });
});

// ── 全链集成（buildMemoryInjection）：选材 → 预算淘汰 → 记账，账实相符 ──
// 全链要的三个取料口放 describe 顶上（动态 import 保持与上方纯函数段同样的懒加载形状，
// 避免纯函数判卷还没跑就先付一次 fs 模块的 import 成本）。
async function freshChain(): Promise<{ ws: string; memDir: string; globalRoot: string; cleanup: () => Promise<void> }> {
  const { mkdir } = await import("node:fs/promises");
  const root = await mkdtemp(join(tmpdir(), "dsh-m7-chain-"));
  const ws = join(root, "ws");
  const globalRoot = join(root, "global");
  await mkdir(join(ws, ".agent", "memory"), { recursive: true });
  await mkdir(globalRoot, { recursive: true });
  return { ws, memDir: join(ws, ".agent", "memory"), globalRoot, cleanup: () => rm(root, { recursive: true, force: true }) };
}

describe("RECALL 注入全链（预算淘汰 / 坏索引行 / 记账）", () => {
  it("预算把 RECALL 淘汰 ⇒ 不记账：没进模型的不算检索练习（观测面同为空）", async () => {
    const f = await freshChain();
    try {
      const { writeTopic, readStats } = await import("../src/agent/memory/store");
      const { buildMemoryInjection, flushRecallHits } = await import("../src/agent/memory/inject");
      await writeTopic(f.memDir, "deploy-timeout", "project", "部署超时阈值：网关统一 30 秒，重试两次；超过即告警", NOW);
      const inj = await buildMemoryInjection({ workspace: f.ws, globalRoot: f.globalRoot, queryText: "部署超时阈值怎么定", tokenBudget: 120 });
      expect(inj.recall).toEqual([]);
      // 段首孤儿摘录一并清掉：RECALL 段要么整段在，要么整段没（不许留无主正文）。
      expect(inj.project === null || !inj.project.includes("[RECALL")).toBe(true);
      await flushRecallHits();
      expect(await readStats(f.memDir)).toEqual({}); // 无账：被淘汰的命中不落盘
    } finally {
      await f.cleanup();
    }
  });

  it("坏名字索引行：只丢那一条，不把整段注入打成「不可用」", async () => {
    const f = await freshChain();
    try {
      const { writeTopic } = await import("../src/agent/memory/store");
      const { buildMemoryInjection } = await import("../src/agent/memory/inject");
      const { writeFile } = await import("node:fs/promises");
      await writeTopic(f.memDir, "deploy-ok", "project", "部署超时阈值：网关统一 30 秒，重试两次", NOW);
      // 手改索引追加一行 topic 名带路径穿越的行：parseIndexLine 收得下（\S 不挑字符），
      // readTopicBody 会抛——修之前这个抛会把整段记忆注入打成 memoryUnavailableText。
      const indexPath = join(f.memDir, "MEMORY.md");
      await writeFile(indexPath, (await readFile(indexPath, "utf8")) + "- ../escape · project · 2026-10-25T00:00:00.000Z · 部署超时阈值与告警策略\n", "utf8");
      const inj = await buildMemoryInjection({ workspace: f.ws, globalRoot: f.globalRoot, queryText: "部署超时阈值怎么定" });
      expect(inj.project).not.toBeNull();
      expect(inj.project).toContain("[RECALL");
      expect(inj.recall).toEqual(["deploy-ok"]); // 坏那条按「无正文不注」跳过，不牵连整段
    } finally {
      await f.cleanup();
    }
  });
});
