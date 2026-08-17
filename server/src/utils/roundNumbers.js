const DECIMALS = 3;
const FACTOR = 10 ** DECIMALS;

export function round3(value) {
  return Math.round((value + Number.EPSILON) * FACTOR) / FACTOR;
}

export function roundDeep(value) {
  if (typeof value === 'number') return round3(value);
  if (Array.isArray(value)) return value.map(roundDeep);
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, roundDeep(v)]));
  }
  return value;
}
