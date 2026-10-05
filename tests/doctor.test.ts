// cairn --doctor 的判卷（spec：docs/superpowers/specs/2026-10-06-productization-b1-design.md §2/§3）。
// 纯函数核全量钉死：脱敏（env 值结构性进不来）、六项固定清单、fatal 只留给 node、三态 search、
// 末行总档。IO 壳（runDoctor）另用 tmpdir 验两条最薄的路——沙箱探测注入，不在判卷里赌机器状态。
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  collectDoctorChecks,
  nodeVersionOk,
  parseEngines,
  renderDoctor,
  runDoctor,
  verdictOf,
  type DoctorFacts,
} from "../src/main/doctor";
import { PROVIDER_ENV_KEYS } from "../src/providers/env-keys";
import { DEFAULT_MODEL_TABLE, specsByTier } from "../src/providers/registry";

const RANGE = parseEngines(">=20.11.0 <25")!;

describe("nodeVersionOk（手写比较器，不引 semver）", () => {
  it("区间边界：20.10.9 拒 / 20.11.0 收 / 24.9.9 收 / 25.0.0 拒", () => {
    expect(nodeVersionOk("20.10.9", RANGE)).toBe(false);
    expect(nodeVersionOk("20.11.0", RANGE)).toBe(true);
    expect(nodeVersionOk("24.9.9", RANGE)).toBe(true);
    expect(nodeVersionOk("25.0.0", RANGE)).toBe(false);
  });

  it("v 前缀收；预发布与脏串一律拒（宁可误报也不放行不认识的串）", () => {
    expect(nodeVersionOk("v22.23.2", RANGE)).toBe(true);
    expect(nodeVersionOk("25.0.0-pre.1", RANGE)).toBe(false);
    expect(nodeVersionOk("abc", RANGE)).toBe(false);
    expect(nodeVersionOk("", RANGE)).toBe(false);
  });

  it("engines 读不出来 ⇒ parseEngines 返回 null（fail-closed，不猜区间）", () => {
    expect(parseEngines(">=20")).toBeNull();
    expect(parseEngines("随便")).toBeNull();
  });
});

const TIER_COUNTS = {
  total: DEFAULT_MODEL_TABLE.length,
  cheap: specsByTier(DEFAULT_MODEL_TABLE, "cheap").length,
  standard: specsByTier(DEFAULT_MODEL_TABLE, "standard").length,
  strong: specsByTier(DEFAULT_MODEL_TABLE, "strong").length,
};

function facts(over: Partial<DoctorFacts> = {}): DoctorFacts {
  return {
    nodeVersion: "v22.23.2",
    engines: ">=20.11.0 <25",
    // 键名 = env 变量名（PROVIDER_ENV_KEYS 的值）；判卷里只可能有「在位与否」，不可能有值
    keyPresence: { CAIRN_API_KEY: true, OPENAI_API_KEY: false, ANTHROPIC_API_KEY: false, GEMINI_API_KEY: false },
    sandbox: { available: true },
    workspaceWritable: true,
    search: { kind: "unset" },
    tierCounts: TIER_COUNTS,
    ...over,
  };
}

describe("collectDoctorChecks（六项固定清单，spec §2）", () => {
  it("脱敏：sk- 形态的串进不了渲染面（事实结构里就没有值的字段）", () => {
    const checks = collectDoctorChecks(
      facts({ keyPresence: { CAIRN_API_KEY: false, OPENAI_API_KEY: true, ANTHROPIC_API_KEY: false, GEMINI_API_KEY: false } }),
    );
    const text = renderDoctor({ checks, ...verdictOf(checks) });
    expect(text).not.toMatch(/sk-[A-Za-z0-9]/);
  });

  it("keys：全缺 ⇒ ✗＋指路 --provider demo（只报不红，非致命）", () => {
    const c = collectDoctorChecks(
      facts({ keyPresence: { CAIRN_API_KEY: false, OPENAI_API_KEY: false, ANTHROPIC_API_KEY: false, GEMINI_API_KEY: false } }),
    );
    const keys = c.find((x) => x.id === "keys")!;
    expect(keys.ok).toBe(false);
    expect(keys.fatal).toBe(false);
    expect(keys.hint).toContain("--provider demo");
  });

  it("keys：部分在位 ⇒ detail 点名缺省将拨谁（按 ENV_KEYED_PROVIDERS 表序第一个在位的）", () => {
    const keys = collectDoctorChecks(facts()).find((x) => x.id === "keys")!;
    expect(keys.ok).toBe(true);
    expect(keys.detail).toContain(PROVIDER_ENV_KEYS.glm);
  });

  it("node：版本不满足 ⇒ fatal（唯一 exit 1 项）；engines 解析失败 ⇒ 同样 fatal", () => {
    expect(collectDoctorChecks(facts({ nodeVersion: "18.0.0" })).find((x) => x.id === "node")!.fatal).toBe(true);
    expect(collectDoctorChecks(facts({ engines: "随便" })).find((x) => x.id === "node")!.fatal).toBe(true);
    expect(collectDoctorChecks(facts({ nodeVersion: "18.0.0" })).find((x) => x.id === "node")!.ok).toBe(false);
  });

  it("sandbox 不可用 ⇒ ✗ 但非致命，detail 带原因，不假装可用", () => {
    const s = collectDoctorChecks(facts({ sandbox: { available: false, reason: "no sandbox-helper" } })).find((x) => x.id === "sandbox")!;
    expect(s.ok).toBe(false);
    expect(s.fatal).toBe(false);
    expect(s.detail).toContain("no sandbox-helper");
  });

  it("search 三态分开：未配＝ok（web_search 本来就可选）；JSON 坏＝✗ 非致命；已配＝ok", () => {
    expect(collectDoctorChecks(facts()).find((x) => x.id === "search")!.ok).toBe(true);
    const broken = collectDoctorChecks(facts({ search: { kind: "broken", message: "Unexpected token" } })).find((x) => x.id === "search")!;
    expect(broken.ok).toBe(false);
    expect(broken.fatal).toBe(false);
    expect(collectDoctorChecks(facts({ search: { kind: "ok" } })).find((x) => x.id === "search")!.ok).toBe(true);
  });

  it("tiers：只报数，恒 ok，detail 带三档分布", () => {
    const t = collectDoctorChecks(facts()).find((x) => x.id === "tiers")!;
    expect(t.ok).toBe(true);
    expect(t.fatal).toBe(false);
    expect(t.detail).toContain(" 条（cheap " + TIER_COUNTS.cheap + " / standard " + TIER_COUNTS.standard + " / strong " + TIER_COUNTS.strong);
  });
});

describe("verdictOf（末行总档：就绪/部分就绪/未就绪；只有 fatal 才 exit 1）", () => {
  it("全绿 ⇒ 就绪/0；非致命红 ⇒ 部分就绪/0；fatal ⇒ 未就绪/1", () => {
    expect(verdictOf(collectDoctorChecks(facts()))).toEqual({ verdict: "就绪", exitCode: 0 });
    expect(verdictOf(collectDoctorChecks(facts({ workspaceWritable: false })))).toEqual({ verdict: "部分就绪", exitCode: 0 });
    expect(verdictOf(collectDoctorChecks(facts({ nodeVersion: "18.0.0" })))).toEqual({ verdict: "未就绪", exitCode: 1 });
  });
});

describe("renderDoctor", () => {
  it("逐项 ✓/✗＋末行总档", () => {
    const checks = collectDoctorChecks(facts());
    const text = renderDoctor({ checks, ...verdictOf(checks) });
    expect(text).toContain("✓ node");
    expect(text.trim().endsWith("总档：就绪")).toBe(true);
  });
});

describe("runDoctor（IO 壳，tmpdir 真工作区）", () => {
  it("空目录：workspace 可写 ✓、search 未配不抛（loadSearchConfig 的 ENOENT ⇒ null ⇒ unset）", async () => {
    const ws = mkdtempSync(join(tmpdir(), "doctor-"));
    try {
      const r = await runDoctor(ws, { sandbox: { available: true } });
      expect(r.checks.find((c) => c.id === "workspace")!.ok).toBe(true);
      expect(r.checks.find((c) => c.id === "search")!.detail).toContain("search.endpoint 未配");
    } finally {
      rmSync(ws, { recursive: true, force: true });
    }
  });

  it(".agent/config.json 是坏 JSON ⇒ search 落在 broken（报告不抛、非致命）", async () => {
    const ws = mkdtempSync(join(tmpdir(), "doctor-"));
    try {
      mkdirSync(join(ws, ".agent"), { recursive: true });
      writeFileSync(join(ws, ".agent", "config.json"), "{bad json");
      const r = await runDoctor(ws, { sandbox: { available: true } });
      const search = r.checks.find((c) => c.id === "search")!;
      expect(search.ok).toBe(false);
      expect(search.fatal).toBe(false);
      expect(search.detail).toContain("config.json 存在但解析失败");
    } finally {
      rmSync(ws, { recursive: true, force: true });
    }
  });
});
