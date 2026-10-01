import test from "node:test";
import assert from "node:assert/strict";
import { setVerbose, isVerbose } from "../src/logger.js";
import { parseArgs } from "../src/parse-args.js";

// 待实现：解析出来的 verbose 要能喂给 logger
test("parseArgs 的结果可以直接喂 setVerbose", () => {
  const r = parseArgs(["--verbose"]);
  setVerbose(r.verbose);
  assert.equal(isVerbose(), true);
  setVerbose(false);
  assert.equal(isVerbose(), false);
});
