# 统一运行清单与失效规则

## 状态

```text
DISCOVERED
→ EFFECT_BASELINE_FROZEN
→ RESOURCE_GRAPH_READY
→ RESOURCE_TRIAL_PROPOSED
→ RESOURCE_TRIAL_APPROVED
→ TOOLCHAIN_VERIFIED
→ RESOURCE_CANDIDATE_READY
→ RESOURCE_APPLY_PROPOSED
→ RESOURCE_APPLY_APPROVED → RESOURCE_APPLIED → RESOURCE_READY
                         ↘ RESOURCE_APPLY_SKIPPED → RESOURCE_READY
→ APPLOVIN_CANDIDATE_BUILT
→ BASELINE_READY
→ PLATFORM_CANDIDATE_BUILT
→ PLATFORM_READY
├─ READY_FOR_MANUAL_PLATFORM_ACCEPTANCE
└─ 可选 CHECKER_IN_PROGRESS
   ├─ CHECKER_ACCEPTANCE_RECORDED → READY_FOR_MANUAL_PLATFORM_ACCEPTANCE
   ├─ CHECKER_REWORK_REQUIRED → 修复、重建、本地复检后重新验签
   ├─ CHECKER_OBSERVATION_RETRY → READY_FOR_MANUAL_PLATFORM_ACCEPTANCE 或新 attempt 补录
   └─ CHECKER_BLOCKED_EXTERNAL → READY_FOR_MANUAL_PLATFORM_ACCEPTANCE 或待外部恢复后补测

RESOURCE_GRAPH_READY
→ RESOURCE_REUSE_PROPOSED
→ RESOURCE_REUSE_CONFIRMED
→ RESOURCE_READY
```

状态码只用于恢复和技术排查；用户只看到中文结论。`RESOURCE_READY` 必须带 `applicationMode=applied|candidate-only` 和 `resourceResultType=optimized|package-only|unchanged-explicitly-approved`。`optimized` 必须绑定真实资源动作和最终净收益；`package-only` 只绑定无损载荷动作和最终净收益；`unchanged-explicitly-approved` 必须绑定用户明确批准且 before/after 字节不变。三类结果不得互换文案。`PLATFORM_READY` 的用户文案使用“已绑定的目标平台候选包”，不得用单数“该平台”描述多平台目录证据。状态机中不存在 DELETE、删除批准或项目级清理状态。

`RESOURCE_REUSE_PROPOSED → RESOURCE_REUSE_CONFIRMED → RESOURCE_READY` 是跨运行复用的唯一替代路径，不插入同一连续运行刚完成的 Gate B 路径。`RESOURCE_REUSE_PROPOSED` 必须绑定历史 resource state 和已展示的复用确认单 JSON/Markdown；`RESOURCE_REUSE_CONFIRMED` 必须绑定本轮 `reuse-existing` 批准。选择 `reanalyze` 或 `use-original` 时不得进入 `RESOURCE_REUSE_CONFIRMED`，而是进入正常 Gate A。

新运行的 Gate A 还必须绑定 `playable-resource-usage-evidence-v1` 且声明 `evidenceMode=per-resource-v2`：图片逐图真实显示尺寸与带依据的 `riskFeatures`、音频 BGM/SFX/语音分类、三维物体 runtime 格式、每个字体独立 `fontUsage`、配置动态读取闭包缺一不可。机会审计与计划同时绑定逐项结论和分桶摘要；Gate A preflight 必须重新计算并验证两者一致。旧运行或未声明新模式的用途证据按 `legacy-read-only` 读取，不补写、不把旧 `KEEP`、旧顶层 `textCoverage` 或旧 Gate A/Gate B 伪装成新审计通过。

## 证据与稳定目录

每个状态用绝对路径、bytes 和 SHA-256 绑定最低证据，并带唯一 `attemptId`。新运行清单固定位于 `<product-root>/playable-runs/<run-id>/run-manifest.json`；Adapter 的 `runRootBase/runRoot` 必须解析到同一位置。继续执行前先 `verify`。`advance --evidence` 的格式为 `name=/absolute/path`，且写入前必须验证全部有效历史；历史漂移时拒绝推进。历史运行保持原路径只读兼容，不自动搬迁。

新运行初始化时在同一稳定目录创建 `execution-timeline.json`，并在运行清单记录其绝对路径。时间账本只记录本轮事件，不导入旧运行时间；并发写入使用文件锁和原子落盘，汇总按区间并集计算。旧运行缺少时间账本时仍可继续原串行契约，但最终报告必须明确“未绑定结构化时间账本”，不得估算自动处理或用户等待。

证据漂移后使用 `invalidate --from-state <state> --reason <中文原因>`。命令追加失效记录，写明失效起点、发现时间、原因、被替代的历史索引和可选替代证据，不删除或改写旧 history。随后只允许用 `rebind --state <同一 state>` 从最后有效阶段创建新 attempt；重新绑定成功前不能继续 `advance`。`verify` 必须输出中文失效步骤和下一条可执行动作。

Gate A 绑定机会审计、计划、显式资源动作、工具能力和参数范围。Tinify 计划使用 `networkPolicy=TINIFY_ALLOWLIST_ONLY`，但 Tinify 服务不进入本地离线工具锁；计划必须绑定服务、上传 allowlist、总 bytes、预计请求数和高风险 action IDs。机会审计缺失、与账本/工具锁漂移、存在未处置 `OPTIMIZE|UNSUPPORTED` 时不能进入批准。Gate B 绑定 `resourceResultType`、单页 fidelity review、final candidate、payload report、候选资源树、目标文件当前 hash、用户原话与精确 action IDs；含 Tinify 时还必须绑定顺序批次报告和 `playable-tinify-candidate-decisions-v1`，淘汰项不得进入 action。资源替换动作不得使用相同 hash、空参数或非正收益；package-only 不得伪造资源替换动作；未优化继续必须绑定明确用户批准。覆盖后绑定 apply manifest、正式资源树 hash 和完整重建结果；candidate-only 绑定实际消费的 candidate tree。平台候选清单额外绑定 `resource-consumption-proof-v1`；只传资源根/allowlist 不足以推进。

历史资源复用门禁绑定当前玩法/变体/目标端、当前效果指纹、引用图、allowlist、历史计划、当前工具链、候选树、历史 run manifest、历史 resource state、Gate A 报告、Gate B 报告和 fidelity review。报告缺失或任一身份漂移时 fail-closed。复用批准必须绑定确认单 hash 和用户本轮原话；旧 Gate A/Gate B 批准不能替代。

`CHECKER_IN_PROGRESS` 只用于用户主动执行 Checker 的可选分支，必须绑定验签通过的 Checker 队列，或绑定 `UNREACHABLE` preflight 进入无队列分支。它必须先通过 `record-checker-outcome` 机器分类，不能直接进入 ready。默认主路径允许 `PLATFORM_READY` 直接生成验签报告并进入 ready；不得手工跳过本地候选清单、payload、静态、运行时、可信 CTA/生命周期、资源消费或 final-recheck 门禁。

`record-checker-outcome` 是 Checker 结论状态的唯一写入口。它验证 acceptance JSON/Markdown 一致后，按 `ARTIFACT_REWORK > OBSERVATION_RETRY > EXTERNAL_CHECKER_BLOCK > PASS` 自动写入：

- `CHECKER_ACCEPTANCE_RECORDED`：仅总体 `PASS`；最低证据为 acceptance JSON/Markdown。
- `CHECKER_REWORK_REQUIRED`：绑定 affected platform、旧 artifact、attempt、observation 和截图 hash；运行清单立即阻止受影响 artifact 的交付资格。恢复时必须修复真实生成链、完整重建并重新 final-recheck；如继续 Checker，以不同 SHA `supersede` 旧 artifact 并保留其他平台结果。
- `CHECKER_OBSERVATION_RETRY`：绑定旧 attempt 与无效原因；不反向使本地 final-recheck 失效。继续补录时 artifact SHA 必须相同，current attempt 必须不同；也可在交付报告记录 `PENDING` 后进入本地 ready。
- `CHECKER_BLOCKED_EXTERNAL`：Checker 不可达、缺目标页签或页面工具故障；不反向使本地 final-recheck 失效，可在交付报告记录 `UNAVAILABLE` 后进入本地 ready。

三个非通过状态都保留下一动作；只有 `CHECKER_REWORK_REQUIRED` 设置 `continuationRequired=true / blocksLocalReady=true`。观察重录和外部不可用只形成可选补测提醒，不得宣称 Checker 通过。

`READY_FOR_MANUAL_PLATFORM_ACCEPTANCE` 最低证据为 `deliveryReportJson`、面向用户的 `deliveryReportMarkdown` 和内部 `deliveryAuditMarkdown`。报告必须重新验签全部候选清单路径与 SHA-256、确认 `localValidationPassed=true`，并包含 `externalValidations.checker.status=NOT_RUN|PENDING|PASS|UNAVAILABLE`；`ISSUES_FOUND` 禁止 ready。Checker acceptance 可选；如存在则必须与当前 candidate manifests 和 exact artifacts 一致。若来源状态为 `CHECKER_ACCEPTANCE_RECORDED / CHECKER_OBSERVATION_RETRY / CHECKER_BLOCKED_EXTERNAL`，报告状态必须分别保持 `PASS / PENDING / UNAVAILABLE`，不能遗漏既有 Checker 输入并降级为 `NOT_RUN`。用户摘要在未执行 Checker 时只能写“本地 ruleset 检查通过，Checker 尚未验证”。任务明确要求普通用户体验复验时仍强制绑定五段式 `skillUserExperienceEvaluation`。

## Gate 等待与冻结辅助证据

- `wait-start --gate gate-a|gate-b|resource-reuse` 只能在对应提案状态后执行，记录 `waitingFor`、`manualGates` 和 `user-wait` 时间事件；重复等待会阻断。
- `wait-finish` 必须绑定非空用户原话，只结束等待。对应批准脚本仍需独立验签，不允许把结束等待当成自动批准。
- `source-freeze.json` 不是新的业务状态，而是 plain 全部通过到 final/hardening 之间的冻结屏障。它绑定同一 AppLovin 基线、全部目标平台 plain 清单、实际 artifact、Adapter、ruleset、资源和源码输入。
- `failure-scope` 只计算必须失效与重建的范围，不能修改历史状态。真正恢复仍通过 `invalidate` 与 `rebind` 保留旧 attempt。

## 失效

- 效果、资源输入、引用、allowlist 或 Gate A 参数变化：资源候选及全部下游失效。
- 历史复用确认单、批准、当前上下文或三个历史报告变化：`RESOURCE_REUSE_PROPOSED` 及全部下游失效；资源树、效果、引用、allowlist、计划或工具链漂移时禁止复用并回到正常资源分析。
- 候选文件、final comparison、payload report 或 Gate B 目标 hash 变化：Gate B 及下游失效。
- 工具路径、版本、二进制哈希或参数变化：trial approval、工具验证和全部下游失效。
- 覆盖后正式资源树变化：`RESOURCE_APPLIED` 和下游失效；先判断是批准后的正常开发还是漂移。
- 共享 runtime 变化：按影响复核效果与资源，AppLovin 和受影响平台失效。
- 单平台 adapter 变化只使该平台失效；AppLovin adapter 变化使基线和依赖平台待回归。
- hardening、重内联或重打包：发生字节变化的 artifact 报告失效。AppLovin/平台阶段优先绑定已冻结候选清单，不绑定下一次构建会覆盖的临时路径。
- 任一 final artifact 字节变化：对应本地 final-recheck、Checker 平台记录和交付报告失效；旧 Checker attempt 保留。如继续 Checker，受影响平台用新 SHA `supersede`。
- 资源优化生成新的 exact artifact SHA-256：旧 Checker observation、截图、attempt 和 acceptance 只读保留且不得复用；重跑使用 enqueue/supersede，只有 artifact SHA 不变的观察重录才新建 attempt。`NOT_RUN|PENDING|UNAVAILABLE` 不阻塞本地 ready，可信 `ISSUES_FOUND` 进入 `CHECKER_REWORK_REQUIRED`。
- Checker 验收记录、证据截图或逐平台结论变化：对应 `externalValidations.checker` 与交付报告失效，不反向使资源/平台本地清单失效；但可信 `ISSUES_FOUND` 会使受影响 artifact 的交付资格失效。
- ruleset 变化：资源候选不失效，平台 artifact 按 `artifactHash + rulesetHash + platform + targetContext` 复检。

旧 `CANDIDATE_READY`、`RESOURCE_PLAN_APPROVED`、v1.4 `RESOURCE_READY`、`AVAILABLE_TABS_PASS` 和 `READY_FOR_MANUAL_ACCEPTANCE` 只可作为 legacy/本地证据，不得直接升级为当前最终通过状态。
