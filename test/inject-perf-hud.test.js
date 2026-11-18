import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const SCRIPT = new URL('../scripts/inject-perf-hud.mjs', import.meta.url).pathname;

async function withFixture(html, callback) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'perf-hud-test-'));
  try {
    const input = path.join(dir, 'in.html');
    const output = path.join(dir, 'out.html');
    await writeFile(input, html, 'utf8');
    await run(process.execPath, [SCRIPT, input, output, '--label', 'unit test']);
    return await callback(await readFile(output, 'utf8'), dir, input, output);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const PAGE = '<!doctype html><html><head><title>t</title></head><body><div id="app"></div></body></html>';

test('the perf HUD is injected before </head> and keeps the page intact', async () => {
  await withFixture(PAGE, async (output) => {
    assert.ok(output.includes('perf-hud'), 'HUD container id missing');
    assert.ok(output.includes('unit test'), 'label was not substituted');
    // Injection must happen in <head>, before the body the playable boots into.
    assert.ok(output.indexOf('perf-hud') < output.indexOf('<body'), 'HUD landed after <body>');
    // The original page must survive unchanged around the injected block.
    assert.ok(output.includes('<div id="app"></div>'), 'the app mount was damaged');
    assert.ok(output.trimEnd().endsWith('</html>'), 'the document tail was truncated');
  });
});

test('the HUD mounts after the body exists instead of writing into a null body', async () => {
  // Regression: the first version called `document.body.appendChild` from a
  // <head> script and threw, so the HUD never appeared on a real device.
  await withFixture(PAGE, async (output) => {
    assert.ok(
      !/document\.body\.appendChild/.test(output),
      'a bare document.body.appendChild came back; mount it via the DOM-ready path'
    );
    assert.ok(/document\.body \|\| document\.documentElement/.test(output),
      'mount path no longer tolerates a missing body');
    assert.ok(/DOMContentLoaded/.test(output), 'DOM-ready fallback is missing');
    assert.ok(/isConnected/.test(output), 'the HUD is no longer re-asserted after pre-roll swaps');
  });
});

test('the HUD reads the runtime surfaces a device actually exposes', async () => {
  await withFixture(PAGE, async (output) => {
    // Frame timing comes from rAF; draw-call counters come from the renderer.
    assert.ok(/requestAnimationFrame/.test(output), 'frame sampling is missing');
    assert.ok(/renderer\.info/.test(output), 'renderer info is not read');
    assert.ok(/render\.calls/.test(output), 'draw calls are not read');
    assert.ok(/jank/.test(output), 'jank accounting is missing');
    // A tab switch must not poison the percentiles with a multi-second gap.
    assert.ok(/dt < 2000/.test(output), 'stall frames are no longer filtered');
  });
});

test('a doc-less HTML file is rejected instead of writing a broken package', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'perf-hud-bad-'));
  try {
    const input = path.join(dir, 'in.html');
    await writeFile(input, '<div>no head here</div>', 'utf8');
    await assert.rejects(
      () => run(process.execPath, [SCRIPT, input, path.join(dir, 'out.html')]),
      /no <\/head>/u
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
