// 装宿主模块：import 它即装好最小 DOM（副作用模块）。
//
// 单独一个文件是为了**模块求值顺序**：ESM 的 import 是编译期提升、按图求值，所以
// `import "./helpers/dom-host-install"` 写在 `import React from "react"` 之前，宿主一定先装好。
// 如果反过来（在测试文件顶层调 installDomHost()），react-dom 在 import 阶段就已经
// 摸过 globalThis.document 了，后装没用。
import { installDomHost } from "./dom-host";

installDomHost();
// 告诉 React「这里是测试宿主」：否则每次 act() 都会打一条
// 「The current testing environment is not configured to support act(...)」的告警。
Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { value: true, writable: true, configurable: true });
