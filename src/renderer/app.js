import { projectHistory, mountHistory } from './history-window.js';
import { projectPanelData } from './projections';
/* ============ 图标 ============ */
const ICONS = {
  pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5"/><path d="M9 3h6l-1 7 3 2.5V15H7v-2.5L10 10Z"/></svg>',
  archive: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8M10 12h4"/></svg>',
  unarchive: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8"/><path d="m9.5 15 2.5-2.5L14.5 15M12 12.5V18"/></svg>',
  pinSm: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5"/><path d="M9 3h6l-1 7 3 2.5V15H7v-2.5L10 10Z"/></svg>',
  folder: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/></svg>',
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>',
  chevR: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="m9 6 6 6-6 6"/></svg>',
  sort: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M7 4v13m0 0-3-3m3 3 3-3M17 20V7m0 0-3 3m3-3 3 3"/></svg>',
  pencil: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
  dots: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="5.5" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="12" cy="18.5" r="1.7"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13"/></svg>'
};

/* 运行中动效：九宫格（9 个小正方形），逐格顺时针点亮 = 颜色转圈加载。
   格子的相位差写在 CSS 的 nth-child 上，所以这里只需 9 个空 <i>。
   variant='proc' 用于聊天流的过程层（大一号、走 --dim 浅灰）。
   纯装饰，状态由所在行的文字与 aria-label 播报 */
const runGrid = (variant) =>
  '<span class="run-grid' + (variant ? ' ' + variant : '') + '" aria-hidden="true">' +
  '<i></i>'.repeat(9) + '</span>';
const RUN_GRID_HTML = runGrid();

/* ============ 会话数据 ============ */
/* 排序方式：recent=最近活动在前，title=标题 A→Z */
let sortBy = 'recent';

const FOLDERS = [
  { id: 'f1', name: 'auth 重构工作区', open: true },
  { id: 'f2', name: '性能优化', open: true }
];

let sessions = [
  { id: 's1', title: '重构认证中间件', time: '14:02', group: 'today', pinned: true, folder: 'f1', rank: 1 },
  { id: 's2', title: '修复 WebSocket 重连竞态', time: '11:38', group: 'today', pinned: false, folder: 'f1', rank: 2 },
  { id: 's3', title: '设计系统 token 迁移', time: '20:18', group: 'yesterday', pinned: false, folder: 'f1', rank: 3 },
  { id: 's4', title: '优化表格虚拟滚动', time: '09:15', group: 'today', pinned: false, folder: 'f2', rank: 1, running: true },
  { id: 's5', title: '排查 CI 缓存失效', time: '09:47', group: 'yesterday', pinned: false, folder: 'f2', rank: 2 },
  { id: 's6', title: '编写 e2e 冒烟测试', time: '周二', group: 'week', pinned: false, folder: null, rank: 1 },
  { id: 's7', title: 'CLI 参数解析重构', time: '周一', group: 'week', pinned: false, folder: null, rank: 2 },
  { id: 's8', title: '数据库索引调优', time: '8月30日', group: 'earlier', pinned: false, folder: null, rank: 3 }
];

let archived = [
  { id: 'a1', title: '旧版桌面通知迁移', time: '8月12日' }
];

/* VIS-06：真实判别「活跃会话 / 归档会话」。原代码 `!item.dataset.archived` 读的是
   sessionItemHTML 永不输出的属性 → 恒为 undefined → 恒真，是死代码。
   改为以归档数据模型为准的谓词；`data-archived` 钩子名保留，由 sessionItemHTML
   按该模型渲染到会话行上（活跃项 "false"，归档项 "true"）。 */
function isArchivedSession(id) {
  return archived.some(a => a.id === id);
}

let selectedId = 's1';
let archiveOpen = false;
let query = '';

/* ============ 工具 ============ */
const $ = (sel) => document.querySelector(sel);
const sessionList = $('#sessionList');
const toastEl = $('#toast');
let toastTimer;

function toast(text) {
  toastEl.textContent = text;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 1800);
}

function esc(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* ============ diff 内置轻量 tokenizer（TS 为主，无外部依赖） ============
   按优先级分组匹配：注释 > 字符串 > 关键字 > 数字 > 函数调用 > 属性访问。
   只对 .diff .ln 生效，行首的 +/- 前缀与缩进原样保留 */
const TS_TOKENS =
  /(\/\/.*$)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|((?:\b(?:abstract|as|async|await|break|case|catch|class|const|continue|declare|default|delete|do|else|enum|export|extends|false|finally|for|from|function|get|if|implements|import|in|instanceof|interface|keyof|let|namespace|new|null|of|private|protected|public|readonly|return|satisfies|set|static|super|switch|this|throw|true|try|type|typeof|undefined|var|void|while)\b))|((?:\b(?:0[xXbBoO][\da-fA-F_]+|\d+(?:\.\d+)?)\b))|((?:\b[a-zA-Z_$][\w$]*(?=\s*\()))|((?:\.\b[a-zA-Z_$][\w$]*\b))/g;
const TK_CLASS = ['', 'tk-com', 'tk-str', 'tk-kw', 'tk-num', 'tk-fn', 'tk-prop'];

function highlightDiffLine(line) {
  /* 行首 [空格][-+|! 前缀][空格] 原样保留，只对代码部分做 token */
  const preM = line.match(/^(\s*[-+!]?\s*)/);
  const pre = preM ? preM[1] : '';
  if (pre) line = line.slice(pre.length);
  let html = pre, last = 0;
  TS_TOKENS.lastIndex = 0;
  let m;
  while ((m = TS_TOKENS.exec(line))) {
    html += esc(line.slice(last, m.index));
    let cls = '';
    for (let g = 1; g <= 6; g++) if (m[g] !== undefined) { cls = TK_CLASS[g]; break; }
    html += cls === 'tk-com'
      ? '<span class="tk-com">' + esc(m[0]) + '</span>'   // 行注释吞到行尾
      : cls
        ? '<span class="' + cls + '">' + esc(m[0]) + '</span>'
        : esc(m[0]);
    if (cls === 'tk-com') { last = line.length; break; }
    last = m.index + m[0].length;
  }
  html += esc(line.slice(last));
  return html;
}

function highlightAllDiffs(root) {
  const rows = (root || document).querySelectorAll('.diff .ln:not(.hunk)');
  rows.forEach(row => {
    if (row.dataset.tokenized) return;
    row.innerHTML = highlightDiffLine(row.textContent);
    row.dataset.tokenized = '1';
  });
}

/* ============ 会话列表渲染 ============ */
function cmpSessions(a, b) {
  if (sortBy === 'title') return a.title.localeCompare(b.title, 'zh-Hans-CN');
  const wa = a.pinned ? 0 : 1, wb = b.pinned ? 0 : 1;
  if (wa !== wb) return wa - wb;
  const ga = GROUP_SEQ.indexOf(a.group), gb = GROUP_SEQ.indexOf(b.group);
  if (ga !== gb) return ga - gb;
  return a.rank - b.rank;
}
const GROUP_SEQ = ['today', 'yesterday', 'week', 'earlier'];

function sessionItemHTML(s, inFolder) {
  const pinBtn = s.pinned
    ? '<button class="sb-item act-pin" data-act="pin" aria-pressed="true">' + ICONS.pin + '<span class="sb-lab">取消置顶</span></button>'
    : '<button class="sb-item act-pin" data-act="pin" aria-pressed="false">' + ICONS.pin + '<span class="sb-lab">置顶</span></button>';
  return (
    '<div class="session' + (s.pinned ? ' pinned' : '') + (s.running ? ' running' : '') + (inFolder ? ' in-folder' : '') + '" role="button" tabindex="0" data-id="' + s.id + '" data-archived="' + (isArchivedSession(s.id) ? 'true' : 'false') + '"' +
    (selectedId === s.id ? ' aria-current="true"' : '') +
    (s.running ? ' aria-label="' + esc(s.title) + '，模型运行中"' : '') + '>' +
      '<div class="session-row">' +
        '<span class="session-title">' +
          (s.running ? RUN_GRID_HTML : '') +
          (s.pinned ? '<span class="pin-ind">' + ICONS.pinSm + '</span>' : '') +
          '<span class="s-txt">' + esc(s.title) + '</span>' +
        '</span>' +
        '<div class="session-actions" data-sid="' + s.id + '">' +
          '<button class="sb-trigger" type="button" aria-label="更多会话操作" title="更多操作" aria-haspopup="true" aria-expanded="false">' + ICONS.dots + '</button>' +
          '<div class="sb-menu" hidden>' +
            '<div class="sb-group">' +
              pinBtn +
              '<button class="sb-item act-rename" data-act="rename" aria-pressed="false">' + ICONS.pencil + '<span class="sb-lab">重命名</span></button>' +
            '</div>' +
            '<div class="sb-group">' +
              '<button class="sb-item act-archive" data-act="archive" aria-pressed="false">' + ICONS.archive + '<span class="sb-lab">归档</span></button>' +
              '<button class="sb-item act-delete danger" data-act="delete" aria-pressed="false">' + ICONS.trash + '<span class="sb-lab">删除会话</span></button>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>' +
    '</div>'
  );
}

function folderRowHTML(f, count) {
  return (
    '<div class="folder-row" role="button" tabindex="0" data-folder="' + f.id + '"' +
    ' aria-expanded="' + String(f.open) + '" aria-label="分组 ' + esc(f.name) + '，' + count + ' 个会话">' +
      '<svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="m9 6 6 6-6 6"/></svg>' +
      '<span class="f-icon">' + ICONS.folder + '</span>' +
      '<span class="f-name">' + esc(f.name) + '</span>' +
    '</div>'
  );
}

function render() {
  closeSbMenus();   // 重绘前先收起面板，避免宿主销毁后菜单悬挂在 body
  const q = query.trim().toLowerCase();
  const visible = sessions.filter(s =>
    !q || s.title.toLowerCase().includes(q)
  );
  let html = '';

  /* —— 置顶：单独一组，位于项目之上；置顶会话从原位置移出 —— */
  const pinnedList = visible.filter(s => s.pinned).sort(cmpSessions);
  if (pinnedList.length) {
    html += '<div class="group-label">' + ICONS.pinSm + '置顶</div>';
    html += pinnedList.map(s => sessionItemHTML(s, false)).join('');
  }

  /* —— 项目：工作区分组，其下的对话直接平铺（不含置顶） —— */
  const folderSessions = visible.filter(s => s.folder && !s.pinned);
  const hasFolders = FOLDERS.some(f => folderSessions.some(s => s.folder === f.id));
  if (hasFolders) {
    html += '<div class="group-label">' + ICONS.folder + '项目</div>';
  }
  for (const f of FOLDERS) {
    const items = folderSessions.filter(s => s.folder === f.id).sort(cmpSessions);
    if (!items.length) continue;
    html += folderRowHTML(f, items.length);
    if (f.open || q) {
      html += items.map(s => sessionItemHTML(s, true)).join('');
    }
  }

  /* —— 最近：不隶属任何工作区的会话（不含置顶） —— */
  const recents = visible.filter(s => !s.folder && !s.pinned).sort(cmpSessions);
  if (recents.length) {
    html += '<div class="group-label">' + ICONS.clock + '最近';
    if (!q) {
      html += '<button class="sort-btn" id="sortToggle" aria-label="切换排序方式">' +
        ICONS.sort + (sortBy === 'recent' ? '时间' : '字母') + '</button>';
    }
    html += '</div>';
    html += recents.map(s => sessionItemHTML(s, false)).join('');
  }

  if (!html) html = '<div class="empty-note">没有匹配「' + esc(query) + '」的会话</div>';
  sessionList.innerHTML = html;
}

/* ============ 会话操作 ============ */
/* 对话流为空时没有一条消息，对话线自然一根都不显示；这里补上空状态说明 */
const CHAT_EMPTY_HTML =
  '<div class="chat-empty" data-od-id="chat-empty">' +
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a8 8 0 0 1-8 8H4l2-3.2A8 8 0 1 1 21 12Z"/><path d="M8.5 11h7M8.5 14.5h4"/></svg>' +
    '<div class="ce-title">开始一段新对话</div>' +
    '<div class="ce-sub">在下方输入需求即可开始。左侧的对话线会随一轮轮对话逐根出现。</div>' +
    '<button class="ce-back" type="button" id="backToLast">返回上一个对话</button>' +
  '</div>';
let transcriptOpen = true;

function showEmptyStream() {
  transcriptOpen = false;
  streamInner.innerHTML = CHAT_EMPTY_HTML;
  const back = $('#backToLast');
  if (back) back.addEventListener('click', () => { selectSession(selectedId, true); });
}
function restoreTranscript() {
  transcriptOpen = true;
  streamInner.innerHTML = INITIAL_TRANSCRIPT;
  streamInner.querySelectorAll('.msg').forEach(observeMsg);
  scrollStream();
}

function selectSession(id, force) {
  if (id === null) {
    selectedId = null;
    closeSbMenus();
    render();
    return;
  }
  selectedId = id;
  closeSbMenus();
  const s = sessions.find(x => x.id === id);
  if (s) $('#chatTitle').textContent = s.title;
  if (!transcriptOpen || force) restoreTranscript();
  render();
}

function pinSession(id) {
  const s = sessions.find(x => x.id === id);
  if (!s) return;
  s.pinned = !s.pinned;
  if (s.pinned) { s.prevGroup = s.group; toast('已置顶「' + s.title + '」'); }
  else { s.group = s.prevGroup || 'earlier'; toast('已取消置顶'); }
  render();
}

function archiveSession(id) {
  const i = sessions.findIndex(x => x.id === id);
  if (i < 0) return;
  const [s] = sessions.splice(i, 1);
  if (s.pinned) s.pinned = false;
  archived.unshift(s);
  toast('已归档「' + s.title + '」');
  render();
}

function unarchiveSession(id) {
  const i = archived.findIndex(x => x.id === id);
  if (i < 0) return;
  const [s] = archived.splice(i, 1);
  s.group = s.prevGroup || 'earlier';
  s.pinned = false;
  sessions.push(s);
  toast('已恢复「' + s.title + '」');
  render();
}

function deleteArchived(id) {
  const i = archived.findIndex(x => x.id === id);
  if (i < 0) return;
  const [s] = archived.splice(i, 1);
  toast('已删除归档「' + s.title + '」');
  render();
}

function deleteSession(id) {
  const i = sessions.findIndex(x => x.id === id);
  if (i < 0) return;
  const [s] = sessions.splice(i, 1);
  if (selectedId === id) selectSession(null);
  else {
    closeSbMenus();
    toast('已删除「' + s.title + '」');
    render();
  }
}

function toggleFolder(id) {
  const f = FOLDERS.find(x => x.id === id);
  if (!f) return;
  f.open = !f.open;
  render();
}

/* ============ 重命名 ============ */
function startRename(sessionEl, id) {
  if (sessionEl.classList.contains('editing')) return;
  const s = sessions.find(x => x.id === id);
  if (!s) return;
  sessionEl.classList.add('editing');
  const row = sessionEl.querySelector('.session-row');
  row.innerHTML = '<input class="rename-input" type="text" value="' + esc(s.title) + '" aria-label="重命名会话">';
  const input = row.querySelector('.rename-input');
  input.focus();
  input.select();

  let done = false;
  const finish = (save) => {
    if (done) return;
    done = true;
    if (save) {
      const v = input.value.trim();
      if (v && v !== s.title) {
        s.title = v;
        if (selectedId === id) $('#chatTitle').textContent = v;
        toast('已重命名为「' + v + '」');
      }
    }
    render();
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    e.stopPropagation();
  });
  input.addEventListener('blur', () => finish(true));
  input.addEventListener('click', (e) => e.stopPropagation());
}

/* 会话操作菜单：仅点击省略号展开；点击对话行只选中、不展开菜单。
   打开时菜单临时挂到 body（脱离 sidebar 的 transform，fixed 才能按视口定位），关闭时送回原位 */
const sbHome = new WeakMap();
let openSbBox = null;
function sbMenuOf(box) { return box._sbMenu || (box._sbMenu = box.querySelector('.sb-menu')); }
function closeSbMenus() {
  if (!openSbBox) return;
  const box = openSbBox;
  openSbBox = null;
  box.classList.remove('open');
  const menu = sbMenuOf(box);
  if (menu) {
    if (menu.parentElement === document.body && sbHome.get(menu)) {
      const home = sbHome.get(menu);
      if (home && home.isConnected) home.appendChild(menu);  // 送回原位
      else menu.remove();                                    // 原宿主已被重绘销毁，直接释放
    }
    menu.hidden = true;          // 无论是否移回，都必须隐藏；并清掉 inline 定位
    menu.style.position = '';
    menu.style.left = '';
    menu.style.top = '';
    menu.style.right = '';
    menu.style.margin = '';
  }
  const trig = box.querySelector('.sb-trigger');
  if (trig) trig.setAttribute('aria-expanded', 'false');
}
function openSbMenu(box) {
  closeSbMenus();
  openSbBox = box;
  box.classList.add('open');
  const menu = sbMenuOf(box);
  const trig = box.querySelector('.sb-trigger');
  if (!menu) return;
  if (!sbHome.has(menu)) sbHome.set(menu, menu.parentElement);
  document.body.appendChild(menu);
  menu.hidden = false;
  if (trig) trig.setAttribute('aria-expanded', 'true');
  positionSbMenu(menu, trig);
}
/* 菜单用 fixed 定位按视口实时计算（菜单已挂到 body，起效）：默认向左弹出，
   放不下自动翻到右侧，并钳制在视口内（避免窄栏/窄窗下被屏幕边缘裁剪） */
function positionSbMenu(menu, trig) {
  if (!menu || !trig) return;
  const tr = trig.getBoundingClientRect();
  const mw = menu.offsetWidth || 178;
  const mh = menu.offsetHeight || 160;
  let left = tr.left - mw - 6;
  if (left < 4) left = tr.right + 6;               // 翻转到右侧
  left = Math.max(4, Math.min(left, window.innerWidth - mw - 4));
  const top = Math.max(4, Math.min(tr.top + tr.height / 2 - mh / 2, window.innerHeight - mh - 4));
  menu.style.position = 'fixed';
  menu.style.left = left + 'px';
  menu.style.top = top + 'px';
  menu.style.right = 'auto';
  menu.style.margin = '0';
}
function toggleSbMenu(trigger) {
  const box = trigger.closest('.session-actions');
  if (!box) return;
  if (box.classList.contains('open')) { closeSbMenus(); return; }
  openSbMenu(box);
}
 sessionList.addEventListener('click', (e) => {
  const trigger = e.target.closest('.sb-trigger');
  if (trigger) { e.stopPropagation(); toggleSbMenu(trigger); return; }
  closeSbMenus();
  const folderRow = e.target.closest('.folder-row');
  if (folderRow) { toggleFolder(folderRow.dataset.folder); return; }
  const sortBtn = e.target.closest('.sort-btn');
  if (sortBtn) {
    sortBy = sortBy === 'recent' ? 'title' : 'recent';
    toast(sortBy === 'recent' ? '已按最近活动排序' : '已按标题排序');
    render();
    return;
  }
  const item = e.target.closest('.session');
  if (item && item.dataset.archived !== 'true') selectSession(item.dataset.id);
});

/* 操作面板挂在 body 上时，菜单项点击改由 document 接收；
   会话上下文取自 openSbBox（打开菜单的会话行） */
document.addEventListener('click', (e) => {
  const actEl = e.target.closest('.sb-item[data-act]');
  if (!actEl || !openSbBox) return;
  const item = openSbBox.closest('.session');
  if (!item) return;
  e.stopPropagation();
  const act = actEl.dataset.act;
  if (act === 'pin') pinSession(item.dataset.id);
  else if (act === 'archive') archiveSession(item.dataset.id);
  else if (act === 'delete') deleteSession(item.dataset.id);
  else if (act === 'rename') startRename(item, item.dataset.id);
  closeSbMenus();
});

/* 点击任意处收起会话面板：只有面板自身与省略号除外（它们各自有处理） */
document.addEventListener('click', (e) => {
  if (!openSbBox) return;
  if (e.target.closest('.sb-menu') || e.target.closest('.sb-trigger')) return;
  closeSbMenus();
});

sessionList.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    const open = document.querySelector('.session-actions.open');
    if (open) {
      closeSbMenus();
      open.querySelector('.sb-trigger')?.focus();
      e.stopPropagation();
    }
    return;
  }
  if (e.key === 'Tab') {
    if (document.querySelector('.session-actions.open')) closeSbMenus();
    return;
  }
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const folderRow = e.target.closest('.folder-row');
  if (folderRow) { e.preventDefault(); toggleFolder(folderRow.dataset.folder); return; }
  const sortBtn = e.target.closest('.sort-btn');
  if (sortBtn) { e.preventDefault(); sortBtn.click(); return; }
  const item = e.target.closest('.session');
  if (item && item.dataset.archived !== 'true') { e.preventDefault(); selectSession(item.dataset.id); }
});

$('#searchInput').addEventListener('input', (e) => { query = e.target.value; render(); });
/* 新建对话：清空整条流（对话线随之全部消失），并给出可回退的空状态 */
$('#newChat').addEventListener('click', () => {
  showEmptyStream();
  toast('已新建对话，输入需求即可开始');
  promptInput.focus({ preventScroll: true });
});

/* ============ 设置面板 ============ */
const settingsOverlay = $('#settingsOverlay');
const settingsTitle = $('#settingsTitle');
const archListEl = $('#archList');
const SEC_NAMES = { general: '通用', model: '模型', appearance: '外观', archive: '归档', about: '关于' };
let settingsReturnFocus = null;

function renderArchive() {
  if (!archived.length) {
    archListEl.innerHTML =
      '<div class="settings-empty">' + ICONS.archive + '<p>暂无已归档的会话</p></div>';
    return;
  }
  archListEl.innerHTML = archived.map(s =>
    '<div class="arch-row" data-id="' + s.id + '">' +
      '<span class="ar-ico" aria-hidden="true">' + ICONS.archive + '</span>' +
      '<div class="ar-text"><div class="ar-name">' + esc(s.title) + '</div>' +
      '<div class="ar-time">' + esc(s.time) + ' · 已归档</div></div>' +
      '<button class="ar-act" data-act="unarchive">恢复</button>' +
      '<button class="ar-del" data-act="delete" aria-label="删除归档" title="删除">' + ICONS.trash + '</button>' +
    '</div>').join('');
}

function showSettingsSection(sec) {
  if (!SEC_NAMES[sec]) sec = 'general';
  document.querySelectorAll('.sn-item').forEach(b => {
    b.setAttribute('aria-current', String(b.dataset.sec === sec));
  });
  document.querySelectorAll('.set-sec').forEach(s => { s.hidden = s.dataset.sec !== sec; });
  settingsTitle.textContent = SEC_NAMES[sec];
  if (sec === 'archive') renderArchive();
}
function openSettings(sec) {
  settingsReturnFocus = document.activeElement;
  settingsOverlay.classList.add('show');
  settingsOverlay.setAttribute('aria-hidden', 'false');
  settingsOverlay.removeAttribute('inert');
  syncThemeButtons();
  showSettingsSection(sec || 'general');
  $('#settingsClose').focus();
}
function closeSettings() {
  settingsOverlay.classList.remove('show');
  settingsOverlay.setAttribute('aria-hidden', 'true');
  settingsOverlay.setAttribute('inert', '');
  if (settingsReturnFocus && settingsReturnFocus.focus) settingsReturnFocus.focus();
}
$('#settingsOpen').addEventListener('click', () => openSettings('general'));
$('#settingsClose').addEventListener('click', closeSettings);
settingsOverlay.addEventListener('click', (e) => { if (e.target === settingsOverlay) closeSettings(); });
document.querySelector('.settings-nav').addEventListener('click', (e) => {
  const item = e.target.closest('.sn-item');
  if (item) showSettingsSection(item.dataset.sec);
});
document.querySelectorAll('.set-switch').forEach(sw => {
  sw.addEventListener('click', () => {
    sw.setAttribute('aria-checked', sw.getAttribute('aria-checked') === 'true' ? 'false' : 'true');
  });
});
/* 设置里的分段选择组（模型/思考程度/权限档）：点谁亮谁 */
document.querySelectorAll('.settings-body [data-grp]').forEach(grp => {
  grp.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-val]');
    if (!b) return;
    grp.querySelectorAll('button[data-val]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
  });
});
/* 减少动效：允许系统偏好之外手动关闭全部动画 */
document.querySelector('[data-reduce-motion]')?.addEventListener('click', () => {
  document.documentElement.classList.toggle('reduce-motion');
});
document.querySelectorAll('[data-set-theme]').forEach(b => {
  b.addEventListener('click', () => { applyTheme(b.dataset.setTheme); });
});
archListEl.addEventListener('click', (e) => {
  const act = e.target.closest('[data-act]');
  if (!act) return;
  const row = act.closest('.arch-row');
  if (act.dataset.act === 'unarchive') unarchiveSession(row.dataset.id);
  if (act.dataset.act === 'delete') deleteArchived(row.dataset.id);
  renderArchive();
});
$('#archiveToggle').addEventListener('click', () => openSettings('archive'));

/* ============ 主题：唯一的切换入口在设置 → 外观 ============ */
function syncThemeButtons() {
  const cur = document.documentElement.dataset.theme;
  document.querySelectorAll('[data-set-theme]').forEach(b => {
    b.setAttribute('aria-pressed', String(b.dataset.setTheme === cur));
  });
}
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  syncThemeButtons();
  try { localStorage.setItem('forge-theme', theme); } catch (_) {}
}
(function initTheme() {
  let stored = null;
  try { stored = localStorage.getItem('forge-theme'); } catch (_) {}
  const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  applyTheme(stored || (prefersDark ? 'dark' : 'light'));
})();

/* ============ 分隔条：拖动 / 键盘调整两侧面板宽度 ============ */
const SIDEBAR_MAX = 420;
const DRAWER_MAX  = 640;
const KEEP_CENTER = 380;           // 中栏至少保留的宽度，面板不能把对话流挤没
const sideMax   = () => Math.min(SIDEBAR_MAX, window.innerWidth - DRAWER_MAX  - KEEP_CENTER);
const drawerMax = () => Math.min(DRAWER_MAX,  window.innerWidth - SIDEBAR_MAX - KEEP_CENTER);

const gutters = [$('#gutterLeft'), $('#gutterRight')].filter(Boolean).map((el) => {
  const isLeft  = el.dataset.panel === 'sidebar';
  const key     = isLeft ? 'forge-sidebar-w' : 'forge-drawer-w';
  const prop    = isLeft ? '--sidebar-w' : '--drawer-w';
  const def     = parseFloat(el.dataset.def);
  const hardMin = parseFloat(el.dataset.min);
  const hardMax = parseFloat(el.dataset.max);
  const ceiling = () => Math.max(hardMin, Math.min(hardMax, isLeft ? sideMax() : drawerMax()));
  let width = def, drag = null;

  function apply() {
    document.documentElement.style.setProperty(prop, width + 'px');
    el.setAttribute('aria-valuenow', String(width));
    el.setAttribute('aria-valuemin', String(hardMin));
    el.setAttribute('aria-valuemax', String(ceiling()));
  }
  const clamp = (w) => Math.round(Math.min(Math.max(w, hardMin), ceiling()));
  const commit = () => { try { localStorage.setItem(key, String(width)); } catch (_) {} };

  el.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    drag = { x: e.clientX, w0: width, id: e.pointerId };
    el.classList.add('dragging');
    document.body.classList.add('resizing');
    try { el.setPointerCapture(e.pointerId); } catch (_) {}
    el.focus({ preventScroll: true });   // 拖完直接能用方向键微调
    e.preventDefault();
  });
  el.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x;
    width = clamp(drag.w0 + (isLeft ? dx : -dx));   // 右栏反向：向左拖变宽
    apply();
  });
  function endDrag(e) {
    if (!drag || (e && e.pointerId !== drag.id)) return;
    drag = null;
    el.classList.remove('dragging');
    document.body.classList.remove('resizing');
    commit();
    if (typeof scrollStream === 'function') scrollStream();  // 宽度变化后重新吸附底部
  }
  el.addEventListener('pointerup', endDrag);
  el.addEventListener('pointercancel', endDrag);
  el.addEventListener('dblclick', () => { width = def; apply(); commit(); });

  el.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 40 : 12;
    let next = null;
    if (e.key === 'ArrowLeft')       next = width + (isLeft ? -step : step);
    else if (e.key === 'ArrowRight') next = width + (isLeft ? step : -step);
    else if (e.key === 'Home')       next = def;
    else if (e.key === 'End')        next = ceiling();
    if (next === null) return;
    e.preventDefault();
    width = clamp(next); apply(); commit();
  });

  try {
    const stored = parseFloat(localStorage.getItem(key));
    if (stored >= hardMin && stored <= hardMax) width = stored;
  } catch (_) {}
  apply();
  return { remap: () => { width = clamp(width); apply(); } };
});

// 窗口变窄时把两侧面板重新收进可用范围，避免挤压中栏
let remapTimer = 0;
window.addEventListener('resize', () => {
  clearTimeout(remapTimer);
  remapTimer = setTimeout(() => gutters.forEach(g => g.remap()), 80);
});

/* ============ 右侧工作区侧栏：多标签 ============ */
const drawer = $('#drawer');
const shell = $('#shell');
const drawerToggle = $('#drawerToggle');
const sideTabsEl = $('#sideTabs');
const sidePagesEl = $('#sidePages');
const sideLauncher = $('#sideLauncher');
const drawerBody = $('#drawerBody');

function setDrawer(collapsed) {
  drawer.classList.toggle('collapsed', collapsed);
  shell.dataset.drawer = collapsed ? '0' : '1';   // 中栏据此收回右侧留宽
  drawerToggle.setAttribute('aria-pressed', String(!collapsed));
  try { localStorage.setItem('forge-drawer', collapsed ? '1' : '0'); } catch (_) {}
}
drawerToggle.addEventListener('click', () => setDrawer(!drawer.classList.contains('collapsed')));
$('#drawerClose').addEventListener('click', () => setDrawer(true));
try { if (localStorage.getItem('forge-drawer') === '1') setDrawer(true); } catch (_) {}

const FOLDER_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/></svg>';
const FILE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z"/><path d="M14 3v5h5"/></svg>';
const GLOBE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14.5 14.5 0 0 1 0 18M12 3a14.5 14.5 0 0 0 0 18"/></svg>';
const REVIEW_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="3"/><path d="M12 8v8M8 12h8"/></svg>';
const TERM_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="3"/><path d="m7 9 3 3-3 3M12.5 15H17"/></svg>';
const BRANCH_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3v12"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="6" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/></svg>';
const PLUS_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>';

const VIEW_META = {
  files:    { title: '工作区文件', icon: FOLDER_ICON },
  browser:  { title: '内置浏览器', icon: GLOBE_ICON },
  review:   { title: '审阅',       icon: REVIEW_ICON },
  terminal: { title: '终端',       icon: TERM_ICON },
  git:      { title: 'Git',        icon: BRANCH_ICON }
};

/* 展示用文件树；path 不是可执行工作区，真实运行目录仅取 AppSettings.workspace。 */
const WORKSPACES = [
  { id: 'ws1', name: 'coding-suite', path: '~/dev/coding-suite', current: true, tree: [
    { dir: 'src/auth', files: [
      { name: 'session.ts', plus: '+12', minus: '−4' },
      { name: 'ttl.ts', tag: '新增' },
      { name: 'middleware.ts' }
    ]},
    { dir: 'tests/auth', files: [
      { name: 'session.spec.ts', plus: '+8', minus: '−2' },
      { name: 'ttl.spec.ts', plus: '+21' }
    ]},
    { dir: 'src', files: [ { name: 'config.ts' } ] }
  ]},
  { id: 'ws2', name: 'docs-site', path: '~/dev/docs-site', tree: [
    { dir: 'docs/guide', files: [
      { name: 'getting-started.mdx', plus: '+46' },
      { name: 'permissions.mdx', tag: '新增' }
    ]},
    { dir: 'src/pages', files: [ { name: 'index.astro' } ] }
  ]},
  { id: 'ws3', name: 'edge-gateway', path: '~/work/edge-gateway', tree: [
    { dir: 'cmd/gateway', files: [ { name: 'main.go', plus: '+9', minus: '−3' } ]},
    { dir: 'internal/ratelimit', files: [
      { name: 'token_bucket.go', tag: '新增' },
      { name: 'token_bucket_test.go', plus: '+64' }
    ]}
  ]}
];
let currentWs = WORKSPACES[0];
/* 右栏五面板的唯一数据源：真实桥接层用 projectPanelData(会话事件, 运行目录) 填充。
   缺省为空 = 面板走空态。原先这里挂着审阅与终端两组演示常量，真运行时照样渲染
   「本会话从未碰过的文件 + 假测试输出」——假象比空白更坏，故一并删除
   （projections.ts 头注「面板 100% 事件流投影，无第二事实源」）。 */
let panelData = { workspace: null, files: [], tree: [], terminal: [], merge: [] };

/* 右栏"文件树高亮"目标：diff 卡展开时置为对应文档路径，收折清空 */
let activeFileDoc = null;

function panelEmptyHTML(title) {
  return '<div class="settings-empty">' + FILE_ICON +
    '<p>' + esc(title) + '<br><span class="dim">内容由本会话事件流投影，无数据即空</span></p></div>';
}
function filesViewHTML() {
  const ws = panelData.workspace;
  const head = '<div class="tree-ws">' + FOLDER_ICON +
    '<span class="tw-text"><span class="tw-name">' + esc(ws ? ws.name : '未配置运行目录') + '</span>' +
    '<span class="tw-path">' + esc(ws ? ws.path : '设置 → 通用 → 真实运行目录') + '</span></span></div>';
  const body = panelData.tree.length
    ? panelData.tree.map(g =>
      '<div class="tree-group">' +
        '<div class="tree-dir">' + FOLDER_ICON + '<span>' + esc(g.dir || '（根目录）') + '</span><span class="cnt">' + g.files.length + '</span></div>' +
        g.files.map(f => {
          const name = f.path.slice(f.path.lastIndexOf('/') + 1);
          const act = activeFileDoc === f.path;
          return '<div class="tree-file' + (act ? ' is-active' : '') + '"' + (act ? ' data-doc-active="' + esc(f.path) + '"' : '') + '>' + FILE_ICON + '<span class="nm">' + esc(name) + '</span>' +
            (f.added ? '<span class="plus">+' + f.added + '</span>' : '') +
            (f.removed ? '<span class="minus">−' + f.removed + '</span>' : '') +
            (f.created ? '<span class="new">新增</span>' : '') +
            '</div>';
        }).join('') +
      '</div>').join('')
    : panelEmptyHTML('本会话尚无写入文件');
  return '<div class="side-page-pad">' + head + body + '</div>';
}
function reviewViewHTML() {
  if (!panelData.files.length) return '<div class="side-page-pad">' + panelEmptyHTML('本会话尚无写入文件') + '</div>';
  return '<div class="side-page-pad">' + panelData.files.map(f =>
    '<div class="file-item">' + FILE_ICON + '<span class="path">' + esc(f.path) + '</span>' +
    (f.added ? '<span class="plus">+' + f.added + '</span>' : '') +
    (f.removed ? '<span class="minus">−' + f.removed + '</span>' : '') +
    (f.created ? '<span class="new">新增</span>' : '') +
    (f.ok === false ? '<span class="new">未落盘</span>' : '') +
    '</div>').join('') + '</div>';
}
function browserViewHTML() {
  return '<div class="side-page-pad">' + panelEmptyHTML('内置浏览器尚未接入') + '</div>';
}
/** 一条 shell 调用 → 终端行（命令 + 输出；输出转义，不解析为 HTML）。 */
function termBodyHTML(entry) {
  if (!entry) return '';
  const lines = ['<div><span class="p">$</span> ' + esc(entry.command) + '</div>'];
  if (entry.ok === null) lines.push('<div class="dim">执行中…</div>');
  else lines.push('<div class="' + (entry.ok ? 'ok' : 'dim') + '">' + (entry.ok ? '✓ 执行完成' : '✗ 执行失败') + '</div>');
  for (const ln of String(entry.output || '').split('\n')) lines.push('<div>' + esc(ln) + '</div>');
  return lines.join('');
}
function terminalViewHTML() {
  const rows = panelData.terminal;
  if (!rows.length) return '<div class="side-page-pad">' + panelEmptyHTML('本会话尚无命令执行') + '</div>';
  return '<div class="term-view"><div class="term-subtabs">' +
    rows.map((s, i) => '<button class="term-subtab' + (i === 0 ? ' active' : '') + '" data-term="' + i + '">' + esc(s.command.split('\n')[0].slice(0, 24) || '(空命令)') + '</button>').join('') +
    '</div><div class="term" id="termBody">' + termBodyHTML(rows[0]) + '</div></div>';
}
/* git 视图（第 5 视图）：write worker 合并列由事件流投影；无 worker 时保持诚实空态，
   版本操作由 CLI 承接；开关状态经 agent settings 持久化 */
function gitViewHTML() {
  const cols = panelData.merge;
  if (!cols.length) {
    return '<div class="side-page-pad">' +
      '<div class="settings-empty">' + BRANCH_ICON +
        '<p>Git 面板尚未接入<br><span class="dim">版本操作暂由命令行承接</span></p>' +
      '</div>' +
    '</div>';
  }
  return '<div class="side-page-pad">' + cols.map(c =>
    '<div class="file-item">' + BRANCH_ICON + '<span class="path">' + esc(c.agent_id) + '</span>' +
    '<span class="new">' + esc(c.outcome || c.status) + '</span></div>').join('') + '</div>';
}
/* git 分支数据：当前分支 ahead/behind 计数与其他分支 */
const BRANCHES = [
  { name: 'main',       current: true,  ahead: 2, behind: 0 },
  { name: 'feat/ttl-rotation', current: false, ahead: 0, behind: 0, merged: false },
  { name: 'fix/grace-window',  current: false, ahead: 0, behind: 0 },
  { name: 'chore/deps',        current: false, ahead: 0, behind: 0, merged: true }
];
function branchesViewHTML() {
  return '<div class="side-page-pad branches">' +
    '<div class="branch-head">分支 <span class="cnt">' + BRANCHES.length + '</span></div>' +
    BRANCHES.map(b =>
      '<button class="branch-row' + (b.current ? ' is-current' : '') + '" type="button" role="radio" aria-checked="' + String(b.current) + '" data-branch="' + esc(b.name) + '">' +
        '<svg class="b-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3v12"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="6" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/></svg>' +
        '<span class="b-name">' + esc(b.name) + '</span>' +
        (b.current ? '<svg class="b-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 13 4 4L19 7"/></svg>' : '') +
        (!b.current && b.ahead ? '<span class="b-ahead">↑' + b.ahead + '</span>' : '') +
        (!b.current && b.behind ? '<span class="b-behind">↓' + b.behind + '</span>' : '') +
        (b.merged ? '<span class="b-tag">已合并</span>' : '') +
      '</button>').join('') +
    '<div class="branch-new">' +
      '<input type="text" id="newBranchInput" placeholder="新建分支名，如 feat/…" aria-label="新分支名称">' +
      '<button class="branch-create" id="newBranchBtn" type="button" aria-label="创建分支">' + PLUS_ICON + '</button>' +
    '</div>' +
    '</div>';
}
function viewHTML(key) {
  if (key === 'files') return filesViewHTML();
  if (key === 'review') return reviewViewHTML();
  if (key === 'browser') return browserViewHTML();
  if (key === 'terminal') return terminalViewHTML();
  if (key === 'git') return gitViewHTML();
  return '';
}

let sideOpenTabs = [];
let activeView = null;

function renderSide() {
  sideTabsEl.innerHTML = sideOpenTabs.map(k =>
    '<button class="side-tab" role="tab" data-view="' + k + '" aria-selected="' + String(k === activeView) + '" aria-label="' + VIEW_META[k].title + '">' +
      '<span class="st-ico" aria-hidden="true">' + VIEW_META[k].icon + '</span>' +
      '<span class="st-name">' + VIEW_META[k].title + '</span>' +
      '<span class="st-x" role="button" tabindex="0" data-close="' + k + '" aria-label="关闭' + VIEW_META[k].title + '">✕</span>' +
    '</button>').join('');
  sidePagesEl.innerHTML = sideOpenTabs.map(k =>
    '<section class="side-page" data-view="' + k + '" role="tabpanel"' + (k === activeView ? '' : ' hidden') + '>' + viewHTML(k) + '</section>').join('');
  const active = !!activeView && sideOpenTabs.includes(activeView);
  sideLauncher.hidden = active;
  sidePagesEl.hidden = !active;
  drawerBody.dataset.empty = String(!active);
}

function openView(key) {
  if (!VIEW_META[key]) return;
  if (!sideOpenTabs.includes(key)) sideOpenTabs.push(key);
  activeView = key;
  if (drawer.classList.contains('collapsed')) setDrawer(false);
  renderSide();
}
function closeView(key) {
  const i = sideOpenTabs.indexOf(key);
  if (i < 0) return;
  sideOpenTabs.splice(i, 1);
  if (activeView === key) activeView = sideOpenTabs[Math.min(i, sideOpenTabs.length - 1)] || null;
  renderSide();
}
sideTabsEl.addEventListener('click', (e) => {
  const x = e.target.closest('[data-close]');
  if (x) { closeView(x.dataset.close); return; }
  const t = e.target.closest('.side-tab');
  if (t) { openView(t.dataset.view); }
});
sideTabsEl.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const x = e.target.closest('[data-close]');
  if (x) { e.preventDefault(); closeView(x.dataset.close); }
});
$('#sideHome').addEventListener('click', () => { activeView = null; renderSide(); });
sideLauncher.addEventListener('click', (e) => {
  const card = e.target.closest('[data-view]');
  if (card) openView(card.dataset.view);
});
sidePagesEl.addEventListener('click', (e) => {
  const sub = e.target.closest('.term-subtab');
  if (!sub) return;
  const seed = panelData.terminal[Number(sub.dataset.term)];
  if (!seed) return;
  sidePagesEl.querySelectorAll('.term-subtab').forEach(b => b.classList.toggle('active', b === sub));
  const body = $('#termBody');
  if (body) body.innerHTML = termBodyHTML(seed);
});

/* 快捷键：⌘⌥E 文件 / ⌘T 浏览器 / ⌘⇧G 审阅 / ⌘⇧J 终端 */
document.addEventListener('keydown', (e) => {
  if (!(e.metaKey || e.ctrlKey)) return;
  const k = e.key.toLowerCase();
  if (e.altKey && k === 'e') { e.preventDefault(); openView('files'); }
  else if (!e.altKey && !e.shiftKey && k === 't') { e.preventDefault(); openView('browser'); }
  else if (e.shiftKey && k === 'g') { e.preventDefault(); openView('review'); }
  else if (e.shiftKey && k === 'j') { e.preventDefault(); openView('terminal'); }
});

renderSide();

/* ============ 发送模拟 ============ */
const streamInner = $('#streamInner');
const promptInput = $('#promptInput');
/* 新对话会清空整条流，这一份初始转录用于"返回上一个对话"；
   先对初始 diff 做 token 着色，保存的转录即带上高亮 span */
highlightAllDiffs();
const INITIAL_TRANSCRIPT = streamInner.innerHTML;

function nowTime() {
  const d = new Date();
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

// PERF-02（F-4）：rAF 合帧——同一帧内多次调用只执行一次（打字机每 6 字符调一次）。
// 语义不变：仍滚到底部；只是把「读 scrollHeight 强制同步重排」收敛到每帧至多一次。
let scrollPending = false;
function scrollStream() {
  if (scrollPending) return;
  scrollPending = true;
  requestAnimationFrame(() => {
    scrollPending = false;
    const stream = $('.stream');
    stream.scrollTop = stream.scrollHeight;
  });
}

/* ============ 消息滚动入场动效 ============ */
const revealObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (!entry.isIntersecting) return;
    const el = entry.target;
    el.classList.remove('reveal');
    el.classList.add('reveal-in');
    revealObserver.unobserve(el);
  });
}, { root: $('.stream'), threshold: 0.15 });
function observeMsg(el) {
  if (!el.classList.contains('reveal')) el.classList.add('reveal');
  revealObserver.observe(el);
}
document.querySelectorAll('.stream-inner .msg').forEach(observeMsg);

/* ============ 消息操作行：复制 / 撤回 / 重新生成 + 发出时间 ============ */
const MSG_ICONS = {
  copy: '<svg class="ic-act" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2.5"/><path d="M15.5 6.5V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7.5a2 2 0 0 0 2 2h.5"/></svg>',
  undo: '<svg class="ic-act" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9h10a5 5 0 0 1 0 10h-3"/><path d="m8 5-4 4 4 4"/></svg>',
  regen: '<svg class="ic-act" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 9a8 8 0 1 0 .9 4.4"/><path d="M20 4v5h-5"/></svg>',
  fork: '<svg class="ic-act" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3v9"/><circle cx="6" cy="17" r="2.5"/><circle cx="17" cy="6" r="2.5"/><circle cx="17" cy="17" r="2.5"/><path d="M17 8.5a5 5 0 0 1-5 5h-3.5"/></svg>',
};
const MSG_DONE_ICON = '<svg class="ic-done" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="m8.5 12.5 2.5 2.5 4.5-5"/></svg>';
function actBtn(kind, label) {
  return '<button class="msg-act" type="button" data-msg-act="' + kind + '" aria-label="' + label +
    '" data-label="' + label + '">' + MSG_ICONS[kind] + MSG_DONE_ICON + '</button>';
}
/* 用户消息：复制 / 撤回；AI 回复：复制 / 重新生成 / 分叉 / 撤回并重发。
   时间戳与 token 消耗只挂 AI 侧（回合去重），用户侧操作行保持精简 */
function actionsHTML(role, time, dur, tokens) {
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
function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) {
    return navigator.clipboard.writeText(text).then(() => true).catch(() => legacyCopy(text));
  }
  return legacyCopy(text);
}
function legacyCopy(text) {
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
function messageText(msg) {
  if (msg.classList.contains('user')) {
    const b = msg.querySelector('.bubble');
    return b ? b.innerText.trim() : '';
  }
  return Array.from(msg.querySelectorAll('.ai-text'))
    .map(el => el.innerText.trim()).filter(Boolean).join('\n\n');
}
function markActDone(btn) {
  btn.classList.add('is-done');
  clearTimeout(btn._doneTimer);
  btn._doneTimer = setTimeout(() => btn.classList.remove('is-done'), 1400);
}
function backToInput(text) {
  promptInput.value = text;
  promptInput.style.height = 'auto';
  promptInput.style.height = Math.min(promptInput.scrollHeight, 140) + 'px';
  promptInput.focus();
  const dot = text.length;
  try { promptInput.setSelectionRange(dot, dot); } catch (e) { /* 非文本控件时忽略 */ }
}
function retype(msg) {
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
    if (i % 6 === 0) scrollStream();
    if (i >= full.length) {
      clearInterval(timer);
      target.textContent = full;
      msg._retyping = false;
      if (durEl) durEl.textContent = '输出用时 ' + ((Date.now() - started) / 1000).toFixed(1) + 's';
      scrollStream();
    }
  }, 24);
}
streamInner.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-msg-act]');
  if (!btn) return;
  const msg = btn.closest('.msg');
  if (!msg) return;
  const kind = btn.dataset.msgAct;
  if (kind === 'copy') {
    const ok = await copyText(messageText(msg));
    if (ok) { markActDone(btn); toast('已复制到剪贴板'); }
    else toast('复制失败，请手动选择文本');
  } else if (kind === 'regen') {
    markActDone(btn);
    toast('正在重新生成…');
    retype(msg);
  } else if (kind === 'fork') {
    markActDone(btn);
    const prev = msg.previousElementSibling;
    const ctx = prev && prev.classList.contains('user') ? messageText(prev) : '';
    if (ctx) { backToInput(ctx); toast('已从这条回复分叉，上一轮需求已放回输入框'); }
    else toast('已从这里分叉对话');
  } else if (kind === 'undo') {
    const prev = msg.previousElementSibling;
    const isUser = msg.classList.contains('user');
    const text = isUser
      ? messageText(msg)
      : (prev && prev.classList.contains('user') ? messageText(prev) : '');
    if (!isUser && prev && prev.classList.contains('user')) prev.remove();
    msg.remove();
    if (text) { backToInput(text); toast('已撤回，内容放回输入框'); }
    else toast('已撤回这条消息');
    scrollStream();
  }
});

/* 运行中状态：把会话行的九宫格和流里的输出绑到同一件事上
   —— 开始发送置位，输出结束撤掉，侧栏因此能真实反映"这个对话在跑" */
function setRunning(id, on) {
  const s = sessions.find(x => x.id === id);
  if (!s || !!s.running === !!on) return;
  s.running = !!on;
  render();
}

function send() {
  const text = promptInput.value.trim();
  if (!text) return;
  /* 新任务开始：右栏回到「工作区文件」树（保留已开标签，只清文件高亮） */
  activeFileDoc = null;
  openView('files');
  /* 空对话里发出的第一条：先撤掉占位说明，否则它压在气泡上方像个残留卡片。
     同时把流标回"有对话"，之后切会话不会再拿初始转录覆盖这段新对话 */
  const placeholder = streamInner.querySelector('.chat-empty');
  if (placeholder) { placeholder.remove(); transcriptOpen = true; }
  promptInput.value = '';
  const startedAt = Date.now();
  const runId = selectedId;
  setRunning(runId, true);

  const userMsg = document.createElement('div');
  userMsg.className = 'msg user';
  userMsg.innerHTML =
    '<div class="msg-body"><div class="msg-meta"></div>' +
    '<div class="bubble">' + esc(text) + '</div>' + actionsHTML('user', nowTime()) + '</div>';
  streamInner.appendChild(userMsg);
  observeMsg(userMsg);

  const aiMsg = document.createElement('div');
  aiMsg.className = 'msg ai';
  aiMsg.setAttribute('data-stream', '');   // 对话线的"运行中"就认这个标记
  aiMsg.setAttribute('aria-busy', 'true');
  aiMsg.innerHTML =
    '<div class="msg-body"><div class="msg-meta meta-loading">' + runGrid('proc') + '</div></div>';
  streamInner.appendChild(aiMsg);
  observeMsg(aiMsg);
  scrollStream();

  const thinkSecs = 2 + Math.floor(Math.random() * 7);

  setTimeout(() => {
    const body = aiMsg.querySelector('.msg-body');
    // 思考结束 → 进入输出阶段：仅保留动态点，正文流式逐字输出
    body.innerHTML =
      '<div class="msg-meta meta-loading">' + runGrid('proc') + '</div>' +
      '<div class="think" data-od-id="think-block-dyn">' +
        '<button class="think-head" type="button" aria-expanded="false" aria-controls="think-body-dyn">' +
          runGrid('proc') +
          '已深度思考 <span class="t">' + thinkSecs + 's</span>' +
          '<svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>' +
        '</button>' +
        '<div class="think-body" id="think-body-dyn">' +
          '<p>先解析请求意图：当前会话「' + esc($('#chatTitle').textContent) + '」的上下文已加载，相关模块与历史改动已检索完毕。</p>' +
          '<p>权衡两种改法的风险后选择影响面更小的方案：先定位相关模块，给出改动方案，再运行测试验证，避免一次性大改引入回归。</p>' +
        '</div>' +
      '</div>' +
      '<div class="ai-text"><span class="stream-text"></span><span class="stream-caret" aria-hidden="true"></span></div>';
    scrollStream();

    const full =
      '收到。这是一个原型演示回复：我会先定位相关模块，给出改动方案，再运行测试验证。当前会话「' +
      $('#chatTitle').textContent + '」的上下文已加载。';
    const textEl = body.querySelector('.stream-text');
    const metaEl = body.querySelector('.msg-meta');
    let i = 0;
    const streamTimer = setInterval(() => {
      textEl.textContent = full.slice(0, ++i);
      if (i % 6 === 0) scrollStream();
      if (i >= full.length) {
        clearInterval(streamTimer);
        // 输出结束 → 撤掉加载行（已答完的助手消息不署名），移除光标，并在消息底部追加操作行
        if (metaEl) metaEl.remove();
        const caret = body.querySelector('.stream-caret');
        if (caret) caret.remove();
        const secs = ((Date.now() - startedAt) / 1000).toFixed(1);
        const tokN = Math.round(700 + full.length * 14);
        body.insertAdjacentHTML('beforeend', actionsHTML('ai', nowTime(), secs + 's',
          tokN >= 1000 ? (tokN / 1000).toFixed(1) + 'k' : String(tokN)));
        // 运行结束：撤掉运行标记，侧栏弧线同时消失
        aiMsg.removeAttribute('data-stream');
        aiMsg.removeAttribute('aria-busy');
        setRunning(runId, false);
        scrollStream();
      }
    }, 24);
  }, 1100 * thinkSecs / 4);
}

$('#sendBtn').addEventListener('click', send);
promptInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
});
promptInput.addEventListener('input', () => {
  promptInput.style.height = 'auto';
  promptInput.style.height = Math.min(promptInput.scrollHeight, 140) + 'px';
});

/* ============ 上下文芯片：工作区 / 工作树 / 上传文件 ============ */
const ctxWorkspace = $('#ctxWorkspace');
const ctxTree = $('#ctxTree');
const ctxUpload = $('#ctxUpload');
const fileInput = $('#fileInput');
const ctxWorkspaceLabel = $('#ctxWorkspaceLabel');
const branchPanel = $('#branchPanel');
const branchPanelBody = $('#branchPanelBody');
const workspacePanel = $('#workspacePanel');
const workspacePanelBody = $('#workspacePanelBody');

/* 看板通用定位：fixed + JS 实测，默认弹在芯片上方，放不下翻到下方，并贴住视口边缘 */
function showPop(popEl, chipEl) {
  popEl.hidden = false;
  popEl.style.visibility = 'hidden';
  popEl.classList.remove('below');
  const rect = chipEl.getBoundingClientRect();
  const h = popEl.offsetHeight || 300;
  const gap = 8;
  let top = rect.top - h - gap;
  if (top < 8) top = Math.min(rect.bottom + gap, window.innerHeight - h - 8);
  popEl.classList.toggle('below', top > rect.top);
  popEl.style.top = Math.max(8, top) + 'px';
  popEl.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - popEl.offsetWidth - 8)) + 'px';
  popEl.style.visibility = '';
  chipEl.setAttribute('aria-expanded', 'true');
}
function hidePop(popEl, chipEl) {
  popEl.hidden = true;
  chipEl.setAttribute('aria-expanded', 'false');
}
/* 三个看板互斥：同一时刻只开一个；render 在展开前刷新内容 */
const ctxPops = [];
function registerPop(popEl, chipEl, render) { ctxPops.push({ popEl, chipEl, render }); }
function togglePop(popEl) {
  if (!popEl.hidden) { closeAllPops(false); return; }
  ctxPops.forEach(p => { if (p.popEl !== popEl) hidePop(p.popEl, p.chipEl); });
  const reg = ctxPops.find(p => p.popEl === popEl);
  if (reg && reg.render) reg.render();
  showPop(popEl, reg.chipEl);
  syncCtxChipState();
}
function closeAllPops(refocus) {
  let opened = false;
  ctxPops.forEach(p => {
    if (p.popEl.hidden) return;
    opened = true;
    hidePop(p.popEl, p.chipEl);
    if (refocus) p.chipEl.focus({ preventScroll: true });
  });
  if (opened) syncCtxChipState();
}

/* 芯片文字：工作区名 / 当前分支，只在对应看板展开时附加 */
function syncCtxChipState() {
  ctxWorkspaceLabel.textContent = workspacePanel.hidden ? '工作区' : '工作区 · ' + currentWs.name;
  const cur = BRANCHES.find(b => b.current);
  $('#ctxTreeLabel').textContent = branchPanel.hidden
    ? '工作树'
    : '工作树 · ' + (cur ? cur.name : '分支');
}
const _openView = openView;
openView = function (key) { _openView(key); syncCtxChipState(); };
const _closeView = closeView;
closeView = function (key) { _closeView(key); syncCtxChipState(); };
syncCtxChipState();

/* 工作区看板：列出可选文件夹，点选即切换工作区 */
function workspaceViewHTML() {
  return (window.agent
    ? '<button class="ws-row" type="button" id="workspaceConfigure"><span class="w-text"><span class="w-name">设置真实运行目录…</span><span class="w-path">设置 → 通用；下方仅为文件树预览，不影响运行目录</span></span></button>'
    : '<div class="ws-head">选择工作区文件夹</div>') +
    WORKSPACES.map(w =>
      '<button class="ws-row' + (w === currentWs ? ' is-current' : '') + '" type="button" data-ws="' + esc(w.id) + '" role="radio" aria-checked="' + String(w === currentWs) + '">' +
        '<svg class="w-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/></svg>' +
        '<span class="w-text"><span class="w-name">' + esc(w.name) + '</span>' +
        '<span class="w-path" title="' + esc(w.path) + '">' + esc(w.path) + '</span></span>' +
        (w === currentWs ? '<svg class="w-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 13 4 4L19 7"/></svg>' : '') +
      '</button>').join('') +
    '<button class="ws-row ws-add" type="button" id="wsAdd" data-ws="add">' +
      '<svg class="w-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>' +
      '<span class="w-text"><span class="w-name">打开其他文件夹…</span></span>' +
    '</button>';
}
function renderWorkspacePanel() { workspacePanelBody.innerHTML = workspaceViewHTML(); }
registerPop(workspacePanel, ctxWorkspace, renderWorkspacePanel, syncCtxChipState);
ctxWorkspace.addEventListener('click', () => togglePop(workspacePanel));
workspacePanel.addEventListener('click', (e) => {
  if (e.target.closest('#workspaceConfigure')) {
    closeAllPops(false);
    openSettings('general');
    $('#workspacePath')?.focus();
    return;
  }
  const add = e.target.closest('#wsAdd');
  if (add) { openFileDialog('workspace'); return; }
  const row = e.target.closest('.ws-row');
  if (!row || !row.dataset.ws || row.dataset.ws === 'add') return;
  selectWorkspace(row.dataset.ws);
  closeAllPops(false);
  ctxWorkspace.focus({ preventScroll: true });
});
/* 切换工作区：文件树与侧栏已开标签、芯片文字一起换到新文件夹 */
function selectWorkspace(id) {
  const next = WORKSPACES.find(w => w.id === id);
  if (!next || next === currentWs) return;
  currentWs = next;
  renderSide();
  syncCtxChipState();
  toast('已切换工作区「' + next.name + '」');
}
/* 文件选择器有两个用途：上传附件 / 选一个文件夹当工作区，按打开来源分流 */
let filePickerPurpose = 'upload';
function openFileDialog(purpose) {
  filePickerPurpose = purpose;
  if (purpose === 'workspace') { fileInput.setAttribute('directory', ''); fileInput.setAttribute('webkitdirectory', ''); }
  else { fileInput.removeAttribute('directory'); fileInput.removeAttribute('webkitdirectory'); }
  fileInput.value = '';
  fileInput.click();
}
/* 「打开其他文件夹…」：把所选目录登记为新工作区并切过去 */
fileInput.addEventListener('change', () => {
  const files = Array.from(fileInput.files);
  if (!files.length) return;
  if (filePickerPurpose === 'workspace') {
    const root = (files[0].webkitRelativePath || '').split('/')[0];
    const name = root || files[0].name.replace(/\.[^.]+$/, '');
    let ws = WORKSPACES.find(w => w.name === name);
    if (!ws) {
      ws = {
        id: 'ws-' + name, name, path: '本机 · ' + files.length + ' 个文件',
        tree: [{ dir: name, files: files.slice(0, 6).map(f => ({ name: f.name })) }]
      };
      WORKSPACES.push(ws);
    }
    selectWorkspace(ws.id);
    if (!workspacePanel.hidden) renderWorkspacePanel();
  } else {
    ctxUpload.setAttribute('aria-label', '已选 ' + files.length + ' 个文件：' + files.map(f => f.name).join('、'));
    ctxUpload.classList.add('has-files');
  }
  fileInput.value = '';
});

/* 工作树看板：点芯片在原位（芯片旁）展开/收起；空间不足时自动翻转到另一侧 */
function renderBranchPanel() {
  branchPanelBody.innerHTML = branchesViewHTML();
}
registerPop(branchPanel, ctxTree, renderBranchPanel, syncCtxChipState);
ctxTree.addEventListener('click', () => togglePop(branchPanel));

/* 上传文件芯片：触发真实文件选择，文件名计入可访问名称 */
ctxUpload.addEventListener('click', () => fileInput.click());

/* ============ 权限看板：档位列表 + 「全部放行」二次确认 ============ */
const ctxPerms = $('#ctxPermissions');
const permLabel = ctxPerms.querySelector('.c-btn-label');
const permPanel = $('#permPanel');
const permPanelBody = $('#permPanelBody');
/* 三档由松到紧：needs 为该档仍需逐项确认的动作面，danger 档走弹窗确认 */
const PERM_MODES = [
  { id: 'strict', name: '严格审批', desc: '每次写入、命令与网络请求都先问我', needs: ['修改文件', '终端命令', '联网请求'] },
  { id: 'standard', name: '标准权限', desc: '工作区内改动直接执行，命令与联网需确认', needs: ['终端命令', '联网请求'] },
  { id: 'yolo', name: '全部放行', desc: '不再逐次询问，直接执行下面的操作', needs: [], danger: true }
];
let permMode = PERM_MODES[1];
function permModeIcon(mode) {
  return mode.danger
    ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4.5 2.8 20h18.4L12 4.5Z"/><path d="M12 10v4.2M12 17.2v.2"/></svg>'
    : mode.id === 'strict'
      ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="10" width="16" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>'
      : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3.5 5 6v6c0 4.2 2.9 7.4 7 8.5 4.1-1.1 7-4.3 7-8.5V6l-7-2.5Z"/><path d="m9 12 2 2 4-4"/></svg>';
}
function permsViewHTML() {
  return '<div class="pm-head">权限模式</div>' +
    PERM_MODES.map(m =>
      '<button class="perm-row' + (m.danger ? ' danger' : '') + (m === permMode ? ' is-current' : '') +
        '" type="button" data-perm="' + m.id + '" role="radio" aria-checked="' + String(m === permMode) + '">' +
        '<span class="p-ico">' + permModeIcon(m) + '</span>' +
        '<span class="p-text"><span class="p-name">' + esc(m.name) + '</span>' +
        '<span class="p-desc">' + esc(m.desc) + '</span></span>' +
        (m === permMode ? '<svg class="p-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 13 4 4L19 7"/></svg>' : '') +
      '</button>').join('');
}
function renderPermPanel() { permPanelBody.innerHTML = permsViewHTML(); }
/* 入口按钮：文字跟随档位，危险档整体换色 */
function syncPermChip() {
  permLabel.textContent = permMode.name;
  ctxPerms.classList.toggle('warn', permMode.id === 'strict');
  ctxPerms.classList.toggle('danger', !!permMode.danger);
  ctxPerms.setAttribute('aria-label', '权限模式：' + permMode.name);
  ctxPerms.setAttribute('title', permMode.desc);
}
registerPop(permPanel, ctxPerms, renderPermPanel);
ctxPerms.addEventListener('click', () => togglePop(permPanel));
permPanel.addEventListener('click', (e) => {
  const row = e.target.closest('.perm-row');
  if (!row) return;
  const mode = PERM_MODES.find(m => m.id === row.dataset.perm);
  if (!mode || mode === permMode) { closeAllPops(false); return; }
  if (mode.danger) { closeAllPops(false); askRisk(mode); return; }
  applyPermMode(mode);
  closeAllPops(false);
  ctxPerms.focus({ preventScroll: true });
});
function applyPermMode(mode) {
  permMode = mode;
  syncPermChip();
  if (!permPanel.hidden) renderPermPanel();
  toast('权限模式已切换为「' + mode.name + '」');
}

/* 二次确认：进弹窗前记下来源焦点，勾选未打时「同意」保持禁用 */
const riskScrim = $('#riskScrim');
const riskAck = $('#riskAck');
const riskAgree = $('#riskAgree');
let riskPendingMode = null;
let riskReturnFocus = null;
function setRiskAck(on) {
  riskAck.classList.toggle('on', on);
  riskAck.setAttribute('aria-checked', String(on));
  riskAgree.disabled = !on;
}
function askRisk(mode) {
  riskPendingMode = mode;
  riskReturnFocus = ctxPerms;
  setRiskAck(false);
  riskScrim.classList.add('show');
  riskScrim.setAttribute('aria-hidden', 'false');
  riskScrim.removeAttribute('inert');
  riskAck.focus({ preventScroll: true });
}
function closeRisk() {
  riskScrim.classList.remove('show');
  riskScrim.setAttribute('aria-hidden', 'true');
  riskScrim.setAttribute('inert', '');
  riskPendingMode = null;
  if (riskReturnFocus && riskReturnFocus.focus) riskReturnFocus.focus({ preventScroll: true });
  riskReturnFocus = null;
}
riskAck.addEventListener('click', () => setRiskAck(!riskAck.classList.contains('on')));
riskAgree.addEventListener('click', () => {
  const mode = riskPendingMode;
  closeRisk();
  if (mode) applyPermMode(mode);
});
$('#riskCancel').addEventListener('click', closeRisk);
$('#riskKeep').addEventListener('click', () => {
  const was = permMode;
  closeRisk();
  toast('已保持「' + was.name + '」');
});
riskScrim.addEventListener('click', (e) => { if (e.target === riskScrim) closeRisk(); });
syncPermChip();

/* 附件按钮与上传芯片走同一个选择器，只是用途不同 */
$('#attachBtn').addEventListener('click', () => openFileDialog('upload'));

/* Escape 分层收起：模态弹窗优先，其次芯片看板（弹窗开着时不该让看板抢走这次按键） */
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (riskScrim.classList.contains('show')) { e.preventDefault(); closeRisk(); return; }
  if (settingsOverlay.classList.contains('show')) { e.preventDefault(); closeSettings(); return; }
  if (ctxPops.some(p => !p.popEl.hidden)) { e.preventDefault(); closeAllPops(true); }
});

/* 看板外点击 / Escape 收起 */
document.addEventListener('click', (e) => {
  if (ctxPops.every(p => p.popEl.hidden)) return;
  if (ctxPops.some(p => !p.popEl.hidden && (p.popEl.contains(e.target) || p.chipEl.contains(e.target)))) return;
  closeAllPops(false);
});

/* ============ 工作树看板：分支选择与新建（事件委托） ============ */
branchPanel.addEventListener('click', (e) => {
  const branchBtn = e.target.closest('.branch-row');
  if (branchBtn) {
    const name = branchBtn.dataset.branch;
    const target = BRANCHES.find(b => b.name === name);
    if (!target || target.current) return;
    BRANCHES.forEach(b => { b.current = b === target; });
    renderBranchPanel();
    syncCtxChipState();
    toast('已切换到分支「' + name + '」');
    return;
  }
  if (e.target.closest('#newBranchBtn')) createBranch();
});
branchPanel.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.id === 'newBranchInput') { e.preventDefault(); createBranch(); }
});
function createBranch() {
  const input = $('#newBranchInput');
  if (!input) return;
  const name = input.value.trim();
  if (!name) { input.focus(); toast('请输入分支名'); return; }
  if (BRANCHES.some(b => b.name === name)) { toast('分支「' + name + '」已存在'); return; }
  BRANCHES.forEach(b => { b.current = false; });
  BRANCHES.unshift({ name, current: true, ahead: 0, behind: 0 });
  renderBranchPanel();
  syncCtxChipState();
  toast('已创建并切换到「' + name + '」');
}

/* ============ 模型选择面板 ============ */
const modelPicker = $('#modelPicker');
const modelBtn = $('#modelSelect');
const modelPop = $('#modelPop');
const modelBtnLabel = $('#modelBtnLabel');
const thinkSlider = $('#thinkSlider');
const thinkThumb = $('#tsThumb');
const thinkVal = $('#thinkVal');
const mpClose = $('#mpClose');
const mpMain = $('#mpMain');
const mpModels = $('#mpModels');
const mpCur = $('#mpCur');
const mpBack = $('#mpBack');
const THINK_LABELS = ['off', 'low', 'medium', 'high', 'max'];
const THINK_MAX = THINK_LABELS.length - 1;
let thinkValue = 2;
/* 参考稿几何：轨道 5 等分，刻度点/滑钮/标签共用同一套 10%→90% 的位置网格 */
const TS_RATIO_MIN = 0.1;
const TS_RATIO_SPAN = 0.8;
const mpScaleEl = $('.mp-scale');
const mpTicks = () => Array.from(mpScaleEl.querySelectorAll('.mp-tick'));
function setThinkVisual() {
  const ratio = thinkValue / THINK_MAX;
  /* 填充右端点 = 滑钮中心 = 第 thinkValue+1 个刻度点位置 */
  const pos = thinkSlider.clientWidth * (TS_RATIO_MIN + ratio * TS_RATIO_SPAN);
  thinkSlider.querySelector('.ts-fill').style.width = pos + 'px';
  thinkThumb.style.left = pos + 'px';
  thinkVal.textContent = THINK_LABELS[thinkValue];
  thinkThumb.setAttribute('aria-valuenow', String(thinkValue));
  thinkThumb.setAttribute('aria-valuetext', THINK_LABELS[thinkValue]);
  mpTicks().forEach((t, i) => t.classList.toggle('on', i === thinkValue));
  thinkSlider.querySelectorAll('.ts-node').forEach((n, i) => n.classList.toggle('on', i === thinkValue));
}
/* 切档动效：档位弹跳（离散切档时触发一次） */
function pulseThink() {
  const tick = mpTicks()[thinkValue];
  if (tick) {
    tick.classList.remove('pop');
    void tick.offsetWidth;
    tick.classList.add('pop');
  }
}
function setThink(v, animate) {
  const next = Math.min(THINK_MAX, Math.max(0, Math.round(v)));
  if (next === thinkValue) return false;
  thinkValue = next;
  if (animate) pulseThink();
  setThinkVisual();
  return true;
}
/* 指针拖动：轨道跟手，松手吸附到最近档位并补一次脉冲 */
let tsDragging = false, tsDirty = false;
function tsPosToValue(clientX) {
  const r = thinkSlider.getBoundingClientRect();
  const inset = r.width * TS_RATIO_MIN, travel = r.width * TS_RATIO_SPAN;
  const center = clientX - r.left - inset;
  const ratio = Math.min(1, Math.max(0, center / travel));
  return ratio * THINK_MAX;
}
thinkSlider.addEventListener('pointerdown', (e) => {
  tsDragging = true;
  tsDirty = setThink(tsPosToValue(e.clientX), false);
  thinkSlider.classList.add('grab');
  thinkSlider.setPointerCapture(e.pointerId);
  thinkThumb.focus({ preventScroll: true });
  e.preventDefault();
});
thinkSlider.addEventListener('pointermove', (e) => {
  if (!tsDragging) return;
  tsDirty = setThink(tsPosToValue(e.clientX), false) || tsDirty;
});
function endTsDrag(e) {
  if (!tsDragging) return;
  tsDragging = false;
  thinkSlider.classList.remove('grab');
  if (thinkSlider.hasPointerCapture(e.pointerId)) thinkSlider.releasePointerCapture(e.pointerId);
  if (tsDirty) { tsDirty = false; pulseThink(); }
}
thinkSlider.addEventListener('pointerup', endTsDrag);
thinkSlider.addEventListener('pointercancel', endTsDrag);
/* 键盘：方向键 / Home / End / 翻页 */
thinkThumb.addEventListener('keydown', (e) => {
  const keys = {
    ArrowRight: thinkValue + 1, ArrowUp: thinkValue + 1,
    ArrowLeft: thinkValue - 1, ArrowDown: thinkValue - 1,
    Home: 0, End: THINK_MAX,
    PageUp: thinkValue + 2, PageDown: thinkValue - 2,
  };
  if (e.key in keys) {
    e.preventDefault();
    setThink(keys[e.key], true);
  }
});
/* 档位标签：原生 button，Enter/Space 即触发 click，选中后焦点交回滑杆 */
mpTicks().forEach((t, i) => {
  t.addEventListener('click', () => {
    setThink(i, true);
    thinkThumb.focus({ preventScroll: true });
  });
});
setThinkVisual();

/* 主视图：模型行在上 + 思考程度滑块（默认） */
function showModelMain() {
  mpModels.hidden = true;
  mpMain.hidden = false;
  mpMain.classList.remove('swap-in');
  void mpMain.offsetWidth;
  mpMain.classList.add('swap-in');
}
/* 覆盖为模型选择页 */
function showModelList() {
  mpMain.hidden = true;
  mpModels.hidden = false;
  mpModels.classList.remove('swap-in');
  void mpModels.offsetWidth;
  mpModels.classList.add('swap-in');
  mpBack.focus();
}
mpCur.addEventListener('click', showModelList);
mpBack.addEventListener('click', showModelMain);

function openModelPop() {
  mpMain.hidden = false;
  mpModels.hidden = true;
  modelPop.hidden = false;
  setThinkVisual();
  modelBtn.setAttribute('aria-expanded', 'true');
}
function closeModelPop() {
  modelPop.hidden = true;
  modelBtn.setAttribute('aria-expanded', 'false');
}
modelBtn.addEventListener('click', () => {
  modelPop.hidden ? openModelPop() : closeModelPop();
});
mpClose.addEventListener('click', () => {
  closeModelPop();
  modelBtn.focus();
});
document.addEventListener('click', (e) => {
  if (!modelPop.hidden && !modelPicker.contains(e.target)) closeModelPop();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !modelPop.hidden) { closeModelPop(); modelBtn.focus(); }
});
document.querySelectorAll('.mp-model').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.mp-model').forEach(b => {
      const active = b === btn;
      b.classList.toggle('is-active', active);
      b.setAttribute('aria-checked', String(active));
    });
    modelBtnLabel.textContent = btn.dataset.model;
    $('#mpCurName').textContent = btn.dataset.model;
    $('#mpCurDesc').textContent = btn.dataset.desc;
    showModelMain();
  });
});

/* ============ 思考过程折叠（委托，覆盖动态消息） ============ */
document.addEventListener('click', e => {
  const head = e.target.closest('.think-head');
  if (!head) return;
  const box = head.closest('.think');
  const expanded = box.classList.toggle('expanded');
  head.setAttribute('aria-expanded', String(expanded));
});

/* ============ 卡片折叠（委托：初始转录可被整体替换，直接绑定会失效） ============ */
/* 右栏情境跟随：工具卡类型 ↦ 右栏视图。
   diff 卡 →「工作区文件」tab + 高亮对应文件；终端卡 → 打开并激活「终端」；
   plan 卡 →「工作区文件」；收折仅清文件高亮，不关标签（保留已有） */
const TOOL_VIEW = { plan: 'files', diff: 'files', terminal: 'terminal' };
function scrollActiveFileIntoView() {
  const el = document.querySelector('.drawer .tree-file.is-active');
  if (el) el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}
function clearFileHighlight() {
  if (activeFileDoc) { activeFileDoc = null; renderSide(); }
}
function followCard(card, collapsed) {
  const head = card.querySelector('[data-card-toggle]');
  const kind = head && head.dataset.card;
  if (!kind || !TOOL_VIEW[kind]) return;
  if (collapsed) {
    if (kind === 'diff') { clearFileHighlight(); scrollActiveFileIntoView(); }
    return;
  }
  if (kind === 'diff') {
    if (head.dataset.doc) activeFileDoc = head.dataset.doc;
    openView('files');
    requestAnimationFrame(scrollActiveFileIntoView);
  } else {
    openView(TOOL_VIEW[kind]);
  }
}
document.addEventListener('click', e => {
  const head = e.target.closest('[data-card-toggle]');
  if (!head) return;
  const card = head.closest('.card');
  if (!card) return;
  const collapsed = card.classList.toggle('collapsed');
  head.setAttribute('aria-expanded', String(!collapsed));
  followCard(card, collapsed);
});
/* 工具调用组的两级折叠：先判内层（单个工具），再判外层（整组），互不串扰 */
document.addEventListener('click', e => {
  const tiHead = e.target.closest('.ti-head');
  if (tiHead) {
    const item = tiHead.closest('.tool-item');
    if (!item) return;
    const collapsed = item.classList.toggle('collapsed');
    tiHead.setAttribute('aria-expanded', String(!collapsed));
    return;
  }
  const tgHead = e.target.closest('.tg-head');
  if (tgHead) {
    const g = tgHead.closest('.toolgroup');
    if (!g) return;
    const collapsed = g.classList.toggle('collapsed');
    tgHead.setAttribute('aria-expanded', String(!collapsed));
  }
});

render();

/* =====================================================================
 * 真实数据桥接（Electron renderer：window.agent 存在时启用，主 UI 以原型为准）。
 * 直接浏览器打开原型时 window.agent 缺失 → 上方 mock 保持不变，可独立预览。
 * 权限映射：原型 严审/标准/全放 ↦ 真实 read-only/default/auto
 * ===================================================================== */
(() => {
  const api = window.agent;
  if (!api || typeof api.listSessions !== 'function') return;

  const PERM_MAP = { strict: 'read-only', standard: 'default', yolo: 'auto' };
  const real = { id: null, title: '新会话', running: false, askCards: new Map(), cards: new Map(), usageIn: 0, usageOut: 0, events: 0, runStart: 0, toolGroup: null };
  let historyWindow = null;
  let openGeneration = 0;
  let pendingHistory = null;
  let historyEvents = null;
  /* 右栏面板的事件源：会话打开时 = 历史快照，运行中逐条追加（与流内渲染同源） */
  let panelEvents = [];
  /** 会改变面板内容的事件类型（工具与编排）；其余事件不触发重绘，避免随 token 抖动。 */
  const PANEL_DIRTY = { tool_call: 1, tool_result: 1, agent_spawned: 1, agent_status: 1 };

  /* ---------- 真实运行目录：与 WORKSPACES 文件树演示数据严格隔离 ---------- */
  const workspaceForm = document.createElement('form');
  workspaceForm.className = 'set-row';
  workspaceForm.innerHTML = '<div class="sr-text">' +
    '<label class="sr-name" for="workspacePath">真实运行目录</label>' +
    '<p class="sr-sub" id="workspaceHelp">请输入本机绝对路径（如 /Users/me/project）；留空使用宿主环境 / 默认目录。文件树预览不会改变运行目录。</p>' +
    '<input id="workspacePath" type="text" placeholder="/Users/me/project" aria-describedby="workspaceHelp workspaceStatus" autocomplete="off" spellcheck="false" disabled>' +
    '<p class="sr-sub" id="workspaceStatus" role="status" aria-live="polite">正在读取运行目录…</p></div>' +
    '<div class="set-choice"><button id="workspaceSave" type="submit" disabled>保存目录</button></div>';
  $('.set-sec[data-sec="general"]').prepend(workspaceForm);
  const workspaceInput = workspaceForm.querySelector('#workspacePath');
  const workspaceSave = workspaceForm.querySelector('#workspaceSave');
  const workspaceStatus = workspaceForm.querySelector('#workspaceStatus');
  let configuredWorkspace = null;
  let workspaceError = '';
  let workspaceSaving = false;
  let workspaceDirty = false;
  let sending = false;
  // This desktop build targets macOS: no shell expansion of ~, $HOME or relative paths.
  function parseWorkspace(value) {
    const path = value == null ? '' : String(value).trim();
    if (!path) return null;
    if (!path.startsWith('/') || /[\x00-\x1f\x7f]/.test(path) || path.length > 4096) {
      throw new Error('运行目录必须是本机绝对路径（以 / 开头），不能使用 ~ 或相对路径');
    }
    return path;
  }
  const baseSyncCtxChipState = syncCtxChipState;
  syncCtxChipState = function () {
    baseSyncCtxChipState();
    ctxWorkspaceLabel.textContent = configuredWorkspace ? '运行目录 · ' + (configuredWorkspace.split('/').filter(Boolean).pop() || '/') : '运行目录 · 宿主默认';
    ctxWorkspace.title = workspaceError || configuredWorkspace || '使用宿主环境 / 默认目录；点击可设置';
  };
  function workspaceFailure(message) {
    workspaceError = message;
    workspaceStatus.textContent = message;
    workspaceInput.setAttribute('aria-invalid', 'true');
    syncCtxChipState();
    toast(message);
  }
  // Share one startup read with layout restoration. Sending waits for this read;
  // disabled controls prevent a late snapshot from overwriting a user's saved path.
  const settingsReady = (async () => {
    try {
      const settings = typeof api.getSettings === 'function' ? await api.getSettings() : null;
      workspaceInput.value = settings?.workspace ?? '';
      configuredWorkspace = parseWorkspace(settings?.workspace);
      workspaceStatus.textContent = configuredWorkspace ? '已配置：' + configuredWorkspace : '未指定运行目录：使用宿主环境 / 默认目录';
      return settings;
    } catch (err) {
      workspaceFailure('读取运行目录失败：' + (err?.message || err) + '；请重新保存目录');
      return null;
    } finally {
      workspaceInput.disabled = false;
      workspaceSave.disabled = typeof api.setSettings !== 'function';
      syncCtxChipState();
    }
  })();
  workspaceInput.addEventListener('input', () => {
    workspaceDirty = true;
    workspaceStatus.textContent = '目录尚未保存；保存后才能运行';
  });
  workspaceForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (workspaceInput.disabled || workspaceSaving || sending || real.running) {
      toast('请等待读取、保存或当前运行完成后再设置目录');
      return;
    }
    try {
      const path = parseWorkspace(workspaceInput.value);
      if (typeof api.setSettings !== 'function') throw new Error('宿主不支持保存设置');
      workspaceSaving = true;
      workspaceInput.disabled = workspaceSave.disabled = true;
      workspaceStatus.textContent = '正在保存运行目录…';
      await api.setSettings({ workspace: path });
      configuredWorkspace = path;
      workspaceInput.value = path || '';
      workspaceDirty = false;
      workspaceError = '';
      workspaceInput.setAttribute('aria-invalid', 'false');
      workspaceStatus.textContent = path ? '已保存：' + path : '已清除：使用宿主环境 / 默认目录';
      syncCtxChipState();
    } catch (err) {
      workspaceFailure('保存运行目录失败：' + (err?.message || err));
    } finally {
      workspaceSaving = false;
      workspaceInput.disabled = false;
      workspaceSave.disabled = typeof api.setSettings !== 'function';
    }
  });
  /* ---------- 运行目录接线结束 ---------- */
  function clearTranscript() {
    historyWindow?.destroy();
    historyWindow = null;
    streamInner.querySelectorAll('.msg').forEach(m => {
      revealObserver.unobserve(m);
      if (m._st) clearInterval(m._st);
    });
    real.cards.clear();
    real.toolGroup = null;
    streamInner.innerHTML = '';
  }
  function renderHistoryRow(row) {
    const node = document.createElement('div');
    node.className = 'msg ' + (row.kind === 'user' ? 'user' : 'ai');
    node.dataset.history = '';
    const body = document.createElement('div');
    body.className = 'msg-body';
    const text = document.createElement('div');
    text.className = row.kind === 'user' ? 'bubble' : 'ai-text';
    text.style.whiteSpace = 'pre-wrap';
    text.textContent = row.text;
    body.appendChild(text);
    if (row.detail !== undefined || row.result !== undefined) {
      const details = document.createElement('details');
      const summary = document.createElement('summary');
      summary.textContent = row.kind === 'tool' ? (row.ok === null ? '执行记录（无结果）' : row.ok ? '执行成功' : '执行失败') : '查看记录';
      const content = document.createElement('pre');
      content.className = 'ti-code';
      content.style.whiteSpace = 'pre-wrap';
      content.style.overflowWrap = 'anywhere';
      content.textContent = (row.detail || '') + (row.result != null ? '\n\n输出：\n' + row.result : '');
      details.append(summary, content);
      if (row.ok === false) details.open = true;
      body.appendChild(details);
    }
    node.appendChild(body);
    return node;
  }

  /* ---------- 会话列表 ---------- */
  function fmtTime(ms) {
    const d = new Date(ms), p = n => String(n).padStart(2, '0');
    return p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  async function loadSessions() {
    try {
      const list = await api.listSessions();
      sessions = list.slice().sort((a, b) => b.mtimeMs - a.mtimeMs).map((s, i) => ({
        id: s.id,
        title: s.id,
        time: fmtTime(s.mtimeMs),
        timeRaw: s.mtimeMs,
        lines: s.lines,
        group: 'today',
        pinned: false, folder: null, rank: i,
        running: real.running && s.id === real.id,
      }));
      if (!selectedId && sessions.length) selectedId = sessions[0].id;
      render();
      return true;
    } catch (err) {
      toast('会话列表加载失败：' + (err && err.message ? err.message : err));
      return false;
    }
  }

  /* ---------- 消息流构造（复用原型 DOM 契约，CSS 全兼容） ---------- */
  function appendUser(text) {
    const d = document.createElement('div');
    d.className = 'msg user';
    d.innerHTML = '<div class="msg-body"><div class="msg-meta"></div><div class="bubble"></div><div class="msg-actions"></div></div>';
    d.querySelector('.bubble').textContent = text;
    d.querySelector('.msg-actions').innerHTML = actionsHTML('user', nowTime());
    streamInner.appendChild(d); observeMsg(d); scrollStream();
    return d;
  }
  function ensureAi() {
    let m = streamInner.querySelector('.msg.ai[data-live]');
    if (m) return m;
    m = document.createElement('div');
    m.className = 'msg ai';
    m.setAttribute('data-live', '');
    m.innerHTML =
      '<div class="msg-body">' +
        '<div class="think"><button class="think-head" type="button" aria-expanded="false">' +
          runGrid('proc') + '已深度思考 <span class="t ttimer">0s</span>' +
          '<svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>' +
        '</button><div class="think-body"><p>…</p></div></div>' +
        '<div class="ai-text"><span class="stream-text"></span></div>' +
      '</div>';
    streamInner.appendChild(m); observeMsg(m); scrollStream();
    const start = Date.now();
    const t = m.querySelector('.ttimer');
    if (t) {
      t.textContent = '0s';
      m._st = setInterval(() => { if (!m.isConnected) { clearInterval(m._st); return; } t.textContent = Math.round((Date.now() - start) / 1000) + 's'; }, 1000);
    }
    return m;
  }
  function tokStr() {
    const n = real.usageIn + real.usageOut;
    return n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n);
  }
  /* ---------- 底栏同步（VIS-02）：事件数 / token 合计 / 沙箱可用性 ---------- */
  /** 底栏事件数 = 当前**展示中**会话的事件数：重放口径取快照行数（与左栏 lines 同口径），
   *  无快照的新会话取本轮 live 投递数。real.events 保持「live 投递计数」语义不变——
   *  重放不得伪造 live 副作用是 renderer-history-live 锁住的不变量。 */
  function displayedEventCount() {
    return historyEvents ? historyEvents.length : real.events;
  }
  function syncStatusbar() {
    const ec = $('#eventCount');
    if (ec) ec.textContent = String(displayedEventCount() || 0);
    const tt = $('#tokenTotal');
    if (tt) tt.textContent = tokStr();
  }
  /** 右栏面板刷新：数据 = projectPanelData(会话事件, 运行目录)，渲染仍走原型段的 renderSide。
   *  只在会话打开与面板相关事件到达时刷新（工具/编排事件每轮个位数，不随 token 抖动）。 */
  function refreshPanels() {
    panelData = projectPanelData(panelEvents, configuredWorkspace);
    renderSide();
  }
  async function initSandboxState() {
    const el = $('#sandboxState');
    if (!el) return;
    if (typeof api.getState !== 'function') { el.dataset.state = 'wait'; el.textContent = '沙箱状态未知'; return; }
    try {
      const st = await api.getState();
      const sb = st && st.sandbox;
      if (sb && sb.available) { el.dataset.state = 'ready'; el.textContent = '沙箱就绪'; }
      else { el.dataset.state = 'down'; el.textContent = '沙箱不可用'; }
    } catch (_) {
      el.dataset.state = 'down';
      el.textContent = '沙箱状态未知';
    }
  }
  function finalizeAi(fullText) {
    const m = streamInner.querySelector('.msg.ai[data-live]');
    if (!m) return;
    real.toolGroup = null; /* 一段话结束 → 之后的工具调用另起一组 */
    m.removeAttribute('data-live');
    if (m._st) clearInterval(m._st);
    m.querySelector('.think-head').setAttribute('aria-expanded', 'true');
    m.querySelector('.think').classList.add('expanded');
    const tt = m.querySelector('.ttimer');
    if (tt) tt.textContent = Math.max(1, Math.round((Date.now() - real.runStart) / 1000)) + 's';
    const st = m.querySelector('.stream-text');
    if (fullText && st) st.textContent = fullText;
    const secs = real.runStart ? ((Date.now() - real.runStart) / 1000).toFixed(1) + 's' : null;
    const wrap = document.createElement('div');
    wrap.className = 'msg-actions';
    wrap.innerHTML = actionsHTML('ai', nowTime(), secs, tokStr());
    m.querySelector('.msg-body').appendChild(wrap);
    scrollStream();
  }
  function finalizePending() {
    const m = streamInner.querySelector('.msg.ai[data-live]');
    if (m) finalizeAi(m.querySelector('.stream-text') ? m.querySelector('.stream-text').textContent : '');
  }

  /* ---------- 工具 / 卡片 ---------- */
  const TOOL_ICONS = {
    read_file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z"/><path d="M14 3v5h5"/>',
    write_file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h4"/>',
    run_command: '<path d="m5 7 4 4-4 4M12 17h7"/>',
    remember: '<path d="M12 17v5"/><path d="M9 3h6l-1 7 3 2.5V15H7v-2.5L10 10Z"/>',
  };
  function toolIcon(name) {
    const p = TOOL_ICONS[name] || TOOL_ICONS.run_command;
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + p + '</svg>';
  }
  /* ---------- 工具调用组（两级折叠） ---------- */
  /** 一行摘要：告诉用户"这个工具干了什么"，取最能代表这次调用的那一个字段。 */
  function toolSummary(name, args) {
    const a = args && typeof args === 'object' ? args : {};
    const pick = (...ks) => {
      for (let i = 0; i < ks.length; i++) {
        const v = a[ks[i]];
        if (typeof v === 'string' && v) return v;
        if (typeof v === 'number') return String(v);
      }
      return '';
    };
    const p = pick('path', 'file', 'filePath', 'target', 'filename');
    if (p) return p;
    const c = pick('command', 'cmd', 'script');
    if (c) return c;
    const q = pick('pattern', 'query', 'glob', 'q', 'symbol');
    if (q) return q;
    const keys = Object.keys(a);
    if (!keys.length) return '—';
    try {
      const v = a[keys[0]];
      return typeof v === 'string' ? v : String(JSON.stringify(v)).slice(0, 120);
    } catch (_) { return '—'; }
  }
  function argText(args) {
    if (args === undefined || args === null) return '—';
    if (typeof args === 'string') return args;
    try { return JSON.stringify(args, null, 2); } catch (_) { return String(args); }
  }
  /** 把工具输出按 +/-/@ 前缀切成 diff 行，复用消息流里同一套 .diff 着色。 */
  function diffHtml(text) {
    const lines = String(text).split('\n');
    let h = '<div class="diff">';
    for (let i = 0; i < lines.length; i++) {
      const ln = lines[i];
      const c = ln.charAt(0);
      const cls = c === '+' ? 'add' : c === '-' ? 'del' : c === '@' ? 'hunk' : 'ctx';
      h += '<div class="ln ' + cls + '">' + esc(ln) + '</div>';
    }
    return h + '</div>';
  }
  /** 与 newCard 同宿主：挂到最后一条 AI 消息体内，没有则退回消息流。 */
  function lastAiHost() {
    const lastAi = Array.from(streamInner.querySelectorAll('.msg.ai:not([data-history])')).at(-1);
    return lastAi && lastAi.isConnected ? lastAi.querySelector('.msg-body') : null;
  }
  const TG_CHEV = '<svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
  /** 取（或新建）当前这轮的工具调用组；连续 tool_call 会复用同一组。 */
  function ensureToolGroup() {
    if (real.toolGroup && real.toolGroup.isConnected) return real.toolGroup;
    const host = lastAiHost() || streamInner;
    const g = document.createElement('div');
    g.className = 'toolgroup collapsed';
    g.innerHTML =
      '<button class="tg-head" type="button" data-tool-toggle aria-expanded="false">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M8 6h13M8 12h13M8 18h13"/><path d="M3.6 6h.01M3.6 12h.01M3.6 18h.01"/></svg>' +
        '<span class="tg-title">执行过程</span><span class="tg-count">0 项</span>' +
        '<span class="tg-sum"></span>' + TG_CHEV +
      '</button><div class="tg-body"></div>';
    host.appendChild(g);
    real.toolGroup = g;
    return g;
  }
  /** 刷新组头部的次数与成败汇总（不展开也能知道这批调用的整体结果）。 */
  function updateToolGroup(g) {
    if (!g) return;
    const items = g.querySelectorAll('.tool-item');
    let ok = 0, fail = 0, pend = 0;
    items.forEach((it) => {
      const s = it.querySelector('.ti-state');
      if (!s) return;
      if (s.classList.contains('ok')) ok++;
      else if (s.classList.contains('fail')) fail++;
      else pend++;
    });
    const c = g.querySelector('.tg-count');
    if (c) c.textContent = items.length + ' 项';
    const sum = g.querySelector('.tg-sum');
    if (sum) {
      sum.innerHTML =
        (ok ? '<span class="ok">✓ ' + ok + '</span>' : '') +
        (fail ? '<span class="bad">✗ ' + fail + '</span>' : '') +
        (pend ? '<span class="pending">… ' + pend + '</span>' : '');
    }
  }
  /* ---------- 事件渲染 ---------- */
  function renderEvent(e) {
    switch (e.type) {
      case 'session_meta':
        break;
      case 'user_message':
        finalizePending();
        appendUser(e.content || (e.origin ? '（来自 sidechat 提升）' : ''));
        break;
      case 'assistant_message':
        finalizeAi(e.content);
        break;
      case 'assistant_delta': {
        const m = ensureAi();
        m.querySelector('.stream-text').textContent += e.text;
        break;
      }
      case 'tool_call': {
        finalizePending();
        const name = String(e.name || 'tool');
        const id = e.callId || e.id || name + Math.random().toString(36).slice(2, 7);
        const g = ensureToolGroup();
        const item = document.createElement('div');
        item.className = 'tool-item collapsed';
        item.innerHTML =
          '<button class="ti-head" type="button" data-tool-toggle aria-expanded="false">' +
            toolIcon(name) +
            '<span class="ti-name">' + esc(name) + '</span>' +
            '<span class="ti-sum">' + esc(toolSummary(name, e.args)) + '</span>' +
            '<span class="ti-state pending">…</span>' + TG_CHEV +
          '</button>' +
          '<div class="ti-body">' +
            '<div class="ti-sec"><div class="ti-label">参数</div><pre class="ti-code">' + esc(argText(e.args)) + '</pre></div>' +
            '<div class="ti-sec ti-out" hidden><div class="ti-label">输出</div><div class="ti-out-body"></div></div>' +
          '</div>';
        g.querySelector('.tg-body').appendChild(item);
        updateToolGroup(g);
        real.cards.set(id, item);
        scrollStream();
        break;
      }
      case 'tool_result': {
        const item = real.cards.get(e.callId);
        if (!item) break;
        const out = String(e.output || '').slice(0, 4000);
        const ok = !!e.ok;
        const name = (item.querySelector('.ti-name') || {}).textContent || '';
        const st = item.querySelector('.ti-state');
        if (st) { st.className = 'ti-state ' + (ok ? 'ok' : 'fail'); st.textContent = ok ? '✓' : '✗'; }
        const outSec = item.querySelector('.ti-out');
        if (outSec) {
          outSec.hidden = false;
          const body = outSec.querySelector('.ti-out-body');
          if (body) {
            if (/write|edit|patch|apply/i.test(name) && /^[+\-@ ]/m.test(out)) {
              body.innerHTML = diffHtml(out);
              highlightAllDiffs(body);
            } else {
              body.innerHTML = '<pre class="ti-code">' + esc(out || (ok ? '（无输出）' : '（无错误输出）')) + '</pre>';
            }
          }
        }
        /* 失败的调用自动展开：错误不该藏在两层折叠后面 */
        if (!ok) {
          item.classList.remove('collapsed');
          const ih = item.querySelector('.ti-head');
          if (ih) ih.setAttribute('aria-expanded', 'true');
          const gg = item.closest('.toolgroup');
          if (gg) {
            gg.classList.remove('collapsed');
            const gh = gg.querySelector('.tg-head');
            if (gh) gh.setAttribute('aria-expanded', 'true');
          }
        }
        updateToolGroup(item.closest('.toolgroup'));
        real.cards.delete(e.callId);
        scrollStream();
        break;
      }
      case 'plan_proposed': {
        finalizePending();
        const p = e.plan || {};
        const c = document.createElement('div');
        c.className = 'card';
        const files = (p.files || []).map(f =>
          '<li><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 7h16"/><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg><span>' +
          esc((f.action || '') + ' · ' + f.path) + '</span></li>').join('');
        c.innerHTML =
          '<button class="card-head" type="button" data-card-toggle data-card="plan">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M9 6h11M9 12h11M9 18h11"/></svg>' +
            '执行计划 <span class="tag">待确认</span>' +
            '<svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>' +
          '</button>' +
          '<div class="plan-steps"><li class="todo"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/></svg><span>' + esc(p.goal || '方案') + '</span></li>' +
          files + '</div>' +
          '<div class="plan-acts">' +
            '<button class="risk-btn ghost plan-approve" type="button">批准</button>' +
            '<button class="risk-btn ghost plan-reject" type="button">拒绝</button>' +
          '</div>';
        const lastAi = Array.from(streamInner.querySelectorAll('.msg.ai:not([data-history])')).at(-1);
        const host = lastAi && lastAi.isConnected ? lastAi.querySelector('.msg-body') : streamInner;
        host.appendChild(c);
        c.querySelector('.plan-approve').addEventListener('click', () => {
          if (api.decidePlan) void api.decidePlan(true);
          c.querySelector('.tag').textContent = '已批准';
          const acts = c.querySelector('.plan-acts'); if (acts) acts.remove();
        });
        c.querySelector('.plan-reject').addEventListener('click', () => {
          if (api.decidePlan) void api.decidePlan(false);
          c.querySelector('.tag').textContent = '已拒绝';
          const acts = c.querySelector('.plan-acts'); if (acts) acts.remove();
        });
        scrollStream();
        break;
      }
      case 'plan_approved': {
        const tag = streamInner.querySelector('.msg:not([data-history]) .card .tag, :scope > .card .tag');
        if (tag) tag.textContent = e.approved ? '已批准' : '已拒绝';
        break;
      }
      case 'verify_result': {
        /* 终端/验证结果并入「执行过程」折叠组（与工具调用同组，统一二级折叠） */
        finalizePending();
        const g = ensureToolGroup();
        const item = document.createElement('div');
        item.className = 'tool-item collapsed';
        const vrows = (e.results || []).map(r =>
          '<div><span class="' + (r.ok ? 'ok' : 'dim') + '">' + (r.ok ? '✓' : '✗') + '</span> ' + esc(r.command) +
          (r.output ? '<div class="dim">' + esc(r.output.slice(0, 2000)) + '</div>' : '') + '</div>').join('');
        item.innerHTML =
          '<button class="ti-head" type="button" data-tool-toggle aria-expanded="false">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="m5 7 4 4-4 4M12 17h7"/></svg>' +
            '<span class="ti-name">终端' + (e.attempt ? ' #' + e.attempt : '') + '</span>' +
            '<span class="ti-sum">验证结果</span>' +
            '<span class="ti-state ' + (e.ok ? 'ok' : 'fail') + '">' + (e.ok ? '✓' : '✗') + '</span>' + TG_CHEV +
          '</button>' +
          '<div class="ti-body"><div class="term">' + (vrows || '<div class="dim">（无输出）</div>') + '</div></div>';
        g.querySelector('.tg-body').appendChild(item);
        updateToolGroup(g);
        scrollStream();
        break;
      }
      case 'usage':
        real.usageIn += e.inputTokens || 0;
        real.usageOut += e.outputTokens || 0;
        syncStatusbar();
        break;
      case 'compaction':
        toast('上下文已压缩，可继续');
        break;
      default:
        /* agent/automation/security 等事件由右侧对应面板承接，主流先静默 */
        break;
    }
  }

  /* ---------- 审批（onAsk / onAskDone → 输入框弹出面板 + 流内已决记录） ----------
     设计：等待审批时在输入框上方弹出「批准面板」（作用域为自绘弹出层），
     决策后面板收起，消息流里落一条已决折叠记录（统一二级折叠语言）。 */
  const ASK_SCOPES = [
    { v: 'once', l: '仅本次', d: '对该操作的一次性放行' },
    { v: 'always', l: '本类始终允许', d: '以后同类操作自动放行' }
  ];
  const ASK_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4.5 2.8 20h18.4L12 4.5Z"/><path d="M12 10v4.2M12 17.2v.2"/></svg>';
  const ASK_CHEV = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
  const askQueue = [];

  function askArgsHtml(p) {
    return Object.entries(p.args || {}).map(([k, v]) =>
      '<div class="dim">' + esc(k) + ': ' + esc(typeof v === 'object' ? JSON.stringify(v).slice(0, 200) : String(v)) + '</div>').join('');
  }

  function buildAskPop() {
    const box = document.querySelector('.composer-box');
    const pop = document.createElement('div');
    pop.className = 'ask-pop';
    pop.id = 'askPop';
    pop.dataset.askId = '';
    pop.hidden = true;
    pop.innerHTML =
      '<div class="ask-pop-hd">' + ASK_ICON +
        '<span class="ask-tool" id="askPopTool"></span>' +
        '<span class="tag" id="askPopRisk" hidden></span>' +
      '</div>' +
      '<div class="ask-pop-reason" id="askPopReason" hidden></div>' +
      '<div class="ask-pop-args" id="askPopArgs" hidden></div>' +
      '<div class="ask-pop-acts">' +
        '<div class="ask-scope-wrap">' +
          '<button class="ask-scope-btn" type="button" aria-haspopup="true" aria-expanded="false" aria-label="审批范围">' +
            '<span class="ask-scope-lab" id="askScopeLab">仅本次</span>' + ASK_CHEV +
          '</button>' +
          '<div class="ask-scope-pop" id="askScopePop" hidden></div>' +
        '</div>' +
        '<span class="ask-sp"></span>' +
        '<button class="risk-btn ghost ask-no" type="button">拒绝</button>' +
        '<button class="risk-btn ask-yes" type="button">批准</button>' +
      '</div>';
    box.appendChild(pop);
    // 作用域：自绘弹出层（同一折叠/弹层的设计语言）
    const scopePop = pop.querySelector('#askScopePop');
    scopePop.innerHTML = ASK_SCOPES.map(s =>
      '<button class="ask-scope-opt" type="button" data-v="' + s.v + '" role="option" aria-selected="' + (s.v === 'once') + '">' +
        '<span class="aso-main">' + s.l + '</span>' +
        '<span class="aso-desc">' + s.d + '</span>' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 13 4 4L19 7"/></svg>' +
      '</button>').join('');
    const setScope = (v) => {
      pop.dataset.scope = v;
      pop.querySelector('#askScopeLab').textContent = (ASK_SCOPES.find(s => s.v === v) || ASK_SCOPES[0]).l;
      scopePop.querySelectorAll('.ask-scope-opt').forEach(o =>
        o.setAttribute('aria-selected', String(o.dataset.v === v)));
    };
    scopePop.addEventListener('click', (e) => {
      const opt = e.target.closest('.ask-scope-opt');
      if (!opt) return;
      setScope(opt.dataset.v);
      scopePop.hidden = true;
      pop.querySelector('.ask-scope-btn').setAttribute('aria-expanded', 'false');
    });
    pop.querySelector('.ask-scope-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      const open = scopePop.hidden;
      scopePop.hidden = !open;
      pop.querySelector('.ask-scope-btn').setAttribute('aria-expanded', String(open));
    });
    document.addEventListener('click', (e) => {
      if (!scopePop.hidden && !e.target.closest('.ask-scope-wrap')) {
        scopePop.hidden = true;
        pop.querySelector('.ask-scope-btn').setAttribute('aria-expanded', 'false');
      }
    });
    pop.querySelector('.ask-yes').addEventListener('click', () => decideAsk(true));
    pop.querySelector('.ask-no').addEventListener('click', () => decideAsk(false));
    return pop;
  }

  /* 审批请求进来：入队并渲染输入框上方的批准面板（流内不落卡，等决策后再落已决记录） */
  function askCard(p) {
    finalizePending();
    real.askCards.set(p.askId, p);
    askQueue.push(p);
    renderAskPop();
    return null;
  }

  function renderAskPop() {
    const pop = document.getElementById('askPop') || buildAskPop();
    const p = askQueue[0];
    if (!p) { pop.hidden = true; return; }
    pop.dataset.askId = p.askId;
    pop.querySelector('#askPopTool').textContent = p.tool;
    pop.querySelector('#askPopRisk').textContent = p.risk || '';
    pop.querySelector('#askPopRisk').hidden = !p.risk;
    pop.querySelector('#askPopReason').textContent = p.reason || '';
    pop.querySelector('#askPopReason').hidden = !p.reason;
    const argsH = askArgsHtml(p);
    pop.querySelector('#askPopArgs').hidden = !argsH;
    if (argsH) pop.querySelector('#askPopArgs').innerHTML = argsH;
    pop.querySelector('#askScopeLab').textContent = '仅本次';
    pop.querySelector('#askScopePop').hidden = true;
    pop.querySelector('.ask-scope-btn').setAttribute('aria-expanded', 'false');
    /* 重置入场动画：每次出新的审批都重新淡入 */
    pop.classList.remove('show');
    void pop.offsetWidth;
    pop.hidden = false;
    pop.classList.add('show');
  }

  function hideAskPop() {
    const pop = document.getElementById('askPop');
    if (pop) { pop.hidden = true; pop.dataset.askId = ''; }
  }

  /* 已决记录：统一二级折叠卡（一级头含状态，展开看理由与参数） */
  function appendAskRecord(p, approved, scope) {
    finalizePending();
    const c = document.createElement('div');
    c.className = 'card ask resolved collapsed';
    c.dataset.ask = p.askId;
    const scopeLabel = (ASK_SCOPES.find(s => s.v === scope) || ASK_SCOPES[0]).l;
    const argsH = askArgsHtml(p);
    c.innerHTML =
      '<button class="card-head" type="button" data-card-toggle aria-expanded="false">' + ASK_ICON +
        '<span class="ask-tool">' + esc(p.tool) + '</span>' +
        '<span class="tag">' + (approved ? '已批准' : '已拒绝') + ' · ' + scopeLabel + '</span>' + ASK_CHEV +
      '</button>' +
      '<div class="body">' +
        (p.reason ? '<div class="ask-reason">' + esc(p.reason) + '</div>' : '') + argsH +
      '</div>';
    streamInner.appendChild(c);
    observeMsg(c);
    scrollStream();
  }

  function decideAsk(approved) {
    const pop = document.getElementById('askPop');
    const p = askQueue.shift();
    if (!p || !pop || pop.hidden || pop.dataset.askId !== p.askId) return;
    hideAskPop();
    appendAskRecord(p, approved, pop.dataset.scope);
    void api.decide(p.askId, approved, pop.dataset.scope);
    renderAskPop();
  }

  api.onAsk(p => { askCard(p); });
  api.onAskDone(p => {
    /* 输入框中等待且外部已决（如 sidechat 代批）→ 面板收起并转成流记录 */
    const pop = document.getElementById('askPop');
    if (pop && !pop.hidden && pop.dataset.askId === p.askId) {
      const i = askQueue.findIndex(q => q.askId === p.askId);
      if (i >= 0) askQueue.splice(i, 1);
      hideAskPop();
      appendAskRecord(p, p.outcome === 'approved', 'once');
      renderAskPop();
      return;
    }
    const c = streamInner.querySelector('.card.ask[data-ask="' + p.askId + '"]');
    if (c && p.reason) {
      const tag = c.querySelector('.tag');
      if (tag && tag.textContent.indexOf(p.reason) === -1) tag.textContent += ' · ' + p.reason;
    }
  });

  /* ---------- 事件订阅 ---------- */
  // JSONL has no event sequence IDs; reconcile the ordered snapshot/live overlap,
  // never a Set of payloads (identical deltas and usage records may be legitimate).
  // session_id is added only to IPC, not to the persisted event.
  // Exact disambiguation of an old identical suffix vs. a newly persisted prefix
  // requires a main-process sequence/watermark; payload overlap assumes ordered IPC.
  function historyEventKey(event) {
    const { session_id, ...payload } = event;
    const canonical = value => Array.isArray(value) ? value.map(canonical)
      : value && typeof value === 'object'
        ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
    return JSON.stringify(canonical(payload));
  }
  function reconcileHistory(snapshot, live) {
    if (!live.length) return snapshot.slice();
    const keys = live.map(historyEventKey), prefix = new Array(keys.length).fill(0);
    for (let i = 1, n = 0; i < keys.length; i++) {
      while (n && keys[i] !== keys[n]) n = prefix[n - 1];
      if (keys[i] === keys[n]) n++;
      prefix[i] = n;
    }
    let overlap = 0;
    for (const event of snapshot) {
      const key = historyEventKey(event);
      while (overlap && (overlap === keys.length || key !== keys[overlap])) overlap = prefix[overlap - 1];
      if (key === keys[overlap]) overlap++;
    }
    return snapshot.concat(live.slice(overlap));
  }
  function showHistory(events) {
    clearTranscript();
    historyEvents = events;
    panelEvents = events;
    real.usageIn = 0; real.usageOut = 0;
    for (const e of events) {
      if (e.type === 'usage') { real.usageIn += e.inputTokens || 0; real.usageOut += e.outputTokens || 0; }
    }
    syncStatusbar();
    refreshPanels();
    historyWindow = mountHistory({ container: streamInner, scroller: $('.stream'), rows: projectHistory(events), renderRow: renderHistoryRow });
    scrollStream();
  }
  api.onEvent(e => {
    real.events += 1;               // VIS-02：每次收到事件真实递增底栏计数
    syncStatusbar();
    // Untagged legacy traffic cannot safely be attributed to the selected session.
    if (!real.id || e.session_id !== real.id) return;
    if (pendingHistory) { pendingHistory.events.push(e); return; }
    // A selected background stream can continue an assistant/tool row in the
    // snapshot. Re-project together rather than creating a disconnected live tail.
    if (historyEvents && !real.running) showHistory(historyEvents.concat(e));
    else {
      renderEvent(e);
      if (PANEL_DIRTY[e.type]) { panelEvents = panelEvents.concat([e]); refreshPanels(); }
    }
  });

  /* ---------- 行为覆写：发送 / 会话切换 / 新建 / 删除 / 归档 ---------- */
  send = async function () {
    const text = promptInput.value.trim();
    if (!text) return;
    if (real.historyPending) { toast('正在打开会话，请稍候'); return; }
    if (real.running || sending) { toast('agent 正在运行，请先等待完成'); return; }
    sending = true;
    try {
      await settingsReady;
      if (real.historyPending) { toast('正在打开会话，请稍候'); return; }
      if (workspaceSaving || workspaceDirty || workspaceError) {
        toast(workspaceError || '请先保存运行目录，再发送消息');
        return;
      }
      const workspace = configuredWorkspace;
      if (!real.id) {
        const r = await api.createSession();
        real.id = r.id;
        await loadSessions();
      }
      activeFileDoc = null;
      openView('files');
      promptInput.value = '';
      finalizePending();
      appendUser(text);
      ensureAi();
      real.runStart = Date.now();
      real.running = true;
      real.usageIn = 0; real.usageOut = 0; real.events = 0;
      syncStatusbar();
      setRunning(real.id, true);
      const res = await api.run({ message: text, mode: PERM_MAP[permMode.id], sessionId: real.id, ...(workspace ? { workspace } : {}) });
      if (!res.ok) { real.running = false; setRunning(real.id, false); toast('启动失败：' + (res.error || '未知')); }
    } catch (err) {
      real.running = false;
      setRunning(real.id, false);
      toast('启动失败：' + (err && err.message ? err.message : err));
    } finally {
      sending = false;
    }
  };
  selectSession = async function (id, force) {
    if (real.running || sending) { toast('agent 运行中，先等待完成再切换'); return; }
    if (id === real.id && !force) { render(); return; }
    const generation = ++openGeneration;
    const pending = { events: [] };
    pendingHistory = pending;
    real.historyPending = true;
    historyEvents = null;
    real.id = id;
    selectedId = id;
    closeSbMenus();
    render();
    const s = sessions.find(x => x.id === id);
    if (s) $('#chatTitle').textContent = s.title;
    clearTranscript();
    real.usageIn = 0; real.usageOut = 0;
    syncStatusbar();
    try {
      const r = await api.openSession(id);
      if (generation !== openGeneration || real.id !== id) return;
      showHistory(reconcileHistory(r.events, pending.events));
    } catch (err) {
      if (generation !== openGeneration || real.id !== id) return;
      // A failed disk read must not discard events received while it was pending.
      showHistory(pending.events);
      toast('打开会话失败：' + (err && err.message ? err.message : err));
    } finally {
      if (generation === openGeneration && real.id === id) {
        pendingHistory = null;
        real.historyPending = false;
      }
    }
  };
  const _newChatBtn = document.querySelector('#newChat');
  if (_newChatBtn) {
    _newChatBtn.addEventListener('click', (e) => {
      if (e.defaultPrevented) return;
      e.stopImmediatePropagation();
      e.preventDefault();
      if (real.running || sending) { toast('agent 运行中，先停止再新建'); return; }
      void (async () => {
        try {
          const r = await api.createSession();
          real.id = r.id;
          await loadSessions();
          selectSession(real.id, true);
          $('#chatTitle').textContent = '新会话';
          toast('已新建会话');
          promptInput.focus({ preventScroll: true });
        } catch (err) { toast('新建失败：' + (err && err.message ? err.message : err)); }
      })();
    }, true);
  }
  deleteSession = function (id) {
    const s = sessions.find(x => x.id === id);
    void api.deleteSession(id);
    const i = sessions.findIndex(x => x.id === id);
    if (i >= 0) sessions.splice(i, 1);
    if (selectedId === id) {
      ++openGeneration;
      pendingHistory = null;
      real.historyPending = false;
      historyEvents = null;
      clearTranscript();
      real.id = null;
      selectedId = null;
      streamInner.innerHTML = CHAT_EMPTY_HTML;
      $('#chatTitle').textContent = 'Forge';
      toast('已删除会话');
    } else {
      closeSbMenus();
      toast('已删除「' + (s ? s.title : id) + '」');
    }
    render();
  };
  archiveSession = function (id) {
    const s = sessions.find(x => x.id === id);
    if (!s) return;
    const i = sessions.findIndex(x => x.id === id);
    if (i >= 0) sessions.splice(i, 1);
    toast('已归档「' + s.title + '」（会话按 id 保留在磁盘）');
    render();
  };

  /* ---------- 布局持久化（§10.7）：仅 git 视图开关 + activePanel 走 agent settings ----------
     只持久化 git（其余四个原生视图不进 settings，避免与既有 localStorage 语义冲突）；
     renderSide 是开 / 关 / 回主页三路的唯一收口，包一层即可覆盖全部变更路径。 */
  function persistGitLayout() {
    if (typeof api.setSettings !== 'function') return;
    try {
      api.setSettings({
        layout: { open: { git: sideOpenTabs.includes('git') }, activePanel: activeView === 'git' ? 'git' : null },
      });
    } catch (_) {}
  }
  const baseRenderSide = renderSide;
  renderSide = function () {
    baseRenderSide();
    persistGitLayout();
  };

  /* ---------- 启动 ---------- */
  $('#chatTitle').textContent = 'Forge';
  void (async () => {
    const loaded = await loadSessions();
    // Never select the prototype list, or replace a session opened during loading.
    if (loaded && !real.id && sessions.length) await selectSession(sessions[0].id, true);
  })();
  syncStatusbar();
  void initSandboxState();
  /* 恢复上次的 git 视图（仅 git；窗口重开后续上） */
  (async () => {
    try {
      const st = await settingsReady;
      const ly = st && st.layout;
      if (ly && ly.open && ly.open.git) openView('git');
    } catch (_) {}
  })();
})();
