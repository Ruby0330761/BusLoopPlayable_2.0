# Moloco Platform Reference

更新时间基线：2026-04-03

## 官方依据

- Moloco Ads Help Center: Playable and Interactive End Card creative guide  
  `https://help.moloco.com/hc/en-us/articles/24124525963799-Playable-and-Interactive-End-Card-IEC-creative-guide`
- Moloco Ads Help Center: Creative settings guide  
  `https://help.moloco.com/hc/en-us/articles/23994325944727-Creative-settings-guide`

## 相对 AppLovin 的核心差异

- 也是单文件路线，但 CTA 不走 `MRAID`，而走 `FbPlayableAd.onCTAClick()`。
- 不允许 `.zip`。
- 不允许 `mraid.js`、`XMLHttpRequest` 和在线请求。

## 官方硬约束

- 单个 `.html` / `.htm`
- 单文件 `< 5MB`
- 不允许 `XMLHttpRequest`
- 不允许 `mraid.js`
- 不允许外部网络请求
- CTA 使用 `FbPlayableAd.onCTAClick()`

## 实现建议

- 保留 AppLovin 已经验证过的单 HTML / 内联资源策略。
- 切掉所有 `MRAID` 依赖和 `mraid.js` 注入。
- CTA 分支改成 `FbPlayableAd.onCTAClick()`。
- 默认把资源压成 data URI 单文件。

## BusJam 实测提醒

- Moloco 是除 Unity 外最接近 AppLovin 基线的平台之一。
- 真正需要改的是 CTA 桥接和禁止项，不是玩法层。
- 任何 `fetch / XHR / 外链` 都要先当成高风险。

## 最终验收入口

- Moloco 实际后台或测试链路

## 判定通过前必须确认

- 单 HTML
- `<= 5MB`
- `FbPlayableAd.onCTAClick()` 已接通
- 无 `mraid.js`
- 无在线请求
