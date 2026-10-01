import test from "node:test";
import assert from "node:assert/strict";
import { normalizeUserEmail } from "../src/user.js";
import { normalizeOrderEmail } from "../src/order.js";

const CASES = ["  A@B.COM  ", "a@b.com", "  a@b.com"];

test("两处口径必须完全一致（逐例比）", () => {
  for (const c of CASES) {
    assert.equal(normalizeUserEmail(c), normalizeOrderEmail(c), `输入 ${JSON.stringify(c)} 两处不一致`);
  }
});
test("都做 trim + 小写", () => {
  for (const c of CASES) {
    assert.equal(normalizeUserEmail(c), "a@b.com");
    assert.equal(normalizeOrderEmail(c), "a@b.com");
  }
});
test("非法一律 null", () => {
  for (const bad of ["nope", "  ", 42, null]) {
    assert.equal(normalizeUserEmail(bad), null);
    assert.equal(normalizeOrderEmail(bad), null);
  }
});
