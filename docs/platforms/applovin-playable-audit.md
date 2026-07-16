# AppLovin Platform Reference

更新时间基线：2026-04-03

## 官方依据

- Axon / AppLovin Best Practices  
  `https://support.axon.ai/en/growth/promoting-your-apps/creatives/best-practices-and-guidelines/`
- Axon / AppLovin Creative Types / Playable Ads / MRAID Support  
  `https://support.axon.ai/zh/max/demand-partners/demand-side-platforms/applovin-ortb-specification/creative-types/`

## 交付模型

- 单个 HTML
- 全资源内联
- 包体 `<= 5MB`
- `MRAID` 家族

## 关键技术约束

- 初始化前等待 `mraid ready` 或等价的可用状态。
- CTA 通过 `mraid.open()`。
- 不能把“首击直接跳商店”当默认行为。
- 不要自定义关闭按钮。
- 音频只能在真实用户交互后启动。
- 进入后台、失焦、关闭时必须停音。
- 需要可见的 loading。
- WebGL 或重资源初始化失败时需要 fallback。
- 不依赖外部脚本、外部样式、外部资源。

## AppLovin 作为基线的意义

先把 AppLovin 做通，等于先把所有平台都会遇到的这些基础问题做通：

- 最终产物是否稳定
- 单文件和包体约束是否可控
- CTA 是否通过平台桥接
- 音频时机是否合规
- loading / fallback / 生命周期是否正常

## BusJam 实战结论

- `fullscreen_first_tap` 只能保留为实验开关，不能作为正式默认导出。
- 真正要验的是最终包，不是本地 dev server。
- 包体接近上限时，优先优化资源策略，不要先怀疑玩法层。

## 最终验收入口

- `https://p.applov.in/playablePreview?create=1&qr=1`
- 实际广告素材后台

## 判定通过前必须确认

- 包体稳定在 `5MB` 以内
- 官方预览通过
- 实际后台通过
- CTA、音频、结束态、后台停音正常
- 进度文档已经记录当前基线样本和剩余风险
