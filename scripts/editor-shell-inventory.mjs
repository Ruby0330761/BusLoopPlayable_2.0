#!/usr/bin/env node
// Editor shell inventory: reads the real FIELD_GROUPS out of src/scene-editor.js,
// assigns every section to a rail panel, and emits the data the layout prototype
// renders. This exists so the panel layout is discussed against the actual 65
// sections instead of somebody's memory of them.
//
//   node scripts/editor-shell-inventory.mjs                 # summary to stdout
//   node scripts/editor-shell-inventory.mjs --json <file>   # write inventory JSON
//   node scripts/editor-shell-inventory.mjs --html <file>   # build the prototype
//
// The extraction is deliberately marker-based and loud: if scene-editor.js
// drifts, this fails instead of quietly producing an empty prototype.

import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const EDITOR_PATH = join(repoRoot, 'src/scene-editor.js');
const LEVEL_DIR = join(repoRoot, 'artifacts/web-levels');
const TEMPLATE_PATH = join(repoRoot, 'scripts/editor-shell-prototype.template.html');

const SECTION_START = 'const CONVEYOR_LAYOUT_OPTIONS';
const GROUP_START = 'const FIELD_GROUPS = [';
const GROUP_END = '\n];\n';

function fail(message) {
  console.error(`editor-shell-inventory: ${message}`);
  process.exit(1);
}

async function readEditorSource() {
  const source = await readFile(EDITOR_PATH, 'utf8');
  const startAt = source.indexOf(SECTION_START);
  if (startAt < 0) fail(`anchor "${SECTION_START}" not found in src/scene-editor.js`);
  if (source.indexOf(SECTION_START, startAt + 1) >= 0) fail(`anchor "${SECTION_START}" hit twice`);
  const groupAt = source.indexOf(GROUP_START, startAt);
  if (groupAt < 0) fail(`anchor "${GROUP_START}" not found`);
  const endAt = source.indexOf(GROUP_END, groupAt);
  if (endAt < 0) fail('FIELD_GROUPS array is not terminated by a bare "];" line');
  return source.slice(startAt, endAt + GROUP_END.length);
}

async function readLevelOptions() {
  // The level picker is generated from whatever authored levels exist; the
  // prototype only needs the option count to look honest.
  try {
    const entries = await readdir(LEVEL_DIR);
    return entries
      .filter((name) => name.endsWith('.json'))
      .sort()
      .map((name) => [name.replace(/\.json$/, ''), name.replace(/\.json$/, '')]);
  } catch {
    return [['level', 'level']];
  }
}

// A group may declare `category`; otherwise the renderer infers it from the
// first field path. The rail panel is a coarser split on purpose: "引导" used to
// hold CTA, BGM and the progress bar, which are three different jobs.
const PANEL_RULES = [
  ['export', /^exportNaming\./],
  ['level', /^level\./],
  ['guide', /^(?:vehicleGuideHand|firstClickGuide|entryBanner|countdown|weatherEffect|freeAssets|preRoll|gameOver|installGate)\./],
  ['ui', /^(?:branding|cta|speedToggle|progressHud)\./],
  ['audio', /^audio\./],
  ['track', /^(?:conveyorLayout\.|conveyorLayouts\.|spatialConveyor\.|queueCurves\.|passengerShadows\.|effects\.)/],
  ['cars', /^(?:parkingSpots|vehiclePath|vehicleDeparturePath|vehicleArea|passengerMaterial|passengers)\./],
  ['scene', /^(?:camera|lighting|sourceCrop|background|visibility|preview)\./],
];

// A section is assigned by majority vote of its own fields, not by its first
// row. "Icon/Logo 调整" opens with the phone-preview size fields and then spends
// 24 rows on branding; going by row 1 would file it under 场景.
function panelForGroup(group) {
  const votes = new Map(PANEL_RULES.map(([panel]) => [panel, 0]));
  for (const field of group.fields ?? []) {
    const path = field[1] ?? '';
    for (const [panel, pattern] of PANEL_RULES) {
      if (pattern.test(path)) {
        votes.set(panel, votes.get(panel) + 1);
        break;
      }
    }
  }
  let best = null;
  let bestVotes = 0;
  for (const [panel] of PANEL_RULES) {
    if (votes.get(panel) > bestVotes) {
      best = panel;
      bestVotes = votes.get(panel);
    }
  }
  // Sections with rows built by a custom panel (free-asset layers) carry no
  // tuning path; they sit with the guide stage that renders them.
  return best ?? 'guide';
}

// Mirrors the control decision in createSceneEditor so the prototype renders
// the same widget the shipped editor would.
function controlForField([label, path, min, max, step, options, control]) {
  if (/color$/i.test(path) || /^passengerMaterial\.solidColors\.\d+$/.test(path)) return 'color';
  if (control === 'toggle') return 'toggle';
  if (control === 'url') return 'url';
  if (control === 'text' || control === 'filename') return 'text';
  if (options) return 'select';
  return 'number';
}

function describeField(field, index) {
  const [label, path, min, max, step, options, control] = field;
  const kind = controlForField(field);
  const described = { index, label, path, kind };
  if (kind === 'number' || kind === 'color' && min === 0 && max === 16777215) {
    described.min = min;
    described.max = max;
    described.step = step;
  }
  if (kind === 'select') {
    // The belt picker is the primary switch in the 轨道 panel; showing "… 另有
    // 5 项" there would hide the thing operators came for.
    const keep = path === 'conveyorLayout.selected' ? options.length : 6;
    described.optionCount = options.length;
    described.options = options.slice(0, keep).map(([value, text]) => [String(value), String(text)]);
    described.moreOptions = Math.max(0, options.length - described.options.length);
  }
  if (control === 'filename') described.note = '命名片段';
  if (control === 'vehicle-id-select') described.note = '按当前车号列出';
  if (control === 'countdown-number') described.note = '受倒计时总时长约束';
  if (/^passengerMaterial\.solidColors\.\d+$/.test(path)) {
    described.colorIndex = Number(path.split('.').pop());
  }
  return described;
}

function countBy(values) {
  const out = {};
  for (const value of values) out[value] = (out[value] ?? 0) + 1;
  return out;
}

// Within a panel, sections are still grouped by job. 9 rail buttons alone took
// the deepest panel from 137 fields to 107 — worth having, but 107 fields is
// still three screens of scrolling, so the heavy panels get named sub-groups.
// First match wins; a section with no match sits under its panel's default group.
const SUBGROUPS = {
  track: [
    ['跑道', /^conveyorLayout\./],
    ['立体轨道', /^spatialConveyor\./],
    ['队列与影子', /^(?:queueCurves|passengerShadows)\./],
    ['粒子', /^effects\./],
  ],
  cars: [
    ['车辆与车位', /^(?:parkingSpots|vehiclePath|vehicleDeparturePath|vehicleArea)\./],
    ['小人', /^(?:passengers|passengerMaterial)\./],
  ],
  guide: [
    ['开场引导', /^(?:vehicleGuideHand|firstClickGuide|entryBanner)\./],
    ['节奏与失败', /^(?:countdown|gameOver|installGate|preRoll)\./],
    ['氛围图层', /^(?:weatherEffect|freeAssets)\./],
  ],
  scene: [
    ['相机与灯光', /^(?:camera|lighting|visibility)\./],
    ['画面', /^(?:background|sourceCrop|preview)\./],
  ],
  ui: [
    ['品牌', /^branding\./],
    ['控件', /^(?:cta|speedToggle|progressHud)\./],
  ],
  export: [
    ['命名', /^exportNaming\./],
    ['出图与交付', /./],
  ],
  audio: [['全部', /./]],
  level: [['全部', /./]],
  assets: [['全部', /./]],
};

// Carries sections whose rows are built by a custom panel and therefore have no
// field path to match on.
function subgroupFor(panel, group) {
  const rules = SUBGROUPS[panel] ?? [];
  const path = group.fields?.[0]?.[1] ?? '';
  for (const [name, pattern] of rules) {
    if (pattern.test(path)) return name;
  }
  // Free-asset layers belong with the opening beat that positions them.
  return panel === 'guide' ? '氛围图层' : (rules[0]?.[0] ?? '');
}

function buildInventory(groups, levelOptions) {
  const byPanel = new Map();
  const sections = groups.map((group, order) => {
    const panel = panelForGroup(group);
    const fields = group.fields.map(describeField);
    if (!byPanel.has(panel)) byPanel.set(panel, []);
    byPanel.get(panel).push(order);
    return {
      id: `s${String(order).padStart(2, '0')}`,
      order,
      panel,
      subgroup: subgroupFor(panel, group),
      title: group.title,
      // Layout-scoped sections only apply to the selected belt; the shipped
      // editor hides the other 20 with [data-conveyor-layout].
      layout: group.conveyorLayout ?? null,
      spatialOnly: Boolean(group.spatialOnly),
      defaultOpen: Boolean(group.defaultOpen),
      fieldCount: fields.length,
      kinds: countBy(fields.map((field) => field.kind)),
      fields,
    };
  });

  const totals = {
    sections: sections.length,
    fields: sections.reduce((sum, section) => sum + section.fieldCount, 0),
    layoutScoped: sections.filter((section) => section.layout).length,
    layouts: [...new Set(sections.map((section) => section.layout).filter(Boolean))].length,
  };

  return {
    source: 'src/scene-editor.js',
    generatedAt: new Date().toISOString().slice(0, 10),
    levelOptionCount: levelOptions.length,
    totals,
    controls: countBy(sections.flatMap((section) => section.fields.map((field) => field.kind))),
    sections,
  };
}

// [id, label, rail short label, note]. The short label is what a 50px rail
// button can hold on one line; the full label is the panel heading.
const PANELS = [
  ['level', '关卡', '关卡', '选关、关卡库、布局编辑器入口'],
  ['scene', '场景', '场景', '相机、灯光、背景、源图裁切、显示控制'],
  ['track', '轨道', '轨道', '跑道选择、立体轨道、队列曲线、影子、粒子'],
  ['cars', '车辆与角色', '车辆', '车位、车辆、行驶路径、小人模型与材质'],
  ['guide', '引导与流程', '引导', '手指提示、开场引导、横幅、倒计时、天气、前贴、结算'],
  ['ui', '界面与品牌', '界面', 'Icon/Logo/文本、CTA、倍速按钮、进度条'],
  ['audio', '声音', '声音', '音效延迟、音量、BGM 库'],
  ['assets', '素材', '素材', '五类素材库的台账与 5 MB 预算'],
  ['export', '导出', '导出', '命名、截图、套系、七平台交付'],
];

function summarize(inventory) {
  const byPanel = new Map(PANELS.map(([id]) => [id, { sections: 0, fields: 0 }]));
  for (const section of inventory.sections) {
    const bucket = byPanel.get(section.panel) ?? { sections: 0, fields: 0 };
    bucket.sections += 1;
    bucket.fields += section.fieldCount;
    byPanel.set(section.panel, bucket);
  }
  const lines = [`${inventory.totals.sections} 段 / ${inventory.totals.fields} 字段（${inventory.totals.layoutScoped} 段按跑道显隐，共 ${inventory.totals.layouts} 条跑道）`, ''];
  for (const [id, label] of PANELS) {
    const bucket = byPanel.get(id);
    lines.push(`${label.padEnd(8, '　')} ${String(bucket.sections).padStart(2)} 段  ${String(bucket.fields).padStart(4)} 字段`);
  }
  lines.push('', '控件类型：' + Object.entries(inventory.controls).map(([kind, count]) => `${kind}×${count}`).join('  '));
  return lines.join('\n');
}

async function writeJson(target, inventory) {
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(inventory, null, 2)}\n`);
  console.log(`wrote ${target}`);
}

async function writeHtml(target, inventory) {
  const template = await readFile(TEMPLATE_PATH, 'utf8');
  const anchor = '/*__EDITOR_SHELL_INVENTORY__*/';
  if (!template.includes(anchor)) fail(`template is missing the ${anchor} placeholder`);
  const payload = JSON.stringify({
    inventory,
    panels: PANELS.map(([id, label, short, note]) => ({ id, label, short, note })),
  });
  const html = template.replace(anchor, `window.__EDITOR_SHELL_DATA__ = ${payload};`);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, html);
  console.log(`wrote ${target}`);
}

const args = process.argv.slice(2);
const source = await readEditorSource();
const levelOptions = await readLevelOptions();
let code = source.replace(/^export /gm, '') + '\nreturn FIELD_GROUPS;';
const groups = new Function('LEVEL_OPTIONS', 'BRANDING_LOCALE_OPTIONS', code)(
  levelOptions,
  [['auto', '跟随浏览器'], ['en', 'English'], ['ja', '日本語']],
);

if (!Array.isArray(groups) || groups.length < 60) fail(`expected at least 60 field groups, got ${groups?.length}`);
const fieldTotal = groups.reduce((sum, group) => sum + group.fields.length, 0);
if (fieldTotal < 500) fail(`expected at least 500 fields, got ${fieldTotal}`);

const inventory = buildInventory(groups, levelOptions);

const jsonAt = args.indexOf('--json');
const htmlAt = args.indexOf('--html');
if (jsonAt >= 0 && args[jsonAt + 1]) await writeJson(resolve(repoRoot, args[jsonAt + 1]), inventory);
if (htmlAt >= 0 && args[htmlAt + 1]) await writeHtml(resolve(repoRoot, args[htmlAt + 1]), inventory);
console.log(summarize(inventory));
