# Platform Delivery

这份文档只保留“怎么从 AppLovin 基线走到多平台交付”的规则。

## AppLovin 先过

默认先把 `AppLovin` 打通，再扩其他平台。

原因：

- 它能逼着团队先收口最常见的 playable 问题。
- 它对 CTA、音频、loading、包体、单文件交付的要求最适合作为基线。
- 基于它扩 Google Ads、Meta、Unity、Moloco、Mintegral、TikTok 的适配路径最清晰。

AppLovin 阶段至少先确认：

- 单文件 HTML
- 全资源内联
- 包体预算
- `mraid` ready/default
- CTA 走 `mraid.open()`
- 不首击直接跳商店
- 音频只在用户交互后启动
- 前后台切换和关闭时停音
- loading 和 fallback

只有这些都稳定后，才算 AppLovin 基线完成。

## 多平台扩展顺序

默认顺序：

1. `AppLovin`
2. `Google Ads`
3. `Meta`
4. `Unity`
5. `Moloco`
6. `Mintegral`
7. `TikTok`
8. `Liftoff` 默认 deferred

扩平台时先读：

1. `docs/platforms/platform-deltas.md`
2. `docs/platforms/cross-platform-playable-summary.md`
3. 当前目标平台对应的 `docs/platforms/*-playable-audit.md`

## 人工验收优先

真实平台上传和人工试玩必须先做，静态校验不能替代它。

每个平台至少确认：

- 加载是否正常
- 玩法是否能完整走通
- CTA 是否正常
- 音频是否正常
- 结束态是否正常
- 方向和适配是否正常
- 前后台切换是否正常
- 平台后台或公开测试入口是否识别到预期结果
- 当前测试样本是否真的是最新包

每完成一次真实测试，都必须回写：

- `docs/project/playable-project-progress.md`
- `docs/project/playable-multi-platform-execution-plan.md`
- `docs/project/platform-manual-validation-checklist.md`
- 对应 `docs/platforms/*-playable-audit.md`

## 静态校验的角色

静态校验器用于补漏，不用于替代真实平台验证。

推荐顺序：

1. 先在真实平台里发现并修掉问题。
2. 确认根因。
3. 再把可静态识别的部分沉淀进离线规则或静态校验器。

优先沉淀的规则类型：

- 文件格式和根目录要求
- 包体和文件数
- 禁止项
- 必需 API
- 已被真实平台验证过的高风险模式

## 混淆最后做

只有当前面流程都稳定后，才接 hardening / obfuscation。

默认优先做：

- 压缩
- 安全后处理
- 顶层名字收缩
- 确定性 ZIP / HTML 重打包

默认不要过早做：

- 重型控制流混淆
- 全量属性名混淆
- 平台桥接名混淆

过早混淆只会提高调试成本、增加平台回归成本。
