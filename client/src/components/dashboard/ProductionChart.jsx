import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, AreaChart, Area } from 'recharts';
import { format } from 'date-fns';

const STAGE_LABELS = {
  cutting: 'Cutting',
  fitUp: 'Fit-up',
  welding: 'Welding',
  visual: 'Visual',
  blasting: 'Blasting',
  finalCoat: 'Final Coat',
};

const STAGE_ORDER = ['cutting', 'fitUp', 'welding', 'visual', 'blasting', 'finalCoat'];
const STAGE_COLOR = 'var(--series-1)';
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

function BarTooltip({ active, payload, labelKey = 'label' }) {
  if (!active || !payload?.length) return null;
  return (
    <div
      className="rounded-lg border px-3 py-2 text-xs shadow-md"
      style={{ background: 'var(--surface-2)', color: 'var(--text-primary)' }}
    >
      {payload[0].payload[labelKey]}: <strong>{payload[0].value}</strong> MT
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
      <div className="mt-1 font-semibold">{payload[0].value} MT completed</div>
    </div>
  );
}

export function ProductionTrendChart({ trend }) {
  const data = trend.map((t) => ({ date: t.date, total: t.total }));

  return (
    <ChartCard title="Final-coat completions, day by day" subtitle="MT completed per day in the selected range">
      {data.length === 0 ? (
        <div className="flex h-[220px] items-center justify-center text-sm" style={{ color: 'var(--text-muted)' }}>
          No completions recorded yet in this range
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={data} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
            <defs>
              <linearGradient id="productionFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--series-3)" stopOpacity={0.25} />
                <stop offset="100%" stopColor="var(--series-3)" stopOpacity={0} />
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
            <Area type="monotone" dataKey="total" stroke="var(--series-3)" strokeWidth={2} fill="url(#productionFill)" />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </ChartCard>
  );
}

export function ProductionStageChart({ byStage }) {
  const map = new Map(byStage.map((s) => [s.stage, s.total]));
  const data = STAGE_ORDER.map((stage) => ({ stage, label: STAGE_LABELS[stage], total: map.get(stage) || 0 }));

  return (
    <ChartCard title="Production by process stage" subtitle="MT progressed per stage in the selected range">
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={data} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
          <CartesianGrid stroke="var(--gridline)" vertical={false} />
          <XAxis dataKey="label" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} axisLine={{ stroke: 'var(--baseline)' }} tickLine={false} />
          <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} axisLine={false} tickLine={false} width={36} />
          <Tooltip cursor={{ fill: 'var(--surface-2)' }} content={<BarTooltip />} />
          <Bar dataKey="total" fill={STAGE_COLOR} radius={[4, 4, 0, 0]} maxBarSize={40} />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

export function ProductionClientChart({ byClient }) {
  const data = byClient.map((c) => ({ label: c.client, total: c.total }));

  return (
    <ChartCard title="Completed MT by client" subtitle="Final-coat completions in the selected range">
      {data.length === 0 ? (
        <div className="flex h-[220px] items-center justify-center text-sm" style={{ color: 'var(--text-muted)' }}>
          No completions recorded yet in this range
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={data} layout="vertical" margin={{ top: 4, right: 24, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="var(--gridline)" horizontal={false} />
            <XAxis type="number" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} axisLine={false} tickLine={false} />
            <YAxis type="category" dataKey="label" tick={{ fill: 'var(--text-secondary)', fontSize: 12 }} axisLine={false} tickLine={false} width={80} />
            <Tooltip cursor={{ fill: 'var(--surface-2)' }} content={<BarTooltip />} />
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
