import test from "node:test";
import assert from "node:assert/strict";
import { parseArgs } from "../src/parse-args.js";

test("--name 取值", () => {
  assert.equal(parseArgs(["--name", "x"]).name, "x");
});
// 待实现：--verbose 打开 verbose，且不进 rest
test("--verbose 置位且不进 rest", () => {
  const r = parseArgs(["--verbose", "--name", "x"]);
  assert.equal(r.verbose, true);
  assert.deepEqual(r.rest, []);
});
test("--verbose 与位置参数共存", () => {
  const r = parseArgs(["a", "--verbose"]);
  assert.equal(r.verbose, true);
  assert.deepEqual(r.rest, ["a"]);
});
