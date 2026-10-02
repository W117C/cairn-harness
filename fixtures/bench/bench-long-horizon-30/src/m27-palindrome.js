// 判回文（忽略大小写与空格）
export function palindrome(s) { return s === [...s].reverse().join("") }
