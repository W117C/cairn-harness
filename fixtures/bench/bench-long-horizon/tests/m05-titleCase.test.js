import test from "node:test";
import assert from "node:assert/strict";
import { titleCase } from "../src/m05-titleCase.js";

test("titleCase：每词首字母大写，**其余转小写**", () => {
  assert.equal(titleCase("hello WORLD"), "Hello World");
});
