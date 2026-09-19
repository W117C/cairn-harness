/* 渲染层叶子：DOM 查询、元素引用与轻提示。
   只放无业务状态的公共底座——app.js 与各 UI 模块都从这里取，避免反向依赖 app.js 成环。 */
export const $ = (sel) => document.querySelector(sel);
export const sessionList = $('#sessionList');
export const streamInner = $('#streamInner');
export const promptInput = $('#promptInput');
const toastEl = $('#toast');
let toastTimer;

export function toast(text) {
  toastEl.textContent = text;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 1800);
}

export function esc(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
