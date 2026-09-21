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

  it("刻意接受的口子（钉住，不是遗漏）：以 / 开头的 base64 串不再由熵分支覆盖", () => {
    // 命中概率 ≈1/64（首字符恰为 `/`）。换来的是绝对路径整段可读。
    // 有名字的密钥形状不受影响——私钥块 / sk- / AIza / AKIA / ghp_ / xox / 赋值式各自独立成规则。
    expect(redactSecrets("slash=/9xKzvLm2pQ7rT4wYbNcHdJsFk8Vg3Rt").text).toBe("slash=/9xKzvLm2pQ7rT4wYbNcHdJsFk8Vg3Rt");
    expect(redactSecrets("cp /home/deploy/AKIAIOSFODNN7EXAMPLE /tmp/x").text).toContain("AKIA****");
  });
});
