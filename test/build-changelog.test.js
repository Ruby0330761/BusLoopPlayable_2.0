import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

import { BUILD_CHANGELOG, changelogVersions, findChangelogEntry } from '../src/build-changelog.js';
import { BUILD_VERSION } from '../src/build-version.js';

const editorSource = await readFile(new URL('../src/scene-editor.js', import.meta.url), 'utf8');
const styleSource = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

test('the changelog ships one entry per shipped day', () => {
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
    // Every entry covers at least its own stamp, and `version` is the newest.
    const stamps = changelogVersions(entry);
    assert.ok(stamps.length > 0, `${entry.date} must cover at least one build`);
    assert.equal(stamps[0], entry.version, `${entry.date} version must be its newest build`);
    for (const stamp of stamps) {
      assert.match(stamp, /^\d{8}-\d{4}$/u, `${stamp} must be a build stamp`);
      assert.equal(stamp.slice(0, 8), entry.date.replaceAll('-', ''),
        `${stamp} belongs to ${entry.date}, not ${stamp.slice(0, 8)}`);
    }
  }
});

test('a day is documented once, however many builds it took', () => {
  // The point of the merge: 2026-11-10 shipped eleven builds of one work stream
  // and used to render as eleven near-identical cards.
  const dates = BUILD_CHANGELOG.map((entry) => entry.date);
  assert.equal(new Set(dates).size, dates.length, 'each day gets exactly one entry');
});

test('the changelog is newest first and no build stamp appears twice', () => {
  const versions = BUILD_CHANGELOG.map((entry) => entry.version);
  assert.equal(new Set(versions).size, versions.length, 'day versions must be unique');
  const sorted = [...versions].sort().reverse();
  assert.deepEqual(versions, sorted, 'entries must be listed newest first');
  const allStamps = BUILD_CHANGELOG.flatMap(changelogVersions);
  assert.equal(new Set(allStamps).size, allStamps.length, 'a build stamp may only belong to one day');
});

test('the running build resolves to its day, so 关于 always explains itself', () => {
  // Shipping a release without notes is the failure this catches: the panel
  // would show an older day as "current" and hide what just changed.
  const entry = findChangelogEntry(BUILD_VERSION);
  assert.ok(entry, `no changelog entry for build ${BUILD_VERSION}`);
  assert.ok(changelogVersions(entry).includes(BUILD_VERSION));
  // A mid-day build still resolves through the day's `versions` list.
  const midDay = changelogVersions(entry)[changelogVersions(entry).length - 1];
  assert.equal(findChangelogEntry(midDay)?.date, entry.date);
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
  assert.match(editorSource, /import \{ BUILD_CHANGELOG, changelogVersions \} from '\.\/build-changelog\.js'/);
  assert.match(editorSource, /class="editor-about"/);
  assert.match(editorSource, /class="editor-about-panel"/);
  assert.match(editorSource, /role="dialog"/);
  assert.match(editorSource, /renderChangelogList\(BUILD_VERSION\)/);
  // The current build is marked, so the operator knows these are their notes.
  assert.match(editorSource, /const stamps = changelogVersions\(entry\);/);
  assert.match(editorSource, /const isCurrent = stamps\.includes\(currentVersion\);/);
  // The day's other build stamps stay visible so the on-screen stamp is traceable.
  assert.match(editorSource, /editor-about-entry-builds/);
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

test('opening About suppresses preview guides without changing the operator preference', () => {
  assert.match(editorSource, /root\.classList\.toggle\('is-about-open', open\)/);
  assert.match(styleSource, /\.editor-safe-guide\[hidden\],\s*#app:has\(> \.scene-editor\.is-about-open\) \.editor-safe-guide\s*\{\s*display: none;/);
});
