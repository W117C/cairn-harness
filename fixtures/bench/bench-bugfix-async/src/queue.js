// 依次跑完所有任务再 resolve。handler 可能是异步的。
export async function drain(jobs, handler) {
  const done = [];
  for (const j of jobs) {
    handler(j).then((r) => done.push(r));
  }
  return done
}
