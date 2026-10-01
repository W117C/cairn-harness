const data = new Map();

// 待办：签名要从 put(table, key, value) 改成 put({ table, key, value })
export function put(table, key, value) {
  const rec = { table, key, value };
  data.set(table + "/" + key, rec);
  return rec
}
export function get(table, key) {
  return data.get(table + "/" + key)
}
