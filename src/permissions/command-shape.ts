// 一条命令「真正执行的是哪个二进制」的解析——全仓**一份**。
//
// 起因（2026-09-21 探针 `scripts/probe-shell-bypass.ts`，实测红 24 / 绿 9，未修期间必红）：
// worker 的 git 闸早已按有效二进制判定（`worker-shell-tools.ts` 的 H2 段注释），
// 而权限规则层 `rules.ts:matchSegment` 至今是 `segment.startsWith(pattern)` 裸文本前缀
// ⇒ 用户手写的 `deny "git push --force"` 被 `/usr/bin/git`、`env FOO=1`、`nohup`、`timeout 30`、
// `command`、`bash -c '…'`、`GIT_PAGER=cat` 六类写法静默击穿。同一条解析写两份、只硬化一支，
// 就是本仓第七族「同族接缝副本」的成因——所以两支都改吃这里这一份。
//
// 本模块**只取值、不裁决**：谁吃这些形态、`allow` 走不走包装器，由调用方各自的语义决定
// （规则层刻意只让 deny/ask 吃派生形态，allow 仍只认原形——见 rules.ts 的接线注释）。
//
// 分工：链式分隔（`&&`、`||`、`;`、`|`、`&`、换行）由调用方先切段，本模块按段工作；
// 唯一的例外是 `shell -c '<载荷>'`——载荷在自己内部再按同一套分隔符切，然后递归下来。

/** exec 提升 / 包装类：跳过它们才看得见真正跑的东西。
 *  `time` 只加测量不改执行、`xargs` 把余下 token 当命令跑（stdin 是它的参数）——
 *  09-22 按位置扫写法时两支都漏（`time git push --force`、`xargs git push --force`）。 */
export const EXEC_WRAPPERS: ReadonlySet<string> = new Set([
  "command", "env", "exec", "nice", "nohup", "sudo", "timeout", "time", "xargs",
]);
/** 把**余下全部参数**当脚本文本执行的壳（与 `bash -c` 的区别是没有 `-c`，载荷就是剩下的 token）。
 *  不滤掉以 `-` 开头的 token：`eval git push --force` 的 `--force` 是载荷的一部分，滤了就自己把判据削短。 */
const SCRIPT_WRAPPERS: ReadonlySet<string> = new Set(["eval"]);
/** 吃 `-c` 载荷的 shell：载荷要按同一套规则再判一遍（递归有界）。 */
export const SHELL_INVOKERS: ReadonlySet<string> = new Set(["bash", "sh", "zsh", "dash", "ksh"]);

/** 带值的选项：跳过选项本身还得**连值一起吞**，否则值会被当成二进制
 *  （`sudo -u root git …` 的 `root`、`timeout -k 5 git …` 的 `5`）。
 *  按包装器分列、宁窄勿宽：没登记的选项不当作带值，最坏结果是少跳一步、多产一支候选形态。 */
const VALUE_OPTS: Readonly<Record<string, ReadonlySet<string>>> = {
  command: new Set(["-v", "-V"]),
  env: new Set(["-u", "--unset", "-C", "--chdir", "-S", "--split-string", "-t", "--traverse-vars"]),
  exec: new Set(["-a", "-d"]),
  nice: new Set(["-n", "--adjustment"]),
  sudo: new Set(["-u", "-g", "-h", "-p", "-r", "-t", "-C", "-D", "-T"]),
  timeout: new Set(["-k", "--kill-after", "-s", "--signal", "-p", "--preserve-status", "-v", "--verbose"]),
  // `-p` 在 bash/GNU time 里都是**布尔**开关（POSIX 格式），不是带值选项：
  // 误登记成带值会把后面的二进制当值吞掉（`time -p git push --force` 实测连 worker 闸一起放行）。
  time: new Set(["-o", "--output", "-f", "--format", "--append", "-v", "--verbose"]),
  xargs: new Set(["-I", "-n", "-P", "-s", "-E", "-e", "-d", "-L", "--max-lines", "--max-args", "--open-tty", "--delimiter", "--replace"]),
};
/** 这些包装器在选项之外还吃一个位置值（`timeout 30 git …` 的时长、`nice 5 git …` 的偏移）。 */
const POSITIONAL_VALUE: ReadonlySet<string> = new Set(["nice", "timeout"]);
const ASSIGN_RE = /^[A-Za-z_][A-Za-z0-9_]*=/;
const DURATION_RE = /^\d+(?:\.\d+)?[smhd]?$|^\d+:\d+(?::\d+(?:[.,]\d+)?)?$/;
const MAX_PAYLOAD_DEPTH = 3; // 载荷递归上限：越界只少跳一层（少判一次），绝不无限展开

export interface Invocation {
  /** 有效二进制名（已取路径基名：`/usr/bin/git` → `git`）。 */
  bin: string;
  args: string[];
}

/** 引号感知分词：单引号内逐字，双引号内放行 `\" \\ \$ \``，反斜杠转义照 shell 语义吃掉。 */
export function tokenize(text: string): string[] {
  const out: string[] = [];
  let cur = "";
  let has = false;
  let quote: "'" | '"' | null = null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quote === "'") {
      if (ch === "'") quote = null;
      else cur += ch;
      continue;
    }
    if (quote === '"') {
      if (ch === '"') { quote = null; continue; }
      if (ch === "\\" && i + 1 < text.length) {
        const nxt = text[i + 1]!;
        if (nxt === '"' || nxt === "\\" || nxt === "$" || nxt === "`") { cur += nxt; i++; continue; }
      }
      cur += ch;
      continue;
    }
    if (ch === "\\") {
      if (i + 1 < text.length) { cur += text[i + 1]!; i++; has = true; }
      else has = true;
      continue;
    }
    if (ch === "'" || ch === '"') { quote = ch; has = true; continue; }
    if (/\s/.test(ch)) {
      if (has) { out.push(cur); cur = ""; has = false; }
      continue;
    }
    cur += ch;
    has = true;
  }
  if (has) out.push(cur);
  return out;
}

/** 载荷内的链式切分：与外层同一套分隔符，但按引号状态判定（载荷里的 `;` 在引号内不算分隔）。 */
function splitPayload(text: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quote: "'" | '"' | null = null;
  const flush = () => { if (cur.trim() !== "") out.push(cur.trim()); cur = ""; };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quote) {
      if (ch === quote) quote = null;
      cur += ch;
      continue;
    }
    if (ch === "'" || ch === '"') { quote = ch; cur += ch; continue; }
    const two = text.slice(i, i + 2);
    if (two === "&&" || two === "||") { flush(); i++; continue; }
    if (ch === ";" || ch === "|" || ch === "&" || ch === "\n" || ch === "\r") { flush(); continue; }
    cur += ch;
  }
  flush();
  return out;
}

function baseName(tok: string): string {
  const i = tok.lastIndexOf("/");
  return i < 0 ? tok : tok.slice(i + 1);
}

/** 跳完前导包装器链后，命令**可能**开始的 token 下标集合（含 0＝原形）。
 *  刻意返回集合：中途每吃完一个包装器都是一个候选起点，`timeout 30 git …` 的中间态
 *  （从 `30` 起）也在里面——多一支候选只会多问一次，不会少问。 */
function startOffsets(tokens: string[]): number[] {
  const starts: number[] = [0];
  const seen = new Set<number>([0]);
  const add = (n: number) => { if (!seen.has(n)) { seen.add(n); starts.push(n); } };
  let i = 0;
  for (;;) {
    while (i < tokens.length && ASSIGN_RE.test(tokens[i]!)) i++;
    add(i); // 前导赋值本身就是一段起点（`GIT_PAGER=cat git push` 的 git 在赋值之后）
    const tok = tokens[i] ?? "";
    if (tok === "") break;
    if (tok === "--") { i++; add(i); break; }
    if (!EXEC_WRAPPERS.has(baseName(tok))) break;
    const wrapper = baseName(tok);
    const vopts = VALUE_OPTS[wrapper] ?? new Set<string>();
    i++;
    let ateValue = false;
    while (i < tokens.length) {
      const t = tokens[i]!;
      if (t === "--") { i++; break; }
      if (ASSIGN_RE.test(t)) { i++; continue; }
      if (t.startsWith("-")) {
        const flag = t.split("=")[0]!;
        i++;
        if (!t.includes("=") && vopts.has(flag)) { i++; ateValue = true; }
        continue;
      }
      if (POSITIONAL_VALUE.has(wrapper) && !ateValue && DURATION_RE.test(t)) { i++; ateValue = true; continue; }
      break;
    }
    add(i);
    if (i >= tokens.length) break;
  }
  return starts;
}

/** `bash -c '<载荷>'` / `sh -lc '<载荷>'` 的载荷取料（取 `-c` 之后的那个 token；
 *  合并写法 `-lc` 也算，此时后一个 token 就是载荷——`sh -lc 'cmd' name` 的 `name` 是 argv[0]）。 */
function payloadOf(bin: string, args: string[]): string | null {
  if (SCRIPT_WRAPPERS.has(bin)) return args.join(" "); // `eval git push --force`：余下的就是脚本
  if (!SHELL_INVOKERS.has(bin)) return null;
  for (let k = 0; k < args.length; k++) {
    const a = args[k]!;
    if (a === "-c" || /^-[A-Za-z]*c[A-Za-z]*$/.test(a)) return args[k + 1] ?? null;
  }
  return null;
}

/** 一段命令文本里所有「可能被真正执行」的调用点：跳过环境赋值与 exec 包装器，
 *  有效二进制取路径基名，`shell -c` 载荷递归展开（深度上限 MAX_PAYLOAD_DEPTH）。 */
export function invocations(text: string, depth = 0): Invocation[] {
  const tokens = tokenize(text);
  const out: Invocation[] = [];
  const seen = new Set<string>();
  const push = (inv: Invocation) => {
    const key = inv.bin + "\u0000" + inv.args.join(" ");
    if (seen.has(key) || inv.bin === "") return;
    seen.add(key);
    out.push(inv);
  };
  for (const at of startOffsets(tokens)) {
    const rest = tokens.slice(at);
    if (rest.length === 0) continue;
    const inv: Invocation = { bin: baseName(rest[0]!), args: rest.slice(1) };
    push(inv);
    if (depth >= MAX_PAYLOAD_DEPTH) continue;
    const payload = payloadOf(inv.bin, inv.args);
    if (payload === null) continue;
    for (const seg of splitPayload(payload)) {
      for (const inner of invocations(seg, depth + 1)) push(inner);
    }
  }
  return out;
}

/** 下游选项归一（09-22）：`git -C /tmp push --force`、`git --no-pager push --force` 这类
 *  **二进制与子命令之间**插了全局选项的写法，会把前缀匹配整个瞎掉——① 那族包装器在上游，
 *  `invocations` 会剥；这一族在下游，得从每个非选项参数位置各起一支后缀形态。
 *  只加在 deny/ask 侧（allow 只吃原形），所以放宽的方向只有一个：更容易命中「被禁的事」。
 *  代价按方向说清：可能过覆盖（`git log --format=%h push` 会出一支 `git push`），
 *  过覆盖的代价是多一张卡，静默漏过的代价是用户手写的 deny 白写。 */
function suffixForms(inv: Invocation): string[] {
  const out: string[] = [];
  // 只对「真命令」那一支生成：包装器自己那支的参数是「被剥掉的前缀 + 真命令」，
  // 从它起后缀会产出 `sudo root git status` / `sudo git status` 这类假形——
  // 多余候选的代价是审批卡变多（tests/command-shape.test.ts 里那支负控钉着）。
  if (EXEC_WRAPPERS.has(inv.bin)) return out;
  for (let i = 1; i < inv.args.length; i++) {
    if (inv.args[i]!.startsWith("-")) continue; // 选项本身不能当子命令起点
    out.push([inv.bin, ...inv.args.slice(i)].join(" ").replace(/\s+/g, " ").trim());
  }
  return out;
}

/** 规则匹配用的形态集：原形（逐字，调用方已归一空白）+ 每个调用点的 `bin args…`。
 *  deny/ask 逐形取最长命中；allow 只吃原形——包装器恰恰是「被禁的事」藏身的地方，
 *  而「用户点过一次总是允许」那次的同意不该顺着 `env`/`timeout` 一起放宽。 */
export function commandForms(normalizedSegment: string): string[] {
  const out: string[] = [normalizedSegment];
  const seen = new Set<string>([normalizedSegment]);
  for (const inv of invocations(normalizedSegment)) {
    for (const form of [[inv.bin, ...inv.args].join(" "), ...suffixForms(inv)]) {
      const flat = form.replace(/\s+/g, " ").trim();
      if (flat === "" || seen.has(flat)) continue;
      seen.add(flat);
      out.push(flat);
    }
  }
  return out;
}
