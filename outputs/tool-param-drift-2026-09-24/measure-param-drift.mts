/** 工具「声明的参数」与「实现真读的字段」的双向对账（能力 32 的开页探针）。
 *
 *  为什么值得量：模型只看得见 schema，看不见代码。两个方向各有一类代价：
 *  - 声明了没人读 ⇒ 模型以为说了话，其实被静默丢掉（白花 token + 完成度虚高）；
 *  - 读了没声明 ⇒ 能力存在但模型无从发现（只能靠猜或靠提示词，等于没发货）。
 *
 *  ⚠️ 取料形状（两次假分母换来的，别再走第三遍）：
 *  ① 声明**不是** `parameters: { … }` 的字面量——`glm-session.ts` 走 `obj(props, required)` 这只局部helper，
 *     所以按"properties 字面量"切的正则会整个认不出顶层参数；这里 AST 认 CallExpression 的第一实参。
 *  ② 参数有嵌套（`clarify` 的 questions[].options[].label）⇒ 必须走 items/properties，
 *     按"名字后第一个 properties 块"切会把上一个工具的子字段算到下一个头上。
 *  ③ 读侧会**跨文件**：`write_file` 的 `then_run` / `verify` 不在 write_file.ts 里读，
 *     而在 action-fusion 那一侧消费。所以本探针把"本工具 run() 内读"与"src/ 别处按名读"
 *     分成两桶，绝不把后者冒充前者（假归因比没归因贵）。
 *  ④ **声明面问活面，不问源码形状**（2026-09-24 改）：`gateToolSpecs()` 就是模型这一趟真看得见的那张表，
 *     直接从 shipped 实现取「工具名 → 顶层参数」。AST 那份只做补充：表驱动生成的规格
 *     （`automation-surface.ts`）在源码形状上认不出归属，靠猜形状这一族会永远漏着（第 42 页 §四 1）。
 *     分母也换：旧写法拿"有 N 处 parameters 认不出归属"当分母不全的证据（代理读数），
 *     现在直接问"活面上的工具，探针有没有一行实现"（真读数）。
 *  ⑤ 两个量不了的格子各有**带理由的显式登记**：整包交接（`sink(args)`）与防御性读取（读它是为了拒）。
 *     两份登记都配一条"不再成立就出声"的反向断言，免得它们变成下一颗漂移磁铁。
 *
 *  复跑：TERM=dumb node --import tsx outputs/tool-param-drift-2026-09-24/measure-param-drift.mts
 */
import ts from "typescript";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { gateToolSpecs } from "../../src/agent/glm-session";

const ROOT = resolve(import.meta.dirname, "../..");
const SRC = join(ROOT, "src");

/** 活面：模型这一趟**真看得见**的那份工具表。声明面从这里取，而不是从源码形状猜——
 *  表驱动生成的规格（`automation-surface.ts` 由 AUTOMATION_TOOLS.map 出 properties）
 *  在 AST 上"认不出属于哪个工具"，靠猜形状只会永远漏着这一族（第 42 页 §四 1 点名的缺口）。 */
const LIVE_FACE = "活面";
export const liveFace = new Map<string, string[]>();
for (const s of gateToolSpecs()) {
  const props = (s.function.parameters as { properties?: Record<string, unknown> }).properties ?? {};
  liveFace.set(s.function.name, Object.keys(props).sort());
}
/** 在活面上、但**按设计**不由 `Tool` 对象实现的名字：显式名单 + 每条给理由（照 §二「防御性读取」同一口径，
 *  规则 57——"刻意不做"要有名字）。名单里任何一条不再成立 ⇒ 下面报「登记已过期」，不许静默留着。 */
const LIVE_NO_TOOL_OBJECT: Readonly<Record<string, string>> = {
  verify: "系统门：由 agent loop 直接驱动，不是一张 `Tool` 对象表（能力 32 §一 已裁）",
};

interface Declared {
  /** 顶层参数名（嵌套的另记路径）。 */
  top: Set<string>;
  /** 全部路径（含嵌套，形如 questions[].options[].label）。 */
  paths: Set<string>;
  required: Set<string>;
}
interface ReadSet {
  own: Set<string>; // 本工具 run(args) 体内读到的
  lines: Map<string, string[]>; // 参数名 → file:line 证据（src/ 全仓按名取）
}

const files: string[] = [];
function walk(dir: string): void {
  for (const ent of readdirSync(dir)) {
    const p = join(dir, ent);
    if (ent === "node_modules" || ent.startsWith(".")) continue;
    if (statSync(p).isDirectory()) walk(p);
    else if (p.endsWith(".ts") && !p.endsWith(".d.ts")) files.push(p);
  }
}
walk(SRC);

const parsed: string[] = [];
const unparsed: string[] = [];
/** 工具名 → 每份声明面（同一工具可能在多个面各写一份，漂移本身就是发现）。 */
const decls = new Map<string, Map<string, Declared>>();
/** 工具名 → run() 内读到的顶层参数名。 */
const ownReads = new Map<string, Set<string>>();
/** 全仓按名取到的 `args.X` / `x.args.X` / `args["X"]` / 解构。 */
const globalReads = new Map<string, string[]>();
/** 把入参袋整体交给下游的工具（`sink(args)` / `{ ...args }`）：逐字段按名对账对它不适用。 */
const bagTools = new Set<string>();

const strLit = (n: ts.Node): string | null =>
  ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) ? n.text : null;
const keyName = (p: ts.ObjectLiteralElementLike): string | null => {
  // 工具实现写的是 `async run(args, ctx) {…}`——MethodDeclaration 也得认得出键名，
  // 否则"本工具自读"这一列会整片空掉（第一版就是这么错的：16 个工具自读全空，看着像没人读参数）。
  const named = p as ts.NamedDeclaration;
  const n = named.name;
  if (n === undefined) return null;
  if (ts.isIdentifier(n)) return n.text;
  if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) return n.text;
  return null; // 计算名（[k]:）认不出 = 不猜，宁可少收一行
};
const at = (n: ts.Node): string => {
  const f = n.getSourceFile();
  const { line } = ts.getLineAndCharacterOfPosition(f, n.getStart());
  return relative(ROOT, f.fileName) + ":" + String(line + 1);
};
/** 入参对象在各工具里不叫同一个名字：`args` / `rawArgs`（remember）/ `x.args`。
 *  只认 `args` 会让整列"自读"空掉——第一版就是这样，随后把正常工具误报成"声明没人读"。 */
const isArgsReceiverName = (text: string): boolean => text === "args" || /Args$/.test(text);
const isArgsReceiver = (e: ts.Expression, name?: string): boolean =>
  ts.isIdentifier(e)
    ? name !== undefined
      ? e.text === name
      : isArgsReceiverName(e.text)
    : ts.isPropertyAccessExpression(e) && e.name.text === "args";

/** 收一份 JSON-schema 对象（或 obj(props, required) 调用）的顶层与嵌套参数名。 */
function schemaOf(init: ts.Expression | undefined, d: Declared, path: string): void {
  let node: ts.Expression | undefined = init;
  if (node && ts.isCallExpression(node)) {
    // 局部 helper：第一实参 = properties 映射，第二实参 = required 名单
    const props = node.arguments[0];
    const req = node.arguments[1];
    if (props && ts.isObjectLiteralExpression(props)) {
      for (const p of props.properties) {
        const k = keyName(p);
        if (k === null) continue;
        d.top.add(path === "" ? k : path + "." + k);
        if (ts.isPropertyAssignment(p)) schemaOf(p.initializer, d, path === "" ? k : path + "." + k);
      }
    } else if (props && ts.isIdentifier(props)) unparsed.push("helper 实参是标识符 " + props.text + "，未追");
    if (req && ts.isArrayLiteralExpression(req)) {
      for (const el of req.elements) { const s = strLit(el); if (s !== null) d.required.add(s); }
    }
    return;
  }
  if (!node || !ts.isObjectLiteralExpression(node)) { if (node) unparsed.push(at(node)); return; }
  const propsProp = node.properties.find((p) => keyName(p) === "properties");
  if (propsProp && ts.isPropertyAssignment(propsProp) && ts.isObjectLiteralExpression(propsProp.initializer)) {
    for (const p of propsProp.initializer.properties) {
      const k = keyName(p);
      if (k === null) continue;
      const full = path === "" ? k : path + "." + k;
      d.top.add(full);
      d.paths.add(full);
      if (ts.isPropertyAssignment(p)) schemaOf(p.initializer, d, full);
    }
  }
  const items = node.properties.find((p) => keyName(p) === "items");
  if (items && ts.isPropertyAssignment(items)) schemaOf(items.initializer, d, path + "[]");
  const reqProp = node.properties.find((p) => keyName(p) === "required");
  if (reqProp && ts.isPropertyAssignment(reqProp) && ts.isArrayLiteralExpression(reqProp.initializer)) {
    for (const el of reqProp.initializer.elements) { const s = strLit(el); if (s !== null && path === "") d.required.add(s); }
  }
}

/** 工具名常常不是字面量：`name: WAIT_FOR_AGENTS`（常量）、
 *  `name: mode === "write" ? "shell_rw" : "shell_ro"`（三元，一份声明面服务两个工具）。
 *  不认常量 ⇒ 真工具被误分类成"只有声明/无声明面"，从分母里静默消失。 */
const constStrings = new Map<string, string[]>();
function collectConsts(src: ts.SourceFile): void {
  // 只收**模块顶层**的 `const X = "字面量"`：函数内的 `const name = "/"` 这类局部同名，
  // 一旦被当成全局标识符→字符串表，就会把 6 份不相干声明算到工具 "/" 头上（第一版实测踩到）。
  for (const stmt of src.statements) {
    if (!ts.isVariableStatement(stmt)) continue;
    for (const d of stmt.declarationList.declarations) {
      if (!ts.isIdentifier(d.name) || !d.initializer) continue;
      const lits = literalStrings(d.initializer);
      if (lits.length > 0) constStrings.set(d.name.text, [...new Set([...(constStrings.get(d.name.text) ?? []), ...lits])]);
    }
  }
}
function literalStrings(e: ts.Expression): string[] {
  const out: string[] = [];
  const visit = (n: ts.Node): void => {
    const s = strLit(n);
    if (s !== null) out.push(s);
    ts.forEachChild(n, visit);
  };
  visit(e);
  return out;
}
function litNames(e: ts.Expression | undefined): string[] {
  if (!e) return [];
  if (ts.isIdentifier(e)) return constStrings.get(e.text) ?? [];
  return [...new Set(literalStrings(e))];
}

const unattributed: string[] = [];
function visitToolObject(obj: ts.ObjectLiteralExpression): void {
  const nameProp = obj.properties.find((p) => keyName(p) === "name");
  const paramsProp0 = obj.properties.find((p) => keyName(p) === "parameters");
  if (nameProp === undefined || !ts.isPropertyAssignment(nameProp)) {
    // 有 parameters 却没有可归属的工具名：这些声明面**不在下面任何结论的分母里**，
    // 必须单独计数——否则"未解析 0 处"会被读成"所有声明都解析了"（它只覆盖认得出名字的那些）。
    if (paramsProp0 !== undefined) unattributed.push(at(obj));
    return;
  }
  const toolNames = litNames(nameProp.initializer);
  if (toolNames.length === 0) {
    if (paramsProp0 !== undefined) unattributed.push(at(obj));
    return;
  }
  const paramsProp = obj.properties.find((p) => keyName(p) === "parameters");
  if (paramsProp && ts.isPropertyAssignment(paramsProp)) {
    const face = relative(ROOT, obj.getSourceFile().fileName);
    const d: Declared = { top: new Set(), paths: new Set(), required: new Set() };
    schemaOf(paramsProp.initializer, d, "");
    for (const toolName of toolNames) {
      if (!decls.has(toolName)) decls.set(toolName, new Map());
      decls.get(toolName)!.set(face, d);
    }
  }
  // run(args) / async run(args, ctx)：方法简写或 run: async (args) => …
  const runProp = obj.properties.find((p) => keyName(p) === "run");
  if (!runProp) return;
  const fn = ts.isMethodDeclaration(runProp)
    ? runProp
    : ts.isPropertyAssignment(runProp) && (ts.isArrowFunction(runProp.initializer) || ts.isFunctionExpression(runProp.initializer))
      ? runProp.initializer
      : null;
  if (!fn) return;
  const argParam = fn.parameters[0];
  const pname = argParam && ts.isIdentifier(argParam.name) ? argParam.name.text : undefined;
  const own = new Set<string>();
  let bag = false; // 整包交接：把入参袋整体交给下游（sink(args) / { ...args }），不逐字段按名读
  const collect = (n: ts.Node): void => {
    if (ts.isPropertyAccessExpression(n) && isArgsReceiver(n.expression, pname)) own.add(n.name.text);
    if (ts.isElementAccessExpression(n) && isArgsReceiver(n.expression, pname)) {
      const s = strLit(n.argumentExpression);
      if (s !== null) own.add(s);
    }
    if (ts.isCallExpression(n) && pname !== undefined && n.arguments.some((a) => ts.isIdentifier(a) && a.text === pname)) bag = true;
    if (ts.isSpreadAssignment(n) && pname !== undefined && ts.isIdentifier(n.expression) && n.expression.text === pname) bag = true;
    if (ts.isVariableDeclaration(n) && n.initializer && isArgsReceiver(n.initializer, pname) && ts.isObjectBindingPattern(n.name)) {
      for (const el of n.name.elements) {
        if (!ts.isBindingElement(el)) continue;
        if (el.propertyName && ts.isIdentifier(el.propertyName)) own.add(el.propertyName.text);
        else if (ts.isIdentifier(el.name)) own.add(el.name.text);
      }
    }
    ts.forEachChild(n, collect);
  };
  collect(fn.body ?? fn);
  // 零形参的 run()（`async run() {…}`）**也是实现了这个工具**——旧写法在这里 return，
  // 于是 automation_list 连分母都没进（自检 ③ 钉的就是这一格）。
  for (const t of toolNames) {
    const prev = ownReads.get(t) ?? new Set<string>();
    for (const p of own) prev.add(p);
    ownReads.set(t, prev); // 零参工具也进这张表（值为空集）——否则它从分母里整个消失
    if (bag) bagTools.add(t);
  }
}

const sources = files.map((f) => ts.createSourceFile(f, readFileSync(f, "utf8"), ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS));
for (const src of sources) collectConsts(src); // 先建常量表，再谈名字归因
for (const src of sources) {
  parsed.push(relative(ROOT, src.fileName));
  const walkNode = (n: ts.Node): void => {
    if (ts.isObjectLiteralExpression(n)) visitToolObject(n);
    if (ts.isPropertyAccessExpression(n) && isArgsReceiver(n.expression)) pushRead(n.name.text, n);
    if (ts.isElementAccessExpression(n) && isArgsReceiver(n.expression)) {
      const s = strLit(n.argumentExpression);
      if (s !== null) pushRead(s, n);
    }
    if (ts.isVariableDeclaration(n) && n.initializer && isArgsReceiver(n.initializer) && ts.isObjectBindingPattern(n.name)) {
      for (const el of n.name.elements) {
        if (!ts.isBindingElement(el)) continue;
        if (el.propertyName && ts.isIdentifier(el.propertyName)) pushRead(el.propertyName.text, el);
        else if (ts.isIdentifier(el.name)) pushRead(el.name.text, el);
      }
    }
    ts.forEachChild(n, walkNode);
  };
  walkNode(src);
}

function pushRead(name: string, n: ts.Node): void {
  const list = globalReads.get(name) ?? [];
  const where = at(n);
  if (!list.includes(where)) list.push(where);
  globalReads.set(name, list);
}

export interface DriftRow {
  tool: string;
  faces: string[];
  declared: string[];
  readOwn: string[];
  /** 探针在这个工具上找到了 run()（零参 run() 也算——见自检 ③）。 */
  hasRun: boolean;
  /** 有实现、但**找不到任何声明面** ⇒ 分母不全（探针的极限，不是产品缺陷；不许算红）。 */
  noFace: boolean;
  /** 有声明、没有 run() 实现（合成夹具 / 外部面）⇒ 提示项，不算红。 */
  declaredOnly: boolean;
  /** **只在模型活面上出现**（`gateToolSpecs()` 里看得见，探针找不到任何实现行）⇒ 真缺陷形状，算红。 */
  liveOnly: boolean;
  /** 声明了、本工具 run() 没读、**全仓也没有任何一处按这个名字读 args** ⇒ 静默丢弃（可判的红）。 */
  ignored: string[];
  /** 整包交接：本工具把 args 袋整体交给下游 ⇒ 这些字段在这里量不了（不许冒充 ignored，也不许冒充已对账）。 */
  bagHandoff: string[];
  /** 声明了、本工具没读、但 src/ 别处按同名读过 ⇒ 跨文件消费（提示项，不保证是为本工具读的）。 */
  elsewhere: string[];
  /** 本工具 run() 读了、任何声明面都没有 ⇒ 模型无从发现（可判的红，但要人工裁"是不是读了为了拒"）。 */
  undeclared: string[];
  /** 同一工具的多份声明面（含活面）顶层参数集不一致。 */
  faceMismatch: string[];
}

const topOnly = (d: Declared): string[] => [...d.top].filter((p) => !p.includes(".") && !p.includes("[]")).sort();

/** 活面判据过期检查用：某个名字在活面上还有没有、还是不是"只有声明"。 */
export function buildRows(
  decls: Map<string, Map<string, Declared>>,
  ownReads: Map<string, Set<string>>,
  globalReads: Map<string, string[]>,
  live: Map<string, string[]> = new Map(),
  bags: ReadonlySet<string> = bagTools,
): DriftRow[] {
  const names = new Set([...decls.keys(), ...ownReads.keys(), ...live.keys()]);
  const rows: DriftRow[] = [];
  for (const tool of [...names].sort()) {
    const faces = new Map(decls.get(tool) ?? new Map<string, Declared>());
    const perFace = [...faces.values()].map(topOnly);
    const hasLive = live.has(tool);
    if (hasLive) {
      faces.set(LIVE_FACE, { top: new Set(live.get(tool)), paths: new Set(live.get(tool)), required: new Set() });
      perFace.push([...(live.get(tool) ?? [])].sort());
    }
    const declared = [...new Set(perFace.flat())].sort();
    const hasRun = ownReads.has(tool);
    const readOwn = [...(ownReads.get(tool) ?? new Set<string>())].sort();
    const notOwn = declared.filter((p) => !readOwn.includes(p) && (globalReads.get(p) ?? []).length === 0);
    rows.push({
      tool,
      faces: [...faces.keys()].sort(),
      declared,
      readOwn,
      hasRun,
      noFace: !hasRun || faces.size === 0,
      declaredOnly: hasRun === false && faces.size > 0,
      liveOnly: hasLive && !hasRun,
      ignored: bags.has(tool) ? [] : notOwn,
      bagHandoff: bags.has(tool) ? notOwn : [],
      elsewhere: declared.filter((p) => !readOwn.includes(p) && (globalReads.get(p) ?? []).length > 0),
      undeclared: readOwn.filter((p) => !declared.includes(p)),
      faceMismatch: declared.filter((p) => perFace.some((s) => !s.includes(p))),
    });
  }
  return rows;
}

const rows = buildRows(decls, ownReads, globalReads, liveFace);

/** 每次跑都注入一次自检（规则 74）：两条硬判据必须能因一个**已知虚假**的形状而红，
 *  否则"零偏差"完全兼容"尺是瞎的"。自检用合成源码走同一套 walker，跑完即从集合里摘掉。 */
function selfCheck(): string[] {
  const problems: string[] = [];
  const feed = (key: string, text: string): void => {
    const src = ts.createSourceFile(join(SRC, "__selfcheck_" + key + ".ts"), text, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
    const go = (n: ts.Node): void => {
      if (ts.isObjectLiteralExpression(n)) visitToolObject(n);
      if (ts.isPropertyAccessExpression(n) && isArgsReceiver(n.expression)) pushRead(n.name.text, n);
      ts.forEachChild(n, go);
    };
    go(src);
  };
  // ① 声明了没人读（helper 形状：obj(props, required)——正是第一版正则认不出的那支）
  feed("ignored", "const obj = (p: object, r: string[]) => ({ type: 'object', properties: p, required: r });\n" +
    "export const sc_ignored = { name: 'sc_ignored', parameters: obj({ sc_phantom: { type: 'string' } }, []), async run(args: Record<string, unknown>) { return { ok: true, output: String(args.sc_used) }; } };");
  // ② 读了没声明（参数不叫 args 也要认得：rawArgs）
  feed("undeclared", "export const sc_undeclared = { name: 'sc_undeclared', parameters: { type: 'object', properties: { sc_declared: { type: 'string' } } }, async run(rawArgs: Record<string, unknown>) { return { ok: true, output: String(rawArgs.sc_hidden) }; } };");
  const check = buildRows(decls, ownReads, globalReads).filter((r) => r.tool.startsWith("sc_"));
  if (!check.some((r) => r.tool === "sc_ignored" && r.ignored.includes("sc_phantom"))) problems.push("自检 ①「声明没人读」没抓到 sc_phantom");
  if (!check.some((r) => r.tool === "sc_undeclared" && r.undeclared.includes("sc_hidden"))) problems.push("自检 ②「读了没声明」没抓到 sc_hidden（rawArgs 这类接收者认不出？）");
  // ③ 零参 run()：`async run() {…}` 也算**有实现**的一行。旧写法在「第一个形参不是标识符」处直接放弃，
  //    于是真工具 automation_list（活面 0 个参数、run 不接 args）**整行从分母里消失**——
  //    连"无声明面"那一桶都没进，读数看着像"没有这个工具"。
  feed("zerorun", "export const sc_zerorun = { name: 'sc_zerorun', async run() { return { ok: true, output: 'x' }; } };");
  // ④ 整包交接：`sink(args)` / `{ ...args }` 把整个入参袋交给下游，逐字段 `args.X` 一次都不出现。
  //    把这种工具的声明字段算成「声明没人读」= 假红（字段确实在消费，只是不在这个边界按名读）；
  //    但也不能当"已对账"——这一格必须说出口，将来谁拿它立门得知道这里量不了。
  feed("bag", "export const sc_bag = { name: 'sc_bag', parameters: { type: 'object', properties: { sc_field: { type: 'string' } } }, async run(args: Record<string, unknown>) { return check(sink(args)); } };");
  const check2 = buildRows(decls, ownReads, globalReads).filter((r) => r.tool.startsWith("sc_"));
  const zero = check2.find((r) => r.tool === "sc_zerorun");
  if (zero === undefined || !zero.hasRun) problems.push("自检 ③ 零参 run() 的工具没进分母（automation_list 就是这么消失的）");
  const bagRow = check2.find((r) => r.tool === "sc_bag");
  if (bagRow === undefined || !(bagRow.bagHandoff ?? []).includes("sc_field")) problems.push("自检 ④ 整包交接（sink(args)）没被认成一格，sc_field 会被误报成「声明没人读」");
  if (bagRow !== undefined && bagRow.ignored.includes("sc_field")) problems.push("自检 ④b 整包交接的工具仍把 sc_field 算进 ignored（假红）");
  // ⑤ 只在活面里出现的工具（探针找不到任何实现行）⇒ 必须有名字，不许静默缺席
  const liveOnly = buildRows(decls, ownReads, globalReads, new Map([["sc_liveonly", ["sc_p"]]])).find((r) => r.tool === "sc_liveonly");
  if (liveOnly === undefined || !liveOnly.liveOnly) problems.push("自检 ⑤ 只在活面里出现的工具没落进「活面无实现」桶");
  for (const t of ["sc_ignored", "sc_undeclared", "sc_zerorun", "sc_bag"]) {
    decls.delete(t);
    ownReads.delete(t);
  }
  return problems;
}
const selfProblems = selfCheck();
for (const p of selfProblems) console.log("❌ 自检失败：" + p + "（尺是瞎的，下面这张表不作数）");

/** 「读了没声明」里的第四类（§二 裁过）：**读它是为了拒**——防御性读取不是隐藏能力。
 *  键 = `工具.字段`，值 = 为什么读。没有这一格，把本探针做成门的日子会把安全防线报成缺陷。
 *  与活面豁免同形：登记本身要配一条「不再成立就出声」的反向断言，否则它会变成下一颗漂移磁铁。 */
const READ_TO_DENY: Readonly<Record<string, string>> = {
  "remember.metadata": "读到 metadata 里塞的 scope 就报错（越权防线，实现处注释点名 mem0 三次同类修复）⇒ 故意不接受，读它是为了拒",
};
const defensiveOf = (r: DriftRow): string[] => r.undeclared.filter((p) => READ_TO_DENY[r.tool + "." + p] !== undefined);
const staleDenies = Object.keys(READ_TO_DENY).filter((k) => {
  const dot = k.indexOf(".");
  const tool = k.slice(0, dot);
  const field = k.slice(dot + 1);
  const r = rows.find((x) => x.tool === tool);
  return r === undefined || !r.undeclared.includes(field);
});

// 只有"既有声明面又有实现"的行才有资格算红——否则分母不全就是红因（规则 104：读到 0 与没尺要分开）。
const scored = rows.filter((r) => !r.noFace && !r.declaredOnly);
const hard = scored.filter((r) => r.ignored.length > 0 || r.undeclared.length > defensiveOf(r).length || r.faceMismatch.length > 0);
const blind = rows.filter((r) => r.noFace && !r.declaredOnly);
const fixtures = rows.filter((r) => r.declaredOnly);
/** 活面上看得见、探针一行实现都没找到 ⇒ 真红（这才分母该由活面算的那一格）。 */
const liveMissing = rows.filter((r) => r.liveOnly && LIVE_NO_TOOL_OBJECT[r.tool] === undefined);
/** 反向那一侧（规则 60）：名单里的名字若已经不再是"只有声明"，登记本身过期了要说出口，不许继续当豁免用。 */
const staleExemptions = Object.keys(LIVE_NO_TOOL_OBJECT).filter((n) => {
  const r = rows.find((x) => x.tool === n);
  return r === undefined || !r.declaredOnly;
});
const bags = rows.filter((r) => r.bagHandoff.length > 0);
console.log("活面（模型真看得见）" + String(liveFace.size) + " 件工具；" +
  "其中逐字段可判 " + String(scored.filter((r) => liveFace.has(r.tool)).length) +
  " / 整包交接 " + String(bags.filter((r) => liveFace.has(r.tool)).length) +
  " / 无实现行 " + String(rows.filter((r) => r.liveOnly).length));
console.log("解析文件 " + String(parsed.length) + " 个；工具行 " + String(rows.length) +
  "（可判 " + String(scored.length) + " / 声明面缺失 " + String(blind.length) + " / 只有声明 " + String(fixtures.length) + "）");
if (unparsed.length > 0) console.log("⚠️ 认得出的工具里，有 " + String(unparsed.length) + " 处 schema 节点解析不了：" + unparsed.slice(0, 8).join("、"));
if (unattributed.length > 0) console.log("ℹ️ 另有 " + String(unattributed.length) + " 处源码里的 parameters 节点没归到某个工具名下（provider 请求翻译 / 表驱动生成器都算）。" +
  "**它们不再决定分母**——分母改由活面算：模型看得见 " + String(liveFace.size) + " 件，逐条列在下面。");
if (blind.length > 0) console.log("⚠️ 这些工具有实现、探针找不到它的声明面（**下面任何结论都不覆盖它们**）：" +
  blind.map((r) => r.tool + "（自读 " + r.readOwn.join(",") + "）").join("、"));
if (liveMissing.length > 0) console.log("❌ 模型面上有、探针找不到实现行（这才是真正的分母缺口）：" +
  liveMissing.map((r) => r.tool + "（声明 " + (liveFace.get(r.tool) ?? []).join(",") + "）").join("、"));
if (staleExemptions.length > 0) console.log("❌ 豁免登记已过期（该名字已不再是「只有声明」，或已不在活面上）：" +
  staleExemptions.map((n) => n + " ⇒ " + LIVE_NO_TOOL_OBJECT[n]).join("、"));
if (fixtures.length > 0) console.log("ℹ️ 只有声明没有 run() 的行（合成夹具 / 外部面）：" + fixtures.map((r) => r.tool).join("、"));
if (bags.length > 0) console.log("ℹ️ 整包交接（逐字段对账不适用，已单列不算「声明没人读」）：" +
  bags.map((r) => r.tool + "→" + r.bagHandoff.length + " 个字段").join("、"));
const denies = rows.flatMap((r) => defensiveOf(r).map((p) => r.tool + "." + p));
if (denies.length > 0) console.log("ℹ️ 防御性读取（读它是为了拒，§二 已裁 ⇒ 不算偏差）：" + denies.join("、"));
if (staleDenies.length > 0) console.log("❌ 防御性读取登记已过期（该字段已不在「读了没声明」里）：" + staleDenies.join("、"));
for (const r of rows) {
  const notes = [
    ...r.ignored.map((p) => "声明没人读:" + p),
    ...r.undeclared.map((p) => "读了没声明:" + p),
    ...r.faceMismatch.map((p) => "两份声明不一致:" + p),
  ];
  if (r.noFace || r.declaredOnly) notes.push(r.declaredOnly ? "（只有声明，不判）" : "（无声明面，不判）");
  if (r.bagHandoff.length > 0) notes.push("整包交接[" + r.bagHandoff.join(",") + "]");
  console.log("  " + r.tool.padEnd(20) + " 面=" + String(r.faces.length) + (r.faces.includes(LIVE_FACE) ? "(含活面)" : "") +
    " 声明[" + r.declared.join(",") + "] 自读[" + r.readOwn.join(",") + "]" +
    (r.elsewhere.length ? " 跨文件读[" + r.elsewhere.join(",") + "]" : "") +
    (notes.length ? "  ⇒ " + notes.join(" / ") : ""));
}
console.log("\n对账结论：可判 " + String(scored.length) + " 个工具里 " + String(hard.length) +
  " 个有偏差；未解析 schema 节点 " + String(unparsed.length) + " 处；无声明面 " + String(blind.length) +
  " 个；活面无实现 " + String(liveMissing.length) + " 个；过期豁免 " + String(staleExemptions.length) +
  " 条；过期防御登记 " + String(staleDenies.length) + " 条");
process.exit(hard.length > 0 || unparsed.length > 0 || selfProblems.length > 0 || liveMissing.length > 0 ||
  staleExemptions.length > 0 || staleDenies.length > 0 ? 1 : 0);
