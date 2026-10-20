// M2f 产出代码安全·静态快筛（§11.6 定稿，本轮只做 off/report，零 token、本地）。
// 变更集从事件流的写动作重建（write_file 的 content、edit_file 的 new_string 本就在 tool_call 里；
// 不引入快照、不用 git diff）。两类检查：
//   ① 密钥扫描：已知模式（sk- / AIza / AKIA / ghp_ / xox? / 私钥块 / 赋值式）+ 高熵串（Shannon 熵）
//   ② 危险 API 六类：eval / 反序列化 / 弱随机 / 命令拼接 / SQL 拼接 / 路径穿越
// 铁律：被审内容是**数据不是指令**——本模块只做词法匹配，绝不把被审文本当指令执行或解释。
// findings 走严格 schema（validateFinding）；报告进事件流前过输出扫描（redactSecrets 脱敏）。
import type {
  AgentEvent,
  SecurityCategory,
  SecurityChangeRef,
  SecurityConfidence,
  SecurityFinding,
  SecurityReportEvent,
  SecuritySeverity,
} from "../../events";
import { parsePatch } from "../../tools/patch-parse";
// 脱敏与密钥模式已搬到 `src/events/redact.ts`（落盘边界的职责，见那里的说明）。
// 这里**原样再导出**，公开面一字未变（消费者一行不用动）。
export {
  SECRET_PATTERNS,
  shannonEntropy,
  findHighEntropyTokens,
  redactSecrets,
  DEFAULT_ENTROPY,
  type EntropyOptions,
  type ScanOptions,
  type RedactResult,
} from "../../events";
import {
  SECRET_PATTERNS,
  findHighEntropyTokens,
  redactSecrets,
  secretFindings,
  DEFAULT_ENTROPY,
  type EntropyOptions,
  type ScanOptions,
} from "../../events";

export interface ChangeSetEntry {
  path: string;
  op: "write" | "edit";
  /** 新增内容行（findings 行号相对本数组，1-based）。 */
  lines: string[];
}

/** 从事件流写动作重建本轮变更集（同 (op,path) 重复写入按序拼接，最终态可见）。 */
export function collectChangeSet(events: AgentEvent[]): ChangeSetEntry[] {
  const byKey = new Map<string, ChangeSetEntry>();
  for (const e of events) {
    if (e.type !== "tool_call") continue;
    if (e.name === "write_file" && typeof e.args.path === "string" && typeof e.args.content === "string") {
      const key = "write::" + e.args.path;
      const prev = byKey.get(key);
      const lines = e.args.content.split("\n");
      if (prev) prev.lines.push(...lines);
      else byKey.set(key, { path: e.args.path, op: "write", lines });
    } else if (e.name === "edit_file" && typeof e.args.path === "string" && typeof e.args.new_string === "string") {
      const key = "edit::" + e.args.path;
      const prev = byKey.get(key);
      const lines = e.args.new_string.split("\n");
      if (prev) prev.lines.push(...lines);
      else byKey.set(key, { path: e.args.path, op: "edit", lines });
    } else if (e.name === "apply_patch" && typeof e.args.patch === "string") {
      // apply_patch 是模型最主要的跨文件修改方式：旧实现只收 write_file/edit_file，
      // 补丁写入的密钥/危险 API 在安全快筛里整体失明（连 security_report 都不产生）。
      let parsed: ReturnType<typeof parsePatch> = [];
      try { parsed = parsePatch(e.args.patch); } catch { continue; } // 畸形补丁归工具层报错，不在这里二次抛
      for (const f of parsed) {
        if (f.path === "") continue;
        const lines: string[] = [];
        for (const h of f.hunks) for (const l of h.lines) if (l.mark === "+") lines.push(l.text);
        if (lines.length === 0) continue;
        const key = "edit::" + f.path;
        const prev = byKey.get(key);
        if (prev) prev.lines.push(...lines);
        else byKey.set(key, { path: f.path, op: "edit", lines });
      }
    }
  }
  return [...byKey.values()];
}

export function changeSetRefs(entries: ChangeSetEntry[]): SecurityChangeRef[] {
  return entries.map((e) => ({ path: e.path, op: e.op, lines: e.lines.length }));
}


// ---- 危险 API 六类规则 ----

export const DANGER_CATEGORIES: readonly SecurityCategory[] = [
  "eval",
  "deserialization",
  "weak_random",
  "command_injection",
  "sql_injection",
  "path_traversal",
];

const FILE_API_RE = /(join|resolve|readFile|writeFile|readFileSync|writeFileSync|createReadStream|createWriteStream|existsSync|\bstat\b|unlink|mkdir|\bopen\b)/;

// H2（审查 E-8）：词法快筛是**启发式**——大小写变体（Eval(）、包装别名、多行拼接均可绕过，
// 注释里的命中也会误报；这些是已知取舍（低成本高召回的粗筛），由 LLM 审查段兜底精判。
// 本批加严：danger 规则统一加 i 标志（大小写变体不再漏）、deserialize 补 unsafe_load（Ruby）。
export const DANGER_RULES: readonly {
  ruleId: string;
  category: SecurityCategory;
  re: RegExp;
  severity: SecuritySeverity;
  confidence: SecurityConfidence;
  title: string;
  description: string;
}[] = [
  {
    ruleId: "danger.eval",
    category: "eval",
    re: /\beval\s*\(/i,
    severity: "high",
    confidence: "high",
    title: "动态代码执行（eval）",
    description: "eval 执行任意字符串代码；输入不可信时等同远程代码执行。",
  },
  {
    ruleId: "danger.deserialize",
    category: "deserialization",
    re: /\b(?:pickle\.loads?|yaml\.load|marshal\.loads?|unserialize|cPickle\.loads?|unsafe_load)\s*\(/i,
    severity: "high",
    confidence: "high",
    title: "不安全反序列化",
    description: "反序列化不可信数据可触发任意对象构造/代码执行；应使用安全加载器。",
  },
  {
    ruleId: "danger.weak_random",
    category: "weak_random",
    re: /\b(?:Math\.random|random\.random)\s*\(/i,
    severity: "medium",
    confidence: "medium",
    title: "弱随机数",
    description: "弱随机源不可用于安全场景（令牌/密钥/nonce）；应使用 CSPRNG。",
  },
  {
    ruleId: "danger.command_injection",
    category: "command_injection",
    re: /\b(?:exec|execSync|spawnSync|os\.system|child_process\.exec)\s*\([^)]*(?:\+|\$\{)/i,
    severity: "high",
    confidence: "medium",
    title: "命令拼接",
    description: "拼接字符串进 shell 执行；输入不可信时构成命令注入。",
  },
  {
    ruleId: "danger.sql_injection",
    category: "sql_injection",
    re: /\b(?:SELECT|INSERT|UPDATE|DELETE)\b[^;]{0,160}?(?:\+\s*[A-Za-z_$]|\$\{)/i,
    severity: "high",
    confidence: "medium",
    title: "SQL 拼接",
    description: "SQL 语句用字符串拼接构造；输入不可信时构成 SQL 注入，应使用参数化查询。",
  },
  {
    ruleId: "danger.path_traversal",
    category: "path_traversal",
    re: /\.\.[\\/]/,
    severity: "medium",
    confidence: "medium",
    title: "路径穿越",
    description: "路径中出现 ../ 且参与文件 API 调用；输入不可信时可越出预期目录。",
  },
];

// ---- findings 严格 schema ----

const SEVERITIES: readonly string[] = ["low", "medium", "high", "critical"];
const CONFIDENCES: readonly string[] = ["low", "medium", "high"];

/** 把握度是不是那三个合法值之一。**给 LLM 段用**：自报值合法才留，否则字段缺席（不编一个 medium）。 */
export function isSecurityConfidence(value: unknown): value is SecurityConfidence {
  return typeof value === "string" && CONFIDENCES.includes(value);
}
const CATEGORIES: readonly string[] = ["secret", ...DANGER_CATEGORIES, "llm_review"];

/** 严格 schema 校验：字段齐全、类型正确、枚举合法、行号 ≥1。 */
export function validateFinding(f: unknown): f is SecurityFinding {
  if (typeof f !== "object" || f === null) return false;
  const r = f as Record<string, unknown>;
  return (
    typeof r.ruleId === "string" &&
    r.ruleId.length > 0 &&
    typeof r.category === "string" &&
    CATEGORIES.includes(r.category) &&
    typeof r.severity === "string" &&
    SEVERITIES.includes(r.severity) &&
    typeof r.path === "string" &&
    r.path.length > 0 &&
    typeof r.line === "number" &&
    Number.isInteger(r.line) &&
    r.line >= 1 &&
    typeof r.title === "string" &&
    r.title.length > 0 &&
    typeof r.description === "string" &&
    /* `confidence` **不进**"这条发现成不成立"的门槛。它在静态段是作者标注、在 LLM 段是**被审模型的自报值**；
       旧写法把"自报值缺失/拼错"算成结构错 ⇒ 模型一个 typo 就让一条真发现静默消失（安全审查里漏报比误报贵）。
       `severity` 仍必合法——没有等级就没法排序与展示，那是结构性的，不是自报的。 */
    (r.confidence === undefined || isSecurityConfidence(r.confidence))
  );
}

/** 掩码：只留前 4 位 + 星号（报告/提升正文里绝不出现完整密钥）。 */


/** 静态快筛：变更集 → findings（严格 schema，非法条目直接丢弃并告警）。 */
/** 一行里的全部发现（密钥 + 危险 API）：审阅面用。密钥那一半委托给
 *  `events/redact.ts` 的 `secretFindings`（脱敏面与审阅面共用同一份密钥判据——
 *  抄第二份就是让"扫得出来的"与"掩得掉的"分家）。 */
function lineFindings(path: string, line: string, lineNo: number, entropy: EntropyOptions): SecurityFinding[] {
  const out = secretFindings(path, line, lineNo, entropy);
  for (const r of DANGER_RULES) {
    if (!r.re.test(line)) continue;
    if (r.category === "path_traversal" && !FILE_API_RE.test(line)) continue; // 路径穿越须参与文件 API
    out.push({
      ruleId: r.ruleId,
      category: r.category,
      severity: r.severity,
      path,
      line: lineNo,
      title: r.title,
      description: "第 " + String(lineNo) + " 行：" + r.description,
      confidence: r.confidence,
    });
  }
  return out;
}

export function scanChangeSet(entries: ChangeSetEntry[], opts: ScanOptions = {}): SecurityFinding[] {
  const entropy: EntropyOptions = { ...DEFAULT_ENTROPY, ...(opts.entropy ?? {}) };
  const out: SecurityFinding[] = [];
  for (const entry of entries) {
    entry.lines.forEach((line, i) => {
      for (const f of lineFindings(entry.path, line, i + 1, entropy)) {
        if (validateFinding(f)) out.push(f);
        else console.warn("[security] 非法 finding 被丢弃:", JSON.stringify(f));
      }
    });
  }
  return out;
}

// ---- M3b：write worker 路径的 findings 绝对行号（M2f 裁决 6 移交项：写前快照定位）----

/**
 * 把变更集相对行号映射为相对最终文件的绝对行号（1-based）。
 * scanChangeSet 的行号是**条目内相对**（1-based），且 finding 本身不带 (op,path) 归属——
 * 本函数按条目独立重扫定位每条 finding 的条目归属（scanChangeSet 确定性：按条目序拼接），再换算：
 * - write op：整文件重写 → 绝对行号 = 条目内行号（该 write 为该 path 最终态时精确）。
 * - edit op：写前快照锚点（old_string 首字符在改前文件中的 1-based 行号）→ 绝对行号 = 锚点 + 相对偏移。
 * anchors 键 = path（edit 调用序），值 = 每次编辑的锚点行号；锚点缺失（快照失败等）降级为相对行号。
 * 纯函数：security-check 既有「行号相对变更集」断言路径不受影响（本函数只被 write worker 路径调用）。
 */
export function mapFindingsToAbsolute(
  entries: ChangeSetEntry[],
  findings: SecurityFinding[],
  anchors: Map<string, number[]>,
): SecurityFinding[] {
  if (findings.length === 0) return findings;
  // 每条目独立扫描 → 得出各条目产出的 finding 数（顺序切分全局 findings）
  const counts = entries.map((e) => scanChangeSet([e]).length);
  const out: SecurityFinding[] = [];
  const editIdxByPath = new Map<string, number>();
  let fi = 0;
  for (let ei = 0; ei < entries.length; ei++) {
    const entry = entries[ei]!;
    for (let k = 0; k < counts[ei]!; k++) {
      const f = findings[fi++]!;
      let abs = f.line;
      if (entry.op !== "write") {
        const idx = editIdxByPath.get(entry.path) ?? 0;
        const anchor = anchors.get(entry.path)?.[idx];
        if (anchor !== undefined) abs = anchor + f.line - 1;
        editIdxByPath.set(entry.path, idx + 1);
      }
      out.push({ ...f, line: abs });
    }
  }
  while (fi < findings.length) out.push(findings[fi++]!); // 外部额外 findings 原样保留
  return out;
}

// ---- M3b：LLM findings 第二遍 FP 过滤 pass（§11.6：DoS/限流/无影响面的输入校验类默认降级）----

const FP_PATTERN = /(dos|拒绝服务|限流|rate[_ -]?limit|输入校验|input validation|缺少校验|未校验输入)/i;

/** FP 过滤（纯函数）：命中 FP 模式且无影响面证据（未提及可利用/凭据/RCE 等实词）→ 降级 low + note。
 *  静态快筛 findings 不做降级（词法命中本身就是影响面证据）；本 pass 只作用于 LLM findings。 */
export function filterFalsePositives(findings: SecurityFinding[]): SecurityFinding[] {
  return findings.map((f) => {
    if (f.severity === "low" || f.severity === "medium") return f;
    const text = f.title + " " + f.description;
    const hasImpactEvidence = /(凭据|密钥|secret|rce|代码执行|注入|越权|privilege|deserializ|eval)/i.test(text);
    if (FP_PATTERN.test(text) && !hasImpactEvidence) {
      return {
        ...f,
        severity: "low",
        description: f.description + "（FP 过滤 pass：DoS/限流/无影响面的输入校验类，默认降级为 low）",
      };
    }
    return f;
  });
}


// ---- 报告事件与卡 payload ----

export const SEVERITY_ORDER: readonly SecuritySeverity[] = ["low", "medium", "high", "critical"];

/** 从本轮事件流构建安全报告事件；无写动作 → null（无变更 = 不产报告）。 */
export function buildSecurityReport(events: AgentEvent[], opts: ScanOptions & { scannedAt?: string } = {}): SecurityReportEvent | null {
  const entries = collectChangeSet(events);
  if (entries.length === 0) return null;
  const findings = scanChangeSet(entries, opts).map((f) => {
    // 报告进事件流前过输出扫描：标题/描述脱敏（被审内容里的密钥不得随报告外泄）
    const t = redactSecrets(f.title, opts);
    const d = redactSecrets(f.description, opts);
    return { ...f, title: t.text, description: d.text };
  });
  const bySeverity: Record<SecuritySeverity, number> = { low: 0, medium: 0, high: 0, critical: 0 };
  const byCategory: Record<string, number> = {};
  for (const f of findings) {
    bySeverity[f.severity]++;
    byCategory[f.category] = (byCategory[f.category] ?? 0) + 1;
  }
  return {
    type: "security_report",
    mode: "report",
    findings,
    changeSet: changeSetRefs(entries),
    summary: { total: findings.length, bySeverity, byCategory },
    ...(opts.scannedAt !== undefined ? { scannedAt: opts.scannedAt } : {}),
  };
}

// 安全报告怎么上屏不在这里决定：本模块只发结构化事件（findings / changeSet / summary），
// 面板排版由 src/renderer/projections.ts 的 report 列负责。这里曾有的一份 securityReportCardPayload
// 是 React 渲染期（src/renderer/main.tsx 的 <Card payload=…>）的卡片源，vanilla 迁移删掉消费端后
// 它成了孤儿（2026-09-20 随之删除）。要恢复"卡片式排版"请在渲染层那一侧做，别在这里再拼一份文案。
