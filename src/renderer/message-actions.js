import { promptInput, toast } from './dom.js';

/* ============ 消息操作行：复制 / 撤回 / 重新生成 + 发出时间 ============
   滚动动作由调用方传入（scrollStream 住在 app.js 的滚动区，那段有验收探针按文本切片，不搬）。 */
const MSG_ICONS = {
  copy: '<svg class="ic-act" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2.5"/><path d="M15.5 6.5V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7.5a2 2 0 0 0 2 2h.5"/></svg>',
  undo: '<svg class="ic-act" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9h10a5 5 0 0 1 0 10h-3"/><path d="m8 5-4 4 4 4"/></svg>',
  regen: '<svg class="ic-act" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 9a8 8 0 1 0 .9 4.4"/><path d="M20 4v5h-5"/></svg>',
  fork: '<svg class="ic-act" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3v9"/><circle cx="6" cy="17" r="2.5"/><circle cx="17" cy="6" r="2.5"/><circle cx="17" cy="17" r="2.5"/><path d="M17 8.5a5 5 0 0 1-5 5h-3.5"/></svg>',
};
const MSG_DONE_ICON = '<svg class="ic-done" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="m8.5 12.5 2.5 2.5 4.5-5"/></svg>';
export function actBtn(kind, label) {
  return '<button class="msg-act" type="button" data-msg-act="' + kind + '" aria-label="' + label +
    '" data-label="' + label + '">' + MSG_ICONS[kind] + MSG_DONE_ICON + '</button>';
}
/* 用户消息：复制 / 撤回；AI 回复：复制 / 重新生成 / 分叉 / 撤回并重发。
   时间戳与 token 消耗只挂 AI 侧（回合去重），用户侧操作行保持精简 */
export function actionsHTML(role, time, dur, tokens) {
  const acts = role === 'user'
    ? actBtn('copy', '复制这条消息') + actBtn('undo', '撤回这条消息')
    : actBtn('copy', '复制这条回复') + actBtn('regen', '重新生成这条回复') + actBtn('fork', '从这里分叉对话') + actBtn('undo', '撤回上一条并重发');
  const meta = dur
    ? '<span class="dur">输出用时 ' + dur + '</span><span class="sep" aria-hidden="true">·</span>' +
      (tokens ? '<span class="tok">' + tokens + ' tokens</span><span class="sep" aria-hidden="true">·</span>' : '')
    : '';
  return '<div class="msg-actions">' + acts +
    (role === 'user' ? '' : '<span class="sp"></span>' + meta + '<span class="t">' + time + '</span>') +
    '</div>';
}
export function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) {
    return navigator.clipboard.writeText(text).then(() => true).catch(() => legacyCopy(text));
  }
  return legacyCopy(text);
}
export function legacyCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.cssText = 'position:fixed;top:0;left:-9999px';
  document.body.appendChild(ta);
  ta.select();
  ta.setSelectionRange(0, ta.value.length);
  let ok = false;
  try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
  ta.remove();
  return ok;
}
export function messageText(msg) {
  if (msg.classList.contains('user')) {
    const b = msg.querySelector('.bubble');
    return b ? b.innerText.trim() : '';
  }
  return Array.from(msg.querySelectorAll('.ai-text'))
    .map(el => el.innerText.trim()).filter(Boolean).join('\n\n');
}
export function markActDone(btn) {
  btn.classList.add('is-done');
  clearTimeout(btn._doneTimer);
  btn._doneTimer = setTimeout(() => btn.classList.remove('is-done'), 1400);
}
export function backToInput(text) {
  promptInput.value = text;
  promptInput.style.height = 'auto';
  promptInput.style.height = Math.min(promptInput.scrollHeight, 140) + 'px';
  promptInput.focus();
  const dot = text.length;
  try { promptInput.setSelectionRange(dot, dot); } catch (e) { /* 非文本控件时忽略 */ }
}
export function retype(msg, scroll) {
  const target = msg.querySelector('.ai-text');
  if (!target || msg._retyping) return;
  const full = target.textContent;
  if (!full) return;
  msg._retyping = true;
  const started = Date.now();
  target.innerHTML = '<span class="stream-text"></span><span class="stream-caret" aria-hidden="true"></span>';
  const span = target.querySelector('.stream-text');
  const durEl = msg.querySelector('.msg-actions .dur');
  let i = 0;
  const timer = setInterval(() => {
    span.textContent = full.slice(0, ++i);
    if (i % 6 === 0) scroll();
    if (i >= full.length) {
      clearInterval(timer);
      target.textContent = full;
      msg._retyping = false;
      if (durEl) durEl.textContent = '输出用时 ' + ((Date.now() - started) / 1000).toFixed(1) + 's';
      scroll();
    }
  }, 24);
}
