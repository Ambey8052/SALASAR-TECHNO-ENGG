import { useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Legend, ResponsiveContainer, Cell, AreaChart, Area, LabelList } from 'recharts';
import { format } from 'date-fns';
import { ChartModal, ExpandHint } from './ChartModal';

const fmt = (v) => (typeof v === 'number' ? Math.round(v * 10) / 10 : v);
const labelStyle = { fill: 'var(--text-secondary)', fontSize: 10 };
const insideLabelStyle = { fill: '#ffffff', fontSize: 11, fontWeight: 600 };
const segmentFmt = (v) => (v ? Math.round(v * 10) / 10 : '');

const STAGE_LABELS = {
  cutting: 'Cutting',
  fitUp: 'Fit-up',
  welding: 'Welding',
  visual: 'Visual',
  blasting: 'Blasting',
  finalCoat: 'Final Coat',
};

const STAGE_ORDER = ['cutting', 'fitUp', 'welding', 'visual', 'blasting', 'finalCoat'];
const CLIENT_COLORS = ['var(--series-2)', 'var(--series-3)', 'var(--series-4)', 'var(--series-5)', 'var(--series-7)'];

function ChartCard({ title, subtitle, onClick, children }) {
  return (
    <div
      className={onClick ? 'group relative rounded-2xl border p-5 transition-shadow hover:shadow-md' : 'rounded-2xl border p-5'}
      style={{ background: 'var(--surface-1)', cursor: onClick ? 'pointer' : undefined }}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => (e.key === 'Enter' || e.key === ' ') && onClick() : undefined}
    >
      {onClick && <ExpandHint />}
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

const PX_PER_POINT = 42;

function ProductionAreaChart({ data, expanded }) {
  const chart = (
    <AreaChart data={data} margin={{ top: 20, right: 8, left: expanded ? 0 : -16, bottom: 0 }}>
      <defs>
        <linearGradient id="productionFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--series-3)" stopOpacity={0.25} />
          <stop offset="100%" stopColor="var(--series-3)" stopOpacity={0} />
        </linearGradient>
      </defs>
      <CartesianGrid stroke="var(--gridline)" vertical={false} />
      <XAxis
        dataKey="date"
        interval={expanded ? 0 : undefined}
        tickFormatter={(d) => format(new Date(d), 'd MMM')}
        tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
        axisLine={{ stroke: 'var(--baseline)' }}
        tickLine={false}
        angle={expanded ? -35 : 0}
        textAnchor={expanded ? 'end' : 'middle'}
        height={expanded ? 50 : 30}
      />
      <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} axisLine={false} tickLine={false} width={36} />
      <Area type="monotone" dataKey="total" stroke="var(--series-3)" strokeWidth={2} fill="url(#productionFill)" dot={{ r: 3, fill: 'var(--series-3)', strokeWidth: 0 }}>
        <LabelList dataKey="total" position="top" formatter={fmt} style={labelStyle} />
      </Area>
    </AreaChart>
  );

  if (!expanded) {
    return (
      <ResponsiveContainer width="100%" height={220}>
        {chart}
      </ResponsiveContainer>
    );
  }

  return (
    <div className="overflow-x-auto">
      <div style={{ minWidth: Math.max(data.length * PX_PER_POINT, 600) }}>
        <ResponsiveContainer width="100%" height={440}>
          {chart}
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export function ProductionTrendChart({ trend }) {
  const [expanded, setExpanded] = useState(false);
  const data = trend.map((t) => ({ date: t.date, total: t.total }));
  const empty = data.length === 0;

  return (
    <>
      <ChartCard
        title="Final-coat completions, day by day"
        subtitle="MT completed per day in the selected range"
        onClick={empty ? undefined : () => setExpanded(true)}
      >
        {empty ? (
          <div className="flex h-[220px] items-center justify-center text-sm" style={{ color: 'var(--text-muted)' }}>
            No completions recorded yet in this range
          </div>
        ) : (
          <ProductionAreaChart data={data} expanded={false} />
        )}
      </ChartCard>
      <ChartModal
        title="Final-coat completions, day by day"
        subtitle="Every day in the selected range"
        isOpen={expanded}
        onClose={() => setExpanded(false)}
      >
        <ProductionAreaChart data={data} expanded />
      </ChartModal>
    </>
  );
}

export function ProductionStageChart({ byStageByClient }) {
  const byStageMap = new Map(byStageByClient.map((row) => [row.stage, row]));

  const clientTotals = new Map();
  byStageByClient.forEach((row) => {
    Object.entries(row).forEach(([key, val]) => {
      if (key === 'stage') return;
      clientTotals.set(key, (clientTotals.get(key) || 0) + val);
    });
  });
  const clientKeys = [...clientTotals.entries()].sort((a, b) => b[1] - a[1]).map(([key]) => key);

  const data = STAGE_ORDER.map((stage) => {
    const row = byStageMap.get(stage) || {};
    const total = clientKeys.reduce((sum, key) => sum + (row[key] || 0), 0);
    return { stage, label: STAGE_LABELS[stage], ...row, __total: total };
  });

  return (
    <ChartCard title="Production by process stage" subtitle="MT progressed per stage in the selected range, by client">
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={data} margin={{ top: 24, right: 8, left: -16, bottom: 0 }}>
          <CartesianGrid stroke="var(--gridline)" vertical={false} />
          <XAxis dataKey="label" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} axisLine={{ stroke: 'var(--baseline)' }} tickLine={false} />
          <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} axisLine={false} tickLine={false} width={36} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {clientKeys.map((key, i) => (
            <Bar
              key={key}
              dataKey={key}
              name={key}
              stackId="stage"
              fill={CLIENT_COLORS[i % CLIENT_COLORS.length]}
              maxBarSize={56}
              radius={i === clientKeys.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]}
            >
              <LabelList dataKey={key} position="center" formatter={segmentFmt} style={insideLabelStyle} />
              {i === clientKeys.length - 1 && (
                <LabelList dataKey="__total" position="top" formatter={fmt} style={labelStyle} />
              )}
            </Bar>
          ))}
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
          <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="var(--gridline)" horizontal={false} />
            <XAxis type="number" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} axisLine={false} tickLine={false} />
            <YAxis type="category" dataKey="label" tick={{ fill: 'var(--text-secondary)', fontSize: 12 }} axisLine={false} tickLine={false} width={80} />
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
