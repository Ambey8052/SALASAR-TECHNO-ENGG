import { format, subDays, startOfMonth } from 'date-fns';
import { DateRangePicker } from './DateRangePicker';

const PRESETS = [
  { label: 'Today', getRange: () => ({ from: new Date(), to: new Date() }) },
  { label: 'Last 7 days', getRange: () => ({ from: subDays(new Date(), 6), to: new Date() }) },
  { label: 'Last 30 days', getRange: () => ({ from: subDays(new Date(), 29), to: new Date() }) },
  { label: 'Month to date', getRange: () => ({ from: startOfMonth(new Date()), to: new Date() }) },
];

const UNITS = [
  { value: 'HSD', label: 'HSD' },
  { value: 'BU', label: 'Bhilai' },
];

export function FilterBar({ activePreset, onPresetChange, range, businessUnit, onBusinessUnitChange }) {
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
        <DateRangePicker
          isActive={activePreset === 'Custom'}
          value={range}
          onApply={(r) => onPresetChange('Custom', r)}
        />
      </div>

      <div className="ml-auto flex items-center gap-1 rounded-lg p-0.5" style={{ background: 'var(--surface-2)' }}>
        {UNITS.map((unit) => (
          <button
            key={unit.value}
            onClick={() => onBusinessUnitChange(unit.value)}
            className="rounded-md px-3 py-1.5 text-sm font-medium transition-colors"
            style={{
              background: businessUnit === unit.value ? 'var(--series-2)' : 'transparent',
              color: businessUnit === unit.value ? '#ffffff' : 'var(--text-secondary)',
            }}
          >
            {unit.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function formatRangeLabel(range) {
  if (!range?.from || !range?.to) return '';
  return `${format(range.from, 'd MMM')} – ${format(range.to, 'd MMM yyyy')}`;
}

export { PRESETS };
