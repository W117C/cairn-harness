/** 变异表 ❌ 归因这把尺自己的判卷面（第 84 页）。
 *  动因：整表一轮 1919s，末尾只说「24 条变异存活或误伤」，三种代价差一个量级的结局混在一行里。
 *  分诊靠单条复跑，而"读哪句输出算哪种"是判据 ⇒ 判据必须有 vitest 面，
 *  否则它只有门脚本会跑到，改坏了没人红（规则 118：只有门在守的格子挂不上锚点）。 */
import { describe, expect, it } from "vitest";

import { classify, failedIds, failedLineCount, looseFailedLineCount, needsAction, redKindsOf } from "../scripts/lib/mutation-rerun-triage";

describe("failedIds：取料面先要可信", () => {
  it("三条 ❌ 就是三条，按行首锚定（描述里再出现 ❌ 也不额外多抽）", () => {
    const log = [
      "✅ a-alive — 正常杀死",
      "❌ b-one — 描述",
      "❌ b-two — 描述里也有 ❌ 字符，但行首只有一个",
      "   ❌ indented-not-a-verdict — 缩进行是输出正文，不是判定行",
      "❌ b-three — 三条",
    ].join("\n");
    expect(failedIds(log)).toEqual(["b-one", "b-two", "b-three"]);
  });

  it("同一条重复出现只留一份（否则复跑会把一条跑两遍，条数也读不成规模）", () => {
    const log = '❌ dup — 首次判定\n❌ dup — 末尾汇总回显\n';
    expect(failedIds(log)).toEqual(["dup"]);
    expect(failedLineCount(log)).toBe(2); // 行数与去重后的 id 数分开报，两者不等就是"有重复"这个事实
  });

  it("CRLF 行尾不吃掉分隔符（日志常由 shell 重定向产生）", () => {
    expect(failedIds("❌ x-one — 甲\r\n❌ x-two — 乙\r\n")).toEqual(["x-one", "x-two"]);
  });

  it("全绿日志抽出 0 条，而两把尺都读到 0 —— 一起看才叫「没有红」而不是「尺没跑到」", () => {
    const log = "✅ only-good — x\n全部变异被正确杀死（断言非恒真）\n";
    expect(failedIds(log)).toEqual([]);
    expect(failedLineCount(log)).toBe(0);
    expect(looseFailedLineCount(log)).toBe(0);
  });

  // 第 84 页实踩：复跑面第一版把「严格抽取 0 条」当成「日志里没有红」而 exit 0——
  // 而喂给它的假日志里确实有一行 `❌broken no em dash here`。抽取器与计数器共用一把尺时，
  // 日志形状一变两个数会**一起**变成 0。第二把尺只认行首，两把不等就是"尺对不上日志"。
  it("第二把尺：形状对不上时两把必须不等（这就是复跑面要红着退出的那一格）", () => {
    const odd = "❌broken no em dash here\n✅ fine\n";
    expect(failedLineCount(odd)).toBe(0);
    expect(looseFailedLineCount(odd)).toBe(1);
  });
});

describe("classify：四种结局＋一种「读不出」，且优先级确定", () => {
  it("已杀死：认那句汇总，退出码 0", () => {
    const r = classify("✅ 全部变异被正确杀死（断言非恒真）", 0);
    expect(r.verdict).toBe("已杀死");
    expect(r.note).toBe("");
  });

  it("真存活：改坏了而测试**全绿** ⇒ 才是「没有观测者」", () => {
    expect(classify("1 条变异存活或误伤", 1).verdict).toBe("存活");
  });

  // 第 84 页实测：整表末尾那句「N 条变异存活或误伤」把修法相反的两件事并成一桶。
  // `prune-attachment-production-entry` 单条复跑时红在**新标题**的用例上（tests/session-prune-attachments.test.ts:69），
  // 观测者一直在，过期的只是锚点的 expectFail ⇒ 若把它记成「存活」，就会凭空多造一条"缺尺"结论。
  it("红了未点名：测试确实红了、但没红在 expectFail 那条上 ⇒ 归到『改 expectFail』而不是『补测试』", () => {
    const out = [
      "⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯",
      " FAIL  tests/session-prune-attachments.test.ts > prune 存盘回取的生产入口 > ①生产形状（组装点未传 workspace）",
      "AssertionError: expected '[Old tool result content cleared]' to contain '读不到'",
      "1 条变异存活或误伤",
    ].join("\n");
    const r = classify(out, 1);
    expect(r.verdict).toBe("红了未点名");
    // 不再 `toContain("expectFail")`：`verdict` 这个封闭枚举就是这条判据的观测者，
    // 而「expectFail」在整表里是 7 处副本 ⇒ 收它等于没收（改坏措辞也不会红）。
  });

  it("红的判据要能认出 vitest 两种排版（`Failed Tests N` 段头 或 行首 FAIL）", () => {
    expect(classify("   FAIL  tests/x.test.ts > a\n1 条变异存活或误伤", 1).verdict).toBe("红了未点名");
    expect(classify("Test Files  1 failed | 3 passed (4)\n1 条变异存活或误伤", 1).verdict).toBe("存活");
  });

  it("基线红优先于存活：同一次输出里既有已提交红灯又带『变异存活』字样时，不许把它记成缺尺之外的缺口", () => {
    const both = "基线就不是全绿（不应发生）:\n     × 某条已提交的红灯\n24 条变异存活或误伤";
    expect(classify(both, 1).verdict).toBe("基线红");
  });

  it("未生效（针脚不在源文件里）单独一态——它与『存活』的修法相反", () => {
    expect(classify("突变未生效（锚点可能已失效）", 1).verdict).toBe("未生效");
  });

  it("反向一侧：非零退出而输出里没有任何可认的汇总行 ⇒ 读不出，绝不默认成『已杀死』", () => {
    const r = classify("some crash without summary", 1);
    expect(r.verdict).toBe("读不出");
    // 收 `cause` 字段而不是 `note` 的措辞（「不可信」在本仓有 7 处副本 ⇒ 收它是假验收）
    expect(r.cause).toBe("no-summary");
  });

  it("spawn 自己失败（没跑到）也是读不出，且退出码不参与判读", () => {
    const r = classify("", null, "ENOENT");
    expect(r.verdict).toBe("读不出");
    expect(r.cause).toBe("spawn");
  });

  // 这一格以前没有：两个成因曾被同一个 `if` 合并，note 里只用 `${… ?? "无退出码"}` 区分，
  // 于是"进程被信号杀掉（有 spawn、没退出码）"与"spawn 失败"在读数上长得一样 ⇒ 修法不同却同读。
  it("只有『没退出码』时 cause 必须是 no-exit-code，不与 spawn 混读", () => {
    const r = classify("", null);
    expect(r.verdict).toBe("读不出");
    expect(r.cause).toBe("no-exit-code");
  });

  it("其余各态 cause 一律空串（『读不出』才有成因；别把成因当成只有失败才有）", () => {
    expect(classify("✅ 全部变异被正确杀死（断言非恒真）", 0).cause).toBe("");
    expect(classify("1 条变异存活或误伤", 1).cause).toBe("");
  });
});

describe("被度量者自己的文案不许当成读数（第 188 页：锚点 desc 里引了判据那句话）", () => {
  /** 逐字取自 09-29 那一次分片跑的片 1 原文（10/10 全杀）——区别只在我把「基线就不是全绿」写进了 desc。 */
  const echoedGreen = [
    "变异验证：10 条",
    "✅ shard-host-split-gate-dropped — 算出「同一判卷宿主被摊到两片」却不拦 ⇒ 其中一片被「基线就不是全绿」那一格读走",
    "✅ shard-dirty-tree-accepted — 脏树检查算出条数却不回理由",
    "全部变异被正确杀死（断言非恒真）",
    "[mutate-verify] 本次耗时 13.4s · 跑了 10/10 条 · 未设预算（外层超时会在中途杀我，见 --budget-ms）",
  ].join("\n");

  it("绿跑里有一条 ✅ 描述正好引用了『基线就不是全绿』⇒ 仍判已杀死，不许读成基线红", () => {
    expect(classify(echoedGreen, 0).verdict).toBe("已杀死");
  });

  it("反方向更要紧：红跑的 ✅ 描述里引用了『全部变异被正确杀死』⇒ 不许读成已杀死", () => {
    const forged = [
      "❌ vacuous-run-guard-dropped — 把闸摘掉后那句『全部变异被正确杀死』照样印得出",
      "1 条判红（按类别分开数，修法各不同——见上一行起的分类名单）",
    ].join("\n");
    expect(classify(forged, 1).verdict).toBe("存活");
  });

  it("真的基线红那一行照旧认（缩进在行首，不是任意位置）", () => {
    const real = [
      "❌ cert-lock-stale-not-unlinked — 判定可回收却不先摘旧锁",
      "   基线就不是全绿（不应发生）:",
      " transform 23%, import 13%, worker 1%)",
    ].join("\n");
    expect(classify(real, 1).verdict).toBe("基线红");
  });

  it("未生效那一档也只认行首形状（带 ❌ 判红· 前缀的分类行算，塞在描述中间不算）", () => {
    // 必须**接在别的行后面**：单行样本里那句本来就在整段开头，摘掉 `m` 旗标也一样命中 ⇒ 突变等价、杀不掉。
    const real = [
      "变异验证：1 条",
      "  ❌ 判红·突变未生效（针脚不在源文件里）⇒ 空操作（1 条）：x",
    ].join("\n");
    expect(classify(real, 1).verdict).toBe("未生效");
    expect(classify("✅ some-anchor — 说明里写着「不要把 突变未生效 当结论」", 0).verdict).toBe("读不出");
  });
});

describe("needsAction：只有三类要人处理，其余不许牵连", () => {
  it("存活、红了未点名、读不出点名；基线红/未生效/已杀死都不算本轮的账", () => {
    const rows = [
      { id: "s1", verdict: "存活" as const },
      { id: "k1", verdict: "已杀死" as const },
      { id: "b1", verdict: "基线红" as const },
      { id: "u1", verdict: "未生效" as const },
      { id: "r1", verdict: "红了未点名" as const },
      { id: "n1", verdict: "读不出" as const },
    ];
    expect(needsAction(rows)).toEqual(["s1", "r1", "n1"]);
  });

  it("空表返回空——这一条是负控：函数不许在没跑的时候也报『有活要干』", () => {
    expect(needsAction([])).toEqual([]);
  });
});

describe("结构化那一行优先（第 172 页⑪，任务 #12）", () => {
  const kinds = (over: Partial<Record<string, number>> = {}) => {
    const base = { "survived": 0, "misattributed": 0, "baseline-red": 0, "no-effect": 0, "syntax": 0, "restore-mismatch": 0, "vacuous": 0, ...over };
    return "REDKINDS=" + Object.entries(base).map(([k, v]) => `${k}:${String(v)}`).join(",");
  };

  it("REDKINDS 在场就直接认类别，不再回头猜散文", () => {
    expect(classify(`x\n${kinds({ survived: 1 })}`, 1).verdict).toBe("存活");
    expect(classify(`x\n${kinds({ misattributed: 1 })}`, 1).verdict).toBe("红了未点名");
    expect(classify(`x\n${kinds({ "baseline-red": 1 })}`, 1).verdict).toBe("基线红");
    expect(classify(`x\n${kinds({ "no-effect": 1 })}`, 1).verdict).toBe("未生效");
    expect(classify(`x\n${kinds({ vacuous: 1 })}`, 1).note).toContain("由 REDKINDS 那一行直接给出");
  });

  it("同一件事的结构化读法与散文读法必须给同一个归宿（两份谓词不许各漂各的）", () => {
    // 存活：散文里没有失败面
    const proseAlive = classify("1 条变异存活或误伤", 1).verdict;
    expect(classify(`1 条判红\n${kinds({ survived: 1 })}`, 1).verdict, "结构化读出的归宿必须等于散文读出的").toBe(proseAlive);
    // 红了未点名：散文里有 FAIL 行
    const proseMis = classify("   FAIL  tests/x.test.ts > a\n1 条变异存活或误伤", 1).verdict;
    expect(classify(`   FAIL  tests/x.test.ts > a\n1 条判红\n${kinds({ misattributed: 1 })}`, 1).verdict).toBe(proseMis);
  });

  it("认不出的类别不许静默跳过——它只会来自一张长大了的表", () => {
    const r = classify("x\nREDKINDS=some-new-kind:2,survived:0", 1);
    expect(r.verdict).toBe("读不出");
    expect(r.note, "要点名是哪一类不认识，否则下一张表加类别就是无声降级").toContain("some-new-kind");
    expect(redKindsOf("REDKINDS=some-new-kind:2,survived:0")?.unknown).toEqual(["some-new-kind:2"]);
  });

  it("旧日志没有 REDKINDS 那一行 ⇒ 退回散文那一档，不许读成『读不出』", () => {
    expect(redKindsOf("1 条变异存活或误伤")).toBeNull();
    expect(classify("1 条变异存活或误伤", 1).verdict).toBe("存活");
    expect(classify("全部变异被正确杀死（断言非恒真）", 0).verdict).toBe("已杀死");
  });
});
