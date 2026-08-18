import { useQuery } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { fetchHsdInsights } from '../../lib/api';

const SEVERITY_COLOR = {
  good: 'var(--status-good)',
  info: 'var(--series-1)',
  warning: 'var(--status-warning)',
  critical: 'var(--status-critical)',
};

export function InsightsPanel({ params }) {
  const insightsQuery = useQuery({
    queryKey: ['hsd-insights', params],
    queryFn: () => fetchHsdInsights(params),
    // Generated once and held for the rest of the session, same as the rest of the
    // dashboard — no silent re-generation while someone is looking at it.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    retry: false,
  });

  // Quietly say nothing rather than surface a raw quota/error message to a manager.
  if (insightsQuery.isError) return null;

  return (
    <div className="rounded-2xl border p-5" style={{ background: 'var(--surface-1)' }}>
      <div className="mb-4 text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
        AI insights
      </div>

      <AnimatePresence mode="wait">
        {insightsQuery.isLoading && (
          <motion.div
            key="loading"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex h-24 items-center justify-center text-sm"
            style={{ color: 'var(--text-muted)' }}
          >
            Analyzing production, dispatch, and manpower data…
          </motion.div>
        )}

        {insightsQuery.data && (
          <motion.div key="done" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
            <div>
              <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                {insightsQuery.data.headline}
              </p>
              <p className="mt-1.5 text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                {insightsQuery.data.narrative}
              </p>
            </div>

            <ul className="space-y-2">
              {insightsQuery.data.insights.map((insight, i) => (
                <li key={i} className="flex gap-2.5 rounded-lg border p-3" style={{ background: 'var(--surface-2)' }}>
                  <span
                    className="mt-1 h-2 w-2 shrink-0 rounded-full"
                    style={{ background: SEVERITY_COLOR[insight.severity] || 'var(--text-muted)' }}
                  />
                  <div>
                    <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                      {insight.title}
                    </div>
                    <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                      {insight.detail}
                    </div>
                  </div>
                </li>
              ))}
            </ul>

            {insightsQuery.data.recommendations?.length > 0 && (
              <div>
                <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
                  Recommendations
                </div>
                <ul className="list-inside list-disc space-y-1 text-sm" style={{ color: 'var(--text-secondary)' }}>
                  {insightsQuery.data.recommendations.map((rec, i) => (
                    <li key={i}>{rec}</li>
                  ))}
                </ul>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
