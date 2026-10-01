import test from "node:test";
import assert from "node:assert/strict";
import { roundTo } from "../src/m16-roundTo.js";

test("roundTo：四舍五入到 n 位小数，**返回数字**", () => {
  assert.strictEqual(roundTo(1.2345, 2), 1.23);
});
