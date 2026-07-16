import fs from 'node:fs';
import path from 'node:path';

const [sourcePath, outputPath] = process.argv.slice(2);
if (!sourcePath || !outputPath) {
  throw new Error('Usage: node scripts/extract-unity-vat.mjs <Unity Texture2D.asset> <output.bin>');
}

const source = fs.readFileSync(sourcePath, 'utf8');
const width = Number(source.match(/m_Width:\s*(\d+)/)?.[1]);
const height = Number(source.match(/m_Height:\s*(\d+)/)?.[1]);
const format = Number(source.match(/m_TextureFormat:\s*(\d+)/)?.[1]);
const hex = source.match(/_typelessdata:\s*([0-9a-f]+)/i)?.[1];
if (!width || !height || format !== 17 || !hex) {
  throw new Error('Expected an inline Unity RGBAHalf Texture2D.');
}

const raw = Buffer.from(hex, 'hex');
const topMipBytes = width * height * 4 * 2;
if (raw.length < topMipBytes) throw new Error('VAT texture data is truncated.');
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, raw.subarray(0, topMipBytes));
console.log(JSON.stringify({ width, height, format: 'RGBAHalf', bytes: topMipBytes }));
