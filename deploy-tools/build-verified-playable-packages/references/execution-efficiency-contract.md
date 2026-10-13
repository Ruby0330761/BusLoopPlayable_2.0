# 执行效率契约

## 目录

1. [目标](#1-目标)
2. [不可优化掉的门禁](#2-不可优化掉的门禁)
3. [关键路径](#3-关键路径)
4. [阶段执行](#4-阶段执行)
5. [失败前移与重建范围](#5-失败前移与重建范围)
6. [缓存边界](#6-缓存边界)
7. [Gate 用户体验](#7-gate-用户体验)
8. [结构化时间账本](#8-结构化时间账本)
9. [Skill 回归分层](#9-skill-回归分层)
10. [验收](#10-验收)
11. [回滚](#11-回滚)

## 1. 目标

在不减少证据、不跳过 Gate A/Gate B、不复用旧通过结论、不手改最终产物、不绕过 Playable Ad Checker 的前提下，缩短一次七平台全新运行的实际处理时间。

正常运行目标：

- 七平台全新运行、无产品缺陷时，自动处理与浏览器终检的关键路径不超过 45 分钟。
- 连续三次同规模运行的 95 分位不超过 60 分钟。
- 用户在 Gate A/Gate B 的等待单独计时，不计入自动处理时间，也不隐藏在总耗时中。
- 平台局部缺陷的定位、修复和重建目标不超过 20 分钟；共享源码缺陷目标不超过 30 分钟。
- 内部审计报告在账本完整时展示自动处理、用户等待、Checker 界面等待和故障返工四类耗时；面向用户的交付摘要默认不展示流程耗时。

这些时间是验收目标，不是通过条件。超过目标不会放宽质量门禁，而是生成效率诊断。

## 2. 不可优化掉的门禁

以下步骤不允许为了提速而删除、合并为自动批准或用旧证据替代：

- Gate A 前不生成有损候选，且必须真实等待用户批准。
- Gate B 必须由用户同时确认 A/B 保真和 `candidate-only|applied`。
- AppLovin 基线必须先通过，其他平台才能形成有效候选清单。
- 每个 exact artifact 使用唯一 check batch，绑定静态、运行时和载荷报告。
- 最终文件任何字节变化后，相应本地报告和 Checker 证据失效。
- hardening 之后必须对最终字节重新执行完整检查。
- Checker 只通过浏览器界面上传本轮 exact final artifact；无页签平台如实记录。
- 未引用资源只从本轮载荷排除，项目文件始终不删除、不移动、不改名、不改写。
- Unity、raw 和高质量来源始终只读。

## 3. 关键路径

```text
本轮新鲜发现与只读预检
→ 资源扫描、引用图、Gate A
→ 用户批准 Gate A
→ 候选批量试做、逐 action 验签、保真、before/after exact candidate、Gate B
→ 用户批准 Gate B
→ AppLovin plain 基线与本地检查
→ 其他平台 plain 候选受控并行构建与本地检查
→ 所有缺陷修复完毕
→ 源码/Adapter/资源/配置冻结
→ 一次 hardening 与最终平台矩阵重建
→ 最终本地复检
→ Checker 浏览器界面逐平台终检
→ 一次性生成报告与必要回归
```

核心变化不是少检查，而是增加“冻结屏障”：所有平台 plain 候选通过前不开始 hardening；所有已知缺陷修复完成后只执行一次最终矩阵重建。

## 4. 阶段执行

### 4.1 本轮新鲜发现与只读预检

一次遍历同时产生：

- 项目、Adapter、ruleset 和构建入口验证。
- 资源 ledger、引用图、allowlist、未引用资源只读快照。
- 各平台构建配置、输出类型、CTA selector 和静态契约的只读预检。
- 工具链版本与 executable hash。

预检可以复用依赖安装和编译器缓存，但所有资源 hash、引用结论、计划、报告和运行清单必须在本轮重新生成。预检不得生成有损资源候选，也不得把平台配置检查写成平台通过。

### 4.2 候选批处理

- 同一资源类型的独立 action 可并行转换，默认并发上限为 `max(1, min(4, floor(CPU 核数 / 2)))`。
- 每个 action 仍从 Gate A 计划读取参数，独立记录 argv、输入输出 hash 和 executable hash。
- 自动保真可以并行，但单 action 的“生成 → 验签 → 保真 → 采用或回退”顺序不可打乱。
- before/after exact candidate 共用一次已冻结的代码、Adapter、变体和构建上下文。
- 任一 action 失败只回退该 action；共享候选树必须通过最终整体 hash 验签。

### 4.3 AppLovin 基线

- AppLovin 仍是串行总闸，不能与其他平台有效候选并行晋级。
- 构建完成后，载荷扫描与静态检查可并行；浏览器运行时检查独占一个浏览器槽位。
- AppLovin 未通过时，其他平台最多执行只读配置预检，不生成可晋级清单。

### 4.4 平台 plain 波次

AppLovin 通过后，其他平台进入受控并行：

- 平台构建并发默认 2，避免 Vite、压缩和浏览器同时抢占内存。
- 每个平台内部严格保持“构建 → 新 check batch → 载荷/静态/运行时 → 候选清单”。
- 同一 artifact 的载荷和静态检查可并行；浏览器运行时检查并发默认 2。
- 每个平台使用独立输出目录、check batch、报告和日志，禁止共享临时文件。
- 平台构建命令必须通过 Adapter 的 `resourceArgs` 接收 `RESOURCE_READY` 绑定的候选资源根与 allowlist；构建前后都要复核资源树哈希。候选清单前还必须验证最终 payload 包含候选 SHA、没有对应原 SHA；派生变换使用 builder receipt。参数传入和资源树登记不能单独证明实际消费。
- Mintegral 必须在此阶段证明 `install` 与完整 `gameReady → gameStart → gameEnd`；Google Ads 必须证明合法 `ad.size`、`ad.orientation` 和动态图片安全映射，Meta 必须证明动态图片安全映射；这些问题不得推迟到 Checker。
- plain 阶段发现的平台局部问题只重建该平台；共享源码问题先回归 AppLovin，再按影响图重建受影响平台。

并行只缩短墙钟，不改变逐 artifact 的完整证据链。

### 4.5 源码冻结与一次最终矩阵

所有 plain 平台通过后，记录一个 `source-freeze.json`，至少绑定：

- 共享源码树 hash。
- 平台 Adapter、模板、构建配置和打包脚本 hash。
- 实际消费资源树与 `applicationMode`。
- ruleset hash、目标平台和交付组合。
- plain 候选清单集合。

冻结后执行一次 hardening 和最终矩阵重建。最终 artifact 必须重新创建 check batch 并完成载荷、静态和运行时检查，plain 报告不能替代 final-recheck。

当用户明确要求“任何修复后七平台完整重建”时，使用 `full-matrix` 策略，但仍把所有修复集中在冻结前，避免多次七平台重建。普通运行可使用 `impact-aware` 策略：平台局部修复只重建当前平台，共享源码修复重建 AppLovin 和影响图命中的平台。

### 4.6 Checker 浏览器终检

- 创建逐平台队列前先执行只导航、不上传的浏览器可达性 preflight。只有 URL 一致、页面可见标记存在且证据未过期时才能 `init/start`；不可达时记录外部阻塞，不创建上传 attempt。
- 每个平台 exact final artifact 冻结并通过本地 final-recheck 后立即进入按页签排序的队列，不等待其余平台全部完成。
- 仍只通过浏览器界面逐页签上传、触发真实 CTA/生命周期并读取页面可见结果。
- 可以自动编排页面导航、文件选择、结果等待和截图命名；禁止调用 Checker 私有接口、读取其实现或直接伪造观察 JSON。
- 每个平台完成后立即落盘页面观察和唯一最终截图；只等待文件名、结果计数和 warning 明细等具体节点，不等待通用 network idle。浏览器中断时从最后一个未完成页签继续，不重复使用旧页签结果。
- 单平台重建时使用 `supersede` 只替换变化的 `platform + deliveryKey` 并保留旧 attempt；未变化平台的完成记录继续有效。日常命令使用 `--compact`，避免反复输出整份队列。
- 页面没有 TikTok 页签时记录 `UNAVAILABLE`，不创建假页签或借用其他平台。

## 5. 失败前移与重建范围

使用 `failure-scope.json`，依据实际输入图把失败分为：

| 失败范围 | 示例 | 必须失效与重建 |
|---|---|---|
| `resource` | 候选字节、allowlist 或参数变化 | 回 Gate A；涉及覆盖时重新 Gate B；全部平台下游失效 |
| `shared-source` | 公共 runtime、CTA、音频门控 | AppLovin 和影响图命中的全部平台 |
| `platform-source` | `src/core/mintegral.ts`、单平台 Adapter | 当前平台；若引用共享模块则按影响图扩大 |
| `packaging` | ZIP 结构、backup、HTML 尾部 | 当前交付类型对应平台 |
| `hardening` | 混淆器或最终内联变化 | 字节变化的平台 final-recheck 与 Checker |
| `checker-observation` | 截图或页面记录缺失 | 仅 Checker 记录和交付报告，不反向重建 artifact |

影响图只能缩小无关平台的重复工作，不能跳过真实生成链。无法证明影响范围时默认扩大到 `full-matrix`。

## 6. 缓存边界

允许缓存：

- `node_modules`、包管理器离线缓存、浏览器二进制和本地工具。
- 以源码、配置、资源、Adapter、ruleset 和命令 hash 为键的编译中间缓存。
- 同一运行内只读扫描的规范化中间结果。

禁止缓存为本轮证据：

- 旧 Gate 文档或用户批准。
- 旧候选资源、旧平台包、旧 check batch、旧本地报告。
- 旧 Checker 页面结果、截图或通过结论。
- 旧运行的 `RESOURCE_READY`、baseline 或 final-recheck 清单。

缓存命中只减少计算，输出仍必须写入本轮稳定目录并重新绑定 bytes、SHA-256 和 attempt。

## 7. Gate 用户体验

- Gate A/Gate B 文档生成后立即显示绝对路径、第一屏摘要和一句可直接回复的中文模板。
- Gate 等待期间运行清单记录 `waitingFor=gate-a|gate-b`，不得显示为仍在自动处理。
- 等待期间不执行超出当前授权的候选、覆盖或平台构建。
- 用户回复后立即记录原话和批准时间，继续执行时不再要求用户理解 action ID、状态码或工具参数细节。
- Gate A 的风险只展示本轮实际动作；包内去重与资源重编码分开计数，避免把逻辑路径去重描述成文件压缩或删除。

## 8. 结构化时间账本

使用 `execution-timeline.json`。每条事件至少包含：

- `phase`、`operation`、`attemptId`、`platform`、`deliveryKey`。
- `startedAt`、`finishedAt`、`durationMs`。
- `timeClass=automatic|user-wait|checker-ui-wait|rework`。
- `inputHashes`、`outputEvidence`、`cacheStatus`、`concurrencyGroup`。
- 失败时的规则 ID、责任范围和失效起点。

总时长按时间区间并集计算，不能把并行任务时长简单相加。汇总必须包含 `complete` 与 `missingEventTypes`。至少要有一个自动处理事件且没有仍在运行的事件，才允许判断 45/60 分钟目标；否则固定 `targetAssessment=INSUFFICIENT_EVIDENCE`，不得把缺失观测显示为 0 秒通过。完整的内部审计报告展示：

1. 墙钟总时长。
2. 自动处理关键路径。
3. Gate A/Gate B 用户等待。
4. Checker 页面等待与操作。
5. 故障返工及其责任范围。
6. 各阶段目标与实际偏差。

面向用户的交付摘要默认不展示时间账本。只有用户明确要求效率报告时，才从完整的内部审计证据生成单独说明。

## 9. Skill 回归分层

- 项目资源、源码或 Adapter 变化：运行目标平台契约和候选清单测试，不运行 Skill 全量测试。
- Skill 脚本变化：先运行命中模块的定向测试。
- 本轮有多个 Skill 修复：修复期间运行定向测试，所有修复完成后只运行一次全量回归。
- ruleset 或共享状态机变化：必须运行完整 Skill 回归和规则集验签。

全量回归不能替代当前项目的 artifact 检查；项目检查也不能替代 Skill 自身回归。

## 10. 验收

启用效率编排至少满足：

- 现有全部 Skill 回归通过。
- 并发隔离测试证明两个平台不得覆盖彼此 artifact、批次或报告。
- 失效测试证明平台局部、共享源码、资源和 Checker 观察分别命中正确范围。
- 冻结测试证明 plain 未全通过不得 hardening，冻结后源码漂移必须阻断。
- 时间账本测试证明并行区间按并集统计，用户等待不会计入自动处理；缺少自动事件时显示证据不足而不是 0 秒达标。
- 缓存红线测试证明旧报告、旧候选、旧截图和旧通过结论永远不能成为新运行证据。
- 严格模式测试证明 `full-matrix` 仍只在所有修复完成后执行一次最终七平台矩阵。
- 效率目标使用至少连续三次同规模新鲜运行计算 P95；单次运行不得作为效率通过结论。

## 11. 回滚

效率实现必须由单一编排开关控制。出现证据错绑、并发覆盖、错误缩小失效范围或时间账本不一致时，立即关闭新编排器，回退到现有串行契约执行；不得通过保留不可信的新报告继续交付。把失败原因写入本轮运行目录和正式方案，不写回 Skill 参考文件。
