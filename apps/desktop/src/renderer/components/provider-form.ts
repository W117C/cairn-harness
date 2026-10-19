// 自定义接口表单的纯函数资产（自旧 CustomProviderForm 保留——判卷引用的语义面：
// 本地端点判定必须被"拉取"与"保存"两处用同一份；变量名字段即时体检点破"把钥匙填进这一格"。
// 表单 UI 待按新设计重建；本文件先立函数（无 React、无 IPC）。

/** 本地/内网地址判定（与服务端 approve 的口径保持一致：loopback + 私网段 + *.local）。
 *  抽成导出函数是因为**它必须被用两次**：拉取（allowLocal）与保存（allowLocalEndpoint）。 */
export function isLocalEndpointURL(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return /^(localhost|127\.|\[?::1\]?|0\.0\.0\.0)/i.test(url.trim());
  }
  if (host === "localhost" || host === "::1" || host === "[::1]" || host === "0.0.0.0") return true;
  if (host.endsWith(".local")) return true;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (v4 !== null) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 127 || a === 10) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 169 && b === 254) return true; // link-local
  }
  return false;
}

/** 变量名字段的即时体检。最常见的错法是**把钥匙本身填进这一格**，所以这里专门点破它。 */
export function envNameHint(value: string): string | null {
  const v = value.trim();
  if (v === "") return null;
  if (/^(sk|sk-ant|sk-or|gsk|xai|gpt|bearer)[-_]/i.test(v) || /^\S{24,}$/.test(v) && /[a-z]/.test(v) && /\d/.test(v)) {
    return "这看着像**钥匙本身**。这一格要填变量的**名字**（如 DEEPSEEK_API_KEY）——钥匙填在下面「API key」那一行。";
  }
  if (!/^[A-Z][A-Z0-9_]*$/.test(v)) {
    return "变量名一般是大写字母 + 数字 + 下划线（如 DEEPSEEK_API_KEY）。";
  }
  return null;
}

/** 选择弹窗的批量置位（纯函数判卷出口）：全选 / 全不选。只读 id——不信任行上的其余字段。 */
export function selectAllRows(rows: readonly { id: string }[], value: boolean): Record<string, boolean> {
  const next: Record<string, boolean> = {};
  for (const row of rows) next[row.id] = value;
  return next;
}
