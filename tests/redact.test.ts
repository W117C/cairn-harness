// M0 复盘 E-2：redactSecrets 曾对每条规则只取首个匹配（`p.re.exec(line)`），
// 同一行出现两个同模式密钥时第二个原样留在文本里 —— 而该函数的产物会经 worker 回传、
// 子流落 JSONL、sidechat promote、安全报告多处流转，等于明文外泄。
import { describe, expect, it } from "vitest";
import { redactSecrets } from "../src/agent/security/scan";

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
