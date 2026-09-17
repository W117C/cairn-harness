// a11y-check —— 渲染层**可访问性**门禁。
//
// 存在的理由：对比度、可访问名、aria 状态一致性此前没有任何自动化守卫——
// 26 道门禁里没有一道会在 `aria-selected` 写成 `"1"`、或正文对比度掉到 3.1:1 时变红。
//
// axe-core 没装、也没有网络，故本门实现一个**等价扫描器**（需求文档明确允许
// 「axe-core 或等价」）：用 CDP 驱动应用，在页内 evaluate 一段只读脚本，
// 产出逐规则的违规清单。等价性靠**规则口径写死在本文件顶部**保证，不靠第三方库。
//
// 三个状态：默认态 / 抽屉打开态 / 设置浮层打开态（aria 状态一致性只在交互后才暴露）。
//
// Fail-visible 纪律：应用起不来 → 打印「未验证」并退出码 1；**绝不允许「跑不起来」时退出 0**。
// 颜色解析同理：解析不了的颜色函数（oklch/lab/color(display-p3)… 里没实现的那些）
// 一律报为违规，不许静默通过。
//
// 用法：
//   pnpm a11y-check                              （默认：构建产物 out/renderer）
//   pnpm a11y-check -- --static /tmp/dsh-a11y-neg （反向对照：必须判红）
//   pnpm a11y-check -- --electron                 （显式走真实交付壳）
//
// 驱动取舍（裁决 1，2026-09-17）：**默认 `--static out/renderer`**，不走 Electron。
// 本宿主 Electron 交付壳根本起不来——`import { BrowserWindow } from "electron"` 在本宿主
// ESM loader 下解析到 npm wrapper 而失败（`Electron --version` 打印 Node v24.20.0 而非
// 44.2.0），已归档于 BLOCKED.md:432。断言集在两支下**完全相同**，只有启动机制不同；
// 而构建产物正是**发货物**。让默认路径永久红只会训练人忽略门禁。Electron 路径**保留**
// 为显式 opt-in，供能起 Electron 的宿主 / CI 用。刻意不做自动探测降级（白加约 25s 等待）。
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  Cdp,
  cdpUp,
  diagnoseBoot,
  launchChromeCdp,
  launchElectronCdp,
  makeReporter,
  parseArgs,
  printTarget,
  serveStatic,
  sleep,
  tryWait,
  type Launched,
  type StaticServer,
} from "./lib/harness";

interface RuleResult {
  level: "critical" | "serious" | "moderate";
  count: number;
  samples: string[];
}

interface ScanResult {
  rules: Record<string, RuleResult>;
  contrast: {
    textSampled: number;
    textUnique: number;
    boundarySampled: number;
    boundaryUnique: number;
  };
  debug: string[];
}

/** 页内只读扫描器。String.raw 保住正则里的反斜杠（普通模板串会把 \s 吃成 s）。 */
const SCAN = String.raw`(() => {
  const out = { rules: {}, contrast: { textSampled: 0, textUnique: 0, boundarySampled: 0, boundaryUnique: 0 }, debug: [] };
  const push = (rule, level, detail) => {
    if (!out.rules[rule]) out.rules[rule] = { level: level, count: 0, samples: [] };
    out.rules[rule].count++;
    if (out.rules[rule].samples.length < 5) out.rules[rule].samples.push(detail);
  };
  const label = (el) => {
    if (!el || !el.tagName) return 'unknown';
    const id = el.id ? '#' + el.id : '';
    const cls = typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/)[0] : '';
    return el.tagName.toLowerCase() + id + cls;
  };
  const vis = (el) => {
    const cs = getComputedStyle(el);
    if (cs.display === 'none') return false;
    if (cs.visibility === 'hidden' || cs.visibility === 'collapse') return false;
    if (parseFloat(cs.opacity) === 0) return false;
    if (el.classList && el.classList.contains('sr-only')) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 2 && r.height < 2) return false;
    return true;
  };

  /* ---------- 颜色解析（sRGB 口径） ---------- */
  const NAMED = { transparent: [0, 0, 0, 0], white: [255, 255, 255, 1], black: [0, 0, 0, 1] };
  const pctOrNum = (t) => {
    const s = String(t).trim();
    return s.endsWith('%') ? parseFloat(s) / 100 : parseFloat(s);
  };
  const gamma = (c) => {
    const v = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
    return Math.min(1, Math.max(0, v));
  };
  // 返回 [r,g,b,a]（r/g/b ∈ [0,255]，a ∈ [0,1]）；解析失败返回 null → 调用方报违规
  const parseColor = (input) => {
    if (input === null || input === undefined) return null;
    const s = String(input).trim().toLowerCase();
    if (s === '') return null;
    if (Object.prototype.hasOwnProperty.call(NAMED, s)) {
      const v = NAMED[s];
      return [v[0], v[1], v[2], v[3]];
    }
    if (s.charAt(0) === '#') {
      const h = s.slice(1);
      if (h.length === 3) return [parseInt(h[0] + h[0], 16), parseInt(h[1] + h[1], 16), parseInt(h[2] + h[2], 16), 1];
      if (h.length === 6) return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), 1];
      if (h.length === 8) return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), parseInt(h.slice(6, 8), 16) / 255];
      return null;
    }
    const rgbM = /^rgba?\(([^)]+)\)$/.exec(s);
    if (rgbM) {
      const parts = rgbM[1].split(/[\s,\/]+/).filter(Boolean);
      if (parts.length < 3) return null;
      const comp = (t) => (String(t).endsWith('%') ? parseFloat(t) * 2.55 : parseFloat(t));
      const r = comp(parts[0]);
      const g = comp(parts[1]);
      const b = comp(parts[2]);
      const a = parts.length >= 4 ? pctOrNum(parts[3]) : 1;
      if (![r, g, b, a].every(isFinite)) return null;
      return [r, g, b, a];
    }
    const oklchM = /^oklch\(([^)]+)\)$/.exec(s);
    if (oklchM) {
      const parts = oklchM[1].split(/[\s\/]+/).filter(Boolean);
      if (parts.length < 3) return null;
      const L = String(parts[0]).endsWith('%') ? parseFloat(parts[0]) / 100 : parseFloat(parts[0]);
      const C = String(parts[1]).endsWith('%') ? parseFloat(parts[1]) * 0.004 : parseFloat(parts[1]);
      let H;
      const hs = String(parts[2]);
      if (hs.endsWith('deg')) H = parseFloat(hs);
      else if (hs.endsWith('rad')) H = parseFloat(hs) * 180 / Math.PI;
      else if (hs.endsWith('turn')) H = parseFloat(hs) * 360;
      else if (hs.endsWith('grad')) H = parseFloat(hs) * 0.9;
      else H = parseFloat(hs);
      const alpha = parts.length >= 4 ? pctOrNum(parts[3]) : 1;
      if (![L, C, H, alpha].every(isFinite)) return null;
      const rad = H * Math.PI / 180;
      const aa = C * Math.cos(rad);
      const bb = C * Math.sin(rad);
      const l_ = L + 0.3963377774 * aa + 0.2158037573 * bb;
      const m_ = L - 0.1055613458 * aa - 0.0638541728 * bb;
      const s_ = L - 0.0894841775 * aa - 1.2914855480 * bb;
      const l = l_ * l_ * l_;
      const m = m_ * m_ * m_;
      const ss = s_ * s_ * s_;
      const R = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * ss;
      const G = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * ss;
      const B = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * ss;
      return [gamma(R) * 255, gamma(G) * 255, gamma(B) * 255, alpha];
    }
    const srgbM = /^color\(srgb\s+([^)]+)\)$/.exec(s);
    if (srgbM) {
      const parts = srgbM[1].split(/[\s\/]+/).filter(Boolean);
      if (parts.length < 3) return null;
      const c = (t) => (String(t).endsWith('%') ? parseFloat(t) / 100 : parseFloat(t));
      const r = c(parts[0]);
      const g = c(parts[1]);
      const b = c(parts[2]);
      const a = parts.length >= 4 ? pctOrNum(parts[3]) : 1;
      if (![r, g, b, a].every(isFinite)) return null;
      return [r * 255, g * 255, b * 255, a];
    }
    return null; // 未实现的颜色函数 → fail-visible
  };
  const lin = (c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  const lum = (c) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
  const over = (fg, bg) => {
    const a = fg[3];
    return [fg[0] * a + bg[0] * (1 - a), fg[1] * a + bg[1] * (1 - a), fg[2] * a + bg[2] * (1 - a), 1];
  };
  const ratio = (a, b) => {
    const la = lum(a);
    const lb = lum(b);
    const hi = Math.max(la, lb);
    const lo = Math.min(la, lb);
    return (hi + 0.05) / (lo + 0.05);
  };
  const bgCache = new Map();
  // 向上遍历祖先，找第一个非透明背景；逐层合成（html → el），底为白画布
  const effectiveBg = (el) => {
    const chain = [];
    let cur = el;
    while (cur) {
      chain.push(cur);
      cur = cur.parentElement;
    }
    chain.reverse();
    let bg = [255, 255, 255, 1];
    for (let i = 0; i < chain.length; i++) {
      const raw = getComputedStyle(chain[i]).backgroundColor;
      const c = parseColor(raw);
      if (c === null) return { bg: null, raw: raw, node: label(chain[i]) };
      if (c[3] > 0) bg = over(c, bg);
    }
    return { bg: bg, raw: null, node: null };
  };
  const key = (c) => Math.round(c[0]) + ',' + Math.round(c[1]) + ',' + Math.round(c[2]);

  /* ---------- 规则 1：重复 id ---------- */
  const idMap = new Map();
  document.querySelectorAll('[id]').forEach((el) => {
    const id = el.id;
    if (!id) return;
    if (!idMap.has(id)) idMap.set(id, []);
    idMap.get(id).push(el);
  });
  idMap.forEach((els, id) => {
    if (els.length > 1) push('duplicate-id', 'serious', '#' + id + ' × ' + els.length + '（' + els.map(label).join(' / ') + '）');
  });

  /* ---------- 规则 2：可访问名 ---------- */
  const accessibleName = (el) => {
    const aria = el.getAttribute('aria-label');
    if (aria && aria.trim() !== '') return aria.trim();
    const by = el.getAttribute('aria-labelledby');
    if (by) {
      const parts = by.split(/\s+/).map((id) => {
        const t = document.getElementById(id);
        return t ? String(t.textContent || '').trim() : '';
      }).filter(Boolean);
      if (parts.length > 0) return parts.join(' ');
    }
    const title = el.getAttribute('title');
    if (title && title.trim() !== '') return title.trim();
    const txt = String(el.textContent || '').replace(/\s+/g, ' ').trim();
    if (txt !== '') return txt;
    const imgAlt = el.querySelector('img[alt]');
    if (imgAlt && String(imgAlt.getAttribute('alt')).trim() !== '') return String(imgAlt.getAttribute('alt')).trim();
    return '';
  };
  document.querySelectorAll('button, [role="button"]').forEach((el) => {
    if (accessibleName(el) === '') push('button-name', 'critical', label(el) + ' 无可访问名');
  });

  /* ---------- 规则 3：img alt ---------- */
  document.querySelectorAll('img').forEach((el) => {
    const hasAlt = el.hasAttribute('alt');
    const decorative = el.getAttribute('role') === 'presentation' && el.getAttribute('aria-hidden') === 'true';
    if (!hasAlt && !decorative) push('image-alt', 'critical', label(el) + ' 无 alt 且未声明 role=presentation + aria-hidden');
  });

  /* ---------- 规则 4：tab / tabpanel 一致性 ---------- */
  const tabPanels = [];
  document.querySelectorAll('[role="tabpanel"]').forEach((p) => tabPanels.push(p));
  document.querySelectorAll('[role="tab"]').forEach((t) => {
    const sel = t.getAttribute('aria-selected');
    if (sel !== 'true' && sel !== 'false') push('tab-aria-selected', 'serious', label(t) + ' aria-selected=' + JSON.stringify(sel));
    const controls = t.getAttribute('aria-controls');
    if (controls) {
      if (!document.getElementById(controls)) push('tabpanel-orphan', 'serious', label(t) + ' aria-controls=' + controls + ' 指向不存在的节点');
    } else {
      const own = t.getAttribute('data-view');
      if (own && !document.querySelector('[role="tabpanel"][data-view="' + own + '"]')) {
        push('tabpanel-orphan', 'serious', label(t) + ' 无对应 tabpanel（data-view=' + own + '）');
      }
    }
  });
  tabPanels.forEach((p) => {
    const view = p.getAttribute('data-view');
    const id = p.id;
    const hasTab = (id && document.querySelector('[role="tab"][aria-controls="' + id + '"]')) ||
      (view && document.querySelector('[role="tab"][data-view="' + view + '"]'));
    if (!hasTab) push('tabpanel-orphan', 'serious', label(p) + ' 无对应 tab（data-view=' + String(view) + '）');
  });

  /* ---------- 规则 5：aria-hidden 子树内无可聚焦元素 ---------- */
  const FOCUSABLE = 'button, a[href], input, select, textarea, [tabindex]';
  document.querySelectorAll('[aria-hidden="true"]').forEach((root) => {
    root.querySelectorAll(FOCUSABLE).forEach((f) => {
      const ti = f.getAttribute('tabindex');
      if (ti === '-1') return;
      if (f.disabled) return;
      if (f.tagName === 'INPUT' && f.getAttribute('type') === 'hidden') return;
      if (f.closest('[aria-hidden="false"]')) return;
      // inert 子树按规范不可聚焦（axe-core 的 isFocusable 同样跳过）：漏了这一支会把
      // 「aria-hidden + inert」这个**正确修法**判成违规——那正是本门要防的假阳。
      // 依据（实测）：inert 元素**仍渲染**（getClientRects().length 仍为 1、tabIndex 仍为 0），
      // 所以下面两条既有豁免都测不到它；而 focus() 实测抢不到焦点 ⇒ 它确实不可聚焦。
      if (f.closest('[inert]')) return;
      // 与 axe 同口径：display:none / 零尺寸的子树不算「可聚焦但被藏起来」——它根本不在渲染树里
      if (f.getClientRects().length === 0) return;
      push('aria-hidden-focus', 'serious', label(root) + ' 内可聚焦：' + label(f));
    });
  });

  /* ---------- 规则 6：aria 状态值必须是 "true"/"false" ---------- */
  document.querySelectorAll('[aria-pressed], [aria-expanded]').forEach((el) => {
    ['aria-pressed', 'aria-expanded'].forEach((attr) => {
      if (!el.hasAttribute(attr)) return;
      const v = el.getAttribute(attr);
      if (v !== 'true' && v !== 'false') push('aria-state-value', 'serious', label(el) + ' ' + attr + '=' + JSON.stringify(v));
    });
  });

  /* ---------- 规则 7：html lang ---------- */
  const lang = document.documentElement.getAttribute('lang');
  if (lang === null || lang.trim() === '') push('html-lang', 'serious', '<html> 缺 lang 或为空');

  /* ---------- 规则 8：标题层级 ---------- */
  const heads = [];
  document.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach((h) => {
    heads.push({ el: h, level: Number(h.tagName.slice(1)) });
  });
  const h1s = heads.filter((h) => h.level === 1);
  if (h1s.length !== 1) push('heading-h1-count', 'serious', '页面 <h1> 数量 = ' + h1s.length + '（要求恰好 1）');
  let prev = 0;
  heads.forEach((h) => {
    if (prev > 0 && h.level > prev + 1) push('heading-order', 'moderate', 'h' + prev + ' → h' + h.level + ' 跳级（' + label(h.el) + '）');
    prev = h.level;
  });

  /* ---------- 规则 9：对比度 ---------- */
  const LARGE_PX = 24;
  const LARGE_BOLD_PX = 18.66;
  const threshold = (cs) => {
    const size = parseFloat(cs.fontSize);
    const weight = Number(cs.fontWeight) || 400;
    if (size >= LARGE_PX) return 3.0;
    if (size >= LARGE_BOLD_PX && weight >= 700) return 3.0;
    return 4.5;
  };
  const hasDirectText = (el) => {
    for (let i = 0; i < el.childNodes.length; i++) {
      const n = el.childNodes[i];
      if (n.nodeType === 3 && String(n.nodeValue || '').trim() !== '') return true;
    }
    return false;
  };
  const SKIP_TAG = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TITLE: 1, HEAD: 1, META: 1, LINK: 1 };
  const textSeen = new Set();
  const all = document.body ? document.body.querySelectorAll('*') : [];
  for (let i = 0; i < all.length; i++) {
    const el = all[i];
    if (SKIP_TAG[el.tagName]) continue;
    if (!hasDirectText(el)) continue;
    if (el.closest('[aria-hidden="true"]')) continue;
    if (!vis(el)) continue;
    const cs = getComputedStyle(el);
    const fgRaw = cs.color;
    const fg = parseColor(fgRaw);
    const bgInfo = effectiveBg(el);
    if (fg === null || bgInfo.bg === null) {
      push('color-contrast', 'serious', label(el) + ' 颜色无法解析：fg=' + JSON.stringify(fgRaw) + ' bg=' + JSON.stringify(bgInfo.raw) + '（' + String(bgInfo.node) + '）');
      continue;
    }
    out.contrast.textSampled++;
    const bg = bgInfo.bg;
    const eff = over(fg, bg);
    const r = ratio(eff, bg);
    const need = threshold(cs);
    const sig = key(eff) + '|' + key(bg) + '|' + cs.fontSize + '|' + cs.fontWeight + '|' + need;
    if (textSeen.has(sig)) continue;
    textSeen.add(sig);
    out.contrast.textUnique++;
    out.debug.push('TEXT ' + label(el) + ' ratio=' + r.toFixed(2) + ' need=' + need + ' fg=' + fgRaw + ' bg=' + key(bg) + ' size=' + cs.fontSize + '/' + cs.fontWeight);
    if (r < need) push('color-contrast', 'serious', label(el) + ' 对比度 ' + r.toFixed(2) + ':1 < ' + need + ':1（fg=' + fgRaw + ' bg=rgb(' + key(bg) + ')）');
  }

  /* ---------- 规则 10：非文字 UI 边界 ≥ 3:1（WCAG 1.4.11） ---------- */
  // WCAG 1.4.11 的「边界」有两种合法实现：边框色 vs 相邻背景，或**填充色 vs 相邻背景**
  // （输入框靠浅填充与周围区分时，边框可以很淡）。取两者较大值，避免把「靠填充区分」
  // 的合法设计误判为违规——判据仍然是 3:1，只是承认两种达成方式。
  const BOUNDARY = ['.composer-box', 'textarea', 'input:not([type="hidden"])', 'select', '.gutter', '.side-tab', '.btn', '.switch'];
  const boundSeen = new Set();
  BOUNDARY.forEach((sel) => {
    document.querySelectorAll(sel).forEach((el) => {
      if (!vis(el)) return;
      if (el.closest('[aria-hidden="true"]')) return;
      const cs = getComputedStyle(el);
      const w = parseFloat(cs.borderTopWidth) + parseFloat(cs.borderRightWidth) + parseFloat(cs.borderBottomWidth) + parseFloat(cs.borderLeftWidth);
      const own = parseColor(cs.backgroundColor);
      const hasOwnFill = own !== null && own[3] > 0;
      if (!(w > 0) && !hasOwnFill) return; // 既无边框也无填充 → 本元素不声明边界，跳过
      const parentInfo = el.parentElement ? effectiveBg(el.parentElement) : { bg: [255, 255, 255, 1], raw: null, node: null };
      const bgInfo = effectiveBg(el);
      out.contrast.boundarySampled++;
      if (bgInfo.bg === null || parentInfo.bg === null) {
        push('non-text-contrast', 'serious', label(el) + ' 背景色无法解析（' + String(bgInfo.node) + String(parentInfo.node) + '）');
        return;
      }
      const bg = bgInfo.bg;
      const pbg = parentInfo.bg;
      let best = -1;
      let how = '';
      let borderRaw = 'none';
      if (w > 0) {
        borderRaw = cs.borderTopColor;
        const bc = parseColor(borderRaw);
        if (bc === null) {
          push('non-text-contrast', 'serious', label(el) + ' 边框色无法解析：' + JSON.stringify(borderRaw));
          return;
        }
        best = ratio(over(bc, bg), bg);
        how = 'border';
      }
      if (hasOwnFill) {
        // effectiveBg(el) 已把 el 自身背景合成到父背景之上，故直接比「自身填充 vs 相邻父背景」
        const fillR = ratio(bg, pbg);
        if (fillR > best) {
          best = fillR;
          how = 'fill';
        }
      }
      const sig = key(bg) + '|' + key(pbg) + '|' + sel + '|' + how;
      if (boundSeen.has(sig)) return;
      boundSeen.add(sig);
      out.contrast.boundaryUnique++;
      out.debug.push('BOUND ' + label(el) + ' best=' + best.toFixed(2) + ' via=' + how + ' border=' + borderRaw + ' bg=' + key(bg) + ' parentBg=' + key(pbg));
      if (best < 3) {
        push('non-text-contrast', 'serious', label(el) + ' 边界对比度 ' + best.toFixed(2) + ':1 < 3:1（border=' + borderRaw + ' bg=rgb(' + key(bg) + ')，填充亦不达标）');
      }
    });
  });

  return out;
})()`;

interface StateDef {
  name: string;
  prep: string;
  /** 状态是否真的进入（fail-visible：进不去 = 未验证）。 */
  verify: string;
}

const STATES: StateDef[] = [
  { name: "默认态", prep: "true", verify: "true" },
  {
    name: "抽屉打开态",
    prep: "(() => { const d = document.querySelector('#drawer'); if (d && d.classList.contains('collapsed')) document.querySelector('#drawerToggle').click(); return true; })()",
    verify: "(() => { const d = document.querySelector('#drawer'); return !!d && !d.classList.contains('collapsed'); })()",
  },
  {
    name: "设置浮层打开态",
    prep: "(() => { const b = document.querySelector('#settingsOpen'); if (b) b.click(); return true; })()",
    verify: "(() => { const o = document.querySelector('#settingsOverlay'); return !!o && o.classList.contains('show'); })()",
  },
];

/** 规则展示顺序（未命中的规则也打印 0，便于「全绿」时有据可查）。 */
const RULE_ORDER: { name: string; level: string; note: string }[] = [
  { name: "duplicate-id", level: "serious", note: "重复 id" },
  { name: "button-name", level: "critical", note: "按钮/role=button 可访问名" },
  { name: "image-alt", level: "critical", note: "img alt" },
  { name: "tab-aria-selected", level: "serious", note: "role=tab 的 aria-selected" },
  { name: "tabpanel-orphan", level: "serious", note: "tab ↔ tabpanel 对应" },
  { name: "aria-hidden-focus", level: "serious", note: "aria-hidden 子树内可聚焦" },
  { name: "aria-state-value", level: "serious", note: "aria-pressed/expanded 取值" },
  { name: "html-lang", level: "serious", note: "<html lang>" },
  { name: "heading-h1-count", level: "serious", note: "恰好一个 h1" },
  { name: "heading-order", level: "moderate", note: "标题不跳级" },
  { name: "color-contrast", level: "serious", note: "正文对比度 ≥ 4.5:1（大字 ≥ 3:1）" },
  { name: "non-text-contrast", level: "serious", note: "非文字 UI 边界 ≥ 3:1" },
];

const reporter = makeReporter();
const args = parseArgs(process.argv.slice(2), 9711 + (process.pid % 300));
if (args.error !== null) {
  console.error("[a11y-check] 参数错误：" + args.error);
  process.exit(2);
}
const staticMode = args.staticDir !== null;
const debugColors = process.argv.includes("--debug-colors");

// 用对象持有句柄：`let` 变量的赋值发生在 boot() 闭包内，TS 的控制流分析看不到，
// 顶层会被收窄成 null → finally 里访问属性报 never。
const ctx: { launched: Launched | null; server: StaticServer | null; profileDir: string | null } = {
  launched: null,
  server: null,
  profileDir: null,
};

async function boot(): Promise<Cdp | null> {
  if (staticMode) {
    ctx.profileDir = await mkdtemp(join(tmpdir(), "a11y-chrome-"));
    ctx.server = await serveStatic(args.staticDir as string, Number(process.env.PROBE_HTTP_PORT ?? args.port + 1));
    ctx.launched = launchChromeCdp({ port: args.port, profileDir: ctx.profileDir });
  } else {
    ctx.launched = launchElectronCdp({ port: args.port });
  }
  if (!(await cdpUp(args.port))) {
    const tail = (ctx.launched?.output() ?? "").trim().split("\n").slice(-8);
    console.log("    诊断（进程输出尾 8 行）：");
    for (const l of tail) console.log("      " + l);
    const hint = diagnoseBoot(tail.join("\n"));
    if (hint !== null) console.log("    ⚠️  归因：" + hint);
    return null;
  }
  const cdp = new Cdp();
  await cdp.connect(args.port);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  if (staticMode && ctx.server !== null) await cdp.send("Page.navigate", { url: ctx.server.url + args.htmlPath });
  await tryWait(async () => {
    const ready = await cdp.eval<boolean>("document.readyState === 'complete' && !!document.body");
    return ready ? true : null;
  }, 20_000);
  await sleep(800);
  return cdp;
}

const totals = new Map<string, number>();
let scannedStates = 0;

function reportState(state: StateDef, scan: ScanResult): void {
  scannedStates++;
  console.log("[a11y-check] 状态：" + state.name);
  let serious = 0;
  let moderate = 0;
  for (const rule of RULE_ORDER) {
    const hit = scan.rules[rule.name];
    const count = hit ? hit.count : 0;
    totals.set(rule.name, (totals.get(rule.name) ?? 0) + count);
    if (count > 0) {
      if (rule.level === "moderate") moderate += count;
      else serious += count;
    }
    const mark = count === 0 ? "✅" : "❌";
    console.log("  " + mark + " " + rule.name.padEnd(20) + " " + rule.level.padEnd(9) + " " + String(count).padStart(3) + "  " + rule.note);
    if (hit) for (const s of hit.samples) console.log("        · " + s);
  }
  console.log(
    "  → 本状态 critical+serious = " + String(serious) + "，moderate = " + String(moderate) +
      "；采样：文本 " + String(scan.contrast.textUnique) + "/" + String(scan.contrast.textSampled) +
      " 组，边界 " + String(scan.contrast.boundaryUnique) + "/" + String(scan.contrast.boundarySampled) + " 组",
  );
  if (debugColors) for (const d of scan.debug) console.log("        [debug] " + d);
  console.log("");
  reporter.ok(serious === 0, state.name + "：critical+serious 违规 = 0（实际 " + String(serious) + "）");
}

console.log("[a11y-check] 可访问性门禁（axe-core 未安装 → 使用等价内置扫描器）");
printTarget(args);
try {
  const cdp = await boot();
  if (cdp === null) {
    reporter.fail(
      "应用起不来（CDP " + String(args.port) + " 不可达）→ 本门**未验证**；" +
        (staticMode ? "检查 --static 目录是否有 index.html + assets/" : "检查 Electron 能否在 --no-sandbox 下启动"),
    );
  } else {
    for (const state of STATES) {
      await cdp.eval(state.prep);
      await sleep(500);
      const reached = await cdp.eval<boolean>(state.verify);
      if (!reached) {
        reporter.fail("状态「" + state.name + "」未能进入 → 该状态未验证（不静默跳过）");
        continue;
      }
      const scan = await cdp.eval<ScanResult>(SCAN);
      reportState(state, scan);
    }
    cdp.close();
  }
} catch (err) {
  reporter.fail("未预期异常（未验证）：" + (err instanceof Error ? err.message : String(err)));
} finally {
  if (ctx.launched !== null) await ctx.launched.kill();
  if (ctx.server !== null) await ctx.server.close();
  if (ctx.profileDir !== null) await rm(ctx.profileDir, { recursive: true, force: true }).catch(() => {});
}

if (scannedStates === 0) {
  // fail-visible：一个状态都没扫到 = 本门未验证。此处**不得**打印「逐规则 0 违规」的表——
  // 那会被读成「全部通过」，正是本门要防的假绿。
  console.log("[a11y-check] 三态合计逐规则违规数：未验证（未扫描任何状态——应用未启动）");
} else {
  console.log("[a11y-check] 三态合计逐规则违规数（已扫描 " + String(scannedStates) + "/" + String(STATES.length) + " 个状态）：");
  for (const rule of RULE_ORDER) {
    const n = totals.get(rule.name) ?? 0;
    console.log("  " + (n === 0 ? "✅" : "❌") + " " + rule.name.padEnd(20) + " " + String(n).padStart(3));
  }
}
console.log(
  "[a11y-check] " + String(reporter.total - reporter.failures) + "/" + String(reporter.total) + " 项通过" +
    (reporter.failures === 0 ? " ✅" : "，失败 " + String(reporter.failures) + " 项 ❌"),
);
process.exit(reporter.failures === 0 ? 0 : 1);
