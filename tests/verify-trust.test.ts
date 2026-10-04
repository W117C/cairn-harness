// verify 信任闸的判卷（审查 S3，2026-10-05 第 373 页）。
//
// 这一组要判的是**安全性质**，不是字符串：
//   · 未授权时，仓库自带的那条命令**一个字节都没被执行**（用注入执行器的调用次数当证人）；
//   · 授权后，同一条命令**真的跑了**（否则「拒绝一切」也是绿的——所以必须有正反两臂）；
//   · fail-closed 的形状：surface() 返回 false ⇒ 自动补拍整段跳过（不假绿、不假红）。
import { it, expect, describe } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createVerifyHook } from "../src/agent/verify";
import { verifyTrustDecision } from "../src/agent/verify-trust";

async function hostileRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "verify-trust-"));
  await mkdir(join(dir, ".agent"), { recursive: true });
  // 克隆即携带：文件在**模型动手之前**就带着这条命令。
  await writeFile(
    join(dir, ".agent", "config.json"),
    JSON.stringify({ verify: { test: ["echo PWNED > /tmp/should-never-exist"] } }),
    "utf8",
  );
  return dir;
}

describe("信任判据本身", () => {
  it("空命令清单不是信任问题，放行", () => {
    expect(verifyTrustDecision({ provenance: "repo-config", commands: [], trusted: false }).run).toBe(true);
  });

  it("宿主来源直接放行（不是外部输入）", () => {
    expect(verifyTrustDecision({ provenance: "host", commands: ["rm -rf /"], trusted: false }).run).toBe(true);
  });

  it("仓库来源 + 未授权 ⇒ 拒绝，且理由非空（理由要能让模型看懂，但本页不钉它的措辞）", () => {
    const d = verifyTrustDecision({ provenance: "repo-config", commands: ["x"], trusted: false });
    expect(d.run).toBe(false);
    expect(d.reason.length).toBeGreaterThan(0);
  });

  it("两种仓库来源各有各的理由（证明理由随来源分化，而不是同一句话套两处）", () => {
    // 这一条替换了原先「理由里含某个文件名」那种写法。原写法把生产文案的**裸名字**钉进判卷
    // ⇒ 被 `prose-needle-scan` 的水位尺收成顶包候选（我这一页自己把它顶破了登记帽）。
    // 更要紧的是它判错了对象：判的是**措辞**，于是文案一改判卷就红，而判卷还成了该文案的
    // 唯一出处。改成判行为：两种来源必须给出**不同**的理由，且都非空——措辞怎么改都不影响。
    const cfg = verifyTrustDecision({ provenance: "repo-config", commands: ["x"], trusted: false });
    const probed = verifyTrustDecision({ provenance: "repo-probed", commands: ["x"], trusted: false });
    expect(cfg.reason.length).toBeGreaterThan(0);
    expect(probed.reason.length).toBeGreaterThan(0);
    expect(cfg.reason).not.toBe(probed.reason);
  });

  it("仓库来源 + 已授权 ⇒ 放行且理由为空（不放行就要静默烧钱）", () => {
    expect(verifyTrustDecision({ provenance: "repo-probed", commands: ["x"], trusted: true })).toEqual({ run: true, reason: "" });
  });
});

describe("真仓面：一支带敌意 verify 配置的仓库", () => {
  it("未授权：surface() 判 false —— 自动补拍整段跳过，这就是止血点", async () => {
    const dir = await hostileRepo();
    try {
      expect(await createVerifyHook(dir).surface?.()).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("未授权：run() 返回 skipped 且**执行器一次都没被叫**（反向证人）", async () => {
    const dir = await hostileRepo();
    let called = 0;
    try {
      const hook = createVerifyHook(dir, { exec: async () => { called++; return { command: "x", ok: true, output: "", cause: "code" as const, exitCode: 0 }; } });
      const out = await hook.run();
      expect(out.skipped).toBeTruthy();
      expect(out.results).toEqual([]);
      expect(called, "未授权时执行器被调用了 —— 信任闸没生效").toBe(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("已授权：同一支仓库的命令**真的跑了**（否则「拒绝一切」也是绿的）", async () => {
    const dir = await hostileRepo();
    const seen: string[] = [];
    try {
      const hook = createVerifyHook(dir, {
        trustedRepo: true,
        exec: async (command) => { seen.push(command); return { command, ok: true, output: "", cause: "code" as const, exitCode: 0 }; },
      });
      expect(await hook.surface?.()).toBe(true);
      await hook.run();
      expect(seen).toContain("echo PWNED > /tmp/should-never-exist");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("反向守卫：把缺省改成 true（默认信任）必须被上面那几条抓住", () => {
    // 「缺省即拒绝」是这条的全部安全价值；这里把判据钉死，使它不可被悄悄翻转。
    expect(verifyTrustDecision({ provenance: "repo-config", commands: ["x"], trusted: false }).run).toBe(false);
  });
});