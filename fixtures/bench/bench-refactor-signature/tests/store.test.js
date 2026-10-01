import test from "node:test";
import assert from "node:assert/strict";
import { put, get } from "../src/store.js";
import { saveUser } from "../src/users.js";
import { saveOrder } from "../src/orders.js";
import { audit } from "../src/audit.js";

test("put 收选项对象", () => {
  const r = put({ table: "t", key: "k", value: 1 });
  assert.deepEqual(r, { table: "t", key: "k", value: 1 });
  assert.deepEqual(get("t", "k"), { table: "t", key: "k", value: 1 });
});
test("三个调用点都改用新签名", () => {
  assert.deepEqual(saveUser(1, "a"), { table: "users", key: "1", value: { name: "a" } });
  assert.deepEqual(saveOrder(2, 9), { table: "orders", key: "2", value: { total: 9 } });
  const a = audit("login");
  assert.equal(a.table, "audit");
  assert.deepEqual(a.value, { action: "login" });
});
