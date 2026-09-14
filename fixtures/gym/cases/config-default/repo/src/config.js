// gym case: config-default
// BUG: 缺 timeout 时无默认值，返回 undefined。
export function loadConfig(raw) {
  return {
    host: raw.host ?? "localhost",
    timeout: raw.timeout, // ← BUG：应为 raw.timeout ?? 30000
  };
}
