// 判卷 · 回取承诺的**清单完整性**（第 63 页 §六 那条"这条尺没进门"的债，这一笔还）。
//
// 为什么必须有 vitest 这一半：探针（`scripts/probe-promise-recall.ts`）只有人记得跑它才说话；
// 而 D-8 第五判据点名的正是这一族形状——「机制挂在"有人跑"上，不挂在现状上」。
// 本文件不重抄判据，只吃探针导出的那一份纯函数（规则 100：同一条判据各抄一份迟早漂）。
//
// 判的两格（缺一格就能骗过去）：
//   ① 每个模型可见的回取承诺面都有判定归属（新加一句「全文见 X」而不登记 ⇒ 红）；
//   ② 判定归属表里没有陈旧键（把三处副本收成一支之后旧键还挂着 ⇒ 红，与 D-8 ② 同族）。
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  PROMISE_MARKS, RUNNERS, UI_ROOTS, promiseInventoryFindings, scanPromiseSites,
  type PromiseSite,
} from "../scripts/probe-promise-recall";
import { trackedScriptFiles } from "../scripts/lib/scan-scope";

const ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");

/** 真盘取料：与探针同一套口径（`trackedScriptFiles` 那份，不各抄一份 git ls-files）。 */
function srcSources(): { files: { path: string; text: string }[]; missingOnDisk: string[] } {
  const tracked = trackedScriptFiles(ROOT, "src") ?? [];
  const files: { path: string; text: string }[] = [];
  const missingOnDisk: string[] = [];
  for (const p of tracked) {
    if (!existsSync(join(ROOT, p))) {
      missingOnDisk.push(p);
      continue;
    }
    files.push({ path: p, text: readFileSync(join(ROOT, p), "utf8") });
  }
  return { files, missingOnDisk };
}

const scanned = srcSources();
const sites = scanPromiseSites(scanned.files);
const findings = promiseInventoryFindings(sites, RUNNERS);

describe("回取承诺清单：每一面都得有判定归属，登记表不许烂在这儿", () => {
  it("真盘扫到了料（读到 0 处＝没有尺，不读成干净——规则 74）", () => {
    expect(sites.length, "PROMISE_MARKS=" + PROMISE_MARKS.join("/")).toBeGreaterThan(0);
    // 取料面必须说得出范围：模型可见 / 免判 / 已跟踪不在盘，三样都要有数。
    expect(findings.modelKeys.length, JSON.stringify(findings.byAudience)).toBeGreaterThan(0);
  });

  it("每一处模型可见的承诺面都有判定归属（新加一句『全文见 X』而不登记 ⇒ 这条先红）", () => {
    expect(findings.unjudged, "没有判定归属的面：" + findings.unjudged.join(" | ")).toEqual([]);
  });

  it("判定归属表里没有陈旧键（那一面已不在盘上发射，登记表必须跟着撤）", () => {
    expect(findings.stale, "陈旧归属键：" + findings.stale.join(" | ")).toEqual([]);
  });

  it("复现器：凭空加一处承诺面 ⇒ 清单当场点名它（证明①不是恒真）", () => {
    const one = scanned.files.find((f) => f.path === "src/agent/plugins/skills.ts") ?? scanned.files[0];
    const withExtra = scanPromiseSites([
      { path: one.path, text: one.text + '\nfunction __addedPromise(): string { return "[全文见 /somewhere/else]"; }\n' },
    ]);
    const after = promiseInventoryFindings(withExtra, RUNNERS);
    expect(after.unjudged, "加了新面而判据没报 ⇒ 这条判据是恒真的").toContain("src/agent/plugins/skills.ts#__addedPromise");
  });

  it("反向一侧：同形状落在 UI 根里 ⇒ 不进义务名单（豁免按落位，不是全量放行）", () => {
    const uiRoot = UI_ROOTS[0]!;
    const asUi: PromiseSite[] = scanPromiseSites([
      { path: uiRoot + "__probe.js", text: 'function __probeUi(): string { return "[全文见 安全报告卡]"; }' },
    ]);
    expect(asUi.length, "UI 根那条得先扫得到料").toBeGreaterThan(0);
    const f = promiseInventoryFindings(asUi, RUNNERS);
    expect(f.modelKeys, JSON.stringify(f.byAudience)).toEqual([]);
    expect(f.unjudged).toEqual([]);
  });

  // #58：收料表原先只有五种中文措辞 ⇒ 英文写法（`obs_recall available`）与另一种中文（`取全文 obs_recall id=`）
  // 整族漏收（规则 122：机制判据挂在一种写法上＝换写法即绕过）。下面三条把"网加宽了"与
  // "没宽到把散文当承诺"一起钉住（第 68 页的教训：一条把安全写法也判红的判据，下一轮就有人放宽它）。
  it("#58 两种新写法都进清单，并且各自当场欠一条判定归属", () => {
    const sites = scanPromiseSites([
      { path: "src/__probe_en.ts", text: 'function a(): string { return "[observation abc: 12 bytes, 3 lines; obs_recall available]"; }' },
      { path: "src/__probe_zh.ts", text: 'function b(): string { return "[source_sha=deadbeef; 取全文 obs_recall id=abc]"; }' },
    ]);
    expect(sites.map((s) => s.mark).sort(), JSON.stringify(sites.map((s) => [s.file, s.mark]))).toEqual([" available", "取全文"]);
    const f = promiseInventoryFindings(sites, RUNNERS);
    expect(f.unjudged.length, "新面没被要求登记判定 ⇒ 这把尺只收字不逼判定").toBe(2);
  });

  it("负控：光有 available 而没点一个可调用的工具 ⇒ 不算承诺（本轮实测假红过的那条形状）", () => {
    const sites = scanPromiseSites([
      { path: "src/__probe_fp.ts", text: 'function c(): string { return "[context_budget_exceeded] final estimate 9; available 4321; request not sent"; }' },
    ]);
    expect(sites).toEqual([]);
  });

  it("盘上这两格确实进了模型可见清单（合成样本过了而盘上没收，等于没修）", () => {
    expect(findings.modelKeys).toContain("src/agent/ledger.ts#project");
    expect(findings.modelKeys).toContain("src/agent/solpi-runtime.ts#candidate");
  });
});
