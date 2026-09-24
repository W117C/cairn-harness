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
 *
 *  复跑：TERM=dumb node --import tsx outputs/tool-param-drift-2026-09-24/measure-param-drift.mts
 */
import ts from "typescript";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "../..");
const SRC = join(ROOT, "src");

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
  if (!argParam || !ts.isIdentifier(argParam.name)) return;
  const pname = argParam.name.text;
  const own = new Set<string>();
  const collect = (n: ts.Node): void => {
    if (ts.isPropertyAccessExpression(n) && isArgsReceiver(n.expression, pname)) own.add(n.name.text);
    if (ts.isElementAccessExpression(n) && isArgsReceiver(n.expression, pname)) {
      const s = strLit(n.argumentExpression);
      if (s !== null) own.add(s);
    }
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
  for (const t of toolNames) {
    const prev = ownReads.get(t) ?? new Set<string>();
    for (const p of own) prev.add(p);
    ownReads.set(t, prev);
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
  /** 有实现、但**找不到任何声明面** ⇒ 分母不全（探针的极限，不是产品缺陷；不许算红）。 */
  noFace: boolean;
  /** 有声明、没有 run() 实现（合成夹具 / 外部面）⇒ 提示项，不算红。 */
  declaredOnly: boolean;
  /** 声明了、本工具 run() 没读、**全仓也没有任何一处按这个名字读 args** ⇒ 静默丢弃（可判的红）。 */
  ignored: string[];
  /** 声明了、本工具没读、但 src/ 别处按同名读过 ⇒ 跨文件消费（提示项，不保证是为本工具读的）。 */
  elsewhere: string[];
  /** 本工具 run() 读了、任何声明面都没有 ⇒ 模型无从发现（可判的红，但要人工裁"是不是读了为了拒"）。 */
  undeclared: string[];
  /** 同一工具的多份声明面顶层参数集不一致。 */
  faceMismatch: string[];
}

const topOnly = (d: Declared): string[] => [...d.top].filter((p) => !p.includes(".") && !p.includes("[]")).sort();

export function buildRows(
  decls: Map<string, Map<string, Declared>>,
  ownReads: Map<string, Set<string>>,
  globalReads: Map<string, string[]>,
): DriftRow[] {
  const names = new Set([...decls.keys(), ...ownReads.keys()]);
  const rows: DriftRow[] = [];
  for (const tool of [...names].sort()) {
    const faces = new Map(decls.get(tool) ?? new Map<string, Declared>());
    const perFace = [...faces.values()].map(topOnly);
    const declared = [...new Set(perFace.flat())].sort();
    const hasRun = ownReads.has(tool);
    const readOwn = [...(ownReads.get(tool) ?? new Set<string>())].sort();
    const notOwn = declared.filter((p) => !readOwn.includes(p));
    rows.push({
      tool,
      faces: [...faces.keys()].sort(),
      declared,
      readOwn,
      noFace: !hasRun || faces.size === 0,
      declaredOnly: hasRun === false && faces.size > 0,
      ignored: notOwn.filter((p) => (globalReads.get(p) ?? []).length === 0),
      elsewhere: notOwn.filter((p) => (globalReads.get(p) ?? []).length > 0),
      undeclared: readOwn.filter((p) => !declared.includes(p)),
      faceMismatch: declared.filter((p) => perFace.some((s) => !s.includes(p))),
    });
  }
  return rows;
}

const rows = buildRows(decls, ownReads, globalReads);

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
  for (const t of ["sc_ignored", "sc_undeclared"]) {
    decls.delete(t);
    ownReads.delete(t);
  }
  return problems;
}
const selfProblems = selfCheck();
for (const p of selfProblems) console.log("❌ 自检失败：" + p + "（尺是瞎的，下面这张表不作数）");

// 只有"既有声明面又有实现"的行才有资格算红——否则分母不全就是红因（规则 104：读到 0 与没尺要分开）。
const scored = rows.filter((r) => !r.noFace && !r.declaredOnly);
const hard = scored.filter((r) => r.ignored.length > 0 || r.undeclared.length > 0 || r.faceMismatch.length > 0);
const blind = rows.filter((r) => r.noFace && !r.declaredOnly);
const fixtures = rows.filter((r) => r.declaredOnly);
console.log("解析文件 " + String(parsed.length) + " 个；工具行 " + String(rows.length) +
  "（可判 " + String(scored.length) + " / 声明面缺失 " + String(blind.length) + " / 只有声明 " + String(fixtures.length) + "）");
if (unparsed.length > 0) console.log("⚠️ 认得出的工具里，有 " + String(unparsed.length) + " 处 schema 节点解析不了：" + unparsed.slice(0, 8).join("、"));
if (unattributed.length > 0) console.log("⚠️ 另有 " + String(unattributed.length) + " 处 parameters 声明**认不出属于哪个工具**（不进任何结论）：" + unattributed.slice(0, 8).join("、"));
if (blind.length > 0) console.log("⚠️ 这些工具有实现、探针找不到它的声明面（**下面任何结论都不覆盖它们**）：" +
  blind.map((r) => r.tool + "（自读 " + r.readOwn.join(",") + "）").join("、"));
if (fixtures.length > 0) console.log("ℹ️ 只有声明没有 run() 的行（合成夹具 / 外部面）：" + fixtures.map((r) => r.tool).join("、"));
for (const r of rows) {
  const notes = [
    ...r.ignored.map((p) => "声明没人读:" + p),
    ...r.undeclared.map((p) => "读了没声明:" + p),
    ...r.faceMismatch.map((p) => "两份声明不一致:" + p),
  ];
  if (r.noFace || r.declaredOnly) notes.push(r.declaredOnly ? "（只有声明，不判）" : "（无声明面，不判）");
  console.log("  " + r.tool.padEnd(20) + " 面=" + String(r.faces.length) +
    " 声明[" + r.declared.join(",") + "] 自读[" + r.readOwn.join(",") + "]" +
    (r.elsewhere.length ? " 跨文件读[" + r.elsewhere.join(",") + "]" : "") +
    (notes.length ? "  ⇒ " + notes.join(" / ") : ""));
}
console.log("\n对账结论：可判 " + String(scored.length) + " 个工具里 " + String(hard.length) +
  " 个有偏差；未解析 schema 节点 " + String(unparsed.length) + " 处；无声明面 " + String(blind.length) + " 个");
process.exit(hard.length > 0 || unparsed.length > 0 || selfProblems.length > 0 || unattributed.length > 0 ? 1 : 0);
