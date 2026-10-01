// 转义 & < > 三个字符
export function escapeHtml(s) { return s.replace(/</g, "&lt;").replace(/>/g, "&gt;") }
