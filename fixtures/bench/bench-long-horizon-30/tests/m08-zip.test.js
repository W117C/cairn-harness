import test from "node:test";
import assert from "node:assert/strict";
import { zip } from "../src/m08-zip.js";

test("zip：**按较长者**配对，缺的用 null 填", () => {
  assert.deepEqual(zip([1,2,3], ["a"]), [[1,"a"],[2,null],[3,null]]);
});
