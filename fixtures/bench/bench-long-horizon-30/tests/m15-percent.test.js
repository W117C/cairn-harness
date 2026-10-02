import test from "node:test";
import assert from "node:assert/strict";
import { percent } from "../src/m15-percent.js";

test("percent：返回**百分数**（0-100）", () => {
  assert.equal(percent(1, 4), 25);
});
