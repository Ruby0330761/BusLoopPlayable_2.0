# 资源工具链与外部依赖契约

## 外部素材

默认 `DENY_EXTERNAL_ASSETS`。当前项目、登记的只读源工程和用户已提供本地输入之外的新贴图、模型、音频、字体、配置或生成内容，均为外部素材。默认数量必须为 0。

用户要求例外时，另建 `EXTERNAL_ASSET_EXCEPTION`，记录来源、许可证/授权、获取时间、原始 SHA-256、用途、目标变体和单独确认。资源计划确认不包含联网获取授权。

## 网络

日常本地工具链保持 `networkPolicy=DENY`：不上传在线压缩、云转码或远程 AI 服务；不通过包管理器、浏览器或下载工具联网安装依赖；最终包不得运行时获取业务资源。普通视觉图片的 Tinify `POST /shrink` 是 Gate A 明确授权的唯一外部服务例外，计划标记 `TINIFY_ALLOWLIST_ONLY`，服务、上传清单和预计调用数进入 approval；Tinify 不登记为本地工具、不写入 toolchain lock，也不把云端请求伪装成本地执行。缺少工具时在内部 JSON 的 `missingCapabilities` 记录机器状态并暂停，普通用户提示不得显示内部错误码。

## 本地工具锁

`toolchain-lock.json` 必须记录工具名、精确版本输出、绝对 executable、可执行文件 SHA-256、来源、许可证、`offline=true`、argv 模板和参数。优先级固定为 Skill 内建脚本、项目锁定依赖、系统已安装工具；不得静默降级。

首次机会审计前，工具检查可以绑定 source ledger 的代表性已引用输入，只读发现 Skill 登记的已知工具并生成完整锁；资源动作形成后再按 `resource-actions.json` 复核 `requiredCapabilities`。`--discover-supported` 支持系统 FFmpeg 的音频重编码、图片降采样和图片格式/质量候选，支持 FBX2glTF 与 gltf-transform 的三维物体格式转换、紧凑存储和减面；图片合集与配置引用闭包使用 Skill 内建脚本并额外锁定脚本 SHA-256，字体工具必须由项目显式声明。发现过程必须只读，保留绝对路径、版本、可执行文件哈希、构建配置、许可证、离线属性、确定性探针和批准参数范围，不得扫描或执行任意未知程序。机会审计、Gate A 和实际转换 receipt 必须引用同一个锁；工具漂移时回到 Gate A。

需要的能力不在锁中时停止，并用中文明确告诉用户缺少什么、用于什么、如何安装、不安装的影响和安装后如何从同一运行继续；不得在普通用户提示中显示内部错误码。空工具数组只在当前计划不需要外部转换能力时合法，不能用来证明资源没有优化空间。

只执行 argv 数组，禁止 shell 拼接。非 Skill 内建工具必须配置代表性输入探针，在隔离临时目录重复转换两次；输出哈希不同则 `TOOLCHAIN_NONDETERMINISTIC`。工具路径、版本输出、哈希或参数变化会同时使 approval、`RESOURCE_READY` 和下游平台状态失效。

候选生成器必须从 Gate A 已批准计划读取参数，不得硬编码最终值。每个实际转换记录 action ID、工具名与可执行文件哈希、完整 argv、输入/输出路径和 SHA-256、规范化实际参数。`verify_resource_execution.py` 同时对照工具链允许参数和 Gate A `parameterRanges`；实际 argv 声明的码率、采样率、声道、编码器等必须与记录一致。存在有损动作时，该验证报告是 `RESOURCE_READY` 必需证据。

新增运行时解码器须计算资源节省减去依赖 bytes 和兼容成本；净收益不为正时拒绝，净收益为正时仍需用户确认。
