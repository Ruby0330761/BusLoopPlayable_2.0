# 两次资源确认契约

## Gate A：《资源优化提案》

Gate A 只授权在 `candidateRoots` 试做，不授权覆盖工程。普通视觉图片的默认有损动作是 Tinify `POST /shrink`；Tinify 服务、上传 allowlist、总 bytes、预计请求数、高风险图片和外部上传授权必须在同一 Gate A 中确认。用户文档必须用普通中文展示：

- 本次素材、关卡、变体、平台和投放端。
- 优化前资源分桶 bytes、Top 大资源和当前候选排除的未引用载荷。
- 每个资源桶用中文展示“可试做/保持原文件/暂时无法优化”、保持原文件的中文原因分布、审计完整性和 bytes；`OPTIMIZE/KEEP/UNSUPPORTED` 与 `RESOURCE-OPP-*` 只进入机器 JSON 和技术账本，不得出现在普通用户提案中。其他桶的优化机会不能替代当前桶的完整审计。
- 高风险但允许试做的图片数量、变换约束与 A/B 要求；保护集合异常和“存在尺寸余量却被保持”的数量必须第一屏可见，后者正常值为 0。
- 每个字体的角色、语言、字符数、动态来源是否闭合、fallback、结论、工具和验证方法；证据不足与已确认保持必须明确区分。
- 每项拟尝试资源的完整项目相对路径。
- 工具、允许参数范围、预计收益、风险、验证方法和不改变的体验。
- 第一屏固定回答“改什么、预计节省、风险、是否覆盖、失败怎么处理”；每个资源组显示预计节省 bytes/% 和实际允许参数，不能只在技术 JSON 中保存。
- 是否使用外部服务、是否引入新素材；默认均为否。
- 明确结论：“当前不会覆盖工程资源；本次不打包的资源仍完整保留在项目中。”

动作只允许 `KEEP`、`EXCLUDE`、`DEDUP`、`TINIFY_SHRINK`、`RESIZE`、`REENCODE`、`SIMPLIFY`、`REPACK_ATLAS`、`SUBSET_FONT`、`PRUNE_CONFIG`。`TINIFY_SHRINK` 只能是 `operation=shrink`，不得带 resize、convert、metadata、quality 或其他独立动作参数；本地图片动作是独立备用候选，必须重新 Gate A。普通用户界面分别使用“图片合集”“三维物体资源”“字体精简”和“配置引用闭包”等中文名称。`EXCLUDE` 只表示从当前候选载荷排除，不是删除。音频 `REENCODE` 必须声明 `audioClass=BGM|SFX|VOICE` 和允许参数范围，不允许全部 MP3 静默套同一参数。

Gate A 计划前必须由 `resource-opportunity-audit-v1` 主动审计账本全部资源。`per-resource-v2` 计划必须携带分桶摘要，并在 preflight 与批准记录时从逐项结论重新计算，复核机器摘要和用户摘要一致；任何资源桶审计不完整、图片三轴结论缺失、保护证据异常、尺寸机会被 `KEEP` 抑制或字体证据未隔离时阻断。每项已引用资源必须显式声明与审计一致的动作。`KEEP` 必须同时绑定审计 rule/metadata、当前资源实际媒体数据、逐资源用途、`keepReason` 和非空 `keepEvidence`；调用者未声明动作时计划器只能生成 `RESOURCE_ACTION_UNDECLARED` blocker，不能自动补成可批准的 `KEEP`。审计为 `OPTIMIZE` 却提交 `KEEP`、审计为 `UNSUPPORTED`、审计与账本/工具锁漂移或有损动作缺少本地锁定工具能力时均阻断。`optimizeCount=0` 不是证据，只有当前资源桶全部逐项机会计算完成且确实没有可执行机会时才合法。

用户文档不展示内部状态码、计划哈希、工具绝对路径、许可证长表或机器账本；这些进入 JSON 和独立技术报告。计划、输入、引用图、工具或参数范围变化后，旧确认立即失效。

## Gate B：《资源覆盖确认单》

只有自动保真通过、唯一单页 A/B 入口可用、优化前后 exact candidate 使用同一构建链完成对照、性能 smoke 已记录、最终载荷 blocker 清零后才能生成 Gate B。单页必须让音频 Original/Candidate 同屏独立播放、图片同屏或切换查看，并在同页提供完整包 before/after 预览或明确降级下载；不得要求用户为每个 action 打开新页面。人工 A/B 结论在文档中可以是“待用户确认”，不能提前伪造通过。用户文档必须展示：

- 文件完整相对路径和精确项目目标路径。
- 原 bytes、候选 bytes、节省 bytes/%、实际参数。
- 自动/人工保真结论和 A/B 入口。
- 覆盖前/候选 SHA-256、action ID、回滚位置。
- 优化前后 exact candidate bytes、SHA-256 和实际净减少量。
- 当前平台、性能和人工门禁。
- 未引用资源单列为“本次不打包、项目中继续保留”。

用户只能选择：

1. 候选用于本轮平台包，但不写回工程。
2. 只覆盖确认单中已通过保真的精确文件。

Tinify 逐图验收必须使用 `record_tinify_candidate_decisions.py` 生成 `playable-tinify-candidate-decisions-v1`。每个成功 receipt 必须有一个 `ELIGIBLE_FOR_GATE_B`、`CANDIDATE_REJECTED` 或 `CANDIDATE_PAUSED` 结论，并绑定 source/candidate SHA、自动保真报告和同一 A/B 页面；Gate B 只消费 `ELIGIBLE_FOR_GATE_B`。`NOT_TESTED_QUOTA` 不是失败伪装：必须另外记录 `REMAINING_KEEP_ORIGINAL`，或绑定只覆盖剩余项且要求重新 Gate A 的本地备用提案。

Gate B 不存在删除选项。`record_resource_apply_approval.py` 必须由调用者显式传入 application mode 和 action IDs，不从自然语言推导写入范围。沉默不代表同意；Gate A 原话也不能作为 Gate B 授权。

资源替换动作必须绑定 Gate A 的有损 action ID，并具有非空实际参数、不同的输入/候选 SHA-256、正向资源字节收益和正向最终 artifact 净收益。任一条件不满足即阻断；禁止用 byte-identical anchor 满足动作非空约束。

只有未引用排除或最终内容去重时使用 `resourceResultType=package-only`，允许 Gate B 的资源替换动作为空，但 before/after exact candidate 必须证明正向净收益。全部资源显式 `KEEP` 时只能使用 `unchanged-explicitly-approved`，并绑定 Gate A 用户原话；该分支不得声称资源已经优化，也不得覆盖工程资源。

用户在一次 Gate B 回复中同时给出 `fidelity-decision=accepted|rejected` 和应用选择。接受时必须同时选择 `candidate-only|applied`；拒绝时不能批准候选使用或覆盖，并回到最近通过候选。`RESOURCE_READY` 可用 Gate B approval 中的人工结论与原话完成验签，无需先改写自动保真报告。
