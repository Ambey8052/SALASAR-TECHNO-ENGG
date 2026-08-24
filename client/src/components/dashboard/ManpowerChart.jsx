import { useState } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, ResponsiveContainer, BarChart, Bar, Cell, LabelList } from 'recharts';
import { format } from 'date-fns';
import { ChartModal, ExpandHint } from './ChartModal';

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

function ManpowerAreaChart({ data, expanded }) {
  const chart = (
    <AreaChart data={data} margin={{ top: 20, right: 8, left: expanded ? 0 : -16, bottom: 0 }}>
      <defs>
        <linearGradient id="manpowerFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--series-1)" stopOpacity={0.25} />
          <stop offset="100%" stopColor="var(--series-1)" stopOpacity={0} />
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

export function ManpowerTrendChart({ trend }) {
  const [expanded, setExpanded] = useState(false);
  const data = trend.map((t) => ({ date: t.date, total: t.total }));
  const empty = data.length === 0;

  return (
    <>
      <ChartCard title="Manpower on site" onClick={empty ? undefined : () => setExpanded(true)}>
        {empty ? (
          <div className="flex h-[220px] items-center justify-center text-sm" style={{ color: 'var(--text-muted)' }}>
            No manpower data synced for this range yet
          </div>
        ) : (
          <ManpowerAreaChart data={data} expanded={false} />
        )}
      </ChartCard>
      <ChartModal
        title="Manpower on site"
        subtitle="Every day in the selected range"
        isOpen={expanded}
        onClose={() => setExpanded(false)}
      >
        <ManpowerAreaChart data={data} expanded />
      </ChartModal>
    </>
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
