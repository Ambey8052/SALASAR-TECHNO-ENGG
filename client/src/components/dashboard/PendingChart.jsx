import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';

function ChartCard({ title, subtitle, children }) {
  return (
    <div className="rounded-2xl border p-5" style={{ background: 'var(--surface-1)' }}>
      <div className="mb-4">
        <div className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
          {title}
        </div>
        {subtitle && (
          <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {subtitle}
          </div>
        )}
      </div>
      {children}
    </div>
  );
}

function PendingTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const dispatched = payload.find((p) => p.dataKey === 'dispatched')?.value ?? 0;
  const pending = payload.find((p) => p.dataKey === 'pending')?.value ?? 0;
  return (
    <div className="rounded-lg border px-3 py-2 text-xs shadow-md" style={{ background: 'var(--surface-2)', color: 'var(--text-primary)' }}>
      <div className="mb-1 font-semibold">{label}</div>
      <div>Dispatched: {dispatched}</div>
      <div>Pending: {pending}</div>
    </div>
  );
}

export function PendingByClientChart({ pending }) {
  const data = pending.map((p) => ({ client: p.client, dispatched: p.dispatched, pending: p.pending }));

  return (
    <ChartCard title="Finished vs dispatched, by client" subtitle="Final-coat MT done so far, split into dispatched and still pending">
      {data.length === 0 ? (
        <div className="flex h-[220px] items-center justify-center text-sm" style={{ color: 'var(--text-muted)' }}>
          No completions recorded yet
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={data} layout="vertical" margin={{ top: 4, right: 24, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="var(--gridline)" horizontal={false} />
            <XAxis type="number" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} axisLine={false} tickLine={false} />
            <YAxis type="category" dataKey="client" tick={{ fill: 'var(--text-secondary)', fontSize: 12 }} axisLine={false} tickLine={false} width={80} />
            <Tooltip cursor={{ fill: 'var(--surface-2)' }} content={<PendingTooltip />} />
            <Legend wrapperStyle={{ fontSize: 12 }} formatter={(v) => (v === 'dispatched' ? 'Dispatched' : 'Pending')} />
            <Bar dataKey="dispatched" stackId="a" fill="var(--series-2)" radius={[0, 0, 0, 0]} maxBarSize={22} />
            <Bar dataKey="pending" stackId="a" fill="var(--status-warning)" radius={[0, 4, 4, 0]} maxBarSize={22} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </ChartCard>
  );
}
