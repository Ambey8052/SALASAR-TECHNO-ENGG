import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { fetchHsdInsights } from '../../lib/api';

const SEVERITY_COLOR = {
  good: 'var(--status-good)',
  info: 'var(--series-1)',
  warning: 'var(--status-warning)',
  critical: 'var(--status-critical)',
};

function sameRange(a, b) {
  if (!a || !b) return false;
  return a.from === b.from && a.to === b.to && (a.businessUnit || '') === (b.businessUnit || '');
}

export function InsightsPanel({ params }) {
  const [state, setState] = useState('idle'); // idle | loading | error | done
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [generatedFor, setGeneratedFor] = useState(null);
  const hasAutoFetched = useRef(false);
  const paramsRef = useRef(params);
  paramsRef.current = params;

  async function generate() {
    const requestParams = paramsRef.current;
    setState('loading');
    setError(null);
    try {
      const result = await fetchHsdInsights(requestParams);
      setData(result);
      setGeneratedFor(requestParams);
      setState('done');
    } catch (err) {
      const serverMessage = err?.response?.data?.error;
      setError(
        serverMessage?.includes('quota')
          ? 'The AI insights quota for today has been used up. Try again later or after the quota resets.'
          : serverMessage || 'Could not generate insights. Please try again.',
      );
      setState('error');
    }
  }

  useEffect(() => {
    if (hasAutoFetched.current) return;
    hasAutoFetched.current = true;
    generate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isStale = state === 'done' && !sameRange(generatedFor, params);

  return (
    <div className="rounded-2xl border p-5" style={{ background: 'var(--surface-1)' }}>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
            AI insights
          </div>
          <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Generated automatically when you open the dashboard
          </div>
        </div>
        <motion.button
          whileTap={{ scale: 0.95 }}
          onClick={generate}
          disabled={state === 'loading'}
          className="rounded-full border px-3 py-1.5 text-xs font-medium disabled:opacity-50"
          style={{ color: 'var(--text-primary)', background: 'var(--surface-2)' }}
        >
          {state === 'loading' ? 'Analyzing…' : 'Regenerate'}
        </motion.button>
      </div>

      <AnimatePresence mode="wait">
        {state === 'idle' && (
          <motion.div
            key="idle"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex h-24 items-center justify-center text-sm"
            style={{ color: 'var(--text-muted)' }}
          >
            Preparing analysis…
          </motion.div>
        )}

        {state === 'loading' && (
          <motion.div
            key="loading"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex h-24 items-center justify-center text-sm"
            style={{ color: 'var(--text-muted)' }}
          >
            Analyzing production, dispatch, and manpower data… this can take up to 30 seconds.
          </motion.div>
        )}

        {state === 'error' && (
          <motion.div
            key="error"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="rounded-lg border px-3 py-2 text-sm"
            style={{ color: 'var(--status-critical)' }}
          >
            {error}
          </motion.div>
        )}

        {state === 'done' && data && (
          <motion.div key="done" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
            {isStale && (
              <div
                className="rounded-lg border px-3 py-2 text-xs"
                style={{ color: 'var(--status-warning)' }}
              >
                This analysis is for a previously selected range. Click "Regenerate" to analyze the current filter.
              </div>
            )}

            <div>
              <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                {data.headline}
              </p>
              <p className="mt-1.5 text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                {data.narrative}
              </p>
            </div>

            <ul className="space-y-2">
              {data.insights.map((insight, i) => (
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

            {data.recommendations?.length > 0 && (
              <div>
                <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
                  Recommendations
                </div>
                <ul className="list-inside list-disc space-y-1 text-sm" style={{ color: 'var(--text-secondary)' }}>
                  {data.recommendations.map((rec, i) => (
                    <li key={i}>{rec}</li>
                  ))}
                </ul>
              </div>
            )}

            {data.cached && (
              <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                Showing a cached analysis from the last 10 minutes for this range.
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
