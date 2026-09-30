// 金额格式化：把「分」渲染成人看的字符串。
// 已知问题：没有补足两位小数，整角金额渲染成 "$3.5" 而不是 "$3.50"。
export function money(cents) {
  return "$" + (cents / 100);
}
