# Liftoff Platform Reference

更新时间基线：2026-04-01

## 官方依据

- Liftoff / Vungle Help Center: Adaptive Creative Asset Requirements  
  `https://support.vungle.com/hc/en-us/articles/360061060131-Adaptive-Creative-Asset-Requirements`

## 为什么默认 deferred

Liftoff 与 AppLovin 的差异不是简单替换 CTA API，而是整套事件模型不同。它不适合作为“顺手一起带上”的平台。

## 相对 AppLovin 的核心差异

- 入口文件不是 `index.html`，而是 `ad.html`
- 不是纯 `MRAID open` 模型，而是事件模型
- 必须有 `download`
- 必须有 `complete`
- `download` 和 `complete` 不能同时触发

## 当前应理解的最低规则

- Playable 要提供 `ad.html`
- CTA 或结束页交互通常触发 `"download"`
- 用户完成足够互动后自动触发 `"complete"`
- `"download"` 和 `"complete"` 互斥
- 完成事件通常需要明确的状态机和防重入保护

## 实现建议

- 不要把 Liftoff 当成 AppLovin 家族平台。
- 需要单独设计：
  - 专用导出结构
  - `download / complete` 事件桥接
  - 完成判定规则
  - 互斥状态机

## BusJam 结论

- Liftoff 在 BusJam 这一轮明确 deferred。
- 如果用户没有明确要求 Liftoff，不要主动把它并入本轮交付目标。

## 什么时候再启用

只有当下面这些都已经稳定后，才建议重新打开 Liftoff：

- AppLovin 基线稳定
- 其他主流平台已通过真实后台验收
- 项目已具备独立的 finish / complete 状态机
