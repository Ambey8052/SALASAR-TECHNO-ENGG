import { isPlausibleDateSerial } from '../../utils/sheetDate.js';

export function findHeaderRowIndexes(rows, minDateCells = 3) {
  const headerRowIndexes = [];
  rows.forEach((row, idx) => {
    const dateCellCount = row.filter((cell) => isPlausibleDateSerial(cell)).length;
    if (dateCellCount >= minDateCells) headerRowIndexes.push(idx);
  });
  return headerRowIndexes;
}
