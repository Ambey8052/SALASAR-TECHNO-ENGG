import { NavLink } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useAuth } from '../../context/AuthContext';

const links = [
  { to: '/', label: 'Dashboard' },
  { to: '/settings', label: 'Settings', adminOnly: true },
];

export function Navbar() {
  const { user, logout } = useAuth();

  return (
    <header
      className="sticky top-0 z-20 flex items-center justify-between border-b px-6 py-3 backdrop-blur"
      style={{ background: 'color-mix(in srgb, var(--surface-1) 85%, transparent)' }}
    >
      <div className="flex items-center gap-8">
        <div className="flex items-center gap-2">
          <div
            className="flex h-8 w-8 items-center justify-center rounded-lg text-sm font-bold text-white"
            style={{ background: 'var(--series-1)' }}
          >
            S
          </div>
          <div className="leading-tight">
            <div className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
              Salasar HSD
            </div>
            <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
              Plant Dashboard
            </div>
          </div>
        </div>

        <nav className="flex items-center gap-1">
          {links
            .filter((l) => !l.adminOnly || user?.role === 'admin')
            .map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                end={link.to === '/'}
                className={({ isActive }) =>
                  `relative rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                    isActive ? '' : 'hover:opacity-80'
                  }`
                }
                style={({ isActive }) => ({
                  color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
                  background: isActive ? 'var(--surface-2)' : 'transparent',
                })}
              >
                {link.label}
              </NavLink>
            ))}
        </nav>
      </div>

      {user && (
        <div className="flex items-center gap-3">
          <div className="text-right leading-tight">
            <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
              {user.name}
            </div>
            <div className="text-xs capitalize" style={{ color: 'var(--text-muted)' }}>
              {user.role}
            </div>
          </div>
          {user.picture ? (
            <img src={user.picture} alt={user.name} className="h-8 w-8 rounded-full" referrerPolicy="no-referrer" />
          ) : (
            <div className="h-8 w-8 rounded-full" style={{ background: 'var(--series-3)' }} />
          )}
          <motion.button
            whileTap={{ scale: 0.95 }}
            onClick={logout}
            className="rounded-md border px-3 py-1.5 text-xs font-medium"
            style={{ color: 'var(--text-secondary)' }}
          >
            Sign out
          </motion.button>
        </div>
      )}
    </header>
  );
}
