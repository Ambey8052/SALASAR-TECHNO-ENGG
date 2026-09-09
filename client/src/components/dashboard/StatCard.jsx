import { motion } from 'framer-motion';

// `wrapLabel` opts a card out of the single-line truncation the others use. Labels are set in
// uppercase at 12px, so a long one ("Completed production till final coat") loses its most
// important words to the ellipsis — the cards sit in a stretch row, so letting that one wrap
// simply makes every card in the row equally taller.
export function StatCard({ label, value, unit, accent = 'var(--series-1)', hint, compact = false, wrapLabel = false }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: 'easeOut' }}
      className={`relative flex-1 overflow-hidden rounded-2xl border ${compact ? 'min-w-[150px] p-3' : 'min-w-0 p-5'}`}
      style={{ background: 'var(--surface-1)' }}
    >
      <div className="absolute inset-x-0 top-0 h-1" style={{ background: accent }} />
      <div
        className={`text-xs font-medium uppercase tracking-wide ${wrapLabel ? 'text-balance' : 'truncate'}`}
        style={{ color: 'var(--text-muted)' }}
        title={label}
      >
        {label}
      </div>
      <div className={`flex items-baseline gap-1.5 ${compact ? 'mt-1' : 'mt-2'}`}>
        <span className={`font-semibold tabular-nums ${compact ? 'text-xl' : 'text-3xl'}`} style={{ color: 'var(--text-primary)' }}>
          {value}
        </span>
        {unit && (
          <span className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
            {unit}
          </span>
        )}
      </div>
      {hint && !compact && (
        <div className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>
          {hint}
        </div>
      )}
    </motion.div>
  );
}
