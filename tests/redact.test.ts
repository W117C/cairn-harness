// M0 复盘 E-2：redactSecrets 曾对每条规则只取首个匹配（`p.re.exec(line)`），
// 同一行出现两个同模式密钥时第二个原样留在文本里 —— 而该函数的产物会经 worker 回传、
// 子流落 JSONL、sidechat promote、安全报告多处流转，等于明文外泄。
import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { redactSecrets } from "../src/agent/security/scan";
import { scanStreamEvent } from "../src/agent/worker-projection";
import type { AgentEvent } from "../src/events";

describe("redactSecrets 全局掩码（E-2 回归）", () => {
  it("同一行多个同模式密钥全部掩码", () => {
    const a = "sk-" + "A".repeat(24);
    const b = "sk-" + "B".repeat(24);
    const r = redactSecrets(`a="${a}" b="${b}"`);
    expect(r.text).not.toContain(a);
    expect(r.text).not.toContain(b);
    expect(r.findings.length).toBeGreaterThan(0);
  });

  it("跨行多个密钥全部掩码", () => {
    const a = "sk-" + "C".repeat(24);
    const b = "sk-" + "D".repeat(24);
    const r = redactSecrets(`${a}\n${b}`);
    expect(r.text).not.toContain(a);
    expect(r.text).not.toContain(b);
  });

  it("无密钥文本原样返回", () => {
    const r = redactSecrets("hello world");
    expect(r.text).toBe("hello world");
    expect(r.findings).toHaveLength(0);
  });
});

// 高熵候选的**边界**（2026-09-22 量测）：旧字符集 `[A-Za-z0-9+/=_-]` 把 `=` 和 `/` 也算进候选，
// 于是一条候选不是「一个密钥」而是「整段赋值 + 整条绝对路径」；mask() 只留前 4 字符 ⇒
// 实测 `scratch=/var/folders/pc/fqvmb…gn/T` 变成 `scra****`（键名连同路径一起没了），
// `created /var/folders/…` 变成 `created /var****`。这条路今天就在生效（子流落流、solpi 归档都过它），
// 且没有任何地方看见它——所以这里成对钉：该掩的仍然掩（漏一个＝假安全），不该掩的别碰（掩一个＝毁正文）。
describe("高熵候选边界：掩值，不吃键名与路径", () => {
  const KEY = "Zx9Qm2Lp7Rk4Tv8Nw3Yb6Hc1Jd5Fs0Ga";

  it("赋值式：值掩掉、键名逐字留着", () => {
    expect(redactSecrets(`SESSION=${KEY}`).text).toBe("SESSION=Zx9Q****");
  });

  it("base64 串中段含 / 与 + 时仍按整串掩（否决只看候选开头）", () => {
    const blob = "qkvHj3d/sdLk2jJQ9xYvBm+cRt2Nw5Zk";
    const r = redactSecrets(`blob=${blob}`);
    expect(r.text).not.toContain(blob);
    expect(r.text).toContain("blob=");
  });

  it("尾部 padding 属于候选（不把 == 留在明文里）", () => {
    const r = redactSecrets(`x ${KEY}== y`);
    expect(r.text).not.toContain(KEY);
  });

  it("绝对路径形状否决：真实 mkdtemp 目录与其下的文件逐字不变", () => {
    const dir = mkdtempSync(join(tmpdir(), "dsh-entropy-"));
    const line = `wrote ${join(dir, "out.jsonl")} done`;
    const r = redactSecrets(line);
    expect(r.findings).toHaveLength(0);
    expect(r.text).toBe(line);
  });

  it("同一条落流事件：路径完整 + 同行的 sk- 密钥仍被擦（两边都要，缺一边就是假话）", () => {
    const dir = mkdtempSync(join(tmpdir(), "dsh-entropy-"));
    const out = `read ${join(dir, "config.env")} → API="sk-abcdefghijklmnopqrstuvwxyz012345"`;
    const e = { type: "tool_result", callId: "t1", ok: true, output: out } as unknown as AgentEvent;
    const scanned = scanStreamEvent(e) as Extract<AgentEvent, { type: "tool_result" }>;
    expect(scanned.output).toContain(dir);
    expect(scanned.output).not.toContain("sk-abcdefghijklmnopqrstuvwxyz012345");
  });

  it("相对路径也要整段可读（agent 最高频的 token 就是工作区相对路径）", () => {
    // 上一笔只否决了「以 / 开头」的候选，而这批形状都不以 / 开头：dated 目录、worktree 名、
    // session 文件名。它们被吃掉后模型拿不到路径 ⇒ 只能重跑命令或猜文件名（返工 + 白花 token）。
    // 断言写成「整条逐字不变」而不是「不含 ****」：前半句才判得出段首被截的失真。
    const lines = [
      "read outputs/ga-strategy-2026-09-23/measure-overmask.mts ok",
      "opened fixtures/no-progress/session-2026-09-20T04-11-52.jsonl",
      "worktree .agents/worktrees/dsh-anchor-3f/src/main.ts dirty",
      "plan docs/superpowers/plans/2026-09-20-goal-plan-modes.md done",
    ];
    for (const line of lines) {
      const r = redactSecrets(line);
      expect(r.text, "相对路径被脱敏吃掉：" + line).toBe(line);
      expect(r.findings, "路径不该产出 secret finding：" + line).toHaveLength(0);
    }
  });

  it("反向那一半：相对路径里真藏高熵串时仍然要擦（否决不许把密钥一起放过）", () => {
    // 这一条与上一条同分母（都含 `/`），差别只在**某一段**自身是高熵随机串。
    // 只测「路径放过」而不测这条，等于允许用「一律放过含 / 的候选」蒙过上一格。
    const secret = "xk39Fd8Qz2Lp7Vm4Rt6Bn";
    const line = `write src/config/${secret} ok`;
    const r = redactSecrets(line);
    expect(r.text).not.toContain(secret);
    expect(r.text).toContain("src/config/"); // 键名与目录仍在（只掩值，不吃上下文）
    expect(r.findings.length).toBeGreaterThan(0);
  });

  it("刻意接受的口子（钉住，不是遗漏）：以 / 开头的 base64 串不再由熵分支覆盖", () => {
    // 命中概率 ≈1/64（首字符恰为 `/`）。换来的是绝对路径整段可读。
    // 有名字的密钥形状不受影响——私钥块 / sk- / AIza / AKIA / ghp_ / xox / 赋值式各自独立成规则。
    expect(redactSecrets("slash=/9xKzvLm2pQ7rT4wYbNcHdJsFk8Vg3Rt").text).toBe("slash=/9xKzvLm2pQ7rT4wYbNcHdJsFk8Vg3Rt");
    expect(redactSecrets("cp /home/deploy/AKIAIOSFODNN7EXAMPLE /tmp/x").text).toContain("AKIA****");
  });
});

/** 赋值式凭据的**漏检一侧**（任务 #5）。旧规则的强制引号等于宣布：
 *  `.env` / `docker run -e` / shell 里最常见的写法（`API_KEY=xxxx`）不是凭据。
 *  这里同时钉住"只掩值、键名逐字留"（否则修漏检会新造一条把键名一起吃掉的过掩）。 */
describe("赋值式凭据：无引号写法（.env / -e / YAML）", () => {
  const rules = (line: string): string[] => redactSecrets(line).findings.map((f) => f.ruleId);

  it("无引号 api_key=<32 位 hex>：命中赋值式，且键名留着、值擦掉", () => {
    const r = redactSecrets("api_key=bf9ccaa2dab744fa83c232deef772ad0");
    expect(rules("api_key=bf9ccaa2dab744fa83c232deef772ad0")).toContain("secret.assigned");
    expect(r.text).toContain("api_key=");
    expect(r.text).not.toContain("bf9ccaa2dab744fa83c232deef772ad0");
  });

  it("大写键 + base64 值（中段含 / 与 +）：整值擦，等号左侧不动", () => {
    const val = "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY";
    const r = redactSecrets(`AWS_SECRET_ACCESS_KEY=${val}`);
    expect(rules(`AWS_SECRET_ACCESS_KEY=${val}`)).toContain("secret.assigned");
    expect(r.text).toContain("AWS_SECRET_ACCESS_KEY=");
    expect(r.text).not.toContain(val);
  });

  it("带引号的旧形状行为一字不变（双引号 / 单引号两种都仍算）", () => {
    for (const line of [`token: "ghtok_abcdefghijklmnop1234"`, "password: 'hunter2hunter2hunter2'"]) {
      expect(rules(line), line).toContain("secret.assigned");
      expect(redactSecrets(line).text, line).not.toContain("abcdefghijklmnop1234".slice(0, 12));
      expect(redactSecrets(line).text, line).not.toContain("hunter2hunter2hunter2");
    }
  });

  it("负控：非凭据键名、变量引用、短值、空值不算赋值式凭据", () => {
    const lines = [
      "token_count: 12",                       // 键不是整词（token 后面还跟着 _count）
      "DB_TOKEN=${VAULT_TOKEN}",               // 变量引用，不是凭据本身
      "password=",                             // 空值（模板 / 未配置）
      "token=short12",                         // 值不足 12
      "secret_key_rotation_policy=annual",     // 键名里含 secret，但值不是凭据
      "api_keys_file: /etc/keys.json",
    ];
    for (const line of lines) {
      expect(rules(line), "不该命中赋值式：" + line).not.toContain("secret.assigned");
    }
  });
});
