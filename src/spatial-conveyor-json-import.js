import { MAX_SPATIAL_PACKAGE_BYTES, isSpatialImportId, validateSpatialJsonImport } from './spatial-conveyor-json.js';

function chooseImportTarget(data, items) {
  const dialog = document.createElement('dialog');
  dialog.className = 'spatial-json-dialog';
  dialog.setAttribute('aria-label', '导入轨道 JSON');
  dialog.innerHTML = `
    <form method="dialog">
      <h3>导入轨道 JSON</h3>
      <p data-summary></p>
      <label>导入到<select name="target"><option value="">新增轨道</option></select></label>
      <label>轨道 ID<input name="trackId" required maxlength="120" autocomplete="off"></label>
      <p data-impact role="status"></p>
      <footer><button type="button">取消</button><button type="submit">新增轨道</button></footer>
    </form>`;
  const form = dialog.querySelector('form');
  const target = form.elements.target;
  const trackId = form.elements.trackId;
  const submit = form.querySelector('[type=submit]');
  const itemsById = new Map(items.map((item) => [item.id, item]));
  let newId = data.id;
  for (let i = 1; itemsById.has(newId); i++) {
    const suffix = i === 1 ? '_copy' : `_copy${i}`;
    newId = data.id.slice(0, 120 - suffix.length) + suffix;
  }
  form.querySelector('[data-summary]').textContent = `${data.id} · 立体轨道 · ${data.path.points.length} 个点`;
  for (const item of items) {
    if (isSpatialImportId(item.id)) target.add(new Option(`替换 ${item.id}`, item.id));
  }
  function syncTarget() {
    const existing = itemsById.get(target.value);
    trackId.value = existing?.id ?? newId;
    trackId.readOnly = Boolean(existing);
    trackId.setCustomValidity('');
    submit.textContent = existing ? '确认替换' : '新增轨道';
    form.querySelector('[data-impact]').textContent = existing
      ? '所有引用该轨道的关卡都会使用新形状。旧轨道会自动备份。'
      : '导入后可在传送带选择中使用。';
  }
  target.addEventListener('change', syncTarget);
  trackId.addEventListener('input', () => { newId = trackId.value; trackId.setCustomValidity(''); });
  syncTarget();
  let choice = null;
  form.querySelector('[type=button]').onclick = () => dialog.close();
  form.addEventListener('submit', (event) => {
    const existing = itemsById.get(target.value);
    const id = trackId.value.trim();
    if (!isSpatialImportId(id) || (!existing && itemsById.has(id))) {
      event.preventDefault();
      trackId.setCustomValidity(isSpatialImportId(id)
        ? '该 ID 已存在，请修改 ID 或选择替换目标'
        : '请输入由字母、数字、点、短横线或下划线组成的有效 ID');
      trackId.reportValidity();
      return;
    }
    choice = { id, existing };
  });
  return new Promise((resolve) => {
    dialog.addEventListener('close', () => { dialog.remove(); resolve(choice); }, { once: true });
    document.body.append(dialog);
    dialog.showModal();
  });
}

export async function importSpatialConveyorJson(file) {
  if (file.size > MAX_SPATIAL_PACKAGE_BYTES) throw new Error('轨道 JSON 超过 4 MB');
  let data;
  try { data = JSON.parse((await file.text()).replace(/^\uFEFF/u, '')); }
  catch { throw new Error('文件不是有效的 JSON'); }
  validateSpatialJsonImport(data);
  const list = await fetch('/__spatial-conveyors', { cache: 'no-store' });
  if (!list.ok) throw new Error('无法读取已有轨道列表');
  const { items } = await list.json();
  const choice = await chooseImportTarget(data, items);
  if (!choice) return null;
  const { id, existing } = choice;
  if (id !== data.id) {
    data.id = id;
    data.label = existing?.label || id;
    validateSpatialJsonImport(data);
  }
  if (existing && !existing.revision) throw new Error('无法确认目标轨道的版本，请刷新编辑器');
  const response = await fetch(`/__spatial-conveyors/package/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ packageData: data, baseRevision: existing?.revision ?? null, importJson: true })
  });
  if (response.status === 409) throw new Error('目标轨道已变更，请重新导入并确认最新版本');
  if (!response.ok) throw new Error((await response.json()).error || `HTTP ${response.status}`);
  return { id, replaced: Boolean(existing) };
}
