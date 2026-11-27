import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// Two editor shells share one control tree: the shipped sidebar (`classic`) and
// the rail/panel/stage/inspector layout (`shell`). These tests pin the contract
// that makes that safe — the classic shell keeps its exact hooks, the shell adds
// only new ones, and opting in is explicit rather than automatic.

const read = (relative) => readFile(new URL(`../${relative}`, import.meta.url), 'utf8');

test('the studio workspace is the local default and the remote editor defaults to classic', async () => {
  const mainSource = await read('src/main.js');
  const editorSource = await read('src/scene-editor.js');

  assert.match(editorSource, /layoutMode = 'classic'/);
  assert.match(editorSource, /const shellLayout = layoutMode === 'shell' \|\| Boolean\(studio\)/);
  assert.match(mainSource, /studioAvailable = import.meta.env.DEV && !__REMOTE_EDITOR__/);
  assert.match(mainSource, /return studioAvailable \? 'studio' : 'classic'/);
  assert.match(mainSource, /studioAvailable \? \['classic', 'shell', 'studio'\] : \['classic', 'shell'\]/);
});

test('the classic shell keeps every hook its wiring queries', async () => {
  const editorSource = await read('src/scene-editor.js');
  const stylesSource = await read('src/styles.css');

  // These selectors are how createSceneEditor binds behaviour. If the classic
  // template stops emitting one, the editor silently loses that control.
  // Markup writes class attributes, so match the bare name rather than the
  // querySelector spelling with a leading dot.
  for (const hook of [
    'editor-category-tabs',
    'data-editor-category-tab',
    'editor-fields',
    'editor-screenshot-select',
    'editor-screenshot-button',
    'editor-export-set-select',
    'editor-export-select',
    'editor-export-button',
    'editor-delivery-list',
    'editor-undo',
    'editor-redo',
    'editor-reset',
    'editor-about',
    'editor-about-close',
    'editor-about-panel',
    'editor-toggle',
    'editor-locale-select',
  ]) {
    assert.ok(editorSource.includes(hook), `classic template lost ${hook}`);
  }

  // The shell layout must not reach into the classic rules; every one of its
  // rules is scoped to #app.layout-shell.
  const shellRules = stylesSource
    .split('\n')
    .filter((line) => /\.(?:shell-|editor-search-)/.test(line) && line.includes('{'));
  assert.ok(shellRules.length > 0, 'shell layout styles are missing');
  for (const rule of shellRules) {
    assert.match(rule, /#app\.layout-shell/, `unscoped shell rule: ${rule.trim()}`);
  }
});

test('the shell shell adds its own hooks and reaches the stage column', async () => {
  const editorSource = await read('src/scene-editor.js');
  const stylesSource = await read('src/styles.css');

  for (const hook of [
    'shell-rail',
    'data-shell-panel',
    'editor-search-input',
    'shell-inspector',
    'data-shell-tab',
  ]) {
    assert.ok(editorSource.includes(hook), `shell template is missing ${hook}`);
  }
  // Panel hosts are built in JS, so the attribute is written through dataset
  // rather than appearing as a literal in the template.
  assert.match(editorSource, /host\.dataset\.shellPanelBody = panel\.id;/);

  // Four columns, and the sidebar wrapper is dissolved so its children can
  // occupy two separate page columns.
  assert.match(stylesSource, /#app\.layout-shell \{\s*display: grid;/);
  assert.match(stylesSource, /#app\.layout-shell > \.scene-editor \{\s*display: contents;/);
  // The shell must re-frame the phone preview against the stage column rather
  // than the whole viewport, or the preview overflows the middle column.
  assert.match(stylesSource, /#app\.layout-shell\.is-phone-preview > #stage/);
});

test('the shell panel is denser than the classic sidebar', async () => {
  const stylesSource = await read('src/styles.css');
  const shellBlock = stylesSource.slice(stylesSource.indexOf('Shell editor layout'));
  const shellRow = shellBlock.match(/#app\.layout-shell \.editor-field \{[^}]*min-height: (\d+)px/);

  assert.ok(shellRow, 'shell field row rule is missing');
  // The classic row is 34px. The shell label ellipsizes instead of wrapping and
  // shares a line with the control, so anything above 28px means the density
  // work regressed.
  assert.ok(Number(shellRow[1]) <= 28, `shell row is ${shellRow[1]}px, expected <= 28`);
  // Fields must not keep the classic fixed number-box column: the shell groups
  // every non-number control onto the same two-column label/control template.
  const collapsed = shellBlock.match(/\.editor-field-text[\s\S]{0,400}?grid-template-columns: 84px minmax\(0, 1fr\);/);
  assert.ok(collapsed, 'shell fields did not collapse to a two-column label/control row');
  // Labels are allowed two lines rather than being ellipsized: truncation cut 47
  // labels mid-word and reads as broken, not dense.
  assert.match(shellBlock, /#app\.layout-shell \.editor-field > span:first-child \{[^}]*white-space: normal/);
  assert.doesNotMatch(shellBlock, /#app\.layout-shell \.editor-field > span:first-child \{[^}]*text-overflow: ellipsis/);
});

test('every field group has a rail panel and no section is left unowned', async () => {
  const editorSource = await read('src/scene-editor.js');

  // Rail panels are declared once and matched by field path.
  const panelBlock = editorSource.slice(
    editorSource.indexOf('const SHELL_PANELS = ['),
    editorSource.indexOf('const SHELL_SUBGROUPS'),
  );
  const panelIds = [...panelBlock.matchAll(/\{ id: '([a-z]+)'/g)].map((match) => match[1]);
  assert.deepEqual(panelIds, [
    'level', 'scene', 'track', 'cars', 'guide', 'ui', 'audio', 'export',
  ]);

  // Rows that are plain divs rather than <details> need an explicit owner;
  // without one they sit outside every panel host and show in all nine panels.
  assert.match(editorSource, /\['editor-level-tools', 'level'\]/);

  // A section with no matching path falls back to 场景 instead of vanishing.
  assert.match(editorSource, /return best \?\? 'scene';/);
});
