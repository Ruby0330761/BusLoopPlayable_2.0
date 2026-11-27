import './editor-studio.css';
import { renderLevelSvg } from './level-layout-thumbnail.js';

const navigation = [
  ['制作', [['level', '关卡管理'], ['scene', '场景设置'], ['track', '传送轨道'], ['cars', '车辆与乘客']]],
  ['表现', [['guide', '引导流程'], ['ui', '界面与品牌'], ['audio', '音频']]]
];

export function mountStudio(root, { getTuning, restartPreview, level }) {
  const app = root.closest('#app');
  const stage = app.querySelector('#stage');
  const rail = root.querySelector('.shell-rail');
  const brand = root.querySelector('.shell-brand');
  const badge = brand.querySelector('.editor-edition');
  const version = brand.querySelector('.editor-version');
  app.classList.add('studio-workspace');
  brand.innerHTML = '<span class="studio-mark" aria-hidden="true"><i></i><i></i><i></i></span><h2>Playable Studio</h2>';
  brand.append(badge);

  const project = document.createElement('div');
  project.className = 'studio-project';
  project.innerHTML = '<img src="/assets/icon-android.jpg" alt=""><div><small>当前项目</small><strong>Bus Loop</strong></div>';
  rail.prepend(project);
  for (const [title, items] of navigation) {
    const group = document.createElement('div');
    group.className = 'studio-nav-group';
    const heading = document.createElement('h3');
    heading.textContent = title;
    group.append(heading);
    for (const [id, label] of items) {
      const button = rail.querySelector(`[data-shell-panel="${id}"]`);
      button.querySelector('span').textContent = label;
      button.title = label;
      group.append(button);
    }
    rail.append(group);
  }
  const exportEntry = rail.querySelector('[data-shell-panel="export"]');
  exportEntry.classList.add('studio-export');
  exportEntry.querySelector('span').textContent = '导出试玩';
  root.querySelector('.editor-header-actions').append(exportEntry);
  exportEntry.addEventListener('click', () => setFocus(false));
  const inspect = document.createElement('button');
  inspect.type = 'button';
  inspect.className = 'studio-inspect-toggle';
  inspect.textContent = '项目检查';
  inspect.title = '项目检查';
  inspect.setAttribute('aria-pressed', 'false');
  rail.append(inspect, version);
  const inspector = root.querySelector('.shell-inspector');
  function showInspector(on) {
    app.classList.toggle('studio-inspecting', on);
    inspect.setAttribute('aria-pressed', String(on));
  }
  inspect.addEventListener('click', () => {
    const on = !app.classList.contains('studio-inspecting');
    showInspector(on);
    if (on) inspector.querySelector('[data-shell-tab="checks"]').click();
  });
  root.addEventListener('click', event => {
    if (event.target.closest('[data-shell-panel], [data-shell-jump], .shell-insp-check.has-jump')) showInspector(false);
  });
  inspector.addEventListener('keydown', event => {
    if (event.target.closest('.shell-insp-check.has-jump') && ['Enter', ' '].includes(event.key)) showInspector(false);
  });
  root.querySelector('.editor-search-input').placeholder = '搜索全部参数';
  const levelActions = root.querySelector('.editor-level-actions');
  const editLevel = levelActions.querySelector('.editor-level-edit');
  const thumbnail = document.createElement('span');
  thumbnail.className = 'studio-layout-thumb';
  thumbnail.setAttribute('aria-hidden', 'true');
  editLevel.prepend(thumbnail);
  const files = document.createElement('details');
  files.className = 'studio-level-files';
  files.innerHTML = '<summary>关卡文件与归属</summary><div></div>';
  for (const name of ['claim', 'import', 'export', 'open-folder', 'delete']) {
    files.lastElementChild.append(levelActions.querySelector('.editor-level-' + name));
  }
  levelActions.after(files);

  const preview = document.createElement('section');
  preview.className = 'studio-preview';
  preview.setAttribute('aria-label', '游戏预览');
  preview.innerHTML = `<header class="studio-preview-bar">
      <div class="studio-view-title"><i aria-hidden="true"></i><strong>实时预览</strong></div>
      <div class="studio-preview-tools">
        <select class="studio-ratio" aria-label="预览画幅" title="预览画幅">
          <option value="scene">场景画幅</option><option value="portrait">竖屏 9:16</option>
          <option value="landscape">横屏 16:9</option><option value="fit">铺满视区</option>
        </select>
        <button type="button" class="studio-replay" title="重新试玩" aria-label="重新试玩">&#8635;</button>
        <button type="button" class="studio-focus" title="专注预览" aria-label="专注预览" aria-pressed="false">&#x26F6;</button>
      </div></header>
    <div class="studio-surface"></div>
    <footer class="studio-preview-foot"><span class="studio-current-level"></span><span class="studio-pixels"></span></footer>`;
  stage.before(preview);
  preview.querySelector('.studio-surface').append(stage);
  const ratio = preview.querySelector('.studio-ratio');
  const focus = preview.querySelector('.studio-focus');
  function setFocus(on) {
    app.classList.toggle('studio-focus-mode', on);
    focus.setAttribute('aria-pressed', String(on));
    focus.title = focus.ariaLabel = on ? '退出专注预览' : '专注预览';
  }
  focus.onclick = () => setFocus(!app.classList.contains('studio-focus-mode'));
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && app.classList.contains('studio-focus-mode') && !document.querySelector('dialog[open]')) {
      setFocus(false);
      focus.focus();
    }
  });
  preview.querySelector('.studio-replay').onclick = restartPreview;
  ratio.onchange = () => { preview.dataset.ratio = ratio.value; };
  new ResizeObserver(() => {
    preview.querySelector('.studio-pixels').textContent = `${stage.clientWidth} × ${stage.clientHeight} px`;
  }).observe(stage);

  let thumbnailLevel;
  return () => {
    const tuning = getTuning();
    const active = level();
    if (active && thumbnailLevel !== active) {
      thumbnailLevel = active;
      thumbnail.innerHTML = renderLevelSvg(active, { width: 120, height: 76, pad: 4, className: 'studio-map' });
    }
    preview.querySelector('.studio-current-level').textContent = [
      active?.displayName || tuning.level?.selected, `${active?.vehicles?.length ?? 0} 辆车`,
      `${tuning.parkingSpots?.count ?? 0} 个车位`
    ].join('   ·   ');
  };
}
