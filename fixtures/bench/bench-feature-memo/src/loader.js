let loads = 0;

// 假装很贵：每次调用都真取一次，并把真取次数记下来（测试用它观测）
export async function loadUser(id) {
  loads += 1;
  await new Promise((r) => setTimeout(r, 1));
  return { id, name: "user-" + String(id) }
}

export function loadCount() { return loads; }
export function resetCount() { loads = 0; }
