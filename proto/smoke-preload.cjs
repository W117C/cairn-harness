// smoke 用 preload：注入最小 window.agent（真实 IPC 桥的形态样例）
const { contextBridge, ipcRenderer } = require('electron');
function sub(ch, cb) {
  ipcRenderer.on(ch, (_e, p) => cb(p));
  return () => ipcRenderer.removeAllListeners(ch);
}
contextBridge.exposeInMainWorld('agent', {
  listSessions: () => Promise.resolve([
    { id: '2026-09-15T02-11-00Z', mtimeMs: Date.now() - 3600e3, lines: 8 },
    { id: '2026-09-15T01-05-00Z', mtimeMs: Date.now() - 7200e3, lines: 5 },
  ]),
  openSession: (id) => Promise.resolve({ events: [
    { type: 'session_meta' },
    { type: 'user_message', content: '帮我修复认证中间件 TTL 的竞态。’'.replace('’', '\u2019') },
    { type: 'assistant_delta', callId: 'c1', text: '好的，我先看' },
    { type: 'assistant_delta', callId: 'c1', text: '现有实现。' },
    { type: 'assistant_message', content: '好的，我先看现有实现。' },
    { type: 'plan_proposed', callId: 'p1', plan: { goal: '作用域化 TTL', files: [{ action: 'edit', path: 'src/auth/session.ts' }], approach: '…' } },
    { type: 'usage', inputTokens: 1200, outputTokens: 340 },
  ] }),
  createSession: () => Promise.resolve({ id: '2026-09-15T03-00-00Z' }),
  run: () => Promise.resolve({ ok: true }),
  deleteSession: () => Promise.resolve({}),
  decide: () => Promise.resolve(true),
  decidePlan: () => Promise.resolve(true),
  onEvent: (cb) => sub('agent:event', cb),
  onAsk: (cb) => sub('agent:ask', cb),
  onAskDone: (cb) => sub('agent:ask-done', cb),
});