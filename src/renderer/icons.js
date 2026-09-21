/* 图标与「运行中」九宫格动效的标记串——纯静态，无 DOM 依赖。 */
export const ICONS = {
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
  chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6.5A2.5 2.5 0 0 1 5.5 4h9A2.5 2.5 0 0 1 17 6.5v4A2.5 2.5 0 0 1 14.5 13H9l-4 3v-3.5A2.5 2.5 0 0 1 3 9.5Z"/><path d="M18 8h.5A2.5 2.5 0 0 1 21 10.5v4a2.5 2.5 0 0 1-2.5 2.5H18v3l-3.5-3"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13"/></svg>'
};

/* 运行中动效：九宫格（9 个小正方形），逐格顺时针点亮 = 颜色转圈加载。
   格子的相位差写在 CSS 的 nth-child 上，所以这里只需 9 个空 <i>。
   variant='proc' 用于聊天流的过程层（大一号、走 --dim 浅灰）。
   纯装饰，状态由所在行的文字与 aria-label 播报 */
export const runGrid = (variant) =>
  '<span class="run-grid' + (variant ? ' ' + variant : '') + '" aria-hidden="true">' +
  '<i></i>'.repeat(9) + '</span>';
export const RUN_GRID_HTML = runGrid();
