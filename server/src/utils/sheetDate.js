const SHEETS_EPOCH = Date.UTC(1899, 11, 30);
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const MIN_PLAUSIBLE_SERIAL = 40000;
const MAX_PLAUSIBLE_SERIAL = 60000;

export function isPlausibleDateSerial(value) {
  return typeof value === 'number' && value >= MIN_PLAUSIBLE_SERIAL && value <= MAX_PLAUSIBLE_SERIAL;
}

export function serialToDate(serial) {
  return new Date(SHEETS_EPOCH + Math.round(serial) * MS_PER_DAY);
}
