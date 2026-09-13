// Client names as the live workbook writes them — "Reliance (Bridge 1B)", "MHI PROJECT", "ADANI",
// or just "RIL" / "MHI" in a progress block's own header. Shared by the dispatch parser (project
// rows) and the production parser (each block's client cell), so both recognise a client the
// same way.
const CLIENT_PATTERNS = [
  { pattern: /reliance|\bril\b/i, client: 'RIL' },
  { pattern: /\bmhi\b/i, client: 'L&T MHI' },
  { pattern: /adani/i, client: 'Adani' },
  { pattern: /afcons/i, client: 'AFCONS' },
  { pattern: /amns/i, client: 'AMNS' },
];

export function normalizeClient(label) {
  if (typeof label !== 'string') return null;
  return CLIENT_PATTERNS.find((p) => p.pattern.test(label))?.client ?? null;
}
