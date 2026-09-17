// 两道新门禁（renderer-arch-check / a11y-check）的**反向对照样本生成器**。
//
// 为什么是生成器而不是冻结快照：快照会随产品演进而**变陈**，届时「判红」里会混入
// 陈旧差异，反而掩盖真正的缺陷（本轮实测：旧快照 /tmp/dsh-s1neg 与当前产物有 10 处差异，
// 其中只有 1 处是 S-1 突变，其余 9 处是后续提交带来的——用它做对照，14 条失败里
// 只有一部分真由 S-1 引起）。故一律**从当前构建产物现场生成**，保证对照只含目标突变。
//
// 用法：
//   node scripts/make-neg-controls.mjs [输出根目录]      # 缺省 /tmp/dsh-neg
//   node scripts/make-neg-controls.mjs --check           # 生成后顺带打印期望的门禁结果
//
// 产物（三个目录，各自是 out/renderer 的完整副本 + 一处突变）：
//   <root>/s1neg            → renderer-arch-check 必须判红（结构：多余 </div> 提前闭合）
//   <root>/a11y-neg         → a11y-check 必须判红（重复 id + 正文低对比度）
//   <root>/a11y-inert-neg   → a11y-check 必须判红（摘掉 inert，aria-hidden 仍在 = 真违规）
//
// 判据：三个样本**都必须红**。若任一变绿，说明对应门失去了分辨力（恒真式），
// 与「干净产物必须绿」一起构成该门的可证伪性证明。

import { cpSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const SRC = "out/renderer";
const args = process.argv.slice(2);
const root = args.find((a) => !a.startsWith("--")) ?? "/tmp/dsh-neg";

function build(name, mutate) {
  const dir = join(root, name);
  mkdirSync(root, { recursive: true });
  cpSync(SRC, dir, { recursive: true });
  const p = join(dir, "index.html");
  const before = readFileSync(p, "utf8");
  const after = mutate(before);
  if (after === before) throw new Error(`[make-neg-controls] ${name}: 突变未生效（锚点可能已失效）`);
  writeFileSync(p, after);
  console.log(`  ✅ ${name} -> ${dir}`);
  return dir;
}

// ① S-1：在第 2 条 AI 消息的 .msg-body/.msg 之后多加两个 </div>，
//    闭合余额上抛把 .stream-inner→.stream→main.chat→.shell→.app 依次提前关掉，
//    .composer 与 aside.drawer 落到 <body> 下（默认窗口下输入框与右板完全在首屏外）。
const ANCHOR = '<div class="msg-actions">';
build("s1neg", (h) => {
  const i = h.indexOf(ANCHOR);
  if (i < 0) throw new Error("锚点 <div class=\"msg-actions\"> 未找到");
  return h.slice(0, i) + "</div>\n              </div>\n              " + h.slice(i);
});

// ② a11y：重复 id（#streamInner ×2）+ 正文色改 #e6e6e6（白底 ≈1.25:1，远低于 4.5:1）
build("a11y-neg", (h) =>
  h.replace(
    "</body>",
    '<div id="streamInner" aria-hidden="true"></div>\n<style>.ai-text,.msg-body{color:#e6e6e6 !important}</style>\n</body>',
  ),
);

// ③ inert 反向：摘掉两浮层的 inert，保留 aria-hidden="true" —— 这才是真违规，
//    用来证明规则 5 新加的 `closest('[inert]')` 分支不是无差别静音。
build("a11y-inert-neg", (h) => {
  const n = (h.match(/ aria-hidden="true" inert>/g) ?? []).length;
  const out = h.replace(/ aria-hidden="true" inert>/g, ' aria-hidden="true">');
  if (n === 0) throw new Error("未找到 `aria-hidden=\"true\" inert>` 浮层（产品侧是否改了写法？）");
  console.log(`     （摘掉 inert：${n} 处）`);
  return out;
});

console.log(`\n反向对照样本已生成于 ${root}\n`);
console.log("验证（三个都必须 EXIT=1）：");
console.log(`  node --import tsx scripts/renderer-arch-check.ts --static ${join(root, "s1neg")}`);
console.log(`  node --import tsx scripts/a11y-check.ts --static ${join(root, "a11y-neg")}`);
console.log(`  node --import tsx scripts/a11y-check.ts --static ${join(root, "a11y-inert-neg")}`);
console.log("\n对照（必须 EXIT=0）：");
console.log("  node --import tsx scripts/renderer-arch-check.ts --static out/renderer");
console.log("  node --import tsx scripts/a11y-check.ts --static out/renderer");
