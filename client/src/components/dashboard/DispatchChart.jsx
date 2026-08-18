import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell, LabelList } from 'recharts';
import { format } from 'date-fns';

const CLIENT_COLORS = ['var(--series-2)', 'var(--series-3)', 'var(--series-4)', 'var(--series-5)', 'var(--series-7)'];
const OTHER_COLOR = 'var(--text-muted)';
const fmt = (v) => (typeof v === 'number' ? Math.round(v * 10) / 10 : v);
const labelStyle = { fill: 'var(--text-secondary)', fontSize: 10 };
const segmentFmt = (v) => (v ? Math.round(v * 10) / 10 : '');
const segmentLabelStyle = { fill: '#ffffff', fontSize: 9, fontWeight: 600 };
const insideLabelStyle = { fill: '#ffffff', fontSize: 11, fontWeight: 600 };

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

function ClientDateTooltip({ active, payload, label, clientKeys }) {
  if (!active || !payload?.length) return null;
  const total = clientKeys.reduce((sum, key) => sum + (payload[0]?.payload[key] || 0), 0);
  return (
    <div
      className="rounded-lg border px-3 py-2 text-xs shadow-md"
      style={{ background: 'var(--surface-2)', color: 'var(--text-primary)' }}
    >
      <div className="mb-1" style={{ color: 'var(--text-muted)' }}>{format(new Date(label), 'd MMM yyyy')}</div>
      {clientKeys.map((key) => {
        const value = payload[0]?.payload[key];
        if (!value) return null;
        return (
          <div key={key}>
            {key}: <strong>{value}</strong> MT
          </div>
        );
      })}
      <div className="mt-1 border-t pt-1 font-semibold">Total: {Math.round(total * 1000) / 1000} MT</div>
    </div>
  );
}

export function DispatchTrendChart({ trendByClient, byClient }) {
  const hasOther = trendByClient.some((t) => 'Other' in t);
  const clientKeys = [...byClient.map((c) => c.client), ...(hasOther ? ['Other'] : [])];
  const data = trendByClient.map((t) => ({
    ...t,
    date: t.date,
    __total: clientKeys.reduce((sum, key) => sum + (t[key] || 0), 0),
  }));
  const colorFor = (i, key) => (key === 'Other' ? OTHER_COLOR : CLIENT_COLORS[i % CLIENT_COLORS.length]);

  return (
    <ChartCard title="Dispatch, day by day" subtitle="Quantity dispatched per day in the selected range, by client">
      {data.length === 0 ? (
        <div className="flex h-[220px] items-center justify-center text-sm" style={{ color: 'var(--text-muted)' }}>
          No dispatches recorded yet in this range
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={data} margin={{ top: 24, right: 8, left: -16, bottom: 0 }}>
            <CartesianGrid stroke="var(--gridline)" vertical={false} />
            <XAxis
              dataKey="date"
              tickFormatter={(d) => format(new Date(d), 'd MMM')}
              tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
              axisLine={{ stroke: 'var(--baseline)' }}
              tickLine={false}
            />
            <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} axisLine={false} tickLine={false} width={36} />
            <Tooltip cursor={{ fill: 'var(--surface-2)' }} content={<ClientDateTooltip clientKeys={clientKeys} />} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            {clientKeys.map((key, i) => (
              <Bar
                key={key}
                dataKey={key}
                name={key}
                stackId="dispatch"
                fill={colorFor(i, key)}
                maxBarSize={36}
                radius={i === clientKeys.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]}
              >
                <LabelList
                  dataKey={key}
                  position="center"
                  angle={-90}
                  formatter={segmentFmt}
                  style={segmentLabelStyle}
                />
                {i === clientKeys.length - 1 && (
                  <LabelList dataKey="__total" position="top" formatter={fmt} style={labelStyle} />
                )}
              </Bar>
            ))}
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
          <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
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
              <LabelList dataKey="total" position="center" formatter={fmt} style={insideLabelStyle} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </ChartCard>
  );
}
