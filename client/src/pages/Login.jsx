import { motion } from 'framer-motion';
import { useSearchParams } from 'react-router-dom';
import { API_BASE } from '../lib/api';

const ERROR_MESSAGES = {
  login_failed: 'Login failed. Please try again.',
  missing_code: 'Login was cancelled.',
};

export function Login() {
  const [params] = useSearchParams();
  const error = params.get('error');

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden px-4">
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background: 'radial-gradient(circle at 50% 38%, rgba(220, 31, 43, 0.08), transparent 55%)',
        }}
      />
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: 'easeOut' }}
        className="w-full max-w-sm rounded-2xl border p-8 shadow-sm"
        style={{ background: 'var(--surface-1)' }}
      >
        <div className="mb-6 flex flex-col items-center text-center">
          <img src="/favicon.svg" alt="Salasar" className="mb-4 h-14 w-14" />
          <h1 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
            Salasar HSD Dashboard
          </h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--text-secondary)' }}>
            Real-time production, dispatch &amp; manpower tracking
          </p>
        </div>

        {error && (
          <div
            className="mb-4 rounded-lg border px-3 py-2 text-sm"
            style={{ color: 'var(--status-critical)', borderColor: 'var(--status-critical)' }}
          >
            {ERROR_MESSAGES[error] || 'Something went wrong.'}
          </div>
        )}

        <motion.a
          whileHover={{ scale: 1.01 }}
          whileTap={{ scale: 0.98 }}
          href={`${API_BASE}/api/auth/google`}
          className="flex w-full items-center justify-center gap-3 rounded-lg border px-4 py-2.5 text-sm font-medium shadow-sm"
          style={{ color: 'var(--text-primary)', background: 'var(--surface-2)' }}
        >
          <svg width="18" height="18" viewBox="0 0 48 48">
            <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.9 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.6 6.1 29.6 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.7-.4-3.5z" />
            <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.6 15.9 18.9 13 24 13c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.6 6.1 29.6 4 24 4c-7.5 0-14 4.1-17.4 10.2z" />
            <path fill="#4CAF50" d="M24 44c5.5 0 10.4-1.9 14.3-5.1l-6.6-5.6C29.7 34.9 27 36 24 36c-5.3 0-9.7-3-11.3-7.4l-6.6 5.1C9.8 39.7 16.4 44 24 44z" />
            <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.3-4.3 5.7l6.6 5.6C39.9 37.4 44 31.3 44 24c0-1.3-.1-2.7-.4-3.5z" />
          </svg>
          Sign in with Google
        </motion.a>

        <p className="mt-4 text-center text-xs" style={{ color: 'var(--text-muted)' }}>
          Sign in with any Google account
        </p>
      </motion.div>
    </div>
  );
}
