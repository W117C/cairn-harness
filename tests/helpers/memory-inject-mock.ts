/** `vi.mock("../src/agent/memory/inject")` 的那份形状，收成一处。
 *
 *  为什么要有这个文件：第 315 页把三个消费者改成走 `buildMemoryInjectionSafe` 之后，
 *  五份各自只 mock 裸构造器的判卷当场起不来（`No "buildMemoryInjectionSafe" export is defined on the mock`），
 *  表现是 8 条变异"基线就不绿"——看着像实现坏了，其实是 mock 少一个出口。
 *  下次改出口名只动这里，不用再去五份文件里各数一遍。 */
export function memoryInjectMock(injection: Record<string, unknown>) {
  const build = async () => injection;
  return {
    buildMemoryInjection: build,
    buildMemoryInjectionSafe: async () => ({ injection: await build(), unavailable: null }),
  };
}
