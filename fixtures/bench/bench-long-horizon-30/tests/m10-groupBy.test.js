import test from "node:test";
import assert from "node:assert/strict";
import { groupBy } from "../src/m10-groupBy.js";

test("groupBy：分组：同键的**累积**成数组（不是覆盖）", () => {
  assert.deepEqual(groupBy([1,2,3,4], (n) => (n % 2 ? "odd" : "even")), { odd: [1,3], even: [2,4] });
});
