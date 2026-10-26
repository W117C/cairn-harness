// 变异验证器：证明单元测试不是恒真的（make-neg-controls.mjs 的逻辑层泛化）。
//
// 理念：门禁体检只能静态查出「恒真式/空断言」；一条断言即便非空，也可能根本不针对
// 被测逻辑。唯一可靠的经验证法是**注入一处行为突变，看测试是否真的红**：
//   存活（mutation survived）= 测试对该逻辑无分辨力 = 恒真式等价物。
// 这把「我觉得代码能跑」变成「我证明了换掉这段逻辑，验收会抓住」。
//
// 用法（须经 tsx 运行——判据本体是 TS，见 scripts/lib/mutate-gates.ts）：
//   pnpm mutate-verify                    # 跑配置表里全部条目
//   pnpm mutate-verify <id>               # 只跑一条或几条
//   pnpm mutate-verify --list             # 列出条目
//
// 安全：被测源文件先备份，finally 原样还原；进程退出前强制再校验一次
// `git diff HEAD --quiet`——还原失败即判红，绝不把突变留在工作树里。
// （与 M7 在飞集零相交：只动自己登记的源文件，且进出都校验零 diff。）
// 可判性三分（entryDisposition）：源文件在飞/未跟踪 = 拒绝并抛死（无回滚兜底）；
// **判卷测试文件**在飞 = 本条记「未证」跳过——否则别人的在飞编辑会伪装成「变异存活」或「基线红」。

import { cpSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync, writeSync, rmSync } from "node:fs";
import ts from "typescript";
import { execFileSync, spawnSync } from "node:child_process";
import { join, dirname, resolve, relative, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { acquireToolLock } from "./lib/tool-lock.ts";
// 判据本体在 TS 侧（可被 tests/ 直接断言）；本脚本经 tsx 运行，见 package.json 的 mutate-verify。
import { entryDisposition, mutateTreeGuard, auditNeedles, backupPathOf, duplicateIds, leftoverBackupPaths, leftoverActionOf, splitRunnable, needleProblemLine, needleSeverity, needleMoveCause, classifyArgs, isLineWiseApply, budgetMsOf, untrackedAnchorPaths, untrackedAnchorLine, headOnlyNeedleProblems, headOnlyNeedleLine, anchorFaces, blockingTotalOf, auditExpectFails, looseOnlyPointers, auditPointerWiring, wiringCensus, expectFailProblemLine, killerAttributionOk, judgeWithRetry, failingTestText, headPointerProblems, baselineRedKind, selectChangedEntries, ledgerOnlyDerivationHint, costRollupOf, costCell, anchorCostCell, selectorAmbiguity, selectorCell, selectedTestCount, escapeTitlePattern, runModeFor, runReadingIsBad, vacuousRunLine, runModeCell, unverifiedCell, restoreDiffProblem, redVerdictCell, redKindsLine } from "./lib/mutate-gates.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const VITEST = join(ROOT, "node_modules/vitest/vitest.mjs");

/** 变异配置表：2026-10-17 按域拆在 `./lib/mutations/*.mjs`（结构债审查报告 #5：15.9k 行单体里
 *  15k 行是这张表；拆分只为体量与定位，条目一条未动）。
 *  追加条目时放进对应域的文件；**组间顺序不影响任何判据**（每条独立），所以这里按固定顺序拼接。
 *  「读表文本」的判据（`extractAnchorNeedles` / `parseAnchors` / id 行计数）走 `./lib/mutation-table.ts`
 *  ——那份文件清单是唯一的一份，别在这里再抄一遍。 */
import { MUTATIONS as AGENT_ORCHESTRATION } from "./lib/mutations/agent-orchestration.mjs";
import { MUTATIONS as AGENT_PLUGINS } from "./lib/mutations/agent-plugins.mjs";
import { MUTATIONS as AGENT_SUBSYSTEMS } from "./lib/mutations/agent-subsystems.mjs";
import { MUTATIONS as AGENT_RUNTIME } from "./lib/mutations/agent-runtime.mjs";
import { MUTATIONS as AGENT_MISC } from "./lib/mutations/agent-misc.mjs";
import { MUTATIONS as MAIN } from "./lib/mutations/main.mjs";
import { MUTATIONS as TOOLS } from "./lib/mutations/tools.mjs";
import { MUTATIONS as CORE } from "./lib/mutations/core.mjs";
import { MUTATIONS as SCRIPTS_GATES } from "./lib/mutations/scripts-gates.mjs";
import { MUTATIONS as SCRIPTS_MUTATE } from "./lib/mutations/scripts-mutate.mjs";
import { MUTATIONS as SCRIPTS_CERTS_EVAL } from "./lib/mutations/scripts-certs-eval.mjs";
import { MUTATIONS as SCRIPTS_MISC } from "./lib/mutations/scripts-misc.mjs";
import { MUTATIONS as MISC } from "./lib/mutations/misc.mjs";

const MUTATIONS = [
  ...AGENT_ORCHESTRATION,
  ...AGENT_PLUGINS,
  ...AGENT_SUBSYSTEMS,
  ...AGENT_RUNTIME,
  ...AGENT_MISC,
  ...MAIN,
  ...TOOLS,
  ...CORE,
  ...SCRIPTS_GATES,
  ...SCRIPTS_MUTATE,
  ...SCRIPTS_CERTS_EVAL,
  ...SCRIPTS_MISC,
  ...MISC,
];

/** 从 apply 闭包里取回针脚原文（函数源码里的第一个字符串字面量；replace/replaceAll、
 *  单双引号与反引号三种写法都认）。取不到不判红：含插值的模板字面量无法静态求值，
 *  这类如实报「未覆盖」——不假装自己全看见了。 */
function extractNeedle(apply) {
  const m = /\.replace(?:All)?\(\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)/u.exec(String(apply));
  if (!m) return null;
  try { return new Function("return " + m[1])(); } catch { return null; }
}

/** 单条锚点的「指针接线」预检（第 260 页，任务 #6）。只在**变异存活**那条红里出现，不当门禁：
 *  静态代理按全表量出来的假疑空太高（现读 680/1123——多数判卷是从上游入口打进去的，用例体里当然不提名被改的函数），
 *  拿它当闸就是"数字不再有意义"那一类（本仓 7320 那条锚点描述的就是这个坑）。
 *  但它对**那一次真事故**（规则 325：指针指向同文件里不调 `certTreeAbs` 的兄弟用例）是有分辨力的——
 *  分辨力实测四格见 `outputs/pointer-wiring-observer-2026-10-01/probe.log`。
 *  所以它的正确位置是：一条已经花掉 2 拍判卷才喊出的红，后面接一句"先排指针、再谈无分辨力"。 */
const readAnchorFace = (rel) => { try { return readFileSync(join(ROOT, rel), "utf8"); } catch { return null; } };
function wiringHint(m) {
  const rows = auditPointerWiring([{
    id: m.id, srcRel: m.src ?? "", needle: extractNeedle(m.apply), test: m.test ?? "", expectFail: m.expectFail ?? "",
  }], { readSrc: readAnchorFace, readTest: readAnchorFace });
  const r = rows[0];
  // 第二半（第 263 页）：把「针脚那段函数有几条 return」一起报出来。
  // 动因是第 262 页实测的一条存活——`suiteRows` 有四条 return，判卷只喂到两条，第三条上的锚点**永远活**，
  // 而当时的提示只讲"指针指错了没"，那句对这一种成因完全没用（它甚至不是 suspect，是 wired）。
  const exitCell = r !== undefined && typeof r.returns === "number" && r.returns >= 2
    ? `\n  ↳ 出口计数：函数「${String(r.symbol)}」里有 ${String(r.returns)} 条 return ⇒ 存活时先问「判卷喂到了第几支」，`
      + "补一条能让那一支走到的输入（规则 329）；**别撤锚点、别改针脚**——撤掉就是把那支出口重新变回没人守"
    : "";
  if (r === undefined || r.kind !== "suspect" || r.symbol === null) return exitCell;
  return `\n  ↳ 指针接线预检：针脚长在函数「${r.symbol}」里，而「${m.expectFail}」那条用例体一次没提它` +
    "⇒ 先排「指针指向不会红的那条」（规则 325 那一次就是这个形状），再谈判卷无分辨力；" +
    "用例若确实从上游入口打进来，这一句忽略即可（静态代理会误喊，实测假疑空 680/1123）" + exitCell;
}

/** 针脚体检：blocking = 这条变异是空操作（它在假装守护）；warn = 针脚命中多处，
 *  replace 只改第一处，需人工复认改到的是哪一处。 */
function reportNeedles(entries, { showUnparsed = true } = {}) {
  const checkable = [];
  const unparsed = [];
  const lineWise = [];
  for (const e of entries) {
    if (isLineWiseApply(String(e.apply))) { lineWise.push(e.id); continue; }
    const needle = extractNeedle(e.apply);
    if (needle === null) unparsed.push(e.id);
    else checkable.push({ id: e.id, srcRel: e.src, needle });
  }
  const problems = auditNeedles(checkable, (rel) => {
    try { return readFileSync(join(ROOT, rel), "utf8"); } catch { return null; }
  });
  const blocking = problems.filter((p) => needleSeverity(p.hits) === "blocking");
  const warn = problems.filter((p) => needleSeverity(p.hits) === "warn");
  /* 「针脚没了」这行红如果只说"没了"，读的人会按**文件**猜归属——本仓为此指错过一次人
   * （第 127 页那批里有一条其实是我自己两页前留下的死针脚，而那个文件恰好也是别人在飞的）。
   *  归属改成事实：`needleMoveCause` 用 pickaxe 找最后一次让这段文字在该路径上增减的提交。
   *  只查 blocking 且 hits===0 的那些（判据自己会跳过 warn）。一次 pickaxe ~0.5s，存量 10 条量级可接受。 */
  const runGit = (args) => {
    try {
      return execFileSync("git", [...args], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    } catch {
      return null; // 让判据印「成因未取」，而不是悄悄留白
    }
  };
  for (const p of blocking) console.log("❌ " + needleProblemLine(p, needleMoveCause(p, runGit)));
  for (const p of warn) console.log("⚠️ " + needleProblemLine(p));
  if (showUnparsed && unparsed.length > 0) {
    console.log(`ℹ️ 静态检未覆盖 ${String(unparsed.length)} 条（apply 非通行写法）：${unparsed.join("、")}`);
  }
  if (showUnparsed && lineWise.length > 0) {
    console.log(`ℹ️ 逐行式 apply ${String(lineWise.length)} 条（多处命中即设计，不核针脚）：${lineWise.join("、")}`);
  }
  const dup = duplicateIds(entries.map((e) => e.id));
  for (const d of dup) {
    console.log("❌ 锚点 id 重复：" + d.id + " ×" + String(d.count) + "（`mutate-verify <id>` 会同时跑两条，报告里两行同 id 不同改法＝读不出哪条活着）");
  }
  /* 锚点的两个文件面（被测源码 + 判卷测试）不在 HEAD 的树里 ⇒ 这类缺陷**主树永远看不见**（本门读的是盘），
     而干净 HEAD 的隔离树里前者必然「源文件读不到」、后者连基线都跑不出来（被写成「基线不是全绿」）。
     一次 `git ls-tree HEAD` 拿全量，判据本体在 lib 里（可单测）。
     git 不可用时报「未查」，不静默当已查——未证 ≠ 通过。 */
  const untracked = [];
  let inHead = null;
  let headUnchecked = 0;
  try {
    inHead = new Set(execFileSync("git", ["ls-tree", "-r", "--name-only", "-z", "HEAD"],
      { cwd: ROOT, encoding: "utf8", maxBuffer: 128 * 1024 * 1024 }).split(String.fromCharCode(0)).filter(Boolean));
    untracked.push(...untrackedAnchorPaths(anchorFaces(entries), (rel) => inHead.has(rel)));
  } catch (err) {
    headUnchecked = 1;
    console.log("⚠️ 锚点文件面的 HEAD 归属未查（git ls-tree 失败：" + (err instanceof Error ? err.message : String(err)) + "）");
  }
  for (const g of untracked) console.log("❌ " + untrackedAnchorLine(g));
  /* 上一条只答得出「文件在不在 HEAD」，答不出「被锚定的那段文字在不在 HEAD」。这里把同一份 `auditNeedles`
     再喂一遍 HEAD 那份内容取差集 ⇒ 锚点钉在**在飞文本**上（锚点行已入库、实现改动还没）从此在主树也出声。
     blob 按不同 src 缓存（一个文件一次 `git show`），门保持秒级。 */
  const drift = [];
  /* 指针的 HEAD 侧那一半（第 141 页）：盘上尺只答「指针指得到盘上那条标题」；锚点行入库了、判卷里那条
     标题没入库时，HEAD 上它指不到任何东西，而盘上照样绿。普查里这一格 23 条，是花 21.8 分钟跑整表才发现的。 */
  const headPointers = [];
  const pointerEntries = entries.map((e) => ({ id: e.id, test: e.test ?? "", expectFail: e.expectFail ?? "" }));
  if (inHead !== null) {
    try {
      const blobs = new Map();
      const readHeadBlob = (rel) => {
        if (!blobs.has(rel)) {
          try {
            blobs.set(rel, execFileSync("git", ["show", "HEAD:" + rel],
              { cwd: ROOT, encoding: "utf8", maxBuffer: 128 * 1024 * 1024 }));
          } catch { blobs.set(rel, null); }
        }
        return blobs.get(rel);
      };
      const missingSrc = new Set(untracked.filter((u) => u.what === "被测面").map((u) => u.path));
      drift.push(...headOnlyNeedleProblems(problems, auditNeedles(checkable, readHeadBlob), missingSrc));
      const headTable = readHeadBlob("scripts/mutate-verify.mjs");
      if (headTable === null) {
        headUnchecked = 1;
        console.log("⚠️ 指针的 HEAD 侧比对未查（HEAD 里读不到本表文件）");
      } else {
        // 只比"相对 HEAD 有改动"的判卷：没改动的两头读数一样，盘上那一遍已经覆盖。
        const dirty = new Set(execFileSync("git", ["diff", "--name-only", "HEAD"], { cwd: ROOT, encoding: "utf8" })
          .split("\n").filter(Boolean));
        // 取 HEAD 那份表里的 id 用**行首锚定**的正则。这里刻意不写那段"字段名＋冒号＋引号"的原文：
        // 判卷那把尺抽条目时只看文字、不分代码与注释，第一版因此在表里凭空多出一条 src 为 null 的假锚点
        // （被它自己的「每条都要有 src」自检当场抓住——这条自检就是它的价值所在）。
        const headIds = new Set([...headTable.matchAll(/^[ \t]+id:[ \t]*"([^"]+)"/gm)].map((m) => m[1]));
        headPointers.push(...headPointerProblems(pointerEntries, {
          inHeadTable: (id) => headIds.has(id),
          judgeDirty: (rel) => dirty.has(rel),
          readAtHead: readHeadBlob,
        }));
      }
    } catch (err) {
      headUnchecked = 1;
      console.log("⚠️ 针脚的 HEAD 侧比对未查（git show 失败：" + (err instanceof Error ? err.message : String(err)) + "）");
    }
  } else {
    headUnchecked = 1;
  }
  for (const d of drift) console.log("❌ " + headOnlyNeedleLine(d));
  for (const p of headPointers) console.log("❌ " + expectFailProblemLine(p) + " ｜HEAD 侧：锚点行已入库、判卷里那条标题还没");
  /* expectFail 指针体检（第 138 页）：一条锚点「杀掉」的判据是**测试红在它期望的那条用例上**；
     用例改过标题而指针还写着旧的，报告说的是「变异存活或误伤」——听起来像代码没被守住，实际是指针断了。
     以前发现它要付出「把那条变异跑一遍」的代价（整表几十分钟），而静态扫是秒级。 */
  const stalePointers = auditExpectFails(pointerEntries,
    (rel) => { try { return readFileSync(join(ROOT, rel), "utf8"); } catch { return null; } },
  );
  for (const p of stalePointers) console.log("❌ " + expectFailProblemLine(p));
  // 「松钉」那一格要有读数（不阻断，但每次跑门都印出来 ⇒ 数字变了就看得见）：
  // 逐字认不出、只靠占位符展开过关的指针。现读 10／872，水位由 tests/mutate-verify-gates.test.ts 钉住（只准调低）。
  const loosePinned = looseOnlyPointers(pointerEntries,
    (rel) => { try { return readFileSync(join(ROOT, rel), "utf8"); } catch { return null; } },
  );
  console.log(`ℹ️  松钉指针 ${String(loosePinned.length)} 条（逐字认不出、只靠占位符展开的标题模式过关——拼接标题与带转义引号那两类必然如此）${loosePinned.length === 0 ? "" : "：" + loosePinned.join("、")}`);
  /* 选择子唯一性（第 169 页的前置闸）：一条锚点的单价＝判卷宿主时长 ×3（第 168 页实测 23.1s/条），
   *  而它真正要证的只有自己那条 killer 用例。想让 `runTest` 改吃 `-t`，前提是指针**逐字唯一定位**那条标题——
   *  0 命中时 vitest 不是失败，是一条也没跑，两拍都白过（第 166 页「只能印 0 的尺」那一族换了载体）。
   *  这一格刻意不进退出码：存量 13 条不是本笔造成的，按水位法只准调低；先把名单点出来，再谈改跑法。 */
  const selectorScan = selectorAmbiguity(pointerEntries, (rel) => { try { return readFileSync(join(ROOT, rel), "utf8"); } catch { return null; } });
  console.log("ℹ️  " + selectorCell(selectorScan));
  /* 指针接线那一格（第 260 页 · 任务 #6）：`killer 指针失效` 只答"标题在判卷里解析得出"，答不出"那条用例调不调被变异的那个符号"。
   *  规则 325 那一次（`cert-tree-abs-args-swapped`）正是标题解析得出、却指向一条根本不碰 `certTreeAbs` 的兄弟用例——
   *  花 6.58s 实跑才现形，而这一格是秒级的。第一版**只出声、不进退出码**：先量存量（规则 235），数字看懂了再谈水位帽。
   *  判据是静态近似：needle 所在的包围函数名 ⇒ 该名字是否出现在那条用例体内。取不到的（表里的数据条目、
   *  class 方法、判卷读不到）一律进「判不了」，**不并进可疑**——"我没看见"不等于"它没守"（规则 261/262）。 */
  const readFace = (rel) => { try { return readFileSync(join(ROOT, rel), "utf8"); } catch { return null; } };
  const wiringRows = auditPointerWiring(entries.map((e) => ({
    id: e.id, srcRel: e.src ?? "", needle: extractNeedle(e.apply), test: e.test ?? "", expectFail: e.expectFail ?? "",
  })), { readSrc: readFace, readTest: readFace });
  const wiring = wiringCensus(wiringRows);
  const wiringUnknown = wiring["no-symbol"] + wiring["no-needle"] + wiring["no-title"] + wiring.unreadable;
  const suspectSample = wiringRows.filter((r) => r.kind === "suspect").slice(0, 8).map((r) => r.id);
  // 第 263 页那一格：能数出 return 出口的那几条里，有多少条落在「多出口」函数上——
  // 这一档是「存活了但判卷没错」的候选池（成因＝判卷没喂到那一支，修法＝补输入，见规则 329）。
  const countable = wiringRows.filter((r) => typeof r.returns === "number");
  const multiExit = countable.filter((r) => (r.returns ?? 0) >= 2);
  console.log(`ℹ️  指针接线（**线索，不进门禁**：静态代理按全表量会误喊，多数判卷从上游入口打进来；它只在「变异存活」那条红后面给方向）：` +
    `接上 ${String(wiring.wired)}／疑空 ${String(wiring.suspect)}／判不了 ${String(wiringUnknown)}` +
    `（疑空＝needle 所在函数名在那条用例体里一次都没出现；判不了的四类：无包围函数 ${String(wiring["no-symbol"])}、抽不出针脚或针脚不在源文件 ${String(wiring["no-needle"])}、` +
    `标题不在这份判卷 ${String(wiring["no-title"])}、两面任一读不到 ${String(wiring.unreadable)}）${suspectSample.length === 0 ? "" : "｜样本 " + suspectSample.join("、")}` +
    `｜出口数可数 ${String(countable.length)} 条，其中针脚长在「≥2 条 return」的函数里 ${String(multiExit.length)} 条` +
    `（存活时先问判卷喂到了第几支，别撤锚点：规则 329）`);
  // 一次求和、两处使用（汇总里印出来的数与 exit 码用的是同一个值；分开算就可能各说各话）。
  const blockingTotal = blockingTotalOf({
    needle: blocking.length, duplicateIds: dup.length, untracked: untracked.length, drift: drift.length,
    expectFail: stalePointers.length,
    headPointer: headPointers.length,
  });
  console.log(`针脚体检：${String(entries.length)} 条 —— 阻断 ${String(blockingTotal)}，待复认 ${String(warn.length)}，未覆盖 ${String(unparsed.length)}，逐行式 ${String(lineWise.length)}，未入库面 ${String(untracked.length)}（被测面 + 判卷两面），钉在飞文本 ${String(drift.length)}，killer 指针失效 ${String(stalePointers.length)}（其中 HEAD 侧 ${String(headPointers.length)}）${headUnchecked === 0 ? "" : "（HEAD 归属未查）"}`);
  return blockingTotal;
}

/** 跑一次判卷文件，并把**这一次**的墙钟毫秒与「本次选中几条用例」带回来。
 *  `pattern` 非空 ⇒ 走 `-t` 精确跑法（第 170 页）：一条锚点只跑自己那条 killer 用例，
 *  实测单价从「宿主时长 ×3」的 8.0s/拍降到 0.14s/拍（同一棵树、同一份宿主、复测两次：8.0/8.5s vs 0.136/0.143s）。
 *  ⚠️ 代价是 `-t` 选不中时 vitest **退出码 0**、全部 skipped——那一条拍什么都没测，所以 `selected` 必须回传，
 *  由调用侧把「选中 0 条」判红（规则 246）。 */
function runTest(testRel, pattern, configRel) {
  const started = Date.now();
  // 判卷配置跟着锚点走：桌面层是**独立 vitest 配置**（apps/desktop/vitest.config.ts，
  // environment: node、include 只收 tests/**），拿核心那份去跑它 ⇒ 一条都选不中、退出码 0，
  // 于是任何桌面锚点都会读成「变异存活」。缺省仍是核心那份（现有 1556 条行为不变）。
  // cwd 也要跟着配置走：vitest 的 include/filter 是相对**配置所在目录**解析的，
  // 在仓库根拿 apps/desktop/vitest.config.ts 去跑 "apps/desktop/tests/…" ⇒ No test files found。
  const cfg = configRel ?? "tests/vitest.config.ts";
  const cwd = configRel === undefined ? ROOT : join(ROOT, dirname(cfg));
  const testArg = configRel === undefined ? testRel : relative(cwd, join(ROOT, testRel));
  const args = [VITEST, "run", "--pool=threads", "--config", configRel === undefined ? cfg : basename(cfg), testArg];
  if (typeof pattern === "string" && pattern !== "") args.push("--testNamePattern=" + escapeTitlePattern(pattern));
  try {
    const out = execFileSync(process.execPath, args,
      { cwd, env: { ...process.env, TERM: "dumb" }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { code: 0, out, ms: Date.now() - started, selected: selectedTestCount(out) };
  } catch (e) {
    const out = (e.stdout ?? "") + (e.stderr ?? "");
    return { code: e.status ?? 1, out, ms: Date.now() - started, selected: selectedTestCount(out) };
  }
}

/** 某文件相对 HEAD 的状态（判据本体在 scripts/lib/mutate-gates.ts，那边可单测）。 */
function headStateOf(rel) {
  const tracked = execFileSync("git", ["ls-files", "--", rel], { cwd: ROOT, encoding: "utf8" }).trim();
  if (!tracked) return "untracked";
  try {
    execFileSync("git", ["diff", "HEAD", "--quiet", "--", rel], { cwd: ROOT });
  } catch {
    return "dirty";
  }
  return "clean";
}

/** 改法必须产出**语法合法**的源文件。把对象字面量里的一行 spread 顶替成 `void x;` 这类写法
 *  会让整个文件不再是合法 TS ⇒ 测试红在 vite 装载阶段而不是红在判据上，而 runner 只会说
 *  「没红在期望用例上——可能误伤无关用例」，把人的注意力引向「expectFail 写错了」这个假因。
 *  本会话内实踩两次，故就地判出来。transpileModule 只报语法诊断（不做类型检查）——
 *  突变体本来就允许类型层面的取巧（`if (false)` 之类）。 */
function mutantSyntaxProblem(mutated, rel = "") {
  /* **`.json` 不归 TS 解析器管**（2026-10-05 实测）：`package.json` 的顶层 `{ "node": ">=20.11.0 <25" }`
   *  在 TS/JS 里被读成**块语句 + 标签语句**，于是 `>=20.11.0 <25` 报 `';' expected`——
   *  而那份文件本身完全合法。后果不是"少抓一个错"，是**本仓被门管着的文件（package.json）
   *  根本没法配锚点**：每次加一条就说"改法把源文件改坏"，把人引向"我的 replace 写错了"这个假因。
   *  JSON 的正确检查是 `JSON.parse`——不是"跳过"：真把 JSON 改坏了照样在这儿拦住。 */
  if (rel.endsWith(".json")) {
    try { JSON.parse(mutated); return null; } catch (e) {
      return "改法致 JSON 非法（测试会红在装载阶段，不算分辨力证据）：" + (e instanceof Error ? e.message : String(e));
    }
  }
  const diags = ts.transpileModule(mutated, {
    reportDiagnostics: true,
    /* **`.tsx` 必须显式给 jsx 选项**（2026-10-14 第 490 页实测）：缺省时 transpileModule 把
     *  JSX 当 TS 的类型断言语法解析 ⇒ 每个 `<div>` 都报 `'>' expected`。实测
     *  `apps/desktop/src/renderer/App.tsx`（**未突变的原文件**）在这一组选项下报 355 条错
     *  ⇒ 桌面层任何 `.tsx` 锚点都会被判「改法致语法错」，而那是工具自己的盲区，不是改法坏了。
     *  这会把人引向「我的 replace 写错了」这个假因（与下面 `.json` 那条同族）。 */
    compilerOptions: {
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
      allowJs: true,
      ...(rel.endsWith(".tsx") ? { jsx: ts.JsxEmit.ReactJSX } : {}),
    },
  }).diagnostics ?? [];
  const errs = diags.filter((d) => d.category === ts.DiagnosticCategory.Error);
  if (errs.length === 0) return null;
  return "改法致语法错（测试会红在装载阶段，不算分辨力证据）：" + ts.flattenDiagnosticMessageText(errs[0].messageText, " ");
}

/** 在飞突变：这一刻盘上的源文件是**改过**的内容。
 *  ⚠️ 实测边界（09-23）：这条**不是**超时保险。`runTest` 走 `execFileSync`，同步阻塞整个事件循环，
 *  JS 层的信号处理器要等子进程结束才可能跑；而外层超时（`pnpm gates` 对本门约 20 分钟）在 SIGTERM
 *  之后不会等这么久——实测 SIGTERM 打到 node 后 1.5s 内什么都没发生，盘上仍是突变体 + `.mutbak`。
 *  真正可靠的口子是**下一次开跑时按证据自愈**（见下面 `leftoverActionOf` 那段）：那时三份内容都在盘上。
 *  这个处理器只兜住「子进程刚好结束、回到 JS 的那一刻被杀」这种次要窗口，成本 3 行，留着。 */
let inFlight = null; // { srcAbs, original, backup, mutated } | null
function restoreInFlight() {
  const f = inFlight;
  if (f === null) return "无在飞条目";
  inFlight = null;
  try {
    // `.mutbak` 从 `cpSync` 那一刻就存在（比突变早一拍：基线跑期间被杀时源文件还是干净的，
    // 但备份已经落了盘）。只还原内容不删备份，会让下次开跑被残留备份的 fail-closed 预检挡住。
    if (f.mutated) writeFileSync(f.srcAbs, f.original);
    rmSync(f.backup, { force: true });
    return `${f.mutated ? "已还原源文件" : "源文件未被改过"}，已清掉 ${f.backup}`;
  } catch { return "还原时抛错（收尾校验会抓到残留）"; }
}
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(sig, () => {
    console.error(`[mutate-verify] 收到 ${sig}：${restoreInFlight()}，剩下的条目按未证记账并判红（不拿「没跑完」当「都杀了」）`);
    process.exit(1);
  });
}

/* 跑法选择表与逐拍台账（第 170 页）。
 * SELECTABLE 是**懒算**的：模块级直接算会在每次 `--list`（判卷反复 spawn 的那条入口）都去读几十份判卷文件，
 * 把一条秒级尺拖成秒级×N；只有真跑锚点时才需要它。判据与第 169 页那把闸共用同一份谓词——
 * 唯一能逐字定位自己那条 killer 用例的锚点才走 `-t`，其余继续整文件跑法（两种跑法共存是刻意的，见那一页的未证②）。 */
let SELECTABLE = null;
const SPAWNS = [];

function selectableIds() {
  if (SELECTABLE === null) {
    const scan = selectorAmbiguity(
      MUTATIONS.map((m) => ({ id: m.id, test: m.test, expectFail: String(m.expectFail ?? "") })),
      (rel) => { try { return readFileSync(join(ROOT, rel), "utf8"); } catch { return null; } },
    );
    SELECTABLE = new Set(scan.selectableIds);
  }
  return SELECTABLE;
}

function verifyEntry(m) {
  /** 这条锚点**实际**付了几次判卷（#37）。早退路径本来就少付：基线不绿只跑 1 次、
   *  变异存活／未归因只跑 2 次、量不了（载不动／判卷在飞）跑 0~1 次。
   *  写死「每条三次」就是把模型当读数——第 165 页那句「每条少付 21s」正是这么推出来的。 */
  const runs = [];
  const mode = runModeFor(m.id, selectableIds());
  const pattern = mode === "selector" ? String(m.expectFail ?? "") : "";
  let vacuous = null;
  /** 每一拍都记账：毫秒进 #37 那份分母，模式与「本次选中几条」进跑法单价。
   *  「这一拍坏没坏」只有一份判据（`runReadingIsBad`）：闸与单价格各写一遍就会有一处先漂（规则 228），
   *  而这一闸是 `-t` 上线唯一的安全带——它同时否掉「什么都没测」与「测的是别条用例」。 */
  const note = (phase, r) => {
    runs.push(r.ms);
    SPAWNS.push({ mode, ms: r.ms, selected: r.selected });
    if (vacuous === null && runReadingIsBad(mode, r.selected)) {
      vacuous = vacuousRunLine(m.id, phase, r.selected);
    }
  };
  const disp = entryDisposition({
    srcRel: m.src,
    srcState: headStateOf(m.src),
    testRel: m.test,
    testState: headStateOf(m.test),
  });
  // refused 仍 fail-closed 抛死：源文件无 HEAD 兜底，崩了就回不来。
  if (disp.kind === "refused") throw new Error(disp.why);
  // unverified 只跳过本条——判卷文件只读不写，没有回滚风险，但也不能拿它当分辨力证据。
  if (disp.kind === "unverified") return { m, ok: null, why: disp.why, runsMs: runs };

  const srcAbs = join(ROOT, m.src);
  const backup = `${srcAbs}.mutbak`;
  const original = readFileSync(srcAbs, "utf8");
  cpSync(srcAbs, backup);
  inFlight = { srcAbs, original, backup, mutated: false }; // 备份一落盘就要能被收尾
  let restored = false;
  /** 判红**在出口就带类别**（第 172 页⑪，任务 #12）：末尾按类别分开数、下游 triage 读结构化那一行，
   *  不再回头解析给人看的散文。收成这一个 helper 是因为：少一处 helper 就多一处「忘了带类别」的出口，
   *  而那由 `redVerdictCell` 当场崩并点名第几条——它不许任何一条判红悄悄从总数里消失。 */
  const red = (failKind, why) => ({ m, ok: false, failKind, runsMs: runs, why });
  try {
    /* ① 基线：突变前该测试必须绿。两半各守一件事，都要保住——
     *  · 偶发红（`1c40df7` 那笔的理由）：判卷里碰真机的用例会偶发红，与本条变异无关，却会把基线读成「红」——
     *    09-28 整表实测 depdirs-descends-into-node-modules 就这样丢的认证（红的是同文件里那条与它无关的 index mtime 负控）。
     *    所以走 `judgeWithRetry`：瞬时红放过、持续红照旧按**最终那拍**判。
     *  · 每一次 spawn 都要进分母（任务 #37）：记账放在被重试的那次调用里做（`note` 同时喂 #37 的毫秒与跑法单价），
     *    被重试掉的第一次不许从读数里消失——否则「每条实际付了几拍」又变回一个乘数。
     *  载不动（判卷 import 不到的东西没入库）不是"基线不绿"——那是量不了（第 143 页）。 */
    const baseRun = judgeWithRetry(() => {
      const r = runTest(m.test, pattern, m.config);
      note("基线", r);
      return r;
    });
    const base = baseRun.probe;
    if (vacuous !== null) return red("vacuous", vacuous);
    if (base.code !== 0) {
      const kind = baselineRedKind(baseRun.probe.out);
      if (kind.kind === "unloadable") {
        return { m, ok: null, unloadable: kind.module, runsMs: runs, why: `判卷载不动（Cannot find module "${kind.module}"）⇒ 本条量不了，按未证记账；这不是「表退化」，是环境没备齐（多半是别人半落库，见 #11）` };
      }
      return red("baseline-red", `基线就不是全绿（不应发生）:\n${base.out.slice(-800)}`);
    }

    // ② 注入突变
    const mutated = m.apply(original);
    if (mutated === original) return red("no-effect", "突变未生效（锚点可能已失效）");
    const syntax = mutantSyntaxProblem(mutated, m.src);
    if (syntax !== null) return red("syntax", syntax);
    inFlight.mutated = true; // 从这一行起，盘上的源文件是**改过**的内容
    writeFileSync(srcAbs, mutated);

    // ③ 突变后必须红，且红在期望的那条用例上
    const hit = runTest(m.test, pattern, m.config);
    note("突变", hit);
    writeFileSync(srcAbs, original); // 尽早还原
    inFlight = null;
    restored = true;
    if (vacuous !== null) return red("vacuous", vacuous);
    if (hit.code === 0) return red("survived", "变异存活：测试全绿 = 对该逻辑无分辨力（恒真等价）" + wiringHint(m));
    // 归因只认**失败面**：`hit.out.includes(指针)` 会被一条 `✓` 通过的用例满足（第 141 页实测）。
    if (!killerAttributionOk(m.expectFail, hit.out)) {
      const failedFace = failingTestText(hit.out).slice(0, 300);
      return red("misattributed", `测试红了但没红在期望用例「${m.expectFail}」上——红的是别的用例（针脚可能落在隔壁支/隔壁函数）:\n${failedFace || "(输出里没有失败面那几行，按未归因处置)"}\n--- 尾部 ---\n${hit.out.slice(-500)}`);
    }
    // ④ 还原到位＝盘上字节与突变前逐字节相同（第 171 页⑩，任务 #10：整表每条少付一拍）。
    // 原来这一拍是「还原后再跑一遍要绿」（`restoreCheck`，含瞬时红重试）——那证明的是「还能跑」，
    // 而基线那一拍已经用同一份字节绿过一次：字节相同 ⇒ 行为等价于①，不必再花一次 spawn 复核；
    // 字节不同 ⇒ 直接点名差在哪，比"测试没绿"更准。**顺带把 `1c40df7` 那条偶发红的前提消掉了**：
    // 这一拍不再 spawn，就没有"重试一次才敢判绿"的那件事可发生（所以这里不保留 `restoreCheck`）。
    const restoreProblem = restoreDiffProblem(original, readFileSync(srcAbs, "utf8"));
    if (restoreProblem !== null) return red("restore-mismatch", `还原未逐字节相同：${restoreProblem}`);
    return { m, ok: true, runsMs: runs };
  } finally {
    inFlight = null; // 早退路径（基线不绿 / 突变未生效 / 语法错）也要清，别留一个指向已还原文件的空档
    if (!restored) writeFileSync(srcAbs, original);
    rmSync(backup, { force: true });
  }
}

/* 「印完就退」的出口必须**同步写满**：`console.log` 到管道是异步排队的，紧随其后的 `process.exit()`
 *  会把还没交给内核的尾巴丢掉。09-28 现读到过两次残缺：判卷在变异机里数出 `--list` 874/918 行，
 *  以及我在隔壁树上 `--list | awk` 数出某判卷文件只有 1 条锚点（同一张表用 node 数是 48 条）。
 *  这张表是两把静态尺共同的取料面，而汇总行是凭证的证据本体——展示可以被截，证据不能被内核丢掉（规则 214/225）。
 *  ⚠️ 单次 `writeSync(1, text)` 也**不够**：fd 1 接管道时是非阻塞的，一次只交得进内核缓冲那一截
 *  （改完第一版实测：920 行的名单被砍到几百行，三条吃 `--list` 的判卷当场一起红）。所以按返回字节数推进、写满为止：
 *  `EAGAIN`＝读者还没排空，重试；`EPIPE`／写不进＝读者走了或盘不对，不再转，剩下的由判卷的「行数≠表长」喊红。 */
const emitAndExit = (text, code) => {
  const buf = Buffer.from(text, "utf8");
  let off = 0;
  while (off < buf.length) {
    let n = 0;
    try {
      n = writeSync(1, buf, off);
    } catch (e) {
      if (String((e && e.code) || "") === "EAGAIN") continue;
      break;
    }
    if (n <= 0) break;
    off += n;
  }
  process.exit(code);
};

const plan = classifyArgs(process.argv.slice(2));
/** 锁面位置要从 git 问（`join(root, ".git")` 在 linked worktree 里是**文件**不是目录 ⇒ 每棵树各算一份锁＝没有锁）。
 *  定义放在只读分支之前，是为了让「只读面不许占锁」这条判卷能用真 common dir 造出反例：
 *  把它塞进 `--list` 那一支的变异如果只能拿 `""` 当入参，那支变异会**假装被杀死**（它根本占不到锁）。 */
const gitCommonDirOut = () => {
  try { return execFileSync("git", ["rev-parse", "--git-common-dir"], { cwd: ROOT, encoding: "utf8" }); }
  catch { return ""; } // 取不到锁面 ⇒ 不占锁但不停门（这道门不许依赖锁文件存在）
};
/** 本树自己的 git 目录。与 common dir 同指一处＝主检出，不同＝linked worktree（`mutateTreeGuard` 的判据）。 */
const gitDirOut = () => {
  try { return execFileSync("git", ["rev-parse", "--git-dir"], { cwd: ROOT, encoding: "utf8" }); }
  catch { return ""; }
};
/** 主检出的根：从 common dir 推，不从"我所在这棵树"推——本脚本在链接树里跑时，`.git` 是个**文件**，
 *  且 `.worktrees/` 下的树住在**主树**里（tests/head-cert-deps.test.ts:750 记的就是这一格算错的后果）。 */
const mainRootOut = () => {
  const c = gitCommonDirOut().trim();
  return c === "" ? "" : dirname(resolve(ROOT, c));
};
/* 本文件在**顶层**跑表，所以 `import("scripts/mutate-verify.mjs")` 就等于发起一次整表变异
 * （实测：一次"只想数一下条目数"的 `node -e` 探针就在主树跑了起来，SIGKILL 后留下一枚 mutant，
 *  靠 `.mutbak` + 三条证据前提还原）。条目数请走 `--list`；被 import 时一个字节都不许动。 */
/* 判「是不是被 import」这一格，两边都得是**真路径**再比：脚本自己那份身份是 `import.meta.url`
 * 给的（那已经是解析过的真路径），而 `process.argv[1]` 是调用方敲进来的那一串——它可以是软链。
 * macOS 上 `/tmp`→`/private/tmp`、`/var`→`/private/var`，home 目录是软链时同理：不归一化的话，
 * 一次完全正常的命令行调用会被这道闸以「被 import」的措辞拒掉，理由与真实原因毫无关系
 * （实测：同一份文件经 `/tmp/...` 调被拒、经 `/private/tmp/...` 调跑得起来）。
 * 读不出真路径时退回 `resolve`——宁可拒，不许因为"取不到身份"就放行。 */
const invokedAs = () => {
  if (process.argv[1] === undefined) return "";
  try { return realpathSync(process.argv[1]); } catch { return resolve(process.argv[1]); }
};
if (invokedAs() !== fileURLToPath(import.meta.url)) {
  console.error("mutate-verify 会就地改源文件：只能经命令行执行（数条目用 `--list`），被 import 时拒绝运行。");
  process.exit(2);
}
/* `--in-worktree=<树名>`：把「就地改源文件」这件事关进一棵**一次性**的树里。
 * 这一支是门表（package.json）与下面那道 `mutateTreeGuard` 之间的接线：门表带这个参数跑，
 * 本进程切好树之后**重新 exec 那棵树里的脚本副本**——于是 `ROOT`（由 import.meta.url 推出来）
 * 天然就是那棵树，后面两千行判据一行都不用改。
 *
 * 为什么父进程不占锁：它写的那棵树与别人无关，切到谁头上结果都一样（都切到同一个 HEAD，幂等），
 * 而真正动盘的那一段由**子进程自己**在树上占锁（见下面 ⓪）⇒ 两个并发的 `pnpm gates` 会在树的
 * 那一格撞窗，而不是并发改同一批 `.mutbak`。
 *
 * 排在 `plan.unknown` 之后、被 import 拒绝之后：拼错的 flag 与被 import 进来的情形都必须在**切树之前**停，
 * 否则一个手误就替用户建出一棵树来。只读面（`--list`／`--check-needles`）不重定向——
 * 它们不改源文件，留在当前树里跑就行，判卷也依赖 `--list` 在任意树里都读得到整张表。 */
if (plan.mode === "run" && (process.argv.slice(2).includes("--in-worktree") || process.argv.slice(2).some((a) => a.startsWith("--in-worktree=")))) {
  if (process.argv.slice(2).includes("--in-worktree")) {
    console.error("--in-worktree 只认 `--in-worktree=<树名>` 连写（空格写法会让树名被当成锚点 id 报「未知 id」）");
    process.exit(2);
  }
  const treeRel = (process.argv.slice(2).find((a) => a.startsWith("--in-worktree=")) ?? "").slice("--in-worktree=".length).trim();
  const mainRoot = mainRootOut();
  if (treeRel === "") {
    console.error("--in-worktree 需要一个树名（空值不等于「就地跑」——就地跑已被 mutateTreeGuard 挡住）");
    process.exit(2);
  }
  if (mainRoot === "") { console.error("取不到主检出的根（git 读不出 common dir）⇒ 没法切树，拒跑"); process.exit(2); }
  const treeAbs = resolve(mainRoot, treeRel);
  if (treeAbs === ROOT) { console.error(`--in-worktree 指向的就是当前这棵树（${ROOT}）⇒ 没有隔离，等于就地跑；换一个树名`); process.exit(2); }
  // 包含判定只问一句：`resolve` 已经把 `..` 归一化过了，所以「解出来还在不在主检出里」
  // 就是全部问题。原来还并列了一个 `treeRel` 里出现 `..` 就拒的子句——它被上面那句完全覆盖，
  // 却多带一格假阳性：`.worktrees/..foo`、`a/../b` 这类**解完仍在仓内**的名字会被它白拒。
  // 尾斜杠是刻意的：`/repo-evil` 不带斜链就不是 `/repo/` 的前缀，少这一个字符就等于没判。
  if (!treeAbs.startsWith(mainRoot + "/")) {
    console.error(`--in-worktree 的树名逃出了主检出（${treeRel} → ${treeAbs}）——不许在仓外开树`);
    process.exit(2);
  }
  const want = (() => { try { return execFileSync("git", ["rev-parse", "HEAD"], { cwd: mainRoot, encoding: "utf8" }).trim(); } catch { return ""; } })();
  if (want === "") { console.error("主检出取不到 HEAD ⇒ 没法切树，拒跑（不许拿一棵空树当隔离）"); process.exit(2); }
  /* 第 333 页 #40：派生**必然为 0** 的两种形状要在开树之前出声。
     实测代价：rev 取成"簇自己"那次，子进程那句 `ℹ️ 选中 0 条` 印出来时，`worktree add` 与
     `cp -al node_modules` 已经付过钱，随后整表兜底跑了 2121.7s（1412/1412）——响是响了，太晚。
     这里不重跑 selectChangedEntries（那要把整张表读进来），只按"改动清单是不是只有台账"判必然空。 */
  {
    const csArg = process.argv.slice(2).find((a) => a.startsWith("--changed-since="));
    if (csArg !== undefined) {
      const csRev = csArg.slice("--changed-since=".length).trim();
      const diff = spawnSync("git", ["diff", "--name-only", `${csRev}..${want}`], { cwd: mainRoot, encoding: "utf8" });
      const prevRev = (spawnSync("git", ["rev-parse", "--short", "HEAD~1"], { cwd: mainRoot, encoding: "utf8" }).stdout ?? "").trim();
      const hint = ledgerOnlyDerivationHint({ files: (diff.stdout ?? "").split("\n"), gitOk: diff.status === 0, prevRev });
      if (hint !== null) console.log(`[mutate-verify] ${hint.line}`);
    }
  }
  if (!existsSync(treeAbs)) {
    mkdirSync(dirname(treeAbs), { recursive: true });
    const added = spawnSync("git", ["worktree", "add", "--detach", treeRel, want], { cwd: mainRoot, encoding: "utf8" });
    console.log(`[mutate-verify] worktree add exit=${String(added.status)}：${treeRel} @ ${want.slice(0, 7)}`);
    if (added.status !== 0) { console.error((added.stderr || added.stdout || "").trim().split("\n").slice(0, 3).join("\n")); process.exit(2); }
  } else {
    const checked = spawnSync("git", ["-C", treeAbs, "checkout", "--detach", "--force", want], { cwd: mainRoot, encoding: "utf8" });
    console.log(`[mutate-verify] checkout exit=${String(checked.status)}：${treeRel} → ${want.slice(0, 7)}`);
    if (checked.status !== 0) { console.error((checked.stderr || checked.stdout || "").trim().split("\n").slice(-4).join("\n")); process.exit(2); }
  }
  // 切完再核：读数必须是这棵树**自己**的 HEAD（头 cert 那一格栽过的形状——链子里的 checkout 红了而门照跑）。
  const got = (() => { try { return execFileSync("git", ["-C", treeAbs, "rev-parse", "HEAD"], { cwd: mainRoot, encoding: "utf8" }).trim(); } catch { return ""; } })();
  if (got !== want) { console.error(`切完再核：树里是 ${got.slice(0, 7) || "读不出"}，目标是 ${want.slice(0, 7)} ⇒ 不一致，停`); process.exit(2); }
  // 依赖集：脚本要 import typescript / vitest，树里没有 node_modules 就一样跑不起来。硬链接零拷贝。
  const nm = join(treeAbs, "node_modules");
  if (!existsSync(nm)) {
    const copied = spawnSync("cp", ["-al", join(mainRoot, "node_modules"), nm], { encoding: "utf8" });
    console.log(`[mutate-verify] cp -al node_modules exit=${String(copied.status)}`);
    if (copied.status !== 0) { console.error((copied.stderr || "").trim()); process.exit(2); }
  }
  const childArgs = process.argv.slice(2).filter((a) => !a.startsWith("--in-worktree"));
  // 路径原样传：脚本自己那道「被 import 时拒绝运行」两边都归一化真路径（S2-3），
  // 仓库根落在软链后面（macOS 上 `/tmp`、`/var`、以及指向软链的 home 目录都可能）时它认得出来。
  // 这里原来有一处 `realpathSync` 兜底，那是给那道闸的缺陷打的补丁；病根修好就把补丁拆了——
  // 补丁留着的话，闸哪天真的退化，这条还会照样绿。
  const childScript = join(treeAbs, "scripts", "mutate-verify.mjs");
  const r = spawnSync(process.execPath, ["--import", "tsx", childScript, ...childArgs],
    { cwd: mainRoot, stdio: "inherit" });
  process.exit(r.status === null ? 2 : r.status);
}
// 认不出的 flag 一律拒跑：本脚本「无参数」的缺省语义是跑全表，那会就地改源文件几十分钟。
if (plan.unknown.length > 0) {
  console.error(`未知参数：${plan.unknown.join(" ")} —— 无参数即「跑全表」（就地改源文件），不把拼错的 flag 静默当缺省`);
  process.exit(2);
}
/* `--changed-since=<rev>`：把「该杀哪几条锚点」从人肉名单改成从**改动面**派生。
 *  一条锚点的面＝被测源 ∪ 它的判卷文件（只认一头必漏另一头，规则 208 的两半）。
 *  取料＝`rev → 工作树`的全部差异 ＋ 未跟踪文件：只比 HEAD 会把「这笔还没入库的改动」读成「没变」，
 *  而那恰好就是本笔要验的那些（第 161 页我手抄 9 条 id，代价是**同文件上的旧锚点全靠我记得**——规则 229 说的正是记不住的那天）。
 *  这段排在 `--list` 之前是有意的：`--list --changed-since=<rev>`＝**只印名单不改源文件**，
 *  于是"这次会验到哪些"能在跑之前先量出来（规则 222：候选尺开张前先量现读；没有这一格，想知道名单就必须真跑）。 */
const sinceArg = (() => {
  const a = process.argv.slice(2);
  const eq = a.find((x) => x.startsWith("--changed-since="));
  if (eq !== undefined) return eq.slice("--changed-since=".length).trim();
  const i = a.indexOf("--changed-since");
  return i === -1 ? null : String(a[i + 1] ?? "").trim();
})();
let derived = { ids: [], faceCount: 0, pickedCount: 0, total: MUTATIONS.length };
if (sinceArg !== null) {
  if (sinceArg === "") {
    console.error("--changed-since 需要一个 rev（空值不等于「不限」；要跑整表就不带参数）");
    process.exit(2);
  }
  try {
    const diff = execFileSync("git", ["diff", "--name-only", sinceArg], { cwd: ROOT, encoding: "utf8" });
    const others = execFileSync("git", ["ls-files", "--others", "--exclude-standard"], { cwd: ROOT, encoding: "utf8" });
    const changed = [...new Set([...diff.split("\n"), ...others.split("\n")].map((s) => s.trim()).filter((s) => s !== ""))];
    derived = selectChangedEntries(MUTATIONS, changed);
  } catch (e) {
    // 「取不到改动面」与「改动面为空」是两个数：前一个必须停下来，否则会被读成"没有要跑的锚点"＝白过
    console.error(`--changed-since=${sinceArg} 取不到改动面（git 报错）⇒ 不许读成「没有要跑的锚点」：${String((e && e.message) || e).split("\n")[0]}`);
    process.exit(2); // 取料坏 ≠ 空面：这里退 0 会让一次拼错的 rev 长得像"全表已验"
  }
  console.log(`改动面派生：rev=${sinceArg} → 变更文件 ${String(derived.faceCount)} 个 ⇒ 选中锚点 ${String(derived.pickedCount)}/${String(derived.total)} 条`);
  if (derived.pickedCount === 0) console.log("ℹ️ 选中 0 条：改动面里没有文件是任一锚点的两面之一（纯文档/配置改动会这样）⇒ 这**不是**「整表验过了」。");
}
/* 锁的身份默认＝这棵树的目录名；`--lock-tag=<标签>` 是给**判卷**留的隔离位。
 *  为什么需要它（09-28 实测，我自己撞出来的）：变异机跑某条锚点时会 spawn 那条锚点的判卷文件，
 *  而那判卷里有一条会往锁面上写"活人锁"——不加标签时它写的正是**这台机器自己占着**的那把，
 *  于是判卷自己喊「撞窗」⇒ 整个判卷文件基线红 ⇒ 挂在它上面的 46 条锚点全被判「基线就不是全绿」。
 *  机器的锁名永远是树名，带标签的那把只有判卷自己会碰到，两边就分开了（规则 223：判卷不许拿被度量者自己的状态当输入；
 *  head-cert 的同一格早有先例，那边是靠 `--tree=<witness>` 这个名字本身隔离的）。
 *  校验排在两条只读分支**之前**：这是入参形状（与 `--changed-since` 不给 rev 同档），不是占锁——
 *  只读面照样不被锁死，只是拿空标签的命令根本不该被读成"用默认那把"。 */
const lockTagRaw = (() => {
  const a = process.argv.slice(2);
  const eq = a.find((x) => x.startsWith("--lock-tag="));
  if (eq !== undefined) return { given: true, value: eq.slice("--lock-tag=".length).trim() };
  const i = a.indexOf("--lock-tag");
  return i === -1 ? { given: false, value: "" } : { given: true, value: String(a[i + 1] ?? "").trim() };
})();
if (lockTagRaw.given && lockTagRaw.value === "") {
  console.error("--lock-tag 需要一个标签（空值不等于「用默认那把」；要默认就别带这个参数）");
  process.exit(2);
}
if (plan.mode === "list") {
  // 后两列（判卷文件 + JSON 化的 killer 指针）是给判卷用的：`tests/mutate-verify-gates.test.ts`
  // 要走这条**不改源文件**的入口拿到整张表，而不能 spawn `--check-needles`——那会在变异跑到一半时被调用，
  // 撞上本门自己的备份文件预检，报「读不到汇总行」（第 138 页实测：三条新锚点的单跑全被这个假信号带红）。
  // 列协议必须无损：字段里可以带换行/制表符（真踩过——`impact-closure-glob-broken` 的 desc 里有换行，
  // 那一行被拆成两行 ⇒ 吃 `--list` 的两把静态尺同时少读一条锚点，而它们自己发现不了）。
  const oneLine = (v) => String(v).replace(/[\t\n\r]+/gu, " ");
  // 没给 `--changed-since` 时"选中 0 条"是**未筛**，不是筛出空表——所以判据看的是"给没给 flag"，不是 pickedCount
  const rows = sinceArg === null ? MUTATIONS : MUTATIONS.filter((m) => derived.ids.includes(m.id));
  const body = rows.map((m) => [m.id, m.src, m.desc, m.test, JSON.stringify(m.expectFail ?? "")].map(oneLine).join("\t")).join("\n") + "\n";
  emitAndExit(body, 0);
}
/** 只核针脚、不跑测试（秒级）——因此它能进 pnpm gates，而整张变异表要跑几十分钟、
 *  常被并发堵着：那段时间里失效的锚点在「假装守护」。 */
if (plan.mode === "check-needles") {
  /** 盘上有 `.mutbak` ⇒ 同名源文件可能是上次没还原的**突变体**，而针脚正是从这份内容算的。
   *  不这么报的后果实测过（2026-09-23）：一条 gemini.ts 的尸体让 needles-check 报出「针脚失效」，
   *  读的人去改一条本来好好的锚点。这一支**只读**（体检不许改盘），所以只点名、不自愈，并判红。 */
  const corpses = leftoverBackupPaths([...new Set(MUTATIONS.map((m) => m.src))], (rel) => existsSync(join(ROOT, rel)));
  if (corpses.length > 0) {
    for (const p of corpses) console.log(`  ❌ 残留 ${p} —— 同名的源文件可能是未还原的突变体，下面的针脚是从它算的，不可信`);
    emitAndExit("[mutate-needles-check] 先跑一次 mutate-verify（开跑前会按证据自愈），再核针脚\n", 1);
  }
  const bad = reportNeedles(MUTATIONS);
  // 顺带核每条**改法**产出的还是不是合法源文件：整张变异表要跑几十分钟且常被并发堵着，
  // 而这类错在变异跑里只会伪装成「误伤无关用例」。秒级能查出来的事不留到几十分钟后。
  const syntaxBad = [];
  for (const m of MUTATIONS) {
    let src;
    try {
      src = readFileSync(join(ROOT, m.src), "utf8");
    } catch {
      continue; // 源文件不存在另有针脚体检报
    }
    let out;
    try {
      out = m.apply(src);
    } catch (err) {
      syntaxBad.push([m.id, "apply 抛错：" + (err instanceof Error ? err.message : String(err))]);
      continue;
    }
    if (out === src) continue; // 未生效 = 针脚失效，上面已报
    const p = mutantSyntaxProblem(out, m.src);
    if (p !== null) syntaxBad.push([m.id, p]);
  }
  for (const [id, why] of syntaxBad) console.log(`  ❌ ${id} — ${why}`);
  if (syntaxBad.length > 0) console.log(`改法语法体检：${String(syntaxBad.length)} 条改法把源文件改坏 ❌`);
  else console.log(`改法语法体检：${String(MUTATIONS.length)} 条改法全部产出合法源文件 ✅`);
  const allGreen = bad === 0 && syntaxBad.length === 0;
  emitAndExit((allGreen
    ? "[mutate-needles-check] 全部锚点针脚可判定 ✅"
    : `[mutate-needles-check] ${String(bad + syntaxBad.length)} 条锚点针脚/改法失效 ❌`) + "\n", allGreen ? 0 : 1);
}

const targets = [...new Set([...plan.targets, ...derived.ids])];
const requested = targets.length ? MUTATIONS.filter((m) => targets.includes(m.id)) : MUTATIONS;

/* ⓪ 占锁：本门**就地改源文件**，所以同一棵树上的第二个实例不是"排队等待"，而是抢同一批 `.mutbak`——
 *  它的「残留备份自愈」会把第一个实例正在用的备份判成可恢复并盖回（第 161 页给 head-cert 建那把锁时，这一格只是没接）。
 *  于是顺序固定为：**先占到锁，再碰盘**（碰盘的第一件事就是 `healLeftoverBackups` 的写）。
 *  上面那两条只读入口（`--list`／`--check-needles`）在占锁之前就 exit 了 ⇒ 只读面永远不被这把门锁死，判卷有反向哨兵。
 *  占锁排在「未知 id 校验」**之前**，是为了给判卷一个不改盘的探法：带一个不存在的 id 真跑一次，
 *  拒跑措辞说「正被占用」＝锁在管，说「未知 id」＝锁没管——两个 exit 2 分得开，而这条路永远走不到写（规则 239）。
 *  占锁过程本身在 `scripts/lib/tool-lock.ts` 里只有一份：「占不到就不许动盘」这条纪律抄第二遍就是让
 *  第 161 页那几个坑（陈旧锁不先摘 ⇒ link 必 EEXIST／rename 会替换别人的锁／放锁不核身份）各复活一次。 */
const LOCK = acquireToolLock({
  tool: "mutate-verify",
  root: ROOT,
  tree: lockTagRaw.given ? lockTagRaw.value : ROOT,
  target: (() => {
    try { return execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim(); }
    catch { return "取不到HEAD"; }
  })(),
  commonDirOut: gitCommonDirOut(),
  harm: "抢这棵树会替别人改盘：第二个实例的自愈会把第一个正在用的 .mutbak 判成可恢复并盖回去",
  say: (line) => console.log(line),
});
console.log("[mutate-verify] 锁=" + LOCK.cell);

if (targets.length && requested.length !== targets.length) {
  console.error(`未知 id: ${targets.filter((t) => !MUTATIONS.some((m) => m.id === t)).join(", ")}`);
  process.exit(2);
}

/* ⓪½ 树闸：本门**就地改源文件**，而收尾兜底拦不住超时（`verifyEntry` 上方「实测边界（09-23）」），
 * 所以能动的树必须是一次性的 worktree。这一格排在未知 id 校验**之后**是为了保住 ⓪ 那条探法
 * （带不存在的 id 在主树真跑一次，措辞要能分出「锁在管」与「锁没管」）——两条都是 exit 2，
 *  把树闸提到前面，那条探法在主树里就永远只会说出「这是主检出」，锁的两态再也分不开。
 * 而它排在 `healLeftoverBackups()`（本次第一次写）之前，所以拒跑的这一支一个字节都没改过盘。 */
const TREE = mutateTreeGuard({ root: ROOT, gitDir: gitDirOut(), commonDir: gitCommonDirOut() });
if (TREE.kind === "refused") {
  console.error(`[mutate-verify] 树闸拒跑：${TREE.why}`);
  process.exit(2);
}

console.log(`变异验证：${requested.length} 条`);
// 预检（动因：HEAD 整跑实测烧掉 19 分钟才在第 k 条撞上"源文件未跟踪"，抛死后账本无痕）。
// 状态按路径缓存——696 条只对应几十个不同文件，逐条 git 会白跑上千次子进程。
const headStateCache = new Map();
const stateOf = (rel) => {
  let v = headStateCache.get(rel);
  if (v === undefined) { v = headStateOf(rel); headStateCache.set(rel, v); }
  return v;
};
/** 先自愈、再分流（2026-09-23 实测的次序缺陷）。处置块原先写在分流**之后**，于是「重跑被打污文件自己那条锚点」
 *  这条最自然的恢复动作会在 `entries.length === 0` 处提前退出，污染永远自愈不了。当场读数：
 *  `node scripts/mutate-verify.mjs gym-draft-worker-writes-as-parent` 只报「预检拒 1 条 ⇒ 判红退出」，
 *  盘上 `src/agent/gym/draft.ts.mutbak` 与原样留着的突变体一根手指都没碰——而它下一道门会把图读歪。
 *  判据只要 HEAD/备份/当前三份内容，与「本次跑哪几条」无关 ⇒ 提到分流前。
 *  顺带收益：`stateOf` 的缓存此刻还是空的，自愈之后分流读到的是还原后的干净态，那些锚点本轮就能照判。 */
healLeftoverBackups();
/** 预检**逐条**跳过不安全的那些，其余照跑（2026-09-23 改，此前是「有条目被拒 ⇒ 一条都不跑」）。
 *  旧写法的后果实测过：别人一个未跟踪的 `src/tools/snapshot.ts` 让 696 条锚点全部停摆，
 *  而红门只报「拒绝 1 条」——其余 695 条本可以判的文件没人判，读的人还以为保护在。
 *  让掉的只有安全性本身：被跳过的正是「崩溃后无 HEAD 可回滚」的 src，一条也不会被写；
 *  退出码照旧红（AGENTS 记的「主动拒变在飞文件＝属正确红」不变），只是这一回先把能跑的跑完。 */
const split = splitRunnable(requested.map((m) => ({
  id: m.id, srcRel: m.src, srcState: stateOf(m.src), testRel: m.test, testState: stateOf(m.test),
})));
const refusedIds = new Set(split.refused.map((r) => r.id));
const entries = requested.filter((m) => !refusedIds.has(m.id));
const refusedCount = split.refused.length;
if (refusedCount > 0) {
  for (const r of split.refused) console.error(`⚠️ 跳过 ${r.id} — ${r.why}`);
  console.error(`[mutate-verify] 预检拒 ${String(refusedCount)} 条（不安全，按未证记账），其余 ${String(entries.length)} 条照跑。` +
    "判卷文件在飞只让那一条不可判，源文件在飞只让那几条不跑——都不该停摆整张表。");
  if (entries.length === 0) {
    console.error("[mutate-verify] 一条都不安全 ⇒ 判红退出（这张表今天什么都没判，别让『没跑』读成『都杀了』）");
    process.exit(1);
  }
}
// 上一次没收尾干净就别硬跑：`.mutbak` 会在本次被 cpSync 覆盖，而它是"崩溃前原始内容"的唯一凭证。
// 但"别硬跑"不等于"一律交给人"——三份内容同一时刻都在盘上，能按证据自愈（判据在 `leftoverActionOf`）：
// 处置本体：备份 == HEAD、当前 != HEAD、且当前这份正好等于本表某条锚点
// 作用在备份上产出的突变体 ⇒ 是我们自己的残留，用备份盖回去无损；`isOurMutant` 不能省——
// 省了就会把「备份之后别人改了同一文件」一笔盖掉。**调用点在分流之前**，理由见那里的注释。
function healLeftoverBackups() {
  const allSrcs = [...new Set(MUTATIONS.map((m) => m.src))];
  const leftovers = leftoverBackupPaths(allSrcs, (rel) => existsSync(join(ROOT, rel)));
  if (leftovers.length === 0) return;
  const gitHeadText = (rel) => {
    try { return execFileSync("git", ["show", "HEAD:" + rel], { cwd: ROOT, encoding: "utf8" }); } catch { return null; }
  };
  const readOr = (abs) => { try { return readFileSync(abs, "utf8"); } catch { return null; } };
  const healed = [];
  const manual = [];
  for (const p of leftovers) {
    const srcRel = p.replace(/\.mutbak$/, "");
    const srcAbs = join(ROOT, srcRel);
    const bakText = readOr(join(ROOT, p));
    const curText = existsSync(srcAbs) ? readOr(srcAbs) : null;
    const isOurMutant = curText !== null && bakText !== null && MUTATIONS.some((m) => {
      if (m.src !== srcRel) return false;
      try { return m.apply(bakText) === curText; } catch { return false; }
    });
    const act = leftoverActionOf(gitHeadText(srcRel), bakText, curText, isOurMutant);
    if (act === "restore") {
      writeFileSync(join(ROOT, srcRel), bakText);
      rmSync(join(ROOT, p), { force: true });
      healed.push(`还原 ${srcRel}（备份 == HEAD，盘上那份是本表某条锚点留下的突变体）`);
    } else if (act === "drop-backup") {
      rmSync(join(ROOT, p), { force: true });
      healed.push(`删掉过期备份 ${p}（源文件已与 HEAD 一致）`);
    } else {
      manual.push(p);
    }
  }
  for (const h of healed) console.error("⚠️ 自愈：" + h);
  if (manual.length > 0) {
    for (const p of manual) console.error(`❌ 残留备份：${p} —— 备份与 HEAD 不一致，或当前内容对不上任何锚点的改法，不敢自动覆盖`);
    console.error("[mutate-verify] 这类残留说明中间还夹着别人的在飞改动，按两步人工处理：");
    for (const p of manual) console.error(`  1) git diff HEAD -- "${p.replace(/\.mutbak$/, "")}"   # 看清两边各是什么`);
    console.error("  2) 确认无误后删掉这些 .mutbak 再重跑");
    process.exit(1);
  }
  if (healed.length > 0) console.error("[mutate-verify] 自愈完成，继续本次判定（这些还原本身仍会过一遍收尾校验）");
}
// 自我预算：外层（`pnpm gates`）对本门有每道约 20 分钟的硬超时，而整张表实测要 20+ 分钟——
// 被掐死的位置若正好在「源文件是突变体」那一拍，就会留下污染（见 `restoreInFlight` 上面那段）。
// 给了预算就**自己**在条目边界收尾：还原完全、报「未判 N 条」、判红退出，绝不把「没跑完」读成「都杀了」。
const budget = budgetMsOf(process.argv.slice(2), process.env.DSH_MUTATE_BUDGET_MS);
if (budget.warning !== null) console.error(`⚠️ ${budget.warning}`);
const startedAt = Date.now();
let stoppedEarly = 0;
const results = [];
for (let i = 0; i < entries.length; i++) {
  const m = entries[i];
  if (budget.ms > 0 && Date.now() - startedAt >= budget.ms) {
    stoppedEarly = entries.length - i;
    for (const rest of entries.slice(i)) results.push({ m: rest, ok: null, stopped: true, runsMs: [], why: "预算用尽，没跑到（不等于已杀死）" });
    console.error(`[mutate-verify] ⏳ 预算 ${String(budget.ms)}ms 用尽：已跑 ${String(i)}/${String(entries.length)}，未判 ${String(stoppedEarly)} 条。` +
      "在条目边界主动收尾（源文件已全部还原），剩下的按未证记账并判红。");
    break;
  }
  const r = verifyEntry(m);
  const mark = r.ok === null ? "⏭️" : r.ok ? "✅" : "❌";
  console.log(`${mark} ${m.id} — ${m.desc} ｜${anchorCostCell(r.runsMs)}`);
  if (r.ok !== true) console.log(`   ${r.why}`);
  results.push(r);
}

// 强制收尾校验：所有被测源文件必须零 diff（还原失败 = 判红）
const srcs = [...new Set(entries.map((m) => m.src))];
// 收尾校验：git diff HEAD 看不见未跟踪文件，必须用 git status --porcelain 才能抓住
// 「未跟踪文件被改动」和「已跟踪文件相对 HEAD 漂移」两种残留。
const statusOut = execFileSync("git", ["status", "--porcelain", "--", ...srcs, ...srcs.map(backupPathOf)], {
  cwd: ROOT, encoding: "utf8",
}).trim();
if (statusOut) {
  console.error(`⚠️ 还原失败，以下源文件残留改动（必须人工检查）：\n${statusOut}`);
  process.exit(1);
}
const failed = results.filter((r) => r.ok === false);
const unverified = results.filter((r) => r.ok === null);
/* 未证分四类，计数与名单同源（第 171 页，任务 #14）。从前这里每个数各自 `filter` 一遍、只印一句「未证 30 条」，
 * 于是补跑得读者自己拿 `--list` 与日志求差集（09-28 实测就是这样补的 30 条）——算错一次就把没验的读成验了。
 * 分类按**字段**（`stopped`／`unloadable`／refused 名单），不按措辞：拿 `why` 的文字认类别，改一句文案就分错。 */
const unverifiedRows = [
  ...split.refused.map((r) => ({ id: r.id, cls: "src-in-flight" })),
  ...unverified.map((r) => ({
    id: r.m.id,
    cls: typeof r.unloadable === "string" ? "judge-unloadable" : r.stopped === true ? "budget-stopped" : "judge-in-flight",
  })),
];
const unv = unverifiedCell(unverifiedRows);
const unverifiedTotal = unv.total;
let unvText = "";
if (unverifiedTotal > 0) {
  const rerunLine = unv.rerun.length > 0
    ? `  ↻ 可原样补跑（只含「预算用尽」那一类；其余两类要等落库／备齐环境，现在补跑也没用）：node --import tsx scripts/mutate-verify.mjs ${unv.rerun.join(" ")}\n`
    : "";
  unvText = unv.summary + "\n" + unv.list.join("\n") + "\n" + rerunLine + "UNVERIFIED=" + String(unverifiedTotal) + "\n";
}
const killed = results.length - failed.length - unverified.length;
/* 判红按类别分开（第 172 页⑪）：从前这里只说「N 条变异存活或误伤」，而这几类的**修法相反**——
 * 存活要补观测者、红了未点名只改期望标题、基线红要先修那条红灯、取料坏根本没判。
 * 类别在各自的出口就定好（`red()` helper），这里只汇总；下游 `mutation-rerun-triage` 读 `REDKINDS=` 那一行，
 * 不再回头解析给人看的这句散文（同一件事两份谓词，改一句文案它就静默读成「读不出」——规则 205/213）。 */
const redCell = redVerdictCell(failed.map((r) => ({ id: r.m.id, kind: r.failKind })));
let redText = "";
if (redCell.total > 0) {
  redText = redCell.summary + "\n" + redCell.list.join("\n") + "\n" + redKindsLine(redCell.counts) + "\n";
}
console.log(`\n${failed.length === 0
  ? (unverifiedTotal === 0
      ? "全部变异被正确杀死（断言非恒真）"
      : `${String(killed)} 条被正确杀死，另 ${String(unverifiedTotal)} 条未证`)
  : `${String(failed.length)} 条判红（按类别分开数，修法各不同——见上一行起的分类名单）`}`);
// 耗时与「跑了几条」要自己报出来：外层对本门的超时是猜的（实测 1200s 掐死于表中途），
// 而这张表到底要跑多久此前没人打印过——没有读数，下一个人只能继续猜。
const secs = (Date.now() - startedAt) / 1000;
/* 成本分母（任务 #37）：这次**实际**spawn 了几次判卷、每个位置的中位多久。
 * 第 165 页那句「每条锚点少付 21s」是按「每条 3 次 × 宿主文件全时长」推的，实测只有 1.4–2.2s——
 * 因为早退路径只付 1~2 次，而第一拍还多付 vite 冷启动。没有这一行，下一个人仍然只能靠推。
 * 取料直接吃 `results` 里那份 `runsMs`：判卷不许自己再算一遍（规则 205/236），缺项由 `costRollupOf` 当场崩。 */
const costRows = results.map((r) => ({ id: r.m.id, runsMs: r.runsMs }));
const costLine = costCell(costRollupOf(costRows));
/* 跑法单价（第 170 页）：精确跑法与整文件跑法各自的拍数、中位与「坏拍数」——
 * 坏的定义只有一份（`runReadingIsBad`）：selector 选中≠1，whole 没量到或 0 条。
 * 「省了多少」以后由这一格说，不由任何人推算。 */
const modeLine = runModeCell(SPAWNS);
const timing = `[mutate-verify] 本次耗时 ${secs.toFixed(1)}s · 跑了 ${String(results.length - stoppedEarly)}/${String(entries.length)} 条` +
  (budget.ms > 0 ? ` · 预算 ${String(Math.round(budget.ms / 1000))}s` : " · 未设预算（外层超时会在中途杀我，见 --budget-ms）") +
  `\n${costLine}` + `\n${modeLine}` + `\n锁=${LOCK.cell}`;
// 有未证就红：这张表没判完不等于判完了（AGENTS：「主动拒变在飞文件」属正确红，不是回归）。
// 预算中途停下同样红：`stoppedEarly > 0` 时 failed 可以全空，但那只是「还没轮到」。
// 名单与补跑命令一起走 `emitAndExit` 那条**同步写满**的出口：名单可能几百条、几 KB，
// 用 `console.log` 交给异步队列再 `process.exit()` 就是拿丢掉尾巴的运气当读数（规则 241）。
emitAndExit(redText + unvText + timing + "\n", failed.length === 0 && refusedCount === 0 && stoppedEarly === 0 ? 0 : 1);
