import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const exp = JSON.parse(readFileSync(new URL("./expected.json", import.meta.url), "utf8"));
test("48 级流水线逐级跑通", async () => {
  let v = exp.input;
  for (let i = 1; i <= 48; i += 1) {
    const mod = await import("../src/s" + String(i).padStart(2, "0") + ".js");
    v = mod["step" + String(i)](v);
    assert.equal(v, exp.stages[i - 1], "第 " + String(i) + " 级输出不对");
  }
});
