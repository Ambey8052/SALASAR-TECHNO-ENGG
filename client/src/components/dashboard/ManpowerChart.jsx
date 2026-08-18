import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, Cell, LabelList } from 'recharts';
import { format } from 'date-fns';

const fmt = (v) => (typeof v === 'number' ? Math.round(v * 10) / 10 : v);
const labelStyle = { fill: 'var(--text-secondary)', fontSize: 10 };
const insideLabelStyle = { fill: '#ffffff', fontSize: 11, fontWeight: 600 };

const CATEGORY_LABELS = {
  fabrication: 'Fabrication',
  painting: 'Painting',
  civil: 'Civil',
  shed: 'Shed',
  office: 'Office',
};

const CATEGORY_COLORS = {
  fabrication: 'var(--series-1)',
  painting: 'var(--series-2)',
  civil: 'var(--series-3)',
  shed: 'var(--series-4)',
  office: 'var(--series-7)',
};

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

function TrendTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div
      className="rounded-lg border px-3 py-2 text-xs shadow-md"
      style={{ background: 'var(--surface-2)', color: 'var(--text-primary)' }}
    >
      <div style={{ color: 'var(--text-muted)' }}>{format(new Date(label), 'd MMM yyyy')}</div>
      <div className="mt-1 font-semibold">{payload[0].value} on site</div>
    </div>
  );
}

export function ManpowerTrendChart({ trend }) {
  const data = trend.map((t) => ({ date: t.date, total: t.total }));

  return (
    <ChartCard title="Manpower on site">
      {data.length === 0 ? (
        <div className="flex h-[220px] items-center justify-center text-sm" style={{ color: 'var(--text-muted)' }}>
          No manpower data synced for this range yet
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={data} margin={{ top: 20, right: 8, left: -16, bottom: 0 }}>
            <defs>
              <linearGradient id="manpowerFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--series-1)" stopOpacity={0.25} />
                <stop offset="100%" stopColor="var(--series-1)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="var(--gridline)" vertical={false} />
            <XAxis
              dataKey="date"
              tickFormatter={(d) => format(new Date(d), 'd MMM')}
              tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
              axisLine={{ stroke: 'var(--baseline)' }}
              tickLine={false}
            />
            <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} axisLine={false} tickLine={false} width={36} />
            <Tooltip content={<TrendTooltip />} />
            <Area
              type="monotone"
              dataKey="total"
              stroke="var(--series-1)"
              strokeWidth={2}
              fill="url(#manpowerFill)"
              dot={{ r: 3, fill: 'var(--series-1)', strokeWidth: 0 }}
            >
              <LabelList dataKey="total" position="top" formatter={fmt} style={labelStyle} />
            </Area>
          </AreaChart>
        </ResponsiveContainer>
      )}
    </ChartCard>
  );
}

export function ManpowerCategoryChart({ byCategory }) {
  const data = byCategory.map((c) => ({ category: CATEGORY_LABELS[c.category] || c.category, total: c.total, key: c.category }));

  return (
    <ChartCard title="Manpower by category" subtitle="Average headcount per day, by category, in the selected range">
      {data.length === 0 ? (
        <div className="flex h-[220px] items-center justify-center text-sm" style={{ color: 'var(--text-muted)' }}>
          No manpower data synced for this range yet
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="var(--gridline)" horizontal={false} />
            <XAxis type="number" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} axisLine={false} tickLine={false} />
            <YAxis
              type="category"
              dataKey="category"
              tick={{ fill: 'var(--text-secondary)', fontSize: 12 }}
              axisLine={false}
              tickLine={false}
              width={90}
            />
            <Tooltip
              cursor={{ fill: 'var(--surface-2)' }}
              content={({ active, payload }) =>
                active && payload?.length ? (
                  <div
                    className="rounded-lg border px-3 py-2 text-xs shadow-md"
                    style={{ background: 'var(--surface-2)', color: 'var(--text-primary)' }}
                  >
                    {payload[0].payload.category}: <strong>{payload[0].value}</strong> avg/day
                  </div>
                ) : null
              }
            />
            <Bar dataKey="total" radius={[0, 4, 4, 0]} maxBarSize={22}>
              {data.map((d) => (
                <Cell key={d.key} fill={CATEGORY_COLORS[d.key] || 'var(--series-1)'} />
              ))}
              <LabelList dataKey="total" position="center" formatter={fmt} style={insideLabelStyle} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </ChartCard>
  );
}
