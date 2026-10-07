// 认证退出码那一格（第 426 页 · 任务 #14）。
//
// 动因是**同一个疏忽连写三页**：第 421／423／425 页凭证都留了同一句「`HEADCERT_EXIT` 是 nohup 起的、没直取」，
// 而那个码门本来就已经算出来了——只差没印进读数行。按「重复疏忽要搬进工具」的口径，这一格不再靠人记 `$?`。
// 形状纪律：判决与那句读数**共用同一份纯函数**（`certExitCode` / `certExitCodeCell`），调用方不许在外面再写一遍
// `&&` 串——那是第二份事实源，也正是本仓反复登记的「构造面与验证面各算一遍」。
//
// 用例按**层**分开（判决 ／ 逐维点名 ／ 读数一致性 ／ 装配）：一条用例被两台各红一次时，其中一台的守卫其实
// 是冗余的——所以「判决」「dims」「cell 文案」拆成三问，让每台变异都有只属于它的那条证人。
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { certExitCode, certExitCodeCell, certFailingDims, type CertOutcome } from "../scripts/lib/head-cert-provenance";

const HEAD_CERT_SRC = readFileSync(fileURLToPath(new URL("../scripts/head-cert.ts", import.meta.url)), "utf8");

const GREEN: CertOutcome = {
  depsComplete: true,
  typecheckOk: true,
  testStatus: 0,
  gateRedCount: 0,
  dirtyJudged: 0,
  treeDrifted: false,
};

/** 逐维推到对面（其余五维保持全绿）。`dimText` ＝ 那一维在 `certFailingDims` 与读数里必须出现的那串。 */
const ONE_RED: Array<{ dimText: string; patch: Partial<CertOutcome> }> = [
  { dimText: "依赖不全", patch: { depsComplete: false } },
  { dimText: "typecheck 非 0", patch: { typecheckOk: false } },
  { dimText: "判卷 exit=1", patch: { testStatus: 1 } },
  { dimText: "认证门面红 2 道", patch: { gateRedCount: 2 } },
  { dimText: "判卷四面在飞 3 项", patch: { dirtyJudged: 3 } },
];

describe("判决那一层：六维的合取", () => {
  it("① 六维全过 ⇒ 0", () => {
    expect(certExitCode(GREEN)).toBe(0);
    expect(certFailingDims(GREEN)).toEqual([]);
  });

  // 这一层只问判决与逐维点名，**不碰读数文案**：这样「阈值被挪松」那一维只有这里能红。
  for (const c of ONE_RED) {
    it(`② 只有「${c.dimText}」这一维翻红 ⇒ 判决给 1，且逐维点名正好一条`, () => {
      const o = { ...GREEN, ...c.patch };
      expect(certExitCode(o)).toBe(1);
      expect(certFailingDims(o)).toEqual([c.dimText]);
    });
  }

  // 「读数作废」是第三种态：既不是「HEAD 红」也不是绿（规则 92/232）。它必须由判决这一层单独接住。
  it("③ 收尾复核发现树被切走 ⇒ 判决必须给 1（这一条只看判决函数）", () => {
    expect(certExitCode({ ...GREEN, treeDrifted: true })).toBe(1);
  });

  it("④ 作废那一维不进「红的维」那一列，文案要说「读数作废」", () => {
    const o = { ...GREEN, treeDrifted: true };
    expect(certFailingDims(o)).toEqual([]);
    const cell = certExitCodeCell(o);
    expect(cell).toContain("读数作废");
    expect(cell).toContain("既不算「HEAD 红」也不算绿");
    expect(cell).not.toContain("红的维：");
  });

  it("⑤ 又作废又有红 ⇒ 两件事都要说出来，不许只报头一件", () => {
    const cell = certExitCodeCell({ ...GREEN, treeDrifted: true, gateRedCount: 1 });
    expect(cell).toContain("读数作废");
    expect(cell).toContain("同趟另有红的维");
    expect(cell).toContain("认证门面红 1 道");
  });

  it("⑥ `--skip-test`（testStatus=null）那一维不算红也不算证过——钉住现行语义", () => {
    const o = { ...GREEN, testStatus: null };
    expect(certFailingDims(o)).toEqual([]);
    expect(certExitCode(o)).toBe(0);
    // 等级不是这一格的事：门另有「认证等级」那行，这里不许由 null 顶成「全量判卷通过」。
    expect(certExitCodeCell(o)).not.toContain("全量判卷通过");
  });
});

describe("读数那一层：码、点名、归属", () => {
  /** 八张面：全绿、五维各翻一次、纯作废、作废＋红、跳过判卷。 */
  const FACES: CertOutcome[] = [
    GREEN,
    ...ONE_RED.map((c) => ({ ...GREEN, ...c.patch })),
    { ...GREEN, treeDrifted: true },
    { ...GREEN, treeDrifted: true, typecheckOk: false },
    { ...GREEN, testStatus: null },
  ];

  // 只有「读数自己算一遍」这一台会红在这里：判决与 dims 都不受影响，两边一旦分叉就红。
  it("⑦ cell 报的码必须等于 certExitCode 的返回值（八张面各问一次）", () => {
    for (const o of FACES) {
      const cell = certExitCodeCell(o);
      const m = cell.match(/^本次退出码=([01])/u);
      expect(m, cell).not.toBeNull();
      expect(Number(m![1]), `面=${JSON.stringify(o)} 的读数=${cell}`).toBe(certExitCode(o));
    }
  });

  // 这条的标题是**字面量**（不像上面那族由 `${c.dimText}` 拼出来）：第 429 页实测——
  // 锚点的 `expectFail` 指在拼接标题上会被算进「松钉指针」那一维（只靠占位符展开过关 ⇒ 秒级尺认不出），
  // 水位帽 10 因此被顶红。所以给「阈值挪松」这一维配一条能当 killer 的字面标题证人。
  it("⑭ 认证门面那一维的阈值是 0：红一道就算红（不许挪成 ≥2）", () => {
    expect(certExitCode({ ...GREEN, gateRedCount: 1 })).toBe(1);
    expect(certFailingDims({ ...GREEN, gateRedCount: 1 })).toEqual(["认证门面红 1 道"]);
  });

  it("⑧ 红的那些面上，读数必须点名红的维", () => {
    for (const c of ONE_RED) {
      expect(certExitCodeCell({ ...GREEN, ...c.patch })).toContain(c.dimText);
    }
    expect(certExitCodeCell(GREEN)).toContain("本次退出码=0");
  });

  // 反向哨兵（A≠旧值）：汇总里已经有一行 `exit=1（退出码直接取）`——那是 test runner 的码。
  // 两个码同屏而不说归属，凭证页就会把其中一个抄成另一个（第 425 页差点就是这么写的）。
  it("⑨ 读数必须点名这是门自己的码，不是它跑进去的 test runner 的码", () => {
    expect(certExitCodeCell(GREEN)).toContain("不是它跑进去的 test runner 的码");
    expect(certExitCodeCell({ ...GREEN, typecheckOk: false })).toContain("不是它跑进去的 test runner 的码");
  });
});

describe("装配面：判决与读数共用同一份，且落在文件写盘之前", () => {
  const lines = HEAD_CERT_SRC.split("\n").filter((l) => /^\s*const code = /.test(l));

  it("⑩ 退出码只有一条算式，且它调的是那份共用函数（不许留第二条 `&&` 串）", () => {
    expect(lines).toHaveLength(1);
    expect(lines[0]).toBe("const code = certExitCode(outcome);");
  });

  it("⑪ 读数行调的是 `certExitCodeCell(outcome)`，与判决同一份输入", () => {
    expect(HEAD_CERT_SRC).toMatch(/certExitCodeCell\(outcome\)/u);
    expect(HEAD_CERT_SRC).toMatch(/const outcome: CertOutcome = \{/u);
  });

  // 位置证人：先 say 再落盘，那一格才同时进 stdout／summary.txt／provenance。
  // 顺序倒了不是「少一行」而是**入库的那两份没有它**——而凭证页引用的恰恰是入库的那份。
  it("⑫ say 在 summary.txt 与 provenance 落盘之前", () => {
    const atSay = HEAD_CERT_SRC.indexOf("certExitCodeCell(outcome)");
    const atSummary = HEAD_CERT_SRC.indexOf('writeFileSync(join(logDir, "summary.txt")');
    const atProv = HEAD_CERT_SRC.indexOf("provenanceDoc(");
    expect(atSay).toBeGreaterThan(-1);
    expect(atSummary).toBeGreaterThan(-1);
    expect(atProv).toBeGreaterThan(-1);
    expect(atSay).toBeLessThan(atSummary);
    expect(atSay).toBeLessThan(atProv);
  });

  it("⑬ 旧的那条内联合取式已从判决处消失（同一件事不许有两个算法）", () => {
    expect(HEAD_CERT_SRC).not.toMatch(/const code = certifiable &&/u);
  });
});
