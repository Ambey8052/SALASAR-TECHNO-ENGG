const BUSINESS_UNIT_PATTERNS = [
  { pattern: /\bhsd\b/i, businessUnit: 'HSD' },
  { pattern: /\bb\.?u\.?\b/i, businessUnit: 'BU' },
];

const CATEGORY_PATTERNS = [
  { pattern: /fab/i, category: 'fabrication' },
  { pattern: /paint/i, category: 'painting' },
  { pattern: /civil/i, category: 'civil' },
  { pattern: /shed/i, category: 'shed' },
  { pattern: /office/i, category: 'office' },
];

const SHIFT_PATTERNS = [
  { pattern: /day/i, shift: 'day' },
  { pattern: /night/i, shift: 'night' },
  { pattern: /12[:.]?30|mid/i, shift: 'mid' },
];

export function normalizeManpowerLabel(rawLabel) {
  if (typeof rawLabel !== 'string' || !rawLabel.trim()) return null;

  const businessUnit = BUSINESS_UNIT_PATTERNS.find((p) => p.pattern.test(rawLabel))?.businessUnit;
  const category = CATEGORY_PATTERNS.find((p) => p.pattern.test(rawLabel))?.category;

  if (!businessUnit || !category) return null;
  return { businessUnit, category };
}

export function detectShiftLabel(rawLabel) {
  if (typeof rawLabel === 'number') {
    // The "12.30" shift sub-header is stored as a raw Excel time-of-day serial (a fraction
    // of a day) rather than text — 12:30 PM = 12.5 / 24 ≈ 0.5208333.
    if (rawLabel > 0 && rawLabel < 1 && Math.abs(rawLabel * 24 - 12.5) < 0.02) return 'mid';
    return null;
  }
  if (typeof rawLabel !== 'string' || !rawLabel.trim()) return null;
  return SHIFT_PATTERNS.find((p) => p.pattern.test(rawLabel))?.shift ?? null;
}
