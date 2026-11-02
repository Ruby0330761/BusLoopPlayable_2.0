// Official in-game level picker for the scene editor.
//
// Separate from the authoring "关卡总览": that overlay lists levels that are
// already authored (baked catalog + imported data volume), while this one lists
// the level assets the game itself ships with. Keeping them apart is what lets
// this be a pure browse surface — nothing here touches the authoring catalog
// until an operator picks a card, at which point that one asset is imported and
// becomes a normal editable level.
//
// Data comes from /__official-levels (+ /__official-levels/<chapter>), which
// reads the shipped asset folders. Chapter thumbnails are rendered server-side
// with the same top-down renderer the authoring overview uses.

import { levelSvgStyles } from './level-layout-thumbnail.js';
import { levelOwnerHeaders, readStoredLevelOwner, normalizeLevelOwner } from './level-owner.js';

const PICKER_STYLE_ID = 'official-levels-styles';

const STYLE = `
.official-levels {
  position: fixed; inset: 0; z-index: 132;
  display: flex; flex-direction: column;
  color: #17242d;
  background: #eef2f5;
  font: 13px/1.4 'Poppins Branding', -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
}
.official-levels__bar {
  display: flex; align-items: center; gap: 12px; flex: none; flex-wrap: wrap;
  padding: 10px 16px;
  border-bottom: 1px solid #ccd7dd; background: #fbfcfd;
  box-shadow: 0 2px 8px rgba(29,50,61,.07);
}
.official-levels__title { color: #173444; font-size: 14px; font-weight: 600; white-space: nowrap; }
.official-levels__subtitle { color: #6b8291; font-size: 11px; white-space: nowrap; }
.official-levels__tabs { display: flex; gap: 4px; flex-wrap: wrap; }
.official-levels__tab {
  min-height: 28px; padding: 4px 10px; border: 1px solid #c3d0d6; border-radius: 999px;
  background: #fff; color: #33505f; font: inherit; font-size: 11px; cursor: pointer;
}
.official-levels__tab:hover { border-color: #1683a2; }
.official-levels__tab[aria-pressed="true"] { background: #1683a2; border-color: #1683a2; color: #fff; }
.official-levels__search {
  flex: 1; min-width: 150px; max-width: 360px;
  padding: 7px 10px; border: 1px solid #c3d0d6; border-radius: 6px;
  background: #fff; color: #1d3644; font: inherit; font-size: 12px;
}
.official-levels__search:focus-visible { outline: 2px solid #1683a2; outline-offset: 1px; }
.official-levels__close {
  margin-left: auto; min-height: 32px; padding: 6px 14px;
  border: 1px solid #b8c7ce; border-radius: 6px; background: #fff;
  color: #243944; font: 600 12px/1 'Poppins Branding', Arial, sans-serif; cursor: pointer;
}
.official-levels__close:hover { border-color: #1683a2; background: #eefafd; }
.official-levels__body { flex: 1; min-height: 0; overflow: auto; padding: 16px; }
.official-levels__grid {
  display: grid; gap: 14px;
  grid-template-columns: repeat(auto-fill, minmax(228px, 1fr));
}
.official-levels__empty { padding: 48px 16px; color: #6b8291; text-align: center; }
.official-levels__card {
  display: flex; flex-direction: column; gap: 8px; min-width: 0;
  padding: 10px; border: 1px solid #d3dde2; border-radius: 10px;
  background: #fff; text-align: left; cursor: pointer;
  box-shadow: 0 1px 2px rgba(29,50,61,.05);
  font: inherit; color: inherit;
}
.official-levels__card:hover { border-color: #1683a2; box-shadow: 0 3px 10px rgba(22,131,162,.16); }
.official-levels__card:focus-visible { outline: 2px solid #1683a2; outline-offset: 2px; }
.official-levels__card[disabled] { cursor: not-allowed; opacity: .55; }
.official-levels__card[data-busy="true"] { cursor: progress; opacity: .7; }
.official-levels__head { display: flex; align-items: baseline; gap: 8px; min-width: 0; }
.official-levels__name {
  flex: 1; min-width: 0; color: #173444; font-size: 13px; font-weight: 600;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.official-levels__key {
  flex: none; color: #7d8f9b; font-size: 11px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
.official-levels__thumb {
  display: flex; align-items: center; justify-content: center;
  border-radius: 6px; background: #f4f7f9; overflow: hidden;
}
.official-levels__thumb svg { display: block; width: 100%; height: auto; }
.official-levels__meta { display: flex; flex-wrap: wrap; gap: 4px 10px; color: #5d7382; font-size: 11px; }
.official-levels__meta b { color: #33505f; font-weight: 600; font-variant-numeric: tabular-nums; }
.official-levels__meta .official-levels__key { flex-basis: 100%; margin-bottom: -2px; }
.official-levels__badges { display: flex; flex-wrap: wrap; gap: 4px; margin-left: auto; }
.official-levels__badge { padding: 1px 6px; border-radius: 8px; font-size: 10px; white-space: nowrap; }
.official-levels__badge[data-kind="guide"] { background: #e3f2e6; color: #2f6b3c; }
.official-levels__badge[data-kind="ready"] { background: #d9f0f7; color: #11667c; }
.official-levels__badge[data-kind="unsupported"] { background: #fbe3e2; color: #9c3330; }
.official-levels__error { color: #9c3330; font-size: 11px; }
.official-levels__foot {
  flex: none; padding: 8px 16px; border-top: 1px solid #ccd7dd;
  background: #fbfcfd; color: #6b8291; font-size: 11px;
}
.official-levels__foot[data-state="error"] { color: #9c3330; }
`;

function injectStyle() {
  if (document.getElementById(PICKER_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = PICKER_STYLE_ID;
  style.textContent = `${STYLE}\n${levelSvgStyles('level-thumb', {
    canvas: '#f4f7f9',
    belt: '#93a6b0',
    bay: '#b7c6ce',
    empty: '#93a6b0'
  })}`;
  document.head.append(style);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function matchesQuery(item, query) {
  if (!query) return true;
  const haystack = [
    item.displayName,
    item.key,
    item.fileName,
    item.conveyorBeltName,
    item.vehicleCount,
    item.passengerCount,
    item.guide ? '引导' : '',
    item.status === 'unsupported' ? '不支持' : ''
  ].filter((value) => value != null && value !== '').join(' ').toLocaleLowerCase();
  return query.toLocaleLowerCase().split(/\s+/u).every((token) => haystack.includes(token));
}

function renderCard(item) {
  const badges = [];
  if (item.guide) badges.push('<span class="official-levels__badge" data-kind="guide">引导关</span>');
  if (item.status === 'unsupported') {
    badges.push('<span class="official-levels__badge" data-kind="unsupported">暂不支持</span>');
  } else if (item.status === 'ready') {
    badges.push('<span class="official-levels__badge" data-kind="ready">可导入</span>');
  }
  const disabled = item.status !== 'ready';
  const thumb = item.svg
    ? item.svg
    : `<div class="official-levels__error">${escapeHtml(item.error ?? '无法读取关卡数据')}</div>`;
  const meta = item.svg
    ? `<div class="official-levels__meta">`
      + `<span class="official-levels__key">${escapeHtml(item.key)}</span>`
      + `<span><b>${Number(item.vehicleCount) || 0}</b> 辆</span>`
      + `<span><b>${Number(item.passengerCount) || 0}</b> 人</span>`
      + `<span><b>${Number(item.colorCount) || 0}</b> 色</span>`
      + (item.seatSummary ? `<span>${escapeHtml(item.seatSummary)}</span>` : '')
      + '</div>'
    : '';
  return `<button type="button" class="official-levels__card" data-file="${escapeHtml(item.fileName)}"`
    + ` title="${escapeHtml(disabled ? item.error ?? '该关卡暂不能导入' : '导入并切换到此关卡')}"`
    + `${disabled ? ' disabled' : ''}>`
    + `<div class="official-levels__head">`
    + `<span class="official-levels__name">${escapeHtml(item.displayName)}</span>`
    + (badges.length ? `<span class="official-levels__badges">${badges.join('')}</span>` : '')
    + '</div>'
    + `<div class="official-levels__thumb">${thumb}</div>`
    + meta
    + '</button>';
}

/**
 * Open the official in-game level picker.
 *
 * @param {object} options
 * @param {string} [options.owner]                     operator name; required for the import
 * @param {(level: object) => void} options.onImported  called with the imported level summary
 * @returns {{ close: () => void, element: HTMLElement }}
 */
export function openOfficialLevelsPicker({ owner = readStoredLevelOwner(), onImported } = {}) {
  injectStyle();
  const root = document.createElement('div');
  root.className = 'official-levels';
  root.dataset.state = 'loading';
  root.innerHTML = `
    <div class="official-levels__bar">
      <strong class="official-levels__title">游戏内关卡</strong>
      <span class="official-levels__subtitle">游戏正式版本自带关卡，选中后导入为可编辑关卡</span>
      <div class="official-levels__tabs" role="group" aria-label="章节"></div>
      <input class="official-levels__search" type="search" placeholder="搜索关卡编号…" autocomplete="off" spellcheck="false" />
      <button type="button" class="official-levels__close">关闭</button>
    </div>
    <div class="official-levels__body"><div class="official-levels__grid"></div></div>
    <div class="official-levels__foot" aria-live="polite">正在读取游戏内关卡…</div>
  `;
  document.body.append(root);

  const tabs = root.querySelector('.official-levels__tabs');
  const searchInput = root.querySelector('.official-levels__search');
  const grid = root.querySelector('.official-levels__grid');
  const body = root.querySelector('.official-levels__body');
  const foot = root.querySelector('.official-levels__foot');
  const closeButton = root.querySelector('.official-levels__close');

  const chapterCache = new Map();
  let chapters = [];
  let activeChapter = '';
  let items = [];
  let importing = false;

  function paint() {
    const query = searchInput.value.trim();
    const visible = items.filter((item) => matchesQuery(item, query));
    grid.innerHTML = visible.length
      ? visible.map(renderCard).join('')
      : `<div class="official-levels__empty">没有符合条件的游戏内关卡</div>`;
    const ready = visible.filter((item) => item.status === 'ready').length;
    foot.dataset.state = '';
    foot.textContent = query
      ? `${visible.length} / ${items.length} 关，可导入 ${ready} 关`
      : `共 ${items.length} 关，可导入 ${ready} 关　点击卡片即可导入并切换`;
    body.scrollTop = 0;
  }

  function renderTabs() {
    tabs.innerHTML = chapters.map((chapter) => (
      `<button type="button" class="official-levels__tab" data-chapter="${escapeHtml(chapter.id)}"`
      + ` aria-pressed="${chapter.id === activeChapter ? 'true' : 'false'}">`
      + `${escapeHtml(chapter.id)} 章 · ${chapter.count}</button>`
    )).join('');
  }

  async function loadChapter(chapterId) {
    activeChapter = chapterId;
    renderTabs();
    const cached = chapterCache.get(chapterId);
    if (cached) {
      items = cached;
      paint();
      return;
    }
    root.dataset.state = 'loading';
    foot.dataset.state = '';
    foot.textContent = `正在读取 ${chapterId} 章关卡…`;
    grid.innerHTML = '<div class="official-levels__empty">加载中…</div>';
    try {
      const response = await fetch(`/__official-levels/${encodeURIComponent(chapterId)}`, { cache: 'no-store' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
      items = Array.isArray(payload.items) ? payload.items : [];
      chapterCache.set(chapterId, items);
      root.dataset.state = 'ready';
      paint();
    } catch (error) {
      root.dataset.state = 'error';
      foot.dataset.state = 'error';
      foot.textContent = `读取 ${chapterId} 章失败：${error.message}`;
      grid.innerHTML = '<div class="official-levels__empty">无法读取该章节</div>';
    }
  }

  async function load() {
    root.dataset.state = 'loading';
    foot.dataset.state = '';
    foot.textContent = '正在读取游戏内关卡…';
    try {
      const response = await fetch('/__official-levels', { cache: 'no-store' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
      chapters = Array.isArray(payload.chapters) ? payload.chapters : [];
      if (!chapters.length) {
        root.dataset.state = 'empty';
        foot.textContent = '没有找到游戏内关卡素材（official-levels 目录为空）';
        grid.innerHTML = '<div class="official-levels__empty">没有游戏内关卡素材</div>';
        return;
      }
      renderTabs();
      await loadChapter(chapters[0].id);
    } catch (error) {
      root.dataset.state = 'error';
      foot.dataset.state = 'error';
      foot.textContent = `读取游戏内关卡失败：${error.message}`;
      grid.innerHTML = '<div class="official-levels__empty">无法读取游戏内关卡</div>';
    }
  }

  async function importLevel(fileName, card) {
    if (importing) return;
    const operator = normalizeLevelOwner(owner || readStoredLevelOwner());
    if (!operator) {
      foot.dataset.state = 'error';
      foot.textContent = '请先在关卡面板填写“操作用户”，再导入游戏内关卡';
      return;
    }
    importing = true;
    card.dataset.busy = 'true';
    for (const other of grid.querySelectorAll('.official-levels__card')) other.disabled = true;
    foot.dataset.state = '';
    foot.textContent = `正在导入 ${fileName}…`;
    try {
      const response = await fetch(
        `/__official-levels/${encodeURIComponent(activeChapter)}/${encodeURIComponent(fileName)}/import`,
        { method: 'POST', headers: levelOwnerHeaders(operator) }
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
      foot.textContent = `已导入 ${payload.level?.displayName ?? fileName}，正在切换…`;
      onImported?.(payload.level ?? {});
      close();
    } catch (error) {
      foot.dataset.state = 'error';
      foot.textContent = `导入失败：${error.message}`;
      card.dataset.busy = 'false';
      for (const other of grid.querySelectorAll('.official-levels__card')) other.disabled = false;
    } finally {
      importing = false;
    }
  }

  function close() {
    root.remove();
    document.removeEventListener('keydown', onKeyDown, true);
  }

  function onKeyDown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
  }

  tabs.addEventListener('click', (event) => {
    const tab = event.target.closest('.official-levels__tab');
    if (!tab || importing || tab.dataset.chapter === activeChapter) return;
    searchInput.value = '';
    void loadChapter(tab.dataset.chapter);
  });
  searchInput.addEventListener('input', paint);
  closeButton.addEventListener('click', close);
  document.addEventListener('keydown', onKeyDown, true);
  grid.addEventListener('click', (event) => {
    const card = event.target.closest('.official-levels__card');
    if (!card || importing || card.disabled) return;
    void importLevel(card.dataset.file, card);
  });

  void load();

  return { close, element: root };
}
