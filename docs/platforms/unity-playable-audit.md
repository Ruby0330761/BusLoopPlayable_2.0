# Unity Platform Reference

更新时间基线：2026-04-03

## 官方依据

- Unity Docs: Playable asset specifications  
  `https://docs.unity.com/grow/acquire/creatives/playable/specifications`

## 相对 AppLovin 的核心差异

- 交付形态和 AppLovin 非常接近，最大差异在启动时机。
- Unity 明确要求等 `viewableChange=true` 后再开始 playable 内容。

## 官方硬约束

- 单个 `index.html`
- 所有资源内联
- `< 5MB`
- 符合 `MRAID 3.0`
- CTA 使用 `mraid.open()`
- 不应自动跳商店
- 不应遮挡系统 close 或容器 UI
- 不应依赖网络请求
- 应支持 portrait / landscape
- 在 `viewableChange` 后启动内容

## 实现建议

- 直接从 AppLovin 基线分出 Unity 分支最省成本。
- 保留单 HTML / 内联资源 / `mraid.open()`。
- 把启动时机切到 `viewableChange=true` 之后。
- 继续保留音频手势与后台停音逻辑。

## BusJam 实测提醒

- Unity 是最接近 AppLovin 基线的平台之一。
- 主要风险不是结构，而是启动时机和容器生命周期。

## 最终验收入口

- Unity 素材后台或官方测试环境

## 判定通过前必须确认

- 单 HTML
- `< 5MB`
- `mraid.open()`
- `viewableChange` 后启动
- 无外部网络依赖
