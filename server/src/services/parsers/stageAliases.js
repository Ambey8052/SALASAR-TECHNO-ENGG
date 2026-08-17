const STAGE_PATTERNS = [
  { pattern: /cut/i, stage: 'cutting' },
  { pattern: /fit/i, stage: 'fitUp' },
  { pattern: /weld/i, stage: 'welding' },
  { pattern: /visual/i, stage: 'visual' },
  { pattern: /blast/i, stage: 'blasting' },
  { pattern: /final\s*coat|paint/i, stage: 'finalCoat' },
];

export function normalizeStageLabel(rawLabel) {
  if (typeof rawLabel !== 'string' || !rawLabel.trim()) return null;
  return STAGE_PATTERNS.find((p) => p.pattern.test(rawLabel))?.stage ?? null;
}
