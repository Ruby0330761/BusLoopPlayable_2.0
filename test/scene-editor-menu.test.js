import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { EDITOR_CATEGORIES, FIELD_GROUPS } from '../src/scene-editor.js';

const EXPECTED_CATEGORIES = [
  ['level', '关卡'],
  ['passenger', '乘客'],
  ['vehicle', '车辆'],
  ['parking', '车位'],
  ['ui', 'UI及材质'],
  ['store', '商店'],
  ['conveyor', '传送带'],
  ['extras', '附加项']
];

test('scene editor keeps every existing field group in one of the eight ordered categories', () => {
  assert.deepEqual(
    EDITOR_CATEGORIES.map(({ id, label }) => [id, label]),
    EXPECTED_CATEGORIES
  );

  const categoryIds = new Set(EDITOR_CATEGORIES.map(({ id }) => id));
  assert.ok(FIELD_GROUPS.length > 0);
  for (const group of FIELD_GROUPS) {
    assert.ok(categoryIds.has(group.category), `${group.title} is missing a valid category`);
  }
  for (const categoryId of categoryIds) {
    assert.ok(
      FIELD_GROUPS.some(({ category }) => category === categoryId),
      `${categoryId} does not contain a field group`
    );
  }
});

test('category detail keeps reset last and initializes all sections as collapsed', async () => {
  const [source, styles] = await Promise.all([
    readFile(new URL('../src/scene-editor.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/styles.css', import.meta.url), 'utf8')
  ]);

  assert.match(source, /class="editor-category-home"/);
  assert.match(source, /class="editor-category-view" hidden[\s\S]*class="editor-fields"[\s\S]*class="editor-reset"/);
  assert.match(source, /class="editor-category-back"/);
  assert.match(source, /initializeCollapsibleSections\(\)/);
  assert.match(source, /setSectionExpanded\(section, false\)/);
  assert.match(source, /button\.setAttribute\('aria-expanded', String\(expanded\)\)/);
  assert.match(source, /spatialSection\.dataset\.editorCategory = 'conveyor'/);
  assert.match(source, /foregroundVideoSection\.dataset\.editorCategory = 'extras'/);
  assert.match(source, /categoryMatches && conveyorLayoutMatches && spatialSelectionMatches/);
  assert.match(styles, /\.editor-section-content\[hidden\] \{ display: none; \}/);
  assert.match(styles, /\.editor-section-header \{ display: flex;/);
});
