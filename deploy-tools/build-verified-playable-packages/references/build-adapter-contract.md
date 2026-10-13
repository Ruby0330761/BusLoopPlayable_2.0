# 统一项目构建 Adapter

优先读取项目的 `docs/project/playable-package-build-adapter.json`。Adapter 只描述项目已有能力，不能发明构建器。v1.5 使用 `playable-package-build-adapter-v2`：

```json
{
  "schemaVersion": "playable-package-build-adapter-v2",
  "resources": {
    "immutableSourceRoots": ["/absolute/path/to/unity-source", "source-assets/raw"],
    "playableWorkingRoots": ["public/assets"],
    "candidateRoots": ["playable-runs"],
    "overwriteEligibleRoots": ["public/assets/audio", "public/assets/images"],
    "referenceEntrypoints": ["src/main.ts"],
    "activeVariantConfigs": ["public/config/current.json"],
    "rebuildCommand": ["node", "scripts/build-resources.mjs"],
    "runRootBase": "product-root",
    "runRoot": "playable-runs",
    "rollbackRoot": "playable-runs"
  },
  "platformBuilds": {
    "applovin": {
      "command": ["node", "scripts/build-platform.mjs", "--platform", "applovin"],
      "output": "dist/applovin/index.html",
      "delivery": "html",
      "ctaSelector": "#cta",
      "resourceReceipt": "dist/applovin/resource-builder-receipt.json"
    }
  },
  "packaging": {
    "deterministicZipCommand": ["python3", "/absolute/skill/scripts/deterministic_zip.py"],
    "doubleWriteVerification": true
  },
  "performanceThresholds": {
    "maxLongTaskMs": 250,
    "maxP95FrameIntervalMs": 50,
    "minApproximateFps": 24,
    "maxDomContentLoadedMs": 3000
  },
  "executionEfficiency": {
    "enabled": false,
    "parallelBuilds": false,
    "buildConcurrency": 1,
    "runtimeConcurrency": 1,
    "rebuildPolicy": "impact-aware",
    "sharedInputs": [],
    "platformInputs": {},
    "plainArgs": [],
    "finalArgs": [],
    "resourceArgs": {
      "resourceRootFlag": "--resources-root",
      "allowlistFlag": "--allowlist"
    }
  },
  "allowedWriteRoots": ["public/assets/audio", "public/assets/images", "dist"],
  "protectedRoots": ["source-assets/raw", "dist/delivered"]
}
```

## 三层边界

- `immutableSourceRoots`：Unity、raw、源 WAV/FBX/PNG 等高质量来源；可位于项目外，始终只读。
- `playableWorkingRoots`：运行时正式消费的 playable 工作资源；Gate B 前只读。
- `candidateRoots`：候选资源、exact candidate、平台包和证据；只允许真实生成链路写入。新运行在 `runRootBase=product-root` 下相对产品仓根解析。
- `overwriteEligibleRoots`：必须是 `playableWorkingRoots` 子路径。Gate B 只允许对其中精确文件执行 `APPROVED_REPLACE`。
- `runRootBase`：新运行固定为 `product-root`。产品仓根由 playable 工程执行 `git rev-parse --show-toplevel` 得到；不接受 `..`、调用方猜测的父目录或任意外部目录。
- `runRoot`：长期运行根；在 `product-root` 模式下只能是 `playable-runs`，解析结果必须精确等于 `<product-root>/playable-runs`，并由产品仓 `.gitignore` 忽略。
- `rollbackRoot`：回滚副本根；在固定布局下同样声明为 `playable-runs`，实际副本写入当前 `<run-id>` 的资源阶段目录。

`UNREFERENCED` 永远不是写入类别。Adapter 不包含删除能力、删除根或清理命令。任何确认文本都不能授权删除未引用资源。

除运行目录族外，所有项目内路径均为 `<project-root>` 相对路径；`candidateRoots`、`runRoot`、`rollbackRoot` 在 `runRootBase=product-root` 时统一按 `<product-root>` 解析。所有相对路径都不得包含 `..`。项目外 `immutableSourceRoots` 必须使用绝对路径。解析后的符号链接越界、层级重叠或未声明路径直接阻断。`allowedWriteRoots` 仍只描述 playable 工程内写入范围，不能借它授权产品仓任意位置；产品仓侧只允许固定的 `playable-runs`。`playable-package-build-adapter-v1` 只允许旧流程只读诊断，不具备 v1.5 覆盖能力。

兼容规则：旧 v2 Adapter 未声明 `runRootBase` 时，`validate_adapter.py` 仍按 `project-root` 解析，便于恢复和诊断历史配置；但新运行初始化会核对最终绝对路径，只有精确落在 `<product-root>/playable-runs` 才能创建。`init_adapter.py` 对处于产品仓子目录的 playable 工程默认生成 `product-root` 草案，并把 `.gitignore` 建议指向产品仓根。Skill 不自动移动历史运行，也不自动修改 Adapter 或 `.gitignore`。

命令必须是 argv 数组，禁止 shell `-c`、Git、删除、部署、上传、远程复制、联网下载和 shell 元字符。npm/pnpm script 与直接调用脚本必须真实存在。普通 `build` 只登记为通用能力，不自动视为 AppLovin 或其他平台入口。

存在 ZIP 平台时必须声明 Skill 共用的 `deterministicZipCommand` 并启用双写校验。该打包器固定成员路径排序、时间、权限、目录项策略、压缩算法和级别；成员内容不得包含当前时间、随机值或临时绝对路径。

`performanceThresholds` 可选，只有项目已批准阈值后才填写。未填写时性能只标记“已采样、尚未判定”，保留代表设备人工门禁；填写后缺数据或超限会阻断。首次接入使用 `init_adapter.py` 生成待确认草案和 `.gitignore` 建议，Skill 不会静默修改项目文件。

`platformBuilds.<platform>.ctaSelector` 可选。项目有稳定 CTA selector 时应记录，运行时检查会优先使用；未填写时 Skill 在真实浏览器中只从可见、可操作且带明确 CTA 语义的元素自动识别。两种方式都必须由浏览器级可信输入触发当前平台 bridge，页面脚本 `click()` 不能通过。

`platformBuilds.<platform>.resourceReceipt` 只在构建器会生成图片合集、二次编码、改名或生成派生资源时需要。构建命令必须输出 `playable-resource-builder-receipt-v1`，逐 action 记录 `actionId`、原 SHA-256、候选 SHA-256/派生输出 SHA-256 和最终 artifact entry，并绑定当前 artifact SHA-256。图片合集必须用 `inputSha256s` 列出全部原始散图；最终 artifact 中任一输入 SHA 仍残留都阻断。可以直接从最终 payload hash 证明候选字节时省略；声明后缺文件、漂移或未绑定当前 artifact 都会阻断。

## 可选执行效率编排

`executionEfficiency` 可选且默认关闭；旧 Adapter 未声明该对象时固定按串行流程执行。只有项目已有构建链能够满足输入图和输出隔离时才设置 `enabled=true`：

- `parallelBuilds` 必须显式为 `true` 才允许 `buildConcurrency>1`；并发数范围为 1 到 8。
- `runtimeConcurrency` 控制本地浏览器运行时检查槽位，范围为 1 到 8；它不改变单个 artifact 的载荷、静态、运行时和候选清单顺序。
- `rebuildPolicy` 只允许 `impact-aware|full-matrix`。无法证明影响范围时仍扩大为完整矩阵。
- `sharedInputs` 是影响全部平台的源码、模板或配置；`platformInputs.<platform>` 是当前平台专用输入。启用时二者必须覆盖 Adapter 声明的全部平台，路径必须是存在的项目相对路径。
- `plainArgs` 与 `finalArgs` 是追加到各平台真实构建命令的 argv 片段。禁止 shell 元字符、下载、部署、删除和 Git 命令；它们不能用于手改最终 HTML/ZIP。
- `resourceArgs` 显式声明真实平台构建器接收候选资源根和 allowlist 的参数名。声明后，构建矩阵必须提供 `--resource-state`，并在构建前后验证实际消费树与 allowlist 未漂移；candidate-only 包不得静默回退到工程工作资源。参数存在和树未漂移只是输入证明，候选清单前仍必须由完整 payload hash 或 `resourceReceipt` 证明最终 artifact 真实消费候选字节。
- 并发平台的最终输出必须位于互不重叠的目录。仅文件名不同但共用同一输出目录不具备隔离证明，Adapter 验证会阻断并要求改成独立目录或继续串行。

启用效率编排不会产生平台通过结论。`run_platform_build_matrix.py` 只把构建结果标为“尚未检查”；`run_platform_check_matrix.py` 为每个 exact artifact 创建唯一 check batch，完成载荷、静态和浏览器运行时检查后才生成候选清单。
