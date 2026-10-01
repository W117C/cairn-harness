import test from "node:test";
import assert from "node:assert/strict";
import { api } from "../src/api.js";
import { cartOwner } from "../src/cart.js";
import { orderOwner } from "../src/orders.js";
import { adminLookup } from "../src/admin.js";

test("新名字 fetchUser 可用", () => {
  assert.equal(api.fetchUser(2).name, "user-2");
});
test("旧名字 getUser 不再保留", () => {
  assert.equal(api.getUser, undefined);
});
test("三个调用点都跟着改了", () => {
  assert.equal(cartOwner(3), "user-3");
  assert.equal(orderOwner(4), "user-4");
  assert.equal(adminLookup(5).name, "user-5");
});
