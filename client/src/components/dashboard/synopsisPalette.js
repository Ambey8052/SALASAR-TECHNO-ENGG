// Colour and formatting shared by every Dispatch Synopsis chart.
//
// Categories are painted from a FIXED list, never from their position in a sorted result.
// The charts re-sort by tonnage and the month filter changes which categories appear at all,
// so keying colour off the rendered order would repaint the survivors every time the filter
// moved and quietly break the reader's colour-to-category memory.
//
// The order below is also the order the palette itself was validated in (adjacent-pair
// contrast, colour-vision separation and lightness band, in both themes), so stacked
// segments touch in a sequence that stays legible. Reordering these entries invalidates
// that — re-run the palette check before changing them.
export const CATEGORY_ORDER = [
  'HSD',
  'Solar',
  'Transmission Pole',
  'Nepal',
  'Job Work',
  'Ramboll Export',
  'Indus GBM',
  'COW',
];

const CATEGORY_COLORS = Object.fromEntries(
  CATEGORY_ORDER.map((category, i) => [category, `var(--series-${i + 1})`]),
);

const FALLBACK_COLOR = 'var(--text-muted)';

export function categoryColor(category) {
  return CATEGORY_COLORS[category] ?? FALLBACK_COLOR;
}

// Sorts whatever categories the API returned into the fixed order above, so the stack and
// the legend always read the same way. Anything unrecognised sinks to the end rather than
// being dropped — a new department in next month's workbook still shows up.
export function orderCategories(categories) {
  return [...categories].sort((a, b) => {
    const ai = CATEGORY_ORDER.indexOf(a);
    const bi = CATEGORY_ORDER.indexOf(b);
    return (ai === -1 ? CATEGORY_ORDER.length : ai) - (bi === -1 ? CATEGORY_ORDER.length : bi);
  });
}

export const MODE_COLORS = {
  Inhouse: 'var(--series-1)',
  'Job Work': 'var(--series-2)',
  Buyout: 'var(--series-3)',
};

export function modeColor(mode) {
  return MODE_COLORS[mode] ?? FALLBACK_COLOR;
}

// Plan is deliberately a neutral: it is the reference the coloured "actual" is read against,
// not a series competing with it for attention.
export const PLANNED_COLOR = 'var(--text-muted)';
export const ACTUAL_COLOR = 'var(--series-1)';

// Achievement bands. These are status colours, always shipped with the % printed on the bar
// and a legend naming each band, so the state is never carried by colour alone.
export const ACHIEVEMENT_BANDS = [
  { label: 'Met plan (100%+)', min: 100, color: 'var(--series-3)' },
  { label: 'Close (75–99%)', min: 75, color: 'var(--series-4)' },
  { label: 'Behind (under 75%)', min: 0, color: 'var(--series-8)' },
];

export function achievementColor(pct) {
  if (pct === null || pct === undefined) return FALLBACK_COLOR;
  return ACHIEVEMENT_BANDS.find((band) => pct >= band.min)?.color ?? FALLBACK_COLOR;
}

// A single-hue sequential ramp for the department-by-month grid, mixed against the card
// surface so it holds up in both themes without a second set of values.
export function heatColor(value, max) {
  if (value === null || value === undefined) return 'transparent';
  if (max <= 0) return 'var(--surface-2)';
  // Square-rooted so the many small cells stay distinguishable instead of all washing out
  // against the one or two very large ones.
  const intensity = Math.sqrt(value / max);
  const pct = Math.round(8 + intensity * 84);
  return `color-mix(in srgb, var(--series-1) ${pct}%, var(--surface-2))`;
}

export function heatTextColor(value, max) {
  if (value === null || value === undefined || max <= 0) return 'var(--text-muted)';
  return Math.sqrt(value / max) > 0.55 ? '#ffffff' : 'var(--text-secondary)';
}

const nf = (digits) => new Intl.NumberFormat('en-IN', { minimumFractionDigits: digits, maximumFractionDigits: digits });

export const formatMt = (value) => (typeof value === 'number' ? nf(1).format(value) : '—');
export const formatMtWhole = (value) => (typeof value === 'number' ? nf(0).format(Math.round(value)) : '—');
export const formatPct = (value) => (typeof value === 'number' ? `${nf(1).format(value)}%` : '—');
export const formatCount = (value) => (typeof value === 'number' ? nf(0).format(value) : '—');

// Chart labels: a zero is dropped rather than printed, so a stack of mostly-idle segments
// is not buried under a row of "0"s.
export const barLabel = (value) => (typeof value === 'number' && Math.abs(value) >= 0.05 ? nf(1).format(value) : '');
