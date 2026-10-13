# 报告结构

## 资源状态报告

`verify_resource_state.py` 输出：

- 中文 `userConclusion`，说明是否可以生成 AppLovin 包以及资源是否写回工程。
- 效果指纹、引用图、allowlist、Gate A、工具链和候选资源树哈希。
- final payload report、Gate B、apply/skip 结果、optimized ledger、保真、性能、provenance 和外部资源报告的文件哈希。
- `applicationMode=applied|candidate-only` 和构建实际消费的资源树。
- `RESOURCE_READY` 或 `BLOCKED`；前者只是平台构建的中间门禁。

## 最终载荷报告

`scan_candidate_payloads.py` 输出 artifact 绝对路径/bytes/SHA-256、完整 `payloads`、总/唯一 payload 数、内容 hash 重复组、额外 occurrence、编码/解码浪费、Base64 膨胀、资源分桶、Top assets、未知业务载荷、平台余量、豁免与 blocker。非豁免重复浪费达到阈值时结论为 `FAIL`。完整 `payloads` 供资源消费证明使用，不能用截断的 Top assets 替代。

## 资源覆盖确认与应用报告

Gate B JSON/Markdown 绑定 change records、逐项实际参数和收益、唯一单页 fidelity review、未优化/优化 exact candidate、payload report、未引用资源只读快照和回滚目录。单页必须内嵌单文件 Original/Candidate 播放器或图片对照，并同时提供完整包 before/after；逐 action 的独立链接只保留在审计数据。apply approval 显式记录 `candidate-only` 或批准的 `APPROVED_REPLACE` action IDs；apply/restore manifest 记录替换前后和恢复后的资源树 hash。

## 资源消费证明

`verify_resource_consumption.py` 输出 `resource-consumption-proof-v1`，逐 action 记录原/候选 SHA-256 是否出现在当前 final artifact 的完整 payload 集、证明方式和 builder entry。直接 payload hash 模式要求候选存在且原字节不存在；图片合集、二次编码或派生变换必须绑定 `playable-resource-builder-receipt-v1`。图片合集 receipt 的 `inputSha256s` 中任一原始散图仍出现在 exact artifact 都会生成 blocker。证明必须绑定当前 artifact、平台、payload report 和 `RESOURCE_READY`；失败时不能创建候选清单。

## 优化效率明细

含 Tinify 的资源阶段在 JSON 和内部审计中记录 `tinify.provider=tinify`、服务、实际请求数、成功 action IDs、逐图接受/淘汰 action IDs 和 `NOT_TESTED_QUOTA` action IDs；用户摘要只显示请求、成功、淘汰和额度未测试的数量，不显示 receipt、URL、Authorization 或任何凭据。

存在资源阶段时，内部审计中文报告必须单独输出完整“优化效率明细”，不能只写一个总百分比；用户摘要同时显示权威净收益结论和逐项已采用资源的精简明细：

- 先分开“源资源盘点”“未引用载荷排除”和“同链路 exact candidate 净减少”。未引用资源只从本轮候选排除、工程文件保持不变；这部分不能和最终包净减少重复相加。
- 列出每个实际采用 action 的原大小、候选大小、减少字节、减少比例、实际参数与保真结论，并汇总采用项自身压缩率。
- 用户摘要的逐项表只保留资源路径、原大小、候选大小、减少量、节省率和最终保真结论；实际 argv、工具哈希与完整参数只进入内部审计和 JSON。
- 列出试做但因保真、收益或参数门禁回退的 action，以及主动放弃的潜在收益。报告必须说明回退后平台包继续使用原字节，不能让用户误以为资源被删除。
- 同时展示计划预计收益、保真后实际收益、计划兑现率、试做命中率、最终重复浪费和 exact candidate 的绝对/相对净减少。
- 可以依据 Base64/ZIP 等明确封装规则给出标明“估算”的贡献拆分；权威结论始终是同代码、Adapter、变体和构建入口的 before/after artifact 实测。
- 没有逐平台未优化对照包时，不得用 HTML 与 ZIP 的不同封装大小推算平台级优化百分比。没有可靠区分自动处理、用户 Gate 等待和人工复测耗时时，不报告人时效率。

## 静态与运行时报告

静态、运行时和最终载荷报告同时绑定当前 artifact SHA-256 与同一个非空 `checkBatchId`。运行开始先把输出原子更新为当前文件的 `CHECKING` 记录，成功或失败都覆盖为本批次结果；候选清单只接受三份报告批次一致的 v4 结果。静态报告包含平台、`deliveryContext.targetOs`、artifact、ruleset、逐项 checks、summary 和 `PASS|REVIEW|FAIL`。运行时报告额外包含浏览器、平台 mock、JavaScript/console、音频、CTA、MRAID/lifecycle、页面渲染，以及启动、Long Task、帧间隔/FPS 和可选内存证据。`probe.dynamicImages` 记录 `src` property/setAttribute 探针是否安装、最终候选的 `configuredAssets`、全部原始赋值的截断值与原长度、scheme、入口、class/alt、时间和丢弃计数；`render.images` 记录最终 `srcAttribute/currentSrc/complete/naturalWidth/naturalHeight`。Google/Meta 中与 `configuredAssets` 匹配的非 `data|blob` 赋值、探针未完整安装或证据被截断时为 blocker；其他普通图片赋值保留为诊断证据。

运行时报告还必须包含 `ctaCapture`：业务脚本前 hook 状态、浏览器输入方式、`isTrusted`、目标节点与坐标、点击时玩法阶段、期望 bridge、实际调用和结论。由页面脚本 `HTMLElement.click()`、探针直接调用 bridge 或不可信合成事件产生的记录只能用于诊断，不能使 CTA 检查通过。Mintegral 额外输出 `lifecycleCapture`，证明 `install` 与完整 `gameReady → gameStart → gameEnd`；字段语义见 [Checker 验收契约](checker-acceptance-contract.md)。

运行时 `performanceAssessment` 分开记录 `dataCollected` 与 `thresholdsConfigured/thresholdStatus`。没有 Adapter 已批准阈值时，结论固定为“性能数据已采样，尚未判定是否合格，需代表设备确认”；配置阈值后，缺数据或超限为 blocker，全部满足才可写“性能检查通过”。

## 候选清单

`record_candidate.py` v4 输出：

- mode、status、platform 和 `deliveryContext.targetOs`。
- artifact、adapter、实际消费资源树、application mode 和 ruleset 哈希。
- 静态、运行时和 final payload report 哈希。
- `resource-consumption-proof-v1` 哈希；只登记构建参数或资源树不能代替。
- 同一检查批次 ID、交付组合 `deliveryKey` 和性能采样/阈值判定。
- 效率编排的 final-recheck 额外绑定有效 `sourceFreeze` 路径、SHA-256 和输入指纹；候选 artifact 是本轮稳定快照，不是会被下一次构建覆盖的临时输出。
- AppLovin 基线、`RESOURCE_READY` 资源状态、Android 单端缺少 iOS App Store 地址的唯一例外和剩余人工门禁。

静态 blocker 和 final payload blocker 不允许接受。warning 必须修复并重建；只有 `COMMON-STA-004=Android 单端投放缺少 iOS App Store 地址，且 Google Play 地址有效并有用户确认` 可进入 ready 状态，其他 warning 即使提供理由也必须阻断。

## Checker 验收报告

`checker-acceptance.json` / `.md` 使用 [Checker 验收契约](checker-acceptance-contract.md)，逐平台绑定 exact final artifact、页签可用性、静态与运行时计数、CTA/生命周期捕获、页面证据和中文结论。Checker 证据是可选外部补充证据，不并入 ruleset，也不能写回候选清单冒充本地报告。

页签存在时，失败必须为 0，且除封闭规则 `COMMON-STA-004` 自动验签的 Android 单端商店链接 notice 外 warning 必须为 0；该 notice 保留在原始计数和 `acceptedNotices`，不能篡改成 0 warning，也不能由自由文本创建。页签缺失继续如实记录 `UNAVAILABLE/EXTERNAL_CHECKER_BLOCK`，observation-v2、artifact/attempt/截图、R2/R5 的真实性门禁不放宽。

交付报告新增 `externalValidations.checker`：

- `NOT_RUN`：未执行 Checker；不阻止本地 ready，用户摘要必须写“本地 ruleset 检查通过，Checker 尚未验证”。
- `PENDING`：观察中、acceptance 无效或需要重录；不使本地 final-recheck 失效。
- `PASS`：可信 Checker acceptance 通过，作为补充证据；仍不替代真实平台人工验收。
- `UNAVAILABLE`：不可达、缺页签或外部页面故障；不阻止本地 ready，提醒后续补测或转入对应真实平台验证。
- `ISSUES_FOUND`：可信 observation/acceptance 已证明当前 artifact 的 warning/failure、CTA、生命周期或结构缺陷；受影响平台必须返工并阻止 ready。

报告状态还必须与统一运行清单已经记录的 Checker 事实一致：来源为 `CHECKER_ACCEPTANCE_RECORDED / CHECKER_OBSERVATION_RETRY / CHECKER_BLOCKED_EXTERNAL` 时只能分别记录 `PASS / PENDING / UNAVAILABLE`。省略 Checker 参数生成的 `NOT_RUN` 报告不能用于覆盖这些状态；`CHECKER_IN_PROGRESS` 必须先机器分类，不能直接收口。

## 汇总报告

报告器固定输出三层：

- `--md-out`：面向普通用户的交付摘要，回答结论、实际资源总收益、逐项已采用资源的前后大小/节省量/保真结论、未引用资源保持状态、工程应用方式、平台包入口、必要风险和下一步。
- `--audit-md-out`：内部审计 Markdown，保留候选路径/bytes/SHA-256、交付矩阵、逐项本地与 Checker 状态、性能、人工门禁、回退动作和时间账本。
- `--json-out`：完整机器事实来源；不因用户摘要降噪而删除审计字段。

用户摘要不得出现实际工具 argv、工具哈希、“流程耗时”“交付矩阵”“人工门禁”“Skill 本地检查”“无页签平台”、SHA-256 长表或没有实际动作的空回退表。Checker 未执行、待重录或不可用时只保留准确的本地/Checker 边界和外部验证待办，不展示队列、attempt、截图与页签明细。候选/覆盖/回滚目录只在实际存在时展示。

用户摘要必须包含结构化资源来源：未跨运行复用时写“本轮在当前流程完成资源阶段”；跨运行复用时写“本轮复用 `<run-id>` 的历史资源候选，没有重新执行资源优化”，并展示历史实际收益、`candidate-only|applied`、工程是否覆盖、Gate A、Gate B 和单页 A/B 三个入口。跨运行复用调用报告器时必须传 `--resource-reuse-approval`；批准与 AppLovin 基线绑定的 resource state 不一致时报告阻断。JSON 和内部审计 Markdown 同时绑定批准文件、历史 run ID、资源摘要和报告引用。

内部审计报告按 `deliveryKey` 输出交付矩阵，每个平台同时展示目标端、application mode、本地状态、可选 Checker 状态、绝对路径、哈希、规则版本、资源状态、warning、性能和人工门禁。允许同一报告包含多个 AppLovin 基线；其他平台通过 `baselineManifest.sha256` 关联输入中的实际基线。缺少被引用基线、规则版本不一致或同一交付组合/平台重复时判阻塞，并在 `errors` 写明具体清单、组合和原因。

汇总状态按以下顺序判定：

- 本地候选清单无效：`BLOCKED`。
- 本地候选有效，Checker 为 `NOT_RUN|PENDING|PASS|UNAVAILABLE`：`READY_FOR_MANUAL_PLATFORM_ACCEPTANCE`；报告分别写尚未验证、待重录、补充证据已通过或外部不可用。
- Checker 可信证明 artifact/生成链存在 warning、failure、CTA 或生命周期真实缺陷：`CHECKER_REWORK_REQUIRED`，同时记录 `externalValidations.checker.status=ISSUES_FOUND`；下一步必须写明修真实生成链、重建和重新 final-recheck。
- 仅有 Checker 页面观察、R2/R5、attempt 或截图证据不完整/不匹配：保持 artifact SHA 不变并记录 `PENDING`，不阻止本地 ready。
- Checker 不可达、缺目标页签或页面工具故障：记录 `UNAVAILABLE`，保留本地结果并提醒补测，不阻止本地 ready。

`READY_FOR_MANUAL_PLATFORM_ACCEPTANCE` 只表示可以把候选交给真实平台和人工验收，不能写成官方 Preview、广告后台或最终上线验收通过。Markdown 不展示内部英文状态码，只展示对应中文结论。

## 流程耗时

提供 `--execution-timeline <run-dir>/execution-timeline.json` 时，最终 JSON 绑定时间账本的绝对路径、bytes、SHA-256 和汇总；内部审计 Markdown 的“流程耗时”章节展示：

- 墙钟事件区间。
- 自动处理与 Checker/返工组成的实际处理关键路径。
- 用户 Gate 等待。
- Checker 浏览器界面等待与操作。
- 故障返工。
- 45 分钟正常目标和 60 分钟观察线的实际偏差。

并行事件按区间并集统计，不能把各平台耗时相加。用户等待不计入实际处理；Checker 界面和返工既单独展示，也计入实际处理关键路径。时间汇总必须包含 `complete` 和 `missingEventTypes`；缺少任何自动处理事件或仍有运行事件时固定为 `complete=false`、`targetAssessment=INSUFFICIENT_EVIDENCE`，内部报告写“不能判定”，不得显示“0 秒，正常目标内”。时间账本缺失时旧报告仍可生成，但必须明确无法区分这些耗时；账本结构无效时报告阻断。用户摘要默认不展示任何流程耗时。

## Skill 用户体验复验

当任务明确要求从普通用户视角复验 Skill 或流程体验时，必须额外生成 `skill-user-experience-evaluation.md`，并在最终报告第一屏提供入口。文件固定包含以下五个二级章节：

1. `结论`：明确“通过/未通过完整用户体验复验”，列出决定性依据。
2. `已通过的体验`：记录普通用户无需内部知识即可完成的步骤和必要门禁。
3. `可读性与误导问题`：记录难懂文案、状态歧义、证据冲突和可能误判为可交付的提示。
4. `无必要暂停`：区分 Gate A/Gate B 等授权停顿与无反馈、无进展的等待。
5. `Skill 缺陷`：每项说明影响、证据、期望行为和当前修复状态；浏览器运行环境、Checker 或真实平台自身问题不计为 Skill 缺陷，但实际未完成仍写入结论。

五个章节都必须出现；没有问题时写“未发现”，不能省略。该报告是流程体验评价，不得修改或覆盖平台技术证据。

新观察输入使用 `skill-user-experience-observations-v2`。`skillDefects[]` 必须声明 `ownership=skill` 和 `resolutionStatus=OPEN|FIXED`；`externalIssues[]` 必须声明 `ownership=checker|environment|platform` 和 `status=OPEN|RESOLVED`。报告器把外部问题追加到“可读性与误导问题”，固定标注“不属于 Skill 缺陷”，并在 JSON 引用中输出 Skill 缺陷总数、未修复数和外部问题数。v1 输入仅为已有运行兼容，不用于新复验。
