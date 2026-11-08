/** 识图通道：图片内容块从 loop 到 provider 的那条路。
 *
 *  为什么需要一只盒子：图片**不能进事件日志**（base64 会让每场会话文件大一个量级，
 *  且事件流是可重放的契约），而 provider 是会话型——它每轮从事件日志重建历史，
 *  所以「只在内存里改 messages」到不了模型面（同一个坑：`ephemeralUserTurn` 的来历）。
 *  于是图片只能活在进程内存里，由 loop 存、provider 取，中间经这只盒子。
 *
 *  两个方法必须由同一只盒子提供（分成两个参数就会有人只递一头）：`push` 给 loop，
 *  `take` 给 provider 的请求组装。`take` 取出即清空——同一张图附两遍就是白付两遍 token，
 *  而模型看到两张一样的图会以为自己看漏了什么。 */

export interface ImageBlock {
  type: "image";
  dataUrl: string;
}

export interface ImageChannel {
  push: (images: readonly ImageBlock[]) => void;
  take: () => ImageBlock[];
  /** 只读一眼待发图，**不拿走**。
   *
   *  为什么必须有一条不消费的读口（2026-11-03 实测）：预算要在 `take` 之前知道这一轮带了
   *  多重的图（两张 900×1200 的帧 base64 就有 285,240 字符），而 `take` 一旦发生，
   *  硬闸拦下的那一轮就等于把图吞了 —— 请求没发出去，图也没了，重试时模型看不到它刚渲的帧，
   *  历史里的 tool_result 却还写着「已作为图片内容块附上」。⇒ 读用 peek，清空放到硬闸之后。 */
  peek: () => ImageBlock[];
  /** 当前盒里待发的张数（观测用：识图到底有没有送到，不能只看模型说没说到）。 */
  size: () => number;
}

export function createImageChannel(): ImageChannel {
  let pending: ImageBlock[] = [];
  return {
    push(images) {
      // 复制一份再存：工具返回的是内部数组的引用，调用方后续改写不该让已经入盒的图变样。
      pending = [...pending, ...images.map((p) => ({ type: p.type, dataUrl: p.dataUrl }))];
    },
    take() {
      if (pending.length === 0) return [];
      const out = pending;
      pending = [];
      return out;
    },
    peek() {
      // 返回副本：调用方拿去量预算，不该顺手改盒里的东西。
      return pending.map((p) => ({ type: p.type, dataUrl: p.dataUrl }));
    },
    size: () => pending.length,
  };
}
