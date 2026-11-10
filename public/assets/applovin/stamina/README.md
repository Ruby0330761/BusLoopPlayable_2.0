# 体力与开场素材

来源：用户提供的 `BFT-2610283/前置+进度条素材/`（2026-11-09）。

- `heart.png` / `heart-empty.png` / `frame.png`：原满心、空心、HUD 底框，保持附件字节。
- `intro-3.png` / `intro-5.png`：附件专用前置模块原图，保留作为源文件。
- `intro-1-source.png` / `intro-10-source.png`：沿用三心模块的立体框、标题胶囊、星星与字形适配；一心居中、十心两排五颗。数字使用项目字体，文字分别为 `1 REVIVE!` / `10 REVIVES!`。
- `intro-{1,3,5,10}.webp`：运行时版本，按最大展示宽度 620px 等比输出，再以无损 WebP 编码（与相应派生 PNG 的 RGBA 逐字节相同）。3/5 保持原设计；1/10 使用上述适配设计。手机通常展示约 270px。
- 2026-11-10 扩展：新增 `intro-{2,4,6,7,8,9}-source.png` 与对应 `.webp`，按已确认 1–10 需求适配原专用模块；6–9 为两排，奇数上排多一颗、下排居中。使用 `scripts/prepare-stamina-intros.py` 与已有 Pillow 生成，无网络/新增依赖；620px 无损 WebP（exact RGBA）用于运行时，PNG 只用于维护。原 1/3/5/10 图不改。

导出只嵌入当前档位的一张开场图；关闭开场时不嵌入。原尺寸源图不加入运行时资源白名单，以控制单 HTML 包体。

验图证据：`artifacts/playable-exports/stamina-qa/intro-artwork-validation.json`、`intro-four-presets.jpg`。使用本地 Pillow 进行素材处理，没有外部上传或新增项目依赖。
