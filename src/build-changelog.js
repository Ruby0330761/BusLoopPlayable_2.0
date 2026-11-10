// What changed in each editor release.
//
// The editor shows this on the 关于 panel so an operator can tell whether the
// build in front of them already has the fix they were waiting for. Newest
// first. Keep each entry to the user-visible outcome — the level of detail that
// belongs in git history or docs/project/playable-project-progress.md does not
// belong here.
//
// When shipping a release: bump `src/build-version.js`, then prepend an entry
// whose `version` matches it exactly.

export const BUILD_CHANGELOG = Object.freeze([
  {
    version: '20261110-1712',
    date: '2026-11-10',
    title: '底部标题跟随系统语言（CTA 不动）',
    changes: [
      '底部标题按玩家设备语言显示，取自需求方「双端商店 title」表',
      'Google / iOS 两端的标题分开：同一语言在两店措辞不同时各自生效',
      '简体中文只有 iOS 表有，Google 端按表里的规则回退英文',
      'Play Now 按钮维持原有八种语言，其它语言回退 Play Now',
      '加载页标题与底部标题保持一致'
    ]
  },
  {
    version: '20261110-1642',
    date: '2026-11-10',
    title: '导出加 5 MB 硬限制，上传素材自动压缩',
    changes: [
      '超过 5 MB 的试玩包不再下载，导出直接报错并列出占用最大的内联素材',
      'ZIP 平台按解包后的大小判断，与平台审核口径一致',
      '上传的贴图 / 自由素材自动转 WebP，BGM 自动转 MP3，状态栏显示压缩前后大小',
      '进度条三个标记图改用已有的 WebP 版本，单包体积减少约 1 MB'
    ]
  },
  {
    version: '20261110-1411',
    date: '2026-11-10',
    title: '新增「关于」页面',
    changes: [
      '编辑器右上角新增「关于」按钮，点开可查看每个版本的更新内容',
      '当前运行版本会在列表顶部标记「当前版本」',
      '点击遮罩、关闭按钮或按 Esc 均可关闭'
    ]
  },
  {
    version: '20261110-1136',
    date: '2026-11-10',
    title: '修复 Moloco 包被检查平台误判为外链',
    changes: [
      '进度条的标记图改用运行时拼接标签，检查平台不再把模板字符串里的 <img> 当成真实外链',
      '运行时画面与修复前完全一致'
    ]
  },
  {
    version: '20261110-1113',
    date: '2026-11-10',
    title: '进度条压住刻度胶囊',
    changes: [
      '进度条与白色描边改到 100% 刻度胶囊上方，右端圆头不再被胶囊和立柱切断',
      '骷髅节点、巴士指针、失败率气泡保持在最上层'
    ]
  },
  {
    version: '20261110-1105',
    date: '2026-11-10',
    title: '进度条适配小屏',
    changes: [
      '进度条的 X/Y 偏移改为按条宽缩放，iPhone SE 等小屏不再把失败率气泡顶出画面',
      '四档屏幕宽度实测气泡均完整可见'
    ]
  },
  {
    version: '20261110-1052',
    date: '2026-11-10',
    title: '修复导出被拒',
    changes: [
      '编辑器不再写已废弃的 exportNaming.stamina 字段，导出恢复正常'
    ]
  },
  {
    version: '20261110-1043',
    date: '2026-11-10',
    title: '引导素材三件套',
    changes: [
      '背景音乐：可上传 / 下载 / 删除，曲目在引导页选择',
      '特效：全屏粒子天气（雨 / 雪 / 风 / 落叶），强度、速度、大小、透明度、风向、颜色可调，可上传粒子贴图',
      '自由素材：上传图片后可在画面中拖动摆放，支持固定（锁定后不可拖），可下载和删除',
      '导出时只打包本关实际引用的素材'
    ]
  },
  {
    version: '20261109-2114',
    date: '2026-11-09',
    title: '进度条整体默认隐藏',
    changes: [
      '进度条（含骷髅节点、巴士指针、刻度胶囊、失败率气泡）默认不显示',
      '需要时在引导页打开「启用进度条」即可，开启后呈现完整设计'
    ]
  },
  {
    version: '20261109-1942',
    date: '2026-11-09',
    title: '进度条位置与轨道配色可调',
    changes: [
      '进度条默认垂直位置调整到传送带带面内，与参考一致',
      '轨道渐变新增 4 个可调色标（起点 / 前段 / 后段 / 终点），改色即时生效'
    ]
  },
  {
    version: '20261109-1813',
    date: '2026-11-09',
    title: '去掉进度条左侧白色高光斑',
    changes: [
      '删除轨道左端的装饰性椭球高光，色带保持完整通透'
    ]
  },
  {
    version: '20261109-1116',
    date: '2026-11-09',
    title: '品牌 Icon 增加可调圆角',
    changes: [
      '图标按实际绘制区域收缩为正方形后再裁圆角，编辑器截图同步处理',
      '新增「Icon 圆角」参数，默认 30，可调范围 0–120'
    ]
  },
  {
    version: '20261106-1141',
    date: '2026-11-06',
    title: '修复换背景后无法导出',
    changes: [
      '补上 background.horizon 默认值，切换或上传背景后导出不再被校验拒绝'
    ]
  }
]);

/** Look up the entry matching a build version, if this release is documented. */
export function findChangelogEntry(version) {
  const key = String(version ?? '').trim();
  return BUILD_CHANGELOG.find((entry) => entry.version === key) ?? null;
}
