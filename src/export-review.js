import { createBrandingVariantTuning } from './export-branding.js';
import { createEditorExportSession } from './playable-session-config.js';
import { normalizeProgressHudConfig } from './progress-hud-config.js';
import { normalizeStaminaConfig } from './stamina.js';
import { normalizeCountdownConfig } from './countdown.js';
import { normalizeCombo } from './combo-hud.js';

function sceneReviewRows(tuning, stages) {
  const rows = [];
  const guide = tuning.firstClickGuide;
  if (Number(guide?.enabled) === 1 && Number(guide.durationSeconds) > 0) {
    rows.push({ label: '开局指引', value: `目标车 ${guide.vehicleId}，持续 ${guide.durationSeconds} 秒` });
    if (Number(guide.maskEnabled) === 1 && Number(guide.maskOpacity ?? 0.8) > 0) {
      rows.push({ label: '开局置灰', value: '目标车高亮，其他车辆置灰' });
    }
  }
  const hand = tuning.vehicleGuideHand;
  if (Number(hand?.enabled) === 1 && stages.some(stage => !hand.levelKey || hand.levelKey === stage.levelKey)) {
    rows.push({ label: '小手提示', value: Number(hand.showAtStart) ? '开场立即显示' : `无操作 ${hand.idleDelaySeconds} 秒后显示` });
  }
  if (Number(tuning.entryBanner?.enabled) === 1) {
    rows.push({ label: '入场横幅', value: `${tuning.entryBanner.style}，持续 ${tuning.entryBanner.durationSeconds} 秒` });
  }
  const progress = normalizeProgressHudConfig(tuning.progressHud);
  if (progress.enabled) {
    rows.push({ label: '进度条', value: `核对进度变化及 ${progress.nodePercent}% 节点` });
  }
  const countdown = normalizeCountdownConfig(tuning.countdown);
  if (countdown.enabled) {
    rows.push({ label: '倒计时', value: `${countdown.durationSeconds} 秒，归零后${countdown.timeoutStore ? '跳转商店' : '显示失败弹窗'}` });
  }
  const combo = normalizeCombo(tuning.combo);
  if (Number(tuning.iq?.enabled) === 1) {
    rows.push({ label: 'IQ 计分', value: '车辆进站 +10，碰撞 −5，最低 0 分' });
  }
  if (combo.mode !== 'off') {
    rows.push({ label: '连击提示', value: combo.mode === 'timed' ? '倒计时读条' : '金色弹字' });
  }
  const stamina = normalizeStaminaConfig(tuning.stamina);
  if (stamina.enabled) {
    rows.push({ label: '体力条', value: '核对各版本的初始体力与扣减' });
    if (stamina.introEnabled) rows.push({ label: '开场体力说明弹窗', value: '核对体力说明的出现和收起' });
  }
  if (Number(tuning.cta?.enabled ?? 1) === 1) {
    rows.push({ label: 'Play Now 弹窗', value: '核对显示位置和点击跳转' });
  }
  if (Number(tuning.gameOver?.retryEnabled) === 1) {
    rows.push({ label: '失败弹窗重试按钮', value: tuning.gameOver.retryAction === 'store' ? '点击跳转商店' : '点击重新开始' });
  }
  return rows;
}

export function buildExportReviewRows(tuning, { brandingSet, brandingSetLabel, platforms, variantCount }) {
  const { branding, exportNaming: naming } = createBrandingVariantTuning(tuning, brandingSet);
  const session = createEditorExportSession(tuning);
  const stages = session.sessions[session.active].stages;
  const rows = [];
  for (const stage of stages) {
    const count = stage.scene?.parkingSpots?.count ?? tuning.parkingSpots?.count;
    const valid = Number.isInteger(count) && count > 0;
    rows.push({
      label: stages.length === 1 ? '车位数量' : stage.levelKey + ' 车位数量',
      value: valid ? count + ' 个' : '请返回设置车位数量',
      invalid: !valid
    });
  }
  rows.push(...sceneReviewRows(tuning, stages));
  rows.push({ label: '导出套系', value: brandingSetLabel });
  for (const [id, label] of platforms) {
    rows.push({ label: '投放渠道', value: label + ' (' + (naming.channels?.[id] || id) + ')' });
  }
  for (const [label, value] of [
    ['需求编号', naming.requirementCode], ['素材编号', naming.materialCode],
    ['前贴编号', naming.iterationCode], ['语言', naming.language], ['格式', naming.format],
    ['设计师', naming.designer], ['需求人', naming.requester],
    ['步数', naming.steps || 'N'], ['尾段版本', naming.version || 'N']
  ]) rows.push({ label, value });
  for (const [label, item, asset] of [
    ['Logo', branding.logo, branding.logo.asset],
    ['Android Icon', branding.icon, branding.icon.deviceAssets.android],
    ['iOS Icon', branding.icon, branding.icon.deviceAssets.ios]
  ]) {
    const visible = Boolean(item.enabled ?? 1);
    rows.push({ label, value: visible ? '显示' : '隐藏', asset });
  }
  rows.push({ label: '导出数量', value: variantCount + ' 个版本，共 ' + variantCount * platforms.length + ' 份' });
  return rows;
}

export function confirmPlayableExport(root, rows) {
  const dialog = document.createElement('dialog');
  dialog.className = 'editor-export-confirm';
  dialog.setAttribute('aria-labelledby', 'export-confirm-heading');
  dialog.innerHTML = `<form method="dialog">
    <header><h3 id="export-confirm-heading">核对导出信息</h3><output aria-live="polite"></output></header>
    <div class="export-review-list"></div>
    <footer><button value="cancel" formnovalidate>返回修改</button><button value="confirm" disabled>确认导出</button></footer>
  </form>`;
  const list = dialog.querySelector('.export-review-list');
  const confirm = dialog.querySelector('[value="confirm"]');
  const checks = [];
  function update() {
    const done = checks.filter(check => check.checked && !check.disabled).length;
    dialog.querySelector('output').textContent = '已核对 ' + done + ' / ' + rows.length;
    confirm.disabled = done !== rows.length;
  }
  for (const { label, value, asset, invalid } of rows) {
    const row = document.createElement('label');
    const check = document.createElement('input');
    check.type = 'checkbox';
    check.required = true;
    check.disabled = Boolean(invalid || asset);
    const name = document.createElement('span');
    name.textContent = label;
    const detail = document.createElement('strong');
    detail.textContent = value || '未填写';
    row.append(check, name, detail);
    if (asset) {
      const image = document.createElement('img');
      image.alt = label + ' 预览';
      image.addEventListener('load', () => { check.disabled = false; }, { once: true });
      image.addEventListener('error', () => { detail.textContent = '图片加载失败，请返回重试'; }, { once: true });
      image.src = asset;
      detail.prepend(image);
    }
    checks.push(check);
    list.append(row);
  }
  list.addEventListener('change', update);
  update();
  root.append(dialog);
  return new Promise(resolve => {
    dialog.addEventListener('close', () => {
      dialog.remove();
      resolve(dialog.returnValue === 'confirm' && checks.every(check => check.checked && !check.disabled));
    }, { once: true });
    dialog.showModal();
  });
}
