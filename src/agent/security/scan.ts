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
    }
  }
  return [...byKey.values()];
}

export function changeSetRefs(entries: ChangeSetEntry[]): SecurityChangeRef[] {
  return entries.map((e) => ({ path: e.path, op: e.op, lines: e.lines.length }));
}

// ---- 密钥扫描 ----

/** 已知密钥模式表（顺序即优先级；ruleId 稳定可审计）。 */
export const SECRET_PATTERNS: readonly {
  ruleId: string;
  re: RegExp;
  severity: SecuritySeverity;
  confidence: SecurityConfidence;
  title: string;
}[] = [
  { ruleId: "secret.private_key", re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/, severity: "critical", confidence: "high", title: "私钥块" },
  { ruleId: "secret.openai", re: /\bsk-[A-Za-z0-9_-]{16,}/, severity: "high", confidence: "high", title: "OpenAI 风格密钥" },
  { ruleId: "secret.google", re: /\bAIza[0-9A-Za-z_-]{20,}/, severity: "high", confidence: "high", title: "Google API 密钥" },
  { ruleId: "secret.aws", re: /\bAKIA[0-9A-Z]{16}\b/, severity: "high", confidence: "high", title: "AWS Access Key ID" },
  { ruleId: "secret.github", re: /\bghp_[A-Za-z0-9]{20,}/, severity: "high", confidence: "high", title: "GitHub Token" },
  { ruleId: "secret.slack", re: /\bxox[baprs]-[A-Za-z0-9-]{10,}/, severity: "high", confidence: "high", title: "Slack Token" },
  {
    ruleId: "secret.assigned",
    re: /(?:api[_-]?key|secret|token|password|passwd|access[_-]?key)\s*[:=]\s*["'`][^"'`\s]{12,}["'`]/i,
    severity: "high",
    confidence: "medium",
    title: "赋值式凭据",
  },
];

/** Shannon 熵（bits/char）。 */
export function shannonEntropy(s: string): number {
  const freq = new Map<string, number>();
  for (const ch of s) freq.set(ch, (freq.get(ch) ?? 0) + 1);
  let h = 0;
  for (const n of freq.values()) {
    const p = n / s.length;
    h -= p * Math.log2(p);
  }
  return h;
}

/** 高熵密钥串参数（可配；熵检查可单独关闭——反向验证用）。 */
export interface EntropyOptions {
  enabled: boolean;
  minLength: number;
  threshold: number;
}
export const DEFAULT_ENTROPY: EntropyOptions = { enabled: true, minLength: 24, threshold: 4.0 };

/** 候选字符集刻意不含 `=`：那是赋值语法、不是值的一部分。旧写法把 `KEY=<高熵>` 整串当候选，
 *  而 mask() 只留前 4 字符 ⇒ 连键名一起吃掉（实测 `scratch=/var/folders/…` 落成 `scra****`）。
 *  base64 尾部 padding 单独放行（`=` 不会出现在串中间）。 */
const ENTROPY_TOKEN_RE = /[A-Za-z0-9+/_-]{16,}={0,2}/g;

/** 路径否决：字符集含 `/`，一条绝对路径会整段成为候选（实测 macOS tmpdir → `/var****`、
 *  session uuid 目录 → `/Users/ze/.agen****.jsonl`）。以 `/` 开头的候选按路径放过。
 *  代价写明：以 `/` 开头的 base64 串（首字符命中率 ≈1/64）不再由熵分支覆盖；
 *  已知模式分支（私钥块 / sk- / AIza / AKIA / ghp_ / xox / 赋值式）与「串中含 `/`」的候选均不受影响。 */
function looksLikePath(token: string): boolean {
  return token.startsWith("/");
}

/** 高熵串探测：长度 ≥ minLength、熵 ≥ threshold、至少含一个字母与一个数字（降噪）。 */
export function findHighEntropyTokens(line: string, opts: EntropyOptions = DEFAULT_ENTROPY): { token: string; entropy: number }[] {
  if (!opts.enabled) return [];
  const out: { token: string; entropy: number }[] = [];
  for (const m of line.matchAll(ENTROPY_TOKEN_RE)) {
    const token = m[0];
    if (looksLikePath(token)) continue;
    if (token.length < opts.minLength) continue;
    if (!/[A-Za-z]/.test(token) || !/[0-9]/.test(token)) continue;
    if (/^[A-Z][A-Z0-9_]*$/.test(token)) continue; // SCREAMING_SNAKE 常量（配置名等）不算密钥
    const entropy = shannonEntropy(token);
    if (entropy >= opts.threshold) out.push({ token, entropy });
  }
  return out;
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
function mask(secret: string): string {
  if (secret.length <= 4) return "****";
  return secret.slice(0, 4) + "****";
}

function lineFindings(path: string, line: string, lineNo: number, entropy: EntropyOptions): SecurityFinding[] {
  const out: SecurityFinding[] = [];
  for (const p of SECRET_PATTERNS) {
    const m = p.re.exec(line);
    if (m) {
      out.push({
        ruleId: p.ruleId,
        category: "secret",
        severity: p.severity,
        path,
        line: lineNo,
        title: p.title,
        description: "第 " + String(lineNo) + " 行命中已知密钥模式（" + mask(m[0]) + "）。",
        confidence: p.confidence,
      });
    }
  }
  for (const t of findHighEntropyTokens(line, entropy)) {
    out.push({
      ruleId: "secret.high_entropy",
      category: "secret",
      severity: "high",
      path,
      line: lineNo,
      title: "高熵密钥串",
      description: "第 " + String(lineNo) + " 行出现高熵串（熵 " + t.entropy.toFixed(2) + " bits/char，长度 " + String(t.token.length) + "），疑似硬编码密钥（" + mask(t.token) + "）。",
      confidence: "medium",
    });
  }
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

export interface ScanOptions {
  entropy?: Partial<EntropyOptions>;
}

/** 静态快筛：变更集 → findings（严格 schema，非法条目直接丢弃并告警）。 */
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

// ---- 输出扫描（进事件流 / 进主上下文前的脱敏）----

export interface RedactResult {
  text: string;
  findings: SecurityFinding[];
  /** true = 命中 critical（如私钥块）：调用方应拒绝而非仅脱敏。 */
  blocked: boolean;
}

/** 输出扫描：把文本里的密钥按模式 + 高熵掩码；返回脱敏文本与命中清单。 */
export function redactSecrets(text: string, opts: ScanOptions = {}): RedactResult {
  const entropy: EntropyOptions = { ...DEFAULT_ENTROPY, ...(opts.entropy ?? {}) };
  const findings: SecurityFinding[] = [];
  let out = text;
  const lines = text.split("\n");
  lines.forEach((line, i) => {
    const hits = lineFindings("<output>", line, i + 1, entropy).filter((f) => f.category === "secret");
    for (const f of hits) {
      findings.push(f);
      // 用掩码替换原文中的密钥字面量（按规则重新定位，避免描述串误替换）
      // 必须**全局**匹配：旧实现只取 `p.re.exec(line)` 的首个匹配，
      // 同一行出现两个同模式密钥时第二个原样留在文本里 → 明文外泄（M0 复盘 E-2）。
      for (const p of SECRET_PATTERNS) {
        const re = new RegExp(p.re.source, p.re.flags.includes("g") ? p.re.flags : p.re.flags + "g");
        for (const m of line.matchAll(re)) {
          const secret = m[0];
          if (secret === "") continue; // 空匹配会让 split("") 把整串拆散
          out = out.split(secret).join(mask(secret));
        }
      }
      for (const t of findHighEntropyTokens(line, entropy)) {
        out = out.split(t.token).join(mask(t.token));
      }
    }
  });
  const blocked = findings.some((f) => f.severity === "critical");
  return { text: out, findings, blocked };
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
