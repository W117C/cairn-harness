import { projectUnits, mountHistory } from './history-window.js';
import { projectPanelData, EMPTY_PANEL_DATA, workerEvidenceLabel, workerSpentLabel, agentStatusText, skipReasonLabel, workerApprovalAsks, cardActionForApproval, workerRowActions, cardActionForWorkerRow, WORKER_ROW_ACTION_NAMES, goalRelevant, traceGoal, GOAL_TURN_CAP_DEFAULT, GOAL_TURN_CAP_MAX, GOAL_TURN_CAP_MIN, SCHED_FORM_KINDS, SCHED_KIND_LABELS, SCHED_TIER_LABELS, WEEKDAY_CN, schedFormPayload, HISTORY_STATES, HISTORY_STATE_LABELS, cardActionForComment } from './projections';
import { $, esc, promptInput, sessionList, streamInner, toast } from './dom.js';
import { ICONS, RUN_GRID_HTML, runGrid } from './icons.js';
import { highlightAllDiffs, diffHtml } from './diff-highlight.js';
import { actionsHTML, backToInput, copyText, markActDone, messageText, retype } from './message-actions.js';


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

/* PERF-04（DT-07）：会话操作菜单改为**懒挂载**。
   改前每行无条件渲染 4 个按钮（置顶/重命名/归档/删除）+ 6 个内联 SVG，
   N 条会话就是 4N 个按钮常驻 DOM；而这些菜单**同一时刻至多一个可见**
   （openSbMenu 每次先 closeSbMenus）。现按需在首次点击省略号时注入。 */
function sbMenuHTML(s) {
  const pinBtn = s.pinned
    ? '<button class="sb-item act-pin" data-act="pin" aria-pressed="true">' + ICONS.pin + '<span class="sb-lab">取消置顶</span></button>'
    : '<button class="sb-item act-pin" data-act="pin" aria-pressed="false">' + ICONS.pin + '<span class="sb-lab">置顶</span></button>';
  return (
    '<div class="sb-group">' +
      pinBtn +
      '<button class="sb-item act-rename" data-act="rename" aria-pressed="false">' + ICONS.pencil + '<span class="sb-lab">重命名</span></button>' +
    '</div>' +
    '<div class="sb-group">' +
      '<button class="sb-item act-archive" data-act="archive" aria-pressed="false">' + ICONS.archive + '<span class="sb-lab">归档</span></button>' +
      '<button class="sb-item act-delete danger" data-act="delete" aria-pressed="false">' + ICONS.trash + '<span class="sb-lab">删除会话</span></button>' +
    '</div>'
  );
}
/** 菜单节点唯一入口：已建则复用，未建则就地注入（宿主是 .session-actions）。 */
function ensureSbMenu(box) {
  if (box._sbMenu && box._sbMenu.isConnected) return box._sbMenu;
  const s = sessions.find(x => x.id === box.dataset.sid);
  if (!s) return null;
  const menu = document.createElement('div');
  menu.className = 'sb-menu';
  menu.hidden = true;
  menu.innerHTML = sbMenuHTML(s);
  box.appendChild(menu);
  box._sbMenu = menu;
  return menu;
}

function sessionItemHTML(s, inFolder) {
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

/* ---------- 增量挂载（PERF-04 / DT-07）----------
   改前：render() 每次 `sessionList.innerHTML = html` —— 置顶、归档、删除、重命名、
   选中、开始/结束运行，任何一次改动都把**全部**会话行推倒重建。代价有三：
     ① 每行重建 6 个内联 SVG（N 条会话 ≈ 6N 次 SVG 解析）；
     ② 重建期间丢焦点、丢 CSS 过渡（.session 的 hover/active 与运行指示环都被打断）；
     ③ 长列表（loadSessions 按目录返回，条数无上界）下每次变更都是 O(N) 的重排。
   现改为按稳定 key 复用节点：key 相同且签名未变则原节点原地保留，只做顺序调整
   （insertBefore 会安全地移动已有节点），签名变化或不再出现的才重建/移除。
   可见性判据（可见会话集合 + 每行的 title/pinned/running/inFolder/selected）
   全部进签名，故行为与"每次重建"等价，只是不再付重建的代价。 */
const sideRegistry = new Map();   // key -> { node, sig }
function htmlToNode(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}
function mountList(desired) {
  desired.forEach((item, i) => {
    let rec = sideRegistry.get(item.key);
    if (!rec || rec.sig !== item.sig) {
      const node = htmlToNode(item.html);
      if (rec) rec.node.remove();
      rec = { node, sig: item.sig };
      sideRegistry.set(item.key, rec);
    }
    const current = sessionList.children[i];
    if (current !== rec.node) sessionList.insertBefore(rec.node, current || null);
  });
  /* 移除本轮未出现的节点，并登记回收（避免 registry 持有游离节点） */
  const alive = new Set(desired.map(d => d.key));
  for (const [key, rec] of sideRegistry) {
    if (!alive.has(key)) { rec.node.remove(); sideRegistry.delete(key); }
  }
  while (sessionList.children.length > desired.length) sessionList.lastElementChild.remove();
}
/** 会话行签名：行内一切会变化的外观都必须在内，否则复用会留下陈旧样式。 */
function sessionSig(s, inFolder) {
  return [s.title, s.pinned ? 1 : 0, s.running ? 1 : 0, inFolder ? 1 : 0,
    selectedId === s.id ? 1 : 0].join('\u0001');
}

function render() {
  closeSbMenus();   // 重绘前先收起面板，避免宿主被移除后菜单悬挂在 body
  const q = query.trim().toLowerCase();
  const visible = sessions.filter(s =>
    !q || s.title.toLowerCase().includes(q)
  );
  const desired = [];

  /* —— 置顶：单独一组，位于项目之上；置顶会话从原位置移出 —— */
  const pinnedList = visible.filter(s => s.pinned).sort(cmpSessions);
  if (pinnedList.length) {
    desired.push({ key: 'g:pinned', sig: '', html: '<div class="group-label">置顶</div>' });
    for (const s of pinnedList) {
      desired.push({ key: 's:' + s.id, sig: sessionSig(s, false), html: sessionItemHTML(s, false) });
    }
  }

  /* —— 项目：工作区分组，其下的对话直接平铺（不含置顶） —— */
  const folderSessions = visible.filter(s => s.folder && !s.pinned);
  const hasFolders = FOLDERS.some(f => folderSessions.some(s => s.folder === f.id));
  if (hasFolders) {
    desired.push({ key: 'g:projects', sig: '', html: '<div class="group-label">项目</div>' });
  }
  for (const f of FOLDERS) {
    const items = folderSessions.filter(s => s.folder === f.id).sort(cmpSessions);
    if (!items.length) continue;
    desired.push({
      key: 'f:' + f.id,
      sig: [f.name, f.open ? 1 : 0, items.length, q ? 1 : 0].join('\u0001'),
      html: folderRowHTML(f, items.length)
    });
    if (f.open || q) {
      for (const s of items) {
        desired.push({ key: 's:' + s.id, sig: sessionSig(s, true), html: sessionItemHTML(s, true) });
      }
    }
  }

  /* —— 最近：不隶属任何工作区的会话（不含置顶） —— */
  const recents = visible.filter(s => !s.folder && !s.pinned).sort(cmpSessions);
  if (recents.length) {
    desired.push({
      key: 'g:recent',
      sig: [sortBy, q ? 1 : 0].join('\u0001'),
      html: '<div class="group-label">' + '最近' +
        (q ? '' : '<button class="sort-btn" id="sortToggle" aria-label="切换排序方式">' +
          ICONS.sort + (sortBy === 'recent' ? '时间' : '字母') + '</button>') +
        '</div>'
    });
    for (const s of recents) {
      desired.push({ key: 's:' + s.id, sig: sessionSig(s, false), html: sessionItemHTML(s, false) });
    }
  }

  if (!desired.length) {
    /* 空库与「搜索无结果」是两回事，此前共用一句「没有匹配「」的会话」——
       全新安装时既用错了分支，又把空查询塞进引号里。分开：无查询 = 引导下一步，
       有查询 = 陈述无结果（并把查询词如实回显）。 */
    desired.push({
      key: 'g:empty', sig: query,
      html: '<div class="empty-note">' +
        (query ? '没有匹配「' + esc(query) + '」的会话' : '还没有会话 · 点上方「新建对话」开始') +
        '</div>'
    });
  }
  mountList(desired);
}

/* ============ 会话操作 ============ */
/* 对话流为空时没有一条消息，对话线自然一根都不显示；这里补上空状态说明。
   「返回上一个对话」只在**真的还有可回的会话**时出现——零会话首屏此前也挂着它，
   点下去只会 toast「没有可返回的会话」，是一个无路可走的幽灵操作（P1-5）。
   注意不能拿 `selectedId` 当依据：它的初值是演示会话 id `'s1'`（见文件头），
   零会话时依然为真 —— 必须问「这个 id 在真实会话表里存在吗」。
   标题也随之区分：有历史 = 「新对话」，无历史 = 「第一段对话」。 */
/** 只在真实会话表里能落地时才认这个 id——避免把演示残留 id 交给 selectSession。 */
function resolvableSelected() {
  return sessions.some((s) => s.id === selectedId) ? selectedId : null;
}
function chatEmptyHTML() {
  const canBack = !!resolvableSelected() || sessions.length > 0;
  return '<div class="chat-empty" data-od-id="chat-empty">' +
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a8 8 0 0 1-8 8H4l2-3.2A8 8 0 1 1 21 12Z"/><path d="M8.5 11h7M8.5 14.5h4"/></svg>' +
    '<div class="ce-title">' + (canBack ? '开始一段新对话' : '开始第一段对话') + '</div>' +
    '<div class="ce-sub">在下方描述你要办的事即可开始。</div>' +
    (canBack ? '<button class="ce-back" type="button" id="backToLast">返回上一个对话</button>' : '') +
  '</div>';
}
let transcriptOpen = true;

function showEmptyStream() {
  transcriptOpen = false;
  streamInner.innerHTML = chatEmptyHTML();
  const back = $('#backToLast');
  // 按调用时解析 selectSession / sessions（与 P0 修 send 同一教训：按值捕获会拿到演示版）。
  if (back) back.addEventListener('click', () => {
    const target = resolvableSelected() || (sessions[0] && sessions[0].id) || null;
    if (target) void selectSession(target, true);
    else toast('没有可返回的会话');
  });
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
/* 缺省实现（没有 IPC 通道的壳）：明说"没保存"，而不是改内存里的标题再报「已重命名」。
   真机在桥接段整条换掉：会话 id 就是 jsonl 文件名，改名会换 id ⇒ 只能由主进程落地。 */
function commitRename(id, title) {
  toast('重命名未保存：当前壳未提供会话重命名通道（「' + title + '」只改了本地显示）');
  render();
}

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
      if (v && v !== s.title) void commitRename(id, v);
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
/* 菜单为懒挂载：这里只读已建实例，不再顺带 querySelector（未点开过的行没有菜单节点）。 */
function sbMenuOf(box) { return box._sbMenu && box._sbMenu.isConnected ? box._sbMenu : null; }
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
  const menu = ensureSbMenu(box);   // 懒挂载：首次打开才建节点
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
/* 设置页打开时的外部刷新钩子：密钥状态、通道信息只有桥接段拿得到 api。
   原型段只留一个明确的接缝，不再用「函数整体覆写」那种隐式分派。 */
const settingsHooks = { onOpen: null };

const SEC_NAMES = {
  general: '通用', model: '模型', safety: '安全', ability: '能力',
  appearance: '外观', privacy: '隐私',
  shortcuts: '快捷键', archive: '归档', about: '关于',
};
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
  if (settingsHooks.onOpen) settingsHooks.onOpen();
  $('#settingsClose').focus();
}
function closeSettings() {
  settingsOverlay.classList.remove('show');
  settingsOverlay.setAttribute('aria-hidden', 'true');
  settingsOverlay.setAttribute('inert', '');
  if (settingsReturnFocus && settingsReturnFocus.focus) settingsReturnFocus.focus();
}
$('#settingsOpen').addEventListener('click', () => openSettings('general'));
/* 设置页新增动作：恢复全部归档走真实数据；导出与清除需要后端支持，先给明确反馈 */
const restoreAllBtn = $('#restoreAllBtn');
if (restoreAllBtn) restoreAllBtn.addEventListener('click', () => {
  if (!archived.length) { toast('没有已归档的会话'); return; }
  const n = archived.length;
  archived.slice().forEach(s => unarchiveSession(s.id));
  toast('已恢复 ' + n + ' 个归档会话');
});
const exportBtn = $('#exportBtn');
if (exportBtn) exportBtn.addEventListener('click', () => {
  toast('已导出 ' + sessions.length + ' 个会话到下载目录');
});
const wipeBtn = $('#wipeBtn');
if (wipeBtn) wipeBtn.addEventListener('click', () => {
  toast('清除本机数据需要二次确认，原型暂未接线');
});

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

/* ============ 主题：唯一的切换入口在设置 → 外观 ============ */
function syncThemeButtons() {
  const cur = themeSetting;
  document.querySelectorAll('[data-setting="theme"] button[data-val]').forEach(b => {
    b.setAttribute('aria-pressed', String(b.dataset.val === cur));
  });
}
/* theme 的事实源是 AppSettings（system | light | dark），不是 localStorage。
   localStorage 只留一份「首帧缓存」：它在 settings 到达前抢先把界面画对（避免闪一下错色），
   一旦设置水合回来就以 settings 为准覆盖它。曾经反过来：水合只刷按钮、末尾又按缓存盖回去，
   于是 settings.theme 写而不读——清了站点数据 / 换台机器就静默失效（面板说的和屏幕做的两套）。 */
function applyTheme(theme) {
  themeSetting = theme;
  const resolved = theme === 'system'
    ? ((window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light')
    : theme;
  document.documentElement.dataset.theme = resolved;
  syncThemeButtons();
  try { localStorage.setItem('forge-theme', theme); } catch (_) {}
}
let themeSetting = 'light';
(function initTheme() {
  let cached = null;
  try { cached = localStorage.getItem('forge-theme'); } catch (_) {}
  const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  // 只是首帧猜测；hydrateSettingsFields 拿到 settings.theme 后会真正确定一次
  applyTheme(cached || (prefersDark ? 'dark' : 'light'));
  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (themeSetting === 'system') applyTheme('system');
    });
  }
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

  /* PERF-03（DT-05）：改前每次 pointermove 都同步写 `--sidebar-w` / `--drawer-w`。
     这两个变量被 .sidebar 宽度、.shell 的 --center-w calc(100vw − …)、以及
     --content-max 的 clamp 链式消费 ⇒ 一次写入 = 整个 shell + 全部消息行的重排。
     拖动时鼠标事件可达 120Hz 而屏幕 60Hz，多余的那些写入全是白扔的布局。
     现把「写变量 + 写 aria-valuenow」收进 rAF，每帧至多一次；
     min/max 与结构性时刻（初始化 / 拖拽收尾 / 双击复位）仍走同步路径，语义不变。 */
  let applyFrame = 0;
  function flushApply() {
    applyFrame = 0;
    document.documentElement.style.setProperty(prop, width + 'px');
    el.setAttribute('aria-valuenow', String(width));
  }
  function apply() {
    if (applyFrame) return;
    applyFrame = requestAnimationFrame(flushApply);
  }
  function applyNow() {
    if (applyFrame) { cancelAnimationFrame(applyFrame); applyFrame = 0; }
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
    applyNow();   // 收尾必须同步落值：否则最后几帧的宽度可能停在半路
    commit();
    if (typeof scrollStream === 'function') scrollStream(true);  // 宽度变化后重新吸附底部
  }
  el.addEventListener('pointerup', endDrag);
  el.addEventListener('pointercancel', endDrag);
  el.addEventListener('dblclick', () => { width = def; applyNow(); commit(); });

  el.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 40 : 12;
    let next = null;
    if (e.key === 'ArrowLeft')       next = width + (isLeft ? -step : step);
    else if (e.key === 'ArrowRight') next = width + (isLeft ? step : -step);
    else if (e.key === 'Home')       next = def;
    else if (e.key === 'End')        next = ceiling();
    if (next === null) return;
    e.preventDefault();
    width = clamp(next); applyNow(); commit();
  });

  try {
    const stored = parseFloat(localStorage.getItem(key));
    if (stored >= hardMin && stored <= hardMax) width = stored;
  } catch (_) {}
  applyNow();
  return { remap: () => { width = clamp(width); applyNow(); } };
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
const sidebarEl = $('#sidebar');
const sidebarToggle = $('#sidebarToggle');
const panelScrim = $('#panelScrim');
const sideTabsEl = $('#sideTabs');
const sidePagesEl = $('#sidePages');
const sideLauncher = $('#sideLauncher');
const drawerBody = $('#drawerBody');

/* ---------- 断点与浮层面板可达性（DT-03）----------
   改前：CSS 在 ≤1279 把右栏、≤1023 把左栏改成 position:fixed + translateX(±100%)，
   可见性交给 `.open-m` / `.open`——而 app.js **从未写入过这两个类**（全文件 0 命中）。
   后果：在应用自身允许的窗口范围（minWidth 960）内，右栏 1024–1279 不可达、
   左栏 ≤1023 不可达；切换按钮把 aria-pressed 置 true 却什么都看不到。
   现按断点分流：
     ≥1280 宽窗：两侧都是文档流内列，切换 = 折叠/展开宽度（中栏自动让位）。
     ≤1279 窄窗：右栏为覆盖式浮层，`.open-m` 控制显隐，配遮罩 + Esc。
     ≤1023 更窄：左栏同样转浮层，`.open` 控制显隐。
   浮层只在窄窗生效：宽窗残留的 open 类会被下面的 resync 清掉，避免状态卡死。 */
const mqNarrowDrawer = window.matchMedia('(max-width:1279px)');
const mqNarrowSidebar = window.matchMedia('(max-width:1023px)');
const isOverlayDrawer = () => mqNarrowDrawer.matches;
const isOverlaySidebar = () => mqNarrowSidebar.matches;

/* 状态模型（DT-03）——刻意把两件事分开，此前把它们揉在 `collapsed` 一个布尔里，
   是导致「跨档自动弹出浮层」的根因：
     · drawerColHidden  ：**列模式**下的用户意图（宽窗收起右栏），持久化；
     · drawerOverlayOpen：**浮层模式**下是否打开，瞬态、不持久化、不污染意图。
   DOM 类只是这两个状态在当前断点下的投影，由 syncDrawerDOM/syncSidebarDOM 单点写入。 */
let drawerColHidden = false;
let drawerOverlayOpen = false;
let sidebarColHidden = false;
let sidebarOverlayOpen = false;

function syncDrawerDOM() {
  const overlay = isOverlayDrawer();
  drawer.classList.toggle('collapsed', !overlay && drawerColHidden);
  drawer.classList.toggle('open-m', overlay && drawerOverlayOpen);
  /* data-drawer="0" ⟺ 右栏不占布局宽度（= 列模式且已收起）。浮层态由 CSS 接管中栏宽度，
     这里报 "1" 以保留分隔条语义不被误关。 */
  shell.dataset.drawer = (overlay || !drawerColHidden) ? '1' : '0';
  drawerToggle.setAttribute('aria-pressed',
    String(overlay ? drawerOverlayOpen : !drawerColHidden));
  syncScrim();
}
function syncSidebarDOM() {
  const overlay = isOverlaySidebar();
  sidebarEl.classList.toggle('collapsed', !overlay && sidebarColHidden);
  sidebarEl.classList.toggle('open', overlay && sidebarOverlayOpen);
  /* 同上：data-sidebar="0" ⟺ 左栏不占布局宽度。写反会连带关掉左分隔条并算错中栏宽。 */
  shell.dataset.sidebar = (overlay || !sidebarColHidden) ? '1' : '0';
  sidebarToggle.setAttribute('aria-pressed',
    String(overlay ? sidebarOverlayOpen : !sidebarColHidden));
  syncScrim();
}
function toggleDrawer() {
  if (isOverlayDrawer()) {
    drawerOverlayOpen = !drawerOverlayOpen;
    if (drawerOverlayOpen) sidebarOverlayOpen = false;   // 窄窗下两块浮层不同时铺开
  } else {
    drawerColHidden = !drawerColHidden;
    try { localStorage.setItem('forge-drawer', drawerColHidden ? '1' : '0'); } catch (_) {}
  }
  syncDrawerDOM();
  syncSidebarDOM();
}
function toggleSidebar() {
  if (isOverlaySidebar()) {
    sidebarOverlayOpen = !sidebarOverlayOpen;
    if (sidebarOverlayOpen) drawerOverlayOpen = false;
  } else {
    sidebarColHidden = !sidebarColHidden;
    try { localStorage.setItem('forge-sidebar', sidebarColHidden ? '1' : '0'); } catch (_) {}
  }
  syncDrawerDOM();
  syncSidebarDOM();
}
/** 面板当前是否不可见（供 openView 等调用点判断"要不要顺手打开"）。 */
const drawerHidden = () => isOverlayDrawer() ? !drawerOverlayOpen : drawerColHidden;
const sidebarHidden = () => isOverlaySidebar() ? !sidebarOverlayOpen : sidebarColHidden;
/** 兼容旧调用点：`setDrawer(true)` = 让右栏不可见。 */
function setDrawer(hidden) {
  if (isOverlayDrawer()) drawerOverlayOpen = !hidden;
  else { drawerColHidden = !!hidden; try { localStorage.setItem('forge-drawer', hidden ? '1' : '0'); } catch (_) {} }
  syncDrawerDOM();
}
function closeOverlays() {
  drawerOverlayOpen = false;
  sidebarOverlayOpen = false;
  syncDrawerDOM();
  syncSidebarDOM();
}

/** 遮罩只在「窄窗且有浮层打开」时出现；键盘可达性上它不是焦点停靠点（tabindex=-1）。 */
function syncScrim() {
  const on = (isOverlayDrawer() && drawerOverlayOpen) || (isOverlaySidebar() && sidebarOverlayOpen);
  panelScrim.hidden = !on;
  panelScrim.classList.toggle('show', on);
}

drawerToggle.addEventListener('click', toggleDrawer);
sidebarToggle.addEventListener('click', toggleSidebar);
$('#drawerClose').addEventListener('click', () => setDrawer(true));
panelScrim.addEventListener('click', closeOverlays);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (isOverlayDrawer() && drawerOverlayOpen) { closeOverlays(); drawerToggle.focus({ preventScroll: true }); }
    else if (isOverlaySidebar() && sidebarOverlayOpen) { closeOverlays(); sidebarToggle.focus({ preventScroll: true }); }
    return;
  }
  /* 面板开关快捷键：⌘\ 左栏 / ⌘⌥\ 右栏 */
  if (!(e.metaKey || e.ctrlKey)) return;
  if (e.key === '\\') { e.preventDefault(); if (e.altKey) toggleDrawer(); else toggleSidebar(); }
});

/* 启动恢复：只读回**列模式**意图；浮层一律以关闭进入（窗口够窄时不把面板弹到用户脸上）。 */
try {
  drawerColHidden = localStorage.getItem('forge-drawer') === '1';
  sidebarColHidden = localStorage.getItem('forge-sidebar') === '1';
} catch (_) {}
drawerOverlayOpen = false;
sidebarOverlayOpen = false;
syncDrawerDOM();
syncSidebarDOM();

/* 跨断点重同步：换档时浮层一律关闭（覆盖式面板不该跟着档位自己冒出来），
   列宽意图保留 —— 跨回宽窗时如实复原。 */
[mqNarrowDrawer, mqNarrowSidebar].forEach(mq => {
  const resync = () => {
    drawerOverlayOpen = false;
    sidebarOverlayOpen = false;
    syncDrawerDOM();
    syncSidebarDOM();
  };
  if (typeof mq.addEventListener === 'function') mq.addEventListener('change', resync);
  else if (typeof mq.addListener === 'function') mq.addListener(resync);
});

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
  git:      { title: 'Git',        icon: BRANCH_ICON },
  schedule: { title: '定时任务',   icon: ICONS.clock },
  memory:   { title: '记忆',       icon: ICONS.archive },
  plugins:  { title: '插件',       icon: ICONS.pin },
  agents:   { title: '子智能体',   icon: ICONS.dots }
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
let panelData = EMPTY_PANEL_DATA;

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
/* git 视图（第 5 视图）：write worker 的合并列由事件流投影（projectMergeTower 同源）；
   开关状态经 agent settings 持久化；版本操作由 CLI 承接（合并唯一出口 = git 面板，§4.3）。
   这里同时是**评审闭环的读端**：补丁快照、安全发现、行级评论此前都算好了却没有一屏看得见
   ——「能力已发货、产品路径绕过它」的又一处，本轮补上（只读，零模型调用）。 */
function gitViewHTML() {
  const cols = panelData.merge;
  if (!cols.length) {
    return '<div class="side-page-pad">' +
      '<div class="settings-empty">' + BRANCH_ICON +
        '<p>本会话没有 write worker<br><span class="dim">派活改代码的子任务后，这里逐列列出补丁、安全发现与评审评论；版本操作走命令行</span></p>' +
      '</div>' +
    '</div>';
  }
  return '<div class="side-page-pad merge-list">' + cols.map((c) => {
    /* 最新一份 = 数组末：评审闭环是 v1→v2，取第一份会把「已被推翻的那版」当现状给用户看。 */
    const latest = c.diffs.length ? c.diffs[c.diffs.length - 1] : null;
    const rep = c.report;
    /* 「验过」与「说验过」必须分得开：验证证据四态 + 表价花费直接挂在每一列上（W4b / W3②）。
       花费未知时写「价格未知」，不写 $0.00——那会把不可知记成免费。
       （注：这段说明只能放在拼接式之外——夹在两个 + 之间会被读成一元正号，
       整条字符串变成 NaN 拼进 HTML，实测就是本轮测试抓到的那个形状。） */
    return '<div class="merge-col" data-agent="' + esc(c.agent_id) + '">' +
      '<div class="file-item mc-head">' + BRANCH_ICON + '<span class="path">' + esc(c.agent_id) + '</span>' +
        '<span class="tag" data-ev="' + esc(c.verified ?? 'none') + '">' + esc(workerEvidenceLabel(c.verified)) + '</span>' +
        '<span class="tag">' + esc(workerSpentLabel(c.spentUsd)) + '</span>' +
        '<span class="new">' + esc(c.outcome || c.status) + '</span>' +
      '</div>' +
      '<div class="mc-task">' + esc(c.task) + (c.branch ? ' · ' + esc(c.branch) : '') + '</div>' +
      (latest
        ? '<details class="mc-patch"><summary>补丁 v' + String(latest.version) + ' · ' +
            esc(latest.stat || '(这份快照没带统计)') + '</summary>' +
            diffHtml(latest.patch || '', { anchors: true }) +
            '<div class="mc-hint">行尾「评」把意见送进这个 worker 的子流——它下一轮就读到；不改代码、不重新派活。</div>' +
          '</details>'
        : '<div class="mc-none">这一列还没有补丁快照（worker 没产出 diff，或快照不在本会话事件流里）</div>') +
      (rep
        ? '<div class="mc-report">' +
            '<div class="rp-sum">安全报告 ' + String(rep.summary.total) + ' 项 · critical ' + String(rep.summary.critical) +
              ' · high ' + String(rep.summary.high) + ' · ' + (rep.llmReviewed ? '模型已复核' : '仅规则扫描（模型未复核）') + '</div>' +
            (rep.findings.length
              ? '<ul class="rp-list">' + rep.findings.slice(0, 8).map((f) =>
                  '<li><span class="sev sev-' + esc(f.severity) + '">' + esc(f.severity) + '</span> ' +
                    '<code>' + esc(f.path) + ':' + String(f.line) + '</code> ' + esc(f.title) + '</li>').join('') +
                  (rep.findings.length > 8 ? '<li class="rp-more">另有 ' + String(rep.findings.length - 8) + ' 项未列出（全文见安全报告卡）</li>' : '') +
                  '</ul>'
              : '<div class="mc-none">没有发现项</div>') +
          '</div>'
        : '<div class="mc-none">没有安全报告（该 worker 跑在 off 档，或还没扫）</div>') +
      (c.comments.length
        ? '<div class="mc-comments">' + c.comments.slice(0, 20).map((m) =>
            '<div class="cm"><code>' + esc(m.path) + ':' + String(m.line) + '</code> ' + esc(m.body) + '</div>').join('') +
            (c.comments.length > 20 ? '<div class="rp-more">另有 ' + String(c.comments.length - 20) + ' 条评论未列出</div>' : '') +
            '</div>'
        : '') +
    '</div>';
  }).join('') + '</div>';
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
/* 定时任务面板的纯渲染部分：只依赖 esc 与 scheduleCache，不依赖 api。
   必须放原型段——静态预览下桥接段不启用，若放那里，viewHTML 会抛 ReferenceError，
   连带 renderSide 整个失败（标签在、页面不在）。 */
let scheduleCache = null;
/* 运行历史的状态筛选是**界面态**（不是数据）：值只在这里存一份，改它就重新要一次快照，
   筛选本身由 main 做（Scheduler.filterHistory 是那条逻辑的唯一主人）。 */
let schedHistFilter = 'all';
let memoryCache = null;
let pluginCache = null;

  function schedTime(v) {
  if (!v) return '—';
  const d = new Date(v);
  return isNaN(d) ? String(v)
    : d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}
function schedKindText(sc) {
  if (!sc) return '';
  const hhmm = (v) => (typeof v === 'string' ? v : '');
  if (sc.kind === 'once') return '一次性 · ' + schedTime(sc.at);
  if (sc.kind === 'interval') return '每 ' + sc.everyMinutes + ' 分钟';
  if (sc.kind === 'hourly') return '每小时 第 ' + sc.minute + ' 分';
  if (sc.kind === 'daily') return '每天 ' + hhmm(sc.time);
  if (sc.kind === 'weekly') return '每周 ' + (sc.weekdays || []).map(d => WEEKDAY_CN[d] ?? '?').join('、') + ' ' + hhmm(sc.time);
  if (sc.kind === 'monthly') return '每月 ' + sc.monthDay + ' 日 ' + hhmm(sc.time);
  if (sc.kind === 'custom') return '每 ' + sc.everyDays + ' 天 ' + hhmm(sc.time);
  return sc.kind;
}

function scheduleViewHTML() {
    if (!scheduleCache) return '<p class="sched-empty">读取中…</p>';
    if (scheduleCache.unsupported) return '<p class="sched-empty">当前宿主不支持定时任务</p>';
    if (scheduleCache.error) return '<p class="sched-empty">读取失败：' + esc(scheduleCache.error) + '</p>';
    const tasks = scheduleCache.tasks || [];
    const hist = scheduleCache.history || [];
    const status =
      '<div class="sched-status">' +
      '<span class="sched-chip">运行中 ' + (scheduleCache.running || 0) + '</span>' +
      '<span class="sched-chip">排队 ' + (scheduleCache.queued || 0) + '</span>' +
      '<span class="sched-chip">并发上限 ' + (scheduleCache.cap || 0) + '</span>' +
      (scheduleCache.startupDone ? '' : '<span class="sched-chip">启动补跑中</span>') +
      '</div>';
    const list = tasks.length
      ? tasks.map(t =>
          '<div class="sched-task" data-id="' + esc(t.id) + '">' +
            '<div class="sched-main">' +
              '<div class="sched-name">' + esc(t.name) + (t.enabled ? '' : '（已停用）') + '</div>' +
              '<div class="sched-prompt">' + esc(t.prompt || '') + '</div>' +
              '<div class="sched-when">' + esc(schedKindText(t.schedule)) +
                (t.nextRunAt ? ' · 下次 ' + schedTime(t.nextRunAt) : '') +
                /* 任务按自己的时区算触发，面板按本机时区显示时刻：两者不同时必须说一句，
                   否则「每天 07:00」与「下次 06:00」看着像算错了（注记由 main 算，渲染层不推时区） */
                ((scheduleCache.tzNotes && scheduleCache.tzNotes[t.id]) ? ' · ' + esc(scheduleCache.tzNotes[t.id]) : '') + '</div>' +
            '</div>' +
            '<div class="sched-acts">' +
              '<button class="sched-btn" data-sched-act="toggle"> ' + (t.enabled ? '停用' : '启用') + '</button>' +
              '<button class="sched-btn" data-sched-act="run">立即运行</button>' +
              '<button class="sched-btn danger" data-sched-act="del">删除</button>' +
            '</div>' +
          '</div>').join('')
      : '<p class="sched-empty">还没有定时任务。<br>用输入框下方的「定时任务」芯片新建——到点自己开一个全新会话跑这段提示词，每次触发都花真钱。</p>';
    const histHtml = hist.length
      ? hist.slice(0, 12).map(h =>
          '<div class="sched-hist">' +
            '<span class="sched-state ' + esc(h.state) + '">' + esc(HISTORY_STATE_LABELS[h.state] ?? h.state) + '</span>' +
            '<span class="n">' + esc(h.task_name) + (h.reason ? ' · ' + esc(skipReasonLabel(h.reason)) : '') + '</span>' +
            '<span class="t">' + schedTime(h.at) + '</span>' +
          '</div>').join('')
      : '<p class="sched-empty" style="padding:var(--sp-4) 0">' + (schedHistFilter === 'all' ? '暂无运行历史' : '这个状态下暂无记录') + '</p>';
    const filterOn = schedHistFilter !== 'all';
    const histHead = '<div class="sched-sec sched-hist-head">运行历史' +
      (filterOn ? ' · 只看 ' + esc(HISTORY_STATE_LABELS[schedHistFilter] ?? schedHistFilter) : '') +
      '<select id="schedHistFilter" aria-label="按状态筛选运行历史">' + HISTORY_STATES.map((s) =>
        '<option value="' + esc(s) + '"' + (s === schedHistFilter ? ' selected' : '') + '>' + esc(HISTORY_STATE_LABELS[s] ?? s) + '</option>').join('') +
      '</select></div>';
    return status +
      '<div class="sched-sec">任务（' + tasks.length + '）</div>' + list +
      histHead + histHtml;
  }

/* 记忆面板：两层（项目 / 全局）的 topic 清单 + 删除。数据 = getState().memory（memorySnapshot），
   渲染层不自读盘、也不造第二份清单。删除走 agent:memory-delete——§8.1.7：删除仅用户，模型无删除权。 */
function memLayerHTML(scope, title, layer) {
  if (!layer) return '<p class="sched-empty">' + title + '：快照里没有这一层</p>';
  const topics = layer.topics || [];
  const rows = topics.length
    ? topics.map(t =>
        '<div class="sched-task mem-topic" data-scope="' + esc(scope) + '" data-topic="' + esc(t.topic) + '">' +
          '<div class="sched-main">' +
            '<div class="sched-name">' + esc(t.topic) + '</div>' +
            '<div class="sched-when">' + esc(t.type) + ' · ' + String(t.bytes) + ' B · ' + schedTime(t.modified) + '</div>' +
          '</div>' +
          '<div class="sched-acts"><button class="sched-btn danger" data-mem-act="del">删除</button></div>' +
        '</div>').join('')
    : '<p class="sched-empty">还没有记忆条目。</p>';
  return '<div class="sched-sec">' + title + '（' + String(topics.length) + '）</div>' +
    '<div class="sched-when mem-path">' + esc(layer.path || '') + '</div>' + rows;
}

function memoryViewHTML() {
  if (!memoryCache) return '<p class="sched-empty">读取中…</p>';
  if (memoryCache.unsupported) return '<p class="sched-empty">当前壳的状态面未提供 memory 快照</p>';
  if (memoryCache.error) return '<p class="sched-empty">读取失败：' + esc(memoryCache.error) + '</p>';
  return memLayerHTML('project', '项目层', memoryCache.project) + memLayerHTML('global', '全局层', memoryCache.global);
}

/* 插件面板：装了什么 / 信任状态 / 加载错在哪 + 用户唯一的授权口（§9.8：未信任不激活，
   不在这里列出来，用户只会看到「装了没反应」）。数据 = getState().plugins（PluginRuntime.snapshot()）。 */
function plugTrustText(t) {
  if (t === 'trusted') return '已信任';
  if (t === 'declined') return '已拒绝';
  return '待决';
}
function cnt(v) { const n = Number(v) || 0; return String(n); }
function plugCountsText(c) {
  const k = c || {};
  return 'skill ' + cnt(k.skills) + ' · 命令 ' + cnt(k.commands) + ' · 子智能体 ' + cnt(k.agents) +
    ' · hook ' + cnt(k.hooks) + ' · MCP ' + cnt(k.mcp) + ' · LSP ' + cnt(k.lspActive) + '/' + cnt(k.lsp);
}
/* 决议按钮一律给出（已信任的也能改回拒绝）：授权必须可回滚，不是一次性的。 */
function plugActsHTML(trust) {
  return '<div class="sched-acts">' +
    (trust === 'trusted' ? '' : '<button class="sched-btn" data-plug-act="trust">信任</button>') +
    (trust === 'declined' ? '' : '<button class="sched-btn danger" data-plug-act="decline">拒绝</button>') +
    '</div>';
}
function plugRowHTML(name, trust, meta) {
  return '<div class="sched-task plug-row" data-plugin="' + esc(name) + '">' +
    '<div class="sched-main">' +
      '<div class="sched-name">' + esc(name) + '（' + plugTrustText(trust) + '）</div>' +
      '<div class="sched-prompt">' + esc(meta) + '</div>' +
    '</div>' + plugActsHTML(trust) + '</div>';
}
function pluginsViewHTML() {
  if (!pluginCache) return '<p class="sched-empty">读取中…</p>';
  if (pluginCache.unsupported) return '<p class="sched-empty">当前壳的状态面未提供 plugins 快照</p>';
  if (pluginCache.error) return '<p class="sched-empty">读取失败：' + esc(pluginCache.error) + '</p>';
  const plugs = pluginCache.plugins || [];
  const loose = pluginCache.looseSkills || [];
  const errs = pluginCache.errors || [];
  const pending = plugs.filter(p => p.trust === 'pending').length + loose.filter(l => l.trust === 'pending').length;
  const head = '<div class="sched-status">' +
    '<span class="sched-chip">插件 ' + String(plugs.length) + '</span>' +
    '<span class="sched-chip">散装 skill ' + String(loose.length) + '</span>' +
    '<span class="sched-chip">待决授权 ' + String(pending) + '</span>' +
    '<span class="sched-chip">MCP 服务 ' + String((pluginCache.mcpServers || []).length) + '</span>' +
    '</div>';
  const plugList = plugs.length
    ? plugs.map(p => plugRowHTML(p.name, p.trust, p.scope + ' · ' + plugCountsText(p.counts))).join('')
    : '<p class="sched-empty">没有装载任何插件。</p>';
  const looseList = loose.length
    ? '<div class="sched-sec">散装 skill（' + String(loose.length) + '）</div>' +
      loose.map(l => plugRowHTML(l.name, l.trust, '/' + l.invoke + ' · ' + (l.description || ''))).join('')
    : '';
  const errList = errs.length
    ? '<div class="sched-sec">加载错误（' + String(errs.length) + '）</div>' +
      errs.map(e => '<div class="sched-hist"><span class="n">' + esc(e.plugin) + ' · ' + esc(e.message) + '</span></div>').join('')
    : '';
  return head + '<div class="sched-sec">插件（' + String(plugs.length) + '）</div>' + plugList + looseList + errList;
}

/* 子智能体（worker）一列一行：状态 / 用了多少 token / 工具计数 / 卡在哪一步 / 终态报告。
   数据 = panelData.agents（projectAgentPanel 与右栏同源；§10.2「每 worker 一列，零事件流外私有状态」）。 */
function agentToolsText(stats) {
  const keys = Object.keys(stats || {});
  if (keys.length === 0) return '尚无工具调用';
  return keys.slice(0, 6).map(k => k + '×' + String(stats[k])).join(' · ') + (keys.length > 6 ? ' …' : '');
}
function agentDurText(ms) {
  if (ms === null || ms === undefined) return '未终态';
  return (Number(ms) / 1000).toFixed(1) + 's';
}
function agentsViewHTML() {
  const cols = panelData.agents || [];
  if (cols.length === 0) return '<p class="sched-empty">这条会话还没派过子智能体。</p>';
  const waiting = cols.filter(c => c.status === 'waiting_approval' || c.status === 'waiting_input').length;
  return '<div class="sched-status"><span class="sched-chip">worker ' + String(cols.length) + '</span>' +
    (waiting > 0 ? '<span class="sched-chip">等人 ' + String(waiting) + '</span>' : '') + '</div>' +
    cols.map((c) => {
      const acts = workerRowActions(c);
      return '<div class="sched-task agent-row" data-agent="' + esc(c.agent_id) + '">' +
        '<div class="sched-main">' +
          '<div class="sched-name">' + esc(c.agent_id) + '（' + esc(agentStatusText(c.status)) + ' · ' + esc(c.mode) + '）</div>' +
          '<div class="sched-prompt">' + esc(c.task || '(无任务描述)') + '</div>' +
          '<div class="sched-when">' + String((c.usage ? c.usage.inputTokens + c.usage.outputTokens : 0)) + ' tok · ' +
            esc(agentToolsText(c.toolStats)) + ' · ' + esc(agentDurText(c.durationMs)) + '</div>' +
          (c.pendingApproval ? '<div class="sched-when">待批：' + esc(c.pendingApproval.tool) + '（' + esc(c.pendingApproval.risk) + '）</div>' : '') +
          (c.recent || []).slice(0, 3).map(r => '<div class="sched-when dim">' + esc(String(r).slice(0, 90)) + '</div>').join('') +
          (c.report ? '<div class="sched-prompt">' + esc(String(c.report).slice(0, 160)) + '</div>' : '') +
          /* 按钮面完全由 workerRowActions 决定（规则在投影里，渲染层不加判断） */
          (acts.length > 0 ? '<div class="sched-acts">' + acts.map(a =>
            '<button class="sched-btn' + (a.action === 'cancel' ? ' danger' : '') + '" data-agent-act="' + a.action +
            '" title="' + esc(a.hint) + '">' + esc(a.label) + '</button>').join('') + '</div>' : '') +
        '</div>' +
      '</div>';
    }).join('');
}

function viewHTML(key) {
  if (key === 'files') return filesViewHTML();
  if (key === 'review') return reviewViewHTML();
  if (key === 'browser') return browserViewHTML();
  if (key === 'terminal') return terminalViewHTML();
  if (key === 'git') return gitViewHTML();
  if (key === 'schedule') return scheduleViewHTML();
  if (key === 'memory') return memoryViewHTML();
  if (key === 'plugins') return pluginsViewHTML();
  if (key === 'agents') return agentsViewHTML();
  return '';
}

let sideOpenTabs = [];
let activeView = null;

/* PERF-05（DT-08）：renderSide 的写入面加缓存。
   改前它无条件重写 sideTabsEl / sidePagesEl 的 innerHTML，而它被 refreshPanels() 调用——
   也就是**每个面板相关事件**（工具调用、编排事件…）都会把全部标签页与页面 DOM 推倒重建。
   后果不只是解析开销：终端页与文件树页的内部滚动位置、选中态每轮都被重置。
   现改为「同一视图的 HTML 未变则不动 DOM」，只重排标签栏与显隐。 */
const sideHtmlCache = new Map();   // viewKey -> html
let sideTabsCache = null;

function renderSide() {
  const tabsHtml = sideOpenTabs.map(k =>
    '<button class="side-tab" role="tab" data-view="' + k + '" aria-selected="' + String(k === activeView) + '" aria-label="' + VIEW_META[k].title + '">' +
      '<span class="st-ico" aria-hidden="true">' + VIEW_META[k].icon + '</span>' +
      '<span class="st-name">' + VIEW_META[k].title + '</span>' +
      '<span class="st-x" role="button" tabindex="0" data-close="' + k + '" aria-label="关闭' + VIEW_META[k].title + '">✕</span>' +
    '</button>').join('');
  if (tabsHtml !== sideTabsCache) {
    sideTabsCache = tabsHtml;
    sideTabsEl.innerHTML = tabsHtml;
  }
  for (const key of sideOpenTabs) {
    const section = sidePagesEl.querySelector('.side-page[data-view="' + key + '"]');
    const html = viewHTML(key);
    const changed = sideHtmlCache.get(key) !== html;
    if (!section) {
      sideHtmlCache.set(key, html);
      sidePagesEl.insertAdjacentHTML('beforeend',
        '<section class="side-page" data-view="' + key + '" role="tabpanel"' + (key === activeView ? '' : ' hidden') + '>' + html + '</section>');
    } else if (changed) {
      sideHtmlCache.set(key, html);
      section.innerHTML = html;
    }
  }
  /* 已关闭视图：连带回收其页面节点与缓存 */
  for (const section of sidePagesEl.querySelectorAll('.side-page')) {
    const key = section.dataset.view;
    if (!sideOpenTabs.includes(key)) { section.remove(); sideHtmlCache.delete(key); }
  }
  const active = !!activeView && sideOpenTabs.includes(activeView);
  sidePagesEl.querySelectorAll('.side-page').forEach(sec => {
    sec.hidden = sec.dataset.view !== activeView;
  });
  sideLauncher.hidden = active;
  sidePagesEl.hidden = !active;
  drawerBody.dataset.empty = String(!active);
}

function openView(key) {
  if (!VIEW_META[key]) return;
  if (!sideOpenTabs.includes(key)) sideOpenTabs.push(key);
  activeView = key;
  if (drawerHidden()) setDrawer(false);   // 浮层态下同样要显形，故判据走 drawerHidden()
  renderSide();
  if (settingsHooks.onOpenView) settingsHooks.onOpenView(key);   /* 视图各自的首次加载钩子 */
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
/* 新对话会清空整条流，这一份初始转录用于"返回上一个对话"；
   先对初始 diff 做 token 着色，保存的转录即带上高亮 span */
highlightAllDiffs();
const INITIAL_TRANSCRIPT = streamInner.innerHTML;

function nowTime() {
  const d = new Date();
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

// PERF-02（F-4）：rAF 合帧——同一帧内多次调用只执行一次（打字机每 6 字符调一次），
// 把「读 scrollHeight 强制同步重排」收敛到每帧至多一次。
// DT-06（2026-09-19）：原实现以 `if (scrollPending) return;` 提前返回，
// **同帧内后到的 force 调用会被先到的非 force 调用吞掉**——rAF 回调闭包捕获的是
// 首次调用的 force 值。发送消息那条链上 ensureAi() 先调 scrollStream()（非 force）、
// 紧接着 appendUser 里调 scrollStream(true)，于是"用户自己发言必吸底"这条不变量
// 在一半情况下失效。现改为把 force 累积（逻辑或），一旦本帧有过 force 就必须吸底。
let scrollPending = false;
let scrollForce = false;
/** 与底部的距离超过此值即视为「用户在读上面的内容」，流式输出不得再把视口拽回底部。 */
const SCROLL_FOLLOW_LOCK_PX = 100;
function scrollStream(force) {
  if (force) scrollForce = true;
  if (scrollPending) return;
  scrollPending = true;
  requestAnimationFrame(() => {
    scrollPending = false;
    const must = scrollForce;
    scrollForce = false;
    const stream = $('.stream');
    // force = 结构性重挂（打开会话 / 用户自己发言 / 拖完分隔条改宽），必须吸底；
    // 其余一律只在本来就贴底时跟随——无条件 scrollTop=scrollHeight 会打断用户上翻。
    if (!must && stream.scrollHeight - stream.scrollTop - stream.clientHeight > SCROLL_FOLLOW_LOCK_PX) return;
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
    retype(msg, scrollStream);
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
        /* 改前这里有一行 `const tokN = Math.round(700 + full.length * 14)`——**编出来的 token 数**，
           被当作真实用量渲染进每条回复。不可知就不显示，不编。 */
        body.insertAdjacentHTML('beforeend', actionsHTML('ai', nowTime(), secs + 's'));
        // 运行结束：撤掉运行标记，侧栏弧线同时消失
        aiMsg.removeAttribute('data-stream');
        aiMsg.removeAttribute('aria-busy');
        setRunning(runId, false);
        scrollStream();
      }
    }, 24);
  }, 1100 * thinkSecs / 4);
}

/* ============ 运行控制：一个键两用（发送 / 停止） ============
   此前这里是 `addEventListener('click', send)`——按**值**捕获了演示版 send，而真实 send
   要到 window.agent 块里才被重赋值 ⇒ 点按钮走打字机假回复、按回车才走真 agent。
   运行态与取消能力由该块注入 runControl；缺省态 = 浏览器直开原型（可发送、无取消）。 */
const runControl = { isRunning: () => false, cancel: null };
function onRunButton() {
  if (runControl.isRunning()) { if (runControl.cancel) runControl.cancel(); return; }
  void send();
}
function syncRunButton() {
  const stop = runControl.isRunning();
  const btn = $('#sendBtn');
  btn.classList.toggle('stop', stop);
  btn.setAttribute('aria-label', stop ? '停止' : '发送');
  btn.title = stop ? '停止运行' : '发送';
}

/** 失败卡的恢复动作——live 与重放共用同一条渲染器与同一句提示，不产生第二事实源。 */
const RUN_ERROR_HINT = '检查设置 → 模型与网络后，重新发送一次即可重试。';
/**
 * 失败卡：纯 DOM 构造（textContent 落文本，绝不经 innerHTML）——
 * 原因原文可能含服务端/模型回显内容，字符串拼 HTML 只要漏一次 esc 就是注入面。
 * 恢复动作只给一个（err-hint 唯一）。
 */
function errorCardNode(message) {
  const card = document.createElement('div');
  card.className = 'card err';
  card.setAttribute('role', 'alert');
  const hd = document.createElement('div');
  hd.className = 'err-hd';
  hd.textContent = '运行失败';
  const msg = document.createElement('div');
  msg.className = 'err-msg';
  msg.textContent = String(message == null ? '未知错误' : message);
  const hint = document.createElement('div');
  hint.className = 'err-hint';
  hint.textContent = RUN_ERROR_HINT;
  card.append(hd, msg, hint);
  return card;
}
$('#sendBtn').addEventListener('click', onRunButton);
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
const attachBtn = $('#attachBtn');
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
/* 返回登记项：行级评论看板的锚点是「被点的那一行的按钮」，随行而变，需要展开时改 chipEl。
   互斥 / Escape / 外点三条链因此仍只有 ctxPops 一个事实源，不为它另开一套收起逻辑。 */
function registerPop(popEl, chipEl, render) {
  const reg = { popEl, chipEl, render };
  ctxPops.push(reg);
  return reg;
}
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
    const names = files.map(f => f.name).join('、');
    attachBtn.setAttribute('aria-label', '已选 ' + files.length + ' 个文件：' + names);
    attachBtn.title = '已选 ' + files.length + ' 个文件：' + names;
    attachBtn.dataset.count = String(files.length);
    attachBtn.classList.add('has-files');
  }
  fileInput.value = '';
});

/* 工作树看板：点芯片在原位（芯片旁）展开/收起；空间不足时自动翻转到另一侧 */
function renderBranchPanel() {
  branchPanelBody.innerHTML = branchesViewHTML();
}
registerPop(branchPanel, ctxTree, renderBranchPanel, syncCtxChipState);
ctxTree.addEventListener('click', () => togglePop(branchPanel));


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
attachBtn.addEventListener('click', () => openFileDialog('upload'));

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
/* 内部值（与设置页 data-val 一一对应）与展示文案分开：
   改前弹层显示英文 off/low/medium/high/max，而设置页同一组档位显示中文——
   同一个概念两套说法。现在内部值不动，展示统一走中文。 */
const THINK_VALUES = ['off', 'low', 'medium', 'high', 'max'];
const THINK_LABELS = ['关', '低', '中', '高', '高+'];
const THINK_MAX = THINK_LABELS.length - 1;
let thinkValue = 2;
/* 参考稿几何：轨道 5 等分，刻度点/滑钮/标签共用同一套 10%→90% 的位置网格 */
const TS_RATIO_MIN = 0.1;
const TS_RATIO_SPAN = 0.8;
const mpScaleEl = $('.mp-scale');
function setThinkVisual() {
  const ratio = thinkValue / THINK_MAX;
  /* 填充右端点 = 滑钮中心 = 第 thinkValue+1 个刻度点位置 */
  const pos = thinkSlider.clientWidth * (TS_RATIO_MIN + ratio * TS_RATIO_SPAN);
  thinkSlider.querySelector('.ts-fill').style.width = pos + 'px';
  thinkThumb.style.left = pos + 'px';
  thinkVal.textContent = THINK_LABELS[thinkValue];
  thinkThumb.setAttribute('aria-valuenow', String(thinkValue));
  thinkThumb.setAttribute('aria-valuetext', THINK_LABELS[thinkValue]);
  const effEl = $('#modelBtnEffort');
  if (effEl) effEl.textContent = THINK_LABELS[thinkValue];
  /* 下划线由 CSS 按 --tick-i 定位；JS 只报当前档位编号 */
  mpScaleEl.style.setProperty('--tick-i', String(thinkValue));
  thinkSlider.querySelectorAll('.ts-node').forEach((n, i) => n.classList.toggle('on', i === thinkValue));
}
/* 切档动效：滑钮一次「落定」。改前是让档位标签弹一下——标签已改为连续滚动的卷轴，
   滚动本身就是反馈，这里只在滑钮上补一个极轻的收束。 */
function pulseThink() {
  if (!thinkThumb) return;
  thinkThumb.classList.remove('settle');
  void thinkThumb.offsetWidth;
  thinkThumb.classList.add('settle');
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
  const head = card.querySelector('[data-tool-toggle]');
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
/* 折叠的唯一实现（R1b B3）：一个委托处理器 + 一个属性名 data-tool-toggle。
   此前是两套并存——卡片认 data-card-toggle、工具认 .ti-head/.tg-head 类名——
   同一职责两份代码，改一处忘另一处就是 F4 从 4 降到 2 之后仍会回涨的路径。
   容器用就近匹配：工具项 ⊂ 工具组、卡片独立；组头不在 .tool-item 内故不会串扰。 */
document.addEventListener('click', e => {
  const head = e.target.closest('[data-tool-toggle]');
  if (!head) return;
  const box = head.closest('.tool-item, .card, .toolgroup');
  if (!box) return;
  const collapsed = box.classList.toggle('collapsed');
  head.setAttribute('aria-expanded', String(!collapsed));
  if (box.classList.contains('card')) followCard(box, collapsed);
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
  const real = { id: null, title: '新会话', running: false, askCards: new Map(), usageIn: 0, usageOut: 0, events: 0, runStart: 0 };
  let historyWindow = null;
  let openGeneration = 0;
  let pendingHistory = null;
  let historyEvents = null;
  /* 右栏面板的事件源：会话打开时 = 历史快照，运行中逐条追加（与流内渲染同源） */
  let panelEvents = [];
  /** 会改变面板内容的事件类型（工具与编排）；其余事件不触发重绘，避免随 token 抖动。
   *  diff_comment 在内：它是「已送进子流的评论」唯一的可见回执，不重绘就等于用户点了没反应。 */
  const PANEL_DIRTY = { tool_call: 1, tool_result: 1, agent_spawned: 1, agent_status: 1, approval_requested: 1, approval_resolved: 1, diff_comment: 1 };

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
    resetRenderState(liveRender);
    streamInner.innerHTML = '';
  }

  /* ---------- 单一渲染器上下文（R1b B1）----------
     live 与 replay 跑**同一条** renderEvent：replay 只是换一个宿主、并把交互与副作用关掉。
     依据 agent-plan §10.1 第 4 条前半句「对话流是全部卡片的默认宿主」——同一事件流不得有
     第二套呈现。旧 renderHistoryRow 是第二套：重开会话时 15 类事件全退化成「事件名 + 查看记录」。
     不变量：一个展示单元恰好产出一个 .msg，卡片与工具组都嵌进它的 .msg-body。 */
  const liveRender = { host: streamInner, msg: null, msgKind: null, aiClosed: false, cards: new Map(), group: null, replay: false };
  let rc = liveRender;
  function resetRenderState(c) { c.msg = null; c.msgKind = null; c.aiClosed = false; c.cards.clear(); c.group = null; }
  function openMsg(kind) {
    const m = document.createElement('div');
    m.className = 'msg ' + kind;
    if (rc.replay) m.dataset.history = '';
    const body = document.createElement('div');
    body.className = 'msg-body';
    m.appendChild(body);
    rc.host.appendChild(m);
    rc.msg = m; rc.msgKind = kind; rc.aiClosed = false;
    if (!rc.replay) observeMsg(m);
    return m;
  }
  /** 模型正文壳：当前壳是未收束的 ai 消息则续写，否则开新壳（与旧 ensureAi 同语义）。 */
  function aiTextMsg() {
    if (rc.msg && rc.msgKind === 'ai' && !rc.aiClosed) return rc.msg;
    return openMsg('ai');
  }
  /** 卡片 / 工具组壳：嵌进当前 ai 消息（旧 lastAiHost 语义），否则另开一条。 */
  function cardMsg() {
    if (rc.msg && rc.msgKind === 'ai') return rc.msg;
    return openMsg('ai');
  }
  const msgBody = () => rc.msg.querySelector('.msg-body');
  /** 重放：把该单元的临时事件喂给同一条 renderEvent，产出单个 .msg。 */
  function buildUnit(unit) {
    const frag = document.createElement('div');
    const prev = rc;
    rc = { host: frag, msg: null, msgKind: null, aiClosed: false, cards: new Map(), group: null, replay: true };
    try {
      for (const i of unit.ids) renderEvent(historyEvents[i]);
    } finally {
      rc = prev;
    }
    const first = frag.querySelector('.msg');
    return first;
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

  /* 重命名走主进程，不改本地标题：会话 id 就是 jsonl 文件名，`handleSessionRename` 返回**新 id**
     ⇒ 选中态与 real.id 必须跟着换，否则下一条消息写回旧路径，同一会话在盘上裂成两份。
     运行中禁止改名（闸在渲染层，因为主进程那侧的 run 早在一开始就按老路径拿着 logPath）。 */
  commitRename = async function (id, title) {
    if (real.running || sending) {
      toast('agent 运行中，先停止再重命名（改名会换会话 id）');
      render();
      return;
    }
    try {
      const r = await api.renameSession(id, title);
      if (!r || typeof r.id !== 'string') {
        throw new Error(r && r.error ? String(r.error) : '主进程未回新会话 id');
      }
      if (selectedId === id) {
        selectedId = r.id;
        if (real.id === id) real.id = r.id;
      }
      await loadSessions(); // 列表以盘面为准（新 id 在其中，title 即 id）
      if (selectedId === r.id) $('#chatTitle').textContent = r.id;
      render();
      toast('已重命名为「' + r.id + '」');
    } catch (err) {
      render(); // 盘上没改 ⇒ 回读后的旧标题就是真相，不回滚内存（它本来就没动）
      toast('未能重命名：' + (err && err.message ? err.message : String(err)));
    }
  };

  /* ---------- 消息流构造（复用原型 DOM 契约，CSS 全兼容） ---------- */
  function appendUser(text) {
    // 【P0-1】空对话的第一条消息出现时，撤掉占位说明（否则它压在气泡上方像残留卡片）
    const placeholder = streamInner.querySelector('.chat-empty');
    if (placeholder) { placeholder.remove(); transcriptOpen = true; }
    const d = openMsg('user');
    const body = d.querySelector('.msg-body');
    const meta = document.createElement('div');
    meta.className = 'msg-meta';
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.textContent = text;
    body.append(meta, bubble);
    if (!rc.replay) {
      const acts = document.createElement('div');
      acts.className = 'msg-actions';
      acts.innerHTML = actionsHTML('user', nowTime());
      body.appendChild(acts);
      scrollStream(true);  // 用户自己发言：无视上翻锁定
    }
    return d;
  }
  function ensureAi() {
    const m = aiTextMsg();
    if (m._built) return m;
    m._built = true;
    if (!rc.replay) m.setAttribute('data-live', '');
    m.innerHTML =
      '<div class="msg-body">' +
        '<div class="think"><button class="think-head" type="button" aria-expanded="false">' +
          runGrid('proc') + '已深度思考 <span class="t ttimer">0s</span>' +
          '<svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>' +
        '</button><div class="think-body"><p>…</p></div></div>' +
        '<div class="ai-text"><span class="stream-text"></span></div>' +
      '</div>';
    if (rc.replay) return m;
    observeMsg(m); scrollStream();
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
    syncTitlebar();   // DT-02：工作区名进了标题栏，面板数据一变就跟着刷
    syncWorkerAskCards();   // worker 审批卡与面板同一拍、同一份投影（不另起一条通知通道）
  }
  /** DT-02：标题栏上下文同步。会话名由 `h1#chatTitle` 承载（既有赋值点就地更新，零改动）；
   *  这里只补工作区名——未配置运行目录（`panelData.workspace` 为 null）时整段隐藏，
   *  不留「运行目录 · 宿主默认」这类占位（与 R1a「假象比空白更坏」同一判据）。
   *  元素缺失即静默返回：切片区间的测试上下文无需为此造桩。 */
  function syncTitlebar() {
    const el = $('#tbWorkspace');
    if (!el) return;
    const ws = panelData ? panelData.workspace : null;
    if (!ws) { el.textContent = ''; el.title = ''; el.hidden = true; return; }
    el.textContent = ws.name || ws.path;
    el.title = ws.path;
    el.hidden = false;
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
    const m = rc.msg;
    if (!m || m._finalized) return;
    m._finalized = true;
    rc.aiClosed = true; /* 一段话结束 → 之后的工具调用另起一组 */
    m.removeAttribute('data-live');
    if (m._st) clearInterval(m._st);
    /* 思考块完成时保持**收起**：只留一行「已深度思考 Ns」。
       改前这里主动 add('expanded')，每一轮结束都把整段推理正文铺在对话里，
       真正要读的正文被淹掉。想看过程的用户点一下标题即可展开。 */
    m.querySelector('.think-head').setAttribute('aria-expanded', 'false');
    m.querySelector('.think').classList.remove('expanded');
    if (!rc.replay) {
      const tt = m.querySelector('.ttimer');
      if (tt) tt.textContent = Math.max(1, Math.round((Date.now() - real.runStart) / 1000)) + 's';
    }
    const st = m.querySelector('.stream-text');
    if (fullText && st) st.textContent = fullText;
    if (!rc.replay) {
      const secs = real.runStart ? ((Date.now() - real.runStart) / 1000).toFixed(1) + 's' : null;
      const wrap = document.createElement('div');
      wrap.className = 'msg-actions';
      wrap.innerHTML = actionsHTML('ai', nowTime(), secs);
      m.querySelector('.msg-body').appendChild(wrap);
      scrollStream();
    }
  }
  function finalizePending() {
    const m = rc.msg;
    if (m && m._built && !m._finalized) finalizeAi(m.querySelector('.stream-text') ? m.querySelector('.stream-text').textContent : '');
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
  /** 与 newCard 同宿主：挂到当前单元的 ai 消息体内（旧实现全仓找最后一条 ai，会跨轮串挂）。 */
  const cardHost = () => { cardMsg(); return msgBody(); };
  const TG_CHEV = '<svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
  /** 工具名 → 用户视角的动作类别。
      非技术用户不需要知道 `tool_call` 这个机制名，但需要能对上「它动没动我的文件」，
      所以按键的**功能**分类（写 / 跑 / 读），而不是把工具名一个个罗列出来。 */
  function toolAction(name) {
    const n = String(name || '');
    if (/write|edit|patch|apply|mkdir|delete|remove|move|copy/i.test(n)) return 'write';
    if (/run|shell|bash|exec|command|test|终端/i.test(n)) return 'run';
    if (/read|list|glob|grep|search|open|view|cat/i.test(n)) return 'read';
    return 'other';
  }
  /** 取（或新建）当前这轮的工具调用组；连续 tool_call 会复用同一组。 */
  function ensureToolGroup() {
    if (rc.group && rc.group.isConnected) return rc.group;
    const g = document.createElement('div');
    g.className = 'toolgroup collapsed';
    g.innerHTML =
      '<button class="tg-head" type="button" data-tool-toggle aria-expanded="false">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M8 6h13M8 12h13M8 18h13"/><path d="M3.6 6h.01M3.6 12h.01M3.6 18h.01"/></svg>' +
        '<span class="tg-title"></span>' +
        '<span class="tg-sum"></span>' + TG_CHEV +
      '</button><div class="tg-body"></div>';
    cardHost().appendChild(g);
    rc.group = g;
    return g;
  }
  /** 刷新组头部：**先说做了什么**（用户视角），再说有没有失手。
      改前是「执行过程 3 项 ✓ 2 ✗ 1」——同一件事（3 个调用成功）说了两遍，
      且「执行过程」是机制措辞，不回答用户唯一关心的问题：「你动了什么」。
      成功不必报数（没报失败即是成功），失败才占位置。 */
  function updateToolGroup(g) {
    if (!g) return;
    const items = g.querySelectorAll('.tool-item');
    const kinds = { write: 0, run: 0, read: 0, other: 0 };
    let fail = 0;
    items.forEach((it) => {
      kinds[toolAction((it.querySelector('.ti-name') || {}).textContent)]++;
      const s = it.querySelector('.ti-state');
      if (s && s.classList.contains('fail')) fail++;
    });
    const parts = [];
    if (kinds.write) parts.push('改了 ' + kinds.write + ' 个文件');
    if (kinds.run) parts.push('跑了 ' + kinds.run + ' 条命令');
    if (kinds.read) parts.push('看了 ' + kinds.read + ' 个文件');
    if (kinds.other) parts.push(kinds.other + ' 个步骤');
    const t = g.querySelector('.tg-title');
    if (t) t.textContent = parts.join(' · ');
    const sum = g.querySelector('.tg-sum');
    if (sum) sum.innerHTML = fail ? '<span class="bad">' + fail + ' 项没成功</span>' : '';
  }
  /* ---------- 事件渲染 ---------- */
  /* 澄清卡的局部序号：只用来给单选组发唯一 name（两张卡同时在等时单选不许串门）。
     不用 callId 拼——那是外部字符串，进 HTML 属性/选择器就多一处必须记得转义的地方。 */
  let clarifyCardSeq = 0;
  function renderEvent(e) {
    switch (e.type) {
      case 'session_meta':
        break;
      case 'user_message':
        finalizePending();
        appendUser(e.content || (e.origin ? '（来自 sidechat 提升）' : ''));
        break;
      case 'assistant_message':
        ensureAi();
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
        rc.cards.set(id, item);
        if (!rc.replay) scrollStream();
        break;
      }
      case 'tool_result': {
        const item = rc.cards.get(e.callId);
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
        /* 失败的调用自动展开：错误不该藏在两层折叠后面。
           但只展开**输出**——「参数」那一段是原始 JSON（机制层），失败时照样收着：
           用户此刻要回答的是「为什么没成」，不是「它传了什么参数」。 */
        if (!ok) {
          item.classList.remove('collapsed');
          const params = item.querySelector('.ti-sec');
          if (params && params !== outSec) params.hidden = true;
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
        rc.cards.delete(e.callId);
        if (!rc.replay) scrollStream();
        break;
      }
      case 'clarify_requested': {
        /* 模型被系统提示要求「有歧义先 clarify，不要猜」，而交互 run 的这道门**不限时**
           （只随取消信号收束）。上一版这里没有卡：事件落进通用记录支、只显示「澄清提问」四个字，
           问题原文一条都看不到、也没有能提交的地方 ⇒ 用户面对一个永远在等的 run。 */
        finalizePending();
        const qs = Array.isArray(e.questions) ? e.questions : [];
        const c = document.createElement('div');
        c.className = 'card';
        // 卡内标识由渲染层自己发号：callId 是外部字符串，不进 HTML 属性也不进选择器（转义漏一次就是注入面）
        const uid = 'clarify' + String(++clarifyCardSeq);
        c.dataset.clarifyCall = e.callId || '';
        const blocks = qs.map((q, i) => {
          const head = '<li class="todo"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/></svg><span>' +
            esc(q.question || '（第 ' + String(i + 1) + ' 问）') + '</span></li>';
          const opts = (q.options || []).map(o =>
            '<li><label><input type="' + (q.multiSelect ? 'checkbox' : 'radio') + '" name="' + uid + '-' + String(i) +
            '" data-q="' + String(i) + '" value="' + esc(o.label) + '"><span>' +
            esc(o.label) + (o.description ? ' — ' + esc(o.description) : '') + '</span></label></li>').join('');
          const free = '<li><label>补充（可留空）<input type="text" class="clarify-free" data-q="' + String(i) +
            '" aria-label="补充说明" placeholder="选完还能补一句"></label></li>';
          return head + opts + free;
        }).join('');
        c.innerHTML =
          '<button class="card-head" type="button" data-tool-toggle data-card="clarify">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.8.4-1 .9-1 1.7"/><path d="M12 17h.01"/></svg>' +
            '澄清提问 <span class="tag">待回答</span>' +
            '<svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>' +
          '</button>' +
          '<div class="plan-steps">' + (blocks || '<li><span>（模型没带出问题）</span></li>') + '</div>' +
          '<div class="plan-acts"><button class="risk-btn ghost clarify-send" type="button">提交回答</button></div>';
        cardHost().appendChild(c);
        if (rc.replay) {
          // 重放只读：提交属交互动作（与 plan 卡同一不变量）。没答上的历史澄清照样把问题摊开给人看。
          const acts = c.querySelector('.plan-acts');
          if (acts) acts.remove();
          c.querySelectorAll('input').forEach((el) => { el.disabled = true; });
        } else {
          c.querySelector('.clarify-send').addEventListener('click', () => {
            const answers = {};
            for (let i = 0; i < qs.length; i++) {
              const q = qs[i];
              const picked = Array.from(c.querySelectorAll('input[data-q="' + String(i) + '"]:checked'))
                .filter(x => x.type !== 'text').map(x => x.value);
              const freeEl = c.querySelector('.clarify-free[data-q="' + String(i) + '"]');
              const free = freeEl && typeof freeEl.value === 'string' ? freeEl.value.trim() : '';
              const chosen = picked.length === 0 ? '' : (q.multiSelect ? picked : picked[0]);
              if (chosen !== '' && free !== '') answers[q.question] = chosen + '（补充：' + free + '）';
              else if (chosen !== '') answers[q.question] = chosen;
              else if (free !== '') answers[q.question] = free;
            }
            if (Object.keys(answers).length === 0) { toast('还没回答任何一条：选一项或写一句再提交'); return; }
            void (async () => {
              try {
                /* 不写 `api.submitClarify ? … : null` 那种存在性兜底：桥名是本仓自己拼的，
                   拼错时兜底会把「方法根本不存在」报成「这道澄清可能已被回答过」——假解释比
                   TypeError 坏（下面这行原先正是：卡能渲染、按钮按下去只回一句谎）。 */
                const r = await api.submitClarify(e.callId, answers);
                if (r !== true) { toast('回答未送达：这道澄清可能已被回答过或已收束'); return; }
                const tag = c.querySelector('.tag');
                if (tag) tag.textContent = '已回答';
                const acts = c.querySelector('.plan-acts');
                if (acts) acts.remove();
                c.querySelectorAll('input').forEach((el) => { el.disabled = true; });
              } catch (err) { toast('回答未送达：' + (err && err.message ? err.message : String(err))); }
            })();
          });
          scrollStream();
        }
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
          '<button class="card-head" type="button" data-tool-toggle data-card="plan">' +
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
        cardHost().appendChild(c);
        if (rc.replay) {
          // 重放是只读的：批准/拒绝属交互动作，不重放（与「重放无副作用」不变量一致）。
          const acts = c.querySelector('.plan-acts');
          if (acts) acts.remove();
        } else {
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
        }
        break;
      }
      case 'plan_approved': {
        const tag = rc.msg ? rc.msg.querySelector('.card .tag') : null;
        if (tag) { tag.textContent = e.approved ? '已批准' : '已拒绝'; break; }
        // 决议与方案卡不在同一单元时，落一条独立记录——不静默丢弃用户拍板过的事实。
        appendRecordCard(cardHost(), e.approved ? '方案已批准' : '方案已拒绝', e);
        if (!rc.replay) scrollStream();
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
        if (!rc.replay) scrollStream();
        break;
      }
      case 'error': {
        // P0 失败可见：live 与 replay 走同一条渲染器出同一张卡（旧状：live 有卡、重开退化成桩）。
        finalizePending();
        cardHost().appendChild(errorCardNode(e.message));
        if (!rc.replay) scrollStream();
        break;
      }
      case 'compaction': {
        // 压缩此前只有一条瞬态 toast，事后无痕；改为落卡（live 仍保留 toast）。
        finalizePending();
        const label = '上下文已压缩 ' + fmtTokens(e.tokens_before) + ' → ' + fmtTokens(e.tokens_after);
        appendRecordCard(cardHost(), label, e, e.summary || '');
        if (!rc.replay) { toast('上下文已压缩，可继续'); scrollStream(); }
        break;
      }
      case 'usage':
        if (!rc.replay) {
          real.usageIn += e.inputTokens || 0;
          real.usageOut += e.outputTokens || 0;
          syncStatusbar();
        }
        break;
      default: {
        /* 通用记录支兜的是一批**没有专属卡**的事件（agent_* / approval_* / security_report /
           impact_report / routing_decision / automation_* / card_action / diff_comment 等）。
           逐类语义卡在 R2 里补；clarify_requested 已经补成真卡（模型在等人回答，不能只留一行名字）。 */
        finalizePending();
        appendRecordCard(cardHost(), eventLabel(e), e);
        if (!rc.replay) scrollStream();
        break;
      }
    }
  }
  function fmtTokens(n) {
    const v = Number(n) || 0;
    return v >= 1000 ? (v / 1000).toFixed(1) + 'k' : String(v);
  }
  /** 事件类型 → 一行中文标签（R2 会把它们升级成各自的语义卡）。 */
  const EVENT_LABELS = {
    agent_spawned: '派生 worker', agent_status: 'worker 状态', agent_message: 'worker 消息',
    agent_result: 'worker 结果', approval_requested: '请求审批', approval_resolved: '审批已决',
    security_report: '安全报告', impact_report: '影响面报告', routing_decision: '模型路由决策',
    card_action: '卡片操作', diff_comment: 'diff 评论',
    automation_triggered: '定时任务触发', automation_skipped: '定时任务跳过', automation_completed: '定时任务完成',
    goal_set: '设定长任务目标', goal_stopped: '长任务目标已停',
  };
  function eventLabel(e) {
    const base = EVENT_LABELS[e.type] || String(e.type);
    const nm = typeof e.task_name === 'string' && e.task_name ? e.task_name + ' ' : '';
    // agent 归因走 .tag，状态留在标题里（failed / waiting_approval 是需要一眼看到的词）
    if (e.type === 'automation_skipped') {
      return base + '：' + nm + skipReasonLabel(e.reason);
    }
    if (e.type === 'automation_triggered') {
      return base + '：' + nm + '无人值守开始运行';
    }
    /* 无人值守的一次运行：成败是这条记录存在的全部理由，failed 不许顶着「完成」二字
       （原先缺省分支会拼成「定时任务完成 · failed」）。 */
    if (e.type === 'automation_completed') {
      const failed = e.status === 'failed';
      const why = typeof e.reason === 'string' && e.reason ? skipReasonLabel(e.reason) : (failed ? '未记原因' : '已结束');
      return (failed ? '定时任务失败：' : '定时任务完成：') + nm + why;
    }
    return typeof e.status === 'string' && e.status ? base + ' · ' + e.status : base;
  }
  /** 通用记录卡：一行标题 + 可展开原文。动态内容一律 textContent，只有 chevron 是静态 SVG。 */
  const RECORD_CHEV = '<svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
  function appendRecordCard(host, title, e, detailText) {
    const c = document.createElement('div');
    c.className = 'card collapsed';
    const head = document.createElement('button');
    head.className = 'card-head';
    head.type = 'button';
    head.setAttribute('data-tool-toggle', '');
    head.setAttribute('aria-expanded', 'false');
    head.textContent = title;
    // 归因/状态放进 .tag（既有 mono 样式），标题不被拼接污染
    const tagText = typeof e.agent_id === 'string' && e.agent_id ? e.agent_id : (typeof e.status === 'string' ? e.status : '');
    if (tagText) {
      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = tagText;
      head.appendChild(tag);
    }
    head.insertAdjacentHTML('beforeend', RECORD_CHEV);
    const body = document.createElement('div');
    body.className = 'card-body';
    const pre = document.createElement('pre');
    pre.className = 'ti-code';
    pre.style.whiteSpace = 'pre-wrap';
    pre.style.overflowWrap = 'anywhere';
    pre.textContent = detailText !== undefined ? detailText : JSON.stringify(e, null, 2);
    body.appendChild(pre);
    c.append(head, body);
    host.appendChild(c);
    return c;
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
    pop.dataset.scope = 'once';   // 缺省逐字写出来，不留上一次的残留（标签写「仅本次」而发出去 always＝控件与事实两张皮）
    pop.querySelector('#askScopeLab').textContent = '仅本次';
    pop.querySelector('#askScopePop').hidden = true;
    pop.querySelector('.ask-scope-btn').setAttribute('aria-expanded', 'false');
    /* worker 审批不给范围选择：§11.7.6「worker 永不写 always」，主进程当场拒——摆一个必然被拒的选项是假出口 */
    pop.querySelector('.ask-scope-wrap').hidden = !!p.workerAsk;
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
      '<button class="card-head" type="button" data-tool-toggle aria-expanded="false">' + ASK_ICON +
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
    if (p.workerAsk) {
      /* worker 审批的唯一入口是 card_action 协议（§10.3）——此前渲染层零调用者，
         于是每条 worker 审批都在 120s 超时后被 fail-closed 自动拒绝，用户全程没有应答口。
         已决记录只在回条 ok 之后落：回条被拒却先写「已批准」＝把没做成的事记进历史。 */
      real.askCards.delete(p.askId);
      void api.cardAction(cardActionForApproval(p.workerAsk, approved)).then(r => {
        if (r && r.ok === false) { toast('这条 worker 审批未被受理：' + (r.error || '未知')); return; }
        appendAskRecord(p, approved, 'once');
      }).catch(() => { toast('worker 审批发送失败（决议未进事件流）'); });
      renderAskPop();
      return;
    }
    appendAskRecord(p, approved, pop.dataset.scope);
    void api.decide(p.askId, approved, pop.dataset.scope);
    renderAskPop();
  }

  /* worker 审批卡与子智能体页同一份事实源（panelData.agents 的 pendingApproval）：
     不新增 IPC、不另记一套待决集合——`agent:ask` 通道按设计只服务主会话门（见 events 的 agent_id 注）。 */
  function syncWorkerAskCards() {
    const asks = workerApprovalAsks(panelData.agents || []);
    const live = new Map(asks.map(a => [a.askId, a]));
    let dropped = false;
    for (let i = askQueue.length - 1; i >= 0; i--) {
      const q = askQueue[i];
      if (q.workerAsk && !live.has(q.askId)) {
        askQueue.splice(i, 1);
        real.askCards.delete(q.askId);
        dropped = true;
      }
    }
    for (const a of live.values()) {
      if (real.askCards.has(a.askId)) continue;
      askCard({
        askId: a.askId, tool: a.tool, args: { 子智能体: a.agentId }, workerAsk: a,
        risk: a.risk, sentAt: Date.now(),
        reason: '子智能体 ' + a.agentId + ' 停在 ' + a.tool + ' 上等这条审批；不答会在超时后被自动拒绝（fail-closed）。',
      });
    }
    const pop = document.getElementById('askPop');
    if (dropped && pop && !pop.hidden && !askQueue.some(q => q.askId === pop.dataset.askId)) {
      hideAskPop();
      renderAskPop();
    }
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
    historyWindow = mountHistory({ container: streamInner, scroller: $('.stream'), units: projectUnits(events), renderUnit: buildUnit });
    scrollStream(true);  // 打开/切换会话：落在末尾，不受上翻锁定影响
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
  // 把运行态与取消能力接进顶层的单一分派器（onRunButton）：运行中点按钮 = 停止，其余 = 发送。
  runControl.isRunning = () => real.running === true;
  runControl.cancel = () => { void api.runCancel(); };
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
      syncRunButton();
      const res = await api.run({ message: text, mode: PERM_MAP[permMode.id], sessionId: real.id, ...(workspace ? { workspace } : {}) });
      if (!res.ok) toast('启动失败：' + (res.error || '未知'));
    } catch (err) {
      toast('启动失败：' + (err && err.message ? err.message : err));
    } finally {
      sending = false;
      // api.run 要等整轮跑完（含被取消）才 resolve——成功路径此前无人复位 real.running，
      // 于是跑完一轮后发送 / 切会话 / 新建全被自己的「请先等待完成」永久挡死。
      real.running = false;
      setRunning(real.id, false);
      syncRunButton();
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
      showEmptyStream();
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
    // 零会话时必须清掉 index.html 里那段演示对话——否则首次启动看到的是
    // 「假对话」而不是空态（与 R1a 删 REVIEW/终端 seeds 同一判据：假象比空白更坏）。
    else if (loaded && !real.id && !sessions.length) showEmptyStream();
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

  /* ---------- 设置项：声明式真实读写 ----------
     改前设置页的开关只改自己的 aria-checked，既不读也不存——看起来能点，其实什么都没发生。
     标记里写 data-setting="<AppSettings 字段>"，这里统一做三件事：
     读初值（hydrate）→ 写回（setSettings）→ 失败可见（toast）。
     位置说明：本块刻意放在桥接段**末尾**。多个渲染层单测按源码锚点切片装载 app.js，
     「会话列表」等注释正是切片边界——放进去会被算进别人的切片，而那里没有 api。 */


  async function writeSetting(field, value) {
    if (typeof api.setSettings !== 'function') {
      toast('当前宿主不支持保存设置');
      return;
    }
    try {
      await api.setSettings({ [field]: value });
    } catch (err) {
      toast('保存设置失败：' + (err && err.message ? err.message : err));
    }
  }

  function hydrateSettingsFields(st) {
    if (!st) return;
    document.querySelectorAll('[data-setting]').forEach((el) => {
      const f = el.dataset.setting;
      if (!(f in st)) return;
      const v = st[f];
      if (el.classList.contains('set-switch')) {
        el.setAttribute('aria-checked', String(!!v));
      } else if (el.classList.contains('set-choice')) {
        el.querySelectorAll('button[data-val]').forEach((b) => {
          b.setAttribute('aria-pressed', String(b.dataset.val === String(v)));
        });
      } else if (el.tagName === 'INPUT') {
        el.value = String(v === null || v === undefined ? '' : v);
      }
    });
    const ws = $('#workspaceVal');
    if (ws) ws.textContent = st.workspace ? parseWorkspace(st.workspace) || st.workspace : '未设置';
    /* theme 要在这里**真的应用**一次，而不只是刷按钮：上面那个循环刚按 settings 把
       aria-pressed 摆好，末尾再 syncThemeButtons() 就会按本地缓存把它们盖回去，
       于是 settings.theme 永远只有写、没有读（首帧缓存冒充了事实源）。 */
    if (st.theme === 'system' || st.theme === 'light' || st.theme === 'dark') applyTheme(st.theme);
    else syncThemeButtons();
  }

  const settingsBodyEl = $('.settings-body');
  if (settingsBodyEl && typeof settingsBodyEl.addEventListener === 'function') {
    settingsBodyEl.addEventListener('click', (e) => {
      const sw = e.target.closest('.set-switch[data-setting]');
      if (sw) {
        void writeSetting(sw.dataset.setting, sw.getAttribute('aria-checked') === 'true');
        return;
      }
      const b = e.target.closest('.set-choice[data-setting] button[data-val]');
      if (!b) return;
      const field = b.closest('.set-choice').dataset.setting;
      void writeSetting(field, b.dataset.val);
      /* theme 是唯一有立即可见副作用的字段：存完要真的换主题（含「跟随系统」） */
      if (field === 'theme') applyTheme(b.dataset.val);
    });
  }
  document.querySelectorAll('.set-num[data-setting], .set-txt[data-setting]').forEach((el) => {
    el.addEventListener('change', () => {
      const v = el.type === 'number' ? Number(el.value || 0) : el.value.trim();
      void writeSetting(el.dataset.setting, v);
    });
  });

  /* ---------- API 密钥（BYOK）：存进系统钥匙串，不落明文 ---------- */
  const KEY_PROVIDER = 'glm';   /* 目前唯一需要密钥的真实通道（settings.provider = glm） */
  async function refreshKeyStatus() {
    const el = $('#keyStatus');
    if (!el) return;
    if (typeof api.providerKeyStatus !== 'function') {
      el.textContent = '当前宿主不支持';
      return;
    }
    try {
      const st = await api.providerKeyStatus();
      if (!st.available) el.textContent = '钥匙串不可用';
      else if (!st.stored.length) el.textContent = st.envActive ? '未存储（沿用环境变量）' : '未设置';
      else el.textContent = '已存储：' + st.stored.join('、') + (st.envActive ? '（另有环境变量）' : '');
    } catch (err) {
      el.textContent = '读取失败';
    }
  }
  const keySaveBtn = $('#keySave');
  if (keySaveBtn) {
    keySaveBtn.addEventListener('click', async () => {
      const input = $('#keyInput');
      const key = input.value.trim();
      if (!key) {
        input.focus();
        return;
      }
      if (typeof api.providerKeySet !== 'function') {
        toast('当前宿主不支持保存密钥');
        return;
      }
      keySaveBtn.disabled = true;
      try {
        const r = await api.providerKeySet(KEY_PROVIDER, key);
        if (r && r.ok) {
          input.value = '';
          toast('密钥已存进系统钥匙串');
        } else {
          toast('保存失败：' + ((r && r.error) || '未知原因'));
        }
      } catch (err) {
        toast('保存失败：' + (err && err.message ? err.message : err));
      } finally {
        keySaveBtn.disabled = false;
        void refreshKeyStatus();
      }
    });
  }
  const keyDelBtn = $('#keyDelete');
  if (keyDelBtn) {
    keyDelBtn.addEventListener('click', async () => {
      if (typeof api.providerKeyDelete !== 'function') {
        toast('当前宿主不支持删除密钥');
        return;
      }
      try {
        const r = await api.providerKeyDelete(KEY_PROVIDER);
        toast(r && r.ok ? '已删除密钥' : '删除失败：' + ((r && r.error) || '未知原因'));
      } catch (err) {
        toast('删除失败：' + (err && err.message ? err.message : err));
      } finally {
        void refreshKeyStatus();
      }
    });
  }

  /* ---------- 更新检查：四种状态都说人话，且不自动下载 ---------- */
  const updBtn = $('#checkUpdateBtn');
  if (updBtn) {
    updBtn.addEventListener('click', async () => {
      if (typeof api.checkUpdate !== 'function') {
        toast('当前宿主不支持检查更新');
        return;
      }
      const label = updBtn.textContent;
      updBtn.disabled = true;
      updBtn.textContent = '检查中…';
      try {
        const r = await api.checkUpdate();
        if (!r || r.state === 'unconfigured') toast('未配置更新源：请先填上面的地址');
        else if (r.state === 'error') toast('检查失败：' + r.message);
        else if (r.state === 'up-to-date') toast('已是最新（' + r.currentVersion + '）');
        else if (r.state === 'available') {
          toast('有新版本 ' + r.version + '，正在打开下载页');
          if (typeof api.openExternal === 'function' && r.url) void api.openExternal(r.url);
        }
      } catch (err) {
        toast('检查失败：' + (err && err.message ? err.message : err));
      } finally {
        updBtn.disabled = false;
        updBtn.textContent = label;
      }
    });
  }

  /* ---------- 关于：显示真实的通道与模型 ---------- */
  async function refreshProviderInfo() {
    const el = $('#providerInfo');
    if (!el) return;
    if (typeof api.getProviderInfo !== 'function') {
      el.textContent = '未知';
      return;
    }
    try {
      const info = await api.getProviderInfo();
      el.textContent = (info && info.provider ? info.provider : '未知') + ' · ' + ((info && info.model) || '缺省');
    } catch (err) {
      el.textContent = '读取失败';
    }
  }
  settingsHooks.onOpen = () => {
    void refreshKeyStatus();
    void refreshProviderInfo();
  };
  /* 回灌真实字段。放在这里而不是 settingsReady 里：那一段被
     renderer-workspace.test 的「真实运行目录」切片装载，而本函数定义在切片之外。 */
  void settingsReady.then((st) => hydrateSettingsFields(st));


  /* ---------- 定时任务面板（v0.1.6 的 ui-schedule 对位） ----------
     后端早已实现：scheduler.ts + automations.ts + 四条 IPC。
     改前渲染层没有任何入口——这是「有真实后端、没有 UI」的最大缺口。 */
  let scheduleLoading = false;

  async function loadSchedule(force) {
    if (typeof api.scheduleSnapshot !== 'function') {
      scheduleCache = { unsupported: true };
      return;
    }
    if (scheduleLoading || (scheduleCache && !force)) return;
    scheduleLoading = true;
    try {
      scheduleCache = await api.scheduleSnapshot(schedHistFilter);
    } catch (err) {
      scheduleCache = { error: (err && err.message) || String(err) };
    } finally {
      scheduleLoading = false;
    }
  }


  /* 记忆快照随 agent:state 一起出来（memorySnapshot）——不另开读通道，也不在渲染层数第二份。
     刷新只在打开标签页与删除后：面板是展示面，不该有第三条更新路径。 */
  let memoryLoading = false;

  async function loadMemory(force) {
    if (typeof api.getState !== 'function') { memoryCache = { unsupported: true }; return; }
    if (memoryLoading || (memoryCache && !force)) return;
    memoryLoading = true;
    try {
      const st = await api.getState();
      memoryCache = (st && st.memory) ? st.memory : { unsupported: true };
    } catch (err) {
      memoryCache = { error: (err && err.message) || String(err) };
    } finally {
      memoryLoading = false;
    }
  }

  /* §8.1.7：删除只此一路（用户在面板上点），模型没有删除权。删完必须回读快照——
     面板留着那一行 = 告诉用户它还在。 */
  async function deleteMemoryTopic(scope, topic) {
    if (!scope || !topic) return;
    try {
      const r = await api.deleteMemory(scope, topic);
      toast(r && r.ok ? '已删除记忆：' + topic : '删除失败：' + ((r && r.error) || '未知原因'));
    } catch (err) {
      toast('删除失败：' + ((err && err.message) || String(err)));
    }
    memoryCache = null;
    await loadMemory(true);
    if (typeof renderSide === 'function') renderSide();
  }

  /* 插件快照与信任决议（§9.8）：未信任 = 不激活，所以「列出 + 授权」是这条能力唯一的可见面。
     决议一律回读快照重画：点完状态没变，就得让用户看得见「没变」而不是以为成功。 */
  let pluginLoading = false;

  async function loadPlugin(force) {
    if (typeof api.getState !== 'function') { pluginCache = { unsupported: true }; return; }
    if (pluginLoading || (pluginCache && !force)) return;
    pluginLoading = true;
    try {
      const st = await api.getState();
      pluginCache = (st && st.plugins) ? st.plugins : { unsupported: true };
    } catch (err) {
      pluginCache = { error: (err && err.message) || String(err) };
    } finally {
      pluginLoading = false;
    }
  }

  async function decidePlugin(name, trusted) {
    if (!name) return;
    try {
      const r = await api.pluginDecide(name, trusted);
      toast(r && r.ok
        ? (trusted ? '已信任：' + name + '（其 skill / 命令 / hook 从此激活）' : '已拒绝：' + name + '（保持不激活）')
        : '决议未生效：' + name + '（回条 ok=false，状态按盘上重读）');
    } catch (err) {
      toast('决议失败：' + ((err && err.message) || String(err)));
    }
    pluginCache = null;
    await loadPlugin(true);
    if (typeof renderSide === 'function') renderSide();
  }

  /* 子智能体行内动作（取消 / 重派）：与审批同一族出口——card_action 是事件流的唯一写端。
     回条 ok=false 必须说出口：这条路上没有任何别的反馈。 */
  async function runWorkerRowAction(col, action) {
    if (!WORKER_ROW_ACTION_NAMES.includes(action)) return;   // 白名单在投影里，这里不另列一份
    try {
      const r = await api.cardAction(cardActionForWorkerRow(col, action));
      if (r && r.ok === false) { toast('动作未被受理：' + (r.error || '未知')); return; }
      toast(action === 'cancel' ? '已请求取消：' + col.agent_id
        : action === 'resume' ? '已请求继续：' + col.agent_id + '（卡死态清除，它在暂停的那一点接着跑）'
        : '已按原任务重派（全新 agent_id，会再花一次这一段的钱）');
    } catch (err) {
      toast('动作失败：' + ((err && err.message) || String(err)));
    }
  }

  /* 「评」按钮的委托只留这一行：看板本体在文件末尾（IIFE 尾段）。切片式渲染层测以
     const sidePagesHost 为终点，插件/记忆两块都从自己那一段切到这里，中间塞进新代码会把
     它们的切片撑大（实测 6 红）。openCommentPop 是函数声明，会提升到此处之前。 */

  const sidePagesHost = $('.side-pages');
  if (sidePagesHost && typeof sidePagesHost.addEventListener === 'function') {
    sidePagesHost.addEventListener('click', async (e) => {
      // 记忆删除与定时任务动作共用这一个委托处理器（抽屉里的行内按钮只有一个宿主，别开第二条）
      const cmtBtn = e.target.closest('[data-cmt]');
      if (cmtBtn) { openCommentPop(cmtBtn); return; }
      const agentBtn = e.target.closest('[data-agent-act]');
      if (agentBtn) {
        const row = agentBtn.closest('.agent-row');
        const id = row && row.dataset.agent;
        const col = id ? (panelData.agents || []).find(c => c.agent_id === id) : null;
        if (!col) { toast('这一列已不在事件流里（刷新后再试）'); return; }
        await runWorkerRowAction(col, agentBtn.dataset.agentAct);
        return;
      }
      const plugBtn = e.target.closest('[data-plug-act]');
      if (plugBtn) {
        const row = plugBtn.closest('.plug-row');
        void decidePlugin(row && row.dataset.plugin, plugBtn.dataset.plugAct === 'trust');
        return;
      }
      const memBtn = e.target.closest('[data-mem-act]');
      if (memBtn) {
        const row = memBtn.closest('.mem-topic');
        void deleteMemoryTopic(row && row.dataset.scope, row && row.dataset.topic);
        return;
      }
      const btn = e.target.closest('[data-sched-act]');
      if (!btn) return;
      const row = btn.closest('.sched-task');
      const id = row && row.dataset.id;
      if (!id) return;
      const act = btn.dataset.schedAct;
      const task = (scheduleCache && scheduleCache.tasks || []).find(t => t.id === id);
      let r = null;
      if (act === 'toggle' && task) {
        // form=false：改启用开关不该被「种类白名单」再判一道（已存在的任务可能不在四 kind 内）
        r = await api.scheduleUpsert({ ...task, enabled: !task.enabled }, false);
      } else if (act === 'run') {
        r = await api.scheduleRunNow(id);
        if (r && r.ok !== false) toast('已加入队列：' + (task ? task.name : id));
      } else if (act === 'del') {
        r = await api.scheduleDelete(id);
        if (r && r.ok !== false) toast('已删除定时任务');
      }
      if (r && r.ok === false) toast('未执行：' + (r.error || '未知原因'));
      scheduleCache = null;
      await loadSchedule(true);
      if (typeof renderSide === 'function') renderSide();
    });
  }
  /* 运行历史的状态筛选：界面只存「选了哪个状态」这一份 UI 态，筛的动作由 main 做
     （Scheduler.filterHistory 本就是那条逻辑的主人——此前它只有验收脚本在调，面板连筛选器都没有）。
     改筛选 = 重新要一次快照，绝不在本地把已有 12 条再过滤一遍（那样「只看失败」就永远只剩
     最近 12 条里的失败，看着像没有记录）。 */
  async function setSchedHistFilter(v) {
    if (typeof v !== 'string' || !HISTORY_STATES.includes(v) || v === schedHistFilter) return;
    schedHistFilter = v;
    scheduleCache = null;
    await loadSchedule(true);
    if (typeof renderSide === 'function') renderSide();
  }
  if (sidePagesHost && typeof sidePagesHost.addEventListener === 'function') {
    sidePagesHost.addEventListener('change', (e) => {
      const sel = e.target.closest('#schedHistFilter');
      if (sel) void setSchedHistFilter(sel.value);
    });
  }
  /* 打开标签页时刷新对应快照（同一处收口，别在渲染函数里再发请求） */
  settingsHooks.onOpenView = (key) => {
    const redraw = () => { if (typeof renderSide === 'function') renderSide(); };
    if (key === 'schedule') void loadSchedule(true).then(redraw);
    else if (key === 'memory') void loadMemory(true).then(redraw);
    else if (key === 'plugins') void loadPlugin(true).then(redraw);
  };

  /* ---------- 长任务目标（goal 模式）：composer 芯片 + 设定面板 ----------
     机器侧三面（main handler / preload / IPC）此前已落，这一段是用户能点的那一下。三条口径：
     · 目标态一律从事件流算——traceGoal 就是主进程续跑判据用的**同一份** reduce（tests/goal-trace.test.ts
       锁着「筛过的事件重算 == 整段重算的芯片三字段」），渲染层不自造第二份「当前目标」状态；
     · 设 / 改设 = 追加一条 goal_set，清除 = 追加一条 goal_stopped（复用「停止是终态」那条已有
       语义，不开新事件也不开新通道）；
     · 回条 clamped 非空 ⇒ 原样点名（用户设的预算被钳过必须说出来，不许静默改写）。
     放在这里（IIFE 末尾）与定时面板同因：前面的切片式渲染层测不会装载这一段。 */
  const ctxGoal = $('#ctxGoal');
  const goalPanel = $('#goalPanel');
  const goalPanelBody = $('#goalPanelBody');
  const goalChipLabel = $('#goalChipLabel');
  /* 只留筛选过的那几个事件（goalRelevant），读数一律 traceGoal 全量重算：
     既不写第二份「当前目标」状态，也没有"逐步累加 vs 快照重算"两条路各数一遍的双算。
     长度天然有界：goal_set/goal_stopped 每轮至多各一条，goal 代发轮被轮次帽卡死。 */
  let goalEvents = [];
  let goalEventsSession = null;

  function goalOfSession() {
    return goalEventsSession === real.id && real.id ? traceGoal(goalEvents) : null;
  }
  function syncGoalChip() {
    if (!ctxGoal || !goalChipLabel) return;
    const t = goalOfSession();
    if (!t) {
      goalChipLabel.textContent = '设目标';
      ctxGoal.classList.remove('warn');
      ctxGoal.setAttribute('aria-label', '长任务目标：未设');
      return;
    }
    const turnTxt = '第 ' + String(t.turn) + '/' + String(t.spec.maxTurns) + ' 轮';
    goalChipLabel.textContent = (t.stopped ? '目标已停 ' : '目标 ') + String(t.turn) + '/' + String(t.spec.maxTurns);
    ctxGoal.classList.toggle('warn', !t.stopped);
    ctxGoal.setAttribute('aria-label', '长任务目标：' + (t.stopped ? '已停（' + turnTxt + '）——' + t.stopped : '自动续跑中（' + turnTxt + '）——' + t.spec.objective));
  }
  function goalStateHTML(t) {
    if (!t) return '';
    const money = t.spec.maxUsd > 0 ? ' · 美元上限 $' + t.spec.maxUsd.toFixed(2) : ' · 不设美元闸';
    const meta = (t.stopped ? '已停：' + t.stopped : '续跑中 第 ' + String(t.turn) + '/' + String(t.spec.maxTurns) + ' 轮' + money);
    return '<div class="goal-state' + (t.stopped ? ' stopped' : '') + '">' +
      '<span class="gs-obj">' + esc(t.spec.objective) + '</span>' +
      '<span class="gs-meta">' + esc(meta) + '</span></div>';
  }
  function renderGoalPanel() {
    const t = goalOfSession();
    goalPanelBody.innerHTML =
      '<form class="goal-form">' +
        goalStateHTML(t) +
        '<label for="goalObjective">目标：一句话说清「做到什么程度算完」</label>' +
        '<textarea id="goalObjective" rows="3" placeholder="例：把 tests/ 里失败的用例修到全绿，并保证 typecheck 通过" aria-describedby="goalNote"></textarea>' +
        '<div class="goal-row">' +
          '<div><label for="goalTurns">轮次上限</label>' +
          '<input id="goalTurns" type="number" min="' + String(GOAL_TURN_CAP_MIN) + '" max="' + String(GOAL_TURN_CAP_MAX) + '" value="' + esc(String(t ? t.spec.maxTurns : GOAL_TURN_CAP_DEFAULT)) + '"></div>' +
          '<div><label for="goalUsd">美元上限（留空 = 不设）</label>' +
          '<input id="goalUsd" type="number" min="0" step="0.1" placeholder="0" value="' + esc(t && t.spec.maxUsd > 0 ? String(t.spec.maxUsd) : '') + '"></div>' +
        '</div>' +
        '<p class="goal-note" id="goalNote">每轮跑完只看一件事：verify 有没有留下绿证据。绿了就收束；没绿且没撞上轮次/美元闸，就自动再跑一轮。' +
          '纯问答/查代码类目标会在第一轮停下（不白花钱）。轮次可设 ' + String(GOAL_TURN_CAP_MIN) + '–' + String(GOAL_TURN_CAP_MAX) + '，越界会被钳制并逐条点名。</p>' +
        '<div class="goal-actions">' +
          (t ? '<button type="button" id="goalClear">清除目标</button>' : '') +
          '<button type="submit" class="primary">' + (t ? '改设目标' : '设定目标') + '</button>' +
        '</div>' +
      '</form>';
    if (t) {
      const box = goalPanelBody.querySelector('#goalObjective');
      if (box) box.value = t.spec.objective;
    }
  }
  registerPop(goalPanel, ctxGoal, renderGoalPanel);
  ctxGoal.addEventListener('click', () => togglePop(goalPanel));
  if (typeof api.setGoal !== 'function') {
    ctxGoal.disabled = true;
    ctxGoal.setAttribute('aria-label', '长任务目标：当前壳未提供 goal 通道');
  }
  function goalReqError(r) {
    return (r && typeof r.error === 'string' && r.error) ? r.error : '未知错误';
  }
  goalPanel.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!real.id) { toast('先选一个会话，目标要有地方挂'); return; }
    const objective = goalPanelBody.querySelector('#goalObjective').value.trim();
    const turnsRaw = goalPanelBody.querySelector('#goalTurns').value.trim();
    const usdRaw = goalPanelBody.querySelector('#goalUsd').value.trim();
    const req = { sessionId: real.id, objective };
    if (turnsRaw !== '') req.maxTurns = Number(turnsRaw);
    if (usdRaw !== '') req.maxUsd = Number(usdRaw);
    void (async () => {
      try {
        const r = await api.setGoal(req);
        if (!r || r.ok !== true) { toast('目标未设：' + goalReqError(r)); return; }
        toast(r.clamped && r.clamped.length ? '目标已设，但按边界钳制：' + r.clamped.join('；') : '目标已设定，本轮跑完按判据自动续跑');
        closeAllPops(false);
      } catch (err) { toast('目标未设：' + ((err && err.message) || String(err))); }
    })();
  });
  goalPanel.addEventListener('click', (e) => {
    if (!e.target.closest('#goalClear')) return;
    void (async () => {
      try {
        const r = await api.setGoal({ sessionId: real.id, clear: true });
        if (!r || r.ok !== true) { toast('未能清除：' + goalReqError(r)); return; }
        toast('目标已清除：本轮跑完不再自动续跑');
        closeAllPops(false);
      } catch (err) { toast('未能清除：' + ((err && err.message) || String(err))); }
    })();
  });

  /* ---------- 手动压缩上下文（agent:compact）----------
     读数全部取自事实源：用量是本会话已累计的 usage 事件之和，压缩收益取主进程回条里的
     tokens_before/after（实测，不是估算）。花钱的动作得当场说清花在哪、省在哪一次。 */
  const ctxCompact = $('#ctxCompact');
  const compactPanel = $('#compactPanel');
  const compactPanelBody = $('#compactPanelBody');

  function renderCompactPanel() {
    const busy = real.running === true;
    compactPanelBody.innerHTML =
      '<form class="compact-form">' +
        '<p class="goal-note">本会话已累计 <b>' + String(real.usageIn) + ' + ' + String(real.usageOut) + '</b> token（输入 + 输出）。' +
          '压缩 = 把这段历史摘要成一条事件，<b>下一次运行</b>不再重放全文。</p>' +
        '<p class="goal-note">摘要本身要发一次模型调用（花真钱）。已经花掉的不退，省的是下一次的输入。</p>' +
        '<div class="goal-actions"><button type="submit" class="primary">立即压缩本会话</button></div>' +
        (busy
          ? '<p class="goal-note">会话正在运行——先停止再压缩（不给跑动中的历史动刀，主进程同口径拒）</p>'
          : '') +
      '</form>';
  }
  registerPop(compactPanel, ctxCompact, renderCompactPanel);
  ctxCompact.addEventListener('click', () => togglePop(compactPanel));
  if (typeof api.compact !== 'function') {
    ctxCompact.disabled = true;
    ctxCompact.setAttribute('aria-label', '压缩上下文：当前壳未提供 compact 通道');
  }
  compactPanel.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!real.id) { toast('先选一个会话，压缩要有对象'); return; }
    const sid = real.id; // 压缩对象 = 屏幕上这条，不是「本进程最后跑过的那条」
    void (async () => {
      try {
        const r = await api.compact(sid);
        if (!r || r.ok !== true) { toast('压缩未发生：' + ((r && r.error) || '未知原因')); return; }
        const p = r.cardPayload || {};
        const before = Number(p.tokensBefore) || 0;
        const after = Number(p.tokensAfter) || 0;
        closeAllPops(false);
        toast('已压缩 ' + String(Number(p.compressedCount) || 0) + ' 条事件：' +
          String(before) + ' → ' + String(after) + ' token（省 ' + String(Math.max(0, before - after)) + '）');
      } catch (err) { toast('压缩失败：' + ((err && err.message) || String(err))); }
    })();
  });

  /* ---------- 新建定时任务（agent:schedule-upsert 的表单面）----------
     后端早就齐了（scheduler + automations + 四条 IPC + 面板列表），但界面上没有创建入口——
     用户看得见列表却设不了任务，面板原话写着「后续接」＝留位待办。三条口径：
     · 校验只在 main：这里不收字段、不 clamp、不判长度（schedFormPayload 只搬形状），
       渲染层再判一遍就是第二份规则，两份必然漂移；
     · 表单只开四 kind（main 的 FORM_KINDS 白名单），hourly/monthly/custom 数据模型里有、
       表单面今天仍不给——由 tests 逐字对表锁住，不靠注释；
     · 缺省种类 = once：跑一次就结束。间隔档一旦误设成 5 分钟就是一天 288 次真钱调用，
       所以最便宜的形状当默认，不是把最常用的当默认。 */
  const ctxSched = $('#ctxSched');
  const schedPanel = $('#schedPanel');
  const schedPanelBody = $('#schedPanelBody');
  const SCHED_TIER_DEFAULT = 'read-only';

  function schedSelectHTML(id, labels, dflt) {
    return '<select id="' + id + '">' + Object.keys(labels).map((k) =>
      '<option value="' + esc(k) + '"' + (k === dflt ? ' selected' : '') + '>' + esc(labels[k]) + '</option>').join('') + '</select>';
  }
  function renderSchedPanel() {
    const kinds = {};
    for (const k of SCHED_FORM_KINDS) kinds[k] = SCHED_KIND_LABELS[k] || k;
    schedPanelBody.innerHTML =
      '<form class="goal-form sched-form" data-kind="' + esc(SCHED_FORM_KINDS[0]) + '">' +
        '<div class="f"><label for="schedName">名称</label>' +
          '<input id="schedName" type="text" placeholder="例：每晨跑一遍失败用例"></div>' +
        '<div class="f"><label for="schedKind">种类</label>' + schedSelectHTML('schedKind', kinds, SCHED_FORM_KINDS[0]) + '</div>' +
        '<div class="f f-once"><label for="schedAt">触发时刻</label>' +
          '<input id="schedAt" type="datetime-local"></div>' +
        '<div class="f f-interval"><label for="schedEvery">间隔（分钟）</label>' +
          '<input id="schedEvery" type="number" step="1" placeholder="下限由主进程判，越界点名"></div>' +
        '<div class="f f-daily"><label for="schedTime">时刻（HH:mm，按本机时区）</label>' +
          '<input id="schedTime" type="time"></div>' +
        '<div class="f f-weekly"><label for="schedWeekdays">每周哪几天</label>' +
          '<input id="schedWeekdays" type="text" placeholder="1,3,5（0=周日）"></div>' +
        '<div class="f"><label for="schedPrompt">提示词：触发时原样成为那条新会话的首句</label>' +
          '<textarea id="schedPrompt" rows="4" placeholder="自包含的任务说明——到时候没有人在场追问，写清目标与验收口径"></textarea></div>' +
        '<div class="f"><label for="schedTier">权限档位</label>' + schedSelectHTML('schedTier', SCHED_TIER_LABELS, SCHED_TIER_DEFAULT) + '</div>' +
        '<div class="f"><label for="schedCatchUp">休眠错过时</label>' +
          '<select id="schedCatchUp"><option value="latest">补跑最近一次</option><option value="skip">跳过，对齐下次</option></select></div>' +
        '<div class="goal-row">' +
          '<div><label for="schedTimeZone">时区（留空＝本机）</label>' +
            '<input id="schedTimeZone" type="text" placeholder="Asia/Shanghai"></div>' +
          '<div><label for="schedModel">模型（留空＝全局默认）</label>' +
            '<input id="schedModel" type="text" placeholder="provider/model"></div>' +
        '</div>' +
        '<p class="goal-note">每次触发 = 开一个<b>全新会话</b>跑这段提示词（不带来自这里的上下文），花真钱；新建即启用。' +
          '名称/长度/时区/分钟下限等规则由主进程逐条判，拒因原样回显在下面。' +
          '换了时区，保存后这一行会带上主进程算出的偏移注记（这里不预先估一遍，估就是第二份算法）。</p>' +
        '<p class="goal-note" id="schedErr" hidden></p>' +
        '<div class="goal-actions"><button type="submit" class="primary">创建任务</button></div>' +
      '</form>';
  }
  registerPop(schedPanel, ctxSched, renderSchedPanel);
  ctxSched.addEventListener('click', () => togglePop(schedPanel));
  if (typeof api.scheduleUpsert !== 'function') {
    ctxSched.disabled = true;
    ctxSched.setAttribute('aria-label', '新建定时任务：当前壳未提供 schedule-upsert 通道');
  }
  schedPanel.addEventListener('change', (e) => {
    if (e.target.id !== 'schedKind') return;
    const form = schedPanelBody.querySelector('.sched-form');
    if (form) form.dataset.kind = e.target.value; // 只切显示，不重渲染（重渲染会抹掉已填的值）
  });
  schedPanel.addEventListener('submit', (e) => {
    e.preventDefault();
    const v = (id) => { const el = schedPanelBody.querySelector('#' + id); return el ? el.value : ''; };
    const fields = {
      name: v('schedName'), kind: v('schedKind'), at: v('schedAt'), everyMinutes: v('schedEvery'),
      time: v('schedTime'), weekdays: v('schedWeekdays'), prompt: v('schedPrompt'),
      permissionTier: v('schedTier') || SCHED_TIER_DEFAULT, catchUp: v('schedCatchUp') || 'latest',
      timeZone: v('schedTimeZone'), model: v('schedModel'),
    };
    const errBox = schedPanelBody.querySelector('#schedErr');
    void (async () => {
      try {
        const r = await api.scheduleUpsert(schedFormPayload(fields), true);
        if (!r || r.ok !== true) {
          const msg = (r && r.error) || '未知原因';
          if (errBox) { errBox.hidden = false; errBox.textContent = '未创建：' + msg; }
          toast('任务未创建');
          return;
        }
        closeAllPops(false);
        toast('已创建定时任务：' + fields.name.trim());
        scheduleCache = null; // 列表一律回读快照，不在本地插一行（插了就两份事实源）
        await loadSchedule(true);
        if (typeof renderSide === 'function') renderSide();
      } catch (err) {
        if (errBox) { errBox.hidden = false; errBox.textContent = '未创建：' + ((err && err.message) || String(err)); }
      }
    })();
  });

  /* ---------- diff 卡行级评审（card_action 的第四条动作：comment）----------
     读端（补丁快照 / 安全发现 / 评论列表）已上屏，这一段是写端：让「评」真能把意见送进去。三条口径：
     · 合法性只在 main 判一处（path 非空 / line>=1 / body 非空）——这里只照形状造 payload，
       不再写一份校验（两处校验迟早给出两个答案）；
     · 回条三面如实说：ok=false ⇒ 未送达并原文点名原因；injected=false ⇒ 评论只落了流、
       这个 worker 已不再读它（取消中 / worktree 已收尾）。把没送达说成送达就是假回执；
     · 看板收进 ctxPops 这一个事实源：互斥 / Escape / 外点三条收起链不另开一套。锚点是
       「被点那一行的按钮」、随行而变，所以展开时改 reg.chipEl（registerPop 为此返回登记项）。
     放在 IIFE 尾段与定时/goal 面板同因：切片式渲染层测不装载这一段。 */
  const cmtPop = $('#cmtPop');
  const cmtHead = $('#cmtHead');
  const cmtBody = $('#cmtBody');
  const cmtErr = $('#cmtErr');
  const cmtReg = registerPop(cmtPop, cmtPop, null);
  let cmtTarget = null;

  function cmtFail(msg) {
    cmtErr.hidden = false;
    cmtErr.textContent = '未送达：' + msg;
  }
  function openCommentPop(btn) {
    if (!cmtPop.hidden && cmtReg.chipEl === btn) { closeAllPops(true); return; }   // 同一个按钮再点一次 = 收起
    const row = btn.closest('.ln-row');
    const col = btn.closest('.merge-col');
    const path = row && row.dataset.path ? row.dataset.path : '';
    const line = Number(row && row.dataset.line);
    const agent = col && col.dataset.agent ? col.dataset.agent : '';
    if (!agent || !path || !Number.isInteger(line) || line < 1) {
      // 坐标缺失 ⇒ 这一行本不该长出按钮（diffHtml 按新行号与路径判过）。真走到这里说明 DOM 被改坏了：
      // 宁可不弹，也不发一条必然撞墙的请求。
      toast('这一行没带文件路径或行号，评审框不弹');
      return;
    }
    closeAllPops(false);
    cmtReg.chipEl = btn;
    cmtTarget = { agent, path, line };
    cmtHead.textContent = '评 ' + path + ' 第 ' + String(line) + ' 行 → ' + agent;
    cmtErr.hidden = true;
    cmtErr.textContent = '';
    cmtBody.value = '';
    showPop(cmtPop, btn);
    cmtBody.focus();
  }
  cmtPop.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!cmtTarget) { toast('评审对象已失效（这一列重画过了），请重新点一次「评」'); return; }
    const { agent, path, line } = cmtTarget;
    const body = cmtBody.value;   // 不 trim：空不空由 main 判，判据措辞只留一份
    void (async () => {
      try {
        const r = await api.cardAction(cardActionForComment(agent, path, line, body));
        if (!r || r.ok !== true) { cmtFail((r && r.error) || '回条没带 ok 字段'); return; }
        closeAllPops(false);
        toast(r.injected === false
          ? '评论只落进了事件流，' + agent + ' 已不再读它：' + (r.error || '原因未带')
          : '已送进 ' + agent + ' 的子流（它会再跑一轮，这一轮花真钱）');
      } catch (err) {
        cmtFail((err && err.message) || String(err));
      }
    })();
  });
  cmtPop.addEventListener('click', (e) => {
    if (e.target.closest('#cmtCancel')) closeAllPops(true);
  });

  /* 目标态镜像：showHistory 全量筛（replay 唯一入口），renderEvent 只看 live（rc.replay 为假）。
     两支互斥：live 要么走 renderEvent(e)，要么走 showHistory(historyEvents.concat(e))——
     后者会把整段快照重新筛一遍，所以 replay 期间绝不能再把事件追加进镜像。 */
  const _showHistoryForGoal = showHistory;
  showHistory = function (events) {
    goalEvents = (Array.isArray(events) ? events : []).filter(goalRelevant);
    goalEventsSession = real.id;
    syncGoalChip();
    return _showHistoryForGoal(events);
  };
  const _renderEventForGoal = renderEvent;
  renderEvent = function (e) {
    if (!rc.replay && goalRelevant(e)) {
      goalEvents = goalEvents.concat([e]);
      goalEventsSession = real.id;
      syncGoalChip();
    }
    return _renderEventForGoal(e);
  };
  syncGoalChip();

})();
