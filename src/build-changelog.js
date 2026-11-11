// What changed on each day the editor shipped.
//
// The editor shows this on the 关于 panel so an operator can tell whether the
// build in front of them already has the fix they were waiting for. Newest
// first. Keep each entry to the user-visible outcome — the level of detail that
// belongs in git history or docs/project/playable-project-progress.md does not
// belong here.
//
// One entry per DAY, not per release. A day's work often ships as several
// builds (fix, re-fix, tweak); listing each one separately turned the panel
// into a scroll of near-duplicates where the same feature appeared three times
// with contradictory descriptions. Merge the day's outcomes into one entry and
// keep the intermediate build stamps in `versions` so the panel can still match
// a running build to its day.
//
// `version` is the day's newest build stamp: it is what `findChangelogEntry`
// resolves, so a build made mid-day still finds its entry through `versions`.
//
// When shipping a release: bump `src/build-version.js`, then either append the
// stamp to today's `versions` (normal case) or prepend a new day entry when the
// date rolled over.

export const BUILD_CHANGELOG = Object.freeze([
  {
    version: '20261111-1451',
    date: '2026-11-11',
    versions: ['20261111-1015', '20261111-1214', '20261111-1451'],
    title: '「关于」按天汇总；修复被挡后车看不出移动',
    changes: [
      '同一天的多次发布合并成一条，不再一次迭代开一个版本',
      '面板里仍能看到当天所有构建时间，便于核对线上跑的是哪一次',
      '历史条目按天重新归并，重复的返工过程不再逐条罗列',
      '修复被别车挡住的点击看不出反应：斜邻车贴住车头时几何间距为 0，碰撞动画被压到 1 毫秒，车看起来完全没动，只剩一团火花',
      '现在被挡时至少会前顶一小段再回弹，玩家能确认这一下点到了',
      '进一步修正碰撞反馈距离：画出来的车比碰撞盒长 1.4–1.6 倍，原来顶到碰撞盒边界就停，视觉上车和障碍之间还空着一块，看起来像撞到空气；现在会顶到两侧车身真正贴合的位置'
    ]
  },
  {
    version: '20261110-1826',
    date: '2026-11-10',
    versions: [
      '20261110-1043', '20261110-1052', '20261110-1105', '20261110-1113',
      '20261110-1136', '20261110-1411', '20261110-1642', '20261110-1712',
      '20261110-1806', '20261110-1815', '20261110-1826'
    ],
    title: '语言本地化、导出体积治理与编辑器体验',
    changes: [
      '文案跟随玩家手机语言：Play Now 按钮与底部标题都本地化，覆盖中/日/韩/西/法/德/俄/阿/葡/土/意/印尼/越南共 15 个市场',
      '底部标题按 Google / iOS 双端商店表分别取值，同一语言两店措辞不同时各自生效；加载页标题同步',
      '语言探测同时读取 languages / language / userLanguage，老 WebView 不再回退英文；交付包固定为「跟随设备」',
      '编辑器右上角新增语言下拉（16 项），切换后预览与截图立即按该语言渲染',
      '导出硬限制 5 MB：超限直接报错并列出占用最大的内联素材；ZIP 平台按解包后大小判断',
      '上传素材自动压缩：贴图 / 自由素材转 WebP，背景音乐转 MP3，状态栏显示压缩前后大小',
      '进度条标记图与消防车音效换成压缩版本，单包体积减少约 1.1 MB',
      '引导素材三件套：背景音乐、粒子天气（雨 / 雪 / 风 / 落叶）、可拖动自由素材，导出只打包本关实际引用的素材',
      '进度条适配小屏、压住刻度胶囊、默认隐藏，轨道渐变 4 个色标可调',
      '品牌 Icon 支持可调圆角，按实际绘制区域收缩后再裁圆角',
      '修复 Moloco 检查平台把模板字符串里的 <img> 误判为外链',
      '修复切关后导出被 exportNaming 校验拒绝'
    ]
  },
  {
    version: '20261109-2114',
    date: '2026-11-09',
    versions: ['20261109-1116', '20261109-1813', '20261109-1942', '20261109-2114'],
    title: '进度条成型与 Icon 圆角',
    changes: [
      '进度条（骷髅节点、巴士指针、刻度胶囊、失败率气泡）默认不显示，需要时在引导页打开',
      '进度条默认垂直位置调整到传送带带面内，与参考图一致',
      '轨道渐变新增 4 个可调色标（起点 / 前段 / 后段 / 终点），改色即时生效',
      '删除轨道左端的装饰性椭球高光，色带保持完整通透',
      '品牌 Icon 新增可调圆角（默认 30，范围 0–120），编辑器截图同步处理'
    ]
  },
  {
    version: '20261106-1141',
    date: '2026-11-06',
    versions: ['20261106-1141'],
    title: '修复换背景后无法导出',
    changes: [
      '补上 background.horizon 默认值，切换或上传背景后导出不再被校验拒绝'
    ]
  }
]);

function normalizeVersion(version) {
  return String(version ?? '').trim();
}

/** Every build stamp a day entry covers, newest first. */
export function changelogVersions(entry) {
  if (!entry) return [];
  const listed = Array.isArray(entry.versions) ? entry.versions : [];
  // Entries written before `versions` existed answer for their own stamp, so a
  // mixed history keeps resolving through findChangelogEntry.
  const stamps = listed.length > 0 ? [...listed] : [entry.version];
  if (entry.version && !stamps.includes(entry.version)) stamps.unshift(entry.version);
  return stamps.map(normalizeVersion).filter(Boolean).sort().reverse();
}

/** Look up the day entry covering a build version, if that release is documented. */
export function findChangelogEntry(version) {
  const key = normalizeVersion(version);
  if (!key) return null;
  return BUILD_CHANGELOG.find((entry) => changelogVersions(entry).includes(key)) ?? null;
}
