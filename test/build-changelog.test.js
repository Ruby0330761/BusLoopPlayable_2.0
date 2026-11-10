import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

import { BUILD_CHANGELOG, findChangelogEntry } from '../src/build-changelog.js';
import { BUILD_VERSION } from '../src/build-version.js';

const editorSource = await readFile(new URL('../src/scene-editor.js', import.meta.url), 'utf8');
const styleSource = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

test('the changelog ships at least one documented release', () => {
  assert.ok(Array.isArray(BUILD_CHANGELOG));
  assert.ok(BUILD_CHANGELOG.length > 0);
  for (const entry of BUILD_CHANGELOG) {
    assert.match(entry.version, /^\d{8}-\d{4}$/u, `${entry.version} must be a build stamp`);
    assert.match(entry.date, /^\d{4}-\d{2}-\d{2}$/u, `${entry.date} must be an ISO date`);
    assert.equal(typeof entry.title, 'string');
    assert.ok(entry.title.trim().length > 0, 'every entry needs a title');
    assert.ok(Array.isArray(entry.changes) && entry.changes.length > 0, 'every entry needs changes');
    for (const change of entry.changes) {
      assert.ok(typeof change === 'string' && change.trim().length > 0);
    }
  }
});

test('the changelog is newest first and has no duplicate versions', () => {
  const versions = BUILD_CHANGELOG.map((entry) => entry.version);
  assert.equal(new Set(versions).size, versions.length, 'versions must be unique');
  const sorted = [...versions].sort().reverse();
  assert.deepEqual(versions, sorted, 'entries must be listed newest first');
});

test('the running build has an entry, so 关于 always explains itself', () => {
  // Shipping a release without notes is the failure this catches: the panel
  // would show an older version as "current" and hide what just changed.
  const entry = findChangelogEntry(BUILD_VERSION);
  assert.ok(entry, `no changelog entry for build ${BUILD_VERSION}`);
  assert.equal(entry.version, BUILD_VERSION);
});

test('findChangelogEntry tolerates unknown and malformed versions', () => {
  assert.equal(findChangelogEntry('19990101-0000'), null);
  assert.equal(findChangelogEntry(''), null);
  assert.equal(findChangelogEntry(null), null);
  assert.equal(findChangelogEntry(undefined), null);
  // Surrounding whitespace should still resolve.
  const known = BUILD_CHANGELOG[0].version;
  assert.equal(findChangelogEntry(`  ${known}  `)?.version, known);
});

test('the editor header exposes an 关于 button and a release-notes dialog', () => {
  assert.match(editorSource, /import \{ BUILD_CHANGELOG \} from '\.\/build-changelog\.js'/);
  assert.match(editorSource, /class="editor-about"/);
  assert.match(editorSource, /class="editor-about-panel"/);
  assert.match(editorSource, /role="dialog"/);
  assert.match(editorSource, /renderChangelogList\(BUILD_VERSION\)/);
  // The current build is marked, so the operator knows these are their notes.
  assert.match(editorSource, /entry\.version === currentVersion/);
  assert.match(editorSource, /editor-about-entry-badge/);
  // Escape, the close button and the backdrop all dismiss it.
  assert.match(editorSource, /event\.key === 'Escape'/);
  assert.match(editorSource, /event\.target === aboutPanel/);
});

test('release-note text is escaped before it reaches innerHTML', () => {
  // Notes are authored, but a changelog line containing `<` (the Moloco fix
  // literally mentions an <img> tag) must not break the panel markup.
  assert.match(editorSource, /function escapeChangelogText/);
  assert.match(editorSource, /replaceAll\('&', '&amp;'\)/);
  assert.match(editorSource, /replaceAll\('<', '&lt;'\)/);
  assert.match(editorSource, /escapeChangelogText\(change\)/);
  assert.match(editorSource, /escapeChangelogText\(entry\.title\)/);
});

test('the about panel is styled as a modal overlay', () => {
  assert.match(styleSource, /\.editor-about-panel \{/);
  assert.match(styleSource, /\.editor-about-panel\[hidden\] \{ display: none; \}/);
  assert.match(styleSource, /\.editor-about-dialog \{/);
  assert.match(styleSource, /\.editor-about-entry\.is-current \{/);
  // Long histories scroll inside the dialog instead of growing the panel.
  assert.match(styleSource, /\.editor-about-list \{[^}]*overflow-y: auto/u);
});
