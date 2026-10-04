import { tierOf, total, TIERS } from "../src/pricing.js";

let failures = 0;
const expect = (cond, msg) => {
  if (!cond) {
    failures++;
    console.error("FAIL: " + msg);
  }
};

// 档内：每公斤单价直接乘。
expect(total(1) === 18, "1 公斤应是 18（实得 " + total(1) + "）");
expect(total(0.5) === 9, "0.5 公斤应是 9（实得 " + total(0.5) + "）");
// ⚠️ 这里**不能**断言 total(3) === 45（「3 公斤都按 15 算」）—— 那是把 bug 写进判卷。
// 3 公斤跨了两档，正确值是 48，见下面「跨档」那组。第一版这里两条断言互相矛盾，
// 是跑正解时被自己的判卷打回来才发现的。

// **跨档**：这是本 case 的重点——必须分段累加。
// 3 公斤 = 1×18 + 2×15 = 48
expect(total(3) === 48, "3 公斤应分段计价 = 1×18 + 2×15 = 48（实得 " + total(3) + "）");
// 8 公斤 = 1×18 + 4×15 + 3×12 = 18+60+36 = 114
expect(total(8) === 114, "8 公斤应分段计价 = 18+60+36 = 114（实得 " + total(8) + "）");
// 18 公斤 = 1×18 + 4×15 + 13×12 = 18+60+156 = 234（注意 18 ≤ 20，仍在最大档内；
//   超过 20 公斤时 tierOf 返回 undefined、total 返回 Infinity，那是**设计内**的，
//   不是 bug——上一版我拿 30 公斤当期望值，被自己的断言打回来才发现。）
expect(total(18) === 234, "18 公斤应分段计价 = 18+60+156 = 234（实得 " + total(18) + "）");
expect(total(21) === Infinity, "21 公斤超出最大档，应返回 Infinity（实得 " + String(total(21)) + "）");

// 档位查表本身不能坏。
expect(tierOf(1).maxKg === 1, "1 公斤应落在第 1 档");
expect(tierOf(6).maxKg === 20, "6 公斤应落在第 3 档");
expect(tierOf(99) === undefined, "超出最大档应查不到");
expect(TIERS.length === 3, "应有 3 个档位");

if (failures > 0) {
  console.error(failures + " 项断言失败");
  process.exit(1);
}
console.log("grep-target: all ok");