// Level layout contact sheet.
//
// Builds one static HTML page that draws every level's top-down layout as an
// inline SVG thumbnail, so layouts can be compared by eye without opening each
// level in the editor and waiting for it to load.
//
// Usage:
//   node scripts/build-level-contact-sheet.mjs                 # local artifacts/web-levels
//   node scripts/build-level-contact-sheet.mjs --remote        # pull from the remote editor
//   node scripts/build-level-contact-sheet.mjs --remote --out artifacts/level-contact-sheet.html
//
// Rendering lives in src/level-layout-thumbnail.js, which the editor's level
// overview imports too, so a thumbnail means the same thing in both places.

import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import path from 'node:path';
import {
  levelSvgStyles,
  renderLevelSvg,
  summarizeLevel
} from '../src/level-layout-thumbnail.js';

const REPO_ROOT = path.resolve(import.meta.dirname, '..');
const WEB_LEVEL_ROOT = path.join(REPO_ROOT, 'artifacts', 'web-levels');
const DEFAULT_OUT = path.join(REPO_ROOT, 'artifacts', 'level-contact-sheet.html');

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function renderRow(level) {
  const stats = summarizeLevel(level);
  return `<tr>
    <td class="name">
      <div class="title">${escapeHtml(level.displayName)}</div>
      <div class="key">${escapeHtml(level.key)}</div>
    </td>
    <td class="layout">${renderLevelSvg(level, { width: 260, height: 200 })}</td>
    <td class="stats">
      <div>${stats.vehicleCount} 辆</div>
      <div>${stats.passengerCount} 人</div>
      <div>${stats.colorCount} 色</div>
      <div class="soft">${escapeHtml(stats.seatSummary)}</div>
    </td>
    <td class="meta">
      <div>${escapeHtml(level.conveyorBeltName ?? '-')}</div>
      <div class="soft">scale ${escapeHtml(String(level.mapScale ?? '-'))}</div>
    </td>
  </tr>`;
}

function renderPage(levels, sourceLabel) {
  const rows = levels.map(renderRow).join('\n');
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<title>关卡布局对照表</title>
<style>
  :root { color-scheme: dark; }
  body {
    margin: 0; padding: 24px;
    background: #14161a; color: #e6e8eb;
    font: 13px/1.5 -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
  }
  h1 { font-size: 18px; margin: 0 0 4px; }
  .sub { color: #8b929c; margin-bottom: 18px; font-size: 12px; }
  table { border-collapse: collapse; width: 100%; }
  th {
    position: sticky; top: 0; z-index: 2;
    background: #1c1f26; color: #9aa3ae;
    font-weight: 500; text-align: left;
    padding: 8px 12px; border-bottom: 1px solid #2a2f38;
  }
  td { padding: 10px 12px; border-bottom: 1px solid #23272f; vertical-align: middle; }
  tr:hover td { background: #1a1e24; }
  .name .title { font-size: 14px; font-weight: 600; }
  .name .key { color: #6f7885; font-size: 11px; font-family: ui-monospace, monospace; }
  .stats { white-space: nowrap; font-variant-numeric: tabular-nums; }
  .soft { color: #7d858f; font-size: 11px; }
  .meta { color: #9aa3ae; font-size: 12px; }
  svg { display: block; }
  ${levelSvgStyles('level-thumb')}
</style>
</head>
<body>
<h1>关卡布局对照表</h1>
<div class="sub">数据源：${escapeHtml(sourceLabel)}　共 ${levels.length} 关　黄框=隐藏车　青框=转向车　虚线框=车位</div>
<table>
<thead>
<tr><th>关卡名字</th><th>布局图</th><th>规模</th><th>传送带</th></tr>
</thead>
<tbody>
${rows}
</tbody>
</table>
</body>
</html>
`;
}

// --- data loading -----------------------------------------------------------

async function loadLocalLevels() {
  const entries = await readdir(WEB_LEVEL_ROOT, { withFileTypes: true });
  const levels = [];
  for (const entry of entries) {
    if (!entry.isFile() || !/^level[1-9]\d*\.json$/.test(entry.name)) continue;
    const source = await readFile(path.join(WEB_LEVEL_ROOT, entry.name), 'utf8');
    levels.push(JSON.parse(source));
  }
  return levels;
}

async function fetchJson(url, attempts = 4) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return await response.json();
      lastError = new Error(`${url} -> HTTP ${response.status}`);
      if (response.status === 404) throw lastError;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
  }
  throw lastError;
}

// The remote route only matches `level<digits>`, so a catalog key like
// `currentLevel12` falls through to the SPA's index.html. The build-time catalog
// in this repo is the same snapshot the remote serves, so use it as the fallback
// rather than dropping the level from the sheet.
async function loadLocalCatalog() {
  try {
    const module = await import(path.join(REPO_ROOT, 'src', 'level-catalog.js'));
    return module.LEVEL_CATALOG ?? {};
  } catch (error) {
    console.warn(`本地 catalog 读取失败: ${error.message}`);
    return {};
  }
}

// Remote levels live in two places: web documents under /__level-authoring and
// the build-time catalog under /__unity-levels. The picker merges both, so the
// sheet does too, or nine catalog-only levels would be missing.
async function loadRemoteLevels(baseUrl) {
  const list = await fetchJson(`${baseUrl}/__level-authoring`);
  const localCatalog = await loadLocalCatalog();
  const items = [...list.items].sort((a, b) => {
    const na = Number(a.key.replace(/\D/g, ''));
    const nb = Number(b.key.replace(/\D/g, ''));
    return na - nb || a.key.localeCompare(b.key);
  });
  const levels = [];
  for (const item of items) {
    const endpoint = item.source === 'catalog'
      ? `${baseUrl}/__unity-levels/${item.key}`
      : `${baseUrl}/__level-authoring/${item.key}`;
    try {
      const payload = await fetchJson(endpoint);
      const level = payload.document ?? payload.level ?? payload;
      if (!Array.isArray(level.vehicles)) {
        // Catalog entries can nest the runtime level under a different key.
        const nested = level.level ?? level.definition;
        if (!Array.isArray(nested?.vehicles)) {
          throw new Error('没有车辆数据');
        }
        levels.push({ ...nested, key: item.key, displayName: item.displayName });
        continue;
      }
      levels.push({ ...level, key: level.key ?? item.key, displayName: level.displayName ?? item.displayName });
    } catch (error) {
      const fallback = localCatalog[item.key];
      if (Array.isArray(fallback?.vehicles)) {
        console.warn(`${item.key}: 远端取不到（${error.message}），改用本地 catalog`);
        levels.push({ ...fallback, key: item.key, displayName: item.displayName });
        continue;
      }
      console.warn(`skip ${item.key}: ${error.message}`);
    }
  }
  return levels;
}

async function main() {
  const args = process.argv.slice(2);
  const useRemote = args.includes('--remote');
  const outIndex = args.indexOf('--out');
  const outPath = outIndex >= 0 ? path.resolve(args[outIndex + 1]) : DEFAULT_OUT;
  const baseUrl = (() => {
    const urlIndex = args.indexOf('--base');
    if (urlIndex >= 0) return args[urlIndex + 1].replace(/\/$/, '');
    return 'http://10.0.0.54:12142';
  })();

  const levels = useRemote ? await loadRemoteLevels(baseUrl) : await loadLocalLevels();
  const sourceLabel = useRemote ? `远端编辑器 ${baseUrl}` : '本地 artifacts/web-levels';
  levels.sort((a, b) => {
    const na = Number(String(a.key).replace(/\D/g, ''));
    const nb = Number(String(b.key).replace(/\D/g, ''));
    return na - nb || String(a.key).localeCompare(String(b.key));
  });

  const empty = levels.filter((level) => !(level.vehicles ?? []).length);
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, renderPage(levels, sourceLabel), 'utf8');
  console.log(`wrote ${outPath}`);
  console.log(`levels: ${levels.length}` + (empty.length ? ` (${empty.length} 关无车辆: ${empty.map((l) => l.key).join(', ')})` : ''));
}

await main();
