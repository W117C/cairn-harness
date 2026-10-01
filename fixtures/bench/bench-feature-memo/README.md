# loader-lite

用户加载器。**待办**：`getUser` 对同一个 id 只能真的取一次（记忆化）；
不同 id 互不影响；`resetCache()` 之后重新取。

真取了几次由 `loader.js` 的 `loadCount()` 观测，测试据此断言。

跑测试：`npm test`
