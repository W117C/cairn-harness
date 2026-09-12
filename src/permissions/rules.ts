// M1c 规则库（§11.7.3）：allow/ask/deny 三行为条目、两层存储（项目 + 全局）、
// 命令链式拆分逐段判定（任一段 deny 全链 deny，同段最长前缀）、原子写、坏配置拒载。
import { readFileSync } from "node:fs";
import { mkdir, readdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { isShellFamily } from "./risk";

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
}

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

/** 两层加载：全局层在前、项目层在后（合并成并集；优先序 deny>ask>allow 与最长前缀
 * 使项目层只能收紧不可放宽全局层）。任一层解析失败 → 整体抛错拒载。 */
export function loadPermissionRules(projectPath?: string, globalPath?: string): PermissionRule[] {
  const rules: PermissionRule[] = [];
  if (globalPath) {
    const raw = readIfExists(globalPath);
    if (raw !== null) rules.push(...parsePermissionsFile(raw, globalPath));
  }
  if (projectPath) {
    const raw = readIfExists(projectPath);
    if (raw !== null) rules.push(...parsePermissionsFile(raw, projectPath));
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

/** 全局层占位路径：<appData>/permissions.json（M1d 接设置页）。 */
export function globalPermissionsPath(appDataDir?: string): string {
  const base = appDataDir ?? process.env.DSH_APPDATA ?? join(process.env.HOME ?? ".", ".local", "share");
  return join(base, "permissions.json");
}

const TMP_PREFIX = "permissions.json.tmp-";

/** 原子写：临时文件 + rename；写前清理历史残留临时文件（写入中断自愈）。 */
export async function savePermissionRules(path: string, rules: PermissionRule[]): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const dir = dirname(path);
  try {
    for (const name of await readdir(dir)) {
      if (name.startsWith(TMP_PREFIX)) await rm(join(dir, name), { force: true });
    }
  } catch {
    // 目录清理失败不阻塞主写入
  }
  const tmp = join(dir, TMP_PREFIX + String(process.pid) + "-" + String(Date.now()));
  const payload: PermissionsFile = { rules };
  await writeFile(tmp, JSON.stringify(payload, null, 2) + "\n", "utf8");
  await rename(tmp, path); // rename 原子：目标文件要么旧内容要么新内容，永不出现半个文件
}

// ---- 命令链式拆分与最长前缀匹配（Roo 引擎语义，§11.7.3 采纳）----

const CHAIN_SPLIT = /\s*(?:&&|\|\||[;|])\s*/;

/** 按 &&、||、;、| 拆链；空白归一（多空格折成单空格）。 */
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
}

/** 单段匹配：所有命中里取最长前缀；同长取行为优先序 deny > ask > allow。 */
function matchSegment(rules: PermissionRule[], segment: string): RuleHit | null {
  let best: RuleHit | null = null;
  for (const rule of rules) {
    let len: number;
    if (rule.pattern === undefined) len = 0; // 裸工具名条目
    else if (segment.startsWith(rule.pattern)) len = rule.pattern.length;
    else continue;
    if (
      best === null ||
      len > best.prefixLen ||
      (len === best.prefixLen && BEHAVIOR_RANK[rule.behavior] < BEHAVIOR_RANK[best.rule.behavior])
    ) {
      best = { rule, prefixLen: len };
    }
  }
  return best;
}

export type ChainVerdict =
  | { verdict: "allow" | "ask" | "deny"; ruleId: string }
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
      return { verdict: "deny", ruleId: hit.rule.id ?? "" }; // 任一段 deny 全链 deny
    }
    if (worst === null || BEHAVIOR_RANK[hit.rule.behavior] > BEHAVIOR_RANK[worst.rule.behavior]) {
      worst = hit;
    }
  }
  if (!allHit || worst === null) return { verdict: "miss" };
  return { verdict: worst.rule.behavior, ruleId: worst.rule.id ?? "" };
}
