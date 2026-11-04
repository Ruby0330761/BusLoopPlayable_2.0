# Findings

## 2026-11-03 闸机队列(type 4)、双层升降舱(type 5) 与「座位多于乘客」关卡的运行时语义

- **背景**：官方关卡库 A/B/E 三章共 456 个 `.asset`，其中 27 个（A/B 各 9、E 9）一直显示「暂不支持」。原因只有两类：容器类型 4/5，或某色座位数与乘客数不相等。放开导入前必须先有运行时可执行语义，否则只是把不可玩的关卡放进编辑器。
- **闸机队列(type 4)**：`gateQueuePathPoints[0]` 精确等于容器坐标、也精确等于车头位置；末点等于队尾。整车组沿路径首尾相接，间距是 `gateQueueGap`（实测 0.1 / 0.2）。朝向统一指向路径反向切线（`atan2(-tangent.x, -tangent.z)`），与编辑器「刷新队列」用的是同一公式。**实测按此规则重排 7 条直线/曲线队列，车辆坐标与作者摆放误差 0.0000**，说明路径点是唯一真源，不能改用车辆中心连线（会把曲线拉直）。
- **闸机玩法推断**：车头离场后整队前移一个车长 + 间距。这是从数据推出的——公开资料查不到玩法说明（该关卡包不在已发布版本的关卡编号内，商店页与攻略站均无电梯/闸机说明）。因此闸门车保持 `parked` 状态，用普通前向扫掠互相阻挡；后车天然被前车挡住，不需要额外状态机。
- **双层升降舱(type 5)**：两层车辆的世界坐标完全重叠（只差 `elevatorLayer`），所以**任何时候只能有一层进入碰撞场**。实现上把非活动层置为 `in-elevator`，`vehicle-collision` 的 `physicalVehicles` 过滤会自动排除它；该层清空后自动提升下一层。E-42/E-43 实测：上层 13/17 辆中只有 1 辆能开出（符合真实遮挡），其余被上层车阵挡住。
- **座位多于乘客**：A/B-165 与 E-38 是数据事实（E-38 总座位 392、乘客 220）。全部 456 关按色校验后**没有任何一关是座位不足**，所以规则应是「座位必须 ≥ 乘客」，多出的座位允许。运行时给这些颜色记账：当该色乘客（队列 + 源队列 + 传送带槽位）清零后，未满座的车到站时直接走正常离站流程；否则这批车永远无法满载，关卡必然死锁。
- **必须同步改的三处校验**：`scripts/unity-level-importer.mjs`（导入）、`scripts/unity-level-parser.mjs` 的 `validateParsedLevel`（抽取）、`src/level-editor-model.js` 的 `validateLevelDocument`（编辑器保存）。只改其中一处会导致「编辑器能存、导入被拒」或「导入成功、抽取出错」。
- **验证**：447 个正式关卡（456 减去 9 个引导关）全部通过 `validateUnityLevelSource` → `importUnityLevelAsset` → `new BusLoopGame` 三段，且推进 1 秒模拟无异常；浏览器实测 E-31 点击车头 42 后 43 接替 gateIndex 0 并移到原车头位置变为可点；E-42 场上是上层 34 辆、下层 15 辆隐藏，点下层车返回 `unavailable`、视图 `visible=false`。

**Why:** 「暂不支持」不是加载失败，而是导入白名单和座位等式两条硬校验；放开它们之前必须先补运行时，否则等于交付不可通关的关卡。

**How to apply:** 再遇到新增容器类型时，先查该类型在关卡数据里是否有唯一可推导的几何真源（这里是路径点）；有就在纯函数模块里复现，并用作者坐标做零误差回归，不要凭玩法猜测重写布局。判断关卡可解性时，先按色做「座位 ≥ 乘客」配平校验，再用 SCC/互锁检查；两步都过仍不能通关，才说明是求解器或引擎问题。

## 2026-11-03 没有装车的车库会在试玩首帧自己消失

- **症状**：编辑器里摆好车库、验证也通过，点「试玩」后场景里找不到车库。车库内车辆数为 0（编辑器画布上的蓝色角标就是 0）。
- **根因**：`BusLoopGame.refreshGarages()` 有两套语义共用一个判断——「车库最后一辆车已驶出 → 隐藏」。它只看 `vehicleIds.length === 0`，于是**摆放时就没装车**的空车库在第一次 `update()` 就被当成「已清空」，置 `hidden = true` 并追加 `garageClearedIds`（还会顺带触发 `garage_clear` 清空音效）。首帧之前车库是可见的，所以光看「视图对象存在、visible 为 true」会误判成没问题，必须推进一帧再看。
- **修复**：车库初始化时记下 `authoredEmpty`（`vehicleIds.length === 0`）。`refreshGarages()` 对这种车库直接跳过，不再隐藏、不再发清空事件；`buildGarageGraph()` 也把它排除在阻挡图外——**一个空布景车库带着实体 body/door 压在车阵上，会让底下那几辆车永久无法驶出**（level83 实测：车 36、40 被 `garage body` 卡死）。有车的车库行为完全不变，清空后照旧隐藏。
- **编辑器同时补一条 warning**（`validateLevelDocument`）：「车库 N 内没有车辆，试玩时它只作为布景显示」。空车库现在是合法布景，不报错，只提醒多半是忘了进容器放车。

**Why:** 「空」在车库这一种机制里有两个完全不同的含义（从未装车 / 已全部离开），用同一个状态位表达必然把前者当成后者。

**How to apply:** 判断「容器已清空」这类终态时，要区分初始状态和达成状态，初始化时就把「本来就没有内容」记下来；布景类容器若要保留可见，就必须同时从碰撞图里摘掉，否则会变成永久障碍。验证时要推进至少一帧（`game.update` / `__busLoop.step`），首帧前的可见性不代表运行时可见性。

## 2026-11-03 画布的 Y 轴必须跟试玩相机同向（+Z 朝下）

- **试玩相机在场地 +Z 侧俯视，所以屏幕上 +Z 朝下，不是朝上。** 编辑器画布一直用 `y = 中心 - z*scale`（教科书式「z 朝上」俯视图），于是整盘上下镜像。28 辆车的实测拟合给出矩阵 `[[+0.279, 0], [0, -0.120]]`，X 同向、Y 反向，残差 0.0023，误差不是"差不多"而是符号错。
- **车头箭头反向会让人觉得左右也翻了。** 画布 sprite 的鼻尖在局部 -Y，用 `context.rotate(θ)` 会让鼻尖指向 `(sinθ, -cosθ)`，而试玩指向 `(sinθ, cosθ)`；必须转 `180 - θ`。修好 Y 轴但不改 yaw 时，位置对了、箭头全反，主观感受仍是"镜像"。
- **别用截图肉眼判断方向。** 两次我都差点被“看着挺像”骗过去：第一次只验了变换函数（自洽），没验画布投影方向；第二次 X 轴归一化方式不同造成假差异。可靠做法是拿运行时相机把每辆车投到 NDC，再和画布坐标做相关系数与象限比对——修好后 X/Y 相关系数都是 1.000，68/68 车辆落在同一象限。
- **缩略图的约定和画布必须一起改**：`createProjection` 原来也是 `maxZ - z`，两处同错时互相印证，看起来"内部一致"。

**Why:** 投影方向错一半时，位置、车数、颜色分组全对，只有整盘翻转；这种错误最容易被"相对布局看起来没错"掩盖。

**How to apply:** 任何"编辑器预览 vs 运行时渲染"的 2D 投影，都要确认相机在哪个方向俯视，并写一条用运行时相机投影做基准的回归测试（相关系数 + 象限一致性），不要只测自己内部的往返一致性。

## 2026-11-03 编辑器画面和试玩画面不是同一套坐标

- **试玩画的是运行时坐标，编辑器画的是授权坐标，两者之间隔着 4 层变换**：`mapVehicleAreaBasePoint` 先围绕 `positionPivot` 乘 `positionUnitScale`（当前 0.7），做 Unity→world 缩放（×2），再按 `mirrorZ` 镜像 Z；然后 scene 还要绕车辆簇中心整体旋转 `rotationDegrees`，朝向同步镜像成 `180 - yaw`。少了任何一层，画面方向或疏密就对不上。
- **镜像比缩放更容易误判**：相对位置、车数、颜色分组全都对，只有整盘左右翻转，人的第一反应是「布局不一样」而不是「镜像了」。判断办法是找一个明显不对称的特征（本关是左上角孤立的粉色车和顶部那台绿色车），看它在两边是否处于同一象限。
- **车画多大也要跟着运行时走**。碰撞盒是 0.27×0.47（4 座），而试玩渲染的是归一化 3D 模型 `modelDepthBySeats × modelScale`（4 座 1.05×0.64 = 0.672），明显更长。用碰撞盒画，车与车的空隙会比游戏里大一圈，缩略图上尤其明显。1:1 不只是位置，还包括尺寸。
- **1:1 是可以用数值验证的**：拿运行时的 `mapVehicleAreaBasePoint` 当基准，把每辆车的映射结果和编辑器用的变换逐车对比，误差应该到机器精度（实测 8.9e-16）。这比截图肉眼比对可靠，也能挡住以后改调参时的漂移。

**Why:** 「看起来像不像」只能发现大偏差；坐标映射这种差一层就差很多的逻辑，必须拿运行时自己的函数当参照物做数值比对。

**How to apply:** 任何「编辑器预览」和「运行时渲染」并存的画面，先找到运行时那个映射函数，把它抽成共享模块双向使用（正向绘制 + 反向拾取），再写一条逐元素对比的回归测试。不要两边各写一份数学。

## 2026-11-03 编辑器的座位数不能靠真实尺寸区分

- **4 座和 6 座的真实碰撞尺寸只差 3%**（0.47157902 vs 0.486，宽度同为 0.27）。在画布上按真实比例画方块时，两者在屏幕上差不到一个像素，这是「编辑器里四人座和六人座没有区分」的根因，不是配色问题。
- **能区分的只有轮廓语义**：4 座按三厢车画（长车头 + 短舱 + 尾厢线），6 座按一厢车画（舱体接近满车长），10 座再长一截并带更多车顶接缝。座位数角标只在放大到车高 ≥62px 时出现，否则密集车阵会被标签糊住。
- **朝向箭头要单独画正三角，不能只靠车身矩形**。原始画法只有一块渐变矩形，即使有 yaw 也读不出方向；参考图是靠车头白色三角指示前向。箭头必须带深色描边，否则浅黄/白色车漆上看不见。
- **缩略图只读 `colorIndex` 是个长期潜伏的 bug**：红绿圣诞关卡是逐车 `colorOverrides.body` 染色，总览里却按图集色显示成粉色/蓝色，和编辑器内不一致。凡是「渲染 + 缩略图」两条路径，颜色解析必须共用同一函数。

**Why:** 用小尺寸几何差异表达信息是无效的；必须换成形状/描边这类与尺寸无关的视觉编码。

**How to apply:** 以后要给编辑器里的元素加「可区分属性」，先量一下两个取值在屏幕上差几像素；低于 3px 就改用形状、图标或标签，不要加大对比度硬撑。

## 2026-11-03 前贴开关有两个来源，打包器只读了一个

- **会话的 `preRoll: 0` 不会自动传达到打包器。** 运行时在 `main.js` 里用 `ACTIVE_PLAYABLE_SESSION.preRollEnabled === false` 把 `SCENE_TUNING.preRoll.enabled` 清零，但打包器和静态检查器直接读调参里的原始开关。只要调参快照里还是 `enabled: 1`，视频就会被打进单 HTML，运行时却从不播——Q159 的 AppLovin 包因此白背了 519 KB 的 TP1327.mp4。
- **这类不一致静态检查抓不到，因为它自己也读同一个错误来源。** `check-applovin-package.mjs` 的「configured pre-roll video inlined」在视频存在时是 PASS，于是打包器和检查器互相印证了一个错误结论。只有把包体按资源类型拆开、拿 data-uri 的 sha256 回查 `public/` 才暴露出来。
- 修法是把判定收敛成一个纯函数 `resolvePreRollAsset(tuning, activeSession)`：会话 opt-out 优先，其次调参开关，最后校验 asset 形状。三处共用同一个函数，才不会再出现「运行时不用、打包器照打」。
- 顺带记一条命名迁移坑：尾段字段已从 `stamina` 改为 `version`（`N`/`B`/`T`/`BT`，标识交付附加项）。旧的调参快照如果还带 `stamina`，导出会直接报 `tuning.exportNaming.stamina is not supported`，必须迁移快照而不是改回导出器。

**Why:** 打包器和检查器共用一个错误来源时，静态全绿也没有意义；真正有效的证据是把成品按资源拆开反查来源。

**How to apply:** 任何「tuning 开关 + session 覆盖」并存的字段，判定函数只能有一份；出包后抽查 `video/mp4`、`audio/mpeg` 这类大块 data-uri 是否真的会被运行时消费。

## 2026-11-02 事件音效的去重键不能带帧时间

- **`lastEvent` 会跨帧停留。** `vehicle-collision-contact` 是一次性事件，但碰撞动画期间它一直是 `lastEvent`；`main.js` 每帧都会把这个事件再次交给音频层。去重键里如果带 `timeKey`（帧时间），每帧都会被判定成新事件，音效就连环播放。Q24 实测一次碰撞响了 2 次、事件停留 4 帧。
- **正确做法是事件侧给稳定身份**：`recordEvent` 时盖 `collisionEventId: ++this.collisionContactEventId`，音频层用 `type:id` 做键。`vehicle-full` 早就这么做了（它的注释写着「lastEvent remains visible while the vehicle is driving away」），碰撞当时漏了。
- **待机手指和开场手指是两套开关。** `vehicleGuideHand.enabled` 控制「无操作 N 秒后出现」的常驻提示；`firstClickGuide` 控制开场高亮那一次。需求说「只在开局置灰时指引」时，要关的是前者。

**Why:** 这类重复触发不会报错、单测也测不出，只能靠「按帧模拟并计数播放次数」发现。

**How to apply:** 新增任何由 `lastEvent` 驱动的音效时，先确认事件是否有跨帧停留；有的话去重键必须是事件自身的 id，不能是时间。
## 2026-11-02 交付版本用最后一段命名；中心救援的引导不能锁输入

- **版本差异只改名字最后一段**：`...-渠道-步数-版本`，版本 `N`/`B`(BGM)/`T`(TP1326)/`BT`。不要在中部插入字段——需求方是按位置比对的。`applyPlayableDeliveryVariant()` 同时推导 `audio.bgm.enabled`、`preRoll` 和这段标签，四个变体共用一份调参文档，避免手工维护四份。
- **置灰就必须锁输入，否则遮罩是假的。** 需求方明确要求「置灰期间不允许操作」。`shouldBlockVehicleInput` 现在只在 `firstClickGuide.lockInput` 为真时锁；这个字段默认 0（保留给纯视觉提示的关卡），Q24 置 1。会话 schema `FIRST_CLICK_GUIDE_KEYS` 也要同步加字段，否则 stage.opening 里写了会被静默丢掉。
- **中心救援玩法里，开场引导目标本来就不可点**。原始盘面是封闭车环，雪橇在中心，任何朝向都被 3–6 辆车挡住。如果引导沿用「锁输入」逻辑，那 3 秒内玩家什么都不能点，等于开局卡死。现在 `firstClickGuide.lockInput` 默认 0，只做视觉强调；需要「点这辆才能开始」的关卡再显式打开。
- **会话里的 `exportNaming` 会覆盖 CLI 变体**。`artifacts/playable-session.json` 里若残留 `version` 字段，`--bgm/--preroll` 推出来的标签会被它盖掉，导出名还是 `-N`。变体开关要留给 CLI，会话只保留 materialCode。
- **调参快照要跟模板同步**：删掉 `exportNaming.stamina` 后旧快照仍带着它，`validateTuning` 直接报 `stamina is not supported` 拒绝导出。改命名结构时同步清理历史快照。

**Why:** 这四条都表现为「导出能跑但产物不对」或「开局体验卡住」，静态检查不会报错。

**How to apply:** 出多版本时逐版做字节校验（BGM mp3、前贴 mp4 的 base64 是否在包里），别只看文件名。
## 2026-11-02 步数限制是玩法字段，不是车型；雪橇和救护车必须分开判定

- **`ambulanceStepLimit` 是运行时唯一的步数字段，但它同时被当成车型开关。** `scene-view` 原本写 `const isAmbulance = Number.isInteger(vehicle.ambulanceStepLimit)`，`deriveLevelMechanics` 也按同一个字段统计救护车。结果：给圣诞雪橇加 35 步，雪橇会被换成救护车 FBX、拉进救护车乘客与倒计时音效，包体会凭空多出 292 KB 且画面变成救护车。
- 正确模型是两层：关卡文档用 `mechanism.stepLimited` 表示「这辆车吃步数」，`levelDocumentToRuntime` 再据此写 `ambulanceStepLimit`；视觉家族看 `mechanism.type`。`isAmbulanceVehicle` 现在先读 `mechanism.type`，只有完全没有 mechanism 的旧 catalog 数据才回退到「有步数就算救护车」。
- **红心徽标是通用 UI，不是救护车资源。** 单独把 `Main_Gamepanel_BubbleLove.png` 复制成 `/assets/unity/christmas/textures/step_heart.png` 挂进 `christmas` 清单，比让圣诞关卡去拉整个 ambulance 资源族干净；雪橇专属徽标还通过 `createAmbulanceStepBoard(bubbleTexture)` 显式传入。
- **「35 步跳转」的两半必须一起对：** 关卡里的 `stepLimit` 只负责红心倒数和失败判定，真正跳商店的是 `installGate.successfulOperationThreshold`。两处数字不一致时，红心还没走完就先跳（或走完了不跳）。`stepLimitedSledJumpOwnsEnding` 只在「有步数限制的非救护车 + 门槛等于步数」时压掉失败卡，否则第 35 步会同时出现商店跳转和 Game Over。
- **预算必须能覆盖阻塞闭包。** 中心雪橇的 6 台直接阻挡车背后是 28 台车的闭包；生成器用 `countCarsToClear` 做传递闭包计数并拒绝 `closure > stepLimit` 的关卡，避免做出「数学上救不出来」的板子。注意「按 peel 顺序排到雪橇可点」需要 60 次，但玩家的最优路线只需 28 次，所以校验用闭包而不是播放顺序。

**Why:** 前三项都不会报错——雪橇只是悄悄换成救护车模型、红心不出现、包体变大，静态检查全绿。

**How to apply:** 再给非救护车加步数限制时，只写 `mechanism.stepLimited + stepLimit`，不要改 `mechanism.type`；出包后确认 `Ambulance_001` / `Idle_girl_rescuer` 不在成品里，`stepBubble` 指向 `step_heart`。

## 2026-11-02 封闭车环的「中心车」永远开不出来；资源加载失败必须当失败

- **中心救援玩法的中心车在原始盘面里是不可点的。** 圣诞盘面是一圈车围成的封闭环，中心车朝任何方向开出去都会撞上 3–6 辆车（实测扫了 3020 个位置 × 24 个朝向，最好情况仍有 2 辆阻挡）。想把中心车做成开场引导目标，必须先按碰撞图开一条车道，而不是「挪一点位置」——车道间距 0.28、车宽 0.27，根本没有挪动空间。
- **开场引导必须指向真正可点的车。** 引导同时锁输入（`isVehicleInputLocked`），指向被挡的车会变成「点不动的高亮」，比没有引导更糟。生成器现在把雪橇转成朝车位（yaw 0）并按 `getBlockers` 移除挡路车，同时把移除后的可解性重新校验一遍。
- **页面「没报错但画面退化」是最难发现的一类。** 这次产物里混进了 `isAmbulanceVehicle is not defined`，三维资源全部回退成无贴图几何体：画布非空、无 404、无 console.error，旧的 13 项运行时检查全绿。新增 `RUNTIME-ASSETS-001` 直接读 `view.unityAssetsFailed`，并让 `scene-view` 把 `unityAssetsError` 一起吐出来。
- 顺带：`rebuildQueues` 支持把指定色号排到队首，用于「开场队列里要出现圣诞老人」。

**Why:** 前两条决定「引导指向谁」，第三条决定「怎么知道资源真的加载了」。三者都不会在类型检查或单元测试里暴露。

**How to apply:** 做中心车玩法时先跑一次 blocker 扫描确认中心车可点；加引导前核对锁定逻辑；出包后除看 PASS，还要确认 `RUNTIME-ASSETS-001` 是 pass 而不是被跳过。
## 2026-11-02 BGM 必须挂在可信手势之后，且不能进预加载池

- **素材来源要先翻工作区再动手创作。** 这次的圣诞曲其实早就在别的项目素材包里（`NutsSortJourney.../Q193bab文件夹/(素材)/40 Jingle Bells.wav`，旁边还有爱给网的《铃儿响叮当》）。先全局找 mp3/wav/m4a 再决定是否合成，能省掉自造音源带来的听感和授权解释成本。
- **现成 cue 直接循环一定爆音。** 这条录音音乐在 30.2 s 结束、后面是房间底噪，从最后一个样本绕回开头会跨乐句跳变。必须按小节找循环长度（用 onset 包络估速度 + 相位，取整小节），再把循环点之后的一小节交叉淡化进开头。交叉淡化方向是「后面的素材淡出、开头淡入」，反了会留下整段幅度的接缝（实测 seamJump 0.159 vs 正确 0.018）。
- **大小硬门槛是 5 MB（COMMON-ART-001，blocker）。** 27.6 s 立体声 320 kbps 光 base64 就 1.4 MB；56 kbps 单声道时成品 4.92 MB 只剩 84 KB 余量，40 kbps 才回到 4.84 MB。加 BGM 前先算：`base64 后字节 ≈ mp3 字节 × 1.34`，再从成品预算里减。

- **音频门控是硬规则，不是建议。** 平台检查里 `COMMON-STA-003` 要求 AudioContext 只在 pointerdown/click/touchstart 之后恢复；运行时门禁 `RUNTIME-AUDIO-001` 更严，交互前出现任何 `AudioContext.resume` / `decodeAudioData` / `BufferSource.start` 都判失败。所以 BGM 只能在「点击成功」之后启动，放 load、preload 或 `unlock()` 里都会挂检查。
- **BGM 要独立于特效池。** `audioConfig` 那套是解锁即预加载 + `resetEventHistory()` 清空音源（重开/换关会调）。把音乐塞进去，重开就会重启音乐、换关会断。现在单独存 `this.bgm`，`resetEventHistory` 刻意不碰它。
- **音乐资源不会自动内联。** 单 HTML 打包器只收集关卡文档、CSS、tuning 里的背景/icon/logo 和机制清单；BGM 路径在 `audio.bgm.asset` 里，必须显式 add，否则成品包请求根相对路径，控制台只留一行 404 警告，不报错、不阻断导出。
- **合成音乐的两个典型坑**：包络每 N 个样本重置成常量（听起来像每个音都在咔哒）；旋律表长度超过循环长度（越界截断 + 出现空洞）。前者要在 sample 级做指数衰减，后者要保证 beat 偏移全部落在 `[0, 循环拍数)` 内，并把尾音折回开头做无缝循环。

**Why:** 这四条都静默——不挂检查、不报错、听着「有声音」但循环处咔哒或中途空一段，只有逐个样本量 RMS 和跨接缝跳变才看得出来。

**How to apply:** 给新关卡加 BGM 时：开 `audio.bgm.enabled`、确认调参里有 asset、跑一次导出再看 `reports/*runtime*.json` 的 `RUNTIME-AUDIO-001/002`，最后在真实浏览器里数「循环音源只在首次点车后出现一次」。
## 2026-10-30 命名 11 段与 Bus 单包双端：会话会覆盖调参，变体数组会丢设备列表

- **命名末尾两段不能再靠"空值裁掉"**。需求方给的交付名是 11 段（`需求-素材-前贴-N-语言-PL-设计师-需求人-渠道-步数-体力`），前贴后固定 `N`、末尾步数/体力无值写 `N`。`buildPlayableArtifactName` 里这两段必须用 `|| 'N'` 兜底；用 `??` 会让编辑器清空输入后整段消失，文件名少两段但静态检查照样通过。
- **`artifacts/playable-session.json` 的 `exportNaming` 覆盖 tuning**。`applySessionExportNaming` 是展开合并，会话里写了 `materialCode` 就赢过 `--tuning-json`。改交付命名时两处都要改，否则会导出 `Q24V1` 而你以为改成了 `Q158V1`。
- **Bus 双端合并的正确落点是"资源 + 运行时"，不是"两份文件"**。`branding.icon.deviceAssets` 存两端 icon，`resolveBrandingIconAsset` 在非编辑器构建里按 UA 选；打包器的 `collectAssetUrls` 要把 `deviceAssets` 的值一起收集，否则只内联当前那一个，另一端是根相对 URL。编辑器内保持 Icon 版本选择器优先，否则操作员一换预览就跳回去。
- **变体数组必须携带 `runtimeDevices`**。单平台导出走默认 `buildVariants`，全平台走 `brandingVariants.map(({id, suffix}) => ...)`——后者只挑两个字段会把设备列表丢掉，于是同一份双端包只跑了一个 UA 的 smoke，报告全绿却没有 iOS 证据。现在两处都传，且第二份报告作为 `runtime-ios.json` 一并归档。

**Why:** 这四个问题都静默：文件名少段、会话覆盖调参、另一端资源缺失、少跑一份 smoke，静态规则全都 PASS，只有逐字比对交付名或在真机 UA 下打开才暴露。

**How to apply:** 出包后先逐字比对文件名与需求清单；再对同一份 HTML 分别用 Android/iOS UA 打开，确认 icon 的 MIME 与 CTA 商店域名都跟着变。

## 2026-11-04 BL 单平台导出曾按「预览选中的 icon」烘包，双端映射必须由导出器写死

- 现象：编辑器「Icon 版本」选 iOS 后导出 BL AppLovin 包，包里 `deviceAssets.android` 和 `asset` 都成了 iOS 的 PNG——Android 玩家会看到 iOS 图标。全平台导出没这个问题，因为那条路径走了品牌变体。
- 根因：`exportPlayablePackage` 对 BL 传 `variants: null`，刻意跳过 `createBrandingVariantTuning`，于是 `applyWorkspaceBrandingIcon()` 直接把调参里的 `branding.icon.asset` 写进 `index.html` 的 `<img id="branding-icon">`，`deviceAssets` 里的 android 槽位又用 `document.getElementById(...).src` 指回那张图。
- 修复：BL 与 BFT 一样必经品牌变体；BL 变体固定 `iconAssets = { android: icon-android.jpg, ios: icon-ios.png }`，并补 `logoAsset = main-loading-icon-small.png`（否则预览停在 BFT 时会带出 BFT 的 Logo）。
- **UI 文案不等于数据**：`BL 安卓` / `BL iOS` 只是预览选择器，不代表导出变体。任何时候看到「按机型切换」的需求，检查的落点应是导出器写出的 `deviceAssets` 两个槽位，而不是编辑器下拉框。
- 该行为目前没有自动化门禁，本次用独立 Chrome + `Emulation.setUserAgentOverride` 实测（iOS PNG 122,838 字符 / Android JPG 119,191 字符）；改品牌注入后要重跑这条手测。

## 2026-10-30 单 HTML 打包器的机制资源根是硬编码的；雪橇换座会造出 blocker 环

- **`replaceBundledDynamicAssetUrls` 只认 `/assets/unity/mechanisms`。** 机制素材在 bundle 里是 `${ROOT}/models/x.fbx` 这种模板字符串，完整 URL 从不出现，所以普通字符串替换扫不到；打包器专门用「根前缀 + 尾部」正则在回写 data URI。圣诞资源挂在 `/assets/unity/christmas` 下，于是清单里内联了、bundle 里却没替换，成品运行时去请求 `/assets/unity/christmas/textures/Idle_boy_Santa.png` 报 404。现在根改成 `DYNAMIC_MECHANISM_ROOTS` 列表；**以后新增任何顶层资源根的机制族，必须同时加进这张表**，否则静态检查全绿、只有运行时门禁能抓到。
- **雪橇是 10 座车体。** `scene-view` 用 `prepareVehicleTemplate(vehicleFbx, 10)` 烘焙，车长按 10 座缩放。把 6 座的中心车直接改成雪橇，碰撞盒仍是 6 座，视觉会比碰撞盒大一截；改成 10 座才是对的，但车长 +0.19 会让中心车和左下方三辆车锁成 10 车 blocker 环（`clearable 60/70`）。沿 -Z 平移 0.03 即解开，画面几乎看不出。
- **渐变配色不能靠 colorIndex 的裸图集。** Q7V3 的深红/红/森林绿是用 `colorOverrides.body` 染色出来的，对应索引 4/2/8 的裸图集其实是红/粉/棕。想复现色参图必须连 `passengerColorOverrides` 一起带，否则车和乘客颜色对不上。

**Why:** 前两条都不会在开发模式暴露——本地 404 只是控制台一行、合成包才致命；座位数和碰撞盒的关系也不在关卡文档里。

**How to apply:** 出包前跑 `check-playable-runtime.mjs`（它会抓 404）；把关卡里的特殊车换成雪橇时，先确认 `clearable == total`，不成立就微调 0.03 级别的位置再复核。
## 2026-10-29 VATM 的 vatIndex 必须写 uint32；星形跑道样条要按车道带中线算

- **`vatIndex` 是整数列号，不是浮点数。** `loadVatGeometry` 用 `DataView.getUint32` 读 VATM v2 尾部那段；如果生成端写成 `Float32Array`，1.0 的字节是 `0x3F800000`，读回来是 1065353216，shader 用 `(vatIndex + 0.5) / textureWidth` 采样就飞到纹理之外，所有顶点塌缩到一点。渲染结果是**网格存在、`visible === true`、包围盒正常，但屏幕上一个像素都没有**，只留下脚下那片影子。排查这类"人不见了但影子还在"时，先打印 `geometry.attributes.vatIndex` 的前几个值。
- **跑道样条的贴合度要用"带内位置百分比"量，不能只看"是否出轨"。** `starLoop` 的旧样条 100% 落在车道带内，但位置在 16%~55% 之间跳（理想 50%），表现就是小人一会贴内沿一会贴外沿，星形凹口处外侧留下大片空白。正确做法：以星形孔的质心为原点、按角度做射线，取车道带的 `[进入, 离开]` 区间中点，把控制点投影到这个中线上；需要"更往里"时再按 `start + (end-start) * bias` 取偏置，bias 0.35 仍有 48px 离边余量。
- 画的核对脚本思路：把控制点经 `toWorldPoint` + `transformCurveCoordinates` 转到世界坐标，再按 `art` 平面的 `x/z/width/depth` 映射到原画像素，直接采样 PNG 的 alpha 判断是否在路面上。

**Why:** 这两个问题都不会报错——一个静默渲染成"不存在"，一个静默渲染成"不好看"，静态检查和运行时冒烟都发现不了。

**How to apply:** 新增 Unity VAT 乘客时，转换完先断言 `vatIndex` 前几位是 `0,1,2,3`；调整跑道样条时，先算带内位置百分比与标准差，再决定往哪个方向偏。

## 2026-10-29 圣诞素材：一个 FBX 三材质槽共用一张图集，色号 16 不能进识图调色板

- `Sled_001.FBX` 的三个材质槽（`Material #202` / `08 - Default1` / `20 - Default`）全部指向 `Textures/Car_0307/Idle_boy_Santa.png`，所以运行时**车辆和乘客共用同一张贴图**；`Sled_001/002/003.mat` 引用的贴图 GUID 也完全一致（`fd38e7d65d43beb4593f978ec8ff4126`），交付里只给一张图是完整的，不是缺文件。
- Unity 的 mesh 顶点数据是**按 stream 分块连续存放**，不是逐顶点交错：stream 0（position/normal/tangent）占满 `vertexCount * 32` 字节后，stream 1 的 UV 才从 `vertexCount * stride` 开始。按交错读会把 UV 读成位置数据（表现为 bbox 越界、UV 出现负数）。`m_DataSize` 还可能比 `vertexCount * stride` 多几个字节的尾部对齐填充，不能拿它反推 stride。
- 乘客动画 `Idle_boy_Santa_positions.ssvat` 是 SSVT v1：`magic + version + vertexCount + frameCount`，随后每帧每顶点 4 个 half float（xyz + 常量 w=1）。102 帧按 `Idle_boy_Santa_animation.asset` 切分：0 静置、1–61 `Passenger_Idle`、62–81 `Passenger_Move`、82–101 `MoveToBus`；运行时只用 idle/move。
- **色号 16 必须从识图调色板里排除**。把它作为普通 `VEHICLE_COLOR_OPTIONS` 条目后，`#C62828` 与红色（`#B10F11`）足够接近，照片里的红车会被 `nearestPaletteColor` 判成圣诞，既有识图回归测试直接红。正确模型是「运行时车型」：允许出现在关卡数据与导入器里，但不参与照片颜色识别、也不进可涂装色列表。

**Why:** 这类补充素材的贴图与坐标约定不在代码里，只能从交付原文推导；错了不会报错，只会静默渲染成怪形状或错色。

**How to apply:** 再加同类 Unity 顶点动画乘客时，直接用 `scripts/extract-unity-santa-vat.mjs` 当模板，并先跑一遍「bbox/UV 与同资源 FBX 对照」再接入。

## 2026-10-29 `ConveyorBelt_Footage*` 家族跑道的饱满度校准、3D 身高视差与 `passengerViews` 池尾部清理

- **Prefab 局部坐标到 `conveyor-layouts.js` 场景坐标的基准转换**：`ConveyorBelt_Footage.prefab`（starLoop）、`ConveyorBelt_Footage2.prefab`（heartLoop）、`ConveyorBelt_Footage3.prefab`（catLoop）共用 `Loop_13` 精灵变换（`localPosition: (0, -0.24, 1.8), localScale: 0.43`），局部点到场景坐标的基准公式为 `out_x = 0.826305 * raw_x - 0.004829, out_z = 0.826305 * raw_z + 14.2367365`，对应 `art: { x: 0, y: -0.045, z: -5.3394, width: 16.685, depth: 10.3288 }` 与全图 `spriteRect (2100 × 1300)`。
- **为什么原版参考图（Level 85/102/156）显得小人饱满而原始 Prefab 点位显得内缩**：
  1. 三次均匀 B 样条对星角、心瓣、猫耳等高曲率处有削峰内缩效应，且 `Footage3` 猫头顶控制点 `6/7/8` 在原 Prefab 里掉到了 `y=833`（低于猫头内框 `y=822`）；必须将控制点向外白边方向外扩，并把猫头顶修正为 `y≈788` 的平滑单弧。
  2. **3D 小人身高带来的屏幕纵向视差（Parallax）**：小人高 `0.48`，在 61° 俯视相机下，圆球头顶比脚底在屏幕上方（贴图 `-y`）偏移约 `22~26px`。若不补偿，上半圈头顶会冒出上白边而脚底留灰缝，下半圈则会往内圈缩而外侧留灰边。将主环控制点整体向贴图 `+y` 下移约 `22px` 并微扩下半圈横向宽度即可消除视差。
  3. **内圈白框孔洞需与小人内包络线等距**：原贴图内圈孔洞偏小，导致上半圈灰带宽度超过 4 人排宽（`~115px`）。对环道内部做平滑径向放大（外圈权重平滑衰减为 0，保持外白边与手臂不变），使内圈白框紧贴小人内侧脚底，即可实现外贴外白边、内贴内白框的饱满效果。
- **切换不同容量跑道时必须隐藏 `this.passengerViews` 池的尾部多余视图**：`SceneView.update` 在遍历 `snapshot.slots` 后必须将 `index >= snapshot.slots.length` 的视图置为 `visible = false`，否则从 60 容量的 `catLoop` 切到 45 容量的 `heartLoop` 会在入口处残留 15 排僵死小人。

## 2026-10-26 同一个「level2」在仓库和远端是两张不同的盘面

- 需求 Q22 写的「游戏内 lv2」指的是 Unity 里序号 2 的那张矩形盘面：12 辆车、每辆 10 座、只有 4 个颜色（3/2/3/4 辆），远端编辑器里存成 `level45`，`displayName: "level2"`、`unityId: 9804`。
- 但本仓库的 `artifacts/web-levels/level2.json` 是 `displayName: "Q7V1改"`、`unityId: 52`、84 辆车的另一张盘面。会话配置一旦写成 `levelKey: "level2"`，导出出来的就是 Q7V1改，与需求方给的那个单关包完全不是同一关。
- 判别方法：不要按 `key` 或 `displayName` 认关卡，要看 `unityId` + 车辆数。需求方给的包可以从 HTML 里抽出关卡字面量（`{id:<unityId>,mapScale,...}`）反查。
- 处理：远端文档取回后存为 `artifacts/web-levels/level9804.json`（`key` 改成 `level9804`，`displayName` 保留 `level2`），Q22 矩形版指向它。远端卷不会被镜像重新播种，所以新增关卡文件只影响本地与后续部署包。

## 2026-10-26 lv154 / lv12 在 4 车位下我的离线求解器打不通（未定性为死局）

- Q22 的两张困难关：lv154（50 辆、380 座、9 色、队列 178+202）和 lv12（94 辆、438 座、9 色）。
- 用 `BusLoopGame` 离线模拟，多种策略都提前判负：队列头部颜色优先、传送带颜色加权（权重 3/10）、前瞻窗口 4~30、随机重启 40 次。lv154 最好约 19 辆（剩 35），lv12 最好 30 辆（剩 68）。判负条件是「车位全停满 + 传送带 32 格全满 + 无可上客车」，属于资源耗尽。
- **这不是死局的证据**：把车位数拉到 5/6/8/10 依然打不通，说明瓶颈不是车位。而且按色统计，四关的座位总数与乘客总数完全相等（lv154 380/380、lv12 438/438），没有任何颜色缺座，关卡数据本身是配平的。
- **以下两条早期的推断已被推翻**：
  - 「与 `ConveyorBelt3` 缺布局有关」——不对。参考交付包同样用 `dualQueue3` 渲染，且我已确认我们的 lv154 / lv2 关卡数据与参考包逐字段一致（车辆 50 辆、队列、`mapScale 1.33` 全部相同）。数据与配置都不是差异来源。
  - 「大概率死局」——证据不足，应改为「我的离线策略不够好」。Q22 的参考包在 4 车位下本来就是可交付的状态，真实玩家能否通关需要人工实测，不能用贪心求解器下结论。
- 教训：离线求解器只能证明「这样打不通」，不能证明「打不通」。把求解失败写成关卡死局前，先做一次配平校验（每色座位数 ≥ 该色乘客数）和参数扫描，这两项都通过时，结论应该指向求解器而不是关卡。

## 2026-10-23 黑车白车导出后变蓝：数据卷里的旧 catalog 只带 11 张色卡图集

- 现象：线上编辑器里 BL-2610132（level38）黑车、白车显示正常，导出的单 HTML 里它们全变成蓝色。
- 根因不在调色，而在**色卡图集数组缺槽位**。该关使用色号 `17`（黑，22 辆）与 `18`（白，31 辆），但导出包里 `colorTextures` 只有 **11 项**（色号 0–10）。`scene-view.js` 取图集写的是 `this.vehicleColorTextures[i] ?? this.vehicleColorTextures[0]`，索引越界就静默回落到 0 号，即蓝色。
- 缺槽位的来源：`Dockerfile` 设了 `PLAYABLE_LEVEL_CATALOG_PATH=/app/artifacts/level-catalog.js`，而 `/app/artifacts` 是**数据卷**，`start.sh` 只在首次播种（`.seeded-v1` 标记）时把镜像里的 catalog 拷过去，之后永不更新。该卷里的 catalog 停留在色卡补充（10-13 加入色号 17–25）之前。`generate-active-level.mjs` 的 web 关卡路径固定用 `LEVEL_CATALOG.level5` 当 assets 基底，于是关卡车辆带 17/18，图集表却还是 11 项。编辑器预览走镜像内新打包的 catalog，所以两边表现不一致。
- 复现方法（不要靠猜）：拿旧版 catalog 文本当 `PLAYABLE_LEVEL_CATALOG_PATH`，把远端 `GET /__level-authoring/<key>` 的文档拼成一个 level 条目跑 `generate-active-level.mjs`，生成的 `PLAYABLE_LEVEL_SEQUENCE[0].assets.colorTextures.length` 就是 11。
- 实测证据（真实 Chrome 打开成品，按 `material.map.source` 反查图集槽位）：坏包 `colour 17 -> atlas {"0":22}`、`colour 18 -> atlas {"0":31}`；修复后 `colour 17 -> {"17":22}`、`colour 18 -> {"18":31}`，其余色号一一对应。
- 修复：新增 `src/color-atlases.js` 作为色号→图集的**唯一来源**（26 槽，11–16 显式留空给特殊车辆）。`scripts/generate-active-level.mjs` 的两条解析路径（web 关卡与 catalog 关卡）都过 `completeColorAtlases()`；`src/level-data.js` 的 `setActiveLevel` 与初始 `LEVEL_1` 也补齐，所以编辑器预览路径同样不会回落。
- 教训：**色卡表不能只存在生成的 catalog 里**。任何"随关卡数据一起下发的资源清单"一旦和远端数据卷里的旧副本绑定，就会在补资源时静默退化；资源清单要放在代码里，缺槽位要在运行时补齐而不是靠 `?? [0]`。
- 顺带确认的边界：`?? [0]` 这类回退不会报错也不会打日志，静态检查和运行时冒烟都不会发现——这类"颜色不对"只能用渲染后反查材质绑定的方式验证。


## 2026-10-23 导出被 payload 扫描拦下：CSS 重复 url 与 loading 图标各算一次重复内联

- `export:playable --platform applovin` 曾在本仓库基线直接失败，报 `FINAL_PAYLOAD_DUPLICATE_WASTE, FINAL_PAYLOAD_DUPLICATE_WASTE`。`deploy-tools/.../scan_candidate_payloads.py` 的默认阈值是 **4,096 B**：成品里同一段 base64 出现第二次、且浪费字节 ≥ 4 KB，就阻断导出。
- 两个肇事资源分别是 `public/assets/applovin/icon_q75.jpg`（51,911 B）和 `speed-toggle-bg_q90.webp`（19,258 B），都是**合法资源**，问题只在被嵌入两次：
  - 加载图标：`index.html` 的 `<img id="loading-icon">` 与 `SCENE_TUNING.branding.loading.icon` 各一份——前者是 DOM，后者是 JS 字面量。
  - 倍速底图：`src/styles.css` 的 `.speed-toggle` 与 `.speed-toggle:hover` 各写了一遍 `url(...)`。第二条是为了擦掉共享 `button:hover` 的 `translateY(-1px)`（会顶掉居中用的 `translate(-50%,-50%)`），不是冗余规则，所以不能删 hover；改成 CSS 自定义属性只声明一次 url。
- `reuseDocumentImageAsset` 的复用名单必须包含 `loading-icon`，而且**不能改成删掉调参里的 icon 字段**：`main.js` 用 `loadingIcon.getAttribute('src') !== iconSource` 判断是否回写，字面量与 DOM 不同就会每次启动重设一遍。
- 定位方法：别猜。`python3 deploy-tools/build-verified-playable-packages/scripts/scan_candidate_payloads.py --artifact <成品> --platform applovin --output /tmp/p.json` 会列出重复组的 sha256、浪费字节和 `origins`（`#data-uri-N` 序号）；拿 sha256 去 `public/` 逐个比对即可锁定具体文件。

## 2026-10-21 Crowd 试玩是 iOS/Android 共用一套包

- Bus Fever 的交付习惯是「同一份 HTML 只换 Icon 与商店链接，出 `-Android` / `-iOS` 两包」。Crowd 不是这样：它只有一套品牌资源，两个商店看到同一个包，所以导出器需要区分「套系（branding set）」而不是固定按两个变体展开。
- 实现：`PLAYABLE_BRANDING_SETS.bus` = android/ios 两个变体；`PLAYABLE_BRANDING_SETS.crowd` = 单个 `crowd` 变体，同时覆盖 `branding.icon.asset` 与 `branding.logo.asset`。Bus 变体只换 Icon，Logo 继续跟随编辑器的 `Logo 版本`，避免旧流程被暗改。
- 关键坑：导出源缓存会把「首个变体的品牌图」烘进 HTML 再复用。缓存 key 必须包含 variants，否则先导 Bus 再导 Crowd 会拿到 Bus 品牌图（或反过来）。
- 另一个坑：单 HTML 打包时文档里的 `<img id="branding-icon"|"branding-logo">` 已经内联为 data URI，tuning 字面量若再嵌一份同样的 base64，包体会翻倍（Logo 约 170 KB）。两处都要用 `reuseDocumentImageAsset` 指回 DOM。
- 品牌文案：Crowd 套会把仍是默认值（`Bus Fever Party!` 或空）的底部文本与加载页标题改成 `Bus Crowd`，自定义文案保持不动。加载页图标跟随品牌 Icon，不能把同一张图既写进 `<img>` 又写进 tuning 字面量——payload 扫描会以 `FINAL_PAYLOAD_DUPLICATE_WASTE` 拒绝。

## 2026-10-20 车位描边比车小；离场瞬间残留上车小人

- **描边尺寸**：车位白线是共用美术，按"一辆标称车"画的。实测 10 座车车身 0.762×1.753（车位本地空间），描边只有 0.36×0.70，覆盖率 0.47×0.40——车明显溢出自己的车位框。层级本身没问题：描边顶面在车底下方 4mm，中心偏差 0.001。
- 修复：`src/scene-view.js` 新增 `updateSpotOutlineSize()` + `measureVehicleModelSize()`，把描边按车位上的车等比放大（`SPOT_OUTLINE_FIT = 1.08`），空车位保持原尺寸。修复后覆盖率 1.08×1.08，描边仍贴地。
- **关键坑**：不能用 `userData.templateSize` 算尺寸——它是 Unity 碰撞尺寸（0.27×0.678），比渲染出来的车模小得多，用它会把描边缩小到 0.47 倍。也不能用世界 AABB：车位有 16° 偏航，AABB 会撑大。正确做法是在模型本地坐标量尺寸、再乘实时渲染缩放。
- **残留小人**：上车行人的视觉目标固定为**车位坐标**，与车本身脱钩。车离开时若还有行人没走完，他们会继续走到空车位并停在那里（截图里"车最后一帧后面站个小人"）。修复：`updateBoardingViews()` 检测到该车已进入 `departing`/`done` 就立即回收未落地的行人，并补发上车音效避免音效丢失。
- 验证：真实 Chrome 连跑 3 辆 10 座车，离场后 `boardingViews` 残留均为 0；描边覆盖率 1.08；`node --test` 312/312。

## 2026-10-19 车库/容器碰撞点坐标空间用错：特效飘到传送带出口

- 现象：点车阵里被挡住的车，撞击白光和飞散粒子出现在画面上方的传送带出口旁，离被点的车很远（用户截图红框）。
- 根因：`findCollisionContact()` 返回的 `contactPosition` 是**关卡源空间坐标**（与 `vehicle.x/z` 同一套），但 `vehicle-effects.js` 的 `spawnHit` 注释假设它已是世界坐标，直接 `new THREE.Vector3(x, y, z)` 丢进场景。车辆→车辆碰撞走的是两个 view 的中点（世界坐标），所以只有**容器类碰撞（车库/传送带墙/门）**会错位。
- 实测（Q21 level20，真实 Chrome）：同一辆车被车库挡住，接触点源空间 `(1.96, -0.19)` 映射到世界后是 `(3.14, 6.36)`。特效距被撞车 **6.89** 个世界单位；修复后 **0.38**（正好在车头接触点）。Node 侧遍历 6 个容器阻挡样本，误差 6.7–11.2 单位。
- 修复：`VehicleEffects` 新增 `mapContactPoint` 注入点，`scene-view.js` 传入 `mapMotionPoint`（源空间 → 镜像/旋转/缩放后的世界空间）。没有注入时保持旧行为（测试与离线用法不受影响）。
- 排查提示：任何来自 `game-model` 的坐标（`contactPosition`、`vehicle.x/z`、`spot.x/z`）都是源空间，必须经 `mapMotionPoint`/`mapVehicleAreaBasePoint` 才能进 Three.js 场景。不要因为某个字段"看起来像世界坐标"就直接用。

## 2026-10-19 碰撞：特效丢失来自事件覆盖，距离过远来自未限制的冲撞行程

- "点了车有碰撞但看不到效果"：`vehicle-effects.js` 的 `spawnSnapshotEvents` 只读 `snapshot.lastEvent`，同帧内碰撞接触事件被后面的"小人上车"覆盖时，撞击粒子就不会生成。与音效是同一个根因，现已让它消费整帧 `frameAudioEvents` 里的全部 `vehicle-collision-contact`（去重键不变）。
- "碰撞效果距离很远"：碰撞判定选中的障碍可能在很远处。实测 10 座车 id=4 的阻挡者是 1.428 单位外的 6 座车（正前方 0.1 单位就有别的车），车要冲过去 0.954 单位（约 1.4 倍自身车长）才触发撞击，视觉上就是"特效出现在很远的地方"。
- 修复方式：新增 `collision.maxBumpDistance`（默认 0.5，0=不限制）。它只限制**冲撞动画的行程**，阻挡判定完全不变——车会提前在障碍前停下触发撞击；真实间隙保存在 `collision.actualDistance` 供排查。
- 实测：上限 0.5 时动画最远 0.5，未限制时最远 0.716；16 次与 19 次碰撞全部正常生成特效。
- 注意：阻挡者的选择本身没有改动（仍按碰撞图 + 前方扫描，取最近接触）。如果某些位置"明明贴着却被远处车挡"，那是布局/碰撞图问题，需要看具体车位坐标再调。

## 2026-10-19 离场终点 Z 偏移方向反了；预览线与实际路径改为共用构建函数

- 现象：编辑器里调「离场终点 Z 偏移」，车不是往想的方向走——用户反馈"出去的时候太靠上"。
- 根因：`exitTargetZOffset` 直接加在源空间 z 上（`forwardStart.z + offset`），而源空间经过 `vehicleArea.mirrorZ = true` 与 `rotationDegrees` 之后方向是反的。实测：offset = +1.0 时终点屏幕 y 从 251 变成 218（上移），offset = -1.0 时变成 309（下移）——与编辑器字段语义相反。
- 修复：新增 `buildDepartureForwardPoints()` 统一做视觉方向 → 源空间的换算（`z = forwardStart.z - exitTargetZOffset`），并让 `game-model.js`（真实行驶）与 `scene-view.js`（编辑器预览线）都调用它。此前两处各写一遍同样的坐标算式，是这类方向错误容易复发的地方。
- 实测（修复后）：offset -1 → 终点 y=192（上），0 → 251，+1 → 309（下），符合"正值=往下（远离镜头）"的直觉。
- 附带确认：预览线和车辆实际路径逐点吻合（起点 99,232 → 倒车到 80,251 → 右行到 399,251），不存在"预览画一条、车走另一条"的问题。
- 若仍想让整条离场轨迹整体下移，用「倒车距离」（backDistance，实测 0.5→1.2 让离场线从 y=251 降到 y=276）；它移动的是倒车终点和整条右行段，比终点 Z 偏移影响更全面。

## 2026-10-19 离场车必须降到线的高度上行驶，不能把线抬到车层

- 现象：满载车辆离场时不再贴着编辑器画的黄色离场路径走，线单独横在车下方的路面上。
- 根因：当天的车位层级修复为了修"车位描边压车"，把离场高度从 `vehicleDeparturePath.y`（-1）改成了 `vehicleArea.y`（0.035）。线的位置没动，于是车和线在屏幕上错开约 60 个设计像素（390 宽视口实测 22～53 CSS px）。注意：`-1` 并不是"把线藏到地面下"——线材质带 `depthTest:false`，它一直是可见的，`-1` 的语义是"这条离场车道在屏幕上比车位行更低"。
- **正确修法（用户确认）：线保持原位，让车降到线的高度行驶**，即离场分支用 `vehicleDeparturePath.y`。曾试过的"把 `vehicleDeparturePath.y` 提到 0.035 让线来贴车"是方向反的，已撤销。
- 实现：`src/scene-view.js` 的离场分支恢复 `const departureY = SCENE_TUNING.vehicleDeparturePath?.y ?? SCENE_TUNING.vehicleArea.y`；`src/main.js` 的 `migrateDepartureRouteHeightTuning/Profiles` 负责把被错误写进缓存的 0.035（= 车辆层高度）改回作者值，操作者自定义的其他高度不动。
- 编辑器字段标签改为「离场高度（线与车）」，因为这个值同时决定线的位置和车辆的离场高度。
- 实测（真实 Chrome，390 宽）：车与线在同一路段屏幕 y 差值为 0，车沿线下行；修复前差 53.5 CSS px。
- 相关：车位描边仍压在车辆层之下，离场车降到 `-1` 后在车位附近与描边重叠时会被描边遮住——这是"车走在这条车道"的必然结果，用户已确认接受。

## 2026-10-19 音效"有的不响"来自帧内事件覆盖；偏移参数本身已实测生效

- `lastEvent` 每帧只保留最后一次赋值，而一帧内可能同时发生"车辆满载开走"和"小人上车"。音效层读 `lastEvent` 时，先发生的事件被后面的覆盖 → 开出音效/撞击音效被吞。实测修复前 4 次出发只响 2 次。
- 修复：引擎新增 `frameAudioEvents`，每帧清空并累积所有音效相关事件（`recordEvent` 写入），快照暴露该列表；运行时逐个播放列表内事件，再补播 `lastEvent`（音频层按事件键去重，不会重复）。
- 音效延迟参数（`audio.busHitDelay/busFullDelay/passengerUpDelay`，正值=推后）通过 `GameAudioController` 的 `getDelay` → `source.start(context.currentTime + delay)` 实现；`passengers.aboardSoundOffset`（负值=提前）仍然控制进车音效的触发时刻。
- 偏移有效性实测（线上导出包）：`aboardSoundOffset = -0.25` 时，音效触发比小人到位时刻早 0.21～0.31 秒，证明参数链路正常。旧导出包不含此能力，必须重新导出。
- 感知提示：进车动画本身约 0.4～0.5 秒；若仍觉得晚，把偏移调到 -0.4 ~ -0.5 可让音效贴近"小人开始移动"的那一刻。音效文件自带 32～42ms 开头静音，属正常范围。

## 2026-10-19 车位与车辆的上下层级：描边贴地、车辆在地面层

- 车位"穿模"不是落位偏移：实测车辆中心与车位中心屏幕投影重合（408.5 vs 408.6）。根因是车位描边模型本身是一块有厚度（约 5cm）的立体贴片，顶面高于车底，斜视角下白线就画到了车身上。车位框 0.532 × 0.949 也比车身小（6 座车 0.665 × 0.947），但即使改尺寸也解决不了"白线在车身上"的层级问题。
- 用户确认的方案是**描边常显、放在车辆下一层**，车从上面开过去。实现：描边 Y 压到 2% 厚度，顶面沉到车底下方 4mm（描边顶 0.031 / 车底 0.035）。曾试过的"占用时隐藏描边"被否决并完整撤除。
- **`vehicleDeparturePath.y` 同时控制离场路径线的高度和离场车辆的行驶高度**（两者必须一致，否则车会脱离线）。车位层级修复期间曾把车辆离场高度改成 `vehicleArea.y`，导致车与线分离，现已恢复为该值。它曾被误认为"调到 -1 是为了让线看不见"——线材质带 `depthTest:false`，-1 只是让线在屏幕上更低，落在路面上。
- 车位描边对齐必须在车位根的局部坐标里算，因为 `applyTuning()` 在 `upgradeSpotViews()` 之后才设置车位世界位置；直接量世界坐标会得到旧值。
- 若日后调大 `parkingSpots` 的 Y 或描边厚度、或把车辆层压到 0.035 以下，压车问题会复发。

### 2026-10-20 修正：车位固定原始尺寸，且必须在所有车辆之下（含离场车）

- 上一版"离场车被描边遮住是可接受表现"的结论**已被用户否决**。真正的要求是：**车位大小固定为美术原始尺寸，永不跟随车辆缩放；车位层级永远低于车，离场车也必须压着车位开出去**。
- 车位曾是"跟随车辆大小"（`updateSpotOutlineSize` + `measureVehicleModelSize` + `SPOT_OUTLINE_FIT`）。这带来两个 bug：空位时把描边缩放重置为 `1`，而模板在 `normalizeObject` 里被缩放到 2.2 倍，等于把空车位缩到原大小约 45%；有车时又按车身重算，占位/空位尺寸不一致。现已整套删除，描边保持 `parkingTemplate` 的原始缩放。
- 白框压到车上有两个独立原因，必须同时修：
  1. `parkingMaterial` 是 `transparent: true`。three.js 把透明物体统一排在不透明物体之后，所以无论怎么调 `renderOrder` 都会画在车身上。改为纯 `alphaTest` 裁剪的不透明材质。
  2. 离场车按 `vehicleDeparturePath.y = -1` 行驶，比车位（约 0.03）更低，深度测试下描边反而更靠近相机、盖住车。因此描边材质设 `depthTest: false, depthWrite: false` 并 `renderOrder = -10`，作为纯地面图层先画。
- 同一原因：`backgroundPlane` 也是透明材质，改成不透明裁剪后它会反过来盖住车位，所以背景在 `opacity < 1` 时才启用 transparent，正常为 1 时走不透明通道。顺序必须是 背景 → 车位 → 车/小人。
- 不要再用"调整描边 Y"或"提高离场高度"来修层级：Y 只影响斜视角下的投影位置，不解决绘制顺序；离场高度又和离场路径线绑定。

## 2026-10-16 CTA 文字在 Windows 上叠字的机制与修复边界

- CTA 调参值 `fontHeight`（16）远小于 `fontSize`（63）是刻意为之的视觉样式（描边字紧贴），但这意味着**任何折行都会让两行字直接重叠**。文字恰好卡在按钮可用宽的临界点（设计上约 302px 可用、文字约 300px 级），因此平台字体度量差异就决定了单行还是糊字。
- Mac 显示正常不等于跨平台安全：同一 HTML 在 Windows 的引擎/字体回退下宽度略增即折行。这类"临界宽度 + 极短行高"组合是 Web 试玩在双端投放时的高危样式。
- 修复选择了"禁止折行 + 超宽按比例缩字号"而不是增大行高：缩字号保留了作者调好的按钮比例与描边位置；增大行高会改变用户已确认的视觉。`document.fonts.ready` 之后必须重跑一次 fit，否则会以回退字体度量做错误收缩。
- 编辑器中的字号/行高字段仍可自由调；nowrap 与自适应只兜底"文字超出按钮"这一种情况，不改变正常参数下的外观。

## 2026-10-15 AppLovin 报表的挑战漏斗列对应 Axon 事件，我们的包只发 6 个核心事件

- 投放侧 AppLovin HTML 素材报表（HTML ID / HTML name + `Challenge failed/retry/solved/pass 25/50/75` 及各自 rate）是按 Axon 事件名汇总的：`CHALLENGE_FAILED`、`CHALLENGE_RETRY`、`CHALLENGE_SOLVED`、`CHALLENGE_PASS_25/50/75`。
- `src/platform-bridge.js` 只发 `LOADING/LOADED/DISPLAYED/CHALLENGE_STARTED/ENDCARD_SHOWN/CTA_CLICKED`；近期导出包（`BL-Q8V5-...-AL-all.html`、`BL-Q1V1-...-AL-0-0.html`）已核实同样只有这 6 个事件名。因此这些挑战列对全部 `BL-*-AL-*` 创意不会出数，不是上报延迟。
- 生产参考：Coolplayable「Tile Journey」AppLovin 包实现了完整事件集，并带两个门控——`CHALLENGE_SOLVED` 之后抑制 `STARTED/FAILED/RETRY/PASS_*`；`CTA_CLICKED` 先于任何 `CHALLENGE_STARTED` 时先补发 `CHALLENGE_STARTED`，再延迟 200ms 发 CTA。
- 已落地（2026-10-15）：bridge 增加 `challengeProgress/challengeSolved/challengeFailed`，进度按安装门槛 `successfulOperationCount/threshold` 的 25/50/75%，胜负接 `showResultOverlay` 的胜/负分支，`CHALLENGE_RETRY` 接 `reset()`；`APL-STA-004` 规则链扩展为 12 个事件，线上编辑器已重新部署生效。
- 复盘教训：本地复现远端导出必须显式设置 `BUILD_VERIFIED_PLAYABLE_SKILL_ROOT` 指向仓库的 `deploy-tools/build-verified-playable-packages`，否则 `scripts/export-playable-package.mjs` 会回退到 `~/.codex/skills` 下的旧技能副本，用旧规则集导致检查结果和远端不一致。

## 2026-10-15 导出耗时的真实分布：冷启动每平台一次 Vite 构建，约 2 分钟；重复导出约 15 秒

- 远端（1 核容器）实测：`__playable-export-all` 冷启动 103–119 秒，同参数第二次 13–21 秒（`X-Playable-Source-Cache: miss → hit`）。单平台导出**不吃**源码缓存，每次都会重建该平台；只有「一键导出全部」在第二次起复用已构建 HTML（只按变体重写图标/商店链接）。本地对照（并发 1，同 env）：cold 20.4s / warm 5.3s。
- 每个平台的构建 = 一次完整 `vite build` + `package-applovin-single-html` 内联，约 12–15 秒/平台；7 个平台串行（容器 1 CPU，并发无收益）。所以「第一次慢」是预期成本，「每次都慢」才是异常——异常来源见下条（非法关卡选择让导出直接失败）。
- 对照数字：本地 8 核并发 3 时 cold 14.6s / warm 5.0s，说明并发只在多核上有效；不要把容器的 `PLAYABLE_EXPORT_CONCURRENCY=1` 当成慢的原因去调大。
- UI 侧改进：导出中显示实时计时，完成后显示服务端耗时；这不是性能修复，只是让等待可解释。

## 2026-10-15 幻影关卡：保护名单里的 id 被合成进下拉框，选中即写坏导出选中关卡

- `BUILTIN_LEVEL_IDS`（vite.config.js）是「不允许删除」的保护名单，历史上按 `level-catalog.js` 的导入关卡写成；但 catalog 后来重新生成，`level22/29/39` 只剩名单里的 id，**web 卷、数据卷、烘焙 catalog 三处都没有它们的定义**。
- 旧的 `readImportedLevelIdentities` 会给名单里未命中的 id 合成 `levelN (levelN.asset)` 展示名，于是这三个 key 出现在编辑器下拉框。用户选中后 `POST /__playable-level` 通过（旧守卫只看名单），`selected-level.txt` 被写成 `level29`，之后**每一次导出**都在 `generate-active-level.mjs` 抛 `Unknown SCENE_TUNING.level.selected value: level29`。
- 修复原则：列表和守卫都必须以「三层真实数据」为准（web 文件 → 数据卷 artifact → 烘焙 catalog，远端 catalog 路径受 `PLAYABLE_LEVEL_CATALOG_PATH` 控制），保护名单只能用于「禁止删除」，不能用于「存在性判断」。导入自动分配 key 也要跳过保留 id，否则新导入会落在不可删除的 key 上。
- 排查提示：见到「导出失败：Unknown SCENE_TUNING.level.selected value」先看 `artifacts/selected-level.txt` 与编辑器 localStorage 的 `level.selected` 是否指向一个没有任何定义的 key。

## 2026-10-15 关卡重名来自「下拉框标签不刷新」+「同内容导入堆叠」两条独立链路

- 编辑器关卡下拉框的重名有两个互相独立的来源，排查时不要混为一谈：
  1. **静态标签残留**：选项先用构建内 catalog 渲染一次，之后 `refreshWebLevelOptions` 只往 select 里追加缺失 key、从不更新已存在选项的标签，也不删除已消失的关卡。于是关卡被覆盖/改名后，下拉框一直显示旧名：level20 实际是「Q9V3（幽灵）」却显示 `level35`（与真正的 level35 同名）、level21 实际「Q9V2（叶子）」显示 `level154`、level33 实际 `BL-Q1` 显示 `level33 (level33.asset)`。修复方式是按服务端合并列表整体重建选项，而不是增量补丁。两个关卡下拉框（当前关卡、引导关卡）共用同一个刷新函数。
  2. **同内容重复导入堆叠**：旧导入按最小可用数字分配 key、不查名称，同一份素材反复导入就留下多条同内容记录（远端 level27/30/31 都是 level154 素材、本地 level20 与 level35 MD5 相同）。新规则：导入命中已有导入关卡名时原地更新该 key（`replaced=true`），命中网页关卡名时拒绝并提示，命中纯内建关卡名（bundle 无导入源）时要求重命名文件。
- 名称等价规则（`scripts/level-name-registry.mjs`）：NFKC + trim + 小写之后，折叠结尾的 Finder 拷贝后缀 ` (1)`/` (2)` 与自动导入标签 ` (level12.asset)`。这样 `level35`、`level35 (level35.asset)`、`level35 (1)` 视为同一名称；真实名称里的括号（如「level36 - 参考图密集车阵」不含结尾括号）不受影响。保存改名的查重也要跑同一条规则，否则用户可以把 level20 改名成 `level35 (level35.asset)` 再次制造重名。
- 关卡数据分三层命名空间（web 卷 > 导入 artifact > 构建内 catalog），且远端数据卷只在首次部署播种（`start.sh` 的 `.seeded-v1` 标记），之后部署不覆盖——清理本地 artifacts 不会影响线上已有数据，反之亦然。
- 打包部署包时排除大产物目录必须限定在 `artifacts/` 路径下：按目录名全局排除会误删 `public/assets/applovin`，远端 Docker 构建会因缺贴图失败（本次首轮部署踩坑）。

## 2026-10-13 旧产物批量修复：FBX 坏引用与 Mintegral CSS 可离线打补丁

- 2026-10-13 之前导出的所有产物都带同一个 FBX 坏引用问题（`data:...base64,<gzip>/file.png` → `ERR_INVALID_URL`），Mintegral 产物还缺 CSS 内联。因为它们和现在的导出器只差两处可静态识别的代码形状，可以在产物内直接打补丁，不用重新导出：`loadingManager=new X,` 后面注入 `setURLModifier`，FBX 资源路径兜底 `e??t.slice(0,t.lastIndexOf("/")+1)` 改为 `e??"playable-fbx-internal:"`。
- 补丁工具 `scripts/repair-legacy-playables.py` 幂等（已修复的包直接跳过），支持 `.html`（单 HTML 平台）与 `.zip`（多文件平台，Mintegral 会同时把 `style.css` 内联并对齐删除）。276 个本地产物全部可修，规则集全平台复检 PASS，CDP 探测坏请求归零。
- NAS（`design/ua_video/BL/试玩`）上的同名产物与本地未修复版逐字节一致，因此可以直接用修复版覆盖；上传走 SMB 挂载，链路只有约 100–300 KB/s 且每个文件的元数据往返也慢（约 20–35 秒/文件），批量覆盖需要数小时，用可断点续传的上传脚本完成后台执行。

## 2026-10-13 Mindworks 检查器「素材依赖代码的存储要求」不允许单独加载 CSS

- 该检查项（内部 prop `outer_chain`）由 Mindworks 注入页面的 `https://mmp-cdn.rayjump.com/pt-scripts/preview-util.js` 判定：加载 1 秒后扫描 `performance.getEntries()`，只放行**同域加载的 script** 与 HTML 文档本身；任何其他单独加载的文件（`link`/`img`/`fetch` 等）都被记为「外链资源」并判失败。检测器上传后把 ZIP 解到 `mmp-cdn.rayjump.com` 再以 iframe（`?preview=true&loading=0&review=1`）运行，console 会打印 `=======外链资源` 及被标记的条目。
- 复现/验证方法：本地把 `preview-util.js` 以同样的 `<script id="preview-util">` 注入解包后的 HTML，用 Chrome 打开 `?review=1` 并监听 `previewer:review` postMessage，即可离线复刻该项判定（脚本在 `/tmp/preview-util.js`，复刻脚本 `/tmp/repro.mjs`）。
- 修复：Mintegral 打包分支把 `style.css` 内联为 `<style>`，ZIP 只保留「同名 HTML + index.js」两个文件；内联后同一份资源实测 `outer_chain` 从 0（不通过）变 1（通过），且官方 `creative-api.mintegral.com/openapi/examine` 返回 `素材依赖 Done`。
- 防回归：本地 Mintegral 规则集新增 `MINTEGRAL-STA-006`（regex_absent，杜绝 `<link|img|video|audio|source|track>` 引用非 `data:` 地址），`test/playable-export.test.js` 增加导出器与规则契约测试。
- 附录：检测器上传接口为 `creative-api.mintegral.com/openapi/examine/upload`（无需登录），`check` 接口逐项返回状态（`install/game_end/game_ready/code/...`），可直接用于离线复核。

## 2026-10-13 Mintegral 检测失败来自 FBX 内部贴图引用与 data URI 目录拼接

- Mindworks/PlayTurbo 的「素材依赖代码的存储要求」(`outer_chain`) 和「代码报错」(`code`) 在这批 Mintegral 包上同时失败，根因是**所有 Unity FBX 内部仍写着 Windows 相对贴图路径**（如 `..\Textures\Car_0307\Car_P2.png`、`Fire Engine.png`）。three 的 `FBXLoader.loadTexture` 会把这类引用归一成裸文件名，再拼接到「模型所在目录」。打包后模型 URL 是 `data:application/octet-stream;base64,<gzip>`，`loadPackedFbx` 原先用 `url.lastIndexOf('/')` 推导目录，斜杠落在 base64 数据里，于是拼出 `data:...base64,<数据>/Car_P2.png` 这种非法地址 → WebView 报 `net::ERR_INVALID_URL` → 检测器判「代码报错」；同一批「素材以非内嵌方式被代码引用」触发 `outer_chain`。
- 复现证据：CDP 探测（`/tmp/cdp-probe.mjs`）在旧包抓到 7 处坏 URL（含 `Fire Engine.png`、`Car_firetruck_shadow.png`），新包 5 处；Mindworks 前端 chunk（`3e4eb0e.js`）确认两项的内部 prop 分别是 `outer_chain` 与 `code`。
- 修复：`src/scene-view.js` 新增 `FBX_INTERNAL_TEXTURE_ROOT = 'playable-fbx-internal:'` 与 1x1 内嵌 PNG 占位图，`loadPackedFbx` 不再从模型 URL 推导目录，`loadingManager.setURLModifier` 把该前缀统一改写到占位图。所有 FBX 材质本来就在运行时替换，占位图不影响视觉；修复后同包浏览器探测为 0 处坏请求。
- `scripts/check-playable-runtime.mjs` 原先在 console 与网络日志两处把 `data:` 开头且 `ERR_INVALID_URL` 的失败当作 Three「可选探测」白名单放行，掩盖了该问题；现已移除，运行时门禁会真实拦截这类引用。
- 同一轮还修了 Mintegral CTA：`openStore` 增加 `window.install !== installFallback` 判断，兼容平台检查器对 `window.install` 的 getter/setter 包装（此前只认启动时快照的 host 函数，检查器环境下 CTA 会被静默跳过）。注意 Mintegral 静态规则 `MINTEGRAL-STA-002` 要求产物保持 `window.install = function ...` 文本，`installFallback` 必须用链式赋值 `const installFallback = window.install = function install(){...}`，否则压缩后正则匹配不到。

## 2026-09-29 Q9V2 线上编辑器导出污染了商店链接槽位

- `/Users/von/wxj/试玩成品/BUS/bus-loop-all-platforms-Q9V2/` 的 14 个线上编辑器导出中，Android 变体把 Google Play URL 同时写入 `storeLinks.android` 与 `storeLinks.ios`，iOS 变体把 Apple App Store URL 同时写入两个槽位。目标设备可能暂时正常，但平台用相反 UA 预览时会触发 `Fallback android/ios store link must be ...`，异常发生在 CTA bridge 之前，所以检查显示为 JavaScript / 渲染错误。
- 原始 `manifest.json` 虽然记录了 PASS，但其中 runtime 报告全部是 `skippedRuntime: true`；静态与 payload 通过不能证明 CTA 可运行。这是线上导出检查链的覆盖缺口，不是玩法逻辑变化。
- 已在导出器增加双槽位合法链接断言，并让带品牌变体的导出对 Android/iOS UA 都执行 runtime smoke；复用 HTML 时也会检查最终 HTML 是否保留两条合法商品链接。远程 `PLAYABLE_EXPORT_REMOTE_FAST=1` 现在只复用 backup.jpg，不再跳过 runtime；只有显式 `PLAYABLE_EXPORT_SKIP_RUNTIME=1` 才允许跳过。
- 原始成品未覆盖。仅修正 `storeLinks` 的复制包位于 `/Users/von/wxj/试玩成品/BUS/bus-loop-all-platforms-Q9V2/修正版/`，玩法、关卡、资源和平台桥接均未改动。修正版 14 个产物交叉 UA 运行检查共 28 次，全部通过；Moloco 两个产物另用 Moloco 平台参数复测也通过。Moloco 首轮结果的 4 个 CTA 失败是检查脚本把目标平台识别为 `applovin` 的命令参数错误，并非成品问题。

## 2026-09-29 Moloco iOS 成品的 CTA 失败来自错误的 Android 回退地址

- `BL-Q10V1-N-EN-PL-WXJ-TJW-MO-iOS.html`、`BL-Q7V5-N-EN-PL-WXJ-TJW-MO-iOS.html`、`BL-Q10V3-N-EN-PL-WXJ-TJW-MO-iOS.html` 原本把 Apple App Store URL 同时写入 `storeLinks.android` 和 `storeLinks.ios`。Moloco 的 CTA 代码虽然正确调用 `FbPlayableAd.onCTAClick()`，但运行门禁按桌面/Android fallback 校验时先在 `resolveStoreLink('android', ...)` 抛错，导致 CTA 没有真正到达 `fb-cta` bridge。
- 修正版只把 `storeLinks.android` 补为合法 Google Play product URL，保留 `storeLinks.ios` 的 Apple App Store URL；没有改玩法、关卡或画面资源。
- 修正版三份文件已放到 `/Users/von/wxj/试玩成品/BUS/BUS-改/`。Moloco 静态检查均为 `15 pass / 0 warning / 0 fail`，iOS UA 浏览器运行均 `13/13 PASS`，可信 CTA 均捕获为 `FbPlayableAd.onCTAClick()` 且无参数。

## 2026-09-29 MTG/Mintegral 与 Moloco 合规规则不能混用

- 用户提供的合规截图标题明确写的是 **Moloco Ads Manager / Moloco IEC**，不是 Mintegral（MTG）。其中的单 HTML、禁止 `.zip`、禁止 `XMLHttpRequest` / `mraid.js`、`FbPlayableAd.onCTAClick()` 和全部资源 Data URI，均属于 Moloco 交付规则。
- 当前编辑器导出器按平台分支处理：Mintegral 生成同名目录下的 ZIP（HTML、`index.js`、`style.css`），使用 `window.install()` 和 `gameReady/gameStart/gameEnd/gameClose/gameRetry` 生命周期；Moloco 才生成单 HTML 并使用 `FbPlayableAd.onCTAClick()`。不能把截图规则直接套到 MTG 包，也不能把 MTG ZIP 上传到 Moloco 入口。
- 现有 `BL_Q16V2_N_EN_PL_WXJ_TJW_MT_Android.zip` 与 `_iOS.zip` 已按 Mintegral 规则静态通过（每包 19 个 pass、0 warning、0 fail，另有 CTA 和 Mindworks 真机/后台复核门）；payload 通过。对交付 ZIP 重新执行 Android/iOS 设备 UA 的浏览器运行门禁，均为 `15/15 PASS`。
- Mintegral 包中出现的 `fetch(` 命中来自 GLSL 的 `texelFetch(`，不是网络请求；包内没有 `XMLHttpRequest`、`mraid.js`、WebSocket 或 JS 自动跳转。后续排查时要按目标渠道的规则集和语义检查，不能只按截图中的字符串清单误判。
- 后续上传前先确认后台入口与文件名渠道码一致：`MT` 走 Mintegral/PlayTurbo，`MO` 走 Moloco；若 MTG 后台出现 Moloco 文案，应先核对选择的广告平台和审核入口，再决定是否改导出逻辑。

## 2026-09-29 编辑器与导出关卡源必须保持同一优先级

- `src/main.js` 的 `resolveSelectedLevel()` 原本优先读取网页关卡文件，再回退到 `src/level-catalog.js`；`scripts/generate-active-level.mjs` 却反过来优先 catalog。
- 当 `artifacts/web-levels/level<number>.json` 覆盖一个同编号 Unity 关卡时，编辑器画面和导出试玩包会使用不同布局。生产生成必须先读取网页文件，并在其不存在时才使用 catalog。

## 2026-09-29 Mintegral 变体必须保留两个合法商店槽位

- 变体导出若把 Android 或 iOS 地址复制到两个槽位，目标设备上的正常 CTA 可能通过，但反向 UA 预览会触发 `resolveStoreLink` 的平台域名校验异常。每个包应同时携带合法的 Google Play 与 Apple App Store product URL；运行时按设备选择对应槽位。
- `retargetBrandingVariantHtml` 只应替换图标或逐平台替换链接，不能再假设两个槽位相同。

## 2026-09-29 消防员 VATM v2 才是正确的乘客资源

- `Idle_boy_firefighter.fbx` 虽然能显示角色，但 FBX 导出根节点带有机制辅助网格和偏移；直接归一化后，角色会在传送带下方出口处脱离其他乘客，看起来像固定站着的小消防员。
- `Idle_boy_firefighter_vatmesh.bin` 解压后是 `VATM` version `2`，多一段显式 `vatIndex` 数组；原 loader 只接受 version `1`，因此之前误以为 VAT 不可用。现在 loader 同时支持 `VATM v1/v2`，消防车乘客改走 VAT mesh + `Idle_boy_firefighter_anim_map.vatq`，与警察/救护车使用相同的传送带坐标和动画路径。

## 2026-09-20 识图摆放 calibration against a real gameplay capture

- Tuning used `artifacts/playable-exports/moloco-checker-fix/reports/original-portrait.png` (`390x844`, ~70 cars in the field plus a passenger spiral, HUD, and a green `Play Now` button). Three defaults that look reasonable in theory are wrong on a real capture:
  - **Fragment merging must be `0`.** With a 2px merge radius, cars 3-8px apart weld into whole-row blobs; the same capture collapsed from `68` detections to `9`.
  - **Neutral bodies must be off by default.** White seat glyphs, arrows, road markings, HUD text and near-white UI chrome all fall within palette tolerance of `White`/`Vip`/`Cream`; with neutrals enabled, `86` of `133` raw detections were white UI, not cars.
  - **Auto minimum area belongs at `0.0008` of the image**, not `0.00028`. The lower value keeps car outlines, arrow slivers and passenger dots (`area 20-100`), which outnumber cars roughly `4:1`.
- The image border is the right background model, but only when clusters must also be *frequent*: a red car clipped by the left edge contributed enough border samples to make red a background colour and lose every red vehicle. Requiring a cluster to cover a few percent of the border samples fixes it.
- Grid pitch must be measured on the larger half of the detections and on same-line pairs only (same row for the x pitch, same column for the y pitch). The naive version returned `5px`/`13px` — the offsets between a car body and its own highlight/shadow fragments — and then re-spaced whole rows by that pitch. It must also be discarded when it comes out smaller than the vehicles themselves (`< 0.6x` the median blob extent), which leaves the raw centroids in place instead of squeezing a row.
- On this capture the field's row pitch is `~26-41px` (the `13px` signal is the shadow/glyph half-offset) and the column pitch is `~28-40px`; the estimator now reports `28/41` and `9` rows for a field of `9` visual rows.
- **Seats are the least recoverable attribute.** In a tilted capture the camera compresses the depth axis, so a car's bounding box reads `~2:1` and a merged pair reads `~2.8:1` — the *opposite* of the top-down intuition that a long box means a 10-seater. The shipped rule is a narrow height band (`1.25-1.65x` the median blob height, never a wide merged run), which catches the real `1.44x` bus/car length ratio and leaves everything else at 4 seats.
- Horizontal long bodies are deliberately read as 4 seats: at capture scale a wide blob is indistinguishable from a merged run of ordinary cars. This matches the earlier 344x556 finding that 4- and 6-seat bodies cannot be separated at reference scale.
- Result on that capture: `68` vehicles in `9` rows (`黄 63 / 粉 2 / 深黄 2 / 绿 1`), landing on the reference cars. The `Play Now` button and a passenger clump still produce one green and one pink false positive each; both are visible in the preview and are deleted in one click after applying.
- Recognition reads the editor's stored underlay, and importing a file re-encodes it to JPEG (`max 2048px`, quality `0.84`). The same capture recognised `68` vehicles from a stored PNG underlay and `64` from a freshly imported one, with one colour reassigned — JPEG artefacts, not a second algorithm. The preview always shows what will be applied.
- The editor also runs a one-time cleanup of persisted 垫图 caches when it first opens. A reference image written to localStorage *before* that first open is deleted; importing through the editor after it has opened persists normally.
- The earlier 344x556 reconstruction finding below reached `69/69` cars with a **greedy rectangle cover over legal footprints with a purity threshold**. That method is still stronger for frames where one car is only `12x20px`; the shipped recognizer uses colour blobs plus cell-size splitting because it must also work for larger captures, and the cover approach is the recorded next step if small reference frames become the main input.

## 2026-09-18 Draft reference-level cleanup

- The temporary reference-level data, screenshots, helper workspace, and reference-only renderer branches were removed. Production data now points to `level36`; the older notes below are historical and are not active project inputs.

## 2026-09-18 Reconstructing a web level from a 344x556 reference frame

- One car measures ~`12 px` wide and ~`20 px` (4/6-seat) or ~`29 px` (10-seat) long in these frames, so the usable calibration is `12 px == 0.27` world units (`~43-46 px/unit`). 4 vs 6 seats (`0.472` vs `0.486` world) cannot be separated at this scale.
- Windshield/arrow blobs are **not** a car count: one car renders two light windows, so 89 ring-passing blobs resolved to 69 cars. Counting cars by blob count, or by `coloured area / one-car area`, both overcount.
- What worked: a greedy rectangle cover of the car-colour mask with legal footprints (`12x20`, `12x21`, `12x29` px in both orientations), scoring newly covered mask pixels and requiring `>=0.82` purity for short cars but `>=0.88` for 10-seaters. One shared threshold lets a 10-seat rectangle swallow two stacked cars (`53/65` "10-seaters" versus `35/69` with split thresholds).
- Per-car facing is not recoverable from a frame this small: a car's front and rear windows average to its centre, so `yaw` has to be assumed per orientation. Ray casting along the long axis also leaks through 1-2 px gaps between packed cars; only the short axis measures reliably.
- Helper scripts: `tmp/cover.py` (mask cover), `tmp/build-level.mjs` (document, SAT overlap check, queues), `tmp/verify-level.mjs` (runtime verification).

## 2026-09-18 Level37 background asset correction

- The first supplied reference includes the autumn tiled road, benches, trees, and fallen leaves; it is not only a warm colour treatment of the blue bus-stop background.
- `src/scene-view.js` now selects `/assets/applovin/textures/BG03_split01_autumn_light_q60.jpg` for `level37` only. The AppLovin packager explicitly keeps that runtime-selected asset in the single HTML payload.
- `level38`-`level43` continue to use the shared blue bus-stop texture. A fresh packaged capture confirms the autumn road and the level37 vehicle/parking composition render together.

## 2026-09-18 Gradient colour bands: the split axis is per level, and level37 is diagonal

- The colour bands are **not** always a vertical `x` split. Measuring the reference field by binning it into a grid and scoring how cleanly the colour changes along `score = xNorm + k * rowNorm` (row 0 = top) gives a per-level answer:

  | level | best k | purity at k=0 | purity at best k |
  | --- | --- | --- | --- |
  | level37 | **+0.9 … +0.95** | 0.635 | 0.893 |
  | level38 | +0.10 | 0.820 | 0.844 |
  | level39 | +0.05 | 0.880 | 0.880 |
  | level40 | −0.05 | 0.961 | 0.969 |
  | level41 | −0.05 | 0.957 | 0.966 |
  | level42 | +0.05 | 0.971 | 0.971 |
  | level43 | +0.10 | 0.970 | 0.970 |

  So `level37` alone is genuinely diagonal; every other level is a vertical split, and their purity is already higher than level37's best. A first-pass estimate using coarse `16x12` cells and 25-degree hue buckets suggested level38 also needed `k≈+0.15`; with `18x14` cells and palette-nearest hue matching the gain drops to `0.024`, i.e. noise. **Use the palette-aware measurement before changing a level's axis.**
- Measuring the reference itself settles the axis. With a high-resolution reference (`894x872`) the per-vehicle colour-family centroids are `B (u 0.243, v 0.293)`, `O (0.503, 0.519)`, `Y (0.742, 0.715)`, giving `du=+0.500`, `dv=+0.422` and an implied band slope `k = -du/dv = -1.18`. A current build measures `-1.13`, so the diagonal axis is right. **Prefer the family-centroid slope over fitting a purity maximum**: with ~90 samples, purity-maximising reported `+6.00` for the reference in one framing and `+1.95` for the build — both artefacts of binning noise, while the centroid slope agreed across methods.
- The reference's per-vehicle colour mix is `brown 34% / orange 37% / yellow 29%` (31/34/27 vehicles). Assigning by cumulative **vehicle count** at `0.34` / `0.71` reproduces it exactly (`35% / 36% / 28%` on a render). The earlier attempt calibrated by **footprint area** instead and produced `15%` brown on a render — the reference's brown share by area is only ~23% because its brown vehicles skew small, so the two measures are not interchangeable. **Pick one measure, take it from the reference with the same method, and match that.**
- The reference contains **no diagonal vehicles at all**: of 97 detected vehicle arrows, 49 are horizontal and 48 vertical, with 0 ambiguous, while an arrow only reads ambiguous when the vehicle sits at a non-right angle. A build derived from the `level36` skeleton had 17 off-axis vehicles (`yaw` 75/140/150/165/210/215/225/255/285). Snapping them to the nearest right angle — `yaw` values are now only 0/90/180/270 — plus nudging 5 of them along their own axes cleared every overlap; verify with the real `boxesOverlap` from `src/vehicle-collision.js` rather than a bounding-box approximation.
- Reliable way to locate vehicles in a reference screenshot: find white blobs (`v>=0.85, s<=0.13`) of area 60-2000 whose bounding box is ringed by saturated vehicle pixels (>55%). The ring test rejects watermark text, page background and the buses' own white highlights, which otherwise produced 1272 raw components where only ~97 are arrows.
- Passenger queues drive the belt's colour, and a blocked queue only ever shows its **head**. The reference's right arm is an orange/yellow blend (hue `32-37`, between the rendered orange `~24` and yellow `~48`), which a blocked queue cannot produce: a brown-then-orange head rendered `50/48/51` (too yellow) and an orange-then-yellow head rendered `24/23/24` (too orange). The reference levels therefore use explicit head-run ordering so the visible arms begin on the matching colour families while preserving the exact total counts.
- `capturePlayableBackupImage` captures the canvas, so the green `Play Now` CTA is absent — but if a full-page capture is used instead, the CTA's green is classified as "yellow" by warm-hue banding and silently inflates the yellow share. Exclude hues above ~60 degrees from a brown/orange/yellow analysis.

## 2026-09-18 Passenger tint shifts hue away from the vehicle body colour

- Vehicles and passengers share one atlas per colour, but passengers additionally pass through `SCENE_TUNING.passengerMaterial.colors[i]`. For the shipped standard colours those entries are tinted (`emissionColor` at `emissionStrength 0.6`), so a passenger renders at a different hue from the same-coloured vehicle: `index 8` (brown) renders `hue ~5` on the belt but `hue ~15-23` as a vehicle; `index 5` (yellow) renders `~48-62` as a passenger but `~39` as a vehicle.
- The references do **not** show this shift — in `level37`'s reference the brown passengers read `10-20` and the yellow arm `32-37`, matching their vehicles. So the shipped tints are the reason the belt reads redder (brown) and greener (yellow) than the reference.
- The global table is deliberately unchanged because `index 5` alone carries 198 of `level12`'s passengers. The seven reference levels bypass those legacy tints and use their atlas colours directly; changing the shared table would still restyle every already-validated level with no reference to check against.

## 2026-09-18 Reference framing calibration

- At equal canvas size (`344x556`) the reference and a current build differ structurally, not just in scale:

  | band | reference | current build |
  | --- | --- | --- |
  | conveyor | 12-36% | 0-28% |
  | road | 36-48% | 28-44% |
  | vehicle field | 48-80% | 44-96% |
  | bottom margin | 20% | 4% |

- The ratios are not uniform (road height ratio `0.75`, field height ratio `0.62`), so this is not one camera-zoom number: the field is proportionally larger than the road compared with the reference. Matching it means changing both the global camera fit and the field's internal scale.
- The reference frames carry a uniform 24px border (`296x508` content, aspect `0.583`, not `9:16`'s `0.5625`), and the `level40`-`level43` references show a video scrubber. Some of the reference's margin is therefore video framing, not game framing — establish the true content box before retuning the camera.
- The playable now applies a reference-only `1.10` camera fit-height and a compacted conveyor curve/art transform (`0.88` X, `0.78` Z, translated down) for `level37`-`level43`. This aligns the loop's top/bottom bounds and keeps the existing global tuning unchanged for older levels. `level40`-`level43` also use a reference-only `1.15` vehicle-field X scale to match the wider diagonal matrices.

## 2026-09-18 Supplied colour supplement composition

- The supplied zip holds only prefabs and PNGs: no `.mat`, no texture assets, no materials embedded in the prefabs. The bus body material is the one element genuinely absent, so the nine vehicle atlases cannot be extracted from it.
- The eight supplied passenger PNGs are **not** a different asset type: they are the same atlas layout as the shipped `color_0..10` set. Applying the blue atlas's body mask to any of them lands on one flat colour for 99.9% of the mask, and the skin mask overlaps the shipped atlas at IoU `1.000` for six of the eight (`girl02`'s two are `0.918`/`0.824`). They leave the body region pure white because Unity tints it via the material; only `black` bakes `#101010`.
- Consequence: the supplied PNGs cannot be dropped in verbatim as `colorTextures`. The web runtime shares one atlas between vehicles and passengers, and the vehicle material applies no tint, so a white body region renders a white car. The body region must be painted; a first attempt that painted only the flat index-1 region rendered the body half white, because a vehicle also samples the body's highlight and shadow entries, which the shipped atlases keep in their own palette indices (`color_0_blue`'s family is 22 indices and 43% of the image, versus 31% for the flat entry alone).
- `gray`, `mintgreen` and `white` are byte-identical files (`sha256:ea6088ee…`), so those three differ only by their material tint. `darkred` ships no texture; its prefab references the same texture as `gray`/`white`. `matchagreen` and `mintgreen` prefabs carry identical material overrides.
- Shipped `passengerMaterial` sets `baseColor` to `#ffffff` for 7 of its 11 colours, so leaving it white is the established convention rather than an omission. Because the variant colour is now baked into the atlas, a non-white `baseColor` would double-tint; the new entries therefore keep `baseColor` white and take the supplied prefab's `m_EmissionColor`.

## 2026-09-18 Reference-image limits

- The seven reference images are `344x556` compressed frames carrying a `JQ 资源` watermark, not the game's native framebuffer. Comparing rendered output to them is reliable for **hue** and for **composition** (how many colour stops, and where they sit), but not for absolute brightness or saturation: every newly painted atlas renders roughly 12% brighter than its reference patch, while the untouched shipped `brown` renders slightly darker and more saturated than the same reference's brown.
- At that resolution a single patch's average mixes vehicles, passengers, arrows, shadows and the pale page background. A `sat>=0.20` filter also silently drops pale cream, which made the warm side of `level39` look brown-dominant until the pale and mid-saturation populations were counted separately. Prefer per-population counts over one average when the patch contains both a pale and a saturated colour.

## 2026-09-18 Supplied colour supplement and the 0-10 colour atlas contract

- The existing `color_0..10_*.png` atlases share one UV layout but order their palettes differently; the correspondence is still one-to-one per region. The painted body is the highest-count palette entry in every atlas (index `1` in blue, index `0` in the other ten) and the body family is its highlight/shadow variants. A new variant can therefore be produced losslessly by rewriting only those body entries and keeping the donor's index map, skin, white and detail entries.
- Colour ids stopped being array positions once the supplement ids `17-25` were added: `16` is unused, so `VEHICLE_COLOR_OPTIONS[i]`, `VEHICLE_COLORS[i]` and `PASSENGER_QUEUE_COLORS`-style positional lookups are wrong. Editor code must use `getVehicleColorOption(id)`.
- A supplied colour whose atlas is dark cannot be brightened into the reference's pastel tone by scene lighting: adding white preserves hue and lands near the original hue, so the near-black teal `7` `(1,72,83)` cannot render as the references' light mint/matcha. That is why `level39` and `level40` needed genuine new colours instead of the closest existing `青`.
- The reference screenshots alone cannot settle every colour stop: at `344x556` the vehicle-field band averages mix in white arrows, shadows and the light background, and the observed hue offset between an atlas and its rendered screenshot varies per level (`level37` `orange 20->21`, `level43` `blue 218->216`, but `level41` `green 130->149`). Stop *lightness* is the reliable discriminator; stop hue is not.
- Reference level 39's third stop is a light, desaturated green (band average `(122,182,112)`), not the dark teal `7`, and the original `深绿绿青棕` name was therefore wrong. Reference level 40's left half is a uniform light mint `(107,196,173)`, which matches the supplied `mintgreen` swatch rather than the dark teal `7`. `level41`'s green, `level42`'s purple and `level43`'s blue/yellow were left on their existing indices because their reference saturation still matches those atlases.

## 2026-09-11 Hand hint behavior

- The regular 3D guide hand and the first-click spotlight are separate systems. A no-mask requirement must disable `firstClickGuide`; setting only its opacity to zero still leaves its timed interaction behavior active.
- Idle timing uses gameplay time and resets on canvas input. After the configured vehicle leaves, guidance should resolve the next visible, unblocked parked vehicle instead of disappearing permanently.
- Existing Level 36 editor caches need a guarded migration for `showAtStart=1`, `idleDelaySeconds=5`, and the disabled first-click mask so saved tuning cannot hide the new defaults.

## 2026-09-10 Level36 reference composition

- The earlier Level 18 outer-ring plus Level 5 center interpretation was incorrect: it left a large hollow center and overused diagonal vehicles.
- The corrected reference is an 82-vehicle, high-density irregular field with filled center bands, mostly horizontal/vertical vehicles, 17 local diagonals, and nine visible colors. Its spacing includes extra visual clearance beyond the logical collision boxes to prevent model clipping.
- The reference's right two columns contain 14 small cars rather than minibuses. Those vehicles now use 4 seats, making total capacity `542`; passenger queues are `274+268` and retain exact per-color seat parity.
- A `0.70` global vehicle model scale gives the requested smaller composition. Existing Level 36 editor sessions that still store the former `0.75` value require a guarded one-time cache migration so the saved tuning does not hide the new default.
- Compacting `vehicleArea.positionUnitScale` from `0.84` to `0.80` pulls both ends of the field toward its center. With `offsetZ=-0.10`, this clears the bottom CTA without crowding the front driving lane; existing Level 36 sessions migrate offsets `0`, `-0.5`, and `-0.25` plus the old map scale.
- Color placement should not reproduce the reference one-for-one. Swapping colors only between equal-seat vehicles changes the composition while preserving exact per-color vehicle capacity and the existing validated passenger queues.
- The reference's upper passenger presentation maps to the existing `dualQueue3` runtime layout. The web-level `conveyorBeltName` records this authoring intent, while `scene-tuning.conveyorLayout.selected` remains the runtime selector used for packaging.
- A stale browser draft can override a newer saved web-level document. Preview storage now uses a revision-aware `v3` envelope: `v1`/`v2` entries are removed, and an explicit unsaved draft may override disk only while its recorded base revision still matches the current saved document.

## 2026-09-10 Level33 blue variant

- Level 33 uses color index `0` for every non-target vehicle and passenger; vehicle 89 and its ten first-wave passengers retain pink color index `2`.
- The editor-owned `artifacts/unity-level-sources/level33.asset` is the durable source; regenerate `artifacts/unity-levels.json`, `src/level-catalog.js`, and `src/generated-active-level.js` after color changes.

## 2026-09-10 Delivery-name platform boundary

- The business order is `requirement-material-iteration-language-format-designer-requester-channel-steps-stamina`, with channel codes `AL/GG/FB/MT/MO/TT/UN` by default.
- Mintegral permits only ASCII letters, digits, and underscores in the ZIP base name, so its separator must be `_`; the other platforms retain `-`. Google Ads additionally limits the ZIP base name to 50 characters.
- Naming metadata belongs to the editor/export layer and must be removed from the production tuning module before bundling. Otherwise Unity Ads detects the `applovin` channel-map key as forbidden AppLovin residue.
- Platform-required ZIP entries such as root `index.html`, `backup.jpg`, and `config.json` must not be renamed to the business delivery name.

## 2026-09-09 Level33 station-path clearance

- A vehicle can pass the initial forward collision check yet visually intersect a neighboring parked vehicle when the rounded station path starts turning too close to the layout boundary.
- For the BL04 `level33` layout, the verified path perimeter is `minX=-3`, `maxX=2.95`, `minZ=-3.22`, `maxZ=2.82`. A regression samples the complete station path, including the in-motion vehicle scale, for all 12 initially movable vehicles against every stationary vehicle.
- Editor `localStorage` can override updated source defaults after a reload. The old Level 33 perimeter and `1.63` guide-hand size now migrate only when the complete saved legacy signature matches, preserving later manual tuning.
- Four rectangular mask pieces leave square transparent wedges around a rounded guide border. The opening spotlight now uses the rounded hole's outer shadow as the mask, so the visible cutout and border share the same corner geometry.
- Spotlight placement is editor-controlled in canvas CSS pixels after target-bound centering; margin and independent width/height scales remain separate controls. Any `firstClickGuide.*` edit restarts the live opening preview so expired three-second guides can still be tuned directly.

## 2026-09-09 Moloco raw-text network false positives

- The uploaded Moloco package already routes real resource loading through the data-only `__playableDataRequest`. Raw case-insensitive `fetch(` scanning also matches 13 GLSL `texelFetch(` calls; token scanning additionally matches Three.js's obsolete `fetch for` error text.
- `prepareMolocoHtml` changes only those known non-network representations and rejects remaining network API markers. The GLSL escape is decoded by JavaScript before compilation; regression tests compare decoded shader text and prove actual fetch/XHR/WebSocket/beacon APIs still block export. Do not encode real network APIs to bypass checks.
- Local checker parity alone missed the stricter raw-substring scan. Keep both static patterns plus actual browser offline/CTA verification. Original and fixed packages show the same five Chrome `ERR_INVALID_URL` diagnostics for embedded gzip model URLs under the extra Playwright probe; this baseline issue is not caused by the Moloco text fix.

## 2026-09-08 Development font versus platform package boundary

- The editor/runtime source keeps the project-local `Poppins-Bold.ttf` so development matches the remote Rainbow font fix.
- Final platform artifacts must not embed or reference that font because AppLovin classifies packaged font declarations as an external-font violation. The shared single-HTML generation path removes the Poppins `@font-face` before asset collection and leaves `Arial, sans-serif` fallbacks in CSS and Canvas text.
- This boundary is enforced in the real generator, not by editing final HTML/ZIP files; all seven rebuilt exact artifacts pass static, payload, and runtime gates and contain no font files or font URLs.

## 2026-09-08 Mechanism audio packaging boundary

- The packager intentionally replaces unselected mechanism resources with the exact one-byte sentinel `data:application/octet-stream;base64,AA==`. The previous runtime registered every mechanism sound regardless of the active session, so the first trusted interaction attempted to decode omitted audio and raised `EncodingError`.
- Runtime audio configuration must be built from the union of `sessionLevels` mechanism types. Ordinary sessions therefore preload only their base `bus_hit`, `passenger_up`, and `bus_full` clips; mechanism audio is included only when its owning mechanism is active.
- Per-clip preload failures are contained to prevent unhandled rejections, while the artifact runtime gate records every `decodeAudioData` input and result. A one-byte payload or rejected decode now fails `RUNTIME-AUDIO-002`, so the fallback does not conceal a broken selected audio asset.

## 2026-09-08 Package-only export boundary

- Editor export consumes the project's existing assets as-is and must not run an asset-compression or resource-optimization stage, rewrite assets, or persist the submitted tuning back into the project.
- HTML versus ZIP remains platform-native delivery packaging: AppLovin, Unity Ads, and Moloco emit HTML; Google Ads, Meta, Mintegral, and TikTok emit ZIP. The all-platform ZIP is only an aggregate delivery container.
- An export launched from Vite's development middleware inherits `NODE_ENV=development` unless the child build overrides it. Every export build must force `NODE_ENV=production`; otherwise editor dynamic imports and `modulepreload` markers leak into Mintegral delivery.
- Passing local rules means there is no known blocker within ruleset `1.5.0`; official platform Preview, ad-console upload, and device play are still required before calling a package platform-ready.

## 2026-09-08 Lossless FBX/VAT compression trial

- Compressed the remaining raw FBX files, VAT mesh binaries, and the default half-float VAT map in place with gzip level 9. The original resource paths and model/VAT payload bytes remain unchanged after decompression.
- Existing `*.fbx.bin` and `*.vatq` resources were not re-quantized or double-compressed; the runtime now detects gzip for raw and already-packed FBX/VAT inputs.
- The pass reduced the backed-up 20-file set from `2,071,159` bytes to `636,959` bytes. Every decompressed file matched its pre-compression SHA-256.
- Rollback is preserved under `artifacts/backups/fbx-vat-before-20260908-095053/`, including `manifest.json`, `compression-results.json`, and `restore.ps1`.

## 2026-09-08 Restored Unity conveyor collision path

- Restored the Unity-style broad forward sweep for conveyor attackers, while ordinary vehicles continue using the existing `mayBlockForwardSweep` path.
- Conveyor obstacles are retained for collision resolution even when outside the exit `viewRange`; that range now only determines whether the belt has a usable global exit.
- Conveyor collision feedback first selects the nearest Unity-style non-conveyor obstacle, then the authored same-belt slot candidate, then the narrow-gap fallback. This preserves conveyor slot behavior and keeps the 1.2-width gap guard conveyor-only.

## 2026-09-07 Conveyor parameters fixed from screenshots

- The authoritative component transforms are the user's explicit screenshot values: belt `Y=-0.01`, `Z scale=1.50`; arrow `X scale=1.50`, `Z scale=1.05`; both doors `Z scale=1.20`, `X rotation=150°`; side panels `X=-4.00/+4.00`; all omitted fields are zero/one as shown.
- The temporary component menu is removed after this bake. Legacy saved/exported `conveyorVisual` patches are discarded before they can override the fixed mechanism config.

## 2026-09-07 Mechanism-aware resource pruning

- Mechanism resources are now owned by `public/assets/unity/mechanisms/<mechanism>/`; ordinary conveyor textures remain in `public/assets/unity/conveyors/`, and spatial conveyor textures remain embedded in imported JSON packages.
- The stable production contract is `level.mechanics`: `isMechanicLevel` distinguishes ordinary levels, while `types` and `counts` select the resource manifest. This leaves new mechanism types additive: register the type, add its manifest, and derive its level flag without changing the packager.
- The package stage must handle Vite's deduplicated mechanism-root template strings. It expands those dynamic references to data URIs before replacing the unused asset URLs; otherwise selected mechanism files appear present but fail at runtime.
- A `level29` package containing luxury resources is `6,023,961` bytes without resource compression, above the current 5,000,000-byte limit. The final verified sample therefore uses `level28` (turn vehicle + spatial conveyor) at `4,598,228` bytes; selecting `level29` still automatically includes the luxury manifest.

## 2026-09-07 Conveyor component tuning reopened

- The prior `2.01` component bake was incorrect and must not be treated as authoritative.
- Temporary component controls are active again with neutral `0/1/0` defaults; the next bake must use the user's explicitly supplied values for belt, arrow, both doors, and both side panels.

## 2026-09-07 Conveyor visual tuning fixed after final arrow adjustment

- The live editor's final component state was zero XYZ position/rotation and `2.01` on every component's XYZ scale, including the retuned arrow.
- These component transforms now belong only to the non-resettable conveyor mechanism config. The editor, saved tuning migration, and tuning export path discard legacy `conveyorVisual` overrides.

## 2026-09-07 Conveyor narrow-gap collision guard

- Conveyor attackers now use a dedicated lateral gap guard of `1.2 * minimum vehicle collision width`.
- When two forward obstacles leave a positive gap below that threshold and the conveyor vehicle's exit footprint passes through it, the nearest forward obstacle receives a transient expanded collision box; the authored vehicle geometry and ordinary vehicle collision path remain unchanged.
- The guard is evaluated by both conveyor drive-out permission and collision-candidate selection, so a narrow gap cannot be passed before collision feedback is created.

## 2026-09-07 Forward gap collision guard

- Unity's `VehicleContext` expands the attacker's forward body to a 500-unit sweep and then resolves the nearest edge contact. The playable now keeps that path, adds a conservative front-only radius guard when multiple vehicles form a narrow forward corridor, and uses projected contact as a numerical fallback.
- Conservative candidates are ignored when an exact SAT candidate already exists, so the guard cannot replace the directly overlapping visual blocker or alter ordinary nearest-target selection.

## 2026-09-04 Conveyor collision and build visuals

- Type 3 conveyor vehicles are excluded from the ordinary vehicle collision graph while they remain on the belt, so the conveyor context must add their current projected boxes as dynamic obstacles and exclude the selected vehicle itself.
- Conveyor blockers are selected from actual range overlaps; when multiple vehicles overlap due to authored spacing or transient motion, the nearest vehicle in the belt forward direction is the direct collision target.
- Unity's current `plane_conveyor_build_DoorLeft/DoorRight` and `Leftside/Rightside` textures are visual-only transparent overlays. They share the conveyor root transform and hidden state; gameplay collision remains driven by the belt exit/wall boxes so the decorative caps cannot alter blocking distances.
- The conveyor art uses a dedicated `1.375x` root visual scale: the current pass applies an additional 10% to the previous `1.25x` tuning. Conveyor vehicle meshes remain sibling views, so their size and movement coordinates are unchanged.

## 2026-09-04 Luxury material tuning isolation

- Luxury brightness updates must target the wealthy passenger visual instance's own cloned material array, selected through `isLuxuryPassenger`; scanning passenger container roots can accidentally couple normal passenger materials to luxury tuning.
- Luxury vehicle/passenger color multipliers are applied idempotently from the slider value, while the Unity Matcap brightness remains the authored base response. This prevents repeated slider changes from accumulating brightness.
- Once the accepted values are fixed, the editor must not expose the temporary luxury brightness controls; old `luxuryMaterialDebug` and stale saved `luxuryMaterial` values are migrated away during editor startup.

## 2026-09-04 Luxury material brightness correction

- Unity's limousine materials use `Idle_wealthy.png` as `_MainTex` for both mesh groups and `bus_limousine_ matcap.png` / `bus_limousine_metal_ matcap.png` only as `_MatcapTex`; substituting color tints for the main atlas makes the vehicle's dark areas appear nearly black.
- The runtime now restores that main-map/Matcap pairing, applies the authored `4.1` Matcap brightness with the Unity diffuse strength, and includes each material's `_EmissionCol` so the vehicle and wealthy passenger retain readable highlights.
- `count_limousine.mat` has a white base color and an sRGB texture, so the luxury count board must keep a white material color; multiplying it by the generic luxury swatch darkens the already-authored gold artwork.

## 2026-09-04 Vehicle conveyor-belt import

- Unity `VehicleContainerConveyorBelt` is container type `3`. Its visible width is the authored exit width plus `1.2`; vehicle gap is derived from that visible width and clamped by the configured minimum gap (`0.27`), matching the Unity setup/update formula.
- Vehicles remain ordinary parked collision candidates only after leaving the conveyor. While on the belt, the collision context checks the belt's central exit range and its wall/scene obstacles; a successful dispatch removes the vehicle from the belt list.
- A type 3 container must have at least one vehicle and a matching `conveyorBelts` entry. Belt entries must reference a type 3 container, preventing incomplete data from silently falling back to default width.
- `Level_Escape_D/level22.asset` is a valid current Unity sample with 8 conveyor vehicles and matching passenger totals. Other inspected samples include unsupported container types or authored passenger/seat mismatches and were not imported.
- The current Unity project has no conveyor-specific audio asset; the import therefore bundles only the conveyor models/textures and does not substitute a generic vehicle cue as a belt sound.

## 2026-09-04 Luxury visual orientation and material mapping

- `passenger_luxury.prefab` applies a 90 degree Y root rotation, while Three.js FBX import exposes the mesh with a +90 degree X conversion and Z as its long axis. Static luxury passenger templates apply -90 degrees around X before height normalization, then use only the prefab's 90 degree Y yaw at the visual pivot. Unity bone quaternions must mirror their Y/Z components before being applied to FBXLoader bones.
- Unity's `Idle_wealthy_cloth` material references the same `Idle_wealthy.png` atlas as the body plus a matcap lighting layer. Using the standalone cloth matcap as the only map removes the authored clothing colors and produces the black/gray appearance; the atlas is the required base map for both material groups.
- Limousine material group 0 (`bus_limousine` with `Luxury.png`) is the dark base/roof group, while group 1 (`bus_limousine_metal` with `Luxury_metal.png`) is the gold body group. The web runtime preserves the Unity-bright `4.1` Matcap response and applies the source colors in that order so the body detail matches the reference.
- The packed wealthy FBX is still required for the skinned bind pose, while its extracted Unity Idle/Move bone curves provide the low-overhead animation path. The packed wealthy VAT mesh/map are retained as artifacts but are not loaded by the runtime.

## Hidden Vehicle Import - 2026-09-03

- Unity `MechanismHiddenVehicle` registers each `Vehicle.IsHidden` vehicle and calls `ToNormalShapeAsync` as soon as `VehicleContext.CanVehicleDriveOut` becomes true. A hidden vehicle therefore remains a collision obstacle until its exit is clear. The playable additionally accepts explicit clicks: blocked clicks use the shared collision response, while a clear click starts the reveal before dispatch.
- The playable preserves `isHidden`, uses the dedicated question-mark hidden shape, and maps the reveal transition to the 0.5-second `Bus_Out_C_4/6/10.anim` duration. The Unity animation/feedback controller is not directly executable in Three.js, so the state transition and visual handoff are reproduced in runtime code.
- The dedicated four-/six-/ten-seat hidden model is scaled to the corresponding normal vehicle bounds before reveal and uses a readable charcoal `0x2a2a2a` equivalent of Unity's intentionally untextured black `bus_hidden` material while hidden. Its meshes are the vehicle-sized hidden-state picking target; question-mark meshes stay out of `pickMeshes`, preventing the marker from stealing clicks from nearby vehicles.
- Unity hidden prefabs place `Arrow_01` at the forward vehicle edge (`x=-1.75/-1.9/-2.74` for 4/6/10 seats). Because the playable normalizes vehicle depth per seat, the runtime maps this to the front edge of the normalized vehicle bounds with a small inset instead of centering the marker.
- Hidden delivery resources total 191,113 raw bytes. The compressed model files are gzip FBX payloads; `hidden_reveal.bin` is a browser-decodable 16 kHz mono 16-bit PCM WAV with no `.wav` filename. Base64 inlining contributes approximately 254,824 bytes to the single-file package.
- The first hidden-body implementation incorrectly used transparent meshes, which produced purple question-mark blocks in the playable. A follow-up incorrectly replaced the authored hidden material with the normal vehicle texture and reset the revealed model scale to `1`, producing mismatched colors and oversized revealed vehicles. The corrected implementation uses a charcoal hidden material, multiplies the existing hidden normalized scale, and leaves the revealed normal model scale untouched; the explicit white-alpha question texture remains a separate visual-only layer, and reveal audio uses a persistent per-event history so unrelated events cannot cause a prior vehicle cue to replay.

## 2026-09-07 Web LevelEditor runtime boundary

- Unity anchor rotation caches `(selectionMin + selectionMax) / 2` when entering `StateRotateAnchor`, then applies `Quaternion.Euler(0, 0, -angle)` to every selected position relative to that fixed center before adding the angle. Recomputing the center per step or using the opposite 2D rotation sign does not match Unity.
- `bus-loop-web-level-v1` is the editable browser document format. Explicit saves live under `artifacts/web-levels/level<number>.json`; Vite uses optimistic revisions and stores overwritten versions under `artifacts/web-level-backups/`.
- The browser editor preserves the inventoried Unity authoring fields and exports them, including linkage, wrench/gear, combination, ambulance, firetruck, garage, gate, conveyor, and elevator data.
- Authoring/export parity is broader than current playable simulation parity. The existing runtime maps ambulance step limits and firetruck time limits, but linkage, wrench/gear, combination, garage, gate, elevator, and the complete firetruck behavior require separate runtime implementation and testing.
- Unity-compatible export must serialize `GateQueuePathShape` as numeric enum values (`0`/`1`). Excel export is SpreadsheetML `.xls`, not tab-delimited text.

## 2026-09-03 Turn vehicle completion audio correction

- The user-confirmed turn-vehicle cue is Unity's `guidemove.wav`; `gear_complete.wav` belongs to the `Effect_Fix` gear-repair prefab and must not be used for turn vehicles.
- The playable stores `guidemove.wav` as `.bin` containing a browser-decodable 16 kHz mono 16-bit PCM WAV so the AppLovin WAV filename check does not reject the package.
- Completion IDs are attached after the model finishes processing the frame, preventing later passenger or vehicle events from hiding the turn cue. The audio controller deduplicates the per-completion event id and plays one cue for simultaneous completions, while later rotations can play again.
- The source is reduced from 49,568 to 8,632 bytes before packaging; base64 inlining adds 11,516 bytes to the final single HTML, which remains under 5,000,000 bytes.

## 2026-09-03 Turn vehicle visual parity

- Unity's turn-vehicle marker is a separate `Arrow_02` mesh, not the normal `Arrow_01` mesh. The playable keeps both assets and selects the turn marker from `vehicle.isTurnVehicle`.
- The turn animation changes the vehicle's garage yaw only. Once the vehicle reaches `at-spot` or `boarding-final`, rendering must use the shared parking-spot orientation so a prior 180-degree garage rotation is not shown at the station.
- `Arrow_02.fbx` is stored as gzip bytes in `Arrow_02.fbx.bin` and decoded before `FBXLoader.parse`; the non-`.gz` extension prevents Vite from applying automatic HTTP gzip decoding before the runtime decoder runs.
- The turn marker is scaled to `0.8` and moved along the vehicle's local `+Z` forward axis by up to `0.18` world units, clamped so its depth remains inside the vehicle. `+X` is the vehicle's lateral axis in the runtime and must not be used for forward placement. Vehicle picking uses body meshes only; the marker remains under the shared hit root for visual hit animation without expanding the clickable area.
- The imported arrow's normalized model root is not guaranteed to have its geometry center at its local pivot. Turn and ordinary markers are therefore cloned under a centered wrapper; placement, scale, and yaw are applied to that wrapper so vehicle rotation cannot make the marker orbit around an offset axis.

## 2026-09-03 Unity turn vehicle import boundary

- Unity marks turn vehicles with `vehicles[].isTurnVehicle`; the existing level importer can accept this optional flag without changing ordinary levels or requiring Unity at runtime.
- Unity triggers all other turn vehicles after a successful dispatch, including vehicles already represented in the scene, using `turnVehicleRotateDuration = 0.25` and the configured rotation curve. The playable stores the animated yaw in game state, blocks selection while the tween is active, and renders turn vehicles from live rather than cached transforms.
- Real Unity samples `level16.asset`, `level17.asset`, and `level114.asset` validate successfully with 13, 19, and 25 turn vehicles. The production boundary is the generated catalog plus bundled assets; the playable package has no dependency on the source Unity project.

## 2026-09-03 Ambulance passenger VAT compatibility

- The rescuer animation source contains a `none_anim` row before Passenger_Idle and Passenger_Move; packed exports must select source rows 1-60,61-79 rather than starting at row zero.
- RGB8 DataTexture sampling is not reliable enough as the delivery path for the ambulance VAT. The compressed payload is still RGB8, but the runtime expands it to RGBA8 before creating the GPU texture, preserving the package-size advantage while improving WebGL/WebView compatibility.



## 2026-09-03 Ambulance Unity parity

- Ambulance level data uses `vehicleAmbulances: [{ vid, stepLimit }]`; the referenced vehicle is color index `13`, has six seats, and requires six color-13 rescuer passengers.
- Every successful vehicle dispatch decrements each active ambulance still parked. Dispatching the ambulance deactivates it before the decrement; blocked or full-spot clicks do not consume a step; reaching exactly zero fails immediately with `ambulance-exceed-step`; warning presentation begins at five steps.
- `Idle_girl_rescuer.fbx` is authored Z-up when loaded by Three.js. It must receive a `-90` degree X-axis correction before Y-height normalization; otherwise the model is measured across its body thickness, becomes oversized, and appears to lie along the conveyor.

## 2026-08-28 Google strict ZIP validator compatibility

- The current delivery validator is stricter than the generic Google package baseline: it requires root `index.html`, `index.js`, and `style.css`, plus both exact portrait orientation and `320x480` size metadata. The project converter now emits this stricter superset by default.
- Detecting an `ExitApi.exit()` string is insufficient for runtime safety. The prior converted CTA remained inside a `window.mraid?.open` guard, which can suppress clicks in Google environments without MRAID; Google output must validate that the Exit API path is independent of MRAID open availability.
- Use the decimal 5,000,000-byte package limit in local validation and reports to match the external checker rather than relying on a 5 MiB interpretation.

## 2026-08-27 Spatial guide restoration

- The missing guides were a package-configuration regression, not a failure of the spatial performance renderer. The first optimized batch reused Heart's `level15 / vehicle 157` guide values for Duck, Fish, and Rainbow, so level scoping correctly hid those guides.
- The authoritative backup matrix is Duck normal `level12 / 1`, Fish normal `level13 / 130`, Heart normal `level15 / 157`, and Rainbow normal `level7 / 39`; only Rainbow enables first-click `level7 / 89`. Disabled first-click configs still retain `level7 / 89` for parity.
- Shared normal-guide motion values are offsets `0.25 / 0.38 / 0.46`, approach `0.62 / -0.11`, size `1.63`, dimensions `0.6 / 0.5`, near/far `1 / 1.14`, and speed `0.55`. Shared first-click values are 3 seconds, opacity `0.8`, padding `15`, and hole scale `0.62 / 0.62`.
- Mobile timing comparison shows the optimized Rainbow first-click guide remains visible after the loading layer for essentially the same duration as the backup, so no performance-optimization rollback or guide-timer code change is required.

## 2026-08-27 Spatial optimization batch packaging

- The spatial delivery family mapping is Duck -> Level12, Fish -> Level13, Heart -> Level15, and Rainbow -> Level7. Background and Android/IOS variants can be regenerated mechanically after those four optimized bases are built.
- Rebuilding from source is the accepted upgrade path for these packages. It preserves each level payload while avoiding blind edits to minified runtime code.
- The current spatial batch keeps the editor's baked values, including capacity 128, normal/long-press speed 2.3/5.4, all visual transforms, all optimization switches enabled, and install threshold 18.
- Unity packages must continue through the integrated conversion plus runtime-hardening pipeline; copying AppLovin HTML directly would omit the required persistent `viewableChange` lifecycle and pause/resume behavior.
- The converter's 54 warnings are known scanner false positives from Base64 `//` fragments, XHTML metadata, and the two embedded store URLs. Final target scans confirm zero remote asset tags.

## 2026-08-27 Spatial mobile optimization boundary

- Spatial optimization must remain gated by both the selected spatial conveyor and spatialConveyor.optimizations.enabled. Ordinary conveyors retain their previous snapshot, queue-view, passenger-material, and renderer behavior.
- The accepted batching unit is passenger color plus four path chunks. It preserves the existing VAT animation and per-row phase while reducing hundreds of passenger/shadow submissions to a bounded set of instance batches with conservative chunk spheres.
- Instance geometries use lightweight BufferGeometry wrappers with shared source vertex/index attributes and a unique small vatPhaseOffset instance buffer. Cloning the full VAT geometry per color/chunk would trade draw-call savings for unnecessary GPU memory growth.
- The optimized initial spatial path must not create or upgrade the ordinary conveyor/queue passenger view pools. Those views are allocated lazily only when instancing is disabled, assets fail, or an ordinary conveyor is selected, which preserves the rollback path without paying its startup cost.
- Per-frame immutable snapshot() remains the external/test/listener contract. Spatial rendering can use renderState() references, but only behind its editor switch; state consumers that retain or mutate render data must continue using snapshot().
- Structural runtime optimization is available in editor/future builds and has now been published to the 64 spatial delivery files under `D:/文件/可玩-立体轨道`; other historical packages remain unchanged.

## 2026-08-27 Corrected platform Icon ownership

- The corrected platform filenames are Android `icon-android.jpg` and iOS `icon-ios.png`. Branding tuning, editor options, asset tests, and exact package data-URI validation must use this mapping.
- Android remains the source/export default, so the current production package includes the Android JPEG and excludes the iOS PNG.

## 2026-08-26 Spatial conveyor production boundary

- Vite development endpoints are editor discovery/import services only. Production cannot rely on `/__spatial-conveyors`; the selected package must be generated into the source graph before Vite bundles the playable.
- Production includes exactly the baked `spatial:*` package from `SCENE_TUNING.conveyorLayout.selected`. Missing or mismatched package data is a build error so an AppLovin delivery cannot silently fall back to an ordinary conveyor.
- Dimension-preserving PNG compression reduced the selected generated package from about 864 KB to about 51 KB, mostly by reducing `Loop_exit` from 629,952 bytes to 4,581 bytes. The final AppLovin HTML now has about 945 KB of headroom below 5,000,000 bytes.

## 2026-08-26 Standalone spatial conveyor import boundary

- The supported source family is currently `ConveyorBeltTemplate` with GUID `e5a3779fb659c934bbca7df9e4f50681`. Unity prefab variants must be merged across three layers: bundled `Paths_1`, bundled `ConveyorBeltTemplate`, then the selected variant prefab.
- Dreamteck serialized point overrides can retain stale `Array.data[n]` entries beyond `_spline.points.Array.size`; the importer must apply the effective array size before emitting points. `ConveyorBeltShape` contains stale entries through index 69 but has only 56 effective points.
- A self-contained spatial package needs the spline points/transforms, entrance and exit gameplay values, Dreamteck SplineMesh channel geometry, and embedded loop/exit textures. Keeping these in one JSON makes catalog removal a file deletion and avoids a separate registry.
- The editor now owns the minimum BusLoop/Dreamteck support package under `tools/spatial-conveyor-import-support/`; importing a new variant requires only its `.prefab`, not access to the original Unity project.
- Imported `spatial:*` options now load the saved JSON package before becoming selectable. The runtime applies `path -> pathsRoot -> prefabRoot` transforms, generates the repeated Dreamteck mesh along the open Catmull-Rom spline, and assigns the exit texture by imported exit range.
- A spatial layout cannot reuse the ordinary dual-queue model. Runtime initialization merges the authored passenger queues into one hidden source and dequeues directly when a belt slot crosses the single start percent.
- The imported Unity capacity can exceed the current level's total passenger groups. Runtime view/slot capacity is capped at the current authored group count so initial fill can complete while preserving the imported capacity in the saved package.
- Spatial row spacing is derived from `path length / spatial capacity`. The editor-owned `spatialConveyor.capacity` overrides the imported capacity for runtime slot generation; changing it must reset the game and rebuild slots so passengers already on the belt are not silently lost.
- A spatial track can skip the long entrance upload without changing passenger totals by dequeuing directly from its hidden merged source during slot initialization. Slots must be filled from the highest index downward to preserve the same color order produced by successive crossings of the entrance at progress zero.
- Spatial normal and long-press speeds are editor presentation/gameplay overrides selected in `main.js`, not level-data replacements. Ordinary conveyors remain at normal multiplier `1.0` and continue passing `LEVEL_1.longPressMultiplier`; spatial tracks use `spatialConveyor.normalSpeedMultiplier` while idle and `spatialConveyor.longPressMultiplier` while held.
- Spatial normal speed supports values below `1.0`. The game-model multiplier floor and the two passenger-entry visual clamps must remain aligned at `0.1`, otherwise queue state and rendered passenger motion drift apart.
- The editor folder action must remain a fixed development-service operation. The browser sends no path; Vite opens only `artifacts/spatial-conveyors`, which prevents the endpoint from becoming an arbitrary filesystem launcher.
- Spatial loop textures are embedded into each imported JSON as a PNG data URL. Replacing the support-package `Loop_initial.png` alone affects only future imports; existing packages such as `ConveyorBeltShape.json` must be regenerated to receive the new road texture.
- The accepted spatial defaults are isolated under `spatialConveyor`: capacity 128, initial fill on, normal speed 2.3, long press 5.4, position `0 / 0.42 / -2.4`, uniform/Y/X/Z/road-width scales `1.45 / 1.3 / 1.178 / 1.05 / 1.1`, exit offset `-0.15 / 0.6`, X/Y/Z rotation `15 / 180 / 0`, and Unity Z mirroring enabled.
- Spatial X/Y/Z axis scale multipliers are display transforms around the imported point bounds center. They run after uniform scale and before mirroring/rotation; X and Z default to `1.0`, so older saved tuning and ordinary conveyors keep their existing geometry.
- Spatial road width is separate from point-axis scale: it multiplies only the repeated mesh lateral offset and the exit overlay's final lateral span. This keeps the centerline, passengers, capacity spacing, and imported prefab points unchanged.
- User-facing spatial rotations are applied after the fixed Unity-coordinate Y correction, in X/Y/Z order around the display center. Keeping X and Z at zero preserves the previously accepted Y-only orientation exactly.
- Unity transform scale alone makes `ConveyorBeltShape` too small and visually compressed in the HTML scene. Keep imported points immutable, then apply display transforms around their transformed bounding-box center: uniform scale controls overall size, while the optional Y-only scale changes vertical spacing without changing the X/Z footprint or saved prefab points.
- Spatial track width and orientation are presentation concerns, not prefab data. The repeated mesh uses a separate lateral width multiplier calibrated against the four-person row, while the display points rotate 180 degrees around world Y to correct front/back direction.
- A spatial-only camera override produced excessive perspective and was rejected. Spatial tracks must use the shared scene camera; size and layer spacing should be corrected through uniform point scaling and translation so ordinary camera composition remains authoritative.
- Unity path positions are left-handed while Three.js world coordinates are right-handed. After applying all imported Unity transforms, the centered display points need a Z-axis reflection before the authored 180-degree Y rotation; omitting this conversion reverses the spiral winding relative to the Unity reference.
- The Unity-coordinate orientation correction and the user-facing model rotation are separate operations. Keep the fixed imported-coordinate rotation code-owned, then apply the editor's `spatialConveyor.rotationYDegrees` so a visible 180-degree model turn can be adjusted without changing imported points.
- `Loop_exit` is not a replacement SplineMesh material in Unity. It is a separate SpriteRenderer with authored size `2.14 x 0.89` and prefab-specific transform overrides. Replacing loop segments with this transparent texture removes the base belt under its transparent corners and creates visible breaks; the web renderer must keep the loop mesh intact, anchor the overlay to the imported exit percentage, and apply its authored sprite size, scale, and offsets in the web curve space.
- The prefab's small negative local Y offset places the exit overlay below the generated Three.js belt surface when applied literally, so depth testing hides it completely. The web overlay needs a small positive curve-normal lift; editor-facing world X/Z offsets are then the reliable adjustment surface for visual alignment.
- The web exit sprite requires a fixed 270-degree rotation around the local curve-up axis after it is sized and positioned. Applying this to geometry, rather than only rotating UVs, preserves the intended rectangular orientation and keeps the X/Z editor offsets centered.
- Exit layering should use normal depth testing with no depth writes, a small curve-normal lift, polygon offset, and a road-level render order above the base belt. Opaque passenger meshes then remain visually above the exit through their depth buffer entries.

## 2026-08-26 Selectable branding assets without package duplication

- Store the selected Icon as `branding.icon.asset` rather than keeping an iOS/Android URL map in the production runtime. The editor-only options can contain both paths while Vite removes that editor module from production.
- Leave the branding Icon `src` unset in the HTML shell and assign it from baked tuning at runtime. This prevents the default Android asset from being inlined alongside iOS when an iOS package is built.
- AppLovin validation compares exact asset data URIs: the selected Icon and small Logo must be present, while the unselected Icon and legacy large Logo must be absent.

## 2026-08-24 Unity conversion branding-runtime preservation

- The Unity hardening pass previously removed every ordinary `<body>` script while extracting the delayed game module. Older packaged playables keep their responsive Icon/Logo/text positioning in a separate `branding-runtime` body script, so the converted package retained the DOM and assets but lost the code that applies authored position, size, and text fitting.
- AppLovin-to-Unity hardening must preserve non-payload body scripts in source order while continuing to isolate and delay only the gameplay module. Regression validation now compares each preserved branding runtime with its AppLovin source, ignoring line-ending normalization only.
- Current sources contain both forms: 58 packages use the standalone branding runtime and 10 newer packages integrate branding into the main module. The converter must support both without inserting duplicate layout code.

## 2026-08-24 Branding background-width constraint

- Stage-width responsive X coordinates can place branding over page gutters when the Three.js background is narrower than a landscape canvas. The constraint must use the projected background plane, not the stage width or a hard-coded aspect ratio.
- Only rendered Icon/Logo centers are clamped, using half their rendered widths so the full rectangles remain visible. Authored design-space coordinates are not rewritten, so editor tuning survives viewport changes without drift.
- Text remains outside this background-width clamp and continues using the existing independent X/Y mapping.

## 2026-08-24 AppLovin branding overlay adaptation

- A packaged branding overlay can be fully present and correctly inlined yet remain invisible if design-space Y uses the width scale on a short/landscape stage. With the saved bottom layout, the previous 1280x720 package placed the three elements at Y 1235-1344, entirely below the 720px stage.
- Branding position adaptation must use `stageWidth/designWidth` for X and `stageHeight/designHeight` for Y. Asset dimensions should use the smaller of those scales so Icon, Logo, and text keep their aspect instead of stretching.
- At this stage AppLovin static validation checked the branding mount, data-URI Icon/Logo images, and a data-URI Poppins TTF independently. The 2026-09-08 platform-package font boundary above supersedes the TTF requirement.

## 2026-08-24 Icon/Logo and text editor overlays

- Icon, Logo, and text overlay coordinates are stored in the simulated preview design space and converted around the stage center with the same uniform width-derived UI scale used by the HUD. This keeps authored placement stable when the stage aspect ratio changes.
- Branding-only editor changes update and persist the DOM overlay directly instead of rebuilding the Three.js scene. Text content uses the bundled Poppins-Bold font and is measured after rendering so it shrinks within the configured width without clipping.
- Dragging writes rounded design-space X/Y values; hidden or locked branding items do not accept pointer input.
- On viewports up to 760px, phone-preview mode must let the stage fill the viewport and keep only the collapsed 60x48 editor control visible. The desktop phone-frame aspect ratio must not constrain the mobile stage.

## 2026-08-21 Removed editor Levels19-20

- Level19 and Level20 are no longer valid editor catalog ids. Only the sequential alias Level18 remains from the three-file import set.
- The durable selection was Level19 at removal time, so `artifacts/selected-level.txt` now selects Level18. Development localStorage values selecting removed Level19/20 migrate to Level18 without changing unrelated tuning.
- The renamed `level19.asset` and `level20.asset` project snapshots were deleted; the user's original Unity repository files remain untouched.

## 2026-08-21 Sequential Level18-20 editor imports

- User-defined editor ordering overrides source filenames: supplied `level16.asset` maps to `level18`, supplied `level18.asset` maps to `level19`, and supplied `level19.asset` maps to `level20`.
- Editor Level18 retains Unity `id: 16`, `mapScale: 1`, 68 vehicles, queues 200+228, and color totals `{0:230,6:198}`.
- Editor Level19 retains Unity `id: 18`, `mapScale: 1.0295557`, 61 vehicles, queues 184+184, and color total `{0:368}`.
- Editor Level20 retains Unity `id: 0`, `mapScale: 1.011019`, 64 vehicles, queues 218+218, and color total `{5:436}`.
- All three levels have unique vehicle ids, valid vehicle-depth references, and no initial oriented collision overlaps. Their project-local renamed snapshots are byte-identical to the corresponding supplied sources.

## 2026-08-21 Level17 editor import restoration

- The supplied Unity YAML is `level17` with Unity `id: 17`, `mapScale: 0.9`, 107 unique vehicles, and two queues of 300 + 258.
- Seat/passenger totals match exactly by color: color 3 = 304 and color 5 = 254. All 63 vehicle-depth entries resolve and no initial oriented collision boxes overlap.
- `conveyorBeltName: ConveyorBelt4` remains informational because per-level conveyor names are not consumed by the current extractor/runtime; conveyor geometry remains the global editor selection.
- Incremental `--merge-existing` imports must update only `artifacts/unity-levels.json` and `src/level-catalog.js`; they now leave `src/generated-active-level.js` untouched so editor catalog recovery cannot replace a production payload.

## 2026-08-20 Production handoff workflow

- The editor auto-saves the mutable `SCENE_TUNING` object to browser `localStorage` key `bus-loop-scene-tuning-v3`; most editor changes do not automatically write project source files.
- Development level selection is a special case: the Vite `/__playable-level` endpoint writes `artifacts/selected-level.txt`, which can make persistence appear more complete than it is.
- The production boundary is explicit: export `window.__busLoop.exportTuning()` to `artifacts/scene-tuning.json`, then run `npm run apply:tuning` to update `src/scene-tuning.js` and synchronize the selected-level marker before building.
- Current `openStore()` only calls `window.mraid.open()` and has no normal-browser `window.open` fallback. A local editor without AppLovin MRAID is therefore expected not to navigate.
- Store opening is wired to actual gameplay/CTA pointer paths, and AppLovin acceptance still requires a real user gesture in the official preview or real ad container. Debug API calls are diagnostic evidence, not platform acceptance.
- Added `docs/project/playable-handoff-guide.md` with the startup, persistence, packaging, verification, and AI prompt handoff flow.
- One targeted `rg` call used a Windows-invalid `*.md` path argument; the useful scoped results still returned, and later reads used explicit document paths instead.

## 2026-08-11 Level12 AppLovin queue replacement

- `Bus Fever - Car Jam Escape Playable_applovin.html` embeds Level12 queues in minified variable `Lu`, assigned to both `passengerQueues` and flattened `passengerSequence`.
- The playable queue lengths are 219 + 219, not the previously imported Excel split of 173 + 265.
- Combined per-color totals remain identical to all 438 Level12 seats: `{0:68,1:34,2:18,3:22,4:12,5:198,6:20,7:52,8:14}`.
- The user explicitly chose the playable's ordering as the new authority for both the supplied Unity `level12.asset` and the imported web catalog.
- `fixedPassengerSequence` is the final field in the asset, so it can be replaced as one controlled section after backing up the original file.
- The original asset is preserved at `D:/备份/busloop素材关卡/level12.asset.before-applovin-queue-20260811.bak`.
- Final comparison confirms the playable HTML, edited asset, generated JSON artifact, and JavaScript catalog contain byte-for-byte equivalent numeric queue arrays at 219+219.
- Focused catalog tests pass 10/10 and the narrow generated production module remains Level10 only.

## 2026-08-11 Level12 layout and Excel queue import

- The supplied `level12.asset` contains 94 vehicles and 438 total seats; Unity `id` is `0`, map scale is `1.0012542`, and scene name is `GameSceneDualQueue2`.
- `FixQueueConfigB.xlsx` stores Level12 on `Sheet1` with `LevelId = 12`, `QueueL1` and `QueueR1` as pipe-delimited color indices.
- The Excel queues are 173 left + 265 right. Combined counts are `{0:68,1:34,2:18,3:22,4:12,5:198,6:20,7:52,8:14}` and match the Level12 vehicle-seat totals exactly for every color.
- The asset's embedded fixed passenger sequence is stale/different, so the reproducible extractor must override Level12 with the Excel-authored order instead of parsing the asset queue.
- Preserve the current Level10 production selection and existing named AppLovin artifacts; Level12 is an editor/development catalog addition only in this task.
- The historical default Level7 source path is gone, and available same-named assets contain different layouts rather than the verified 83-vehicle Level7. The extractor therefore needs an explicit merge mode that replaces supplied levels while preserving the existing validated catalog entries.
- Incremental generation retained all prior catalog counts, inserted Level12 between Level10 and Level13, and restored the narrow production module to Level10 only.
- Level12 has 94 unique vehicle ids, valid depth owners/references, and zero initial logical collision-box overlaps.
- Browser QA loaded Level12 in the real editor, visually confirmed the complete vehicle/queue scene, and reported zero error-level console logs. Existing Three.js texture/FBX compatibility warnings remain unrelated and unchanged.

## 2026-08-11 Level10 winter separate package

- User explicitly requires the prior Sakura package to remain available. `scripts/package-applovin-single-html.mjs` always writes `artifacts/applovin/index.html`, so the current file must be copied before invoking it.
- Preserve the actual on-disk artifact, not only the previously reported hash: current `index.html` size is 4,196,123 bytes and requires a fresh Sakura/background/config fingerprint check before backup.
- Planned stable outputs: `level10-sakura.html` for the preserved package and `level10-winter.html` for the new package; `index.html` may remain the latest winter output.
- Fresh fingerprint confirms the preserved source artifact is Level10/39 with CTA enabled and threshold 10, contains Sakura but not winter, is 4,196,123 bytes, and has SHA-256 `81A42A23ABADC5A320203BDE099F829D5CCE9286EF7C669834C041371A94D344`.
- `artifacts/applovin/level10-sakura.html` now exists with the exact same size/hash, so later writes to `index.html` cannot destroy the prior package.
- Source/exported tuning and selection marker now agree on Level10 with winter q60; Level10/39, CTA 1, threshold 10, first-click mask disabled, and DualQueue3 remain unchanged.
- The winter delivery asset is 139,386 bytes. The preserved Sakura artifact remains present at 4,196,123 bytes while source/test syntax checks pass.
- Generated the Level10-only winter payload and passed five focused background/cache/catalog/guide checks.
- Winter build/package completed at 3,822,146 bytes and was copied to `level10-winter.html`; the preserved `level10-sakura.html` remains 4,196,123 bytes.
- Both descriptive targets now exist. `index.html` currently matches the latest winter output.
- Independent Base64 byte fingerprints prove `level10-winter.html` embeds only `BG01_split01_q60.jpg` and `level10-sakura.html` embeds only `BG01_split01_Sakura_q60.jpg`; summer q60 and the original Sakura PNG are absent from both.
- Both named artifacts contain the requested Level10, vehicle 39, CTA-enabled, and threshold-10 markers and pass the same 15 AppLovin static checks.
- Final winter SHA-256 is `30BA4A16F886428507E5C7392E7858CAA9EB2F511DC2EC0A441CE0AE8D420E7E`; preserved Sakura SHA-256 is `81A42A23ABADC5A320203BDE099F829D5CCE9286EF7C669834C041371A94D344`.
- After the temporary Sakura validation swap, `index.html` was restored from `level10-winter.html`; both files are byte-identical at 3,822,146 bytes.

## 2026-08-11 Level10 Sakura repackage

- Current Level10 package source/export background is `/assets/applovin/textures/BG02_split01_summer_q60.jpg`.
- Target background is the existing 278,157-byte `/assets/applovin/textures/BG01_split01_Sakura_q60.jpg`; the 1,976,289-byte source PNG remains excluded.
- `scripts/generate-active-level.mjs` already overwrites the generated session manifest with `SCENE_TUNING.background.asset`, so after apply/generate the final entry should reference Sakura only.
- Update the exact Level10 package cache migration from summer to Sakura so prior saved defaults cannot visually override the new baked background in development.
- Source, exported tuning, and selected marker now agree on Level10 with Sakura q60; Level10/39, CTA 1, threshold 10, disabled first-click mask, and DualQueue3 remain unchanged.
- The selected Sakura delivery asset exists at 278,157 bytes. Main/test syntax checks pass.
- First focused background run exposed a real mismatch: `SCENE_TUNING.background.asset` is Sakura but runtime `LEVEL_1.assets.background` is still summer after generation. Catalog/guide/cache-migration checks otherwise pass.
- Direct inspection shows `src/generated-active-level.js` and a fresh module import both contain Sakura correctly. The failed assertion observed the mutable `LEVEL_1` binding after shared test-module state, not a stale generated artifact.
- The background production assertion should use immutable `ACTIVE_LEVEL.assets.background` rather than the mutable runtime `LEVEL_1` binding; runtime texture swapping remains separately covered by the existing source contract.
- The broader sizing regression used PNG fixed offsets (`readUInt32BE(16/20)`) on a JPEG and therefore returned 65536 instead of 2100. Replace it with a format-aware PNG/JPEG dimension reader so the 2100x3382 assertion remains meaningful.
- The format-aware parser succeeds and reaches later assertions; the same broad historical test then fails on unrelated parking spot count `6 !== 5`. Preserve the user's current parking tuning and place exact image dimensions in the focused background test instead.
- Final focused verification passes 5/5: optimized Sakura selection and 2100x3382 dimensions, exact saved-default migration, Level10-only active payload, Level10 vehicle 39, and guide/mask state.
- Final AppLovin HTML is 4,192,202 bytes and passes all 15 checks. It contains only the Sakura q60 byte payload; summer q60, winter q60, and the original Sakura PNG are absent.
- Final package markers retain Level10, guide vehicle 39, CTA enabled, and threshold 10. SHA-256 is `CA7BAF4EC5645B14CEB7F95058D051EEC87653DF1F38BC2630CC499AB2BC2A63`.

## 2026-08-11 Level10 guide-39 CTA package

- Requested baked values: Level10, guide level 10, guide vehicle id 39, CTA enabled, and store redirect after 10 successful operations.
- Prior package work synchronizes both the normal guide and disabled first-click guide scope/target together while preserving `firstClickGuide.enabled`; follow the same established behavior unless the user explicitly asks to enable the mask.
- AppLovin remains the project baseline: single fully inlined HTML, <= 5,000,000 bytes, MRAID CTA, and all 15 existing static checks.
- `artifacts/selected-level.txt` is already `level10`, likely from the editor selection, while `src/scene-tuning.js` and `artifacts/scene-tuning.json` still declare `level16`; the package inputs must be synchronized before generation.
- CTA is already enabled (`cta.enabled = 1`) in both source and exported tuning. Preserve it at `1` and add explicit verification rather than changing unrelated CTA geometry.
- Current package values still use threshold `30`, normal guide `level16/45`, disabled first-click guide `level16/45`, and `firstClickGuide.enabled = 0`.
- `src/main.js` contains a saved-editor migration from the prior Level15/157/40 defaults to Level16/45/30. This package needs a narrow next migration so exact Level16/45/30 cached defaults move to Level10/39/10 without overwriting unrelated custom tuning.
- Level10 contains visible vehicle 39: 6 seats, color index 0, position `(1.1570295, 1.502522)`, yaw about 45 degrees. Level10 has 64 vehicles and authored queues 218+218.
- Exact editable package fields are `level.selected`, `vehicleGuideHand.levelKey/vehicleId`, `firstClickGuide.levelKey/vehicleId`, `cta.enabled`, and `installGate.successfulOperationThreshold`. Preserve every other tuning value.
- The source/exported first-click mask is disabled and remains disabled. The normal guide remains enabled.
- Source, exported tuning, and selected-level marker now agree exactly on Level10. CTA is `1`, threshold is `10`, normal guide is `level10/39/enabled`, and first-click guide is `level10/39/disabled`.
- Unrequested durable values remain unchanged in the structured comparison, including summer background and `dualQueue3` conveyor layout.
- Syntax checks pass for `src/main.js` and the three touched test files.
- Active generation now emits exactly Level10 with 64 vehicles and queues 218+218; no Level9 -> Level7 expansion applies.
- Five focused checks pass: guide target/mask state, selected-session boundary, Level10 vehicle 39, saved-cache migration contracts, and threshold-10 store redirect wiring.
- The final AppLovin package contains only the Level10 session, includes vehicle 39, and carries `level10/39`, CTA enabled, and threshold 10 markers; Level16 and Level9 payload markers are absent.
- Final artifact size is 3,972,962 bytes, leaving 1,027,038 bytes under the strict limit. SHA-256 is `BA8EC8CD23FDF2104E0314488AFC963C7A3348D4AF28AD556F75B2F33261447B`.

## 2026-08-11 Sakura background packaging

- The supplied asset already exists at `public/assets/applovin/textures/BG01_split01_Sakura.png` and is intended to become a third editor background option.
- The current project already records a winter/summer selector and confirms the final AppLovin package embeds only the optimized selected summer image, so the implementation should extend that established selection boundary rather than introduce a parallel asset-loading path.
- Session catch-up automation was unavailable because this Windows environment exposes neither `python` nor `py`; the current planning files and targeted repository reads are the recovery source.
- Current ownership is `src/scene-tuning.js` for the selected asset, `src/scene-editor.js` for the option list, `src/scene-view.js` for live texture swapping, and `scripts/generate-active-level.mjs` plus the level asset manifest for the production-only selection boundary.
- `BG01_split01_Sakura.png` is 1,976,289 bytes. Replacing the currently embedded 195,940-byte summer JPEG in the latest 3,968,019-byte package without optimization would push the package well above AppLovin's 5,000,000-byte limit.
- The source PNG should remain untouched while a dimension-preserving optimized delivery derivative is added and referenced by the editor option.
- The existing editor options point to `BG01_split01_q60.jpg` (139,386 bytes) and `BG02_split01_summer_q60.jpg` (195,940 bytes); Sakura should follow the same optimized-derivative naming and size pattern.
- `scripts/generate-active-level.mjs` serializes only the selected catalog level (plus the explicit Level9 follow-up case) and shares identical asset manifests. It does not independently override the background from tuning, so the apply/export synchronization path must be inspected before editing.
- Runtime switching is already generic: `getSelectedBackgroundUrl()` prefers `SCENE_TUNING.background.asset`, and the view reapplies that texture during tuning changes.
- `scripts/apply-scene-tuning.mjs` updates `src/scene-tuning.js` and the selected-level marker only; it does not update `src/level-catalog.js`.
- `scripts/generate-active-level.mjs` currently serializes the catalog asset manifest unchanged. When a non-summer background is baked into tuning, the production JS can therefore retain both the selected tuning URL and the catalog's summer fallback URL.
- The narrow fix is to clone each selected session level during generation and overwrite `assets.background` with `SCENE_TUNING.background.asset`. Runtime behavior stays unchanged, but both the tuning and generated manifest then reference the same single background.
- AppLovin packaging enumerates all built assets but only substitutes URLs present in the inlined entry HTML/JS/CSS. Preventing extra background URLs from entering production source is sufficient to keep unused editor alternatives out of the final HTML.
- A q60 progressive JPEG derivative was generated at `public/assets/applovin/textures/BG01_split01_Sakura_q60.jpg`: 2100x3382, 278,157 bytes. Visual inspection preserves the supplied composition and major edge/detail readability while keeping the expected package increase manageable.
- Touched source/test syntax checks pass, as do the focused background selector and active-level generator contract tests.
- With a temporary baked Sakura selection, prebuild generated the current durable selected Level5 payload with its background manifest overwritten to Sakura. The production build passed with only the existing Vite chunk-size warning.
- The temporary Sakura AppLovin HTML is 4,191,471 bytes and passes all 15 static checks, leaving 808,529 bytes under the strict limit.
- Final HTML contains no original asset filenames because the packager replaces referenced URLs with data URIs; byte-content fingerprints are required for the definitive selected-only assertion.
- Base64 byte fingerprints confirm the temporary Sakura package embeds only `BG01_split01_Sakura_q60.jpg`; summer, winter, and the original Sakura PNG are absent.
- After restoring the summer default, the refreshed final package embeds only `BG02_split01_summer_q60.jpg`; Sakura, winter, and the original PNG are absent.
- Browser DOM QA at the local editor shows exactly three background options: `BG01 \u51ac\u5b63`, selected `BG02 \u590f\u5b63`, and `BG01 \u6a31\u82b1`.
- Selecting `BG01 \u6a31\u82b1` in the real editor immediately changes the phone preview to the supplied Sakura artwork. The select value resolves to `/assets/applovin/textures/BG01_split01_Sakura_q60.jpg`, and browser error logs remain empty.
- The final restored selection remains Level5 + summer in source/exported/generated state. Final AppLovin size is 3,972,231 bytes with SHA-256 `3300A5FDC1045513203224648AB414AB472E5C490CC6C2D873817DE9C060196F`.
- The current worktree was already broadly dirty across level, tuning, editor, runtime, tests, and generated artifacts. This task preserved those changes and only added the Sakura derivative/option, generator background override, focused contracts, regenerated current artifacts, and short durable records.

## 2026-08-03 Level16 guide-45 package

- Level16 contains visible vehicle 45 (`6` seats, color index `2`), so it is a valid guide target.
- The prior guide remained scoped to `level15 + vehicle 157`; changing only the id would keep the guide hidden on the current Level16 package. Both normal and disabled first-click guide configs therefore need `level16 + vehicle 45`.
- Editor localStorage may still contain the exact prior guide pair. The existing saved-default migration now upgrades `level15 + 157` to `level16 + 45` for both guide configs without changing offsets, scale, speed, mask settings, or first-click enabled state.
- The refreshed final package is 3,968,019 bytes and leaves 1,031,981 bytes under the strict limit. Both guide configs contain `levelKey: "level16", vehicleId: 45`; the first-click guide remains disabled.
- All 15 AppLovin static checks pass. Only the optimized summer q60 background is embedded, and the final SHA-256 is `7E4C981851EFC8F3F13371E2ED6109553D6327FCA04585507AE9909391FBA7CF`.

## 2026-08-03 Level16 parameter package

- Requested production values map to `level.selected = level16`, `background.asset = BG02_split01_summer_q60.jpg`, `installGate.successfulOperationThreshold = 30`, `vehiclePath.parkingBounds.minX/maxX = -2.2/2.2`, and `vehicleArea.positionUnitScale/modelScale = 0.8/0.7`.
- The optimized summer background is already the baked source/export asset, so this package does not need another image conversion or duplicate background asset.
- Current pre-change values are Level15, threshold 40, path X bounds -2.53/2.53, map scale 0.73, and vehicle model scale 0.63. `artifacts/scene-tuning.json` is the authoritative patch input for `npm run apply:tuning`, which also synchronizes `src/scene-tuning.js` and `artifacts/selected-level.txt`.
- Selecting Level16 generates a single-level production payload; the special Level9 -> Level7 session expansion does not apply.
- Final generated session is exactly `['level16']` with 37 vehicles and queues 139+79. The production build passes with only the existing >500 kB chunk warning.
- Final AppLovin single HTML is 3,968,021 bytes with 1,031,979 bytes remaining under the strict limit. All 15 static checks pass and marker scans confirm Level16, threshold 30, path X -2.2/2.2, map scale 0.8, model scale 0.7, and `You Win!`.
- Binary embedding verification confirms the package contains the q60 summer background and contains neither the 1,035,562-byte summer source nor the winter background. SHA-256 is `9B6B584D7E58765471B1EDEA4F8CF6C455A41C23873133A9D3D0BAFD5644A201`.
- Existing browser tabs can retain the complete prior editor tuning in localStorage and override new source defaults. A development-only migration now upgrades only exact previous package defaults (Level15/40/-2.53/2.53/0.73/0.63); production excludes this path and the rebuilt package remains byte-identical.

## 2026-08-03 editor final-level freeze

- `BusLoopGame.checkEndState()` correctly sets `status = 'won'` only after every vehicle is `done` and no passengers remain, so the model is not deadlocked.
- `main.js` then always hides `#end-panel`; when there is no next session level it also leaves `showResultOverlay('You Win!')` disabled. The final editor frame therefore has no replay or next action even though the runtime has completed normally.
- Follow-up requirement supersedes the simple replay-panel approach: final victory should reuse `showResultOverlay()` so the existing icon, title animation, CTA art, and store bridge are shared with the failure state; only the title changes to `You Win!`.
- The final implementation calls `showResultOverlay('You Win!')` only after `advanceAfterWin()` returns no next level. Intermediate Level9 -> Level7 completion still reconstructs Level7 and returns before the overlay call.
- Browser DOM inspection confirms one shared result title, one `Play Now` CTA, and one `/assets/main-loading-icon.png` logo; no error-level console logs were reported.

## 2026-08-03 editor layout-switch queue mismatch

- Level16 source/catalog data is already validated at 218 seats and 218 authored passengers with exact per-color parity, so do not alter its queue sequences before reproducing a runtime discrepancy.
- Editor `level.selected` changes are saved immediately, persisted through `/__playable-level`, and followed by a full page reload. Startup resolves the selected catalog level, calls `setActiveLevel`, constructs a fresh `BusLoopGame(selectedLevel)`, then initializes queues from that same model level.
- `BusLoopGame.initializeQueues()` rebuilds its visible queues and source queues from `this.level.passengerQueues`; the next diagnostic must count visible queue items, source items, and belt slots together to distinguish a real loss/mix from finite on-screen queue capacity.
- Direct initialization with the current maximum layout capacities preserves exact totals for both Level15 (510) and Level16 (218). Every runtime per-color count matches both authored queues and vehicle seats; only the visible queue heads differ because the rest remain in `sourceQueues` for later refill.
- The current editor is Level15 + DualQueue3. That conveyor layout exposes 22 visible passengers per side, so counting only the on-screen side queues cannot equal the 510-seat vehicle layout.
- The real duplication occurs after passengers enter the belt: non-structural editor changes call `initializeQueues()` with `resetSlots: false`; the old implementation rebuilt both side/source queues from the full authored arrays while retaining occupied belt slots. Level16 therefore grew from 218 to 226 after eight passengers entered the belt.
- Non-reset queue initialization must preserve the current remaining side/source sequence and only recalculate capacity/distance metadata. Explicit `resetSlots: true` keeps the prior full authored reset behavior.

## 2026-08-03 Level16 import discovery

- Supplied source `D:/备份/busloop素材关卡/level16.asset` is a 19,337-byte Unity YAML level file. Its filename yields catalog key `level16`, while its authored internal `id` is `14`; preserve both values rather than rewriting the Unity id.
- The asset declares `mapScale: 0.95` and `conveyorBeltName: ConveyorBelt4`. Vehicle and fixed passenger queue sections are present; exact counts and per-color parity still require structured extraction.
- The request is to add a new layout, not to replace the current production selection. Preserve the existing Level15 selection unless validation reveals an explicit project rule requiring otherwise.
- The existing extractor already derives catalog keys/options from filenames and validates per-color passenger totals. Level16 needs only a new default source entry, regenerated catalog/artifact output, a Vite persistence whitelist entry, and focused catalog coverage; no new editor control subsystem is required.
- Production generation reads `artifacts/selected-level.txt` and emits only the selected session, so keeping that marker at Level15 allows Level16 to be development-selectable without increasing the current AppLovin package.
- Structured parsing finds 37 unique vehicle ids with 218 total seats (`14x4`, `17x6`, `6x10`) and two authored queues of 139 + 79 passengers. Seat and passenger color totals match exactly: `{0:30,1:36,2:44,3:18,5:24,6:20,7:34,8:12}`.
- The source `m_Name` is also `level14`, confirming the filename/internal-name mismatch originates in the supplied asset. Catalog key/display should remain filename-based (`level16`) while provenance fields retain Unity `id: 14`.
- `conveyorBeltName: ConveyorBelt4` exists in the YAML, but the current level extractor/runtime do not store or consume that field; conveyor shape remains the independently selected global editor layout. The user specifically scoped this import to vehicle layout and passenger queues, so no conveyor mapping should be invented.
- Direct runtime-collision diagnostics report zero initial vehicle-body overlaps, every derived yaw is finite, and every authored `vehicleDepthes` reference points to an existing Level16 vehicle id.
- Browser QA confirms Level16 appears after Level15 in the editor, the Vite endpoint accepts the selection, and the reloaded scene visibly renders the new vehicle ring plus both passenger queues on a nonblank 644x1328 canvas with zero error-level console messages.

## 2026-08-03 summer background packaging decision

- The supplied summer JPG is 1,035,562 bytes at 2100x3382. A quality-60 derivative preserves the dimensions and visual composition at 195,940 bytes, so production uses the derivative while retaining the original as the source asset.
- AppLovin packaging replaces only asset URLs present in the production JS/CSS/HTML. Keeping BG01 in the development-only editor options does not embed it in the final package; the verified HTML contains the summer q60 bytes and contains neither the original summer bytes nor BG01 bytes.
- The verified single HTML is 3,979,125 bytes, leaving 1,020,875 bytes under the project's strict 5,000,000-byte limit.

## 2026-07-30 Level15 import discovery

- Supplied source `D:/备份/busloop素材关卡/level15.asset` is a Unity YAML level asset with `id: 15`, `m_Name: level15`, and `conveyorBeltName: ConveyorBelt6`.
- The existing reproducible import boundary is `scripts/extract-unity-levels.mjs`; it owns source paths, exact passenger-queue overrides, per-color seat validation, and generated catalog/artifact output. Focused coverage lives in `test/level-catalog.test.js`.
- The supplied sequences contain 278 left-queue passengers and 232 right-queue passengers (510 total); the Unity asset contains 81 unique vehicles and 510 seats.
- Queue color totals are `{0:86,1:58,2:70,3:54,4:76,5:48,6:62,7:56}` and exactly match the Unity vehicle-seat totals color by color, so the queues are valid as an authoritative override.
- Replacement queue request redistributes the same 510 passengers to 296 left + 214 right while preserving the exact combined color totals `{0:86,1:58,2:70,3:54,4:76,5:48,6:62,7:56}`; no vehicle color/seat changes are required.
- Requested editor/runtime fields map to `vehicleArea.positionUnitScale` (Map Scale), `vehicleArea.modelScale` (vehicle model size), `vehiclePath.parkingBounds.minX/maxX` (drive-path X bounds), and both `vehicleGuideHand` / `firstClickGuide` for guide level and vehicle id.
- Making an imported level the current playable requires synchronizing `src/scene-tuning.js`, `artifacts/scene-tuning.json`, `artifacts/selected-level.txt`, and the Vite development-selection whitelist; Level9-only guide `levelKey` values are separate scope controls and must remain unchanged.
- The former default Level7 path under `D:/UnityProjects/.../Level_Escape_C/level7.asset` has drifted to an unrelated 42-vehicle, color-8 layout. The compatible preserved 83-vehicle source is `D:/备份/改文件名临时文件夹/level7.asset`; the extractor now uses that stable backup so adding Level15 does not rewrite or invalidate Level7.
- The planning skill session-catchup helper cannot run because neither `py` nor `python` is available in this Windows workspace; continue from the existing planning files plus direct workspace inspection.
- Current AppLovin packaging route remains `npm.cmd run build` -> `npm.cmd run package:applovin` -> `npm.cmd run check:applovin`; local completion requires a single fully inlined HTML <= 5,000,000 bytes, while official preview and real-backend play remain external manual acceptance steps.

## Level9 to Level7 session transition - 2026-07-17

- New packaging request: disable only the first-step timed mask (`firstClickGuide.enabled`) while retaining the ordinary Level9 vehicle-114 guide hand, threshold 40, and guide size 2.12.
- `SceneView.updateGuideHand()` suppresses the ordinary sprite only while `firstClickGuide.enabled` is truthy, so setting that flag to `0` both hides the timed DOM mask/hand and restores the normal vehicle guide without runtime code changes.
- Final package markers confirm `firstClickGuide.enabled: 0` and `vehicleGuideHand.enabled: 1`; the new single HTML remains 3,653,268 bytes, passes all AppLovin static checks, and has SHA-256 `041493FEB89FB3714FBF72CEFB2D4E6C7D2CED5006BF166C5412B720FCF83EE5`.
- Current packaging request uses the project's established AppLovin baseline path: baked source/exported tuning -> `npm.cmd run build` -> `npm.cmd run package:applovin` -> `npm.cmd run check:applovin` -> fixed-marker/hash inspection of `artifacts/applovin/index.html`.
- AppLovin delivery remains a single fully inlined HTML using the existing MRAID bridge. Local checks cannot replace AppLovin preview/upload validation.
- Requested baked values are successful-operation threshold 40, both guide targets on Level9 vehicle 114, and `vehicleGuideHand.size` 2.12.
- Initial config inspection confirmed source and exported tuning were synchronized at threshold 20 and guide size 2.52; both already held Level9 vehicle 114 before the requested parameter update.
- The project checker enforces one HTML <= 5,000,000 bytes, inline script syntax, no external script/stylesheet, no WAV, MRAID CTA, no `window.open` fallback, lifecycle/startup markers, and an allowlist for only the Android/iOS store URLs plus W3C namespace references.
- First package generation produced 5,926,059 bytes (5.652 MiB). Every AppLovin checker item passes except the 5,000,000-byte limit, so the remaining work is package-size optimization rather than bridge/runtime correction.
- Level9 and Level7 use the same asset manifest, but the generated session serialized that manifest twice. Because the AppLovin packager replaces every asset URL occurrence with a full data URI, the duplicate manifest repeated the encoded models/textures/audio in the single HTML. The generator can safely share the primary level's asset object with follow-up levels while retaining distinct vehicle/passenger layouts.
- After sharing the manifest, the final single HTML is 3,653,268 bytes and all static checks pass. Marker inspection confirms threshold 40, both Level9 vehicle-114 guide configs, guide size 2.12, and the MRAID-only CTA bridge. SHA-256: `79B7951D936AEBF1D0D5E6340555157607C234A4C641056BB7FB82BFC505745B`.

- Guide follow-up: source/exported tuning still stores vehicle 89 even though the current editor setting is vehicle 114. Persist vehicle 114 in both `vehicleGuideHand` and `firstClickGuide` so production matches the requested current configuration.
- Both guide layers are owned by `SceneView`: the normal sprite uses `vehicleGuideHand`, while the timed DOM mask/hand uses `firstClickGuide`. Level scoping must be checked in both `updateGuideHand()` and `isFirstClickGuideActive()` to guarantee Level7 suppression.
- Add a durable `levelKey: 'level9'` to both guide configs. Saved editor patches that omit this field will preserve the source default through the existing deep merge.
- Vehicle 114 exists in both baked session levels, confirming that id-only lookup will reproduce the guide on Level7 unless the active `LEVEL_1.key` is checked.
- The editor already supports option-backed fields through `LEVEL_OPTIONS`, so both normal and first-click guide scopes can be exposed as level selectors without adding new editor infrastructure.
- Final guide verification passes: the scope helper returns true for Level9 and false for Level7 for both configs; guide/session tests pass 6/6 and the production build succeeds.
- The 749,343-byte final bundle contains `vehicleGuideHand` and `firstClickGuide` as `levelKey: "level9", vehicleId: 114`.

- Follow-up clarification: the conveyor artwork and general passenger/conveyor layout must remain stationary during the Level9-to-Level7 handoff. Only the newly created Level7 vehicle roots should animate upward from below.
- `replaceActiveLevel()` already clears `initialEntryPathStates` and `queueEntryPathStates`; `main.js` then calls `initializeGameQueues({ resetSlots: true })` on a fresh Level7 model. This preserves the existing two-sided `entryMotion` startup path, so no separate passenger animation system is needed.
- The current `layoutRoot` owns conveyor art, spots, passengers, guide, vehicles, and effects; animating it scales/moves all of them. Add a child `vehicleRoot` for vehicle views and animate only that child while leaving `layoutRoot` at its identity transform.
- Ground-plane screen direction is represented by positive world Z toward the lower/near side of the camera, so a vehicle-root Z offset can provide the requested from-below entrance without changing vehicle scales.
- Level7 supplies two queues, capacity 24 per side, entry percents `[0, 0.421]`, and the standard initial-fill metadata. A focused model regression can confirm both entry indices become active after the fresh Level7 queue reset.
- Final implementation uses a dedicated `Vehicle Layout Root` with a positive-Z start offset of 8 and a 0.85-second cubic ease-out to zero. Conveyor art, parking/passenger layout roots, and vehicle scale remain unchanged during the handoff.
- Refined verification passes 13/13 across session/catalog and paired CTA tests. The 749,210-byte production bundle contains the vehicle-only entrance markers, excludes the old scale entrance marker, and retains only Level9/Level7 data.

- The current production boundary is still a generated single active level (`src/generated-active-level.js`); Level7 and Level9 coexist only in the development catalog. A production two-level session therefore needs an explicit second-level payload path instead of relying on editor-only catalog imports.
- `src/main.js` owns the session-wide CTA/install state (`numberCountBus`, `isFinish`, and the counted vehicle set), while its existing `reset()` clears all three. The Level9-to-Level7 handoff must rebuild the game/view without calling that session reset path.
- Current win handling in `syncHud()` hides `#end-panel` and calls `showResultOverlay('You Win!')`; this is the end-page behavior that must be disabled for the intermediate Level9 win and, per request, temporarily suppressed altogether.
- `BusLoopGame` already accepts a level argument in its constructor, and `level-data.js` exposes `setActiveLevel(level)`, so the model can be reconstructed around Level7 while keeping CTA state in the outer bootstrap scope.
- `SceneView` reads the live `LEVEL_1` binding throughout construction and update logic but has no level-swap or full-dispose API. The least invasive safe transition is to add a focused scene rebuild method that clears level-specific scene objects/state and rebuilds them after `setActiveLevel(level7)`, or to make the bootstrap replace the entire view while explicitly disposing the old renderer/listeners/assets.
- `src/main.js` currently declares `game` and `view` as constants and exposes those fixed objects through `window.__busLoop`; a real in-session level swap requires mutable runtime references and QA accessors that resolve the current objects.
- The install counted set currently keys only by numeric vehicle id. Because Level9 and Level7 reuse numeric ids, a shared counter must namespace uniqueness by level key while preserving the accumulated numeric count.
- Level9 and Level7 share the exact same runtime asset manifest, conveyor scene, and background; only authored level data differs. The existing loaded Three.js templates/textures can be reused safely, so the transition only needs to replace level-specific vehicle roots and reset transient render state.
- Current production generation writes only `ACTIVE_LEVEL`. The focused extension is to keep Level9 as `ACTIVE_LEVEL` and emit Level7 as a named session follow-up from the same generator, preserving the narrow production payload without importing the full development catalog.
- Structural sizes: Level9 has 37 vehicles with queues 131+131; Level7 has 83 vehicles with queues 368+278.
- `VehicleEffects.clear()` already removes live particles and resets timing/contact state, so render-level handoff can explicitly clear effects before replacing vehicle roots.
- `BusLoopGame.subscribe()` returns an unsubscribe closure. The main runtime should unsubscribe the completed Level9 model before creating/subscribing Level7, preventing stale listeners and duplicate win handling.
- The generated runtime now contains exactly `level9` and `level7` when Level9 is selected; direct inspection confirms 37/83 vehicles and queue sizes 131+131 / 368+278 in that order.
- The current install threshold is 20 while Level9 has 37 vehicles. To keep Level9 completable, reaching the threshold during Level9 records `installReady` but does not intercept input or open the store until the session advances to Level7.
- Focused verification passes 12/12 across session/catalog and paired CTA main-thread/threshold paths. The production bundle is 749,274 bytes and includes only Level9/Level7 markers among imported levels; the existing >500 kB Vite warning remains unchanged.

## Level7 vehicle 66/82 coordinate sync - 2026-07-16

- The authoritative input is `D:\UnityProjects\BusLoop\Assets\BusJam\Game\Bundleables\Level_Escape_C\level7.asset`.
- Project navigation maps this change to `scripts/extract-unity-levels.mjs`, generated `src/level-catalog.js` / `src/generated-active-level.js`, and `test/level-catalog.test.js`.
- Level7 is already the durable selected production level; the prior package contains 83 vehicles and queues 368+278.
- Current Unity-authored coordinates are vehicle 66 `x=-0.15425447, z=0.95464253` and vehicle 82 `x=0.77715284, z=0.57091796`; both retain their existing rotations.
- The extractor already has a per-level `vehicleOverrides` mechanism, while focused Level7 assertions currently cover vehicle 89 color plus exact queue order.
- Level7 positions are parsed directly from the Unity asset by `parseUnityLevel`; no new hardcoded override is needed. The durable repo changes should be regenerated catalog/artifact/active-level data plus a focused coordinate regression.
- Compared with the current generated Level7 payload, vehicle 66 moves from `(-0.14925447, 0.8996426)` to `(-0.15425447, 0.95464253)`, and vehicle 82 moves from `(0.78215283, 0.6409179)` to `(0.77715284, 0.57091796)` in web `x/z` coordinates.
- The active generated level is already `level7`. Run the extractor with `--selected=level7`, then focused catalog/collision checks, `npm.cmd run build`, `package:applovin`, and `check:applovin`.
- After regeneration, both the development catalog and single-level production payload contain the exact new coordinates, and the complete 83-vehicle Level7 collision scan still reports zero initial overlaps.
- Vite strips leading zeros from decimal literals in the final package; Level7 markers appear as `id:66 ... x:-.15425447,z:.95464253` and `id:82 ... x:.77715284,z:.57091796`.

## DualQueue3 Trajectory Refresh - 2026-07-16

- The screenshot requires DualQueue3 closed curve `offsetX 0`, `offsetZ 0.85`, `scaleX 0.75`, `scaleZ 0.80`; entry 1 `offsetX 0.60`, `offsetZ 0.95`; entry 2 `offsetX -0.60`, `offsetZ 1.00`.
- The current tuning selected `dualQueue3` but its per-layout transform still held stale DualQueue2-like values (`offsetZ 0.60`, entries `0.60/0.90` and `-0.50/0.90`). The package therefore needs a real config correction before rebuilding.

## Current Editor Tuning Rebuild - 2026-07-16

- The browser editor state is authoritative for this request; `artifacts/scene-tuning.json` must be refreshed from the editor before `npm.cmd run apply:tuning`.
- Browser page inspection cannot access the main-world `window.__busLoop`, but every editor row carries its exact tuning path in `data-path` and exposes the current value in a number input or select. Those path/value pairs are sufficient to rebuild the complete editor-authored patch without reading browser storage.
- The automated fresh-tab form state was stale. The user's direct runtime export is authoritative: `level7`, `dualQueue3`, guide vehicle 89 with base X `0.25`, right-side approach `0.62`, far/near scale `1.14/1`, speed `0.55`, and a 3-second mask sized `0.62 x 0.62` with padding 15.
- The production workflow keeps the editor catalog development-only and regenerates `src/generated-active-level.js` from the selected level during `npm.cmd run build`.
- AppLovin delivery remains one fully inlined HTML under 5,000,000 bytes with MRAID CTA/ready handling and no external asset URLs.
- The final Level7/dualQueue3 package is 3,639,703 bytes with SHA-256 `1AEC67487626C7E73EBB07DE00967344FA0EE6F47BCE61042274ECD8DD03DA5C`; static validation and package marker checks passed. Automated local `file://` runtime QA was blocked by browser URL policy, so AppLovin preview/upload play remains pending manual validation.

## Level7 Escape C Import - 2026-07-16

- Follow-up validation: vehicle 89 is a visible 10-seat parking-area vehicle currently using color 5. Changing it to color 2 requires moving exactly 10 passenger entries from color 5 to color 2.
- The revised right queue remains length 278 and changes counts from `{0:66,1:44,5:76,6:22,7:70}` to `{0:66,1:44,2:10,5:66,6:22,7:70}`. Combined with the unchanged left queue, it exactly matches the projected vehicle seat totals after vehicle 89 becomes color 2, with zero per-color mismatch.
- The durable override and revised queue were applied successfully; extraction regenerated the selected Level7 catalog/artifact/active payload with unchanged structural counts (83 vehicles, queues 368+278).
- Verification exposed that `artifacts/selected-level.txt` is currently `level9`; generating active Level7 created a selection mismatch even though the Level7 catalog assertions passed. Preserve the existing Level9 selection and regenerate active/artifact selection as Level9 while retaining the updated Level7 catalog entry.
- After resynchronizing to current selection Level9, focused catalog/collision tests pass 12/12. Direct Level7 verification confirms vehicle 89 `{seats:10,colorIndex:2}`, right queue length 278 with counts `{0:66,1:44,2:10,5:66,6:22,7:70}`, and exact combined seat/passenger color parity.
- Production build passed with the current selected Level9 payload and only the existing Vite >500 kB chunk warning; Level7 changes remain in the generated development catalog/artifact.
- Source: `D:\UnityProjects\BusLoop\Assets\BusJam\Game\Bundleables\Level_Escape_C\level7.asset` (42,234 bytes, Unity id 7, mapScale 1).
- The asset contains 83 parking-area vehicles and 646 total seats. Seat totals by color are: `0:110`, `1:126`, `3:44`, `4:50`, `5:112`, `6:74`, `7:130`; vehicle seat types are 18 four-seat, 19 six-seat, and 46 ten-seat vehicles.
- The asset's serialized fixed queues are not usable for this import: they total only 152+124 passengers and include color 8, which has no corresponding vehicle seat total. The user's supplied left/right queues must explicitly override the asset queues before `validateLevel()`.
- Existing ownership is `scripts/extract-unity-levels.mjs` -> `artifacts/unity-levels.json` + `src/level-catalog.js` + selected `src/generated-active-level.js`, with catalog coverage in `test/level-catalog.test.js`.
- The supplied queues parse cleanly as left/queue 0 length 368 and right/queue 1 length 278, totaling exactly 646 passengers. Combined color counts exactly match the 83 vehicles' seat totals for every color (`0,1,3,4,5,6,7`) with zero mismatch.
- Queue-specific counts are left `{0:44,1:82,3:44,4:50,5:36,6:52,7:60}` and right `{0:66,1:44,5:76,6:22,7:70}`.
- `artifacts/selected-level.txt` currently selects Level9 and is the production generator's authoritative selection. This import should update it to Level7 and regenerate the active payload; `src/scene-tuning.js` remains a fallback default of Level5.
- Level7 was added between Level5 and Level8 in the default source order, `artifacts/selected-level.txt` now selects `level7`, and extraction succeeded with `83 vehicles, queues 368+278`; the generated active module is Level7.
- Focused catalog/collision tests pass 12/12. Direct generated-data verification confirms options `[level5, level7, level8, level9, level10, level13]`, active key `level7`, exact passenger/seat color totals, and zero initial Level7 vehicle-body overlaps.

## Level8/Level9 Initial Collider Parity - 2026-07-16

- The imported vehicle positions and yaw values come directly from each Unity level asset; yaw is reconstructed from the serialized quaternion.
- The extractor does not read per-prefab collider geometry. It assigns hard-coded web collision bodies by seat count: width `0.27` for all types and lengths `0.4814318817567568`, `0.5639630614864864`, and `0.6785897` for 4/6/10-seat vehicles.
- Runtime collision uses centered oriented boxes and treats exact boundary contact as overlap (`<=` in all SAT axes). The next check is to enumerate the Level8/Level9 pairs and compare their authored prefab collider bounds/centers against these hard-coded dimensions.
- A direct SAT diagnostic on the current catalog reproduced 22 initial overlap pairs in Level8 and 21 in Level9. The common Level8 straight-line spacing is about `0.51`, while two hard-coded 6-seat lengths sum to a required center spacing of `0.563963...`; penetrations commonly reach about `0.054`.
- Level9's curved chains show the same pattern across rotated 6-seat vehicles, so the defect is systemic rather than a single bad imported pose. `D:\UnityProjects\BusLoop\Assets` is available for authoritative prefab inspection.
- Authoritative prefab YAML confirms the web constants are wrong for 4-seat and 6-seat buses. After applying each collider object's local scale, Unity sizes are approximately: 4-seat `0.27000001 x 0.47157903` with local center Z `-0.02223980`; 6-seat `0.27 x 0.486` centered; 10-seat `0.27000002 x 0.67858938` centered.
- All 33 normal color/seat prefabs under `BusAndPassenger` use the same values for their seat class. The current web lengths `0.48143188` (4-seat) and `0.56396306` (6-seat) do not match those prefabs; especially the 6-seat body is about `0.077963` too long.
- Substituting the authoritative sizes removes every initial overlap in Level9 and reduces Level8 from 22 pairs to three very small 4/6-seat contacts. Level5 also becomes clean; Level10 and Level13 retain one small 4-seat-related pair each if the prefab's nonzero 4-seat collider center is applied literally.
- Unity runtime sets `scene.VehicleScale = clamp(config.mapScale, 0.5, 1.8)` before borrowing vehicles, while the level asset stores raw vehicle transforms. The remaining question is how `VehiclePool` applies the inverse/scene scale and whether authored `position` denotes the vehicle transform or an adjusted collider reference point.
- `BusJamConfig.asset` is the authoritative logical collision source and contains exactly: 4-seat `{x:0.27,z:0.47157902}`, 6-seat `{x:0.27,z:0.486}`, 10-seat `{x:0.27,z:0.6785897}`. `VehicleConfig.GetSize()` and `GameScene.GetVehicleSize()` use these centered sizes; the prefab BoxCollider's 4-seat center offset is not part of the gameplay geometry graph.
- Unity scales both authored positions (about the parking-area anchor) and logical vehicle sizes by the same `VehicleScale`, so overlap relationships remain invariant in the raw level coordinate space used by the web runtime.
- Using the centered `BusJamConfig.asset` sizes eliminates all initial oriented-box overlaps in all five imported levels, including Level8 and Level9. This identifies the root cause as stale/incorrect 4-seat and 6-seat web length constants, not position/yaw extraction or SAT tolerance.
- The five supplied source assets are at `D:\备份\改文件名临时文件夹\level{5,8,9,10,13}.asset`; the extractor's current default path string is mojibake and should be corrected while regenerating.
- `test/level-catalog.test.js` already owns an oriented collision-box helper and the prior Level13 overlap regression, making it the narrow test boundary for asserting the Unity size table and zero initial Level8/Level9 pair overlaps.

## Configurable Success Redirect - 2026-07-15

### Real-device failure comparison

- Exact comparison against `before-second-playable-20260709-153725/applovin-index.html` found no missing gate step: both versions de-duplicate vehicle IDs, increment after `game.clickVehicle(...)` returns `ok`, call `InstallFullGame()` on the threshold-reaching operation, count arrived vehicle states as a fallback, reset the gate, and intercept later canvas presses while finished.
- The intended difference is only the threshold source: old `Au=10` versus current `SCENE_TUNING.installGate.successfulOperationThreshold` defaulting to 40.
- `openStore()` is also structurally unchanged: both versions call only `window.mraid.open(url)` and have no browser fallback, so the next comparison boundary is whether the current vehicle callback still executes synchronously inside a platform-recognized pointer event.
- `artifacts/applovin` currently contains two distinct packages: stale `Bus Fever - Car Jam Escape Playable_applovin_Hard.html` from 2026-07-09 (3,293,249 bytes, SHA256 `7ED436...B392C1B7`) and current `index.html` from 2026-07-15 (3,630,878 bytes, SHA256 `CD8648...ABC8AE6`). The uploaded filename/hash must be confirmed during retest.
- Fixed-index extraction confirmed the supplied working backup and current `index.html` both contain the same active `clickVehicle -> ok -> unique count -> threshold -> InstallFullGame` chain and the same finished-state canvas interception. No logical gate step is missing from current `index.html`.
- The stale `Bus Fever - Car Jam Escape Playable_applovin_Hard.html` does not contain the active `?.ok&&...` success-gate chain, despite still containing `mraid.open`. Uploading that descriptive filename would reproduce “CTA bridge exists but the 40-success redirect never fires.”
- A 50-seed model diagnostic on the current level13 + DualQueue3 content reached 40 or more successes on stronger play paths (best 45) but lost as early as 5 on poor paths. Threshold 40 is technically reachable but close to the level's practical deadlock boundary, unlike the working backup's threshold 10.
- Old and current audio `unlock()` implementations are equivalent, including `AudioContext` creation/resume and preload ordering, so no new audio dependency omission was found before `mraid.open()`.
- Current SceneView and the working backup both synchronously invoke the vehicle callback from a canvas `pointerup`; no user-gesture timing regression was found.
- The newer game-over overlay does cover the canvas, unlike the older end panel behavior, but the active success-click gate calls the store before that overlay path. It is only relevant if the threshold is reached through the asynchronous arrived-state fallback and the following tap lands on the overlay.
- Final-package browser instrumentation used a temporary copy with threshold 1 and a recording MRAID stub. A real canvas click at vehicle 130's projected center produced `GATE_DIAG 1 1 true` and `MRAID_OPEN https://play.google.com/store/apps/details?id=gridplus.busjam.carpuzzle` in the same millisecond.
- The first visual click landed under the animated guide-hand offset and correctly logged `GATE_REJECT blocked`; computing the actual vehicle-center projection was necessary to trigger the valid operation. This demonstrates why visually counted taps can exceed the internal `ok` count.
- Current `index.html` therefore reaches and invokes `mraid.open()` when its internal successful-operation count reaches the threshold. Remaining real-device hypotheses are (1) fewer than 40 actual `ok` operations or (2) the device/platform MRAID bridge rejecting/ignoring the call.

- The supplied backup AppLovin package used `Au=10` and called `InstallFullGame()` on the same successful vehicle click that raised the unique count to the threshold; later canvas clicks also reopened the store while the finished gate remained active.
- Current `src/main.js` retained the same unique-vehicle counter and parked-state fallback, but disabled both entry paths. Restoring those existing paths preserves the prior semantics without introducing another gameplay counter.
- The threshold now lives at `SCENE_TUNING.installGate.successfulOperationThreshold`, defaults to `40`, is normalized to an integer of at least one at runtime, and is exposed in the editor as a 1-200 whole-number control.
- `src/scene-tuning.js` and `artifacts/scene-tuning.json` are synchronized so later editor export/apply/package cycles retain the default.
- The final level13 AppLovin artifact is 3,630,878 bytes and contains both `installGate:{successfulOperationThreshold:40}` and an enabled same-click successful-operation redirect.

## Imported Levels And Collision Parity - 2026-07-15

- The referenced demo worktree is clean; its collision parity implementation is committed source, centered on `src/vehicle-collision.js` plus small `BusLoopGame` integration changes and focused `test/vehicle-collision.test.js` coverage.
- Before this change, the playable used static depth chains for dispatch. Runtime dispatch now uses the demo geometry graph; vehicleDepthes remains provenance/debug evidence.
- All five supplied Unity assets are readable YAML and share `GameSceneDualQueue2`. Each contains complete vehicles, a ground container, legacy `vehicleDepthes`, and `fixedPassengerSequence` entries carrying both `queueId` and `colorIndex`; level10 also contains vehicle anchor metadata that is outside the current base playable mechanics.
- Full-level switching is structurally different from the existing conveyor-prefab switch: it must replace vehicles and both authored passenger queues together, then rebuild the game/view runtime.
- To satisfy single-level delivery, the all-level catalog must remain development-only. Production should import a generated active-level module containing one selected payload; the editor catalog can stay behind the existing Vite development-only dynamic editor import.
- Extracted totals: level5 has 61 vehicles and queues 202+202; level8 38 and 140+140; level9 37 and 131+131; level10 64 and 218+218; level13 75 and 202+202. Every per-color passenger total matches vehicle seats.
- The production default is level5. Editor selection writes `artifacts/selected-level.txt` and reloads the runtime; exported/applied tuning synchronizes the same marker, and prebuild emits only that payload.
- Legacy currentLevel12 remains internal template data but is excluded from editor options because its manually altered spacing does not produce a viable geometry graph.
- Focused level/collision tests pass 9/9. Vite build and AppLovin checks pass; the 3,627,325-byte package contains only level5.asset.
- Browser QA switched level5 -> level8 -> level5 successfully with no error-level console messages.
- Broader test/game-model.test.js: 27 passed / 8 failed. The remaining failures are existing stale parking-count, queue, texture-dimension, and path-tuning expectations; updated collision tests pass.

## DualQueue B-Spline Turn Fix - 2026-07-15

- The active defect is a continuation of the multi-conveyor feature: DualQueue3/10 Unity prefabs use closed Dreamteck B-splines, while the web renderer currently treats all generated control points as closed Catmull-Rom curves.
- Preserve the four-passenger group structure and shared tangent rotation; the path interpolation type is the confirmed parity gap.
- The workspace is not recognized as a Git repository, matching the previously recorded limitation. Avoid Git-dependent diff/recovery steps and verify touched files directly.
- The extractor already merges arbitrary prefab property maps for direct and nested layouts; `splineType` can be read from `_spline.type` on the same merged conveyor-role properties used by `extractPoints`.
- `SceneView.buildPathCurves()` is the single closed-conveyor construction point and currently hardcodes `THREE.CatmullRomCurve3`; open queue paths should remain on their existing Catmull-Rom path.
- `scene-layout.js` is dependency-free pure math and is the right unit-test boundary for a Dreamteck B-spline point sampler; `scene-view.js` can adapt its `{x,y,z}` result into `THREE.Vector3`.
- Targeted prefab inspection shows the final closed conveyor types are all `BSpline` (`1`), but through distinct authored values: DualQueue2/3/10 set the conveyor spline to `1` directly, while DualQueue5 overrides ConveyorBelt6's base conveyor value `0` to `1`. Extraction must therefore read the merged role properties rather than hardcode a shared type.
- The installed Dreamteck source at `Assets/Plugins/Dreamteck/Splines/Core/Spline.cs` uses plus signs for both nested polynomial terms and the constant term in `CalculateBSplinePosition`; this differs from the minus signs in the handoff transcription. Implement against the actual source formula.
- Closed Dreamteck evaluation uses `doubleIndex = pointCount * progress`, `fromIndex = floor(doubleIndex)` (clamped to the last point at progress `1`), local `t = doubleIndex - fromIndex`, and control points `(i-1, i, i+1, i+2)` wrapped modulo the point count.

## Multi-Conveyor Layout Work - 2026-07-14

- The active level identifies itself as `GameSceneDualQueue2`; runtime conveyor speed uses the actual rendered curve length returned by `SceneView`, so switching the renderer curve can preserve distance-based passenger speed if queue initialization is rerun.
- Current ownership is split across `src/level-data.js` (authored conveyor/queue points and gameplay constants), `src/scene-view.js` (Three.js curves and art), `src/scene-tuning.js`/`src/scene-editor.js` (editable tuning), and `src/main.js` (reinitializes queues after full tuning changes).
- The repository does not contain the requested Unity prefab files. It currently contains only the DualQueue2-derived `Loop_02.png` plus extracted spline/queue data, so layouts 3/5/10 must be read from the original Unity project rather than approximated.
- Broad text search touched generated AppLovin artifacts and produced excessive output. Further searches must explicitly exclude `artifacts`, `dist`, `node_modules`, and archive files.
- The original Unity source is available at `D:\UnityProjects\BusLoop`. All four requested prefabs exist under `Assets/BusJam/Game/Bundleables/Prefabs`; layouts 2, 3, and 10 are about 1.02 MB each, while layout 5 is about 276 KB.
- Each target prefab contains Dreamteck `_spline.points` overrides. DualQueue2 visibly binds `Loop_Road_02`, `Left_Road_02`, and `Right_Road_02` sprites; the remaining layout-specific sprite GUIDs/names and spline groups still need structured extraction from the prefab modification lists.
- Unity-authored capacities differ by layout: DualQueue2 uses conveyor 32 / queues 24+24; DualQueue3 uses conveyor 36 / queues 22+22; DualQueue10 uses conveyor 38 / queues 26+26. Layout 3 uses `Loop/Loop_Road/Left_Road/Right_Road_03`; layout 10 uses the corresponding `_04` assets.
- `GameSceneDualQueue5.prefab` is structurally different and much smaller: it instantiates the conveyor/queue visual objects as nested prefabs and overrides their splines rather than serializing the objects inline. Its direct scene component exposes one `passengerQueue` and one `conveyorBelt` reference, so its referenced prefab GUIDs must be resolved before deciding whether it is genuinely dual-entry at runtime.
- Layout 5's conveyor source GUID resolves to `Assets/BusJam/Game/Bundleables/Prefabs/ConveyorBelt6.prefab`; its other resolved nested prefabs are background/sky/parking/shadow visuals.
- Layout 3 art resolves to `Textures/Car_0307/Loop_03.png` plus `Sprites/Loop_Road_03.png`, `Left_Road_03.png`, and `Right_Road_03.png`. Layout 10 uses the same `_04` asset family. These are real source files suitable for copying into `public/assets`.
- `ConveyorBelt6.prefab` is a true dual-entry layout despite the outer `GameSceneDualQueue5` exposing singular references: it contains `PassengerQueueDual6`, queue capacities 26+26, conveyor capacity 31, exit range about 0.615-0.795, and `_06` loop/road sprites. The scene prefab applies additional overrides to this nested layout.
- The current web renderer builds both the closed belt and open queue curves from `LEVEL_1`, applies global path tuning plus separate curve tuning, and reuses one `loopPlane`. Supporting layout switching therefore needs a catalog consumed by `SceneView`, a texture swap on that plane, and layout-aware game constants (`capacity`, entry percents, exit range) rather than only changing the image.
- DualQueue5's outer overrides target spline component file IDs inside `ConveyorBelt6.prefab` (GUID `e138...`). Many overridden points only change X while inheriting Y/Z from ConveyorBelt6, so its final authored geometry must be computed by merging the base ConveyorBelt6 spline with the scene-level overrides.
- The extraction approach will be reproducible: classify spline components through each prefab's `conveyorSpline`/`queueSpline` references and stripped-object source mapping, then merge nested prefab overrides for DualQueue5. This avoids relying on approximate visual tracing.
- The `_03`, `_04`, and `_06` loop textures are all 2100x1300. Their authored sprite crops are respectively `(0,56,2100,1244)`, `(0,57,2100,1243)`, and `(0,58,2100,1242)`, matching the existing `_02` crop pattern.
- Web curve conversion mirrors Unity Z around `SCENE_TUNING.path.centerZ`, then applies global path scale/offset and per-curve coordinate transforms. Layout-specific tuning can reuse this pipeline without rewriting passenger animation logic.
- The new extractor successfully reconstructs every requested layout as a 19-point closed conveyor spline plus two 20-point queue splines. DualQueue2 output structurally matches the existing web data.
- Final Unity layout constants from extraction: DualQueue2 `32 / 24+24 / exit 0.605-0.78`; DualQueue3 `36 / 22+22 / exit 0.625-0.77`; DualQueue5 (ConveyorBelt6) `31 / 26+26 / exit 0.615-0.795`; DualQueue10 `38 / 26+26 / exit 0.635-0.77`.
- `scripts/extract-unity-conveyor-layouts.mjs` now provides a repeatable prefab-to-JSON path and correctly merges the nested DualQueue5 overrides. The generated inspection artifact is `artifacts/unity-conveyor-layouts.json`.
- Layout switching cannot stay renderer-only: `BusLoopGame` currently reads conveyor capacity, queue capacity, entry percents, and exit range directly from immutable `LEVEL_1`. These need instance-level runtime configuration supplied by the selected layout.
- `SceneView` currently allocates exactly 32 conveyor passenger views and 24 queue views per side. It must allocate catalog maxima (38 conveyor, 26 queue) so editor switching never addresses missing visual groups.
- Entry percents can be computed from the rendered curves by finding the closest closed-curve progress to each queue head. Passing those values into the game model keeps passenger entry aligned with authored trajectories and remains correct if curve tuning changes.
- Runtime tuning should treat a layout selection as a structural change: resize/reset the game belt and queues, then reinitialize with the selected capacity, computed entry percents, actual curve lengths, and layout exit range. Ordinary visual tuning can keep the existing lighter reinitialization path.
- The source loop PNGs are 1.2-1.36 MB each, while the current Loop_02 q80 WebP is only 43 KB. Pillow 12.1 is available, so importing the three extra shapes as q80 WebP assets will keep the playable package impact small.
- Generated `src/conveyor-layouts.js` now holds the four prefab-derived catalogs plus maximum capacities and lookup helpers. The four q80 WebP loop assets total about 238 KB, with each file between 43 KB and 68 KB.
- `scene-editor.js` already supports string-valued select options and has a visibility-refresh pattern for passenger material controls. The conveyor UI can reuse both: one layout selector plus four layout-specific tuning sections that only show the selected layout's fields.
- `SCENE_TUNING` now has independent `art`, closed-curve, and two queue-curve transforms for each of the four layout IDs, while retaining the legacy top-level DualQueue2 fields for exported-tuning compatibility.
- The existing regression suite contains source-contract assertions for editor fields and the old single `initializeQueues(...)` call. Those assertions must be updated alongside behavioral catalog/model tests so they validate the new selector, layout visibility, runtime config handoff, and SceneView catalog usage.
- Unity's queue `conveyorBeltIndex` ordering is opposite the current web `queuePaths` order for DualQueue2. The web convention is queue 0 = left/negative-X entry and queue 1 = right/positive-X entry; extracted layouts must normalize by queue-head X to preserve passenger sequence ownership.
- After left-to-right normalization and regeneration, the catalog exactly matches existing DualQueue2 closed/queue points, and focused tests pass for all requested IDs/assets, runtime capacity/entry/exit configuration, and editor-renderer-main wiring.
- Required Vite production build passes; output includes the existing >500 kB chunk warning. The in-app browser QA path is blocked by the bundled browser client's `process` redefinition error, so visible editor switching still needs a manual browser pass.
- Legacy v3/local exported tuning did not contain `conveyorLayouts`. Main-thread loading and `scripts/apply-scene-tuning.mjs` now copy old `conveyorArt`, `conveyorCurve`, and `queueCurves` into `dualQueue2`, preserving existing tuning during migration.

## Current Durable Findings - 2026-07-08

### Active Level Layout

- The playable now targets imported level12-style data for `GameSceneDualQueue2` rather than the original 6-vehicle level1 prototype.
- Active data has 94 visible vehicles, two fixed queues with 219 groups each, and authored `vehicleDepthes` blocker data for 90 vehicles.
- Vehicle seat totals match fixed passenger queue totals by color. Initial movable vehicles are `1, 4, 34, 51`.
- As of the latest queue-0 variant, fixed queue lengths are `[257, 181]` for 438 passengers; passenger color totals match vehicle seats by color.

### Conveyor / Passenger Entry Parity

- Unity conveyor progress is based on actual spline path length: initial fill uses passenger speed, normal belt motion uses conveyor speed, both divided by spline length.
- Unity queue supply waits until the queue head is ready. During initial fill, empty belt slots clamp just before the entry with `InitialEntryOffsetPercent = 0.0001` until a passenger can enter.
- Web should reuse the full queue-entry visual path for both initial-fill and later refill groups.
- Game Over should not trigger merely when parking spots are reserved. It waits until every occupied parking spot's vehicle is actually `at-spot`, the conveyor has no empty slots, no belt passenger can eventually board, and that condition persists for the configurable `gameOver.failureDelaySeconds` delay.

### Vehicle / Passenger Materials

- Vehicle prefabs use full Unity color atlases; authored model UVs should remain active for window/light/body regions.
- Passenger prefabs are color-specific materials/textures rather than simple runtime swatches. Unity materials combine `_MainTex`, `_BaseCol`, and `_EmissionCol` through `AnimSimpleLit`.
- Current web tuning exposes passenger material color/brightness controls for parity adjustment.

### Effects / Audio / Shadows

- Effect_Hit uses ParticleHit_2/Circle_01_Add, ParticleHit_1/Round_02_Add, and ParticleHit/Round_01_Add at vehicle collision contact.
- Effect_SmokeTrail uses ParticleTrail/Round_01_Alp as a looping moving-vehicle trail.
- Core audio clips are wired for collision, passenger boarding, and full-vehicle departure.
- Real-time Three.js shadow maps were removed after experimentation; authored fake shadows are the active shadow layer.

### AppLovin Packaging

- When inserting large inlined JS/CSS strings into HTML, use function replacers with `String.replace`; plain replacement strings interpret minified `$&` sequences and can inject the matched `</head>` text into the bundle, causing `SyntaxError: Unexpected token '<'` and a loading screen stuck at 0%.
- Editor tuning saved in browser `localStorage` is not a delivery artifact. Before AppLovin packaging, export the tuning JSON and apply it into `src/scene-tuning.js`; the AppLovin single HTML should not include the scene editor UI or editor code.
- Production/AppLovin runtime must not restore editor tuning from `localStorage`; stale platform-preview storage can override newly baked camera/CTA adaptation values and make repeated package changes appear unchanged on device.
- iOS AppLovin store jumps should use `itms-apps://itunes.apple.com/app/id6746743297` as the first MRAID URL, with the `https://apps.apple.com/app/id6746743297` link retained as a fallback. The static AppLovin checker now verifies the direct iOS scheme is present.
- AppLovin single HTML must include the `data:` URL `fetch` compatibility layer for inlined `application/octet-stream` model/VAT assets, and store jumps should remain MRAID-only with no browser `window.open` fallback.
- The 10-vehicle install gate must fire from a successful vehicle dispatch user gesture on real devices; waiting until an asynchronous arrival/frame update can lose the MRAID-open gesture context.

### Camera / Screen Adaptation

- Current trial design-cover behavior is fixed visible height: `camera.fitHeight` remains the vertical visible height across viewport aspects. With `fitHeight: 14.9`, short/wide screens keep visible height 14.9 and only reveal more horizontal content.
- The phone preview frame is an editor-only tool. Production/AppLovin must not add `is-phone-preview`, otherwise CSS can force the stage back to the 1080x2160 design aspect and prevent camera adaptation from seeing the real device/container aspect.

### Vehicle Arrow / Motion

- Bus prefab hierarchy treats Arrow as part of the vehicle visual. Web hit clips should move the vehicle model and arrow under one shared hit root.
- Arrow outline parity is approximated with a dark outline layer behind the white Arrow_01 geometry.
- Authored `vehicleDepthes` remains the blocker/unlock source, but blocked-click hit animations should prefer a nearby directly overlapping visual blocker when one exists; bus 49 should collide with bus 63 rather than indirect depth candidates such as bus 50.

## Luxury Vehicle Import - 2026-09-03

- BusLoop `MatchColor.Luxury` is color index `16`, serialized in level assets as zero-based `colorIndex: 15`.
- Luxury vehicles use six passenger seats but the original model/collision depth follows the ten-seat vehicle footprint; imported validation therefore requires six seats while runtime fits the limousine model to the ten-seat depth.
- Luxury has no mechanism section requirement. The editor accepts only color index 15 as the special vehicle/passenger type; index 14 remains rejected.
- Runtime resources are editor-owned: compressed `Luxury_001.fbx.bin`, compressed `Idle_wealthy.fbx.bin`, and dedicated limousine/passenger textures. The wealthy passenger is rendered from the original FBX's 824-UV bind-pose topology to avoid VAT vertex-order tearing; movement is currently path translation while the 77-frame VAT resources remain retained for a future exact Unity vertex-order export. Wealthy passengers use the authored 90-degree Y model yaw without adding the ordinary passenger model correction; extracted Unity bone quaternions are converted to the FBXLoader basis before playback.
- Spatial passenger instancing is disabled for levels containing Luxury so the dedicated model/material path is preserved.

## Garage Mechanism Import - 2026-09-03

- Unity garages are passive containers: they automatically release the first authored vehicle when the exact door box is clear, allow only one active exit, wait `0.3s`, move for about `0.6s` to a `0.7` forward offset, and hide after the final vehicle leaves.
- Runtime garage collision uses Unity's `0.50425464 x 0.668775` garage footprint plus the next vehicle's actual collision size. Other active garages can block the door.
- Editor-owned resources are `Garage_Truck_01.fbx`, its fake-shadow FBX, both Unity textures, and the original `garage_out.wav` / `garage_clear.wav` clips at volumes `0.7979798` / `1`.
- Browser QA with a temporary, non-persisted three-vehicle garage confirmed authored release order, door blocking, count changes `2 -> 1 -> cleared`, final hide, and zero error-level logs. The QA-only level hook was removed after validation.
- Current Unity garage levels such as `BusJam/level101.asset` contain garage data but no authored `fixedPassengerSequence`; the playable importer correctly refuses to invent passenger order. A real garage level should not be added to the editor catalog until an authored queue source is supplied or an explicit deterministic-generation rule is approved.
- The final AppLovin HTML contains all six garage resources and decodes the WAV clips after user interaction. It is currently `6,738,170` bytes, so only the deferred 5 MB size check fails.

## Garage Visual Correction - 2026-09-03

- SHA-256 and byte-size comparisons against the current `BusLoop` checkout match for both garage FBX files, both textures, `garage_out V1.1.wav`, and `garage_clear.wav`; no legacy duplicate was used.
- `Garage.prefab` rotates its `Truck` child by `Y=180°`; the playable now applies that offset to the garage model and fake shadow while keeping gameplay/container yaw unchanged.
- `Ani_Truck_Stay`/`Ani_Truck_BusOut` animate `Bone_Box/Bone_Door01` and `Bone_Box/Bone_Door02` around local `Z` with opposite signs. The playable now uses that hinge axis and the authored approximately `144.25°` swing.
- Garage visual targets and collision footprints use the shared `1.3x` enlargement. This keeps the enlarged blocking volume tied to the enlarged garage footprint rather than scaling the model alone.
- Three.js `FBXLoader` converts the garage FBX `AmbientColor` metadata into an `AmbientLight`; leaving it attached brightens every `MeshStandardMaterial` while a garage is present. The importer now removes imported lights from the garage template before it enters the scene, leaving lighting exclusively under the playable's scene-light configuration.
- The garage doors are on the imported model's negative `Z` side; after the Prefab `Y=180°` correction, the runtime front is local positive `Z`. The fake shadow now receives a small `+Z` offset (`0.1`) while retaining the shared `Y` ground offset.

## Garage Shadow Alignment - 2026-09-04

- The remaining rearward shadow offset was corrected with a `0.1` local-unit `+Z` translation on the fake shadow. Because the shadow remains under the garage view's shared scale and yaw, the adjustment follows every garage orientation without changing collision geometry.

## Archive

Full detailed 2026-07-07 findings were archived to:

- `docs/project/archive/findings.full-2026-07-08.md`

## 2026-09-29 前贴视频触发交互前 AUDIO_PLAY

- 失败导出中的前贴控制器显式调用了 `HTMLMediaElement.play()`，部分平台检测会把它记录成交互前 `AUDIO_PLAY`；视频即使已静音也可能被误判。控制器现在只使用原生 `autoplay + muted`，并在任何加载前同时设置 `defaultMuted` 与 `volume = 0`，声音只在可信点击后恢复。
- 前贴视频标签在 HTML 初始解析阶段就带有 `autoplay muted playsinline`，避免导出单 HTML 后初始化顺序变化；打包产物不再包含前贴控制器的显式 `video.play()` 调用。
- Verification: 前贴单元测试、Chrome runtime smoke（含静音前贴和交互前音频门禁）通过；重新生成 `artifacts/applovin/index.html` 并通过 AppLovin 静态检查。
## 2026-09-07 Conveyor mechanism tuning boundary

- Conveyor presentation values that were confirmed through the manual adjustment pass must not live in browser-saved `SCENE_TUNING`: the shipped contract is isolated in `src/conveyor-mechanism-config.js`.
- The confirmed values are visual root scale `1.375` (the prior `1.25` pass plus `10%`), left door outward factor `1.17`, right door outward factor `1.20`, and right-side vehicle visibility factor `0.93`.
- The imported component baseline is explicit zero position/unit scale/zero rotation for belt, arrow, both doors, and both side overlays. The temporary editor menu now stores independent component overrides on top of that baseline; the fixed mechanism values remain outside this mutable object.

# Web LevelEditor Migration - 2026-09-07

- The authoritative Unity editor is under `D:\UnityProjects\BusLoop\Assets\BusJam\Game\Editor\LevelEditor`.
- Its scope includes canvas pan/zoom, grid movement, normal/anchor rotation, scale/rotate, box selection, parking-element/group movement, clipboard duplicate/cut/copy/paste, undo/redo, serialization, and inspectors for vehicles plus parking area, gate queue, garage, elevator, and conveyor groups.
- Vehicle authoring includes at least color, seat count, turn state, hidden/combination/linkage/wrench-related data, ambulance, and firetruck mechanisms. Existing web import deliberately rejects several of these mechanisms, so full parity requires extending the web data/runtime boundary rather than only adding UI.
- Existing web ownership is split among `src/scene-editor.js`, `src/scene-view.js`, Unity level import/generation, and the standalone spatial conveyor editor. There is no editable full-level document model yet.
- Unity's exact top-level authoring schema includes `id`, `mapScale`, `difficulty`, `conveyorBeltName`, background material, passenger method, vehicles, containers, conveyor belt widths, fixed passenger sequence, and five vehicle-mechanism lists.
- Vehicle records contain id, seats, hidden/turn flags, color, position, quaternion rotation, container type/id, and elevator layer. Mechanisms are linkage head/tail/distance; wrench/gear pair/color; second combination color; ambulance step limit; and firetruck time limit.
- Container records cover ParkingArea, Garage, ConveyorBelt, GateQueue, and Elevator. Gate queues add path shape, lock, gap, and path points; elevators add a 2D size and upper/lower layers; conveyor groups add exit width.
- Unity shortcuts include save/copy/paste/cut/duplicate/undo, delete, mirror, reset view, and toggles for vehicle snap/alignment guides/grid snap. Toolbar operations include depth rebuild, validation, CSV/Excel export, equal spacing, centering, vehicle-to-gate conversion, and vehicle lookup.

# Level Editor Vehicle/Passenger Colour Binding - 2026-09-18

- The web authoring document has no persistent `vehicleId -> passenger` relation. Colour edits therefore bind seats deterministically to same-colour passenger occurrences in queue order and vehicle document order, with combination primary seats before secondary seats.
- The binding replaces colours in place, so manual queue layout is preserved; capacity reconciliation remains the final guard for malformed or incomplete queues. An explicit persisted binding graph can be added later if per-passenger identity becomes a requirement.
## 2026-09-24 识图路线：先做确定性二维预处理，AI 只做候选补全

- 当前照片识别的主要误差不是“没有把 3D 变成 2D”，而是箭头短、车身阴影/高光、编辑器叠加层和斜向阵列被简化成四向朝向。`src/level-image-recognizer.js` 已保留箭头主轴，按 15° 量化 `yaw`，并沿主轴回采车身颜色；垫图旋转也会同步到车辆朝向。
- 暂不把视觉大模型作为主识别器：大模型适合给出车辆候选框/方向/颜色，但对 48+ 辆车的像素级中心和稳定排序不可作为直接落盘数据，且会引入网络、密钥、成本和平台部署依赖。候选结果应回到同一套本地校验、预览和人工修正流程。
- 下一阶段若继续提升，优先做“单张照片四点校正/裁剪 -> 每车按箭头旋转到 canonical 2D patch -> 实例分割/颜色与 OBB 估计 -> 置信度和漏检/重复提示”。对当前径向构图不要启用整图行列吸附；平面校正主要服务于车身尺度和遮挡处理，不应重写已识别的世界坐标。

## 2026-09-24 识图失败样本根因

- 用户提供的失败截图带有编辑器红色安全框、网格和编号牌，不是车辆原图。白色编号牌会被箭头检测器解释成车辆，单张图产生 `125` 个候选并形成 `42px` 假网格。
- 识别入口现在对跨图红框 fail-closed，UI 会提示重新上传无红框/网格/编号牌的原图；大型白色规则矩形也通过箭头剖面过滤。不能靠调颜色容差解决这类输入污染。
- 箭头照片模式另外按箭头轴线扫描车身长度，自动把明显长车识别为 10 座；手动座位数仍优先。

## 2026-09-29 全平台导出 DevTools 超时

- 失败根因是远程导出并发启动多个平台及 Android/iOS 双设备 Chrome 检测，容器资源不足时 Chrome 在 DevTools 端口监听前退出或卡住；旧进程还会继续占用临时调试端口。
- 远程容器固定 `PLAYABLE_EXPORT_CONCURRENCY=1`，runtime gate 使用进程组清理并支持导出中止；DevTools 启动等待为 `15s`，服务端导出超时为 `10min`。
- 直接全平台导出已完成 14 个变体，自动检查 `468/496` 通过；Docker CLI 当前不支持 `docker build --check`，容器镜像语法仍需在支持 BuildKit check 的环境验证。

## 2026-09-29 编辑器直接导出策略

- 用户明确要求导出按钮不再检测，因此编辑器 HTTP 导出路由传入 `skipChecks: true`；本地 CLI 仍默认执行完整规则、payload 和 runtime 检测，避免降低离线发布验证能力。
- 直接导出不是平台合规保证：聚合包 manifest 使用 `EXPORTED_WITHOUT_LOCAL_CHECKS`，下载提示要求后续平台验收。Google Ads 的 fallback 图从已存在的备份资源复制，不启动 Chrome 截图流程。
## 2026-10-13 Exported playable CTA fallback

- 普通浏览器打开平台导出包时没有广告宿主对象，原先只有 AppLovin 有预览回退，Google/Meta/Unity/Mintegral/Moloco/TikTok 会因缺少平台 CTA API 而无法跳商店。
- `src/platform-bridges/basic.js` 统一提供已插入 DOM 的 `<a>` 预览跳转；各平台桥接仅在原生 API 不存在时使用该回退，容器内仍保持原平台 CTA 契约。
- 真实广告平台仍需在官方预览中验收；浏览器回退只解决导出文件直接打开测试时的跳转问题。


## 2026-10-23 车辆序号重排必须同步三类引用

- 车辆 id 不只是画布上的标签，它同时是运行时寻址（`clickVehicle(id)`、`getVehicle(id)`、碰撞/车库 `vehicleIds`）、Unity 导出 `vehicles[].id`、以及 `vehicleDepthes` 的键和值。删除后随手改号会打断这三处，所以重排要在同一个事务里成组改写。
- `vehicleDepthes` 的值是**混合命名空间**：既可能是车辆 id，也可能是非停车区容器 id（level20 里车辆 1/2 与车库 1/2 撞号，深度图里 313 条车辆引用、10 条容器引用）。重排时先按车辆解析、再退回容器，容器引用必须原样保留，否则车库/闸门阻挡关系会被误改。
- 车辆文档数组顺序在所有现有 web 关卡里都等于 id 升序（level48/49/50/51 也无例外地保持递增），因此「按当前 id 排序后重排为 1..N」既消除了空号，又不会改变运营在画布上看到的相对顺序。
- 引导车 id 存在 `SCENE_TUNING`（及导出 JSON 的 `tuning` 快照）里，不在关卡文档的 vehicles 中，重排必须通过回调把它一起搬走并落盘，否则删车后引导手指会指向另一辆车。带 `levelKey` 且不等于当前关卡的那份配置属于别的关卡，不能动。
- 删除时先清理深度图里对已删车辆/容器的引用再压缩编号，顺序反过来会把空出来的 id 分配给仍活着的车，让已删除的阻挡者重新变成真实阻挡。


## 2026-10-28 点车音效导出后消失：catalog 数据卷滞后，音效表也只在 catalog 里

- 现象：编辑器预览里点车有声，远端导出的包里没有。用户 15:33 下载的 `BL-Q1V1-…-AL-0-0 (4).html` 里音频配置只有 `bus_hit` / `passenger_up` / `bus_full` 三项、5 段 `data:audio/mpeg`；`vehicle_tap` 只出现在代码分支（`vehicle-dispatched` 事件、`vehicleTapDelay`/`vehicleTapVolume`），没有对应的 `vehicle_tap:{clips:…}`。
- 根因与 2026-10-23「黑白车导出变蓝」是同一个：`Dockerfile` 把 `PLAYABLE_LEVEL_CATALOG_PATH` 指向 `/app/artifacts/level-catalog.js`，而 `/app/artifacts` 是数据卷，`start.sh` 只按 `.seeded-v1` 首次播种。卷里的 catalog 停留在 `vehicle_tap` 加入之前，于是 web 关卡的 `assets.audio` 基座（`levelDocumentToRuntime(document, LEVEL_CATALOG.level5)`）没有这一条。音频文件和代码都在，只是关卡数据不引用它，打包器按关卡文档扫描资源，自然也不会内联。
- **静默失败**：`GameAudioController.play()` 查不到 `audioConfig[name]` 时直接 return，既不报错也不 `console.warn`，静态检查和 runtime smoke 都不会发现——这和色卡 `?? [0]` 是同一类"不报错的退化"。
- 严格复现：把 `src/level-catalog.js` 里 19 处 `vehicle_tap` 删掉当旧 catalog，设 `PLAYABLE_LEVEL_CATALOG_PATH` 跑 `generate-active-level.mjs`，5 个关卡全部只剩三个音效名，与远端导出逐项一致。
- 修复：新增 `src/level-audio-config.js` 作为关卡音效的代码内唯一来源（照 `color-atlases.js` 的先例），`generate-active-level.mjs` 的两条解析路径过 `completeLevelAssets()`，`src/level-data.js` 的 `setActiveLevel`/初始 `LEVEL_1` 用 `withCompleteLevelAssets()` 补齐，`src/main.js` 组装控制器时对合并后的音效表再补一次（会话关卡合并绕过了 `setActiveLevel`）。关卡自带的值优先，不覆盖。
- 打包器另外要补一条：`package-applovin-single-html.mjs` 的资源白名单加上 `LEVEL_AUDIO_CONFIG` 的全部 clip。运行时会补齐音效表，所以关卡文档没写的 clip 也可能被播放；只按文档扫描会让兜底路径指向单文件广告里不存在的根相对 URL。
- **clip 路径必须写成完整字面量**，不能用 `${ROOT}/name.mp3`：单 HTML 打包器按精确 URL 匹配内联，模板字符串压缩后会留成 `${ms}/bus_hit_V5.mp3`，任何替换都改不到。这也是 `mechanism` 资源要在 `replaceBundledDynamicAssetUrls()` 里特殊处理的原因。
- 验证：旧 catalog 与正式 catalog 各导出一次 `export:playable --platform applovin`，`sha256` 完全相同（`e72e79b8…`，3,960,348 B）——产物已与 catalog 版本无关。真实 Chrome 打开两份成品，真实手势解锁后点引导车，音频探针各抓到一次 `createBufferSource.start()`，buffer 时长 0.392 s（`vehicle_tap.mp3` 实际长度）。`check:applovin` 23 PASS / 1 FAIL，失败项为既有的 `/assets/applovin/textures` 根相对常量，改动前的产物也有同一处。
- 教训：任何"随关卡数据下发的资源清单"都会跟远端数据卷的旧副本一起退化。色卡那次把表搬进代码只解决了一半，音效表当时没做——**新增的音效/资源一旦靠 catalog 承载，就同时补一条代码内兜底**。

## 2026-10-28 共享编辑器里别人的关卡会被覆盖：版本校验挡的是「旧」，挡不住「别人」

- 现象：别人新建的关卡经常被别人保存时覆盖。编辑器是多人共用的内网工具（同一个 artifacts 卷），关卡就是 `artifacts/web-levels/<key>.json`。
- 根因不是并发写，而是**缺少写入者身份**。`saveWebLevelDocument` 只有 `baseRevision` 校验，它挡的是「你手上的版本已经过期」；两个人先后打开同一个关卡、各自改完保存，第二个人的 revision 是当时最新的，于是**合法地**覆盖了第一个人。`deleteWebLevelDocument`、两个导入路径同样没有任何身份判断。
- 修复：新增写入归属（ownership），不是鉴权。
  - `scripts/level-ownership.mjs` 持有规则：名字规范化（折叠空白、去控制字符、截断 40）、比较键 `levelOwnerKey`（小写化，`WXJ` 与 `wxj` 是同一人）、注册表形状、`resolveLevelWrite` 返回 claim/allow/refuse，以及冲突文案。
  - `vite.config.js` 在保存（PUT）、网页关卡导入、Unity `.asset` 导入、两种删除上统一 `requireRequestLevelOwner(request)`（缺名字 403）＋`assertLevelWritable(levelKey, owner)`；写成功后才 `claimLevelOwner`，删除时释放归属。
  - 注册表落在 `artifacts/level-owners.json`，和关卡同卷、随部署保留。**不写进关卡文档**：`createLevelDocument` 按固定字段表重建文档，任何塞进去的 owner 字段都会在下次保存时被丢掉。
  - `src/level-owner.js` 是浏览器侧的一半：名字存 `bus-loop-level-owner-v1`，`X-Level-Owner` 头（URL 编码，中文名字不依赖 header 编码），以及和服务端一致的规范化/比较键。
- **第一版在这里错了**：当时让「没有归属的旧关卡由第一个写入者自动认领」，理由是省掉迁移。实际效果是用户照样能改别人的关卡，因为 42 个已有关卡全都没有归属，谁先保存谁就把它吞下来，而且完全没有提示。现在的规则是：**没有登记归属的关卡默认只读**，保存和删除都返回 403 `LEVEL_UNCLAIMED`；要接手必须走独立的 `POST /__level-authoring/<key>/claim`，界面上是「认领此关卡」按钮，带确认弹窗，且只能认领不存在归属的真实关卡（认领别人的关卡 403，认领不存在的 key 404）。
- 新关卡不受这条限制：文件还不存在就没有可保护的东西，创建者直接拥有，所以「新建关卡」不会被护栏挡住。判断依据是 `pathExists(<key>.json)`，而不是 `createOnly` 参数——后者可以由客户端伪造。
- 名字大小写必须不敏感：第一版用了严格相等，实测 `WXJ` 存进去后自己用 `wxj` 保存会被 403 锁在门外——对防误覆盖的护栏来说这是不必要的伤害。现在是「存储保留首次输入的写法，比较不区分大小写」。
- 选择器里每个关卡都显示归属（`名称 · WXJ`），删除前会提示「该关卡属于 X」，这样「为什么我存不了」在尝试之前就能看到。
- 边界：这是护栏不是鉴权。任何客户端都能伪造 `X-Level-Owner`；它让「我不是故意改这个关卡」变成不可能，让「我要接手」变成显式动作。真正的多租户隔离需要登录体系。
- 验证：`node --test` 393/393（新增 `test/level-ownership.test.js` 13 条）；对本机 dev server 跑了 13 项 HTTP 端到端：匿名写 403、首写认领 201、列表带 owner、他人 PUT/DELETE 403 且文件未变、本人可写、`wxJ` 视为同一人、删除后释放可被他人认领。
