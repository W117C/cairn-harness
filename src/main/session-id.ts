/** 会话 id 的 sidecar 引用判定：非空、≤80、首尾无空白、不以点开头、不含路径分隔符/控制字符。
 *
 *  这条判据此前在 `pins.ts` / `feedback.ts` / `session-metadata.ts` 三个文件里各写一份
 *  （第 967 页），三份逐字相同；`handleSessionPrefsSet` 的 IPC 门又另写了一份更松的
 *  （不查长度 / 控制字符 / 首尾空白），同一件事四种答案。
 *
 *  本判据只回答「能不能作为 sidecar 的 sessionId 引用」；文件名寻址另有一层更严的
 *  `sessions.isValidSessionName`（它连中间的 `.` 也不收，因为 id 要拼成 `<id>.jsonl`）。
 *  两层刻意分开，别互相冒充。
 */
export const MAX_SESSION_ID_LENGTH = 80;

export function isSessionId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_SESSION_ID_LENGTH &&
    value.trim() === value &&
    !value.startsWith(".") &&
    !/[\\/\u0000-\u001f\u007f]/.test(value)
  );
}
