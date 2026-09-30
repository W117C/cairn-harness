// 认证门面（`CERT_GATES`）的判卷（第 224 页 #36）。
//
// 这一格要守的是三件事，缺一件就回到「cert exit=0 与门红并存」那个病：
// ⑴ 名单形状读得出来（读不出必须**红**，不能读成"这笔没有门面"）；
// ⑵ 跑没跑到 / 退出码非 0 = 红，而**超出预算只是出声**——判决不许押在时钟上（规则 256）；
// ⑶ 名单自己不许漂：要么含重量级门（一次认证变成 20 分钟），要么与 `head-cert` 已经跑过的重复计数。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CERT_GATES, CERT_GATE_EXCLUDED, GATES } from "../scripts/gate-manifest";
import { certGateCell, certGatePlan, certGateVerdict, parseCertGateRows } from "../scripts/lib/head-cert-deps";

const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const MANIFEST = read("../scripts/gate-manifest.ts");
/** 真机取料：`outputs/gate-cost-for-cert-face-2026-09-30/thirteen-gates-at-2becb8e.log`
 *  是认证树 `2becb8e` 上 `gates.ts --only=…` 的原文（13 道、逐道自报 exit 与 ms）。
 *  规则 250：入库的日志是免费取料面——解析器吃真文本，不吃我手写的理想形状。 */
const GATE_LOG = read("../outputs/gate-cost-for-cert-face-2026-09-30/thirteen-gates-at-2becb8e.log");

describe("certGatePlan：名单三态——读不到与「这一笔还没有」不许同形", () => {
  it("从真源文件里抽出整张名单，名字与预算逐个对上（表长不写死：长度归表管，规则 290）", () => {
    const face = certGatePlan(MANIFEST);
    expect(face.state).toBe("ok");
    expect(face.plan.map((g) => `${g.name}:${String(g.budgetMs)}`)).toEqual(
      CERT_GATES.map((g) => `${g.name}:${String(g.budgetMs)}`),
    );
    expect(face.plan.length, "一条都不许少（少＝被度量者改了形状而解析器静默漏读）").toBe(CERT_GATES.length);
    for (const g of face.plan) expect(g.budgetMs).toBeGreaterThan(0);
  });

  it("那一笔根本没有这一格 ⇒ absent（认证老提交不许被判红）", () => {
    expect(certGatePlan("export const GATES = [\n  \"docs-check\",\n];").state).toBe("absent");
    expect(certGatePlan(null).state).toBe("absent");
  });

  it("格子在而形状变了 ⇒ broken，且 head-cert 把这一态当红（不是「名单为空」）", () => {
    const face = certGatePlan("export const CERT_GATES: readonly X[] = [] as never;\n");
    expect(face.state).toBe("broken");
    expect(face.plan).toEqual([]);
  });
});

describe("认证面那一格的判定与读数分开", () => {
  const plan = [{ name: "docs-check", budgetMs: 1300 }, { name: "prune-check", budgetMs: 1100 }];

  it("真机日志解析出来的行含名字、退出码、毫秒（ANSI 不挡路）", () => {
    const rows = parseCertGateRows(GATE_LOG);
    const docs = rows.find((r) => r.name === "docs-check");
    expect(docs).toEqual({ name: "docs-check", exit: 0, ms: 606 });
    expect(rows.some((r) => r.name === "mutate-needles-check" && r.ms === 9756)).toBe(true);
  });

  it("缺席＝红，且那句话点名是哪道门", () => {
    const v = certGateVerdict(plan, [{ name: "docs-check", exit: 0, ms: 606 }]);
    expect(v.reds).toHaveLength(1);
    expect(v.reds[0]).toContain("prune-check");
    expect(certGateCell(plan, v)).toContain("❌ 红 1 道");
  });

  it("退出码非 0＝红；两样都绿时那一格印「绿 2 道」", () => {
    const red = certGateVerdict(plan, [{ name: "docs-check", exit: 1, ms: 606 }, { name: "prune-check", exit: 0, ms: 500 }]);
    expect(red.reds).toHaveLength(1);
    expect(red.reds[0]).toContain("exit=1");
    const green = certGateVerdict(plan, [{ name: "docs-check", exit: 0, ms: 606 }, { name: "prune-check", exit: 0, ms: 500 }]);
    expect(green.reds).toEqual([]);
    expect(green.warns).toEqual([]);
    expect(certGateCell(plan, green)).toContain("绿 2 道");
  });

  it("超预算只出声，不改判定（判决不许押在时钟粒度与调度上）", () => {
    const v = certGateVerdict(plan, [{ name: "docs-check", exit: 0, ms: 99_999 }, { name: "prune-check", exit: 0, ms: 500 }]);
    expect(v.reds, "慢不是红：这台机器负载高、隔壁在跑都会挪秒数").toEqual([]);
    expect(v.warns).toHaveLength(1);
    expect(v.warns[0]).toContain("docs-check");
    expect(v.warns[0]).toContain("超");
  });

  it("名单外的行只出声——名单与实跑不一致＝有一份手写表在漂", () => {
    const v = certGateVerdict(plan, [{ name: "docs-check", exit: 0, ms: 606 }, { name: "prune-check", exit: 0, ms: 500 }, { name: "plugins-check", exit: 0, ms: 15_209 }]);
    expect(v.reds).toEqual([]);
    expect(v.warns.join(" ")).toContain("名单外");
  });
});

describe("接线那一半：head-cert 真去跑门、真把红的接进退出码", () => {
  // 语义面在上面（那几格是纯函数，能真喂输入）；这里只答"这一支到底接没接上"——
  // 与 `tests/shell-family-cause.test.ts` 那组同形状：行锚定 + 当场做一份突变副本证明正则不是恒真。
  const SRC = read("../scripts/head-cert.ts");
  const line = (re: RegExp): RegExpExecArray | null => re.exec(SRC);

  it("跑门那一行、名单来源、退出码里的门红三项都在语句开头", () => {
    expect(line(/^[ \t]*const gr = run\(TREE, "node", \["--import", "tsx", "scripts\/gates\.ts", /mu), "认证门面没去 spawn gates.ts").not.toBeNull();
    expect(line(/^[ \t]*const face = certGatePlan\(gateSrc/mu), "名单没取自被认证的那一笔（会读成假完整）").not.toBeNull();
    expect(line(/^[ \t]*const code = certifiable[\s\S]{0,200}&& gateReds\.length === 0/mu), "门红没接进退出码 ⇒ cert exit=0 又只剩判卷").not.toBeNull();
  });

  it("把跑门那一行摘掉，上面那条接线证人就红（不是恒真正则）", () => {
    const one = SRC.replace(/^[ \t]*const gr = run\(TREE[^\n]*gates\.ts[^\n]*$/mu, "  const gr = { status: 0, out: \"\" };");
    expect(/^[ \t]*const gr = run\(TREE, "node", \["--import", "tsx", "scripts\/gates\.ts", /mu.test(one), "突变副本里那行还在 ⇒ 正则没在数语句").toBe(false);
    expect(SRC).not.toBe(one); // 真的动过字节，不是 replace 打了个空
  });
});

describe("名单自己的边界（这条门不能变成一次 20 分钟的认证）", () => {

  it("每道门都在 GATES 里（名单不是第二事实源）", () => {
    for (const g of CERT_GATES) expect(GATES, `门 ${g.name} 不在 GATES 上`).toContain(g.name);
    expect(new Set(CERT_GATES.map((g) => g.name)).size).toBe(CERT_GATES.length);
  });

  it("重量级门与 `head-cert` 已自跑的两道绝不重复进门面", () => {
    for (const g of CERT_GATES) {
      expect(CERT_GATE_EXCLUDED, `${g.name} 是分钟级或已被本趟跑过`).not.toContain(g.name);
      expect(g.budgetMs, `${g.name} 的预算超过 20s ⇒ 认证这一趟不该带它`).toBeLessThanOrEqual(20_000);
    }
  });

  it("预算都是实测的两倍档（量纲类留余量、计数类不留）：单项预算 ≥ 400ms 且总额可加", () => {
    const total = CERT_GATES.reduce((n, g) => n + g.budgetMs, 0);
    expect(total).toBeLessThanOrEqual(60_000);
    for (const g of CERT_GATES) expect(g.budgetMs).toBeGreaterThanOrEqual(400);
  });

  /* 第 272 页。动因是一条被证伪的补偿声称：`evidence-typecheck-check` 建门时（第 259 页）写的是
     「单价 2.06s 高于 <1.5s 那条线 ⇒ 不进认证面，由 `pnpm gates` 与**交笔时手动跑**覆盖」，
     而我在第 268/269/270/271 连续四笔都没手动跑 ⇒ 自己第 269 页入库的探针带着一条 TS7053 落了库。
     ⇒ 「人肉记得跑」不是覆盖机制（规则 292 同族）。这一条用例钉的是**类**：
       每笔交笔都要成立的判据不许因单价线被挡在门外；挡在门外的每一道都得有真证人，不能只有散文。 */
  it("交笔必跑的门按类进门面：`evidence-typecheck-check` 在册且预算不低于实测两倍", () => {
    const row = CERT_GATES.find((g) => g.name === "evidence-typecheck-check");
    expect(row, "不在门面＝这道门又退化成「交笔时手动跑」那种没人守的承诺").toBeDefined();
    expect(GATES, "门面名单不许变成第二事实源：这道门必须同时在 `GATES` 上").toContain("evidence-typecheck-check");
    expect(row!.budgetMs, "预算写成低于实测两倍＝拿一次读数当上限，负载一动就红").toBeGreaterThanOrEqual(2 * 2644);
  });
});
