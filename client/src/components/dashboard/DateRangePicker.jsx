import { useEffect, useRef, useState } from 'react';
import { DayPicker } from 'react-day-picker';
import { format } from 'date-fns';
import 'react-day-picker/style.css';

function useIsNarrowViewport(breakpointPx = 640) {
  const [isNarrow, setIsNarrow] = useState(
    () => typeof window !== 'undefined' && window.innerWidth < breakpointPx,
  );

  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${breakpointPx - 1}px)`);
    const handler = (e) => setIsNarrow(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, [breakpointPx]);

  return isNarrow;
}

export function DateRangePicker({ isActive, value, onApply }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const containerRef = useRef(null);
  const isNarrow = useIsNarrowViewport();

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  function toggleOpen() {
    if (!open) {
      // Sync draft to the live value synchronously (batched with setOpen) so the
      // calendar mounts already showing the right month — an effect-based sync
      // would run one render too late, after DayPicker has already mounted with
      // stale defaultMonth from the previous time it was open.
      setDraft(value);
    }
    setOpen((o) => !o);
  }

  function handleSelect(range) {
    setDraft(range);
    if (range?.from && range?.to) {
      onApply({ from: range.from, to: range.to });
      setOpen(false);
    }
  }

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={toggleOpen}
        className="rounded-lg px-3 py-1.5 text-sm font-medium transition-colors"
        style={{
          background: isActive ? 'var(--series-1)' : 'transparent',
          color: isActive ? '#ffffff' : 'var(--text-secondary)',
        }}
      >
        {isActive && value?.from && value?.to
          ? `${format(value.from, 'd MMM')} – ${format(value.to, 'd MMM')}`
          : 'Custom range'}
      </button>

      {open && (
        <div
          className="salasar-daypicker absolute left-0 top-full z-30 mt-2 max-w-[95vw] overflow-x-auto rounded-xl border p-3 shadow-lg"
          style={{ background: 'var(--surface-1)' }}
        >
          <DayPicker
            key={isNarrow ? 'narrow' : 'wide'}
            mode="range"
            numberOfMonths={isNarrow ? 1 : 2}
            selected={draft}
            onSelect={handleSelect}
            defaultMonth={draft?.from}
            disabled={{ after: new Date() }}
          />
          <div className="mt-1 flex items-center justify-between border-t px-1 pt-2 text-xs" style={{ color: 'var(--text-muted)' }}>
            <span>
              {draft?.from ? format(draft.from, 'd MMM yyyy') : 'Start date'}
              {' – '}
              {draft?.to ? format(draft.to, 'd MMM yyyy') : 'End date'}
            </span>
            <button onClick={() => setDraft(undefined)} className="underline">
              Clear
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
