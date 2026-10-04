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
import { certGateCell, certGatePlan, certGateVerdict, onlyListDiff, onlyListsIn, parseCertGateRows } from "../scripts/lib/head-cert-deps";

const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const MANIFEST = read("../scripts/gate-manifest.ts");
/** 真机取料：`outputs/gate-cost-for-cert-face-2026-09-30/thirteen-gates-at-2becb8e.log`
 *  是认证树 `2becb8e` 上 `gates.ts --only=…` 的原文（13 道、逐道自报 exit 与 ms）。
 *  规则 250：入库的日志是免费取料面——解析器吃真文本，不吃我手写的理想形状。 */
const GATE_LOG = read("../outputs/gate-cost-for-cert-face-2026-09-30/thirteen-gates-at-2becb8e.log");
/** 第 273 页的第二本取料：**入库的全表日志**（31 道逐道 `exit`/`ms`，主检出那一趟）。
 *  规则 250——代价已经付过，读数就在盘上，判卷不必再跑二十分钟去买同一个数。 */
const ALL_GATES_LOG = read("../outputs/gates-outside-cert-2026-10-01/gates-all.log");
/** 门面那条「亚秒档全进」的线：它此前只在 `gate-manifest.ts` 的注释里活着，本笔把它变成判据。 */
const FAST_LINE_MS = 1500;

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

  /* 第 273 页：把门表头上那句「实测 <1.5s 全进」从散文变成判据。
     动因不是又漏跑了一格，而是这句话**只对部分人成立**：同一趟全表里 `web-fetch-check` 实测 568ms 却在门外——
     而它当初被挡在外面的理由（「本轮没量过就不占那个位」）已经被那趟跑掉了。
     取料是入库的那本日志（规则 250）⇒ 判卷不重跑二十分钟。
     两条各管一半：⑴「线内的必须在门面」防"散文只对熟门生效"；⑵「预算 ≥ 该日志里的实测 ms」防"占位式的预算"。
     ⚠️ 这条判据用的是**同一本日志里的 ms**，不是别的树的读数（规则 260：单价要连着跑它的那棵树一起记）；
        日后若某道门在新趟里漂过 1.5s，这一条会自动不再要求它——那是这条线的本意，不是判卷坏了。 */
  it("实测在这条线内的门不许留在认证门面外（取料＝入库的那趟全表日志）", () => {
    const rows = parseCertGateRows(ALL_GATES_LOG);
    expect(rows.length, "31 道一条都不许少（少＝解析器被新形状打败，分母会静默变小）").toBe(31);
    const fast = [...new Set(rows.filter((r) => r.ms < FAST_LINE_MS).map((r) => r.name))].filter(
      (n) => !CERT_GATE_EXCLUDED.includes(n),
    );
    expect(fast.length, "一把空尺：一个快门都没挑出来＝取料面或这条线读不到东西").toBeGreaterThan(5);
    const names = CERT_GATES.map((g) => g.name);
    const budgets = new Map(CERT_GATES.map((g) => [g.name, g.budgetMs]));
    for (const r of rows.filter((x) => x.ms < FAST_LINE_MS && !CERT_GATE_EXCLUDED.includes(x.name))) {
      expect(names, r.name + " 实测 " + String(r.ms) + "ms 在这条线内却不在门面 ⇒ 「全进」只对部分门生效").toContain(r.name);
      expect(budgets.get(r.name) ?? 0, r.name + " 的预算低于它自己那趟的实测 ⇒ 负载一动就红").toBeGreaterThanOrEqual(r.ms);
    }
    const bought = CERT_GATES.find((g) => g.name === "web-fetch-check");
    expect(bought, "这一道是第 273 页按线买进来的，不在门面＝被摘掉了").toBeDefined();
    expect(bought!.budgetMs, "两倍档：568ms 的实测对应 1200ms 预算").toBeGreaterThanOrEqual(2 * 568);
  });
});

/* 预算与它旁边那句实测**必须成对**（2026-10-02 加）。
 * 动因不是又有人把预算写小了，而是我自己这一笔把 `head-import-check` 的单价**抬上去**了：
 * 给 import 面加「模板字面量是数据」的涂白，要多建一遍 AST ⇒ 同一棵树上 A/B 实测
 * 0.70s（涂白关，两趟 0.63/0.77）→ 1.18s（涂白开，三趟 1.17/1.18/1.33），旧预算 1400ms
 * 只剩 18% 余量 ⇒ 负载一动就红，而红的是一道上下一致性都没问题的门。
 * 这条判据钉的是那一格最容易烂的形状：**注释里的读数与表里的预算各漂各的**。
 * 取料＝门表自己那一行（不是别的树的读数，规则 260）。 */
describe("预算与注释实测成对：改单价必须同时改两处", () => {
  /** 从门表那一行的注释里把「实测 NNNNm'」读出来——与预算同一个事实源。 */
  const recordedMs = (name: string): number | null => {
    const line = MANIFEST.split("\n").find((l) => l.includes(`name: "${name}"`));
    if (line === undefined) return null;
    const m = /实测 (\d+)ms/.exec(line);
    return m === null ? null : Number(m[1]);
  };

  it("head-import-check：注释里的实测与预算是两倍档，且涂白这一次涨价已同时记账", () => {
    const row = CERT_GATES.find((g) => g.name === "head-import-check");
    expect(row, "这道门不在门面＝import 面自洽又退化成「交笔时手动跑」").toBeDefined();
    const ms = recordedMs("head-import-check");
    expect(ms, "注释里那句实测读数读不出来＝涨价只改了预算没改读数").not.toBeNull();
    expect(row!.budgetMs, "预算低于两倍档＝拿一次读数当上限，负载一动就红").toBeGreaterThanOrEqual(2 * (ms as number));
    // 反向哨兵：这道门的单价确实因为涂白涨过一档。写死旧值（667）会让"把预算改回 1400"蒙过去。
    expect(ms as number, "单价已从 667ms 涨到 ≈1180ms：读数停在旧值＝涨价没被记下来").toBeGreaterThan(1000);
  });

  it("成对判据自己有牙：每道门那一行都得带实测读数（现读 0 条例外 ⇒ 帽就钉 0，只准下调）", () => {
    // 先量分母本身：22 道门在门表里各有一行，解析不出行＝判卷自己在空转（规则 248：恰好 1 条那一族）
    const lines = CERT_GATES.map((g) => MANIFEST.split("\n").find((l) => l.includes(`name: "${g.name}"`)) ?? "");
    expect(lines.filter((l) => l !== "").length, "有一道门在表里找不到自己那一行＝解析被打败，分母会静默变小").toBe(CERT_GATES.length);

    const withBudgetNoReading = lines.filter((l) => !/实测 \d+ms/.test(l)).map((_, i) => CERT_GATES[i]!.name);
    /* 现读：**0 条例外**（22 道全带实测读数）。第一版我把这条帽写成 ≤6，理由是「今天真有几道没写读数」——
       那是我从旧页面上记来的话，现读一量就是 0；留个 6 等于给这条判卷预先开了 6 个空位。
       计数类不留余量（新闸门存量水位法那条），所以帽钉 0，涨了就是有人新买入一道没量单价的门。 */
    expect(withBudgetNoReading.length, "没配实测读数的预算：" + withBudgetNoReading.join("、")).toBeLessThanOrEqual(0);
  });
});

/* 手抄第二份名单的对账（第 319 页）。
 *
 * 为什么这一格必须有判据，而不是靠那句散文：`scripts/ci/README.md` 原先写的是
 * 「名单与 `CERT_GATES` 的**集合相等**由脚本核过（两边各 22 道、双向差集为空）」——
 * 那是一次**人工核对**的记录（10-02 那一刻确实相等），却被写成了常态性质的样子。
 * 核对过一次 ≠ 此后每趟都核：实测（第 319 页）写这句话时，**README 自己的可粘贴复跑块已经缺两道门**
 * （`gate-check` 与 `mutate-needles-check`，20 项 vs 名单 22 项）——正是那份"脚本核过"会当场抓到的东西。
 * 而本仓没有 git remote ⇒ workflow 至今没真跑过，这类漂移没有任何人会看到。
 *
 * 取料面刻意是**仓里真实存在的那两份手抄件**（不是合成的样本）：
 * 合成样本只能证明解析器会认字，证明不了"此刻这两份是对的"。 */
describe("手抄的第二份名单必须与唯一事实源逐项相等（第 319 页）", () => {
  /** 仓里两份手抄件：CI 真正会跑的那一串、以及给人粘贴的那一串。 */
  const HAND_COPIED: readonly { label: string; text: string }[] = [
    { label: "工作流的 --only", text: read("../.github/workflows/verify.yml") },
    { label: "CI 说明页的复跑块", text: read("../scripts/ci/README.md") },
  ];
  const SOURCE_NAMES = CERT_GATES.map((g) => g.name);

  it("两份手抄件里的每一份名单都与 CERT_GATES 集合相等，且一份都不许少", () => {
    for (const h of HAND_COPIED) {
      const lists = onlyListsIn(h.text);
      // 抽不到 ≠ 没漂：这一格要是恒空，下面那个循环就一次都不跑（空尺也绿）。
      expect(lists, h.label + " 里一份名单都抽不到 ⇒ 这一格没量到，不是「没漂」").not.toBeNull();
      expect((lists ?? []).length, h.label + " 的手抄件数量为 0＝尺没落在任何东西上").toBeGreaterThan(0);
      for (const one of lists ?? []) {
        const d = onlyListDiff(one.names, SOURCE_NAMES);
        expect(
          d.same,
          h.label + " 第 " + String(one.line) + " 行与门面不相等：缺 " + d.missing.join("、")
            + (d.extra.length > 0 ? "；多 " + d.extra.join("、") : "")
            + "（手抄份与 CERT_GATES 只准集合相等，顺序不限）",
        ).toBe(true);
      }
    }
  });

  it("三态分开：取不到 / 只有省略号的散文 / 真名单，三者不许同形", () => {
    // 散文里的 `--only=…` 是在**引用**这个机制（它就是上面那份说明白），不是第二份可粘贴清单。
    expect(onlyListsIn(null)).toBeNull();
    expect(onlyListsIn("快门面 pnpm gates --only=…（逐道点名在 workflow 里）")).toBeNull();
    expect(onlyListsIn("pnpm gates --only=docs-check,security-check")).toEqual([
      { line: 1, names: ["docs-check", "security-check"] },
    ]);
    // 省略号那一处在前、真名单在后时，必须抽到真名单而不是被首处顶掉。
    const both = "引用：--only=…\n\n实跑：--only=docs-check,security-check,prune-check";
    expect(onlyListsIn(both)).toEqual([{ line: 3, names: ["docs-check", "security-check", "prune-check"] }]);
  });

  it("这条判据有牙：从工作流正文里摘掉一道门，对齐必须当场失败", () => {
    const wf = read("../.github/workflows/verify.yml");
    const first = (onlyListsIn(wf) ?? [])[0];
    expect(first, "工作流里那份名单抽不出来 ⇒ 有牙这一条没东西可咬").toBeDefined();
    const dropped = first!.names[0]!;
    const mutated = wf.replace("--only=" + first!.names.join(","), "--only=" + first!.names.slice(1).join(","));
    expect(mutated, "替换打了个空＝下面那半证的不是这条判据").not.toBe(wf);
    const after = (onlyListsIn(mutated) ?? [])[0]!;
    expect(after.names).not.toContain(dropped);
    expect(onlyListDiff(after.names, SOURCE_NAMES).same, "少一道门却仍判对齐＝这条判据是恒真的").toBe(false);
  });

  it("差异函数自己有牙：空对空不算对齐（一把什么也没量到的尺没有分辨力）", () => {
    expect(onlyListDiff([], []).same, "两侧皆空被判对齐＝恒真式").toBe(false);
    expect(onlyListDiff(["a"], []).same).toBe(false);
    expect(onlyListDiff([], ["a"]).same).toBe(false);
    expect(onlyListDiff(["b", "a"], ["a", "b"]).same, "顺序不同不算漂（只准集合相等）").toBe(true);
  });
});
