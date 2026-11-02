// Official in-game level library.
//
// The Unity project ships its campaign levels as one .asset per level, split
// across chapter folders. They are kept out of the authoring catalog until an
// operator actually picks one: importing all 400+ up front would bloat the
// generated catalog and make every picker slower for levels nobody uses.
//
// Keys are numeric because every runtime, export, and web-level route requires
// `level<number>`. A chapter letter maps to its alphabet position and the level
// number is padded to three digits, so the three shipped chapters stay distinct:
//
//   A/level12.asset  -> level1012        A/guidelevel4.asset -> level19004
//   B/level12.asset  -> level2012        E/level47.asset     -> level5047
//
// Guide levels use a `9` marker between the chapter code and the padded number.
// Chapters only reach level 200, so the marker cannot collide with a real
// chapter level.
//
// The display name carries the same identity in a readable form
// ("A-12（游戏内）"), so the shared level dropdown stays unambiguous.

import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderLevelSvg, summarizeLevel } from '../src/level-layout-thumbnail.js';
import { validateUnityLevelSource } from './unity-level-importer.mjs';
import { parseUnityLevelSource } from './unity-level-parser.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const OFFICIAL_LEVEL_ROOT = process.env.PLAYABLE_OFFICIAL_LEVEL_ROOT
  ? path.resolve(process.env.PLAYABLE_OFFICIAL_LEVEL_ROOT)
  // Deliberately outside artifacts/: that directory is a persistent volume on
  // the remote editor and is seeded only once, so assets added there later
  // never reach the live editor. Shipped source levels belong in the image.
  : path.join(ROOT, 'official-levels');

export const OFFICIAL_LEVEL_FILE_PATTERN = /^(guide)?level(\d+)\.asset$/i;

// A letter maps to its alphabet position so adding chapter F later never
// renumbers the keys of levels that were already imported.
export function chapterCode(chapterId) {
  const match = /^([A-Z])$/i.exec(String(chapterId ?? '').trim());
  if (!match) throw new Error(`Invalid official level chapter: ${chapterId}`);
  const code = match[1].toUpperCase().charCodeAt(0) - 64;
  if (code < 1 || code > 26) throw new Error(`Invalid official level chapter: ${chapterId}`);
  return code;
}

export function officialLevelKey(chapterId, number, { guide = false } = {}) {
  const parsed = Number(number);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 999) {
    throw new Error(`Invalid official level number: ${number}`);
  }
  return `level${chapterCode(chapterId)}${guide ? 9 : ''}${String(parsed).padStart(3, '0')}`;
}

export function officialLevelDisplayName(chapterId, number, { guide = false } = {}) {
  const chapter = String(chapterId).toUpperCase();
  return guide ? `${chapter}-引导${Number(number)}（游戏内）` : `${chapter}-${Number(number)}（游戏内）`;
}

function chapterFromFolder(folderName) {
  const match = /([A-Z])$/i.exec(folderName);
  if (!match) return null;
  const id = match[1].toUpperCase();
  try {
    chapterCode(id);
  } catch {
    return null;
  }
  return id;
}

function isAssetFile(fileName) {
  return OFFICIAL_LEVEL_FILE_PATTERN.test(fileName);
}

/**
 * List the chapter folders that actually contain level assets.
 * Missing root is not an error: an un-provisioned editor should simply show an
 * empty library instead of failing the level panel.
 */
export async function listOfficialChapters(root = OFFICIAL_LEVEL_ROOT) {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  const chapters = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const id = chapterFromFolder(entry.name);
    if (!id) continue;
    let files;
    try {
      files = (await readdir(path.join(root, entry.name))).filter(isAssetFile);
    } catch {
      continue;
    }
    if (files.length === 0) continue;
    chapters.push({ id, label: entry.name, folder: entry.name, count: files.length });
  }
  chapters.sort((first, second) => first.id.localeCompare(second.id));
  return chapters;
}

async function chapterSignature(folderPath) {
  const files = (await readdir(folderPath)).filter(isAssetFile).sort();
  const parts = [];
  for (const fileName of files) {
    const info = await stat(path.join(folderPath, fileName));
    parts.push(`${fileName}:${info.size}:${info.mtimeMs}`);
  }
  return parts.join('|');
}

async function buildChapterItems(folderPath, chapterId) {
  const files = (await readdir(folderPath)).filter(isAssetFile).sort((first, second) => {
    const a = OFFICIAL_LEVEL_FILE_PATTERN.exec(first);
    const b = OFFICIAL_LEVEL_FILE_PATTERN.exec(second);
    return Number(a?.[2] ?? 0) - Number(b?.[2] ?? 0)
      || Number(Boolean(a?.[1])) - Number(Boolean(b?.[1]))
      || first.localeCompare(second);
  });
  const items = [];
  for (const fileName of files) {
    const match = OFFICIAL_LEVEL_FILE_PATTERN.exec(fileName);
    const number = Number(match?.[2]);
    const guide = Boolean(match?.[1]);
    const key = officialLevelKey(chapterId, number, { guide });
    const displayName = officialLevelDisplayName(chapterId, number, { guide });
    const item = { key, chapter: chapterId, number, guide, fileName, displayName };
    let level = null;
    let importError = null;
    let source = null;
    try {
      source = await readFile(path.join(folderPath, fileName), 'utf8');
      // Parse without the parity gate so an asset that cannot be imported yet
      // still shows its real layout instead of a blank "unreadable" card.
      level = parseUnityLevelSource(source, {
        fileName,
        key,
        displayName,
        baseLevel: {},
        validate: false
      });
    } catch (error) {
      importError = error.message;
    }
    if (level) {
      try {
        validateUnityLevelSource({
          filename: fileName,
          source,
          targetKey: key,
          displayName
        });
      } catch (error) {
        // The layout still renders, so the level stays visible with the reason
        // it cannot be imported instead of disappearing from the library.
        importError = error.message;
      }
    }
    if (level) {
      items.push({
        ...item,
        ...summarizeLevel(level),
        unityId: level.unityId,
        conveyorBeltName: level.conveyorBeltName || '',
        status: importError ? 'unsupported' : 'ready',
        error: importError,
        svg: renderLevelSvg(level, { width: 240, height: 176, className: 'level-thumb' })
      });
    } else {
      items.push({ ...item, status: 'error', error: importError ?? '无法解析关卡数据', svg: null });
    }
  }
  return items;
}

const chapterCache = new Map();

/**
 * Read one chapter's level summaries, including a rendered top-down thumbnail.
 * Parsing 200 assets takes long enough to notice, so a chapter is cached until
 * one of its files changes.
 */
export async function readOfficialChapter(chapterId, { root = OFFICIAL_LEVEL_ROOT, chapters = null } = {}) {
  const id = String(chapterId ?? '').trim().toUpperCase();
  const resolvedRoot = path.resolve(root);
  const known = chapters ?? await listOfficialChapters(resolvedRoot);
  const chapter = known.find((entry) => entry.id === id);
  if (!chapter) {
    const error = new Error(`Official level chapter not found: ${chapterId}`);
    error.statusCode = 404;
    throw error;
  }
  const folderPath = path.join(resolvedRoot, chapter.folder);
  const signature = await chapterSignature(folderPath);
  // Keyed by root too: the same chapter id under a different asset root is a
  // different library, and tests/preview roots must not read each other's data.
  const cacheKey = `${resolvedRoot}\u0000${id}`;
  const cached = chapterCache.get(cacheKey);
  if (cached?.signature === signature) return cached.payload;
  const payload = { ...chapter, items: await buildChapterItems(folderPath, id) };
  chapterCache.set(cacheKey, { signature, payload });
  return payload;
}

/**
 * Resolve one asset for import, rejecting anything outside the chapter folder.
 */
export async function readOfficialLevelAsset(chapterId, fileName, { root = OFFICIAL_LEVEL_ROOT, chapters = null } = {}) {
  const id = String(chapterId ?? '').trim().toUpperCase();
  const name = String(fileName ?? '').trim();
  const resolvedRoot = path.resolve(root);
  const known = chapters ?? await listOfficialChapters(resolvedRoot);
  const chapter = known.find((entry) => entry.id === id);
  if (!chapter) {
    const error = new Error(`Official level chapter not found: ${chapterId}`);
    error.statusCode = 404;
    throw error;
  }
  const match = OFFICIAL_LEVEL_FILE_PATTERN.exec(name);
  if (!match || path.basename(name) !== name) {
    const error = new Error(`Invalid official level file: ${fileName}`);
    error.statusCode = 400;
    throw error;
  }
  const folderPath = path.join(resolvedRoot, chapter.folder);
  let source;
  try {
    source = await readFile(path.join(folderPath, name), 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      const missing = new Error(`Official level file not found: ${name}`);
      missing.statusCode = 404;
      throw missing;
    }
    throw error;
  }
  const number = Number(match[2]);
  const guide = Boolean(match[1]);
  return {
    chapter: id,
    folder: chapter.folder,
    fileName: name,
    number,
    guide,
    key: officialLevelKey(id, number, { guide }),
    displayName: officialLevelDisplayName(id, number, { guide }),
    source
  };
}
