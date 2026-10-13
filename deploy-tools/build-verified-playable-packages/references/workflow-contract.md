# 工作流契约

## 目的

保证 Skill 位于 SOP 第 4、5 步内部，并在首次或重新创建 AppLovin 基线包前完成资源准备。资源候选、平台包生成和内置规则闭环属于同一条主路径。

流程提速必须遵守本文全部门禁。[执行效率契约](execution-efficiency-contract.md) 定义默认关闭的可选编排；项目 Adapter 未显式启用时继续执行原串行流程。启用只改变任务调度和可解释耗时，不改变 Gate、artifact 级证据或通过条件。

新运行的稳定入口固定为 `<product-root>/playable-runs/<run-id>/`。`<product-root>` 由目标 playable 工程所在的 Git worktree 根确定；例如 `SJ/playable` 必须写到 `SJ/playable-runs`，不得写到 `SJ/playable/playable-runs`、`SJ/playable/_交付` 或 `SJ/_交付`。所有候选资源、平台包、回滚副本、运行清单、报告和证据都从这个入口归档。历史运行不迁移；旧 Adapter 可以只读诊断，但不能创建不符合固定入口的新运行。

## 资源准备

```text
确认效果基线
→ 引用图与 allowlist
→ Gate A：允许候选试做
→ 显式资源动作覆盖与本地工具能力锁
→ candidateRoots 单变量试做、实际 argv 验签与自动保真
→ 未优化/优化 exact candidate 同链路对照
→ 最终载荷分桶与重复硬闸
→ Gate B：同一次回复确认 A/B，并选择 candidate-only 或精确覆盖
→ 覆盖后从正式工程重建（如适用）
→ RESOURCE_READY(applicationMode, resourceResultType)
```

Gate A 前不得生成有损候选；Gate B 前不得修改 `playableWorkingRoots`。已引用资源动作缺失、无证据 `KEEP`、`UNKNOWN`、`TOOLCHAIN_MISSING`、未批准外部素材、远程处理、工具漂移、缺少人工保真或最终重复载荷 blocker 都会阻断。相同字节锚点、非正资源收益和最终 artifact 非正净收益不能进入 Gate B。`UNREFERENCED` 只从当前候选排除，项目文件永远保留。

## AppLovin 基线

```text
验证 RESOURCE_READY 与实际消费资源树
→ 验证内置 ruleset
→ 执行真实 AppLovin 构建
→ 为 artifact 创建唯一 check batch
→ 最终 payload 扫描
→ 静态检查
→ 浏览器可信输入触发 CTA、运行时与性能 smoke（同一 check batch）
→ 分类与修复
→ 完整重建
→ BASELINE_READY
```

AppLovin 未通过时，不开始其他平台。基线清单必须绑定 artifact、adapter、实际消费资源树、application mode、payload report、ruleset、静态报告和运行时报告。

效率编排下，AppLovin plain 构建与检查仍单独执行。`run_platform_build_matrix.py` 禁止把 AppLovin 和其他平台放进同一 plain 波次；只有 `BASELINE_READY` 清单有效时，其他平台 plain 波次才能开始。

## 多平台扩展

验证 baseline manifest 后逐平台生成 exact candidate、执行 payload/静态/运行时检查并修复。运行时 CTA 必须由浏览器级 pointer/touch 输入触发并观察当前平台 bridge；`HTMLElement.click()` 或探针直接调用 bridge 不能作为通过证据。Mintegral 同时验证 `install` 与完整 `gameReady → gameStart → gameEnd`；Google Ads 同时验证合法 `ad.size` 与 `ad.orientation`。共享源码变化先回归 AppLovin；资源变化回到 Gate A，覆盖范围变化还需新的 Gate B。资源与共享源码未变化时，平台扩展只验证已有资源状态和 baseline，不重跑资源候选。

候选准入要求 payload blocker、静态 blocker/warning 和运行时 blocker/warning 全部清零。唯一可记录例外是 Android 单端投放缺少 iOS App Store 地址时的 `COMMON-STA-004` 提示，且必须已配置正确的 Google Play 地址并绑定用户确认。

Adapter 显式启用效率编排时，多平台路径为：

```text
AppLovin plain 单独构建与检查
→ 其他平台 plain 受控并行构建
→ 每个 exact artifact 独立 check batch 与本地完整检查
→ plain 缺陷全部修复
→ source-freeze.json 绑定源码、Adapter、资源、ruleset 与 plain 清单
→ 一次完整 final/hardening 构建矩阵
→ 每个 final artifact 新建 check batch 并重新完成本地完整检查
```

构建矩阵成功只表示文件已生成，固定显示“尚未检查”。本地检查矩阵先把临时构建输出逐字节复制到本轮独立稳定目录，校验 SHA-256 后才创建 check batch；报告和候选清单不得绑定下一次构建会覆盖的临时路径。检查矩阵必须按 `runtimeConcurrency` 控制浏览器槽位；载荷与静态检查可以并行，但三份报告必须绑定同一批次。冻结后任一输入、plain 清单、其稳定 artifact 或报告漂移都会阻断 final 矩阵；效率编排的 final-recheck 清单必须显式绑定仍有效的同一 source freeze。

返工使用 `plan_rebuild_scope.py` 生成影响范围：资源变化回 Gate A/Gate B 并使全部平台下游失效；共享源码扩大到全部冻结平台；平台源码/打包问题只在证据充分时缩小到当前平台；Checker 页面观察问题只重录页面证据和报告。`full-matrix` 始终重建全部冻结平台。

## 最终复检

混淆、压缩、重新内联、重打 ZIP 或任何字节变化都会使旧报告失效。复检仍使用 Skill 内置 ruleset 和最终 payload 扫描，不读取本机 Checker 实现。

最终字节冻结后的默认完成顺序：

```text
全部目标平台 final-recheck 清单、payload、资源消费和本地可信 CTA/生命周期证明有效
→ 生成用户摘要、内部审计报告与外部验证待办
→ PLATFORM_READY → READY_FOR_MANUAL_PLATFORM_ACCEPTANCE
→ 后续执行 Playable Ad Checker、官方 Preview、真实广告后台和代表设备验收
```

Checker 与官方 Preview、广告后台和代表设备同属外部验证，不再是本地候选 ready 的必经状态。缺少 Checker 证据时只能称“本地 ruleset 检查通过，Checker 尚未验证”；不可达、缺页签或 observation 重录只形成 `UNAVAILABLE|PENDING` 提醒，不反向使本地 final-recheck 失效。

用户选择执行 Checker 时，仍用 `checker_ui_queue.py` 生成 exact artifact 队列并断点续跑。队列一次只允许一个正在操作的页签；`record` 只接受当前 attempt 的 observation-v2，从结果节点、可信输入和桥接调用派生计数、CTA 和生命周期。最终 PNG 必须非空白、非纯色、包含当前身份且 SHA 唯一。后续冻结平台使用 `enqueue`，artifact 返工使用新 SHA `supersede`；观察重录保持 SHA 不变并创建新 attempt。最终仍由 `record_checker_acceptance.py` 重放证据并推导验收结论。

可选 Checker 分支的状态为 `NOT_RUN|PENDING|PASS|ISSUES_FOUND|UNAVAILABLE`。`PASS` 只增加补充证据；`NOT_RUN|PENDING|UNAVAILABLE` 不阻止 ready；`ISSUES_FOUND` 表示可信观察已证明当前 artifact 存在真实缺陷，受影响平台必须进入 `CHECKER_REWORK_REQUIRED`，修真实生成链、完整重建和本地复检后才能恢复候选资格。

一旦运行清单主动进入 Checker 分支，最终报告不得省略或降级已记录事实：`CHECKER_IN_PROGRESS` 必须先由机器分类，不能直接 ready；`CHECKER_ACCEPTANCE_RECORDED / CHECKER_OBSERVATION_RETRY / CHECKER_BLOCKED_EXTERNAL` 的交付报告状态必须分别为 `PASS / PENDING / UNAVAILABLE`。默认未进入 Checker 分支的 `PLATFORM_READY` 才可使用 `NOT_RUN` 报告直接 ready。

## 写入与完成边界

- `immutableSourceRoots` 始终只读。
- Gate B 只允许 `APPROVED_REPLACE` 写入 `overwriteEligibleRoots` 的精确文件；不支持 DELETE。
- 平台阶段只修改目标 playable 工程内与失败直接相关且获授权的源码、adapter、模板、构建配置和打包脚本。
- 禁止手改最终产物、Git、推送、部署、正式平台/广告后台上传和正式 Unity 工程写入。用户选择执行 Checker 时，只允许通过浏览器界面上传本轮 exact final artifact 做补充验证。
- 本地通过只称候选包，不替代官方 Preview、广告后台、代表设备、真实商店跳转和人工验收。

## 时间账本与 Gate 等待

新运行初始化时同时创建 `execution-timeline.json`。事件分为自动处理、用户等待、Checker 界面等待和故障返工；并行事件按时间区间并集计时。Gate A/Gate B 文档展示后必须执行 `run_manifest.py wait-start`，收到用户明确原话后执行 `wait-finish`。这两个命令只记录等待，不会批准 Gate 或推进状态。
