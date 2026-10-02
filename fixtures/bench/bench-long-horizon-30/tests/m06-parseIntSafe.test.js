import test from "node:test";
import assert from "node:assert/strict";
import { parseIntSafe } from "../src/m06-parseIntSafe.js";

test("parseIntSafe：解析失败返回 fallback，不是 NaN", () => {
  assert.equal(parseIntSafe("12", 0), 12)
  assert.equal(parseIntSafe("x", 7), 7);
});
