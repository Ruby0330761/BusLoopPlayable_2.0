import { FileBlob, SpreadsheetFile } from '@oai/artifact-tool';
import fs from 'node:fs/promises';

const path = 'D:/备份/busloop素材关卡/FixQueueConfigB.xlsx';
const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(path));

const sheets = await workbook.inspect({
  kind: 'sheet',
  include: 'id,name',
  maxChars: 8000,
});
console.log('SHEETS');
console.log(sheets.ndjson);

const summary = await workbook.inspect({
  kind: 'workbook,sheet,table,region',
  maxChars: 16000,
  tableMaxRows: 12,
  tableMaxCols: 14,
  tableMaxCellChars: 120,
});
console.log('SUMMARY');
console.log(summary.ndjson);

const sheet = workbook.worksheets.getItem('Sheet1');
const values = sheet.getRange('A1:C16').values;
const levelRow = values.find((row) => Number(row[0]) === 12);
if (!levelRow) throw new Error('Level 12 row not found');

function parseQueue(value) {
  return String(value ?? '')
    .split('|')
    .filter((item) => item !== '')
    .map((item) => Number(item));
}

function counts(queue) {
  return Object.fromEntries(
    [...new Set(queue)].sort((a, b) => a - b).map((color) => [color, queue.filter((item) => item === color).length]),
  );
}

const left = parseQueue(levelRow[1]);
const right = parseQueue(levelRow[2]);
console.log('LEVEL12');
console.log(JSON.stringify({
  levelId: levelRow[0],
  queueL1: { length: left.length, counts: counts(left), invalid: left.filter((value) => !Number.isInteger(value)).length },
  queueR1: { length: right.length, counts: counts(right), invalid: right.filter((value) => !Number.isInteger(value)).length },
  total: left.length + right.length,
}, null, 2));

const assetPath = 'D:/UnityProjects/BusLoop/Assets/BusJam/Game/Bundleables/Level_Escape_B/level12.asset';
const asset = await fs.readFile(assetPath, 'utf8');
const vehicleStart = asset.indexOf('\n  vehicles:');
const vehicleEnd = asset.indexOf('\n  containers:', vehicleStart);
const vehicleBlocks = asset.slice(vehicleStart, vehicleEnd).split(/\n  - id: /).slice(1);
const vehicleCounts = {};
for (const block of vehicleBlocks) {
  const seats = Number(block.match(/\n    seats: (\d+)/)?.[1]);
  const color = Number(block.match(/\n    colorIndex: (\d+)/)?.[1]);
  vehicleCounts[color] = (vehicleCounts[color] ?? 0) + seats;
}
const assetQueueBlock = asset.slice(asset.indexOf('\n  fixedPassengerSequence:'));
const assetQueueCounts = {};
const assetQueueLengths = {};
let currentQueueId = null;
for (const line of assetQueueBlock.split(/\r?\n/)) {
  const queueMatch = line.match(/^  - queueId: (\d+)/);
  if (queueMatch) {
    currentQueueId = Number(queueMatch[1]);
    assetQueueLengths[currentQueueId] = (assetQueueLengths[currentQueueId] ?? 0) + 1;
    continue;
  }
  const colorMatch = line.match(/^    colorIndex: (-?\d+)/);
  if (colorMatch && currentQueueId != null) {
    const color = Number(colorMatch[1]);
    assetQueueCounts[color] = (assetQueueCounts[color] ?? 0) + 1;
  }
}
const workbookCounts = counts([...left, ...right]);
const colors = [...new Set([...Object.keys(vehicleCounts), ...Object.keys(workbookCounts)])]
  .map(Number)
  .sort((a, b) => a - b);
const comparison = colors.map((color) => ({
  color,
  vehicleSeats: vehicleCounts[color] ?? 0,
  workbookPassengers: workbookCounts[color] ?? 0,
  assetPassengers: assetQueueCounts[color] ?? 0,
  workbookMatchesVehicles: (vehicleCounts[color] ?? 0) === (workbookCounts[color] ?? 0),
}));
console.log('MATCH');
console.log(JSON.stringify({
  assetVehicles: vehicleBlocks.length,
  assetVehicleSeats: Object.values(vehicleCounts).reduce((sum, value) => sum + value, 0),
  assetQueueTotal: Object.values(assetQueueCounts).reduce((sum, value) => sum + value, 0),
  assetQueueLengths,
  comparison,
  allColorsMatch: comparison.every((row) => row.workbookMatchesVehicles),
}, null, 2));
