import test from "node:test";
import assert from "node:assert/strict";
import { deepMerge } from "../src/m18-deepMerge.js";

test("deepMerge：**深**合并（嵌套对象不整个覆盖）", () => {
  assert.deepEqual(deepMerge({x:{p:1,q:2}}, {x:{q:9}}), {x:{p:1,q:9}});
});
