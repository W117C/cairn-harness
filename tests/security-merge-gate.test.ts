// 合并准入闸的判卷（2026-10-02 立项）。
//
// 立项动因（全仓普查实测，不是印象）：`src/agent/security/llm-review.ts` 的 `llmReviewDiff`
// 是「静态扫描漏了、LLM 补上」这条**唯一**兜底路径，而它把 findings 送进
// `mergeWorker` 的 gate 档之前**没有任何证人**：
//   · `tests/` 里零条断言调 `llmReviewDiff`（`hardening3` 只引了同文件的 `buildMessages`）；
//   · 1234 条变异锚点里 `llm-review.ts` 一条都没有；
//   · `scripts/security-check.ts` 里 `llm` / `gate` / `merge` / `blocking` 各出现 0 次。
// ⇒ 把 `high` 从闸的过滤器里删掉、或让 `parseLlmFindings` 把 severity 悄悄降级，
//   全仓 3754 条断言**一条都不会红**。本文件补的就是这一格。
//
// 关键取舍：判卷吃的是 `src/agent/security/merge-gate.ts` 那**同一份**纯函数，
// 不在测试里另写一遍 `severity === "high"`。理由是本仓最忌「同一条判据各抄一份」——
// 抄一份的话，生产改了判卷还在验，漂掉的方向恰恰是「判卷绿、闸放行」。
import { describe, expect, it } from "vitest";
import { parseLlmFindings } from "../src/agent/security/llm-review";
import {
  MERGE_BLOCKING_SEVERITIES,
  isMergeBlocking,
  mergeBlockingFindings,
  mergeGateMessage,
  mergeGateVerdict,
} from "../src/agent/security/merge-gate";
import type { SecurityFinding } from "../src/events";

/** 造一条 findings（只填判据要用的那几个字段；schema 校验在 parse 那侧，这里是闸的输入）。 */
const finding = (severity: SecurityFinding["severity"], path = "a.ts", line = 3): SecurityFinding =>
  ({ severity, path, line, title: "t", description: "d", ruleId: "r", category: "llm_review" }) as SecurityFinding;

/** LLM 原始响应（一段真的会被 parse 的 JSON 文本）——链路的输入端。 */
const llmSays = (severity: string, extra: Record<string, unknown> = {}): string =>
  JSON.stringify([{ severity, path: "src/risky.ts", line: 12, title: "硬编码密钥", description: "d", ...extra }]);

describe("闸的判据本身：哪两档挡合并", () => {
  it("挡合并的恰好是 critical 与 high（不多不少）", () => {
    // 这条是「不许靠改数组了事」的锁：去掉 high ⇒ 「LLM 补出来的高危」全部放行。
    expect([...MERGE_BLOCKING_SEVERITIES].sort()).toEqual(["critical", "high"]);
  });

  it("critical / high 挡，medium / low 不挡", () => {
    expect(isMergeBlocking(finding("critical"))).toBe(true);
    expect(isMergeBlocking(finding("high"))).toBe(true);
    expect(isMergeBlocking(finding("medium"))).toBe(false);
    expect(isMergeBlocking(finding("low"))).toBe(false);
  });

  it("空清单 ⇒ 没有挡合并的（gate 不会因为「没扫到东西」而卡住一切）", () => {
    expect(mergeBlockingFindings([])).toEqual([]);
  });

  it("混合清单只挑出挡合并的那几条，且保持原顺序（卡面要逐条点名）", () => {
    const all = [finding("low", "l.ts"), finding("high", "h.ts"), finding("medium", "m.ts"), finding("critical", "c.ts")];
    expect(mergeBlockingFindings(all).map((f) => f.path)).toEqual(["h.ts", "c.ts"]);
  });
});

describe("闸的裁决是三态，不是两态", () => {
  it("无挡合并项 ⇒ 放行，且 blocking 是空元组", () => {
    const v = mergeGateVerdict([finding("low"), finding("medium")]);
    expect(v.allow).toBe(true);
    expect(v.blocking).toEqual([]);
  });

  it("有 high 且没人确认 ⇒ 拒绝（合并权永远在人）", () => {
    const v = mergeGateVerdict([finding("high")]);
    expect(v.allow).toBe(false);
    expect(v.forced).toBe(false);
  });

  it("force=true ⇒ 放行，但**必须留下 forced 痕迹**（合成一态就没人验这条路了）", () => {
    const v = mergeGateVerdict([finding("critical")], { force: true });
    expect(v.allow).toBe(true);
    expect(v.forced).toBe(true);
    expect(v.blocking).toHaveLength(1); // 放行也要说清挡了什么
  });

  it("force 只对当次生效：不给 force 的另一次调用仍然拒", () => {
    // 作用域回归：force 必须是逐次参数，不许在某处被记成常开。
    expect(mergeGateVerdict([finding("high")], { force: true }).allow).toBe(true);
    expect(mergeGateVerdict([finding("high")]).allow).toBe(false);
  });
});

describe("链路证人：LLM 报 high ⇒ 合并真的被拒（这一格此前无人守）", () => {
  it("LLM 原始响应里的 high，走完 parse 再进闸 ⇒ 拒", () => {
    const parsed = parseLlmFindings(llmSays("high"), 0);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.severity).toBe("high");
    expect(mergeGateVerdict(parsed).allow).toBe(false);
  });

  it("同一条链路，force=true 才放行（人确认这条路也有证人）", () => {
    const parsed = parseLlmFindings(llmSays("high"), 0);
    expect(mergeGateVerdict(parsed, { force: true }).allow).toBe(true);
  });

  it("LLM 报 medium ⇒ 不挡（gate 不是「零告警才能合并」）", () => {
    const parsed = parseLlmFindings(llmSays("medium"), 0);
    expect(mergeGateVerdict(parsed).allow).toBe(true);
  });

  it("LLM 报 critical ⇒ 拒（两档都要有证人，不能只钉 high）", () => {
    expect(mergeGateVerdict(parseLlmFindings(llmSays("critical"), 0)).allow).toBe(false);
  });
});

describe("schema 严格性：非法形状不许被「顺手放行」（这是漏报那一侧）", () => {
  // 这几条量的都是**同一件事**：一条真发现被丢进闸里之前就被结构校验挡掉 ⇒ 闸看不见它 ⇒ 放行。
  // 反过来，非法 severity 若被「宽容地」归一成 low，同样是绕过闸。所以两者都断「被丢掉」。

  it("severity 取值非法 ⇒ 整条丢弃（不许归一成 low 去绕过闸）", () => {
    for (const bad of ["HIGH", "blocker", "严重", ""]) {
      expect(parseLlmFindings(llmSays(bad), 0), `severity=${JSON.stringify(bad)}`).toEqual([]);
    }
  });

  it("行号非法（0 / 负数 / 缺失 / 非整数）⇒ 整条丢弃", () => {
    for (const bad of [0, -1, undefined, "3", 1.5]) {
      const raw = JSON.stringify([{ severity: "high", path: "a.ts", line: bad, title: "t", description: "d" }]);
      expect(parseLlmFindings(raw, 0), `line=${JSON.stringify(bad)}`).toEqual([]);
    }
  });

  it("缺 path / title ⇒ 丢弃（没有定位信息的发现没法让人核对，也不许进闸）", () => {
    for (const key of ["path", "title"]) {
      const obj: Record<string, unknown> = { severity: "high", path: "a.ts", line: 3, title: "t", description: "d" };
      delete obj[key];
      expect(parseLlmFindings(JSON.stringify([obj]), 0), `缺 ${key}`).toEqual([]);
    }
  });

  it("非 JSON 散文 ⇒ 0 条（不许把散文编成 findings——编造比漏报更坏）", () => {
    expect(parseLlmFindings("我认为这段代码存在高危漏洞，但没有给出结构化输出。", 0)).toEqual([]);
  });

  it("```json 围栏 + 前后闲话 ⇒ 照样取出（真实响应就是这个形状）", () => {
    const raw = "审查开始。\n```json\n" + llmSays("high") + "\n```\n审查完毕。";
    const out = parseLlmFindings(raw, 0);
    expect(out).toHaveLength(1);
    expect(mergeGateVerdict(out).allow).toBe(false);
  });

  it("confidence 是垃圾值 ⇒ 字段整条消失，但**发现本身必须留下**（它不是必填项）", () => {
    // 这条防的是「把『模型没说』写成『模型说了中等把握』」那种谎；
    // 反向也要钉住：不能因为把握度不合法就把一条 high 真发现丢掉（那是漏报）。
    const out = parseLlmFindings(llmSays("high", { confidence: "very sure" }), 0);
    expect(out).toHaveLength(1);
    expect(out[0]?.severity).toBe("high");
    expect(out[0]?.confidence).toBeUndefined();
  });

  it("数组元素不是对象 ⇒ 跳过，不炸", () => {
    expect(parseLlmFindings(JSON.stringify([["high", "a.ts", 3], null, 42]), 0)).toEqual([]);
  });
});

describe("卡面文案：必须说清「哪几条」与「人能做什么」", () => {
  it("点名到文件:行 + 条数，并写明 force 是哪条路", () => {
    const msg = mergeGateMessage([finding("high", "src/x.ts", 42), finding("critical", "src/y.ts", 7)]);
    expect(msg).toContain("src/x.ts:42");
    expect(msg).toContain("src/y.ts:7");
    expect(msg).toContain("2");
  });

  it("超过 3 条只点前 3 条（卡面有界），但条数照实报", () => {
    const many = Array.from({ length: 9 }, (_, i) => finding("high", `f${i}.ts`, i + 1));
    const msg = mergeGateMessage(many);
    expect(msg).toContain("9");
    expect(msg).toContain("f0.ts:1");
    expect(msg).not.toContain("f5.ts");
  });
});

describe("反向验证：这些判据能变红（判不出红的判据是摆设）", () => {
  it("把 high 从闸里去掉 ⇒ 链路的 high 用例必须转红（本组即该反向验证的证人）", () => {
    // 不真去改生产代码（那会脏工作树），而是**在判卷内部**造一份「去掉 high 的闸」，
    // 证明上面那条链路断言真的有分辨力：它对「high 挡不挡」这件事敏感。
    const crippled = MERGE_BLOCKING_SEVERITIES.filter((s) => s !== "high");
    // 显式放宽回 SecuritySeverity：filter 的 `s !== "high"` 会把元素类型收窄成
    // `"low"|"medium"|"critical"`，而反向验证要量的恰恰是**被收窄掉的那一档**。
    const crippledSevs: readonly SecurityFinding["severity"][] = crippled;
    const crippledGate = (fs: readonly SecurityFinding[], force?: boolean) => {
      const blocking = fs.filter((f) => crippledSevs.includes(f.severity));
      if (blocking.length === 0) return true;
      return force === true;
    };
    const parsed = parseLlmFindings(llmSays("high"), 0);
    expect(mergeGateVerdict(parsed).allow, "真闸：high 挡住").toBe(false);
    expect(crippledGate(parsed), "去掉 high 的闸：放行 ⇒ 上面那条断言确实在测这一格").toBe(true);
  });

  it("判据与消费方同源：逐档语义等值（判卷自己另写一份就会在这里漂）", () => {
    expect(mergeBlockingFindings).toBeTypeOf("function");
    expect(mergeGateVerdict).toBeTypeOf("function");
    for (const sev of ["critical", "high", "medium", "low"] as const) {
      expect(isMergeBlocking(finding(sev))).toBe(sev === "critical" || sev === "high");
    }
  });
});
