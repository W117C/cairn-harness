import { clampSum } from "../src/math.js";

let failures = 0;
const expect = (cond, msg) => {
  if (!cond) {
    failures++;
    console.error("FAIL: " + msg);
  }
};

expect(clampSum([1, 2, 3], 0, 5) === 5, "sum=6 应夹到 max=5（实得 " + clampSum([1, 2, 3], 0, 5) + "）");
expect(clampSum([1, 2], 0, 10) === 3, "区间内不夹（实得 " + clampSum([1, 2], 0, 10) + "）");
expect(clampSum([-5, 2], 0, 10) === 0, "负和夹到 min=0（实得 " + clampSum([-5, 2], 0, 10) + "）");

if (failures > 0) {
  console.error(failures + " 项断言失败");
  process.exit(1);
}
console.log("sum-clamp: all ok");
