import { FileBlob, SpreadsheetFile } from '@oai/artifact-tool';

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
