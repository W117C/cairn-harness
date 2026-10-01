import test from "node:test";
import assert from "node:assert/strict";
import { exportUsers } from "../src/report.js";

test("导出带表头，且转义生效", () => {
  const out = exportUsers([{ id: 1, name: "a,b", note: null }]);
  assert.equal(out, 'id,name,note\n1,"a,b",');
});
