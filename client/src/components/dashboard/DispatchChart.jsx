import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { format } from 'date-fns';

const CLIENT_COLORS = ['var(--series-2)', 'var(--series-3)', 'var(--series-4)', 'var(--series-5)', 'var(--series-7)'];

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

function DateTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div
      className="rounded-lg border px-3 py-2 text-xs shadow-md"
      style={{ background: 'var(--surface-2)', color: 'var(--text-primary)' }}
    >
      <div style={{ color: 'var(--text-muted)' }}>{format(new Date(label), 'd MMM yyyy')}</div>
      <div className="mt-1 font-semibold">{payload[0].value} MT dispatched</div>
    </div>
  );
}

export function DispatchTrendChart({ trend }) {
  const data = trend.map((t) => ({ date: t.date, total: t.total }));

  return (
    <ChartCard title="Dispatch, day by day" subtitle="Quantity dispatched per day in the selected range">
      {data.length === 0 ? (
        <div className="flex h-[220px] items-center justify-center text-sm" style={{ color: 'var(--text-muted)' }}>
          No dispatches recorded yet in this range
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={data} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
            <CartesianGrid stroke="var(--gridline)" vertical={false} />
            <XAxis
              dataKey="date"
              tickFormatter={(d) => format(new Date(d), 'd MMM')}
              tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
              axisLine={{ stroke: 'var(--baseline)' }}
              tickLine={false}
            />
            <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} axisLine={false} tickLine={false} width={36} />
            <Tooltip cursor={{ fill: 'var(--surface-2)' }} content={<DateTooltip />} />
            <Bar dataKey="total" fill="var(--series-2)" radius={[4, 4, 0, 0]} maxBarSize={28} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </ChartCard>
  );
}

export function DispatchClientChart({ byClient }) {
  const data = byClient.map((c) => ({ label: c.client, total: c.total }));

  return (
    <ChartCard title="Dispatched by client" subtitle="Quantity dispatched in the selected range">
      {data.length === 0 ? (
        <div className="flex h-[220px] items-center justify-center text-sm" style={{ color: 'var(--text-muted)' }}>
          No dispatches recorded yet in this range
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={data} layout="vertical" margin={{ top: 4, right: 24, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="var(--gridline)" horizontal={false} />
            <XAxis type="number" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} axisLine={false} tickLine={false} />
            <YAxis type="category" dataKey="label" tick={{ fill: 'var(--text-secondary)', fontSize: 12 }} axisLine={false} tickLine={false} width={80} />
            <Tooltip
              cursor={{ fill: 'var(--surface-2)' }}
              content={({ active, payload }) =>
                active && payload?.length ? (
                  <div className="rounded-lg border px-3 py-2 text-xs shadow-md" style={{ background: 'var(--surface-2)', color: 'var(--text-primary)' }}>
                    {payload[0].payload.label}: <strong>{payload[0].value}</strong> MT
                  </div>
                ) : null
              }
            />
            <Bar dataKey="total" radius={[0, 4, 4, 0]} maxBarSize={22}>
              {data.map((d, i) => (
                <Cell key={d.label} fill={CLIENT_COLORS[i % CLIENT_COLORS.length]} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </ChartCard>
  );
}
