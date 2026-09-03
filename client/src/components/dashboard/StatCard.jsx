import { motion } from 'framer-motion';

export function StatCard({ label, value, unit, accent = 'var(--series-1)', hint, compact = false }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: 'easeOut' }}
      className={`relative flex-1 overflow-hidden rounded-2xl border ${compact ? 'min-w-[150px] p-3' : 'min-w-0 p-5'}`}
      style={{ background: 'var(--surface-1)' }}
    >
      <div className="absolute inset-x-0 top-0 h-1" style={{ background: accent }} />
      <div className="truncate text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
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
