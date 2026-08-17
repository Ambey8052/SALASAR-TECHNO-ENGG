import { motion } from 'framer-motion';

export function StatCard({ label, value, unit, accent = 'var(--series-1)', hint }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: 'easeOut' }}
      className="relative overflow-hidden rounded-2xl border p-5"
      style={{ background: 'var(--surface-1)' }}
    >
      <div className="absolute inset-x-0 top-0 h-1" style={{ background: accent }} />
      <div className="text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
        {label}
      </div>
      <div className="mt-2 flex items-baseline gap-1.5">
        <span className="text-3xl font-semibold tabular-nums" style={{ color: 'var(--text-primary)' }}>
          {value}
        </span>
        {unit && (
          <span className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
            {unit}
          </span>
        )}
      </div>
      {hint && (
        <div className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>
          {hint}
        </div>
      )}
    </motion.div>
  );
}
