# Findings & Decisions

## 2026-07-06 Phase 26 Unity 相机/平面取证

- Unity `GameSceneDualQueue2.prefab` 的 `Main Camera_2` 是透视相机：`orthographic: 0`、FOV 4.7°、位置 `(0,87.8823,-50.05)`、X 轴旋转 55°、near/far 100/116。
- Unity 玩法对象位于世界水平面；相机 forward 与 y=0 的交点约在 z=11.48。
- `BG01_split01` 不是玩法地面，而是 `Main Camera_2` 的子节点，局部位置约 `(0,0.11000061,114.112)`，位于玩法后方的独立背景面。
- 当前 Web 使用 `OrthographicCamera`，并把背景与传送带图片都旋转为水平 XZ 面；因此未复刻 Unity 的透视相机 + 相机子级背景结构。
- 用户关于透视差异造成视觉问题的判断成立；继续只修人物局部节点不足以完全对齐 Unity。
- Unity `Idle_boy01_1.prefab` 的人物根位置为 0、Y 旋转 90°、统一缩放 0.168；人物 mesh 和 Shadow_01 都是同一根的子级。
- Unity Shadow_01 在乘客根下局部位置为 `(0,0,0)`、局部 Y 旋转 90°、缩放 1；没有独立世界坐标偏移。
- Web 后续应把背景改为 camera child / camera-facing plane，并以透视相机进行视口 fit；玩法与影子保持世界水平面。

## 2026-07-06 Phase 25 完成结论

- 传送带图片新增 width/depth 控件；车位新增 scaleX/scaleZ 控件，均可实时调节。
- 背景使用 PNG 头部确认的 2100×3382 尺寸；世界平面深度由 `width * 3382 / 2100` 推导，原图比例不再被横向拉伸。
- 相机 fitHeight 从 16.2 调至 19.4，容纳修正比例后更深的背景平面。
- 人物模板不再直接承担局部旋转，也不再覆盖 normalize 后的 Y translation；`personPivot` 负责旋转和离地高度。
- 每个人物和 Shadow_01 保留在同一个 `visualRoot`，调整循环/队列坐标时两者继承完全一致的世界变换。
- 浏览器把左右队列 X 分别调到 -1.5/+1.5，未再观察到人物与影子分离；传送带宽度 12、车位 X 尺寸 1.3 均实时生效。
- 1280×720 与 390×844 均无页面溢出；窄屏含 23 个编辑控件且默认收起。
- 浏览器仅有 FBXLoader 对原材质类型的既有 warning，无新增 error。

## 2026-07-06 Phase 25 初始取证

- 用户补充要求：车位和传送带图片需要尺寸控制；背景恢复原图比例；修复调小人坐标后影子脱离。
- `BG01_split01.png` 实际尺寸为 2100×3382，宽高比 0.620934；当前平面 14.1×18.8 的比例为 0.75，确认存在横向拉伸。
- 背景应保留 14.1 世界宽度并按原比例推导深度约 22.708，同时扩大相机纵向适配范围。
- 乘客模型当前直接在带有 normalize translation 的模板根上旋转，并覆盖模板根的 Y normalization；这会让模型几何中心/底部偏离影子锚点。
- 修正方向：新增 `personPivot` 承担局部朝向与高度，保留模板自身 normalization，并让人物与影子始终挂在同一个 `visualRoot` 下。

## 2026-07-06 场景编辑器与响应式结论

- 编辑器需求最终明确为：传送带图片位置；中间循环曲线的位置与 X/Z 尺寸；左右队列曲线各自的位置与 X/Z 尺寸；车位起点/Z/间距/角度；车辆统一大小。
- 小人不使用独立队列间距参数，继续沿各自整条曲线均匀分布；曲线尺寸变化自然改变整体间距。
- 中间循环曲线以自身包围盒中心为缩放锚点；侧队列以第一个控制点（接入传送带端）为缩放锚点。
- `SCENE_TUNING` 是编辑器、预览与 QA 接口的唯一数据源；`SceneView.applyTuning()` 负责实时重建曲线和更新布局。
- 正交相机尺寸使用 `max(fitHeight/2, fitWidth/(2*aspect))`，并包含 padding，因此同时满足可见宽度和高度。
- 1280×720 浏览器验证：document 1280×720，无页面滚动；canvas 960×720；editor 320×720。
- 390×844 浏览器验证：document 和 canvas 均 390×844，无页面滚动；编辑器默认收起为 60×48。
- 手机展开编辑器为 320×828，编辑器 body clientHeight 750 / scrollHeight 1133，滚动被限制在面板内部。
- 将中间循环曲线 X 尺寸从 1.00 调至 1.25 后，数字输入、range 值和场景轨迹同步更新。
- 浏览器控制台无 error/warn；一次截图出现瞬态 WebGL 黑块，立即复核后消失，非持续运行问题。
- `node --test` 最终 19/19 通过；生产构建成功，JS chunk 627.63 kB（gzip 168.82 kB）。

## Requirements
- 源 Unity 工程：`D:\UnityProjects\BusLoop`，只读。
- 当前阶段仅提炼核心玩法，不开发 three.js 页面。
- 关卡来源：`Assets\BusJam\Game\Bundleables\Level_Escape_A` 下的 `level1..asset`。
- 关卡文件包含车辆位置、颜色、ID 等数据。
- 颜色映射：0 Blue；1 Green；2 Pink；3 Purple；4 Red；5 Yellow；6 Orange；7 LightBlue；8 Brown；9 DarkGreen；10 DarkBlue。
- 产物写入当前工作区项目文档。
- 新增：实现第一个 Three.js 原型，不使用 Unity 工程内 3D 模型。
- 场景基于 `GameSceneDualQueue.prefab`，小人沿 spline 闭环移动。
- 目标是功能与 Unity level1 一致，而不是当前阶段的美术还原。
- 2026-07-03：场景改用 GameSceneDualQueue2.prefab，需要支持两个传送带入口，并引用该 prefab 使用的背景、传送带、车位等资源，尽可能还原 Unity 视觉效果。

## Research Findings
- GameSceneDualQueue2.prefab 实际结构为两个 24 容量 PassengerQueue 入口汇入同一条 32 槽闭环 ConveyorBelt，不是两条独立闭环传送带。
- DualQueue2 的传送带速度 0.5、长按阈值 0.2 秒、加速倍率 3、出口区间 60.5%–78%，仍使用 8 个候车位。
- 场景直接视觉依赖包括 BG01_split01/02.png、Loop_Road_02.png、Left_Road_02.png、Right_Road_02.png、BG.FBX、Car_P.fbx、ParkingSpots.prefab 与阴影平面。
- 已从 Paths prefab override 提取 19 点闭环传送带和左右各 20 点入口路径；左右入口分别接近闭环进度 0 与 0.421。
- level1.asset 的 60 条固定乘客记录均为 queueId: 0。为满足本原型必须可见两个入口的要求，Web 适配按原顺序切成前 30 组进入左队列、后 30 组进入右队列；颜色总量、车辆和胜负需求不变。
- 项目处于 Phase 0“玩法规则提炼”；在核心规则写清前不进入 three.js 运行时。
- `Level_Escape_A` 实际含 `level1.asset` 至 `level300.asset`，另有 guidelevel 文件；本轮按用户指定聚焦 `level1.asset`。
- `level1.asset` 类型为 `LevelConfig`：id=1、mapScale=1.33、difficulty=Normal、sceneName=`GameSceneDualQueue`、passengerMethod=4=`FixedSequence`。
- level1 有 6 辆 10 座车：84/85=Blue(0)，86/88=Red(4)，89/90=Yellow(5)；都在 ParkingArea 容器 0，均非隐藏车。
- 车辆分成两个朝向族：84/86/88 约 -60°，85/89/90 约 +30°；点击后仅碰撞图叶节点（前方无阻挡）能驶出。
- level1 固定序列共 60 条逻辑乘客组：Blue×20、Red×20、Yellow×20；排列为 Blue×10 → Red×10 → Blue×10 → Yellow×10 → Red×10 → Yellow×10。
- 每条固定序列实际生成一个四人组（`PassengerGroupRoot.GroupSize=4`），因此是 60 组/240 个可见角色；每辆 `seats=10` 对应 10 组/40 人容量。
- `GameSceneDualQueue` 有 8 个候车位；39 槽闭环传送带，速度 0.5，长按 0.2 秒后 3 倍速，出口区间为 spline 64.5%–77%。
- 玩家按下/点击车辆；可移动且有空候车位时，车辆自动占用第一个可用车位。被其它车辆挡住时播放碰撞反馈；车位满时拒绝操作。
- 乘客四人组从固定队列补入传送带，在出口区自动寻找已到站、同色且剩余座位足够的车并逐个上车。
- 车辆满载后自动离站；所有停车场车辆、候车位车辆、离场动画车辆和容器车辆清空后胜利。
- 失败条件（该传送带场景）：所有启用候车位均被占用，源队列无法继续提供可用空间，且传送带上不存在能登上当前车辆的乘客组。
- level1 的扩展机制均为空：隐藏车、链接车、扳手/齿轮车、双色组合车、锚点与特殊乘客位置均不参与本关核心。
- level1 是教学关，源码存在逐车手势引导，但具体车辆 ID 顺序来自运行时 `GuideConfig`，未在仓库静态资源中找到。
- 原型工作区当前没有现成前端源码；Node 24.14 与 pnpm 11.7 可用。
- `GameSceneDualQueue.prefab` 的乘客传送带参数直接配置为 capacity=39、speed=0.5、longPressThreshold=0.2、multiplier=3、exit=64.5%–77%。
- 传送带 spline 来自 `Assets/BusJam/Game/Bundleables/Prefabs/Paths.prefab`（GUID `41208ecf...`），`GameSceneDualQueue.prefab` 对 20 个 Dreamteck spline 点进行了 override。
- 候车位来自 `Assets/BusJam/Game/Prefabs/Car_0307/ParkingSpots.prefab` 的实例，场景层共有 8 个引用。
- 已实现纯逻辑 `BusLoopGame` 与 Three.js `SceneView` 分层；浏览器通过 `window.__busLoop` 暴露稳定 QA 接口。
- 原型使用 Unity ConveyorBeltPath 的 19 个闭合控制点，经中心归一化后交给 `THREE.CatmullRomCurve3`。
- 自动化模型测试 6/6 通过；Vite 生产构建成功，JS 约 520 KB（gzip 约 134 KB）。
- 最终自动化模型测试为 7/7，通过合法点击顺序完整跑到胜利；JS 语法检查通过，运行时无外部 URL。
- 应用内浏览器因现有用户策略拒绝 `127.0.0.1:4173`，不能换地址或浏览器规避；该端口同时已被标题不同的其它页面占用，因此本轮没有可信的视觉试玩结果。

## Technical Decisions
| Decision | Rationale |
|----------|-----------|
| 优先解析 Unity YAML 与对应 C# 类型 | 配置结构与运行逻辑必须互相印证 |
| 不把美术资源纳入本轮提炼 | 当前目标是玩法规则和关卡语义 |
| 使用 Three.js 几何体和 CSS HUD | 不依赖 Unity 3D 模型，同时保留空间点击与动画反馈 |
| spline 采用 Three.js 闭合曲线并使用 Unity 场景控制点 | 保留路径驱动语义与出口百分比，不把乘客移动写成固定坐标序列 |

## Issues Encountered
| Issue | Resolution |
|-------|------------|
| 全工程入口扫描 120 秒超时且无报告 | 缩小到指定关卡目录，并通过 YAML 脚本 GUID、字段名和运行时类型定向取证 |
| `seats=10` 容易误读为 10 个可见乘客 | 结合 `PassengerCapacity=Seats*GroupSize` 与 `GroupSize=4`，明确为 10 个四人组/40 人 |
| 只读分析期间 Unity 源仓库 Git 状态在 15:24 左右变化 | 检查到多个正在运行的 Unity 进程（其中两个约 15:18 启动）；本轮命令和扫描脚本只读源目录，扫描脚本仅向当前工作区 output 写报告。未回滚或触碰这些并发改动 |

## Resources
- `D:\UnityProjects\BusLoop\Assets\BusJam\Game\Bundleables\Level_Escape_A`
- `D:\WorkPlace\Playable\BusLoopPlayable_new\docs\project\playable-core-rules.md`
- `D:\UnityProjects\BusLoop\Assets\BusJam\Game\Scripts\LevelConfigs\LevelConfig.cs`
- `D:\UnityProjects\BusLoop\Assets\BusJam\Game\Scripts\GamePlay\PlayerControllerState\PlayerControllerStateNormal.cs`
- `D:\UnityProjects\BusLoop\Assets\BusJam\Game\Scripts\GamePlay\States\StatePlay.cs`
- `D:\UnityProjects\BusLoop\Assets\BusJam\Game\Scripts\ConveyorBelt\ConveyorBelt.cs`
- `D:\UnityProjects\BusLoop\Assets\BusJam\Game\Scripts\VehicleContext\VehicleContext.cs`
- `D:\UnityProjects\BusLoop\Assets\BusJam\Game\Bundleables\Prefabs\GameSceneDualQueue.prefab`

## Visual/Browser Findings
- 浏览器导航在页面加载前被策略拒绝；没有产生可用于判断布局的截图或 DOM 结果。
- 2026-07-03 用户提供 Unity 运行参考图：传送带/双入口位于上方，8 个候车位位于中间，车辆停车场位于下方；无需复刻截图顶部/底部按钮和关卡标识。
- Loop_02_0 不是独立物理文件，而是 Textures/Car_0307/Loop_02.png 的 Sprite 子资源；Unity meta 定义裁切区域 x=0、y=57、width=2100、height=1243，原图尺寸 2100×1300。
- Main Camera_2 的 Unity 俯角为 55°；Web 端将相机俯角和模型 Y 轴朝向作为独立可调参数。
- Car_001/Van_001/Bus_001 FBX 内各有车体网格与 Wheel_001 网格，容量映射为 4/6/10。
- Idle_New 与 Car_New 的 11 个颜色材质按文件名后缀对应颜色，并共享同一组颜色纹理图集；level1 实际使用 blue/red/yellow。
- BG_split01.mat 指向 2100×2800 的 BG_split01.png；Web 使用同源高质量 WebP 置于独立平面。
- 原模型资源接入后 dist 为 3,042,626 bytes，仍低于 AppLovin 5 MB 基线。
- 用户进一步澄清“关卡布局”特指停车场车辆生成区域：仅初始车辆位置/朝向逆时针旋转 180°；车位、传送带和乘客路径保持上一版。
- 最新编号参考图表明 level1 原始 x/z 已具备正确相对关系：84/90/89 在右侧，85/86/88 在左侧；额外 180° 会同时翻转左右与前后，因此应撤销。
- 当前效果图与目标图进一步说明：X 轴左右关系无需改变，只有车辆区域的 Z 轴前后关系和对应车辆朝向需要镜像；正确变换是 Z 镜像而非旋转。
- 乘客运行时采用 VAT：Passenger_Move 约 0.6 秒、Passenger_Idle 2 秒；普通上车没有单独 clip，StateMoveToVehicle 的 PlayMoveAnim 调用已被注释。
- BusJamConfig.asset 的实际上车参数为：四人间距 0.13、逐人间隔 0.05 秒、移动速度 3.8、动画相位参数 0.3、停车位局部目标点 (-0.24,-0.13,-0.33)。
- 当前复制的 Idle_boy01.fbx 经 FBXLoader 解析没有 animation clips；Web 动画不能直接依赖 AnimationMixer。
- 已通过隔离 Unity batch 工具导出与 VAT 编号一致的网格（471 顶点/2007 索引），源 Unity 工程未改动。
- Web 端现使用 512×128 RGBAHalf DataTexture 与自定义 MeshStandardMaterial vertex shader 播放原 Passenger_Move/Idle。
- 动画接入后 dist 为 4,243,704 bytes，低于 AppLovin 5 MB，但后续单 HTML、CTA 和音频需严格控制余量。
- 汽车驶入车位由 StateToStation 构造 MovingPathImpl：从车辆当前点沿车头方向驶出停车区包围盒，再沿包围盒边缘转向停车位入口，最后进入车位；折角用 vehicleTurnRadius 与入/出弯控制器生成贝塞尔段。
- 驶入路径的时长不是固定值：按路径总长度在 vehicleMoveToStationConfig 中选区间并插值速度，duration=distance/speed；位移进度使用配置 AnimationCurve，朝向始终 LookRotation(path tangent)。
- 满载驶离由 StateOutStation 分为倒车段和前进段：先沿 CollectPathPoints 生成的路径倒车并 LookRotation(-tangent)，再沿停车区外直线路径前进并 LookRotation(tangent)；两段各有独立速度和曲线。
- 受阻点击由 StateCollide 处理：根据车辆 OBB 边与前向射线计算最近真实接触距离，撞击车按 forward 曲线前进、停留 collideDelay、按 backward 曲线回原位。
- 被撞对象若是车辆，StateCollide 在碰撞点调用目标车 PlayHitAnim（方向转换到目标车局部空间），同时播放 VfxVehicleCollide；撞到容器时不触发目标车辆动效。
- 所有正式数值仍需从当前生效的 BusJamMovingConfig asset/实验配置以及 Vehicle.PlayHitAnim 实现中继续取证，尚未开始 Web 端实现。
- 正确的独立背景资源是 BG01_split01.png；正确的停车位纹理是 Car_P2.png。旧 BG_split01.webp 与 Car_P.png 已从 public/dist 排除。
- 巴士顶部 Arrow_01 的局部朝向还需额外旋转 180°，该修正与全局布局旋转分别配置。
## 2026-07-03 Phase 23 — 正式汽车动效（受击动画取证）

- Level 1 的普通 10 座车辆使用 `Ani_Bus.controller`；其 `Hit` 状态是由 `HitX` / `HitY` 驱动的二维 BlendTree，四个方向分别引用 `Bus_Hit_Right.anim`、`Bus_Hit_Left.anim`、`Bus_Hit_Front.anim`、`Bus_Hit_Back.anim`，并回到 `Bus_Idle`。
- 四个受击 clip 均为 0.5 秒。动画目标不是整辆车根节点，而是 `Whole/Bus_001` 车身子节点；车轮只有激活曲线。因此网页端应保持车辆逻辑根、阴影和箭头稳定，只对车身模型应用位移/旋转响应。
- BlendTree 方向位置为：`(-1,0)=Right`、`(1,0)=Left`、`(0,-1)=Front`、`(0,1)=Back`、`(0,0)=Idle`。碰撞方向来自攻击车 forward 经被撞车 world-to-local 变换后的二维向量。
- 已确认的 clip 形态是 Unity 曲线驱动的短促摆动，不应替换为自定义 tween。下一步提取全部 keyframe/tangent，并实现 Unity AnimationCurve 兼容采样。

## 2026-07-03 Phase 23 — 实现结论

- `MovingPathImpl` 的三次贝塞尔控制点是相对起点/终点的 offset；`Bessel3` 默认以 64 段烘焙弧长并按离散切线求值。Web 实现已遵循同一规则。
- `StateToStation` 的速度按路径长度在距离 2/5/12 三档间插值；`StateOutStation` 使用倒车 2.5、前进 10；`StateCollide` 使用距离 0.1/1/4.5 三档配置。
- 四向 `Bus_Hit_*.anim` 的 Euler/Position 全部关键帧与斜率已提取。clip 的 `weightedMode=0`，因此受击曲线使用标准 Unity Hermite 等价贝塞尔；移动配置的加权曲线使用时间轴三次贝塞尔反求参数。
- Level 数据位置处于 `GameScene.VehicleScale` 前的配置平面，碰撞体尺寸在计算接触距离前需除回 `mapScale`，否则 Level 1 初始紧邻车辆会被误判为零移动距离。
