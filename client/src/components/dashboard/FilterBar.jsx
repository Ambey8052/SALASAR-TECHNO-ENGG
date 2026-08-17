import { format, subDays, startOfMonth } from 'date-fns';

const PRESETS = [
  { label: 'Today', getRange: () => ({ from: new Date(), to: new Date() }) },
  { label: 'Last 7 days', getRange: () => ({ from: subDays(new Date(), 6), to: new Date() }) },
  { label: 'Last 30 days', getRange: () => ({ from: subDays(new Date(), 29), to: new Date() }) },
  { label: 'Month to date', getRange: () => ({ from: startOfMonth(new Date()), to: new Date() }) },
];

export function FilterBar({ activePreset, onPresetChange, businessUnit, onBusinessUnitChange }) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border p-1.5" style={{ background: 'var(--surface-1)' }}>
      <div className="flex flex-wrap gap-1">
        {PRESETS.map((preset) => (
          <button
            key={preset.label}
            onClick={() => onPresetChange(preset.label, preset.getRange())}
            className="rounded-lg px-3 py-1.5 text-sm font-medium transition-colors"
            style={{
              background: activePreset === preset.label ? 'var(--series-1)' : 'transparent',
              color: activePreset === preset.label ? '#ffffff' : 'var(--text-secondary)',
            }}
          >
            {preset.label}
          </button>
        ))}
      </div>

      <div className="ml-auto flex items-center gap-2 px-1.5">
        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
          Business unit
        </span>
        <select
          value={businessUnit}
          onChange={(e) => onBusinessUnitChange(e.target.value)}
          className="rounded-lg border px-2 py-1.5 text-sm"
          style={{ background: 'var(--surface-2)', color: 'var(--text-primary)' }}
        >
          <option value="">All</option>
          <option value="HSD">HSD</option>
          <option value="BU">B.U</option>
        </select>
      </div>
    </div>
  );
}

export function formatRangeLabel(range) {
  if (!range?.from || !range?.to) return '';
  return `${format(range.from, 'd MMM')} – ${format(range.to, 'd MMM yyyy')}`;
}

export { PRESETS };
