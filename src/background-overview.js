export function openBackgroundOverview({ select, refresh, add }) {
  const dialog = document.createElement('dialog');
  dialog.className = 'background-overview';
  dialog.setAttribute('aria-labelledby', 'background-overview-title');
  dialog.innerHTML = `<header><h2 id="background-overview-title">背景总览</h2>
    <button type="button" class="bg-close" title="关闭" aria-label="关闭">×</button></header>
    <div class="bg-toolbar"><input type="search" aria-label="搜索背景" placeholder="搜索背景名称" autofocus>
    <button type="button" class="bg-add" aria-label="添加背景" title="添加背景">+</button></div>
    <output aria-live="polite"></output><div class="bg-grid"></div><p class="bg-notice" role="status"></p>`;
  const query = dialog.querySelector('input');
  const grid = dialog.querySelector('.bg-grid');
  const count = dialog.querySelector('output');
  function render() {
    const term = query.value.trim().toLocaleLowerCase();
    const options = Array.from(select.options).filter(option => option.value && !option.disabled);
    const matches = options.filter(option => option.label.toLocaleLowerCase().includes(term));
    count.textContent = matches.length ? `显示 ${matches.length} / ${options.length} 张` : '没有匹配的背景';
    grid.replaceChildren(...matches.map(option => {
      const card = document.createElement('button');
      card.type = 'button';
      card.dataset.value = option.value;
      card.setAttribute('aria-pressed', String(option.selected));
      const image = document.createElement('img');
      image.alt = '';
      image.loading = 'lazy';
      image.decoding = 'async';
      image.src = option.value;
      const label = document.createElement('span');
      label.textContent = option.label;
      card.append(image, label);
      return card;
    }));
  }
  query.addEventListener('input', render);
  grid.addEventListener('click', event => {
    const card = event.target.closest('button[data-value]');
    if (!card) return;
    select.value = card.dataset.value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    dialog.close();
  });
  dialog.querySelector('.bg-close').onclick = () => dialog.close();
  dialog.querySelector('.bg-add').onclick = () => { dialog.close(); add(); };
  dialog.addEventListener('close', () => dialog.remove(), { once: true });
  document.body.append(dialog);
  dialog.showModal();
  render();
  refresh().then(() => { if (dialog.open) render(); }).catch(() => {
    if (dialog.open) dialog.querySelector('.bg-notice').textContent = '背景列表刷新失败，重新打开可重试。';
  });
}
