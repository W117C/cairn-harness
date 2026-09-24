// §8.1.8 记忆安全第 6 条（agent-plan.md:860）承诺：「remember 工具描述明文禁止密钥/凭据入库
//   **+ §11.1 脱敏 pass 覆盖记忆写入路径**」。前半是提示词里的一句话，后半——把 redactSecrets 接到
// 记忆写入这条路上——从未实现：redactSecrets 的调用方只有 orchestrator / llm-review / solpi-runtime /
// worker-projection / worker-report 五面，`src/tools/remember.ts` 与 `src/agent/memory/*` 零命中。
// ⇒ 落进 `.agent/memory/` 与全局层的笔记是**跨会话**回流给模型的（inject 面），一份密钥写进去就是
//   每次会话都带一遍。本文件钉的就是那半句承诺。
// 为什么闸在 remember.run 而不是 main 层的 gated 包装：沉淀轮走的是**未加门的工具本体**
//   （agent-runner 里 `rememberTool: remember`），闸放包装层 ⇒ 真·最容易含密钥的那条路绕过它。
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { remember } from "../src/tools/remember";
import { MemoryError, initMemoryHome, globalMemoryDir, ROOT_FILES } from "../src/agent/memory/store";
import type { ToolContext } from "../src/tools/base";

let ws: string;
let home: string;
beforeEach(() => {
  ws = mkdtempSync(join(tmpdir(), "memred-ws-"));
  home = mkdtempSync(join(tmpdir(), "memred-home-"));
  process.env.M2D_MEMORY_HOME = home;
  initMemoryHome(home);
});
afterEach(() => {
  rmSync(ws, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
});

const ctx = (): ToolContext => ({ workspace: ws });
const topicFile = (t: string): string => join(ws, ".agent", "memory", t + ".md");
const disk = (p: string): string => readFileSync(p, "utf8");

// 现场生成的真凭据形状（不从文档抄——抄来的样本会让「按字符集取候选」的规则假绿）
const OPENAI_KEY = "sk-" + "Q7dK2mZx9Rb4Tn8Lc5Vg1Ph".repeat(1);
const ASSIGNED = "deploy_token = 9f3ab71c0d4e8825a1b6c30d";
const PRIVKEY = "-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAA\n-----END OPENSSH PRIVATE KEY-----";

describe("记忆写入面过脱敏 pass（§8.1.8 第 6 条后半，此前零实现）", () => {
  it("已知模式名密钥：落盘不得含明文，回执要点名脱敏", async () => {
    const r = await remember.run(
      { scope: "project", kind: "memory", type: "project", topic: "gateway", content: "网关密钥是 " + OPENAI_KEY + "，轮换找运维。" },
      ctx(),
    );
    expect(r.ok).toBe(true);
    expect(disk(topicFile("gateway"))).not.toContain(OPENAI_KEY);
    expect(r.output).toContain("脱敏");
    expect(r.output).not.toContain(OPENAI_KEY); // 回执本身也不许把明文再播一遍（进事件流）
  });

  it("赋值式凭据（无引号 key=value）同样覆盖：不能只接模式名那一支", async () => {
    const r = await remember.run(
      { scope: "project", kind: "memory", type: "project", topic: "ci", content: "CI 里这样注入：\n" + ASSIGNED + "\n仅此一行。" },
      ctx(),
    );
    expect(r.ok).toBe(true);
    expect(disk(topicFile("ci"))).not.toContain("9f3ab71c0d4e8825a1b6c30d");
  });

  it("DECISIONS（第四个写原语，appendDecisionEntry）也在闸内：别只修 writeTopic", async () => {
    await remember.run({ scope: "project", kind: "decision", content: "决定用托管网关，密钥 " + OPENAI_KEY }, ctx());
    expect(disk(join(ws, ".agent", ROOT_FILES.decision))).not.toContain(OPENAI_KEY);
  });

  it("全局层同样过闸（跨项目共享，泄露面更大）", async () => {
    await remember.run(
      { scope: "global", kind: "memory", type: "reference", topic: "creds", content: "位置说明。样例：" + ASSIGNED },
      ctx(),
    );
    expect(disk(join(globalMemoryDir(), "creds.md"))).not.toContain("9f3ab71c0d4e8825a1b6c30d");
  });

  it("op=replace 的新正文也过闸，但 old_content 仍按盘上原文精确匹配（掩码只作用于新内容）", async () => {
    await remember.run({ scope: "project", kind: "memory", type: "project", topic: "note", content: "原文" }, ctx());
    const r = await remember.run(
      { scope: "project", kind: "memory", type: "project", topic: "note", op: "replace", old_content: "原文", content: "改写后 " + OPENAI_KEY },
      ctx(),
    );
    expect(r.ok).toBe(true);
    expect(disk(topicFile("note"))).not.toContain(OPENAI_KEY);
    // 反向：old_content 里若出现凭据形状，也必须能匹配上盘上原文（不被掩码后比较）
    await remember.run({ scope: "project", kind: "memory", type: "project", topic: "raw", content: ASSIGNED }, ctx());
    const body = disk(topicFile("raw"));
    const prevBody = body.replace(/^---[\s\S]*?---\n/, "");
    const r2 = await remember.run(
      { scope: "project", kind: "memory", type: "project", topic: "raw", op: "replace", old_content: prevBody, content: "已清理" },
      ctx(),
    );
    expect(r2.ok).toBe(true);
  });

  it("私钥块 = blocked：拒绝写入且盘上无痕（沿用 scan.ts 既有契约「调用方应拒绝而非仅脱敏」）", async () => {
    const err = await remember.run(
      { scope: "project", kind: "memory", type: "project", topic: "keynote", content: "备份私钥：\n" + PRIVKEY },
      ctx(),
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MemoryError);
    const msg = String((err as Error).message);
    expect(msg).toContain("私钥");
    expect(msg).not.toContain("b3BlbnNzaC1rZXktdjEAAAAA"); // 拒因不得回显凭据本体
    expect(existsSync(topicFile("keynote"))).toBe(false);
    // 盘上无痕 = 连索引都不许长出这一条（索引文件可能压根没被创建过，那是更强的「无」）
    const idx = join(ws, ".agent", "memory", "MEMORY.md");
    expect(existsSync(idx) ? disk(idx) : "").not.toContain("keynote");
  });

  // ---- 反向钉（今天就该绿）：闸不得伤到正常笔记与既有分型语义 ----
  it("无凭据笔记：逐字落盘，回执不提脱敏（零回归）", async () => {
    const content = "判卷文件 sha256 冻结在 scripts/frozen-sha256.json；pnpm gates 的清单事实源是 scripts/gate-manifest.ts。";
    const r = await remember.run({ scope: "project", kind: "memory", type: "project", topic: "plain", content }, ctx());
    expect(r.ok).toBe(true);
    expect(disk(topicFile("plain"))).toContain(content);
    expect(r.output).not.toContain("脱敏");
  });

  it("空白 content 仍报 empty_change（新闸不得抢在它前面改分型）", async () => {
    const err = await remember.run({ scope: "project", kind: "memory", type: "project", topic: "x", content: "   " }, ctx())
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MemoryError);
    expect((err as MemoryError).code).toBe("empty_change");
  });
});
