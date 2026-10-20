// 落盘/出站面的**脱敏**（2026-10-19 从 src/agent/security/scan.ts 提取到这里）。
//
//  **为什么搬到 events 这一层**：脱敏是**持久化边界**的职责——"密钥不进主转录 JSONL"这句话
//  说的是**日志**，不是 loop。所以它归 `src/events/log.ts`（存储引擎）自己管：
//  凡是往日志里 append 的事件，**由日志自己擦**，落盘那一侧不可能"忘了擦"。
//  旧形状把脱敏藏在 loop 的 `events.append` 里（消费者拿到的是已脱敏的事件）——两处代价：
//   ① 任何一个**新写的出口**（不经过 loop 的 append）都可能把明文写进盘，而没有一处会报错；
//   ② **安全扫描面失明**：`collectChangeSet` 从事件里取 `args.content` / `args.new_string`
//      去扫密钥，而那些串早就被掩成了 `AKIA****` ⇒ `secret.*` 规则一条都不命中
//      ⇒ 写进 `src/creds.ts` 的 `AKIA…` 在 security_report 里报 total=0（**一道静默空转的闸**）。
//  搬到这里之后：内存流是**原件**（扫描面要真内容），**落盘/出站的那一份**是脱敏副本。
//
//  这一层不依赖 events 的运行时面（只有 `SecurityFinding` 等类型是 type-only 引入）⇒ 无循环依赖。
import type { SecurityConfidence, SecurityFinding, SecuritySeverity } from "./types";

// ---- 密钥扫描 ----

/** 已知密钥模式表（顺序即优先级；ruleId 稳定可审计）。 */
export const SECRET_PATTERNS: readonly {
  ruleId: string;
  re: RegExp;
  severity: SecuritySeverity;
  confidence: SecurityConfidence;
  title: string;
  /** 命中物是**公开标记**（不是凭据本身）⇒ 只报不掩。
   *  典型：私钥块的 `-----BEGIN … PRIVATE KEY-----` 行——秘密是中间的 base64 体，
   *  那两行是常量。把它抹掉有三重坏处：① 掩了个不是秘密的东西；
   *  ② **下游再也认不出"这里曾经是私钥块"**（sidechat 的提升面要靠它 fail-closed 地
   *  拒掉整条提升，见 sidechat.ts 的 promote）——一道闸静默失效；
   *  ③ 抹掉标记看着像"没处理过"，与"已处理"分不开（半掩比不掩更坏）。 */
  publicMarker?: boolean;
}[] = [
  // 私钥块：命中物是 `-----BEGIN … PRIVATE KEY-----` 那行——**公开常量**，不是凭据
  // （秘密是中间的 base64 体，由熵分支掩掉）。所以这条**只报不掩**（`publicMarker`）：
  // 抹掉标记有三重坏处——① 掩了个不是秘密的东西；② **下游再也认不出"这里曾经是私钥块"**
  //  （sidechat 的提升面要靠它 fail-closed 地拒掉整条提升，见 sidechat.ts 的 promote）
  //  ⇒ 一道闸静默失效；③ 抹掉标记看着像"没处理过"，与"已处理"分不开（半掩比不掩更坏）。
  { ruleId: "secret.private_key", re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/, severity: "critical", confidence: "high", title: "私钥块", publicMarker: true },
  // **必须排在 secret.assigned 之前**（表头注释"顺序即优先级"的字面含义）：
  // 脱敏是按表序逐条做 `out.split(secret).join(mask(secret))` 的。若 assigned 先跑，
  // 它会把 `PASSWORD=postgres://…` 的 `postgres:` 那一段掩成 `post****`，本条的整串匹配
  // 于是**在已改过的文本上再也找不到** ⇒ 只剩半掩，`//` 之后的真密码原样留下。
  // 实测过这个顺序：放后面时输出 `PASSWORD=post****`，放前面时整条掩掉。
  // 两条独立实测漏检（2026-10-19）：
  //   ① `DATABASE_URL=postgres://user:pass@host/db` —— 键名 url/uri/dsn 不在 assigned 的
  //      alternation 里，而值的 charset 又不含 `/` `:` ⇒ 整条零命中，明文落盘。
  //   ② `PASSWORD=postgres://user:pass@host/db` —— assigned **会**命中但只掩到第一个 `/`。
  //      半掩比不掩更坏：它给出"已经脱敏过了"的假象。所以这条整条掩，不猜哪段不要掩。
  // 连接串凭据（2026-10-19 补，两条独立实测漏检）：
  //   ① `DATABASE_URL=postgres://user:pass@host:5432/db` —— 键名 url/uri/dsn 不在上面那条的
  //       alternation 里，而值的 charset 又不含 `/` `:` ⇒ 整条零命中，明文落盘。
  //   ② `PASSWORD=postgres://user:pass@host/db` —— 上面那条**会命中**，但只掩到第一个 `/`
  //       （`post****`），`//` 之后真正的密码原样留在文本里。半掩比不掩更坏：它给出
  //       "已经脱敏过了"的假象。所以这条必须**整条**掩，不能只掩片段。
  // 掩整个 URI（含 scheme 与路径）：连接串里每一段都可能是凭据，猜"哪一段不要掩"就是在猜。
  {
    ruleId: "secret.connection_string",
    re: /\b(?:postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|redis|rediss|amqp|mssql|jdbc:[a-z0-9]+):\/\/[^\s"'`]{4,}@[^\s"'`]+/gi,
    severity: "high",
    confidence: "medium",
    title: "连接串内嵌凭据",
  },
  { ruleId: "secret.openai", re: /\bsk-[A-Za-z0-9_-]{16,}/, severity: "high", confidence: "high", title: "OpenAI 风格密钥" },
  { ruleId: "secret.google", re: /\bAIza[0-9A-Za-z_-]{20,}/, severity: "high", confidence: "high", title: "Google API 密钥" },
  { ruleId: "secret.aws", re: /\bAKIA[0-9A-Z]{16}\b/, severity: "high", confidence: "high", title: "AWS Access Key ID" },
  { ruleId: "secret.github", re: /\bghp_[A-Za-z0-9]{20,}/, severity: "high", confidence: "high", title: "GitHub Token" },
  { ruleId: "secret.slack", re: /\bxox[baprs]-[A-Za-z0-9-]{10,}/, severity: "high", confidence: "high", title: "Slack Token" },
  // 值自带括号的赋值式凭据：`ADMIN_PASSWORD=Tr0ub4dor&3(x)99` 这类真实密码若被上面那条
  // （`secret.assigned`）先命中，会被截到 `Tr0ub4dor&3`（11 字，够不到 {12,}）⇒ 漏检；
  // 而头部长到 ≥12 字时它**会**命中、只掩住头 ⇒ 尾巴（`(staple)123` 那一段）原样留在明文里。
  // **半掩比不掩更坏**（它给出"已经脱敏过了"的假象）——所以这条必须排在 `secret.assigned`
  // **之前**：掩码是按顺序做的（`out.split(secret).join(mask(secret))`），先到的那条把整串
  // 换掉之后，后到的那条就再也匹配不到完整串了（尾巴因此幸存）。同 `secret.connection_string`
  // 排在 `secret.assigned` 之前的那条补丁。
  // 这条允许括号，但仍排除引号/空白/`$ { } < > , ;`（不引变量引用、不吃后半个 YAML 行）。
  {
    ruleId: "secret.assigned_bracketed",
    re: /(?:api[_-]?key|secret|token|password|passwd|access[_-]?key)\s*[:=]\s*["'`]?([^\s"'`,;{}<>$][^\s"'`,;{}<>$]{11,}|[^\s"'`,;{}<>$]{12,})["'`]?/i,
    severity: "high",
    confidence: "medium",
    title: "赋值式凭据（值含括号）",
  },

  {
    ruleId: "secret.assigned",
    // 引号可有可无：`.env`、`docker run -e`、shell 与 YAML 里最常见的凭据写法是**无引号**的，
    // 旧写法强制引号 ⇒ 等于宣布 `API_KEY=bf9ccaa2…` 不是凭据（实测漏检）。
    // 捕获组 1 = 真正要掩的值（掩值不吃键名）。值里排除 `$ { } ( ) < > , ;` 与引号空白 ⇒
    // 变量引用（DB_TOKEN=${VAULT_TOKEN}）、空值、短值都不算；`token_count:` 这类"键不是整词"
    // 也进不来（token 后面还有 _count，[:=] 接不上）。
    // ⚠️ `( )` 在排除集里 ⇒ 值自带括号的密码（`Tr0ub4dor&3(x)99`）会被截到 12 字以下而漏检；
    //   见 `secret.connection_string` 与 `secret.assigned_bracketed` 两条补丁。
    re: /(?:api[_-]?key|secret|token|password|passwd|access[_-]?key)\s*[:=]\s*["'`]?([^\s"'`,;{}()<>$]{12,})["'`]?/i,
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
  /** 路径形状候选里，**单段**要多长才算"这可能是个随机值"（见下面分段判据）。 */
  minSegmentLength: number;
}
export const DEFAULT_ENTROPY: EntropyOptions = { enabled: true, minLength: 24, threshold: 4.0, minSegmentLength: 12 };

/** 候选字符集刻意不含 `=`：那是赋值语法、不是值的一部分。旧写法把 `KEY=<高熵>` 整串当候选，
 *  而 mask() 只留前 4 字符 ⇒ 连键名一起吃掉（实测 `scratch=/var/folders/…` 落成 `scra****`）。
 *  base64 尾部 padding 单独放行（`=` 不会出现在串中间）。 */
const ENTROPY_TOKEN_RE = /[A-Za-z0-9+/_-]{16,}={0,2}/g;

/** 路径否决：字符集含 `/`，一条绝对路径会整段成为候选（实测 macOS tmpdir → `/var****`、
 *  session uuid 目录 → `/Users/ze/.agen****.jsonl`）。以 `/` 开头的候选按路径放过。
 *  代价写明：以 `/` 开头的 base64 串（首字符命中率 ≈1/64）不再由熵分支覆盖；
 *  已知模式分支（私钥块 / sk- / AIza / AKIA / ghp_ / xox / 赋值式）与「串中含 `/`」的候选均不受影响。 */
const HEX_ONLY = /^[0-9a-f]{24,}$/;

/** 真实 provider 的工具/消息 id（Anthropic `toolu_01…`、OpenAI `call_…`/`chatcmpl-…` 等）。
 *  它们是**关联键**而不是凭据：一旦被熵分支掩成同一个 `tool****`，同一会话里所有
 *  tool_call/tool_result 的 id 塌成一个值 ⇒ 上下文重建时结果按 id 合并、快照路径撞名、
 *  文件回滚找不到快照（2026-10-19 实测：200/200 个 Anthropic 形状 id 全变成 `tool****`）。
 *  只豁免「前缀 + 标识符字符」的整串，key 里出现的 `sk-…` 等已知密钥形态不受影响。 */
const PROVIDER_ID_TOKEN = /^(?:toolu|tool|call|msg|chatcmpl|resp|run|fc|file|asst|item)[_-][A-Za-z0-9_-]{8,}$/;

function looksLikePath(token: string): boolean {
  return token.startsWith("/");
}

/** 高熵串探测：长度 ≥ minLength、熵 ≥ threshold、至少含一个字母与一个数字（降噪）。
 *
 *  含 `/` 的候选**按段判**，整串熵不作数。理由（实测，不是审美）：
 *  工作区相对路径是这个 agent 输出里最高频的 token，而 `dated 目录 / 随机段 / 文件名`
 *  拼起来之后整串熵轻松过 4.0 ⇒ 旧写法把 `outputs/ga-strategy-2026-09-23/measure`
 *  掩成 `outp****`、把 `src/config/<随机>` 连目录一起吃掉。模型拿不到路径 = 只能重跑命令或猜文件名
 *  （返工 + 白花 token），而这正是一条**安全判据在静默制造不可用**。
 *  代价写明（两侧都有钉住的用例）：
 *  - 收紧：整串高熵但每一段都不够格的候选不再算密钥（如 `abcd1234/efgh5678/ijkl9012`）；
 *  - 保留：任意一段自身是高熵随机串 ⇒ 只掩那一段，路径其余部分逐字可读。
 *  绝对路径另有 `looksLikePath` 那道否决（首字符是 `/` 的 base64 因此不由本分支覆盖，已钉为口子）。 */
export function findHighEntropyTokens(
  line: string,
  opts: EntropyOptions = DEFAULT_ENTROPY,
): { token: string; secret: string; entropy: number }[] {
  if (!opts.enabled) return [];
  const out: { token: string; secret: string; entropy: number }[] = [];
  for (const m of line.matchAll(ENTROPY_TOKEN_RE)) {
    const token = m[0];
    if (looksLikePath(token)) continue;
    // provider 关联 id 不是凭据：掩掉会把整个 id 空间塌成一个常量（见 PROVIDER_ID_TOKEN）。
    if (PROVIDER_ID_TOKEN.test(token)) continue;
    // 小写纯 hex 一律不由熵分支判（实测取料：本仓一次 `git ls-tree -r HEAD` 809 行里 3 行的
    // blob id 今天就被改写过，全量 git 样本 3727 条 naked 长 hex 中**凭据形状 0 条**）。
    // 机制：40 位 hex 的香农熵上界是 log2(16)=4.0 ⇒ 随机 SHA 一半会**撞过** threshold。
    // 凭据那一半不让它漏：hex 值靠**键名上下文**命中（secret.assigned，含无引号式）；
    // 混合/大写 hex 形状不在本否决内，仍走熵分支。
    if (HEX_ONLY.test(token)) continue;
    if (token.length < opts.minLength) continue;
    if (!/[A-Za-z]/.test(token) || !/[0-9]/.test(token)) continue;
    if (/^[A-Z][A-Z0-9_]*$/.test(token)) continue; // SCREAMING_SNAKE 常量（配置名等）不算密钥
    // 带分隔符（`/` 或 `-`）的候选**按段判**：路径、带日期的文件名、`sha512-<digest>` 这类
    // "多段可读标识符拼起来"的东西，聚合熵轻松过 4.0（实测：`2026-09-18-r1b-renderer-subtraction-design`
    // 4.062、`sha512-9f2b…` 4.129 ⇒ 一个文件名、一条校验和当密钥被吃掉）。
    // 只有某段自身够格才算密钥，且 secret 就是那一段 ⇒ 掩它、其余逐字留下。
    if (token.includes("/") || token.includes("-")) {
      let hot: { secret: string; entropy: number } | null = null;
      for (const seg of token.split(/[/-]/)) {
        if (seg.length < opts.minSegmentLength) continue;
        if (HEX_ONLY.test(seg)) continue; // 校验和/对象 id 段：基数太大，不作凭据证据
        if (!/[A-Za-z]/.test(seg) || !/[0-9]/.test(seg)) continue;
        if (/^[A-Z][A-Z0-9_]*$/.test(seg)) continue;
        const e = shannonEntropy(seg);
        if (e >= opts.threshold && (hot === null || e > hot.entropy)) hot = { secret: seg, entropy: e };
      }
      if (hot === null) continue; // 只是几段可读名字拼起来的路径 / 文件名 / 带算法前缀的校验和
      out.push({ token, secret: hot.secret, entropy: hot.entropy });
      continue;
    }
    const entropy = shannonEntropy(token);
    if (entropy >= opts.threshold) out.push({ token, secret: token, entropy });
  }
  return out;
}

function mask(secret: string): string {
  if (secret.length <= 4) return "****";
  return secret.slice(0, 4) + "****";
}

/** 一行里的**密钥**发现（脱敏面用；危险 API 那半留在 agent/security/scan.ts——
 *  那一半是"审阅面"的事，不参与脱敏，两件事不该挤在一个函数里）。
 *  脱敏只需要密钥这一半：掩码按这张表的规则逐条做。 */
export function secretFindings(path: string, line: string, lineNo: number, entropy: EntropyOptions): SecurityFinding[] {
  const out: SecurityFinding[] = [];
  for (const p of SECRET_PATTERNS) {
    const m = line.match(p.re);
    if (m) {
      out.push({
        ruleId: p.ruleId,
        category: "secret",
        severity: p.severity,
        path,
        line: lineNo,
        title: p.title,
        // 表里带捕获组的规则 = 「组 1 是值」⇒ 只掩值；无组的规则整段就是密钥本身。
        // publicMarker 规则的命中物是公开常量 ⇒ 描述里照原文写（掩成 "----****" 看不出是什么）。
        description: "第 " + String(lineNo) + " 行命中已知密钥模式（" + (p.publicMarker === true ? (m[1] ?? m[0]) : mask(m[1] ?? m[0])) + "）。",
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
      description: "第 " + String(lineNo) + " 行出现高熵串（熵 " + t.entropy.toFixed(2) + " bits/char，长度 " + String(t.secret.length) + "），疑似硬编码密钥（" + mask(t.secret) + "）。",
      confidence: "medium",
    });
  }
  return out;
}

export interface ScanOptions {
  entropy?: Partial<EntropyOptions>;
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
    const hits = secretFindings("<output>", line, i + 1, entropy);
    for (const f of hits) {
      findings.push(f);
      // 用掩码替换原文中的密钥字面量（按规则重新定位，避免描述串误替换）
      // 必须**全局**匹配：旧实现只取每行首个匹配，
      // 同一行出现两个同模式密钥时第二个原样留在文本里 → 明文外泄（M0 复盘 E-2）。
      for (const p of SECRET_PATTERNS) {
        const re = new RegExp(p.re.source, p.re.flags.includes("g") ? p.re.flags : p.re.flags + "g");
        for (const m of line.matchAll(re)) {
          // 命中物是公开标记的规则**只报不掩**（见 SECRET_PATTERNS 的 publicMarker 说明）：
          // 秘密在别处（私钥的 base64 体），抹标记只会让下游认不出"这里曾经是私钥块"
          // （sidechat 的提升面要靠它 fail-closed 地拒掉整条提升）。
          if (p.publicMarker === true) continue;
          const secret = m[1] ?? m[0]; // 有捕获组的规则只掩值，键名与引号逐字留下
          if (secret === "") continue; // 空匹配会让 split("") 把整串拆散
          out = out.split(secret).join(mask(secret));
        }
      }
      for (const t of findHighEntropyTokens(line, entropy)) {
        // 掩 secret（含 `/` 的候选里那一段真高熵的），不掩整个 token ⇒ 目录与文件名逐字留着
        out = out.split(t.secret).join(mask(t.secret));
      }
    }
  });
  const blocked = findings.some((f) => f.severity === "critical");
  return { text: out, findings, blocked };
}

/** 事件级脱敏：字符串叶子逐段过 `redactSecrets`，结构保持不变（非普通对象原样返回、
 *  循环引用打成显式占位）。落盘与出站共用这一份。 */
function redactValue(v: unknown, seen: WeakSet<object> = new WeakSet()): unknown {
  if (typeof v === "string") return redactSecrets(v).text;
  if (Array.isArray(v)) {
    if (seen.has(v)) return "[循环引用]";
    seen.add(v);
    const out = v.map((inner) => redactValue(inner, seen));
    seen.delete(v);
    return out;
  }
  if (typeof v === "object" && v !== null) {
    // 只对**普通对象**逐键递归；Map/Set/Date/类实例原样返回（口径②：结构不变的适用域——
    // `Object.entries` 会把 Date 拍成 {}，那已经改了结构，与"非字符串值原样返回"相反）。
    const proto = Object.getPrototypeOf(v) as object | null;
    const plain = proto === null || proto === Object.prototype;
    if (!plain) return v;
    if (seen.has(v)) return "[循环引用]";
    seen.add(v);
    const out: Record<string, unknown> = {};
    for (const [k, inner] of Object.entries(v as Record<string, unknown>)) out[k] = redactValue(inner, seen);
    seen.delete(v);
    return out;
  }
  return v;
}

/** 所有事件共用落盘/投影脱敏面：字符串叶子逐段过 `redactSecrets`，结构保持不变。
 *
 *  导出给落盘/出站两侧共用（`src/events/log.ts` 的 append、agent-runner / orchestrator / sidechat
 *  的推送面）：判据不许在两处各写一份——抄第二份就是给"这个出口忘了擦"留门。 */
export function redactEventForLog<T>(e: T): T {
  return redactValue(e) as T;
}
