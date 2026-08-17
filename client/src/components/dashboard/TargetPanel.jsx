import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { saveTarget, deleteTarget } from '../../lib/api';

const CLIENT_COLORS = { Adani: 'var(--series-2)', 'L&T MHI': 'var(--series-3)', RIL: 'var(--series-4)' };

function ProgressBar({ pct, color }) {
  return (
    <div className="h-2 w-full overflow-hidden rounded-full" style={{ background: 'var(--surface-2)' }}>
      <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(Math.max(pct, 0), 100)}%`, background: color }} />
    </div>
  );
}

export function TargetPanel({ targets, knownClients, isAdmin }) {
  const queryClient = useQueryClient();
  const [editingClient, setEditingClient] = useState('');
  const [qtyInput, setQtyInput] = useState('');

  const saveMutation = useMutation({
    mutationFn: ({ client, qty }) => saveTarget(client, qty),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hsd-summary'] });
      setEditingClient('');
      setQtyInput('');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (client) => deleteTarget(client),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['hsd-summary'] }),
  });

  const targetedClients = new Set(targets.map((t) => t.client));
  const unsetClients = knownClients.filter((c) => !targetedClients.has(c));
  const dropdownOptions = [...unsetClients, ...targets.map((t) => t.client)];

  return (
    <div className="rounded-2xl border p-5" style={{ background: 'var(--surface-1)' }}>
      <div className="mb-4">
        <div className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
          Target vs completed, by client
        </div>
        <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
          Manually set target quantities per client
        </div>
      </div>

      {targets.length === 0 && (
        <div className="mb-4 text-sm" style={{ color: 'var(--text-muted)' }}>
          No targets set yet.
        </div>
      )}

      <div className="space-y-4">
        {targets.map((t) => {
          const pct = t.target > 0 ? (t.completed / t.target) * 100 : 0;
          return (
            <div key={t.client}>
              <div className="mb-1 flex items-center justify-between text-sm">
                <span style={{ color: 'var(--text-primary)' }}>{t.client}</span>
                <span style={{ color: 'var(--text-muted)' }}>
                  {t.completed} / {t.target} MT ({Math.round(pct)}%)
                </span>
              </div>
              <ProgressBar pct={pct} color={CLIENT_COLORS[t.client] || 'var(--series-1)'} />
              {isAdmin && (
                <div className="mt-1 flex gap-3 text-xs">
                  <button
                    onClick={() => {
                      setEditingClient(t.client);
                      setQtyInput(String(t.target));
                    }}
                    className="underline"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    Edit
                  </button>
                  <button onClick={() => deleteMutation.mutate(t.client)} className="underline" style={{ color: 'var(--status-critical)' }}>
                    Remove
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {isAdmin && (
        <div className="mt-5 border-t pt-4" style={{ borderColor: 'var(--baseline)' }}>
          <div className="mb-2 text-xs font-medium" style={{ color: 'var(--text-muted)' }}>
            {editingClient ? `Set target for ${editingClient}` : 'Set a target'}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {!editingClient && (
              <select
                value=""
                onChange={(e) => setEditingClient(e.target.value)}
                className="rounded-lg border px-2 py-1.5 text-sm"
                style={{ background: 'var(--surface-2)', color: 'var(--text-primary)' }}
              >
                <option value="" disabled>
                  Choose client…
                </option>
                {dropdownOptions.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            )}
            {editingClient && (
              <>
                <span className="text-sm" style={{ color: 'var(--text-primary)' }}>
                  {editingClient}
                </span>
                <input
                  type="number"
                  min="0"
                  value={qtyInput}
                  onChange={(e) => setQtyInput(e.target.value)}
                  placeholder="Target qty (MT)"
                  className="w-32 rounded-lg border px-2 py-1.5 text-sm"
                  style={{ background: 'var(--surface-2)', color: 'var(--text-primary)' }}
                />
                <button
                  onClick={() => {
                    const qty = Number(qtyInput);
                    if (editingClient && qty >= 0) saveMutation.mutate({ client: editingClient, qty });
                  }}
                  disabled={saveMutation.isPending || !qtyInput}
                  className="rounded-lg px-3 py-1.5 text-sm font-medium disabled:opacity-50"
                  style={{ background: 'var(--series-1)', color: '#ffffff' }}
                >
                  Save
                </button>
                <button
                  onClick={() => {
                    setEditingClient('');
                    setQtyInput('');
                  }}
                  className="text-sm underline"
                  style={{ color: 'var(--text-muted)' }}
                >
                  Cancel
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
