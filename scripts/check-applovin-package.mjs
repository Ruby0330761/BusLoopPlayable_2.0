import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const PACKAGE_FILE = path.join(ROOT, 'artifacts', 'applovin', 'index.html');
const MAX_BYTES = 5_000_000;
const ALLOWED_URLS = new Set([
  'https://play.google.com/store/apps/details?id=gridplus.busjam.carpuzzle',
  'https://apps.apple.com/app/id6746743297'
]);
const ALLOWED_URL_PREFIXES = [
  'http://www.w3.org/'
];

function collectMatches(source, pattern) {
  return [...source.matchAll(pattern)].map((match) => match[0]);
}

function getInlineModuleScripts(html) {
  return [...html.matchAll(/<script\b(?=[^>]*\btype=["']module["'])[^>]*>([\s\S]*?)<\/script>/giu)]
    .map((match) => match[1] ?? '');
}

function inlineModulesAreSyntaxValid(html) {
  try {
    for (const script of getInlineModuleScripts(html)) {
      // The Vite production bundle is self-contained; this catches corrupted
      // inline JS before upload, such as broken string literals after packaging.
      new Function(script);
    }
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const [{ size }, html] = await Promise.all([
    stat(PACKAGE_FILE),
    readFile(PACKAGE_FILE, 'utf8')
  ]);

  const checks = [
    {
      name: 'single HTML size <= 5,000,000 bytes',
      pass: size <= MAX_BYTES,
      detail: `${size} bytes`
    },
    {
      name: 'no external script src',
      pass: [...html.matchAll(/<script\b([^>]*)>[\s\S]*?<\/script>/giu)]
        .every((match) => !/\bsrc\s*=/iu.test(match[1] ?? ''))
    },
    {
      name: 'inline module syntax valid',
      pass: inlineModulesAreSyntaxValid(html)
    },
    {
      name: 'no external stylesheet link',
      pass: !collectMatches(html, /<link\b[^>]*>/giu)
        .some((tag) => /\bhref\s*=/iu.test(tag))
    },
    {
      name: 'no root-relative asset URLs',
      pass: !/(?:src|href)=["']\/|url\(["']?\/|\/assets\//iu.test(html)
    },
    {
      name: 'no WAV references',
      pass: !/\.wav\b/iu.test(html)
    },
    {
      name: 'MRAID CTA bridge present',
      pass: /mraid\.open/iu.test(html)
    },
    {
      name: 'no browser window.open fallback',
      pass: !/window\.open/iu.test(html)
    },
    {
      name: 'data URL fetch compatibility layer present',
      pass: /installDataUrlFetchCompat/iu.test(html) &&
        /dataUrlFetchCompat/iu.test(html) &&
        /new Response\(bytes/iu.test(html)
    },
    {
      name: 'inline binary data assets present',
      pass: /data:application\/octet-stream;base64/iu.test(html)
    },
    {
      name: 'iOS App Store direct scheme present',
      pass: /itms-apps:\/\/itunes\.apple\.com\/app\/id6746743297/iu.test(html)
    },
    {
      name: 'MRAID ready/default wait present',
      pass: /\.getState\(\)/u.test(html) &&
        /\.addEventListener\(["']ready["']/u.test(html) &&
        /["']loading["']/u.test(html) &&
        /["']default["']/u.test(html)
    },
    {
      name: 'inline image assets present',
      pass: /data:image\//iu.test(html)
    },
    {
      name: 'inline audio assets present',
      pass: /data:audio\/mpeg/iu.test(html)
    },
    {
      name: 'no disallowed remote URLs',
      pass: collectMatches(html, /https?:\/\/[^"'`\s<>)]+/giu)
        .every((url) => (
          ALLOWED_URLS.has(url) ||
          ALLOWED_URL_PREFIXES.some((prefix) => url.startsWith(prefix))
        )),
      detail: collectMatches(html, /https?:\/\/[^"'`\s<>)]+/giu)
        .filter((url) => (
          !ALLOWED_URLS.has(url) &&
          !ALLOWED_URL_PREFIXES.some((prefix) => url.startsWith(prefix))
        ))
        .join(', ')
    }
  ];

  for (const check of checks) {
    const detail = check.detail ? ` (${check.detail})` : '';
    console.log(`${check.pass ? 'PASS' : 'FAIL'} ${check.name}${detail}`);
  }

  if (checks.some((check) => !check.pass)) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
