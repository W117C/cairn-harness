// M1c 规则库（§11.7.3）：allow/ask/deny 三行为条目、两层存储（项目 + 全局）、
// 命令链式拆分逐段判定（任一段 deny 全链 deny，同段最长前缀）、原子写、坏配置拒载。
import { readFileSync } from "node:fs";
import { readdir, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { writeFileAtomic } from "../atomic-write";
import { commandForms, invocations, tokenize, tokenSubsequenceStart } from "./command-shape";
import { ALLOW_PAYLOAD, isShellFamily } from "./risk";

export type RuleBehavior = "allow" | "ask" | "deny";

/** 规则条目 schema（§11.7.3）：pattern 仅命令类工具有效，读/写类用工具名全称。 */
export interface PermissionRule {
  behavior: RuleBehavior;
  tool: string;
  /** 命令段前缀：链拆分后逐段 startsWith 匹配；缺省 = 裸工具名条目（长度 0）。 */
  pattern?: string;
  scope: "always";
  /** 审计 id：加载/落库时生成（behavior:tool[:pattern]#序号）。 */
  id?: string;
  /** 这条规则来自哪一层，**只在加载面存在**：`loadPermissionRules` 盖章、`savePermissionRules` 剥掉。
   *  为什么不入库（S4 的地板要用它当判据）：文件内容是可以被仓库作者写的——把 `layer` 当成盘上事实，
   *  等于让仓内那份 `.agent/permissions.json` 自称"我是全局层"。归属只能由"这次读的是哪个路径"决定。 */
  layer?: RuleLayer;
}

/** 规则来源层。`global` ＝ 用户自己机器上那份；`project` ＝ 随仓库分发的那份。 */
export type RuleLayer = "global" | "project";

export interface PermissionsFile {
  rules: PermissionRule[];
}

const BEHAVIORS: ReadonlySet<string> = new Set(["allow", "ask", "deny"]);

function ruleIdOf(rule: PermissionRule, index: number): string {
  return `${rule.behavior}:${rule.tool}${rule.pattern ? ":" + rule.pattern : ""}#${String(index)}`;
}

/** 解析并校验一份权限库文本；任何不合法 → 抛错拒载（不静默回退默认，fail-closed）。 */
export function parsePermissionsFile(raw: string, origin: string): PermissionRule[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`权限库解析失败，拒载（${origin}）：${err instanceof Error ? err.message : String(err)}——请修复文件后重试`);
  }
  const file = parsed as Partial<PermissionsFile> | null;
  if (!file || typeof file !== "object" || !Array.isArray(file.rules)) {
    throw new Error(`权限库结构不合法，拒载（${origin}）：缺少 rules 数组`);
  }
  return file.rules.map((entry, i) => {
    const r = entry as Partial<PermissionRule> | null;
    if (!r || typeof r !== "object" || typeof r.behavior !== "string" || !BEHAVIORS.has(r.behavior)) {
      throw new Error(`权限库条目不合法，拒载（${origin}）：rules[${String(i)}].behavior 必须是 allow|ask|deny`);
    }
    if (typeof r.tool !== "string" || r.tool.trim() === "") {
      throw new Error(`权限库条目不合法，拒载（${origin}）：rules[${String(i)}].tool 必须是非空字符串`);
    }
    if (r.scope !== "always") {
      throw new Error(`权限库条目不合法，拒载（${origin}）：rules[${String(i)}].scope 必须是 "always"`);
    }
    if (r.pattern !== undefined && (typeof r.pattern !== "string" || r.pattern.trim() === "")) {
      throw new Error(`权限库条目不合法，拒载（${origin}）：rules[${String(i)}].pattern 必须是非空字符串或缺省`);
    }
    const rule: PermissionRule = {
      behavior: r.behavior as RuleBehavior,
      tool: r.tool.trim(),
      scope: "always",
    };
    if (typeof r.pattern === "string") rule.pattern = normalizeCommand(r.pattern);
    rule.id = ruleIdOf(rule, i);
    return rule;
  });
}

/** 两层加载：全局层在前、项目层在后，**合并成并集并给每条盖上层归属**。任一层解析失败 → 整体抛错拒载。
 *
 *  合并面为什么必须带层：段内的赢家是「最长前缀那条」，行为优先序只在等长时生效——所以
 *  「谁放宽了谁」光看合并后的数组是**答不出来**的（S4 的实测形状：deny「git push」＋allow
 *  「git push --force」⇒ allow，且与两条的先后顺序无关）。有了层归属，`matchSegment` 才谈得上
 *  地板：全局层的 deny 命中即压过任何 allow（业主 2026-10-04 裁决）。
 *  旧注释写的「优先序 deny>ask>allow 与最长前缀使项目层只能收紧」是错的，且错了很多轮没人抓到
 *  ——因为此前没有任何一格判「这条 allow 来自哪一层」。 */
export function loadPermissionRules(projectPath?: string, globalPath?: string): PermissionRule[] {
  const rules: PermissionRule[] = [];
  if (globalPath) {
    const raw = readIfExists(globalPath);
    if (raw !== null) rules.push(...parsePermissionsFile(raw, globalPath).map((r) => ({ ...r, layer: "global" as const })));
  }
  if (projectPath) {
    const raw = readIfExists(projectPath);
    if (raw !== null) rules.push(...parsePermissionsFile(raw, projectPath).map((r) => ({ ...r, layer: "project" as const })));
    // #57：同目录的 always-allow 那份**透明并入**（同为 project 层，排在被跟踪那份之后）。
    // 为什么放读侧而不是让每个调用方自己多传一个参数：写入端搬走文件之后，若读侧漏一处，
    // 症状是"批准过的总是允许下次不生效"——那是**静默失效**，比记错更坏。
    // 收在一处，任何调用方（含将来新增的）都不可能忘。文件不存在＝零行为（现读全仓都没有这个文件）。
    const alwaysPath = join(dirname(projectPath), ALWAYS_RULES_FILE);
    const alwaysRaw = readIfExists(alwaysPath);
    if (alwaysRaw !== null) rules.push(...parsePermissionsFile(alwaysRaw, alwaysPath).map((r) => ({ ...r, layer: "project" as const })));
  }
  return rules;
}

function readIfExists(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

/** always-allow 的落点文件名（#57，2026-10-05）——与受版本控制的 `permissions.json` **分开**。
 *
 *  为什么必须分开：`<workspace>/.agent/permissions.json` 在本仓是**有意跟踪**的（它是策展过的
 *  项目策略，该随仓库走）。但「某人在这台机器上点过一次总是允许」是**授权记录**，属于机器、
 *  不属于仓库——写在同一个文件里就等于随仓库分发：谁 clone，谁就继承那一次授权。
 *  这条与 S4 是同一族的两半：S4 修的是「谁放宽了谁」不可判，这一条修的是「授权跟着仓库跑」。
 *
 *  单独一个文件而不是改名整体迁移：`permissions.json` 里可能有**人写**的项目策略，
 *  那些该继续被跟踪；只有**程序写**的那部分搬走。判卷钉的是"程序写的一律不落进被跟踪那份"。 */
export const ALWAYS_RULES_FILE = "permissions.always.json";

/** always-allow 的落点：`<workspace>/.agent/permissions.always.json`（**必须**在 `.gitignore` 里）。 */
export function alwaysRulesPath(workspace: string): string {
  return join(workspace, ".agent", ALWAYS_RULES_FILE);
}

/** 全局层占位路径：<appData>/permissions.json（M1d 接设置页）。 */
export function globalPermissionsPath(appDataDir?: string): string {
  const base = appDataDir ?? process.env.DSH_APPDATA ?? join(process.env.HOME ?? ".", ".local", "share");
  return join(base, "permissions.json");
}

/** 原子写：临时文件 + rename；写前清理历史残留临时文件（写入中断自愈）。
 *  临时名由目标文件名派生（见 src/atomic-write），故清理前缀同样派生——写死的名字在
 *  传非缺省 path 时清不到自己留下的残留。 */
export async function savePermissionRules(path: string, rules: PermissionRule[]): Promise<void> {
  const dir = dirname(path);
  const prefix = basename(path) + ".tmp-";
  try {
    for (const name of await readdir(dir)) {
      if (name.startsWith(prefix)) await rm(join(dir, name), { force: true });
    }
  } catch {
    // 目录清理失败不阻塞主写入
  }
  // 落盘前剥掉 `layer`：归属是「这次读了哪个路径」的事实，不是文件内容。留着它＝仓内那份
  // `.agent/permissions.json` 可以自称全局层，而全局层这一侧现在带着地板权（deny 压过 allow）。
  const payload: PermissionsFile = {
    rules: rules.map(({ behavior, tool, pattern, scope, id }) => ({ behavior, tool, ...(pattern === undefined ? {} : { pattern }), scope, ...(id === undefined ? {} : { id }) })),
  };
  await writeFileAtomic(path, JSON.stringify(payload, null, 2) + "\n"); // rename 原子：目标文件要么旧内容要么新内容，永不出现半个文件
}

// ---- 命令链式拆分与最长前缀匹配（Roo 引擎语义，§11.7.3 采纳）----

// P1-5（审查根因 1）：换行与单与号也是 shell 命令分隔符——旧切分不认它们，
// `echo hi\ngit push --force` 归一成一段且不以 git push 开头 → deny 命中不了 → 放行。
const CHAIN_SPLIT = /\s*(?:&&|\|\||[;|&]|[\r\n]+)\s*/;

/** 按 &&、||、;、|、&、换行拆链；空白归一（多空格折成单空格）。 */
export function splitCommandChain(command: string): string[] {
  return command
    .split(CHAIN_SPLIT)
    .map((s) => normalizeCommand(s))
    .filter((s) => s.length > 0);
}

export function normalizeCommand(s: string): string {
  return s.trim().replace(/\s+/g, " ");
}

const BEHAVIOR_RANK: Record<RuleBehavior, number> = { deny: 0, ask: 1, allow: 2 };

export interface RuleHit {
  rule: PermissionRule;
  prefixLen: number;
  /** allow 命中但前缀之后还剩载荷：这条命中的**同意范围**不覆盖当前命令，已就地降为 ask。 */
  consentGap?: boolean;
  /** ⑩：deny/ask 的词只在**某个不认识的头部 token 之后**按序出现（`setsid git push --force`）。
   *  头部那个词是包装器还是"被 echo 出去的文本"判不准 ⇒ 不静默拒绝也不静默放行，降为 ask。
   *  `headBeyondKnownToken` 是那一支的首词，只给卡面看。 */
  headBeyondKnown?: boolean;
  headBeyondKnownToken?: string;
}

/** **token 边界**前缀命中（09-22 已裁）：整串 `startsWith` 一头宽一头窄——
 *  `deny "git push --force"` 会把 `--force-with-lease`（比裸强推更安全的那个）一起拦掉。
 *  命中处的右邻必须是空白或行尾才算命中；pattern 自身尾部的空白不参与比较。
 *  返回用于「最长前缀」比较的长度（未命中 −1）。空 pattern 语义原样保留（命中整段）。 */
function prefixLenAtBoundary(text: string, pattern: string): number {
  const pat = pattern.replace(/\s+$/, "");
  if (pat === "") return 0;
  if (!text.startsWith(pat)) return -1;
  return text.length === pat.length || /\s/.test(text.charAt(pat.length)) ? pat.length : -1;
}

/** 单段匹配：所有命中里取最长前缀；同长取行为优先序 deny > ask > allow。
 *
 *  deny/ask 按**有效形态**匹配（`commandForms`：跳过 exec 包装器与环境赋值、路径取基名、
 *  `shell -c` 载荷递归），allow 只认原形。这条不对称是刻意的：
 *  ⑴ 包装器恰恰是「被禁的事」藏身的地方——`/usr/bin/git push --force`、`env FOO=1 …`、
 *    `nohup …`、`timeout 30 …`、`command …`、`bash -c '…'` 六类写法曾把用户手写的 deny
 *    静默击穿（09-21 探针红 24 / 绿 9）；
 *  ⑵ 而 allow 是「用户点过一次总是允许」时**看见并同意的那条字面命令**，顺着包装器放宽
 *    等于替他扩大同意范围（本仓另有一笔 allow 过覆盖的账要还，方向是收紧不是放宽）。
 *  两侧都走 `prefixLenAtBoundary`：边界收紧对 allow 同样成立（`allow git status` 不该
 *  覆盖 `git status-bar`），但它仍只吃原形——不对称的是形态面，不是边界。 */
function matchSegment(rules: PermissionRule[], segment: string): RuleHit | null {
  let best: RuleHit | null = null;
  let forms: string[] | null = null; // 惰性解析：只有 deny/ask 条目需要时才展开形态
  for (const rule of rules) {
    const pattern = rule.pattern; // 取一次：形态匹配在 else 分支里，TS 的收窄跟不过 else-if 链
    let len: number;
    let gap = false;
    let beyond = false;
    if (pattern === undefined) len = 0; // 裸工具名条目
    else if (rule.behavior === "allow") {
      len = prefixLenAtBoundary(segment, pattern);
      // 前缀命中之后还剩载荷 ⇒ 用户点「总是允许」时看见的不是这条命令。按 ask 处理：
      // 同意范围不往外扩（09-21 探针 ② 段，`echo hi` 的同意曾覆盖 `echo hi > /tmp/pwned`）。
      if (len >= 0) gap = ALLOW_PAYLOAD.test(segment.slice(len));
    } else {
      forms ??= commandForms(segment);
      if (forms.some((f) => prefixLenAtBoundary(f, pattern) >= 0)) len = pattern.length;
      else {
        // ⑩（09-22 已裁）的按序面：词的顺序对得上、中间插了别的词也算命中。
        // 候选是**token 序列**（段本身 + 每个调用点的 `bin + args`），不是 `commandForms` 那些
        // 重新 join 出来的字符串——引号在 join 时已经丢了，按字符串扫会把
        // `echo 'git push --force'`（一个 token 的文本）当成三个词命中。
        // 最早命中下标 > 0 ⇒ 规则的内容躲在一个不认识的头部 token 后面（setsid / pkexec /
        // script …）：那可能是包装器也可能是被 echo 出去的文本，判不准就不静默拒绝、
        // 也不静默放行 ⇒ 就地降为 ask，把决定权交回用户。
        const starts = [tokenize(segment), ...invocations(segment).map((i) => [i.bin, ...i.args])]
          .map((t) => tokenSubsequenceStart(t, pattern))
          .filter((i) => i >= 0);
        len = starts.length === 0 ? -1 : pattern.length;
        beyond = starts.length > 0 && Math.min(...starts) > 0;
      }
    }
    if (len < 0) continue;
    const headUnknown = beyond && rule.behavior === "deny";
    const effective: PermissionRule = gap || headUnknown ? { ...rule, behavior: "ask" } : rule;
    // 地板（业主 2026-10-04 裁决，S4）：**全局层的 deny 一旦命中，就压过任何 allow**，不管那条
    // allow 的前缀更长还是更短。没有这条时，赢家单纯是「段内最长前缀」，于是仓内一份
    // `.agent/permissions.json` 里的 allow「git push --force」就能把用户自己下的 deny「git push」放宽
    // （实测：顺序对调也是 allow ⇒ 放宽不来自顺序，来自长度）。
    // 方向只此一条：项目层的 deny **不**获得同等优先权——它既不能替全局层放行，也不能替全局层强加；
    // 其余一切仍是「段内最长前缀者胜，等长时 deny>ask>allow」。
    const floor = effective.behavior === "deny" && effective.layer === "global";
    const bestFloor = best !== null && best.rule.behavior === "deny" && best.rule.layer === "global";
    const longerOrTiedBetter =
      best === null ||
      len > best.prefixLen ||
      (len === best.prefixLen && BEHAVIOR_RANK[effective.behavior] < BEHAVIOR_RANK[best.rule.behavior]);
    if (best === null || (floor && !bestFloor) || (floor === bestFloor && longerOrTiedBetter)) {
      best = {
        rule: effective,
        prefixLen: len,
        consentGap: gap,
        ...(headUnknown
          ? { headBeyondKnown: true, headBeyondKnownToken: tokenize(segment)[0] ?? "" }
          : {}),
      };
    }
  }
  return best;
}

export type ChainVerdict =
  /** `pattern` = 命中那条规则禁/放的字面（卡面要说得出「禁的是哪一段」，只有 ruleId 时用户得自己拆）。
   *  `headBeyondKnown` / `headToken` = ⑩ 的降级凭据：规则的内容躲在这个首词后面，而首词我们认不出来。 */
  | {
      verdict: "allow" | "ask" | "deny";
      ruleId: string;
      pattern?: string;
      consentGap?: boolean;
      headBeyondKnown?: boolean;
      headToken?: string;
    }
  | { verdict: "miss" };

/** 规则适用工具判定：shell 能力域内互通（run_shell ↔ shell_rw ↔ shell_ro）。
 *  用户为 run_shell 写的 deny/ask 必须同样约束 worker 的 shell_rw——否则「按能力设防」
 *  在编排侧整条失效（M3b worker 的 shell 工具名不是 run_shell）。 */
function ruleApplies(ruleTool: string, tool: string): boolean {
  if (ruleTool === tool) return true;
  return isShellFamily(ruleTool) && isShellFamily(tool);
}

/** 链式判定：任一段命中 deny → 全链 deny（deny 短路优先，不受其他段未命中影响）；
 *  全段命中时取最坏行为（deny > ask > allow）；任一段无规则命中 → miss（落回档位层）。
 *  deny 短路必须先于 miss 判定：否则 `echo x && git push --force` 里那个无规则命中的
 *  无害前缀会把整链打回档位层，用户显式 deny 被击穿（P0-2）。 */
export function judgeChain(rules: PermissionRule[], tool: string, command?: string): ChainVerdict {
  const applicable = rules.filter((r) => ruleApplies(r.tool, tool));
  if (applicable.length === 0) return { verdict: "miss" };
  const segments = command === undefined ? [""] : splitCommandChain(command);
  if (segments.length === 0) return { verdict: "miss" };
  let worst: RuleHit | null = null;
  let allHit = true;
  for (const seg of segments) {
    const hit = matchSegment(applicable, seg);
    if (!hit) {
      allHit = false; // 本段无规则：不再立即 miss——后面的段仍可能命中 deny 并短路整链
      continue;
    }
    if (hit.rule.behavior === "deny") {
      return {
        verdict: "deny",
        ruleId: hit.rule.id ?? "",
        ...(hit.rule.pattern !== undefined ? { pattern: hit.rule.pattern } : {}),
      }; // 任一段 deny 全链 deny
    }
    // 审查 S1-1：跨段必须取最严（rank 小者优先，deny<ask<allow）。旧实现用 > 取的是
    // rank 最高=最宽，于是一条 allow 前缀就把同链任意 ask 段击穿（与上方注释相反）。
    if (worst === null || BEHAVIOR_RANK[hit.rule.behavior] < BEHAVIOR_RANK[worst.rule.behavior]) {
      worst = hit;
    }
  }
  if (!allHit || worst === null) return { verdict: "miss" };
  return {
    verdict: worst.rule.behavior,
    ruleId: worst.rule.id ?? "",
    ...(worst.rule.pattern !== undefined ? { pattern: worst.rule.pattern } : {}),
    ...(worst.consentGap === true ? { consentGap: true } : {}),
    ...(worst.headBeyondKnown === true
      ? { headBeyondKnown: true, headToken: worst.headBeyondKnownToken ?? "" }
      : {}),
  };
}
