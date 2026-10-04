// `scripts/lib/subrepo-dep-need.ts` 的判卷：把「零依赖靶子」从「补不齐 ⇒ 判卷红不可归因于代码」那句话里摘出去。
// 两态各钉一次（0 项 ⇒ 不计入补齐面；有声明 ⇒ 照旧要补），fail-closed 那一支单独有牙；
// 再加一条真仓事实源（现读靶子自己的 package.json，加了依赖这条就红）与一条接线（head-cert 确实在用这把尺）。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { declaredDepCount, needsNodeModules } from "../scripts/lib/subrepo-dep-need";

const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const pkg = (fields: Record<string, Record<string, string>>): string => JSON.stringify(fields);

describe("declaredDepCount／needsNodeModules：两态各钉一次", () => {
  it("dependencies 与 devDependencies 都是空对象 ⇒ 计数 0、不需要 node_modules", () => {
    const text = pkg({ dependencies: {}, devDependencies: {} });
    expect(declaredDepCount(text)).toBe(0);
    expect(needsNodeModules(text)).toBe(false);
  });

  it("两个字段压根没写（bench-* 靶子的真实形状）⇒ 同样 0、false（不许把「没写」读成「说不清」）", () => {
    const text = JSON.stringify({ name: "queue-lite", private: true, scripts: { test: "node --test tests/*.test.js" } });
    expect(declaredDepCount(text)).toBe(0);
    expect(needsNodeModules(text)).toBe(false);
  });

  it("只有 devDependencies 一项 ⇒ 计数 1、需要（「只有开发依赖」不是零依赖）", () => {
    const text = pkg({ devDependencies: { vitest: "^3.0.0" } });
    expect(declaredDepCount(text)).toBe(1);
    expect(needsNodeModules(text)).toBe(true);
  });

  it("两面各有若干 ⇒ 计数是两者之和（钉住「只数 dependencies」那种退化写法：这里会读成 2）", () => {
    const text = pkg({ dependencies: { zod: "^3", electron: "^44" }, devDependencies: { typescript: "^5", vitest: "^3", tsx: "^4" } });
    expect(declaredDepCount(text)).toBe(5);
    expect(needsNodeModules(text)).toBe(true);
  });
});

describe("fail-closed 那一支要有牙：说不清 ⇒ 当作要补依赖", () => {
  it("坏 JSON／空串／顶层是数组／顶层是标量／顶层是 null ⇒ null 且 true", () => {
    for (const bad of ["{ not json", "", "[1,2,3]", '"a string"', "42", "null"]) {
      expect(declaredDepCount(bad), "输入：" + bad).toBeNull();
      expect(needsNodeModules(bad), "输入：" + bad).toBe(true);
    }
  });

  it("字段在却不是对象（字符串／null）⇒ 同样 null 且 true（不猜它有几项）", () => {
    for (const odd of ['{ "dependencies": "latest" }', '{ "devDependencies": null }']) {
      expect(declaredDepCount(odd), "输入：" + odd).toBeNull();
      expect(needsNodeModules(odd), "输入：" + odd).toBe(true);
    }
  });
});

describe("真仓事实源（现读，不写死读数）", () => {
  it("fixtures/bench/bench-bugfix-async 的 package.json 现在就是零依赖 ⇒ false（谁给它加了依赖，这条当场红）", () => {
    const text = read("../fixtures/bench/bench-bugfix-async/package.json");
    expect(declaredDepCount(text)).toBe(0);
    expect(needsNodeModules(text)).toBe(false);
  });
});

describe("接线：head-cert 用这把尺决定谁进「补不齐」那句话", () => {
  // 与 `tests/cert-gate-face.test.ts` 那组同形状：读源文（head-cert 那支会写盘、起进程，不能 import），
  // 行锚定＋当场做突变副本证明正则不是恒真。
  const SRC = read("../scripts/head-cert.ts");
  const loopOf = (text: string): string => /for \(const d of subDirs\) \{[\s\S]*?\n\}/.exec(text)?.[0] ?? "";
  const LOOP = loopOf(SRC);

  it("循环体取到了（分母非空，否则下面几条全是恒真）", () => {
    expect(LOOP, "没认出 subDirs 那个循环 ⇒ 取料形状变了").toContain("subMissing.push");
  });

  it("尺在循环里被调用，喂进去的是**那棵认证树里那个子包自己**的 package.json 文字", () => {
    expect(/needsNodeModules\(/.test(LOOP), "head-cert 没调用这把尺 ⇒ 零依赖靶子又被计入补齐面").toBe(true);
    expect(/readFileSync\(join\(treeAbs, d, "package.json"\), "utf8"\)/.test(LOOP), "取料不是那一棵树里那一个子包的 package.json ⇒ 问错了对象").toBe(true);
  });

  it("零依赖那一支只计数并收尾，不 push；两处 push 都在需要依赖的那两支之后", () => {
    const guard = /if \(!needsNodeModules\((\w+)\)\) \{([\s\S]*?)\n {2}\}/u.exec(LOOP);
    expect(guard, "零依赖那一支的 guard 认不出来").not.toBeNull();
    expect(guard![2], "零依赖那一支里出现了 push ⇒ 免罪符又发给它了").not.toContain("subMissing.push");
    expect(/continue;/u.test(guard![2]), "零依赖那一支没跳出循环 ⇒ 还会走去补依赖那段").toBe(true);
    const pushes = [...LOOP.matchAll(/subMissing\.push/gu)];
    expect(pushes.length, "push 点只能是「主树也没有」与「硬链接失败」那两支").toBe(2);
    const guardAt = LOOP.indexOf(guard![0]);
    for (const p of pushes) expect(p.index, "有一处 push 落在 guard 之前 ⇒ 零依赖目录照样进补齐面").toBeGreaterThan(guardAt);
  });

  it("有牙（前半）：把 guard 的谓词写死成恒假，上面那条接线证人当场红", () => {
    const mutated = SRC.replace(/if \(!needsNodeModules\((\w+)\)\) \{/u, "if (false) {");
    expect(mutated, "替换打了个空＝正则没咬到东西").not.toBe(SRC);
    expect(/needsNodeModules\(/.test(loopOf(mutated))).toBe(false);
  });

  it("有牙（后半）：往零依赖那一支塞一条 push，那条计数立刻从 2 变 3", () => {
    const leaked = LOOP.replace(/(!needsNodeModules\(\w+\)\) \{\n)( {4}subNoDep \+= 1;)/u, "$1    subMissing.push(d);\n$2");
    expect(leaked, "突变副本打了个空").not.toBe(LOOP);
    expect([...leaked.matchAll(/subMissing\.push/gu)].length).toBe(3);
  });
});
