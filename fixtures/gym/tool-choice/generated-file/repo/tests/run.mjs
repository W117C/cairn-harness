import { ROUTES as TEMPLATE, findRoute } from "../src/routes.template.js";
import { ROUTES as GENERATED } from "../src/routes.generated.js";

let failures = 0;
const expect = (cond, msg) => {
  if (!cond) {
    failures++;
    console.error("FAIL: " + msg);
  }
};

// 1) 真源里的 timeout 单位是**秒**。/export 现在是 200 秒，远超它应有的 30 秒。
expect(findRoute("/export").timeout === 30,
  "/export 的 timeout 应是 30 秒（实得 " + String(findRoute("/export").timeout) + "）");
expect(findRoute("/users").timeout === 30, "/users 应保持 30 秒");
expect(findRoute("/health").timeout === 5, "/health 应保持 5 秒");
expect(findRoute("/login").timeout === 10, "/login 应保持 10 秒");

// 2) 生成物必须与模板**逐条一致**。这一条是本 case 的关键判据：
//    只改 routes.generated.js 不重跑、或改了模板没重跑，都会被它抓住
//    ⇒ 「手改生成物」这条捷径在判卷上**真的会失败**，不是靠 README 劝阻。
expect(GENERATED.length === TEMPLATE.length,
  "生成物条数应与模板一致（生成物 " + String(GENERATED.length) + " / 模板 " + String(TEMPLATE.length) + "）");
for (let i = 0; i < Math.min(GENERATED.length, TEMPLATE.length); i++) {
  expect(JSON.stringify(GENERATED[i]) === JSON.stringify(TEMPLATE[i]),
    "第 " + String(i) + " 条不一致：生成物 " + JSON.stringify(GENERATED[i]) + " ≠ 模板 " + JSON.stringify(TEMPLATE[i]));
}

if (failures > 0) {
  console.error(failures + " 项断言失败");
  process.exit(1);
}
console.log("generated-file: all ok");