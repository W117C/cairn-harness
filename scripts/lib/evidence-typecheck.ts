/** 证据面（`outputs` 下的 .mts 探针）的类型检查那一格（第 259 页；任务 #4）。
 *
 *  为什么要有这一格：`tsconfig.json` 的 `include` 是 `["src","scripts","tests"]` ⇒ 仓里 97 个探针/取料脚本
 *  **全在 typecheck 门外**，而 `node --import tsx` 只剥类型不查类型。第 249 页就是这么糊过去的：
 *  一把探针的 `readIdx` 返回形状里没有 `ino`，打印行照读 `after.ino`，`undefined !== undefined` 为假
 *  ⇒ 12 圈全印「ino 不变」，与"真的没变"同一个字，而 tsc 只要看过一眼就会报 TS2339。
 *
 *  为什么不直接把 `outputs` 加进主 tsconfig：存量报错 **HEAD 侧 31 条**、主检出工作树 51 条／16 个文件
 *  （`outputs/evidence-typecheck-gate-2026-10-01/tsc-raw.log` 是工作树那一份；差的 20 条全在隔壁未入库的探针里——两个数都要报，只报一个就是拿工作树冒充仓），
 *  里头 30 条是 TS7006（隐式 any，纯标注缺失、不改变取到什么），只有**会产出假读数那一族**值得当闸：
 *  TS2339/TS2551（读不存在的属性，正是 `ino` 那一案）、TS18048（可能 undefined 却直接吃）、TS2304（名字不存在）、
 *  TS2305/TS2459（import 了模块里没有的名字）、TS7053（按字符串下标取不存在的键）。
 *  帽 12 条／8 个文件（只登记**在 HEAD 里**的文件），按「新增门的存量水位法」逐文件登记、**只准调低**；涨一条就红。
 *  ⚠️ 主检出工作树从前会多读 4 条（16 条／10 个文件）：来自两个**隔壁在飞、尚未入库**的探针
 *  ——`outputs/selector-uniqueness-2026-09-30/diagnose.mts`（3 条）与 `outputs/sequencer-dynamic-2026-10-01/probe-prod.mts`（1 条）。
 *  它们不进登记表：登记一个不在 HEAD 的文件＝干净树上那条登记变成幽灵，而本门的判卷里就有一条「不许留幽灵条目」，
 *  `head-cert` 会被自己这边的登记判红（253 页凭证里我已把 diagnose.mts 归为隔壁在用、不替他们改）。
 *  第 281 页把这层归因**做进判定**：`verdict` 收未跟踪清单，未跟踪那几个文件的危险码只点名、不进棘轮
 *  （`flying`／`flyFace`）；清单取不到时退回工作树口径并出声，宁可真红不假绿。
 *  装饰性那一族刻意不纳（纳了就得替别人改 30 处，且它不会产出假读数）——理由写在门里，不靠沉默。
 *
 *  ⚠️ 解析形状（同页第二次踩到）：`^([^(]+)\(` 这类"到第一个左括号为止"的写法**会把 tsc 的续行**（缩进的说明行）
 *  连进文件名——`[^(]` 是字符类，里面含换行。所以这里按「行首到 `(` 之间不许有空白、且整行以 `)` 冒号 error 收尾」钉死，
 *  并留一条不变量：逐条码数之和必须等于总报错行数（对不上就是解析器坏了，交 `verdict` 报「这一格没量到」）。 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

/** 会产出假读数的错误码：判据是**「那个位置拿到不存在的东西」**——属性名对不上（TS2339/TS2551）、
 *  名字查不到（TS2304）、import 了模块里没有的（TS2305/TS2459）、按字符串下标取不存在的键（TS7053）、
 *  可能 undefined 却直接吃（TS18048）。这一族的共同后果是**探针继续跑、并把 `undefined` 交出去**，
 *  于是打印行与真读数同形（第 249 页的 `ino` 一案就是 TS2339 那一格）。
 *
 *  刻意不纳的两族，各配理由（不靠沉默）：
 *  ⑴ TS7006（隐式 any 的参数，现读 30 条）——它不改变取到什么，只欠一个标注，产出假读数的概率是零；
 *  ⑵ TS2345/TS2769（调用点形状不符：实参类型不配、重载全不匹配）。第 284 页逐条读过剩下的 4 处：
 *     `outputs/cred-face-coverage-2026-10-01/cred-face.mts` 那支 TS2345 是"探针抄了门的取料面形状、形状换了没人重跑"，
 *     现跑**当场抛** `x.list.map is not a function`（已改成共用构造器 `credFaceFiles`）；
 *     `outputs/scratch-face-foreign-2026-09-30/probe.mts` 那支 `join(null)` 会抛；
 *     `outputs/selector-uniqueness-2026-09-30/width-delta.mts` 那支把 `null` 交给 `re.test` ⇒ 被强转成 `"null"`，
 *     它今天的效果是**多报一个问题**而不是少报（fail-toward-red）；`witness.mts` 那支 TS2769 是标注形状问题、运行时按 utf8 编码拿到 string。
 *     ⇒ 四条里没有一条是"静默交出 undefined 当读数"，与本门要拦的那一族不同性质，故不纳。
 *     反转条件：若出现"实参/返回形状不符却继续跑、并把 `null`/`undefined` 交出去"的实例（像 TS2353 那一族那样），
 *     就先按第 283 页的办法把存量清成 0，再把对应码纳进来——**清零之后纳**是唯一不往登记表里塞别人存量的进法。
 *  第 284 页纳进来的那一支：TS2353（对象字面量里给了类型没有的键 ⇒ **那个键被静默丢掉**）。
 *  动因是一条真事故：`outputs/map-inject-cost-2026-09-30/` 两支探针把 tags 缓存目录写成 `cacheDir`
 *  （真名 `tagsCacheDir`），键被丢、两臂同走缺省缓存，于是第 214 页那句「空缓存 vs 热缓存」量的其实是 warm vs warm
 *  （见该页第 283 页的更正与 `outputs/map-cold-warm-283-2026-10-01/`）。它不崩、不报错，只是把读数变成假的。
 *  纳进来时存量＝0（那两处已改对，干净树现读 `TS2353 = 0`）⇒ 不需要往 `DANGER_BASELINE` 里加任何名字。 */
export const DANGER_CODES: readonly string[] = ["TS2339", "TS2551", "TS18048", "TS2304", "TS2305", "TS2459", "TS7053", "TS2353"];

/** 存量登记（2026-10-01 现读，第 259 页；只登记**在 HEAD 里**的文件——见文件头那条幽灵登记的理由）。
 *  **只准调低**：清掉一条就把数字改小，涨一条门就红。 */
export const DANGER_BASELINE: Readonly<Record<string, number>> = {
  "outputs/anchor-resolvability-2026-09-23/measure-anchor.mts": 2,
  "outputs/head-cert-drift-witness-2026-09-27/witness.mts": 3,
  "outputs/midrun-steering-2026-09-23/measure-steering.mts": 1,
  "outputs/sandbox-degrade-face-2026-09-24/measure-degrade.mts": 1,
  "outputs/sequencer-dynamic-2026-10-01/probe.mts": 1,
  "outputs/sequencer-status-readings-2026-10-01/probe-fail.mts": 1,
  "outputs/sequencer-status-readings-2026-10-01/probe.mts": 1,
  "outputs/stagnation-detection-2026-09-23/measure-local-base-rate.mts": 2,
};

/** 一行的报错 → `{file, code}`；不是报错行回 null（tsc 会夹缩进的说明行与空行）。
 *  ⚠️ 分组号数错过一次：`(error)` 也占一个组，把 `code` 取成 `m[4]` 就得到常量 "error"——
 *  门于是永远 0 命中、永远绿，而"解析 51/51"的自证完全抓不到（它只数行，不看取错字段）。
 *  现在 ⑴ 去掉不吃组的 `(error)`；⑵ 判卷里有一条**真喂一行 TS2339**、断言它被算进危险码。 */
export function parseTscLine(line: string): { file: string; code: string } | null {
  const m = /^(\S[^()]*?)\((\d+),(\d+)\): error (TS\d+):/u.exec(line);
  if (m === null) return null;
  return { file: m[1]!, code: m[4]! };
}

/** 逐文件数危险码；顺带把"总报错行数"与"逐条解析出来的行数"配成一对（解析器漏行时必须出声）。 */
export function tally(rows: readonly string[]): { perFile: Record<string, number>; parsed: number; total: number } {
  const perFile: Record<string, number> = {};
  let parsed = 0;
  let total = 0;
  for (const line of rows) {
    if (!/: error TS\d+:/.test(line)) continue;
    total += 1;
    const hit = parseTscLine(line);
    if (hit === null) continue;
    parsed += 1;
    if (!DANGER_CODES.includes(hit.code)) continue;
    perFile[hit.file] = (perFile[hit.file] ?? 0) + 1;
  }
  return { perFile, parsed, total };
}

/** 取料面的**前缀**从 `tsconfig.evidence.json` 的 `include` 现读，不写死目录名。
 *  为什么（第 281 页）：未跟踪清单要跟 tsc 扫的面**同宽**，否则哪天 include 加了 `tools/`，
 *  那里的草稿探针就会重新算进我的账（假红）。两个方向的坏法都安全：前缀取宽了只会多认几个未跟踪文件
 *  （`git ls-files --others` 不可能把已跟踪文件列进来 ⇒ 造不出假绿），取窄了是假红。
 *  通配开头的条目（例如以双星号起头那种）代表"整棵树"，交成 `.`；空 include 在 tsc 里也是"整棵树"。 */
export function evidenceOthersPrefixes(include: readonly string[]): string[] {
  if (include.length === 0) return ["."];
  const out: string[] = [];
  for (const raw of include) {
    const e = raw.trim();
    if (e.length === 0) continue;
    const cut = e.search(/[*?{[]/u);
    const seg = (cut === -1 ? e : e.slice(0, cut)).replace(/\/+$/u, "");
    out.push(seg.length === 0 ? "." : seg);
  }
  return out.length === 0 ? ["."] : [...new Set(out)];
}

export type EvidenceVerdict = {
  ok: boolean;
  /** 三态要分开印（规则 239）：没跑到／跑完没料／跑完有涨。 */
  state: "unreadable" | "clean" | "grew";
  cell: string;
  grew: { file: string; now: number; cap: number }[];
  /** 现存量低于登记帽的文件——门只报数，撤不撤由人决定（只准调低是规矩，自动调低等于没有读数）。 */
  lowered: string[];
  /** 未跟踪（不在 HEAD）那几个文件里的危险码：只点名、不进棘轮。
   *  为什么必须分出来（第 281 页）：本门的口径从第 259 页起就写在文件头——「只登记**在 HEAD 里**的文件」，
   *  而判定面从前把所有报错一视同仁，于是隔壁一支未入库的探针就能让这一格 `exit 1`。
   *  共享工作树里「别人的草稿」与「我的涨」被读成同一个红，交笔自检就只能靠人肉归因。 */
  flying: { file: string; now: number }[];
  /** 未跟踪面的三态：`ok`＝清单可取（哪怕为空），`unavailable`＝取不到 ⇒ **不许**读成"没有未跟踪件"，
   *  此时退回工作树口径判（最坏是假红，不会造出假绿）。 */
  flyFace: "ok" | "unavailable";
};

/** 判定：把现读对上登记帽。**只准调低**——新文件带危险码、或老文件多一条，都是红。
 *  `untracked` 缺省＝面取不到（判卷里那些不关心归属的用例保持原语义），此时按整棵工作树判并出声。 */
export function verdict(input: {
  tsc: { status: number | null; out: string } | null;
  baseline: Readonly<Record<string, number>>;
  untracked?: { files: readonly string[]; unavailable: boolean };
}): EvidenceVerdict {
  /* 「跑到了没有」在判定这一层也要自证：只信调用方把 status 归一化成 null 是不可靠的（门与判卷都会直接喂 {status:1}）。
     tsc 只有 0（无错）与 2（有错）是"跑过了并给了结论"；其余（含 1＝用法/内部错、null＝没起来）一律「没量到」。 */
  if (input.tsc === null || input.tsc.status === null || (input.tsc.status !== 0 && input.tsc.status !== 2)) {
    return { ok: false, state: "unreadable", cell: "证据面 tsc 没跑到（取不到）⇒ 这一格没量到，不等于干净", grew: [], lowered: [], flying: [], flyFace: "unavailable" };
  }
  const lines = input.tsc.out.split("\n");
  const t = tally(lines);
  if (t.total !== t.parsed) {
    // 解析器漏行＝分母会静默变小，比"没跑到"更坏（它看着像绿）。宁可不判。
    return { ok: false, state: "unreadable", cell: `证据面 tsc 输出解析不完整（报错 ${String(t.total)} 行、抽出 ${String(t.parsed)} 行）⇒ 这一格没量到`, grew: [], lowered: [], flying: [], flyFace: "unavailable" };
  }
  const flyFace: "ok" | "unavailable" = input.untracked !== undefined && input.untracked.unavailable === false ? "ok" : "unavailable";
  const flySet = new Set(input.untracked?.files ?? []);
  const trackedFile: Record<string, number> = {};
  const flying: { file: string; now: number }[] = [];
  for (const [file, now] of Object.entries(t.perFile)) {
    if (flyFace === "ok" && flySet.has(file)) flying.push({ file, now });
    else trackedFile[file] = now;
  }
  flying.sort((a, b) => (a.file < b.file ? -1 : 1));
  const grew: { file: string; now: number; cap: number }[] = [];
  const lowered: string[] = [];
  for (const [file, cap] of Object.entries(input.baseline)) {
    const now = trackedFile[file] ?? 0;
    if (now > cap) grew.push({ file, now, cap });
    else if (now < cap) lowered.push(file);
  }
  for (const [file, now] of Object.entries(trackedFile)) {
    if (!(file in input.baseline) && now > 0) grew.push({ file, now, cap: 0 });
  }
  grew.sort((a, b) => (a.file < b.file ? -1 : 1));
  const nowTotal = Object.values(trackedFile).reduce((a, b) => a + b, 0);
  const capTotal = Object.values(input.baseline).reduce((a, b) => a + b, 0);
  /* 口径必须写在读数里：同一个「12 条」在 HEAD 口径与工作树口径下是两件事（第 259 页就为这两个数吵过一次）。 */
  const flyTotal = flying.reduce((a, f) => a + f.now, 0);
  const scope = flyFace === "ok"
    ? `HEAD 口径｜在飞未入库 ${String(flyTotal)} 条／${String(flying.length)} 个文件（只点名，不计我的账${flying.length === 0 ? "" : `：${flying.map((f) => `${f.file}(${String(f.now)})`).join("、")}`}）`
    : "工作树口径（未跟踪面取不到，不等于没有 ⇒ 隔壁的草稿也会被算进我的账，最坏是假红）";
  const head = `证据面危险码 ${String(nowTotal)} 条／帽 ${String(capTotal)} 条（${scope}；登记 ${String(Object.keys(input.baseline).length)} 个文件；全量报错 ${String(t.total)} 条）`;
  if (grew.length > 0) {
    return { ok: false, state: "grew", cell: `${head}｜⚠️ 涨了 ${String(grew.length)} 个文件（只准调低）：${grew.map((g) => `${g.file} ${String(g.now)}>${String(g.cap)}`).join("、")}`, grew, lowered, flying, flyFace };
  }
  return {
    ok: true,
    state: "clean",
    cell: `${head}${lowered.length === 0 ? "" : `｜${String(lowered.length)} 个文件已清到帽下（把登记值调低即可）：${lowered.join("、")}`}`,
    grew,
    lowered,
    flying,
    flyFace,
  };
}

/** 跑一次证据面 tsc（配置取仓内 `tsconfig.evidence.json`；取不到回 null，让调用方出声）。 */
export function runEvidenceTsc(cwd: string): { status: number | null; out: string } | null {
  const cfg = join(cwd, "tsconfig.evidence.json");
  if (!existsSync(cfg)) return null;
  const local = join(cwd, "node_modules", "typescript", "bin", "tsc");
  const r = existsSync(local)
    ? spawnSync(process.execPath, [local, "-p", cfg, "--noEmit"], { cwd, encoding: "utf8" })
    : spawnSync("tsc", ["-p", cfg, "--noEmit"], { cwd, encoding: "utf8" });
  if (r.error !== undefined) return null;
  /* tsc 的退出码：**0＝无报错、2＝发现了一处或多处错误**（本仓 `scripts/typecheck.ts` 就是原样转发这个 2），
     1 留给用法/内部错。上一版把 2 当成"用法错"⇒ 门在真有料时反而报「没跑到」，把红读成了没测——
     正是本门要拦的那类形状，这次拦到了自己身上。判"跑到了没有"要看码是不是 0/2，别按"0/1"想当然。 */
  if (r.status !== 0 && r.status !== 2) {
    return { status: null, out: (r.stdout ?? "") + (r.stderr ?? "") };
  }
  return { status: r.status, out: (r.stdout ?? "") + (r.stderr ?? "") };
}
