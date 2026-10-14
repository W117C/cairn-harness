# 第 486 页取料：探针找出两处真缺陷

出证 2026-10-14。方法：给新写的代码喂边界输入，不读注释里的承诺。
两个缺陷都不是门抓到的——跑出它们的时候 34 道门全绿。

## 缺陷一：空串 agent_id 的口径分叉

```
isWorkerSubflow  (acceptance-sampler.ts) : typeof id === "string"
splitStreams     (run-scorecard.ts)      : typeof id === "string" && id !== ""
```

同一个 agent_id 为空的事件：一把尺当 worker、另一把当主会话 ⇒ 两个读数对不上。
修法：两处都改成空串不算 id（以 splitStreams 为准，它是既有的那条口径）。

## 缺陷二：formatRate 印出 Infinity%

```
formatRate('x', {hits:1,total:0,unmeasurable:false})  =>  x：1/0 = Infinity%
```

cost-per-progress 第二条纪律原文：「没有前进边界就是不可测，不是 0、也不是 Infinity」。
两个采样器都从 rate() 出来不会触发，但 formatRate 是导出面，别的构造路径会。
修法：分母 0 一律判不可测，不信任调用方给的 unmeasurable 标志。

## 一条写废的判据（记下来因为那不是手滑）

给缺陷一补的 coverage 用例第一版恒真：spawn(false) 的 agent_id 是随机串，永不为空
⇒ 无论实现把空串当不当 id，读数都一样。改成让 spawn 自己也带空串 id + 反向格。
且 coverage 那半边的反向验证一开始没生效（替换串没匹配上）——没看到红就是没验。
