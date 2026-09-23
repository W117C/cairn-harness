// 「设置/调用方两半接线」的覆盖率判据（纯函数、零 IO，供判卷与门消费）。
//
// 病灶（2026-09-24 实测，PROGRESS 能力 34/35）：`src/main/agent-runner.ts` 里成片的
// `X: over.x ?? (await store().get()).y` —— 每一行有**两个可坏的方向**：
// 吞掉盘上的值（用户在设置界面点的开关到不了内核）与吞掉调用方传的值（override 被无视）。
// 8 行 × 两半的分辨力是逐行突变才量出来的，而**下次再加第 9 个开关时没人会重做那张表**——
// 本模块就是把"每行都得有人守"这件事挂在**现状**（源码里真实存在的行）上，不挂在手抄清单上。
//
// 两侧都走 AST（记忆规则 79：按行的正则判据会把注释里的示例当代码）：
//  - 被测面：TS AST 找 `?? ` 二元式，左边 `over.<k>`、右边 `(await store()).<k2>`，且外层是对象字面量属性；
//  - 锚点面：变异表的 AST，取 `apply:` 箭头函数里 `.replace(<针脚>, <改法>)` 两个字符串字面量 + 同级的 `id`。
//    （表本体在 `scripts/mutate-verify.mjs`，它按规则 110 拒绝被 import，所以只能读文本再解析。）
import ts from "typescript";

export interface ToggleWiring {
  /** 对象字面量里的属性名（模型/调用方看到的那个键）。 */
  key: string;
  /** overrides 侧的键（`over.<overrideKey>`）。 */
  overrideKey: string;
  /** settings 侧的键（`(await store().get()).<settingsKey>`）。 */
  settingsKey: string;
  line: number;
  /** 归一化空白后的 `key: over.x ?? (await store().get()).y`，用来与锚点针脚对文本。 */
  snippet: string;
}

export interface AnchorNeedle {
  id: string;
  needle: string;
  replacement: string;
}

const norm = (s: string): string => s.replace(/\s+/g, " ").trim();

/** `(await store())` 这一坨的识别（含 `.get()` 中继：`(await store().get())`）。 */
function isStoreRead(node: ts.Expression): boolean {
  // 目标形状：ParenthesizedExpression( AwaitExpression( ... CallExpression ... ) )
  if (!ts.isParenthesizedExpression(node)) return false;
  const inner = node.expression;
  return ts.isAwaitExpression(inner) && ts.isCallExpression(inner.expression);
}

/** 被测面：扫出一行 `key: over.x ?? (await store().get()).y` 形状的接线。 */
export function extractToggleWiring(
  sourceText: string,
  fileName = "inline.ts",
  overrideHost = "over",
): ToggleWiring[] {
  const sf = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
  const out: ToggleWiring[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken &&
      ts.isPropertyAccessExpression(node.left) &&
      ts.isIdentifier(node.left.expression) &&
      node.left.expression.text === overrideHost &&
      ts.isPropertyAccessExpression(node.right) &&
      isStoreRead(node.right.expression) &&
      node.parent !== undefined &&
      ts.isPropertyAssignment(node.parent) &&
      ts.isIdentifier(node.parent.name)
    ) {
      const parent = node.parent;
      const keyText = parent.name.getText(sf).replace(/["']/g, "");
      out.push({
        key: keyText,
        overrideKey: node.left.name.text,
        settingsKey: node.right.name.text,
        line: sf.getLineAndCharacterOfPosition(parent.getStart(sf)).line + 1,
        snippet: norm(keyText + ": " + node.getText(sf)),
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

/** 锚点面：从变异表文本里取每条 `id` + 它 `apply` 里的第一对 `.replace(针脚, 改法)` 字面量。 */
export function extractAnchorNeedles(tableText: string, fileName = "mutate-verify.mjs"): AnchorNeedle[] {
  const sf = ts.createSourceFile(fileName, tableText, ts.ScriptTarget.ESNext, true, ts.ScriptKind.JS);
  const out: AnchorNeedle[] = [];
  const literalText = (n: ts.Node | undefined): string | undefined => {
    if (n === undefined) return undefined;
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) return n.text;
    return undefined; // 带插值的模板字面量无法静态求值 ⇒ 如实不覆盖，不假装看见
  };
  const findApply = (node: ts.Node): ts.ArrowFunction | undefined => {
    if (ts.isPropertyAssignment(node) && node.name.getText() === "apply" && ts.isArrowFunction(node.initializer)) {
      return node.initializer;
    }
    let found: ts.ArrowFunction | undefined;
    ts.forEachChild(node, (c) => {
      if (found === undefined) found = findApply(c);
    });
    return found;
  };
  /** 一条锚点里**所有**可静态求值的 `.replace(针脚, 改法)` 对（逐行式 apply 会有多对，都算它守过的面）。 */
  const collectReplaces = (node: ts.Node, into: Array<{ needle: string; replacement: string }>): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "replace" &&
      node.arguments.length >= 2
    ) {
      const needle = literalText(node.arguments[0]);
      const replacement = literalText(node.arguments[1]);
      if (needle !== undefined && replacement !== undefined) into.push({ needle, replacement });
    }
    ts.forEachChild(node, (c) => collectReplaces(c, into));
  };
  const visit = (node: ts.Node): void => {
    if (ts.isObjectLiteralExpression(node)) {
      const idProp = node.properties.find(
        (p) => ts.isPropertyAssignment(p) && p.name.getText() === "id",
      ) as ts.PropertyAssignment | undefined;
      const idText = idProp === undefined ? undefined : literalText(idProp.initializer);
      if (idText !== undefined && /^\w/.test(idText)) {
        const apply = findApply(node);
        if (apply !== undefined) {
          const pairs: Array<{ needle: string; replacement: string }> = [];
          collectReplaces(apply.body, pairs);
          for (const p of pairs) out.push({ id: idText, needle: norm(p.needle), replacement: norm(p.replacement) });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

export interface WiringCell {
  wiring: ToggleWiring;
  /** 砍掉「读盘」那一半的锚点 id（`?? false` 一类）。 */
  settingsAnchor?: string;
  /** 砍掉「尊重 overrides」那一半的锚点 id。 */
  overrideAnchor?: string;
  /** override 半边刻意不测时的署名理由（来自外部表，不是这里编的）。 */
  overrideWaiver?: string;
}

export interface WiringCoverage {
  cells: WiringCell[];
  /** 两半里没有任何锚点、也没署名的 ⇒ 必须判红。 */
  problems: string[];
  /** 豁免表里有名字、但**已经有锚点了** ⇒ 陈旧豁免，判红（宁可逼人删掉它）。 */
  staleWaivers: string[];
}

/**
 * 逐行判定两半各有没有人守。
 * 判据方向：**源码里有这行 ⇒ 必须有锚点或署名**（新增第 9 个开关时这里立刻缺格）。
 */
export function coverWiring(
  wirings: readonly ToggleWiring[],
  anchors: readonly AnchorNeedle[],
  overrideWaivers: Readonly<Record<string, string>>,
): WiringCoverage {
  const cells: WiringCell[] = [];
  const problems: string[] = [];
  const staleWaivers: string[] = [];
  for (const w of wirings) {
    const mine = anchors.filter((a) => a.needle.includes(w.snippet));
    const settingsAnchor = mine.find((a) => !a.replacement.includes(`(await store().get()).${w.settingsKey}`));
    const overrideAnchor = mine.find((a) => !a.replacement.includes(`over.${w.overrideKey}`));
    const waiver = overrideWaivers[w.key];
    if (waiver !== undefined && overrideAnchor !== undefined) staleWaivers.push(w.key);
    if (settingsAnchor === undefined) {
      problems.push(`${w.key}（第 ${String(w.line)} 行）：没有砍掉「读盘」那一半的锚点 ⇒ 设置界面的开关无人守`);
    }
    if (overrideAnchor === undefined && waiver === undefined) {
      problems.push(`${w.key}（第 ${String(w.line)} 行）：override 半边既没锚点也没署名（刻意不做要写理由）`);
    }
    cells.push({
      wiring: w,
      ...(settingsAnchor !== undefined ? { settingsAnchor: settingsAnchor.id } : {}),
      ...(overrideAnchor !== undefined ? { overrideAnchor: overrideAnchor.id } : {}),
      ...(waiver !== undefined ? { overrideWaiver: waiver } : {}),
    });
  }
  // 署名表里指不到真实接线行的（改过名/删了行而忘撤署名）⇒ 同样是陈旧
  const live = new Set(wirings.map((w) => w.key));
  for (const k of Object.keys(overrideWaivers)) if (!live.has(k)) staleWaivers.push(k);
  return { cells, problems, staleWaivers };
}
