# 资源准备工作流

## 定位

资源阶段位于首次或重新创建 AppLovin 基线之前。它把效果已确认的 playable 转换为平台构建可安全消费的最小候选资源集，并决定候选是否写回 playable 工作资源；它不删除项目资源。

## 顺序

1. 固定玩法、视觉、动画、交互、CTA、音频和人工效果基线。
2. 识别当前素材 × 关卡 × 变体 × 平台入口，建立 source ledger、引用图、allowlist 和排除清单。
3. 将资源分为 `REQUIRED`、`CONDITIONAL`、`UNREFERENCED`、`UNKNOWN`。`UNKNOWN` 阻断；`UNREFERENCED` 只从当前候选排除。
4. 验证 v2 Adapter 的 `immutableSourceRoots`、`playableWorkingRoots`、`candidateRoots`、`overwriteEligibleRoots`、`runRootBase`、`runRoot` 和 `rollbackRoot`；新运行三类候选目录统一解析到 `<product-root>/playable-runs`，不得藏在 playable 或 `_交付` 下。
5. 判断本轮是否准备消费其他 run 的 `RESOURCE_READY` 或候选树。同一连续流程刚完成 Gate B 时继续正常流程；跨 run 复用必须先验签当前效果/引用/allowlist/计划/工具链和候选树，生成并展示包含历史 Gate A、Gate B、单页 A/B 与实际收益的复用确认单。
6. 复用确认单展示后只允许三种路由：`reuse-existing` 生成 `RESOURCE_REUSE_CONFIRMED`；`reanalyze` 进入新的机会审计；`use-original` 进入 `unchanged-explicitly-approved` 正常 Gate A。旧批准或沉默不能授权复用。
7. 不复用或选择重新分析时，只读发现并锁定 Skill 支持的本地离线工具，再运行 `analyze_resource_opportunities.py --usage-evidence <current-usage.json>` 对账本全部资源生成逐项机会审计。新用途证据声明 `evidenceMode=per-resource-v2` 并绑定当前玩法、关卡、主题、变体、目标端和平台；图片逐图声明显示尺寸与有具体依据的 `riskFeatures`，字体逐个声明独立 `fontUsage`。审计基于实际媒体元数据输出 `OPTIMIZE|KEEP|UNSUPPORTED`、命中规则、建议动作和工具；图片尺寸/格式/质量独立审计，字体证据缺项只使当前字体 `UNSUPPORTED`。旧证据按 `legacy-read-only` 恢复，不能升级为新审计通过。
8. 先按资源桶复核三种结论、bytes、`KEEP` 原因、审计完整性、图片保护集合异常和被抑制尺寸机会；一个桶的机会不能掩盖另一个桶的缺项。再为每项已引用资源声明与机会审计一致的显式动作，`KEEP` 同时绑定实际媒体数据、逐资源用途、原因与证据。动作缺失、忽略已发现机会、审计漂移或所需能力缺失时停止并提醒，不能进入 Gate A。Gate A 第一屏同步展示分桶结论、高风险图片和逐字体状态。
9. Gate A 通过后只在稳定 `candidateRoots` 试做；普通视觉图片按 allowlist 顺序调用 Tinify `POST /shrink`，记录脱敏 receipt、实际请求数和输入/输出 bytes/SHA-256；Tinify 不进入本地工具锁，也不改变本地 `networkPolicy=DENY` 工具链。每个有损候选只改变一个试做变量。图片合集同时生成位置表、padding、边缘扩展和 receipt 并逐张反裁；配置只按显式 JSON Pointer 闭包生成；字体绑定完整字符覆盖证明。
10. 自动保真后生成唯一 `fidelity-review/index.html`。单文件 Original/Candidate 播放器或图片对照以及完整包 before/after 都在当前页面完成，不默认打开新页面。Tinify 成功项另生成哈希绑定的 `playable-tinify-candidate-decisions-v1`，逐图记录接受、淘汰或暂停；没有逐图结论、A/B 视图、像素敏感语义报告或统一页面时不得进入 Gate B。
11. 用同一代码、adapter、allowlist、素材、变体和平台上下文生成未优化/优化 exact candidate 对照。
12. 扫描最终 HTML/ZIP 的完整内容 hash、分桶、Base64 膨胀和重复载荷；非豁免重复浪费达到 4 KiB、原/候选共存、图片合集与任一原始散图共存时阻断。
13. 拒绝相同字节、非正资源收益、空参数或最终 artifact 非正净收益的候选；生成 Gate B《资源覆盖确认单》并等待用户选择 `candidate-only` 或精确覆盖。Tinify Gate B 必须同时绑定 Gate A、顺序批次、逐图决策、自动保真、单页 A/B 和 change records；只消费 `ELIGIBLE_FOR_GATE_B` 项，淘汰项保持原字节。package-only 不伪造资源替换动作，未优化继续必须绑定明确用户批准。
14. `candidate-only` 保持正式工程 0 字节变化；覆盖模式先备份、验 hash、原子替换，失败整批回滚。图片合集只有 Adapter 提供全部映射和精确写回动作时才允许覆盖，否则保持 candidate-only。
15. 覆盖后必须从正式工程完整重建；两种模式都用 `verify_resource_state.py` 验证并记录 `applicationMode` 与 `resourceResultType`。
16. 每个平台创建候选清单前使用 `verify_resource_consumption.py` 证明 final artifact 包含候选 SHA、没有对应原 SHA；派生变换必须绑定 builder receipt，图片合集 receipt 必须列出全部输入 SHA。构建参数和资源树登记本身不是消费证明。
17. 每完成一个候选，重新构建 exact artifact、更新账本，并按净减少量、证据可信度、效果风险、平台兼容成本和验证成本重新排序；无损排除/去重固定先做，有损类型不固定先后。
18. 新 exact artifact SHA 使旧 Checker observation/acceptance 失效并只读保留；用户重跑时继续使用 enqueue/supersede。`NOT_RUN|PENDING|UNAVAILABLE` 不阻塞本地 ready，可信 `ISSUES_FOUND` 强制返工。

## 不可配置红线

- Unity/raw/高质量来源始终只读。
- Skill 永远不得物理删除 playable 工程中的未引用图片、图片合集、三维物体资源、音频、字体、配置或其他静态资源。
- 不实现 DELETE schema、delete approval、自动清理模式或“确认后删除”。
- 无论任何模式或确认文本，`UNREFERENCED` 文件的路径、目录结构、bytes 与 SHA-256 都必须不变。
- 最终 artifact 只能由真实生成链路生成，不得人工编辑。

## 产物

稳定运行目录至少保留：效果基线、source/optimized ledger、引用图、allowlist、机会审计、Gate A JSON/Markdown/技术账本、trial approval、工具链锁/验证、candidate working tree、change records、单页 fidelity review、保真与性能报告、未优化/优化 exact candidates、final payload report、Gate B JSON/Markdown、apply approval、apply/rollback manifest、资源状态验证、逐平台资源消费证明和平台报告。跨运行复用时还必须保留 resource reuse context、confirmation JSON/Markdown 和本轮 approval。

## 用户表达

- Gate A：资源优化提案已生成。确认后只会在候选目录试做，不会覆盖工程；本次不打包的资源继续保留在项目中。
- 候选完成：候选资源和实际包体对照已完成，请决定“仅用于本轮平台包”或“覆盖确认单列出的资源”。
- candidate-only：分别说明已完成真实资源优化、仅完成 package-only 无损处理，或用户明确选择未优化继续；正式工程资源未被覆盖。
- applied：确认单列出的资源已备份并覆盖，正式工程已完整重建；未引用资源保持不变。
- history reuse：本轮没有重新执行资源优化；准备复用 `<run-id>` 的历史候选。请先查看此前 Gate A、Gate B 和单页 A/B，以及历史实际收益，再明确选择。
