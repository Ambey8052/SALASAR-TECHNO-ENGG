import { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

export function ChartModal({ title, subtitle, isOpen, onClose, children }) {
  useEffect(() => {
    if (!isOpen) return undefined;
    function onKeyDown(e) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKeyDown);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = prevOverflow;
    };
  }, [isOpen, onClose]);

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-8"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          onClick={onClose}
        >
          <div className="absolute inset-0" style={{ background: 'rgba(0,0,0,0.55)' }} />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={title}
            className="relative z-10 flex h-full w-full max-w-6xl flex-col overflow-hidden rounded-2xl border sm:h-auto sm:max-h-[85vh]"
            style={{ background: 'var(--surface-1)' }}
            initial={{ opacity: 0, scale: 0.97, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 10 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex shrink-0 items-start justify-between gap-3 border-b p-4 sm:p-5" style={{ borderColor: 'var(--baseline)' }}>
              <div>
                <div className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
                  {title}
                </div>
                {subtitle && (
                  <div className="mt-0.5 text-xs" style={{ color: 'var(--text-muted)' }}>
                    {subtitle}
                  </div>
                )}
              </div>
              <button
                onClick={onClose}
                aria-label="Close"
                className="shrink-0 rounded-full px-2.5 py-1.5 text-sm leading-none transition-colors"
                style={{ color: 'var(--text-secondary)', background: 'var(--surface-2)' }}
              >
                ✕
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-4 sm:p-5">{children}</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function ExpandHint() {
  return (
    <div
      className="pointer-events-none absolute right-4 top-4 flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-medium opacity-0 transition-opacity group-hover:opacity-100"
      style={{ background: 'var(--surface-2)', color: 'var(--text-muted)' }}
    >
      <span aria-hidden="true">⤢</span> Expand
    </div>
  );
}
