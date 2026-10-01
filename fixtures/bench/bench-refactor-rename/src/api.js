// 对外唯一入口：都在这个对象上
export const api = {
  getUser(id) { return { id, name: "user-" + String(id) } },
  listOrders(id) { return [{ id: 1, user: id }] },
};
