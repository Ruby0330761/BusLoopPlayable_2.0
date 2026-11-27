import { gunzipSync, gzipSync } from 'node:zlib';

const binaryHeader = Buffer.from('Kaydara FBX Binary  \0\x1a\0');
const footerMagic = Buffer.from('f85a8c6adef5d97eece90ce3758f290b', 'hex');
const collectionType = 'CollectionExclusive';
const maxFbxBytes = 8 * 1024 * 1024;

class UnsupportedFbx extends Error {}

function requireFbx(condition) {
  if (!condition) throw new UnsupportedFbx();
}

function uniqueNode(nodes, name) {
  const matches = nodes.filter(node => node.name === name);
  requireFbx(matches.length === 1);
  return matches[0];
}

function readFbxString(properties, offset) {
  requireFbx(properties[offset] === 83 && offset + 5 <= properties.length);
  const end = offset + 5 + properties.readUInt32LE(offset + 1);
  requireFbx(end <= properties.length);
  return { value: properties.toString('utf8', offset + 5, end), end };
}

function objectId(properties, offset = 0) {
  requireFbx(properties[offset] === 76 && offset + 9 <= properties.length);
  return properties.readBigInt64LE(offset + 1);
}

function addObjectId(ids, id) {
  requireFbx(id !== 0n && !ids.has(id));
  ids.add(id);
}

function updateBinaryCount(parent, adjustment, expected) {
  const count = uniqueNode(parent.children, 'Count');
  const bytes = count.properties;
  requireFbx(bytes.length === 5 && bytes[0] === 73 && count.childCount === 0);
  const previous = bytes.readUInt32LE(1);
  requireFbx(previous >= adjustment && (expected === undefined || previous === expected));
  count.properties = Buffer.from(bytes);
  count.properties.writeUInt32LE(previous - adjustment, 1);
}

function stripBinary(raw) {
  const version = raw.readUInt32LE(binaryHeader.length);
  requireFbx(version >= 7000 && version <= 7700);
  const word = version >= 7500 ? 8 : 4;
  const headerSize = 3 * word + 1;
  const nullRecord = Buffer.alloc(headerSize);
  const readWord = offset => word === 8 ? Number(raw.readBigUInt64LE(offset)) : raw.readUInt32LE(offset);
  function readNodes(start, limit, depth = 0) {
    requireFbx(depth <= 64);
    const nodes = [];
    let offset = start;
    while (offset < limit) {
      requireFbx(offset + headerSize <= limit);
      const end = readWord(offset);
      if (end === 0) {
        requireFbx(raw.subarray(offset, offset + headerSize).equals(nullRecord));
        return { nodes, end: offset + headerSize, terminated: true };
      }
      const nameStart = offset + headerSize;
      const propertyStart = nameStart + raw[nameStart - 1];
      const childStart = propertyStart + readWord(offset + 2 * word);
      requireFbx(nameStart < propertyStart && childStart <= end && end <= limit);
      const children = readNodes(childStart, end, depth + 1);
      requireFbx(children.end === end);
      nodes.push({
        name: raw.toString('utf8', nameStart, propertyStart),
        header: raw.subarray(offset, propertyStart),
        properties: raw.subarray(propertyStart, childStart),
        children: children.nodes,
        terminated: children.terminated,
        childCount: children.nodes.length
      });
      offset = end;
    }
    return { nodes, end: offset, terminated: false };
  }

  const roots = readNodes(binaryHeader.length + 4, raw.length);
  const trailerStart = raw.length - 144;
  const magicEnd = roots.end + 16;
  const trailer = raw.subarray(trailerStart);
  requireFbx(roots.terminated && magicEnd <= trailerStart && trailerStart - magicEnd <= 16
    && trailerStart % 16 === 0 && raw.subarray(magicEnd, trailerStart).every(value => value === 0)
    && trailer.readUInt32LE(0) === 0 && trailer.readUInt32LE(4) === version
    && trailer.subarray(-16).equals(footerMagic));

  const objects = uniqueNode(roots.nodes, 'Objects');
  const collectionNodes = objects.children.filter(node => node.name === collectionType);
  if (!collectionNodes.length) return null;
  const referenced = new Set();
  for (const node of uniqueNode(roots.nodes, 'Connections').children) {
    requireFbx(node.name === 'C' && node.childCount === 0);
    const type = readFbxString(node.properties, 0);
    requireFbx(/^[OP]{2}$/u.test(type.value));
    referenced.add(objectId(node.properties, type.end));
    referenced.add(objectId(node.properties, type.end + 9));
    const end = type.end + 18;
    requireFbx(end === node.properties.length || readFbxString(node.properties, end).end === node.properties.length);
  }

  const ids = new Set();
  const removed = new Set();
  for (const node of objects.children) {
    const id = objectId(node.properties);
    addObjectId(ids, id);
    if (node.name !== collectionType || referenced.has(id)) continue;
    const label = readFbxString(node.properties, 9);
    const kind = readFbxString(node.properties, label.end);
    requireFbx(kind.end === node.properties.length);
    if (kind.value === 'DisplayLayer') removed.add(node);
  }
  if (!removed.size) return null;

  const definitions = uniqueNode(roots.nodes, 'Definitions');
  const category = definitions.children.filter(node => node.name === 'ObjectType'
    && readFbxString(node.properties, 0).value === collectionType);
  requireFbx(category.length === 1);
  updateBinaryCount(category[0], removed.size, collectionNodes.length);
  updateBinaryCount(definitions, removed.size, objects.children.length + 1);
  if (removed.size === collectionNodes.length) {
    definitions.children = definitions.children.filter(node => node !== category[0]);
  }
  objects.children = objects.children.filter(node => !removed.has(node));

  const output = Buffer.alloc(raw.length);
  raw.copy(output, 0, 0, binaryHeader.length + 4);
  let cursor = binaryHeader.length + 4;
  function writeNodes(nodes) {
    for (const node of nodes) {
      const start = cursor;
      cursor += node.header.copy(output, cursor);
      cursor += node.properties.copy(output, cursor);
      writeNodes(node.children);
      if (node.terminated) cursor += headerSize;
      if (word === 8) output.writeBigUInt64LE(BigInt(cursor), start);
      else output.writeUInt32LE(cursor, start);
    }
  }
  writeNodes(roots.nodes);
  cursor += headerSize;
  cursor += raw.copy(output, cursor, roots.end, magicEnd);
  cursor += (16 - cursor % 16) % 16;
  cursor += trailer.copy(output, cursor);
  requireFbx(cursor < raw.length);
  return { bytes: output.subarray(0, cursor), removedLayers: removed.size };
}

function stripAscii(raw) {
  // Match the tab-indented, line-oriented FBX form consumed by Three.js. The
  // lexer ignores braces inside quoted strings and comments.
  const source = raw.toString('latin1');
  requireFbx(/^; FBX 7\.\d\.\d project file\r?\n/u.test(source));
  const root = { children: [] };
  const stack = [root];
  for (const token of source.matchAll(/"[^"\r\n]*"|;[^\r\n]*|[{}"]/gu)) {
    if (token[0] === '{') {
      const start = source.lastIndexOf('\n', token.index - 1) + 1;
      const header = /^\t*([A-Za-z][A-Za-z0-9_]*):\s*([^\r\n]*)$/u.exec(source.slice(start, token.index));
      requireFbx(header && stack.length <= 64);
      const node = { name: header[1], properties: header[2].trim(), start, body: token.index + 1, children: [] };
      stack.at(-1).children.push(node);
      stack.push(node);
    } else if (token[0] === '}') {
      requireFbx(stack.length > 1);
      const node = stack.pop();
      node.bodyEnd = token.index;
      node.end = token.index + 1;
    } else {
      requireFbx(token[0] !== '"');
    }
  }
  requireFbx(stack.length === 1);

  const objects = uniqueNode(root.children, 'Objects');
  const collectionNodes = objects.children.filter(node => node.name === collectionType);
  if (!collectionNodes.length) return null;
  const connections = uniqueNode(root.children, 'Connections');
  const referenced = new Set();
  for (const line of source.slice(connections.body, connections.bodyEnd).split(/\r?\n/u)) {
    const text = line.trim();
    if (!text || text.startsWith(';')) continue;
    const link = /^C:\s*"[OP]{2}"\s*,\s*(-?\d+)\s*,\s*(-?\d+)(?:\s*,\s*"[^"]*")?$/u.exec(text);
    requireFbx(link);
    referenced.add(BigInt(link[1]));
    referenced.add(BigInt(link[2]));
  }

  const ids = new Set();
  const removed = [];
  for (const node of objects.children) {
    const match = /^(-?\d+)\s*,/u.exec(node.properties);
    requireFbx(match);
    const id = BigInt(match[1]);
    addObjectId(ids, id);
    if (node.name !== collectionType || referenced.has(id)) continue;
    if (/^-?\d+\s*,\s*"[^"]*"\s*,\s*"DisplayLayer"$/u.test(node.properties)) removed.push(node);
  }
  if (!removed.length) return null;

  // Apply nonoverlapping edits from the end to retain every other source byte.
  const edits = removed.map(node => ({ start: node.start, end: node.end, text: '' }));
  const definitions = uniqueNode(root.children, 'Definitions');
  const category = definitions.children.filter(node => node.name === 'ObjectType' && node.properties === '"CollectionExclusive"');
  requireFbx(category.length === 1);
  function editCount(node, expected) {
    const prefix = source.slice(node.body, node.children[0]?.start ?? node.bodyEnd);
    const match = /^\t*Count:[\t ]*(\d+)/mu.exec(prefix);
    requireFbx(match && Number(match[1]) === expected);
    const start = node.body + match.index + match[0].length - match[1].length;
    edits.push({ start, end: start + match[1].length, text: String(expected - removed.length) });
  }
  editCount(definitions, objects.children.length + 1);
  if (removed.length === collectionNodes.length) {
    edits.push({ start: category[0].start, end: category[0].end, text: '' });
  } else {
    editCount(category[0], collectionNodes.length);
  }
  const result = edits.sort((a, b) => b.start - a.start)
    .reduce((text, edit) => text.slice(0, edit.start) + edit.text + text.slice(edit.end), source);
  return { bytes: Buffer.from(result, 'latin1'), removedLayers: removed.length };
}

export function stripUnreferencedFbxDisplayLayers(bytes) {
  try {
    const gzip = bytes[0] === 0x1f && bytes[1] === 0x8b;
    if (bytes.length > maxFbxBytes) return { bytes, reason: 'fbx-byte-budget' };
    const raw = gzip ? gunzipSync(bytes, { maxOutputLength: maxFbxBytes }) : bytes;
    if (!raw.includes('DisplayLayer')) return { bytes, reason: 'no-fbx-display-layers' };
    const binary = raw.subarray(0, binaryHeader.length).equals(binaryHeader);
    const stripped = binary ? stripBinary(raw) : stripAscii(raw);
    if (!stripped) return { bytes, reason: 'no-unreferenced-fbx-display-layers' };
    let delivery = stripped.bytes;
    if (gzip) {
      delivery = gzipSync(stripped.bytes, { level: 9 });
      if (delivery.length >= bytes.length) {
        const alternate = gzipSync(stripped.bytes, { level: 9, memLevel: 7 });
        if (alternate.length < delivery.length) delivery = alternate;
      }
    }
    return {
      bytes: delivery,
      removedLayers: stripped.removedLayers,
      reason: 'removed-unreferenced-fbx-display-layers'
    };
  } catch (error) {
    if (!(error instanceof UnsupportedFbx) && !(error instanceof RangeError)
      && error.code !== 'ERR_BUFFER_TOO_LARGE' && !error.code?.startsWith('Z_')) throw error;
    return { bytes, reason: 'unsupported-fbx-structure' };
  }
}
